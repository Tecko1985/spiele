/* ==========================================================================
   Werwolf — Prüfskript
   ==========================================================================

   Aufruf (im Ordner werwolf):

     node pflege/pruefe-regeln.js
     node pflege/pruefe-regeln.js 3000      (Zufallspartien)

   Teil 1: feste Partien mit vorgegebenen Rollen — jede Siegbedingung, jede
           Todes-Kette, jeder Sonderfall aus dem Auftrag.
   Teil 2: Zufallspartien mit reproduzierbarer Saat. Nach jedem Schritt wird
           geprüft, dass der Zustand in sich stimmt (niemand stirbt zweimal,
           jede Partie endet, keine Ausnahme fliegt).

   ⚠️ Es prüft die REGELN, nicht die Oberfläche und nicht Firebase.
   ========================================================================== */

'use strict';

const assert = require('assert');
const rollen = require('../rollen.js');
const regeln = require('../regeln.js');

let geprueft = 0;
function test(name, fn) {
  try { fn(); geprueft++; console.log('  ok   ' + name); }
  catch (f) { console.log('  FEHL ' + name + '\n       ' + (f.stack || f.message)); process.exitCode = 1; }
}

/* Reproduzierbarer Zufall (mulberry32). */
function saat(s) {
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------------
   Hilfen zum Aufbau
   ---------------------------------------------------------------------- */

function spielMit(rollenJeName, einstellungen) {
  const namen = Object.keys(rollenJeName);
  const z = {};
  for (const n of namen) z[rollenJeName[n]] = (z[rollenJeName[n]] || 0) + 1;
  const liste = namen.map(function (n) { return { uid: 'u_' + n, name: n }; });
  if (z.dieb) { z.dorfbewohner = (z.dorfbewohner || 0) + 2; }
  const spiel = regeln.neuesSpiel(liste, z, einstellungen || {}, saat(1));
  /* Rollen fest zuweisen — der Test will wissen, wer was ist. */
  for (const s of spiel.spieler) s.rolle = rollenJeName[s.name];
  if (z.dieb) spiel.uebrigeKarten = ['dorfbewohner', 'dorfbewohner'];
  for (const s of spiel.spieler) regeln.rolleGesehen(spiel, s.uid);
  return spiel;
}

function uid(name) { return 'u_' + name; }
function lebt(spiel, name) { return regeln.spielerVon(spiel, uid(name)).lebt; }
function ok(r, was) { assert.strictEqual(r.ok, true, (was || '') + ' ' + (r.fehler || '')); }
function fehl(r, was) { assert.strictEqual(r.ok, false, was || 'sollte scheitern'); }

/**
 * Spielt eine Nacht durch. `plan` ist {schrittId: function(spiel, handelndeUids)}.
 * Schritte ohne Plan werden erzwungen (= nichts tun).
 */
function nacht(spiel, plan) {
  if (spiel.phase !== 'nacht') ok(regeln.starteNacht(spiel), 'Nacht starten');
  let schutz = 0;
  while (spiel.phase === 'nacht' && spiel.nacht.schritt) {
    if (++schutz > 50) throw new Error('Nacht endet nicht');
    const s = regeln.aktuellerSchritt(spiel);
    if (s.aktiv && plan && plan[s.id]) plan[s.id](spiel, s.handelnde);
    if (regeln.schrittFertig(spiel)) ok(regeln.weiter(spiel), 'weiter ' + s.id);
    else ok(regeln.schrittErzwingen(spiel), 'erzwingen ' + s.id);
  }
}

/** Durch die Verkündungen bis zur Abstimmung (oder bis zum Ende / zur Nacht). */
function bisAbstimmung(spiel) {
  let schutz = 0;
  while (spiel.phase === 'tag' && ['morgen', 'ergebnis', 'diskussion'].indexOf(spiel.tag.schritt) >= 0) {
    if (++schutz > 20) throw new Error('Tag hängt in ' + spiel.tag.schritt);
    const schritt = spiel.tag.schritt;
    ok(regeln.tagWeiter(spiel), 'tagWeiter ' + schritt);
  }
}

function abstimmen(spiel, stimmen) {
  assert.ok(spiel.tag.schritt === 'abstimmung' || spiel.tag.schritt === 'stichwahl', 'Abstimmung erwartet, ist ' + spiel.tag.schritt);
  for (const w in stimmen) ok(regeln.stimme(spiel, uid(w), stimmen[w] ? uid(stimmen[w]) : null), 'Stimme ' + w);
  ok(regeln.abstimmungSchliessen(spiel), 'schließen');
}

/* ======================================================================
   Teil 1 — Rollen und Zusammenstellung
   ====================================================================== */

console.log('Rollen');

test('Empfehlung liefert für 5 bis 20 Spieler genau so viele Karten', function () {
  for (let n = 5; n <= 20; n++) {
    const z = rollen.empfehlung(n);
    assert.strictEqual(rollen.anzahlKarten(z), n, n + ' Spieler');
    assert.ok(rollen.pruefe(n, z).ok, n + ' Spieler: ' + rollen.pruefe(n, z).fehler.join(' '));
  }
  assert.strictEqual(rollen.empfehlung(8).werwolf, 2);
  assert.strictEqual(rollen.empfehlung(12).werwolf, 3);
  assert.strictEqual(rollen.empfehlung(16).werwolf, 4);
});

test('Prüfung lehnt falsche Kartenzahl, fehlende Wölfe und zu wenige Spieler ab', function () {
  assert.ok(!rollen.pruefe(8, { werwolf: 2, dorfbewohner: 5 }).ok);
  assert.ok(!rollen.pruefe(8, { dorfbewohner: 8 }).ok);
  assert.ok(!rollen.pruefe(4, { werwolf: 1, dorfbewohner: 3 }).ok);
  assert.ok(!rollen.pruefe(8, { werwolf: 2, seherin: 2, dorfbewohner: 4 }).ok, 'zwei Seherinnen');
  /* Mit Dieb: zwei Karten mehr. */
  assert.ok(!rollen.pruefe(6, { werwolf: 1, dieb: 1, dorfbewohner: 4 }).ok);
  assert.ok(rollen.pruefe(6, { werwolf: 1, dieb: 1, dorfbewohner: 6 }).ok);
});

test('Rollen werden verteilt, Anzahl stimmt, Dieb bekommt zwei übrige Karten', function () {
  const liste = [];
  for (let i = 0; i < 8; i++) liste.push({ uid: 'p' + i, name: 'P' + i });
  const spiel = regeln.neuesSpiel(liste, { werwolf: 2, seherin: 1, hexe: 1, jaeger: 1, amor: 1, dorfbewohner: 2 }, {}, saat(7));
  const z = {};
  for (const s of spiel.spieler) z[s.rolle] = (z[s.rolle] || 0) + 1;
  assert.deepStrictEqual(z, { werwolf: 2, seherin: 1, hexe: 1, jaeger: 1, amor: 1, dorfbewohner: 2 });
  assert.strictEqual(spiel.uebrigeKarten.length, 0);

  const s2 = regeln.neuesSpiel(liste, { werwolf: 2, dieb: 1, dorfbewohner: 7 }, {}, saat(7));
  assert.strictEqual(s2.uebrigeKarten.length, 2);
});

/* ======================================================================
   Teil 1 — Nachtablauf
   ====================================================================== */

console.log('Nachtablauf');

test('Nacht ruft jede Rolle der Zusammenstellung, auch tote — und in der richtigen Reihenfolge', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'seherin', D: 'hexe', E: 'jaeger', F: 'amor', G: 'dorfbewohner', H: 'dorfbewohner' });
  regeln.starteNacht(spiel);
  assert.deepStrictEqual(regeln.nachtSchritte(spiel), ['amor', 'verliebte', 'werwolf', 'hexe', 'seherin']);
  /* Seherin tot: wird trotzdem gerufen, aber als Attrappe. */
  regeln.spielerVon(spiel, uid('C')).lebt = false;
  spiel.nachtNr = 2;
  assert.deepStrictEqual(regeln.nachtSchritte(spiel), ['werwolf', 'hexe', 'seherin']);
  spiel.nacht.schritt = 'seherin';
  assert.strictEqual(regeln.aktuellerSchritt(spiel).aktiv, false);
  assert.strictEqual(regeln.schrittFertig(spiel), true);
});

