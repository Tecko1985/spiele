// Feste Karte des Vereinsgeländes: reine Daten + Geometrie-Hilfsfunktionen, kein Firebase,
// kein DOM. Alles hier ist deterministisch und auf allen Geräten identisch — die Karte wird
// NICHT über Firebase verteilt, sondern liegt als Konstante in jedem Client.
//
// Layout-Prinzip: Räume, Gänge und Türen sind achsenparallele Rechtecke. Begehbar ist alles,
// was in der VEREINIGUNG dieser Rechtecke liegt (siehe istBegehbar).
//
// Anders als in der ersten Fassung grenzen die Räume NICHT mehr aneinander und die Gänge
// laufen auch nicht mehr quer durch sie hindurch: zwischen allen Flächen liegen 35 px Wand,
// verbunden wird ausschließlich über Türöffnungen. Dadurch gibt es echte Flure, in denen man
// sich begegnet, und Räume mit zählbaren Ein-/Ausgängen — die Grundlage dafür, dass "wo warst
// du?" im Meeting überhaupt eine sinnvolle Frage ist.
//
// Weltkoordinaten: 0..WELT_BREITE / 0..WELT_HOEHE. Der Canvas-Renderer in app.js skaliert
// das auf die Bildschirmgröße, hier stehen keine Pixel-Annahmen über das Endgerät.

const WELT_BREITE = 2600;
const WELT_HOEHE = 1500;

const SPIELER_RADIUS = 16;
const INTERAKTIONS_RADIUS = 58;
const KILL_REICHWEITE = 74;
const TUNNEL_RADIUS = 46;

// Sichtweiten in Weltkoordinaten. Maulwürfe sehen etwas weiter, bei ausgefallenem Licht
// schrumpft der Radius fürs Team drastisch (Maulwürfe behalten ihre volle Sicht — das ist
// der eigentliche Sinn dieser Sabotage).
//
// Die Werte hängen an der Raumgröße, nicht an der Weltgröße: man soll den Raum, in dem man
// steht, gerade eben überblicken können. Mit dem Umbau auf das Original-Layout sind die Räume
// von 250×200 auf 300×310 gewachsen — die Sichtweiten mussten deshalb mitwachsen, sonst stünde
// man in der Mitte eines Raums und sähe seine eigenen Wände nicht mehr.
const SICHT_TEAM = 340;
const SICHT_MAULWURF = 420;
const SICHT_TEAM_DUNKEL = 120;
const SICHT_GEIST = 99999;

// Verstecken-Modus: alle sehen weniger, der Fänger am wenigsten. Das dreht das
// Kräfteverhältnis des Klassik-Modus bewusst um — dort sieht der Maulwurf am weitesten. Hier
// weiß der Fänger ohnehin, dass ihn alle kommen sehen; sein Nachteil ist, dass er selbst kaum
// etwas erkennt und sich an der Nähe-Anzeige entlangtasten muss.
const SICHT_VERSTECKEN_TEAM = 270;
const SICHT_VERSTECKEN_FAENGER = 195;

// Layout nach dem Vorbild von "The Skeld" (Among Us), auf achsenparallele Rechtecke
// zurückgeführt — die Engine kennt nur solche (siehe istBegehbar). Nachgebaut ist die
// TOPOLOGIE, nicht jeder Pixel: welcher Raum an welchen grenzt, wo die Flure langlaufen und
// vor allem, wie viele Ein-/Ausgänge jeder Raum hat. Genau daran hängt das Spiel.
//
// **VIER Sackgassen mit je genau EINEM Eingang: Sicherheit, Krankenstation, Elektrik,
// Kommunikation.** Das ist der wichtigste Teil der Vorlage. Wer dort hineingeht, kommt nur auf
// demselben Weg wieder heraus — deshalb ist es dort so gefährlich und deshalb ist "wer war mit
// dir drin?" eine harte Frage. Die Elektrik ist die berühmteste davon; genau ein Eingang ist
// der Grund, warum dort so viele sterben. Beim Ändern des Layouts nicht versehentlich eine
// zweite Tür spendieren — der Kartentest prüft alle vier.
//
// Die Cafeteria ist das Drehkreuz mit vier Ausgängen, das Lager der zweite Knoten. Wer die
// Cafeteria verlässt, wird gesehen — das macht sie zum sicheren Ort und zum Ausgangspunkt
// jeder Diskussion.
//
// Die Namen sind die des Originals in der deutschen Fassung (Cafeteria, Reaktor, Elektrik …).
// Die ids bleiben englisch wie im Original-Grundriss — sie stehen in Stationstabelle,
// Türliste und Schächten und sind nicht für Spieleraugen bestimmt.
const RAEUME = [
  // obere Reihe
  { id: "upper-engine", name: "Oberer Motor",  x: 190,  y: 90,   w: 330, h: 310 },
  { id: "cafeteria",    name: "Cafeteria",     x: 1030, y: 90,   w: 620, h: 310 },
  { id: "weapons",      name: "Waffen",        x: 2020, y: 90,   w: 330, h: 310 },
  // mittlere Reihe
  { id: "reactor",      name: "Reaktor",       x: 60,   y: 540,  w: 240, h: 310 },
  { id: "security",     name: "Sicherheit",    x: 455,  y: 540,  w: 345, h: 310 },
  { id: "medbay",       name: "Krankenstation", x: 1000, y: 540, w: 300, h: 310 },
  { id: "admin",        name: "Verwaltung",    x: 1560, y: 540,  w: 300, h: 310 },
  { id: "o2",           name: "O2",            x: 1900, y: 540,  w: 240, h: 310 },
  { id: "navigation",   name: "Navigation",    x: 2300, y: 540,  w: 260, h: 310 },
  // untere Reihe
  { id: "lower-engine", name: "Unterer Motor", x: 190,  y: 990,  w: 330, h: 310 },
  { id: "electrical",   name: "Elektrik",      x: 560,  y: 990,  w: 280, h: 310 },
  { id: "storage",      name: "Lager",         x: 1080, y: 990,  w: 420, h: 310 },
  { id: "comms",        name: "Kommunikation", x: 1560, y: 1205, w: 320, h: 235 },
  { id: "shields",      name: "Schilde",       x: 2060, y: 990,  w: 320, h: 310 }
];

