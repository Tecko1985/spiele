/* ==========================================================================
   Viertelmeile — Turnierformen
   ==========================================================================
   Reine Rechnerei: wer fährt in welcher Runde gegen wen, und wie sieht die
   Tabelle danach aus. Kein Firebase, kein DOM — prüfbar in Node
   (pflege/pruefe-turnier.js).

   ZWEI FORMEN, die der Gastgeber in der Lobby wählt:

   LIGA
     Bis 10 Fahrer: jeder gegen jeden, einmal (Kreis-Verfahren).
     Ab 11 Fahrer: feste 7 Runden, gepaart nach Tabellenstand — Erster gegen
     Zweiten, Dritter gegen Vierten und so weiter. Bei 20 Leuten wären
     „jeder gegen jeden" 19 Runden; das dauert im Bus zu lang.
     Bei ungerader Zahl bekommt in jeder Runde genau einer den Bot.

   K.-O.
     Wer verliert, ist raus. Passt die Zahl nicht in eine Zweierpotenz, gibt
     es eine VORRUNDE: genau so viele Fahrer, dass danach 2, 4, 8 oder 16
     übrig sind. Ab dem Halbfinale werden drei Läufe gefahren, wer zwei
     gewinnt, kommt weiter. Ein Bot wird hier NICHT gebraucht — die Vorrunde
     hat immer eine gerade Teilnehmerzahl.
   ========================================================================== */

