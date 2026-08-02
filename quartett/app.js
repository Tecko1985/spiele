/* ============================================================================
   app.js — gemeinsame Oberfläche der drei Quartett-Spiele
   ----------------------------------------------------------------------------
   Wird von auto-quartett, fussball-quartett und fussball-vereine-quartett
   geladen. Was die Spiele unterscheidet, steht in ihrer eigenen
   `spiel-config.js` (Titel, Zeichen, Beschreibung) und ihrem eigenen
   `mock-data.js` (Kartendeck) — hier steht kein Wort, das nur für eines
   der drei gilt.

   Die gesamte Oberfläche wird gezeichnet, es gibt keine Bildschirme im
   Dokument mehr. Diese Datei hält den Zustand der Ansicht, malt Kopfzeile,
   Reiter, Karte und Dialoge und ruft für den jeweiligen Bildschirm die
   passende Funktion aus `bildschirme.js` auf.

   Ladereihenfolge (siehe index.html): ui → spiel-config → mock-data →
   game-service → bildschirme → **app zuletzt**, weil es die Oberfläche
   startet und dafür alles andere bereits braucht.

   Diese Datei redet NIE direkt mit mock-data.js, sondern ausschließlich über
   die gameService-API (siehe game-service.js) — einzige Ausnahme ist
   `getKategorien()` als Rückfallebene, solange die gemergten Kategorien noch
   nicht geladen sind.
============================================================================ */

/* Welcher Bildschirm gehört zu welcher Spielphase. Alles, was NICHT aus der
   Phase folgt (Bestenliste, Kartenverwaltung), steht in `ansicht.ueberlagert`
   und geht vor — sonst risse ein Firebase-Update die geöffnete
   Kartenverwaltung wieder weg. */
const BILDSCHIRM_FUER_PHASE = {
  start: "start",
  lobby: "lobby",
  amZug: "spiel",
  warteAufAndere: "spiel",
  vergleich: "vergleich",
  beendet: "endstand",
  abgebrochen: "abgebrochen"
};

const PHASEN_MIT_ABBRUCH = ["amZug", "warteAufAndere", "vergleich"];

const DECKGROESSE_LABEL = {
  klein: "5 Karten/Spieler:in",
  normal: "10 Karten/Spieler:in",
  gross: "Maximum aus dem Kartenpool"
};

/* Farben der Sammelkarten-Optik. Übernommen aus der abgelösten style.css,
   damit die gezeichnete Karte aussieht wie die bisherige. */
const KARTE_GOLD = "#c9941f";
const KARTE_VERLAUF = ["#ffffff", "#eef3fb", "#dbe6f7"];

/* Höhe einer Eigenschaftszeile. Sie ist die wichtigste Antippfläche des ganzen
   Spiels — wer am Zug ist, wählt hier seine Kategorie. Deshalb NICHT kleiner
   als `ui.TIPPZIEL` (44 px): darunter trifft man auf dem Handy im fahrenden
   Bus daneben. Ein erster Entwurf hatte 38 px, das fiel erst beim Nachmessen
   im Hochformat auf. */
const EIGENSCHAFT_HOEHE = 44;

/* --------------------------------------------------------------------------
   Zustand der Ansicht
   Alles, was nicht aus dem Spielzustand folgt: welcher Reiter offen ist,
   welcher Bildschirm die Phase überlagert, Fehlermeldungen, der gerade
   bearbeitete Kartensatz.
-------------------------------------------------------------------------- */
const ansicht = {
  reiter: "spiel",            // "spiel" | "info"
  ueberlagert: null,          // null | "name" | "bestenliste" | "verwaltung" | "bearbeiten" | "kriterien"
  fehler: "",                 // Meldung unter dem gerade offenen Formular
  modus: null,                // "erstellen" | "beitreten" — was nach der Namenseingabe passiert
  deckgroesse: "normal",
  beitrittsCode: "",
  grossansicht: null,         // Bildquelle der Foto-Großansicht
  frage: null,                // {text, ja, jaText, art} — ersetzt window.confirm
  bestenliste: null,          // null = noch nicht geladen
  bestenlisteFehler: "",
  verwaltungsKarten: null,
  verwaltungsFehler: "",
  suche: "",
  karte: null,                // die Karte, die gerade bearbeitet wird
  karteNeuesFoto: undefined,  // undefined = unverändert, sonst Daten-URL
  kriterien: null,            // Arbeitskopie beim Bearbeiten
  kriterienFehler: "",
  gespeichertBis: 0           // Zeitpunkt, bis zu dem „Gespeichert" steht
};

let istAdmin = false;

/* Kategorien (Bezeichnung/Zeichen) sind über die Verwaltung umbenennbar. Da
   `getKategorien()` synchron aus mock-data.js liest, wird hier zusätzlich ein
   asynchron geladener, gemergter Zwischenspeicher gehalten. */