// Das Flurnetz. Waagerechte Verbindungsstücke oben und rechts, drei Längsgänge und ein
// unterer Quergang in ZWEI Hälften — zusammen ergibt das den Rundlauf des Originals: man kann
// im Kreis laufen, ohne je umzudrehen. Ohne diesen Rundlauf wäre jede Verfolgung eine
// Sackgasse und "ich bin ihm ausgewichen" keine glaubhafte Aussage mehr. Der Rundlauf führt
// aber bewusst DURCH das Lager und nicht daran vorbei — siehe unten.
const KORRIDORE = [
  // oben: Oberer Motor — Cafeteria — Waffen
  { id: "flur-o1", x: 555,  y: 205,  w: 440,  h: 80 },
  { id: "flur-o2", x: 1685, y: 205,  w: 300,  h: 80 },
  // linker Längsgang: Oberer Motor ↔ Süd, mit Abzweig zum Reaktor
  { id: "gang-l",  x: 340,  y: 435,  w: 80,   h: 520 },
  // Mittlerer Längsgang, die Hauptschlagader der Westhälfte: vom oberen Flur durchgehend
  // bis zum unteren Quergang. Kreuzt flur-o1 und flur-u — die Flächen überlappen bewusst,
  // das ergibt T-Kreuzungen ohne eigene Tür. An ihm hängen Krankenstation und Elektrik mit
  // je genau EINER Tür, wie im Original.
  { id: "gang-m",  x: 880,  y: 205,  w: 80,   h: 1210 },
  // Cafeteria nach unten in den Lager, östlich am Krankenstation vorbei
  { id: "gang-c",  x: 1400, y: 435,  w: 80,   h: 520 },
  // Cafeteria ↓ Verwaltung. Die Verwaltung hat ihre zweite Tür zum Gang Cafeteria–Lager,
  // nicht zur Kommunikation — sonst wäre die Kommunikation keine Sackgasse mehr.
  { id: "gang-a",  x: 1560, y: 435,  w: 80,   h: 70 },
  // rechter Längsgang: Waffen ↕ O2 ↕ Navigation ↕ Schilde
  { id: "gang-r",  x: 2180, y: 435,  w: 80,   h: 520 },
  // Unterer Quergang, ZWEIGETEILT. Er lief bis 2026-07-27 in einem Stück über 1955 px unter
  // der ganzen Karte durch — ein Gang, den das Original nicht hat und der das Lager
  // umgehbar machte. Jetzt endet die Westhälfte am Lager und die Osthälfte beginnt dahinter:
  // **wer von links nach rechts will, muss durch das Lager.** Damit ist es der Knotenpunkt,
  // der es im Original ist, und der lange unbeobachtete Rückweg existiert nicht mehr.
  { id: "flur-uw", x: 300,  y: 1335, w: 880,  h: 80 },
  // Ostgang Lager ↔ Schilde, auf RAUMHÖHE — nicht unter allem hindurch. Die Kommunikation
  // hängt als Sackgasse darunter und wird von hier aus betreten, genau wie im Original.
  { id: "flur-so", x: 1535, y: 1090, w: 490,  h: 80 }
];

// Türöffnungen. Angegeben wird der Mittelpunkt der Öffnung in der Raumwand plus die Achse:
// "h" = Durchgang in x-Richtung (Öffnung in einer senkrechten Wand), "v" = in y-Richtung.
// TUER_TIEFE reicht bewusst über die 35 px Wand hinaus, damit die Schwelle beide Flächen
// sicher überlappt und an der Naht keine unpassierbare Lücke entsteht.
const TUER_BREITE = 84;
const TUER_TIEFE = 56;

// Die Achse bleibt am Rechteck hängen: der Renderer muss wissen, in welche Richtung eine
// Schwelle durch die Wand stößt, um ihre beiden Hälften unterschiedlich einzufärben.
function tuer(x, y, achse) {
  return achse === "h"
    ? { achse: "h", x: x - TUER_TIEFE, y: y - TUER_BREITE / 2, w: TUER_TIEFE * 2, h: TUER_BREITE }
    : { achse: "v", x: x - TUER_BREITE / 2, y: y - TUER_TIEFE, w: TUER_BREITE, h: TUER_TIEFE * 2 };
}

