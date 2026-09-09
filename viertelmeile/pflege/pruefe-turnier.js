/* ==========================================================================
   Prüfstand für die Turnierformen von Viertelmeile
   ==========================================================================
   Aufruf:  node pflege/pruefe-turnier.js

   Geprüft wird der ECHTE turnier.js, den auch der Browser lädt.

   Was belegt werden muss:
     1. Liga bis 10: jeder fährt gegen JEDEN, genau einmal.
     2. Liga ab 11: 7 Runden, jeder fährt in jeder Runde genau einmal.
     3. Ungerade Zahl: in jeder Runde bekommt genau EINER den Bot, und über
        das Turnier verteilt trifft es jeden gleich oft.
     4. K.-o.: jede Teilnehmerzahl von 2 bis 20 spielt einen Sieger aus.
     5. Ab dem Halbfinale sind zwei Siege nötig, davor einer.
     6. Die Tabelle sortiert nach Siegen, dann nach bester Zeit.
   ========================================================================== */

const turnier = require('../turnier.js');

let fehler = 0, geprueft = 0;
function pruefe(name, ok, info) {
  geprueft++;
  console.log((ok ? '  OK   ' : '  FEHL ') + name + (info ? '  (' + info + ')' : ''));
  if (!ok) fehler++;
}

function spieler(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push('u' + (i < 10 ? '0' : '') + i);
  return a;
}

/* --------------------------------------------------------------------------
   1./3. Liga bis 10 Fahrer
   -------------------------------------------------------------------------- */

console.log('\n=== 1. Liga bis 10: jeder gegen jeden ===\n');

for (let n = 2; n <= 10; n++) {
  const ids = spieler(n);
  const runden = turnier.ligaRunden(n);
  const gesehen = {};
  const proRunde = {};
  const botRunden = {};
  let mehrfach = 0, doppeltInRunde = 0;

  for (let r = 1; r <= runden; r++) {
    const paare = turnier.ligaPaarungen(ids, r, 4242, {}, {});
    const inRunde = {};
    let botsHier = 0;
    for (const pa of paare) {
      for (const id of [pa.a, pa.b]) {
        if (id === null) { botsHier++; continue; }
        if (inRunde[id]) doppeltInRunde++;
        inRunde[id] = true;
        proRunde[id] = (proRunde[id] | 0) + 1;
      }
      if (pa.a !== null && pa.b !== null) {
        const k = turnier.paarSchluessel(pa.a, pa.b);
        if (gesehen[k]) mehrfach++;
        gesehen[k] = true;
      } else {
        const mensch = pa.a === null ? pa.b : pa.a;
        botRunden[mensch] = (botRunden[mensch] | 0) + 1;
      }
    }
    if (n % 2 === 1) {
      if (botsHier !== 1) doppeltInRunde += 100;   // genau einer muss gegen den Bot
    } else if (botsHier !== 0) doppeltInRunde += 100;
  }

  const sollPaare = (n * (n - 1)) / 2;
  const botMax = Math.max.apply(null, ids.map(function (i) { return botRunden[i] | 0; }));
  const botMin = Math.min.apply(null, ids.map(function (i) { return botRunden[i] | 0; }));

  pruefe(n + ' Fahrer: alle ' + sollPaare + ' Paarungen kommen vor, keine doppelt',
    Object.keys(gesehen).length === sollPaare && mehrfach === 0,
    Object.keys(gesehen).length + ' Paarungen, ' + mehrfach + ' doppelt');
  pruefe(n + ' Fahrer: niemand fährt zweimal in derselben Runde', doppeltInRunde === 0);
  if (n % 2 === 1) {
    pruefe(n + ' Fahrer (ungerade): der Bot trifft jeden genau einmal', botMin === 1 && botMax === 1, 'von ' + botMin + ' bis ' + botMax);
  }
}

/* --------------------------------------------------------------------------
   2. Liga ab 11 Fahrern
   -------------------------------------------------------------------------- */

console.log('\n=== 2. Liga ab 11: sieben Runden nach Tabellenstand ===\n');

for (const n of [11, 12, 15, 16, 19, 20]) {
  const ids = spieler(n);
  pruefe(n + ' Fahrer: ' + turnier.SCHWEIZER_RUNDEN + ' Runden', turnier.ligaRunden(n) === turnier.SCHWEIZER_RUNDEN);

  /* Ein ganzes Turnier durchspielen: nach jeder Runde gewinnt der mit der
     kleineren Kennung, damit sich eine echte Tabelle bildet. */
  const stand = {};
  const gefahren = {};
  let doppelt = 0, doppeltInRunde = 0, wiederholung = 0;
  for (let r = 1; r <= turnier.SCHWEIZER_RUNDEN; r++) {
    const paare = turnier.ligaPaarungen(ids, r, 4242, stand, gefahren);
    const inRunde = {};
    let bots = 0;
    for (const pa of paare) {
      for (const id of [pa.a, pa.b]) {
        if (id === null) { bots++; continue; }
        if (inRunde[id]) doppeltInRunde++;
        inRunde[id] = true;
      }
      if (pa.a !== null && pa.b !== null) {
        const k = turnier.paarSchluessel(pa.a, pa.b);
        if (gefahren[k]) wiederholung++;
        gefahren[k] = true;
      } else {
        /* Auch das Bot-Rennen wird vermerkt, sonst trifft es immer denselben. */
        gefahren[turnier.paarSchluessel(pa.a === null ? pa.b : pa.a, turnier.BOT_MARKE)] = true;
      }
      const sieger = pa.b === null ? pa.a : (pa.a < pa.b ? pa.a : pa.b);
      const verlierer = sieger === pa.a ? pa.b : pa.a;
      for (const id of [sieger, verlierer]) {
        if (id === null) continue;
        stand[id] = stand[id] || { siege: 0, niederlagen: 0, rennen: 0, besteZeit: null };
        stand[id].rennen++;
        const zeit = 10 + Number(id.slice(1)) / 100;
        if (stand[id].besteZeit === null || zeit < stand[id].besteZeit) stand[id].besteZeit = zeit;
      }
      stand[sieger].siege++;
      if (verlierer !== null) stand[verlierer].niederlagen++;
    }
    if (n % 2 === 1 && bots !== 1) doppelt += 100;
    if (n % 2 === 0 && bots !== 0) doppelt += 100;
    if (Object.keys(inRunde).length !== n) doppelt++;
  }
  pruefe(n + ' Fahrer: jeder fährt in jeder Runde genau einmal', doppelt === 0 && doppeltInRunde === 0);
  pruefe(n + ' Fahrer: keine Paarung wird wiederholt', wiederholung === 0, wiederholung + ' Wiederholungen');
}