let kategorienCache = null;
let kategorienLaeuft = false;

function stelleKategorienBereit() {
  if (kategorienCache || kategorienLaeuft) return;
  kategorienLaeuft = true;
  gameService.ladeKategorienZurBearbeitung().then(k => {
    kategorienCache = k;
    kategorienLaeuft = false;
    ui.anfordern();
  }).catch(() => {
    /* unkritisch: die Basiskategorien bleiben als Rückfallebene */
    kategorienLaeuft = false;
  });
}

function kategorienJetzt() {
  stelleKategorienBereit();
  return kategorienCache || getKategorien();
}

function kategorieMeta(schluessel) {
  const k = kategorienJetzt();
  return k[schluessel] || { label: schluessel, icon: "▫️" };
}

/* --------------------------------------------------------------------------
   Kleine Helfer
-------------------------------------------------------------------------- */

function spielerNameVon(zustand, spielerId) {
  const s = zustand.spieler.find(x => x.id === spielerId);
  return s ? s.name : "?";
}

function eigenerSpielerVon(zustand) {
  return zustand.spieler.find(s => s.id === zustand.eigenerSpielerId) || null;
}

function binIchHost(zustand) {
  const e = eigenerSpielerVon(zustand);
  return !!(e && e.istHost);
}

function initialeVon(name) {
  return String(name || "?").trim().charAt(0).toUpperCase();
}

/* Zahlen mit Tausenderpunkten — ein Preis von 122000 ist sonst nicht lesbar.
   `toLocaleString` gibt es auch auf alten Geräten, die Angabe „de-DE" nicht
   überall zuverlässig; deshalb von Hand. */
function zahlLesbar(wert) {
  const n = Number(wert);
  if (!isFinite(n)) return String(wert);
  const teile = String(Math.abs(Math.round(n))).split("");
  let aus = "";
  for (let i = 0; i < teile.length; i++) {
    if (i > 0 && (teile.length - i) % 3 === 0) aus += ".";
    aus += teile[i];
  }
  return (n < 0 ? "-" : "") + aus;
}

/* Die Bildquelle einer Karte. `foto` ist eine hochgeladene Daten-URL, `bild`
   ein Dateiname neben dem Spiel — beides zeichnet ui.zeichneBild gleich.
   Damit bleibt der Weg zu echten Kartenbildern offen, ohne dass die
   Oberfläche etwas davon wissen muss. */
function kartenBild(karte) {
  if (!karte) return null;
  if (karte.foto) return karte.foto;
  if (karte.bild) return karte.bild;
  return null;
}

/* --------------------------------------------------------------------------
   Wiederkehrende Zeichnungen
-------------------------------------------------------------------------- */

/* Rundes Plättchen mit Anfangsbuchstaben — oder dem Foto, wenn eines da ist. */
function zeichneAvatar(x, y, groesse, farbe, name, bildquelle) {
  const ctx = ui.ctx;
  ctx.beginPath();
  ctx.arc(x + groesse / 2, y + groesse / 2, groesse / 2, 0, Math.PI * 2);
  ctx.fillStyle = farbe || ui.F.primaer;
  ctx.fill();
  if (bildquelle && ui.zeichneBild(bildquelle, x, y, groesse, groesse, { rund: true, fuellen: true })) return;
  ui.schreibe(initialeVon(name), x + groesse / 2, y + groesse / 2 + 1, {
    groesse: Math.round(groesse * 0.45), fett: true, farbe: ui.F.weiss, ausrichtung: "center"
  });
}

/* Die Quartettkarte in Sammelkarten-Optik.
   Gibt die gewählte Kategorie zurück, wenn eine angetippt wurde (nur wenn
   `waehlbar`), sonst null. Die Höhe wird vorab gerechnet, damit der Aufrufer
   die Karte mittig setzen kann — auf einer Zeichenfläche gibt es kein
   Layout, das das für einen erledigt.

   `hervorgehoben` färbt eine Zeile (die verglichene Kategorie). */
function karteHoehe(karte, breite) {
  const anzahl = karte ? Object.keys(karte.eigenschaften).length : 0;
  return 12 + 26 + 18 + Math.round(breite * 0.62) + 8 + anzahl * EIGENSCHAFT_HOEHE + 10;
}

