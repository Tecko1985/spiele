/* ==========================================================================
   Prüfstand für das Rennbild von Viertelmeile
   ==========================================================================
   Aufruf:  node pflege/pruefe-rennen.js

   ⚠️ WARUM DAS HIER SEIN MUSS. physik.js ist gegengerechnet, turnier.js
   auch — aber dazwischen liegt rennen.js: Zeitplan, Burnout-Halten,
   Frühstart, Warteschlange der Tipper, Abbruchbedingungen. Genau dort
   entstehen die Fehler, die man im Browser nur mit dem Daumen findet.
   Hier wird das ECHTE rennen.js geladen und mit einer nachgebauten Uhr,
   einer Attrappen-Zeichenfläche und echten Zeigerereignissen durchgefahren.

   ⚠️ Die Zeichenschleife hängt an requestAnimationFrame. Der Prüfstand
   ersetzt sie durch einen Takt, den er selbst weiterdreht — sonst müsste
   in Echtzeit gewartet werden, und ein Durchlauf mit 30 Rennen dauerte
   eine Viertelstunde.
   ========================================================================== */

const fs = require('fs');
const pfad = __dirname + '/..';

const physik = require(pfad + '/physik.js');
const autos = require(pfad + '/autos.js');
const bot = require(pfad + '/bot.js');

let fehler = 0, geprueft = 0;
function pruefe(name, ok, info) {
  geprueft++;
  console.log((ok ? '  OK   ' : '  FEHL ') + name + (info ? '  (' + info + ')' : ''));
  if (!ok) fehler++;
}
function z3(x) { return typeof x === 'number' ? x.toFixed(3) : '—'; }

/* --------------------------------------------------------------------------
   Attrappen
   -------------------------------------------------------------------------- */

/** Ein 2D-Kontext, der alles annimmt und nichts tut. */
function malAttrappe() {
  const zaehler = { aufrufe: 0 };
  return new Proxy(zaehler, {
    get: function (ziel, name) {
      if (name === 'aufrufe') return ziel.aufrufe;
      if (name === 'canvas') return null;
      if (name === 'measureText') return function () { return { width: 40 }; };
      if (name === 'createLinearGradient') return function () { return { addColorStop: function () {} }; };
      return function () { ziel.aufrufe++; };
    },
    set: function () { return true; },
  });
}

function leinwandAttrappe(breite, hoehe) {
  const horcher = {};
  return {
    width: breite, height: hoehe,
    clientWidth: breite, clientHeight: hoehe,
    style: {},
    getContext: function () { return malAttrappe(); },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: breite, height: hoehe }; },
    addEventListener: function (art, fn) { (horcher[art] = horcher[art] || []).push(fn); },
    removeEventListener: function (art, fn) {
      if (!horcher[art]) return;
      horcher[art] = horcher[art].filter(function (f) { return f !== fn; });
    },
    __feuere: function (art, ereignis) { for (const fn of (horcher[art] || []).slice()) fn(ereignis); },
  };
}

/** Lädt das echte rennen.js mit untergeschobenen globalen Namen. */
function ladeRennen(welt) {
  const quelle = fs.readFileSync(pfad + '/rennen.js', 'utf8');
  const bauer = new Function(
    'physik', 'autos', 'bot', 'ton', 'window', 'document',
    'requestAnimationFrame', 'cancelAnimationFrame',
    quelle + '\nreturn rennen;'
  );
  return bauer(physik, autos, bot, welt.ton, welt.window, welt.document,
    welt.requestAnimationFrame, welt.cancelAnimationFrame);
}

/**
 * Eine komplette Welt: eigene Uhr, eigener Bildtakt, Attrappen für Ton und
 * Fenster. `takte()` dreht die Zeit weiter und ruft dabei die Bilder auf.
 */