// Türen. Die ANZAHL je Raum ist die eigentliche Spielinformation — sie entscheidet, ob ein
// Raum eine Falle ist. Sicherheit, Krankenstation, Elektrik und Kommunikation haben je genau
// eine; Reaktor, O2 und Navigation haben zwei zum selben Gang (wie im Original: zwei Türen,
// aber nur ein Fluchtweg-System).
//
// Umbau 2026-07-27 nach dem Original-Grundriss: die Krankenstation wird nicht mehr direkt aus
// der Cafeteria betreten, sondern vom mittleren Längsgang — man muss sich also erst in den
// Gang begeben, wo einen jeder sieht. Die Elektrik hat ihre zweite Tür zum unteren Quergang
// verloren und ist damit die Sackgasse des Originals. Die Kommunikation hängt nur noch am
// unteren Quergang; die Abkürzung Verwaltung↓Kommunikation ist weg, dafür hat die Verwaltung
// ihre zweite Tür zum Gang Cafeteria–Lager.
const TUEREN = [
  // oberer Flur
  tuer(537, 245, "h"),   // Oberer Motor ↔ flur-o1
  tuer(1012, 245, "h"),  // flur-o1 ↔ Cafeteria
  tuer(1667, 245, "h"),  // Cafeteria ↔ flur-o2
  tuer(2002, 245, "h"),  // flur-o2 ↔ Waffen
  // linker Längsgang
  tuer(380, 417, "v"),   // Oberer Motor ↓ gang-l
  tuer(380, 972, "v"),   // gang-l ↓ Unterer Motor
  tuer(320, 620, "h"),   // Reaktor ↔ gang-l (obere Tür)
  tuer(320, 790, "h"),   // Reaktor ↔ gang-l (untere Tür)
  tuer(437, 695, "h"),   // gang-l ↔ Sicherheit — die EINZIGE Tür dieses Raums, und sie geht
                         // direkt auf den Hauptgang. Kein Stichflur davor: im Original steht
                         // die Sicherheit unmittelbar am Längsgang.
  // mittlerer Längsgang: an ihm hängen die beiden westlichen Sackgassen
  tuer(980, 695, "h"),   // gang-m ↔ Krankenstation — die EINZIGE Tür dieses Raums
  tuer(860, 1145, "h"),  // Elektrik ↔ gang-m — die EINZIGE Tür dieses Raums
  // Cafeteria nach unten
  tuer(1440, 417, "v"),  // Cafeteria ↓ gang-c
  tuer(1440, 972, "v"),  // gang-c ↓ Lager
  tuer(1600, 417, "v"),  // Cafeteria ↓ gang-a
  tuer(1600, 522, "v"),  // gang-a ↓ Verwaltung
  tuer(1520, 695, "h"),  // gang-c ↔ Verwaltung (zweite Tür, zum Gang Cafeteria–Lager)
  // rechter Längsgang
  tuer(2220, 417, "v"),  // Waffen ↓ gang-r
  tuer(2160, 620, "h"),  // O2 ↔ gang-r (obere Tür)
  tuer(2160, 790, "h"),  // O2 ↔ gang-r (untere Tür)
  tuer(2280, 620, "h"),  // gang-r ↔ Navigation (obere Tür)
  tuer(2280, 790, "h"),  // gang-r ↔ Navigation (untere Tür)
  tuer(2220, 972, "v"),  // gang-r ↓ Schilde
  // unterer Quergang
  tuer(380, 1317, "v"),  // Unterer Motor ↓ flur-uw
  tuer(1180, 1317, "v"), // flur-uw ↑ Lager — hier endet der Quergang aus dem Westen
  // Ostgang: aus dem Lager heraus, Kommunikation darunter, Schilde am Ende
  tuer(1517, 1130, "h"), // Lager ↔ flur-so
  tuer(1720, 1187, "v"), // flur-so ↓ Kommunikation — die EINZIGE Tür dieses Raums
  tuer(2042, 1130, "h")  // flur-so ↔ Schilde
];

// Lüftungsschächte. Nur Maulwürfe (und der Ingenieur) dürfen sie benutzen.
//
// **Ein Eintrag ist ein NETZ, keine Verbindung.** Bis 2026-07-27 verband jeder Schacht genau
// zwei Punkte; das Original hat aber zwei Dreiernetze, und die sind spielentscheidend: aus
// einem Dreieck kommt man an drei Stellen wieder heraus, was jede Zeugenaussage entwertet.
// Deshalb `enden: [...]` mit zwei ODER drei Enden.
//
// Die sechs Netze des Originals — bewusst voneinander getrennt, man kommt nicht von einer
// Schiffsseite zur anderen:
//   1. Todes-Dreieck   Elektrik ↔ Krankenstation ↔ Sicherheit
//   2./3. Reaktor      je ein Ende nach oben zum Oberen, nach unten zum Unteren Motor
//   4. rechts oben     Waffen ↔ Navigation
//   5. rechts unten    Navigation ↔ Schilde
//   6. Zentral-Dreieck Cafeteria ↔ Verwaltung ↔ Ostflur
//
// **Das Ende im Ostflur ist die einzige Abweichung von unserer bisherigen Regel**, dass alle
// Enden in Räumen liegen. Im Original liegt dieser Vent im Flur, und genau das macht ihn
// gefährlich: man taucht mitten im Gang vor jemandem auf, statt aus einem Raum zu kommen.
//
// Jedes Ende trägt seinen Ortsnamen mit. Bei Dreiernetzen steht er zur Auswahl im
// Wohin-Dialog, und für den Ostflur gäbe raumAn() ohnehin nichts zurück.
//
// **Die Standorte sind nicht frei wählbar.** ermittleAktion() gibt nur EINE Aktion zurück und
// prüft Kamerapult und Aufgabenstation VOR dem Schacht. Liegt ein Ende zu dicht an einem
// dieser Punkte, ist der Schacht von dort aus unbenutzbar. Bis zum Umbau war das bei 12 von
// 14 Enden der Fall, ohne dass es jemandem auffiel — der Kartentest prüfte Schächte nur
// gegeneinander. Der Schachttest deckt das jetzt ab; Mindestabstand 79 px.
const TUNNEL = [
  { id: "netz-todesdreieck", name: "Elektrik ↔ Krankenstation ↔ Sicherheit", farbe: "#a855f7", enden: [
    { x: 700,  y: 1265, ort: "Elektrik" },
    { x: 1020, y: 830,  ort: "Krankenstation" },
    { x: 780,  y: 830,  ort: "Sicherheit" }
  ] },
  { id: "netz-reaktor-nord", name: "Reaktor ↔ Oberer Motor", farbe: "#f97316", enden: [
    { x: 180, y: 560, ort: "Reaktor" },
    { x: 210, y: 380, ort: "Oberer Motor" }
  ] },
  { id: "netz-reaktor-sued", name: "Reaktor ↔ Unterer Motor", farbe: "#eab308", enden: [
    { x: 290, y: 830,  ort: "Reaktor" },
    { x: 210, y: 1280, ort: "Unterer Motor" }
  ] },
  { id: "netz-waffen", name: "Waffen ↔ Navigation", farbe: "#22d3ee", enden: [
    { x: 2040, y: 380, ort: "Waffen" },
    { x: 2365, y: 560, ort: "Navigation" }
  ] },
  { id: "netz-schilde", name: "Navigation ↔ Schilde", farbe: "#34d399", enden: [
    { x: 2430, y: 830,  ort: "Navigation" },
    { x: 2080, y: 1280, ort: "Schilde" }
  ] },
  { id: "netz-zentral", name: "Cafeteria ↔ Verwaltung ↔ Ostflur", farbe: "#f472b6", enden: [
    { x: 1050, y: 380, ort: "Cafeteria" },
    { x: 1580, y: 830, ort: "Verwaltung" },
    { x: 2200, y: 495, ort: "Ostflur" }
  ] }
];

