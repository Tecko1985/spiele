/* ==========================================================================
   Werwolf — Ablaufsteuerung
   ==========================================================================
   Hält den Zustand des einzelnen Geräts, verteilt auf die Bildschirme und
   hängt die Ereignisse an. Welche Ansicht gilt, wird aus dem Raumzustand
   ABGELEITET, nicht gespeichert — nach einem Neuladen steht das Gerät
   sofort wieder dort, wo die Partie gerade ist.
   ========================================================================== */

/* Bleibt bei 1.0. Neue Funktionen kommen als Block in die Änderungsliste,
   die Versionsnummer wird nicht hochgezählt (Flottenregel). */
const APP_VERSION = '1.0';

const CHANGELOG = [
  {
    version: '1.1',
    groups: [
      {
        title: 'Behoben',
        items: [
          'Heilte die Hexe den Alten, war danach beides weg: ihr Trank und sein Freischuss. Eine einzige Wolfsnacht kostete das Dorf damit seine beiden Einmal-Rettungen, und in der nächsten Nacht reichte derselbe Angriff. Die Hexe konnte dem nicht ausweichen — sie sieht nur den Namen des Opfers, nicht seine Rolle. Jetzt greift der Heiltrank zuerst, so wie es im Ablauf steht, und der Alte behält seinen Freischuss.',
        ],
      },
    ],
  },
  {
    version: '1.0',
    groups: [
      {
        title: 'Worum es geht',
        items: [
          'Werwolf für 5 bis 20 Spieler an eigenen Handys, verbunden über einen sechsstelligen Raum-Code. Die App ersetzt den Spielleiter.',
          'Das Erzähler-Gerät sagt jede Rolle an — auf Wunsch laut per Sprachausgabe. Der Eröffner spielt selbst mit oder legt sein Handy nur als Erzähler in die Mitte.',
          'Der Erzähler stellt im Warteraum die Sitzreihenfolge ein und kann jemanden wieder herausnehmen, der doch nicht mitspielt.',
        ],
      },
      {
        title: 'Rollen',
        items: [
          '13 Rollen: Dorfbewohner, Werwolf, Seherin, Hexe, Jäger, Amor, Beschützer, Dieb, das Mädchen, der Alte, Sündenbock, Weißer Werwolf, Flötenspieler.',
          'Der Erzähler stellt sie selbst zusammen; ein Knopf lädt eine Empfehlung für die vorhandene Spielerzahl, und eine Waage zeigt, ob die Runde zu den Wölfen oder zum Dorf kippt.',
          'Die eigene Rolle erscheint nur, solange der Finger auf der Karte liegt. Wölfe sehen sich gegenseitig, Verliebte erkennen sich.',
        ],
      },
      {
        title: 'Nacht und Tag',
        items: [
          'Nachts ruft die App jede Rolle der Runde einzeln auf — auch die toten, mit derselben Wartezeit. So verrät der Ablauf nicht, wer noch lebt.',
          'Aufgelöst wird erst nach der letzten Rolle: Schutz vor Heiltrank vor Wolfsangriff vor Gift, dann Verliebte und Jäger.',
          'Am Tag: Tote werden verkündet, danach Diskussionsuhr und offene Abstimmung am eigenen Handy. Bei Gleichstand gibt es eine Stichwahl, es stirbt niemand, oder der Sündenbock.',
          'Alle Siegbedingungen und Todesketten (Verliebte, Jäger, der Alte) sind gegen ein Prüfskript mit tausenden Zufallspartien gesichert.',
        ],
      },
      {
        title: 'Was sich einstellen lässt',
        items: [
          'Für die Partie: Diskussionszeit von ohne Uhr bis zehn Minuten, Wartezeit je Nachtaufruf, Verhalten bei Gleichstand und ob die Rollen der Toten aufgedeckt werden.',
          'Für das eigene Gerät: Ansagen vorlesen, Vibration, wenn man dran ist, und ein helles Design für Räume, in denen es nicht dunkel genug ist.',
        ],
      },
      {
        title: 'Übersicht, Chronik und Regeln',
        items: [
          'Der Reiter Übersicht zeigt, wer noch lebt, und führt eine Chronik der Partie.',
          'Die Chronik hält geheime Einträge zurück, solange gespielt wird — wen Amor verkuppelt, wen die Seherin ansieht, wen Beschützer und Hexe wählen, steht erst am Ende darin. Rollen erscheinen nur, wenn Aufdecken eingeschaltet ist.',
          'Der Reiter Regeln erklärt Ablauf, Nachtreihenfolge, alle Rollen, die Siegbedingungen und eine Empfehlung je Spielerzahl — zum Nachschlagen mitten in der Partie.',
          'Ein laufendes Spiel übersteht einen Neustart der App — auch auf dem Erzähler-Gerät.',
        ],
      },
      {
        title: 'Daten und Datenschutz',
        items: [
          'Gespeichert werden nur der selbst gewählte Anzeigename und der Spielstand der laufenden Partie; die Anmeldung ist anonym.',
          'Schließt der Erzähler den Raum, werden Raum, Namen und Spielstand gelöscht. Macht er stattdessen nur den Browser zu, bleibt der Raum stehen — der Info-Bereich sagt das offen.',
          'Die Spieldaten laufen über die Echtzeit-Datenbank von Google (Firebase), Rechenzentrum in Belgien. Wer das nicht möchte, gibt einen Spitznamen statt des echten Namens ein.',
        ],
      },
    ],
  },
];

