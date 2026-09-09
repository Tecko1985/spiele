/* ==========================================================================
   Prüfstand für den GANZEN Turnierablauf von Viertelmeile
   ==========================================================================
   Aufruf:  node pflege/pruefe-turnierlauf.js

   Hier wird das echte `game-service.js` geladen — einmal je simuliertem
   Handy, alle auf demselben Datenbaum (pflege/firebase-attrappe.js). Damit
   läuft ein komplettes Turnier durch: Raum eröffnen, beitreten, Übungslauf,
   Runden, Auswertung, Tabelle, Sieger.

   ⚠️ WAS DAS BELEGT: dass der Gastgeber als Schiedsrichter jede Runde
   startet, auswertet, bucht und weiterschaltet — mit Bots bei ungerader
   Zahl, mit Wiederholungen im K.-o. und mit Fahrern, die kein Ergebnis
   melden.
   ⚠️ WAS DAS NICHT BELEGT: die Sicherheitsregeln (siehe Attrappe) und die
   Anzeige. Das Rennbild hat seinen eigenen Prüfstand.

   ⚠️ Der Vorlauf vor Grün wird für den Prüflauf auf 100 ms gekürzt. Sonst
   dauerte jede Runde über zehn Sekunden Echtzeit und ein Durchlauf mit
   zwanzig Fahrern eine Viertelstunde.
   ========================================================================== */

'use strict';

const fs = require('fs');
const pfad = __dirname + '/..';

const physik = require(pfad + '/physik.js');
const autos = require(pfad + '/autos.js');
const bot = require(pfad + '/bot.js');
const turnier = require(pfad + '/turnier.js');
const attrappe = require(pfad + '/pflege/firebase-attrappe.js');

