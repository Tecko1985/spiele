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
// Rechnung für die größte Partie: 15 Spieler * 5 Hz = 75 Writes/s, jeder Client empfängt
// 75 * ~40 Byte = ~3 KB/s, bei 15 Clients ~45 KB/s. Eine 10-Minuten-Partie kostet damit
// ~27 MB Download. Mit on("value") auf dem Raumobjekt wäre es das Zehn- bis Zwanzigfache
// gewesen und der Free-Tier nach wenigen Partien aufgebraucht.
//
// **Das Volumen wächst quadratisch mit der Spielerzahl** (jeder schreibt, alle empfangen).
// Die Anhebung von 10 auf 15 hat es gut verdoppelt. Wer weiter erhöhen will, sollte vorher
// die Tickrate senken oder Positionen nur noch für Sichtbare übertragen.
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
// **Es muss mindestens so viele Farben geben wie MAX_SPIELER.** Wird die Liste knapp, fällt
// die Vergabe unten auf SPIELER_FARBEN[0] zurück und zwei Leute laufen in derselben Farbe
// herum — auf der Karte und im Kamerabild sind sie dann nicht mehr auseinanderzuhalten, und
// genau daran hängt jede Zeugenaussage. Die letzten fünf kamen mit der Anhebung auf 15 dazu.
//
// Alle Töne sind hell genug für den dunklen Kartenboden (#2c3a52). Die frühere Liste stammte
// aus der hellen Oberfläche; Vereinsblau, Tannengrün, Oliv, Braun und Grau verschwammen darauf
// mit dem Boden — ausgerechnet die Farben, die eine Zeugin am ehesten verwechselt.
//
// Die REIHENFOLGE ist Absicht und nicht der Farbkreis: vergeben wird von vorn, also müssen die
// ersten Einträge maximal weit auseinanderliegen. In einer Viererrunde spielt niemand Rot gegen
// Orange, sondern Rot gegen Himmelblau gegen Grün gegen Bernstein.
const SPIELER_FARBEN = [
  "#ff5a5f", "#38bdf8", "#3ddc84", "#ffc53d", "#b57cff",
  "#2ee6c8", "#ff77b3", "#ff9231", "#b6e335", "#94a3b8",
  "#eef2fb", "#e879f9", "#5b8dff", "#bb7c4e", "#8b8bff"
];
const MIN_SPIELER = 4;
const MAX_SPIELER = 15;

const RAEUME_PFAD = "maulwurf/raeume";
const POSITIONEN_PFAD = "maulwurf/positionen";
const CHAT_PFAD = "maulwurf/chat";
const ROLLEN_PFAD = "maulwurf/geheime_rollen";
const TEAM_PFAD = "maulwurf/maulwurf_team";
const AUFDECKUNG_PFAD = "maulwurf/aufdeckung";

const POSITION_INTERVALL_MS = 200;   // 5 Hz, siehe Schreibvolumen-Rechnung oben
const POSITION_MINDEST_DELTA = 1.5;  // darunter wird gar nicht geschrieben
const REVEAL_DAUER_MS = 4500;
const MEETING_ERGEBNIS_MS = 6000;
const SABOTAGE_REAKTOR_MS = 45000;
const TUEREN_SPERRE_MS = 12000;
const SABOTAGE_COOLDOWN_MS = 25000;
// Wer die Kameras ansieht, verlängert seinen Eintrag alle 3 s um 8 s. Der Vorlauf ist Absicht:
// ohne ihn erlischt das Warnsignal auf der Karte zwischen zwei Taktschlägen kurz und flackert.
// Und weil der Eintrag von selbst abläuft, bleibt er nach einem Absturz nicht stehen — sonst
// stünde die Warnung für den Rest der Partie und wäre wertlos.
const KAMERA_TAKT_MS = 3000;
const KAMERA_GUELTIG_MS = 8000;
const SICHTBARE_WIRKUNG_MS = 6000;   // so lange bleibt eine sichtbare Aufgabe als Alibi stehen
const SCHUTZ_DAUER_MS = 12000;
const SCHUTZ_COOLDOWN_MS = 40000;
const VERKLEIDUNG_DAUER_MS = 20000;
const VERKLEIDUNG_COOLDOWN_MS = 45000;
// Die KI rechnet ihre Bewegung mit 20 Hz, schreibt sie aber weiterhin nur mit 5 Hz nach
// Firebase. Bis 2026-07-27 lief beides mit 200 ms: die Figuren sprangen fünfmal pro Sekunde um
// 46 px weiter und ruckelten sichtbar. Die Trennung macht sie flüssig, ohne das Schreibvolumen
// anzufassen — für alle anderen Geräte ändert sich nichts, deren Interpolation glättet weiter.
const BOT_TICK_MS = 50;
const BOT_SCHREIB_MS = 200;
// Nach so vielen Ticks ohne Fortschritt wird der Weg verworfen. Hängt an der Tickrate: bei
// 20 Hz sind 32 Ticks dieselben 1,6 Sekunden, die vorher 8 Ticks waren.
const BOT_KLEMM_TICKS = 32;
const BOT_AUFGABE_MS = 9000;
const BOT_STIMME_MS = 11000;

// Zahlen, keine Booleans: die Einstellungsfelder in der Lobby werden alle über denselben
// parseInt-Weg gespeichert (siehe app.js). 1/0 statt true/false hält das einheitlich.
const STANDARD_EINSTELLUNGEN = {
  modus: "klassisch",        // "klassisch" | "verstecken"
  killCooldownSek: 30,
  diskussionSek: 45,
  abstimmungSek: 60,
  notfallKnoepfe: 1,
  aufgabenProSpieler: 5,
  // 2026-07-27 um ein Fünftel gesenkt (232 → 186): mit dem Original-Layout war die Figur so
  // flott unterwegs, dass Räume im Vorbeilaufen abgehakt wurden, statt dass Wege etwas kosten.
  // Alle drei Stufen sind gleichmäßig mitgesenkt, damit die Abstufung erhalten bleibt.
  tempo: 186,
  rolleNachRauswurf: 1,
  rolleIngenieur: 0,
  rolleWissenschaftler: 0,
  rolleSchutzengel: 0,
  rolleGestaltwandler: 0,
  vorsprungSek: 15,          // nur Verstecken: so lange steht der Fänger noch still
  zeitlimitMin: 5            // nur Verstecken: danach hat das Team durchgehalten
};

// Vorschlag, den der Host in den Einstellungen überschreiben kann. Ab zwölf Personen drei
// Maulwürfe: mit zweien gegen dreizehn wäre die Übermacht-Siegbedingung praktisch unerreichbar
// und die Partie liefe nur noch über die Aufgaben aus.
function anzahlMaulwuerfeFuer(spielerAnzahl) {
  if (spielerAnzahl >= 12) return 3;
  if (spielerAnzahl >= 7) return 2;
  return 1;
}

// --- Verstecken-Modus ---
//
// Zweiter Spielmodus nach dem Vorbild von Hide n Seek: genau ein Fänger, von Beginn an offen
// bekannt, dafür ohne Besprechung und ohne Abstimmung. Das Team muss nur seine Aufgaben
// schaffen oder die Zeit überstehen.
//
// Der Fänger steht öffentlich in raeume/$code/faengerUid. Die verdeckte Selbstziehung bleibt
// trotzdem unverändert — wer "maulwurf" zieht, trägt sich zusätzlich dort ein. Das spart einen
// zweiten Zuteilungsweg samt eigener Race Condition, und die Sonderrollen bleiben auch hier
// geheim.
function istVersteckModus(raum) {
  return ((raum && raum.einstellungen) || {}).modus === "verstecken";
}