// Aufgabenstationen. Raum → Liste von [typ, xAnteil, yAnteil]; die Anteile sind relativ zum
// Raum (0..1) und werden beim Laden umgerechnet. So bleibt die Tabelle lesbar und übersteht
// Layoutänderungen.
//
// **Zuordnung und Lage stammen aus dem Original** (Michels Aufstellung vom 2026-07-27), nicht
// aus einem gleichmäßigen Verteilraster: der Müllhebel hängt rechts an der Wand der Cafeteria,
// die Datenkonsole oben links, der Probentisch unten rechts in der Krankenstation. Genau das
// macht Aussagen wie "ich stand hinten am Schaltkasten" überhaupt überprüfbar.
//
// Räume mit nur einer Aufgabe (Sicherheit) sind Absicht — im Original ist die Sicherheit der
// Kameraraum, nicht ein Arbeitsplatz.
//
// Vier Typen brauchen mehrere Standorte, weil sie mehrteilig sind (siehe AUFGABEN_TYPEN):
//   kabel     3 Teile in 3 verschiedenen Räumen → 4 Standorte zur Auswahl
//   daten     Teil 2 MUSS in der Verwaltung liegen (Hauptterminal), Teil 1 überall sonst
//   strom     Teil 1 MUSS in der Elektrik liegen, Teil 2 im versorgten Raum
//   betanken  Teil 1 MUSS im Lager liegen (Tankstation), Teil 2 in einem Motorraum
// Wer hier Standorte streicht, muss diese Bedingungen erhalten, sonst findet
// waehleAufgaben() keine gültige Kette mehr.
//
// **Die Lage ist nicht frei wählbar:** ermittleAktion() gibt nur EINE Aktion zurück. Stationen
// dürfen deshalb nicht zu dicht an Sonderpunkten (Notfallknopf, Kamerapult, Reparaturstellen)
// oder an Schachtenden liegen — Karten- und Schachttest prüfen die Abstände.
const STATIONS_TABELLE = [
  ["cafeteria",    [["daten", 0.12, 0.18], ["kabel", 0.28, 0.80], ["muell", 0.90, 0.50]]],
  ["electrical",   [["strom", 0.50, 0.13], ["kabel", 0.18, 0.52], ["verteiler", 0.86, 0.52],
                    ["daten", 0.18, 0.89]]],
  ["reactor",      [["reaktor", 0.22, 0.40], ["manifold", 0.80, 0.40]]],
  ["medbay",       [["scan", 0.35, 0.32], ["proben", 0.80, 0.80]]],
  ["security",     [["daten", 0.50, 0.20]]],
  ["upper-engine", [["triebwerk", 0.50, 0.42], ["betanken", 0.78, 0.75]]],
  ["lower-engine", [["triebwerk", 0.50, 0.42], ["betanken", 0.78, 0.75]]],
  ["storage",      [["muell", 0.12, 0.28], ["kabel", 0.85, 0.28], ["betanken", 0.50, 0.85]]],
  ["admin",        [["kabel", 0.20, 0.20], ["daten", 0.50, 0.45], ["swipe", 0.80, 0.75]]],
  ["weapons",      [["daten", 0.22, 0.30], ["asteroiden", 0.78, 0.25], ["strom", 0.50, 0.75]]],
  ["o2",           [["filter", 0.22, 0.35], ["muell", 0.75, 0.28], ["strom", 0.62, 0.75]]],
  ["navigation",   [["daten", 0.20, 0.55], ["lenkung", 0.58, 0.25], ["kurs", 0.80, 0.70]]],
  ["shields",      [["schilde", 0.50, 0.25], ["strom", 0.82, 0.70]]],
  ["comms",        [["daten", 0.30, 0.60], ["strom", 0.75, 0.32]]]
];

const STATIONEN = [];
STATIONS_TABELLE.forEach(([raumId, eintraege]) => {
  const raum = RAEUME.find(r => r.id === raumId);
  eintraege.forEach(([typ, ax, ay], i) => {
    STATIONEN.push({
      id: `st-${typ}-${raumId}-${i}`,
      typ,
      raum: raumId,
      x: Math.round(raum.x + ax * raum.w),
      y: Math.round(raum.y + ay * raum.h)
    });
  });
});

