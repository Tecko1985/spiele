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

const WELT_BREITE = 2000;
const WELT_HOEHE = 1370;

const SPIELER_RADIUS = 16;
const INTERAKTIONS_RADIUS = 58;
const KILL_REICHWEITE = 74;
const TUNNEL_RADIUS = 46;

// Sichtweiten in Weltkoordinaten. Maulwürfe sehen etwas weiter, bei ausgefallenem Flutlicht
// schrumpft der Radius fürs Team drastisch (Maulwürfe behalten ihre volle Sicht — das ist
// der eigentliche Sinn dieser Sabotage).
const SICHT_TEAM = 265;
const SICHT_MAULWURF = 330;
const SICHT_TEAM_DUNKEL = 95;
const SICHT_GEIST = 99999;

// Raster des Layouts. Spalten A–E und Zeilen 1–4 sind 250 x 200 groß, dazwischen liegen
// 80 px breite Gänge mit je 35 px Wand zu den Räumen.
const RAEUME = [
  // Zeile 1
  { id: "heimkabine",   name: "Heimkabine",       x: 75,   y: 60,   w: 250,  h: 200 },
  { id: "gaestekabine", name: "Gästekabine",      x: 475,  y: 60,   w: 250,  h: 200 },
  { id: "waschkueche",  name: "Waschküche",       x: 875,  y: 60,   w: 250,  h: 200 },
  { id: "physio",       name: "Physioraum",       x: 1275, y: 60,   w: 250,  h: 200 },
  { id: "kueche",       name: "Vereinsküche",     x: 1675, y: 60,   w: 250,  h: 200 },
  // Zeile 2
  { id: "geraeteraum",  name: "Geräteraum",       x: 75,   y: 410,  w: 250,  h: 200 },
  { id: "buero",        name: "Trainerbüro",      x: 475,  y: 410,  w: 250,  h: 200 },
  { id: "vereinsheim",  name: "Vereinsheim",      x: 875,  y: 410,  w: 250,  h: 200 },
  { id: "sanitaer",     name: "Sanitärbereich",   x: 1275, y: 410,  w: 250,  h: 200 },
  { id: "vorstand",     name: "Vorstandszimmer",  x: 1675, y: 410,  w: 250,  h: 200 },
  // Zeile 3
  { id: "keller",       name: "Materialkeller",   x: 75,   y: 760,  w: 250,  h: 200 },
  { id: "werkstatt",    name: "Werkstatt",        x: 475,  y: 760,  w: 250,  h: 200 },
  { id: "technik",      name: "Technikraum",      x: 875,  y: 760,  w: 250,  h: 200 },
  { id: "schiri",       name: "Schiedsrichter",   x: 1275, y: 760,  w: 250,  h: 200 },
  { id: "tribuene",     name: "Tribüne",          x: 1675, y: 760,  w: 250,  h: 200 },
  // Zeile 4: der Platz zieht sich über die ganze Breite
  { id: "rasen",        name: "Rasenplatz",       x: 75,   y: 1110, w: 1850, h: 200 }
];