// Vorsprung und Zeitlimit laufen gegen den Beginn der Laufphase. Als Startzeit dient revealBis:
// dieser Wert steht bereits in der Datenbank und ist damit auf allen Geräten derselbe, während
// ein eigener Zeitstempel je nach schreibendem Gerät um Millisekunden abwiche — bei einem
// Countdown, den alle sehen, wäre das sichtbar.
function laufBeginn(raum) {
  return raum && raum.revealBis ? raum.revealBis : 0;
}

// Anlaufsperre: die ersten Sekunden einer Runde darf niemand ausgeschaltet werden.
//
// Ohne sie stehen alle noch dicht beieinander in der Cafeteria, und ein Maulwurf kann in der
// ersten Sekunde zuschlagen — vor Zeugen zwar, aber das Opfer hatte nie eine Chance und die
// halbe Runde ist entschieden, bevor jemand einen Fuß vor die Tür gesetzt hat.
//
// **Die Sperre steht NICHT in der Datenbank**, sondern wird aus `revealBis` abgeleitet. Dieser
// Wert markiert ohnehin den Beginn der Laufphase und liegt auf allen Geräten identisch vor —
// ein eigener Zeitstempel bräuchte einen zusätzlichen Write, könnte je nach schreibendem Gerät
// abweichen und ginge bei einem Reload mitten in der Partie verloren.
const START_KILL_COOLDOWN_MS = 10000;

// Ab wann darf diese Person wieder ausschalten? Zwei Sperren laufen parallel — die Abklingzeit
// seit dem letzten Foulspiel und die Anlaufsperre seit Rundenbeginn; es gilt die spätere.
//
// **Diese Funktion ist die einzige Quelle dafür.** Anzeige (Countdown auf dem Knopf), Prüfung
// beim Ausschalten und die KI-Mitspieler müssen dieselbe Rechnung benutzen: rechnete die
// Anzeige anders als die Prüfung, zeigte der Knopf "bereit" und der Versuch liefe ins Leere.
function killBereitAb(raum, uid) {
  const nachFoulspiel = (raum && raum.killCooldownBis && raum.killCooldownBis[uid]) || 0;
  const start = laufBeginn(raum);
  return Math.max(nachFoulspiel, start ? start + START_KILL_COOLDOWN_MS : 0);
}

// Beide geben 0 zurück, solange der Startzeitpunkt noch nicht feststeht. Ohne diese Prüfung
// stünde nach der Rechnung 0 + 5 min ein Zeitpunkt im Jahr 1970 — und pruefeZeitlimit() würde
// die Partie in derselben Sekunde als "durchgehalten" beenden, in der sie beginnt.
function vorsprungBis(raum) {
  const start = laufBeginn(raum);
  if (!istVersteckModus(raum) || !start) return 0;
  const e = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  return start + e.vorsprungSek * 1000;
}

function zeitlimitBis(raum) {
  const start = laufBeginn(raum);
  if (!istVersteckModus(raum) || !start) return 0;
  const e = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
  return start + e.zeitlimitMin * 60000;
}

