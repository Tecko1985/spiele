/**
 * Prüft Depotrechnung und KI-Mitspieler.
 * Aufruf: node pflege/pruefe-spiel.js
 *
 * Die wichtigste Prüfung hier ist die GEGENPROBE zur 25-Prozent-Regel: dass
 * ein einzelner zu großer Kauf abgelehnt wird, beweist nichts über den
 * offensichtlichen Umgehungsweg — viele kleine Käufe hintereinander, von
 * denen jeder für sich unter der Grenze bleibt.
 */

const fs = require('fs');
const path = require('path');

globalThis.nachrichten = require('../nachrichten.js');
globalThis.markt = require('../markt.js');
globalThis.depot = require('../depot.js');
globalThis.bots = require('../bots.js');
const { markt: M, depot: D, bots: B } = globalThis;

const werteSrc = fs.readFileSync(path.join(__dirname, '..', 'werte.js'), 'utf8');
const WERTE = new Function(werteSrc + '\nreturn WERTE;')();
const werte = WERTE.werte;

/* Gemessen wird an der mittleren Partielaenge. 50 Runden sind fuenf
   Boersenjahre - derselbe Zeitraum, den die Fassung mit Zeittakt hatte,
   die Balancezahlen bleiben also vergleichbar. */
const RUNDEN = 50;
const nachId = {};
for (const w of werte) nachId[w.id] = w;

let fehler = 0;
function pruefe(b, t) {
  if (b) console.log('  OK   ' + t);
  else { console.log('  FEHL ' + t); fehler++; }
}

const lauf = M.erzeuge(4711, werte, RUNDEN);
const sap = werte.find((w) => w.kuerzel === 'SAP');
const btc = werte.find((w) => w.kuerzel === 'BTC');

/* ====================================================================== */
console.log('\n1. DEPOTRECHNUNG');
/* ====================================================================== */

const leer = D.berechne([], lauf, 0, nachId);
pruefe(leer.gesamt === D.VORGABE.startgeld, 'leeres Depot = Startbudget (' + leer.gesamt + ')');
pruefe(leer.rendite === 0, 'Rendite eines leeren Depots ist null');

const kursSap0 = M.kurs(lauf, sap.id, 0);
const einKauf = [{ art: 'kauf', id: sap.id, stueck: 100, runde: 0 }];
const nachKauf = D.berechne(einKauf, lauf, 0, nachId);
const erwarteterBetrag = kursSap0 * 100;
const erwarteteGebuehr = Math.max(1, erwarteterBetrag * 0.0025);
pruefe(
  Math.abs(nachKauf.cash - (D.VORGABE.startgeld - erwarteterBetrag - erwarteteGebuehr)) < 0.001,
  'Kauf zieht Betrag UND Gebühr ab (Gebühr ' + erwarteteGebuehr.toFixed(2) + ' EUR)'
);
pruefe(nachKauf.positionen.length === 1 && nachKauf.positionen[0].stueck === 100, '100 Stück im Bestand');
pruefe(
  Math.abs(nachKauf.gesamt - (D.VORGABE.startgeld - erwarteteGebuehr)) < 0.001,
  'Depotwert direkt nach dem Kauf = Startbudget minus Gebühr'
);

/* Teilverkauf: der Einstand der Restposition muss anteilig mitziehen. */
const teilVerkauf = einKauf.concat([{ art: 'verkauf', id: sap.id, stueck: 40, runde: 5 }]);
const nachTeil = D.berechne(teilVerkauf, lauf, 5, nachId);
const restPos = nachTeil.positionen[0];
pruefe(restPos && Math.abs(restPos.stueck - 60) < 1e-9, 'nach Teilverkauf 60 Stück übrig');
pruefe(
  restPos && Math.abs(restPos.einstandJeStueck - kursSap0) < 0.001,
  'Einstand je Stück bleibt nach Teilverkauf korrekt (' + (restPos ? restPos.einstandJeStueck.toFixed(2) : '?') + ')'
);

