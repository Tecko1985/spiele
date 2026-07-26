// Feste Karte des Vereinsgeländes: reine Daten + Geometrie-Hilfsfunktionen, kein Firebase,
// kein DOM. Alles hier ist deterministisch und auf allen Geräten identisch — die Karte wird
// NICHT über Firebase verteilt, sondern liegt als Konstante in jedem Client.
//
// Layout-Prinzip: Räume und Korridore sind achsenparallele Rechtecke. Begehbar ist alles,
// was in mindestens einem Rechteck liegt (siehe istBegehbar). Die Korridore ragen bewusst
// ~10 px in die angrenzenden Räume hinein, damit es an den Übergängen keine Lücke gibt, an
// der die Figur hängen bleibt.
//
// Weltkoordinaten: 0..WELT_BREITE / 0..WELT_HOEHE. Der Canvas-Renderer in app.js skaliert
// das auf die Bildschirmgröße, hier stehen keine Pixel-Annahmen über das Endgerät.

const WELT_BREITE = 1370;
const WELT_HOEHE = 820;

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

const RAEUME = [
  { id: "kabine",      name: "Kabine",         x: 60,   y: 40,  w: 260, h: 200 },
  { id: "waschkueche", name: "Waschküche",     x: 390,  y: 40,  w: 260, h: 200 },
  { id: "kueche",      name: "Küche",          x: 720,  y: 40,  w: 260, h: 200 },
  { id: "tribuene",    name: "Tribüne",        x: 1050, y: 40,  w: 260, h: 470 },
  { id: "geraeteraum", name: "Geräteraum",     x: 60,   y: 310, w: 260, h: 200 },
  { id: "vereinsheim", name: "Vereinsheim",    x: 390,  y: 310, w: 260, h: 200 },
  { id: "buero",       name: "Trainerbüro",    x: 720,  y: 310, w: 260, h: 200 },
  { id: "keller",      name: "Materialkeller", x: 60,   y: 580, w: 260, h: 200 },
  { id: "werkstatt",   name: "Werkstatt",      x: 390,  y: 580, w: 260, h: 200 },
  { id: "rasen",       name: "Rasenplatz",     x: 720,  y: 580, w: 590, h: 200 }
];

const KORRIDORE = [
  { id: "flur-oben",   x: 60,  y: 230, w: 990,  h: 90 },
  { id: "flur-unten",  x: 60,  y: 500, w: 1250, h: 90 },
  { id: "gang-links",  x: 310, y: 40,  w: 90,   h: 740 },
  { id: "gang-mitte",  x: 640, y: 40,  w: 90,   h: 740 },
  { id: "gang-rechts", x: 970, y: 40,  w: 90,   h: 470 }
];

// Abkürzungen: nur Maulwürfe dürfen sie benutzen. Jeder Eintrag verbindet genau zwei Punkte;
// wer auf dem einen steht, landet per Tap auf dem anderen.
const TUNNEL = [
  { id: "waescheschacht", name: "Wäscheschacht",  a: { x: 610, y: 200 }, b: { x: 110, y: 740 } },
  { id: "kabelkanal",     name: "Kabelkanal",     a: { x: 610, y: 740 }, b: { x: 110, y: 470 } },
  { id: "getraenkelift",  name: "Getränkeaufzug", a: { x: 940, y: 80 },  b: { x: 1270, y: 740 } }
];