// Während des Vorsprungs steht der Fänger fest und kann niemanden fangen.
function faengerGesperrt(raum, uid) {
  return istVersteckModus(raum) && raum.faengerUid === uid && serverJetzt() < vorsprungBis(raum);
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

let eigeneUid = null;
let aktuellerRaumCode = null;
let roomRef = null;
let positionenRef = null;
let chatRef = null;
let teamRef = null;
let letzterRaum = null;
let listener = null;

let meineRolle = null;         // "team" | "maulwurf" | null
let meineRolleRunde = null;    // zu welcher Runde die obige Rolle gehört
let meineSonderrolle = null;   // "ingenieur" | "wissenschaftler" | "schutzengel" | "gestaltwandler" | null
let meineAufgaben = [];        // Stations-Ids
let meineErledigten = [];      // Stations-Ids
let meineWartezeiten = {};     // Stations-Id -> Startzeitpunkt der Wartezeit
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
    meineAufgaben: meineAufgaben.map(id => {
      const station = karte.stationNachId(id);
      const def = (station && aufgabenModul.AUFGABEN_TYPEN[station.typ]) || {};
      const teile = teileDerAufgabe(id);
      const nachfolger = teile[teile.indexOf(id) + 1];
      const nachfolgerStation = nachfolger && karte.stationNachId(nachfolger);
      const zielRaum = nachfolgerStation && karte.RAEUME.find(r => r.id === nachfolgerStation.raum);
      return {
        id,
        station,
        erledigt: meineErledigten.indexOf(id) !== -1,
        // teil/teile sind 1-basiert und stehen so auch in der Aufgabenliste ("Ort 2 von 3")
        teil: teile.indexOf(id) + 1,
        teile: teile.length,
        gesperrt: ketteBlockiert(id),
        zielRaum: zielRaum ? zielRaum.name : null,
        wartenSek: def.wartenSek || 0,
        wartenSeit: meineWartezeiten[id] || 0
      };
    }),
    meineSonderrolle,
    schutz: raum.schutz || {},
    schutzCooldownBis: raum.schutzCooldownBis || 0,
    verkleidungen: raum.verkleidung || {},
    verkleidungCooldownBis: raum.verkleidungCooldownBis || 0,
    maulwurfTeam: meineRolle === "maulwurf" ? Object.keys(aktuelleMaulwuerfe()) : [],
    positionen,
    meinePosition,
    leichen: raum.leichen || {},
    aufgaben: raum.aufgaben || { erledigt: 0, gesamt: 0 },
    visuell: raum.visuell || {},
    sabotage: raum.sabotage || null,
    // Nur der Boolean geht nach draußen, nie die uid-Liste: sonst stünde in jedem Client, WER
    // gerade zusieht — und die Warnung soll aussagen "jemand", nicht "Sabine".
    kameraBeobachtet: kameraBeobachtet(raum),
    funkGestoert: !!(raum.sabotage && raum.sabotage.typ === "funk"),
    tueren: raum.tueren || {},
    meeting: raum.meeting || null,
    chat: chatVerlauf,
    killCooldownBis: killBereitAb(raum, eigeneUid),
    schacht: schachtZustand(),
    sabotageCooldownBis: raum.sabotageCooldownBis || 0,
    sieger: raum.sieger || null,
    siegGrund: raum.siegGrund || null,
    aufdeckung: raum.aufdeckungCache || null,
    einstellungen: Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {}),
    anzahlMaulwuerfe: istVersteckModus(raum)
      ? 1
      : (raum.einstellungen && raum.einstellungen.anzahlMaulwuerfe) || anzahlMaulwuerfeFuer(spielerListe.length),
    versteckModus: istVersteckModus(raum),
    faengerUid: raum.faengerUid || null,
    vorsprungBis: vorsprungBis(raum),
    zeitlimitBis: zeitlimitBis(raum),
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
  verwerfeRundendaten();
  positionen = {};
  chatVerlauf = [];
  meinePosition = null;
  meetingUebergangGeplantFuer = null;
  aufdeckungListenerAktiv = false;
  Object.keys(botZustand).forEach(k => delete botZustand[k]);
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
  if (positionTimer) { clearInterval(positionTimer); positionTimer = null; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

// Alles, was genau EINER Runde gehört. Wird beim Rundenwechsel auf JEDEM Gerät fällig, nicht
// nur auf dem des Hosts — siehe die Prüfung am Kopf von verarbeiteRaumZustand.
function verwerfeRundendaten() {
  meineRolle = null;
  meineRolleRunde = null;
  meineSonderrolle = null;
  meineAufgaben = [];
  meineErledigten = [];
  meineWartezeiten = {};
  maulwurfTeamRoh = {};
  // Der Listener der Vorrunde muss mit weg: uebernehmeEigeneRolle hängt ihn nur an, wenn noch
  // keiner steht, und würde ihn sonst nie erneuern.
  if (teamRef) { teamRef.off(); teamRef = null; }
  aufdeckungGeschriebenFuerRunde = null;
  revealTimerFuerRunde = null;
  zuteilungLaeuft = false;
  botZuteilungLaeuft = false;
  rollenNachladenLaeuft = false;
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

  // Alle Countdowns (Diskussion, Abstimmung, Reaktor, Rollen-Reveal) laufen gegen absolute
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
  meineRolleRunde = rundeVon(daten);
  meineSonderrolle = daten.sonder || null;
  meineAufgaben = daten.aufgaben || [];
  meineErledigten = daten.erledigt || [];
  meineWartezeiten = daten.warten || {};
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
  // Im Verstecken-Modus gibt es immer genau einen Fänger, unabhängig von der Gruppengröße:
  // zwei bekannte Jäger würden die Hälfte der Karte gleichzeitig abdecken, und ohne
  // Besprechung fehlt jedes Gegenmittel.
  const anzahlMaulwuerfe = istVersteckModus(raum)
    ? 1
    : Math.min(einstellungen.anzahlMaulwuerfe || anzahlMaulwuerfeFuer(uids.length), Math.floor(uids.length / 2) - 1 || 1);

  // Das Deck ist bewusst nur eine gemischte Liste OHNE Zuordnung zu Personen — der Host
  // erfährt beim Schreiben nichts über die spätere Verteilung. Sonderrollen hängen als
  // "seite:sonderrolle" am Eintrag und belegen bestehende Plätze, siehe rollen.js.
  const gemischt = mischeListe(rollenModul.baueDeck(uids.length, anzahlMaulwuerfe, einstellungen));

  const teamAnzahl = uids.length - anzahlMaulwuerfe;
  const updates = {};
  const basis = `${RAEUME_PFAD}/${aktuellerRaumCode}`;
  updates[`${basis}/phase`] = "zuteilung";
  updates[`${basis}/rollenDeck`] = gemischt;
  updates[`${basis}/zuteilungZaehler`] = 0;
  updates[`${basis}/einstellungen/anzahlMaulwuerfe`] = anzahlMaulwuerfe;
  updates[`${basis}/aufgaben`] = { erledigt: 0, gesamt: teamAnzahl * einstellungen.aufgabenProSpieler };
  updates[`${basis}/visuell`] = null;
  updates[`${basis}/schutz`] = null;
  updates[`${basis}/schutzCooldownBis`] = 0;
  updates[`${basis}/verkleidung`] = null;
  updates[`${basis}/verkleidungCooldownBis`] = 0;
  updates[`${basis}/leichen`] = null;
  updates[`${basis}/sabotage`] = null;
  updates[`${basis}/kameras`] = null;
  updates[`${basis}/tueren`] = null;
  updates[`${basis}/meeting`] = null;
  updates[`${basis}/killCooldownBis`] = null;
  updates[`${basis}/sabotageCooldownBis`] = 0;
  updates[`${basis}/siegClaim`] = null;
  updates[`${basis}/sieger`] = null;
  updates[`${basis}/siegGrund`] = null;
  updates[`${basis}/revealBis`] = 0;
  updates[`${basis}/faengerUid`] = null;   // trägt sich beim Ziehen selbst ein
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

function zufaelligesElement(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

// Wählt die Stationen für EINE Aufgabe. Mehrteilige Typen liefern mehrere Stationen, und zwar
// in genau der Reihenfolge, in der sie abgearbeitet werden müssen.
function waehleTeile(def, stationen) {
  if (def.kette) {
    // Feste Reihenfolge mit Raumbedingung: "*" heißt "irgendein Raum, der in der Kette nicht
    // ausdrücklich genannt ist" — sonst könnte der Hinweg im selben Raum enden wie der Rückweg.
    const teile = [];
    def.kette.forEach(bedingung => {
      const passend = stationen.filter(st => teile.indexOf(st) === -1 &&
        (bedingung === "*" ? def.kette.indexOf(st.raum) === -1 : st.raum === bedingung));
      if (passend.length) teile.push(zufaelligesElement(passend));
    });
    return teile.length === def.kette.length ? teile : [];
  }
  if (def.teile) {
    // Jeder Teil in einem ANDEREN Raum — sonst stünde man dreimal am selben Fleck und die
    // Aufgabe wäre kein Laufweg mehr, sondern dreimal derselbe Knopfdruck.
    const raeume = mischeListe(stationen.map(st => st.raum).filter((r, i, a) => a.indexOf(r) === i));
    const teile = raeume.slice(0, def.teile).map(raum => zufaelligesElement(stationen.filter(st => st.raum === raum)));
    return teile.length === def.teile ? teile : [];
  }
  return [zufaelligesElement(stationen)];
}

function waehleAufgaben(anzahl) {
  // Pro Aufgabentyp höchstens einmal, damit die Runde abwechslungsreich bleibt.
  const nachTyp = {};
  karte.STATIONEN.forEach(st => {
    if (!nachTyp[st.typ]) nachTyp[st.typ] = [];
    nachTyp[st.typ].push(st);
  });

  const gewaehlt = [];
  const schonVergeben = {};

  // Zwei Durchgänge: erst die mehrteiligen Aufgaben, dann die einteiligen.
  //
  // Eine mehrteilige Aufgabe wird nur GANZ vergeben. Passte nur ihr erster Teil ins
  // Restkontingent, stünde eine halbe Kette in der Liste, die sich nie abschließen lässt —
  // der gemeinsame Fortschrittsbalken käme dann nie auf 100 % und die Aufgaben-Siegbedingung
  // wäre unerreichbar. Deshalb füllen die einteiligen Typen im zweiten Durchgang exakt auf.
  [true, false].forEach(mehrteiligeRunde => {
    mischeListe(Object.keys(nachTyp)).forEach(typ => {
      if (gewaehlt.length >= anzahl || schonVergeben[typ]) return;
      const def = aufgabenModul.AUFGABEN_TYPEN[typ] || {};
      if (!!(def.teile || def.kette) !== mehrteiligeRunde) return;
      const teile = waehleTeile(def, nachTyp[typ]);
      if (!teile.length || gewaehlt.length + teile.length > anzahl) return;
      schonVergeben[typ] = true;
      teile.forEach(st => gewaehlt.push(st.id));
    });
  });
  return gewaehlt;
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

    const { rolle, sonder } = rollenModul.teileDeckEintrag(raum.rollenDeck[index]);
    const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
    const daten = {
      rolle, sonder: sonder || null, index, runde: rundeVon(raum),
      aufgaben: waehleAufgaben(einstellungen.aufgabenProSpieler), erledigt: []
    };
    await db.ref(`${ROLLEN_PFAD}/${code}/${eigeneUid}`).set(daten);
    if (rolle === "maulwurf") {
      await db.ref(`${TEAM_PFAD}/${code}/${eigeneUid}`).set({ name: raum.spieler[eigeneUid].name, runde: rundeVon(raum) });
      // Im Verstecken-Modus ist der Fänger kein Geheimnis — er meldet sich selbst öffentlich an.
      if (istVersteckModus(raum)) {
        await db.ref(`${RAEUME_PFAD}/${code}/faengerUid`).set(eigeneUid).catch(() => {});
      }
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
    const runde = rundeVon(raum);
    const bots = Object.keys(raum.spieler).filter(uid => raum.spieler[uid].istSimuliert);
    for (const botId of bots) {
      const merker = botZustand[botId] || (botZustand[botId] = {});
      if (merker.rolle && merker.rundeGezogen === runde) continue;

      // Die Box eines Bots darf der Host lesen — database.rules.json erlaubt es
      // ausdrücklich ($uid.beginsWith('bot-') und hostId === auth.uid). Das war früher
      // anders: die Rule verlangte $uid === auth.uid, das once() warf PERMISSION_DENIED
      // und brach die ganze Zuteilung ab — mit KI-Mitspielenden startete das Spiel
      // deshalb überhaupt nicht (gefunden 2026-07-26). Das try/catch bleibt trotzdem
      // stehen: es ist der Rückfall, falls die Rules einmal nicht eingespielt sind.
      // Genau dieser Lesevorgang stellt nach einem Reload des Hosts den Bot-Fortschritt
      // wieder her — ohne ihn zählt jeder Bot seine Aufgaben ein zweites Mal.
      let vorhanden = null;
      try {
        const snap = await db.ref(`${ROLLEN_PFAD}/${code}/${botId}`).once("value");
        if (snap.exists() && boxGehoertZurRunde(snap.val(), raum)) vorhanden = snap.val();
      } catch (e) {
        // nicht lesbar — dann entscheidet allein der lokale Merker
      }
      if (vorhanden) {
        merker.rolle = vorhanden.rolle;
        merker.sonder = vorhanden.sonder || null;
        merker.rundeGezogen = runde;
        // Ohne diese Zeile fängt der Bot nach einem Reload des Hosts wieder bei 0 an und
        // zählt den gemeinsamen Aufgabenzähler ein zweites Mal hoch — das Team gewinnt
        // dann zu früh (gefunden in der Bugjagd vom 04.09.2026).
        merker.aufgabenErledigt = vorhanden.erledigtAnzahl || 0;
        continue;
      }

      const index = await ziehIndex(code);
      if (index === null || index >= raum.rollenDeck.length) return;
      // Der Deck-Eintrag ist "team", "maulwurf" oder "seite:sonderrolle" und MUSS aufgeteilt
      // werden — genau wie bei Menschen. Ohne das stand bei einem Bot "team:ingenieur" im
      // Rollenfeld, und damit griff weder der team- noch der maulwurf-Zweig des Bot-Ticks:
      // er lief nur noch herum, erledigte nichts und trug sich als Maulwurf nirgends ein.
      const { rolle, sonder } = rollenModul.teileDeckEintrag(raum.rollenDeck[index]);
      const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
      await db.ref(`${ROLLEN_PFAD}/${code}/${botId}`).set({
        rolle, sonder: sonder || null, index, runde,
        aufgaben: waehleAufgaben(einstellungen.aufgabenProSpieler), erledigt: [],
        erledigtAnzahl: 0
      });
      if (rolle === "maulwurf") {
        await db.ref(`${TEAM_PFAD}/${code}/${botId}`).set({ name: raum.spieler[botId].name, runde });
        if (istVersteckModus(raum)) {
          await db.ref(`${RAEUME_PFAD}/${code}/faengerUid`).set(botId).catch(() => {});
        }
      }
      merker.rolle = rolle;
      merker.sonder = sonder || null;
      merker.rundeGezogen = runde;
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

  // Ein Rundenwechsel entwertet die lokal gehaltene Rolle — auf JEDEM Gerät.
  //
  // neueRunde() räumt sie weg, läuft aber nur beim Host (ganz oben steht ein return für alle
  // anderen). Ein GAST behielt seine Rolle deshalb aus der Vorrunde, und weil zieheEigeneRolle()
  // bei gesetzter Rolle sofort zurückkehrt, zog sein Gerät in der neuen Runde nicht mehr. Der
  // zuteilungZaehler erreichte die Spielerzahl dadurch nie, revealBis wurde nie gesetzt und die
  // Partie stand still im Zuteilungsbild — gemeldet als „der Start friert nach zwei, drei
  // Partien nacheinander ein" (2026-08-02). Betroffen war jede Runde ab der zweiten, sobald
  // mindestens eine Person nicht der Host war; wer zwischendurch neu lud, kam frei, weil
  // betretRaumLokal() den Zustand ohnehin leert. Genau daher das sporadische Bild.
  //
  // Gebunden wird an die mitgeschriebene Rundennummer, nicht an die Phase: dieselbe Regel, die
  // für geheime_rollen und maulwurf_team schon gilt — Korrektheit hängt am Lesen, nicht am
  // Aufräumen.
  if (meineRolleRunde !== null && meineRolleRunde !== rundeVon(raum)) verwerfeRundendaten();

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
    pruefeZeitlimit(raum);
    starteBotSchleifeFallsNoetig(raum);
    if (raum.meeting) pruefeMeetingUebergaenge(raum);
  }

  if (raum.phase === "beendet") {
    schreibeEigeneAufdeckung(raum);
    ladeAufdeckung();
    if (botTimer) { clearInterval(botTimer); botTimer = null; }
  }
}

// --- Bewegung ---

function setzeStartposition(raum) {
  const daten = raum || letzterRaum;
  if (!daten) return;
  // Wer beim Meeting im Schacht sitzt, kommt mit heraus. Ohne das bliebe das Flag stehen und
  // die Figur wäre nach der Besprechung unsichtbar — mitten in der Cafeteria.
  imSchacht = null;
  const uids = Object.keys(daten.spieler || {});
  const punkte = karte.startPositionen(uids.length);
  const index = Math.max(uids.indexOf(eigeneUid), 0);
  meinePosition = Object.assign({}, punkte[index % punkte.length]);
  schreibePosition(true);
}

// --- Abkürzungen (Schächte) ---
//
// **Man steigt EIN und wieder AUS, statt nur zu springen.** Bis 2026-07-27 setzte ein Druck auf
// den Knopf die Figur sofort ans andere Ende — man tauchte blind auf, mitten in einer Gruppe,
// ohne es vorher sehen zu können. Jetzt ist der Schacht ein Aufenthalt: drin ist man für alle
// unsichtbar, kann zwischen den Enden des Netzes wechseln, sieht bei jedem die Umgebung und
// steigt erst aus, wenn die Luft rein ist. Genau darin liegt der Wert der Rolle.
//
// Der Zustand lebt lokal; nach außen geht nur das Flag `schacht` in der Position. Mehr braucht
// niemand: welches Netz jemand benutzt und an welchem Ende er sitzt, geht keinen etwas an, und
// jedes zusätzliche Feld wäre ein Datenleck über die Konsole.
let imSchacht = null;   // { tunnelId, index } oder null

function schachtZustand() {
  if (!imSchacht) return null;
  const tunnel = karte.TUNNEL.find(t => t.id === imSchacht.tunnelId);
  if (!tunnel) return null;
  return {
    tunnel,
    index: imSchacht.index,
    hier: tunnel.enden[imSchacht.index],
    ziele: tunnel.enden.map((e, i) => ({ ...e, index: i })).filter((_, i) => i !== imSchacht.index)
  };
}

// Einsteigen: nur, wo tatsächlich ein Schachtende liegt, und nur lebend.
function betreteSchacht() {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft" || raum.meeting) return false;
  if (raum.spieler[eigeneUid] && raum.spieler[eigeneUid].lebt === false) return false;
  if (!meinePosition || imSchacht) return false;
  const treffer = karte.tunnelAn(meinePosition.x, meinePosition.y);
  if (!treffer) return false;
  imSchacht = { tunnelId: treffer.tunnel.id, index: treffer.index };
  // Sauber auf dem Ende sitzen, sonst steigt man einen Schritt daneben wieder aus.
  meinePosition.x = treffer.tunnel.enden[treffer.index].x;
  meinePosition.y = treffer.tunnel.enden[treffer.index].y;
  schreibePosition(true);
  return true;
}

// Zu einem anderen Ende desselben Netzes wechseln — man bleibt im Schacht.
function wechsleSchachtEnde(index) {
  const zustand = schachtZustand();
  if (!zustand) return false;
  const ziel = zustand.tunnel.enden[index];
  if (!ziel || index === imSchacht.index) return false;
  imSchacht.index = index;
  meinePosition.x = ziel.x;
  meinePosition.y = ziel.y;
  schreibePosition(true);
  return true;
}

function verlasseSchacht() {
  if (!imSchacht) return false;
  imSchacht = null;
  schreibePosition(true);
  return true;
}

function binImSchacht() {
  return !!imSchacht;
}

function bewege(dx, dy, sekunden) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft" || raum.meeting) return;
  if (!meinePosition) return;
  if (imSchacht) return;   // im Schacht bewegt man sich nur zwischen den Enden
  if (faengerGesperrt(raum, eigeneUid)) return; // Vorsprung: der Fänger steht noch
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
    geist,
    // Wer im Schacht sitzt, wird von den anderen nicht gezeichnet. Bewusst ein Flag an der
    // Position und kein eigener Knoten: es muss mit derselben Nachricht ankommen wie die
    // Koordinaten, sonst gäbe es Bilder, in denen jemand schon am neuen Ende steht, aber noch
    // als sichtbar gilt — ein Aufblitzen quer über die Karte.
    schacht: !!imSchacht
  }).catch(() => {});
}

function startePositionsSchleife() {
  if (positionTimer) return;
  positionTimer = setInterval(() => schreibePosition(false), POSITION_INTERVALL_MS);
}

// --- Aufgaben ---

// Die Teile EINER mehrteiligen Aufgabe: alle eigenen Stationen desselben Typs, in der
// Reihenfolge, in der waehleAufgaben sie vergeben hat.
function teileDerAufgabe(stationId) {
  const station = karte.stationNachId(stationId);
  if (!station) return [];
  return meineAufgaben.filter(id => {
    const s = karte.stationNachId(id);
    return s && s.typ === station.typ;
  });
}

// Bei einer Kette (Strom umleiten, Daten übertragen) müssen die Teile in der vorgegebenen
// Reihenfolge kommen: erst der Regler in der Elektrik, dann der Schalter im Zielraum.
function ketteBlockiert(stationId) {
  const station = karte.stationNachId(stationId);
  const def = station && aufgabenModul.AUFGABEN_TYPEN[station.typ];
  if (!def || !def.kette) return false;
  const teile = teileDerAufgabe(stationId);
  return teile.slice(0, teile.indexOf(stationId)).some(id => meineErledigten.indexOf(id) === -1);
}

// Warteaufgaben (Proben analysieren, WLAN neu starten) merken sich ihren Startzeitpunkt in der
// eigenen Rollenbox. Das MUSS überdauern, dass die Aufgabe geschlossen wird — der ganze Sinn
// ist ja, in der Zwischenzeit wegzugehen.
async function starteWartezeit(stationId) {
  if (!aktuellerRaumCode || !eigeneUid) return;
  if (meineAufgaben.indexOf(stationId) === -1 || meineWartezeiten[stationId]) return;
  meineWartezeiten = { ...meineWartezeiten, [stationId]: serverJetzt() };
  benachrichtige();
  await db.ref(`${ROLLEN_PFAD}/${aktuellerRaumCode}/${eigeneUid}/warten`)
    .set(meineWartezeiten).catch(() => {});
}

async function erledigeAufgabe(stationId) {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft") return { erfolg: false };
  if (meineAufgaben.indexOf(stationId) === -1) return { erfolg: false };
  if (meineErledigten.indexOf(stationId) !== -1) return { erfolg: false };
  if (ketteBlockiert(stationId)) return { erfolg: false, fehler: "Der vorherige Schritt fehlt noch." };

  meineErledigten = meineErledigten.concat([stationId]);
  await db.ref(`${ROLLEN_PFAD}/${aktuellerRaumCode}/${eigeneUid}/erledigt`).set(meineErledigten).catch(() => {});

  // Der eigentliche Bluff: Maulwürfe dürfen dieselbe Aufgabe spielen, ihr Ergebnis zählt
  // nur nicht für den gemeinsamen Fortschritt — und löst auch keine sichtbare Wirkung aus.
  if (meineRolle === "team") {
    await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/aufgaben/erledigt`)
      .set(firebase.database.ServerValue.increment(1)).catch(() => {});
    await zeigeSichtbareWirkung(stationId);
  }
  benachrichtige();
  return { erfolg: true };
}

// Sichtbare Aufgaben hinterlassen für ein paar Sekunden eine Spur an der Station, die jeder
// in Sichtweite sieht. Das ist das einzige harte Alibi im Spiel.
//
// Die Prüfung "ist das Gerät wirklich im Team?" passiert hier im Client — genau wie beim
// Aufgabenzähler. Die Rules können das nicht abfangen, ohne die Rollen offenzulegen, und die
// wiederum sind der Kern des Spiels. Wer seinen eigenen Client manipuliert, kann auch heute
// schon den Fortschrittsbalken hochzählen; das ist bewusst dieselbe Vertrauensebene.
async function zeigeSichtbareWirkung(stationId) {
  const station = karte.stationNachId(stationId);
  const typ = station && aufgabenModul.AUFGABEN_TYPEN[station.typ];
  if (!typ || !typ.sichtbar) return;
  const name = (letzterRaum && letzterRaum.spieler[eigeneUid] && letzterRaum.spieler[eigeneUid].name) || "";
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/visuell/${stationId}`)
    .set({ name, zeichen: typ.sichtbar, bis: serverJetzt() + SICHTBARE_WIRKUNG_MS }).catch(() => {});
}

// --- Sonderrollen ---

// Schutzengel: erst als Geist einsetzbar, wirkt auf eine lebende Person in der Nähe. Der
// Schutz liegt offen im Raumobjekt — er MUSS für das Maulwurf-Gerät lesbar sein, weil dort
// der Kill geprüft wird. Dass ein Maulwurf dadurch sieht, wer gerade geschützt ist, ist kein
// Leck, sondern beabsichtigt: er soll das vergebliche Foulspiel ja bemerken können.
async function schuetze(zielUid) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (meineSonderrolle !== "schutzengel") return { erfolg: false };
  if (raum.spieler[eigeneUid].lebt !== false) return { erfolg: false, fehler: "Das geht erst, wenn du ausgeschaltet bist." };
  if (!raum.spieler[zielUid] || raum.spieler[zielUid].lebt === false) return { erfolg: false };
  if ((raum.schutzCooldownBis || 0) > serverJetzt()) {
    return { erfolg: false, fehler: `Noch ${Math.ceil(((raum.schutzCooldownBis || 0) - serverJetzt()) / 1000)} s.` };
  }
  const updates = {};
  updates[`${RAEUME_PFAD}/${code}/schutz/${zielUid}`] = serverJetzt() + SCHUTZ_DAUER_MS;
  updates[`${RAEUME_PFAD}/${code}/schutzCooldownBis`] = serverJetzt() + SCHUTZ_COOLDOWN_MS;
  await db.ref().update(updates).catch(() => {});
  return { erfolg: true };
}