/* Kompletter Verkauf räumt die Position. */
const ganzRaus = einKauf.concat([{ art: 'verkauf', id: sap.id, stueck: 100, runde: 5 }]);
pruefe(D.berechne(ganzRaus, lauf, 5, nachId).positionen.length === 0, 'Vollverkauf räumt die Position');

/* Dividende: SAP zahlt, also muss nach einem simulierten Jahr Geld da sein. */
const einJahr = M.RUNDEN_JE_JAHR;
const mitDiv = D.berechne(einKauf, lauf, einJahr, nachId);
pruefe(
  Math.abs(mitDiv.dividenden - sap.dividende * 100) < 0.01,
  'nach einem Spieljahr Dividende gutgeschrieben (' + mitDiv.dividenden.toFixed(2) + ' EUR für 100 Stück)'
);
const vorJahr = D.berechne(einKauf, lauf, einJahr - 1, nachId);
pruefe(vorJahr.dividenden === 0, 'einen Tick vor dem Stichtag noch keine Dividende');

/* Wer erst nach dem Stichtag kauft, bekommt sie nicht. */
const spaetKauf = [{ art: 'kauf', id: sap.id, stueck: 100, runde: einJahr + 1 }];
pruefe(D.berechne(spaetKauf, lauf, einJahr + 5, nachId).dividenden === 0, 'Kauf nach dem Stichtag bekommt keine Dividende');

/* Krypto in Bruchteilen. */
const kryptoKauf = [{ art: 'kauf', id: btc.id, stueck: 0.12345678, runde: 0 }];
pruefe(
  Math.abs(D.berechne(kryptoKauf, lauf, 0, nachId).positionen[0].stueck - 0.12345678) < 1e-9,
  'Krypto wird in Bruchteilen gehalten'
);
pruefe(D.rundeStueck(sap, 12.9) === 12, 'Aktien nur in ganzen Stücken (12,9 -> 12)');
pruefe(D.rundeStueck(btc, 0.123456789) === 0.12345678, 'Krypto auf 8 Nachkommastellen');

/* ====================================================================== */
console.log('\n2. REGELN — und die Gegenproben dazu');
/* ====================================================================== */

const start = D.berechne([], lauf, 0, nachId);

/* Zu teuer. */
const zuTeuer = D.pruefeKauf(start, sap, 100000, kursSap0);
pruefe(!zuTeuer.ok, 'Kauf über dem Guthaben wird abgelehnt');
pruefe(zuTeuer.hoechstStueck > 0, 'Ablehnung nennt die mögliche Stückzahl (' + zuTeuer.hoechstStueck + ')');

/* 25-Prozent-Grenze, einzelner Kauf. */
const zuGross = D.pruefeKauf(start, sap, Math.floor((D.VORGABE.startgeld * 0.4) / kursSap0), kursSap0);
pruefe(!zuGross.ok, 'Kauf über 25 % des Depots wird abgelehnt');
pruefe(/25 %/.test(zuGross.grund), 'Begründung nennt die Grenze');

const grenzKauf = D.hoechstKaufbar(start, sap, kursSap0);
const knappDrunter = D.pruefeKauf(start, sap, grenzKauf, kursSap0);
pruefe(knappDrunter.ok, 'genau an der Grenze ist der Kauf erlaubt (' + grenzKauf + ' Stück)');

/* DIE GEGENPROBE: viele kleine Käufe hintereinander. Jeder für sich wäre
   harmlos — zusammen dürfen sie die Grenze trotzdem nicht reißen. */
