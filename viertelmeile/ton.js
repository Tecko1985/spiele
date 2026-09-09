/* ==========================================================================
   Viertelmeile — Ton, Vibration, Bildschirm wach halten
   ==========================================================================
   Der Motor wird im Handy selbst erzeugt (zwei Sägezahn-Töne durch ein
   Filter), es gibt keine Klangdateien — nichts zu laden, kein Datenvolumen.

   ⚠️ WARUM DER TON KEIN BEIWERK IST. In 10 Sekunden muss man gleichzeitig
   auf die Drehzahl und auf die Spur achten. Wer den Motor HÖRT, muss nicht
   auf den Tacho starren und hat die Augen für die Spur frei. Deshalb steht
   der Ton auf AN — abschalten geht über den Lautsprecher im Kopf.

   ⚠️ iOS lässt Töne erst nach einer Nutzergeste zu. `entsperre()` wird beim
   ersten Tipper gerufen. Alles ist geguardet: fehlt die Schnittstelle, läuft
   das Spiel eben stumm.
   ========================================================================== */

const ton = (function () {
  'use strict';

  const SCHLUESSEL = 'spiele_viertelmeile_einstellungen';
  let einstellungen = lade();

  let ctx = null;
  let motorAn = false;
  let osc1 = null, osc2 = null, filter = null, motorGain = null;
  let rauschQuelle = null, rauschGain = null, rauschFilter = null;
  let wachSperre = null;

  function lade() {
    const vorgabe = { ton: true, vibration: true, lack: 'rot', name: '' };
    try {
      return Object.assign(vorgabe, JSON.parse(localStorage.getItem(SCHLUESSEL) || '{}'));
    } catch (f) { return vorgabe; }
  }

  function speichere() {
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(einstellungen)); } catch (f) { /* Privatmodus */ }
  }

  function setze(name, wert) { einstellungen[name] = wert; speichere(); if (name === 'ton' && !wert) motorStopp(); }
  function hole(name) { return einstellungen[name]; }

  function kannTon() {
    return typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  }

  /** Beim ersten Tipper: Tonausgabe für iOS freischalten. */
  function entsperre() {
    if (!kannTon()) return;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (f) { ctx = null; }
  }

  function bereit() {
    if (!einstellungen.ton) return false;
    entsperre();
    return !!ctx && ctx.state === 'running';
  }

  /* ----------------------------------------------------------------------
     Motor
     ---------------------------------------------------------------------- */

  function motorStart() {
    if (motorAn || !bereit()) return;
    try {
      motorGain = ctx.createGain();
      motorGain.gain.value = 0;
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.Q.value = 4;
      osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
      osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.detune.value = -14;
      osc1.connect(filter); osc2.connect(filter);
      filter.connect(motorGain); motorGain.connect(ctx.destination);
      osc1.start(); osc2.start();
      motorAn = true;
    } catch (f) { motorAn = false; }
  }

  function motorStopp() {
    if (!motorAn) return;
    try {
      motorGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      const o1 = osc1, o2 = osc2;
      setTimeout(function () { try { o1.stop(); o2.stop(); } catch (f) { /* egal */ } }, 300);
    } catch (f) { /* egal */ }
    motorAn = false;
    osc1 = osc2 = filter = motorGain = null;
  }

  /**
   * `drehzahl` 0 bis etwa 1.1, `gas` 0 oder 1 (beim Schalten kurz aus).
   * Wird jedes Bild gerufen; die Werte werden weich nachgeführt, sonst
   * knackt es bei jedem Sprung.
   */
  function motor(drehzahl, gas) {
    if (!einstellungen.ton) { motorStopp(); return; }
    if (!motorAn) motorStart();
    if (!motorAn) return;
    try {
      const jetzt = ctx.currentTime;
      const r = Math.max(0, Math.min(1.15, drehzahl || 0));
      /* Grundton steigt mit der Drehzahl; oben wird es zusätzlich schärfer. */
      const hz = 48 + r * 190;
      osc1.frequency.setTargetAtTime(hz, jetzt, 0.02);
      osc2.frequency.setTargetAtTime(hz * 1.005, jetzt, 0.02);
      filter.frequency.setTargetAtTime(500 + r * 2600, jetzt, 0.03);
      motorGain.gain.setTargetAtTime(gas ? 0.075 + r * 0.045 : 0.028, jetzt, 0.03);
    } catch (f) { /* egal */ }
  }

  function leerlauf() { motor(0.12, 1); }

  /* ----------------------------------------------------------------------
     Reifenqualm (Burnout) und kurze Töne
     ---------------------------------------------------------------------- */

  function rauschStart() {
    if (rauschQuelle || !bereit()) return;
    try {
      const laenge = ctx.sampleRate * 2;
      const puffer = ctx.createBuffer(1, laenge, ctx.sampleRate);
      const daten = puffer.getChannelData(0);
      for (let i = 0; i < laenge; i++) daten[i] = Math.random() * 2 - 1;
      rauschQuelle = ctx.createBufferSource();
      rauschQuelle.buffer = puffer;
      rauschQuelle.loop = true;
      rauschFilter = ctx.createBiquadFilter();
      rauschFilter.type = 'bandpass';
      rauschFilter.frequency.value = 1400;
      rauschFilter.Q.value = 1.2;
      rauschGain = ctx.createGain();
      rauschGain.gain.value = 0;
      rauschQuelle.connect(rauschFilter); rauschFilter.connect(rauschGain); rauschGain.connect(ctx.destination);
      rauschQuelle.start();
    } catch (f) { rauschQuelle = null; }
  }

  /** `waerme` 0 bis 1.4 — je heißer, desto schriller das Quietschen. */
  function quietschen(waerme) {
    if (!einstellungen.ton) return;
    rauschStart();
    if (!rauschQuelle) return;
    try {
      const jetzt = ctx.currentTime;
      rauschGain.gain.setTargetAtTime(0.10, jetzt, 0.03);
      rauschFilter.frequency.setTargetAtTime(900 + (waerme || 0) * 1800, jetzt, 0.05);
    } catch (f) { /* egal */ }
  }

  function quietschenAus() {
    if (!rauschQuelle) return;
    try { rauschGain.gain.setTargetAtTime(0, ctx.currentTime, 0.06); } catch (f) { /* egal */ }
  }

  function stoppAlles() {
    motorStopp();
    quietschenAus();
    if (rauschQuelle) {
      const q = rauschQuelle;
      rauschQuelle = null;
      setTimeout(function () { try { q.stop(); } catch (f) { /* egal */ } }, 300);
    }
  }

  const TOENE = {
    gelb: { hz: 520, dauer: 0.10, laut: 0.16, form: 'square' },
    gruen: { hz: 880, dauer: 0.28, laut: 0.22, form: 'square' },
    warnung: { hz: 300, dauer: 0.14, laut: 0.18, form: 'triangle' },
    perfekt: { hz: 1180, dauer: 0.07, laut: 0.14, form: 'sine' },
    fehler: { hz: 150, dauer: 0.30, laut: 0.22, form: 'sawtooth' },
    ziel: { hz: 660, dauer: 0.45, laut: 0.20, form: 'sine' },
  };

  function piep(art) {
    if (!bereit()) return;
    const t = TOENE[art];
    if (!t) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = t.form;
      o.frequency.value = t.hz;
      g.gain.setValueAtTime(t.laut, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t.dauer);
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + t.dauer + 0.02);
    } catch (f) { /* egal */ }
  }

  /* ----------------------------------------------------------------------
     Vibration und Wach-Halten
     ---------------------------------------------------------------------- */

  function vibriere(muster) {
    if (!einstellungen.vibration) return;
    try { if (navigator.vibrate) navigator.vibrate(muster || 30); } catch (f) { /* egal */ }
  }

  async function halteWach() {
    try {
      if (!('wakeLock' in navigator) || wachSperre) return;
      wachSperre = await navigator.wakeLock.request('screen');
      wachSperre.addEventListener('release', function () { wachSperre = null; });
    } catch (f) { wachSperre = null; }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') stoppAlles();
      else if (wachSperre === null && window.__wachHalten) halteWach();
    });
  }

  return {
    setze: setze,
    hole: hole,
    kannTon: kannTon,
    entsperre: entsperre,
    motor: motor,
    leerlauf: leerlauf,
    motorStopp: motorStopp,
    quietschen: quietschen,
    quietschenAus: quietschenAus,
    stoppAlles: stoppAlles,
    piep: piep,
    vibriere: vibriere,
    halteWach: halteWach,
  };
})();