// Gestaltwandler: übernimmt zeitweise Name und Farbe einer lebenden Person. Auch das steht
// offen im Raum — jedes fremde Gerät muss die Verkleidung ja zeichnen können. Wer die Konsole
// öffnet, sieht die Täuschung auffliegen; das ist dieselbe Grenze wie bei den Positionen.
async function verkleideDich(zielUid) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (meineSonderrolle !== "gestaltwandler") return { erfolg: false };
  if (raum.spieler[eigeneUid].lebt === false) return { erfolg: false };
  const updates = {};
  if (zielUid && raum.spieler[zielUid]) {
    // ⚠️ Die Abklingzeit bremst das VERWANDELN und darf nur hier stehen. Vor der
    // Fallunterscheidung sperrte sie auch das Ablegen — und weil sie mit 45 s mehr als
    // doppelt so lang läuft wie die Verkleidung mit 20 s, war der Knopf "Verkleidung
    // ablegen" in jedem Moment, in dem es ihn überhaupt gab, wirkungslos.
    if ((raum.verkleidungCooldownBis || 0) > serverJetzt()) {
      return { erfolg: false, fehler: `Noch ${Math.ceil(((raum.verkleidungCooldownBis || 0) - serverJetzt()) / 1000)} s.` };
    }
    updates[`${RAEUME_PFAD}/${code}/verkleidung/${eigeneUid}`] = { alsUid: zielUid, bis: serverJetzt() + VERKLEIDUNG_DAUER_MS };
    updates[`${RAEUME_PFAD}/${code}/verkleidungCooldownBis`] = serverJetzt() + VERKLEIDUNG_COOLDOWN_MS;
  } else {
    updates[`${RAEUME_PFAD}/${code}/verkleidung/${eigeneUid}`] = null;   // vorzeitig abstreifen
  }
  await db.ref().update(updates).catch(() => {});
  return { erfolg: true };
}

