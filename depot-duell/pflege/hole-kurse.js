/**
 * Holt die Kurse und Kennzahlen fuer die woechentliche Pflegerunde und
 * traegt sie in die Tabellen von baue-werte.js ein.
 *
 * Aufruf:
 *   node pflege/hole-kurse.js              nur abrufen und zeigen, was sich aendert
 *   node pflege/hole-kurse.js --schreiben  die Zahlen in baue-werte.js ersetzen
 *   node pflege/hole-kurse.js --pruefe q1 q2 ...   einzelne Quellen antesten
 *
 * WARUM DIESES SKRIPT:
 * 250 Kurse, 250 KGV und 250 Dividendenrenditen von Hand abzuschreiben ist
 * dieselbe Fehlerquelle, gegen die baue-werte.js schon gebaut wurde - nur
 * viermal so gross. Das Skript liest die Tabellen, ruft je Wert seine Quelle
 * ab und schreibt die Zahlen zurueck. Die Tabellen selbst (welcher Wert,
 * welcher Sektor, welches Land) bleiben Handarbeit und damit nachvollziehbar.
 *
 * DIE QUELLEN sind je Wert in der letzten Spalte hinterlegt:
 *   stocks/nvda        Aktie an einer US-Boerse
 *   quote/etr/SAP      Aktie an einer auslaendischen Boerse (etr, epa, ams,
 *                      bit, bme, ebr, lon, swx, tyo, tsx, krx, hkg)
 *   etf/voo            ETF
 *   coingecko/bitcoin  Kryptowaehrung
 *
 * Die drei stockanalysis-Formen liefern alle dieselbe SvelteKit-Datenstruktur
 * unter <pfad>/__data.json - Kurs, Waehrung, KGV, Dividendenrendite und bei
 * ETFs zusaetzlich Fondsvolumen, Anzahl Positionen, TER und Zahlrhythmus.
 * Ein Abruf je Wert, kein Bildschirmabschreiben.
 *
 * WAS NICHT GESCHRIEBEN WIRD:
 * Fehlt ein KURS, bricht das Skript ab und laesst baue-werte.js unberuehrt -
 * eine halb aktualisierte Tabelle waere schlimmer als eine alte. Fehlt eine
 * KENNZAHL (KGV, Dividende, TER), wird sie null; die App zeigt dann einen
 * Strich. Geschaetzt wird nichts.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ZIEL = path.join(__dirname, 'baue-werte.js');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// Gleichzeitige Abrufe. Hoeher waere schneller, provoziert aber Sperren -
// und eine Pflegerunde, die einmal die Woche laeuft, darf zwei Minuten dauern.
const PARALLEL = 4;

/* =========================================================================
   Netz
   ========================================================================= */

function hole(url, versuch) {
  versuch = versuch || 1;
  return new Promise((erfuellt, abgelehnt) => {
    const anfrage = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' }, timeout: 30000 },
      (antwort) => {
        if (antwort.statusCode >= 300 && antwort.statusCode < 400 && antwort.headers.location) {
          antwort.resume();
          erfuellt(hole(new URL(antwort.headers.location, url).href, versuch));
          return;
        }
        let text = '';
        antwort.on('data', (stueck) => (text += stueck));
        antwort.on('end', () => {
          if (antwort.statusCode !== 200) {
            abgelehnt(new Error('HTTP ' + antwort.statusCode));
            return;
          }
          erfuellt(text);
        });
      }
    );
    anfrage.on('timeout', () => anfrage.destroy(new Error('Zeitueberschreitung')));
    anfrage.on('error', (f) => {
      // Ein einzelner Aussetzer soll nicht die ganze Pflegerunde kosten.
      if (versuch < 3) setTimeout(() => erfuellt(hole(url, versuch + 1)), 800 * versuch);
      else abgelehnt(f);
    });
  });
}

async function nacheinander(liste, arbeit) {
  const ergebnis = new Array(liste.length);
  let naechster = 0;
  async function laufe() {
    while (naechster < liste.length) {
      const i = naechster++;
      try {
        ergebnis[i] = await arbeit(liste[i], i);
      } catch (f) {
        ergebnis[i] = { fehler: f.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, liste.length) }, laufe));
  return ergebnis;
}

/* =========================================================================
   SvelteKit-Datenformat aufloesen

   stockanalysis liefert seine Seitendaten im devalue-Format: ein flaches
   Array, in dem jedes Feld auf einen Index zeigt. WICHTIG - ein Index wird
   GENAU EINMAL aufgeloest. Waere die Aufloesung rekursiv, wuerde ein echter
   Zahlenwert (Kurs 4358) als weiterer Index gelesen und man landete in einem
   voellig fremden Datensatz, ohne dass etwas nach einem Fehler aussieht.
   ========================================================================= */

