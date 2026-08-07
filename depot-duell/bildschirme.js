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
    if (kurs >= 1) return euro(kurs, 2);
    return euro(kurs, 4);
  }

  /* Aufzählung von Namen, wie man sie sprechen würde. */
  function namenListe(namen) {
    if (namen.length === 1) return namen[0];
    if (namen.length === 2) return namen[0] + ' und ' + namen[1];
    if (namen.length <= 4) return namen.slice(0, -1).join(', ') + ' und ' + namen[namen.length - 1];
    return namen.slice(0, 3).join(', ') + ' und ' + (namen.length - 3) + ' weitere';
  }

  /* ----------------------------------------------------------------------
     Kopfzeile
     ---------------------------------------------------------------------- */

  /* Die blaue Leiste erscheint NUR während einer laufenden Partie — dort
     trägt sie Depotwert, Rendite, Rundenstand und freies Geld.

     Vor der Partie hat sie nichts zu zeigen und würde nur oben am Rand
     kleben, während der eigentliche Inhalt mittig sitzt. Die Quartett-Spiele
     machen es genauso: dort steht der Titel als Teil des zentrierten Blocks,
     nicht als Balken darüber. */
  function kopfzeile(app) {
    const z = app.zustand;
    const laeuft = z.raum && z.raum.phase === 'laeuft';
    if (!laeuft) return;

    const r = ui.reserviere(64, { abstand: 8 });
    ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS, F.primaer);

    {
      const stand = app.eigenerStand();
      ui.schreibe(euro(stand.gesamt, 0), r.x + 16, r.y + 24, {
        groesse: 22, fett: true, farbe: F.weiss,
      });
      ui.schreibe(prozent(stand.rendite, 1), r.x + 16, r.y + 47, {
        groesse: 14, fett: 'halb',
        farbe: stand.rendite >= 0 ? '#a7f3d0' : '#fecaca',
      });

      /* Rechts: Rundenstand und das freie Geld. Ohne das freie Geld musste
         man für jede Kaufentscheidung erst in den Depot-Reiter wechseln —
         und das genau in dem Moment, in dem man vor der Kaufentscheidung
         steht. */
      const runde = app.runde();
      const gesamtRunden = z.runden || markt.STANDARD_RUNDEN;
      const angezeigt = Math.min(runde + 1, gesamtRunden);

      /* Der Ausstieg gehört in die Kopfzeile. Vorher stand er nur ganz unten
         in der Rangliste — dorthin muss man erst wechseln und dann scrollen,
         und wer aussteigen will, findet ihn nicht. Die Kopfzeile ist in
         jeder Ansicht da. Rückfrage kommt trotzdem, ein Fehltipp beendet
         beim Eröffner die Partie für alle. */
      const schliessen = { x: r.x + r.b - 42, y: r.y + 4, b: 38, h: 38 };
      ui.schreibe('✕', schliessen.x + schliessen.b / 2, schliessen.y + schliessen.h / 2, {
        groesse: 19, fett: true, farbe: 'rgba(255,255,255,0.75)', ausrichtung: 'center',
      });
      ui.merke('btn-kopf-beenden', schliessen, 'knopf');
      if (ui.geklickt(schliessen)) app.abbruchFrage = true;

      ui.schreibe('Runde ' + angezeigt + ' / ' + gesamtRunden, r.x + r.b - 50, r.y + 22, {
        groesse: 13, farbe: 'rgba(255,255,255,0.8)', ausrichtung: 'right',
      });
      ui.schreibe('frei ' + euro(stand.cash, 0), r.x + r.b - 16, r.y + 47, {
        groesse: 15, fett: true, farbe: F.weiss, ausrichtung: 'right',
      });

      const anteil = runde / gesamtRunden;
      ui.fuelleRund(r.x + 12, r.y + r.h - 9, r.b - 24, 4, 2, 'rgba(255,255,255,0.25)');
      if (anteil > 0) ui.fuelleRund(r.x + 12, r.y + r.h - 9, Math.max(4, (r.b - 24) * anteil), 4, 2, F.weiss);
    }
  }

  /* Der Titel für alles vor der Partie: Teil des zentrierten Blocks, kein
     Balken am oberen Rand. */
  function spielTitel() {
    ui.titel('📈 Depot-Duell', { groesse: 28, zentriert: true, abstand: 2 });
  }

  /* ----------------------------------------------------------------------
     Nachrichtenblock — steht über allem anderen

     Die Meldungen dieser Runde sind die eigentliche Spielinformation: sie
     bewegen den Kurs erst beim nächsten Rundenwechsel, wer sie richtig
     deutet, verdient daran. Deshalb stehen sie ganz oben und nicht in einem
     Reiter, den man erst suchen muss.
     ---------------------------------------------------------------------- */

  function markeFuer(m) {
    if (m.geruecht) return { text: '🗣️ Gerücht', farbe: '#b45309' };
    if (m.aufloesung === 'bestaetigt') return { text: '✅ Bestätigt', farbe: GRUEN };
    if (m.aufloesung === 'dementiert') return { text: '❌ Dementiert', farbe: ROT };
    return m.richtung > 0
      ? { text: '▲ Gute Nachricht', farbe: GRUEN }
      : { text: '▼ Schlechte Nachricht', farbe: ROT };
  }

  function newsBlock(app) {
    const liste = markt.meldungenIn(app.lauf, app.runde());
    if (!liste.length) return;

    /* Zugeklappt bleibt eine einzige Zeile stehen. Auf einem kleinen
       Bildschirm ist der Platz sonst weg, bevor die Marktliste anfängt —
       und wer schon gelesen hat, will die Werte sehen. */
    if (!app.newsOffen) {
      const z = ui.reserviere(34, { abstand: 8 });
      ui.fuelleRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN, F.karte);
      ui.schreibe('📰 ' + liste.length + (liste.length === 1 ? ' Meldung' : ' Meldungen') + ' in dieser Runde',
        z.x + 12, z.y + z.h / 2, { groesse: 13, fett: 'halb', farbe: F.text });
      ui.schreibe('anzeigen ▾', z.x + z.b - 12, z.y + z.h / 2, {
        groesse: 12, fett: 'halb', farbe: F.primaer, ausrichtung: 'right',
      });
      ui.merke('news-aufklappen', z, 'knopf');
      if (ui.geklickt(z)) app.newsOffen = true;
      return;
    }

    let i = app.newsIndex;
    if (i >= liste.length) i = liste.length - 1;
    if (i < 0) i = 0;
    app.newsIndex = i;
    const m = liste[i];
    const marke = markeFuer(m);

    const griff = ui.beginneKarte('news-block', { polster: 12 });

    /* Kopfzeile der Karte: Art der Meldung, Zähler, Blätterpfeile. */
    const kopf = ui.reserviere(24, { abstand: 4 });
    ui.schreibe(marke.text, kopf.x, kopf.y + 12, { groesse: 12, fett: 'halb', farbe: marke.farbe });

    if (liste.length > 1) {
      const links = { x: kopf.x + kopf.b - 92, y: kopf.y - 4, b: 30, h: 30 };
      const rechts = { x: kopf.x + kopf.b - 30, y: kopf.y - 4, b: 30, h: 30 };
      ui.schreibe('‹', links.x + links.b / 2, links.y + links.h / 2, {
        groesse: 22, fett: true, farbe: i > 0 ? F.primaer : F.rand, ausrichtung: 'center',
      });
      ui.schreibe((i + 1) + '/' + liste.length, kopf.x + kopf.b - 46, kopf.y + 12, {
        groesse: 12, fett: 'halb', farbe: F.gedaempft, ausrichtung: 'center',
      });
      ui.schreibe('›', rechts.x + rechts.b / 2, rechts.y + rechts.h / 2, {
        groesse: 22, fett: true, farbe: i < liste.length - 1 ? F.primaer : F.rand, ausrichtung: 'center',
      });
      ui.merke('news-zurueck', links, 'knopf');
      ui.merke('news-vor', rechts, 'knopf');
      if (ui.geklickt(links) && i > 0) app.newsIndex = i - 1;
      if (ui.geklickt(rechts) && i < liste.length - 1) app.newsIndex = i + 1;
    } else {
      const zu = { x: kopf.x + kopf.b - 76, y: kopf.y - 4, b: 76, h: 30 };
      ui.schreibe('ausblenden ▴', zu.x + zu.b, kopf.y + 12, {
        groesse: 12, fett: 'halb', farbe: F.primaer, ausrichtung: 'right',
      });
      ui.merke('news-zuklappen', zu, 'knopf');
      if (ui.geklickt(zu)) app.newsOffen = false;
    }

    ui.absatz(m.text, { groesse: 15, farbe: F.text, abstand: 4 });

    const unten = ui.reserviere(20, { abstand: 0 });
    if (m.zielName) {
      ui.schreibe('betrifft ' + ui.kuerze(m.zielName, unten.b - 90, 12), unten.x, unten.y + 10, {
        groesse: 12, farbe: F.gedaempft,
      });
    }
    if (liste.length > 1) {
      ui.schreibe('ausblenden ▴', unten.x + unten.b, unten.y + 10, {
        groesse: 12, fett: 'halb', farbe: F.primaer, ausrichtung: 'right',
      });
      const zu = { x: unten.x + unten.b - 80, y: unten.y - 4, b: 80, h: 26 };
      ui.merke('news-zuklappen', zu, 'knopf');
      if (ui.geklickt(zu)) app.newsOffen = false;
    }

    ui.beendeKarte(griff);
    ui.luecke(8);
  }

  /* ----------------------------------------------------------------------
     Rundenleiste — liegt FEST am unteren Rand

     Das Spiel wartet auf Menschen, nicht auf eine Uhr. Wer fertig ist,
     schließt ab; sobald alle abgeschlossen haben, springen die Kurse.

     Warum unten und nicht im Fluss: der Knopf wird in jeder Runde genau
     einmal gebraucht und ist der wichtigste des Spiels. Im Fluss stand er
     zwischen Nachrichten und Marktliste, kostete dort rund 80 Pixel und
     verschob sich je nachdem, wie lang die Schlagzeile gerade war. Unten
     ist er immer am selben Fleck und mit dem Daumen erreichbar.
     ---------------------------------------------------------------------- */

  const FUSS_HOEHE = 60;

  function brauchtFuss(app) {
    const z = app.zustand;
    return !!(z.raum && z.raum.phase === 'laeuft' && !z.vorbei);
  }

  function rundenLeiste(app) {
    if (!brauchtFuss(app)) return;
    const z = app.zustand;
    const fehlt = z.fehlende || [];

    const y = ui.hoehe - FUSS_HOEHE;
    const rand = ui.oben().x;
    const breite = ui.oben().b;

    /* Deckt den durchscrollenden Inhalt ab — der Scrollbereich endet zwar
       darüber, aber ein angeschnittener halber Listeneintrag sähe nach
       Fehler aus. */
    ui.fuelleRund(0, y - 6, ui.breite, FUSS_HOEHE + 6, 0, F.hintergrund);

    /* Ein abgelehnter Zug MUSS hier stehen und nicht nur in der Konsole.
       Sonst tippt man auf "Runde abschließen", es passiert nichts, und man
       hält das Spiel für kaputt statt zu erfahren, was schiefging. */
    if (app.fehler) {
      const fh = 26;
      const fr = { x: rand, y: y - fh - 4, b: breite, h: fh };
      ui.fuelleRund(fr.x, fr.y, fr.b, fr.h, ui.RADIUS_KLEIN, '#fee2e2');
      ui.schreibe('⚠ ' + ui.kuerze(app.fehler, fr.b - 60, 12), fr.x + 10, fr.y + fh / 2, {
        groesse: 12, fett: 'halb', farbe: ROT,
      });
      ui.schreibe('schließen', fr.x + fr.b - 10, fr.y + fh / 2, {
        groesse: 11, fett: 'halb', farbe: ROT, ausrichtung: 'right',
      });
      ui.merke('btn-fehler-weg', fr, 'knopf');
      if (ui.geklickt(fr)) app.fehler = null;
    }

    if (!z.abgeschlossen) {
      const feld = { x: rand, y: y + 4, b: breite, h: 48 };
      ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.primaer);
      ui.schreibe('Runde abschließen', feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 16, fett: true, farbe: F.weiss, ausrichtung: 'center',
      });
      ui.merke('btn-runde-fertig', feld, 'knopf');
      if (ui.geklickt(feld)) app.schliesseRundeAb();
      return;
    }

    /* Abgeschlossen: nur noch warten. Der Host bekommt daneben den Ausweg —
       ohne ihn hält ein einziges Handy im Rucksack die ganze Partie an. */
    const zeigeWeiter = z.istHost && fehlt.length > 0;
    const wartenBreite = zeigeWeiter ? breite * 0.62 : breite;
    const warten = { x: rand, y: y + 4, b: wartenBreite - (zeigeWeiter ? 6 : 0), h: 48 };
    ui.fuelleRund(warten.x, warten.y, warten.b, warten.h, ui.RADIUS_KLEIN, F.karte);
    ui.rahmeRund(warten.x, warten.y, warten.b, warten.h, ui.RADIUS_KLEIN, F.rand, 1.5);
    const text = fehlt.length ? 'Warten auf ' + namenListe(fehlt) : 'Runde wird abgerechnet …';
    ui.schreibe('⏳ ' + ui.kuerze(text, warten.b - 30, 13), warten.x + warten.b / 2, warten.y + warten.h / 2, {
      groesse: 13, fett: 'halb', farbe: F.gedaempft, ausrichtung: 'center',
    });

    if (zeigeWeiter) {
      const feld = { x: rand + wartenBreite + 6, y: y + 4, b: breite - wartenBreite - 6, h: 48 };
      ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.karte);
      ui.rahmeRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.primaer, 1.5);
      ui.schreibe('Weiter ohne sie', feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 12, fett: true, farbe: F.primaer, ausrichtung: 'center',
      });
      ui.merke('btn-runde-erzwingen', feld, 'knopf');
      if (ui.geklickt(feld)) app.schalteWeiter();
    }
  }

  /* ----------------------------------------------------------------------
     Reiter
     ---------------------------------------------------------------------- */

  function reiter(app, eintraege) {
    const r = ui.reserviere(40, { abstand: 8 });
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
      spielTitel();
      ui.absatz('Börsenspiel mit Spielgeld — gegen die Mannschaft oder allein gegen die KI.', {
        zentriert: true, groesse: 14, abstand: 18,
      });
      ui.titel('Wer bist du?', { zentriert: true, groesse: 21, abstand: 6 });
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
        /* Führt in dieselbe Einstellansicht wie das Eröffnen. Vorher sprang
           der Solo-Start direkt los — an die Einstellungen kam man auf
           diesem Weg gar nicht heran. */
        if (!app.entwurf.botAnzahl) app.entwurf.botAnzahl = 4;
        app.ansicht = 'lobby-neu';
      }

      ui.trenner('', { abstand: 12 });
      if (ui.knopf('btn-bestenliste', '🏆 Bestenliste', { art: 'link', abstand: 4 })) {
        app.ladeBestenliste();
        app.ansicht = 'bestenliste';
      }
      if (ui.knopf('btn-info', 'ℹ️ Wie es funktioniert', { art: 'link' })) app.ansicht = 'info';
    }, { zentriert: true });
  }

  function beitreten(app) {
    ui.beginneSeite();
    kopfzeile(app);

    ui.seite('beitreten', function () {
      spielTitel();
      ui.luecke(14);
      ui.titel('Raum-Code eingeben', { zentriert: true, groesse: 21, abstand: 6 });
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
    }, { zentriert: true });
  }

  /* ======================================================================
     2. LOBBY
     ====================================================================== */

  /* Eine Reihe gleich breiter Wahlknöpfe. Alle Einstellungen sehen damit
     gleich aus und verhalten sich gleich — bei fünf handgebauten Reihen wäre
     sonst jede ein eigener kleiner Fehler. */
  function wahlReihe(kennung, werte, aktuell, opt) {
    const o = opt || {};
    const hoehe = o.hoehe || 46;
    const r = ui.reserviere(hoehe, { abstand: o.abstand === undefined ? 6 : o.abstand });
    const b = r.b / werte.length;
    let gewaehlt = null;
    for (let i = 0; i < werte.length; i++) {
      const feld = { x: r.x + b * i + 3, y: r.y, b: b - 6, h: r.h };
      const aktiv = werte[i].wert === aktuell;
      ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, aktiv ? F.primaer : F.karte);
      if (!aktiv) ui.rahmeRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, F.rand, 1.5);
      const hatUnter = !!werte[i].unter;
      ui.schreibe(ui.kuerze(werte[i].text, feld.b - 6, o.groesse || 15, true),
        feld.x + feld.b / 2, hatUnter ? feld.y + hoehe * 0.38 : feld.y + hoehe / 2, {
          groesse: o.groesse || 15, fett: true,
          farbe: aktiv ? F.weiss : F.text, ausrichtung: 'center',
        });
      if (hatUnter) {
        ui.schreibe(ui.kuerze(werte[i].unter, feld.b - 6, 11), feld.x + feld.b / 2, feld.y + hoehe * 0.72, {
          groesse: 11, farbe: aktiv ? 'rgba(255,255,255,0.85)' : F.gedaempft, ausrichtung: 'center',
        });
      }
      ui.merke(kennung + '-' + i, feld, 'knopf');
      if (ui.geklickt(feld)) gewaehlt = werte[i].wert;
    }
    return gewaehlt;
  }

  function lobbyNeu(app) {
    const e = app.entwurf;
    const imRaum = !!(app.zustand.raum && app.zustand.raum.phase === 'lobby');

    ui.beginneSeite();
    kopfzeile(app);

    ui.seite('lobby-neu', function () {
      ui.titel(imRaum ? 'Einstellungen ändern' : 'Partie einstellen', { zentriert: true, abstand: 14 });

      ui.absatz('Wie viele Runden?', { fett: true, farbe: F.text, abstand: 6 });
      const gewaehltRunden = wahlReihe('runden', gameService.RUNDENSTUFEN.map(function (s) {
        return { wert: s.runden, text: String(s.runden), unter: s.unter };
      }), e.runden, { hoehe: 54, groesse: 19 });
      if (gewaehltRunden !== null) e.runden = gewaehltRunden;
      ui.absatz('Zehn Runden sind ein Börsenjahr. In jeder Runde erscheinen Nachrichten, alle handeln in Ruhe — und erst wenn alle abgeschlossen haben, bewegen sich die Kurse. Es läuft keine Uhr mit.', {
        groesse: 13, abstand: 14,
      });

      ui.absatz('Startgeld', { fett: true, farbe: F.text, abstand: 6 });
      const gewaehltGeld = wahlReihe('geld', [
        { wert: 10000, text: '10.000' },
        { wert: 50000, text: '50.000' },
        { wert: 100000, text: '100.000' },
        { wert: 1000000, text: '1 Mio' },
      ], e.startgeld, { groesse: 14 });
      if (gewaehltGeld !== null) e.startgeld = gewaehltGeld;
      ui.absatz('Mit wenig Geld sind teure Aktien unerreichbar und jede Gebühr tut weh — mit viel Geld spielt sich die Gebühr nicht mehr.', {
        groesse: 13, abstand: 14,
      });

      ui.absatz('Ordergebühr', { fett: true, farbe: F.text, abstand: 6 });
      const gewaehltGeb = wahlReihe('gebuehr', [
        { wert: 0, text: 'keine' },
        { wert: 0.0025, text: '0,25 %' },
        { wert: 0.01, text: '1 %' },
      ], e.gebuehrSatz, { groesse: 14 });
      if (gewaehltGeb !== null) {
        e.gebuehrSatz = gewaehltGeb;
        /* Ohne Satz auch keinen Mindestbetrag — sonst kostete jeder Auftrag
           weiterhin einen Euro, obwohl "keine" dransteht. */
        e.gebuehrMind = gewaehltGeb === 0 ? 0 : depot.VORGABE.gebuehrMind;
      }
      ui.absatz('Die Gebühr bestraft hektisches Hin und Her, wie in echt. Ohne sie kann man in jeder Runde umschichten, ohne dass es etwas kostet.', {
        groesse: 13, abstand: 14,
      });

      ui.absatz('Höchstens je Wert', { fett: true, farbe: F.text, abstand: 6 });
      const gewaehltAnteil = wahlReihe('anteil', [
        { wert: 0.1, text: '10 %' },
        { wert: 0.25, text: '25 %' },
        { wert: 0.5, text: '50 %' },
        { wert: 1, text: 'alles' },
      ], e.hoechstanteil, { groesse: 14 });
      if (gewaehltAnteil !== null) e.hoechstanteil = gewaehltAnteil;
      ui.absatz('Der Anteil, den ein einzelner Wert beim Kauf im Depot haben darf. Bei "alles" darf jemand sein ganzes Geld auf eine Kryptowährung setzen — dann entscheidet ein einziger Treffer die Partie.', {
        groesse: 13, abstand: 14,
      });

      ui.absatz('KI-Mitspieler', { fett: true, farbe: F.text, abstand: 6 });
      const gewaehltBots = wahlReihe('bots', [0, 1, 2, 3, 4, 5].map(function (i) {
        return { wert: i, text: String(i) };
      }), e.botAnzahl, { hoehe: 44, groesse: 17 });
      if (gewaehltBots !== null) e.botAnzahl = gewaehltBots;
      ui.absatz('KI-Mitspieler halten die Partie nie auf — sie sind sofort fertig. Mit ihnen zählt das Ergebnis aber nicht für die Bestenliste.', {
        groesse: 13, abstand: 16,
      });

      if (imRaum) {
        if (ui.knopf('btn-lobby-uebernehmen', 'Übernehmen', { abstand: 10 })) app.uebernehmeEinstellungen();
        if (ui.knopf('btn-lobby-zurueck', 'Zurück zur Lobby', { art: 'zweit' })) app.ansicht = 'lobby';
      } else {
        if (ui.knopf('btn-lobby-erstellen', 'Raum eröffnen', { abstand: 10 })) app.erstelleRaum();
        if (ui.knopf('btn-lobby-zurueck', 'Zurück', { art: 'zweit' })) app.ansicht = 'start';
      }
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

      const stufe = z.stufe;
      const R = app.regeln();
      ui.absatz(
        (stufe ? stufe.runden + ' Runden (' + stufe.unter + ')' : '—') +
        '  ·  ' + euro(R.startgeld, 0) + ' Startgeld' +
        '  ·  ' + (R.gebuehrSatz ? (R.gebuehrSatz * 100).toFixed(2).replace('.', ',') + ' % Gebühr' : 'ohne Gebühr') +
        '  ·  höchstens ' + (R.hoechstanteil >= 1 ? 'alles' : Math.round(R.hoechstanteil * 100) + ' %') + ' je Wert',
        { zentriert: true, groesse: 13, abstand: 14 }
      );

      if (z.istHost) {
        if (ui.knopf('btn-lobby-einstellungen', '⚙️ Einstellungen ändern', { art: 'zweit', abstand: 10 })) {
          app.oeffneEinstellungen();
        }
        if (ui.knopf('btn-start', 'Partie starten', { abstand: 10 })) app.starte();
      } else {
        ui.absatz('Warte auf den Start …', { zentriert: true, fett: 'halb', abstand: 10 });
      }
      if (ui.knopf('btn-lobby-verlassen', 'Raum verlassen', { art: 'zweit' })) app.verlassen();
    }, { zentriert: true });
  }

  /* ======================================================================
     3. MARKT
     ====================================================================== */

  const KLASSEN = [
    { id: 'aktie', text: 'Aktien' },
    { id: 'etf', text: 'ETFs' },
    { id: 'krypto', text: 'Krypto' },
  ];

  /* Sortierkriterien je Anlageklasse.

     Sie MÜSSEN sich unterscheiden: ETFs haben in den Daten weder KGV noch
     Dividende, Kryptowährungen ebenso wenig. Ein KGV-Knopf hätte dort alle
     Werte gleich bewertet und die Reihenfolge willkürlich verwürfelt —
     ein Knopf, der etwas tut, aber nichts sortiert, ist schlimmer als
     keiner.

     `auf` ist die Richtung beim ERSTEN Antippen: bei A–Z und KGV will man
     das Kleinste zuerst, bei Bewegung und Dividende das Größte. Ein zweites
     Antippen dreht um. */
  const SORTEN = {
    aktie: [
      { id: 'name', text: 'A–Z', auf: true },
      { id: 'tag', text: 'Bewegung', auf: false },
      { id: 'kgv', text: 'KGV', auf: true },
      { id: 'div', text: 'Dividende', auf: false },
    ],
    etf: [
      { id: 'name', text: 'A–Z', auf: true },
      { id: 'tag', text: 'Bewegung', auf: false },
      { id: 'kurs', text: 'Kurs', auf: false },
      { id: 'seit', text: 'seit Start', auf: false },
    ],
    krypto: [
      { id: 'name', text: 'A–Z', auf: true },
      { id: 'tag', text: 'Bewegung', auf: false },
      { id: 'kurs', text: 'Kurs', auf: false },
      { id: 'groesse', text: 'Größe', auf: false },
    ],
  };

  function sortenFuer(klasse) { return SORTEN[klasse] || SORTEN.aktie; }

  /* Wieviel Platz bleibt dem scrollenden Inhalt? Die Rundenleiste liegt
     fest am unteren Rand und darf nicht überdeckt werden. */
  function inhaltsHoehe(app) {
    return ui.hoeheRest() - (brauchtFuss(app) ? FUSS_HOEHE : 0);
  }

  function markt_(app) {
    const runde = app.runde();
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
      if (ui.geklickt(feld)) app.setzeKlasse(KLASSEN[i].id);
    }

    const suche = ui.eingabe('eing-suche', {
      platzhalter: '🔎 Name oder Kürzel …', maxLaenge: 24, hoehe: 38, abstand: 8,
    });

    /* Sortierung — der aktive Knopf zeigt die Richtung und dreht beim
       erneuten Antippen um. */
    const sorten = sortenFuer(app.klasse);
    const rs = ui.reserviere(32, { abstand: 8 });
    const bs = rs.b / sorten.length;
    for (let i = 0; i < sorten.length; i++) {
      const feld = { x: rs.x + bs * i + 2, y: rs.y, b: bs - 4, h: rs.h };
      const aktiv = app.sortierung === sorten[i].id;
      ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, ui.RADIUS_KLEIN, aktiv ? F.primaer : F.karte);
      const beschriftung = aktiv ? sorten[i].text + ' ' + (app.sortAb ? '▾' : '▴') : sorten[i].text;
      ui.schreibe(ui.kuerze(beschriftung, feld.b - 8, 12, aktiv), feld.x + feld.b / 2, feld.y + feld.h / 2, {
        groesse: 12, fett: aktiv ? true : false,
        farbe: aktiv ? F.weiss : F.gedaempft, ausrichtung: 'center',
      });
      ui.merke('sort-' + sorten[i].id, feld, 'knopf');
      if (ui.geklickt(feld)) app.setzeSortierung(sorten[i]);
    }

    const liste = app.gefilterteWerte(suche, runde);

    ui.scroll('roll-markt', inhaltsHoehe(app) - 4, function () {
      if (!liste.length) {
        ui.absatz('Nichts gefunden.', { zentriert: true, abstand: 10 });
        return;
      }
      for (const w of liste) {
        zeileWert(app, w, runde, stand);
      }
    });
  }

  function zeileWert(app, w, runde, stand) {
    const zeile = ui.reserviere(58, { abstand: 6 });
    ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, F.karte);

    const kurs = markt.kurs(app.lauf, w.id, runde);
    const bewegung = markt.veraenderung(app.lauf, w.id, runde);
    const bestand = depot.bestandVon(stand, w.id);

    ui.schreibe(ui.kuerze(w.name, zeile.b - 130, 15, true), zeile.x + 12, zeile.y + 20, {
      groesse: 15, fett: true, farbe: F.text,
    });

    /* Die Unterzeile zeigt, wonach gerade sortiert wird — sonst sortiert man
       nach KGV und sieht in der Liste keine KGVs. */
    let unten = w.kuerzel;
    if (w.art === 'aktie') {
      const kgvJetzt = markt.kgv(app.lauf, w, runde);
      unten += '  ·  KGV ' + (kgvJetzt ? kgvJetzt.toFixed(1).replace('.', ',') : '—');
      const dr = markt.divRendite(app.lauf, w, runde);
      if (dr > 0) unten += '  ·  Div ' + dr.toFixed(1).replace('.', ',') + ' %';
    } else if (w.art === 'etf') {
      unten += '  ·  ' + w.sektor;
      if (app.sortierung === 'seit') {
        unten += '  ·  ' + prozent(markt.seitStart(app.lauf, w.id, runde), 0) + ' seit Start';
      }
    } else {
      const mk = markt.marktkapitalisierung(app.lauf, w, runde);
      unten += mk ? '  ·  ' + kompakt(mk) : '  ·  Krypto';
    }
    ui.schreibe(ui.kuerze(unten, zeile.b - 130, 12), zeile.x + 12, zeile.y + 40, {
      groesse: 12, farbe: F.gedaempft,
    });

    ui.schreibe(kursText(kurs), zeile.x + zeile.b - 12, zeile.y + 20, {
      groesse: 15, fett: true, farbe: F.text, ausrichtung: 'right',
    });
    ui.schreibe(prozent(bewegung, 1), zeile.x + zeile.b - 12, zeile.y + 40, {
      groesse: 13, fett: 'halb', farbe: farbeFuer(bewegung), ausrichtung: 'right',
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
    const runde = app.runde();
    const stand = app.eigenerStand();
    const kurs = markt.kurs(app.lauf, w.id, runde);

    ui.beginneSeite();
    kopfzeile(app);

    ui.scroll('roll-detail', inhaltsHoehe(app), function () {
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
      const seit = markt.seitStart(app.lauf, w.id, runde);
      ui.absatz(prozent(markt.veraenderung(app.lauf, w.id, runde), 2) + ' letzte Runde   ·   ' +
        prozent(seit, 1) + ' seit Partiebeginn', {
        groesse: 13, fett: 'halb', farbe: farbeFuer(seit), abstand: 8,
      });
      chart(app, w, runde);
      ui.beendeKarte(griff);
      ui.luecke(12);

      /* Kennzahlen */
      const griff2 = ui.beginneKarte('karte-kennzahlen');
      ui.absatz('Kennzahlen', { fett: true, farbe: F.text, abstand: 8 });
      for (const [bez, wert] of kennzahlen(app, w, runde)) {
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

      const z = app.zustand;
      const laeuft = z.raum && z.raum.phase === 'laeuft' && !z.vorbei;
      if (laeuft && z.abgeschlossen) {
        ui.absatz('Du hast diese Runde abgeschlossen. Sobald alle so weit sind, geht es weiter.', {
          zentriert: true, groesse: 13, abstand: 4,
        });
      } else if (laeuft) {
        if (ui.knopf('btn-kaufen', 'Kaufen', { abstand: 8 })) app.oeffneHandel(w.id, 'kauf');
        if (bestand > 0) {
          if (ui.knopf('btn-verkaufen', 'Verkaufen', { art: 'zweit' })) app.oeffneHandel(w.id, 'verkauf');
        }
      } else {
        ui.absatz('Gehandelt wird nur während der Partie.', { zentriert: true, abstand: 4 });
      }
    });

    /* Auch hier, sonst müsste man erst zurück zum Markt, um die Runde
       abzuschließen — man kauft ja gerade in der Detailansicht. */
    rundenLeiste(app);
  }

  function kennzahlen(app, w, runde) {
    const zeilen = [];
    const sp = markt.spanne(app.lauf, w.id, runde);

    zeilen.push(['Höchststand bisher', kursText(sp.hoch)]);
    zeilen.push(['Tiefststand bisher', kursText(sp.tief)]);

    if (w.art === 'aktie') {
      const k = markt.kgv(app.lauf, w, runde);
      zeilen.push(['KGV', k ? k.toFixed(1).replace('.', ',') : '—']);
      zeilen.push(['KGV zu Beginn', w.kgv ? String(w.kgv).replace('.', ',') : '—']);
      const g = markt.gewinnJeAktie(app.lauf, w.id, runde);
      zeilen.push(['Gewinn je Aktie', g > 0 ? euro(g) : '—']);
      const dr = markt.divRendite(app.lauf, w, runde);
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
      const mk = markt.marktkapitalisierung(app.lauf, w, runde);
      zeilen.push(['Marktkapitalisierung', mk ? kompakt(mk) : '—']);
      zeilen.push(['Umlaufmenge', w.umlaufmenge ? w.umlaufmenge.toLocaleString('de-DE', { maximumFractionDigits: 0 }) : '—']);
      zeilen.push(['Höchstmenge', w.hoechstmenge ? w.hoechstmenge.toLocaleString('de-DE', { maximumFractionDigits: 0 }) : 'unbegrenzt']);
      zeilen.push(['Allzeithoch (real)', w.allzeithoch ? euro(w.allzeithoch, 2) : '—']);
    }
    return zeilen;
  }

  /* Kursverlauf. Auf einer Zeichenfläche ist ein Chart ein paar Linien —
     keine Fremdbibliothek nötig. */
  function chart(app, w, runde) {
    const h = 120;
    const r = ui.reserviere(h, { abstand: 6 });
    const reihe = app.lauf.kurse[w.id];
    if (!reihe || runde < 1) {
      ui.schreibe('Der Verlauf entsteht ab der zweiten Runde.', r.x + r.b / 2, r.y + h / 2, {
        groesse: 13, farbe: F.gedaempft, ausrichtung: 'center',
      });
      return;
    }

    let hoch = reihe[0];
    let tief = reihe[0];
    for (let i = 0; i <= runde; i++) {
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

    const gestiegen = reihe[runde] >= reihe[0];
    ctx.strokeStyle = gestiegen ? GRUEN : ROT;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= runde; i++) {
      const x = r.x + (i / Math.max(1, runde)) * r.b;
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
    const stand = app.eigenerStand();

    ui.scroll('roll-depot', inhaltsHoehe(app), function () {
      const griff = ui.beginneKarte('karte-depot');
      ui.absatz('Depotwert', { groesse: 13, abstand: 2 });
      const rz = ui.reserviere(36, { abstand: 2 });
      ui.schreibe(euro(stand.gesamt), rz.x, rz.y + 20, { groesse: 27, fett: true, farbe: F.text });
      ui.absatz(prozent(stand.rendite, 2) + '  gegenüber ' + euro(app.regeln().startgeld, 0) + ' Startgeld', {
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
        ui.absatz('Noch nichts gekauft. Im Markt findest du ' + app.werteListe.length + ' Werte.', {
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
     6. RANGLISTE — und der Ausstieg aus der Partie
     ====================================================================== */

  function rangliste(app) {
    const reihen = app.rangliste();
    const z = app.zustand;

    ui.scroll('roll-rang', inhaltsHoehe(app), function () {
      ui.absatz('Wer liegt vorn?', { fett: true, farbe: F.text, abstand: 8 });
      let platz = 0;
      for (const e of reihen) {
        platz++;
        const zeile = ui.reserviere(56, { abstand: 6 });
        const ist = e.uid === z.uid;
        ui.fuelleRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, ist ? '#e3edfb' : F.karte);
        if (ist) ui.rahmeRund(zeile.x, zeile.y, zeile.b, zeile.h, ui.RADIUS_KLEIN, F.primaer, 2);

        const medaille = platz === 1 ? '🥇' : platz === 2 ? '🥈' : platz === 3 ? '🥉' : String(platz) + '.';
        ui.schreibe(medaille, zeile.x + 14, zeile.y + zeile.h / 2, {
          groesse: platz <= 3 ? 20 : 15, fett: true, farbe: F.gedaempft,
        });

        ui.schreibe(ui.kuerze((e.zeichen ? e.zeichen + ' ' : '') + e.name, zeile.b - 170, 15, true),
          zeile.x + 52, zeile.y + 21, { groesse: 15, fett: true, farbe: F.text });
        /* Wer schon abgeschlossen hat, ist sichtbar — sonst rätselt man, auf
           wen die Runde noch wartet. */
        let unten = e.trades + ' Aufträge';
        if (e.istBot) unten += '  ·  KI';
        else if (e.raus) unten += '  ·  ausgestiegen';
        else if (e.fertig) unten += '  ·  ✓ fertig';
        ui.schreibe(unten, zeile.x + 52, zeile.y + 40, { groesse: 12, farbe: F.gedaempft });

        ui.schreibe(euro(e.gesamt, 0), zeile.x + zeile.b - 12, zeile.y + 21, {
          groesse: 15, fett: true, farbe: F.text, ausrichtung: 'right',
        });
        ui.schreibe(prozent(e.rendite, 1), zeile.x + zeile.b - 12, zeile.y + 40, {
          groesse: 13, fett: 'halb', farbe: farbeFuer(e.rendite), ausrichtung: 'right',
        });
      }

      ui.luecke(10);
      ui.absatz('Alle rechnen dieselben Kurse aus derselben Zufallszahl — niemand sieht andere Preise als du.', {
        groesse: 12, zentriert: true, abstand: 14,
      });

      /* Ausstieg. Beim Host beendet er die Partie für alle, deshalb steht
         eine Rückfrage davor. */
      ui.trenner('', { abstand: 10 });
      if (z.istHost) {
        if (ui.knopf('btn-abbrechen', 'Partie abbrechen', { art: 'zweit', abstand: 6 })) {
          app.abbruchFrage = true;
        }
        ui.absatz('Beendet die Partie für alle. Das Ergebnis zählt dann nicht für die Bestenliste.', {
          groesse: 11, zentriert: true, abstand: 4,
        });
      } else {
        if (ui.knopf('btn-aussteigen', 'Partie verlassen', { art: 'zweit', abstand: 6 })) {
          app.abbruchFrage = true;
        }
        ui.absatz('Die anderen spielen ohne dich weiter. Dein Depot bleibt in der Rangliste stehen.', {
          groesse: 11, zentriert: true, abstand: 4,
        });
      }
    });
  }

  /* Rückfrage vor dem Abbruch — ein Fehltipp würde sonst für alle die
     Partie beenden. */
  function abbruchDialog(app) {
    const z = app.zustand;
    const istHost = z.istHost;

    ui.abdunkeln(0.55);
    const griff = ui.beginneDialog('dlg-abbruch', { maxHoehe: ui.hoehe - 40 });

    ui.titel(istHost ? 'Partie wirklich abbrechen?' : 'Partie wirklich verlassen?', {
      groesse: 19, abstand: 6,
    });
    ui.absatz(istHost
      ? 'Die Partie endet sofort für alle Mitspieler. Ihr seht noch die Abrechnung, aber das Ergebnis zählt nicht für die Bestenliste.'
      : 'Du steigst aus und kannst nicht zurück. Die anderen spielen ohne dich weiter — dein jetziges Depot bleibt in ihrer Rangliste stehen.',
      { groesse: 14, abstand: 14 });

    if (ui.knopf('btn-abbruch-ja', istHost ? 'Ja, abbrechen' : 'Ja, verlassen', { abstand: 8 })) {
      app.abbruchFrage = false;
      if (istHost) app.brichAb(); else app.verlassen();
    }
    if (ui.knopf('btn-abbruch-nein', 'Weiterspielen', { art: 'zweit', hoehe: 40 })) {
      app.abbruchFrage = false;
    }

    ui.beendeDialog(griff);
  }

  /* ======================================================================
     7. NACHRICHTEN-ARCHIV
     ====================================================================== */

  function ticker(app) {
    const runde = app.runde();
    const liste = markt.meldungenBis(app.lauf, runde);

    ui.scroll('roll-news', inhaltsHoehe(app), function () {
      if (!liste.length) {
        ui.absatz('Noch keine Meldungen. Es geht gleich los.', { zentriert: true, abstand: 10 });
        return;
      }
      ui.absatz('Alle Meldungen bis jetzt, neueste zuerst.', { groesse: 12, abstand: 8 });
      for (let i = 0; i < liste.length; i++) {
        const m = liste[i];
        const griff = ui.beginneKarte('news-' + m.runde + '-' + i, { polster: 12 });
        const marke = markeFuer(m);
        ui.absatz(marke.text + '  ·  Runde ' + (m.runde + 1), {
          groesse: 11, fett: 'halb', farbe: marke.farbe, abstand: 4,
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
    const runde = app.runde();
    const kurs = markt.kurs(app.lauf, w.id, runde);
    const stand = app.eigenerStand();
    const istKauf = h.art === 'kauf';

    ui.abdunkeln(0.55);
    const griff = ui.beginneDialog('dlg-handel', { maxHoehe: ui.hoehe - 40 });

    ui.titel((istKauf ? 'Kaufen: ' : 'Verkaufen: ') + w.name, { groesse: 19, abstand: 4 });
    ui.absatz('Kurs jetzt ' + kursText(kurs) + '  ·  frei ' + euro(stand.cash, 0), {
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

    ui.absatz('Ausgeführt wird sofort zum angezeigten Kurs. Die Nachrichten dieser Runde wirken erst danach.', {
      groesse: 11, abstand: 10,
    });

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
    const z = app.zustand;
    const eigener = reihen.findIndex(function (e) { return e.uid === z.uid; });

    ui.beginneSeite();
    kopfzeile(app);

    ui.scroll('roll-ende', ui.hoeheRest(), function () {
      ui.titel(z.abgebrochen ? 'Partie abgebrochen' : 'Abgerechnet!', { zentriert: true, abstand: 4 });
      ui.absatz(z.abgebrochen
        ? 'Die Partie wurde vorzeitig beendet. Das Ergebnis zählt nicht für die Bestenliste.'
        : (z.runden || markt.STANDARD_RUNDEN) + ' Runden, ' +
          Math.round((z.runden || markt.STANDARD_RUNDEN) / markt.RUNDEN_JE_JAHR) + ' Börsenjahre.', {
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
        const ist = e.uid === z.uid;
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
      if (z.istHost) {
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
        ['So läuft es', 'Der Eröffner stellt ein, wie viel Startgeld es gibt, wie hoch die Ordergebühr ist und wie viel höchstens in einen einzelnen Wert darf. Gespielt wird in 20, 50 oder 100 Runden — zehn Runden sind ein Börsenjahr. Wer am Ende das wertvollste Depot hat, gewinnt.'],
        ['Ihr bestimmt das Tempo', 'Es läuft keine Uhr. In jeder Runde erscheinen Nachrichten, jeder handelt so lange er will, und erst wenn ALLE die Runde abgeschlossen haben, bewegen sich die Kurse. Wer noch fehlt, steht unter dem Knopf. Der Eröffner kann weiterschalten, wenn jemand nicht mehr reagiert.'],
        ['Die Werte sind echt', WERTE.werte.length + ' Werte mit echten Startkursen und Kennzahlen vom ' + WERTE.stand.split('-').reverse().join('.') + ': ' + WERTE.werte.filter(function (w) { return w.art === 'aktie'; }).length + ' Aktien, ' + WERTE.werte.filter(function (w) { return w.art === 'etf'; }).length + ' ETFs und ' + WERTE.werte.filter(function (w) { return w.art === 'krypto'; }).length + ' Kryptowährungen.'],
        ['Der Verlauf ist erfunden', 'Ab dem Start läuft eine Simulation. Die Kursentwicklung hat nichts mit der Wirklichkeit zu tun und ist keine Vorhersage.'],
        ['Nachrichten entscheiden', 'Die Meldungen einer Runde stehen ganz oben — sie bewegen die Kurse erst beim Rundenwechsel. Du hast also Zeit, sie zu lesen und zu handeln, bevor sie wirken. Vorsicht bei Gerüchten: sie werden zwei Runden später bestätigt oder dementiert, und ein Dementi dreht die Bewegung stärker zurück, als sie hingegangen ist.'],
        ['Kennzahlen rechnen mit', 'Das KGV ist keine Zierzahl: es wird laufend aus Kurs und Gewinn je Aktie neu gerechnet. Ein Wert mit KGV 8 ist günstig bewertet, einer mit KGV 90 heiß gelaufen.'],
        ['Streuen ist Pflicht', 'Der eingestellte Höchstanteil gilt beim KAUF. Wächst eine Position danach darüber hinaus, darfst du sie behalten — das hast du dir verdient. Die Grenze lässt sich beim Eröffnen bis auf "alles" öffnen; dann kann ein einziger Treffer die Partie entscheiden.'],
        ['Was Handeln kostet', 'Die Ordergebühr ist einstellbar (keine, 0,25 % oder 1 %, mindestens 1 €). Hektisches Hin und Her kostet damit Geld — wie in echt.'],
        ['Dividenden', 'Alle zehn Runden wird auf den gehaltenen Bestand ausgeschüttet. Wer erst danach kauft, geht leer aus.'],
        ['Alle sehen dieselben Kurse', 'Der ganze Verlauf entsteht aus einer einzigen Zufallszahl, die beim Eröffnen gezogen wird. Jedes Handy rechnet ihn selbst — deshalb laufen Kurse und Meldungen auch im Funkloch weiter. Nur Käufe und Zustimmungen holen später auf.'],
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
    newsBlock(app);
    reiter(app, [
      { id: 'markt', text: 'Markt' },
      { id: 'depot', text: 'Depot' },
      { id: 'rang', text: 'Rangliste' },
      { id: 'news', text: 'Archiv' },
    ]);
    if (app.reiter === 'markt') markt_(app);
    else if (app.reiter === 'depot') depotAnsicht(app);
    else if (app.reiter === 'rang') rangliste(app);
    else ticker(app);

    /* ZULETZT: die Leiste liegt über dem Inhalt und muss nach ihm gezeichnet
       werden, sonst scrollt die Marktliste darüber hinweg. */
    rundenLeiste(app);
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
    abbruchDialog: abbruchDialog,
    sortenFuer: sortenFuer,
    euro: euro,
    prozent: prozent,
    kursText: kursText,
    stueckText: stueckText,
    farbeFuer: farbeFuer,
  };
})();
