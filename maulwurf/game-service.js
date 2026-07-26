// Mehrgeräte-Anbindung über Firebase Realtime Database + Anonymous Auth.
// Eigener Namensraum "maulwurf/", getrennt von den anderen Spielen im Projekt spiele-sc1911.
//
// ============================================================================
// ARCHITEKTUR-KERNENTSCHEIDUNG: verdeckte Selbstziehung der Rollen
// ============================================================================
// Bei einem Verräterspiel ist das Muster "Gastgeber-Gerät ist Schiedsrichter" aus den
// Quartett-Spielen dieses Hubs UNBRAUCHBAR: wer die Rollen verteilt, kennt sie, und ein
// Blick in die DevTools würde die ganze Partie entwerten. Peer-symmetrisch wie beim
// Elfmeterschießen reicht allein auch nicht, weil dort schlicht nichts geheim bleiben muss.
//
// Deshalb hier ein drittes Muster:
//   1. Beim Start schreibt der Host nur ein GEMISCHTES, ANONYMES Rollen-Deck, z.B.
//      ["team","team","maulwurf","team",…]. Das ist eine reine Multimenge — sie verrät nur
//      die Anzahl der Maulwürfe, und die steht ohnehin in den Einstellungen.
//   2. Jedes Gerät zieht danach SELBST per transaction() auf zuteilungZaehler seinen Index
//      und liest daraus seine eigene Rolle. Niemand — auch nicht der Host — erfährt dabei,
//      welcher Index zu welcher Person gehört.
//   3. Die gezogene Rolle landet in geheime_rollen/$code/$uid. database.rules.json grenzt
//      diesen Pfad per "$uid === auth.uid" ein: fremde Rollen sind serverseitig nicht lesbar.
//   4. Maulwürfe tragen sich zusätzlich in maulwurf_team/$code ein. Dieser Knoten ist per
//      Rule nur lesbar, wenn die eigene Rolle "maulwurf" ist — so erkennen sich Maulwürfe
//      gegenseitig, ohne dass das Team mitliest.
//
// Das ist das erste Mal in dieser Flotte, dass ein Geheimnis serverseitig (per Rule)
// durchgesetzt wird statt nur clientseitig verborgen. Was das NICHT abdeckt, steht unten
// unter "Bekannte Grenzen".
//
// ============================================================================
// Schreibvolumen (der kritische Punkt bei Echtzeit-Bewegung auf Firebase)
// ============================================================================
// Positionen liegen bewusst in einem EIGENEN Top-Level-Pfad maulwurf/positionen/$code und
// nicht im Raumobjekt — sonst würde jeder Positions-Tick den kompletten Raumzustand an alle
// Geräte pushen. Zusätzlich horchen die Clients per child_added/child_changed (nicht
// on("value")), sodass pro Tick nur der eine geänderte Datensatz übertragen wird.
// Rechnung für die größte Partie: 10 Spieler * 5 Hz = 50 Writes/s, jeder Client empfängt
// 50 * ~40 Byte = ~2 KB/s, bei 10 Clients ~20 KB/s. Eine 10-Minuten-Partie kostet damit
// ~12 MB Download. Mit on("value") auf dem Raumobjekt wäre es das Zehn- bis Zwanzigfache
// gewesen und der Free-Tier nach wenigen Partien aufgebraucht.
//
// ============================================================================
// Bekannte Grenzen (bewusst so, nicht als Bug melden)
// ============================================================================
// - Positionen sind für alle authentifizierten Clients lesbar. Wer die (öffentliche)
//   Firebase-Config kennt und die Konsole öffnet, sieht alle Figuren durch die Wände. Das
//   Sichtfeld ist eine Darstellungs-, keine Schutzgrenze.
// - Wer sich per Konsole selbst rolle:"maulwurf" in die eigene Box schreibt, kann die
//   Maulwurf-Liste lesen. Verhindern ließe sich das nur mit serverseitiger Rollenvergabe
//   (Cloud Function / Worker mit Admin-Secret). Für ein Busfahrt-Spiel im Team bewusst
//   nicht gebaut — entscheidend ist, dass unter NORMALER Nutzung kein Gerät fremde Rollen
//   bekommt, auch nicht das des Gastgebers.
// - Kills werden clientseitig auf Reichweite/Cooldown geprüft, nicht serverseitig.
// - Die rollenabhängigen Siegbedingungen (alle Maulwürfe raus / Maulwürfe in Überzahl)
//   können nur Maulwurf-Geräte erkennen, weil nur sie die nötige Information haben. Sie
//   melden sie über eine transaction auf siegClaim. Das setzt voraus, dass mindestens ein
//   Maulwurf-Gerät verbunden bleibt — Geister bleiben im Spiel, also ist das normalerweise
//   gegeben. Fällt wirklich jedes Maulwurf-Gerät aus, bleibt dem Host der Abbrechen-Knopf.
// - KI-Mitspieler steuert das Host-Gerät, also kennt der Host deren Rollen. Für Solo-Übung
//   irrelevant; in gemischten Partien ein kleiner, bewusst hingenommener Wissensvorsprung.

const STORAGE_KEY = "spiele_maulwurf_raumcode";
const RAUMCODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O/1/I, leichter vorzulesen
const SPIELER_FARBEN = [
  "#dc2626", "#1a56a0", "#057a55", "#c9941f", "#9333ea",
  "#0891b2", "#db2777", "#ea580c", "#4d7c0f", "#57534e"
];
const MIN_SPIELER = 4;
const MAX_SPIELER = 10;

const RAEUME_PFAD = "maulwurf/raeume";
const POSITIONEN_PFAD = "maulwurf/positionen";
const CHAT_PFAD = "maulwurf/chat";
const ROLLEN_PFAD = "maulwurf/geheime_rollen";
const TEAM_PFAD = "maulwurf/maulwurf_team";
const AUFDECKUNG_PFAD = "maulwurf/aufdeckung";
const BESTENLISTE_PFAD = "maulwurf/bestenliste";

const POSITION_INTERVALL_MS = 200;   // 5 Hz, siehe Schreibvolumen-Rechnung oben
const POSITION_MINDEST_DELTA = 1.5;  // darunter wird gar nicht geschrieben
const REVEAL_DAUER_MS = 4500;
const MEETING_ERGEBNIS_MS = 6000;
const SABOTAGE_HEIZUNG_MS = 45000;
const TUEREN_SPERRE_MS = 12000;
const SABOTAGE_COOLDOWN_MS = 25000;
const BOT_TICK_MS = 200;
const BOT_AUFGABE_MS = 9000;
const BOT_STIMME_MS = 11000;

const STANDARD_EINSTELLUNGEN = {
  killCooldownSek: 30,
  diskussionSek: 45,
  abstimmungSek: 60,
  notfallKnoepfe: 1,
  aufgabenProSpieler: 5,
  tempo: 175
};

function anzahlMaulwuerfeFuer(spielerAnzahl) {
  return spielerAnzahl >= 7 ? 2 : 1;
}

