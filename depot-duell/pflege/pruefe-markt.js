/**
 * Prüft den Kursmotor. Aufruf: node pflege/pruefe-markt.js
 *
 * DREI FRAGEN, DIE HIER BEANTWORTET WERDEN:
 *
 * 1. BESTIMMTHEIT — liefert dieselbe Saat auf zwei Instanzen bitgleiche
 *    Kurse? Daran hängt das ganze Konzept: gäbe es die kleinste Abweichung,
 *    sähen zwei Handys verschiedene Kurse, ohne dass irgendetwas nach einem
 *    Fehler aussieht. Der Fehler fiele erst auf, wenn jemand behauptet, er
 *    habe billiger gekauft.
 *
 * 2. BALANCE — entscheidet bei fünf Jahren Zeitraffer noch Können, oder ist
 *    es Würfeln? Einzelne Testpartien zeigen das nicht; nur die Verteilung
 *    über viele Läufe. Gemessen wird die Spreizung der Endstände und wie oft
 *    ein Depot alles verliert oder absurd gewinnt.
 *
 * 3. PLAUSIBILITÄT — keine NaN, keine Nullkurse, keine Unendlichkeiten.
 *    Ein einziges NaN im Kurs reißt jede Depotberechnung mit.
 */

const fs = require('fs');
const path = require('path');

globalThis.nachrichten = require('../nachrichten.js');
const markt = require('../markt.js');

const werteSrc = fs.readFileSync(path.join(__dirname, '..', 'werte.js'), 'utf8');
const WERTE = new Function(werteSrc + '\nreturn WERTE;')();
const werte = WERTE.werte;

/* Gemessen wird an der mittleren Partielaenge. 50 Runden sind fuenf
   Boersenjahre - derselbe Zeitraum, den die Fassung mit Zeittakt hatte,
   die Balancezahlen bleiben also vergleichbar. */
const RUNDEN = 50;

let fehler = 0;
function pruefe(bedingung, text) {
  if (bedingung) { console.log('  OK   ' + text); }
  else { console.log('  FEHL ' + text); fehler++; }
}

/* ====================================================================== */
console.log('\n1. BESTIMMTHEIT');
/* ====================================================================== */

const a = markt.erzeuge(123456789, werte, RUNDEN);
const b = markt.erzeuge(123456789, werte, RUNDEN);
const c = markt.erzeuge(123456790, werte, RUNDEN);

let abweichungen = 0;
let verglichen = 0;
for (const w of werte) {
  for (let t = 0; t <= RUNDEN; t++) {
    verglichen++;
    if (a.kurse[w.id][t] !== b.kurse[w.id][t]) abweichungen++;
  }
}
pruefe(abweichungen === 0, verglichen + ' Kurswerte identisch bei gleicher Saat (' + abweichungen + ' Abweichungen)');

let meldungenGleich = a.meldungen.length === b.meldungen.length;
if (meldungenGleich) {
  for (let i = 0; i < a.meldungen.length; i++) {
    if (a.meldungen[i].text !== b.meldungen[i].text || a.meldungen[i].runde !== b.meldungen[i].runde) {
      meldungenGleich = false;
      break;
    }
  }
}
pruefe(meldungenGleich, a.meldungen.length + ' Meldungen identisch bei gleicher Saat');

/* Gegenprobe: eine ANDERE Saat muss etwas anderes liefern. Ohne diese Probe
   würde ein Motor, der stur immer dasselbe ausgibt, den Test oben bestehen. */
let unterschiedlich = 0;
for (const w of werte) {
  if (a.kurse[w.id][RUNDEN] !== c.kurse[w.id][RUNDEN]) unterschiedlich++;
}
pruefe(unterschiedlich === werte.length, 'andere Saat liefert andere Kurse (' + unterschiedlich + '/' + werte.length + ')');

/* ====================================================================== */
console.log('\n2. PLAUSIBILITÄT');
/* ====================================================================== */

let schlecht = 0;
let nullnah = 0;
for (const w of werte) {
  for (let t = 0; t <= RUNDEN; t++) {
    const k = a.kurse[w.id][t];
    if (!Number.isFinite(k) || k <= 0) schlecht++;
    if (k < w.kurs * 0.0011) nullnah++;
  }
}
pruefe(schlecht === 0, 'kein NaN, kein Nullkurs, kein Unendlich (' + schlecht + ' Treffer)');
pruefe(nullnah === 0, 'kein Kurs am Boden (' + nullnah + ' Treffer)');