function zeichneQuartettKarte(karte, x, y, b, opt) {
  const o = opt || {};
  const ctx = ui.ctx;
  const schluessel = Object.keys(karte.eigenschaften);
  const h = karteHoehe(karte, b);
  let gewaehlt = null;

  /* Grund mit Verlauf, goldener Rand, Schatten */
  const verlauf = ctx.createLinearGradient(x, y, x + b * 0.5, y + h);
  verlauf.addColorStop(0, KARTE_VERLAUF[0]);
  verlauf.addColorStop(0.55, KARTE_VERLAUF[1]);
  verlauf.addColorStop(1, KARTE_VERLAUF[2]);
  ui.schatten(22);
  ui.fuelleRund(x, y, b, h, ui.RADIUS, verlauf);
  ui.keinSchatten();
  ui.rahmeRund(x, y, b, h, ui.RADIUS, o.gewinner ? ui.F.erfolg : KARTE_GOLD, o.gewinner ? 3.5 : 2);

  /* Glanz von links oben, wie das ::before der abgelösten Karte */
  ctx.save();
  ui.rundesRechteck(x, y, b, h, ui.RADIUS);
  ctx.clip();
  const glanz = ctx.createLinearGradient(x, y, x + b * 0.8, y + h * 0.55);
  glanz.addColorStop(0, "rgba(255,255,255,0.55)");
  glanz.addColorStop(0.45, "rgba(255,255,255,0)");
  ctx.fillStyle = glanz;
  ctx.fillRect(x, y, b, h);
  ctx.restore();

  let cy = y + 12;

  /* Kopf: Name und Rolle */
  ui.schreibe(ui.kuerze(karte.name, b - 32, 20, true), x + 16, cy + 13, { groesse: 20, fett: true });
  cy += 26;
  ui.schreibe(ui.kuerze(karte.rolle, b - 32, 13), x + 16, cy + 9, { groesse: 13, farbe: ui.F.gedaempft });
  cy += 18;

  /* Bild: 4:3 auf voller Breite, Grund in der Kartenfarbe */
  const bildH = Math.round(b * 0.62);
  const quelle = kartenBild(karte);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, cy, b, bildH);
  ctx.clip();
  ctx.fillStyle = karte.avatarFarbe || ui.F.primaer;
  ctx.fillRect(x, cy, b, bildH);
  const hatBild = quelle && ui.zeichneBild(quelle, x, cy, b, bildH);
  if (!hatBild) {
    /* Ohne eigenes Foto eine generische Silhouette passend zum Typ der Karte
       (Sportwagen, SUV, Van …). Sie ist gezeichnet, nicht geladen: keine
       Urheberrechtsfrage, keine 500 Dateien, scharf auf jeder Auflösung.
       Der Anfangsbuchstabe steht klein daneben, damit die Karte auch dann
       noch zu unterscheiden ist, wenn zwei Modelle denselben Typ haben. */
    motive.zeichne(ctx, karte.rolle, x + b * 0.06, cy + bildH * 0.12,
                   b * 0.88, bildH * 0.72, "#ffffff", 0.55);
    ui.schreibe(initialeVon(karte.name), x + b / 2, cy + bildH * 0.92, {
      groesse: Math.round(bildH * 0.16), fett: true,
      farbe: "rgba(255,255,255,0.5)", ausrichtung: "center"
    });
  }
  ctx.restore();
  if (hatBild) {
    const bildR = { x: x, y: cy, b: b, h: bildH };
    ui.merke("karte-bild", bildR, "bild");
    if (ui.geklickt(bildR)) ansicht.grossansicht = quelle;
  }
  cy += bildH + 8;

  /* Eigenschaften */
  schluessel.forEach((sch, i) => {
    const meta = kategorieMeta(sch);
    const r = { x: x + 2, y: cy, b: b - 4, h: EIGENSCHAFT_HOEHE };
    const ist = o.hervorgehoben === sch;
    if (ist) ui.fuelleRund(r.x + 4, r.y + 1, r.b - 8, r.h - 2, 8, "rgba(26, 86, 160, 0.12)");
    else if (o.waehlbar && ui.gedruecktAuf(r)) ui.fuelleRund(r.x + 4, r.y + 1, r.b - 8, r.h - 2, 8, "rgba(26, 86, 160, 0.07)");

    ui.schreibe(meta.icon, r.x + 16, r.y + r.h / 2, { groesse: 16 });
    const wert = zahlLesbar(karte.eigenschaften[sch]);
    const wertB = ui.textBreite(wert, 18, true);
    ui.schreibe(ui.kuerze(meta.label, r.b - 60 - wertB, 15), r.x + 42, r.y + r.h / 2, { groesse: 15 });
    ui.schreibe(wert, r.x + r.b - 16, r.y + r.h / 2, { groesse: 18, fett: true, ausrichtung: "right" });

    if (i < schluessel.length - 1) {
      ui.ctx.strokeStyle = ui.F.rand;
      ui.ctx.lineWidth = 1;
      ui.ctx.beginPath();
      ui.ctx.moveTo(r.x + 16, r.y + r.h);
      ui.ctx.lineTo(r.x + r.b - 16, r.y + r.h);
      ui.ctx.stroke();
    }

    if (o.waehlbar) {
      ui.merke("eig-" + sch, r, "eigenschaft");
      if (ui.geklickt(r)) gewaehlt = sch;
    }
    cy += EIGENSCHAFT_HOEHE;
  });

  /* Plakette „Gewinner" */
  if (o.gewinner) {
    const text = "Gewinner";
    const tb = ui.textBreite(text, 12, true) + 20;
    ui.fuelleRund(x + b - tb - 6, y - 10, tb, 22, 11, ui.F.erfolg);
    ui.schreibe(text, x + b - tb / 2 - 6, y + 1, { groesse: 12, fett: true, farbe: ui.F.weiss, ausrichtung: "center" });
  }

  return gewaehlt;
}