function knotenAus(text) {
  const j = JSON.parse(text);
  if (!j || !Array.isArray(j.nodes)) return [];
  const treffer = [];
  for (const n of j.nodes) {
    if (!n || n.type !== 'data' || !Array.isArray(n.data)) continue;
    const D = n.data;
    const wurzel = D[0];
    if (!wurzel || typeof wurzel !== 'object' || Array.isArray(wurzel)) continue;
    const hol = function (idx, tiefe) {
      const x = D[idx];
      if (tiefe > 4) return x;
      if (Array.isArray(x)) return x.map((i) => hol(i, tiefe + 1));
      if (x && typeof x === 'object') {
        const o = {};
        for (const k of Object.keys(x)) o[k] = hol(x[k], tiefe + 1);
        return o;
      }
      return x;
    };
    treffer.push(hol(0, 0));
  }
  return treffer;
}

// "34.30" -> 34.3 · "1.46%" -> 1.46 · "$1.00 (0.45%)" -> 0.45 · "-"/"n/a" -> null
function zahl(roh) {
  if (roh === null || roh === undefined) return null;
  if (typeof roh === 'number') return Number.isFinite(roh) ? roh : null;
  const t = String(roh).trim();
  if (!t || t === '-' || t === 'n/a' || t === 'N/A') return null;
  const klammer = t.match(/\(([-\d.,]+)%\)/);
  const kern = klammer ? klammer[1] : t.replace(/[$%\s]/g, '').replace(/,/g, '');
  const w = parseFloat(kern);
  return Number.isFinite(w) ? w : null;
}

// "$1.03T" -> 1030 (Milliarden) · "$47.5B" -> 47.5 · "$980.2M" -> 0.9802
function milliarden(roh) {
  if (!roh) return null;
  const t = String(roh).replace(/[$,\s]/g, '');
  const w = parseFloat(t);
  if (!Number.isFinite(w)) return null;
  if (/T$/i.test(t)) return Math.round(w * 1000 * 10) / 10;
  if (/B$/i.test(t)) return Math.round(w * 10) / 10;
  if (/M$/i.test(t)) return Math.round((w / 1000) * 10) / 10;
  return Math.round((w / 1e9) * 10) / 10;
}

/* =========================================================================
   Ein Wert, eine Quelle
   ========================================================================= */