// Feste Sonderpunkte: Notfallknopf und die Reparaturstellen der Sabotagen. Die beiden
// Kühlventile liegen bewusst in gegenüberliegenden Ecken des Geländes — sie müssen
// gleichzeitig gehalten werden, das soll zwei Leute kosten.
// Wie im Original: der Notfallknopf steht mitten in der Cafeteria, der Sicherungskasten in
// der Elektrik. Die beiden Kühlventile liegen in Reaktor und O2 — die
// gegenüberliegenden Enden der Karte, was genau der Punkt dieser Sabotage ist.
//
// **Alle Sonderpunkte müssen deutlich mehr als INTERAKTIONS_RADIUS von jeder Aufgabenstation
// entfernt liegen.** ermittleAktion() gibt nur EINE Aktion zurück; überlappen die Radien, gibt
// es Standpunkte, von denen aus die jeweils zweite unerreichbar ist. Deshalb sitzen sie
// bewusst in Raumecken statt in der Mitte — der Kartentest misst die verbleibende
// Überlappungszone und lässt höchstens ein paar Pixel durch.
const NOTFALLKNOPF = { x: 1340, y: 300, raum: "cafeteria" };
const SICHERUNGSKASTEN = { x: 800, y: 1265, raum: "electrical" };
const KUEHLUNG_A = { x: 100, y: 830, raum: "reactor" };
const KUEHLUNG_B = { x: 1940, y: 830, raum: "o2" };
// Das Kamerapult gibt der Sicherheit ihren Zweck — bis dahin war sie reines Risiko ohne
// Gegenwert (eine Tür, drei Stationen, sonst nichts). Das Funkpult ist der Reparaturplatz der
// vierten Sabotage und füllt die Kommunikation.
const KAMERAPULT = { x: 630, y: 830, raum: "security" };
const FUNKPULT = { x: 1600, y: 1240, raum: "comms" };

// Die vier festen Kamerabereiche. Bewusst überwiegend GÄNGE statt Räume: Kameras sollen
// verraten, wer wohin unterwegs ist, nicht was jemand in einem Raum tut — sonst wären
// Aufgaben und Alibis wertlos.
//
// Die Cafeteria ist die Ausnahme, weil dort ohnehin ständig alle durchlaufen.
//
// Alle Ausschnitte haben dieselbe Größe, damit die vier Bilder nebeneinander gleich wirken
// und keiner unbeabsichtigt mehr Fläche abdeckt als die anderen.
const KAMERA_BREITE = 660;
const KAMERA_HOEHE = 340;
// x/y ist der STANDORT der Kamera — dort blinkt sie auf der Karte, und dieser Punkt muss
// deshalb begehbar in einer Fläche liegen. Läge er in einer Wand, gäbe es nie eine Sichtlinie
// dorthin und die Warnung wäre für niemanden zu sehen (genau so gebaut und im Test aufgefallen).
// links/oben ist davon getrennt der BILDAUSSCHNITT: um den Standort zentriert, aber in die
// Welt hineingeschoben, wo er sonst über den Rand ragen würde — der Südgang liegt so dicht am
// unteren Rand, dass sein Bild sonst zur Hälfte aus Nichts bestünde.
const KAMERAS = [
  { id: "kam-cafeteria", name: "Cafeteria",    x: 1340, y: 245 },
  { id: "kam-nord",      name: "Nordgang",     x: 775,  y: 245 },
  { id: "kam-west",      name: "Westkreuzung", x: 480,  y: 695 },
  { id: "kam-sued",      name: "Ostgang",       x: 1780, y: 1130 }
].map(k => ({
  ...k,
  links: Math.min(Math.max(k.x - KAMERA_BREITE / 2, 0), WELT_BREITE - KAMERA_BREITE),
  oben: Math.min(Math.max(k.y - KAMERA_HOEHE / 2, 0), WELT_HOEHE - KAMERA_HOEHE),
  breite: KAMERA_BREITE, hoehe: KAMERA_HOEHE
}));

// Liegt der Punkt im Bild dieser Kamera?
function imKamerabild(kamera, x, y) {
  return x >= kamera.links && x <= kamera.links + kamera.breite &&
         y >= kamera.oben && y <= kamera.oben + kamera.hoehe;
}

// Startpositionen: alle starten im Cafeteria, kreisförmig verteilt (max. 10 Plätze).
function startPositionen(anzahl) {
  const punkte = [];
  const mitte = { x: 1340, y: 190 };
  for (let i = 0; i < anzahl; i++) {
    const winkel = (i / Math.max(anzahl, 1)) * Math.PI * 2;
    punkte.push({
      x: Math.round(mitte.x + Math.cos(winkel) * 88),
      y: Math.round(mitte.y + Math.sin(winkel) * 58)
    });
  }
  return punkte;
}