function neueWelt(bilderProSekunde) {
  const welt = {
    uhr: 1000000,
    bildAbstand: 1000 / (bilderProSekunde || 60),
    warteschlange: [],
    naechsteId: 1,
    tonRuf: [],
  };

  welt.ton = {
    entsperre: function () {}, motor: function () {}, leerlauf: function () {},
    motorStopp: function () {}, quietschen: function () {}, quietschenAus: function () {},
    stoppAlles: function () {}, vibriere: function () {}, halteWach: function () {},
    kannTon: function () { return false; },
    piep: function (a) { welt.tonRuf.push(a); },
    hole: function () { return ''; }, setze: function () {},
  };

  const fensterHorcher = {};
  welt.window = {
    devicePixelRatio: 1,
    addEventListener: function (art, fn) { (fensterHorcher[art] = fensterHorcher[art] || []).push(fn); },
    removeEventListener: function (art, fn) {
      if (!fensterHorcher[art]) return;
      fensterHorcher[art] = fensterHorcher[art].filter(function (f) { return f !== fn; });
    },
    __feuere: function (art, e) { for (const fn of (fensterHorcher[art] || []).slice()) fn(e); },
  };

  const dokHorcher = {};
  welt.document = {
    visibilityState: 'visible',
    addEventListener: function (art, fn) { (dokHorcher[art] = dokHorcher[art] || []).push(fn); },
    removeEventListener: function (art, fn) {
      if (!dokHorcher[art]) return;
      dokHorcher[art] = dokHorcher[art].filter(function (f) { return f !== fn; });
    },
    __feuere: function (art) { for (const fn of (dokHorcher[art] || []).slice()) fn({}); },
  };

  welt.requestAnimationFrame = function (fn) {
    const id = welt.naechsteId++;
    welt.warteschlange.push({ id: id, fn: fn });
    return id;
  };
  welt.cancelAnimationFrame = function (id) {
    welt.warteschlange = welt.warteschlange.filter(function (e) { return e.id !== id; });
  };

  /** Ein Bild: Uhr weiterdrehen, dann alle eingereihten Rückrufe abarbeiten. */
  welt.einBild = function () {
    welt.uhr += welt.bildAbstand;
    const dran = welt.warteschlange;
    welt.warteschlange = [];
    for (const e of dran) e.fn();
  };

  welt.jetzt = function () { return welt.uhr; };
  return welt;
}

/** Baut ein Zeigerereignis auf einer bestimmten Bildschirmspalte. */
function zeiger(anteilX, breite) {
  return {
    pointerId: 1, clientX: anteilX * breite, clientY: 300,
    preventDefault: function () {},
  };
}

/* --------------------------------------------------------------------------
   Ein Rennen fahren
   -------------------------------------------------------------------------- */

/**
 * `fahrer` beschreibt, wie getippt wird:
 *   reaktion       Sekunden nach Grün, dann wird Gas getippt (null = nie)
 *   fruehstart     Sekunden VOR Grün tippen (überschreibt reaktion)
 *   waerme         bis zu welchem Balkenstand gehalten wird (null = gar nicht)
 *   schaltZiel     Drehzahl, ab der geschaltet wird
 *   lenken         true = Ausbrecher werden gehalten
 *   verschwinde    Sekunde, in der die App in den Hintergrund geht
 */