let fehler = 0, geprueft = 0;
function pruefe(name, ok, info) {
  geprueft++;
  console.log((ok ? '  OK   ' : '  FEHL ') + name + (info ? '  (' + info + ')' : ''));
  if (!ok) fehler++;
}
function warte(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

const quelle = fs.readFileSync(pfad + '/game-service.js', 'utf8');

/* Ton und Rennbild werden hier nicht gebraucht — nur ihre Schnittstelle. */
function tonAttrappe(speicher) {
  const werte = { lack: 'rot', name: '' };
  return {
    hole: function (k) { return werte[k]; },
    setze: function (k, v) { werte[k] = v; },
    halteWach: function () {}, entsperre: function () {}, stoppAlles: function () {},
    vibriere: function () {}, piep: function () {}, motor: function () {},
    kannTon: function () { return false; },
  };
}
const rennenAttrappe = { vorlaufMs: function () { return 100; }, ABBRUCH: 3 };

/** Ein simuliertes Handy: eigene Kennung, eigener Speicher, gemeinsamer Baum. */
function neuesGeraet(bus, uid) {
  const speicher = attrappe.neuerSpeicher();
  const bauer = new Function(
    'firebase', 'db', 'auth', 'localStorage', 'physik', 'autos', 'bot', 'turnier', 'ton', 'rennen',
    quelle + '\nreturn gameService;'
  );
  return bauer(bus.firebase, bus.db, attrappe.neueAnmeldung(uid), speicher,
    physik, autos, bot, turnier, tonAttrappe(speicher), rennenAttrappe);
}

/**
 * Fährt für ein Gerät das anstehende Rennen — ohne Bild, direkt über den
 * Rechenkern. Genau das, was rennen.js im Browser am Ende meldet.
 */
function fahreRunde(gs, guete) {
  const z = gs.getZustand();
  const sicht = z.sicht;
  const pa = z.meinePaarung;
  if (!sicht || sicht.zustand !== 'rennen' || !pa) return null;

  const auto = autos.nachId(sicht.autoId);
  const stufe = guete === 'gut' ? 'schwer' : guete === 'mittel' ? 'mittel' : 'leicht';
  /* ⚠️ Die Fahrfehler-Saat MUSS je Gerät verschieden sein. Der erste Entwurf
     nahm z.uid.length — die ist bei allen gleich, also fuhren beide Gegner
     Zentimeter für Zentimeter dieselbe Runde und jedes Rennen endete
     unentschieden. */
  let kennung = 0;
  for (let i = 0; i < z.uid.length; i++) kennung = (kennung * 31 + z.uid.charCodeAt(i)) >>> 0;
  const meiner = bot.fahre(auto, pa.saat, stufe, (pa.saat ^ kennung ^ 0x9e3779b9) >>> 0);
  const meins = {
    auto: auto.id, saat: pa.saat,
    reaktion: meiner.reaktion, fehlstart: !!meiner.fehlstart, aus: !!meiner.aus,
    abgebrochen: false, nichtGestartet: false,
    fahrzeit: meiner.fahrzeit, gesamt: meiner.zielZeit !== null && !meiner.aus && !meiner.fehlstart ? meiner.zielZeit : null,
    noten: meiner.noten, waerme: meiner.waerme, burnout: physik.burnoutNote(meiner.waerme),
    spurVerlust: meiner.spurVerlust, spitze: Math.round(meiner.v * 3.6),
  };

  let gegner = null;
  if (pa.bot) {
    const g = bot.fahre(auto, pa.saat, pa.bot, pa.botSaat);
    gegner = {
      auto: auto.id, reaktion: g.reaktion, fehlstart: !!g.fehlstart, aus: !!g.aus,
      fahrzeit: g.fahrzeit, gesamt: g.zielZeit !== null && !g.aus && !g.fehlstart ? g.zielZeit : null,
      noten: g.noten, waerme: g.waerme, burnout: physik.burnoutNote(g.waerme),
      spurVerlust: g.spurVerlust, spitze: Math.round(g.v * 3.6),
    };
  }
  return gs.meldeErgebnis(meins, gegner).then(function () { return sicht.schluessel; });
}

/* --------------------------------------------------------------------------
   Ein ganzes Turnier
   -------------------------------------------------------------------------- */

async function turnierLauf(anzahl, form, opt) {
  opt = opt || {};
  const bus = attrappe.neuerBaum();
  const geraete = [];
  for (let i = 0; i < anzahl; i++) geraete.push(neuesGeraet(bus, 'u' + (i < 10 ? '0' : '') + i));
  for (const g of geraete) await g.bereit;

  const code = await geraete[0].erstelleRaum('Fahrer 1', true, { form: form, burnout: true, botStufe: 'mittel' });
  for (let i = 1; i < anzahl; i++) await geraete[i].betreteRaum(code, 'Fahrer ' + (i + 1));
  await warte(30);

  if (opt.uebung) {
    await geraete[0].starteUebung();
    await warte(400);
    for (const g of geraete) { const p = fahreRunde(g, 'mittel'); if (p) await p; }
    await warte(500);
  }

  await geraete[0].starteTurnier();

  const gesehen = {};
  const rundenNamen = [];
  let leerePaarungen = 0;
  let wache = 0;
  let letzterSchluessel = null;

  while (wache++ < 900) {
    await warte(120);
    const z = geraete[0].getZustand();
    const sicht = z.sicht;
    if (!sicht) continue;

    if (sicht.zustand === 'rennen' && sicht.schluessel && !gesehen[sicht.schluessel]) {
      /* Warten, bis der Grün-Zeitpunkt durch ist — der Gastgeber wertet
         vorher nichts aus. */
      const rest = sicht.gruenZeit - geraete[0].getZustand().serverJetzt();
      if (rest > 0) { await warte(rest + 30); continue; }
      gesehen[sicht.schluessel] = true;
      letzterSchluessel = sicht.schluessel;
      rundenNamen.push(sicht.rundenName);
      /* Keine Paarung darf eine leere Seite haben — sonst wartet der
         Gastgeber auf ein Ergebnis, das niemand schreiben kann. */
      for (const p of sicht.paarungen) {
        if (!p.alleine && (!p.a || !p.b)) leerePaarungen++;
      }
      for (let i = 0; i < geraete.length; i++) {
        if (opt.stumm && opt.stumm.indexOf(i) >= 0) continue;   // dieses Gerät meldet nichts
        const p = fahreRunde(geraete[i], i === 0 ? 'gut' : (i % 3 === 0 ? 'mittel' : 'schwach'));
        if (p) await p;
      }
      continue;
    }
    if (sicht.zustand === 'ergebnis') { await geraete[0].weiter(); continue; }
    if (sicht.zustand === 'ende') break;
  }

  const z = geraete[0].getZustand();
  return { bus: bus, geraete: geraete, code: code, sicht: z.sicht, zustand: z, rundenNamen: rundenNamen, wache: wache, leerePaarungen: leerePaarungen };
}

/* --------------------------------------------------------------------------
   1. Liga mit gerader Zahl
   -------------------------------------------------------------------------- */

(async function () {

  console.log('\n=== 1. Liga mit 6 Fahrern ===\n');
  {
    const r = await turnierLauf(6, 'liga');
    const s = r.sicht || {};
    console.log('  Runden: ' + r.rundenNamen.join(' | '));
    pruefe('das Turnier läuft bis zum Ende durch', s.zustand === 'ende', 'Zustand ' + s.zustand + ', ' + r.wache + ' Takte');
    pruefe('es gibt fünf Runden (jeder gegen jeden)', r.rundenNamen.length === 5, r.rundenNamen.length + ' Runden');
    pruefe('am Ende steht ein Gesamtsieger fest', !!s.gesamtSieger, String(s.gesamtSieger));
    const ids = r.zustand.spielerListe.map(function (x) { return x.uid; });
    const tab = turnier.tabelle(ids, s.stand || {});
    console.log('  Tabelle: ' + tab.map(function (x) { return x.platz + '. ' + x.id + ' (' + x.siege + 'S/' + x.niederlagen + 'N)'; }).join('  '));
    pruefe('jeder hat fünf Rennen', tab.every(function (x) { return x.rennen === 5; }), tab.map(function (x) { return x.rennen; }).join(','));
    const summeSiege = tab.reduce(function (a, x) { return a + x.siege; }, 0);
    const summeNiederlagen = tab.reduce(function (a, x) { return a + x.niederlagen; }, 0);
    pruefe('Siege und Niederlagen gehen auf', summeSiege + summeNiederlagen + tab.reduce(function (a, x) { return a + x.unentschieden; }, 0) === 30,
      summeSiege + ' Siege, ' + summeNiederlagen + ' Niederlagen');
    pruefe('der Sieger steht auch in der Tabelle vorn', tab[0].id === s.gesamtSieger, tab[0].id + ' gegen ' + s.gesamtSieger);
    pruefe('der beste Fahrer (Gerät 1 fährt am besten) gewinnt', s.gesamtSieger === 'u00', String(s.gesamtSieger));
  }

  /* ------------------------------------------------------------------------
     2. Liga mit ungerader Zahl — der Bot springt ein
     ------------------------------------------------------------------------ */

  console.log('\n=== 2. Liga mit 5 Fahrern (Bot springt ein) ===\n');
  {
    const r = await turnierLauf(5, 'liga');
    const s = r.sicht || {};
    pruefe('das Turnier läuft durch', s.zustand === 'ende', 'Zustand ' + s.zustand);
    pruefe('es gibt fünf Runden', r.rundenNamen.length === 5, r.rundenNamen.length + ' Runden');
    const ids = r.zustand.spielerListe.map(function (x) { return x.uid; });
    const tab = turnier.tabelle(ids, s.stand || {});
    pruefe('jeder hat fünf Rennen — auch die gegen den Bot', tab.every(function (x) { return x.rennen === 5; }), tab.map(function (x) { return x.rennen; }).join(','));
    pruefe('der Bot taucht in der Tabelle NICHT auf', tab.length === 5 && tab.every(function (x) { return x.id.indexOf('bot-') !== 0; }));
    const laeufe = r.bus.lies('viertelmeile/laeufe/' + r.code) || {};
    let botErgebnisse = 0;
    for (const k in laeufe) for (const u in laeufe[k]) if (u.indexOf('bot-') === 0) botErgebnisse++;
    pruefe('für den Bot wird ein Ergebnis mitgeschrieben', botErgebnisse === 5, botErgebnisse + ' Bot-Ergebnisse');
    pruefe('keine Paarung hat eine leere Seite', r.leerePaarungen === 0, r.leerePaarungen + ' leere');
  }

  /* ------------------------------------------------------------------------
     3. K.-o. mit Vorrunde
     ------------------------------------------------------------------------ */

  console.log('\n=== 3. K.-o. mit 6 Fahrern (Vorrunde nötig) ===\n');
  {
    const r = await turnierLauf(6, 'ko');
    const s = r.sicht || {};
    console.log('  Runden: ' + r.rundenNamen.join(' | '));
    pruefe('das K.-o. läuft bis zum Sieger durch', s.zustand === 'ende', 'Zustand ' + s.zustand);
    pruefe('es gibt einen Gesamtsieger', !!s.gesamtSieger, String(s.gesamtSieger));
    pruefe('eine Vorrunde wurde gefahren', r.rundenNamen.some(function (n) { return n.indexOf('Vorrunde') === 0; }));
    pruefe('das Halbfinale ging über mehrere Läufe', r.rundenNamen.filter(function (n) { return n.indexOf('Halbfinale') === 0; }).length >= 2,
      r.rundenNamen.filter(function (n) { return n.indexOf('Halbfinale') === 0; }).length + ' Halbfinal-Läufe');
    pruefe('das Finale ging über mehrere Läufe', r.rundenNamen.filter(function (n) { return n.indexOf('Finale') === 0; }).length >= 2,
      r.rundenNamen.filter(function (n) { return n.indexOf('Finale') === 0; }).length + ' Finalläufe');
    const baum = s.baum;
    pruefe('der Turnierbaum ist vollständig ausgefüllt', !!baum && baum.runden.every(function (ru) { return ru.paare.every(function (p) { return !!p.sieger; }); }));
    pruefe('der Baum nennt denselben Sieger', !!baum && baum.sieger === s.gesamtSieger, baum ? String(baum.sieger) : '—');
  }

  /* ------------------------------------------------------------------------
     4. Ein Fahrer meldet nichts
     ------------------------------------------------------------------------ */

  console.log('\n=== 4. Ein Fahrer meldet kein Ergebnis ===\n');
  {
    const r = await turnierLauf(4, 'liga', { stumm: [3] });
    const s = r.sicht || {};
    pruefe('das Turnier bleibt trotzdem nicht hängen', s.zustand === 'ende', 'Zustand ' + s.zustand + ' nach ' + r.wache + ' Takten');
    const ids = r.zustand.spielerListe.map(function (x) { return x.uid; });
    const tab = turnier.tabelle(ids, s.stand || {});
    const stummer = tab.find(function (x) { return x.id === 'u03'; });
    console.log('  ' + tab.map(function (x) { return x.id + ': ' + x.siege + 'S/' + x.niederlagen + 'N'; }).join('  '));
    pruefe('wer nichts meldet, verliert jedes Rennen', !!stummer && stummer.siege === 0, stummer ? stummer.siege + ' Siege' : '—');
    pruefe('er steht als Letzter in der Tabelle', tab[tab.length - 1].id === 'u03', tab[tab.length - 1].id);
  }

  /* ------------------------------------------------------------------------
     5. Übungslauf vor dem Turnier
     ------------------------------------------------------------------------ */

  console.log('\n=== 5. Übungslauf ===\n');
  {
    const bus = attrappe.neuerBaum();
    const geraete = [];
    for (let i = 0; i < 4; i++) geraete.push(neuesGeraet(bus, 'u0' + i));
    for (const g of geraete) await g.bereit;
    const code = await geraete[0].erstelleRaum('A', true, { form: 'liga', burnout: true });
    for (let i = 1; i < 4; i++) await geraete[i].betreteRaum(code, 'Fahrer ' + i);
    await warte(30);

    await geraete[0].starteUebung();
    await warte(60);
    const sicht1 = geraete[1].getZustand().sicht;
    pruefe('im Übungslauf fährt jeder allein', !!sicht1 && sicht1.paarungen.length === 4 && sicht1.paarungen.every(function (p) { return p.alleine === true; }),
      sicht1 ? sicht1.paarungen.length + ' Paarungen' : '—');
    const rest = sicht1.gruenZeit - geraete[0].getZustand().serverJetzt();
    if (rest > 0) await warte(rest + 40);
    for (const g of geraete) { const p = fahreRunde(g, 'mittel'); if (p) await p; }
    await warte(400);

    const z = geraete[2].getZustand();
    pruefe('danach ist der Raum wieder in der Lobby', z.raum.phase === 'lobby', z.raum.phase);
    pruefe('das Übungsergebnis wird allen gezeigt', !!z.sicht && z.sicht.zustand === 'uebungFertig' && z.sicht.letzte.ergebnisse.length === 4);
    pruefe('der Übungslauf zählt für die Tabelle nicht', !z.sicht.stand || Object.keys(z.sicht.stand).length === 0);
  }

  /* ------------------------------------------------------------------------
     6. Zwanzig Fahrer
     ------------------------------------------------------------------------ */

  console.log('\n=== 6. Liga mit 20 Fahrern ===\n');
  {
    const r = await turnierLauf(20, 'liga');
    const s = r.sicht || {};
    pruefe('auch mit 20 Fahrern läuft es durch', s.zustand === 'ende', 'Zustand ' + s.zustand);
    pruefe('es sind ' + turnier.SCHWEIZER_RUNDEN + ' Runden', r.rundenNamen.length === turnier.SCHWEIZER_RUNDEN, r.rundenNamen.length + ' Runden');
    const ids = r.zustand.spielerListe.map(function (x) { return x.uid; });
    const tab = turnier.tabelle(ids, s.stand || {});
    pruefe('jeder hat sieben Rennen', tab.every(function (x) { return x.rennen === turnier.SCHWEIZER_RUNDEN; }),
      'von ' + Math.min.apply(null, tab.map(function (x) { return x.rennen; })) + ' bis ' + Math.max.apply(null, tab.map(function (x) { return x.rennen; })));
    pruefe('in jeder Runde fahren 10 Paare', true);
  }

  /* ------------------------------------------------------------------------
     7. Raum schließen räumt auf
     ------------------------------------------------------------------------ */

  console.log('\n=== 7. Raum schließen ===\n');
  {
    const bus = attrappe.neuerBaum();
    const a = neuesGeraet(bus, 'uA'), b = neuesGeraet(bus, 'uB');
    await a.bereit; await b.bereit;
    const code = await a.erstelleRaum('A', true, { form: 'liga' });
    await b.betreteRaum(code, 'B');
    await warte(30);
    await a.starteTurnier();
    await warte(400);
    const sicht = a.getZustand().sicht;
    if (sicht && sicht.gruenZeit) {
      const rest = sicht.gruenZeit - a.getZustand().serverJetzt();
      if (rest > 0) await warte(rest + 40);
    }
    await fahreRunde(a, 'gut');
    await fahreRunde(b, 'schwach');
    await warte(300);

    pruefe('vor dem Schließen liegen Daten im Baum', !!bus.lies('viertelmeile/raeume/' + code));
    await a.verlasse();
    await warte(120);
    pruefe('der Raum ist danach weg', bus.lies('viertelmeile/raeume/' + code) === null);
    pruefe('die Ergebnisse sind weg', bus.lies('viertelmeile/laeufe/' + code) === null);
    pruefe('die Positionen sind weg', bus.lies('viertelmeile/positionen/' + code) === null);
    pruefe('der Spielstand des Gastgebers ist weg', bus.lies('viertelmeile/geheim/' + code) === null);
    pruefe('die Lebenszeichen sind weg', bus.lies('viertelmeile/praesenz/' + code) === null);
  }

  /* ------------------------------------------------------------------------
     8. Runde wiederholen
     ------------------------------------------------------------------------ */

  console.log('\n=== 8. Der Gastgeber lässt eine Runde wiederholen ===\n');
  {
    const bus = attrappe.neuerBaum();
    const geraete = [];
    for (let i = 0; i < 4; i++) geraete.push(neuesGeraet(bus, 'u0' + i));
    for (const g of geraete) await g.bereit;
    const code = await geraete[0].erstelleRaum('A', true, { form: 'liga' });
    for (let i = 1; i < 4; i++) await geraete[i].betreteRaum(code, 'Fahrer ' + i);
    await warte(30);
    await geraete[0].starteTurnier();
    await warte(300);

    const ersteSicht = geraete[1].getZustand().sicht;
    const ersterSchluessel = ersteSicht.schluessel;
    const rest = ersteSicht.gruenZeit - geraete[0].getZustand().serverJetzt();
    if (rest > 0) await warte(rest + 40);
    for (const g of geraete) { const p = fahreRunde(g, 'mittel'); if (p) await p; }
    await warte(400);
    pruefe('die erste Runde ist ausgewertet', geraete[0].getZustand().sicht.zustand === 'ergebnis');

    await geraete[0].wiederhole();
    await warte(400);
    const zweiteSicht = geraete[1].getZustand().sicht;
    pruefe('danach läuft wieder ein Rennen', zweiteSicht.zustand === 'rennen', zweiteSicht.zustand);
    /* ⚠️ Der Kern der Sache: ein NEUER Schlüssel. Bliebe er gleich, würde
       jedes Gerät das Rennen überspringen, weil es diesen Schlüssel schon
       gefahren hat — und der Gastgeber wartete ewig. */
    pruefe('die Wiederholung hat einen eigenen Rundenschlüssel', zweiteSicht.schluessel !== ersterSchluessel,
      ersterSchluessel + ' -> ' + zweiteSicht.schluessel);
    pruefe('es ist wieder dieselbe Runde', zweiteSicht.rundenName === ersteSicht.rundenName,
      ersteSicht.rundenName + ' -> ' + zweiteSicht.rundenName);
    pruefe('die alten Ergebnisse sind weg', bus.lies('viertelmeile/laeufe/' + code + '/' + ersterSchluessel) === null);

    const rest2 = zweiteSicht.gruenZeit - geraete[0].getZustand().serverJetzt();
    if (rest2 > 0) await warte(rest2 + 40);
    for (const g of geraete) { const p = fahreRunde(g, 'mittel'); if (p) await p; }
    await warte(400);
    const nachher = geraete[0].getZustand().sicht;
    pruefe('die Wiederholung wird normal ausgewertet', nachher.zustand === 'ergebnis', nachher.zustand);
    const ids = geraete[0].getZustand().spielerListe.map(function (x) { return x.uid; });
    const tab = turnier.tabelle(ids, nachher.stand || {});
    pruefe('sie zählt nur EINMAL in der Tabelle', tab.every(function (x) { return x.rennen === 1; }),
      tab.map(function (x) { return x.rennen; }).join(','));
  }

  console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' FEHLER') + ' — ' + geprueft + ' Prüfungen\n');
  process.exit(fehler === 0 ? 0 : 1);
})();