test('Weißer Werwolf wird nur in jeder zweiten Nacht gerufen', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'weisserWerwolf', C: 'seherin', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  regeln.starteNacht(spiel);
  assert.deepStrictEqual(regeln.nachtSchritte(spiel), ['werwolf', 'seherin']);
  spiel.nachtNr = 2;
  assert.deepStrictEqual(regeln.nachtSchritte(spiel), ['werwolf', 'weisserWerwolf', 'seherin']);
});

test('Wölfe stimmen ab: Mehrheit stirbt, Gleichstand = niemand, Wölfe sind kein Ziel', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp) {
      fehl(regeln.nachtAktion(sp, uid('A'), { ziel: uid('B') }), 'Wolf auf Wolf');
      ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') }));
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('D') }));
    },
  });
  assert.ok(lebt(spiel, 'C') && lebt(spiel, 'D'), 'Gleichstand: niemand stirbt');
  assert.strictEqual(spiel.tag.tote.length, 0);
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: null, B: null, C: null, D: null, E: null, F: null, G: null });
  bisAbstimmung(spiel);
  assert.strictEqual(spiel.phase, 'nacht');
  nacht(spiel, {
    werwolf: function (sp) {
      ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') }));
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') }));
    },
  });
  assert.ok(!lebt(spiel, 'C'));
  assert.strictEqual(spiel.tag.tote[0].ursache, 'woelfe');
});

test('Beschützer schützt das Wolfsopfer — und darf nicht zweimal dieselbe Person', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'beschuetzer', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  nacht(spiel, {
    beschuetzer: function (sp) { ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') })); },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') })); },
  });
  assert.ok(lebt(spiel, 'C'), 'geschützt');
  bisAbstimmung(spiel);
  abstimmen(spiel, {});
  bisAbstimmung(spiel);
  nacht(spiel, {
    beschuetzer: function (sp) {
      fehl(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') }), 'zweimal dieselbe');
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('B') }), 'sich selbst');
    },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') })); },
  });
  assert.ok(!lebt(spiel, 'C'));
});

test('Hexe rettet sich selbst und vergiftet in derselben Nacht; Tränke sind danach weg', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'hexe', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('B') })); },
    hexe: function (sp) {
      const sicht = regeln.sichtFuer(sp, uid('B'));
      assert.strictEqual(sicht.aufgabe.opfer.name, 'B', 'Hexe sieht sich als Opfer');
      ok(regeln.nachtAktion(sp, uid('B'), { heilen: true, gift: uid('C') }));
    },
  });
  assert.ok(lebt(spiel, 'B'), 'Hexe lebt');
  assert.ok(!lebt(spiel, 'C'), 'C vergiftet');
  assert.strictEqual(spiel.tag.tote[0].ursache, 'gift');
  assert.deepStrictEqual(spiel.hexe, { heil: false, gift: false });
  bisAbstimmung(spiel);
  abstimmen(spiel, {});
  bisAbstimmung(spiel);
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('D') })); },
    hexe: function (sp) {
      fehl(regeln.nachtAktion(sp, uid('B'), { heilen: true }), 'Heiltrank verbraucht');
      fehl(regeln.nachtAktion(sp, uid('B'), { gift: uid('E') }), 'Gift verbraucht');
      ok(regeln.nachtAktion(sp, uid('B'), {}));
    },
  });
  assert.ok(!lebt(spiel, 'D'));
});