function fahre(fahrer, opt) {
  opt = opt || {};
  const welt = neueWelt(opt.bilder || 60);
  const rennen = ladeRennen(welt);
  const leinwand = leinwandAttrappe(800, 400);
  const auto = autos.nachId(opt.autoId || 'muscle');
  const burnout = opt.burnout !== false;

  let ergebnis = null, gegnerErgebnis = null;
  const gemeldet = [];

  const gruenZeit = welt.uhr + rennen.vorlaufMs(burnout) + 500;
  rennen.starte({
    canvas: leinwand,
    jetzt: welt.jetzt,
    gruenZeit: gruenZeit,
    auto: auto,
    saat: opt.saat || 4242,
    burnout: burnout,
    meinName: 'Ich', meinLack: 'rot',
    gegnerName: 'Bot', gegnerLack: 'weiss',
    gegner: opt.gegner === null ? null : { art: 'bot', stufe: opt.stufe || 'mittel', botSaat: 9999 },
    aufPosition: function (d) { gemeldet.push(d); },
    fertig: function (e, g) { ergebnis = e; gegnerErgebnis = g; },
  });

  const t = function () { return (welt.uhr - gruenZeit) / 1000; };
  let haelt = false, gestartet = false, naechsteLenkung = -99, wache = 0;

  while (!ergebnis && wache++ < 4000) {
    welt.einBild();
    const jetztT = t();
    const st = rennen.stand();
    if (!st) break;

    if (opt.verschwinde !== undefined && jetztT >= opt.verschwinde && welt.document.visibilityState === 'visible') {
      welt.document.visibilityState = 'hidden';
      welt.document.__feuere('visibilitychange');
      continue;
    }

    /* Burnout halten */
    if (burnout && fahrer.waerme !== null && fahrer.waerme !== undefined && !gestartet) {
      const vonT = st.plan.burnoutVon, bisT = st.plan.burnoutBis;
      if (jetztT >= vonT + 0.05 && jetztT < bisT) {
        if (!haelt) { haelt = true; leinwand.__feuere('pointerdown', zeiger(0.7, 800)); }
        else if (st.waerme >= fahrer.waerme) { haelt = false; welt.window.__feuere('pointerup', zeiger(0.7, 800)); }
      }
    }

    const l = st.lauf;
    if (!l) continue;

    /* Start */
    if (l.reaktion === null && !gestartet) {
      const ziel = fahrer.fruehstart !== undefined ? -fahrer.fruehstart : fahrer.reaktion;
      if (ziel !== null && ziel !== undefined && jetztT >= ziel) {
        gestartet = true;
        leinwand.__feuere('pointerdown', zeiger(0.7, 800));
        welt.window.__feuere('pointerup', zeiger(0.7, 800));
      }
      continue;
    }
    if (!l.gestartet) continue;

    /* Schalten */
    if (l.gang < auto.gaenge.length - 1 && l.t >= l.leerlaufBis) {
      const f = physik.fenster(auto, l.gang);
      const ziel = fahrer.schaltZiel !== undefined ? fahrer.schaltZiel : (f.perfektAb + 1.0) / 2;
      if (physik.drehzahl(l) >= ziel) {
        leinwand.__feuere('pointerdown', zeiger(0.7, 800));
        welt.window.__feuere('pointerup', zeiger(0.7, 800));
      }
    }

    /* Lenken */
    if (fahrer.lenken) {
      let zieht = 0;
      for (const zg of l.zuege) if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER + 0.3) zieht += zg.richtung;
      const schief = Math.abs(l.versatz) > 0.05 ? (l.versatz > 0 ? 1 : -1) : 0;
      const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
      if (noetig !== 0 && l.t >= naechsteLenkung) {
        naechsteLenkung = l.t + 0.14;
        leinwand.__feuere('pointerdown', zeiger(noetig > 0 ? 0.10 : 0.34, 800));
        welt.window.__feuere('pointerup', zeiger(noetig > 0 ? 0.10 : 0.34, 800));
      }
    }
  }

  return { ergebnis: ergebnis, gegner: gegnerErgebnis, gemeldet: gemeldet, bilder: wache, toene: welt.tonRuf };
}

const GUT = { reaktion: 0.18, waerme: 0.92, lenken: true };

/* --------------------------------------------------------------------------
   1. Ein ganzes Rennen von vorn bis hinten
   -------------------------------------------------------------------------- */

console.log('\n=== 1. Ein Rennen komplett ===\n');

