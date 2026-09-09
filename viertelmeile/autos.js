/* ==========================================================================
   Viertelmeile — die Autos
   ==========================================================================
   ⚠️ BEIDE FAHRER EINES RENNENS FAHREN IMMER DASSELBE AUTO. Welches, das
   ergibt sich aus der Rundennummer — nicht aus einer Wahl. Ein Turnier, in
   dem einer das stärkere Auto nehmen darf, sagt nichts über das Können aus.
   Frei ist nur die Lackierung, und die ändert am Rennen nichts.

   Die Zahlen sind gegen pflege/pruefe-fahrt.js abgestimmt:
   `vMax` = Tempo in m/s, bei dem die Nadel im roten Bereich steht,
   `kraft` = Beschleunigung in m/s^2 bei bester Drehzahl.
   ========================================================================== */

const autos = (function () {
  'use strict';

  const LISTE = [
    {
      id: 'flitzer',
      name: 'Kleiner Flitzer',
      icon: '🚙',
      kurz: 'Viel Schalten, wenig Zug. Das Auto zum Reinkommen.',
      gaenge: [
        { vMax: 14, kraft: 9.6 },
        { vMax: 24, kraft: 8.4 },
        { vMax: 36, kraft: 7.0 },
        { vMax: 50, kraft: 5.6 },
      ],
      fensterBreit: 0.17,
      fensterSchritt: 0.020,
      fensterEng: 0.090,
      zuege: [2, 3],
      luft: 1.25,
    },
    {
      id: 'muscle',
      name: 'Muscle-Car',
      icon: '🚗',
      kurz: 'Drei lange Gänge, brutal viel Kraft — und es reißt am Lenkrad.',
      gaenge: [
        { vMax: 21, kraft: 11.3 },
        { vMax: 42, kraft: 9.2 },
        { vMax: 70, kraft: 6.9 },
      ],
      fensterBreit: 0.135,
      fensterSchritt: 0.025,
      fensterEng: 0.070,
      zuege: [3, 4],
      luft: 1.00,
    },
    {
      id: 'dragster',
      name: 'Dragster',
      icon: '🏎️',
      kurz: 'Das schnellste Auto — mit dem schmalsten grünen Bereich.',
      gaenge: [
        { vMax: 23, kraft: 13.8 },
        { vMax: 41, kraft: 11.6 },
        { vMax: 62, kraft: 9.5 },
        { vMax: 84, kraft: 7.6 },
      ],
      fensterBreit: 0.095,
      fensterSchritt: 0.018,
      fensterEng: 0.048,
      zuege: [2, 4],
      luft: 0.80,
    },
  ];

  const NACH_ID = {};
  for (const a of LISTE) NACH_ID[a.id] = a;

  /** Das Auto einer Runde. Beide Fahrer bekommen dasselbe. */
  function fuerRunde(nr) {
    return LISTE[(Math.max(1, nr | 0) - 1) % LISTE.length];
  }

  function nachId(id) { return NACH_ID[id] || LISTE[0]; }

  /* Lackierungen — reine Optik, ohne Wirkung aufs Rennen. */
  const LACKE = [
    { id: 'rot', name: 'Rot', farbe: '#e0533f', dunkel: '#8f2c1e' },
    { id: 'blau', name: 'Blau', farbe: '#3d7fd6', dunkel: '#1f4a86' },
    { id: 'gruen', name: 'Grün', farbe: '#3fa859', dunkel: '#1f6b34' },
    { id: 'gelb', name: 'Gelb', farbe: '#f0c419', dunkel: '#a4830a' },
    { id: 'lila', name: 'Lila', farbe: '#9b59c4', dunkel: '#5f2f7d' },
    { id: 'orange', name: 'Orange', farbe: '#ef8321', dunkel: '#9c4f08' },
    { id: 'tuerkis', name: 'Türkis', farbe: '#22b3ac', dunkel: '#0d6d69' },
    { id: 'weiss', name: 'Weiß', farbe: '#e8e2d8', dunkel: '#948d81' },
  ];

  const LACK_NACH_ID = {};
  for (const l of LACKE) LACK_NACH_ID[l.id] = l;

  function lack(id) { return LACK_NACH_ID[id] || LACKE[0]; }

  /** Freie Lackierung für einen Neuzugang — nimmt die erste noch unbenutzte. */
  function freierLack(belegt) {
    for (const l of LACKE) if (!belegt || belegt.indexOf(l.id) < 0) return l.id;
    return LACKE[Math.floor(Math.random() * LACKE.length)].id;
  }

  const api = {
    LISTE: LISTE,
    LACKE: LACKE,
    fuerRunde: fuerRunde,
    nachId: nachId,
    lack: lack,
    freierLack: freierLack,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