function slugifyName(name) {
  return (name || "").trim().toLowerCase().replace(/[.#$\[\]/]/g, "_") || "unbekannt";
}

function mischeListe(liste) {
  const kopie = liste.slice();
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const merk = kopie[i];
    kopie[i] = kopie[j];
    kopie[j] = merk;
  }
  return kopie;
}

// KI-Mitspieler zählen nicht für die Bestenliste — sonst würde jede Solo-Übungspartie die
// eigene Quote verzerren (gleiche Regel wie beim Elfmeterschießen in diesem Hub).
// "gewonnen" wird hier bewusst NICHT vergeben: der auflösende Client kennt die Rollen der
// anderen nicht. Jedes Gerät trägt seinen eigenen Sieg selbst nach, siehe
// meldeEigenenAusgang().
function fuegeStatistikUpdatesHinzu(updates, spieler) {
  Object.keys(spieler).forEach(uid => {
    if (spieler[uid].istSimuliert) return;
    const slug = slugifyName(spieler[uid].name);
    const basis = `${BESTENLISTE_PFAD}/${slug}`;
    updates[`${basis}/name`] = spieler[uid].name;
    updates[`${basis}/gespielt`] = firebase.database.ServerValue.increment(1);
  });
}

let eigeneUid = null;
let aktuellerRaumCode = null;
let roomRef = null;
let positionenRef = null;
let chatRef = null;
let teamRef = null;
let letzterRaum = null;
let listener = null;

let meineRolle = null;         // "team" | "maulwurf" | null
let meineAufgaben = [];        // Stations-Ids
let meineErledigten = [];      // Stations-Ids
let maulwurfTeamRoh = {};      // uid -> {name, runde}, nur wenn ich Maulwurf bin
let positionen = {};           // uid -> {x,y}
let chatVerlauf = [];
let meinePosition = null;
let serverOffset = 0;

// Guards gegen Doppelausführung durch mehrfach feuernde on()-Events. ALLE davon, die um
// einen await-Block liegen, gehören in ein try/finally — bleibt so ein Flag nach einem
// Fehler stehen, ist die betroffene Funktion für den Rest der Sitzung tot.
let zuteilungLaeuft = false;
let botZuteilungLaeuft = false;
let rollenNachladenLaeuft = false;
let revealTimerFuerRunde = null;
let meetingUebergangGeplantFuer = null;
let ausgangGemeldetFuerRunde = null;
let aufdeckungGeschriebenFuerRunde = null;
let aufdeckungListenerAktiv = false;
let botTimer = null;
let positionTimer = null;
let tickTimer = null;
let letzterPositionsWrite = 0;
const botZustand = {};         // botId -> { ziel, letzteAufgabe, stimmeAb }

const authBereit = new Promise(resolve => {
  auth.onAuthStateChanged(user => {
    if (user) {
      eigeneUid = user.uid;
      resolve(user.uid);
    }
  });
});
auth.signInAnonymously().catch(err => console.error("Anonyme Anmeldung fehlgeschlagen:", err));

// Firebase liefert den Uhren-Versatz zum Server. Alle Countdowns arbeiten mit absoluten
// Endzeitpunkten, die jedes Gerät gegen serverJetzt() prüft — ohne diese Korrektur würde
// ein Handy mit falsch gestellter Uhr das Meeting zu früh oder zu spät beenden.
db.ref(".info/serverTimeOffset").on("value", snap => {
  serverOffset = snap.val() || 0;
});

function serverJetzt() {
  return Date.now() + serverOffset;
}

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

// --- Zustands-Aufbereitung für die Oberfläche ---

function zustandOhneRaum() {
  return {
    raumCode: null,
    phase: "start",
    eigenerSpielerId: eigeneUid,
    spieler: [],
    istHost: false,
    einstellungen: Object.assign({}, STANDARD_EINSTELLUNGEN),
    maxSpieler: MAX_SPIELER,
    minSpieler: MIN_SPIELER
  };
}

function lebendeSpieler(raum) {
  return Object.keys(raum.spieler || {}).filter(uid => raum.spieler[uid].lebt !== false);
}

function getZustand() {
  const raum = letzterRaum;
  if (!raum) return zustandOhneRaum();

  const spielerListe = Object.keys(raum.spieler || {}).map(uid => ({
    id: uid,
    ...raum.spieler[uid],
    position: positionen[uid] || null
  }));
  const eigener = raum.spieler ? raum.spieler[eigeneUid] : null;
  const binGeist = !!(eigener && eigener.lebt === false);

  return {
    raumCode: aktuellerRaumCode,
    phase: raum.phase || "lobby",
    runde: rundeVon(raum),
    eigenerSpielerId: eigeneUid,
    istHost: raum.hostId === eigeneUid,
    hostId: raum.hostId,
    spieler: spielerListe,
    eigener: eigener ? { id: eigeneUid, ...eigener } : null,
    binGeist,
    binDabei: !!eigener,
    meineRolle,
    meineAufgaben: meineAufgaben.map(id => ({
      id,
      station: karte.stationNachId(id),
      erledigt: meineErledigten.indexOf(id) !== -1
    })),
    maulwurfTeam: meineRolle === "maulwurf" ? Object.keys(aktuelleMaulwuerfe()) : [],
    positionen,
    meinePosition,
    leichen: raum.leichen || {},
    aufgaben: raum.aufgaben || { erledigt: 0, gesamt: 0 },
    sabotage: raum.sabotage || null,
    tueren: raum.tueren || {},
    meeting: raum.meeting || null,
    chat: chatVerlauf,
    killCooldownBis: (raum.killCooldownBis && raum.killCooldownBis[eigeneUid]) || 0,
    sabotageCooldownBis: raum.sabotageCooldownBis || 0,
    sieger: raum.sieger || null,
    siegGrund: raum.siegGrund || null,
    aufdeckung: raum.aufdeckungCache || null,
    einstellungen: Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {}),
    anzahlMaulwuerfe: (raum.einstellungen && raum.einstellungen.anzahlMaulwuerfe) || anzahlMaulwuerfeFuer(spielerListe.length),
    revealBis: raum.revealBis || 0,
    jetzt: serverJetzt(),
    maxSpieler: MAX_SPIELER,
    minSpieler: MIN_SPIELER
  };
}

function benachrichtige() {
  if (listener && letzterRaum) listener(getZustand());
}

function loeseListenerAb() {
  if (roomRef) roomRef.off();
  if (positionenRef) positionenRef.off();
  if (chatRef) chatRef.off();
  if (teamRef) teamRef.off();
  roomRef = positionenRef = chatRef = teamRef = null;
  letzterRaum = null;
  meineRolle = null;
  meineAufgaben = [];
  meineErledigten = [];
  maulwurfTeamRoh = {};
  positionen = {};
  chatVerlauf = [];
  meinePosition = null;
  zuteilungLaeuft = false;
  botZuteilungLaeuft = false;
  rollenNachladenLaeuft = false;
  revealTimerFuerRunde = null;
  meetingUebergangGeplantFuer = null;
  ausgangGemeldetFuerRunde = null;
  aufdeckungGeschriebenFuerRunde = null;
  aufdeckungListenerAktiv = false;
  Object.keys(botZustand).forEach(k => delete botZustand[k]);
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
  if (positionTimer) { clearInterval(positionTimer); positionTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
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
    letzterRaum = snap.val();
    if (!letzterRaum) return; // Raum wurde beendet/gelöscht
    verarbeiteRaumZustand(letzterRaum);
    benachrichtige();
  });

  // Positionen bewusst einzeln pro Kind, nicht als ganzer Knoten — siehe Volumen-Rechnung
  // im Dateikopf.
  positionenRef = db.ref(`${POSITIONEN_PFAD}/${code}`);
  positionenRef.on("child_added", snap => { positionen[snap.key] = snap.val(); benachrichtige(); });
  positionenRef.on("child_changed", snap => { positionen[snap.key] = snap.val(); benachrichtige(); });
  positionenRef.on("child_removed", snap => { delete positionen[snap.key]; benachrichtige(); });

  chatRef = db.ref(`${CHAT_PFAD}/${code}`);
  chatRef.on("child_added", snap => {
    chatVerlauf.push(Object.assign({ id: snap.key }, snap.val()));
    benachrichtige();
  });
  chatRef.on("value", snap => {
    if (!snap.exists() && chatVerlauf.length) { chatVerlauf = []; benachrichtige(); }
  });

  // Die eigene Rolle wird NICHT hier nachgeladen, sondern in verarbeiteRaumZustand — erst
  // dort ist die Rundennummer bekannt, gegen die die gespeicherte Box geprüft werden muss.

  // Alle Countdowns (Diskussion, Abstimmung, Heizung, Rollen-Reveal) laufen gegen absolute
  // Endzeitpunkte. Ohne eigenen Taktgeber würden sie nur bei einem Firebase-Update geprüft —
  // und genau während eines Countdowns schreibt oft niemand. Dieser Tick zieht die
  // Zustandsmaschine deshalb einmal pro Sekunde nach; alle darin aufgerufenen Prüfungen
  // sind idempotent bzw. transaction-geschützt.
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (letzterRaum) {
      verarbeiteRaumZustand(letzterRaum);
      benachrichtige();
    }
  }, 1000);
}

function uebernehmeEigeneRolle(daten) {
  meineRolle = daten.rolle || null;
  meineAufgaben = daten.aufgaben || [];
  meineErledigten = daten.erledigt || [];
  if (meineRolle === "maulwurf" && !teamRef && aktuellerRaumCode) {
    teamRef = db.ref(`${TEAM_PFAD}/${aktuellerRaumCode}`);
    teamRef.on("value", snap => {
      maulwurfTeamRoh = snap.val() || {};
      benachrichtige();
    });
  }
  benachrichtige();
}

