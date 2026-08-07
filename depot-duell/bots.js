/* ==========================================================================
   Depot-Duell — KI-Mitspieler
   ==========================================================================

   Die Bots werden VOLLSTÄNDIG aus der Saat der Partie abgeleitet, genau wie
   die Kurse. Damit rechnet jedes Gerät identische Bot-Züge aus und es muss
   kein einziger Bot-Kauf über das Netz — bei fünf Bots und dreißig Zügen
   wären das sonst 150 Schreibvorgänge je Partie, die alle empfangen müssen.

   Sie sehen nur, was ein Mensch auch sieht: Kurse und Meldungen BIS zum
   aktuellen Tick. Ein Bot, der in die fertige Kurve schauen darf, wäre
   unschlagbar — und da die ganze Partie im Voraus berechnet ist, wäre genau
   das der leichteste Fehler.

   ⚠️ Der Bot-Pfad ist ein eigenständiger Weg durch den Code. Beim Maulwurf
   war er komplett tot, während der Mehrspieler-Pfad sauber verifiziert war
   (siehe CLAUDE.md). Der Solo-Modus gehört deshalb eigens getestet, nicht
   im Vorbeigehen mitgeprüft.
   ========================================================================== */

const bots = (function () {
  'use strict';

  /* Rollennamen, keine Personennamen — die Charaktere sollen ihre Strategie
     verraten, damit man beim Zuschauen etwas lernt. */
  const CHARAKTERE = [
    {
      id: 'zocker',
      name: 'Zocker',
      zeichen: '🎲',
      beschreibung: 'Geht auf alles, was gerade steigt — am liebsten Krypto.',
    },
    {
      id: 'sparer',
      name: 'Sparer',
      zeichen: '🛡️',
      beschreibung: 'Kauft breite Indexfonds und Anleihen und lässt sie liegen.',
    },
    {
      id: 'trendjaeger',
      name: 'Trendjäger',
      zeichen: '📰',
      beschreibung: 'Springt auf jede Schlagzeile auf, im Guten wie im Schlechten.',
    },
    {
      id: 'ruhepol',
      name: 'Ruhepol',
      zeichen: '🧘',
      beschreibung: 'Stellt einmal ein gestreutes Depot zusammen und rührt es nie wieder an.',
    },
    {
      id: 'schnaeppchen',
      name: 'Schnäppchenjäger',
      zeichen: '🔍',
      beschreibung: 'Kauft, was billig bewertet ist — niedriges KGV, hohe Dividende.',
    },
  ];

  function charakterListe() { return CHARAKTERE.slice(); }

  /* ----------------------------------------------------------------------
     Hilfen
     ---------------------------------------------------------------------- */

  /* Kursentwicklung über die letzten `fenster` Ticks — der einzige Blick
     zurück, den ein Bot hat. */
  function schwung(lauf, id, tick, fenster) {
    const von = Math.max(0, tick - fenster);
    const a = markt.kurs(lauf, id, von);
    const b = markt.kurs(lauf, id, tick);
    if (!(a > 0)) return 0;
    return (b / a - 1) * 100;
  }

  function kaufe(trades, zustand, wert, kurs, tick, anteilVomCash) {
    const wunschBetrag = zustand.cash * anteilVomCash;
    if (wunschBetrag < 500) return false;      // Kleckerkäufe lohnen die Gebühr nicht
    let stueck = depot.rundeStueck(wert, wunschBetrag / kurs);
    const grenze = depot.hoechstKaufbar(zustand, wert, kurs);
    if (stueck > grenze) stueck = grenze;
    if (!(stueck > 0)) return false;
    const pruefung = depot.pruefeKauf(zustand, wert, stueck, kurs);
    if (!pruefung.ok) return false;
    trades.push({ art: 'kauf', id: wert.id, stueck: stueck, tick: tick });
    return true;
  }

  function verkaufe(trades, zustand, position, tick, anteil) {
    const stueck = depot.rundeStueck(position.wert, position.stueck * anteil);
    if (!(stueck > 0)) return false;
    trades.push({ art: 'verkauf', id: position.id, stueck: stueck, tick: tick });
    return true;
  }

  /* ----------------------------------------------------------------------
     Die Strategien

     Jede bekommt (rng, lauf, werte, zustand, tick, trades) und darf handeln.
     Rückgabe wird nicht ausgewertet — was zählt, sind die Einträge in
     `trades`.
     ---------------------------------------------------------------------- */

  const STRATEGIEN = {
    /* Kauft, was zuletzt am stärksten gestiegen ist. Steigt aus, wenn eine
       Position deutlich ins Minus läuft. Krypto bevorzugt. */
    zocker: function (rng, lauf, werte, zustand, tick, trades) {
      for (const p of zustand.positionen) {
        if (p.gewinnProzent < -28 && rng() < 0.7) verkaufe(trades, zustand, p, tick, 1);
      }
      const auswahl = werte.filter(function (w) {
        return w.art === 'krypto' || (w.art === 'aktie' && rng() < 0.35);
      });
      if (!auswahl.length) return;
      let bester = null;
      let bestwert = -1e9;
      for (const w of auswahl) {
        const s = schwung(lauf, w.id, tick, 12) + rng() * 20;
        if (s > bestwert) { bestwert = s; bester = w; }
      }
      if (bester) kaufe(trades, zustand, bester, markt.kurs(lauf, bester.id, tick), tick, 0.55);
    },

    /* Breite Indexfonds und Anleihen, dann liegen lassen. */
    sparer: function (rng, lauf, werte, zustand, tick, trades) {
      const auswahl = werte.filter(function (w) {
        return w.art === 'etf' && (w.anlageklasse === 'Aktien' || w.anlageklasse === 'Anleihen');
      });
      if (!auswahl.length) return;
      const w = auswahl[Math.floor(rng() * auswahl.length)];
      kaufe(trades, zustand, w, markt.kurs(lauf, w.id, tick), tick, 0.4);
    },

    /* Reagiert auf Meldungen: kauft nach guten, verkauft nach schlechten.
       Sieht nur Meldungen der letzten Ticks — wie jemand, der den Ticker
       mitliest, aber nicht die ganze Historie durchgeht. */
    trendjaeger: function (rng, lauf, werte, zustand, tick, trades, werteNachId) {
      const frisch = lauf.meldungen.filter(function (m) {
        return m.tick <= tick && m.tick > tick - 8;
      });
      if (!frisch.length) return;
      const m = frisch[Math.floor(rng() * frisch.length)];

      let ziele = [];
      if (m.zielArt === 'wert') { const w = werteNachId[m.ziel]; if (w) ziele = [w]; }
      else if (m.zielArt === 'gruppe') ziele = werte.filter(function (w) { return nachrichten.gruppeVon(w) === m.ziel; });
      else ziele = werte.filter(function () { return rng() < 0.06; });
      if (!ziele.length) return;

      const ziel = ziele[Math.floor(rng() * ziele.length)];
      if (m.richtung > 0) {
        kaufe(trades, zustand, ziel, markt.kurs(lauf, ziel.id, tick), tick, 0.45);
      } else {
        const p = zustand.positionen.find(function (x) { return x.id === ziel.id; });
        if (p) verkaufe(trades, zustand, p, tick, 1);
      }
    },

    /* Kauft in den ersten Ticks ein gestreutes Depot und rührt es nie an.
       Der stille Gegenspieler zu allen anderen — und erstaunlich oft vorn. */
    ruhepol: function (rng, lauf, werte, zustand, tick, trades) {
      if (tick > 24) return;
      const auswahl = werte.filter(function (w) { return w.art !== 'krypto'; });
      if (!auswahl.length) return;
      const w = auswahl[Math.floor(rng() * auswahl.length)];
      kaufe(trades, zustand, w, markt.kurs(lauf, w.id, tick), tick, 0.3);
    },

    /* Sucht niedrige Bewertung: kleines KGV, ordentliche Dividende. */
    schnaeppchen: function (rng, lauf, werte, zustand, tick, trades) {
      const auswahl = werte.filter(function (w) { return w.art === 'aktie' && w.kgv; });
      if (!auswahl.length) return;
      let bester = null;
      let bestwert = -1e9;
      for (const w of auswahl) {
        if (rng() < 0.7) continue;              // schaut sich nicht alles an
        const kgvJetzt = markt.kgv(lauf, w, tick);
        if (!kgvJetzt || kgvJetzt <= 0) continue;
        const punkte = 40 / kgvJetzt + markt.divRendite(lauf, w, tick);
        if (punkte > bestwert) { bestwert = punkte; bester = w; }
      }
      if (bester) kaufe(trades, zustand, bester, markt.kurs(lauf, bester.id, tick), tick, 0.4);
    },
  };

  /* Wie oft ein Charakter überhaupt zum Handeln ansetzt. */
  const TAKT = { zocker: 11, sparer: 17, trendjaeger: 7, ruhepol: 5, schnaeppchen: 19 };

  /* ----------------------------------------------------------------------
     Erzeugung

     Rechnet alle Züge eines Bots für die ganze Partie im Voraus. Läuft
     einmal beim Partiestart.
     ---------------------------------------------------------------------- */
  function erzeugeTrades(lauf, werte, werteNachId, charakterId, platz) {
    const strategie = STRATEGIEN[charakterId];
    if (!strategie) return [];

    /* Eigene Saat je Bot, damit zwei Bots derselben Sorte nicht Zug um Zug
       dasselbe tun. Aus der Partiesaat abgeleitet, also weiterhin bestimmt. */
    const rng = markt.zufallsgeber((lauf.saat ^ Math.imul(platz + 1, 0x9e3779b9)) >>> 0);
    const trades = [];
    const takt = TAKT[charakterId] || 12;

    /* Versetzter Start, sonst kaufen alle Bots im selben Tick. */
    let naechster = 2 + Math.floor(rng() * takt);

    for (let t = 0; t <= markt.TICKS; t++) {
      if (t < naechster) continue;
      naechster = t + Math.max(3, takt + Math.floor(rng() * 7) - 3);

      const zustand = depot.berechne(trades, lauf, t, werteNachId);
      strategie(rng, lauf, werte, zustand, t, trades, werteNachId);
    }

    return trades;
  }

  /**
   * Stellt das Bot-Feld einer Partie auf.
   * @param {object} lauf   aus markt.erzeuge
   * @param {Array} werte
   * @param {object} werteNachId
   * @param {number} anzahl 1..5
   * @returns {Array} Mitspieler mit id, name, zeichen, trades
   */
  function stelleAuf(lauf, werte, werteNachId, anzahl) {
    const zahl = Math.max(0, Math.min(CHARAKTERE.length, anzahl | 0));
    const raus = [];
    for (let i = 0; i < zahl; i++) {
      const c = CHARAKTERE[i];
      raus.push({
        uid: 'bot-' + c.id,
        name: c.name,
        zeichen: c.zeichen,
        beschreibung: c.beschreibung,
        istBot: true,
        trades: erzeugeTrades(lauf, werte, werteNachId, c.id, i),
      });
    }
    return raus;
  }

  return {
    CHARAKTERE: CHARAKTERE,
    charakterListe: charakterListe,
    stelleAuf: stelleAuf,
    erzeugeTrades: erzeugeTrades,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = bots;