async function holeVonStockanalysis(quelle) {
  const text = await hole('https://stockanalysis.com/' + quelle + '/__data.json');
  const knoten = knotenAus(text);
  if (!knoten.length) throw new Error('Seite liefert keine Daten (Kuerzel falsch?)');

  let info = null;
  let kennzahlen = null;
  for (const o of knoten) {
    if (o && o.info && o.info.quote) info = o.info;
    if (o && (o.peRatio !== undefined || o.expenseRatio !== undefined || o.aum !== undefined)) kennzahlen = o;
  }
  if (!info) throw new Error('kein Kursblock');

  const k = kennzahlen || {};
  const kurs = zahl(info.quote.p);
  let waehrung = (info.curr && info.curr.price) || 'USD';

  // London notiert in Pence (GBX). Wer das uebersieht, hat Shell mit dem
  // Hundertfachen im Spiel - und es faellt nicht auf, weil 3277 eine
  // plausible Zahl ist.
  if (info.quote && typeof info.quote.p === 'number' && /^\/quote\/lon\//.test(info.bu || '')) waehrung = 'GBX';

  return {
    name: info.nameFull || info.name || null,
    kurs: kurs,
    waehrung: waehrung,
    kgv: zahl(k.peRatio),
    divRendite: zahl(k.dividendYield) !== null ? zahl(k.dividendYield) : zahl(k.dividend),
    // Nur bei ETFs belegt:
    fondsvolumenMrd: milliarden(k.aum),
    anzahlPositionen: typeof k.holdings === 'number' ? k.holdings : null,
    ter: zahl(k.expenseRatio),
    // Ein US-ETF, der einen Zahlrhythmus meldet, schuettet aus. GLD und IBIT
    // halten einen Sachwert und melden keinen - genau die beiden Ausnahmen,
    // die auch von Hand als thesaurierend gefuehrt waren.
    ausschuettend: k.payoutFrequency ? true : k.aum !== undefined ? false : null,
  };
}

async function holeKrypto(ids) {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&ids=' +
    ids.join(',') +
    '&per_page=250&price_change_percentage=24h';
  const liste = JSON.parse(await hole(url));
  const nach = {};
  for (const m of liste) {
    nach[m.id] = {
      name: m.name,
      kurs: m.current_price,
      marktkapitalisierung: m.market_cap,
      umlaufmenge: m.circulating_supply,
      hoechstmenge: m.max_supply === null ? null : m.max_supply,
      allzeithoch: m.ath,
    };
  }
  return nach;
}

async function holeWechselkurse(waehrungen) {
  const noetig = waehrungen.filter((w) => w !== 'EUR' && w !== 'GBX');
  if (waehrungen.indexOf('GBX') >= 0 && noetig.indexOf('GBP') < 0) noetig.push('GBP');
  const antwort = JSON.parse(
    await hole('https://api.frankfurter.dev/v1/latest?from=EUR&to=' + noetig.join(','))
  );
  return { datum: antwort.date, kurse: antwort.rates };
}

/* =========================================================================
   Die Tabellen in baue-werte.js lesen und schreiben

   Gearbeitet wird zeilenweise: eine Datenzeile beginnt mit "[", alles andere
   (Abschnittskommentare, Leerzeilen) wandert unveraendert mit. Damit bleibt
   die Datei nach dem Schreiben so lesbar wie vorher.
   ========================================================================= */

function findeBlock(text, name) {
  const anfang = text.indexOf('const ' + name + ' = [');
  if (anfang < 0) throw new Error('Tabelle ' + name + ' nicht gefunden');
  const von = text.indexOf('[', anfang) + 1;
  let tiefe = 1;
  let i = von;
  let inText = null;
  while (i < text.length && tiefe > 0) {
    const c = text[i];
    if (inText) {
      if (c === '\\') i++;
      else if (c === inText) inText = null;
    } else if (c === "'" || c === '"') inText = c;
    else if (c === '[') tiefe++;
    else if (c === ']') tiefe--;
    i++;
  }
  return { von: von, bis: i - 1, inhalt: text.slice(von, i - 1) };
}

function leseZeilen(inhalt) {
  const zeilen = [];
  for (const roh of inhalt.split('\n')) {
    const t = roh.trim();
    if (!t.startsWith('[')) {
      zeilen.push({ art: 'text', roh: roh });
      continue;
    }
    let felder;
    try {
      felder = new Function('return ' + t.replace(/,\s*$/, ''))();
    } catch (f) {
      throw new Error('Zeile nicht lesbar: ' + t.slice(0, 60));
    }
    zeilen.push({ art: 'wert', felder: felder });
  }
  return zeilen;
}

function alsQuelltext(wert) {
  if (wert === null) return 'null';
  if (typeof wert === 'string') return "'" + wert.replace(/'/g, "\\'") + "'";
  return String(wert);
}

// Spaltenweise ausrichten: eine Tabelle, in der die Kurse untereinander
// stehen, laesst einen Zahlendreher mit blossem Auge auffallen.
function schreibeZeilen(zeilen, einzug) {
  const breiten = [];
  for (const z of zeilen) {
    if (z.art !== 'wert') continue;
    z.felder.forEach((f, i) => {
      const s = alsQuelltext(f);
      breiten[i] = Math.max(breiten[i] || 0, s.length);
    });
  }
  const aus = [];
  for (const z of zeilen) {
    if (z.art === 'text') {
      aus.push(z.roh);
      continue;
    }
    const teile = z.felder.map((f, i) => {
      const s = alsQuelltext(f);
      const letzte = i === z.felder.length - 1;
      if (letzte) return s;
      // Zahlen rechtsbuendig, Text linksbuendig.
      return typeof f === 'number' ? ' '.repeat(breiten[i] - s.length) + s : s + ' '.repeat(breiten[i] - s.length);
    });
    aus.push(einzug + '[' + teile.join(', ') + '],');
  }
  return aus.join('\n');
}

/* =========================================================================
   Ablauf
   ========================================================================= */

function felderVon(art) {
  // Position der Spalten in den Tabellen von baue-werte.js.
  if (art === 'AKTIEN') return { kuerzel: 1, kurs: 2, waehrung: 3, kgv: 4, div: 5, quelle: 8 };
  if (art === 'ETFS') return { kuerzel: 1, kurs: 2, volumen: 3, positionen: 4, ter: 5, ausschuettend: 6, quelle: 9 };
  return { kuerzel: 1, kurs: 2, marktkap: 3, umlauf: 4, hoechst: 5, ath: 6, quelle: 7 };
}

async function main() {
  const argumente = process.argv.slice(2);
  const schreiben = argumente.indexOf('--schreiben') >= 0;

  if (argumente[0] === '--pruefe') {
    for (const q of argumente.slice(1)) {
      try {
        const d = await holeVonStockanalysis(q);
        console.log('OK   ' + q + '  ' + d.name + '  ' + d.kurs + ' ' + d.waehrung + '  KGV ' + d.kgv + '  Div ' + d.divRendite);
      } catch (f) {
        console.log('FEHL ' + q + '  ' + f.message);
      }
    }
    return;
  }

  const text = fs.readFileSync(ZIEL, 'utf8');
  const bloecke = {};
  for (const name of ['AKTIEN', 'ETFS', 'KRYPTO']) {
    const b = findeBlock(text, name);
    bloecke[name] = { block: b, zeilen: leseZeilen(b.inhalt) };
  }

  const aufgaben = [];
  for (const name of ['AKTIEN', 'ETFS']) {
    const s = felderVon(name);
    for (const z of bloecke[name].zeilen) {
      if (z.art !== 'wert') continue;
      aufgaben.push({ name: name, zeile: z, quelle: z.felder[s.quelle], kuerzel: z.felder[s.kuerzel] });
    }
  }
  const kryptoSpalten = felderVon('KRYPTO');
  const kryptoZeilen = bloecke.KRYPTO.zeilen.filter((z) => z.art === 'wert');

  console.log('Abrufen: ' + aufgaben.length + ' Wertpapiere, ' + kryptoZeilen.length + ' Kryptowaehrungen ...');

  const ergebnisse = await nacheinander(aufgaben, async (a) => {
    if (!a.quelle) throw new Error('keine Quelle hinterlegt');
    return await holeVonStockanalysis(a.quelle);
  });

  const kryptoIds = kryptoZeilen.map((z) => String(z.felder[kryptoSpalten.quelle]).replace(/^coingecko\//, ''));
  let kryptoDaten = {};
  let kryptoFehler = null;
  try {
    kryptoDaten = await holeKrypto(kryptoIds);
  } catch (f) {
    kryptoFehler = f.message;
  }

  /* --- Auswerten. Ein fehlender KURS ist ein Abbruchgrund, eine fehlende
         Kennzahl nicht. --- */
  const abbruch = [];
  const hinweise = [];
  const aenderungen = [];
  const waehrungen = new Set(['EUR']);

  ergebnisse.forEach((d, i) => {
    const a = aufgaben[i];
    if (!d || d.fehler || !(d.kurs > 0)) {
      abbruch.push(a.kuerzel + ' (' + a.quelle + '): ' + ((d && d.fehler) || 'kein Kurs'));
      return;
    }
    waehrungen.add(d.waehrung);
    const s = felderVon(a.name);
    const f = a.zeile.felder;
    const alt = f[s.kurs];

    if (a.name === 'AKTIEN') {
      if (f[s.waehrung] !== d.waehrung) {
        hinweise.push(a.kuerzel + ': Waehrung ' + f[s.waehrung] + ' -> ' + d.waehrung);
        f[s.waehrung] = d.waehrung;
      }
      f[s.kurs] = d.kurs;
      f[s.kgv] = d.kgv !== null && d.kgv > 0 ? d.kgv : null;
      f[s.div] = d.divRendite !== null && d.divRendite > 0 ? d.divRendite : 0;
      if (f[s.kgv] === null) hinweise.push(a.kuerzel + ': kein KGV -> Strich in der App');
    } else {
      f[s.kurs] = d.kurs;
      if (d.fondsvolumenMrd !== null) f[s.volumen] = d.fondsvolumenMrd;
      if (d.anzahlPositionen !== null) f[s.positionen] = d.anzahlPositionen;
      f[s.ter] = d.ter;
      f[s.ausschuettend] = d.ausschuettend;
      if (d.ter === null) hinweise.push(a.kuerzel + ': keine TER -> Strich in der App');
      if (d.waehrung !== 'USD') hinweise.push(a.kuerzel + ': ETF notiert in ' + d.waehrung + ', erwartet USD');
    }
    if (alt !== f[s.kurs]) {
      const prozent = alt > 0 ? ((f[s.kurs] - alt) / alt) * 100 : 0;
      aenderungen.push({ kuerzel: a.kuerzel, alt: alt, neu: f[s.kurs], prozent: prozent });
    }
  });

  if (kryptoFehler) {
    abbruch.push('CoinGecko nicht erreichbar: ' + kryptoFehler);
  } else {
    kryptoZeilen.forEach((z, i) => {
      const id = kryptoIds[i];
      const d = kryptoDaten[id];
      const s = kryptoSpalten;
      if (!d || !(d.kurs > 0)) {
        abbruch.push(z.felder[s.kuerzel] + ' (coingecko/' + id + '): kein Kurs');
        return;
      }
      const alt = z.felder[s.kurs];
      z.felder[s.kurs] = d.kurs;
      z.felder[s.marktkap] = d.marktkapitalisierung;
      z.felder[s.umlauf] = Math.round(d.umlaufmenge);
      z.felder[s.hoechst] = d.hoechstmenge === null ? null : Math.round(d.hoechstmenge);
      z.felder[s.ath] = d.allzeithoch;
      if (alt !== d.kurs) {
        aenderungen.push({
          kuerzel: z.felder[s.kuerzel],
          alt: alt,
          neu: d.kurs,
          prozent: alt > 0 ? ((d.kurs - alt) / alt) * 100 : 0,
        });
      }
    });
  }

  /* --- Wechselkurse --- */
  let devisen = null;
  try {
    devisen = await holeWechselkurse(Array.from(waehrungen));
  } catch (f) {
    abbruch.push('Wechselkurse nicht erreichbar: ' + f.message);
  }

  /* --- Bericht --- */
  aenderungen.sort((a, b) => Math.abs(b.prozent) - Math.abs(a.prozent));
  console.log('\nGroesste Kursbewegungen seit dem letzten Lauf:');
  for (const a of aenderungen.slice(0, 12)) {
    console.log(
      '  ' + a.kuerzel.padEnd(7) + String(a.alt).padStart(12) + ' -> ' + String(a.neu).padStart(12) +
      '  ' + (a.prozent >= 0 ? '+' : '') + a.prozent.toFixed(1) + ' %'
    );
  }
  console.log('  (' + aenderungen.length + ' Werte insgesamt veraendert)');

  if (hinweise.length) {
    console.log('\nHinweise (kein Abbruchgrund, die App zeigt dort einen Strich):');
    for (const h of hinweise) console.log('  - ' + h);
  }

  if (abbruch.length) {
    console.error('\nABBRUCH - baue-werte.js wurde NICHT angefasst:');
    for (const f of abbruch) console.error('  - ' + f);
    process.exit(1);
  }

  if (devisen) {
    console.log('\nWechselkurse (EZB via frankfurter.dev, ' + devisen.datum + '):');
    for (const w of Object.keys(devisen.kurse)) console.log('  1 EUR = ' + devisen.kurse[w] + ' ' + w);
  }

  if (!schreiben) {
    console.log('\nTrockenlauf. Mit --schreiben werden die Zahlen in baue-werte.js eingetragen.');
    return;
  }

  /* --- Schreiben. Von hinten nach vorne, damit die vorher ermittelten
         Blockgrenzen gueltig bleiben. --- */
  let neu = text;
  for (const name of ['KRYPTO', 'ETFS', 'AKTIEN']) {
    const b = bloecke[name].block;
    const einzug = name === 'AKTIEN' ? '  ' : '  ';
    neu = neu.slice(0, b.von) + '\n' + schreibeZeilen(bloecke[name].zeilen, einzug) + '\n' + neu.slice(b.bis);
  }

  const heute = new Date().toISOString().slice(0, 10);
  neu = neu.replace(/const STAND = '[^']*';/, "const STAND = '" + heute + "';");
  if (devisen) {
    const usd = devisen.kurse.USD;
    neu = neu.replace(
      /const EUR_USD = [0-9.]+;[^\n]*/,
      'const EUR_USD = ' + usd + '; // 1 EUR = ' + usd + ' USD (EZB via frankfurter.dev, ' + devisen.datum + ')'
    );
    const block = Object.keys(devisen.kurse)
      .sort()
      .map((w) => '  ' + w + ': ' + devisen.kurse[w] + ',')
      .join('\n');
    neu = neu.replace(/const WECHSELKURSE = \{[\s\S]*?\n\};/, 'const WECHSELKURSE = {\n' + block + '\n};');
  }

  fs.writeFileSync(ZIEL, neu, 'utf8');
  console.log('\nbaue-werte.js aktualisiert. Stand ' + heute + '.');
  console.log('Weiter mit: node pflege/baue-werte.js');
}

main().catch((f) => {
  console.error('ABBRUCH: ' + f.message);
  process.exit(1);
});