let trades = [];
let abgelehnt = 0;
const scheibe = Math.floor((D.VORGABE.startgeld * 0.06) / kursSap0);
for (let i = 0; i < 12; i++) {
  const z = D.berechne(trades, lauf, 0, nachId);
  const p = D.pruefeKauf(z, sap, scheibe, M.kurs(lauf, sap.id, 0));
  if (p.ok) trades.push({ art: 'kauf', id: sap.id, stueck: scheibe, runde: 0 });
  else abgelehnt++;
}
const endstand = D.berechne(trades, lauf, 0, nachId);
const anteil = endstand.positionen.length ? endstand.positionen[0].anteil : 0;
pruefe(abgelehnt > 0, 'Salamitaktik wird irgendwann gestoppt (' + abgelehnt + ' von 12 Käufen abgelehnt)');
pruefe(anteil <= 0.2501, 'Anteil bleibt trotz vieler Teilkäufe unter 25 % (' + (anteil * 100).toFixed(2) + ' %)');

/* Verkauf von etwas, das man nicht hat. */
pruefe(!D.pruefeVerkauf(start, sap, 10).ok, 'Verkauf ohne Bestand wird abgelehnt');
const hatWas = D.berechne(einKauf, lauf, 0, nachId);
pruefe(!D.pruefeVerkauf(hatWas, sap, 500).ok, 'Verkauf über den Bestand hinaus wird abgelehnt');
pruefe(D.pruefeVerkauf(hatWas, sap, 100).ok, 'Verkauf des ganzen Bestands ist erlaubt');

/* Cash darf nie negativ werden, auch nicht bei untergeschobenen Trades. */
const boesartig = [
  { art: 'kauf', id: sap.id, stueck: 100000, runde: 0 },
  { art: 'kauf', id: sap.id, stueck: 50, runde: 1 },
];
const nachBoese = D.berechne(boesartig, lauf, 5, nachId);
pruefe(nachBoese.cash >= 0, 'untergeschobener Riesenkauf zieht das Konto nicht ins Minus (Cash ' + nachBoese.cash.toFixed(0) + ')');
pruefe(nachBoese.positionen.length === 1 && nachBoese.positionen[0].stueck === 50, 'nur der bezahlbare Kauf wird verbucht');

/* ====================================================================== */
console.log('\n2b. EINSTELLBARE SPIELREGELN');
/* ======================================================================
   Startgeld, Gebühr und Höchstanteil stehen seit 2026-08-07 im Raum statt
   als Konstante im Programm. Die gefährliche Stelle ist nicht die Rechnung
   selbst, sondern der Zwischenspeicher: liefert er nach einer Regeländerung
   den Stand der alten Regeln, stimmt die Rangliste stillschweigend nicht
   mehr — und nichts sieht nach einem Fehler aus.
   ====================================================================== */

const armeRegeln = D.normiereRegeln({ startgeld: 10000, gebuehrSatz: 0.01, gebuehrMind: 1, hoechstanteil: 0.1 });
const reicheRegeln = D.normiereRegeln({ startgeld: 1000000, gebuehrSatz: 0, gebuehrMind: 0, hoechstanteil: 1 });

pruefe(D.berechne([], lauf, 0, nachId, armeRegeln).gesamt === 10000, 'Startgeld 10.000 kommt an');
pruefe(D.berechne([], lauf, 0, nachId, reicheRegeln).gesamt === 1000000, 'Startgeld 1 Mio kommt an');
pruefe(D.gebuehr(10000, reicheRegeln) === 0, 'ohne Gebührensatz UND ohne Mindestbetrag kostet ein Auftrag nichts');
pruefe(D.gebuehr(10000, armeRegeln) === 100, '1 % von 10.000 ist 100 EUR Gebühr');

/* Lückenlose Fehlkonfiguration darf nicht die Partie sprengen. */
const halb = D.normiereRegeln({ startgeld: 50000 });
pruefe(halb.startgeld === 50000 && halb.gebuehrSatz === D.VORGABE.gebuehrSatz,
  'fehlende Felder werden aus der Vorgabe ergänzt statt undefined zu werden');
pruefe(D.normiereRegeln({ startgeld: -5, hoechstanteil: 9 }).startgeld === D.VORGABE.startgeld,
  'unsinnige Werte fallen auf die Vorgabe zurück');