// Der Knoten maulwurf_team lässt sich beim Rundenwechsel NICHT löschen: die Rules erlauben
// Schreibzugriff nur auf $uid-Ebene, ein remove() auf den Elternknoten wird abgelehnt (und
// der Fehler landete im .catch()). Wer in der Vorrunde Maulwurf war, blieb dadurch in der
// Liste stehen — beim Rematch zählten die alten Einträge mit und die Siegprüfung meldete
// sofort "Maulwürfe in Überzahl" (gefunden im E2E-Test, 2026-07-26).
// Deshalb trägt jeder Eintrag seine Rundennummer und es wird beim LESEN gefiltert, statt
// sich auf ein Aufräumen zu verlassen.
// Fehlt die Rundennummer, stammt der Eintrag aus einer Version vor diesem Feld und gehört
// zur ersten Runde. Bewusst nicht "x || 1": eine 0 ist falsy und würde damit zu 1 werden.
function rundeVon(objekt) {
  const wert = objekt && objekt.runde;
  return (wert === undefined || wert === null) ? 1 : wert;
}

function aktuelleMaulwuerfe() {
  const runde = rundeVon(letzterRaum);
  const gefiltert = {};
  Object.keys(maulwurfTeamRoh).forEach(uid => {
    const eintrag = maulwurfTeamRoh[uid];
    if (eintrag && rundeVon(eintrag) === runde) gefiltert[uid] = eintrag;
  });
  return gefiltert;
}

// --- Öffentliche API: Lobby ---

async function erstelleRaum(spielerName) {
  if (!spielerName || !spielerName.trim()) return { erfolg: false, fehler: "Bitte einen Namen eingeben." };
  await authBereit;
  const code = await erzeugeEindeutigenRaumCode();
  await db.ref(`${RAEUME_PFAD}/${code}`).set({
    erstelltAm: firebase.database.ServerValue.TIMESTAMP,
    hostId: eigeneUid,
    phase: "lobby",
    runde: 1,
    einstellungen: Object.assign({}, STANDARD_EINSTELLUNGEN, { anzahlMaulwuerfe: 1 }),
    spieler: {
      [eigeneUid]: { name: spielerName.trim(), farbe: SPIELER_FARBEN[0], istHost: true, istSimuliert: false, lebt: true }
    }
  });
  betretRaumLokal(code);
  return { erfolg: true, raumCode: code };
}

async function tritRaumBei(raumCode, spielerName) {
  if (!spielerName || !spielerName.trim()) return { erfolg: false, fehler: "Bitte einen Namen eingeben." };
  if (!raumCode || !raumCode.trim()) return { erfolg: false, fehler: "Bitte einen Raum-Code eingeben." };
  await authBereit;
  const code = raumCode.trim().toUpperCase();
  const snap = await db.ref(`${RAEUME_PFAD}/${code}`).once("value");
  if (!snap.exists()) return { erfolg: false, fehler: "Raum nicht gefunden." };

  const raum = snap.val();
  const spielerListe = raum.spieler || {};
  if (spielerListe[eigeneUid]) {
    betretRaumLokal(code); // schon Mitglied, z.B. nach Reload
    return { erfolg: true };
  }
  if (raum.phase !== "lobby") return { erfolg: false, fehler: "Diese Partie läuft schon." };
  if (Object.keys(spielerListe).length >= MAX_SPIELER) return { erfolg: false, fehler: `Raum ist voll (max. ${MAX_SPIELER}).` };

  const belegteFarben = Object.keys(spielerListe).map(uid => spielerListe[uid].farbe);
  const farbe = SPIELER_FARBEN.find(f => belegteFarben.indexOf(f) === -1) || SPIELER_FARBEN[0];
  await db.ref(`${RAEUME_PFAD}/${code}/spieler/${eigeneUid}`).set({
    name: spielerName.trim(), farbe, istHost: false, istSimuliert: false, lebt: true
  });
  betretRaumLokal(code);
  return { erfolg: true };
}

async function fuegeKiMitspielerHinzu() {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  const uids = Object.keys(raum.spieler || {});
  if (uids.length >= MAX_SPIELER) return { erfolg: false, fehler: "Die Lobby ist schon voll." };

  const belegteFarben = uids.map(uid => raum.spieler[uid].farbe);
  const farbe = SPIELER_FARBEN.find(f => belegteFarben.indexOf(f) === -1) || SPIELER_FARBEN[0];
  const botId = "bot-" + Math.random().toString(36).slice(2, 9);
  const nummer = uids.filter(uid => raum.spieler[uid].istSimuliert).length + 1;
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/spieler/${botId}`).set({
    name: "KI " + nummer, farbe, istHost: false, istSimuliert: true, lebt: true
  });
  return { erfolg: true };
}

async function entferneKiMitspieler(botId) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  if (!raum.spieler[botId] || !raum.spieler[botId].istSimuliert) return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/spieler/${botId}`).remove();
  return { erfolg: true };
}

