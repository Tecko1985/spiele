/* ==========================================================================
   Letzte Karte — Prüfskript
   ==========================================================================

   Spielt tausende vollständige Partien durch, nur mit KI-Spielern, und
   prüft nach JEDEM Zug, dass der Spielzustand in sich stimmt.

   Aufruf (im Ordner letzte-karte):

     node pflege/pruefe-spiel.js
     node pflege/pruefe-spiel.js 2000          (Partien je Modus)
     node pflege/pruefe-spiel.js 500 gnadenlos (nur ein Modus)

   WARUM DAS NÖTIG IST.
   Drei Regelwerke teilen eine Engine. Ein Fehler im Zusammenspiel von
   Stapeln, Anfechten und Aussetzen tritt vielleicht in einer von tausend
   Partien auf — beim Durchklicken sieht man ihn nie, im Bus dafür sofort.
   Das Skript nutzt einen reproduzierbaren Zufallsgenerator: bricht ein Lauf,
   steht die Saat im Fehlerbericht und die Partie lässt sich exakt so wieder
   herstellen.

   ⚠️ Es prüft die REGELN, nicht die Oberfläche und nicht Firebase. Ein
   grüner Lauf sagt nichts darüber, ob die Karten auch auf dem Bildschirm
   ankommen.
   ========================================================================== */

'use strict';

const karten = require('../karten.js');
const regeln = require('../regeln.js');
const bots = require('../bots.js');

/* ------------------------------------------------------------------------
   Gegenproben
   ------------------------------------------------------------------------ */

/** Das erwartete Kartenspiel als Zählwerk: Karte -> wie oft sie vorkommt. */
function deckZaehlwerk(modusId) {
  const z = {};
  for (const k of karten.baueDeck(modusId)) z[k] = (z[k] || 0) + 1;
  return z;
}

/** Was gerade im Umlauf ist, in derselben Form. */
function umlaufZaehlwerk(spiel) {
  const z = {};
  function zaehle(k) { z[k] = (z[k] || 0) + 1; }
  for (const k of spiel.stapel) zaehle(k);
  for (const k of spiel.ablagestapel) zaehle(k);
  if (spiel.tisch.ablage) zaehle(spiel.tisch.ablage);
  for (const uid in spiel.haende) for (const k of spiel.haende[uid]) zaehle(k);
  return z;
}

function vergleicheZaehlwerke(soll, ist) {
  const fehlend = [];
  const zuviel = [];
  for (const k in soll) if ((ist[k] || 0) !== soll[k]) {
    if ((ist[k] || 0) < soll[k]) fehlend.push(k + ' (' + (ist[k] || 0) + ' statt ' + soll[k] + ')');
    else zuviel.push(k + ' (' + ist[k] + ' statt ' + soll[k] + ')');
  }
  for (const k in ist) if (soll[k] === undefined) zuviel.push(k + ' (gibt es im Deck gar nicht)');
  return { fehlend: fehlend, zuviel: zuviel };
}

/**
 * Alle Bedingungen, die zu JEDEM Zeitpunkt gelten müssen.
 * Wirft bei Verstoß — der Aufrufer fängt und berichtet mit Saat.
 */
function pruefeZustand(spiel, soll, modus, wo) {
  const t = spiel.tisch;

  const verglichen = vergleicheZaehlwerke(soll, umlaufZaehlwerk(spiel));
  if (verglichen.fehlend.length || verglichen.zuviel.length) {
    throw new Error(wo + ': Kartenbestand stimmt nicht.' +
      (verglichen.fehlend.length ? ' Fehlt: ' + verglichen.fehlend.slice(0, 4).join(', ') : '') +
      (verglichen.zuviel.length ? ' Zu viel: ' + verglichen.zuviel.slice(0, 4).join(', ') : ''));
  }

  for (const uid in spiel.haende) {
    if (t.handAnzahl[uid] !== spiel.haende[uid].length) {
      throw new Error(wo + ': angezeigte Handzahl (' + t.handAnzahl[uid] +
        ') weicht von der echten ab (' + spiel.haende[uid].length + ') bei ' + uid);
    }
  }

  if (t.stapelRest !== spiel.stapel.length) {
    throw new Error(wo + ': angezeigter Stapelrest weicht ab.');
  }

  if (modus.mercy) {
    for (const uid in spiel.haende) {
      if (!t.raus[uid] && spiel.haende[uid].length >= modus.mercy) {
        throw new Error(wo + ': ' + uid + ' hat ' + spiel.haende[uid].length +
          ' Karten, ist aber nicht ausgeschieden (Grenze ' + modus.mercy + ').');
      }
    }
  }

  const t2 = karten.teile(t.ablage, t.dunkel);
  if (t2.farbe !== 'w' && t.farbe !== t2.farbe && !karten.brauchtFarbe(t2.art)) {
    throw new Error(wo + ': geltende Farbe (' + t.farbe + ') passt nicht zur offenen Karte (' + t.ablage + ').');
  }

  const erlaubteFarben = karten.farbenFuer(t.modus, t.dunkel);
  if (erlaubteFarben.indexOf(t.farbe) < 0) {
    throw new Error(wo + ': geltende Farbe "' + t.farbe + '" gibt es auf dieser Seite nicht.');
  }

  if (t.strafe < 0) throw new Error(wo + ': negative Strafe.');
}