function inRechteck(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

const ALLE_FLAECHEN = RAEUME.concat(KORRIDORE, TUEREN);

// Umriss aller Flächen plus etwas Außenwand. Der Renderer legt darunter das Mauerwerk: sonst
// sind die Zwischenräume zwischen Räumen und Gängen genauso schwarz wie das Nichts außerhalb
// der Karte, und die Räume schweben als lose Kacheln (gemeldet 2026-07-26).
const GEBAEUDE = (function () {
  const links = Math.min.apply(null, ALLE_FLAECHEN.map(f => f.x));
  const oben = Math.min.apply(null, ALLE_FLAECHEN.map(f => f.y));
  const rechts = Math.max.apply(null, ALLE_FLAECHEN.map(f => f.x + f.w));
  const unten = Math.max.apply(null, ALLE_FLAECHEN.map(f => f.y + f.h));
  const rand = 22;
  return { x: links - rand, y: oben - rand, w: rechts - links + rand * 2, h: unten - oben + rand * 2 };
})();

function punktInFlaeche(x, y) {
  for (let i = 0; i < ALLE_FLAECHEN.length; i++) {
    const r = ALLE_FLAECHEN[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

// Begehbar = Mittelpunkt UND die vier Randpunkte des Spielerkreises liegen in der
// VEREINIGUNG aller Rechtecke.
//
// Wichtig, warum es nicht "ein einzelnes Rechteck mit SPIELER_RADIUS Wandabstand" ist: an
// jedem Übergang erfüllt kein einzelnes Rechteck den Radiusabstand, weil sich die Flächen
// dort nur an der Türschwelle überlappen. Mit der Einzelrechteck-Prüfung entstand genau dort
// eine unpassierbare Lücke — die Karte zerfiel in unerreichbare Inseln (gefunden beim
// Flood-Fill-Test, 2026-07-26). Die Vereinigungsprüfung lässt Türen passieren und hält die
// Figur trotzdem zuverlässig aus den Außenwänden.
function istBegehbar(x, y) {
  const r = SPIELER_RADIUS;
  return punktInFlaeche(x, y) &&
    punktInFlaeche(x - r, y) && punktInFlaeche(x + r, y) &&
    punktInFlaeche(x, y - r) && punktInFlaeche(x, y + r);
}

// Achsenweise Auflösung: erst x allein, dann y allein. Wer schräg gegen eine Wand läuft,
// rutscht dadurch an ihr entlang, statt komplett zu stoppen.
function bewegeMitKollision(x, y, dx, dy) {
  let neuX = x;
  let neuY = y;
  if (dx !== 0 && istBegehbar(x + dx, y)) neuX = x + dx;
  if (dy !== 0 && istBegehbar(neuX, y + dy)) neuY = y + dy;
  return { x: neuX, y: neuY };
}

// Für die Raumanzeige: nur echte Räume zählen (Gänge und Türen absichtlich nicht), damit die
// Ortsangabe im Meeting-Chat aussagekräftig bleibt.
function raumAn(x, y) {
  for (let i = 0; i < RAEUME.length; i++) {
    if (inRechteck(x, y, RAEUME[i])) return RAEUME[i];
  }
  return null;
}

function raumName(x, y) {
  const raum = raumAn(x, y);
  return raum ? raum.name : "Flur";
}

function abstand(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

// Liefert das Tunnelende, auf dem die Position steht, plus das Gegenstück zum Hinreisen.
// Auf welchem Schachtende steht man, und wohin führt es? `ziele` sind alle ANDEREN Enden
// desselben Netzes — bei einem Zweiernetz genau eines, bei einem Dreiernetz zwei, zwischen
// denen der Aufrufer wählen lässt.
function tunnelAn(x, y) {
  for (let i = 0; i < TUNNEL.length; i++) {
    const t = TUNNEL[i];
    for (let k = 0; k < t.enden.length; k++) {
      if (abstand(x, y, t.enden[k].x, t.enden[k].y) <= TUNNEL_RADIUS) {
        return { tunnel: t, index: k, ziele: t.enden.filter((_, j) => j !== k) };
      }
    }
  }
  return null;
}

function stationAn(x, y, erlaubteIds) {
  let beste = null;
  let besterAbstand = INTERAKTIONS_RADIUS;
  STATIONEN.forEach(st => {
    if (erlaubteIds && erlaubteIds.indexOf(st.id) === -1) return;
    const d = abstand(x, y, st.x, st.y);
    if (d <= besterAbstand) {
      besterAbstand = d;
      beste = st;
    }
  });
  return beste;
}

function stationNachId(id) {
  return STATIONEN.find(st => st.id === id) || null;
}

// ============================================================
// Wegfindung
// ============================================================
//
// Mit Türen statt offener Übergänge reicht "stumpf auf den Raummittelpunkt zulaufen" für die
// KI-Mitspieler nicht mehr — sie würden an jeder Wand kleben. Deshalb ein Raster über die
// begehbare Fläche und eine Breitensuche darauf.
//
// Bewusst nur 4er-Nachbarschaft: bei Diagonalschritten kann der Weg zwischen zwei begehbaren
// Zellen durch eine Wandecke führen, die Figur bliebe hängen. Der Umweg über die Kante ist
// billiger als die Sonderfallprüfung.

const RASTER = 25;
const rasterSpalten = Math.ceil(WELT_BREITE / RASTER);
const rasterZeilen = Math.ceil(WELT_HOEHE / RASTER);
const rasterFrei = new Uint8Array(rasterSpalten * rasterZeilen);

for (let zeile = 0; zeile < rasterZeilen; zeile++) {
  for (let spalte = 0; spalte < rasterSpalten; spalte++) {
    const mx = spalte * RASTER + RASTER / 2;
    const my = zeile * RASTER + RASTER / 2;
    rasterFrei[zeile * rasterSpalten + spalte] = istBegehbar(mx, my) ? 1 : 0;
  }
}

function zelleFuer(x, y) {
  const spalte = Math.min(Math.max(Math.floor(x / RASTER), 0), rasterSpalten - 1);
  const zeile = Math.min(Math.max(Math.floor(y / RASTER), 0), rasterZeilen - 1);
  return zeile * rasterSpalten + spalte;
}

// Liegt der Punkt selbst auf einer belegten Zelle (z.B. dicht an einer Wand), wird die
// nächstgelegene freie Zelle genommen — sonst fände die Suche nie einen Startpunkt.
function naechsteFreieZelle(x, y) {
  const start = zelleFuer(x, y);
  if (rasterFrei[start]) return start;
  const startSpalte = start % rasterSpalten;
  const startZeile = Math.floor(start / rasterSpalten);
  for (let radius = 1; radius <= 6; radius++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let ds = -radius; ds <= radius; ds++) {
        if (Math.abs(dz) !== radius && Math.abs(ds) !== radius) continue;
        const s = startSpalte + ds;
        const z = startZeile + dz;
        if (s < 0 || z < 0 || s >= rasterSpalten || z >= rasterZeilen) continue;
        const index = z * rasterSpalten + s;
        if (rasterFrei[index]) return index;
      }
    }
  }
  return -1;
}

function zelleZuPunkt(index) {
  return {
    x: (index % rasterSpalten) * RASTER + RASTER / 2,
    y: Math.floor(index / rasterSpalten) * RASTER + RASTER / 2
  };
}

// Liefert eine Liste von Wegpunkten (ohne den Startpunkt) oder null, wenn kein Weg existiert.
// Der Rohpfad wird auf Richtungswechsel eingedampft — dazwischen kann geradeaus gelaufen
// werden, das spart Zwischenziele und sieht flüssiger aus.
function findeWeg(vonX, vonY, zuX, zuY) {
  const start = naechsteFreieZelle(vonX, vonY);
  const ziel = naechsteFreieZelle(zuX, zuY);
  if (start < 0 || ziel < 0) return null;
  if (start === ziel) return [{ x: zuX, y: zuY }];

  const vorgaenger = new Int32Array(rasterSpalten * rasterZeilen).fill(-1);
  const warteschlange = new Int32Array(rasterSpalten * rasterZeilen);
  let kopf = 0;
  let ende = 0;
  warteschlange[ende++] = start;
  vorgaenger[start] = start;

  while (kopf < ende) {
    const aktuell = warteschlange[kopf++];
    if (aktuell === ziel) break;
    const spalte = aktuell % rasterSpalten;
    const zeile = Math.floor(aktuell / rasterSpalten);
    for (let richtung = 0; richtung < 4; richtung++) {
      const s = spalte + (richtung === 0 ? 1 : richtung === 1 ? -1 : 0);
      const z = zeile + (richtung === 2 ? 1 : richtung === 3 ? -1 : 0);
      if (s < 0 || z < 0 || s >= rasterSpalten || z >= rasterZeilen) continue;
      const nachbar = z * rasterSpalten + s;
      if (!rasterFrei[nachbar] || vorgaenger[nachbar] !== -1) continue;
      vorgaenger[nachbar] = aktuell;
      warteschlange[ende++] = nachbar;
    }
  }

  if (vorgaenger[ziel] === -1) return null;

  const roh = [];
  let lauf = ziel;
  while (lauf !== start) {
    roh.push(lauf);
    lauf = vorgaenger[lauf];
  }
  roh.reverse();

  const weg = [];
  for (let i = 0; i < roh.length; i++) {
    const vorher = i === 0 ? start : roh[i - 1];
    const nachher = roh[i + 1];
    if (nachher === undefined) break;
    const richtungA = roh[i] - vorher;
    const richtungB = nachher - roh[i];
    if (richtungA !== richtungB) weg.push(zelleZuPunkt(roh[i]));
  }
  weg.push({ x: zuX, y: zuY });
  return weg;
}

// Ziele für die KI-Mitspieler: Raummittelpunkte plus alle Aufgabenstationen. Die Bots laufen
// die Punkte über findeWeg an, damit sie sich wie Mitspielende durch die Flure bewegen.
const BOT_WEGPUNKTE = RAEUME.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }))
  .concat(STATIONEN.map(st => ({ x: st.x, y: st.y })));