/* --------------------------------------------------------------------------
   Kopfzeile und Reiter
-------------------------------------------------------------------------- */

function zeichneKopfzeile(zustand) {
  const ctx = ui.ctx;
  const h = 52;
  ctx.fillStyle = ui.F.primaer;
  ctx.fillRect(0, 0, ui.breite, h);

  const eng = ui.breite < 560;
  let x = 14;
  const mitte = h / 2;

  /* Titel */
  const titel = SPIEL_CONFIG.zeichen + " " + SPIEL_CONFIG.titel;
  const titelG = eng ? 15 : 18;
  const titelB = Math.min(ui.textBreite(titel, titelG, true), ui.breite * (eng ? 0.5 : 0.42));
  ui.schreibe(ui.kuerze(titel, titelB, titelG, true), x, mitte, { groesse: titelG, fett: true, farbe: ui.F.weiss });
  x += titelB + 8;

  /* Versionsplakette — klickbar, führt auf den Info-Reiter */
  const vText = "v" + APP_VERSION;
  const vB = ui.textBreite(vText, 11, "halb") + 16;
  const vR = { x: x, y: mitte - 10, b: vB, h: 20 };
  ui.fuelleRund(vR.x, vR.y, vR.b, vR.h, 10, "rgba(255,255,255,0.18)");
  ui.rahmeRund(vR.x, vR.y, vR.b, vR.h, 10, "rgba(255,255,255,0.35)", 1);
  ui.schreibe(vText, vR.x + vR.b / 2, mitte, { groesse: 11, fett: "halb", farbe: ui.F.weiss, ausrichtung: "center" });
  ui.merke("version-badge", vR, "plakette");
  if (ui.geklickt(vR)) { ansicht.reiter = "info"; ui.loeseFokus(); }
  x += vB + 8;

  /* Rechte Seite: Logo, dann von rechts nach links die Knöpfe */
  let rx = ui.breite - 14;
  const logoB = 34, logoH = 26;
  if (ui.zeichneBild("logo.png", rx - logoB, mitte - logoH / 2, logoB, logoH)) rx -= logoB + 10;

  /* Spiel abbrechen / verlassen */
  if (PHASEN_MIT_ABBRUCH.indexOf(zustand.phase) !== -1) {
    const text = binIchHost(zustand) ? (eng ? "Abbrechen" : "Spiel abbrechen") : (eng ? "Verlassen" : "Spiel verlassen");
    rx -= zeichneKopfKnopf("btn-abbrechen", text, rx, mitte, () => {
      const host = binIchHost(zustand);
      ansicht.frage = {
        text: host
          ? "Spiel für alle Mitspieler:innen abbrechen?"
          : "Spiel verlassen? Deine Karten werden gleichmäßig an die übrigen Mitspieler:innen verteilt.",
        jaText: host ? "Abbrechen" : "Verlassen",
        art: "gefahr",
        ja: () => { gameService.verlasseSpiel(); }
      };
    }) + 8;
  } else if (istAdmin && !ansicht.ueberlagert) {
    /* Kartenverwaltung nur für ToolsUebersicht-Admins und nur außerhalb einer
       laufenden Partie — genau wie in der abgelösten Oberfläche. */
    rx -= zeichneKopfKnopf("btn-karten", eng ? "✏️" : "✏️ Karten", rx, mitte, () => {
      oeffneVerwaltung();
    }) + 8;
  }

  /* Zurück zum Dashboard — nur wenn wirklich Platz ist */
  if (!eng && rx > ui.breite * 0.55) {
    const text = "← Zurück zum Dashboard";
    const tb = ui.textBreite(text, 13, "halb") + 24;
    const r = { x: rx - tb, y: mitte - 14, b: tb, h: 28 };
    ui.fuelleRund(r.x, r.y, r.b, r.h, 14, "rgba(255,255,255,0.15)");
    ui.rahmeRund(r.x, r.y, r.b, r.h, 14, "rgba(255,255,255,0.3)", 1);
    ui.schreibe(text, r.x + r.b / 2, mitte, { groesse: 13, fett: "halb", farbe: ui.F.weiss, ausrichtung: "center" });
    ui.merke("btn-dashboard", r, "knopf");
    if (ui.geklickt(r)) window.location.href = "https://tecko1985.github.io/ToolsUebersicht/";
  }

  return h;
}

