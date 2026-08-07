/* ==========================================================================
   Depot-Duell — alle Ansichten
   ==========================================================================

   Unmittelbarer Modus: jede Funktion liest den Zustand und beschreibt daraus
   das ganze Bild. Es gibt kein "aktualisieren" — genau dort sitzen in
   DOM-Oberflächen die meisten Fehler (Beschriftung gesetzt, Knopf aber nicht
   gesperrt und dergleichen).

   Rot und Grün stehen NIE allein für eine Information. Jede Kursangabe trägt
   zusätzlich ein Vorzeichen und einen Pfeil, damit sie auch bei
   Farbfehlsichtigkeit lesbar bleibt.
   ========================================================================== */

const bildschirme = (function () {
  'use strict';

  const F = ui.F;

  const GRUEN = '#057a55';
  const ROT = '#dc2626';

  /* ----------------------------------------------------------------------
     Formatierung
     ---------------------------------------------------------------------- */

  function euro(betrag, stellen) {
    const s = stellen === undefined ? 2 : stellen;
    return betrag.toLocaleString('de-DE', { minimumFractionDigits: s, maximumFractionDigits: s }) + ' €';
  }

  function kompakt(betrag) {
    const a = Math.abs(betrag);
    if (a >= 1e12) return (betrag / 1e12).toFixed(1).replace('.', ',') + ' Bio €';
    if (a >= 1e9) return (betrag / 1e9).toFixed(1).replace('.', ',') + ' Mrd €';
    if (a >= 1e6) return (betrag / 1e6).toFixed(1).replace('.', ',') + ' Mio €';
    return euro(betrag, 0);
  }

  /* Vorzeichen und Pfeil gehören dazu — die Farbe allein trägt die
     Information nicht. */
  function prozent(wert, stellen) {
    const s = stellen === undefined ? 2 : stellen;
    const pfeil = wert > 0.005 ? '▲' : wert < -0.005 ? '▼' : '•';
    const vor = wert > 0 ? '+' : '';
    return pfeil + ' ' + vor + wert.toFixed(s).replace('.', ',') + ' %';
  }

  function farbeFuer(wert) {
    if (wert > 0.005) return GRUEN;
    if (wert < -0.005) return ROT;
    return F.gedaempft;
  }

  function stueckText(wert, stueck) {
    if (wert.art === 'krypto') {
      return stueck.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 8 });
    }
    return String(Math.round(stueck));
  }

  function kursText(kurs) {
    if (kurs >= 100) return euro(kurs, 2);
    if (kurs >= 1) return euro(kurs, 2);
    return euro(kurs, 4);
  }

  function zeitText(sekunden) {
    const m = Math.floor(sekunden / 60);
    const s = sekunden % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ----------------------------------------------------------------------
     Kopfzeile
     ---------------------------------------------------------------------- */

  function kopfzeile(app) {
    const z = app.zustand;
    const k = ui.oben();
    const r = ui.reserviere(64, { abstand: 8 });

    ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS, F.primaer);

    const laeuft = z.raum && z.raum.phase === 'laeuft';
    if (laeuft) {
      const stand = app.eigenerStand();
      ui.schreibe(euro(stand.gesamt, 0), r.x + 16, r.y + 24, {
        groesse: 22, fett: true, farbe: F.weiss,
      });
      ui.schreibe(prozent(stand.rendite, 1), r.x + 16, r.y + 47, {
        groesse: 14, fett: 'halb',
        farbe: stand.rendite >= 0 ? '#a7f3d0' : '#fecaca',
      });

      /* Fortschritt und Restzeit rechts. */
      const jahr = markt.spieljahr(app.tick());
      ui.schreibe('Jahr ' + (Math.floor(jahr) + 1) + ' von ' + markt.JAHRE, r.x + r.b - 16, r.y + 22, {
        groesse: 13, farbe: 'rgba(255,255,255,0.8)', ausrichtung: 'right',
      });
      ui.schreibe('noch ' + zeitText(z.restSekunden), r.x + r.b - 16, r.y + 44, {
        groesse: 15, fett: true, farbe: F.weiss, ausrichtung: 'right',
      });

      const anteil = app.tick() / markt.TICKS;
      ui.fuelleRund(r.x + 12, r.y + r.h - 9, r.b - 24, 4, 2, 'rgba(255,255,255,0.25)');
      if (anteil > 0) ui.fuelleRund(r.x + 12, r.y + r.h - 9, Math.max(4, (r.b - 24) * anteil), 4, 2, F.weiss);
    } else {
      ui.schreibe('📈 Depot-Duell', r.x + 16, r.y + r.h / 2, { groesse: 21, fett: true, farbe: F.weiss });
      if (z.code) {
        ui.schreibe('Raum ' + z.code, r.x + r.b - 16, r.y + r.h / 2, {
          groesse: 15, fett: 'halb', farbe: 'rgba(255,255,255,0.85)', ausrichtung: 'right',
        });
      }
    }
  }

  /* ----------------------------------------------------------------------
     Reiter
     ---------------------------------------------------------------------- */

  function reiter(app, eintraege) {
    const r = ui.reserviere(42, { abstand: 10 });
    const breite = r.b / eintraege.length;
    ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS_KLEIN + 2, F.karte);

    for (let i = 0; i < eintraege.length; i++) {
      const e = eintraege[i];
      const feld = { x: r.x + breite * i, y: r.y, b: breite, h: r.h };
      const aktiv = app.reiter === e.id;
      if (aktiv) ui.fuelleRund(feld.x + 3, feld.y + 3, feld.b - 6, feld.h - 6, ui.RADIUS_KLEIN, F.primaer);
      ui.schreibe(e.text, feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 14, fett: aktiv ? true : 'halb',
        farbe: aktiv ? F.weiss : F.gedaempft, ausrichtung: 'center',
      });
      /* Von Hand gezeichnete Klickfläche muss eingetragen werden, sonst ist
         sie für einen Test nur über feste Pixelkoordinaten erreichbar. */
      ui.merke('reiter-' + e.id, feld, 'reiter');
      if (ui.geklickt(feld)) { app.reiter = e.id; app.detailId = null; }
    }
  }

  /* ======================================================================
     1. START
     ====================================================================== */

  function start(app) {
    ui.beginneSeite();
    kopfzeile(app);

    ui.seite('start', function () {
      ui.titel('Wer bist du?', { zentriert: true, abstand: 6 });
      ui.absatz('Der Name steht in der Rangliste und in der Bestenliste.', {
        zentriert: true, abstand: 14,
      });

      const name = ui.eingabe('eing-name', {
        platzhalter: 'Dein Name', maxLaenge: 20, abstand: 16, setze: app.name,
      });
      app.name = name;

      const bereit = name.trim().length >= 2;

      if (ui.knopf('btn-raum-erstellen', 'Neuen Raum eröffnen', { aus: !bereit, abstand: 10 })) {
        app.merkeName();
        app.ansicht = 'lobby-neu';
      }
      if (ui.knopf('btn-raum-beitreten', 'Mit Code beitreten', {
        art: 'zweit', aus: !bereit, abstand: 10,
      })) {
        app.merkeName();
        app.ansicht = 'beitreten';
      }
      if (ui.knopf('btn-solo', 'Allein gegen die KI üben', {
        art: 'zweit', aus: !bereit, abstand: 16,
      })) {
        app.merkeName();
        app.starteSolo();
      }

      ui.trenner('', { abstand: 12 });
      if (ui.knopf('btn-bestenliste', '🏆 Bestenliste', { art: 'link', abstand: 4 })) {
        app.ladeBestenliste();
        app.ansicht = 'bestenliste';
      }
      if (ui.knopf('btn-info', 'ℹ️ Wie es funktioniert', { art: 'link' })) app.ansicht = 'info';
    });
  }

  function beitreten(app) {
    ui.beginneSeite();
    kopfzeile(app);

    ui.seite('beitreten', function () {
      ui.titel('Raum-Code eingeben', { zentriert: true, abstand: 6 });
      ui.absatz('Sechs Zeichen — lass sie dir vorlesen.', { zentriert: true, abstand: 14 });

      const code = ui.eingabe('eing-code', {
        platzhalter: 'z. B. K7PQ2M', maxLaenge: 6, abstand: 8, grossschrift: true,
      });

      if (app.fehler) {
        ui.absatz(app.fehler, { farbe: ROT, zentriert: true, abstand: 10, fett: 'halb' });
      }

      if (ui.knopf('btn-beitreten-los', 'Beitreten', { aus: code.trim().length !== 6, abstand: 10 })) {
        app.beitreten(code.trim().toUpperCase());
      }
      if (ui.knopf('btn-beitreten-zurueck', 'Zurück', { art: 'zweit' })) {
        app.fehler = null;
        app.ansicht = 'start';
      }
    });
  }

  /* ======================================================================
     2. LOBBY
     ====================================================================== */

  function lobbyNeu(app) {
    ui.beginneSeite();
    kopfzeile(app);

    ui.seite('lobby-neu', function () {
      ui.titel('Partie einstellen', { zentriert: true, abstand: 14 });

      ui.absatz('Spieldauer', { fett: true, farbe: F.text, abstand: 6 });
      const stufen = [
        { id: 'kurz', text: 'Kurz', unter: '10 Min' },
        { id: 'normal', text: 'Normal', unter: '30 Min' },
        { id: 'lang', text: 'Lang', unter: '60 Min' },
      ];
      const r = ui.reserviere(58, { abstand: 6 });
      const b = r.b / 3;
      for (let i = 0; i < 3; i++) {
        const feld = { x: r.x + b * i + 3, y: r.y, b: b - 6, h: r.h };
        const aktiv = app.dauerStufe === stufen[i].id;
        ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, aktiv ? F.primaer : F.karte);
        if (!aktiv) ui.rahmeRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.rand, 1.5);
        ui.schreibe(stufen[i].text, feld.x + feld.b / 2, feld.y + 21, {
          groesse: 15, fett: true, farbe: aktiv ? F.weiss : F.text, ausrichtung: 'center',
        });
        ui.schreibe(stufen[i].unter, feld.x + feld.b / 2, feld.y + 40, {
          groesse: 12, farbe: aktiv ? 'rgba(255,255,255,0.85)' : F.gedaempft, ausrichtung: 'center',
        });
        ui.merke('dauer-' + stufen[i].id, feld, 'knopf');
        if (ui.geklickt(feld)) app.dauerStufe = stufen[i].id;
      }
      ui.absatz('In jeder Länge werden fünf Börsenjahre gespielt — nur schneller oder gemächlicher. Deshalb sind die Ergebnisse vergleichbar.', {
        groesse: 13, abstand: 16,
      });

      ui.absatz('KI-Mitspieler', { fett: true, farbe: F.text, abstand: 6 });
      const rb = ui.reserviere(48, { abstand: 6 });
      const bb = rb.b / 6;
      for (let i = 0; i <= 5; i++) {
        const feld = { x: rb.x + bb * i + 3, y: rb.y, b: bb - 6, h: rb.h };
        const aktiv = app.botAnzahl === i;
        ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, aktiv ? F.primaer : F.karte);
        if (!aktiv) ui.rahmeRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.rand, 1.5);
        ui.schreibe(String(i), feld.x + feld.b / 2, feld.y + feld.h / 2, {
          groesse: 17, fett: true, farbe: aktiv ? F.weiss : F.text, ausrichtung: 'center',
        });
        ui.merke('bots-' + i, feld, 'knopf');
        if (ui.geklickt(feld)) app.botAnzahl = i;
      }
      ui.absatz('Mit KI-Mitspielern zählt das Ergebnis nicht für die Bestenliste.', {
        groesse: 13, abstand: 16,
      });

      if (ui.knopf('btn-lobby-erstellen', 'Raum eröffnen', { abstand: 10 })) app.erstelleRaum();
      if (ui.knopf('btn-lobby-zurueck', 'Zurück', { art: 'zweit' })) app.ansicht = 'start';
    });
  }

  function lobby(app) {
    const z = app.zustand;
    ui.beginneSeite();
    kopfzeile(app);

    const spieler = z.raum && z.raum.spieler ? Object.keys(z.raum.spieler) : [];

    ui.seite('lobby', function () {
      ui.absatz('Raum-Code', { zentriert: true, groesse: 13, abstand: 2 });
      ui.titel(z.code || '—', { zentriert: true, groesse: 40, abstand: 6, farbe: F.primaer });
      ui.absatz('Diesen Code vorlesen — wer ihn eingibt, ist dabei.', {
        zentriert: true, abstand: 16,
      });

      const griff = ui.beginneKarte('karte-spieler');
      ui.absatz(spieler.length + ' von ' + gameService.MAX_SPIELER + ' dabei', {
        fett: true, farbe: F.text, abstand: 8,
      });
      for (const uid of spieler) {
        const zeile = ui.reserviere(30, { abstand: 2 });
        const ist = uid === z.uid;
        ui.schreibe((uid === z.raum.hostId ? '👑 ' : '👤 ') + z.raum.spieler[uid].name, zeile.x, zeile.y + 15, {
          groesse: 15, fett: ist ? true : 'halb', farbe: ist ? F.primaer : F.text,
        });
        if (ist) ui.schreibe('du', zeile.x + zeile.b, zeile.y + 15, {
          groesse: 12, farbe: F.gedaempft, ausrichtung: 'right',
        });
      }
      if (z.raum && z.raum.botAnzahl > 0) {
        for (const c of bots.charakterListe().slice(0, z.raum.botAnzahl)) {
          const zeile = ui.reserviere(30, { abstand: 2 });
          ui.schreibe(c.zeichen + ' ' + c.name, zeile.x, zeile.y + 15, {
            groesse: 15, fett: 'halb', farbe: F.gedaempft,
          });
          ui.schreibe('KI', zeile.x + zeile.b, zeile.y + 15, {
            groesse: 12, farbe: F.gedaempft, ausrichtung: 'right',
          });
        }
      }
      ui.beendeKarte(griff);
      ui.luecke(14);

      const stufe = z.dauerStufe;
      ui.absatz(
        'Dauer: ' + (stufe ? stufe.name + ' (' + stufe.minuten + ' Min)' : '—') +
        '  ·  Startgeld: ' + euro(depot.STARTBUDGET, 0) +
        '  ·  höchstens ' + Math.round(depot.HOECHSTANTEIL * 100) + ' % je Wert',
        { zentriert: true, groesse: 13, abstand: 14 }
      );

      if (z.istHost) {
        if (ui.knopf('btn-start', 'Partie starten', { abstand: 10 })) app.starte();
      } else {
        ui.absatz('Warte auf den Start …', { zentriert: true, fett: 'halb', abstand: 10 });
      }
      if (ui.knopf('btn-lobby-verlassen', 'Raum verlassen', { art: 'zweit' })) app.verlassen();
    });
  }

  /* ======================================================================
     3. MARKT
     ====================================================================== */

  const KLASSEN = [
    { id: 'aktie', text: 'Aktien' },
    { id: 'etf', text: 'ETFs' },
    { id: 'krypto', text: 'Krypto' },
  ];

  function markt_(app) {
    const tick = app.tick();
    const stand = app.eigenerStand();

    /* Klassenumschalter */
    const r = ui.reserviere(36, { abstand: 8 });
    const b = r.b / KLASSEN.length;
    for (let i = 0; i < KLASSEN.length; i++) {
      const feld = { x: r.x + b * i, y: r.y, b: b, h: r.h };
      const aktiv = app.klasse === KLASSEN[i].id;
      if (aktiv) ui.fuelleRund(feld.x + 2, feld.y, feld.b - 4, feld.h, ui.RADIUS_KLEIN, F.primaerHell);
      ui.schreibe(KLASSEN[i].text, feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 14, fett: aktiv ? true : 'halb',
        farbe: aktiv ? F.weiss : F.gedaempft, ausrichtung: 'center',
      });
      ui.merke('klasse-' + KLASSEN[i].id, feld, 'reiter');
      if (ui.geklickt(feld)) app.klasse = KLASSEN[i].id;
    }

    const suche = ui.eingabe('eing-suche', {
      platzhalter: '🔎 Name oder Kürzel …', maxLaenge: 24, hoehe: 40, abstand: 8,
    });

    /* Sortierung */
    const sorten = [
      { id: 'name', text: 'A–Z' },
      { id: 'tag', text: 'Bewegung' },
      { id: 'kgv', text: 'KGV' },
      { id: 'div', text: 'Dividende' },
    ];
    const rs = ui.reserviere(30, { abstand: 8 });
    const bs = rs.b / sorten.length;
    for (let i = 0; i < sorten.length; i++) {
      const feld = { x: rs.x + bs * i + 2, y: rs.y, b: bs - 4, h: rs.h };
      const aktiv = app.sortierung === sorten[i].id;
      ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, aktiv ? F.primaer : F.karte);
      ui.schreibe(sorten[i].text, feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 12, fett: aktiv ? true : false,
        farbe: aktiv ? F.weiss : F.gedaempft, ausrichtung: 'center',
      });
      ui.merke('sort-' + sorten[i].id, feld, 'knopf');
      if (ui.geklickt(feld)) app.sortierung = sorten[i].id;
    }

    const liste = app.gefilterteWerte(suche, tick);

    ui.scroll('roll-markt', ui.hoeheRest() - 4, function () {
      if (!liste.length) {
        ui.absatz('Nichts gefunden.', { zentriert: true, abstand: 10 });
        return;
      }
      for (const w of liste) {
        zeileWert(app, w, tick, stand);
      }
    });
  }

  function zeileWert(app, w, tick, stand) {
    const zeile = ui.reserviere(58, { abstand: 6 });
    ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, F.karte);

    const kurs = markt.kurs(app.lauf, w.id, tick);
    const tagesLauf = markt.veraenderung(app.lauf, w.id, tick);
    const bestand = depot.bestandVon(stand, w.id);

    ui.schreibe(ui.kuerze(w.name, zeile.b - 130, 15, true), zeile.x + 12, zeile.y + 20, {
      groesse: 15, fett: true, farbe: F.text,
    });

    let unten = w.kuerzel;
    if (w.art === 'aktie') {
      const kgvJetzt = markt.kgv(app.lauf, w, tick);
      unten += '  ·  KGV ' + (kgvJetzt ? kgvJetzt.toFixed(1).replace('.', ',') : '—');
      const dr = markt.divRendite(app.lauf, w, tick);
      if (dr > 0) unten += '  ·  Div ' + dr.toFixed(1).replace('.', ',') + ' %';
    } else if (w.art === 'etf') {
      unten += '  ·  ' + w.sektor;
    } else {
      unten += '  ·  Krypto';
    }
    ui.schreibe(ui.kuerze(unten, zeile.b - 130, 12), zeile.x + 12, zeile.y + 40, {
      groesse: 12, farbe: F.gedaempft,
    });

    ui.schreibe(kursText(kurs), zeile.x + zeile.b - 12, zeile.y + 20, {
      groesse: 15, fett: true, farbe: F.text, ausrichtung: 'right',
    });
    ui.schreibe(prozent(tagesLauf, 1), zeile.x + zeile.b - 12, zeile.y + 40, {
      groesse: 13, fett: 'halb', farbe: farbeFuer(tagesLauf), ausrichtung: 'right',
    });

    /* Wer den Wert hält, sieht das sofort — ohne ins Depot zu wechseln. */
    if (bestand > 0) {
      ui.fuelleRund(zeile.x, zeile.y, 4, zeile.h, 2, F.primaer);
    }

    ui.merke('wert-' + w.id, zeile, 'zeile');
    if (ui.geklickt(zeile)) { app.detailId = w.id; app.ansicht = 'detail'; }
  }

  /* ======================================================================
     4. DETAIL
     ====================================================================== */

  function detail(app) {
    const w = app.wertNachId[app.detailId];
    if (!w) { app.ansicht = 'spiel'; return; }
    const tick = app.tick();
    const stand = app.eigenerStand();
    const kurs = markt.kurs(app.lauf, w.id, tick);

    ui.beginneSeite();
    kopfzeile(app);

    ui.scroll('roll-detail', ui.hoeheRest(), function () {
      if (ui.knopf('btn-detail-zurueck', '‹ Zurück zum Markt', { art: 'link', abstand: 4 })) {
        app.ansicht = 'spiel';
      }

      ui.titel(w.name, { abstand: 2 });
      ui.absatz(w.kuerzel + (w.land ? '  ·  ' + w.land : '') + '  ·  ' + w.sektor, { abstand: 10 });

      const griff = ui.beginneKarte('karte-kurs');
      ui.schreibe(kursText(kurs), ui.oben().x, ui.oben().y + ui.verbraucht() + 16, {
        groesse: 28, fett: true, farbe: F.text,
      });
      ui.reserviere(34, { abstand: 2 });
      const seit = markt.seitStart(app.lauf, w.id, tick);
      ui.absatz(prozent(markt.veraenderung(app.lauf, w.id, tick), 2) + ' zuletzt   ·   ' +
        prozent(seit, 1) + ' seit Partiebeginn', {
        groesse: 13, fett: 'halb', farbe: farbeFuer(seit), abstand: 8,
      });
      chart(app, w, tick);
      ui.beendeKarte(griff);
      ui.luecke(12);

      /* Kennzahlen */
      const griff2 = ui.beginneKarte('karte-kennzahlen');
      ui.absatz('Kennzahlen', { fett: true, farbe: F.text, abstand: 8 });
      for (const [bez, wert] of kennzahlen(app, w, tick)) {
        const zeile = ui.reserviere(26, { abstand: 0 });
        ui.schreibe(bez, zeile.x, zeile.y + 13, { groesse: 13, farbe: F.gedaempft });
        ui.schreibe(wert, zeile.x + zeile.b, zeile.y + 13, {
          groesse: 13, fett: 'halb', farbe: F.text, ausrichtung: 'right',
        });
      }
      ui.beendeKarte(griff2);
      ui.luecke(12);

      /* Bestand und Handel */
      const bestand = depot.bestandVon(stand, w.id);
      if (bestand > 0) {
        const pos = stand.positionen.find(function (p) { return p.id === w.id; });
        const griff3 = ui.beginneKarte('karte-bestand', { farbe: '#eef5ff' });
        ui.absatz('Dein Bestand', { fett: true, farbe: F.text, abstand: 6 });
        ui.absatz(stueckText(w, bestand) + ' Stück  ·  Einstand ' + kursText(pos.einstandJeStueck), {
          groesse: 13, abstand: 4,
        });
        ui.absatz(euro(pos.marktwert) + '   ' + prozent(pos.gewinnProzent, 1), {
          groesse: 15, fett: true, farbe: farbeFuer(pos.gewinn), abstand: 0,
        });
        ui.beendeKarte(griff3);
        ui.luecke(12);
      }

      const laeuft = app.zustand.raum && app.zustand.raum.phase === 'laeuft' && !app.zustand.vorbei;
      if (laeuft) {
        if (ui.knopf('btn-kaufen', 'Kaufen', { abstand: 8 })) app.oeffneHandel(w.id, 'kauf');
        if (bestand > 0) {
          if (ui.knopf('btn-verkaufen', 'Verkaufen', { art: 'zweit' })) app.oeffneHandel(w.id, 'verkauf');
        }
      } else {
        ui.absatz('Gehandelt wird nur während der Partie.', { zentriert: true, abstand: 4 });
      }
    });
  }

  function kennzahlen(app, w, tick) {
    const zeilen = [];
    const kurs = markt.kurs(app.lauf, w.id, tick);
    const sp = markt.spanne(app.lauf, w.id, tick);

    zeilen.push(['Höchststand bisher', kursText(sp.hoch)]);
    zeilen.push(['Tiefststand bisher', kursText(sp.tief)]);

    if (w.art === 'aktie') {
      const k = markt.kgv(app.lauf, w, tick);
      zeilen.push(['KGV', k ? k.toFixed(1).replace('.', ',') : '—']);
      zeilen.push(['KGV zu Beginn', w.kgv ? String(w.kgv).replace('.', ',') : '—']);
      const g = markt.gewinnJeAktie(app.lauf, w.id, tick);
      zeilen.push(['Gewinn je Aktie', g > 0 ? euro(g) : '—']);
      const dr = markt.divRendite(app.lauf, w, tick);
      zeilen.push(['Dividendenrendite', dr > 0 ? dr.toFixed(2).replace('.', ',') + ' %' : '—']);
      zeilen.push(['Dividende je Aktie', w.dividende > 0 ? euro(w.dividende) : '—']);
      zeilen.push(['Branche', w.sektor]);
      zeilen.push(['Land', w.land || '—']);
      if (w.waehrungOriginal) {
        zeilen.push(['Notiert in', w.kursOriginal.toLocaleString('de-DE') + ' ' + w.waehrungOriginal + ' beim Start']);
      }
    } else if (w.art === 'etf') {
      zeilen.push(['Anlageklasse', w.anlageklasse]);
      zeilen.push(['Schwerpunkt', w.sektor]);
      zeilen.push(['Fondsvolumen', w.fondsvolumenMrd ? w.fondsvolumenMrd.toLocaleString('de-DE') + ' Mrd $' : '—']);
      zeilen.push(['Enthaltene Werte', w.anzahlPositionen ? w.anzahlPositionen.toLocaleString('de-DE') : '—']);
      /* Bewusst als Strich statt geschätzt: die laufenden Kosten stehen in
         keiner der benutzten Quellen als Liste. */
      zeilen.push(['Laufende Kosten', w.ter === null ? '—' : w.ter + ' %']);
      zeilen.push(['Ausschüttung', w.ausschuettend === null ? '—' : w.ausschuettend ? 'ausschüttend' : 'thesaurierend']);
    } else {
      const mk = markt.marktkapitalisierung(app.lauf, w, tick);
      zeilen.push(['Marktkapitalisierung', mk ? kompakt(mk) : '—']);
      zeilen.push(['Umlaufmenge', w.umlaufmenge ? w.umlaufmenge.toLocaleString('de-DE', { maximumFractionDigits: 0 }) : '—']);
      zeilen.push(['Höchstmenge', w.hoechstmenge ? w.hoechstmenge.toLocaleString('de-DE', { maximumFractionDigits: 0 }) : 'unbegrenzt']);
      zeilen.push(['Allzeithoch (real)', w.allzeithoch ? euro(w.allzeithoch, 2) : '—']);
    }
    return zeilen;
  }

  /* Kursverlauf. Auf einer Zeichenfläche ist ein Chart ein paar Linien —
     keine Fremdbibliothek nötig. */
  function chart(app, w, tick) {
    const h = 120;
    const r = ui.reserviere(h, { abstand: 6 });
    const reihe = app.lauf.kurse[w.id];
    if (!reihe || tick < 1) {
      ui.schreibe('Der Verlauf entsteht, sobald die Partie läuft.', r.x + r.b / 2, r.y + h / 2, {
        groesse: 13, farbe: F.gedaempft, ausrichtung: 'center',
      });
      return;
    }

    let hoch = reihe[0];
    let tief = reihe[0];
    for (let i = 0; i <= tick; i++) {
      if (reihe[i] > hoch) hoch = reihe[i];
      if (reihe[i] < tief) tief = reihe[i];
    }
    const spanne = hoch - tief || 1;
    const ctx = ui.ctx;

    /* Nulllinie = Startkurs. Ohne sie sieht jede Kurve gleich aus. */
    const yStart = r.y + h - ((reihe[0] - tief) / spanne) * h;
    ctx.strokeStyle = F.rand;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(r.x, yStart);
    ctx.lineTo(r.x + r.b, yStart);
    ctx.stroke();
    ctx.setLineDash([]);

    const gestiegen = reihe[tick] >= reihe[0];
    ctx.strokeStyle = gestiegen ? GRUEN : ROT;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= tick; i++) {
      const x = r.x + (i / Math.max(1, tick)) * r.b;
      const y = r.y + h - ((reihe[i] - tief) / spanne) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ui.schreibe(kursText(hoch), r.x + r.b, r.y + 8, {
      groesse: 11, farbe: F.gedaempft, ausrichtung: 'right',
    });
    ui.schreibe(kursText(tief), r.x + r.b, r.y + h - 8, {
      groesse: 11, farbe: F.gedaempft, ausrichtung: 'right',
    });
  }

  /* ======================================================================
     5. DEPOT
     ====================================================================== */

  function depotAnsicht(app) {
    const tick = app.tick();
    const stand = app.eigenerStand();

    ui.scroll('roll-depot', ui.hoeheRest(), function () {
      const griff = ui.beginneKarte('karte-depot');
      ui.absatz('Depotwert', { groesse: 13, abstand: 2 });
      const rz = ui.reserviere(36, { abstand: 2 });
      ui.schreibe(euro(stand.gesamt), rz.x, rz.y + 20, { groesse: 27, fett: true, farbe: F.text });
      ui.absatz(prozent(stand.rendite, 2) + '  gegenüber ' + euro(depot.STARTBUDGET, 0) + ' Startgeld', {
        groesse: 13, fett: 'halb', farbe: farbeFuer(stand.rendite), abstand: 10,
      });

      const anteilInvestiert = stand.gesamt > 0 ? stand.anlagewert / stand.gesamt : 0;
      ui.balken(anteilInvestiert, { hoehe: 8, farbe: F.primaer, abstand: 6 });
      ui.absatz('Angelegt ' + euro(stand.anlagewert, 0) + '  ·  Frei ' + euro(stand.cash, 0), {
        groesse: 12, abstand: 6,
      });
      ui.absatz(stand.anzahlTrades + ' Aufträge  ·  ' + euro(stand.gebuehren, 2) + ' Gebühren' +
        (stand.dividenden > 0 ? '  ·  ' + euro(stand.dividenden, 2) + ' Dividenden' : ''), {
        groesse: 12, abstand: 0,
      });
      ui.beendeKarte(griff);
      ui.luecke(12);

      if (!stand.positionen.length) {
        ui.absatz('Noch nichts gekauft. Im Markt findest du 141 Werte.', {
          zentriert: true, abstand: 10,
        });
        return;
      }

      ui.absatz('Positionen', { fett: true, farbe: F.text, abstand: 6 });
      for (const p of stand.positionen) {
        const zeile = ui.reserviere(66, { abstand: 6 });
        ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, F.karte);

        ui.schreibe(ui.kuerze(p.wert.name, zeile.b - 130, 15, true), zeile.x + 12, zeile.y + 19, {
          groesse: 15, fett: true, farbe: F.text,
        });
        ui.schreibe(stueckText(p.wert, p.stueck) + ' × ' + kursText(p.kurs), zeile.x + 12, zeile.y + 38, {
          groesse: 12, farbe: F.gedaempft,
        });
        ui.schreibe('Anteil ' + (p.anteil * 100).toFixed(1).replace('.', ',') + ' %', zeile.x + 12, zeile.y + 55, {
          groesse: 11, farbe: F.gedaempft,
        });

        ui.schreibe(euro(p.marktwert, 0), zeile.x + zeile.b - 12, zeile.y + 19, {
          groesse: 15, fett: true, farbe: F.text, ausrichtung: 'right',
        });
        ui.schreibe(prozent(p.gewinnProzent, 1), zeile.x + zeile.b - 12, zeile.y + 38, {
          groesse: 13, fett: 'halb', farbe: farbeFuer(p.gewinn), ausrichtung: 'right',
        });
        ui.schreibe((p.gewinn >= 0 ? '+' : '') + euro(p.gewinn, 0), zeile.x + zeile.b - 12, zeile.y + 55, {
          groesse: 11, farbe: farbeFuer(p.gewinn), ausrichtung: 'right',
        });

        ui.merke('pos-' + p.id, zeile, 'zeile');
        if (ui.geklickt(zeile)) { app.detailId = p.id; app.ansicht = 'detail'; }
      }
    });
  }

  /* ======================================================================
     6. RANGLISTE
     ====================================================================== */

  function rangliste(app) {
    const reihen = app.rangliste();

    ui.scroll('roll-rang', ui.hoeheRest(), function () {
      ui.absatz('Wer liegt vorn?', { fett: true, farbe: F.text, abstand: 8 });
      let platz = 0;
      for (const e of reihen) {
        platz++;
        const zeile = ui.reserviere(56, { abstand: 6 });
        const ist = e.uid === app.zustand.uid;
        ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, ist ? '#e3edfb' : F.karte);
        if (ist) ui.rahmeRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, F.primaer, 2);

        const medaille = platz === 1 ? '🥇' : platz === 2 ? '🥈' : platz === 3 ? '🥉' : String(platz) + '.';
        ui.schreibe(medaille, zeile.x + 14, zeile.y + zeile.h / 2, {
          groesse: platz <= 3 ? 20 : 15, fett: true, farbe: F.gedaempft,
        });

        ui.schreibe(ui.kuerze((e.zeichen ? e.zeichen + ' ' : '') + e.name, zeile.b - 170, 15, true),
          zeile.x + 52, zeile.y + 21, { groesse: 15, fett: true, farbe: F.text });
        ui.schreibe(e.trades + ' Aufträge' + (e.istBot ? '  ·  KI' : ''), zeile.x + 52, zeile.y + 40, {
          groesse: 12, farbe: F.gedaempft,
        });

        ui.schreibe(euro(e.gesamt, 0), zeile.x + zeile.b - 12, zeile.y + 21, {
          groesse: 15, fett: true, farbe: F.text, ausrichtung: 'right',
        });
        ui.schreibe(prozent(e.rendite, 1), zeile.x + zeile.b - 12, zeile.y + 40, {
          groesse: 13, fett: 'halb', farbe: farbeFuer(e.rendite), ausrichtung: 'right',
        });
      }

      ui.luecke(10);
      ui.absatz('Alle rechnen dieselben Kurse aus derselben Zufallszahl — niemand sieht andere Preise als du.', {
        groesse: 12, zentriert: true,
      });
    });
  }

  /* ======================================================================
     7. NACHRICHTEN
     ====================================================================== */

  function ticker(app) {
    const tick = app.tick();
    const liste = markt.meldungenBis(app.lauf, tick);

    ui.scroll('roll-news', ui.hoeheRest(), function () {
      if (!liste.length) {
        ui.absatz('Noch keine Meldungen. Es geht gleich los.', { zentriert: true, abstand: 10 });
        return;
      }
      for (const m of liste) {
        const griff = ui.beginneKarte('news-' + m.tick + '-' + m.text.length, { polster: 12 });
        const farbe = m.richtung > 0 ? GRUEN : ROT;
        const marke = m.geruecht ? '🗣️ Gerücht' :
          m.aufloesung === 'bestaetigt' ? '✅ Bestätigt' :
          m.aufloesung === 'dementiert' ? '❌ Dementiert' :
          m.richtung > 0 ? '▲ Gut' : '▼ Schlecht';
        ui.absatz(marke + '  ·  Jahr ' + (Math.floor(markt.spieljahr(m.tick)) + 1), {
          groesse: 11, fett: 'halb', farbe: farbe, abstand: 4,
        });
        ui.absatz(m.text, { groesse: 14, farbe: F.text, abstand: 2 });
        if (m.zielName) {
          ui.absatz('betrifft ' + m.zielName, { groesse: 11, abstand: 0 });
        }
        ui.beendeKarte(griff);
        ui.luecke(8);
      }
    });
  }

  /* ======================================================================
     8. HANDELSDIALOG
     ====================================================================== */

  function handelDialog(app) {
    const h = app.handel;
    const w = app.wertNachId[h.id];
    if (!w) { app.handel = null; return; }
    const tick = app.tick();
    const kurs = markt.kurs(app.lauf, w.id, tick);
    const stand = app.eigenerStand();
    const istKauf = h.art === 'kauf';

    ui.abdunkeln(0.55);
    const griff = ui.beginneDialog('dlg-handel', { maxHoehe: ui.hoehe - 40 });

    ui.titel((istKauf ? 'Kaufen: ' : 'Verkaufen: ') + w.name, { groesse: 19, abstand: 4 });
    ui.absatz('Kurs jetzt ' + kursText(kurs) + '  ·  ' + prozent(markt.veraenderung(app.lauf, w.id, tick), 1), {
      groesse: 13, abstand: 10,
    });

    const hoechst = istKauf
      ? depot.hoechstKaufbar(stand, w, kurs)
      : depot.bestandVon(stand, w.id);

    /* Schnellwahl statt Tippen — im fahrenden Bus trifft niemand ein
       Zahlenfeld. */
    const anteile = [0.25, 0.5, 0.75, 1];
    const r = ui.reserviere(44, { abstand: 8 });
    const b = r.b / anteile.length;
    for (let i = 0; i < anteile.length; i++) {
      const feld = { x: r.x + b * i + 3, y: r.y, b: b - 6, h: r.h };
      ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.karte);
      ui.rahmeRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.rand, 1.5);
      ui.schreibe(Math.round(anteile[i] * 100) + ' %', feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 14, fett: true, farbe: F.text, ausrichtung: 'center',
      });
      ui.merke('anteil-' + i, feld, 'knopf');
      if (ui.geklickt(feld)) {
        h.stueck = depot.rundeStueck(w, hoechst * anteile[i]);
        ui.setzeEingabe('eing-stueck', stueckText(w, h.stueck));
      }
    }

    const eingetippt = ui.eingabe('eing-stueck', {
      platzhalter: 'Stückzahl', maxLaenge: 14, abstand: 8,
      setze: h.stueck !== null ? stueckText(w, h.stueck) : '',
    });
    const stueck = depot.rundeStueck(w, parseFloat(String(eingetippt).replace(',', '.')) || 0);

    ui.absatz(istKauf
      ? 'Möglich sind ' + stueckText(w, hoechst) + ' Stück.'
      : 'Du hältst ' + stueckText(w, hoechst) + ' Stück.', { groesse: 12, abstand: 8 });

    /* Vorschau: Betrag und Gebühr, bevor bestätigt wird. */
    let hinweis = null;
    let erlaubt = false;
    if (stueck > 0) {
      const pruefung = istKauf
        ? depot.pruefeKauf(stand, w, stueck, kurs)
        : depot.pruefeVerkauf(stand, w, stueck);
      erlaubt = pruefung.ok;
      if (!pruefung.ok) hinweis = pruefung.grund;
      else {
        const betrag = kurs * stueck;
        const geb = depot.gebuehr(betrag);
        hinweis = (istKauf ? 'Kosten ' : 'Erlös ') +
          euro(istKauf ? betrag + geb : betrag - geb) +
          '  (davon ' + euro(geb) + ' Gebühr)';
      }
    }
    if (hinweis) {
      ui.absatz(hinweis, {
        groesse: 13, fett: 'halb', farbe: erlaubt ? F.text : ROT, abstand: 10,
      });
    }

    ui.absatz('Ausgeführt wird zum nächsten Kursstand.', { groesse: 11, abstand: 10 });

    if (ui.knopf('btn-handel-los', istKauf ? 'Kaufen' : 'Verkaufen', {
      aus: !erlaubt, abstand: 8,
    })) {
      app.fuehreHandelAus(w, stueck);
    }
    if (ui.knopf('btn-handel-abbrechen', 'Abbrechen', { art: 'zweit', hoehe: 40 })) {
      app.handel = null;
    }

    ui.beendeDialog(griff);
  }

  /* ======================================================================
     9. ENDABRECHNUNG
     ====================================================================== */

  function ende(app) {
    const reihen = app.rangliste();
    const eigener = reihen.findIndex(function (e) { return e.uid === app.zustand.uid; });

    ui.beginneSeite();
    kopfzeile(app);

    ui.scroll('roll-ende', ui.hoeheRest(), function () {
      ui.titel('Abgerechnet!', { zentriert: true, abstand: 4 });
      ui.absatz('Fünf Börsenjahre in ' + (app.zustand.dauerStufe ? app.zustand.dauerStufe.minuten : 30) + ' Minuten.', {
        zentriert: true, abstand: 14,
      });

      if (reihen.length) {
        const sieger = reihen[0];
        const griff = ui.beginneKarte('karte-sieger', { farbe: '#fff8e1' });
        ui.absatz('🏆 Sieger', { zentriert: true, groesse: 13, abstand: 4 });
        ui.titel((sieger.zeichen ? sieger.zeichen + ' ' : '') + sieger.name, {
          zentriert: true, groesse: 24, abstand: 4,
        });
        ui.absatz(euro(sieger.gesamt) + '   ' + prozent(sieger.rendite, 1), {
          zentriert: true, groesse: 15, fett: true, farbe: farbeFuer(sieger.rendite), abstand: 0,
        });
        ui.beendeKarte(griff);
        ui.luecke(14);
      }

      if (eigener >= 0) {
        ui.absatz('Du wurdest ' + (eigener + 1) + '. von ' + reihen.length + '.', {
          zentriert: true, fett: true, farbe: F.text, abstand: 12,
        });
      }

      let platz = 0;
      for (const e of reihen) {
        platz++;
        const zeile = ui.reserviere(44, { abstand: 4 });
        const ist = e.uid === app.zustand.uid;
        ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, ist ? '#e3edfb' : F.karte);
        ui.schreibe(platz + '.', zeile.x + 12, zeile.y + zeile.h / 2, {
          groesse: 14, fett: true, farbe: F.gedaempft,
        });
        ui.schreibe(ui.kuerze((e.zeichen ? e.zeichen + ' ' : '') + e.name, zeile.b - 190, 14, true),
          zeile.x + 44, zeile.y + zeile.h / 2, { groesse: 14, fett: ist ? true : 'halb', farbe: F.text });
        ui.schreibe(euro(e.gesamt, 0), zeile.x + zeile.b - 90, zeile.y + zeile.h / 2, {
          groesse: 13, farbe: F.text, ausrichtung: 'right',
        });
        ui.schreibe(prozent(e.rendite, 0), zeile.x + zeile.b - 12, zeile.y + zeile.h / 2, {
          groesse: 13, fett: 'halb', farbe: farbeFuer(e.rendite), ausrichtung: 'right',
        });
      }

      ui.luecke(14);
      if (ui.knopf('btn-ende-depot', 'Mein Depot ansehen', { art: 'zweit', abstand: 8 })) {
        app.ansicht = 'spiel';
        app.reiter = 'depot';
      }
      if (app.zustand.istHost) {
        if (ui.knopf('btn-ende-neu', 'Raum schließen und neu anfangen', { abstand: 8 })) {
          app.raeumeAufUndZurueck();
        }
      } else if (ui.knopf('btn-ende-raus', 'Zurück zum Start', { abstand: 8 })) {
        app.verlassen();
      }
    });
  }

  /* ======================================================================
     10. BESTENLISTE UND INFO
     ====================================================================== */

  function bestenliste(app) {
    ui.beginneSeite();
    kopfzeile(app);

    ui.scroll('roll-beste', ui.hoeheRest(), function () {
      if (ui.knopf('btn-beste-zurueck', '‹ Zurück', { art: 'link', abstand: 6 })) app.ansicht = 'start';
      ui.titel('🏆 Bestenliste', { abstand: 4 });
      ui.absatz('Nur Partien gegen echte Mitspieler zählen — sonst könnte man seine Zahlen gegen schwache KI aufpolieren.', {
        groesse: 13, abstand: 12,
      });

      if (app.bestenlisteLaedt) {
        ui.absatz('Wird geladen …', { zentriert: true });
        return;
      }
      if (!app.bestenlisteDaten || !app.bestenlisteDaten.length) {
        ui.absatz('Noch keine Einträge. Spielt die erste Partie!', { zentriert: true });
        return;
      }

      const kopf = ui.reserviere(26, { abstand: 4 });
      ui.schreibe('Name', kopf.x + 12, kopf.y + 13, { groesse: 12, fett: 'halb', farbe: F.gedaempft });
      ui.schreibe('Siege', kopf.x + kopf.b - 108, kopf.y + 13, {
        groesse: 12, fett: 'halb', farbe: F.gedaempft, ausrichtung: 'right',
      });
      ui.schreibe('beste Rendite', kopf.x + kopf.b - 12, kopf.y + 13, {
        groesse: 12, fett: 'halb', farbe: F.gedaempft, ausrichtung: 'right',
      });

      for (const e of app.bestenlisteDaten) {
        const zeile = ui.reserviere(44, { abstand: 4 });
        ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, F.karte);
        ui.schreibe(ui.kuerze(e.name, zeile.b - 200, 14, true), zeile.x + 12, zeile.y + 16, {
          groesse: 14, fett: 'halb', farbe: F.text,
        });
        ui.schreibe(e.partien + ' Partien', zeile.x + 12, zeile.y + 33, {
          groesse: 11, farbe: F.gedaempft,
        });
        ui.schreibe(String(e.siege), zeile.x + zeile.b - 108, zeile.y + zeile.h / 2, {
          groesse: 15, fett: true, farbe: F.text, ausrichtung: 'right',
        });
        ui.schreibe(e.besteRendite === null ? '—' : prozent(e.besteRendite, 0),
          zeile.x + zeile.b - 12, zeile.y + zeile.h / 2, {
            groesse: 14, fett: 'halb', farbe: farbeFuer(e.besteRendite || 0), ausrichtung: 'right',
          });
      }
    });
  }

  function info(app) {
    ui.beginneSeite();
    kopfzeile(app);

    ui.scroll('roll-info', ui.hoeheRest(), function () {
      if (ui.knopf('btn-info-zurueck', '‹ Zurück', { art: 'link', abstand: 6 })) app.ansicht = 'start';

      ui.titel('Depot-Duell', { abstand: 2 });
      ui.absatz('Version ' + app.APP_VERSION, { groesse: 12, abstand: 12 });

      const bloecke = [
        ['So läuft es', 'Jeder startet mit ' + euro(depot.STARTBUDGET, 0) + ' Spielgeld. In einer Partie vergehen fünf Börsenjahre — je nach eingestellter Länge in 10, 30 oder 60 Minuten. Wer am Ende das wertvollste Depot hat, gewinnt.'],
        ['Die Werte sind echt', WERTE.werte.length + ' Werte mit echten Startkursen und Kennzahlen vom ' + WERTE.stand.split('-').reverse().join('.') + ': ' + WERTE.werte.filter(function (w) { return w.art === 'aktie'; }).length + ' Aktien, ' + WERTE.werte.filter(function (w) { return w.art === 'etf'; }).length + ' ETFs und ' + WERTE.werte.filter(function (w) { return w.art === 'krypto'; }).length + ' Kryptowährungen.'],
        ['Der Verlauf ist erfunden', 'Ab dem Start läuft eine Simulation. Die Kursentwicklung hat nichts mit der Wirklichkeit zu tun und ist keine Vorhersage.'],
        ['Nachrichten bewegen die Kurse', 'Eine Meldung erscheint zuerst, der Kurs wandert danach über etwa eine Minute in ihre Richtung. Wer schnell liest und handelt, fährt den Großteil mit. Vorsicht bei Gerüchten — sie werden später bestätigt oder dementiert.'],
        ['Kennzahlen rechnen mit', 'Das KGV ist keine Zierzahl: es wird laufend aus Kurs und Gewinn je Aktie neu gerechnet. Ein Wert mit KGV 8 ist günstig bewertet, einer mit KGV 90 heiß gelaufen.'],
        ['Streuen ist Pflicht', 'Höchstens ' + Math.round(depot.HOECHSTANTEIL * 100) + ' % des Depots dürfen beim Kauf in einen einzigen Wert. Wächst eine Position danach darüber hinaus, darfst du sie behalten — das hast du dir verdient.'],
        ['Was Handeln kostet', 'Je Auftrag ' + (depot.GEBUEHR_SATZ * 100).toFixed(2).replace('.', ',') + ' %, mindestens ' + euro(depot.GEBUEHR_MIND, 0) + '. Hektisches Hin und Her kostet also Geld — wie in echt.'],
        ['Dividenden', 'Einmal je Spieljahr wird auf den gehaltenen Bestand ausgeschüttet. Wer erst danach kauft, geht leer aus.'],
        ['Alle sehen dieselben Kurse', 'Der ganze Verlauf entsteht aus einer einzigen Zufallszahl, die beim Eröffnen gezogen wird. Jedes Handy rechnet ihn selbst — deshalb laufen Kurse und Meldungen auch im Funkloch weiter. Nur Käufe und Rangliste holen später auf.'],
      ];
      for (const [titelText, text] of bloecke) {
        const griff = ui.beginneKarte('info-' + titelText.length + text.length, { polster: 14 });
        ui.absatz(titelText, { fett: true, farbe: F.text, groesse: 15, abstand: 4 });
        ui.absatz(text, { groesse: 13, abstand: 0 });
        ui.beendeKarte(griff);
        ui.luecke(8);
      }

      ui.luecke(6);
      const griffW = ui.beginneKarte('info-warnung', { farbe: '#fff4e5' });
      ui.absatz('Spielgeld. Keine Anlageberatung, keine Kaufempfehlung.', {
        fett: true, farbe: '#b45309', groesse: 14, abstand: 4,
      });
      ui.absatz('Startkurse und Kennzahlen: ' + WERTE.quellen.join(', ') + '. Stand ' +
        WERTE.stand.split('-').reverse().join('.') + '. Der Kursverlauf im Spiel ist simuliert.', {
        groesse: 12, abstand: 0,
      });
      ui.beendeKarte(griffW);

      ui.luecke(12);
      ui.absatz('Änderungen', { fett: true, farbe: F.text, abstand: 6 });
      for (const v of app.CHANGELOG) {
        ui.absatz('Version ' + v.version, { fett: 'halb', farbe: F.text, groesse: 13, abstand: 2 });
        for (const g of v.groups) {
          for (const eintrag of g.items) {
            ui.absatz('• ' + eintrag, { groesse: 12, links: 8, abstand: 2 });
          }
        }
        ui.luecke(6);
      }
    });
  }

  /* ======================================================================
     Verteiler
     ====================================================================== */

  function spiel(app) {
    ui.beginneSeite();
    kopfzeile(app);
    reiter(app, [
      { id: 'markt', text: 'Markt' },
      { id: 'depot', text: 'Depot' },
      { id: 'rang', text: 'Rangliste' },
      { id: 'news', text: 'News' },
    ]);
    if (app.reiter === 'markt') markt_(app);
    else if (app.reiter === 'depot') depotAnsicht(app);
    else if (app.reiter === 'rang') rangliste(app);
    else ticker(app);
  }

  return {
    start: start,
    beitreten: beitreten,
    lobbyNeu: lobbyNeu,
    lobby: lobby,
    spiel: spiel,
    detail: detail,
    ende: ende,
    bestenliste: bestenliste,
    info: info,
    handelDialog: handelDialog,
    euro: euro,
    prozent: prozent,
    kursText: kursText,
    stueckText: stueckText,
    farbeFuer: farbeFuer,
  };
})();
