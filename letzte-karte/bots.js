/* ==========================================================================
   Letzte Karte — KI-Mitspieler
   ==========================================================================

   DIE BOTS LAUFEN AUF DEM GERÄT DES GASTGEBERS.

   Sie sind keine eigenen Anmeldungen: ihre Kennungen beginnen mit `bot-` und
   existieren nur im Spielzustand. Das heißt auch, dass der Gastgeber ihre
   Karten kennt — derselbe bewusst hingenommene Wissensvorsprung wie beim
   Maulwurf. Ein Bot nutzt ihn nicht: `waehleZug` bekommt AUSSCHLIESSLICH die
   eigene Hand und den öffentlichen Tisch zu sehen, nie `spiel.haende`.
   Wer diese Grenze aufweicht, baut einen Schummler, den niemand schlagen kann.

   FÜNF ERKENNBARE STILE.
   Ein Bot, der immer optimal spielt, ist als Mitspieler langweilig und
   nimmt einer Runde im Bus jede Überraschung. Die Charaktere unterscheiden
   sich darin, wie gern sie angreifen, wie lange sie Farbwahlkarten
   zurückhalten und wie schnell sie jemanden melden.
   ========================================================================== */

const bots = (function () {
  'use strict';

  const K = (typeof karten !== 'undefined') ? karten : require('./karten.js');
  const R = (typeof regeln !== 'undefined') ? regeln : require('./regeln.js');

  /* `angriff`   wie gern Ziehkarten und Aussetzer gespielt werden
     `horten`    wie lange Farbwahlkarten aufgehoben werden
     `wachsam`   wie zuverlässig ein vergessenes "Letzte Karte" gemeldet wird
     `denkzeit`  Millisekunden, bevor der Zug kommt — ohne das wirkt eine
                 Bot-Runde wie ein Standbild, das plötzlich weiterspringt */
  const CHARAKTERE = [
    { id: 'ruhig',    name: 'Bernd',  zeichen: '🧢', angriff: 0.3, horten: 0.8, wachsam: 0.4, denkzeit: 1100 },
    { id: 'frech',    name: 'Jule',   zeichen: '⚡', angriff: 0.9, horten: 0.2, wachsam: 0.9, denkzeit: 700 },
    { id: 'zaeh',     name: 'Otto',   zeichen: '🛡️', angriff: 0.5, horten: 0.9, wachsam: 0.6, denkzeit: 1400 },
    { id: 'flott',    name: 'Mira',   zeichen: '🚀', angriff: 0.7, horten: 0.4, wachsam: 0.8, denkzeit: 550 },
    { id: 'schlau',   name: 'Kalle',  zeichen: '🦊', angriff: 0.6, horten: 0.6, wachsam: 1.0, denkzeit: 950 },
  ];

  function charakter(i) { return CHARAKTERE[i % CHARAKTERE.length]; }

  /** Die Kennung eines Bots. Muss mit `bot-` beginnen — daran erkennt der
      ganze Rest der App, dass niemand darauf wartet, dass er etwas tippt. */
  function uidFuer(i) { return 'bot-' + charakter(i).id; }

  function istBot(uid) { return String(uid || '').indexOf('bot-') === 0; }

  function feld(anzahl) {
    const raus = [];
    for (let i = 0; i < anzahl; i++) {
      const c = charakter(i);
      raus.push({ uid: uidFuer(i), name: c.name, zeichen: c.zeichen, charakter: c });
    }
    return raus;
  }

  /* ----------------------------------------------------------------------
     Bewertung einer Karte
     ---------------------------------------------------------------------- */

  /**
   * Wie gern spielt dieser Charakter diese Karte gerade?
   * Höher ist besser. Die Zahlen sind Erfahrungswerte, keine Wissenschaft —
   * sie sollen nur dafür sorgen, dass ein Bot nicht seine Farbwahlkarte
   * verheizt, während er noch drei passende Zahlen auf der Hand hat.
   */
  function bewerte(karte, tisch, hand, c, zufall) {
    const t = K.teile(karte, tisch.dunkel);
    const zieh = K.zieht(t.art);
    let wert = 0;

    if (K.istZahl(t.art)) {
      /* Hohe Zahlen zuerst abwerfen: sie kosten am Ende die meisten Punkte. */
      wert = 10 + Number(t.art);
    } else if (zieh > 0) {
      wert = 30 + zieh * 3 * c.angriff;
    } else if (t.art === 's' || t.art === 'e') {
      wert = 26 + 8 * c.angriff;
    } else if (t.art === 'u') {
      wert = 24;
    } else if (t.art === 'a') {
      /* Alles ablegen ist stark, wenn viel von der Farbe auf der Hand liegt. */
      let gleich = 0;
      for (const k of hand) if (K.teile(k, tisch.dunkel).farbe === t.farbe) gleich++;
      wert = 25 + gleich * 6;
    } else if (t.art === 'f') {
      wert = 22;
    }

    if (t.farbe === 'w') {
      /* Farbwahlkarten passen immer — sie sind die Rettung, wenn nichts mehr
         geht. Deshalb je nach Charakter zurückhalten, solange es Alternativen
         gibt. Bei nur noch zwei Karten zählt das nicht mehr. */
      wert = 20 + zieh * 4 * c.angriff;
      if (hand.length > 2) wert -= 18 * c.horten;
    }

    /* Farbe halten: eine Karte in der Farbe, von der man ohnehin viel hat,
       ist weniger wertvoll als eine, die eine Rest-Farbe leerräumt. */
    if (t.farbe !== 'w') {
      let gleich = 0;
      for (const k of hand) if (K.teile(k, tisch.dunkel).farbe === t.farbe) gleich++;
      wert += (gleich - 1) * 1.5;
    }

    /* Eine Prise Zufall, damit zwei Bots mit demselben Blatt nicht
       identisch spielen. */
    wert += (zufall ? zufall() : Math.random()) * 3;
    return wert;
  }

  /** Die Farbe, von der der Bot am meisten hat. Bei Gleichstand die erste. */
  function besteFarbe(hand, tisch, zufall) {
    const erlaubt = K.farbenFuer(tisch.modus, tisch.dunkel);
    const zaehler = {};
    for (const f of erlaubt) zaehler[f] = 0;
    for (const k of hand) {
      const t = K.teile(k, tisch.dunkel);
      if (zaehler[t.farbe] !== undefined) zaehler[t.farbe]++;
    }
    let beste = erlaubt[0];
    let max = -1;
    for (const f of erlaubt) {
      /* Kleiner Zufallszuschlag, sonst wählt jeder Bot bei leerer Hand
         immer dieselbe Farbe. */
      const wert = zaehler[f] + (zufall ? zufall() : Math.random()) * 0.4;
      if (wert > max) { max = wert; beste = f; }
    }
    return beste;
  }

  /* ----------------------------------------------------------------------
     Der Zug
     ---------------------------------------------------------------------- */

  /**
   * Entscheidet, was der Bot tut.
   * @param {object} tisch  der öffentliche Spielzustand
   * @param {array}  hand   NUR die eigene Hand
   * @param {object} c      Charakter
   * @returns {{art:'legen'|'ziehen'|'passen', idx, farbe, sagtUno}}
   */
  function waehleZug(tisch, hand, c, zufall) {
    const moeglich = R.legbare(tisch, hand);

    if (moeglich.length === 0) {
      return tisch.gezogen ? { art: 'passen' } : { art: 'ziehen' };
    }

    /* Liegt eine Strafe an, ist Kontern fast immer richtig — wer schluckt,
       hat die Karten für den Rest der Runde am Bein. Nur ein sehr ruhiger
       Charakter nimmt eine hohe Strafe lieber an, als seine letzte
       Ziehkarte dafür zu verbrennen. */
    if (tisch.strafe > 0) {
      const nehmenLieber = tisch.strafe <= 2 && hand.length <= 3 && c.angriff < 0.4;
      if (nehmenLieber && !tisch.gezogen) return { art: 'ziehen' };
    }

    let besterIdx = moeglich[0];
    let bester = -Infinity;
    for (const i of moeglich) {
      const w = bewerte(hand[i], tisch, hand, c, zufall);
      if (w > bester) { bester = w; besterIdx = i; }
    }

    const teil = K.teile(hand[besterIdx], tisch.dunkel);
    const zug = { art: 'legen', idx: besterIdx, sagtUno: hand.length === 2 };
    if (K.brauchtFarbe(teil.art)) {
      /* Die eigene Karte zählt bei der Farbwahl nicht mehr mit — sie ist ja
         gerade weg. */
      const rest = hand.slice(0, besterIdx).concat(hand.slice(besterIdx + 1));
      zug.farbe = besteFarbe(rest, tisch, zufall);
    }
    return zug;
  }

  /**
   * Soll dieser Bot jemanden melden, der "Letzte Karte" vergessen hat?
   * Läuft unabhängig vom eigenen Zug — sonst könnte man sich vor der Strafe
   * retten, indem man einfach den Bot davor legen lässt.
   */
  function willMelden(tisch, c, eigeneUid, zufall) {
    if (!tisch.erwischbar) return false;
    if (tisch.erwischbar === eigeneUid) return false;
    return (zufall ? zufall() : Math.random()) < c.wachsam;
  }

  /**
   * Soll der Bot eine Farbwahl-Ziehkarte anfechten?
   * Nur wenn es sich lohnt: bei kleiner eigener Hand ist der Zuschlag für
   * eine Fehlanklage teuer. Angriffslustige Charaktere riskieren mehr.
   */
  function willAnfechten(tisch, c, zufall) {
    if (!tisch.anfechtbar) return false;
    return (zufall ? zufall() : Math.random()) < c.angriff * 0.35;
  }

  return {
    CHARAKTERE: CHARAKTERE,
    charakter: charakter,
    uidFuer: uidFuer,
    istBot: istBot,
    feld: feld,
    waehleZug: waehleZug,
    willMelden: willMelden,
    willAnfechten: willAnfechten,
    besteFarbe: besteFarbe,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = bots;