/* Kleiner heller Knopf auf dem blauen Grund der Kopfzeile. Gibt seine Breite
   zurück, damit der Aufrufer weiterrücken kann. */
function zeichneKopfKnopf(id, text, rechts, mitte, beiKlick) {
  const tb = ui.textBreite(text, 13, "halb") + 24;
  const r = { x: rechts - tb, y: mitte - 15, b: tb, h: 30 };
  const aktiv = ui.gedruecktAuf(r);
  ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS_KLEIN, aktiv ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.15)");
  ui.rahmeRund(r.x, r.y, r.b, r.h, ui.RADIUS_KLEIN, "rgba(255,255,255,0.5)", 1);
  ui.schreibe(text, r.x + r.b / 2, mitte, { groesse: 13, fett: "halb", farbe: ui.F.weiss, ausrichtung: "center" });
  ui.merke(id, r, "knopf");
  if (ui.geklickt(r)) beiKlick();
  return tb;
}

/* Reiter „Spiel" und „Info". Info steht ganz rechts — Flottenkonvention:
   linke Reiter sind das Arbeiten, rechts stehen die Angaben zur App. */
function zeichneReiter() {
  const ctx = ui.ctx;
  const h = 42;
  const y = 52;
  ctx.fillStyle = ui.F.karte;
  ctx.fillRect(0, y, ui.breite, h);
  ctx.strokeStyle = ui.F.rand;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y + h - 0.5);
  ctx.lineTo(ui.breite, y + h - 0.5);
  ctx.stroke();

  const eintraege = [
    { name: "spiel", text: "Spiel", x: 16 },
    { name: "info", text: "Info", x: null }
  ];

  eintraege.forEach(e => {
    const tb = ui.textBreite(e.text, 14, "halb") + 32;
    const x = e.x === null ? ui.breite - tb - 16 : e.x;
    const r = { x: x, y: y + 4, b: tb, h: h - 4 };
    const aktiv = ansicht.reiter === e.name;
    if (aktiv) {
      ctx.fillStyle = ui.F.primaer;
      ctx.fillRect(r.x, y + h - 3, r.b, 3);
    }
    ui.schreibe(e.text, r.x + r.b / 2, y + h / 2, {
      groesse: 14, fett: "halb", farbe: aktiv ? ui.F.primaer : ui.F.gedaempft, ausrichtung: "center"
    });
    ui.merke("reiter-" + e.name, r, "reiter");
    if (ui.geklickt(r)) { ansicht.reiter = e.name; ui.loeseFokus(); }
  });

  return h;
}

/* --------------------------------------------------------------------------
   Dialoge
-------------------------------------------------------------------------- */

/* Ersetzt window.confirm. Auf einer Zeichenfläche wäre ein Systemdialog der
   einzige Bruch im Bild — und auf dem iPhone stiehlt er nebenbei den Fokus
   des Tastatur-Stellvertreters. */
function zeichneFrage() {
  const f = ansicht.frage;
  if (!f) return;
  const griff = ui.beginneDialog("frage", { breite: 420 });
  ui.titel(f.titel || "Sicher?", { groesse: 19 });
  ui.absatz(f.text, { groesse: 15 });
  ui.luecke(6);
  if (ui.knopf("frage-ja", f.jaText || "Ja", { art: f.art || "primaer" })) {
    const tun = f.ja;
    ansicht.frage = null;
    if (tun) tun();
  }
  if (ui.knopf("frage-nein", f.neinText || "Abbrechen", { art: "link" })) {
    ansicht.frage = null;
  }
  ui.beendeDialog(griff);
}

/* Foto in Großansicht — Tippen schließt. */
function zeichneGrossansicht() {
  if (!ansicht.grossansicht) return;
  ui.abdunkeln(0.88);
  const rand = 24;
  const b = ui.breite - rand * 2;
  const h = ui.hoehe - rand * 2;
  if (!ui.zeichneBild(ansicht.grossansicht, rand, rand, b, h)) {
    ui.schreibe("Bild wird geladen …", ui.breite / 2, ui.hoehe / 2, {
      groesse: 15, farbe: "rgba(255,255,255,0.7)", ausrichtung: "center"
    });
  }
  const alles = { x: 0, y: 0, b: ui.breite, h: ui.hoehe };
  ui.merke("grossansicht", alles, "overlay");
  if (ui.geklickt(alles)) ansicht.grossansicht = null;
  ui.ctx.save();
  ui.ctx.globalAlpha = 0.75;
  ui.schreibe("Tippen zum Schließen", ui.breite / 2, ui.hoehe - 18, {
    groesse: 13, farbe: ui.F.weiss, ausrichtung: "center"
  });
  ui.ctx.restore();
  /* abdunkeln() hat eine Ebene aufgemacht — die muss wieder zu, sonst zählt
     das nächste Bild ab der falschen Ebene und nichts darunter nimmt Klicks
     entgegen. */
  ui.beendeEbene();
}

