/* ==========================================================================
   Viertelmeile — Ablaufsteuerung
   ==========================================================================
   Hält den Zustand des einzelnen Geräts, verteilt auf die Bildschirme und
   startet das Rennbild. Welche Ansicht gilt, wird aus dem Raumzustand
   ABGELEITET, nicht gespeichert — nach einem Neuladen steht das Gerät
   sofort wieder dort, wo das Turnier gerade ist.
   ========================================================================== */

/* Bleibt bei 1.0. Neue Funktionen kommen als Block in die Änderungsliste,
   die Versionsnummer wird nicht hochgezählt (Flottenregel). */
const APP_VERSION = '1.0';

/* Was das Spiel kann — die Karte „Funktionen" im Info-Reiter. Hier steht der
   Zustand, nicht die Änderung: keine Versionsnummern, kein „neu", kein
   „jetzt". CHANGELOG darunter bleibt gepflegt, angezeigt wird es nicht. */
const FUNKTIONEN = [
  {
    title: 'Was hier gefahren wird',
    items: [
      'Ein Drag Race über die Viertelmeile für 2 bis 20 Fahrer an eigenen Handys, verbunden über einen sechsstelligen Raum-Code.',
      'Gefahren wird immer einer gegen einen, beide gleichzeitig — das gegnerische Auto fährt neben dir.',
      'Ein Rennen dauert rund zehn Sekunden. Mehrere Paare fahren gleichzeitig, es sitzt also niemand herum.',
      'Das Gerät des Gastgebers ist Schiedsrichter und führt Tabelle und Turnierbaum. Er fährt selbst mit oder legt sein Handy nur daneben.',
    ],
  },
  {
    title: 'Die vier Dinge, die man können muss',
    items: [
      'Burnout: vor der Ampel den rechten Daumen halten und im grünen Bereich loslassen — dann greifen die Reifen beim Start.',
      'Start: drei gelbe Lichter im festen Takt, dann grün. Die Reaktionszeit zählt voll zur Endzeit; wer vor Grün tippt, hat verloren.',
      'Schalten: den grünen Bereich am Tacho treffen. Er wird mit jedem Gang schmaler, ein ganz knapper Treffer gibt einen kleinen Schub.',
      'Spur halten: zwei- bis viermal je Rennen bricht das Auto aus, ein Pfeil warnt vorher. Wer gar nicht gegenhält, berührt die Linie und verliert.',
    ],
  },
  {
    title: 'Fair für alle',
    items: [
      'Beide Fahrer eines Rennens fahren dasselbe Auto — welches, das wechselt von Runde zu Runde. Die Lackierung ist frei und ändert nichts.',
      'Beide bekommen dieselben Ausbrecher zur selben Zeit. Niemand verliert durch Pech.',
      'Gerechnet wird in festen Schritten, unabhängig davon, wie flüssig ein Handy zeichnet. Ein schnelleres Gerät hat keinen Vorteil.',
      'Jeder Tipper wird mit seinem eigenen Zeitstempel verrechnet, nicht erst beim nächsten Bild.',
    ],
  },
  {
    title: 'Turnierformen',
    items: [
      'Liga bis 10 Fahrer: jeder gegen jeden, einmal. Sieger ist, wer die meisten Rennen gewinnt; bei Gleichstand die beste Zeit.',
      'Liga ab 11 Fahrern: sieben Runden, gepaart nach Tabellenstand — sonst dauert es zu lang.',
      'K.-o.: wer verliert, ist raus. Passt die Zahl nicht, gibt es eine Vorrunde. Ab dem Halbfinale gewinnt, wer zwei von drei Läufen holt.',
      'Sind es ungerade viele, springt in der Liga ein Bot ein — leicht, mittel oder schwer, der Gastgeber stellt es ein.',
    ],
  },
  {
    title: 'Vor und neben dem Turnier',
    items: [
      'Übungslauf: alle fahren gleichzeitig allein gegen die Uhr, damit jeder einmal reingekommen ist. Zählt für nichts.',
      'Allein üben geht auch ohne Raum, gegen den Bot.',
      'Nach jedem Rennen steht da, wo die Zeit hingegangen ist: Reaktion, Burnout, Schaltnoten, Spurverlust und Spitzengeschwindigkeit.',
      'Der Reiter „Anleitung" erklärt alles zum Nachschlagen mitten im Turnier.',
    ],
  },
  {
    title: 'Grenzen',
    items: [
      'Es gibt kein Konto und keine Bestenliste; Ergebnisse werden nicht aufgehoben.',
      'Zuschauen geht nicht — wer gerade nicht fährt, sieht nur das Ergebnis.',
      'Wird die App mitten im Rennen weggedrückt, gilt das Rennen als verloren. Der Gastgeber kann eine Runde wiederholen lassen.',
      'Vor jedem Start wird geprüft, ob alle Fahrer bereit sind; fehlt jemand, wartet das Rennen.',
      'Die Spieldaten laufen über die Echtzeit-Datenbank von Google (Firebase), Rechenzentrum in Belgien.',
    ],
  },
];