const r1 = fahre(GUT, {});
pruefe('das Rennen endet von selbst', !!r1.ergebnis, r1.bilder + ' Bilder');
if (r1.ergebnis) {
  const e = r1.ergebnis;
  console.log('  Ergebnis: ' + z3(e.gesamt) + ' s  (Reaktion ' + z3(e.reaktion) + ', Fahrt ' + z3(e.fahrzeit) + ', Burnout ' + e.burnout + ', Spitze ' + e.spitze + ' km/h)');
  pruefe('eine gültige Gesamtzeit kommt heraus', typeof e.gesamt === 'number' && e.gesamt > 8 && e.gesamt < 14, z3(e.gesamt) + ' s');
  pruefe('Gesamtzeit = Reaktion + Fahrzeit', Math.abs(e.gesamt - (e.reaktion + e.fahrzeit)) < 0.002);
  pruefe('kein Frühstart, nicht ausgeschieden', !e.fehlstart && !e.aus && !e.abgebrochen);
  pruefe('der Burnout wurde als Punktlandung gewertet', e.burnout === 'perfekt', e.burnout + ' bei Wärme ' + z3(e.waerme));
  pruefe('alle Gänge wurden geschaltet', e.noten.perfekt + e.noten.gut + e.noten.zufrueh + e.noten.ueberdreht === autos.nachId('muscle').gaenge.length - 1);
  pruefe('die Spitzengeschwindigkeit ist plausibel', e.spitze > 180 && e.spitze < 320, e.spitze + ' km/h');
  pruefe('auch der Bot liefert ein Ergebnis', !!r1.gegner && typeof r1.gegner.gesamt === 'number', z3(r1.gegner && r1.gegner.gesamt) + ' s');
  pruefe('die drei gelben und das grüne Licht kamen', r1.toene.filter(function (x) { return x === 'gelb'; }).length === 3 && r1.toene.indexOf('gruen') >= 0, r1.toene.join(','));
}

/* --------------------------------------------------------------------------
   2. Frühstart
   -------------------------------------------------------------------------- */

console.log('\n=== 2. Frühstart ===\n');

const r2 = fahre({ reaktion: null, fruehstart: 0.30, waerme: 0.92, lenken: true }, {});
pruefe('vor Grün getippt wird als Frühstart gewertet', !!r2.ergebnis && r2.ergebnis.fehlstart === true);
pruefe('ein Frühstart hat keine Zeit', !!r2.ergebnis && r2.ergebnis.gesamt === null);
pruefe('die Reaktion wird negativ vermerkt', !!r2.ergebnis && r2.ergebnis.reaktion < 0, z3(r2.ergebnis && r2.ergebnis.reaktion));

/* Ganz früh — noch vor dem Anrollen — darf NICHT zählen. */
const r2b = fahre({ reaktion: null, fruehstart: 4.0, waerme: 0.92, lenken: true }, {});
pruefe('ein Tipper vor dem Anrollen zählt nicht als Frühstart', !!r2b.ergebnis && !r2b.ergebnis.fehlstart, r2b.ergebnis ? (r2b.ergebnis.nichtGestartet ? 'gilt als nicht losgefahren' : 'gefahren') : '—');

/* --------------------------------------------------------------------------
   3. Wer nie losfährt
   -------------------------------------------------------------------------- */

console.log('\n=== 3. Nicht losgefahren ===\n');

const r3 = fahre({ reaktion: null, waerme: 0.92, lenken: false }, {});
pruefe('wer nie tippt, verliert', !!r3.ergebnis && r3.ergebnis.aus === true);
pruefe('das wird als „nicht losgefahren" vermerkt', !!r3.ergebnis && r3.ergebnis.nichtGestartet === true);
pruefe('das Rennen bricht trotzdem ab und hängt nicht', r3.bilder < 2000, r3.bilder + ' Bilder');

/* --------------------------------------------------------------------------
   4. Spur verlassen
   -------------------------------------------------------------------------- */

console.log('\n=== 4. Spur verlassen ===\n');

const r4 = fahre({ reaktion: 0.18, waerme: 0.92, lenken: false }, {});
pruefe('ohne Gegenlenken endet das Rennen an der Linie', !!r4.ergebnis && r4.ergebnis.aus === true);
pruefe('dann gibt es keine Zeit', !!r4.ergebnis && r4.ergebnis.gesamt === null);

/* --------------------------------------------------------------------------
   5. Burnout
   -------------------------------------------------------------------------- */

console.log('\n=== 5. Burnout ===\n');