function schutzAktiv(raum, uid) {
  return ((raum.schutz || {})[uid] || 0) > serverJetzt();
}

// --- Ausschalten ("Foulspiel") ---

async function schalteAus(opferUid) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (meineRolle !== "maulwurf") return { erfolg: false };
  if (raum.spieler[eigeneUid].lebt === false) return { erfolg: false };
  if (imSchacht) return { erfolg: false, fehler: "Nicht aus dem Schacht heraus." };
  if (faengerGesperrt(raum, eigeneUid)) return { erfolg: false, fehler: "Der Vorsprung läuft noch." };
  const opfer = raum.spieler[opferUid];
  if (!opfer || opfer.lebt === false) return { erfolg: false };
  // Wer im Schacht sitzt, ist unsichtbar und damit auch unerreichbar — sonst könnte man jemanden
  // treffen, den man gar nicht sieht, und das Opfer verstünde nicht, was passiert ist.
  if (positionen[opferUid] && positionen[opferUid].schacht) return { erfolg: false, fehler: "Da ist niemand." };
  if (aktuelleMaulwuerfe()[opferUid]) return { erfolg: false, fehler: "Das ist ein Maulwurf." };
  if (killBereitAb(raum, eigeneUid) > serverJetzt()) return { erfolg: false, fehler: "Noch nicht bereit." };
  const meine = positionen[eigeneUid];
  const seine = positionen[opferUid];
  if (!meine || !seine || karte.abstand(meine.x, meine.y, seine.x, seine.y) > karte.KILL_REICHWEITE) {
    return { erfolg: false, fehler: "Zu weit weg." };
  }
  // Die Reichweite (74) ist größer als eine Wand dick ist (35). Ohne diese Prüfung ließe sich
  // durch die Wand foulen — und seit die Sicht an Wänden endet, sähe das Opfer nicht einmal,
  // woher es kam.
  if (!karte.sichtlinieFrei(meine.x, meine.y, seine.x, seine.y)) {
    return { erfolg: false, fehler: "Da ist eine Wand dazwischen." };
  }
  // Schutzengel: das Foulspiel geht daneben. Der Cooldown läuft trotzdem an — sonst könnte
  // man den Schutz einfach aussitzen und sofort nachsetzen, und die Rolle wäre wirkungslos.
  if (schutzAktiv(raum, opferUid)) {
    const einst = Object.assign({}, STANDARD_EINSTELLUNGEN, raum.einstellungen || {});
    await db.ref(`${RAEUME_PFAD}/${code}/killCooldownBis/${eigeneUid}`)
      .set(serverJetzt() + einst.killCooldownSek * 1000).catch(() => {});
    return { erfolg: false, fehler: "Da war etwas dazwischen …" };
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
  if (istVersteckModus(raum)) return { erfolg: false }; // ohne Besprechung gibt es nichts zu melden
  if (raum.spieler[eigeneUid].lebt === false) return { erfolg: false };
  const leiche = (raum.leichen || {})[leicheUid];
  if (!leiche || leiche.gemeldet) return { erfolg: false };
  return starteMeeting("leiche", leiche.name);
}