async function speichereEinstellungen(neue) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/einstellungen`).update(neue);
  return { erfolg: true };
}

// --- Partiestart: anonymes Rollen-Deck schreiben ---

async function starteSpiel() {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "lobby" || raum.hostId !== eigeneUid) return { erfolg: false };
  const uids = Object.keys(raum.spieler || {});
  if (uids.length < MIN_SPIELER) return { erfolg: false, fehler: `Mindestens ${MIN_SPIELER} Mitspielende nötig.` };

  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  const anzahlMaulwuerfe = Math.min(einstellungen.anzahlMaulwuerfe || anzahlMaulwuerfeFuer(uids.length), Math.floor(uids.length / 2) - 1 || 1);

  // Das Deck ist bewusst nur eine gemischte Liste OHNE Zuordnung zu Personen — der Host
  // erfährt beim Schreiben nichts über die spätere Verteilung.
  const deck = [];
  for (let i = 0; i < uids.length; i++) deck.push(i < anzahlMaulwuerfe ? "maulwurf" : "team");
  const gemischt = mischeListe(deck);

  const teamAnzahl = uids.length - anzahlMaulwuerfe;
  const updates = {};
  const basis = `${RAEUME_PFAD}/${aktuellerRaumCode}`;
  updates[`${basis}/phase`] = "zuteilung";
  updates[`${basis}/rollenDeck`] = gemischt;
  updates[`${basis}/zuteilungZaehler`] = 0;
  updates[`${basis}/einstellungen/anzahlMaulwuerfe`] = anzahlMaulwuerfe;
  updates[`${basis}/aufgaben`] = { erledigt: 0, gesamt: teamAnzahl * einstellungen.aufgabenProSpieler };
  updates[`${basis}/leichen`] = null;
  updates[`${basis}/sabotage`] = null;
  updates[`${basis}/tueren`] = null;
  updates[`${basis}/meeting`] = null;
  updates[`${basis}/killCooldownBis`] = null;
  updates[`${basis}/sabotageCooldownBis`] = 0;
  updates[`${basis}/siegClaim`] = null;
  updates[`${basis}/sieger`] = null;
  updates[`${basis}/siegGrund`] = null;
  updates[`${basis}/revealBis`] = 0;
  uids.forEach(uid => {
    updates[`${basis}/spieler/${uid}/lebt`] = true;
    updates[`${basis}/spieler/${uid}/notfallUebrig`] = einstellungen.notfallKnoepfe;
  });
  await db.ref().update(updates);
  await db.ref(`${AUFDECKUNG_PFAD}/${aktuellerRaumCode}`).remove().catch(() => {});
  return { erfolg: true };
}

// Zieht per transaction genau einen Index aus dem Deck. Läuft auf JEDEM Gerät für sich
// selbst — dadurch weiß kein anderes Gerät, welcher Index vergeben wurde.
function ziehIndex(code) {
  return new Promise(resolve => {
    db.ref(`${RAEUME_PFAD}/${code}/zuteilungZaehler`).transaction(
      wert => (wert || 0) + 1,
      (fehler, committed, snap) => {
        if (fehler || !committed) return resolve(null);
        resolve(snap.val() - 1); // der Wert VOR dem Hochzählen ist der eigene Index
      }
    );
  });
}

function waehleAufgaben(anzahl) {
  // Pro Aufgabentyp höchstens einmal, damit die Runde abwechslungsreich bleibt.
  const nachTyp = {};
  karte.STATIONEN.forEach(st => {
    if (!nachTyp[st.typ]) nachTyp[st.typ] = [];
    nachTyp[st.typ].push(st.id);
  });
  const typen = mischeListe(Object.keys(nachTyp));
  const gewaehlt = [];
  typen.forEach(typ => {
    if (gewaehlt.length >= anzahl) return;
    const stationen = nachTyp[typ];
    gewaehlt.push(stationen[Math.floor(Math.random() * stationen.length)]);
  });
  return gewaehlt.slice(0, anzahl);
}

// Die Rollenbox trägt die Rundennummer mit. Ohne sie würde eine Box, die eine neueRunde()
// überlebt hat (verlorenes remove(), Schreib-Race), in der Folgerunde als gültige aktuelle
// Rolle durchgehen — man behielte im Rematch seine alte Rolle (gefunden im E2E-Test,
// 2026-07-26).
function boxGehoertZurRunde(box, raum) {
  return !!box && rundeVon(box) === rundeVon(raum);
}

async function zieheEigeneRolle(raum) {
  if (zuteilungLaeuft || meineRolle) return;
  const code = aktuellerRaumCode;
  if (!code || !raum.rollenDeck) return;
  zuteilungLaeuft = true;

  // try/finally ist hier Pflicht, nicht Kosmetik: ohne das finally bliebe zuteilungLaeuft
  // nach einem einzigen fehlgeschlagenen Write dauerhaft true, und das Gerät bekäme in
  // KEINER weiteren Runde je wieder eine Rolle (gefunden im E2E-Test, 2026-07-26).
  try {
    const vorhanden = await db.ref(`${ROLLEN_PFAD}/${code}/${eigeneUid}`).once("value");
    if (vorhanden.exists() && boxGehoertZurRunde(vorhanden.val(), raum)) {
      uebernehmeEigeneRolle(vorhanden.val());
      return;
    }

    const index = await ziehIndex(code);
    if (index === null || index >= raum.rollenDeck.length) return;

    const rolle = raum.rollenDeck[index];
    const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
    const daten = {
      rolle, index, runde: rundeVon(raum),
      aufgaben: waehleAufgaben(einstellungen.aufgabenProSpieler), erledigt: []
    };
    await db.ref(`${ROLLEN_PFAD}/${code}/${eigeneUid}`).set(daten);
    if (rolle === "maulwurf") {
      await db.ref(`${TEAM_PFAD}/${code}/${eigeneUid}`).set({ name: raum.spieler[eigeneUid].name, runde: rundeVon(raum) });
    }
    uebernehmeEigeneRolle(daten);
  } catch (e) {
    console.error("Rollenziehung fehlgeschlagen, nächster Takt versucht es erneut:", e);
  } finally {
    zuteilungLaeuft = false;
  }
}

// Nach einem Reload mitten in der Partie (Phase läuft schon, es wird nichts mehr gezogen)
// die eigene Rolle nachladen — aber nur, wenn sie zur laufenden Runde gehört.
async function ladeEigeneRolleNach(raum) {
  if (rollenNachladenLaeuft || meineRolle || !aktuellerRaumCode) return;
  rollenNachladenLaeuft = true;
  try {
    const snap = await db.ref(`${ROLLEN_PFAD}/${aktuellerRaumCode}/${eigeneUid}`).once("value");
    if (snap.exists() && boxGehoertZurRunde(snap.val(), raum)) uebernehmeEigeneRolle(snap.val());
  } catch (e) {
    // unkritisch, der Sekundentakt versucht es erneut
  } finally {
    rollenNachladenLaeuft = false;
  }
}

// Bots haben kein eigenes Gerät — der Host zieht für sie. Das ist der eine Punkt, an dem
// der Host mehr weiß als die anderen (siehe "Bekannte Grenzen" im Dateikopf).
async function zieheBotRollen(raum) {
  const code = aktuellerRaumCode;
  if (!code || raum.hostId !== eigeneUid || botZuteilungLaeuft) return;
  botZuteilungLaeuft = true;
  try {
    const bots = Object.keys(raum.spieler).filter(uid => raum.spieler[uid].istSimuliert);
    for (const botId of bots) {
      const vorhanden = await db.ref(`${ROLLEN_PFAD}/${code}/${botId}`).once("value");
      if (vorhanden.exists() && boxGehoertZurRunde(vorhanden.val(), raum)) {
        botZustand[botId] = botZustand[botId] || {};
        botZustand[botId].rolle = vorhanden.val().rolle;
        continue;
      }
      const index = await ziehIndex(code);
      if (index === null || index >= raum.rollenDeck.length) return;
      const rolle = raum.rollenDeck[index];
      const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
      await db.ref(`${ROLLEN_PFAD}/${code}/${botId}`).set({
        rolle, index, runde: rundeVon(raum),
        aufgaben: waehleAufgaben(einstellungen.aufgabenProSpieler), erledigt: []
      });
      if (rolle === "maulwurf") {
        await db.ref(`${TEAM_PFAD}/${code}/${botId}`).set({ name: raum.spieler[botId].name, runde: rundeVon(raum) });
      }
      botZustand[botId] = botZustand[botId] || {};
      botZustand[botId].rolle = rolle;
    }
  } catch (e) {
    console.error("Bot-Rollenziehung fehlgeschlagen:", e);
  } finally {
    botZuteilungLaeuft = false;
  }
}

// --- Zustandsmaschine: läuft bei jedem Raum-Update auf jedem Gerät ---

function verarbeiteRaumZustand(raum) {
  const code = aktuellerRaumCode;
  if (!code) return;

  if (raum.phase === "zuteilung") {
    zieheEigeneRolle(raum);
    if (raum.hostId === eigeneUid) zieheBotRollen(raum);
    const anzahl = Object.keys(raum.spieler || {}).length;
    if ((raum.zuteilungZaehler || 0) >= anzahl && !raum.revealBis) {
      // Idempotenter Literal-Write: mehrere Geräte dürfen das gleichzeitig setzen.
      db.ref(`${RAEUME_PFAD}/${code}/revealBis`).set(serverJetzt() + REVEAL_DAUER_MS).catch(() => {});
    }
    if (raum.revealBis && revealTimerFuerRunde !== raum.runde) {
      revealTimerFuerRunde = raum.runde;
      const restZeit = Math.max(raum.revealBis - serverJetzt(), 0);
      setTimeout(() => {
        const aktuell = letzterRaum;
        if (aktuell && aktuell.phase === "zuteilung") {
          db.ref(`${RAEUME_PFAD}/${code}/phase`).set("laeuft").catch(() => {});
        }
      }, restZeit);
    }
  }

  if (raum.phase === "laeuft") {
    if (!meineRolle) ladeEigeneRolleNach(raum); // z.B. nach einem Reload mitten in der Partie
    pruefeSabotageAblauf(raum);
    pruefeAufgabenSieg(raum);
    pruefeRollenabhaengigenSieg(raum);
    starteBotSchleifeFallsNoetig(raum);
    if (raum.meeting) pruefeMeetingUebergaenge(raum);
  }

  if (raum.phase === "beendet") {
    meldeEigenenAusgang(raum);
    schreibeEigeneAufdeckung(raum);
    ladeAufdeckung();
    if (botTimer) { clearInterval(botTimer); botTimer = null; }
  }
}

// --- Bewegung ---

function setzeStartposition(raum) {
  const daten = raum || letzterRaum;
  if (!daten) return;
  const uids = Object.keys(daten.spieler || {});
  const punkte = karte.startPositionen(uids.length);
  const index = Math.max(uids.indexOf(eigeneUid), 0);
  meinePosition = Object.assign({}, punkte[index % punkte.length]);
  schreibePosition(true);
}

// Abkürzung: Positionssprung ohne Kollisionsprüfung (nur Maulwürfe, siehe karte.TUNNEL).
function springeZu(x, y) {
  if (!meinePosition) return;
  meinePosition.x = x;
  meinePosition.y = y;
  schreibePosition(true);
}

function bewege(dx, dy, sekunden) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft" || raum.meeting) return;
  if (!meinePosition) return;
  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  const laenge = Math.hypot(dx, dy);
  if (laenge < 0.01) return;
  const tempo = einstellungen.tempo * (raum.spieler[eigeneUid] && raum.spieler[eigeneUid].lebt === false ? 1.35 : 1);
  const schritt = tempo * sekunden;
  const zielX = (dx / laenge) * schritt;
  const zielY = (dy / laenge) * schritt;

  const binGeist = raum.spieler[eigeneUid] && raum.spieler[eigeneUid].lebt === false;
  const neu = binGeist
    ? { x: Math.min(Math.max(meinePosition.x + zielX, 0), karte.WELT_BREITE), y: Math.min(Math.max(meinePosition.y + zielY, 0), karte.WELT_HOEHE) }
    : karte.bewegeMitKollision(meinePosition.x, meinePosition.y, zielX, zielY);

  // Verriegelte Türen: Räume dürfen nicht betreten/verlassen werden, solange die Sperre
  // läuft. Geister ignorieren das (sie laufen ohnehin durch Wände).
  if (!binGeist && !tuerDurchgangErlaubt(raum, meinePosition, neu)) return;
  meinePosition = neu;
}

function tuerDurchgangErlaubt(raum, alt, neu) {
  const tueren = raum.tueren || {};
  const jetzt = serverJetzt();
  const alterRaum = karte.raumAn(alt.x, alt.y);
  const neuerRaum = karte.raumAn(neu.x, neu.y);
  const alterId = alterRaum ? alterRaum.id : null;
  const neuerId = neuerRaum ? neuerRaum.id : null;
  if (alterId === neuerId) return true;
  if (alterId && tueren[alterId] > jetzt) return false;
  if (neuerId && tueren[neuerId] > jetzt) return false;
  return true;
}

function schreibePosition(sofort) {
  if (!meinePosition || !aktuellerRaumCode || !eigeneUid) return;
  const jetzt = Date.now();
  if (!sofort && jetzt - letzterPositionsWrite < POSITION_INTERVALL_MS) return;
  const alt = positionen[eigeneUid];
  if (!sofort && alt && Math.hypot(alt.x - meinePosition.x, alt.y - meinePosition.y) < POSITION_MINDEST_DELTA) return;
  letzterPositionsWrite = jetzt;
  const raum = letzterRaum;
  const geist = !!(raum && raum.spieler[eigeneUid] && raum.spieler[eigeneUid].lebt === false);
  db.ref(`${POSITIONEN_PFAD}/${aktuellerRaumCode}/${eigeneUid}`).set({
    x: Math.round(meinePosition.x),
    y: Math.round(meinePosition.y),
    geist
  }).catch(() => {});
}

function startePositionsSchleife() {
  if (positionTimer) return;
  positionTimer = setInterval(() => schreibePosition(false), POSITION_INTERVALL_MS);
}

// --- Aufgaben ---

async function erledigeAufgabe(stationId) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft") return { erfolg: false };
  if (meineAufgaben.indexOf(stationId) === -1) return { erfolg: false };
  if (meineErledigten.indexOf(stationId) !== -1) return { erfolg: false };

  meineErledigten = meineErledigten.concat([stationId]);
  await db.ref(`${ROLLEN_PFAD}/${aktuellerRaumCode}/${eigeneUid}/erledigt`).set(meineErledigten).catch(() => {});

  // Der eigentliche Bluff: Maulwürfe dürfen dieselbe Aufgabe spielen, ihr Ergebnis zählt
  // nur nicht für den gemeinsamen Fortschritt.
  if (meineRolle === "team") {
    await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/aufgaben/erledigt`)
      .set(firebase.database.ServerValue.increment(1)).catch(() => {});
  }
  benachrichtige();
  return { erfolg: true };
}

