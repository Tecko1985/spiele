/* ==========================================================================
   Viertelmeile — der Bot
   ==========================================================================
   Fährt eine komplette Runde durch, ohne zu zeichnen. Gebraucht wird er an
   zwei Stellen:

     1. ungerade Spielerzahl in der Liga — dann fehlt genau einem Menschen
        ein Gegner,
     2. „Allein üben" ohne Raum.

   ⚠️ DER BOT HAT KEIN EIGENES FIREBASE-KONTO. Seine Kennung ist nur ein
   String (`bot-…`), gerechnet wird er auf dem Gerät des Menschen, gegen den
   er antritt. Deshalb schreibt dieses Gerät ZWEI Ergebnisse.

   ⚠️ Der Bot benutzt denselben Rechenkern wie ein Mensch (physik.js). Es
   gibt keinen zweiten, vereinfachten Fahrweg — sonst prüft der Prüfstand
   Code, den nie jemand fährt.
   ========================================================================== */

const bot = (function () {
  'use strict';

  /* Im Browser liegt `physik` als globale Konstante bereit (Reihenfolge der
     script-Tags in index.html); in Node wird die Datei nachgeladen. */
  const p = typeof physik !== 'undefined' ? physik : require('./physik.js');

  const STUFEN = {
    leicht: {
      name: 'Leicht',
      reaktion: 0.48, reaktionStreu: 0.11,
      waerme: 0.58, waermeStreu: 0.26,
      schaltZiel: 0.900, schaltStreu: 0.060,
      lenkVerzug: 0.46, lenkTakt: 0.26, lenkAussetzer: 0.06,
    },
    mittel: {
      name: 'Mittel',
      reaktion: 0.33, reaktionStreu: 0.075,
      waerme: 0.86, waermeStreu: 0.15,
      schaltZiel: 0.955, schaltStreu: 0.032,
      lenkVerzug: 0.34, lenkTakt: 0.22, lenkAussetzer: 0.015,
    },
    schwer: {
      name: 'Schwer',
      reaktion: 0.235, reaktionStreu: 0.045,
      waerme: 0.93, waermeStreu: 0.075,
      schaltZiel: 0.985, schaltStreu: 0.018,
      lenkVerzug: 0.26, lenkTakt: 0.20, lenkAussetzer: 0.02,
    },
  };

  function stufe(id) { return STUFEN[id] || STUFEN.mittel; }

  /* Zwei Gleichverteilte ergeben zusammen eine glockige Streuung — das reicht
     hier und braucht keine Wurzel-Logarithmus-Rechnerei. */
  function streu(w, breite) { return (w() + w() - 1) * breite; }

  /**
   * Fährt einen kompletten Lauf. `saat` ist die Saat des Rennens (gleiche
   * Ausbrecher wie beim Menschen), `botSaat` würfelt die Fahrfehler.
   */
  const SPUR_TAKT = 1 / 30;      // so oft wird die Position für die Anzeige notiert

  function fahre(auto, saat, stufenId, botSaat, spur) {
    const s = stufe(stufenId);
    const w = p.saatZufall((botSaat >>> 0) ^ 0x9e3779b9);

    const waerme = Math.max(0, Math.min(1.4, s.waerme + streu(w, s.waermeStreu)));
    const l = p.neuerLauf(auto, saat, waerme);

    const reaktion = Math.max(0.06, s.reaktion + streu(w, s.reaktionStreu));
    p.starte(l, reaktion);

    let naechsteLenkung = -1;
    let naechsteSpur = 0;
    let wache = 0;

    while (!l.fertig && !l.aus && wache++ < 20000) {
      p.schritt(l, p.SCHRITT);
      if (spur && l.t >= naechsteSpur) {
        naechsteSpur += SPUR_TAKT;
        spur.push({ t: l.t, s: l.s, v: l.v, versatz: l.versatz });
      }
      if (l.fertig || l.aus) break;

      /* Schalten: sobald die Nadel den eigenen Zielwert erreicht. */
      if (l.gang < auto.gaenge.length - 1 && l.t >= l.leerlaufBis) {
        const ziel = Math.max(0.55, s.schaltZiel + streu(w, s.schaltStreu));
        if (p.drehzahl(l) >= ziel) p.schalte(l);
      }

      /* Gegenlenken: erst nach der eigenen Schrecksekunde, dann im Takt.
         ⚠️ Die Schrecksekunde hält AUCH das Nachsteuern an. Ohne das griff
         der Bot schon zu, sobald sich das Auto einen Fingerbreit bewegte —
         dann war `lenkVerzug` eine Zahl ohne Wirkung und alle drei Stufen
         lenkten gleich gut. */
      let schlaeft = false;
      let zieht = 0;
      for (const z of l.zuege) {
        if (l.t >= z.zeit && l.t < z.zeit + p.ZUG_DAUER + 0.35) {
          if (l.t < z.zeit + s.lenkVerzug) schlaeft = true; else zieht += z.richtung;
        }
      }
      if (schlaeft) continue;
      const schief = Math.abs(l.versatz) > 0.10 ? (l.versatz > 0 ? 1 : -1) : 0;
      const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
      if (noetig !== 0 && l.t >= naechsteLenkung) {
        naechsteLenkung = l.t + s.lenkTakt;
        if (w() >= s.lenkAussetzer) p.lenke(l, -noetig);
      }
    }
    return l;
  }

  /**
   * Wie `fahre`, gibt aber zusätzlich die abgefahrene Spur zurück — damit
   * das Menschen-Gerät den Bot NEBEN sich zeichnen kann, ohne ihn Bild für
   * Bild mitrechnen zu müssen. Der ganze Lauf ist am Start schon bekannt.
   */
  function mitSpur(auto, saat, stufenId, botSaat) {
    const spur = [];
    const lauf = fahre(auto, saat, stufenId, botSaat, spur);
    /* Der letzte Punkt: das Ziel bzw. die Stelle, an der es vorbei war. */
    spur.push({ t: lauf.t, s: lauf.s, v: lauf.v, versatz: lauf.versatz });
    return { lauf: lauf, spur: spur };
  }

  /** Position des Bots zu einem Zeitpunkt (Sekunden ab Grün), interpoliert. */
  function ausSpur(spur, t) {
    if (!spur || !spur.length) return null;
    if (t <= spur[0].t) return spur[0];
    const letzter = spur[spur.length - 1];
    if (t >= letzter.t) return letzter;
    /* Gleichmäßiger Takt: der Index lässt sich direkt ausrechnen. */
    let i = Math.min(spur.length - 2, Math.max(0, Math.floor(t / SPUR_TAKT)));
    while (i > 0 && spur[i].t > t) i--;
    while (i < spur.length - 2 && spur[i + 1].t < t) i++;
    const a = spur[i], b = spur[i + 1];
    const spanne = b.t - a.t;
    const k = spanne > 0 ? (t - a.t) / spanne : 0;
    return { t: t, s: a.s + (b.s - a.s) * k, v: a.v + (b.v - a.v) * k, versatz: a.versatz + (b.versatz - a.versatz) * k };
  }

  const api = { STUFEN: STUFEN, SPUR_TAKT: SPUR_TAKT, stufe: stufe, fahre: fahre, mitSpur: mitSpur, ausSpur: ausSpur };
  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