test('Seherin sieht die echte Rolle und muss bestätigen, bevor der Schritt fertig ist', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'seherin', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  regeln.starteNacht(spiel);
  while (spiel.nacht.schritt !== 'seherin') regeln.weiter(spiel);
  fehl(regeln.nachtAktion(spiel, uid('B'), { ziel: uid('B') }), 'sich selbst');
  ok(regeln.nachtAktion(spiel, uid('B'), { ziel: uid('A') }));
  const sicht = regeln.sichtFuer(spiel, uid('B'));
  assert.strictEqual(sicht.aufgabe.ergebnis.rolle, 'werwolf');
  assert.strictEqual(regeln.schrittFertig(spiel), false, 'noch nicht bestätigt');
  ok(regeln.nachtAktion(spiel, uid('B'), { bestaetigt: true }));
  assert.strictEqual(regeln.schrittFertig(spiel), true);
});

test('Der Alte überlebt Angriff Nr. 1 und stirbt bei Angriff Nr. 2', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'alte', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  const angriff = { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('B') })); } };
  nacht(spiel, angriff);
  assert.ok(lebt(spiel, 'B'), 'überlebt');
  bisAbstimmung(spiel); abstimmen(spiel, {}); bisAbstimmung(spiel);
  nacht(spiel, angriff);
  assert.ok(!lebt(spiel, 'B'), 'stirbt beim zweiten');
  assert.strictEqual(spiel.dorfOhneFaehigkeit, false, 'Wölfe lösen keinen Fähigkeitsverlust aus');
});

test('Heilt die Hexe den Alten, bleibt sein Freischuss erhalten', function () {
  /* ⚠️ Bugjagd 05.09.2026: der Freischuss des Alten stand VOR dem
     Heiltrank. Eine einzige Wolfsnacht verbrannte damit beide
     Einmal-Rettungen des Dorfes — der Trank war in `nachtAktion` schon
     weg, der Alte überlebte über den anderen Zweig, und in der nächsten
     Nacht reichte derselbe Angriff. Die Hexe kann dem nicht ausweichen:
     sie sieht nur den Namen des Opfers, nicht seine Rolle. */
  const spiel = spielMit({ A: 'werwolf', B: 'alte', C: 'hexe', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('B') })); },
    hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('C'), { heilen: true, gift: null })); },
  });
  assert.ok(lebt(spiel, 'B'), 'der Alte überlebt');
  assert.strictEqual(spiel.hexe.heil, false, 'der Heiltrank ist verbraucht');
  assert.strictEqual(spiel.alte.angriffe, 0, 'der Freischuss des Alten ist NICHT verbraucht');

  bisAbstimmung(spiel); abstimmen(spiel, {}); bisAbstimmung(spiel);
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('B') })); } });
  assert.ok(lebt(spiel, 'B'), 'in der zweiten Nacht greift der Freischuss');
  assert.strictEqual(spiel.alte.angriffe, 1, 'jetzt ist er verbraucht');
});

test('Stirbt der Alte durch das Dorf, verlieren Seherin und Hexe ihre Fähigkeit', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'alte', C: 'seherin', D: 'hexe', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('E') })); } });
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: 'B', C: 'B', D: 'B', F: 'B', G: 'B' });
  assert.ok(!lebt(spiel, 'B'));
  assert.strictEqual(spiel.dorfOhneFaehigkeit, true);
  bisAbstimmung(spiel);
  assert.strictEqual(spiel.phase, 'nacht');
  const schritte = regeln.nachtSchritte(spiel);
  assert.ok(schritte.indexOf('seherin') >= 0, 'wird weiter gerufen');
  assert.strictEqual(regeln.handelnde(spiel, 'seherin').length, 0, 'aber handelt nicht');
  assert.strictEqual(regeln.handelnde(spiel, 'hexe').length, 0);
});

test('Amor: Verliebte erkennen sich, Partner stirbt mit — auch wenn beide in derselben Nacht sterben', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'amor', C: 'hexe', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, {
    amor: function (sp) {
      fehl(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('D'), uid('D')] }), 'zweimal derselbe');
      ok(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('D'), uid('E')] }));
    },
    verliebte: function (sp, h) {
      assert.deepStrictEqual(h.sort(), [uid('D'), uid('E')]);
      assert.strictEqual(regeln.sichtFuer(sp, uid('D')).verliebtMit.name, 'E');
    },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('D') })); },
    hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('C'), { gift: uid('E') })); },
  });
  assert.ok(!lebt(spiel, 'D') && !lebt(spiel, 'E'));
  assert.strictEqual(spiel.tag.tote.length, 2, 'jeder stirbt genau einmal');
  const ursachen = spiel.tag.tote.map(function (t) { return t.ursache; }).sort();
  assert.deepStrictEqual(ursachen, ['gift', 'woelfe']);
});