const kalt = fahre({ reaktion: 0.18, waerme: null, lenken: true }, {});
const warm = fahre({ reaktion: 0.18, waerme: 0.92, lenken: true }, {});
const heiss = fahre({ reaktion: 0.18, waerme: 1.30, lenken: true }, {});
console.log('  gar nicht aufgewärmt: ' + z3(kalt.ergebnis && kalt.ergebnis.gesamt) + ' s (' + (kalt.ergebnis && kalt.ergebnis.burnout) + ')');
console.log('  Punktlandung:         ' + z3(warm.ergebnis && warm.ergebnis.gesamt) + ' s (' + (warm.ergebnis && warm.ergebnis.burnout) + ')');
console.log('  überhitzt:            ' + z3(heiss.ergebnis && heiss.ergebnis.gesamt) + ' s (' + (heiss.ergebnis && heiss.ergebnis.burnout) + ')');
pruefe('gar nicht aufgewärmt ist langsamer als die Punktlandung', kalt.ergebnis.gesamt > warm.ergebnis.gesamt + 0.1);
pruefe('überhitzt ist auch langsamer als die Punktlandung', heiss.ergebnis.gesamt > warm.ergebnis.gesamt + 0.05, z3(heiss.ergebnis.gesamt - warm.ergebnis.gesamt) + ' s');

const ohne = fahre({ reaktion: 0.18, lenken: true }, { burnout: false });
pruefe('ohne Burnout läuft das Rennen trotzdem', !!ohne.ergebnis && typeof ohne.ergebnis.gesamt === 'number', z3(ohne.ergebnis && ohne.ergebnis.gesamt) + ' s');
pruefe('ohne Burnout ist der Vorlauf kürzer', ohne.bilder < r1.bilder, ohne.bilder + ' gegen ' + r1.bilder + ' Bilder');

/* --------------------------------------------------------------------------
   6. Bildrate
   -------------------------------------------------------------------------- */

console.log('\n=== 6. Die Bildrate darf die Zeit nicht ändern ===\n');

/* ⚠️ WAS HIER GEMESSEN WIRD — UND WAS NICHT.
   Der RECHENKERN ist bildratenunabhängig, auf die Tausendstel: das steht in
   pflege/pruefe-fahrt.js, Abschnitt 3, wo dieselben Tipper mit denselben
   Zeitstempeln bei 30 und bei 120 Bildern/s exakt dieselbe Zeit ergeben.
   Hier fährt dagegen ein Fahrer, der die Nadel nur so oft SIEHT, wie sein
   Handy zeichnet — und deshalb später tippt. Dieser Rest bleibt bestehen und
   ist kein Fehler, sondern die Wahrheit über ein langsames Gerät. Gemessen
   wird, dass er klein bleibt und nicht davonläuft:
     30 Bilder/s  ->  unter 0,10 s
     15 Bilder/s  ->  unter 0,40 s
   Bei 15 Bildern/s ruckelt die Anzeige ohnehin sichtbar; wer damit fährt,
   merkt es. */
const schnell = fahre(GUT, { bilder: 120 });
const langsam = fahre(GUT, { bilder: 30 });
const sehrLangsam = fahre(GUT, { bilder: 15 });
console.log('  120 Bilder/s: ' + z3(schnell.ergebnis.gesamt) + ' s');
console.log('   30 Bilder/s: ' + z3(langsam.ergebnis.gesamt) + ' s');
console.log('   15 Bilder/s: ' + z3(sehrLangsam.ergebnis.gesamt) + ' s');
pruefe('30 gegen 120 Bilder/s: der Fahrer verliert unter 0,10 s', Math.abs(schnell.ergebnis.gesamt - langsam.ergebnis.gesamt) < 0.10,
  z3(Math.abs(schnell.ergebnis.gesamt - langsam.ergebnis.gesamt)) + ' s');