async function drueckeNotfallknopf() {
  const raum = letzterRaum;
  if (!raum || raum.phase !== "laeuft" || raum.meeting) return { erfolg: false };
  if (istVersteckModus(raum)) return { erfolg: false };
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
        await db.ref(`${RAEUME_PFAD}/${code}`).update({ sabotage: null, tueren: null, leichen: null, kameras: null }).catch(() => {});
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
  const einstellungen = Object.assign({}, STANDARD_EINSTELLUNGEN, daten.einstellungen || {});
  if (!einstellungen.rolleNachRauswurf) return;
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
  // Im Verstecken-Modus gibt es keine Sabotage. Der Reaktor setzt darauf, dass zwei Leute
  // gemeinsam reparieren und sich vorher absprechen — ohne Besprechung wäre sie ein reiner
  // Zeitzünder, und der Fänger gewänne, ohne jemanden gefangen zu haben.
  if (istVersteckModus(raum)) return { erfolg: false };
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
  // Funk und Licht laufen beide ohne Countdown und werden von einer einzelnen Person
  // repariert — nur an unterschiedlichen Pulten und mit unterschiedlicher Wirkung.
  const neu = typ === "reaktor"
    ? { typ: "reaktor", endeAt: serverJetzt() + SABOTAGE_REAKTOR_MS, ventile: null, reparaturClaim: null, aufloesungClaim: null }
    : typ === "funk"
    ? { typ: "funk", endeAt: 0, reparaturClaim: null, aufloesungClaim: null }
    : { typ: "licht", endeAt: 0, reparaturClaim: null, aufloesungClaim: null };

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

async function repariereLicht() {
  const raum = letzterRaum;
  if (!raum || !raum.sabotage || raum.sabotage.typ !== "licht") return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/sabotage`).set(null).catch(() => {});
  return { erfolg: true };
}

async function repariereFunk() {
  const raum = letzterRaum;
  if (!raum || !raum.sabotage || raum.sabotage.typ !== "funk") return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${aktuellerRaumCode}/sabotage`).set(null).catch(() => {});
  return { erfolg: true };
}

// --- Kameras ---
//
// Der Eintrag trägt seinen eigenen Ablaufzeitpunkt statt eines simplen "true": ein Gerät, das
// mitten im Zusehen abstürzt oder den Tab schließt, käme sonst nie dazu, sich auszutragen — die
// Warnung bliebe für den Rest der Partie stehen und niemand würde ihr mehr glauben.
function kameraZusehen() {
  const code = aktuellerRaumCode;
  if (!code || !eigeneUid) return;
  db.ref(`${RAEUME_PFAD}/${code}/kameras/${eigeneUid}`)
    .set(serverJetzt() + KAMERA_GUELTIG_MS).catch(() => {});
}

function kameraWegsehen() {
  const code = aktuellerRaumCode;
  if (!code || !eigeneUid) return;
  db.ref(`${RAEUME_PFAD}/${code}/kameras/${eigeneUid}`).remove().catch(() => {});
}

// Sieht IRGENDWER gerade zu? Abgelaufene Einträge zählen nicht mit.
function kameraBeobachtet(raum) {
  const eintraege = (raum && raum.kameras) || {};
  const jetzt = serverJetzt();
  return Object.keys(eintraege).some(uid => eintraege[uid] > jetzt);
}