test('Jäger stirbt durch Gift, sein Schuss trifft einen Verliebten, dessen Partner stirbt mit (Kette)', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'hexe', C: 'jaeger', D: 'amor', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner', H: 'dorfbewohner' });
  nacht(spiel, {
    amor: function (sp) { ok(regeln.nachtAktion(sp, uid('D'), { ziele: [uid('E'), uid('F')] })); },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('G') })); },
    hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('B'), { gift: uid('C') })); },
  });
  assert.ok(!lebt(spiel, 'C') && !lebt(spiel, 'G'));
  assert.strictEqual(spiel.tag.schritt, 'morgen');
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.tag.schritt, 'jaeger', 'Jäger muss schießen');
  assert.strictEqual(spiel.tag.jaegerUid, uid('C'));
  assert.strictEqual(spiel.ende, null, 'kein Sieg, solange der Jäger offen ist');
  fehl(regeln.jaegerSchuss(spiel, uid('E'), uid('A')), 'nur der Jäger');
  const js = regeln.jaegerSicht(spiel, uid('C'));
  assert.ok(js.kandidaten.every(function (k) { return k.uid !== uid('C'); }));
  ok(regeln.jaegerSchuss(spiel, uid('C'), uid('E')));
  assert.ok(!lebt(spiel, 'E') && !lebt(spiel, 'F'), 'Verliebter und Partner tot');
  assert.strictEqual(spiel.tag.schritt, 'ergebnis');
  assert.strictEqual(spiel.tag.tote.length, 2);
  assert.strictEqual(spiel.tag.tote[1].ursache, 'liebe');
});

test('Dieb: tauscht in Nacht 1, die neue Rolle handelt noch in derselben Nacht', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'dieb', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  spiel.uebrigeKarten = ['seherin', 'dorfbewohner'];
  spiel.zusammenstellung = { werwolf: 1, dieb: 1, seherin: 1, dorfbewohner: 4 };
  let seherinGerufen = false;
  nacht(spiel, {
    dieb: function (sp) {
      const sicht = regeln.sichtFuer(sp, uid('B'));
      assert.strictEqual(sicht.aufgabe.karten[0].id, 'seherin');
      ok(regeln.nachtAktion(sp, uid('B'), { karte: 0 }));
      assert.strictEqual(regeln.spielerVon(sp, uid('B')).rolle, 'seherin');
      assert.deepStrictEqual(sp.uebrigeKarten, ['dieb', 'dorfbewohner']);
    },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') })); },
    seherin: function (sp, h) {
      seherinGerufen = true;
      assert.deepStrictEqual(h, [uid('B')]);
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('A') }));
      ok(regeln.nachtAktion(sp, uid('B'), { bestaetigt: true }));
    },
  });
  assert.ok(seherinGerufen, 'Seherin wurde nach dem Tausch gerufen');
});

test('Dieb: sind beide Karten Wölfe, muss er eine nehmen', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'dieb', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  spiel.uebrigeKarten = ['werwolf', 'werwolf'];
  regeln.starteNacht(spiel);
  assert.strictEqual(spiel.nacht.schritt, 'dieb');
  fehl(regeln.nachtAktion(spiel, uid('B'), { karte: null }), 'muss nehmen');
  ok(regeln.nachtAktion(spiel, uid('B'), { karte: 1 }));
  assert.strictEqual(regeln.spielerVon(spiel, uid('B')).rolle, 'werwolf');
});

test('Weißer Werwolf stimmt mit den Wölfen und tötet in Nacht 2 einen Wolf', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'weisserWerwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp, h) {
      assert.deepStrictEqual(h.sort(), [uid('A'), uid('B')], 'beide heulen');
      ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') }));
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') }));
    },
  });
  assert.ok(!lebt(spiel, 'C'));
  bisAbstimmung(spiel); abstimmen(spiel, {}); bisAbstimmung(spiel);
  nacht(spiel, {
    werwolf: function (sp) {
      ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('D') }));
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('D') }));
    },
    weisserWerwolf: function (sp) {
      fehl(regeln.nachtAktion(sp, uid('B'), { ziel: uid('E') }), 'nur Wölfe');
      ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('A') }));
    },
  });
  assert.ok(!lebt(spiel, 'A') && !lebt(spiel, 'D'));
});

test('Flötenspieler verzaubert zwei je Nacht, Verzauberte erkennen sich', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'floetenspieler', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('E') })); },
    floetenspieler: function (sp) {
      fehl(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('B'), uid('C')] }), 'nicht sich selbst');
      ok(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('C'), uid('D')] }));
    },
    verzauberte: function (sp, h) {
      assert.deepStrictEqual(h.sort(), [uid('C'), uid('D')]);
      assert.strictEqual(regeln.sichtFuer(sp, uid('C')).aufgabe.mitverzauberte[0].name, 'D');
    },
  });
  assert.ok(regeln.spielerVon(spiel, uid('C')).verzaubert);
});

/* ======================================================================
   Teil 1 — Tag
   ====================================================================== */

console.log('Tag');

test('Abstimmung: Mehrheit stirbt, Tote dürfen nicht stimmen, Rolle wird aufgedeckt', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('G') })); ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('G') })); } });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.tag.schritt, 'diskussion');
  ok(regeln.tagWeiter(spiel));
  fehl(regeln.stimme(spiel, uid('G'), uid('A')), 'Toter stimmt');
  abstimmen(spiel, { A: 'C', B: 'C', C: 'A', D: 'A', E: 'A', F: null });
  assert.ok(!lebt(spiel, 'A'));
  const oeff = regeln.oeffentlicheSicht(spiel);
  assert.strictEqual(oeff.tag.tote[0].rolleName, 'Werwolf');
  const a = oeff.spieler.filter(function (s) { return s.uid === uid('A'); })[0];
  assert.strictEqual(a.rolle, 'werwolf', 'aufgedeckt');
  const b = oeff.spieler.filter(function (s) { return s.uid === uid('B'); })[0];
  assert.strictEqual(b.rolle, null, 'Lebende bleiben verdeckt');
});

test('Rollen der Toten bleiben verdeckt, wenn so eingestellt', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' }, { rollenAufdecken: false });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('G') })); ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('G') })); } });
  assert.strictEqual(regeln.oeffentlicheSicht(spiel).tag.tote[0].rolle, null);
});