// --- Ausschalten ("Foulspiel") ---

async function schalteAus(opferUid) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (meineRolle !== "maulwurf") return { erfolg: false };
  if (raum.spieler[eigeneUid].lebt === false) return { erfolg: false };
  const opfer = raum.spieler[opferUid];
  if (!opfer || opfer.lebt === false) return { erfolg: false };
  if (aktuelleMaulwuerfe()[opferUid]) return { erfolg: false, fehler: "Das ist ein Maulwurf." };
  const cooldownBis = (raum.killCooldownBis && raum.killCooldownBis[eigeneUid]) || 0;
  if (cooldownBis > serverJetzt()) return { erfolg: false, fehler: "Noch nicht bereit." };
  const meine = positionen[eigeneUid];
  const seine = positionen[opferUid];
  if (!meine || !seine || karte.abstand(meine.x, meine.y, seine.x, seine.y) > karte.KILL_REICHWEITE) {
    return { erfolg: false, fehler: "Zu weit weg." };
  }

  // Race: zwei Maulwürfe könnten gleichzeitig dieselbe Person erwischen. Die Leiche wird
  // per transaction angelegt — nur wer sie tatsächlich setzt, schreibt danach den Rest.
  const ergebnis = await new Promise(resolve => {
    db.ref(`${RAEUME_PFAD}/${code}/leichen/${opferUid}`).transaction(
      wert => (wert ? undefined : { x: Math.round(seine.x), y: Math.round(seine.y), name: opfer.name, farbe: opfer.farbe, gemeldet: false }),
      (fehler, committed) => resolve(!fehler && committed)
    );
  });
  if (!ergebnis) return { erfolg: false };

  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  const updates = {};
  updates[`${RAEUME_PFAD}/${code}/spieler/${opferUid}/lebt`] = false;
  updates[`${RAEUME_PFAD}/${code}/killCooldownBis/${eigeneUid}`] = serverJetzt() + einstellungen.killCooldownSek * 1000;
  await db.ref().update(updates);
  return { erfolg: true };
}

// --- Meetings ---

async function meldeLeiche(leicheUid) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (raum.spieler[eigeneUid].lebt === false) return { erfolg: false };
  const leiche = (raum.leichen || {})[leicheUid];
  if (!leiche || leiche.gemeldet) return { erfolg: false };
  return starteMeeting("leiche", leiche.name);
}

async function drueckeNotfallknopf() {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  const eigener = raum.spieler[eigeneUid];
  if (!eigener || eigener.lebt === false) return { erfolg: false };
  if ((eigener.notfallUebrig || 0) <= 0) return { erfolg: false, fehler: "Kein Notfallknopf mehr übrig." };
  const ergebnis = await starteMeeting("notfall", null);
  if (ergebnis.erfolg) {
    await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/spieler/${eigeneUid}/notfallUebrig`)
      .set(firebase.database.ServerValue.increment(-1)).catch(() => {});
  }
  return ergebnis;
}

// Race: mehrere Personen können im selben Moment melden. Das ganze meeting-Objekt wird per
// transaction gesetzt — nur der erste Aufruf gewinnt, alle anderen sehen es schon belegt.
function starteMeeting(grund, opferName) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  const neu = {
    grund,
    opferName: opferName || null,
    ausgeloestVon: raum.spieler[eigeneUid].name,
    unterphase: "diskussion",
    endeAt: serverJetzt() + einstellungen.diskussionSek * 1000,
    stimmen: null,
    ergebnis: null,
    aufloesungClaim: null
  };
  return new Promise(resolve => {
    db.ref(`${RAEUME_PFAD}/${code}/meeting`).transaction(
      wert => (wert ? undefined : neu),
      async (fehler, committed) => {
        if (fehler || !committed) return resolve({ erfolg: false });
        // Sabotagen enden mit dem Meeting, Leichen werden abgeräumt.
        await db.ref(`${RAEUME_PFAD}/${code}`).update({ sabotage: null, tueren: null, leichen: null }).catch(() => {});
        resolve({ erfolg: true });
      }
    );
  });
}

async function sendeChat(text) {
  const raum = letzterRaum;
  if (!raum || !raum.meeting || !text || !text.trim()) return { erfolg: false };
  const eigener = raum.spieler[eigeneUid];
  if (!eigener || eigener.lebt === false) return { erfolg: false, fehler: "Geister können nicht sprechen." };
  await db.ref(`${CHAT_PFAD}/${aktuellerRaumCode}`).push({
    name: eigener.name,
    farbe: eigener.farbe,
    text: text.trim().slice(0, 140),
    t: firebase.database.ServerValue.TIMESTAMP
  });
  return { erfolg: true };
}

async function stimmeAb(zielUid) {
  const raum = letzterRaum;
  if (!raum || !raum.meeting || raum.meeting.unterphase !== "abstimmung") return { erfolg: false };
  const eigener = raum.spieler[eigeneUid];
  if (!eigener || eigener.lebt === false) return { erfolg: false };
  if (raum.meeting.stimmen && raum.meeting.stimmen[eigeneUid]) return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/meeting/stimmen/${eigeneUid}`).set(zielUid || "skip");
  return { erfolg: true };
}

function pruefeMeetingUebergaenge(raum) {
  const code = aktuellerRaumCode;
  const meeting = raum.meeting;
  const jetzt = serverJetzt();
  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  const schluessel = `${raum.runde}:${meeting.unterphase}`;

  if (meeting.unterphase === "diskussion") {
    planeBotStimmen(raum);
    if (jetzt >= meeting.endeAt && meetingUebergangGeplantFuer !== schluessel) {
      meetingUebergangGeplantFuer = schluessel;
      db.ref(`${RAEUME_PFAD}/${code}/meeting`).update({
        unterphase: "abstimmung",
        endeAt: serverJetzt() + einstellungen.abstimmungSek * 1000
      }).catch(() => {});
    }
    return;
  }

  if (meeting.unterphase === "abstimmung") {
    planeBotStimmen(raum);
    const lebende = lebendeSpieler(raum);
    const stimmen = meeting.stimmen || {};
    const alleHabenGestimmt = lebende.every(uid => stimmen[uid]);
    if (alleHabenGestimmt || jetzt >= meeting.endeAt) {
      beanspracheMeetingAufloesung(raum);
    }
    return;
  }

  if (meeting.unterphase === "ergebnis") {
    deckeAusgeschlosseneRolleAuf(raum);
    if (meeting.endeAt && jetzt >= meeting.endeAt && meetingUebergangGeplantFuer !== schluessel) {
      meetingUebergangGeplantFuer = schluessel;
      beendeMeeting(raum);
    }
  }
}