// Aufgabenstationen. Jeder Typ kommt zweimal vor, damit sich nicht alle im selben Raum
// drängeln. Die Zuteilung an die einzelnen Spieler:innen passiert zufällig in game-service.js.
const STATIONEN = [
  { id: "st-trikot-kabine",    typ: "trikots",    raum: "kabine",      x: 130, y: 100, name: "Trikots sortieren" },
  { id: "st-trikot-wasch",     typ: "trikots",    raum: "waschkueche", x: 450, y: 100, name: "Trikots sortieren" },
  { id: "st-baelle-geraete",   typ: "baelle",     raum: "geraeteraum", x: 130, y: 370, name: "Bälle aufpumpen" },
  { id: "st-baelle-keller",    typ: "baelle",     raum: "keller",      x: 250, y: 640, name: "Bälle aufpumpen" },
  { id: "st-fahnen-rasen",     typ: "eckfahnen",  raum: "rasen",       x: 800, y: 640, name: "Eckfahnen stecken" },
  { id: "st-fahnen-tribuene",  typ: "eckfahnen",  raum: "tribuene",    x: 1120, y: 120, name: "Eckfahnen stecken" },
  { id: "st-kisten-kueche",    typ: "kisten",     raum: "kueche",      x: 790, y: 190, name: "Kisten stapeln" },
  { id: "st-kisten-heim",      typ: "kisten",     raum: "vereinsheim", x: 590, y: 460, name: "Kisten stapeln" },
  { id: "st-linien-rasen",     typ: "linien",     raum: "rasen",       x: 1180, y: 720, name: "Linien nachziehen" },
  { id: "st-linien-werkstatt", typ: "linien",     raum: "werkstatt",   x: 600, y: 730, name: "Linien nachziehen" },
  { id: "st-memory-buero",     typ: "schluessel", raum: "buero",       x: 790, y: 370, name: "Schlüssel finden" },
  { id: "st-memory-kabine",    typ: "schluessel", raum: "kabine",      x: 280, y: 200, name: "Schlüssel finden" }
];

// Feste Sonderpunkte: Notfallknopf und die Reparaturstellen der Sabotagen.
const NOTFALLKNOPF = { x: 450, y: 400, raum: "vereinsheim" };
const SICHERUNGSKASTEN = { x: 440, y: 640, raum: "werkstatt" };
const HEIZUNG_A = { x: 110, y: 620, raum: "keller" };
const HEIZUNG_B = { x: 930, y: 90, raum: "kueche" };

// Startpositionen: alle starten im Vereinsheim, kreisförmig verteilt (max. 10 Plätze).
function startPositionen(anzahl) {
  const punkte = [];
  const mitte = { x: 520, y: 410 };
  for (let i = 0; i < anzahl; i++) {
    const winkel = (i / Math.max(anzahl, 1)) * Math.PI * 2;
    punkte.push({
      x: Math.round(mitte.x + Math.cos(winkel) * 75),
      y: Math.round(mitte.y + Math.sin(winkel) * 62)
    });
  }
  return punkte;
}

function inRechteck(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

const ALLE_FLAECHEN = RAEUME.concat(KORRIDORE);

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
// jedem Raum-Korridor-Übergang erfüllt kein einzelnes Rechteck den Radiusabstand, weil sich
// die Flächen dort nur um wenige Pixel überlappen. Mit der Einzelrechteck-Prüfung entstand
// genau dort eine unpassierbare Lücke — die Karte zerfiel in unerreichbare Inseln (gefunden
// beim Flood-Fill-Test, 2026-07-26). Die Vereinigungsprüfung lässt Übergänge passieren und
// hält die Figur trotzdem zuverlässig aus den Außenwänden.
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

// Für die Raumanzeige: nur echte Räume zählen (Korridore absichtlich nicht), damit die
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

// Wegpunkte für die KI-Mitspieler: die Raummittelpunkte. Die Bots laufen stumpf von einem
// zum nächsten (siehe game-service.js) — bewusst keine Wegfindung, das reicht fürs Üben und
// hält den Code klein.
const BOT_WEGPUNKTE = RAEUME.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));

const karte = {
  WELT_BREITE, WELT_HOEHE,
  SPIELER_RADIUS, INTERAKTIONS_RADIUS, KILL_REICHWEITE, TUNNEL_RADIUS,
  SICHT_TEAM, SICHT_MAULWURF, SICHT_TEAM_DUNKEL, SICHT_GEIST,
  RAEUME, KORRIDORE, TUNNEL, STATIONEN,
  NOTFALLKNOPF, SICHERUNGSKASTEN, HEIZUNG_A, HEIZUNG_B,
  BOT_WEGPUNKTE,
  startPositionen, istBegehbar, bewegeMitKollision, raumAn, raumName,
  abstand, tunnelAn, stationAn, stationNachId
};
