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
/* `gesamt` kommt aus depot.js auf Cent gerundet (Absicht, sonst sortiert die
   Rangliste nach Fliesskomma-Resten). Der Erwartungswert muss deshalb genauso
   gerundet werden — sonst haengt diese Pruefung am Tageskurs: die Gebuehr ist
   Kurs * 0.25, und die trifft nur dann einen vollen Cent, wenn der Kurs in
   Cent durch 4 teilbar ist. Bei SAP 177.96 ging es auf, bei 180.14 nicht. */
pruefe(
  Math.abs(nachKauf.gesamt - Math.round((D.VORGABE.startgeld - erwarteteGebuehr) * 100) / 100) < 0.001,
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
const armeStaende = armeBots.map((b) => D.berechne(b.trades, lauf, RUNDEN, nachId, armeRegeln, b.uid));
pruefe(armeStaende.every((z) => z.cash >= -0.001), 'Bots gehen auch mit 10.000 Startgeld nie ins Minus');
const reicheBots = B.stelleAuf(lauf, werte, nachId, 3, reicheRegeln);
pruefe(JSON.stringify(armeBots[0].trades) !== JSON.stringify(reicheBots[0].trades),
  'Bots handeln bei anderem Startgeld anders — die Regeln kommen wirklich bei ihnen an');

/* ====================================================================== */
console.log('\n2c. START-DEPOT');
/* ======================================================================
   Zu Partiebeginn liegen 10 % des Startgeldes bereits in sechs Positionen,
   je Mitspieler andere. Das Depot wird nirgends gespeichert, sondern aus
   Saat und uid abgeleitet — die entscheidende Eigenschaft ist deshalb
   nicht, dass es gut aussieht, sondern dass JEDES Geraet fuer denselben
   Mitspieler exakt dasselbe herausbekommt. Weicht ein Geraet ab, zeigt es
   eine andere Rangliste, ohne dass irgendetwas nach einem Fehler aussieht.
   ====================================================================== */

const UID_A = 'spieler-aaa111';
const UID_B = 'spieler-bbb222';
const lauf2 = M.erzeuge(4712, werte, RUNDEN);

const sdA = D.berechne([], lauf, 0, nachId, null, UID_A);
const artenA = {};
for (const p of sdA.positionen) artenA[p.wert.art] = (artenA[p.wert.art] || 0) + 1;

pruefe(sdA.positionen.length === 6, 'Start-Depot hat sechs Positionen (' + sdA.positionen.length + ')');
pruefe(artenA.aktie === 3 && artenA.etf === 2 && artenA.krypto === 1,
  'Mischung stimmt: 3 Aktien, 2 ETFs, 1 Krypto (' +
  (artenA.aktie || 0) + '/' + (artenA.etf || 0) + '/' + (artenA.krypto || 0) + ')');
pruefe(sdA.positionen.every((p) => p.ausStart), 'alle sechs sind als Start-Position gekennzeichnet');

/* Die wichtigste Zahl: der Depotwert zu Beginn MUSS auf den Cent das
   Startgeld sein. Faellt hier eine Gebuehr an, startet jeder mit einer
   Rendite unter null, ohne etwas getan zu haben. */
pruefe(sdA.gesamt === D.VORGABE.startgeld,
  'Depotwert zu Beginn ist exakt das Startgeld (' + sdA.gesamt.toFixed(4) + ')');
/* Nicht "fast null": die Rangliste sortiert nach diesem Wert. Ein Rest von
   0,00000000001 aus sechs Fliesskomma-Abzuegen reicht, um den Menschen
   hinter eine KI zu setzen, die genau dasselbe hat. */
pruefe(sdA.rendite === 0 && sdA.gesamt === D.berechne([], lauf, 0, nachId).gesamt,
  'kein Fliesskomma-Rest gegenueber einem Depot ohne Start-Positionen');
pruefe(sdA.gebuehren === 0, 'auf das gestellte Depot faellt keine Gebuehr an');
pruefe(sdA.rendite === 0, 'Rendite startet bei null');
pruefe(sdA.anzahlTrades === 0,
  'das Start-Depot zaehlt NICHT als eigener Auftrag (' + sdA.anzahlTrades + ')');

/* Angelegt sein sollen 10 %. Durch das Abrunden auf ganze Stuecke bleibt
   ein Rest liegen — viel darf das nicht sein, sonst ist die Vorgabe nur
   noch dem Namen nach eingehalten. */
const anteilA = sdA.anlagewert / sdA.gesamt;
pruefe(anteilA > 0.085 && anteilA <= 0.1001,
  'angelegt sind ' + (anteilA * 100).toFixed(2) + ' % (Ziel 10 %, Rest durch ganze Stueckzahlen)');

/* Bestimmtheit — ohne sie waere das ganze Verfahren wertlos. */
D.leereSpeicher();
const sdAerneut = D.berechne([], lauf, 0, nachId, null, UID_A);
pruefe(JSON.stringify(D.startdepot(lauf, UID_A, nachId, null)) ===
  JSON.stringify(D.startdepot(lauf, UID_A, nachId, null)),
  'zweimal derselbe Aufruf ergibt dasselbe Depot');
pruefe(Math.abs(sdAerneut.gesamt - sdA.gesamt) < 1e-9,
  'auch nach geleertem Zwischenspeicher dasselbe Ergebnis');

const sdB = D.berechne([], lauf, 0, nachId, null, UID_B);
pruefe(sdA.positionen.map((p) => p.id).join() !== sdB.positionen.map((p) => p.id).join(),
  'zwei Mitspieler bekommen verschiedene Depots');
pruefe(Math.abs(sdB.gesamt - D.VORGABE.startgeld) < 0.005,
  'auch beim zweiten Mitspieler stimmt der Startwert auf den Cent');

const andereSaat = D.berechne([], lauf2, 0, nachId, null, UID_A);
pruefe(sdA.positionen.map((p) => p.id).join() !== andereSaat.positionen.map((p) => p.id).join(),
  'andere Partie-Saat ergibt fuer denselben Spieler ein anderes Depot');

/* GEGENPROBE: die Auswahl darf nicht davon abhaengen, in welcher
   Reihenfolge die Werteliste einmal zusammengesetzt wurde. Sonst
   verschoebe eine spaetere Umsortierung in werte.js rueckwirkend jedes
   Start-Depot — und niemand kaeme auf die Idee, dort zu suchen. */
const nachIdRueckwaerts = {};
for (const w of werte.slice().reverse()) nachIdRueckwaerts[w.id] = w;
const sdRueckwaerts = D.berechne([], lauf, 0, nachIdRueckwaerts, null, UID_A);
pruefe(sdA.positionen.map((p) => p.id).sort().join() === sdRueckwaerts.positionen.map((p) => p.id).sort().join(),
  'umgekehrt aufgebautes Werteverzeichnis ergibt dasselbe Depot');

/* Abschaltbar — und dann wirklich leer. */
const ohneStart = D.normiereRegeln({ startdepotAnteil: 0 });
pruefe(ohneStart.startdepotAnteil === 0,
  'null schlaegt die Vorgabe (sonst waere das Start-Depot nicht abschaltbar)');
pruefe(D.berechne([], lauf, 0, nachId, ohneStart, UID_A).positionen.length === 0,
  'bei "aus" beginnt das Depot leer');
pruefe(D.normiereRegeln({}).startdepotAnteil === D.VORGABE.startdepotAnteil,
  'fehlendes Feld faellt auf die Vorgabe zurueck');

/* Verkaufen koennen ist der ganze Zweck der Sache. */
const raus = sdA.positionen[0];
const verkauft = D.berechne(
  [{ art: 'verkauf', id: raus.id, stueck: raus.stueck, runde: 0, zeit: 1 }],
  lauf, 0, nachId, null, UID_A);
pruefe(verkauft.positionen.length === 5,
  'eine Start-Position laesst sich in Runde 0 vollstaendig verkaufen');
pruefe(verkauft.cash > sdA.cash,
  'der Erloes landet im Bargeld (' + Math.round(sdA.cash) + ' -> ' + Math.round(verkauft.cash) + ')');
pruefe(verkauft.gebuehren > 0,
  'der Verkauf kostet dagegen sehr wohl Gebuehr (' + verkauft.gebuehren.toFixed(2) + ' EUR)');
pruefe(D.pruefeVerkauf(sdA, raus.wert, raus.stueck).ok,
  'die Verkaufspruefung kennt den geerbten Bestand');

/* Keine Start-Position darf ueber dem Hoechstanteil liegen — auch nicht
   bei einer scharf gestellten Grenze. */
const engeRegeln = D.normiereRegeln({ hoechstanteil: 0.1 });
const sdEng = D.berechne([], lauf, 0, nachId, engeRegeln, UID_A);
pruefe(sdEng.positionen.every((p) => p.anteil <= 0.1 + 1e-9),
  'keine Start-Position sprengt selbst eine 10-Prozent-Grenze (groesste ' +
  (Math.max(...sdEng.positionen.map((p) => p.anteil)) * 100).toFixed(2) + ' %)');

/* Kleines Startgeld: teure Aktien passen dann nicht mehr ins Budget je
   Position. Das darf die Mischung ausduennen, aber nicht den Startwert
   verfaelschen. */
const armStart = D.berechne([], lauf, 0, nachId, armeRegeln, UID_A);
pruefe(Math.abs(armStart.gesamt - 10000) < 0.005,
  'auch mit 10.000 Startgeld stimmt der Depotwert auf den Cent (' + armStart.gesamt.toFixed(4) + ')');
pruefe(armStart.positionen.length >= 5,
  'mit 10.000 Startgeld kommen noch ' + armStart.positionen.length + ' von 6 Positionen zustande');

/* Dieselbe Falle wie beim Zwischenspeicher der Regeln: gleicher
   Schluessel, andere uid. */
D.leereSpeicher();
const cacheA = D.stand('ich', [], lauf, 0, nachId, null, UID_A);
const cacheB = D.stand('ich', [], lauf, 0, nachId, null, UID_B);
pruefe(cacheA.positionen.map((p) => p.id).join() !== cacheB.positionen.map((p) => p.id).join(),
  'Zwischenspeicher verwechselt zwei Mitspieler NICHT, wenn der Schluessel gleich ist');

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
function pruefeKaufregelTreue(trades, l, uid) {
  const bisher = [];
  for (const h of trades) {
    if (h.art === 'kauf') {
      /* Die uid MUSS mit: sie entscheidet ueber das Startdepot. Ohne sie
         rechnet die Pruefung auf einem Bestand, den der Bot nie hatte —
         seine Verkaeufe aus dem Startdepot liefen ins Leere, das Geld
         fehlte, und ein voellig regeltreuer Kauf saehe nach Verstoss aus. */
      const davor = D.berechne(bisher, l, h.runde, nachId, null, uid);
      const p = D.pruefeKauf(davor, nachId[h.id], h.stueck, M.kurs(l, h.id, h.runde));
      if (!p.ok) return { ok: false, wo: h };
    }
    bisher.push(h);
  }
  return { ok: true };
}

for (const b of feld1) {
  const z = D.berechne(b.trades, lauf, RUNDEN, nachId, null, b.uid);
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
  const treue = pruefeKaufregelTreue(b.trades, lauf, b.uid);
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
    const z = D.berechne(b.trades, l, RUNDEN, nachId, null, b.uid);
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


/* ====================================================================== */
console.log('\n5. STÜCKZAHLFELD — DER RUNDWEG');
/* ====================================================================== */
/* Das Feld im Handelsdialog ist ein Rundweg: die Oberfläche SCHREIBT eine
   Zahl hinein und LIEST sie im nächsten Bild als Text wieder heraus. Bricht
   eine der beiden Richtungen, verkauft ein Druck auf "100 %" den falschen
   Betrag — ohne Fehlermeldung, weil die kleinere Zahl völlig gültig ist.
   Geprüft wird der ECHTE Code aus `bildschirme.js`, nicht ein Nachbau. */

globalThis.ui = { F: {} };
const bildSrc = fs.readFileSync(path.join(__dirname, '..', 'bildschirme.js'), 'utf8');
const BS = new Function(bildSrc + '\nreturn bildschirme;')();

/* Beide Tippgewohnheiten müssen durchgehen — deutsch und von der Tastatur. */
const zahlFaelle = [
  ['1234', 1234], ['1.234', 1234], ['1234,5', 1234.5], ['1.234,5', 1234.5],
  ['1234.5', 1234.5], ['0,5', 0.5], ['0.5', 0.5], ['12,5', 12.5], ['12.5', 12.5],
  ['0,00000001', 1e-8], ['1.234.567', 1234567], ['', 0], ['abc', 0], ['12abc', 0],
];
for (const f of zahlFaelle) {
  const ist = BS.zahlAus(f[0]);
  pruefe(Math.abs(ist - f[1]) < 1e-12,
    'zahlAus("' + f[0] + '") = ' + f[1] + (ist === f[1] ? '' : '  — ist ' + ist));
}

/* Der eigentliche Rundweg: was die Oberfläche schreibt, muss sie auch wieder
   lesen können — sonst wird aus 12.345 Stück still eine 12. */
const rundwegFaelle = [
  [{ art: 'aktie' }, 1234], [{ art: 'aktie' }, 12345], [{ art: 'aktie' }, 7],
  [{ art: 'krypto' }, 0.12345678], [{ art: 'krypto' }, 12345.678],
  [{ art: 'krypto' }, 1234.56789012], [{ art: 'krypto' }, 0.00000001],
];
for (const f of rundwegFaelle) {
  const zurueck = D.rundeStueck(f[0], BS.zahlAus(BS.stueckEingabe(f[0], f[1])));
  const abweichung = Math.abs(zurueck - f[1]) / Math.max(1, f[1]);
  pruefe(abweichung < 1e-8,
    f[0].art + ' ' + f[1] + ' → "' + BS.stueckEingabe(f[0], f[1]) + '" → ' + zurueck);
}

/* Gegenprobe zum eigentlichen Fehler: nach "100 %" darf KEIN Rest im Depot
   liegen bleiben, und abgelehnt100 werden darf der Auftrag erst recht nicht.
   Ein Kryptobestand entsteht als Summe von Vielfachen eines
   Hundertmillionstels und trägt deshalb einen Fließkommarest — genau der
   überlebte den Rundweg, mal nach oben (Ablehnung), mal nach unten (Rest). */
let resteGefunden = 0;
let abgelehnt100 = 0;
let geprueft100 = 0;
for (let i = 0; i < 400; i++) {
  const w = i % 2 === 0 ? btc : sap;
  /* Bestand wie im echten Spiel: zwei Käufe, ein Teilverkauf. */
  const trades = [
    { art: 'kauf', id: w.id, stueck: D.rundeStueck(w, (0.7 + i * 0.013) * (w === btc ? 0.31 : 41)), runde: 0 },
    { art: 'kauf', id: w.id, stueck: D.rundeStueck(w, (0.3 + i * 0.007) * (w === btc ? 0.17 : 23)), runde: 1 },
    { art: 'verkauf', id: w.id, stueck: D.rundeStueck(w, (0.11 + i * 0.003) * (w === btc ? 0.09 : 13)), runde: 2 },
  ];
  const z = D.berechne(trades, lauf, 3, nachId);
  const bestand = D.bestandVon(z, w.id);
  if (!(bestand > 0)) continue;
  geprueft100++;

  /* Genau der Weg des Dialogs: 100 % → ins Feld → zurücklesen → prüfen. */
  const p = D.pruefeVerkauf(z, w, D.rundeStueck(w, BS.zahlAus(BS.stueckEingabe(w, bestand))));
  if (!p.ok) { abgelehnt100++; continue; }
  const danach = D.berechne(
    trades.concat([{ art: 'verkauf', id: w.id, stueck: p.stueck, runde: 3 }]), lauf, 3, nachId);
  if (D.bestandVon(danach, w.id) !== 0) resteGefunden++;
}
pruefe(geprueft100 > 300, geprueft100 + ' Bestände durchgerechnet');
pruefe(abgelehnt100 === 0, '"100 %" wird nie abgelehnt (' + abgelehnt100 + ' Ablehnungen)');
pruefe(resteGefunden === 0, '"100 %" lässt nie einen Rest im Depot (' + resteGefunden + ' Reste)');

/* ====================================================================== */
console.log('\n6. DER KOSTENTEXT IM HANDELSDIALOG');
/* ====================================================================== */
/* Bis 2026-09-06 stand hier oben nur `D.gebuehr(betrag, regeln)` — also die
   Rechenfunktion MIT Regeln. Der Fehler saß aber in der Aufrufstelle: der
   Dialog rief `depot.gebuehr(betrag)` ohne Regeln und nannte deshalb bei
   jeder Einstellung dieselbe Vorgabe-Gebühr. Gemessen wird darum jetzt der
   AUSGEGEBENE TEXT des echten `handelDialog` gegen die Verbuchung in
   `berechne()` — eine geprüfte Rechenfunktion sagt nichts über die Zahl, die
   über dem Kaufknopf steht. */

const dlgTexte = [];
globalThis.ui = {
  F: {}, RADIUS: 8, RADIUS_KLEIN: 6, hoehe: 800, breite: 400, ctx: {},
  abdunkeln() {}, beginneDialog: () => ({}), beendeDialog() {},
  titel(t) { dlgTexte.push(t); },
  absatz(t) { dlgTexte.push(t); },
  schreibe(t) { dlgTexte.push(t); },
  reserviere: () => ({ x: 0, y: 0, b: 360, h: 44 }),
  fuelleRund() {}, rahmeRund() {}, merke() {}, geklickt: () => false,
  luecke() {}, trenner() {},
  eingabe: () => '', setzeEingabe() {}, knopf: () => false,
};

/* "9.589,92 €" → 9589.92 */
function euroAus(text) {
  return parseFloat(String(text).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
}

const gebuehrFaelle = [
  ['keine Gebühr', { gebuehrSatz: 0, gebuehrMind: 0 }],
  ['1 %', { gebuehrSatz: 0.01, gebuehrMind: 1 }],
  ['0,25 % (Vorgabe)', {}],
];
for (const f of gebuehrFaelle) {
  const R = D.normiereRegeln(f[1]);
  const standF = D.berechne([], lauf, 0, nachId, R, 'mensch-1');
  const stueckF = 50;
  dlgTexte.length = 0;
  globalThis.ui.eingabe = () => BS.stueckEingabe(sap, stueckF);
  BS.handelDialog({
    handel: { id: sap.id, art: 'kauf', stueck: stueckF },
    wertNachId: nachId,
    lauf: lauf,
    runde: () => 0,
    eigenerStand: () => standF,
    regeln: () => R,
    zustand: { raum: { phase: 'laeuft' }, vorbei: false, abgeschlossen: false, uid: 'mensch-1' },
    fuehreHandelAus() {},
  });
  const zeile = dlgTexte.find((t) => typeof t === 'string' && t.indexOf('Kosten ') === 0);
  const m = zeile && zeile.match(/^Kosten\s+(.+?)\s+\(davon\s+(.+?)\s+Gebühr\)$/);
  if (!m) {
    pruefe(false, 'Kostentext bei "' + f[0] + '" lesbar (gefunden: ' + (zeile || 'nichts') + ')');
    continue;
  }
  const gebucht = D.berechne(
    [{ art: 'kauf', id: sap.id, stueck: stueckF, runde: 0 }], lauf, 0, nachId, R, 'mensch-1').gebuehren;
  const zeigtGeb = euroAus(m[2]);
  const zeigtKosten = euroAus(m[1]);
  const betragF = kursSap0 * stueckF;
  /* Toleranz ein Cent — `euro()` rundet auf zwei Stellen. Der Fehler wich um
     24 bzw. 72 EUR ab und liegt weit darüber. */
  pruefe(Math.abs(zeigtGeb - gebucht) <= 0.011,
    'Dialog nennt bei "' + f[0] + '" die Gebühr, die auch gebucht wird (' +
    zeigtGeb.toFixed(2) + ' gegen ' + gebucht.toFixed(2) + ' EUR)');
  pruefe(Math.abs(zeigtKosten - (betragF + D.gebuehr(betragF, R))) <= 0.011,
    'Dialog nennt bei "' + f[0] + '" die Gesamtkosten richtig (' + zeigtKosten.toFixed(2) + ' EUR)');
}

/* ====================================================================== */
console.log('\n7. EINSTELLUNGSWECHSEL IN DER LOBBY');
/* ====================================================================== */
/* Die gefährlichste Klasse Fehler dieses Spiels sind zwei Geräte mit
   verschiedenem Stand derselben Partie — dagegen ist die ganze
   Saat-Architektur gebaut. `app.uebernehmeZustand` baute das KI-Feld bis
   2026-09-06 nur bei geänderter Saat oder Rundenzahl neu; `botAnzahl` und die
   Regeln lösten es nicht aus, obwohl beide hineingehen. Wer in der Lobby
   umstellte, spielte gegen das Feld von vorher — wer NACH der Änderung
   beitrat, gegen ein anderes.

   Geprüft wird der ECHTE `app` aus `app.js`, herausgeschnitten wie
   `bildschirme` oben. Die Beitrittsreihenfolge ist der einzige Unterschied
   zwischen den beiden Geräten. */

globalThis.WERTE = WERTE;
globalThis.bildschirme = BS;
globalThis.ui = { F: {}, anfordern() {}, starte() {}, setzeEingabe() {} };
globalThis.gameService = { onZustandsAenderung() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, addEventListener() {} };
globalThis.navigator = {};
globalThis.window = { addEventListener() {} };
globalThis.fetch = () => Promise.reject(new Error('kein Netz im Prüfstand'));

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function frischeApp() { return new Function(appSrc + '\nreturn app;')(); }

/* Ein Zustand, wie ihn der Firebase-Horcher liefert. */
function horcherZustand(o) {
  const R = D.normiereRegeln(o.regeln || {});
  const spieler = { h: { name: 'Michel' } };
  if (o.gast) spieler.g = { name: 'Gast' };
  const raum = {
    hostId: 'h', phase: o.phase || 'lobby', saat: 4711, runden: RUNDEN,
    botAnzahl: o.botAnzahl, regeln: R, spieler: spieler,
  };
  return {
    uid: o.uid || 'h', code: 'AAAAAA', raum: raum, trades: {},
    runde: o.runde || 0, runden: RUNDEN, abgeschlossen: false, fehlende: [],
    bereitJetzt: {}, vorbei: false, abgebrochen: false,
    istHost: (o.uid || 'h') === 'h', stufe: { runden: RUNDEN },
    regeln: R, botAnzahl: o.botAnzahl,
  };
}

/* ⚠️ In Runde 0 hat noch keine KI gehandelt — dort steht überall blank das
   Startgeld, und ein Vergleich wäre blind für eine Regeländerung. Gemessen
   wird am Ende der Partie. */
function botAbdruckAmEnde(a, o) {
  a.uebernehmeZustand(horcherZustand(Object.assign({}, o, { phase: 'laeuft', runde: RUNDEN })));
  return a.rangliste().filter((e) => e.istBot)
    .map((e) => e.name + '=' + e.gesamt.toFixed(2)).sort().join(' | ');
}

/* a) Die Lobby zeigt die neue Zahl — gespielt werden muss dieselbe. */
const wechsler = frischeApp();
wechsler.uebernehmeZustand(horcherZustand({ botAnzahl: 1, regeln: { startgeld: 100000 } }));
const nachher = { botAnzahl: 5, regeln: { startgeld: 1000000 }, gast: true };
wechsler.uebernehmeZustand(horcherZustand(nachher));
pruefe(wechsler.botFeld.length === 5,
  'nach dem Umstellen auf 5 KI-Mitspieler spielt der Host auch gegen 5 (' + wechsler.botFeld.length + ')');
pruefe(wechsler.botFeld.map((b) => b.name).sort().join() ===
       B.charakterListe().slice(0, 5).map((c) => c.name).sort().join(),
  'die Namen in der Lobby sind die Namen des gespielten Feldes');

/* b) Zwei Geräte, unterschiedliche Beitrittsreihenfolge, dieselbe Partie. */
const spaeterGast = frischeApp();
spaeterGast.uebernehmeZustand(horcherZustand(Object.assign({}, nachher, { uid: 'g' })));
const abdruckHost = botAbdruckAmEnde(wechsler, nachher);
const abdruckGast = botAbdruckAmEnde(spaeterGast, Object.assign({}, nachher, { uid: 'g' }));
pruefe(abdruckHost === abdruckGast,
  'wer vor und wer nach der Änderung beitritt, rechnet dasselbe KI-Feld\n' +
  '       Host: ' + abdruckHost + '\n       Gast: ' + abdruckGast);

/* c) Nicht rückwirkend: in der laufenden Partie rührt sich nichts mehr. */
const laeuft = frischeApp();
const feste = { botAnzahl: 4, regeln: { startgeld: 50000 } };
laeuft.uebernehmeZustand(horcherZustand(feste));
laeuft.uebernehmeZustand(horcherZustand(Object.assign({}, feste, { phase: 'laeuft', runde: 10 })));
const feldObjekt = laeuft.botFeld;
const beiRunde10 = laeuft.rangliste().filter((e) => e.istBot)
  .map((e) => e.name + '=' + e.gesamt.toFixed(2)).sort().join(' | ');
for (let r = 11; r <= 20; r++) {
  laeuft.uebernehmeZustand(horcherZustand(Object.assign({}, feste, { phase: 'laeuft', runde: r })));
}
pruefe(laeuft.botFeld === feldObjekt, 'während der Partie wird das KI-Feld kein einziges Mal neu gebaut');
laeuft.uebernehmeZustand(horcherZustand(Object.assign({}, feste, { phase: 'laeuft', runde: 10 })));
pruefe(laeuft.rangliste().filter((e) => e.istBot)
  .map((e) => e.name + '=' + e.gesamt.toFixed(2)).sort().join(' | ') === beiRunde10,
  'eine bereits abgerechnete Runde wird später auf den Cent genauso bewertet');

/* d) Der abgeräumte Raum darf keine Kennung zurücklassen. */
const neuerRaum = frischeApp();
neuerRaum.uebernehmeZustand(horcherZustand(feste));
const ersteNamen = neuerRaum.botFeld.map((b) => b.name).join();
neuerRaum.uebernehmeZustand({
  uid: 'h', code: null, raum: null, trades: {}, runde: 0, runden: RUNDEN,
  abgeschlossen: false, fehlende: [], bereitJetzt: {}, vorbei: false,
  abgebrochen: false, istHost: false, stufe: null,
});
neuerRaum.uebernehmeZustand(horcherZustand(feste));
pruefe(neuerRaum.lauf !== null && neuerRaum.botFeld.map((b) => b.name).join() === ersteNamen,
  'nach dem Abräumen des Raums baut derselbe Raum Lauf und KI-Feld wieder auf');

console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' PRÜFUNG(EN) FEHLGESCHLAGEN'));
process.exit(fehler === 0 ? 0 : 1);