/* ------------------------------------------------------------------------
   Eine Partie
   ------------------------------------------------------------------------ */

function spielePartie(modusId, spielerZahl, saat) {
  const zufall = karten.generator(saat);
  const modus = karten.modus(modusId);
  const soll = deckZaehlwerk(modusId);

  const uids = [];
  const charaktere = {};
  const namen = {};
  for (let i = 0; i < spielerZahl; i++) {
    const c = bots.charakter(i);
    uids.push(bots.uidFuer(i));
    charaktere[bots.uidFuer(i)] = c;
    namen[bots.uidFuer(i)] = c.name;
  }
  regeln.setzeNamen(namen);

  const spiel = regeln.neueRunde(modusId, uids, zufall, {});
  pruefeZustand(spiel, soll, modus, 'nach dem Austeilen');

  let zuege = 0;
  const MAX_ZUEGE = 4000;

  while (spiel.tisch.phase === 'laeuft') {
    zuege++;
    if (zuege > MAX_ZUEGE) {
      throw new Error('Partie endet nicht — nach ' + MAX_ZUEGE + ' Zügen läuft sie immer noch.');
    }

    const uid = regeln.dran(spiel);
    if (!uid) throw new Error('Niemand ist dran, die Runde läuft aber noch.');
    const c = charaktere[uid];

    /* Melden und Anfechten laufen unabhängig vom eigenen Zug — genau wie
       am echten Tisch, wo auch jemand dazwischenrufen darf. */
    if (spiel.tisch.erwischbar) {
      for (const anderer of uids) {
        if (bots.willMelden(spiel.tisch, charaktere[anderer], anderer, zufall)) {
          regeln.melde(spiel, anderer, spiel.tisch.erwischbar, zufall);
          pruefeZustand(spiel, soll, modus, 'nach einer Meldung');
          break;
        }
      }
    }

    if (spiel.tisch.phase !== 'laeuft') break;

    if (spiel.tisch.anfechtbar && spiel.tisch.anfechtbar.uid !== uid &&
        bots.willAnfechten(spiel.tisch, c, zufall)) {
      const a = regeln.fechteAn(spiel, uid, zufall);
      pruefeZustand(spiel, soll, modus, 'nach einer Anfechtung');
      if (a.ok && !a.schuldig) continue;   // Ankläger ist durch, der Nächste ist dran
    }

    if (spiel.tisch.phase !== 'laeuft') break;

    const hand = spiel.haende[uid];
    const zug = bots.waehleZug(spiel.tisch, hand, c, zufall);

    let ergebnis;
    if (zug.art === 'legen') {
      ergebnis = regeln.lege(spiel, uid, zug.idx, zug.farbe, zug.sagtUno, zufall);
    } else if (zug.art === 'ziehen') {
      ergebnis = regeln.ziehe(spiel, uid, zufall);
    } else {
      ergebnis = regeln.passe(spiel, uid, zufall);
    }

    if (!ergebnis.ok) {
      throw new Error('Ein Bot hat einen unerlaubten Zug versucht (' + zug.art + '): ' + ergebnis.grund);
    }

    pruefeZustand(spiel, soll, modus, 'nach Zug ' + zuege + ' (' + zug.art + ')');
  }

  /* --- Nach der Runde ------------------------------------------------- */

  if (spiel.tisch.fertig.length === 0 && regeln.aktive(spiel).length > 1) {
    throw new Error('Runde beendet, aber niemand ist fertig und es sind noch mehrere im Spiel.');
  }

  const rp = spiel.tisch.rundenPunkte;
  if (!rp) throw new Error('Runde beendet, aber keine Abrechnung entstanden.');
  if (rp.summe < 0) throw new Error('Negative Rundenpunkte.');

  if (rp.sieger) {
    /* Nur wer LEER geworden ist, muss auch leer sein. Wer als Letzter
       übrig blieb, weil alle anderen an der 25er-Grenze gescheitert sind,
       hält selbstverständlich noch Karten. */
    if (rp.endart === 'leer' && spiel.haende[rp.sieger].length !== 0) {
      throw new Error('Der Sieger hat noch ' + spiel.haende[rp.sieger].length + ' Karten auf der Hand.');
    }
    if (rp.endart === 'letzterUebrig' && regeln.aktive(spiel).length > 1) {
      throw new Error('Als "letzter Übriger" abgerechnet, es sind aber noch mehrere im Spiel.');
    }
    let nachgerechnet = 0;
    for (const uid of uids) {
      if (uid === rp.sieger) continue;
      for (const k of spiel.haende[uid]) nachgerechnet += karten.punkte(k, modusId, spiel.tisch.dunkel);
    }
    if (nachgerechnet !== rp.summe) {
      throw new Error('Punkte stimmen nicht: abgerechnet ' + rp.summe + ', nachgerechnet ' + nachgerechnet + '.');
    }
  }

  return { zuege: zuege, sieger: rp.sieger, dunkel: spiel.tisch.dunkel, raus: Object.keys(spiel.tisch.raus).length };
}