// Race: der Timer läuft auf jedem Gerät gleichzeitig ab. Genau ein Client darf auswerten.
function beanspracheMeetingAufloesung(raum) {
  const code = aktuellerRaumCode;
  db.ref(`${RAEUME_PFAD}/${code}/meeting/aufloesungClaim`).transaction(
    wert => (wert ? undefined : eigeneUid),
    (fehler, committed, snap) => {
      if (!fehler && committed && snap.val() === eigeneUid) werteAbstimmungAus(raum);
    }
  );
}

// Reine Funktion, damit sie sich ohne Firebase testen lässt: liefert die ausgeschlossene
// uid oder null (Gleichstand und "überspringen"-Mehrheit schließen niemanden aus).
function ermittleAusschluss(stimmen, lebendeUids) {
  const zaehler = {};
  Object.keys(stimmen || {}).forEach(waehler => {
    if (lebendeUids.indexOf(waehler) === -1) return;
    const ziel = stimmen[waehler];
    zaehler[ziel] = (zaehler[ziel] || 0) + 1;
  });
  let bestesZiel = null;
  let besteAnzahl = 0;
  let gleichstand = false;
  Object.keys(zaehler).forEach(ziel => {
    if (zaehler[ziel] > besteAnzahl) {
      besteAnzahl = zaehler[ziel];
      bestesZiel = ziel;
      gleichstand = false;
    } else if (zaehler[ziel] === besteAnzahl) {
      gleichstand = true;
    }
  });
  if (!bestesZiel || gleichstand || bestesZiel === "skip") return { ausgeschlossen: null, zaehler };
  return { ausgeschlossen: bestesZiel, zaehler };
}

async function werteAbstimmungAus(raum) {
  const code = aktuellerRaumCode;
  const lebende = lebendeSpieler(raum);
  const { ausgeschlossen, zaehler } = ermittleAusschluss(raum.meeting.stimmen || {}, lebende);

  const updates = {};
  updates[`${RAEUME_PFAD}/${code}/meeting/unterphase`] = "ergebnis";
  updates[`${RAEUME_PFAD}/${code}/meeting/endeAt`] = serverJetzt() + MEETING_ERGEBNIS_MS;
  updates[`${RAEUME_PFAD}/${code}/meeting/ergebnis`] = {
    ausgeschlossenUid: ausgeschlossen,
    ausgeschlossenName: ausgeschlossen ? raum.spieler[ausgeschlossen].name : null,
    zaehler
  };
  if (ausgeschlossen) updates[`${RAEUME_PFAD}/${code}/spieler/${ausgeschlossen}/lebt`] = false;
  await db.ref().update(updates);
}

// Die Rolle der ausgeschlossenen Person deckt ein Maulwurf-Gerät auf — nur diese Geräte
// haben die Information. Idempotent: schreiben alle Maulwürfe gleichzeitig, steht überall
// derselbe Wert.
async function deckeAusgeschlosseneRolleAuf(raum) {
  if (meineRolle !== "maulwurf") return;
  const daten = raum || letzterRaum;
  if (!daten) return;
  const meeting = daten.meeting;
  if (!meeting || !meeting.ergebnis || meeting.ergebnis.warMaulwurf !== undefined) return;
  const uid = meeting.ergebnis.ausgeschlossenUid;
  if (!uid) return;
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/meeting/ergebnis/warMaulwurf`)
    .set(!!aktuelleMaulwuerfe()[uid]).catch(() => {});
}

async function beendeMeeting(raum) {
  const code = aktuellerRaumCode;
  await db.ref(`${RAEUME_PFAD}/${code}`).update({ meeting: null }).catch(() => {});
  await db.ref(`${CHAT_PFAD}/${code}`).remove().catch(() => {});
  setzeStartposition(raum);
}

// --- Sabotagen ---

async function sabotiere(typ, raumId) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (meineRolle !== "maulwurf") return { erfolg: false };
  if (raum.spieler[eigeneUid].lebt === false) return { erfolg: false };
  if ((raum.sabotageCooldownBis || 0) > serverJetzt()) return { erfolg: false, fehler: "Noch nicht bereit." };

  if (typ === "tueren") {
    if (!raumId) return { erfolg: false };
    const updates = {};
    updates[`${RAEUME_PFAD}/${code}/tueren/${raumId}`] = serverJetzt() + TUEREN_SPERRE_MS;
    updates[`${RAEUME_PFAD}/${code}/sabotageCooldownBis`] = serverJetzt() + SABOTAGE_COOLDOWN_MS;
    await db.ref().update(updates);
    return { erfolg: true };
  }

  if (raum.sabotage) return { erfolg: false, fehler: "Läuft schon eine Sabotage." };
  const neu = typ === "heizung"
    ? { typ: "heizung", endeAt: serverJetzt() + SABOTAGE_HEIZUNG_MS, ventile: null, reparaturClaim: null, aufloesungClaim: null }
    : { typ: "flutlicht", endeAt: 0, reparaturClaim: null, aufloesungClaim: null };

  const gesetzt = await new Promise(resolve => {
    db.ref(`${RAEUME_PFAD}/${code}/sabotage`).transaction(
      wert => (wert ? undefined : neu),
      (fehler, committed) => resolve(!fehler && committed)
    );
  });
  if (!gesetzt) return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${code}/sabotageCooldownBis`).set(serverJetzt() + SABOTAGE_COOLDOWN_MS).catch(() => {});
  return { erfolg: true };
}

async function repariereFlutlicht() {
  const raum = letzterRaum;
  if (!raum || !raum.sabotage || raum.sabotage.typ !== "flutlicht") return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/sabotage`).set(null).catch(() => {});
  return { erfolg: true };
}

// Heizung: beide Ventile müssen GLEICHZEITIG gehalten werden. Jedes Gerät schreibt nur sein
// eigenes Ventil; die Prüfung "beide offen" macht dann der erste Client, der es sieht.
async function setzeHeizungsventil(seite, gehalten) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || !raum.sabotage || raum.sabotage.typ !== "heizung") return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${code}/sabotage/ventile/${seite}`).set(gehalten ? eigeneUid : null).catch(() => {});
  return { erfolg: true };
}

function pruefeSabotageAblauf(raum) {
  const code = aktuellerRaumCode;
  const sab = raum.sabotage;
  if (!sab) return;

  if (sab.typ === "heizung") {
    const ventile = sab.ventile || {};
    if (ventile.a && ventile.b) {
      db.ref(`${RAEUME_PFAD}/${code}/sabotage/reparaturClaim`).transaction(
        wert => (wert ? undefined : eigeneUid),
        (fehler, committed, snap) => {
          if (!fehler && committed && snap.val() === eigeneUid) {
            db.ref(`${RAEUME_PFAD}/${code}/sabotage`).set(null).catch(() => {});
          }
        }
      );
      return;
    }
    if (sab.endeAt && serverJetzt() >= sab.endeAt) {
      beanspracheSieg(raum, "maulwuerfe", "Die Heizung ist geplatzt – niemand hat rechtzeitig repariert.");
    }
  }
}

// --- Siegprüfung ---

function pruefeAufgabenSieg(raum) {
  const aufgaben = raum.aufgaben || { erledigt: 0, gesamt: 0 };
  if (aufgaben.gesamt > 0 && aufgaben.erledigt >= aufgaben.gesamt) {
    beanspracheSieg(raum, "team", "Alle Aufgaben sind erledigt.");
  }
}

// Nur Maulwurf-Geräte können diese beiden Bedingungen überhaupt sehen (siehe Dateikopf).
function pruefeRollenabhaengigenSieg(raum) {
  if (meineRolle !== "maulwurf") return;
  // Wichtig: erst prüfen, wenn die Maulwurf-Liste wirklich angekommen ist. Direkt nach dem
  // Rundenstart ist sie noch leer, und ein Check dagegen würde sofort "alle Maulwürfe
  // enttarnt" melden und die Partie im ersten Moment beenden.
  const maulwuerfe = aktuelleMaulwuerfe();
  if (Object.keys(maulwuerfe).length === 0) return;
  const lebende = lebendeSpieler(raum);
  const lebendeMaulwuerfe = lebende.filter(uid => maulwuerfe[uid]).length;
  const lebendeTeam = lebende.length - lebendeMaulwuerfe;
  if (lebendeMaulwuerfe === 0) {
    beanspracheSieg(raum, "team", "Alle Maulwürfe sind enttarnt.");
  } else if (lebendeMaulwuerfe >= lebendeTeam) {
    beanspracheSieg(raum, "maulwuerfe", "Die Maulwürfe sind in der Überzahl.");
  }
}