// ============================================================
// Sichtlinien
// ============================================================
//
// Bis 2026-07-26 war die Sicht ein reiner Abstand: wer nah genug stand, war zu sehen — auch
// quer durch eine Wand. Jetzt blockiert jede Wand den Blick, und der Sichtbereich hat die
// Form des Raums statt eines Kreises.
//
// Die Sicht darf NICHT über istBegehbar laufen. Das prüft zusätzlich den Spielerradius und
// verengt damit jede Türöffnung um 32 px — man sähe durch eine Tür schmaler, als man
// hindurchpasst, und an Türnähten entstünden Sichtschatten, wo keine Wand ist. Für Licht
// zählt allein, ob der Punkt überhaupt in einer Fläche liegt.
//
// Warum ein eigenes, feineres Raster: das Sichtpolygon schickt pro Bild einige hundert
// Strahlen mit je dutzenden Abtastpunkten los. Jeden davon gegen alle ~90 Rechtecke zu prüfen
// wären Millionen Vergleiche pro Bild — ein Array-Zugriff kostet dagegen nichts. Das
// Wegfindungsraster (25 px) ist dafür zu grob: eine Türöffnung wäre darin drei Zellen breit.
const SICHT_RASTER = 8;
const SICHT_SCHRITT = 6;         // Abtastweite entlang eines Strahls
const SICHT_WANDZUSCHLAG = 20;   // so weit reicht der Blick in die getroffene Wand hinein
const SICHT_STRAHLEN = 240;      // Auflösung des Sichtpolygons rundum

const sichtSpalten = Math.ceil(WELT_BREITE / SICHT_RASTER);
const sichtZeilen = Math.ceil(WELT_HOEHE / SICHT_RASTER);
const sichtFrei = new Uint8Array(sichtSpalten * sichtZeilen);

