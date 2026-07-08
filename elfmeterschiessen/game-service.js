// Echte Mehrgeräte-Anbindung über Firebase Realtime Database + Anonymous Auth.
//
// Architektur-Kernpunkt (Abweichung von den Quartett-Spielen in diesem Hub):
// Anders als bei den Kartenspielen gibt es hier keine dauerhaft geheime Hand, die ein
// Gastgeber-Gerät als Schiedsrichter schützen müsste — beide Geräte sind gleichberechtigte
// Peers. Jede Seite schreibt nur ihr eigenes Feld (schussZiel bzw. wurfZiel); die einzige
// echte Race Condition ("wer berechnet das Rundenergebnis?") wird über eine Firebase
// transaction() auf aktuelleRunde/aufloesungClaim gelöst (siehe beanspracheAufloesung).
// Dass der Gegner das eigene Ziel nicht VOR der eigenen Entscheidung sieht, ist nur
// clientseitig durchgesetzt (getZustand() blendet es vor Phase "aufloesung" aus) — wie
// überall sonst in dieser Flotte ist das kein serverseitig erzwungener Schutz.
//
// Eigener "elfmeterschiessen/"-Namensraum, getrennt von den anderen Spielen im selben
// Firebase-Projekt "spiele-sc1911".

const STORAGE_KEY = "spiele_elfmeterschiessen_raumcode";
const RAUMCODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/I, leichter vorzulesen
const SPIELER_FARBEN = ["#1a56a0", "#057a55", "#c9941f", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#ea580c"];
const MAX_SPIELER = 2;
const REGULAERE_RUNDEN = 10;
const REICHWEITE = 0.45; // Torwart-Reichweite in Torraum-Einheiten, Tuning-Wert
const BEREIT_ANZEIGE_MS = 1500;
const AUFLOESUNG_ANIMATION_MS = 700;
const WEITER_AUTO_MS = 6000;
const RAEUME_PFAD = "elfmeterschiessen/raeume";
const BESTENLISTE_PFAD = "elfmeterschiessen/bestenliste";

function slugifyName(name) {
  return (name || "").trim().toLowerCase().replace(/[.#$\[\]/]/g, "_") || "unbekannt";
}

function fuegeStatistikUpdatesHinzu(updates, spieler, gewinnerUid) {
  Object.keys(spieler).forEach(uid => {
    const slug = slugifyName(spieler[uid].name);
    const basis = `${BESTENLISTE_PFAD}/${slug}`;
    updates[`${basis}/name`] = spieler[uid].name;
    updates[`${basis}/gespielt`] = firebase.database.ServerValue.increment(1);
    if (uid === gewinnerUid) {
      updates[`${basis}/gewonnen`] = firebase.database.ServerValue.increment(1);
    }
  });
}

let eigeneUid = null;
let aktuellerRaumCode = null;
let roomRef = null;
let letzterOeffentlicherZustand = null;
let listener = null;

// Pro-Runde-Guards (Wert = Rundennummer, für die schon gehandelt wurde). Verhindern,
// dass mehrfach feuernde on("value")-Events dieselbe Runde doppelt vorantreiben.
let bereitTimerGeplantFuerRunde = null;
let aufloesungVersuchtFuerRunde = null;
let aufloesungTimerGeplantFuerRunde = null;
let autoWeiterTimerGeplantFuerRunde = null;

const authBereit = new Promise(resolve => {
  auth.onAuthStateChanged(user => {
    if (user) {
      eigeneUid = user.uid;
      resolve(user.uid);
    }
  });
});
auth.signInAnonymously().catch(err => console.error("Anonyme Anmeldung fehlgeschlagen:", err));

function erzeugeRaumCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += RAUMCODE_ZEICHEN[Math.floor(Math.random() * RAUMCODE_ZEICHEN.length)];
  }
  return code;
}

async function erzeugeEindeutigenRaumCode() {
  for (let versuch = 0; versuch < 5; versuch++) {
    const code = erzeugeRaumCode();
    const snap = await db.ref(`${RAEUME_PFAD}/${code}`).once("value");
    if (!snap.exists()) return code;
  }
  throw new Error("Konnte keinen freien Raum-Code erzeugen.");
}

function rundenLabel(rundenNummer) {
  if (!rundenNummer) return "";
  if (rundenNummer <= REGULAERE_RUNDEN) return `Runde ${rundenNummer}/${REGULAERE_RUNDEN}`;
  return `Sudden Death – Paar ${Math.ceil((rundenNummer - REGULAERE_RUNDEN) / 2)}`;
}

function neueRundeObjekt(nummer, schuetzeUid, torwartUid) {
  return {
    nummer,
    schuetzeUid,
    torwartUid,
    schussZiel: null,
    wurfZiel: null,
    ergebnis: null,
    aufloesungClaim: null,
    naechsteRunde: null,
    spielEndeSiegerUid: null
  };
}

function zustandOhneRaum() {
  return {
    raumCode: null,
    modus: null,
    eigenerSpielerId: eigeneUid,
    spieler: [],
    gegnerName: null,
    phase: "start",
    hostId: null,
    rundenNummer: 0,
    rundenLabel: "",
    punkte: { eigene: 0, gegner: 0 },
    siegerUid: null,
    binSieger: null,
    aktuelleRunde: null,
    maxSpieler: MAX_SPIELER
  };
}

function getZustand() {
  const raum = letzterOeffentlicherZustand;
  if (!raum) return zustandOhneRaum();

  const spielerListe = Object.keys(raum.spieler || {}).map(uid => ({ id: uid, ...raum.spieler[uid] }));
  const eigenerSpieler = raum.spieler ? raum.spieler[eigeneUid] : null;
  const gegner = spielerListe.find(s => s.id !== eigeneUid) || null;

  const runde = raum.aktuelleRunde;
  const zielSichtbar = !!runde && (raum.phase === "aufloesung" || raum.phase === "ergebnis" || raum.phase === "beendet");

  let meineRolle = null;
  if (runde) {
    if (runde.schuetzeUid === eigeneUid) meineRolle = "schuetze";
    else if (runde.torwartUid === eigeneUid) meineRolle = "torwart";
  }

  return {
    raumCode: aktuellerRaumCode,
    modus: eigenerSpieler ? (eigenerSpieler.istHost ? "host" : "gast") : null,
    eigenerSpielerId: eigeneUid,
    spieler: spielerListe,
    gegnerName: gegner ? gegner.name : null,
    phase: raum.phase || "lobby",
    hostId: raum.hostId || null,
    rundenNummer: raum.rundenNummer || 0,
    rundenLabel: rundenLabel(raum.rundenNummer || 0),
    punkte: {
      eigene: (raum.punkte && raum.punkte[eigeneUid]) || 0,
      gegner: gegner ? (raum.punkte && raum.punkte[gegner.id]) || 0 : 0
    },
    siegerUid: raum.siegerUid || null,
    binSieger: raum.siegerUid ? raum.siegerUid === eigeneUid : null,
    aktuelleRunde: runde ? {
      nummer: runde.nummer,
      meineRolle,
      schussZiel: zielSichtbar ? runde.schussZiel : null,
      wurfZiel: zielSichtbar ? runde.wurfZiel : null,
      meinZiel: meineRolle === "schuetze" ? runde.schussZiel : meineRolle === "torwart" ? runde.wurfZiel : null,
      habeIchCommittet: meineRolle === "schuetze" ? !!runde.schussZiel : meineRolle === "torwart" ? !!runde.wurfZiel : false,
      gegnerBereit: meineRolle === "schuetze" ? !!runde.wurfZiel : meineRolle === "torwart" ? !!runde.schussZiel : false,
      ergebnis: zielSichtbar ? runde.ergebnis : null
    } : null,
    maxSpieler: MAX_SPIELER
  };
}

function benachrichtige() {
  if (listener && letzterOeffentlicherZustand) {
    listener(getZustand());
  }
}

function loeseListenerAb() {
  if (roomRef) roomRef.off();
  roomRef = null;
  letzterOeffentlicherZustand = null;
  bereitTimerGeplantFuerRunde = null;
  aufloesungVersuchtFuerRunde = null;
  aufloesungTimerGeplantFuerRunde = null;
  autoWeiterTimerGeplantFuerRunde = null;
}

function betretRaumLokal(code) {
  loeseListenerAb();
  aktuellerRaumCode = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch (e) {
    // unkritisch, falls localStorage nicht verfügbar ist
  }

  roomRef = db.ref(`${RAEUME_PFAD}/${code}`);
  roomRef.on("value", snap => {
    letzterOeffentlicherZustand = snap.val();
    if (!letzterOeffentlicherZustand) return; // Raum wurde beendet/gelöscht
    pruefeUndPlaneUebergaenge(letzterOeffentlicherZustand);
    benachrichtige();
  });
}

// --- Öffentliche API ---

async function erstelleRaum(spielerName) {
  if (!spielerName || !spielerName.trim()) {
    return { erfolg: false, fehler: "Bitte einen Namen eingeben." };
  }
  await authBereit;
  const code = await erzeugeEindeutigenRaumCode();
  await db.ref(`${RAEUME_PFAD}/${code}`).set({
    erstelltAm: firebase.database.ServerValue.TIMESTAMP,
    hostId: eigeneUid,
    phase: "lobby",
    rundenNummer: 0,
    punkte: { [eigeneUid]: 0 },
    siegerUid: null,
    aktuelleRunde: null,
    spieler: {
      [eigeneUid]: { name: spielerName.trim(), avatarFarbe: SPIELER_FARBEN[0], istHost: true }
    }
  });
  betretRaumLokal(code);
  return { erfolg: true, raumCode: code };
}

async function tritRaumBei(raumCode, spielerName) {
  if (!spielerName || !spielerName.trim()) {
    return { erfolg: false, fehler: "Bitte einen Namen eingeben." };
  }
  if (!raumCode || !raumCode.trim()) {
    return { erfolg: false, fehler: "Bitte einen Raum-Code eingeben." };
  }
  await authBereit;
  const code = raumCode.trim().toUpperCase();
  const snap = await db.ref(`${RAEUME_PFAD}/${code}`).once("value");
  if (!snap.exists()) {
    return { erfolg: false, fehler: "Raum nicht gefunden." };
  }
  const raum = snap.val();
  const spielerListe = raum.spieler || {};

  if (spielerListe[eigeneUid]) {
    betretRaumLokal(code); // schon Mitglied, z.B. nach Reload
    return { erfolg: true };
  }
  if (raum.phase !== "lobby") {
    return { erfolg: false, fehler: "Dieses Spiel läuft schon." };
  }
  if (Object.keys(spielerListe).length >= MAX_SPIELER) {
    return { erfolg: false, fehler: "Raum ist voll (max. 2)." };
  }

  const farbe = SPIELER_FARBEN[Object.keys(spielerListe).length % SPIELER_FARBEN.length];
  await db.ref(`${RAEUME_PFAD}/${code}/spieler/${eigeneUid}`).set({
    name: spielerName.trim(),
    avatarFarbe: farbe,
    istHost: false
  });
  await db.ref(`${RAEUME_PFAD}/${code}/punkte/${eigeneUid}`).set(0);
  betretRaumLokal(code);
  return { erfolg: true };
}

async function starteSpiel() {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  const uids = Object.keys(raum.spieler || {});
  if (uids.length < 2) return { erfolg: false, fehler: "Warte auf eine zweite Person." };
  const gastUid = uids.find(uid => uid !== raum.hostId);

  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}`).update({
    phase: "bereit",
    rundenNummer: 1,
    aktuelleRunde: neueRundeObjekt(1, raum.hostId, gastUid)
  });
  return { erfolg: true };
}

async function commitSchuss(x, y, macht) {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "eingabe" || !raum.aktuelleRunde) return { erfolg: false };
  if (raum.aktuelleRunde.schuetzeUid !== eigeneUid || raum.aktuelleRunde.schussZiel) return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/aktuelleRunde/schussZiel`).set({ x, y, macht });
  return { erfolg: true };
}