/* --------------------------------------------------------------------------
   Aktionen, die mehrere Bildschirme auslösen
-------------------------------------------------------------------------- */

function geheZuNamenseingabe(modus) {
  ansicht.modus = modus;
  ansicht.ueberlagert = "name";
  ansicht.fehler = "";
  ui.setzeEingabe("eingabe-name", "");
  ui.loeseFokus();
}

function bestaetigeNamen() {
  const name = String(ui.leseEingabe("eingabe-name") || "").trim();
  const versprechen = ansicht.modus === "erstellen"
    ? gameService.erstelleRaum(name, ansicht.deckgroesse)
    : gameService.tritRaumBei(ansicht.beitrittsCode, name);
  versprechen.then(ergebnis => {
    if (!ergebnis.erfolg) {
      ansicht.fehler = ergebnis.fehler || "Das hat nicht funktioniert.";
    } else {
      ansicht.ueberlagert = null;
      ansicht.fehler = "";
    }
    ui.anfordern();
  });
}

function oeffneBestenliste() {
  ansicht.ueberlagert = "bestenliste";
  ansicht.bestenliste = null;
  ansicht.bestenlisteFehler = "";
  ui.loeseFokus();
  gameService.ladeBestenliste().then(eintraege => {
    ansicht.bestenliste = eintraege;
    ui.anfordern();
  }).catch(() => {
    ansicht.bestenliste = [];
    ansicht.bestenlisteFehler = "Bestenliste konnte nicht geladen werden.";
    ui.anfordern();
  });
}

function oeffneVerwaltung() {
  ansicht.ueberlagert = "verwaltung";
  ansicht.verwaltungsKarten = null;
  ansicht.verwaltungsFehler = "";
  ui.loeseFokus();
  gameService.ladeKartenZurBearbeitung().then(karten => {
    ansicht.verwaltungsKarten = karten;
    ui.anfordern();
  }).catch(() => {
    ansicht.verwaltungsKarten = [];
    ansicht.verwaltungsFehler = "Karten konnten nicht geladen werden.";
    ui.anfordern();
  });
}

function oeffneKartenBearbeitung(karte) {
  ansicht.karte = karte;
  ansicht.karteNeuesFoto = undefined;
  ansicht.fehler = "";
  ansicht.ueberlagert = "bearbeiten";
  ui.setzeEingabe("kb-name", karte.name || "");
  ui.setzeEingabe("kb-rolle", karte.rolle || "");
  ui.loeseFokus();

  /* Die Eingabefelder der Eigenschaften bekommen ihre Werte hier gesetzt und
     nicht bei jedem Bild — sonst überschriebe das Zeichnen laufend, was
     gerade getippt wird. */
  gameService.ladeKategorienZurBearbeitung().catch(() => getKategorien()).then(kat => {
    const k = kat || getKategorien();
    Object.keys(k).forEach(sch => {
      const wert = karte.eigenschaften && karte.eigenschaften[sch] !== undefined ? karte.eigenschaften[sch] : 50;
      ui.setzeEingabe("kb-eig-" + sch, String(wert));
    });
    ui.anfordern();
  });
}