test('Gleichstand: Stichwahl, dann wieder gleich → niemand stirbt', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'dorfbewohner', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('F') })); } });
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: 'B', B: 'C', C: 'B', D: 'C', E: 'D' });
  assert.strictEqual(spiel.tag.schritt, 'stichwahl');
  assert.deepStrictEqual(spiel.tag.kandidaten.sort(), [uid('B'), uid('C')]);
  fehl(regeln.stimme(spiel, uid('A'), uid('D')), 'nur Kandidaten');
  abstimmen(spiel, { A: 'B', B: 'C', C: 'B', D: 'C' });
  assert.strictEqual(spiel.tag.schritt, 'ergebnis');
  assert.strictEqual(spiel.tag.tote.length, 0);
  assert.ok(lebt(spiel, 'B') && lebt(spiel, 'C'));
});

test('Gleichstand mit Einstellung „niemand": keine Stichwahl', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'dorfbewohner', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' }, { gleichstand: 'niemand', diskussionSek: 0 });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('E') })); } });
  bisAbstimmung(spiel);
  assert.strictEqual(spiel.tag.schritt, 'abstimmung', 'ohne Diskussion direkt zur Abstimmung');
  abstimmen(spiel, { A: 'B', B: 'C', C: 'B', D: 'C' });
  assert.strictEqual(spiel.tag.schritt, 'ergebnis');
  assert.strictEqual(spiel.tag.tote.length, 0);
});

test('Gleichstand mit Sündenbock: er stirbt, und das Dorf verliert nicht seine Fähigkeiten', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'suendenbock', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('F') })); } });
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: 'C', B: 'D', C: 'D', D: 'C', E: null });
  assert.ok(!lebt(spiel, 'B'), 'Sündenbock tot');
  assert.ok(lebt(spiel, 'C') && lebt(spiel, 'D'));
  assert.strictEqual(spiel.tag.tote[0].ursache, 'suendenbock');
});

test('Jäger stirbt durch Abstimmung und schießt sofort', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'jaeger', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('F') })); } });
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: 'B', C: 'B', D: 'B', E: 'B' });
  assert.ok(!lebt(spiel, 'B'));
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.tag.schritt, 'jaeger');
  ok(regeln.jaegerSchuss(spiel, uid('B'), uid('A')));
  assert.ok(!lebt(spiel, 'A'));
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.phase, 'ende');
  assert.strictEqual(spiel.ende.sieger, 'dorf');
});

test('Erzähler wirft einen Spieler raus — am Tag sofort, in der Nacht mit der Auflösung', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  regeln.starteNacht(spiel);
  ok(regeln.toeteManuell(spiel, uid('G')));
  assert.ok(!lebt(spiel, 'G'));
  assert.strictEqual(spiel.phase, 'nacht', 'Nacht läuft weiter');
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') })); ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') })); } });
  assert.strictEqual(spiel.tag.tote.length, 2, 'beide werden am Morgen verkündet');
  ok(regeln.toeteManuell(spiel, uid('D')));
  assert.strictEqual(spiel.tag.tote.length, 3);
  fehl(regeln.toeteManuell(spiel, uid('D')), 'schon tot');
  /* Noch A, B, E, F: 2 Wölfe gegen 2 → Wölfe gewinnen sofort. */
  assert.strictEqual(spiel.phase, 'ende');
  assert.strictEqual(spiel.ende.sieger, 'wolf');
});

/* ======================================================================
   Teil 1 — Siegbedingungen
   ====================================================================== */

console.log('Siegbedingungen');

test('Dorf gewinnt, wenn alle Wölfe tot sind', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'dorfbewohner', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('E') })); } });
  bisAbstimmung(spiel);
  abstimmen(spiel, { B: 'A', C: 'A', D: 'A' });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.ende.sieger, 'dorf');
  assert.deepStrictEqual(spiel.ende.gewinner.sort(), [uid('B'), uid('C'), uid('D'), uid('E')].sort(), 'auch der tote Dorfbewohner gewinnt');
});

test('Wölfe gewinnen, wenn sie so viele sind wie der Rest', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') })); ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') })); } });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.ende.sieger, 'wolf');
});

test('Alle Wölfe sterben gleichzeitig (Gift + Jäger) → Dorf', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'hexe', D: 'jaeger', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('D') })); ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('D') })); },
    hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('C'), { gift: uid('A') })); },
  });
  assert.ok(!lebt(spiel, 'A') && !lebt(spiel, 'D'));
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.tag.schritt, 'jaeger');
  ok(regeln.jaegerSchuss(spiel, uid('D'), uid('B')));
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.ende.sieger, 'dorf');
});

test('Verliebte aus zwei Lagern gewinnen nur zu zweit — und schlagen die Wölfe', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'amor', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  nacht(spiel, {
    amor: function (sp) { ok(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('A'), uid('C')] })); },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('D') })); },
  });
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: 'E', B: 'E', C: 'E' });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.phase, 'nacht', 'A, B, C leben: 1 Wolf gegen 2, weiter');
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('B') })); } });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.ende.sieger, 'verliebte');
  assert.deepStrictEqual(spiel.ende.gewinner.sort(), [uid('A'), uid('C')]);
});

test('Verliebte im selben Lager gewinnen mit ihrem Lager', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'amor', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  nacht(spiel, {
    amor: function (sp) { ok(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('C'), uid('D')] })); },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('E') })); },
  });
  bisAbstimmung(spiel);
  abstimmen(spiel, { B: 'A', C: 'A', D: 'A' });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.ende.sieger, 'dorf');
  assert.ok(spiel.ende.gewinner.indexOf(uid('C')) >= 0);
});