// Reaktor: beide Kühlventile müssen GLEICHZEITIG gehalten werden. Jedes Gerät schreibt nur sein
// eigenes Ventil; die Prüfung "beide offen" macht dann der erste Client, der es sieht.
async function setzeKuehlventil(seite, gehalten) {
  const raum = letzterRaum;
  const code = aktuellerRaumCode;
  if (!raum || !code || !raum.sabotage || raum.sabotage.typ !== "reaktor") return { erfolg: false };
  await db.ref(`${RAEUME_PFAD}/${code}/sabotage/ventile/${seite}`).set(gehalten ? eigeneUid : null).catch(() => {});
  return { erfolg: true };
}

function pruefeSabotageAblauf(raum) {
  const code = aktuellerRaumCode;
  const sab = raum.sabotage;
  if (!sab) return;

  if (sab.typ === "reaktor") {
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
      beanspracheSieg(raum, "maulwuerfe", "Der Reaktor ist durchgegangen – niemand hat rechtzeitig gekühlt.");
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

// Im Verstecken-Modus läuft die Uhr: reicht sie aus, hat das Team durchgehalten.
function pruefeZeitlimit(raum) {
  if (!istVersteckModus(raum)) return;
  const ende = zeitlimitBis(raum);
  if (ende && serverJetzt() >= ende) {
    beanspracheSieg(raum, "team", "Die Zeit ist um – ihr habt durchgehalten.");
  }
}

// Nur Maulwurf-Geräte können diese beiden Bedingungen überhaupt sehen (siehe Dateikopf).
function pruefeRollenabhaengigenSieg(raum) {
  // Ausnahme Verstecken-Modus: dort ist der Fänger öffentlich bekannt, also kann JEDES Gerät
  // zählen, wer noch frei herumläuft. Das ist die robustere Variante — sie hängt nicht daran,
  // dass ausgerechnet das Gerät des Fängers verbunden bleibt.
  if (istVersteckModus(raum)) {
    if (!raum.faengerUid) return; // Zuteilung noch nicht durch
    const freie = lebendeSpieler(raum).filter(uid => uid !== raum.faengerUid).length;
    if (freie === 0) beanspracheSieg(raum, "maulwuerfe", "Alle sind gefangen.");
    return;
  }

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
      await db.ref().update(updates);
    }
  );
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
    // Bots haben kein eigenes Gerät, ihre Rollen kommen vom Host — aus dem lokalen Merker,
    // denn deren Boxen sind per Rule nicht lesbar (siehe zieheBotRollen). Ein once() darauf
    // hätte diese Funktion abgebrochen und auch die EIGENE Aufdeckung verhindert.
    Object.keys(raum.spieler)
      .filter(uid => raum.spieler[uid].istSimuliert)
      .forEach(botId => {
        const rolle = botZustand[botId] && botZustand[botId].rolle;
        if (rolle) updates[`${AUFDECKUNG_PFAD}/${code}/${botId}`] = rolle;
      });
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
    if (!bot.istSimuliert) return;
    // Tote KI-Mitspieler laufen als Geister weiter und arbeiten ihre Aufgaben ab — genau wie
    // menschliche Geister das dürfen. Ohne das bliebe der Aufgaben-Sieg im Solo-Modus nach
    // dem ersten Foulspiel unerreichbar (der Balken zählt die Aufgaben der Toten weiter mit).
    const istGeist = bot.lebt === false;
    const zustand = botZustand[botId] || (botZustand[botId] = {});
    const pos = positionen[botId] || karte.startPositionen(1)[0];

    if (raum.meeting) return; // im Meeting bewegt sich niemand
    // Der Vorsprung gilt auch für einen KI-Fänger — sonst wäre der Modus gegen die KI von der
    // ersten Sekunde an aussichtslos.
    if (faengerGesperrt(raum, botId)) return;

    // Wegfindung statt stumpfem Zulaufen: seit die Räume nur noch über Türen erreichbar sind,
    // würde ein Bot, der direkt auf den Raummittelpunkt zuhält, an der nächsten Wand kleben
    // bleiben. karte.findeWeg liefert eine Wegpunktkette, die hier Punkt für Punkt abgelaufen
    // wird; der Pfad wird nur bei einem neuen Ziel berechnet, nicht in jedem Tick.
    if (!zustand.pfad || !zustand.pfad.length || jetzt - (zustand.zielSeit || 0) > 30000) {
      const ziel = karte.BOT_WEGPUNKTE[Math.floor(Math.random() * karte.BOT_WEGPUNKTE.length)];
      zustand.pfad = karte.findeWeg(pos.x, pos.y, ziel.x, ziel.y) || [];
      zustand.zielSeit = jetzt;
      zustand.klemmt = 0;
    }
    const naechster = zustand.pfad[0];
    if (!naechster) return; // kein Weg gefunden – der nächste Tick würfelt ein neues Ziel

    const dx = naechster.x - pos.x;
    const dy = naechster.y - pos.y;
    const laenge = Math.hypot(dx, dy) || 1;
    // **Nie über den Wegpunkt hinaus.** Ohne die Begrenzung auf die Restdistanz schoss die KI
    // darüber hinweg: bei 200 ms Tick und Tempo 232 war ein Schritt 46 px lang, ein Wegpunkt
    // gilt aber erst ab 28 px als erreicht. Der Bot sprang über den Radius, lief vorbei, drehte
    // um, sprang zurück — und pendelte um den Punkt, ohne ihn je abzuhaken.
    const schritt = Math.min(einstellungen.tempo * (BOT_TICK_MS / 1000), laenge);

    // **Achsenweise laufen, nicht anteilig.** Der zweite Grund, warum die KI im Laufe des
    // Spiels stehenblieb — und der schwerer wiegende. Ein auf die Schrittlänge normierter
    // Richtungsvektor auf ein weit entferntes Ziel ist fast achsenparallel: bei 692 px Rest
    // nach oben und 9 px nach rechts entfallen von 9,3 px Schritt ganze 0,1 px auf x. Steckt
    // die dominante Achse in einer Wand (typisch: der Bot steht drei Pixel neben einer
    // Türöffnung), löst bewegeMitKollision() nur die andere auf — und der Bot kriecht mit
    // einem Zehntel Pixel pro Tick seitwärts. Das liegt unter der Klemm-Schwelle, er gilt als
    // festsitzend, obwohl er sich bewegt. Im Simulationstest kamen so 129 von 200 Fahrten nie
    // an. Menschen trifft das nicht: bei Tastensteuerung ist die Richtung ±1, nicht normiert.
    //
    // Deshalb: erst die Achse mit dem größeren Rest mit VOLLEM Schritt; ist die blockiert, die
    // andere — das schiebt den Bot an der Wand entlang, bis er vor der Öffnung steht.
    const zuerstX = Math.abs(dx) > Math.abs(dy);
    const schrittX = Math.sign(dx) * Math.min(schritt, Math.abs(dx));
    const schrittY = Math.sign(dy) * Math.min(schritt, Math.abs(dy));
    let neu = zuerstX
      ? karte.bewegeMitKollision(pos.x, pos.y, schrittX, 0)
      : karte.bewegeMitKollision(pos.x, pos.y, 0, schrittY);
    if (karte.abstand(neu.x, neu.y, pos.x, pos.y) < schritt * 0.3) {
      neu = zuerstX
        ? karte.bewegeMitKollision(pos.x, pos.y, 0, schrittY)
        : karte.bewegeMitKollision(pos.x, pos.y, schrittX, 0);
    }

    // Verriegelte Räume halten auch die KI auf – sonst wäre die Sabotage "Raum verriegeln"
    // gegen Bots wirkungslos und sähe wie ein Fehler aus.
    if (!istGeist && zustand.rolle !== "maulwurf" && !tuerDurchgangErlaubt(raum, pos, neu)) {
      zustand.pfad = null;
      return;
    }

    // Kommt der Bot trotz Pfad nicht voran, wird der Weg verworfen statt endlos gegen eine
    // Wand zu drücken (kann passieren, wenn ihn eine Kollision aus dem Raster gedrängt hat).
    if (karte.abstand(neu.x, neu.y, pos.x, pos.y) < schritt * 0.3) {
      zustand.klemmt = (zustand.klemmt || 0) + 1;
      if (zustand.klemmt > BOT_KLEMM_TICKS) { zustand.pfad = null; zustand.klemmt = 0; }
    } else {
      zustand.klemmt = 0;
      if (karte.abstand(neu.x, neu.y, naechster.x, naechster.y) < 28) zustand.pfad.shift();
    }

    // Lokal jeden Tick (das Host-Gerät sieht die KI dadurch flüssig laufen), nach Firebase nur
    // alle BOT_SCHREIB_MS — sonst vervierfachte die feinere Tickrate das Schreibvolumen.
    positionen[botId] = { x: neu.x, y: neu.y, geist: istGeist };
    if (jetzt - (zustand.letzterWrite || 0) >= BOT_SCHREIB_MS) {
      zustand.letzterWrite = jetzt;
      db.ref(`${POSITIONEN_PFAD}/${code}/${botId}`).set({ x: Math.round(neu.x), y: Math.round(neu.y), geist: istGeist }).catch(() => {});
    }

    if (zustand.rolle === "maulwurf") {
      if (!istGeist) versucheBotKill(raum, botId, neu, einstellungen);
    } else if (zustand.rolle === "team") {
      if (!zustand.letzteAufgabe) zustand.letzteAufgabe = jetzt;
      if (jetzt - zustand.letzteAufgabe > BOT_AUFGABE_MS) {
        zustand.letzteAufgabe = jetzt;
        zustand.aufgabenErledigt = (zustand.aufgabenErledigt || 0) + 1;
        if (zustand.aufgabenErledigt <= einstellungen.aufgabenProSpieler) {
          // Mit in die (nicht öffentliche) Bot-Box, damit der Stand einen Reload des Hosts
          // übersteht. NICHT in raeume/: dort stünde er für alle sichtbar, und weil nur
          // Team-Bots hochzählen, wäre jeder Wert über 0 ein Verräter seiner Rolle.
          db.ref(`${ROLLEN_PFAD}/${code}/${botId}/erledigtAnzahl`).set(zustand.aufgabenErledigt).catch(() => {});
          db.ref(`${RAEUME_PFAD}/${code}/aufgaben/erledigt`).set(firebase.database.ServerValue.increment(1)).catch(() => {});
          // Steht der Bot dabei zufällig an einer sichtbaren Station, hinterlässt er dieselbe
          // Spur wie ein Mensch — sonst könnte ein KI-Mitspieler nie ein Alibi vorweisen.
          const station = karte.stationAn(neu.x, neu.y, null);
          const typ = station && aufgabenModul.AUFGABEN_TYPEN[station.typ];
          if (typ && typ.sichtbar) {
            db.ref(`${RAEUME_PFAD}/${code}/visuell/${station.id}`)
              .set({ name: bot.name, zeichen: typ.sichtbar, bis: jetzt + SICHTBARE_WIRKUNG_MS }).catch(() => {});
          }
        }
      }
    }
  });
}

