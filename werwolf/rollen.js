/* ==========================================================================
   Werwolf — Rollen
   ==========================================================================

   REINE DATEN, KEIN FIREBASE, KEINE OBERFLÄCHE.

   Jede Rolle hat:
     id             Schlüssel im Spielzustand
     name           Anzeige
     team           'dorf' | 'wolf' | 'weiss' | 'floete'
                    ('weiss' und 'floete' spielen allein)
     icon           Emoji für Karte und Liste
     beschreibung   Regeltext, den der Spieler auf seiner Karte liest
     nachtPosition  Reihenfolge der Aufrufe in der Nacht (0 = wird nie gerufen)
     nurErsteNacht  wird nur in der ersten Nacht gerufen
     max            wie oft die Rolle höchstens in einer Runde liegt
     gewicht        grober Wert für die Balance-Anzeige (+ Dorf, − Wölfe)
     wachAuf        Ansage des Erzählers, wenn die Rolle dran ist
     schlafEin      Ansage, wenn sie fertig ist

   Der Wolf zählt „als Wolf" für Sieg und Zählung; der Weiße Werwolf ebenso,
   er will aber am Ende allein übrig sein.
   ========================================================================== */

const rollen = (function () {
  'use strict';

  const LISTE = [
    {
      id: 'dorfbewohner', name: 'Dorfbewohner', team: 'dorf', icon: '🧑‍🌾',
      beschreibung: 'Du hast keine besondere Fähigkeit. Hör gut zu, rede mit und finde die Werwölfe, bevor sie dich finden.',
      nachtPosition: 0, nurErsteNacht: false, max: 20, gewicht: 1,
      wachAuf: '', schlafEin: '',
    },
    {
      id: 'werwolf', name: 'Werwolf', team: 'wolf', icon: '🐺',
      beschreibung: 'Jede Nacht wählst du mit den anderen Werwölfen ein Opfer. Am Tag spielst du den harmlosen Dorfbewohner.',
      nachtPosition: 40, nurErsteNacht: false, max: 6, gewicht: -6,
      wachAuf: 'Die Werwölfe erwachen und wählen ihr Opfer.',
      schlafEin: 'Die Werwölfe schlafen wieder ein.',
    },
    {
      id: 'seherin', name: 'Seherin', team: 'dorf', icon: '🔮',
      beschreibung: 'Jede Nacht darfst du dir die Rolle eines Spielers ansehen.',
      nachtPosition: 70, nurErsteNacht: false, max: 1, gewicht: 7,
      wachAuf: 'Die Seherin erwacht und sieht sich die Rolle eines Spielers an.',
      schlafEin: 'Die Seherin schläft wieder ein.',
    },
    {
      id: 'hexe', name: 'Hexe', team: 'dorf', icon: '🧪',
      beschreibung: 'Du hast einen Heiltrank und einen Gifttrank, jeden nur einmal im Spiel. Nachts siehst du, wen die Wölfe gerissen haben. Du kannst das Opfer retten, auch dich selbst, und jemanden vergiften.',
      nachtPosition: 60, nurErsteNacht: false, max: 1, gewicht: 4,
      wachAuf: 'Die Hexe erwacht. Sie sieht das Opfer der Wölfe und entscheidet über ihre Tränke.',
      schlafEin: 'Die Hexe schläft wieder ein.',
    },
    {
      id: 'jaeger', name: 'Jäger', team: 'dorf', icon: '🏹',
      beschreibung: 'Stirbst du, ganz gleich wodurch, gibst du sofort einen letzten Schuss ab und reißt einen Spieler mit in den Tod.',
      nachtPosition: 0, nurErsteNacht: false, max: 1, gewicht: 3,
      wachAuf: '', schlafEin: '',
    },
    {
      id: 'amor', name: 'Amor', team: 'dorf', icon: '💘',
      beschreibung: 'In der ersten Nacht verkuppelst du zwei Spieler. Du darfst dich selbst wählen. Stirbt einer der beiden, stirbt der andere vor Kummer. Stehen sie in verschiedenen Lagern, gewinnen sie nur zu zweit.',
      nachtPosition: 20, nurErsteNacht: true, max: 1, gewicht: -2,
      wachAuf: 'Amor erwacht und wählt zwei Spieler, die sich ineinander verlieben.',
      schlafEin: 'Amor schläft wieder ein.',
    },
    {
      id: 'beschuetzer', name: 'Beschützer', team: 'dorf', icon: '🛡️',
      beschreibung: 'Jede Nacht beschützt du einen Spieler vor den Wölfen, auch dich selbst. Nie zweimal hintereinander denselben.',
      nachtPosition: 30, nurErsteNacht: false, max: 1, gewicht: 3,
      wachAuf: 'Der Beschützer erwacht und wählt, wen er in dieser Nacht beschützt.',
      schlafEin: 'Der Beschützer schläft wieder ein.',
    },
    {
      id: 'dieb', name: 'Dieb', team: 'dorf', icon: '🎭',
      beschreibung: 'In der ersten Nacht siehst du die zwei Karten, die übrig geblieben sind. Du darfst eine davon nehmen. Sind beide Werwölfe, musst du eine nehmen.',
      nachtPosition: 10, nurErsteNacht: true, max: 1, gewicht: 0,
      wachAuf: 'Der Dieb erwacht und sieht sich die beiden übrigen Karten an.',
      schlafEin: 'Der Dieb schläft wieder ein.',
    },
    {
      id: 'maedchen', name: 'Das Mädchen', team: 'dorf', icon: '👧',
      beschreibung: 'Während die Werwölfe wach sind, darfst du kurz blinzeln. Wirst du erwischt, bist du ihr nächstes Opfer.',
      nachtPosition: 0, nurErsteNacht: false, max: 1, gewicht: 2,
      wachAuf: '', schlafEin: '',
    },
    {
      id: 'alte', name: 'Der Alte', team: 'dorf', icon: '🧓',
      beschreibung: 'Den ersten Angriff der Wölfe überlebst du. Tötet dich aber das Dorf, die Hexe oder der Jäger, verlieren alle Dorfrollen ihre Fähigkeiten.',
      nachtPosition: 0, nurErsteNacht: false, max: 1, gewicht: 2,
      wachAuf: '', schlafEin: '',
    },
    {
      id: 'suendenbock', name: 'Sündenbock', team: 'dorf', icon: '🐐',
      beschreibung: 'Endet eine Abstimmung im Dorf unentschieden, stirbst du an Stelle der Kandidaten.',
      nachtPosition: 0, nurErsteNacht: false, max: 1, gewicht: 0,
      wachAuf: '', schlafEin: '',
    },
    {
      id: 'weisserWerwolf', name: 'Weißer Werwolf', team: 'weiss', icon: '🐺',
      beschreibung: 'Du heulst mit den Wölfen und wählst mit ihnen das Opfer. In jeder zweiten Nacht darfst du zusätzlich einen Werwolf töten. Du gewinnst nur, wenn du am Ende ganz allein übrig bist.',
      nachtPosition: 50, nurErsteNacht: false, max: 1, gewicht: -5,
      wachAuf: 'Der Weiße Werwolf erwacht allein und darf einen Werwolf töten.',
      schlafEin: 'Der Weiße Werwolf schläft wieder ein.',
    },
    {
      id: 'floetenspieler', name: 'Flötenspieler', team: 'floete', icon: '🎶',
      beschreibung: 'Jede Nacht verzauberst du zwei Spieler. Sind alle Lebenden außer dir verzaubert, gewinnst du allein.',
      nachtPosition: 80, nurErsteNacht: false, max: 1, gewicht: -3,
      wachAuf: 'Der Flötenspieler erwacht und verzaubert zwei Spieler.',
      schlafEin: 'Der Flötenspieler schläft wieder ein.',
    },
  ];

  const JE_ID = {};
  for (const r of LISTE) JE_ID[r.id] = r;

  /* Rollen, die zwar in der Nacht „gerufen" werden, aber keine eigene Karte
     sind. Sie tauchen als Schritt im Nachtablauf auf. */
  const SCHRITTE_OHNE_KARTE = {
    verliebte: {
      id: 'verliebte', name: 'Die Verliebten', icon: '💞', nachtPosition: 25, nurErsteNacht: true,
      wachAuf: 'Die Verliebten erwachen und erkennen sich.',
      schlafEin: 'Die Verliebten schlafen wieder ein.',
    },
    verzauberte: {
      id: 'verzauberte', name: 'Die Verzauberten', icon: '🎶', nachtPosition: 85, nurErsteNacht: false,
      wachAuf: 'Die Verzauberten erwachen und erkennen sich.',
      schlafEin: 'Die Verzauberten schlafen wieder ein.',
    },
  };

  function rolle(id) { return JE_ID[id] || null; }
  function name(id) { const r = JE_ID[id]; return r ? r.name : id; }
  function istWolf(id) { const r = JE_ID[id]; return !!r && (r.team === 'wolf' || r.team === 'weiss'); }
  function istDorf(id) { const r = JE_ID[id]; return !!r && r.team === 'dorf'; }

  /* Fähigkeiten, die verloren gehen, wenn das Dorf den Alten tötet. */
  const VERLIERT_FAEHIGKEIT = ['seherin', 'hexe', 'jaeger', 'beschuetzer', 'maedchen'];

  /**
   * Empfehlung nach Spielerzahl. Wölfe zuerst, dann die Sonderrollen, Rest
   * Dorfbewohner. Gibt IMMER genau `anzahl` Karten zurück.
   */
  function empfehlung(anzahl) {
    const z = {};
    function setze(id, n) { if (n > 0) z[id] = n; }
    let woelfe;
    const extra = [];
    if (anzahl <= 7) { woelfe = anzahl <= 5 ? 1 : 2; extra.push('seherin', 'hexe'); }
    else if (anzahl <= 11) { woelfe = 2; extra.push('seherin', 'hexe', 'jaeger', 'amor'); }
    else if (anzahl <= 15) { woelfe = 3; extra.push('seherin', 'hexe', 'jaeger', 'amor', 'beschuetzer', 'maedchen'); }
    else { woelfe = 4; extra.push('seherin', 'hexe', 'jaeger', 'amor', 'beschuetzer', 'maedchen', 'alte', 'suendenbock'); }
    setze('werwolf', woelfe);
    let rest = anzahl - woelfe;
    for (const id of extra) { if (rest <= 0) break; setze(id, 1); rest--; }
    setze('dorfbewohner', rest);
    return z;
  }

  /** Summe der Gewichte — grob: > 0 Dorf im Vorteil, < 0 Wölfe im Vorteil. */
  function balance(zusammenstellung) {
    let summe = 0;
    for (const id in zusammenstellung) {
      const r = JE_ID[id];
      if (r) summe += r.gewicht * (zusammenstellung[id] | 0);
    }
    return summe;
  }

  function anzahlKarten(zusammenstellung) {
    let n = 0;
    for (const id in zusammenstellung) n += (zusammenstellung[id] | 0);
    return n;
  }

  /**
   * Prüft eine Zusammenstellung gegen die Spielerzahl. Mit Dieb liegen zwei
   * Karten mehr im Stapel als Spieler am Tisch sitzen.
   */
  function pruefe(anzahlSpieler, zusammenstellung) {
    const fehler = [];
    const warnungen = [];
    const z = zusammenstellung || {};
    for (const id in z) {
      const r = JE_ID[id];
      if (!r) { fehler.push('Unbekannte Rolle: ' + id); continue; }
      if ((z[id] | 0) < 0) fehler.push(r.name + ': negative Anzahl.');
      if ((z[id] | 0) > r.max) fehler.push(r.name + ' darf höchstens ' + r.max + '-mal liegen.');
    }
    const karten = anzahlKarten(z);
    const soll = anzahlSpieler + (z.dieb ? 2 : 0);
    if (karten !== soll) {
      fehler.push('Es liegen ' + karten + ' Karten, gebraucht werden ' + soll + (z.dieb ? ' (Spieler + 2 für den Dieb).' : '.'));
    }
    const woelfe = (z.werwolf | 0) + (z.weisserWerwolf | 0);
    if (woelfe === 0) fehler.push('Ohne Werwolf gibt es kein Spiel.');
    if (anzahlSpieler < 5) fehler.push('Es braucht mindestens 5 Spieler.');
    if (woelfe > 0 && woelfe * 2 >= anzahlSpieler) warnungen.push('So viele Wölfe gewinnen fast sofort.');
    if (z.weisserWerwolf && !z.werwolf) warnungen.push('Der Weiße Werwolf ohne andere Wölfe hat niemanden zu töten.');
    return { ok: fehler.length === 0, fehler: fehler, warnungen: warnungen, karten: karten, soll: soll };
  }

  return {
    LISTE: LISTE,
    SCHRITTE_OHNE_KARTE: SCHRITTE_OHNE_KARTE,
    VERLIERT_FAEHIGKEIT: VERLIERT_FAEHIGKEIT,
    rolle: rolle,
    name: name,
    istWolf: istWolf,
    istDorf: istDorf,
    empfehlung: empfehlung,
    balance: balance,
    anzahlKarten: anzahlKarten,
    pruefe: pruefe,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = rollen;