function neueKarteAnlegen() {
  const farben = ["#1a56a0", "#057a55", "#c9941f", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#ea580c"];
  oeffneKartenBearbeitung({
    id: "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: "",
    rolle: "",
    foto: null,
    avatarFarbe: farben[Math.floor(Math.random() * farben.length)],
    eigenschaften: {},
    istNeu: true
  });
}

/* Foto auswählen und auf Kartengröße verkleinern. Ein Bild vom Handy hat
   mehrere Megabyte; als Daten-URL landet es unverkleinert in der Datenbank
   und wird bei JEDEM Spielstart mitgeladen — deshalb wird hier hart auf
   480×360 skaliert, bevor irgendetwas gespeichert wird. */
function waehleKartenFoto() {
  ui.waehleDatei(datei => {
    const leser = new FileReader();
    leser.onload = () => {
      const bild = new Image();
      bild.onload = () => {
        const maxB = 480, maxH = 360;
        let breite = bild.width, hoehe = bild.height;
        const f = Math.min(maxB / breite, maxH / hoehe, 1);
        breite = Math.round(breite * f);
        hoehe = Math.round(hoehe * f);
        const flaeche = document.createElement("canvas");
        flaeche.width = breite;
        flaeche.height = hoehe;
        flaeche.getContext("2d").drawImage(bild, 0, 0, breite, hoehe);
        ansicht.karteNeuesFoto = flaeche.toDataURL("image/jpeg", 0.8);
        ui.anfordern();
      };
      bild.src = leser.result;
    };
    leser.readAsDataURL(datei);
  });
}

function speichereKarte() {
  const karte = ansicht.karte;
  if (!karte) return;
  const name = String(ui.leseEingabe("kb-name") || "").trim();
  const rolle = String(ui.leseEingabe("kb-rolle") || "").trim();
  if (!name || !rolle) {
    ansicht.fehler = "Bitte Name und Rolle ausfüllen.";
    return;
  }
  const eigenschaften = {};
  Object.keys(kategorienJetzt()).forEach(sch => {
    eigenschaften[sch] = Number(ui.leseEingabe("kb-eig-" + sch)) || 0;
  });
  ansicht.fehler = "";
  gameService.speichereKartenUebersteuerung(karte.id, {
    name: name,
    rolle: rolle,
    foto: ansicht.karteNeuesFoto !== undefined ? ansicht.karteNeuesFoto : (karte.foto || null),
    eigenschaften: eigenschaften
  }).then(() => {
    oeffneVerwaltung();
  }).catch(() => {
    ansicht.fehler = "Speichern fehlgeschlagen.";
    ui.anfordern();
  });
}

function karteZuruecksetzen() {
  const karte = ansicht.karte;
  if (!karte) return;
  gameService.setzeKarteZurueck(karte.id).then(() => {
    oeffneVerwaltung();
  }).catch(() => {
    ansicht.fehler = "Zurücksetzen fehlgeschlagen.";
    ui.anfordern();
  });
}

function oeffneKriterien() {
  ansicht.ueberlagert = "kriterien";
  ansicht.kriterien = null;
  ansicht.kriterienFehler = "";
  ui.loeseFokus();
  gameService.ladeKategorienZurBearbeitung().then(kat => {
    ansicht.kriterien = kat;
    Object.keys(kat).forEach(sch => {
      ui.setzeEingabe("kr-icon-" + sch, kat[sch].icon);
      ui.setzeEingabe("kr-label-" + sch, kat[sch].label);
    });
    ui.anfordern();
  }).catch(() => {
    ansicht.kriterien = {};
    ansicht.kriterienFehler = "Kriterien konnten nicht geladen werden.";
    ui.anfordern();
  });
}

function speichereKriterien() {
  const kat = ansicht.kriterien;
  if (!kat) return;
  const schluessel = Object.keys(kat);
  for (let i = 0; i < schluessel.length; i++) {
    const icon = String(ui.leseEingabe("kr-icon-" + schluessel[i]) || "").trim();
    const label = String(ui.leseEingabe("kr-label-" + schluessel[i]) || "").trim();
    if (!icon || !label) {
      ansicht.kriterienFehler = "Bitte Icon und Bezeichnung für jedes Kriterium ausfüllen.";
      return;
    }
  }
  ansicht.kriterienFehler = "";
  const nacheinander = schluessel.reduce((kette, sch) => kette.then(() => {
    return gameService.speichereKategorieUebersteuerung(sch, {
      icon: String(ui.leseEingabe("kr-icon-" + sch)).trim(),
      label: String(ui.leseEingabe("kr-label-" + sch)).trim()
    });
  }), Promise.resolve());

  nacheinander.then(() => {
    kategorienCache = null;
    oeffneVerwaltung();
  }).catch(() => {
    ansicht.kriterienFehler = "Speichern fehlgeschlagen.";
    ui.anfordern();
  });
}

/* --------------------------------------------------------------------------
   Admin-Prüfung (Kartenverwaltung nur für ToolsUebersicht-Admins)
   Nutzt dieselbe Anmeldung wie die ToolsUebersicht-Landingpage (gleicher
   Origin tecko1985.github.io, localStorage-Schlüssel "tu_session_token") —
   kein eigenes Login hier. Ohne Token oder bei jedem Fehler bleibt der Knopf
   verborgen (fail-closed).
-------------------------------------------------------------------------- */
const TU_WORKER_URL = "https://landingpage.michel-brunner.workers.dev";
const TU_TOKEN_KEY = "tu_session_token";

function pruefeAdminStatus() {
  let token = null;
  try {
    token = localStorage.getItem(TU_TOKEN_KEY);
  } catch (e) {
    /* unkritisch, falls localStorage nicht verfügbar ist */
  }
  if (!token) {
    istAdmin = false;
    return;
  }
  fetch(TU_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ action: "me" })
  }).then(antwort => (antwort.ok ? antwort.json() : null))
    .then(daten => {
      istAdmin = !!(daten && daten.isAdmin);
      ui.anfordern();
    })
    .catch(() => {
      istAdmin = false;   // im Zweifel (Netzwerkfehler o.ä.) Knopf verborgen lassen
    });
}

