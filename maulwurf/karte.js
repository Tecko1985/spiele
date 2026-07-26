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

// Sichtweiten in Weltkoordinaten. Maulwürfe sehen etwas weiter, bei ausgefallenem Flutlicht
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
// Die beiden Sackgassen sind Absicht und der wichtigste Teil der Vorlage:
// **Sicherheitsraum und Sanitätsraum haben je nur EINEN Eingang.** Wer dort hineingeht, kommt
// nur auf demselben Weg wieder heraus — deshalb ist es dort so gefährlich und deshalb ist
// "wer war mit dir drin?" eine harte Frage. Beim Ändern des Layouts nicht versehentlich eine
// zweite Tür spendieren.
//
// Der Aufenthaltsraum ist das Drehkreuz: von dort führen vier Wege weg. Wer ihn verlässt,
// wird gesehen — das macht ihn zum sicheren Ort und zum Ausgangspunkt jeder Diskussion.
const RAEUME = [
  // obere Reihe
  { id: "upper-engine", name: "Maschinenraum Nord", x: 190,  y: 90,   w: 330, h: 310 },
  { id: "cafeteria",    name: "Aufenthaltsraum",    x: 1030, y: 90,   w: 620, h: 310 },
  { id: "weapons",      name: "Torschusswand",      x: 2020, y: 90,   w: 330, h: 310 },
  // mittlere Reihe
  { id: "reactor",      name: "Heizungskeller",     x: 60,   y: 540,  w: 240, h: 310 },
  { id: "security",     name: "Hausmeisterloge",    x: 600,  y: 540,  w: 200, h: 310 },
  { id: "medbay",       name: "Sanitätsraum",       x: 1000, y: 540,  w: 300, h: 310 },
  { id: "admin",        name: "Geschäftsstelle",    x: 1560, y: 540,  w: 300, h: 310 },
  { id: "o2",           name: "Grünpflege",         x: 1900, y: 540,  w: 240, h: 310 },
  { id: "navigation",   name: "Trainerbüro",        x: 2300, y: 540,  w: 260, h: 310 },
  // untere Reihe
  { id: "lower-engine", name: "Maschinenraum Süd",  x: 190,  y: 990,  w: 330, h: 310 },
  { id: "electrical",   name: "Technikraum",        x: 640,  y: 990,  w: 320, h: 310 },
  { id: "storage",      name: "Lagerraum",          x: 1080, y: 990,  w: 420, h: 310 },
  { id: "comms",        name: "Sprecherkabine",     x: 1560, y: 990,  w: 320, h: 310 },
  { id: "shields",      name: "Flutlichtwarte",     x: 2060, y: 990,  w: 320, h: 310 }
];