/* ------------------------------------------------------------------------
   Lauf
   ------------------------------------------------------------------------ */

function laufe(modusId, partien) {
  const anfang = Date.now();
  let zuegeGesamt = 0;
  let dunkelEnden = 0;
  let rausGesamt = 0;
  const fehler = [];

  for (let i = 0; i < partien; i++) {
    /* Zwei bis zehn Spieler, damit auch die Sonderfälle drankommen: zu
       zweit wirkt der Richtungswechsel wie Aussetzen, zu zehnt geht dem
       Nachziehstapel viel schneller die Luft aus. */
    const spielerZahl = 2 + (i % 9);
    const saat = 1000000 + i * 7919;
    try {
      const e = spielePartie(modusId, spielerZahl, saat);
      zuegeGesamt += e.zuege;
      if (e.dunkel) dunkelEnden++;
      rausGesamt += e.raus;
    } catch (f) {
      fehler.push({ saat: saat, spieler: spielerZahl, text: f.message });
      if (fehler.length >= 5) break;
    }
  }

  const dauer = Date.now() - anfang;
  const gelaufen = partien - fehler.length;
  console.log('');
  console.log('  ' + modusId.toUpperCase());
  console.log('  ' + '-'.repeat(60));
  if (fehler.length === 0) {
    console.log('  ' + partien + ' Partien fehlerfrei, ' + zuegeGesamt + ' Züge, ' + dauer + ' ms');
    console.log('  Schnitt: ' + Math.round(zuegeGesamt / Math.max(1, gelaufen)) + ' Züge je Partie');
    if (modusId === 'wende') console.log('  Auf der dunklen Seite geendet: ' + dunkelEnden + ' von ' + partien);
    if (modusId === 'gnadenlos') console.log('  Ausgeschiedene Spieler insgesamt: ' + rausGesamt);
  } else {
    console.log('  FEHLER in ' + fehler.length + ' von ' + partien + ' Partien:');
    for (const f of fehler) {
      console.log('    Saat ' + f.saat + ', ' + f.spieler + ' Spieler: ' + f.text);
    }
  }
  return fehler.length;
}

const partien = Number(process.argv[2]) || 500;
const nurModus = process.argv[3];

console.log('');
console.log('  Letzte Karte — Regelprüfung');
console.log('  ' + partien + ' Partien je Modus, 2 bis 10 Spieler im Wechsel');

let fehlerGesamt = 0;
for (const m of karten.MODI) {
  if (nurModus && m.id !== nurModus) continue;
  fehlerGesamt += laufe(m.id, partien);
}

console.log('');
if (fehlerGesamt === 0) {
  console.log('  Alles sauber.');
  console.log('');
  process.exit(0);
} else {
  console.log('  ' + fehlerGesamt + ' Partien mit Regelverstoß.');
  console.log('');
  process.exit(1);
}