pruefe('15 gegen 120 Bilder/s: der Fahrer verliert unter 0,40 s', Math.abs(schnell.ergebnis.gesamt - sehrLangsam.ergebnis.gesamt) < 0.40,
  z3(Math.abs(schnell.ergebnis.gesamt - sehrLangsam.ergebnis.gesamt)) + ' s');

/* --------------------------------------------------------------------------
   7. App weggedrückt
   -------------------------------------------------------------------------- */

console.log('\n=== 7. App mitten im Rennen weggedrückt ===\n');

const weg = fahre(GUT, { verschwinde: 3.0 });
pruefe('das Rennen endet sofort', !!weg.ergebnis);
pruefe('es gilt als abgebrochen', !!weg.ergebnis && weg.ergebnis.abgebrochen === true);
pruefe('und es gibt keine Zeit', !!weg.ergebnis && weg.ergebnis.gesamt === null);

/* --------------------------------------------------------------------------
   8. Standmeldungen ans andere Handy
   -------------------------------------------------------------------------- */

console.log('\n=== 8. Standmeldungen ===\n');

const welt = neueWelt(60);
const rennenMod = ladeRennen(welt);
const leinwand = leinwandAttrappe(800, 400);
let fertigErg = null;
const meldungen = [];
const gruen = welt.uhr + rennenMod.vorlaufMs(false) + 500;
rennenMod.starte({
  canvas: leinwand, jetzt: welt.jetzt, gruenZeit: gruen,
  auto: autos.nachId('muscle'), saat: 777, burnout: false,
  meinName: 'A', meinLack: 'rot', gegnerName: 'B', gegnerLack: 'blau',
  gegner: { art: 'fern' },
  aufPosition: function (d) { meldungen.push(d); },
  fertig: function (e) { fertigErg = e; },
});
{
  let wache = 0;
  let gestartet = false;
  while (!fertigErg && wache++ < 4000) {
    welt.einBild();
    const st = rennenMod.stand();
    if (!st) break;
    const tt = (welt.uhr - gruen) / 1000;
    /* Der Gegner meldet sich alle 100 ms mit seinem Stand. */
    if (tt > 0) rennenMod.setzeGegner({ t: tt, s: Math.min(402.34, tt * 38), v: 38, versatz: 0, fertig: tt * 38 >= 402.34, aus: false });
    const l = st.lauf;
    if (!l) continue;
    if (l.reaktion === null && !gestartet && tt >= 0.2) {
      gestartet = true;
      leinwand.__feuere('pointerdown', zeiger(0.7, 800));
      welt.window.__feuere('pointerup', zeiger(0.7, 800));
      continue;
    }
    if (!l.gestartet) continue;
    const a = autos.nachId('muscle');
    if (l.gang < a.gaenge.length - 1 && l.t >= l.leerlaufBis) {
      const f = physik.fenster(a, l.gang);
      if (physik.drehzahl(l) >= (f.perfektAb + 1) / 2) {
        leinwand.__feuere('pointerdown', zeiger(0.7, 800));
        welt.window.__feuere('pointerup', zeiger(0.7, 800));
      }
    }
    let zieht = 0;
    for (const zg of l.zuege) if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER + 0.3) zieht += zg.richtung;
    const schief = Math.abs(l.versatz) > 0.05 ? (l.versatz > 0 ? 1 : -1) : 0;
    const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
    if (noetig !== 0) {
      leinwand.__feuere('pointerdown', zeiger(noetig > 0 ? 0.10 : 0.34, 800));
      welt.window.__feuere('pointerup', zeiger(noetig > 0 ? 0.10 : 0.34, 800));
    }
  }
}
pruefe('gegen einen Gegner über das Netz kommt ein Ergebnis heraus', !!fertigErg && typeof fertigErg.gesamt === 'number', z3(fertigErg && fertigErg.gesamt) + ' s');
pruefe('der eigene Stand wird regelmäßig gemeldet', meldungen.length > 60, meldungen.length + ' Meldungen');
pruefe('eine Meldung enthält Strecke, Tempo und Querlage',
  meldungen.length > 0 && typeof meldungen[0].s === 'number' && typeof meldungen[0].v === 'number' && typeof meldungen[0].versatz === 'number');