function versucheBotKill(raum, botId, pos, einstellungen) {
  const jetzt = serverJetzt();
  if (killBereitAb(raum, botId) > jetzt) return;
  const code = aktuellerRaumCode;

  const opferUid = Object.keys(raum.spieler).find(uid => {
    if (uid === botId || raum.spieler[uid].lebt === false) return false;
    if (botZustand[uid] && botZustand[uid].rolle === "maulwurf") return false;
    if (schutzAktiv(raum, uid)) return false;   // Schutzengel gilt auch gegen die KI
    const p = positionen[uid];
    return p && karte.abstand(pos.x, pos.y, p.x, p.y) <= karte.KILL_REICHWEITE
             && karte.sichtlinieFrei(pos.x, pos.y, p.x, p.y);   // nicht durch die Wand
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
  updates[`${RAEUME_PFAD}/${code}/visuell`] = null;
  updates[`${RAEUME_PFAD}/${code}/schutz`] = null;
  updates[`${RAEUME_PFAD}/${code}/schutzCooldownBis`] = 0;
  updates[`${RAEUME_PFAD}/${code}/verkleidung`] = null;
  updates[`${RAEUME_PFAD}/${code}/verkleidungCooldownBis`] = 0;
  updates[`${RAEUME_PFAD}/${code}/meeting`] = null;
  updates[`${RAEUME_PFAD}/${code}/sabotage`] = null;
  updates[`${RAEUME_PFAD}/${code}/kameras`] = null;
  updates[`${RAEUME_PFAD}/${code}/tueren`] = null;
  updates[`${RAEUME_PFAD}/${code}/sieger`] = null;
  updates[`${RAEUME_PFAD}/${code}/siegGrund`] = null;
  updates[`${RAEUME_PFAD}/${code}/siegClaim`] = null;
  updates[`${RAEUME_PFAD}/${code}/revealBis`] = 0;
  // Muss mit zurück auf null: sonst gälte im Rematch der Fänger der Vorrunde als markiert,
  // bis der neue sich einträgt — und Vorsprung wie Zeitlimit rechneten gegen ein revealBis,
  // das noch gar nicht steht.
  updates[`${RAEUME_PFAD}/${code}/faengerUid`] = null;
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
  // Auf dem Host wirkt das sofort; die Gäste erledigen dasselbe, sobald ihr Raum-Update die
  // neue Rundennummer bringt (Prüfung am Kopf von verarbeiteRaumZustand).
  verwerfeRundendaten();
  // Der Bot-Zustand ist strikt rundengebunden: er hält neben der Rolle auch den Zähler
  // aufgabenErledigt. Ohne dieses Leeren startete jeder Bot im Rematch mit dem vollen
  // Zähler der Vorrunde und erledigte keine einzige Aufgabe mehr — die Siegbedingung
  // "alle Aufgaben erledigt" war ab der zweiten Runde unerreichbar (gefunden 2026-07-26).
  Object.keys(botZustand).forEach(k => delete botZustand[k]);
  if (botTimer) { clearInterval(botTimer); botTimer = null; }
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
  bewege, setzeStartposition, startePositionsSchleife, schreibePosition,
  betreteSchacht, wechsleSchachtEnde, verlasseSchacht, binImSchacht,
  erledigeAufgabe, starteWartezeit, schalteAus, meldeLeiche, drueckeNotfallknopf,
  sendeChat, stimmeAb, deckeAusgeschlosseneRolleAuf,
  sabotiere, repariereLicht, repariereFunk, setzeKuehlventil,
  kameraZusehen, kameraWegsehen, KAMERA_TAKT_MS,
  schuetze, verkleideDich,
  verlasseSpiel, neueRunde, raeumeRaumAuf,
  getZustand, onZustandsAenderung,
  serverJetzt,
  // für Verifikation direkt aufrufbar (reine Funktionen, kein Firebase-Zugriff):
  SICHTBARE_WIRKUNG_MS,
  ermittleAusschluss, anzahlMaulwuerfeFuer, mischeListe,
  istVersteckModus, vorsprungBis, zeitlimitBis,
  laufBeginn, killBereitAb, START_KILL_COOLDOWN_MS,
  MIN_SPIELER, MAX_SPIELER
};