// Das Flurnetz. Waagerechte Verbindungsstücke oben und rechts, drei durchgehende Längsgänge
// und ein breiter unterer Quergang — zusammen ergibt das den Rundlauf des Originals: man kann
// im Kreis laufen, ohne je umzudrehen. Ohne diesen Rundlauf wäre jede Verfolgung eine
// Sackgasse und "ich bin ihm ausgewichen" keine glaubhafte Aussage mehr.
const KORRIDORE = [
  // oben: Maschinenraum Nord — Aufenthaltsraum — Torschusswand
  { id: "flur-o1", x: 555,  y: 205,  w: 440,  h: 80 },
  { id: "flur-o2", x: 1685, y: 205,  w: 300,  h: 80 },
  // linker Längsgang: Maschinenraum Nord ↔ Süd, mit Abzweig zum Heizungskeller
  { id: "gang-l",  x: 340,  y: 435,  w: 80,   h: 520 },
  { id: "flur-rk", x: 455,  y: 655,  w: 110,  h: 80 },   // Abzweig zur Hausmeisterloge
  // mittlerer Längsgang: oberer Flur ↔ Technikraum. Kreuzt flur-o1 — die beiden überlappen
  // bewusst, das ergibt die T-Kreuzung ohne eigene Tür.
  { id: "gang-m",  x: 880,  y: 205,  w: 80,   h: 750 },
  // Zugang zum Sanitätsraum — der EINZIGE, siehe Kommentar oben
  { id: "flur-md", x: 1100, y: 435,  w: 80,   h: 70 },
  // Aufenthaltsraum nach unten in den Lagerraum, östlich am Sanitätsraum vorbei
  { id: "gang-c",  x: 1400, y: 435,  w: 80,   h: 520 },
  // Aufenthaltsraum ↔ Geschäftsstelle ↔ Sprecherkabine
  { id: "gang-a",  x: 1560, y: 435,  w: 80,   h: 70 },
  { id: "gang-ac", x: 1660, y: 885,  w: 80,   h: 70 },
  // rechter Längsgang: Torschusswand ↕ Grünpflege ↕ Trainerbüro ↕ Flutlichtwarte
  { id: "gang-r",  x: 2180, y: 435,  w: 80,   h: 520 },
  // unterer Quergang: der lange Rückweg unter allem hindurch
  { id: "flur-u",  x: 300,  y: 1335, w: 1955, h: 80 }
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
// Raum eine Falle ist. Hausmeisterloge und Sanitätsraum haben je genau eine; Heizungskeller,
// Grünpflege und Trainerbüro haben zwei zum selben Gang (wie im Original: zwei Türen, aber nur
// ein Fluchtweg-System).
const TUEREN = [
  // oberer Flur
  tuer(537, 245, "h"),   // Maschinenraum Nord ↔ flur-o1
  tuer(1012, 245, "h"),  // flur-o1 ↔ Aufenthaltsraum
  tuer(1667, 245, "h"),  // Aufenthaltsraum ↔ flur-o2
  tuer(2002, 245, "h"),  // flur-o2 ↔ Torschusswand
  // linker Längsgang
  tuer(380, 417, "v"),   // Maschinenraum Nord ↓ gang-l
  tuer(380, 972, "v"),   // gang-l ↓ Maschinenraum Süd
  tuer(320, 620, "h"),   // Heizungskeller ↔ gang-l (obere Tür)
  tuer(320, 790, "h"),   // Heizungskeller ↔ gang-l (untere Tür)
  tuer(437, 695, "h"),   // gang-l ↔ flur-rk
  tuer(582, 695, "h"),   // flur-rk ↔ Hausmeisterloge — die EINZIGE Tür dieses Raums
  // mittlerer Längsgang
  tuer(920, 972, "v"),   // gang-m ↓ Technikraum
  // Sanitätsraum: der einzige Zugang, über einen Stichflur aus dem Aufenthaltsraum
  tuer(1140, 417, "v"),  // Aufenthaltsraum ↓ flur-md
  tuer(1140, 522, "v"),  // flur-md ↓ Sanitätsraum
  // Aufenthaltsraum nach unten
  tuer(1440, 417, "v"),  // Aufenthaltsraum ↓ gang-c
  tuer(1440, 972, "v"),  // gang-c ↓ Lagerraum
  tuer(1600, 417, "v"),  // Aufenthaltsraum ↓ gang-a
  tuer(1600, 522, "v"),  // gang-a ↓ Geschäftsstelle
  tuer(1700, 867, "v"),  // Geschäftsstelle ↓ gang-ac
  tuer(1700, 972, "v"),  // gang-ac ↓ Sprecherkabine
  // rechter Längsgang
  tuer(2220, 417, "v"),  // Torschusswand ↓ gang-r
  tuer(2160, 620, "h"),  // Grünpflege ↔ gang-r (obere Tür)
  tuer(2160, 790, "h"),  // Grünpflege ↔ gang-r (untere Tür)
  tuer(2280, 620, "h"),  // gang-r ↔ Trainerbüro (obere Tür)
  tuer(2280, 790, "h"),  // gang-r ↔ Trainerbüro (untere Tür)
  tuer(2220, 972, "v"),  // gang-r ↓ Flutlichtwarte
  // unterer Quergang
  tuer(380, 1317, "v"),  // Maschinenraum Süd ↓ flur-u
  tuer(800, 1317, "v"),  // Technikraum ↓ flur-u
  tuer(1180, 1317, "v"), // Lagerraum ↓ flur-u (linke Tür)
  tuer(1400, 1317, "v"), // Lagerraum ↓ flur-u (rechte Tür)
  tuer(1720, 1317, "v"), // Sprecherkabine ↓ flur-u
  tuer(2220, 1317, "v")  // Flutlichtwarte ↓ flur-u
];

// Abkürzungen: nur Maulwürfe dürfen sie benutzen. Jeder Eintrag verbindet genau zwei Punkte;
// wer auf dem einen steht, landet per Tap auf dem anderen. Alle Enden liegen in Räumen, nie
// in einem Gang — sonst könnte man mitten im Flur vor jemandem auftauchen.
//
// Nachgebaut nach den Lüftungsschächten des Originals. Wo dort drei Räume an einem Netz
// hängen (Sanitätsraum – Technikraum – Hausmeisterloge), sind es hier zwei Paare über den
// Technikraum: unsere Schächte verbinden immer genau zwei Enden. Räume mit zwei Enden
// (Heizungskeller, Technikraum, Trainerbüro) haben sie weit genug auseinander, damit
// tunnelAn() eindeutig bleibt.
const TUNNEL = [
  { id: "heizrohr-nord", name: "Heizrohr Nord",   a: { x: 280,  y: 180 },  b: { x: 130,  y: 620 } },
  { id: "heizrohr-sued", name: "Heizrohr Süd",    a: { x: 280,  y: 1210 }, b: { x: 130,  y: 790 } },
  { id: "waescheschacht", name: "Wäscheschacht",  a: { x: 1060, y: 800 },  b: { x: 700,  y: 1060 } },
  { id: "kabelkanal",    name: "Kabelkanal",      a: { x: 660,  y: 800 },  b: { x: 900,  y: 1060 } },
  { id: "aktenaufzug",   name: "Aktenaufzug",     a: { x: 1090, y: 150 },  b: { x: 1620, y: 800 } },
  { id: "ballnetz",      name: "Ballnetz",        a: { x: 2300, y: 150 },  b: { x: 2510, y: 600 } },
  { id: "kabelrinne",    name: "Kabelrinne",      a: { x: 2350, y: 800 },  b: { x: 2340, y: 1060 } }
];

// Aufgabenstationen. 25 Typen à zwei Standorte in unterschiedlichen Räumen, damit sich nicht
// alle am selben Ort drängeln. Angegeben wird die Lage relativ zum Raum (0..1), umgerechnet
// wird beim Laden — so bleibt die Tabelle lesbar und übersteht Layoutänderungen.
const STATIONS_TABELLE = [
  ["cafeteria",    ["getraenke", "kaffee", "anpfiff", "muell", "tabelle"]],
  ["upper-engine", ["kabel", "inventur", "zaehler", "kisten"]],
  ["weapons",      ["baelle", "elfmeterpunkt", "netz", "fahne"]],
  ["reactor",      ["kabel", "zaehler", "spind"]],
  ["security",     ["schluessel", "wappen", "pfeife"]],
  ["medbay",       ["verbandskasten", "waesche", "trikots", "stollen"]],
  ["admin",        ["tabelle", "wappen", "schluessel"]],
  ["o2",           ["maehen", "linien", "eckfahnen"]],
  ["navigation",   ["anpfiff", "pfeife", "elfmeterpunkt"]],
  ["lower-engine", ["inventur", "kisten", "stollen", "waschgang"]],
  ["electrical",   ["linien", "fahne", "netz", "muell"]],
  ["storage",      ["baelle", "trikots", "waschgang", "eckfahnen"]],
  ["comms",        ["verbandskasten", "kaffee", "getraenke"]],
  ["shields",      ["maehen", "waesche", "spind"]]
];

// Verteilmuster innerhalb eines Raums, damit die Marker nicht übereinanderliegen.
const STATIONS_RASTER = {
  3: [[0.20, 0.30], [0.50, 0.72], [0.80, 0.30]],
  4: [[0.18, 0.32], [0.40, 0.70], [0.62, 0.32], [0.84, 0.70]],
  5: [[0.08, 0.35], [0.28, 0.70], [0.50, 0.30], [0.72, 0.70], [0.92, 0.35]]
};

const STATIONEN = [];
STATIONS_TABELLE.forEach(([raumId, typen]) => {
  const raum = RAEUME.find(r => r.id === raumId);
  const raster = STATIONS_RASTER[typen.length];
  typen.forEach((typ, i) => {
    STATIONEN.push({
      id: `st-${typ}-${raumId}-${i}`,
      typ,
      raum: raumId,
      x: Math.round(raum.x + raster[i][0] * raum.w),
      y: Math.round(raum.y + raster[i][1] * raum.h)
    });
  });
});

// Feste Sonderpunkte: Notfallknopf und die Reparaturstellen der Sabotagen. Die beiden
// Heizungsventile liegen bewusst in gegenüberliegenden Ecken des Geländes — sie müssen
// gleichzeitig gehalten werden, das soll zwei Leute kosten.
// Wie im Original: der Notfallknopf steht mitten im Aufenthaltsraum, der Sicherungskasten im
// Technikraum. Die beiden Heizungsventile liegen in Heizungskeller und Grünpflege — die
// gegenüberliegenden Enden der Karte, was genau der Punkt dieser Sabotage ist.
//
// **Alle Sonderpunkte müssen deutlich mehr als INTERAKTIONS_RADIUS von jeder Aufgabenstation
// entfernt liegen.** ermittleAktion() gibt nur EINE Aktion zurück; überlappen die Radien, gibt
// es Standpunkte, von denen aus die jeweils zweite unerreichbar ist. Deshalb sitzen sie
// bewusst in Raumecken statt in der Mitte — der Kartentest misst die verbleibende
// Überlappungszone und lässt höchstens ein paar Pixel durch.
const NOTFALLKNOPF = { x: 1340, y: 300, raum: "cafeteria" };
const SICHERUNGSKASTEN = { x: 660, y: 1270, raum: "electrical" };
const HEIZUNG_A = { x: 100, y: 830, raum: "reactor" };
const HEIZUNG_B = { x: 1940, y: 830, raum: "o2" };
// Das Kamerapult gibt der Hausmeisterloge ihren Zweck — bis dahin war sie reines Risiko ohne
// Gegenwert (eine Tür, drei Stationen, sonst nichts). Das Funkpult ist der Reparaturplatz der
// vierten Sabotage und füllt die Sprecherkabine.
const KAMERAPULT = { x: 630, y: 830, raum: "security" };
const FUNKPULT = { x: 1590, y: 1280, raum: "comms" };

// Die vier festen Kamerabereiche. Bewusst überwiegend GÄNGE statt Räume: Kameras sollen
// verraten, wer wohin unterwegs ist, nicht was jemand in einem Raum tut — sonst wären
// Aufgaben und Alibis wertlos. Der Aufenthaltsraum ist die Ausnahme, weil dort ohnehin
// ständig alle durchlaufen.
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
  { id: "kam-cafeteria", name: "Aufenthaltsraum", x: 1340, y: 245 },
  { id: "kam-nord",      name: "Nordflur",        x: 775,  y: 245 },
  { id: "kam-west",      name: "Westkreuzung",    x: 480,  y: 695 },
  { id: "kam-sued",      name: "Südgang",         x: 1280, y: 1375 }
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

// Startpositionen: alle starten im Aufenthaltsraum, kreisförmig verteilt (max. 10 Plätze).
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
function tunnelAn(x, y) {
  for (let i = 0; i < TUNNEL.length; i++) {
    const t = TUNNEL[i];
    if (abstand(x, y, t.a.x, t.a.y) <= TUNNEL_RADIUS) return { tunnel: t, ziel: t.b };
    if (abstand(x, y, t.b.x, t.b.y) <= TUNNEL_RADIUS) return { tunnel: t, ziel: t.a };
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
  NOTFALLKNOPF, SICHERUNGSKASTEN, HEIZUNG_A, HEIZUNG_B, KAMERAPULT, FUNKPULT,
  KAMERAS, imKamerabild,
  BOT_WEGPUNKTE,
  startPositionen, istBegehbar, bewegeMitKollision, raumAn, raumName,
  abstand, tunnelAn, stationAn, stationNachId, findeWeg,
  sichtFreiAn, sichtPolygon, sichtlinieFrei, punktInFlaeche
};

if (typeof module !== "undefined" && module.exports) module.exports = karte;