test('Weißer Werwolf gewinnt allein — und zählt sonst als Wolf', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'weisserWerwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner', F: 'dorfbewohner', G: 'dorfbewohner' });
  nacht(spiel, { werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('C') })); ok(regeln.nachtAktion(sp, uid('B'), { ziel: uid('C') })); } });
  bisAbstimmung(spiel);
  abstimmen(spiel, { A: 'D', B: 'D', D: 'A', E: 'A' });
  assert.strictEqual(spiel.tag.schritt, 'stichwahl');
  abstimmen(spiel, { A: 'D', B: 'D', D: 'A', E: 'A' });
  assert.strictEqual(spiel.tag.tote.length, 0);
  /* A, B, D, E, F, G: 2 Wölfe gegen 4 → weiter. Sterben D und E, sind es 2 gegen 2. */
  regeln.spielerVon(spiel, uid('D')).lebt = false;
  regeln.spielerVon(spiel, uid('E')).lebt = false;
  assert.strictEqual(regeln.pruefeSieg(spiel).sieger, 'wolf', 'Weißer zählt als Wolf');

  /* Direkter Fall: nur der Weiße lebt. */
  const s2 = spielMit({ A: 'werwolf', B: 'weisserWerwolf', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  for (const n of ['A', 'C', 'D', 'E']) regeln.spielerVon(s2, uid(n)).lebt = false;
  assert.strictEqual(regeln.pruefeSieg(s2).sieger, 'weiss');
});

test('Flötenspieler gewinnt, wenn alle anderen Lebenden verzaubert sind', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'floetenspieler', C: 'dorfbewohner', D: 'dorfbewohner', E: 'dorfbewohner' });
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('E') })); },
    floetenspieler: function (sp) { ok(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('C'), uid('D')] })); },
  });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.phase, 'tag', 'A noch nicht verzaubert');
  bisAbstimmung(spiel);
  abstimmen(spiel, {});
  bisAbstimmung(spiel);
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('A'), { ziel: uid('D') })); },
    floetenspieler: function (sp) {
      const sicht = regeln.sichtFuer(sp, uid('B'));
      assert.strictEqual(sicht.aufgabe.anzahl, 1, 'nur noch A ist unverzaubert');
      ok(regeln.nachtAktion(sp, uid('B'), { ziele: [uid('A')] }));
    },
  });
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.ende.sieger, 'floete');
});

/* ======================================================================
   Teil 1 — Sichten verraten nichts
   ====================================================================== */

console.log('Sichten');

test('Ein Dorfbewohner sieht keine fremde Rolle; Wölfe sehen sich; öffentliche Sicht ist verdeckt', function () {
  const spiel = spielMit({ A: 'werwolf', B: 'werwolf', C: 'seherin', D: 'dorfbewohner', E: 'dorfbewohner' });
  const d = regeln.sichtFuer(spiel, uid('D'));
  assert.strictEqual(d.rolle, 'dorfbewohner');
  assert.deepStrictEqual(d.mitwoelfe, []);
  const text = JSON.stringify(d);
  assert.ok(text.indexOf('werwolf') < 0 && text.indexOf('seherin') < 0, 'kein fremder Rollenname in der Sicht');
  const a = regeln.sichtFuer(spiel, uid('A'));
  assert.deepStrictEqual(a.mitwoelfe.map(function (w) { return w.name; }), ['B']);
  const oeff = JSON.stringify(regeln.oeffentlicheSicht(spiel).spieler);
  assert.ok(oeff.indexOf('werwolf') < 0 && oeff.indexOf('seherin') < 0, 'öffentlich alles verdeckt');
});

test('Die öffentliche Chronik verrät mitten im Spiel keine Nachtaktion und keine Rolle', function () {
  const rollenJeName = { Anna: 'werwolf', Ben: 'amor', Cleo: 'seherin', Dana: 'hexe', Emil: 'beschuetzer', Finn: 'dorfbewohner', Gerd: 'dorfbewohner', Hanna: 'dorfbewohner' };
  for (const aufdecken of [false, true]) {
    const spiel = spielMit(rollenJeName, { rollenAufdecken: aufdecken });
    nacht(spiel, {
      amor: function (sp) { ok(regeln.nachtAktion(sp, uid('Ben'), { ziele: [uid('Finn'), uid('Gerd')] })); },
      beschuetzer: function (sp) { ok(regeln.nachtAktion(sp, uid('Emil'), { ziel: uid('Cleo') })); },
      werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('Anna'), { ziel: uid('Hanna') })); },
      hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('Dana'), { gift: uid('Finn') })); },
      seherin: function (sp) { ok(regeln.nachtAktion(sp, uid('Cleo'), { ziel: uid('Anna') })); ok(regeln.nachtAktion(sp, uid('Cleo'), { bestaetigt: true })); },
    });
    assert.strictEqual(spiel.phase, 'tag');
    /* Hanna (Wölfe), Finn (Gift), Gerd (Liebe) sind tot — die geheime Chronik weiß alles. */
    assert.ok(spiel.chronik.some(function (c) { return /Amor verkuppelt/.test(c.text); }), 'intern steht Amor drin');
    const texte = regeln.oeffentlicheSicht(spiel).chronik.map(function (c) { return c.text; }).join('\n');
    /* Die Todesursache („vergiftet") ist öffentlich — der Erzähler sagt sie am Morgen laut. Wer die Hexe ist, bleibt geheim. */
    for (const wort of ['Amor', 'Seherin', 'Beschützer', 'Hexe', 'Dieb', 'Flötenspieler', 'Weiße']) {
      assert.ok(texte.indexOf(wort) < 0, 'öffentlich (aufdecken=' + aufdecken + ') nennt ' + wort + ':\n' + texte);
    }
    if (!aufdecken) {
      assert.ok(texte.indexOf('(') < 0, 'ohne Aufdecken keine Rolle in Klammern:\n' + texte);
      assert.ok(/Hanna von den Werwölfen gerissen/.test(texte), 'Tod ohne Rolle bleibt sichtbar:\n' + texte);
    } else {
      assert.ok(/Hanna \(Dorfbewohner\)/.test(texte), 'mit Aufdecken steht die Rolle da:\n' + texte);
    }
    /* Am Ende ist alles offen. */
    spiel.ende = { sieger: 'dorf', siegerName: 'Das Dorf', text: '', gewinner: [] };
    const ende = regeln.oeffentlicheSicht(spiel).chronik.map(function (c) { return c.text; }).join('\n');
    assert.ok(/Amor verkuppelt Finn und Gerd/.test(ende) && /Die Seherin sieht sich Anna an/.test(ende), 'am Ende steht alles da');
  }
});