async function commitWurf(x, y) {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "eingabe" || !raum.aktuelleRunde) return { erfolg: false };
  if (raum.aktuelleRunde.torwartUid !== eigeneUid || raum.aktuelleRunde.wurfZiel) return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/aktuelleRunde/wurfZiel`).set({ x, y });
  return { erfolg: true };
}

async function bestaetigeWeiter() {
  const raum = letzterOeffentlicherZustand;
  if (!raum || raum.phase !== "ergebnis" || !raum.aktuelleRunde) return { erfolg: false };
  await fuehreWeiterAus(raum.aktuelleRunde.nummer);
  return { erfolg: true };
}

async function verlasseSpiel() {
  const raum = letzterOeffentlicherZustand;
  const code = aktuellerRaumCode;
  if (raum && code && raum.phase !== "beendet") {
    await db.ref(`${RAEUME_PFAD}/${code}/phase`).set("abgebrochen").catch(() => {});
  }
  loeseListenerAb();
  aktuellerRaumCode = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (listener) listener(zustandOhneRaum());
  return { erfolg: true };
}

async function neuesSpiel() {
  const raum = letzterOeffentlicherZustand;
  const code = aktuellerRaumCode;
  if (raum && code && raum.hostId === eigeneUid) {
    db.ref(`${RAEUME_PFAD}/${code}`).remove().catch(() => {});
  }
  loeseListenerAb();
  aktuellerRaumCode = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (listener) listener(zustandOhneRaum());
  return { erfolg: true };
}

async function ladeBestenliste() {
  await authBereit;
  const snap = await db.ref(BESTENLISTE_PFAD).once("value");
  const daten = snap.val() || {};
  return Object.values(daten)
    .map(eintrag => {
      const gespielt = eintrag.gespielt || 0;
      const gewonnen = eintrag.gewonnen || 0;
      return {
        name: eintrag.name || "?",
        gespielt,
        gewonnen,
        prozent: gespielt > 0 ? Math.round((gewonnen / gespielt) * 100) : 0
      };
    })
    .sort((a, b) => b.prozent - a.prozent || b.gewonnen - a.gewonnen);
}

async function setzeBestenlisteZurueck() {
  await authBereit;
  await db.ref(BESTENLISTE_PFAD).remove();
  return { erfolg: true };
}

function onZustandsAenderung(callback) {
  listener = callback;
  let gespeicherterCode = null;
  try {
    gespeicherterCode = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (gespeicherterCode) {
    authBereit.then(() => betretRaumLokal(gespeicherterCode));
  } else {
    callback(zustandOhneRaum());
  }
}

// --- Zustandsmaschine: Peer-symmetrische Runden-Übergänge ---
// Kein Host-Schiedsrichter (siehe Kommentar am Dateianfang). "bereit"->"eingabe" und
// "aufloesung"->"ergebnis" sind reine Zeit-Übergänge, die JEDES Gerät unabhängig auslösen
// darf (idempotenter Literal-Write, unkritisch bei doppeltem Schreiben). Die Ergebnis-
// Berechnung selbst ist die einzige echte Race Condition und läuft über eine Firebase
// transaction() auf aktuelleRunde/aufloesungClaim (siehe beanspracheAufloesung).

function pruefeUndPlaneUebergaenge(raum) {
  if (!raum || !raum.aktuelleRunde) return;
  const runde = raum.aktuelleRunde;
  const rundenNummer = runde.nummer;

  if (raum.phase === "bereit" && bereitTimerGeplantFuerRunde !== rundenNummer) {
    bereitTimerGeplantFuerRunde = rundenNummer;
    setTimeout(() => uebergangFallsPhaseUnveraendert(rundenNummer, "bereit", "eingabe"), BEREIT_ANZEIGE_MS);
  }

  if (raum.phase === "eingabe" && runde.schussZiel && runde.wurfZiel && aufloesungVersuchtFuerRunde !== rundenNummer) {
    aufloesungVersuchtFuerRunde = rundenNummer;
    beanspracheAufloesung(rundenNummer);
  }

  if (raum.phase === "aufloesung" && runde.ergebnis && aufloesungTimerGeplantFuerRunde !== rundenNummer) {
    aufloesungTimerGeplantFuerRunde = rundenNummer;
    setTimeout(() => uebergangFallsPhaseUnveraendert(rundenNummer, "aufloesung", "ergebnis"), AUFLOESUNG_ANIMATION_MS);
  }

  if (raum.phase === "ergebnis" && autoWeiterTimerGeplantFuerRunde !== rundenNummer) {
    autoWeiterTimerGeplantFuerRunde = rundenNummer;
    setTimeout(() => fuehreWeiterAus(rundenNummer), WEITER_AUTO_MS);
  }
}

function uebergangFallsPhaseUnveraendert(rundenNummer, erwartetePhase, neuePhase) {
  const aktuell = letzterOeffentlicherZustand;
  if (!aktuell || aktuell.phase !== erwartetePhase || !aktuell.aktuelleRunde || aktuell.aktuelleRunde.nummer !== rundenNummer) return;
  db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/phase`).set(neuePhase).catch(() => {});
}