// Aufgebaut wird über die Flächen, nicht über die Zellen: sonst müsste jede der ~43000 Zellen
// gegen jedes Rechteck geprüft werden. Eine Zelle gilt als frei, wenn ihr MITTELPUNKT in einer
// Fläche liegt — dieselbe Regel wie bei punktInFlaeche, nur vorberechnet.
ALLE_FLAECHEN.forEach(f => {
  const vonSpalte = Math.max(Math.ceil((f.x - SICHT_RASTER / 2) / SICHT_RASTER), 0);
  const bisSpalte = Math.min(Math.floor((f.x + f.w - SICHT_RASTER / 2) / SICHT_RASTER), sichtSpalten - 1);
  const vonZeile = Math.max(Math.ceil((f.y - SICHT_RASTER / 2) / SICHT_RASTER), 0);
  const bisZeile = Math.min(Math.floor((f.y + f.h - SICHT_RASTER / 2) / SICHT_RASTER), sichtZeilen - 1);
  for (let z = vonZeile; z <= bisZeile; z++) {
    for (let s = vonSpalte; s <= bisSpalte; s++) sichtFrei[z * sichtSpalten + s] = 1;
  }
});

function sichtFreiAn(x, y) {
  if (x < 0 || y < 0 || x >= WELT_BREITE || y >= WELT_HOEHE) return false;
  return sichtFrei[((y / SICHT_RASTER) | 0) * sichtSpalten + ((x / SICHT_RASTER) | 0)] === 1;
}

// Wie weit trägt der Blick in diese Richtung? Der Rückgabewert reicht bewusst ein Stück in die
// getroffene Wand hinein: endete er exakt an der Wandkante, bliebe genau die Wand unbeleuchtet,
// an der man steht, und die Räume hätten keine sichtbaren Kanten mehr. Der Zuschlag liegt
// unter der Wandstärke von 35 px — hindurchsehen kann man dadurch nicht.
function sichtDistanz(x, y, dx, dy, maxDist) {
  for (let d = SICHT_SCHRITT; d <= maxDist; d += SICHT_SCHRITT) {
    if (!sichtFreiAn(x + dx * d, y + dy * d)) {
      // Den Grobtreffer nachschärfen. Ohne das hängt die Reichweite davon ab, wo zufällig ein
      // Abtastpunkt lag: zwei benachbarte Strahlen treffen dieselbe glatte Wand und kommen
      // trotzdem bis zu SICHT_SCHRITT unterschiedlich weit — der Lichtrand franst dann sichtbar
      // aus und flimmert beim Laufen. Vier Halbierungen bringen ihn auf unter einen halben Pixel.
      let frei = d - SICHT_SCHRITT;
      let belegt = d;
      for (let i = 0; i < 4; i++) {
        const mitte = (frei + belegt) / 2;
        if (sichtFreiAn(x + dx * mitte, y + dy * mitte)) frei = mitte; else belegt = mitte;
      }
      return Math.min(frei + SICHT_WANDZUSCHLAG, maxDist);
    }
  }
  return maxDist;
}

// Der Bereich, den man von (x,y) aus tatsächlich einsehen kann — samt der Schatten, die Wände
// und Türpfosten werfen. Rundum Strahlen schicken, Trefferpunkte verbinden.
function sichtPolygon(x, y, radius, strahlen) {
  const anzahl = strahlen || SICHT_STRAHLEN;
  const punkte = [];
  for (let i = 0; i < anzahl; i++) {
    const winkel = (i / anzahl) * Math.PI * 2;
    const dx = Math.cos(winkel);
    const dy = Math.sin(winkel);
    const d = sichtDistanz(x, y, dx, dy, radius);
    punkte.push({ x: x + dx * d, y: y + dy * d });
  }
  return punkte;
}

// Steht etwas zwischen den beiden Punkten? Start und Ziel selbst werden bewusst nicht geprüft:
// eine Figur darf dicht an einer Wand stehen, ohne sich damit selbst unsichtbar zu machen —
// ihr Mittelpunkt kann bei 16 px Radius durchaus auf einer Zelle liegen, die als belegt gilt.
function sichtlinieFrei(ax, ay, bx, by) {
  const strecke = Math.hypot(bx - ax, by - ay);
  if (strecke <= SICHT_SCHRITT) return true;
  const schritte = Math.ceil(strecke / SICHT_SCHRITT);
  for (let i = 1; i < schritte; i++) {
    const t = i / schritte;
    if (!sichtFreiAn(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

const karte = {
  WELT_BREITE, WELT_HOEHE,
  SPIELER_RADIUS, INTERAKTIONS_RADIUS, KILL_REICHWEITE, TUNNEL_RADIUS,
  SICHT_TEAM, SICHT_MAULWURF, SICHT_TEAM_DUNKEL, SICHT_GEIST, SICHT_STRAHLEN,
  SICHT_VERSTECKEN_TEAM, SICHT_VERSTECKEN_FAENGER,
  RAEUME, KORRIDORE, TUEREN, TUNNEL, STATIONEN, GEBAEUDE,
  NOTFALLKNOPF, SICHERUNGSKASTEN, KUEHLUNG_A, KUEHLUNG_B, KAMERAPULT, FUNKPULT,
  KAMERAS, imKamerabild,
  BOT_WEGPUNKTE,
  startPositionen, istBegehbar, bewegeMitKollision, raumAn, raumName,
  abstand, tunnelAn, stationAn, stationNachId, findeWeg,
  sichtFreiAn, sichtPolygon, sichtlinieFrei, punktInFlaeche
};

if (typeof module !== "undefined" && module.exports) module.exports = karte;