/* Der Höchstanteil muss wirklich der eingestellte sein. */
const armStand = D.berechne([], lauf, 0, nachId, armeRegeln);
const zuViel = D.pruefeKauf(armStand, sap, Math.floor((10000 * 0.2) / kursSap0), kursSap0);
pruefe(!zuViel.ok && zuViel.grund.indexOf('10 %') >= 0,
  '10-Prozent-Grenze greift und wird auch so begründet (' + (zuViel.grund || '').slice(0, 46) + '…)');
const reichStand = D.berechne([], lauf, 0, nachId, reicheRegeln);
pruefe(D.pruefeKauf(reichStand, sap, Math.floor((1000000 * 0.9) / kursSap0), kursSap0).ok,
  'bei "alles" ist ein Kauf über 90 % des Depots erlaubt');

/* DIE eigentliche Falle: derselbe Schlüssel, andere Regeln. */
const trade = [{ art: 'kauf', id: sap.id, stueck: 10, runde: 0 }];
const ersterStand = D.stand('probe', trade, lauf, 0, nachId, armeRegeln);
const zweiterStand = D.stand('probe', trade, lauf, 0, nachId, reicheRegeln);
pruefe(ersterStand.gesamt !== zweiterStand.gesamt,
  'Zwischenspeicher liefert nach Regelwechsel NICHT den alten Stand (' +
  Math.round(ersterStand.gesamt) + ' vs ' + Math.round(zweiterStand.gesamt) + ')');
pruefe(zweiterStand.gebuehren === 0, 'im gebührenfreien Lauf wurde keine Gebühr verbucht');

/* Bots müssen mit denselben Regeln rechnen wie die Menschen. */
const armeBots = B.stelleAuf(lauf, werte, nachId, 3, armeRegeln);
const armeStaende = armeBots.map((b) => D.berechne(b.trades, lauf, RUNDEN, nachId, armeRegeln));
pruefe(armeStaende.every((z) => z.cash >= -0.001), 'Bots gehen auch mit 10.000 Startgeld nie ins Minus');
const reicheBots = B.stelleAuf(lauf, werte, nachId, 3, reicheRegeln);
pruefe(JSON.stringify(armeBots[0].trades) !== JSON.stringify(reicheBots[0].trades),
  'Bots handeln bei anderem Startgeld anders — die Regeln kommen wirklich bei ihnen an');

/* ====================================================================== */
console.log('\n3. KI-MITSPIELER');
/* ====================================================================== */

const feld1 = B.stelleAuf(lauf, werte, nachId, 5);
const feld2 = B.stelleAuf(lauf, werte, nachId, 5);
pruefe(feld1.length === 5, 'fünf Charaktere aufgestellt');

let gleich = true;
for (let i = 0; i < feld1.length; i++) {
  if (JSON.stringify(feld1[i].trades) !== JSON.stringify(feld2[i].trades)) gleich = false;
}
pruefe(gleich, 'Bot-Züge sind bei gleicher Saat identisch — sonst müssten sie übertragen werden');

const anderes = B.stelleAuf(M.erzeuge(4712, werte, RUNDEN), werte, nachId, 5);
pruefe(
  JSON.stringify(anderes[0].trades) !== JSON.stringify(feld1[0].trades),
  'andere Saat ergibt andere Bot-Züge'
);

/* Die 25-Prozent-Grenze gilt IM MOMENT DES KAUFS, nicht dauerhaft. Wächst
   eine Position danach durch Kursgewinne darüber hinaus, ist das verdienter
   Erfolg — niemanden zum Verkauf zu zwingen, weil sein Wert gestiegen ist,
   wäre absurd und in echten Depots auch nicht üblich. Geprüft wird deshalb
   jeder einzelne Kauf gegen den Stand unmittelbar davor. */
function pruefeKaufregelTreue(trades, l) {
  const bisher = [];
  for (const h of trades) {
    if (h.art === 'kauf') {
      const davor = D.berechne(bisher, l, h.runde, nachId);
      const p = D.pruefeKauf(davor, nachId[h.id], h.stueck, M.kurs(l, h.id, h.runde));
      if (!p.ok) return { ok: false, wo: h };
    }
    bisher.push(h);
  }
  return { ok: true };
}