// Drei durchgehende Quergänge und vier Längsgänge. Die Längsgänge enden am untersten
// Quergang — der Rasenplatz hängt über eigene Türen daran und wird nicht durchschnitten.
const KORRIDORE = [
  { id: "flur-1", x: 75,   y: 295, w: 1850, h: 80 },
  { id: "flur-2", x: 75,   y: 645, w: 1850, h: 80 },
  { id: "flur-3", x: 75,   y: 995, w: 1850, h: 80 },
  { id: "gang-1", x: 360,  y: 60,  w: 80,   h: 1015 },
  { id: "gang-2", x: 760,  y: 60,  w: 80,   h: 1015 },
  { id: "gang-3", x: 1160, y: 60,  w: 80,   h: 1015 },
  { id: "gang-4", x: 1560, y: 60,  w: 80,   h: 1015 }
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

// Jeder Raum hat zwei Türen (das Vereinsheim als Treffpunkt vier, der Rasenplatz drei),
// bewusst versetzt statt symmetrisch — so gibt es kurze und lange Wege zum selben Ziel.
const TUEREN = [
  // Zeile 1: je nach unten in Flur 1 plus eine Seitentür in einen Längsgang
  tuer(200, 260, "v"),  tuer(325, 160, "h"),   // Heimkabine
  tuer(600, 260, "v"),  tuer(475, 160, "h"),   // Gästekabine
  tuer(1000, 260, "v"), tuer(1125, 160, "h"),  // Waschküche
  tuer(1400, 260, "v"), tuer(1275, 160, "h"),  // Physioraum
  tuer(1800, 260, "v"), tuer(1675, 160, "h"),  // Vereinsküche
  // Zeile 2
  tuer(200, 410, "v"),  tuer(325, 510, "h"),   // Geräteraum
  tuer(600, 410, "v"),  tuer(600, 610, "v"),   // Trainerbüro
  tuer(1000, 410, "v"), tuer(1000, 610, "v"),  // Vereinsheim …
  tuer(875, 510, "h"),  tuer(1125, 510, "h"),  // … mit zwei zusätzlichen Seitentüren
  tuer(1400, 410, "v"), tuer(1525, 510, "h"),  // Sanitärbereich
  tuer(1800, 410, "v"), tuer(1675, 510, "h"),  // Vorstandszimmer
  // Zeile 3
  tuer(200, 760, "v"),  tuer(325, 860, "h"),   // Materialkeller
  tuer(600, 760, "v"),  tuer(600, 960, "v"),   // Werkstatt
  tuer(1000, 760, "v"), tuer(875, 860, "h"),   // Technikraum
  tuer(1400, 760, "v"), tuer(1525, 860, "h"),  // Schiedsrichterkabine
  tuer(1800, 760, "v"), tuer(1800, 960, "v"),  // Tribüne
  // Rasenplatz
  tuer(300, 1110, "v"), tuer(1000, 1110, "v"), tuer(1700, 1110, "v")
];

// Abkürzungen: nur Maulwürfe dürfen sie benutzen. Jeder Eintrag verbindet genau zwei Punkte;
// wer auf dem einen steht, landet per Tap auf dem anderen. Alle Enden liegen in Räumen, nie
// in einem Gang — sonst könnte man mitten im Flur vor jemandem auftauchen.
const TUNNEL = [
  { id: "waescheschacht", name: "Wäscheschacht",  a: { x: 1080, y: 110 },  b: { x: 120,  y: 910 } },
  { id: "kabelkanal",     name: "Kabelkanal",     a: { x: 1080, y: 910 },  b: { x: 1880, y: 460 } },
  { id: "getraenkelift",  name: "Getränkeaufzug", a: { x: 1880, y: 110 },  b: { x: 1860, y: 1260 } },
  { id: "regenrinne",     name: "Regenrinne",     a: { x: 120,  y: 110 },  b: { x: 1720, y: 910 } }
];

// Aufgabenstationen. 25 Typen à zwei Standorte in unterschiedlichen Räumen, damit sich nicht
// alle am selben Ort drängeln. Angegeben wird die Lage relativ zum Raum (0..1), umgerechnet
// wird beim Laden — so bleibt die Tabelle lesbar und übersteht Layoutänderungen.
const STATIONS_TABELLE = [
  ["heimkabine",   ["trikots", "stollen", "spind"]],
  ["gaestekabine", ["waesche", "schluessel", "pfeife"]],
  ["waschkueche",  ["waschgang", "kisten", "netz"]],
  ["physio",       ["verbandskasten", "tabelle", "anpfiff"]],
  ["kueche",       ["kaffee", "getraenke", "muell"]],
  ["geraeteraum",  ["baelle", "inventur", "eckfahnen"]],
  ["buero",        ["tabelle", "wappen", "zaehler"]],
  ["vereinsheim",  ["getraenke", "kaffee", "anpfiff"]],
  ["sanitaer",     ["waschgang", "muell", "waesche"]],
  ["vorstand",     ["wappen", "schluessel", "spind"]],
  ["keller",       ["kisten", "inventur", "stollen"]],
  ["werkstatt",    ["kabel", "linien", "netz"]],
  ["technik",      ["kabel", "zaehler", "fahne"]],
  ["schiri",       ["pfeife", "verbandskasten", "trikots"]],
  ["tribuene",     ["fahne", "elfmeterpunkt", "eckfahnen"]],
  ["rasen",        ["maehen", "linien", "elfmeterpunkt", "maehen", "baelle"]]
];

// Verteilmuster innerhalb eines Raums, damit die Marker nicht übereinanderliegen.
const STATIONS_RASTER = {
  3: [[0.20, 0.30], [0.50, 0.72], [0.80, 0.30]],
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
const NOTFALLKNOPF = { x: 1000, y: 470, raum: "vereinsheim" };
const SICHERUNGSKASTEN = { x: 1000, y: 930, raum: "technik" };
const HEIZUNG_A = { x: 200, y: 820, raum: "keller" };
const HEIZUNG_B = { x: 1800, y: 110, raum: "kueche" };

// Startpositionen: alle starten im Vereinsheim, kreisförmig verteilt (max. 10 Plätze).
function startPositionen(anzahl) {
  const punkte = [];
  const mitte = { x: 1000, y: 530 };
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
  RAEUME, KORRIDORE, TUEREN, TUNNEL, STATIONEN, GEBAEUDE,
  NOTFALLKNOPF, SICHERUNGSKASTEN, HEIZUNG_A, HEIZUNG_B,
  BOT_WEGPUNKTE,
  startPositionen, istBegehbar, bewegeMitKollision, raumAn, raumName,
  abstand, tunnelAn, stationAn, stationNachId, findeWeg,
  sichtFreiAn, sichtPolygon, sichtlinieFrei, punktInFlaeche
};

if (typeof module !== "undefined" && module.exports) module.exports = karte;