const startStimmt = werte.every((w) => a.kurse[w.id][0] === w.kurs);
pruefe(startStimmt, 'Tick 0 entspricht exakt dem echten Startkurs');

/* KGV muss mitwandern statt eingefroren zu sein. */
const sap = werte.find((w) => w.kuerzel === 'SAP');
const kgvStart = markt.kgv(a, sap, 0);
const kgvEnde = markt.kgv(a, sap, RUNDEN);
pruefe(kgvStart !== null && Math.abs(kgvStart - sap.kgv) < 0.01, 'KGV bei Tick 0 = echtes KGV (' + (kgvStart || 0).toFixed(2) + ' vs ' + sap.kgv + ')');
pruefe(kgvEnde !== null && kgvEnde !== kgvStart, 'KGV wandert mit (' + (kgvStart || 0).toFixed(1) + ' -> ' + (kgvEnde || 0).toFixed(1) + ')');

/* Werte ohne KGV müssen sauber null liefern, nicht 0 oder NaN. */
const ohneKgv = werte.find((w) => w.art === 'aktie' && w.kgv === null);
pruefe(markt.kgv(a, ohneKgv, 50) === null, 'Wert ohne KGV liefert null statt einer erfundenen Zahl (' + ohneKgv.name + ')');

/* ====================================================================== */
console.log('\n3. BALANCE über 300 Partien');
/* ====================================================================== */

const LAEUFE = 300;
const endstaende = { aktie: [], etf: [], krypto: [] };
const alleEnden = [];
let meldungssumme = 0;
const start = Date.now();

for (let i = 0; i < LAEUFE; i++) {
  const lauf = markt.erzeuge(1000 + i * 7919, werte, RUNDEN);
  meldungssumme += lauf.meldungen.length;
  for (const w of werte) {
    const rendite = (lauf.kurse[w.id][RUNDEN] / w.kurs - 1) * 100;
    endstaende[w.art].push(rendite);
    alleEnden.push(rendite);
  }
}
const dauer = Date.now() - start;

function stat(liste) {
  const s = liste.slice().sort((x, y) => x - y);
  const mittel = s.reduce((p, q) => p + q, 0) / s.length;
  return {
    mittel: mittel,
    median: s[Math.floor(s.length / 2)],
    p5: s[Math.floor(s.length * 0.05)],
    p95: s[Math.floor(s.length * 0.95)],
    min: s[0],
    max: s[s.length - 1],
  };
}

for (const art of ['aktie', 'etf', 'krypto']) {
  const s = stat(endstaende[art]);
  console.log(
    '  ' + art.padEnd(7) +
    ' Median ' + s.median.toFixed(0).padStart(6) + '%' +
    '   5%-Quantil ' + s.p5.toFixed(0).padStart(6) + '%' +
    '   95%-Quantil ' + s.p95.toFixed(0).padStart(7) + '%' +
    '   Spanne ' + s.min.toFixed(0) + '% bis ' + s.max.toFixed(0) + '%'
  );
}

const g = stat(alleEnden);
console.log('\n  Meldungen je Partie: ' + Math.round(meldungssumme / LAEUFE));
console.log('  Rechenzeit je Partie: ' + (dauer / LAEUFE).toFixed(1) + ' ms');

/* Bewertungsmaßstäbe für die Spielbarkeit: */
pruefe(dauer / LAEUFE < 60, 'Rechenzeit unter 60 ms je Partie (' + (dauer / LAEUFE).toFixed(1) + ' ms) — sonst ruckelt der Partiestart');

const totalverlust = alleEnden.filter((r) => r < -90).length / alleEnden.length;
pruefe(totalverlust < 0.02, 'unter 2 % der Werte verlieren mehr als 90 % (' + (totalverlust * 100).toFixed(2) + ' %)');

const aktienStat = stat(endstaende.aktie);
pruefe(aktienStat.p95 > 60 && aktienStat.p95 < 900, 'Aktien-Oberfeld liegt zwischen +60 % und +900 % (' + aktienStat.p95.toFixed(0) + ' %) — genug Spreizung, kein Irrsinn');
pruefe(aktienStat.p5 < -20, 'es gibt echte Verlierer (5%-Quantil ' + aktienStat.p5.toFixed(0) + ' %)');

const etfStat = stat(endstaende.etf);
const aktieSpanne = aktienStat.p95 - aktienStat.p5;
const etfSpanne = etfStat.p95 - etfStat.p5;
pruefe(etfSpanne < aktieSpanne, 'ETFs schwanken weniger als Einzelaktien (' + etfSpanne.toFixed(0) + ' vs ' + aktieSpanne.toFixed(0) + ' Punkte) — sonst wäre Streuen sinnlos');