const CHANGELOG = [
  {
    version: '1.0',
    groups: [
      {
        title: 'Worum es geht',
        items: [
          'Drag Race über die Viertelmeile für 2 bis 20 Fahrer an eigenen Handys, quer gehalten. Immer einer gegen einen, beide gleichzeitig.',
          'Vier Fertigkeiten in zehn Sekunden: Burnout, Reaktion an der Ampel, Schalten am grünen Bereich und Gegenhalten, wenn das Auto ausbricht.',
          'Das Gerät des Gastgebers ist Schiedsrichter — wie in den anderen Spielen des Hubs.',
        ],
      },
      {
        title: 'Turnier',
        items: [
          'Zwei Formen zur Wahl: Liga (jeder gegen jeden bis 10 Fahrer, darüber sieben Runden nach Tabellenstand) und K.-o. mit Vorrunde und drei Läufen ab dem Halbfinale.',
          'Bei ungerader Zahl springt ein Bot in drei Stärken ein; er wird auf dem Gerät seines menschlichen Gegners gerechnet.',
          'Übungslauf für alle vor dem Start, und „Allein üben" ganz ohne Raum.',
        ],
      },
      {
        title: 'Fairness',
        items: [
          'Beide fahren dasselbe Auto, bekommen dieselben Ausbrecher zur selben Zeit und starten auf derselben Serveruhr.',
          'Fester Rechentakt und Tipper mit eigenem Zeitstempel: die Bildrate des Handys ändert die Zeit nicht.',
          'Zwei Prüfstände sichern das ab — pflege/pruefe-fahrt.js für die Fahrphysik, pflege/pruefe-turnier.js für Paarungen und Tabelle.',
        ],
      },
    ],
  },
];