/* --------------------------------------------------------------------------
   Bildschirm wachhalten
   Browser drosseln Timer und Firebase-Listener stark, sobald der Bildschirm
   sperrt — besonders auf dem Gastgeber-Handy spürbar, da dort die gesamte
   Spiellogik läuft.
-------------------------------------------------------------------------- */
let bildschirmWakeLock = null;

function sichereBildschirmWach() {
  if (!("wakeLock" in navigator) || bildschirmWakeLock) return;
  navigator.wakeLock.request("screen").then(sperre => {
    bildschirmWakeLock = sperre;
    sperre.addEventListener("release", () => { bildschirmWakeLock = null; });
  }).catch(() => {
    /* unkritisch, z.B. wenn der Tab gerade nicht sichtbar ist */
  });
}

function gibBildschirmFrei() {
  if (bildschirmWakeLock) {
    bildschirmWakeLock.release().catch(() => {});
    bildschirmWakeLock = null;
  }
}

/* --------------------------------------------------------------------------
   Die Szene — beschreibt bei jedem Bild die ganze Oberfläche
-------------------------------------------------------------------------- */

function szene() {
  const zustand = gameService.getZustand();

  if (zustand.phase === "start") gibBildschirmFrei();
  else sichereBildschirmWach();

  /* Eine überlagerte Ansicht, die zur laufenden Partie nicht mehr passt,
     macht sich selbst zu: wer in der Kartenverwaltung steht und in einen Raum
     gezogen wird, soll die Partie sehen. Die Namenseingabe verschwindet,
     sobald der Beitritt geglückt ist. */
  if (ansicht.ueberlagert === "name" && zustand.phase !== "start") ansicht.ueberlagert = null;
  if (ansicht.ueberlagert && ansicht.ueberlagert !== "name" && zustand.phase !== "start") ansicht.ueberlagert = null;

  const ctx = ui.ctx;
  ctx.fillStyle = ui.F.hintergrund;
  ctx.fillRect(0, 0, ui.breite, ui.hoehe);

  const kopfH = zeichneKopfzeile(zustand);
  const reiterH = zeichneReiter();
  const oben = kopfH + reiterH;

  ui.beginneKasten({ x: 0, y: oben, b: ui.breite, h: ui.hoehe - oben }, 0);

  if (ansicht.reiter === "info") {
    bildschirme.info();
  } else {
    const name = ansicht.ueberlagert || BILDSCHIRM_FUER_PHASE[zustand.phase] || "start";
    const zeichner = bildschirme[name];
    if (zeichner) zeichner(zustand);
    else bildschirme.start(zustand);
  }

  ui.beendeKasten();

  zeichneFrage();
  zeichneGrossansicht();
  ui.zeichneOffeneListen();
}

/* --------------------------------------------------------------------------
   Start
-------------------------------------------------------------------------- */

const APP_VERSION = "1.0";
const CHANGELOG = [
  {
    version: "1.0",
    groups: [
      { title: "Spielen", items: [
          "Quartett auf mehreren Geräten gleichzeitig — ein Gerät eröffnet den Raum, die anderen treten mit dem Raumcode bei.",
          "Bis zu 8 Mitspielende, die eigene Hand sieht nur man selbst.",
          "Bockrunde bei Gleichstand: der Pott geht an die nächste gewonnene Runde.",
          "Gegen eine einfache KI spielen, wenn gerade niemand sonst da ist."
      ]},
      { title: "Karten", items: [
          "Karten ohne eigenes Foto zeigen eine Silhouette passend zum Typ — Sportwagen, SUV, Van, Pickup, Oldtimer und sieben weitere.",
          "Die Silhouetten sind gezeichnet, nicht geladen: es wird nichts nachgeladen, und sie sind auf jedem Display scharf.",
          "Kartenverwaltung und Kriterien pflegen Administratoren."
      ]},
      { title: "Oberfläche", items: [
          "Das ganze Spiel läuft auf einer einzigen Zeichenfläche statt auf HTML-Bildschirmen — flüssig auf dem Handy und überall gleich.",
          "Die Karte ist groß und gut lesbar, Werte stehen mit Tausenderpunkten.",
          "Kartenverwaltung, Bestenliste und Info laufen auf derselben Fläche; Sicherheitsabfragen erscheinen als Dialog im Spiel statt als Systemfenster."
      ]},
      { title: "Drumherum", items: [
          "Bestenliste über alle bisherigen Partien."
      ]}
    ]
  }
];

gameService.onZustandsAenderung(() => ui.anfordern());
pruefeAdminStatus();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (gameService.getZustand().phase !== "start") sichereBildschirmWach();
    ui.anfordern();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

ui.starte(
  document.getElementById("buehne"),
  document.getElementById("tastatur-proxy"),
  szene,
  document.getElementById("foto-datei")
);