test('Die 8-Spieler-Partie aus der Abnahme läuft von Setup bis Siegbildschirm', function () {
  const spiel = spielMit({ Anna: 'werwolf', Ben: 'werwolf', Cleo: 'seherin', Dana: 'hexe', Emil: 'jaeger', Finn: 'amor', Gerd: 'dorfbewohner', Hanna: 'dorfbewohner' });
  assert.ok(regeln.alleBereit(spiel));
  /* Nacht 1 */
  nacht(spiel, {
    amor: function (sp) { ok(regeln.nachtAktion(sp, uid('Finn'), { ziele: [uid('Gerd'), uid('Hanna')] })); },
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('Anna'), { ziel: uid('Cleo') })); ok(regeln.nachtAktion(sp, uid('Ben'), { ziel: uid('Cleo') })); },
    hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('Dana'), { heilen: true })); },
    seherin: function (sp) { ok(regeln.nachtAktion(sp, uid('Cleo'), { ziel: uid('Anna') })); ok(regeln.nachtAktion(sp, uid('Cleo'), { bestaetigt: true })); },
  });
  assert.strictEqual(spiel.tag.tote.length, 0, 'Hexe hat gerettet');
  bisAbstimmung(spiel);
  abstimmen(spiel, { Anna: 'Emil', Ben: 'Emil', Cleo: 'Anna', Dana: 'Anna', Emil: 'Anna', Finn: 'Anna', Gerd: 'Emil', Hanna: 'Emil' });
  /* 4:4 → Stichwahl */
  assert.strictEqual(spiel.tag.schritt, 'stichwahl');
  abstimmen(spiel, { Anna: 'Emil', Ben: 'Emil', Cleo: 'Anna', Dana: 'Anna', Emil: 'Anna', Finn: 'Anna', Gerd: 'Anna', Hanna: 'Emil' });
  assert.ok(!lebt(spiel, 'Anna'));
  bisAbstimmung(spiel);
  assert.strictEqual(spiel.phase, 'nacht');
  /* Nacht 2 */
  nacht(spiel, {
    werwolf: function (sp) { ok(regeln.nachtAktion(sp, uid('Ben'), { ziel: uid('Gerd') })); },
    hexe: function (sp) { ok(regeln.nachtAktion(sp, uid('Dana'), { gift: uid('Emil') })); },
    seherin: function (sp) { ok(regeln.nachtAktion(sp, uid('Cleo'), { ziel: uid('Ben') })); ok(regeln.nachtAktion(sp, uid('Cleo'), { bestaetigt: true })); },
  });
  /* Gerd (Wölfe) + Hanna (Liebe) + Emil (Gift) */
  assert.strictEqual(spiel.tag.tote.length, 3);
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.tag.schritt, 'jaeger');
  ok(regeln.jaegerSchuss(spiel, uid('Emil'), uid('Ben')));
  ok(regeln.tagWeiter(spiel));
  assert.strictEqual(spiel.phase, 'ende');
  assert.strictEqual(spiel.ende.sieger, 'dorf');
  const oeff = regeln.oeffentlicheSicht(spiel);
  assert.ok(oeff.spieler.every(function (s) { return s.rolle; }), 'am Ende alle Rollen offen');
  assert.ok(oeff.chronik.length > 10, 'Chronik gefüllt');
  assert.ok(oeff.chronik.some(function (c) { return /Amor verkuppelt/.test(c.text); }), 'am Ende steht die Nacht in der Chronik');
});

/* ======================================================================
   Teil 2 — Zufallspartien
   ====================================================================== */

