/* ==========================================================================
   Werwolf — Sprecher
   ==========================================================================
   Sprachausgabe (Web Speech API), Vibration und Wach-Halten des Bildschirms.
   Alles wird geguardet: auf alten Geräten fehlt die eine oder andere API,
   und das Spiel muss trotzdem laufen — dann eben stumm.

   ⚠️ iOS spricht erst nach einer Nutzergeste. `entsperre()` wird deshalb
   beim ersten Tipper auf einen Knopf gerufen und spricht einmal leer.
   ========================================================================== */

const sprecher = (function () {
  'use strict';

  const SCHLUESSEL = 'spiele_werwolf_einstellungen';
  let einstellungen = lade();
  let entsperrt = false;
  let stimme = null;
  let wachSperre = null;

  function lade() {
    const vorgabe = { sprache: true, vibration: true, hell: false };
    try {
      const roh = JSON.parse(localStorage.getItem(SCHLUESSEL) || '{}');
      return Object.assign(vorgabe, roh);
    } catch (f) { return vorgabe; }
  }

  function speichere() {
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(einstellungen)); } catch (f) { /* Privatmodus */ }
  }

  function setze(name, wert) { einstellungen[name] = wert; speichere(); }
  function hole(name) { return einstellungen[name]; }

  function kannSprechen() { return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; }

  function waehleStimme() {
    if (!kannSprechen()) return null;
    const alle = window.speechSynthesis.getVoices() || [];
    const deutsch = alle.filter(function (v) { return /^de/i.test(v.lang); });
    /* Lokale Stimmen sprechen ohne Netz — im Bus die einzigen, die zuverlässig kommen. */
    return deutsch.find(function (v) { return v.localService; }) || deutsch[0] || null;
  }

  if (kannSprechen()) {
    stimme = waehleStimme();
    window.speechSynthesis.onvoiceschanged = function () { stimme = waehleStimme(); };
  }

  /** Beim ersten Tipper: Sprachausgabe für iOS freischalten. */
  function entsperre() {
    if (entsperrt || !kannSprechen()) return;
    entsperrt = true;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.lang = 'de-DE';
      window.speechSynthesis.speak(u);
    } catch (f) { /* egal */ }
  }

  function sprich(text) {
    if (!einstellungen.sprache || !kannSprechen() || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      u.rate = 0.95;
      if (stimme) u.voice = stimme;
      window.speechSynthesis.speak(u);
    } catch (f) { /* stumm weiter */ }
  }

  function stopp() {
    if (kannSprechen()) { try { window.speechSynthesis.cancel(); } catch (f) { /* egal */ } }
  }

  /** Vibration — auf dem iPhone gibt es keine, dort passiert einfach nichts. */
  function vibriere(muster) {
    if (!einstellungen.vibration) return;
    try { if (navigator.vibrate) navigator.vibrate(muster || 40); } catch (f) { /* egal */ }
  }

  /** Bildschirm wach halten (Erzähler-Gerät). */
  async function halteWach() {
    try {
      if (!('wakeLock' in navigator) || wachSperre) return;
      wachSperre = await navigator.wakeLock.request('screen');
      wachSperre.addEventListener('release', function () { wachSperre = null; });
    } catch (f) { wachSperre = null; }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && wachSperre === null && window.__wachHalten) halteWach();
    });
  }

  return {
    setze: setze,
    hole: hole,
    kannSprechen: kannSprechen,
    entsperre: entsperre,
    sprich: sprich,
    stopp: stopp,
    vibriere: vibriere,
    halteWach: halteWach,
  };
})();