/* --------------------------------------------------------------------------
   4./5. K.-o.
   -------------------------------------------------------------------------- */

console.log('\n=== 3. K.-o. von 2 bis 20 Fahrern ===\n');

for (let n = 2; n <= 20; n++) {
  const ids = spieler(n);
  const baum = turnier.koBaum(ids, 987654);
  let laeufe = 0, halbfinaleNoetig = null, vorrundeNoetig = null, viertelNoetig = null;
  let wache = 0;
  let weiter = true;

  while (weiter && wache++ < 200) {
    const runde = turnier.offeneRunde(baum);
    if (!runde) break;
    if (runde.vorrunde) vorrundeNoetig = runde.paare[0].noetig;
    if (runde.name === 'Halbfinale') halbfinaleNoetig = runde.paare[0].noetig;
    if (runde.name === 'Viertelfinale') viertelNoetig = runde.paare[0].noetig;
    for (const pa of runde.paare) {
      let sicherung = 0;
      while (!pa.sieger && sicherung++ < 10) {
        /* Der mit der kleineren Kennung gewinnt jeden Lauf. */
        turnier.koEintragen(baum, pa, pa.a < pa.b ? pa.a : pa.b);
        laeufe++;
      }
    }
    weiter = turnier.koWeiter(baum);
  }

  const erwarteteRunden = Math.ceil(Math.log2(n));
  pruefe(n + ' Fahrer: es gibt am Ende genau einen Sieger', !!baum.sieger, 'Sieger ' + baum.sieger + ', Zweiter ' + baum.zweiter);
  pruefe(n + ' Fahrer: Sieger ist u00 (gewinnt annahmegemäß jeden Lauf)', baum.sieger === 'u00');
  pruefe(n + ' Fahrer: Rundenzahl passt (' + erwarteteRunden + ')', baum.runden.length === erwarteteRunden,
    baum.runden.length + ' Runden: ' + baum.runden.map(function (r) { return r.name; }).join(', '));
  if (n >= 4) pruefe(n + ' Fahrer: im Halbfinale zählen zwei Siege', halbfinaleNoetig === 2, 'nötig: ' + halbfinaleNoetig);
  if (viertelNoetig !== null) pruefe(n + ' Fahrer: im Viertelfinale zählt ein Sieg', viertelNoetig === 1, 'nötig: ' + viertelNoetig);
  if (vorrundeNoetig !== null) pruefe(n + ' Fahrer: in der Vorrunde zählt ein Sieg', vorrundeNoetig === 1);

  /* Kein Bot im K.-o. — die Vorrunde hat immer eine gerade Teilnehmerzahl. */
  let botDrin = false;
  for (const r of baum.runden) for (const pa of r.paare) if (pa.a === null || pa.b === null) botDrin = true;
  pruefe(n + ' Fahrer: kein Bot im K.-o.-Baum', botDrin === false);
}

/* --------------------------------------------------------------------------
   6. Tabelle
   -------------------------------------------------------------------------- */

console.log('\n=== 4. Tabelle ===\n');

const t = turnier.tabelle(['a', 'b', 'c', 'd'], {
  a: { siege: 2, niederlagen: 1, rennen: 3, besteZeit: 10.9 },
  b: { siege: 2, niederlagen: 1, rennen: 3, besteZeit: 10.2 },
  c: { siege: 3, niederlagen: 0, rennen: 3, besteZeit: 11.5 },
  d: { siege: 0, niederlagen: 3, rennen: 3, besteZeit: null },
});
console.log('  ' + t.map(function (z) { return z.platz + '. ' + z.id + ' (' + z.siege + ' Siege, beste ' + (z.besteZeit === null ? '—' : z.besteZeit) + ')'; }).join('   '));
pruefe('mehr Siege steht vorn', t[0].id === 'c');
pruefe('bei Sieggleichheit entscheidet die beste Zeit', t[1].id === 'b' && t[2].id === 'a');
pruefe('wer noch keine Zeit hat, steht hinten', t[3].id === 'd');

const t2 = turnier.tabelle(['x', 'y'], {
  x: { siege: 0, niederlagen: 0, rennen: 0, besteZeit: null },
  y: { siege: 0, niederlagen: 1, rennen: 1, besteZeit: 12.0 },
});
pruefe('vor dem ersten Rennen wirft die leere Tabelle niemanden hinaus', t2.length === 2);

const t3 = turnier.tabelle(['x', 'y'], {});
pruefe('ganz ohne Stand steht trotzdem jeder drin', t3.length === 2 && t3[0].punkte === 0);

console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' FEHLER') + ' — ' + geprueft + ' Prüfungen\n');
process.exit(fehler === 0 ? 0 : 1);