const app = (function () {
  'use strict';

  let z = null;                 // Zustand aus gameService
  const ui = {
    reiter: 'spiel',
    formular: null,
    spieltMit: true,
    kartenOffen: false,
    rolleGesehen: false,
    auswahl: [],
    hexeHeilen: false,
    hexeGift: null,
    ansage: null,
    schrittSchluessel: null,
  };
  let uhr = null;
  let meldungTimer = null;
  let warDran = false;
  let warJaeger = false;
  let letztePhase = null;
  let gezeigterFehler = null;   // zeit der zuletzt gezeigten Ablehnung aus der privaten Sicht

  const $ = function (id) { return document.getElementById(id); };

  /* ----------------------------------------------------------------------
     Zeichnen
     ---------------------------------------------------------------------- */

  function ansicht() {
    if (!z || !z.code || !z.raum) return 'start';
    if (z.raum.phase === 'lobby') return 'lobby';
    if (z.raum.phase === 'beendet') return 'start';
    if (!z.sicht) return 'warten';
    return z.sicht.phase;   // rollen | nacht | tag | ende
  }

  function zeichne() {
    if (!z) return;
    document.body.classList.toggle('hell', !!sprecher.hole('hell'));
    const a = ansicht();
    document.body.classList.toggle('nacht', a === 'nacht');
    if (!z.code && ui.reiter === 'uebersicht') ui.reiter = 'spiel';

    /* Lokale Auswahl gehört zu genau einem Schritt — wechselt er, ist sie weg. */
    const schluessel = a + ':' + (z.sicht ? z.sicht.nachtNr + ':' + (z.sicht.schritt ? z.sicht.schritt.id : '') + ':' + (z.sicht.tag ? z.sicht.tag.schritt : '') : '');
    if (schluessel !== ui.schrittSchluessel) {
      ui.schrittSchluessel = schluessel;
      ui.auswahl = []; ui.hexeHeilen = false; ui.hexeGift = null;
      if (a !== 'rollen') ui.rolleGesehen = false;
      if (a === 'nacht') ui.kartenOffen = false;
    }
    if (letztePhase !== a) {
      letztePhase = a;
      if (a === 'rollen') sprecher.vibriere([80, 60, 80]);
      if (a === 'ende') sprecher.vibriere([200, 100, 200]);
    }

    /* Vibration, wenn ich gerade dran werde. */
    const dran = !!(z.privat && z.privat.dran && z.privat.lebt && a === 'nacht');
    if (dran && !warDran) sprecher.vibriere([150, 80, 150]);
    warDran = dran;
    const jaeger = !!(z.privat && z.privat.jaeger);
    if (jaeger && !warJaeger) sprecher.vibriere([300]);
    warJaeger = jaeger;
    const stimmt = !!(z.privat && z.privat.stimmeAbgeben);
    if (stimmt && a === 'tag' && z.sicht.tag && !z.sicht.tag.abgestimmt && Object.keys(z.sicht.tag.stimmen || {}).length === 0 && ui.schrittSchluessel !== ui.stimmVibriert) {
      ui.stimmVibriert = ui.schrittSchluessel; sprecher.vibriere([80]);
    }

    $('kopf').innerHTML = bildschirme.kopf(z);
    $('reiter').innerHTML = bildschirme.reiter(z, ui);

    let inhalt = '';
    if (ui.reiter === 'regeln') inhalt = bildschirme.regelnSeite();
    else if (ui.reiter === 'info') inhalt = bildschirme.info(APP_VERSION, CHANGELOG);
    else if (ui.reiter === 'uebersicht') inhalt = bildschirme.uebersicht(z);
    else {
      switch (a) {
        case 'start': inhalt = bildschirme.start(z, ui); break;
        case 'lobby': inhalt = bildschirme.lobby(z, ui); break;
        case 'warten': inhalt = '<p class="leise mitte">Die Partie startet …</p>'; break;
        case 'rollen': inhalt = bildschirme.rollenPhase(z, ui); break;
        case 'nacht': inhalt = bildschirme.nacht(z, ui); break;
        case 'tag': inhalt = bildschirme.tag(z, ui); break;
        case 'ende': inhalt = bildschirme.ende(z); break;
      }
    }
    $('inhalt').innerHTML = inhalt;

    const leiste = bildschirme.erzaehlerLeiste(z, ui);
    $('erzaehler').innerHTML = leiste;
    $('erzaehler').className = leiste ? 'erzaehler' : '';
    $('inhalt').className = leiste ? 'mit-leiste' : '';

    if (z.fehler) zeigeMeldung(z.fehler);
    /* Der Erzähler hat eine meiner Aktionen abgelehnt — sonst hinge mein Schritt stumm. */
    const ab = z.privat && z.privat.letzterFehler;
    if (ab && ab.zeit !== gezeigterFehler) { gezeigterFehler = ab.zeit; zeigeMeldung(ab.text); }

    /* Sekundentakt nur, wenn eine Uhr läuft. */
    const brauchtUhr = z.istHost && (a === 'nacht' || a === 'tag') || (a === 'tag' && z.sicht.tag && z.sicht.tag.schritt === 'diskussion');
    if (brauchtUhr && !uhr) uhr = setInterval(function () { z = gameService.getZustand(); zeichne(); }, 1000);
    if (!brauchtUhr && uhr) { clearInterval(uhr); uhr = null; }

    if (z.istHost && z.raum && z.raum.phase === 'laeuft') { window.__wachHalten = true; sprecher.halteWach(); }
  }

  function zeigeMeldung(text) {
    const m = $('meldung');
    m.textContent = text;
    m.className = 'meldung';
    m.hidden = false;
    clearTimeout(meldungTimer);
    meldungTimer = setTimeout(function () { m.hidden = true; }, 4000);
  }

  /* ----------------------------------------------------------------------
     Aktionen
     ---------------------------------------------------------------------- */

  function sende(aktion) {
    return gameService.sendeAktion(aktion).catch(function (f) { zeigeMeldung(f.message); });
  }

  function toggleAuswahl(uid, max) {
    const i = ui.auswahl.indexOf(uid);
    if (i >= 0) ui.auswahl.splice(i, 1);
    else {
      if (max === 1) ui.auswahl = [uid];
      else if (ui.auswahl.length < max) ui.auswahl.push(uid);
    }
    sprecher.vibriere(30);
  }

  const AKTIONEN = {
    reiter: function (d) { ui.reiter = d.reiter; },
    formular: function (d) { ui.formular = d.formular || null; },
    fortsetzen: function () {
      gameService.betreteRaum(z.gemerkterCode, z.gemerkterName).catch(function (f) { zeigeMeldung(f.message); });
    },
    raumErstellen: function () {
      const name = ($('name') || {}).value || '';
      const mit = $('spieltMit') ? $('spieltMit').checked : true;
      ui.spieltMit = mit;
      gameService.erstelleRaum(name, mit, {}).then(function () { ui.formular = null; ui.reiter = 'spiel'; })
        .catch(function (f) { zeigeMeldung(f.message); });
    },
    raumBeitreten: function () {
      const code = ($('code') || {}).value || '';
      const name = ($('name') || {}).value || '';
      gameService.betreteRaum(code, name).then(function () { ui.formular = null; ui.reiter = 'spiel'; })
        .catch(function (f) { zeigeMeldung(f.message); });
    },
    verlassen: function () {
      const frage = z.istHost ? 'Raum für alle schließen?' : 'Raum verlassen?';
      if (!window.confirm(frage)) return;
      ui.reiter = 'spiel';
      gameService.verlasse();
    },

    /* Lobby */
    rollePlus: function (d) { const zus = Object.assign({}, z.raum.zusammenstellung || {}); zus[d.rolle] = (zus[d.rolle] | 0) + 1; gameService.setzeZusammenstellung(zus); },
    rolleMinus: function (d) { const zus = Object.assign({}, z.raum.zusammenstellung || {}); zus[d.rolle] = Math.max(0, (zus[d.rolle] | 0) - 1); if (!zus[d.rolle]) delete zus[d.rolle]; gameService.setzeZusammenstellung(zus); },
    empfehlung: function () { gameService.setzeZusammenstellung(rollen.empfehlung(z.spielerListe.length)); },
    spielerHoch: function (d) { gameService.verschiebeSpieler(d.uid, -1); },
    spielerRunter: function (d) { gameService.verschiebeSpieler(d.uid, 1); },
    spielerRaus: function (d) { if (window.confirm('Spieler entfernen?')) gameService.entferneSpieler(d.uid); },
    starten: function () { gameService.starteRaum().catch(function (f) { zeigeMeldung(f.message); }); },

    /* Rollen */
    rolleGesehen: function () { ui.rolleGesehen = true; ui.kartenOffen = false; sende({ art: 'rolleGesehen' }); },
    nachtBeginnen: function (d) {
      if (d.erzwingen && !window.confirm('Nicht alle haben ihre Rolle bestätigt. Trotzdem beginnen?')) return;
      gameService.nachtBeginnen();
    },

    /* Nacht */
    auswahl: function (d) {
      const a = z.privat && z.privat.aufgabe;
      const max = a && (a.schritt === 'amor' || a.schritt === 'floetenspieler') ? (a.anzahl || 2) : 1;
      toggleAuswahl(d.uid, max);
    },
    diebKarte: function (d) { sende({ art: 'nacht', karte: d.idx | 0 }); },
    diebBehalten: function () { sende({ art: 'nacht', karte: null }); },
    amorBestaetigen: function () { if (ui.auswahl.length === 2) sende({ art: 'nacht', ziele: ui.auswahl.slice() }); },
    floeteBestaetigen: function () { sende({ art: 'nacht', ziele: ui.auswahl.slice() }); },
    einzelBestaetigen: function () { if (ui.auswahl.length === 1) sende({ art: 'nacht', ziel: ui.auswahl[0] }); },
    einzelLeer: function () { sende({ art: 'nacht', ziel: null }); },
    wolfStimme: function (d) { sprecher.vibriere(30); sende({ art: 'nacht', ziel: d.uid }); },
    hexeGift: function (d) { ui.hexeGift = ui.hexeGift === d.uid ? null : d.uid; sprecher.vibriere(30); },
    hexeBestaetigen: function () { sende({ art: 'nacht', heilen: ui.hexeHeilen, gift: ui.hexeGift }); },
    seherinFertig: function () { sende({ art: 'nacht', bestaetigt: true }); },
    ueberspringen: function () { if (window.confirm('Schritt ohne Eingabe beenden?')) gameService.schrittErzwingen(); },

    /* Tag */
    weiter: function () { gameService.tagWeiter(); },
    stimme: function (d) {
      const meine = z.privat && z.privat.meineStimme;
      sprecher.vibriere(30);
      sende({ art: 'stimme', ziel: meine === d.uid ? null : d.uid });
    },
    jaegerSchuss: function () { if (ui.auswahl.length === 1 && window.confirm('Wirklich schießen?')) sende({ art: 'jaeger', ziel: ui.auswahl[0] }); },
    jaegerUeberspringen: function () { if (window.confirm('Jäger ohne Schuss übergehen?')) gameService.jaegerUeberspringen(); },
    toeten: function (d) { if (window.confirm(d.name + ' aus dem Spiel nehmen? Das lässt sich nicht rückgängig machen.')) gameService.toeteManuell(d.uid); },

    /* Ende */
    neueRunde: function () { if (window.confirm('Neue Runde mit denselben Spielern?')) { ui.reiter = 'spiel'; gameService.neueRunde(); } },
  };

  function aktion(name, daten) {
    const fn = AKTIONEN[name];
    if (!fn) return;
    sprecher.entsperre();
    fn(daten || {});
    zeichne();
  }

  /* ----------------------------------------------------------------------
     Ereignisse
     ---------------------------------------------------------------------- */

  function verdrahte() {
    const wurzel = $('app');

    wurzel.addEventListener('click', function (e) {
      const el = e.target.closest('[data-aktion]');
      if (!el || el.disabled) return;
      e.preventDefault();
      aktion(el.dataset.aktion, el.dataset);
    });

    wurzel.addEventListener('change', function (e) {
      const el = e.target;
      if (el.dataset.einstellung) {
        sprecher.setze(el.dataset.einstellung, !!el.checked);
        zeichne();
        return;
      }
      if (el.dataset.einstellungRaum && z && z.raum) {
        const e2 = Object.assign({}, z.raum.einstellungen || {});
        const k = el.dataset.einstellungRaum;
        e2[k] = el.type === 'checkbox' ? el.checked : (isNaN(Number(el.value)) ? el.value : Number(el.value));
        gameService.setzeEinstellungen(e2);
        return;
      }
      if (el.dataset.aktionChange === 'hexeHeilen') { ui.hexeHeilen = !!el.checked; zeichne(); }
    });

    /* Halten zum Sehen — Zeiger statt Klick, damit Loslassen wieder verdeckt. */
    function karteAuf(e) {
      const k = e.target.closest('#rollenkarte');
      if (!k) return;
      e.preventDefault();
      sprecher.entsperre();
      if (!ui.kartenOffen) { ui.kartenOffen = true; sprecher.vibriere(40); zeichne(); }
    }
    function karteZu() {
      if (ui.kartenOffen) { ui.kartenOffen = false; zeichne(); }
    }
    wurzel.addEventListener('pointerdown', karteAuf);
    wurzel.addEventListener('pointerup', karteZu);
    wurzel.addEventListener('pointercancel', karteZu);
    window.addEventListener('blur', karteZu);
    wurzel.addEventListener('contextmenu', function (e) { if (e.target.closest('#rollenkarte')) e.preventDefault(); });

    /* Eingabe mit Enter abschicken. */
    wurzel.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'name' || e.target.id === 'code') {
        e.preventDefault();
        aktion(ui.formular === 'neu' ? 'raumErstellen' : 'raumBeitreten');
      }
    });
  }

  /* ----------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */

  function start() {
    verdrahte();
    gameService.onAnsage(function (text) {
      ui.ansage = text;
      sprecher.sprich(text);
      zeichne();
    });
    gameService.onZustandsAenderung(function (neu) {
      z = neu;
      zeichne();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return { APP_VERSION: APP_VERSION, zeichne: zeichne, ui: ui, zustand: function () { return z; } };
})();