const kryptoStat = stat(endstaende.krypto);
pruefe(kryptoStat.p95 - kryptoStat.p5 > aktieSpanne, 'Krypto schwankt am stärksten — die Zockeroption muss sich anfühlen wie eine');

/* Anleihen-ETFs müssen der ruhige Hafen sein, sonst hat die Anlageklasse
   im Spiel keinen Zweck. */
const anleihen = werte.filter((w) => w.anlageklasse === 'Anleihen').map((w) => w.id);
const anleiheRenditen = [];
for (let i = 0; i < 60; i++) {
  const lauf = markt.erzeuge(50000 + i * 31, werte, RUNDEN);
  for (const id of anleihen) anleiheRenditen.push((lauf.kurse[id][RUNDEN] / lauf.kurse[id][0] - 1) * 100);
}
const anleiheStat = stat(anleiheRenditen);
pruefe(anleiheStat.p95 - anleiheStat.p5 < 90, 'Anleihen-ETFs bleiben ruhig (Spanne ' + (anleiheStat.p95 - anleiheStat.p5).toFixed(0) + ' Punkte)');

/* ====================================================================== */
console.log('\n4. MELDUNGEN');
/* ====================================================================== */

const arten = { wert: 0, gruppe: 0, markt: 0 };
let geruechte = 0;
let aufloesungen = 0;
for (const m of a.meldungen) {
  arten[m.zielArt]++;
  if (m.geruecht) geruechte++;
  if (m.aufloesung) aufloesungen++;
}
console.log('  Einzelwert ' + arten.wert + ' | Gruppe ' + arten.gruppe + ' | Gesamtmarkt ' + arten.markt +
  ' | davon Gerüchte ' + geruechte + ', Auflösungen ' + aufloesungen);
pruefe(arten.gruppe + arten.markt > 0, 'es gibt Meldungen, die viele Depots gleichzeitig treffen');
pruefe(geruechte > 0 && aufloesungen >= geruechte - 2, 'nahezu jedes Gerücht wird später aufgelöst (' + aufloesungen + '/' + geruechte + ')');
pruefe(a.meldungen.every((m) => m.text.indexOf('{') === -1), 'kein Platzhalter blieb unersetzt stehen');

/* ====================================================================== */
console.log('\n5. RUNDENSPRÜNGE UND NACHRICHTENWIRKUNG');
/* ======================================================================

   DIE ENTSCHEIDENDE MESSUNG DES RUNDENMODUS.

   Das ganze Spielkonzept steht und fällt damit, dass eine Meldung sich im
   nächsten Kursschritt tatsächlich bemerkbar macht. Geht sie im normalen
   Rauschen unter, liest man sie, handelt danach — und es passiert nichts
   Erkennbares. Dann wäre das Spiel Würfeln mit Deko.

   Zu stark darf sie aber auch nicht sein: dann wäre jede Meldung eine
   sichere Bank, jeder handelt gleich, und die Rangliste entschiede sich
   allein daran, wer am schnellsten tippt.
   ====================================================================== */

const spruenge = { aktie: [], etf: [], krypto: [] };
const treffer = { wert: [0, 0], gruppe: [0, 0], markt: [0, 0] };
const ohneMeldung = [0, 0];

for (let i = 0; i < 120; i++) {
  const lauf = markt.erzeuge(700000 + i * 3571, werte, RUNDEN);

  /* Welche Werte hatten in welcher Runde eine Meldung? */
  const getroffen = {};   // 'runde|id' -> Richtung
  for (const m of lauf.meldungen) {
    let ziele;
    if (m.zielArt === 'wert') ziele = [m.ziel];
    else if (m.zielArt === 'gruppe') ziele = werte.filter((w) => nachrichten.gruppeVon(w) === m.ziel).map((w) => w.id);
    else ziele = werte.map((w) => w.id);
    for (const id of ziele) {
      const s = m.runde + '|' + id;
      /* Bei mehreren Meldungen auf denselben Wert zählt die Summe der
         Richtungen — sonst würde eine gute und eine schlechte Meldung als
         Fehlschlag gewertet, obwohl sie sich zu Recht aufheben. */
      getroffen[s] = (getroffen[s] || 0) + m.richtung * m.staerke;
      if (!getroffen[s + '|art'] || m.zielArt === 'wert') getroffen[s + '|art'] = m.zielArt;
    }
  }

  for (const w of werte) {
    for (let r = 1; r <= RUNDEN; r++) {
      const bewegung = lauf.kurse[w.id][r] / lauf.kurse[w.id][r - 1] - 1;
      spruenge[w.art].push(Math.abs(bewegung) * 100);

      const s = (r - 1) + '|' + w.id;
      const wirkung = getroffen[s];
      if (wirkung === undefined || Math.abs(wirkung) < 1e-9) {
        ohneMeldung[1]++;
        if (bewegung > 0) ohneMeldung[0]++;
      } else {
        const art = getroffen[s + '|art'];
        treffer[art][1]++;
        if ((wirkung > 0) === (bewegung > 0)) treffer[art][0]++;
      }
    }
  }
}