const app = (function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  const ui = {
    reiter: 'spiel',
    formular: null,
    spieltMit: true,
    uebAuto: 'muscle',
    uebStufe: 'mittel',
    uebBurnout: true,
    alleinErgebnis: null,
    alleinGegner: null,
    imRennen: false,
    gefahren: {},          // Rundenschlüssel -> true, damit kein Rennen doppelt startet
  };

  let z = null;
  let meldungTimer = null;
  let uhr = null;
  let letzterZustand = '';

  /* ----------------------------------------------------------------------
     Zeichnen
     ---------------------------------------------------------------------- */

  function zeichne() {
    z = gameService.getZustand();
    const raum = z.raum;
    const sicht = z.sicht;

    /* Läuft gerade ein Rennen auf diesem Gerät? Dann bleibt die Zeichenfläche
       stehen und der Rest wird gar nicht angefasst. */
    if (ui.imRennen) { pruefeQuerformat(); return; }

    let ansicht = 'start';
    if (raum) {
      if (raum.phase === 'lobby' || raum.phase === 'uebung') ansicht = 'lobby';
      else if (raum.phase === 'beendet') ansicht = 'ende';
      else if (sicht && sicht.zustand === 'wartet') ansicht = 'warten';
      else if (sicht && sicht.zustand === 'ende') ansicht = 'ende';
      else ansicht = 'ergebnis';
    }
    if (ui.alleinErgebnis) ansicht = 'allein';

    if (letzterZustand !== ansicht) {
      letzterZustand = ansicht;
      if (ansicht !== 'lobby' && ui.reiter === 'stand' && !raum) ui.reiter = 'spiel';
    }

    $('kopf').innerHTML = bildschirme.kopf(z);
    $('reiter').innerHTML = bildschirme.reiter(z, ui);

    let inhalt = '';
    if (ui.reiter === 'hilfe') inhalt = bildschirme.hilfe();
    else if (ui.reiter === 'info') inhalt = bildschirme.info(FUNKTIONEN);
    else if (ui.reiter === 'stand') inhalt = bildschirme.stand(z);
    else {
      switch (ansicht) {
        case 'start': inhalt = bildschirme.start(z, ui); break;
        case 'allein': inhalt = bildschirme.alleinErgebnis(ui); break;
        case 'lobby': inhalt = bildschirme.lobby(z, ui); break;
        case 'warten': inhalt = bildschirme.warten(z); break;
        case 'ergebnis': inhalt = bildschirme.ergebnis(z, ui); break;
        case 'ende': inhalt = bildschirme.ende(z); break;
      }
    }
    $('inhalt').innerHTML = inhalt;

    if (z.fehler) zeigeMeldung(z.fehler);

    /* Der Gastgeber muss wach bleiben — er ist der Schiedsrichter. */
    if (z.istHost && raum && raum.phase !== 'beendet') { window.__wachHalten = true; ton.halteWach(); }

    pruefeRennstart();
    pruefeQuerformat();
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
     Querformat
     ---------------------------------------------------------------------- */

  function pruefeQuerformat() {
    const noetig = ui.imRennen;
    const quer = window.innerWidth > window.innerHeight;
    $('drehen').hidden = !(noetig && !quer);
  }

  /* ----------------------------------------------------------------------
     Rennen starten
     ---------------------------------------------------------------------- */

  function pruefeRennstart() {
    if (ui.imRennen) return;
    const sicht = z.sicht;
    if (!sicht || sicht.zustand !== 'rennen' || !sicht.schluessel) return;
    const pa = z.meinePaarung;
    if (!pa) return;
    if (ui.gefahren[sicht.schluessel]) return;
    /* Zu spät dazugekommen (Neuladen mitten im Rennen)? Dann nicht mehr
       einsteigen — das Ergebnis wäre ohnehin wertlos. */
    if (gameService.serverJetzt() > sicht.gruenZeit + 1500) { ui.gefahren[sicht.schluessel] = true; return; }

    ui.gefahren[sicht.schluessel] = true;
    const ichBinA = pa.a === z.uid;
    const gegnerUid = ichBinA ? pa.b : pa.a;

    let gegner = null;
    if (pa.alleine) gegner = null;
    else if (pa.bot) gegner = { art: 'bot', stufe: pa.bot, botSaat: pa.botSaat };
    else { gegner = { art: 'fern' }; }

    if (!pa.alleine && !pa.bot) {
      gameService.horcheGegner(sicht.schluessel, gegnerUid, function (d) { rennen.setzeGegner(d); });
    } else {
      gameService.horcheGegner(sicht.schluessel, null, null);
    }

    starteRennbild({
      auto: autos.nachId(sicht.autoId),
      saat: pa.saat,
      burnout: sicht.burnout !== false,
      gruenZeit: sicht.gruenZeit,
      meinName: z.namen[z.uid] || 'Du',
      meinLack: z.lacke[z.uid] || ton.hole('lack'),
      gegnerName: pa.alleine ? 'die Uhr' : bildschirme.nameVon(z, gegnerUid),
      gegnerLack: pa.alleine ? 'weiss' : (gegnerUid && z.lacke[gegnerUid] ? z.lacke[gegnerUid] : 'weiss'),
      gegner: gegner,
      jetzt: gameService.serverJetzt,
      aufPosition: pa.alleine || pa.bot ? null : function (d) { gameService.meldePosition(d); },
      fertig: function (ergebnis, gegnerErgebnis) {
        beendeRennbild();
        gameService.loeseGegner();
        gameService.meldeErgebnis(ergebnis, gegnerErgebnis).catch(function () { /* Netz weg */ });
        zeichne();
      },
    });
  }

  function starteRennbild(opt) {
    ui.imRennen = true;
    $('app').hidden = true;
    $('rennflaeche').hidden = false;
    window.__wachHalten = true;
    ton.halteWach();
    opt.canvas = $('leinwand');
    pruefeQuerformat();
    /* Die Zeichenfläche braucht ihre Maße, bevor gezeichnet wird. */
    requestAnimationFrame(function () { rennen.starte(opt); });
  }

  function beendeRennbild() {
    rennen.stopp();
    ui.imRennen = false;
    $('rennflaeche').hidden = true;
    $('app').hidden = false;
    $('drehen').hidden = true;
  }

  /* ----------------------------------------------------------------------
     Allein üben
     ---------------------------------------------------------------------- */

  function alleinFahren() {
    const auto = autos.nachId(($('uebAuto') || {}).value || ui.uebAuto);
    const stufe = ($('uebStufe') || {}).value || ui.uebStufe;
    const burnout = $('uebBurnout') ? $('uebBurnout').checked : ui.uebBurnout;
    ui.uebAuto = auto.id; ui.uebStufe = stufe; ui.uebBurnout = burnout;
    ui.alleinErgebnis = null; ui.alleinGegner = null;

    const saat = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    starteRennbild({
      auto: auto,
      saat: saat,
      burnout: burnout,
      gruenZeit: Date.now() + rennen.vorlaufMs(burnout) + 600,
      meinName: ton.hole('name') || 'Du',
      meinLack: ton.hole('lack') || 'rot',
      gegnerName: '🤖 Bot',
      gegnerLack: 'weiss',
      gegner: { art: 'bot', stufe: stufe, botSaat: (saat ^ 0x5bf03635) >>> 0 },
      jetzt: function () { return Date.now(); },
      aufPosition: null,
      fertig: function (ergebnis, gegnerErgebnis) {
        beendeRennbild();
        ui.alleinErgebnis = ergebnis;
        ui.alleinGegner = gegnerErgebnis;
        ui.formular = 'allein';
        zeichne();
      },
    });
  }

  /* ----------------------------------------------------------------------
     Aktionen
     ---------------------------------------------------------------------- */

  const AKTIONEN = {
    reiter: function (d) { ui.reiter = d.reiter; },
    formular: function (d) { ui.formular = d.formular || null; ui.alleinErgebnis = null; },
    lack: function (d) { gameService.setzeLack(d.lack); },

    fortsetzen: function () {
      gameService.betreteRaum(z.gemerkterCode, z.gemerkterName).catch(function (f) { zeigeMeldung(f.message); });
    },
    raumErstellen: function () {
      const name = ($('name') || {}).value || '';
      const mit = $('spieltMit') ? $('spieltMit').checked : true;
      ui.spieltMit = mit;
      gameService.erstelleRaum(name, mit, {}).then(function () { ui.formular = null; ui.reiter = 'spiel'; zeichne(); })
        .catch(function (f) { zeigeMeldung(f.message); });
    },
    raumBeitreten: function () {
      const code = ($('code') || {}).value || '';
      const name = ($('name') || {}).value || '';
      gameService.betreteRaum(code, name).then(function () { ui.formular = null; ui.reiter = 'spiel'; zeichne(); })
        .catch(function (f) { zeigeMeldung(f.message); });
    },
    alleinStarten: function () { alleinFahren(); },

    spielerRaus: function (d) { if (window.confirm('Fahrer entfernen?')) gameService.entferneSpieler(d.uid); },
    uebung: function () { gameService.starteUebung().catch(function (f) { zeigeMeldung(f.message); }); },
    starten: function () { gameService.starteTurnier().catch(function (f) { zeigeMeldung(f.message); }); },
    weiter: function () { gameService.weiter().catch(function (f) { zeigeMeldung(f.message); }); },
    wiederholen: function () {
      if (!window.confirm('Diese Runde noch einmal fahren? Die Ergebnisse werden verworfen.')) return;
      ui.gefahren = {};
      gameService.wiederhole().catch(function (f) { zeigeMeldung(f.message); });
    },
    nochmal: function () {
      if (!window.confirm('Neues Turnier mit denselben Leuten?')) return;
      ui.gefahren = {};
      ui.reiter = 'spiel';
      gameService.nochmal().catch(function (f) { zeigeMeldung(f.message); });
    },
    verlassen: function () {
      const frage = z.istHost ? 'Raum für alle schließen? Tabelle und Zeiten sind danach weg.' : 'Raum verlassen?';
      if (!window.confirm(frage)) return;
      ui.reiter = 'spiel';
      ui.gefahren = {};
      gameService.verlasse();
    },
  };

  function aktion(name, daten) {
    const fn = AKTIONEN[name];
    if (!fn) return;
    ton.entsperre();
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
      if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;   // die laufen über change
      e.preventDefault();
      aktion(el.dataset.aktion, el.dataset);
    });

    wurzel.addEventListener('change', function (e) {
      const el = e.target;
      if (el.dataset.einstellung) { ton.setze(el.dataset.einstellung, !!el.checked); zeichne(); return; }
      if (el.dataset.aktion === 'form') {
        const alt = gameService.normiereEinstellungen(z.raum.einstellungen);
        gameService.setzeEinstellungen(Object.assign({}, alt, { form: el.value }));
        return;
      }
      if (el.dataset.aktion === 'burnout') {
        const alt = gameService.normiereEinstellungen(z.raum.einstellungen);
        gameService.setzeEinstellungen(Object.assign({}, alt, { burnout: !!el.checked }));
        return;
      }
      if (el.dataset.aktion === 'botStufe') {
        const alt = gameService.normiereEinstellungen(z.raum.einstellungen);
        gameService.setzeEinstellungen(Object.assign({}, alt, { botStufe: el.value }));
        return;
      }
    });

    window.addEventListener('resize', pruefeQuerformat);
    window.addEventListener('orientationchange', pruefeQuerformat);

    /* Sekundentakt, solange auf einen Start gewartet wird — sonst hinge der
       Countdown, bis Firebase von sich aus etwas schickt. */
    uhr = setInterval(function () {
      if (ui.imRennen) return;
      if (z && z.sicht && (z.sicht.zustand === 'rennen' || z.sicht.zustand === 'wartet')) zeichne();
    }, 700);
  }

  function start() {
    gameService.setzeMelder(zeichne);
    verdrahte();
    gameService.bereit.then(function () {
      zeichne();
      const code = gameService.getZustand().gemerkterCode;
      if (code) {
        /* Nach einem Neuladen automatisch zurück in den Raum. */
        gameService.betreteRaum(code, '').then(zeichne).catch(function () { zeichne(); });
      }
    }).catch(function () { zeichne(); });
  }

  return { start: start, ui: ui };
})();

app.start();
