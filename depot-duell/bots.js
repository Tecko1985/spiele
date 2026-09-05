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

  /* Kursentwicklung über die letzten `fenster` Runden — der einzige Blick
     zurück, den ein Bot hat. */
  function schwung(lauf, id, runde, fenster) {
    const von = Math.max(0, runde - fenster);
    const a = markt.kurs(lauf, id, von);
    const b = markt.kurs(lauf, id, runde);
    if (!(a > 0)) return 0;
    return (b / a - 1) * 100;
  }

  function kaufe(trades, zustand, wert, kurs, runde, anteilVomCash) {
    /* ⚠️ Eine Strategie darf in EINEM Takt mehrfach handeln — nach dem ersten Zug ist der
       übergebene Zustand veraltet (Guthaben und Depotwert stimmen nicht mehr). Der Bot
       prüfte seinen Kauf dann gegen einen Stand, den es nicht mehr gab, und kaufte knapp
       über der 25-Prozent-Grenze. `frisch()` rechnet aus den bisherigen Zügen neu. */
    if (zustand.frisch) zustand = zustand.frisch();
    const wunschBetrag = zustand.cash * anteilVomCash;
    if (wunschBetrag < 500) return false;      // Kleckerkäufe lohnen die Gebühr nicht
    let stueck = depot.rundeStueck(wert, wunschBetrag / kurs);
    const grenze = depot.hoechstKaufbar(zustand, wert, kurs);
    if (stueck > grenze) stueck = grenze;
    if (!(stueck > 0)) return false;
    const pruefung = depot.pruefeKauf(zustand, wert, stueck, kurs);
    if (!pruefung.ok) return false;
    trades.push({ art: 'kauf', id: wert.id, stueck: stueck, runde: runde });
    return true;
  }

  function verkaufe(trades, zustand, position, runde, anteil) {
    const stueck = depot.rundeStueck(position.wert, position.stueck * anteil);
    if (!(stueck > 0)) return false;
    trades.push({ art: 'verkauf', id: position.id, stueck: stueck, runde: runde });
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
    zocker: function (rng, lauf, werte, zustand, runde, trades) {
      for (const p of zustand.positionen) {
        if (p.gewinnProzent < -28 && rng() < 0.7) verkaufe(trades, zustand, p, runde, 1);
      }
      const auswahl = werte.filter(function (w) {
        return w.art === 'krypto' || (w.art === 'aktie' && rng() < 0.35);
      });
      if (!auswahl.length) return;
      let bester = null;
      let bestwert = -1e9;
      for (const w of auswahl) {
        const s = schwung(lauf, w.id, runde, 3) + rng() * 20;
        if (s > bestwert) { bestwert = s; bester = w; }
      }
      if (bester) kaufe(trades, zustand, bester, markt.kurs(lauf, bester.id, runde), runde, 0.55);
    },

    /* Breite Indexfonds und Anleihen, dann liegen lassen. */
    sparer: function (rng, lauf, werte, zustand, runde, trades) {
      const auswahl = werte.filter(function (w) {
        return w.art === 'etf' && (w.anlageklasse === 'Aktien' || w.anlageklasse === 'Anleihen');
      });
      if (!auswahl.length) return;
      const w = auswahl[Math.floor(rng() * auswahl.length)];
      kaufe(trades, zustand, w, markt.kurs(lauf, w.id, runde), runde, 0.4);
    },

    /* Reagiert auf die Meldungen DIESER Runde: kauft nach guten, verkauft
       nach schlechten — genau wie ein Mensch, der die Schlagzeilen oben
       liest, bevor er auf "weiter" tippt. Ältere Meldungen sind für ihn
       erledigt, ihre Wirkung steckt längst im Kurs. */
    trendjaeger: function (rng, lauf, werte, zustand, runde, trades, werteNachId) {
      const frisch = markt.meldungenIn(lauf, runde);
      if (!frisch.length) return;
      const m = frisch[Math.floor(rng() * frisch.length)];

      let ziele = [];
      if (m.zielArt === 'wert') { const w = werteNachId[m.ziel]; if (w) ziele = [w]; }
      else if (m.zielArt === 'gruppe') ziele = werte.filter(function (w) { return nachrichten.gruppeVon(w) === m.ziel; });
      else ziele = werte.filter(function () { return rng() < 0.06; });
      if (!ziele.length) return;

      const ziel = ziele[Math.floor(rng() * ziele.length)];
      if (m.richtung > 0) {
        kaufe(trades, zustand, ziel, markt.kurs(lauf, ziel.id, runde), runde, 0.45);
      } else {
        const p = zustand.positionen.find(function (x) { return x.id === ziel.id; });
        if (p) verkaufe(trades, zustand, p, runde, 1);
      }
    },

    /* Kauft in den ersten Runden ein gestreutes Depot und rührt es nie an.
       Der stille Gegenspieler zu allen anderen — und erstaunlich oft vorn.
       Das Zeitfenster wächst mit der Partielänge: bei 20 Runden hat er drei
       Runden zum Aufbauen, bei 100 Runden fünfzehn. Eine feste Rundenzahl
       hätte ihn in der kurzen Partie mit halbem Depot dastehen lassen. */
    ruhepol: function (rng, lauf, werte, zustand, runde, trades) {
      if (runde > Math.max(3, Math.round(lauf.runden * 0.15))) return;
      const auswahl = werte.filter(function (w) { return w.art !== 'krypto'; });
      if (!auswahl.length) return;
      const w = auswahl[Math.floor(rng() * auswahl.length)];
      kaufe(trades, zustand, w, markt.kurs(lauf, w.id, runde), runde, 0.3);
    },

    /* Sucht niedrige Bewertung: kleines KGV, ordentliche Dividende. */
    schnaeppchen: function (rng, lauf, werte, zustand, runde, trades) {
      const auswahl = werte.filter(function (w) { return w.art === 'aktie' && w.kgv; });
      if (!auswahl.length) return;
      let bester = null;
      let bestwert = -1e9;
      for (const w of auswahl) {
        if (rng() < 0.7) continue;              // schaut sich nicht alles an
        const kgvJetzt = markt.kgv(lauf, w, runde);
        if (!kgvJetzt || kgvJetzt <= 0) continue;
        const punkte = 40 / kgvJetzt + markt.divRendite(lauf, w, runde);
        if (punkte > bestwert) { bestwert = punkte; bester = w; }
      }
      if (bester) kaufe(trades, zustand, bester, markt.kurs(lauf, bester.id, runde), runde, 0.4);
    },
  };

  /* Nach wie vielen Runden ein Charakter erneut zum Handeln ansetzt.
     Absolute Rundenabstände, NICHT auf die Partielänge umgerechnet: eine
     Runde ist immer derselbe Zeitsprung, also handelt ein Bot in einer
     langen Partie schlicht öfter — genauso wie ein Mensch. */
  const TAKT = { zocker: 4, sparer: 6, trendjaeger: 2, ruhepol: 2, schnaeppchen: 7 };

  /* ----------------------------------------------------------------------
     Erzeugung

     Rechnet alle Züge eines Bots für die ganze Partie im Voraus. Läuft
     einmal beim Partiestart.
     ---------------------------------------------------------------------- */
  function erzeugeTrades(lauf, werte, werteNachId, charakterId, platz, regeln) {
    const strategie = STRATEGIEN[charakterId];
    if (!strategie) return [];

    /* Eigene Saat je Bot, damit zwei Bots derselben Sorte nicht Zug um Zug
       dasselbe tun. Aus der Partiesaat abgeleitet, also weiterhin bestimmt. */
    const rng = markt.zufallsgeber((lauf.saat ^ Math.imul(platz + 1, 0x9e3779b9)) >>> 0);
    const trades = [];
    const takt = TAKT[charakterId] || 12;
    /* MUSS dieselbe uid sein wie in stelleAuf: sie entscheidet über das
       Startdepot. Rechnete der Bot seine Züge auf einem anderen Startbestand
       als die Rangliste später anzeigt, verkaufte er Werte, die er dort
       nie hatte — und die Rangliste zeigte einen Stand, der nie entstand. */
    const uid = 'bot-' + charakterId;

    /* Versetzter Start, sonst kaufen alle Bots in derselben Runde. */
    let naechster = Math.floor(rng() * takt);

    for (let t = 0; t <= lauf.runden; t++) {
      if (t < naechster) continue;
      naechster = t + Math.max(1, takt + Math.floor(rng() * 3) - 1);

      const zustand = depot.berechne(trades, lauf, t, werteNachId, regeln, uid);
      /* Nachrechnen auf Zuruf — siehe kaufe(). Die Strategien selbst bleiben unberührt. */
      zustand.frisch = function () {
        return depot.berechne(trades, lauf, t, werteNachId, regeln, uid);
      };
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
   * @param {object} regeln  Spielregeln des Raums (Startgeld, Gebuehr, Hoechstanteil).
   *   ⚠️ MUSS dieselben sein wie beim Menschen — sonst kauft ein Bot mit
   *   100.000 ein, waehrend die Mitspieler 500.000 haben, und die Rangliste
   *   vergleicht zwei verschiedene Spiele.
   * @returns {Array} Mitspieler mit id, name, zeichen, trades
   */
  function stelleAuf(lauf, werte, werteNachId, anzahl, regeln) {
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
        trades: erzeugeTrades(lauf, werte, werteNachId, c.id, i, regeln),
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