function quantil(liste, q) {
  const s = liste.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length * q)];
}

for (const art of ['aktie', 'etf', 'krypto']) {
  console.log('  ' + art.padEnd(7) + ' Sprung je Runde: Median ' +
    quantil(spruenge[art], 0.5).toFixed(1).padStart(5) + ' %   95%-Quantil ' +
    quantil(spruenge[art], 0.95).toFixed(1).padStart(6) + ' %');
}

const grundQuote = ohneMeldung[0] / ohneMeldung[1];
console.log('\n  Ohne Meldung steigt ein Wert in ' + (grundQuote * 100).toFixed(1) + ' % der Runden');
for (const art of ['wert', 'gruppe', 'markt']) {
  const q = treffer[art][1] ? treffer[art][0] / treffer[art][1] : 0;
  console.log('  ' + art.padEnd(7) + ' Meldung trifft die Richtung in ' + (q * 100).toFixed(1) +
    ' % der Fälle  (' + treffer[art][1].toLocaleString('de-DE') + ' Beobachtungen)');
}

for (const art of ['wert', 'gruppe', 'markt']) {
  const q = treffer[art][0] / treffer[art][1];
  pruefe(q > 0.62, art + '-Meldung weist die Richtung deutlich (' + (q * 100).toFixed(1) +
    ' % gegen ' + (grundQuote * 100).toFixed(1) + ' % Grundquote) — sonst geht sie im Rauschen unter');
  pruefe(q < 0.95, art + '-Meldung ist keine sichere Bank (' + (q * 100).toFixed(1) +
    ' %) — sonst gewinnt nur, wer am schnellsten tippt');
}

pruefe(quantil(spruenge.aktie, 0.5) < 12, 'eine Aktie springt im Median unter 12 % je Runde (' +
  quantil(spruenge.aktie, 0.5).toFixed(1) + ' %) — sonst ist jede Runde ein Würfelwurf');
pruefe(quantil(spruenge.etf, 0.5) < quantil(spruenge.aktie, 0.5), 'ETFs springen ruhiger als Aktien');

/* ====================================================================== */
console.log('\n6. AUSREISSER NAMENTLICH');
/* ======================================================================
   Eine Spanne von mehreren zehntausend Prozent in der ETF-Zeile ist als
   Zahl nicht zu beurteilen — sie kann ein Fehler sein oder der
   Krypto-ETF, der sich zu Recht wie Krypto verhält. Deshalb wird der
   Ausreißer beim Namen genannt statt in einer Quantilszeile zu
   verschwinden.
   ====================================================================== */

const extrem = {};
for (let i = 0; i < 120; i++) {
  const lauf = markt.erzeuge(1000 + i * 7919, werte, RUNDEN);
  for (const w of werte) {
    const r = (lauf.kurse[w.id][RUNDEN] / w.kurs - 1) * 100;
    if (!extrem[w.id] || r > extrem[w.id].max) extrem[w.id] = { max: r, wert: w };
  }
}
const spitze = Object.values(extrem).sort((a, b) => b.max - a.max).slice(0, 3);
for (const e of spitze) {
  console.log('  Bestes gemessenes Ergebnis: ' + e.wert.name + ' (' + e.wert.art +
    (e.wert.anlageklasse ? ', ' + e.wert.anlageklasse : '') + ') ' + e.max.toFixed(0) + ' %');
}
const nurWildeKlassen = spitze.every((e) => e.wert.art === 'krypto' || e.wert.anlageklasse === 'Krypto' ||
  (e.wert.art === 'aktie' && ['Halbleiter', 'Technologie', 'Ruestung'].indexOf(e.wert.sektor) >= 0));
pruefe(nurWildeKlassen, 'die Extremwerte stammen aus den bewusst wilden Klassen, nicht aus den ruhigen');

/* ====================================================================== */
console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' PRÜFUNG(EN) FEHLGESCHLAGEN'));
process.exit(fehler === 0 ? 0 : 1);
