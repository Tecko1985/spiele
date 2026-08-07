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

let fehler = 0;
function pruefe(bedingung, text) {
  if (bedingung) { console.log('  OK   ' + text); }
  else { console.log('  FEHL ' + text); fehler++; }
}

/* ====================================================================== */
console.log('\n1. BESTIMMTHEIT');
/* ====================================================================== */

const a = markt.erzeuge(123456789, werte);
const b = markt.erzeuge(123456789, werte);
const c = markt.erzeuge(123456790, werte);

let abweichungen = 0;
let verglichen = 0;
for (const w of werte) {
  for (let t = 0; t <= markt.TICKS; t++) {
    verglichen++;
    if (a.kurse[w.id][t] !== b.kurse[w.id][t]) abweichungen++;
  }
}
pruefe(abweichungen === 0, verglichen + ' Kurswerte identisch bei gleicher Saat (' + abweichungen + ' Abweichungen)');

let meldungenGleich = a.meldungen.length === b.meldungen.length;
if (meldungenGleich) {
  for (let i = 0; i < a.meldungen.length; i++) {
    if (a.meldungen[i].text !== b.meldungen[i].text || a.meldungen[i].tick !== b.meldungen[i].tick) {
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
  if (a.kurse[w.id][markt.TICKS] !== c.kurse[w.id][markt.TICKS]) unterschiedlich++;
}
pruefe(unterschiedlich === werte.length, 'andere Saat liefert andere Kurse (' + unterschiedlich + '/' + werte.length + ')');

/* ====================================================================== */
console.log('\n2. PLAUSIBILITÄT');
/* ====================================================================== */

let schlecht = 0;
let nullnah = 0;
for (const w of werte) {
  for (let t = 0; t <= markt.TICKS; t++) {
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
const kgvEnde = markt.kgv(a, sap, markt.TICKS);
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
  const lauf = markt.erzeuge(1000 + i * 7919, werte);
  meldungssumme += lauf.meldungen.length;
  for (const w of werte) {
    const rendite = (lauf.kurse[w.id][markt.TICKS] / w.kurs - 1) * 100;
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
  const lauf = markt.erzeuge(50000 + i * 31, werte);
  for (const id of anleihen) anleiheRenditen.push((lauf.kurse[id][markt.TICKS] / lauf.kurse[id][0] - 1) * 100);
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
console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' PRÜFUNG(EN) FEHLGESCHLAGEN'));
process.exit(fehler === 0 ? 0 : 1);