const turnier = (function () {
  'use strict';

  const p = typeof physik !== 'undefined' ? physik : require('./physik.js');

  const JEDER_GEGEN_JEDEN_BIS = 10;
  const SCHWEIZER_RUNDEN = 7;

  /* ----------------------------------------------------------------------
     Hilfen
     ---------------------------------------------------------------------- */

  function istBot(id) { return typeof id === 'string' && id.indexOf('bot-') === 0; }

  /** Mischt eine Liste reproduzierbar — gleiche Saat, gleiche Reihenfolge. */
  function mische(liste, saat) {
    const w = p.saatZufall(saat);
    const a = liste.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(w() * (i + 1));
      const h = a[i]; a[i] = a[j]; a[j] = h;
    }
    return a;
  }

  function paarSchluessel(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  /* ----------------------------------------------------------------------
     Liga
     ---------------------------------------------------------------------- */

  function ligaRunden(anzahl) {
    if (anzahl < 2) return 0;
    if (anzahl <= JEDER_GEGEN_JEDEN_BIS) return anzahl % 2 === 0 ? anzahl - 1 : anzahl;
    return SCHWEIZER_RUNDEN;
  }

  function jederGegenJeden(anzahl) { return anzahl <= JEDER_GEGEN_JEDEN_BIS; }

  /**
   * Kreis-Verfahren: der Erste bleibt stehen, alle anderen rücken auf.
   * Bei ungerader Zahl steht ein Platzhalter im Kreis — wer auf ihn trifft,
   * fährt gegen den Bot.
   */
  function ligaPlan(ids, saat) {
    const feld = mische(ids, saat);
    const ungerade = feld.length % 2 === 1;
    if (ungerade) feld.push(null);                 // Platzhalter = Bot
    const n = feld.length;
    const runden = [];
    for (let r = 0; r < n - 1; r++) {
      const paare = [];
      for (let i = 0; i < n / 2; i++) {
        const a = feld[i];
        const b = feld[n - 1 - i];
        /* Damit nicht immer derselbe links steht: jede zweite Runde drehen. */
        paare.push(r % 2 === 0 ? { a: a, b: b } : { a: b, b: a });
      }
      runden.push(paare);
      /* Rotieren: der Erste bleibt, der Rest wandert im Kreis. */
      const rest = feld.slice(1);
      rest.unshift(rest.pop());
      for (let i = 1; i < n; i++) feld[i] = rest[i - 1];
    }
    return runden;
  }

  const BOT_MARKE = 'BOT';

  /**
   * Ab 11 Fahrern: nach Tabellenstand paaren, schon gefahrene Paarungen
   * meiden.
   *
   * ⚠️ MIT RÜCKZUG, NICHT GIERIG. Der erste Entwurf nahm einfach immer den
   * nächstbesten freien Gegner. Das läuft sich fest: die letzten zwei
   * Übriggebliebenen sind dann manchmal genau die, die schon gegeneinander
   * gefahren sind — und die Paarung wiederholte sich. Hier wird bei einer
   * Sackgasse zurückgegangen und die vorige Wahl geändert. Erst wenn es gar
   * keine wiederholungsfreie Aufteilung mehr gibt, wird eine Wiederholung
   * zugelassen (sonst käme gar keine Runde zustande).
   */
  function paareOhneWiederholung(offen, gefahren) {
    if (offen.length === 0) return [];
    const a = offen[0];
    for (let i = 1; i < offen.length; i++) {
      if (gefahren[paarSchluessel(a, offen[i])]) continue;
      const rest = offen.slice(1);
      rest.splice(i - 1, 1);
      const weiter = paareOhneWiederholung(rest, gefahren);
      if (weiter) return [{ a: a, b: offen[i] }].concat(weiter);
    }
    return null;
  }

  function schweizerPaarung(reihenfolge, gefahren) {
    let offen = reihenfolge.slice();
    const paare = [];

    /* Ungerade: den Bot bekommt der Letzte der Tabelle, der ihn noch nicht
       hatte — sonst träfe es immer denselben. */
    if (offen.length % 2 === 1) {
      let idx = -1;
      for (let i = offen.length - 1; i >= 0; i--) {
        if (!gefahren[paarSchluessel(offen[i], BOT_MARKE)]) { idx = i; break; }
      }
      if (idx < 0) idx = offen.length - 1;
      paare.push({ a: offen[idx], b: null });
      offen = offen.slice(0, idx).concat(offen.slice(idx + 1));
    }

    const sauber = paareOhneWiederholung(offen, gefahren);
    if (sauber) return paare.concat(sauber);

    /* Notnagel: es geht nicht ohne Wiederholung. Dann eben der Reihe nach. */
    for (let i = 0; i + 1 < offen.length; i += 2) paare.push({ a: offen[i], b: offen[i + 1] });
    return paare;
  }

  /**
   * Die Paarungen einer Liga-Runde. `runde` zählt ab 1.
   * `stand` ist die Tabelle nach der Vorrunde (nur ab 11 Fahrern gebraucht),
   * `gefahren` ein Verzeichnis schon gespielter Paarungen.
   */
  function ligaPaarungen(ids, runde, saat, stand, gefahren) {
    if (ids.length < 2) return [];
    if (jederGegenJeden(ids.length)) {
      const plan = ligaPlan(ids, saat);
      return plan[(runde - 1) % plan.length] || [];
    }
    if (runde === 1) {
      const feld = mische(ids, saat);
      const paare = [];
      for (let i = 0; i + 1 < feld.length; i += 2) paare.push({ a: feld[i], b: feld[i + 1] });
      if (feld.length % 2 === 1) paare.push({ a: feld[feld.length - 1], b: null });
      return paare;
    }
    const reihenfolge = tabelle(ids, stand || {}).map(function (z) { return z.id; });
    return schweizerPaarung(reihenfolge, gefahren || {});
  }

  /* ----------------------------------------------------------------------
     Tabelle
     ---------------------------------------------------------------------- */

  /**
   * `stand` ist { uid: { siege, niederlagen, unentschieden, rennen,
   *                      besteZeit, summeZeit, gewertete } }.
   * Sortiert nach Siegen, dann bester Zeit. Wer noch keine Zeit hat, steht
   * hinten — aber nicht vor jemandem mit mehr Siegen.
   */
  function tabelle(ids, stand) {
    const zeilen = ids.map(function (id) {
      const s = stand[id] || {};
      return {
        id: id,
        siege: s.siege | 0,
        niederlagen: s.niederlagen | 0,
        unentschieden: s.unentschieden | 0,
        rennen: s.rennen | 0,
        besteZeit: typeof s.besteZeit === 'number' ? s.besteZeit : null,
        punkte: (s.siege | 0) * 3 + (s.unentschieden | 0),
      };
    });
    zeilen.sort(function (x, y) {
      if (y.punkte !== x.punkte) return y.punkte - x.punkte;
      if (x.besteZeit === null && y.besteZeit === null) return x.id < y.id ? -1 : 1;
      if (x.besteZeit === null) return 1;
      if (y.besteZeit === null) return -1;
      if (x.besteZeit !== y.besteZeit) return x.besteZeit - y.besteZeit;
      return x.id < y.id ? -1 : 1;
    });
    zeilen.forEach(function (z, i) { z.platz = i + 1; });
    return zeilen;
  }

  /* ----------------------------------------------------------------------
     K.-o.
     ---------------------------------------------------------------------- */

  function zweierpotenzDarunter(n) {
    let k = 1;
    while (k * 2 <= n) k *= 2;
    return k;
  }

  /** Wie viele Siege eine Paarung braucht: ab dem Halbfinale zwei. */
  function siegeNoetig(paareInRunde) { return paareInRunde <= 2 ? 2 : 1; }

  function rundenName(paareInRunde, istVorrunde) {
    if (istVorrunde) return 'Vorrunde';
    if (paareInRunde === 1) return 'Finale';
    if (paareInRunde === 2) return 'Halbfinale';
    if (paareInRunde === 4) return 'Viertelfinale';
    if (paareInRunde === 8) return 'Achtelfinale';
    return 'Runde der letzten ' + paareInRunde * 2;
  }

  function neuePaare(ids, istVorrunde) {
    const paare = [];
    for (let i = 0; i + 1 < ids.length; i += 2) {
      paare.push({ a: ids[i], b: ids[i + 1], siegeA: 0, siegeB: 0, sieger: null, remis: 0 });
    }
    const noetig = siegeNoetig(paare.length);
    for (const pa of paare) pa.noetig = istVorrunde ? 1 : noetig;
    return paare;
  }

  /**
   * Legt den Baum an. Ist die Teilnehmerzahl keine Zweierpotenz, spielt eine
   * VORRUNDE die Überzähligen aus; wer dort gewinnt, trifft im Hauptfeld auf
   * die, die direkt durch sind.
   */
  function koBaum(ids, saat) {
    const feld = mische(ids, saat);
    const baum = { feld: feld, runden: [], sieger: null, zweiter: null };
    if (feld.length < 2) return baum;

    const haupt = zweierpotenzDarunter(feld.length);
    const ueberzaehlig = feld.length - haupt;

    if (ueberzaehlig > 0) {
      /* Die HINTEREN 2 x überzählig fahren die Vorrunde — die vorderen sind
         gesetzt. Die Zahl ist immer gerade, ein Bot wird nie gebraucht. */
      const direkt = feld.slice(0, feld.length - ueberzaehlig * 2);
      const vor = feld.slice(feld.length - ueberzaehlig * 2);
      baum.direkt = direkt;
      baum.runden.push({ name: 'Vorrunde', vorrunde: true, paare: neuePaare(vor, true) });
    } else {
      baum.direkt = [];
      baum.runden.push({ name: rundenName(feld.length / 2, false), paare: neuePaare(feld, false) });
    }
    return baum;
  }

  function offeneRunde(baum) {
    for (const r of baum.runden) {
      for (const pa of r.paare) if (!pa.sieger) return r;
    }
    return null;
  }

  const REMIS_BIS = 3;

  /** Trägt einen Lauf ein. `sieger` ist die Kennung des Gewinners. */
  function koEintragen(baum, paar, sieger) {
    if (!paar || paar.sieger) return;
    if (sieger === paar.a) paar.siegeA++;
    else if (sieger === paar.b) paar.siegeB++;
    else return;
    if (paar.siegeA >= paar.noetig) paar.sieger = paar.a;
    else if (paar.siegeB >= paar.noetig) paar.sieger = paar.b;
  }

  /**
   * Ein Unentschieden im K.-o. Der Lauf wird wiederholt — aber nicht ewig.
   *
   * ⚠️ EIN K.-O. DARF SICH NICHT AUFHÄNGEN. Der erste Entwurf trug bei
   * einem Unentschieden schlicht nichts ein und ließ neu fahren. Kommt aber
   * dreimal dasselbe heraus (zwei Ausgeschiedene, zwei Frühstarts, zwei
   * identische Zeiten), wiederholt sich die Runde für immer und das Turnier
   * steht. Nach `REMIS_BIS` Läufen wird deshalb entschieden — nach dem, was
   * an den beiden Fahrten sonst noch unterscheidbar ist.
   *
   * Gibt die Kennung des Siegers zurück oder `null`, wenn noch einmal
   * gefahren wird.
   */
  function koRemis(paar, ergA, ergB) {
    if (!paar || paar.sieger) return null;
    paar.remis = (paar.remis | 0) + 1;
    if (paar.remis < REMIS_BIS) return null;
    return notEntscheidung(paar.a, paar.b, ergA, ergB);
  }

  /** Reihenfolge: wer überhaupt durchkam, dann die bessere Reaktion, dann die Kennung. */
  function notEntscheidung(a, b, ergA, ergB) {
    const heil = function (e) { return !!e && !e.fehlstart && !e.aus && !e.fehlt; };
    if (heil(ergA) && !heil(ergB)) return a;
    if (heil(ergB) && !heil(ergA)) return b;
    const ra = ergA && typeof ergA.reaktion === 'number' ? ergA.reaktion : 99;
    const rb = ergB && typeof ergB.reaktion === 'number' ? ergB.reaktion : 99;
    /* Ein Frühstart ist negativ — der zählt hier als schlechter, nicht als besser. */
    const wert = function (r) { return r < 0 ? 99 + r : r; };
    if (wert(ra) !== wert(rb)) return wert(ra) < wert(rb) ? a : b;
    return a < b ? a : b;
  }

  /**
   * Ist die laufende Runde durch, wird die nächste angelegt.
   * Gibt `true` zurück, wenn danach noch etwas zu fahren ist.
   */
  function koWeiter(baum) {
    const laufend = baum.runden[baum.runden.length - 1];
    if (!laufend) return false;
    for (const pa of laufend.paare) if (!pa.sieger) return true;

    const sieger = laufend.paare.map(function (pa) { return pa.sieger; });

    if (laufend.vorrunde) {
      const feld = (baum.direkt || []).concat(sieger);
      baum.runden.push({ name: rundenName(feld.length / 2, false), paare: neuePaare(feld, false) });
      return true;
    }
    if (sieger.length === 1) {
      baum.sieger = sieger[0];
      const finale = laufend.paare[0];
      baum.zweiter = finale.sieger === finale.a ? finale.b : finale.a;
      return false;
    }
    baum.runden.push({ name: rundenName(sieger.length / 2, false), paare: neuePaare(sieger, false) });
    return true;
  }

  const api = {
    JEDER_GEGEN_JEDEN_BIS: JEDER_GEGEN_JEDEN_BIS,
    BOT_MARKE: BOT_MARKE,
    SCHWEIZER_RUNDEN: SCHWEIZER_RUNDEN,
    istBot: istBot,
    mische: mische,
    paarSchluessel: paarSchluessel,
    ligaRunden: ligaRunden,
    jederGegenJeden: jederGegenJeden,
    ligaPlan: ligaPlan,
    ligaPaarungen: ligaPaarungen,
    tabelle: tabelle,
    zweierpotenzDarunter: zweierpotenzDarunter,
    siegeNoetig: siegeNoetig,
    rundenName: rundenName,
    koBaum: koBaum,
    offeneRunde: offeneRunde,
    koEintragen: koEintragen,
    koRemis: koRemis,
    notEntscheidung: notEntscheidung,
    REMIS_BIS: REMIS_BIS,
    koWeiter: koWeiter,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