function zufallsPartie(nr, zufall) {
  const anzahl = 5 + Math.floor(zufall() * 16);
  const liste = [];
  for (let i = 0; i < anzahl; i++) liste.push({ uid: 'p' + i, name: 'P' + i });
  const z = rollen.empfehlung(anzahl);
  /* Zufällig Sonderrollen dazu, dafür Dorfbewohner raus. */
  const extra = ['beschuetzer', 'dieb', 'maedchen', 'alte', 'suendenbock', 'weisserWerwolf', 'floetenspieler', 'amor', 'jaeger', 'hexe', 'seherin'];
  for (const id of extra) {
    if (z[id] || zufall() < 0.5) continue;
    if (id === 'dieb') { z.dieb = 1; z.dorfbewohner = (z.dorfbewohner || 0) + 1; continue; }
    if ((z.dorfbewohner | 0) <= 0) continue;
    z[id] = 1; z.dorfbewohner--;
  }
  if (!z.dorfbewohner) delete z.dorfbewohner;
  const p = rollen.pruefe(anzahl, z);
  if (!p.ok) return null;

  const spiel = regeln.neuesSpiel(liste, z, {
    diskussionSek: zufall() < 0.5 ? 0 : 60,
    gleichstand: zufall() < 0.5 ? 'stichwahl' : 'niemand',
    rollenAufdecken: zufall() < 0.5,
  }, zufall);
  for (const s of spiel.spieler) regeln.rolleGesehen(spiel, s.uid);

  function wahl(k) { return k.length ? k[Math.floor(zufall() * k.length)].uid : null; }

  let schritte = 0;
  while (spiel.phase !== 'ende') {
    if (++schritte > 2000) throw new Error('Partie ' + nr + ' endet nicht');
    pruefeInvarianten(spiel, nr);

    if (spiel.phase === 'rollen') { ok(regeln.starteNacht(spiel)); continue; }

    if (spiel.phase === 'nacht') {
      const s = regeln.aktuellerSchritt(spiel);
      if (!s) { ok(regeln.weiter(spiel)); continue; }
      if (s.aktiv) {
        for (const h of s.handelnde) {
          const sicht = regeln.sichtFuer(spiel, h);
          const auf = sicht.aufgabe;
          if (!auf || auf.fertig) continue;
          const k = auf.kandidaten;
          let r;
          switch (s.id) {
            case 'dieb': r = regeln.nachtAktion(spiel, h, { karte: auf.mussTauschen || zufall() < 0.5 ? Math.floor(zufall() * 2) : null }); break;
            case 'amor': r = regeln.nachtAktion(spiel, h, { ziele: [k[0].uid, k[1].uid] }); break;
            case 'beschuetzer': r = regeln.nachtAktion(spiel, h, { ziel: wahl(k) }); break;
            case 'werwolf': r = regeln.nachtAktion(spiel, h, { ziel: zufall() < 0.7 ? k[0].uid : wahl(k) }); break;
            case 'weisserWerwolf': r = regeln.nachtAktion(spiel, h, { ziel: zufall() < 0.5 ? wahl(k) : null }); break;
            case 'hexe': r = regeln.nachtAktion(spiel, h, { heilen: auf.heil && auf.opfer && zufall() < 0.5, gift: auf.gift && zufall() < 0.4 ? wahl(k) : null }); break;
            case 'seherin':
              r = regeln.nachtAktion(spiel, h, { ziel: wahl(k) });
              if (r.ok) r = regeln.nachtAktion(spiel, h, { bestaetigt: true });
              break;
            case 'floetenspieler': r = regeln.nachtAktion(spiel, h, { ziele: k.slice(0, auf.anzahl).map(function (x) { return x.uid; }) }); break;
            default: r = { ok: true };
          }
          if (!r.ok) throw new Error('Partie ' + nr + ', Schritt ' + s.id + ': ' + r.fehler);
        }
      }
      if (!regeln.schrittFertig(spiel)) throw new Error('Partie ' + nr + ': Schritt ' + s.id + ' nach Eingaben nicht fertig');
      ok(regeln.weiter(spiel));
      continue;
    }

    if (spiel.phase === 'tag') {
      const t = spiel.tag;
      if (t.schritt === 'jaeger') {
        const js = regeln.jaegerSicht(spiel, t.jaegerUid);
        if (js.kandidaten.length) ok(regeln.jaegerSchuss(spiel, t.jaegerUid, wahl(js.kandidaten)));
        else ok(regeln.jaegerUeberspringen(spiel));
        continue;
      }
      if (t.schritt === 'abstimmung' || t.schritt === 'stichwahl') {
        const l = regeln.lebende(spiel);
        const ziele = t.kandidaten ? t.kandidaten : l.map(function (s) { return s.uid; });
        for (const w of l) {
          const ziel = zufall() < 0.15 ? null : ziele[Math.floor(zufall() * ziele.length)];
          ok(regeln.stimme(spiel, w.uid, ziel));
        }
        ok(regeln.abstimmungSchliessen(spiel));
        continue;
      }
      /* Gelegentlich wirft der Erzähler jemanden raus. */
      if (zufall() < 0.02) {
        const l = regeln.lebende(spiel);
        if (l.length) ok(regeln.toeteManuell(spiel, wahl(l)));
        if (spiel.phase === 'ende') break;
      }
      ok(regeln.tagWeiter(spiel));
      continue;
    }
  }
  pruefeInvarianten(spiel, nr);
  assert.ok(spiel.ende && spiel.ende.sieger, 'Partie ' + nr + ' ohne Sieger');
  return spiel.ende.sieger;
}

function pruefeInvarianten(spiel, nr) {
  const tote = spiel.spieler.filter(function (s) { return !s.lebt; });
  for (const t of tote) assert.ok(t.todesursache, 'Partie ' + nr + ': Toter ohne Ursache');
  for (const j of spiel.jaegerAusstehend) {
    const s = regeln.spielerVon(spiel, j);
    assert.ok(s && !s.lebt && s.rolle === 'jaeger', 'Partie ' + nr + ': Jäger-Vormerkung falsch');
  }
  if (spiel.tag && spiel.tag.tote) {
    const gesehen = {};
    for (const t of spiel.tag.tote) {
      assert.ok(!gesehen[t.uid], 'Partie ' + nr + ': ' + t.name + ' zweimal verkündet');
      gesehen[t.uid] = true;
    }
  }
  /* Sichten dürfen nie werfen. */
  regeln.oeffentlicheSicht(spiel);
  for (const s of spiel.spieler) regeln.sichtFuer(spiel, s.uid);
}

const anzahlPartien = parseInt(process.argv[2], 10) || 1000;
console.log('Zufallspartien (' + anzahlPartien + ')');
test(anzahlPartien + ' Zufallspartien laufen ohne Fehler bis zum Ende', function () {
  const sieger = {};
  let gespielt = 0;
  for (let i = 0; i < anzahlPartien; i++) {
    const s = zufallsPartie(i, saat(1000 + i));
    if (s === null) continue;
    gespielt++;
    sieger[s] = (sieger[s] || 0) + 1;
  }
  console.log('       ' + gespielt + ' Partien, Sieger: ' + JSON.stringify(sieger));
  assert.ok(gespielt > anzahlPartien * 0.8, 'zu viele ungültige Zusammenstellungen');
});

console.log('\n' + geprueft + ' Prüfungen bestanden' + (process.exitCode ? ', FEHLER siehe oben' : '.'));