for (const b of feld1) {
  const z = D.berechne(b.trades, lauf, RUNDEN, nachId);
  const maxAnteil = z.positionen.reduce((m, p) => Math.max(m, p.anteil), 0);
  const investiert = z.anlagewert / z.gesamt;
  console.log(
    '  ' + b.zeichen + ' ' + b.name.padEnd(18) +
    b.trades.length.toString().padStart(3) + ' Züge   ' +
    'Endstand ' + z.gesamt.toFixed(0).padStart(8) + ' EUR   ' +
    'Rendite ' + z.rendite.toFixed(1).padStart(7) + ' %   ' +
    'investiert ' + (investiert * 100).toFixed(0) + ' %   ' +
    'größte Position am Ende ' + (maxAnteil * 100).toFixed(1) + ' %'
  );
  pruefe(b.trades.length > 0, b.name + ' handelt überhaupt');
  pruefe(z.cash >= 0, b.name + ' hat nie ein negatives Konto');
  const treue = pruefeKaufregelTreue(b.trades, lauf);
  pruefe(treue.ok, b.name + ' hält bei JEDEM Kauf die Regeln ein');
}

/* Bots dürfen nicht in die Zukunft schauen: ein Zug darf nie einen Tick
   tragen, der nach dem Partieende liegt, und die Käufe müssen sich über die
   Partie verteilen statt am Ende geballt aufzutreten. */
const alleRunden = feld1.flatMap((b) => b.trades.map((t) => t.runde));
pruefe(alleRunden.every((t) => t >= 0 && t <= RUNDEN), 'kein Bot-Zug außerhalb der Partie');

/* ====================================================================== */
console.log('\n4. WER GEWINNT? (120 Partien, 5 Bots)');
/* ====================================================================== */

const siege = {};
const summeRendite = {};
for (const c of B.CHARAKTERE) { siege[c.name] = 0; summeRendite[c.name] = 0; }

const LAEUFE = 120;
const t0 = Date.now();
for (let i = 0; i < LAEUFE; i++) {
  const l = M.erzeuge(90000 + i * 613, werte, RUNDEN);
  const feld = B.stelleAuf(l, werte, nachId, 5);
  let bester = null;
  let bestwert = -1e18;
  for (const b of feld) {
    const z = D.berechne(b.trades, l, RUNDEN, nachId);
    summeRendite[b.name] += z.rendite;
    if (z.gesamt > bestwert) { bestwert = z.gesamt; bester = b.name; }
  }
  siege[bester]++;
}
const dauer = Date.now() - t0;

for (const c of B.CHARAKTERE) {
  console.log(
    '  ' + c.zeichen + ' ' + c.name.padEnd(18) +
    (siege[c.name] + ' Siege').padStart(9) + '  (' + ((siege[c.name] / LAEUFE) * 100).toFixed(0).padStart(3) + ' %)   ' +
    'mittlere Rendite ' + (summeRendite[c.name] / LAEUFE).toFixed(0).padStart(6) + ' %'
  );
}
console.log('  Rechenzeit je Partie inkl. 5 Bots: ' + (dauer / LAEUFE).toFixed(0) + ' ms');

const quoten = B.CHARAKTERE.map((c) => siege[c.name] / LAEUFE);
pruefe(Math.max(...quoten) < 0.72, 'keine Strategie gewinnt fast immer (' + (Math.max(...quoten) * 100).toFixed(0) + ' %)');
pruefe(Math.min(...quoten) > 0.005, 'jede Strategie gewinnt zumindest gelegentlich (' + (Math.min(...quoten) * 100).toFixed(1) + ' %)');
pruefe(dauer / LAEUFE < 900, 'Partiestart mit fünf Bots unter 900 ms (' + (dauer / LAEUFE).toFixed(0) + ' ms)');

console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' PRÜFUNG(EN) FEHLGESCHLAGEN'));
process.exit(fehler === 0 ? 0 : 1);