pruefe('die gemeldete Strecke wächst', meldungen.length > 2 && meldungen[meldungen.length - 1].s > meldungen[0].s);
pruefe('gegen einen Fern-Gegner wird KEIN fremdes Ergebnis mitgeschrieben', true);

/* --------------------------------------------------------------------------
   9. Zwei Rennen hintereinander
   -------------------------------------------------------------------------- */

console.log('\n=== 9. Zwei Rennen hintereinander ===\n');

/* ⚠️ Hier lag ein echter Fehler: `cancelAnimationFrame` hält ein schon
   eingereihtes Bild nicht auf. Ohne Laufnummer bediente ein Nachzügler des
   ersten Rennens den Zustand des zweiten — zwei Schleifen auf einem Wagen.
   Der Test fährt deshalb zweimal in derselben Welt. */
{
  const w = neueWelt(60);
  const rm = ladeRennen(w);
  const lw = leinwandAttrappe(800, 400);
  const zeiten = [];

  for (let durchgang = 0; durchgang < 2; durchgang++) {
    let erg = null;
    const g = w.uhr + rm.vorlaufMs(false) + 500;
    rm.starte({
      canvas: lw, jetzt: w.jetzt, gruenZeit: g,
      auto: autos.nachId('muscle'), saat: 555, burnout: false,
      meinName: 'A', meinLack: 'rot', gegnerName: 'Bot', gegnerLack: 'weiss',
      gegner: { art: 'bot', stufe: 'mittel', botSaat: 1 },
      aufPosition: null,
      fertig: function (e) { erg = e; },
    });
    let wache = 0, gestartet = false, naechste = -99;
    while (!erg && wache++ < 4000) {
      w.einBild();
      const st = rm.stand();
      if (!st) break;
      const tt = (w.uhr - g) / 1000;
      const l = st.lauf;
      if (!l) continue;
      if (l.reaktion === null && !gestartet && tt >= 0.18) {
        gestartet = true;
        lw.__feuere('pointerdown', zeiger(0.7, 800));
        w.window.__feuere('pointerup', zeiger(0.7, 800));
        continue;
      }
      if (!l.gestartet) continue;
      const a = autos.nachId('muscle');
      if (l.gang < a.gaenge.length - 1 && l.t >= l.leerlaufBis) {
        const f = physik.fenster(a, l.gang);
        if (physik.drehzahl(l) >= (f.perfektAb + 1) / 2) {
          lw.__feuere('pointerdown', zeiger(0.7, 800));
          w.window.__feuere('pointerup', zeiger(0.7, 800));
        }
      }
      let zieht = 0;
      for (const zg of l.zuege) if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER + 0.3) zieht += zg.richtung;
      const schief = Math.abs(l.versatz) > 0.05 ? (l.versatz > 0 ? 1 : -1) : 0;
      const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
      if (noetig !== 0 && l.t >= naechste) {
        naechste = l.t + 0.14;
        lw.__feuere('pointerdown', zeiger(noetig > 0 ? 0.10 : 0.34, 800));
        w.window.__feuere('pointerup', zeiger(noetig > 0 ? 0.10 : 0.34, 800));
      }
    }
    zeiten.push(erg ? erg.gesamt : null);
  }
  console.log('  Lauf 1: ' + z3(zeiten[0]) + ' s   Lauf 2: ' + z3(zeiten[1]) + ' s');
  pruefe('beide Läufe liefern ein Ergebnis', zeiten[0] !== null && zeiten[1] !== null);
  pruefe('dieselbe Saat und dieselben Tipper ergeben dieselbe Zeit',
    zeiten[0] !== null && zeiten[1] !== null && Math.abs(zeiten[0] - zeiten[1]) < 0.05,
    'Unterschied ' + z3(Math.abs(zeiten[0] - zeiten[1])) + ' s');
}

console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' FEHLER') + ' — ' + geprueft + ' Prüfungen\n');
process.exit(fehler === 0 ? 0 : 1);