function beanspracheSieg(raum, seite, grund) {
  const code = aktuellerRaumCode;
  if (!code || raum.phase !== "laeuft") return;
  db.ref(`${RAEUME_PFAD}/${code}/siegClaim`).transaction(
    wert => (wert ? undefined : eigeneUid),
    async (fehler, committed, snap) => {
      if (fehler || !committed || snap.val() !== eigeneUid) return;
      const updates = {};
      updates[`${RAEUME_PFAD}/${code}/phase`] = "beendet";
      updates[`${RAEUME_PFAD}/${code}/sieger`] = seite;
      updates[`${RAEUME_PFAD}/${code}/siegGrund`] = grund;
      updates[`${RAEUME_PFAD}/${code}/meeting`] = null;
      updates[`${RAEUME_PFAD}/${code}/sabotage`] = null;
      fuegeStatistikUpdatesHinzu(updates, raum.spieler);
      await db.ref().update(updates);
    }
  );
}

// Jedes Gerät trägt seinen eigenen Sieg in der Bestenliste nach — der auflösende Client
// kennt die Rollen der anderen nicht und könnte das nicht für alle entscheiden.
async function meldeEigenenAusgang(raum) {
  if (ausgangGemeldetFuerRunde === raum.runde) return;
  if (!meineRolle || !raum.sieger || !raum.spieler[eigeneUid] || raum.spieler[eigeneUid].istSimuliert) return;
  ausgangGemeldetFuerRunde = raum.runde;
  const habeGewonnen = (raum.sieger === "team" && meineRolle === "team") || (raum.sieger === "maulwuerfe" && meineRolle === "maulwurf");
  if (!habeGewonnen) return;
  const slug = slugifyName(raum.spieler[eigeneUid].name);
  // Der Name wird hier mitgeschrieben, obwohl ihn auch beanspracheSieg() setzt: geht dessen
  // Write verloren (Gerät offline im entscheidenden Moment), stünde sonst ein Eintrag ohne
  // Namen in der Liste und würde als "?" mit 0 % angezeigt.
  await db.ref(`${BESTENLISTE_PFAD}/${slug}`).update({
    name: raum.spieler[eigeneUid].name,
    gewonnen: firebase.database.ServerValue.increment(1)
  }).catch(() => {});
}

// Rollen-Aufdeckung am Ende: jedes Gerät schreibt nur die EIGENE Rolle. Die Rule lässt das
// erst zu, wenn die Partie beendet ist — vorher kann niemand etwas aufdecken.
async function schreibeEigeneAufdeckung(raum) {
  if (aufdeckungGeschriebenFuerRunde === raum.runde || !meineRolle) return;
  aufdeckungGeschriebenFuerRunde = raum.runde;
  const code = aktuellerRaumCode;
  const updates = {};
  updates[`${AUFDECKUNG_PFAD}/${code}/${eigeneUid}`] = meineRolle;
  if (raum.hostId === eigeneUid) {
    // Bots haben kein eigenes Gerät, ihre Rollen kommen vom Host.
    const bots = Object.keys(raum.spieler).filter(uid => raum.spieler[uid].istSimuliert);
    for (const botId of bots) {
      const snap = await db.ref(`${ROLLEN_PFAD}/${code}/${botId}`).once("value");
      if (snap.exists()) updates[`${AUFDECKUNG_PFAD}/${code}/${botId}`] = snap.val().rolle;
    }
  }
  await db.ref().update(updates).catch(() => {});
}

function ladeAufdeckung() {
  if (aufdeckungListenerAktiv) return; // sonst käme bei jedem Raum-Update ein Listener dazu
  aufdeckungListenerAktiv = true;
  const code = aktuellerRaumCode;
  db.ref(`${AUFDECKUNG_PFAD}/${code}`).on("value", snap => {
    if (letzterRaum) {
      letzterRaum.aufdeckungCache = snap.val() || {};
      benachrichtige();
    }
  });
}

// --- KI-Mitspieler (nur auf dem Host-Gerät) ---

function starteBotSchleifeFallsNoetig(raum) {
  if (botTimer || raum.hostId !== eigeneUid) return;
  const hatBots = Object.keys(raum.spieler || {}).some(uid => raum.spieler[uid].istSimuliert);
  if (!hatBots) return;
  botTimer = setInterval(fuehreBotTickAus, BOT_TICK_MS);
}

function fuehreBotTickAus() {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "laeuft" || raum.hostId !== eigeneUid) return;
  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  const jetzt = serverJetzt();

  Object.keys(raum.spieler).forEach(botId => {
    const bot = raum.spieler[botId];
    if (!bot.istSimuliert || bot.lebt === false) return;
    const zustand = botZustand[botId] || (botZustand[botId] = {});
    const pos = positionen[botId] || { x: 520, y: 410 };

    if (raum.meeting) return; // im Meeting bewegt sich niemand

    // Wegpunkt-Lauf ohne Wegfindung: stumpf auf den nächsten Raummittelpunkt zu. Bleibt der
    // Bot an einer Wand hängen, wird nach kurzer Zeit ein neuer Wegpunkt gewählt.
    if (!zustand.ziel || karte.abstand(pos.x, pos.y, zustand.ziel.x, zustand.ziel.y) < 30 || (zustand.zielSeit && jetzt - zustand.zielSeit > 12000)) {
      zustand.ziel = karte.BOT_WEGPUNKTE[Math.floor(Math.random() * karte.BOT_WEGPUNKTE.length)];
      zustand.zielSeit = jetzt;
    }
    const dx = zustand.ziel.x - pos.x;
    const dy = zustand.ziel.y - pos.y;
    const laenge = Math.hypot(dx, dy) || 1;
    const schritt = einstellungen.tempo * (BOT_TICK_MS / 1000);
    const neu = karte.bewegeMitKollision(pos.x, pos.y, (dx / laenge) * schritt, (dy / laenge) * schritt);
    positionen[botId] = { x: neu.x, y: neu.y, geist: false };
    db.ref(`${POSITIONEN_PFAD}/${code}/${botId}`).set({ x: Math.round(neu.x), y: Math.round(neu.y), geist: false }).catch(() => {});

    if (zustand.rolle === "maulwurf") {
      versucheBotKill(raum, botId, neu, einstellungen);
    } else if (zustand.rolle === "team") {
      if (!zustand.letzteAufgabe) zustand.letzteAufgabe = jetzt;
      if (jetzt - zustand.letzteAufgabe > BOT_AUFGABE_MS) {
        zustand.letzteAufgabe = jetzt;
        zustand.aufgabenErledigt = (zustand.aufgabenErledigt || 0) + 1;
        if (zustand.aufgabenErledigt <= einstellungen.aufgabenProSpieler) {
          db.ref(`${RAEUME_PFAD}/${code}/aufgaben/erledigt`).set(firebase.database.ServerValue.increment(1)).catch(() => {});
        }
      }
    }
  });
}

function versucheBotKill(raum, botId, pos, einstellungen) {
  const jetzt = serverJetzt();
  const cooldownBis = (raum.killCooldownBis && raum.killCooldownBis[botId]) || 0;
  if (cooldownBis > jetzt) return;
  const code = aktuellerRaumCode;

  const opferUid = Object.keys(raum.spieler).find(uid => {
    if (uid === botId || raum.spieler[uid].lebt === false) return false;
    if (botZustand[uid] && botZustand[uid].rolle === "maulwurf") return false;
    const p = positionen[uid];
    return p && karte.abstand(pos.x, pos.y, p.x, p.y) <= karte.KILL_REICHWEITE;
  });
  if (!opferUid) return;
  // Der Host darf hier nicht prüfen, ob das Opfer selbst Maulwurf ist (er kennt nur die
  // Bot-Rollen). Ein Bot, der versehentlich einen Maulwurf erwischt, ist ein hingenommener
  // Nachteil des Übungsmodus.
  const opfer = raum.spieler[opferUid];
  const p = positionen[opferUid];
  db.ref(`${RAEUME_PFAD}/${code}/leichen/${opferUid}`).transaction(
    wert => (wert ? undefined : { x: Math.round(p.x), y: Math.round(p.y), name: opfer.name, farbe: opfer.farbe, gemeldet: false }),
    async (fehler, committed) => {
      if (fehler || !committed) return;
      const updates = {};
      updates[`${RAEUME_PFAD}/${code}/spieler/${opferUid}/lebt`] = false;
      updates[`${RAEUME_PFAD}/${code}/killCooldownBis/${botId}`] = jetzt + einstellungen.killCooldownSek * 1000;
      await db.ref().update(updates);
    }
  );
}