function beanspracheAufloesung(rundenNummer) {
  db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/aktuelleRunde/aufloesungClaim`).transaction(
    aktuellerWert => (aktuellerWert ? undefined : eigeneUid),
    (fehler, committed, snap) => {
      if (!fehler && committed && snap.val() === eigeneUid) {
        fuehreAufloesungAus(rundenNummer);
      }
    }
  );
}

// Deterministische Auflösung, kein Zufall: "vorbei" bei Schuss außerhalb des Tor-Rahmens,
// sonst "gehalten" wenn das Schussziel innerhalb der Torwart-Reichweite liegt, sonst "tor".
function loeseAuf(schussZiel, wurfZiel) {
  if (!schussZiel || !wurfZiel) return "vorbei";
  if (Math.abs(schussZiel.x) > 1 || schussZiel.y > 1) return "vorbei";
  const abstand = Math.hypot(schussZiel.x - wurfZiel.x, schussZiel.y - wurfZiel.y);
  return abstand <= REICHWEITE ? "gehalten" : "tor";
}

// Alterniert strikt Host/Gast (Host schießt auf ungeraden Rundennummern). Läuft nach
// REGULAERE_RUNDEN als Sudden Death weiter, bis nach einem abgeschlossenen Paar (gerade
// Rundennummer) ein Punkteunterschied besteht.
function berechneNaechsteRundeOderEnde(punkte, abgeschlosseneRundenNummer, hostId, gastUid) {
  const paarKomplett = abgeschlosseneRundenNummer % 2 === 0;
  const hostPunkte = punkte[hostId] || 0;
  const gastPunkte = punkte[gastUid] || 0;
  if (paarKomplett && abgeschlosseneRundenNummer >= REGULAERE_RUNDEN && hostPunkte !== gastPunkte) {
    return { beendet: true, siegerUid: hostPunkte > gastPunkte ? hostId : gastUid };
  }
  const naechsteNummer = abgeschlosseneRundenNummer + 1;
  const naechsterSchuetze = naechsteNummer % 2 === 1 ? hostId : gastUid;
  const naechsterTorwart = naechsterSchuetze === hostId ? gastUid : hostId;
  return { beendet: false, nummer: naechsteNummer, schuetzeUid: naechsterSchuetze, torwartUid: naechsterTorwart };
}

// Läuft NUR im Client, der die aufloesungClaim-Transaction gewonnen hat (siehe
// beanspracheAufloesung) — daher hier ganz normale (nicht transaction-geschützte)
// Multi-Path-Updates, es gibt keine zweite gleichzeitige Ausführung dieser Funktion.
async function fuehreAufloesungAus(rundenNummer) {
  const raum = letzterOeffentlicherZustand;
  const code = aktuellerRaumCode;
  if (!raum || !code || !raum.aktuelleRunde || raum.aktuelleRunde.nummer !== rundenNummer) return;
  const runde = raum.aktuelleRunde;
  const ergebnis = loeseAuf(runde.schussZiel, runde.wurfZiel);
  const hostId = raum.hostId;
  const gastUid = Object.keys(raum.spieler).find(uid => uid !== hostId);

  // punkte in letzterOeffentlicherZustand ist der Stand VOR dieser Runde – für die
  // Sudden-Death-Entscheidung muss ein möglicher Torerfolg dieser Runde lokal
  // vorgerechnet werden, auch wenn der eigentliche Firebase-Write per increment() läuft.
  const punkteNachRunde = { ...raum.punkte };
  if (ergebnis === "tor") {
    punkteNachRunde[runde.schuetzeUid] = (punkteNachRunde[runde.schuetzeUid] || 0) + 1;
  }
  const naechste = berechneNaechsteRundeOderEnde(punkteNachRunde, rundenNummer, hostId, gastUid);

  const updates = {
    [`${RAEUME_PFAD}/${code}/aktuelleRunde/ergebnis`]: ergebnis,
    [`${RAEUME_PFAD}/${code}/phase`]: "aufloesung",
    [`${RAEUME_PFAD}/${code}/verlauf/${rundenNummer}`]: {
      schuetzeUid: runde.schuetzeUid,
      torwartUid: runde.torwartUid,
      schussZiel: runde.schussZiel,
      wurfZiel: runde.wurfZiel,
      ergebnis
    }
  };
  if (ergebnis === "tor") {
    updates[`${RAEUME_PFAD}/${code}/punkte/${runde.schuetzeUid}`] = firebase.database.ServerValue.increment(1);
  }
  if (naechste.beendet) {
    updates[`${RAEUME_PFAD}/${code}/aktuelleRunde/spielEndeSiegerUid`] = naechste.siegerUid;
    fuegeStatistikUpdatesHinzu(updates, raum.spieler, naechste.siegerUid);
  } else {
    updates[`${RAEUME_PFAD}/${code}/aktuelleRunde/naechsteRunde`] = naechste;
  }

  await db.ref().update(updates);
}

// Idempotent: kopiert nur bereits beim Auflösen vorberechnete Werte (naechsteRunde /
// spielEndeSiegerUid), berechnet nichts neu — deshalb unkritisch, wenn beide Geräte
// (Button-Tap und Auto-Timer) dies für dieselbe Runde gleichzeitig ausführen.
async function fuehreWeiterAus(rundenNummer) {
  const raum = letzterOeffentlicherZustand;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "ergebnis" || !raum.aktuelleRunde || raum.aktuelleRunde.nummer !== rundenNummer) return;
  const runde = raum.aktuelleRunde;
  if (runde.spielEndeSiegerUid) {
    await db.ref(`${RAEUME_PFAD}/${code}`).update({ phase: "beendet", siegerUid: runde.spielEndeSiegerUid }).catch(() => {});
  } else if (runde.naechsteRunde) {
    await db.ref(`${RAEUME_PFAD}/${code}`).update({
      phase: "bereit",
      rundenNummer: runde.naechsteRunde.nummer,
      aktuelleRunde: neueRundeObjekt(runde.naechsteRunde.nummer, runde.naechsteRunde.schuetzeUid, runde.naechsteRunde.torwartUid)
    }).catch(() => {});
  }
}

const gameService = {
  erstelleRaum,
  tritRaumBei,
  starteSpiel,
  commitSchuss,
  commitWurf,
  bestaetigeWeiter,
  verlasseSpiel,
  neuesSpiel,
  getZustand,
  onZustandsAenderung,
  ladeBestenliste,
  setzeBestenlisteZurueck,
  // fuer Tests/Verifikation direkt aufrufbar (reine Funktionen, kein Firebase-Zugriff):
  loeseAuf,
  berechneNaechsteRundeOderEnde,
  rundenLabel
};