function planeBotStimmen(raum) {
  if (raum.hostId !== eigeneUid || !raum.meeting) return;
  const code = aktuellerRaumCode;
  const lebende = lebendeSpieler(raum);
  const stimmen = raum.meeting.stimmen || {};
  Object.keys(raum.spieler).forEach(botId => {
    const bot = raum.spieler[botId];
    if (!bot.istSimuliert || bot.lebt === false || stimmen[botId]) return;
    const zustand = botZustand[botId] || (botZustand[botId] = {});
    if (zustand.stimmeGeplantFuer === raum.runde + ":" + raum.meeting.unterphase) return;
    zustand.stimmeGeplantFuer = raum.runde + ":" + raum.meeting.unterphase;
    setTimeout(() => {
      const aktuell = letzterRaum;
      if (!aktuell || !aktuell.meeting || aktuell.meeting.unterphase !== "abstimmung") return;
      if ((aktuell.meeting.stimmen || {})[botId]) return;
      // Bewusst simpel: zufälliges lebendes Ziel oder überspringen, keine Taktik.
      const moeglich = lebende.filter(uid => uid !== botId);
      const ziel = Math.random() < 0.35 || moeglich.length === 0 ? "skip" : moeglich[Math.floor(Math.random() * moeglich.length)];
      db.ref(`${RAEUME_PFAD}/${code}/meeting/stimmen/${botId}`).set(ziel).catch(() => {});
    }, BOT_STIMME_MS);
  });
}

// --- Partie verlassen / neue Runde ---

async function verlasseSpiel() {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (raum && code && raum.hostId === eigeneUid && raum.phase !== "beendet") {
    await db.ref(`${RAEUME_PFAD}/${code}/phase`).set("abgebrochen").catch(() => {});
  } else if (raum && code && raum.phase === "lobby") {
    await db.ref(`${RAEUME_PFAD}/${code}/spieler/${eigeneUid}`).remove().catch(() => {});
  } else if (raum && code && raum.phase === "laeuft") {
    // Mitten in der Partie darf niemand einfach verschwinden, sonst wartet die Siegprüfung
    // ewig auf eine Person, die gar nicht mehr da ist. Wer geht, scheidet aus.
    await db.ref(`${RAEUME_PFAD}/${code}/spieler/${eigeneUid}/lebt`).set(false).catch(() => {});
  }
  await verlasseLokal();
  return { erfolg: true };
}

async function verlasseLokal() {
  const code = aktuellerRaumCode;
  if (code && eigeneUid) {
    await db.ref(`${POSITIONEN_PFAD}/${code}/${eigeneUid}`).remove().catch(() => {});
  }
  loeseListenerAb();
  aktuellerRaumCode = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // unkritisch
  }
  if (listener) listener(zustandOhneRaum());
}

// Rematch: derselbe Raum, dieselben Leute, neue Rollen.
async function neueRunde() {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.hostId !== eigeneUid) return { erfolg: false };
  const updates = {};
  updates[`${RAEUME_PFAD}/${code}/phase`] = "lobby";
  updates[`${RAEUME_PFAD}/${code}/runde`] = rundeVon(raum) + 1;
  updates[`${RAEUME_PFAD}/${code}/rollenDeck`] = null;
  updates[`${RAEUME_PFAD}/${code}/zuteilungZaehler`] = 0;
  updates[`${RAEUME_PFAD}/${code}/leichen`] = null;
  updates[`${RAEUME_PFAD}/${code}/meeting`] = null;
  updates[`${RAEUME_PFAD}/${code}/sabotage`] = null;
  updates[`${RAEUME_PFAD}/${code}/tueren`] = null;
  updates[`${RAEUME_PFAD}/${code}/sieger`] = null;
  updates[`${RAEUME_PFAD}/${code}/siegGrund`] = null;
  updates[`${RAEUME_PFAD}/${code}/siegClaim`] = null;
  updates[`${RAEUME_PFAD}/${code}/revealBis`] = 0;
  Object.keys(raum.spieler || {}).forEach(uid => {
    updates[`${RAEUME_PFAD}/${code}/spieler/${uid}/lebt`] = true;
  });
  // Reihenfolge ist wichtig: die Aufdeckung ist per Rule nur beschreibbar, solange die
  // Partie als "beendet" gilt — also VOR dem Phasenwechsel zurück in die Lobby löschen.
  await db.ref(`${AUFDECKUNG_PFAD}/${code}`).remove().catch(() => {});
  await db.ref().update(updates);
  // Diese beiden Aufräum-Versuche sind bewusst nur best effort: die Rules erlauben Schreiben
  // auf $uid-Ebene, ein remove() auf den Elternknoten gelingt nur dem Host. Die Korrektheit
  // hängt NICHT daran — Rollen- und Maulwurf-Einträge tragen ihre Rundennummer und werden
  // beim Lesen gefiltert (siehe boxGehoertZurRunde / aktuelleMaulwuerfe).
  await db.ref(`${ROLLEN_PFAD}/${code}`).remove().catch(() => {});
  await db.ref(`${TEAM_PFAD}/${code}`).remove().catch(() => {});
  await db.ref(`${CHAT_PFAD}/${code}`).remove().catch(() => {});
  meineRolle = null;
  meineAufgaben = [];
  meineErledigten = [];
  maulwurfTeamRoh = {};
  if (teamRef) { teamRef.off(); teamRef = null; }
  ausgangGemeldetFuerRunde = null;
  aufdeckungGeschriebenFuerRunde = null;
  revealTimerFuerRunde = null;
  zuteilungLaeuft = false;
  botZuteilungLaeuft = false;
  rollenNachladenLaeuft = false;
  return { erfolg: true };
}

async function raeumeRaumAuf() {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (raum && code && raum.hostId === eigeneUid) {
    // Bewusst sequenziell und der Raum ZULETZT: mehrere Aufräum-Regeln prüfen gegen
    // raeume/$code (hostId bzw. phase). Wäre der Raum schon weg, würden sie fehlschlagen.
    await db.ref(`${AUFDECKUNG_PFAD}/${code}`).remove().catch(() => {});
    await db.ref(`${ROLLEN_PFAD}/${code}`).remove().catch(() => {});
    await db.ref(`${TEAM_PFAD}/${code}`).remove().catch(() => {});
    await db.ref(`${CHAT_PFAD}/${code}`).remove().catch(() => {});
    await db.ref(`${POSITIONEN_PFAD}/${code}`).remove().catch(() => {});
    await db.ref(`${RAEUME_PFAD}/${code}`).remove().catch(() => {});
  }
  await verlasseLokal();
  return { erfolg: true };
}

// --- Bestenliste ---

async function ladeBestenliste() {
  await authBereit;
  const snap = await db.ref(BESTENLISTE_PFAD).once("value");
  const daten = snap.val() || {};
  return Object.values(daten)
    .map(eintrag => {
      const gespielt = eintrag.gespielt || 0;
      const gewonnen = eintrag.gewonnen || 0;
      return { name: eintrag.name || "?", gespielt, gewonnen, prozent: gespielt > 0 ? Math.round((gewonnen / gespielt) * 100) : 0 };
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

const gameService = {
  erstelleRaum, tritRaumBei, fuegeKiMitspielerHinzu, entferneKiMitspieler,
  speichereEinstellungen, starteSpiel,
  bewege, setzeStartposition, springeZu, startePositionsSchleife, schreibePosition,
  erledigeAufgabe, schalteAus, meldeLeiche, drueckeNotfallknopf,
  sendeChat, stimmeAb, deckeAusgeschlosseneRolleAuf,
  sabotiere, repariereFlutlicht, setzeHeizungsventil,
  verlasseSpiel, neueRunde, raeumeRaumAuf,
  getZustand, onZustandsAenderung, ladeBestenliste, setzeBestenlisteZurueck,
  serverJetzt,
  // für Verifikation direkt aufrufbar (reine Funktionen, kein Firebase-Zugriff):
  ermittleAusschluss, anzahlMaulwuerfeFuer, mischeListe,
  MIN_SPIELER, MAX_SPIELER
};
