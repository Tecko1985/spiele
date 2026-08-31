/* ==========================================================================
   Letzte Karte — die Bildschirme
   ==========================================================================

   Alles wird auf EINE Zeichenfläche gemalt (quartett/ui.js, unmittelbarer
   Modus). Jede Funktion hier beschreibt ein vollständiges Bild und meldet
   Tipper direkt zurück — es gibt keinen Baum aus Elementen, der mit dem
   Spielzustand synchron gehalten werden müsste.

   DIE HAND IST DER SCHWIERIGE TEIL.
   Bei Gnadenlos liegen bis zu 24 Karten auf der Hand, und der Bildschirm ist
   360 Pixel breit. Gelöst mit einem Fächer, dessen Überlappung sich der
   Anzahl anpasst, und mit ZWEI Tippern: der erste wählt eine Karte aus und
   hebt sie vollständig sichtbar an, der zweite legt sie. Direktes Legen mit
   einem Tipper wäre schneller — aber im fahrenden Bus trifft man zwischen
   überlappenden Karten regelmäßig die falsche, und eine versehentlich
   gelegte Karte lässt sich nicht zurücknehmen.
   ========================================================================== */

const bildschirme = (function () {
  'use strict';

  /* Das Seitenverhältnis einer Spielkarte. Alle Kartenmaße werden daraus
     gerechnet — feste Pixelgrößen wären auf einem großen Handy verloren und
     auf einem kleinen zu groß. */
  const KARTE_VERHAELTNIS = 58 / 86;

  /* Feste Anteile des Tisches. Was übrig bleibt, gehört der Mitte. */
  const KOPF_H = 60;
  const PROTOKOLL_H = 30;

  /**
   * Teilt die Bildschirmhöhe auf.
   *
   * ⚠️ Gerechnet wird von UNTEN: die Hand bekommt ihren Anteil zuerst, denn
   * dort liegt der Daumen und dort passiert das Spiel. Der erste Entwurf
   * reservierte feste Höhen von oben nach unten und deckelte die Karten bei
   * 86 px — auf einem 390×844-Handy blieben dadurch 410 Pixel unter der Hand
   * einfach leer, und alles wirkte oben zusammengedrängt und winzig.
   */
  function masze() {
    const h = ui.hoehe;
    const b = ui.breite;

    const mitspieler = Math.round(Math.max(62, Math.min(84, h * 0.085)));
    const aktion = Math.round(Math.max(46, Math.min(58, h * 0.062)));

    /* Die Hand bekommt gut ein Drittel — genug für zwei Kartenreihen, ohne
       der Tischmitte den Platz zu nehmen. */
    let hand = Math.round(h * 0.34);
    const festeAnteile = KOPF_H + mitspieler + PROTOKOLL_H + aktion;
    let mitte = h - festeAnteile - hand;

    /* Auf sehr flachen Bildschirmen (altes iPhone SE quer, Tastatur offen)
       geht der Mitte zuerst der Platz aus. Dann von der Hand abgeben, bis
       beide eine brauchbare Höhe haben. */
    const MITTE_MIN = 150;
    if (mitte < MITTE_MIN) {
      const fehlt = MITTE_MIN - mitte;
      hand = Math.max(96, hand - fehlt);
      mitte = h - festeAnteile - hand;
    }

    return {
      mitspieler: mitspieler,
      aktion: aktion,
      mitte: Math.max(120, mitte),
      hand: hand,
      breite: b,
    };
  }

  /** Kartenhöhe zu einer gegebenen Breite und umgekehrt. */
  function kartenBreiteZuHoehe(h) { return Math.round(h * KARTE_VERHAELTNIS); }

  /* ----------------------------------------------------------------------
     Eine Karte zeichnen
     ---------------------------------------------------------------------- */

  /**
   * @param opt.gedaempft   nicht legbar — blass
   * @param opt.angehoben   ausgewählt — sitzt höher und hat einen Rahmen
   * @param opt.klein       Miniatur (Aufdeckung, Abrechnung)
   * @param opt.rueckseite  verdeckte Karte (Nachziehstapel, fremde Hand)
   */
  function zeichneKarte(x, y, b, h, karte, dunkel, opt) {
    const o = opt || {};
    const ctx = ui.ctx;
    const r = Math.round(Math.min(10, b * 0.16));

    if (o.rueckseite) {
      ui.fuelleRund(x, y, b, h, r, '#243043');
      ui.rahmeRund(x, y, b, h, r, 'rgba(255,255,255,0.55)', 2);
      ui.ctx.stroke();
      /* Ein schräges Band als Rückenmuster — reicht, um den verdeckten
         Stapel auf einen Blick vom offenen zu unterscheiden. */
      ctx.save();
      ctx.beginPath();
      ui.rundesRechteck(x, y, b, h, r);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(3, b * 0.09);
      for (let i = -h; i < b + h; i += Math.max(9, b * 0.22)) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    const t = karten.teile(karte, dunkel);
    const grund = karten.FARBWERT[t.farbe] || '#3a3f4b';
    const schrift = karten.SCHRIFTWERT[t.farbe] || '#ffffff';

    ctx.save();
    if (o.gedaempft) ctx.globalAlpha = 0.34;

    if (o.angehoben) { ui.schatten(14); }
    ui.fuelleRund(x, y, b, h, r, grund);
    if (o.angehoben) ui.keinSchatten();

    /* Der weiße Innenrand ist das, was eine Spielkarte als Spielkarte lesbar
       macht — ohne ihn verschwimmen mehrere gleichfarbige Karten im Fächer
       zu einer Fläche. */
    ui.rahmeRund(x + 3, y + 3, b - 6, h - 6, Math.max(4, r - 3), 'rgba(255,255,255,0.85)', 2);
    ctx.stroke();

    /* Farbwahlkarten tragen keine eigene Farbe, sondern alle vier als
       Viertelkreise — sonst wäre nicht zu sehen, wofür sie gut sind. */
    if (t.farbe === 'w') {
      const farben = karten.farbenFuer(
        dunkel ? 'wende' : (karte.indexOf('|') >= 0 ? 'wende' : 'klassisch'), dunkel);
      const mx = x + b / 2;
      const my = y + h / 2;
      const rad = Math.min(b, h) * 0.27;
      ctx.save();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.arc(mx, my, rad, (i * Math.PI) / 2, ((i + 1) * Math.PI) / 2);
        ctx.closePath();
        ctx.fillStyle = karten.FARBWERT[farben[i]] || '#888';
        ctx.fill();
      }
      ctx.restore();
    }

    const zeichen = karten.zeichen(karte, dunkel);
    const gross = Math.round(h * (zeichen.length > 2 ? 0.26 : 0.40));
    ui.schreibe(zeichen, x + b / 2, y + h / 2 + (t.farbe === 'w' ? h * 0.30 : 0), {
      groesse: gross, fett: true, farbe: schrift, ausrichtung: 'center',
    });

    /* Kleines Zeichen in der Ecke — so bleibt eine Karte im Fächer
       erkennbar, auch wenn nur ihr linker Streifen zu sehen ist. */
    if (!o.klein) {
      ui.schreibe(zeichen, x + 8, y + 12, {
        groesse: Math.max(9, Math.round(h * 0.14)), fett: true, farbe: schrift, ausrichtung: 'left',
      });
    }

    if (o.angehoben) {
      ui.rahmeRund(x - 2, y - 2, b + 4, h + 4, r + 2, '#111827', 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ----------------------------------------------------------------------
     Kopfzeile
     ---------------------------------------------------------------------- */

  function kopf(app, titelText, opt) {
    const o = opt || {};
    const h = 60;
    const ctx = ui.ctx;
    ctx.fillStyle = ui.F.primaer;
    ctx.fillRect(0, 0, ui.breite, h);

    const r = ui.reserviere(h, { abstand: 0 });

    if (o.zurueck) {
      const zr = { x: 8, y: 10, b: 74, h: 40 };
      ui.merke('kopf-zurueck', zr, 'knopf');
      ui.fuelleRund(zr.x, zr.y, zr.b, zr.h, 999, 'rgba(255,255,255,0.15)');
      ui.schreibe('‹ Zurück', zr.x + zr.b / 2, zr.y + zr.h / 2, {
        groesse: 13, fett: 'halb', farbe: '#fff', ausrichtung: 'center',
      });
      if (ui.geklickt(zr)) o.zurueck();
    }

    ui.schreibe(titelText, ui.breite / 2, h / 2 - (o.unter ? 8 : 0), {
      groesse: 17, fett: true, farbe: '#fff', ausrichtung: 'center',
    });
    if (o.unter) {
      ui.schreibe(o.unter, ui.breite / 2, h / 2 + 11, {
        groesse: 12, farbe: 'rgba(255,255,255,0.85)', ausrichtung: 'center',
      });
    }

    if (o.rechts) {
      const rr = { x: ui.breite - 82, y: 10, b: 74, h: 40 };
      ui.merke('kopf-rechts', rr, 'knopf');
      ui.fuelleRund(rr.x, rr.y, rr.b, rr.h, 999, 'rgba(255,255,255,0.15)');
      ui.schreibe(o.rechtsText || 'Beenden', rr.x + rr.b / 2, rr.y + rr.h / 2, {
        groesse: 13, fett: 'halb', farbe: '#fff', ausrichtung: 'center',
      });
      if (ui.geklickt(rr)) o.rechts();
    }
    return r;
  }

  /* ----------------------------------------------------------------------
     Startbildschirm
     ---------------------------------------------------------------------- */

  function start(app) {
    kopf(app, 'Letzte Karte');
    ui.seite('start', function () {
      ui.luecke(6);
      ui.titel('Letzte Karte', { zentriert: true, groesse: 27 });
      /* „Uno-Klon“ steht hier als BESCHREIBUNG, nicht als Name — man darf
         sagen, wonach das eigene Spiel gemacht ist. Der Name der App bleibt
         eigenständig, und der Satz im Info-Tab, dass keine Verbindung zu
         Mattel besteht, gehört seitdem erst recht dazu. */
      ui.absatz('Der Uno-Klon für die Busfahrt. Wer als Erster keine Karte mehr hat, gewinnt.',
        { zentriert: true });
      ui.luecke(10);

      ui.absatz('Dein Name', { fett: true, farbe: ui.F.text, groesse: 13 });
      const name = ui.eingabe('name', { platzhalter: 'z. B. Michel', anfangswert: app.name, maxLaenge: 18 });
      if (name !== app.name) { app.name = name; app.merkeName(); }

      ui.luecke(6);
      if (ui.knopf('neu', 'Neue Partie eröffnen', { aus: !app.name.trim() })) app.geheZu('neu');
      if (ui.knopf('beitreten', 'Einer Partie beitreten', { art: 'zweit', aus: !app.name.trim() })) app.geheZu('beitreten');
      if (!app.name.trim()) {
        ui.absatz('Trag zuerst deinen Namen ein.', { zentriert: true, groesse: 12 });
      }

      ui.luecke(14);
      if (ui.knopf('info', 'Regeln und Änderungen', { art: 'link' })) app.geheZu('info');
    }, { zentriert: true, maxBreite: 420 });
  }

  /* ----------------------------------------------------------------------
     Neue Partie einstellen
     ---------------------------------------------------------------------- */

  function neu(app) {
    kopf(app, 'Neue Partie', { zurueck: function () { app.geheZu('start'); } });
    ui.seite('neu', function () {
      ui.titel('Spielart', { groesse: 19 });

      for (const m of karten.MODI) {
        const gewaehlt = app.entwurf.modus === m.id;
        const griff = ui.beginneKarte('modus-' + m.id, {});
        ui.luecke(2);
        ui.absatz(m.name + (gewaehlt ? '   ✓' : ''), {
          fett: true, groesse: 16, farbe: gewaehlt ? ui.F.primaer : ui.F.text,
        });
        ui.absatz(m.beschreibung, { groesse: 12 });
        ui.luecke(2);
        const r = ui.beendeKarte(griff);
        ui.merke('modus-' + m.id, r, 'knopf');
        if (gewaehlt) { ui.rahmeRund(r.x, r.y, r.b, r.h, ui.RADIUS, ui.F.primaer, 2); ui.ctx.stroke(); }
        if (ui.geklickt(r)) app.entwurf.modus = m.id;
      }

      ui.luecke(6);
      ui.titel('Einstellungen', { groesse: 19 });

      ui.absatz('KI-Mitspieler', { fett: true, farbe: ui.F.text, groesse: 13 });
      reihenAuswahl(app, 'bots', ['0', '1', '2', '3', '4', '5'], String(app.entwurf.botAnzahl), function (w) {
        app.entwurf.botAnzahl = Number(w);
      });

      ui.luecke(4);
      ui.absatz('Bedenkzeit je Zug', { fett: true, farbe: ui.F.text, groesse: 13 });
      const zeitTexte = gameService.ZUGZEITEN.map(function (z) { return z === 0 ? 'aus' : z + ' s'; });
      reihenAuswahl(app, 'zeit', zeitTexte, app.entwurf.zugSekunden === 0 ? 'aus' : app.entwurf.zugSekunden + ' s',
        function (w, i) { app.entwurf.zugSekunden = gameService.ZUGZEITEN[i]; });
      ui.absatz('Läuft die Zeit ab, wird für den Trödler eine Karte gezogen. Dreimal verpasst — die KI übernimmt.',
        { groesse: 11 });

      ui.luecke(4);
      ui.absatz('Länge', { fett: true, farbe: ui.F.text, groesse: 13 });
      reihenAuswahl(app, 'serie', ['Eine Runde', 'Serie'], app.entwurf.serie ? 'Serie' : 'Eine Runde',
        function (w) { app.entwurf.serie = (w === 'Serie'); });
      if (app.entwurf.serie) {
        ui.absatz('Gespielt wird, bis jemand ' + karten.modus(app.entwurf.modus).zielPunkte + ' Punkte hat.',
          { groesse: 11 });
      }

      ui.luecke(10);
      if (ui.knopf('eroeffnen', app.laeuft ? 'Wird eröffnet …' : 'Partie eröffnen', { aus: app.laeuft })) {
        app.eroeffne();
      }
      if (app.fehler) ui.absatz(app.fehler, { farbe: ui.F.gefahr, zentriert: true, groesse: 13 });
    }, { maxBreite: 460 });
  }

  /** Eine Reihe gleich breiter Schalter — kompakter als eine Auswahlliste. */
  function reihenAuswahl(app, id, texte, wert, beiWahl) {
    const r = ui.reserviere(42);
    const lueckeB = 6;
    const b = (r.b - lueckeB * (texte.length - 1)) / texte.length;
    for (let i = 0; i < texte.length; i++) {
      const x = r.x + i * (b + lueckeB);
      const feld = { x: x, y: r.y, b: b, h: r.h };
      const an = texte[i] === wert;
      ui.fuelleRund(x, r.y, b, r.h, 10, an ? ui.F.primaer : ui.F.karte);
      if (!an) { ui.rahmeRund(x, r.y, b, r.h, 10, ui.F.rand, 1); ui.ctx.stroke(); }
      ui.schreibe(texte[i], x + b / 2, r.y + r.h / 2, {
        groesse: 13, fett: 'halb', farbe: an ? '#fff' : ui.F.text, ausrichtung: 'center',
      });
      ui.merke(id + '-' + i, feld, 'knopf');
      if (ui.geklickt(feld)) beiWahl(texte[i], i);
    }
  }

  /* ----------------------------------------------------------------------
     Beitreten
     ---------------------------------------------------------------------- */

  function beitreten(app) {
    kopf(app, 'Beitreten', { zurueck: function () { app.geheZu('start'); } });
    ui.seite('beitreten', function () {
      ui.titel('Raum-Code', { zentriert: true, groesse: 21 });
      ui.absatz('Sechs Zeichen, die dir der Eröffner vorliest.', { zentriert: true });
      ui.luecke(6);
      /* `grossschreiben` macht die Umwandlung schon im Eingabefeld — sonst
         sähe man beim Tippen Kleinbuchstaben, die hinterher springen. */
      const code = ui.eingabe('code', {
        platzhalter: 'ABC123', anfangswert: app.codeEingabe,
        maxLaenge: 6, grossschreiben: true, zentriert: true, groesse: 24, fett: true,
      });
      if (code !== app.codeEingabe) app.codeEingabe = code;
      ui.luecke(6);
      if (ui.knopf('los', app.laeuft ? 'Verbinde …' : 'Beitreten', { aus: app.laeuft || String(app.codeEingabe || '').length !== 6 })) {
        app.tritteBei();
      }
      if (app.fehler) ui.absatz(app.fehler, { farbe: ui.F.gefahr, zentriert: true, groesse: 13 });
    }, { zentriert: true, maxBreite: 400 });
  }

  /* ----------------------------------------------------------------------
     Lobby
     ---------------------------------------------------------------------- */

  function lobby(app) {
    const z = app.zustand;
    const raum = z.raum || {};
    const istHost = z.istHost;
    const m = karten.modus((raum.regeln || {}).modus);

    kopf(app, 'Warteraum', {
      unter: m.name,
      rechts: function () { app.frageAussteigen = true; },
      rechtsText: istHost ? 'Abbrechen' : 'Raus',
    });

    ui.seite('lobby', function () {
      ui.titel('Raum-Code', { zentriert: true, groesse: 15, farbe: ui.F.gedaempft });
      const r = ui.reserviere(58);
      ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS, ui.F.primaer);
      ui.schreibe(z.code || '……', r.x + r.b / 2, r.y + r.h / 2, {
        groesse: 32, fett: true, farbe: '#fff', ausrichtung: 'center',
      });
      ui.absatz('Diesen Code den anderen vorlesen.', { zentriert: true, groesse: 12 });

      ui.luecke(8);
      const spieler = raum.spieler || {};
      const namen = Object.keys(spieler);
      ui.titel('Dabei (' + namen.length + ')', { groesse: 17 });
      for (const uid of namen) {
        const griff = ui.beginneKarte('sp-' + uid, {});
        ui.absatz(spieler[uid].name + (uid === raum.hostId ? '   · Eröffner' : '') + (uid === z.uid ? '   · du' : ''),
          { fett: true, farbe: ui.F.text, groesse: 15 });
        ui.beendeKarte(griff);
      }
      const botAnzahl = (raum.regeln || {}).botAnzahl || 0;
      if (botAnzahl > 0) {
        for (const b of bots.feld(botAnzahl)) {
          const griff = ui.beginneKarte('bot-' + b.uid, {});
          ui.absatz(b.zeichen + '  ' + b.name + '   · KI', { farbe: ui.F.gedaempft, groesse: 15 });
          ui.beendeKarte(griff);
        }
      }

      ui.luecke(8);
      if (istHost) {
        ui.absatz('Einstellungen lassen sich hier noch ändern.', { groesse: 12 });
        ui.absatz('KI-Mitspieler', { fett: true, farbe: ui.F.text, groesse: 13 });
        reihenAuswahl(app, 'lbots', ['0', '1', '2', '3', '4', '5'], String(botAnzahl), function (w) {
          app.aendereRegeln({ botAnzahl: Number(w) });
        });
        ui.luecke(10);
        const genug = namen.length + botAnzahl >= 2;
        if (ui.knopf('start', genug ? 'Losspielen' : 'Mindestens zwei Spieler', { aus: !genug })) {
          gameService.starteRaum();
        }
      } else {
        ui.absatz('Warte auf den Eröffner …', { zentriert: true });
      }
    }, { maxBreite: 460 });
  }

  /* ----------------------------------------------------------------------
     Der Tisch
     ---------------------------------------------------------------------- */

  function spiel(app) {
    const z = app.zustand;
    const t = z.tisch;
    if (!t) { ladeBild('Karten werden gemischt …'); return; }

    const m = karten.modus(t.modus);
    const binDran = regeln.dran({ tisch: t }) === z.uid;
    const hand = z.hand || [];
    const M = masze();

    kopf(app, m.name, {
      unter: t.dunkel ? 'Dunkle Seite' : null,
      rechts: function () { app.frageAussteigen = true; },
      rechtsText: z.istHost ? 'Abbrechen' : 'Raus',
    });

    /* ---- Mitspieler oben ---- */
    mitspielerReihe(app, t, z, M);

    /* ---- Tischmitte ---- */
    tischMitte(app, t, z, binDran, M);

    /* ---- Protokoll ---- */
    const prot = z.protokoll || [];
    const pr = ui.reserviere(PROTOKOLL_H, { links: 12, rechts: 12, abstand: 0 });
    if (prot.length) {
      ui.fuelleRund(pr.x, pr.y, pr.b, pr.h, 8, 'rgba(17,24,39,0.05)');
      ui.schreibe(ui.kuerze(prot[prot.length - 1], pr.b - 16, 12), pr.x + pr.b / 2, pr.y + pr.h / 2,
        { groesse: 12, farbe: ui.F.gedaempft, ausrichtung: 'center' });
    }

    /* ---- Aktionsleiste ---- */
    aktionsLeiste(app, t, z, binDran, hand, M);

    /* ---- Die eigene Hand ---- */
    handFaecher(app, t, z, binDran, hand, M);
  }

  function ladeBild(text) {
    ui.seite('laden', function () {
      ui.luecke(40);
      ui.absatz(text, { zentriert: true });
    }, { zentriert: true });
  }

  function mitspielerReihe(app, t, z, M) {
    const alle = t.reihenfolge || [];
    const andere = alle.filter(function (u) { return u !== z.uid; });
    if (!andere.length) { ui.luecke(M.mitspieler); return; }

    const r = ui.reserviere(M.mitspieler, { links: 8, rechts: 8, abstand: 0 });
    const lueckeB = 5;
    const b = Math.min(96, (r.b - lueckeB * (andere.length - 1)) / andere.length);
    const gesamt = b * andere.length + lueckeB * (andere.length - 1);
    let x = r.x + (r.b - gesamt) / 2;

    for (const uid of andere) {
      const dranJetzt = t.reihenfolge[t.dranIdx] === uid;
      const raus = !!(t.raus && t.raus[uid]);
      const fertig = (t.fertig || []).indexOf(uid) >= 0;
      const anzahl = (t.handAnzahl || {})[uid] || 0;
      const erwischbar = t.erwischbar === uid;

      const feld = { x: x, y: r.y, b: b, h: r.h };
      ui.fuelleRund(x, r.y, b, r.h, 10, dranJetzt ? '#e8f0fc' : ui.F.karte);
      ui.rahmeRund(x, r.y, b, r.h, 10, dranJetzt ? ui.F.primaer : ui.F.rand, dranJetzt ? 2 : 1);
      ui.ctx.stroke();

      /* Die drei Zeilen sitzen auf Anteilen der Kachelhöhe, nicht auf festen
         Pixeln — die Kachel wächst mit dem Bildschirm. */
      const name = app.nameVon(uid);
      ui.schreibe(ui.kuerze(name, b - 8, 12, 'halb'), x + b / 2, r.y + r.h * 0.23,
        { groesse: 12, fett: 'halb', farbe: raus ? ui.F.gedaempft : ui.F.text, ausrichtung: 'center' });

      const mitte = r.y + r.h * 0.56;
      if (raus) {
        ui.schreibe('raus', x + b / 2, mitte, { groesse: 13, fett: true, farbe: ui.F.gefahr, ausrichtung: 'center' });
      } else if (fertig) {
        ui.schreibe('fertig', x + b / 2, mitte, { groesse: 13, fett: true, farbe: ui.F.erfolg, ausrichtung: 'center' });
      } else {
        /* Ein gezeichnetes Kartensymbol statt eines Schriftzeichens: das
           Unicode-Zeichen für eine Spielkartenrückseite fehlt auf vielen
           Android-Geräten und erscheint dort als leeres Kästchen. */
        const zh = Math.max(15, r.h * 0.26);
        const zb = kartenBreiteZuHoehe(zh);
        const zx = x + b / 2 - (zb + 6 + ui.textBreite(String(anzahl), 17, true)) / 2;
        const zy = mitte - zh / 2;
        ui.fuelleRund(zx, zy, zb, zh, 3, anzahl === 1 ? ui.F.gefahr : '#243043');
        ui.schreibe(String(anzahl), zx + zb + 6, mitte, {
          groesse: 17, fett: true, farbe: anzahl === 1 ? ui.F.gefahr : ui.F.text, ausrichtung: 'left',
        });
      }

      if (anzahl === 1 && !raus && !fertig) {
        ui.schreibe(erwischbar ? 'still …' : 'letzte Karte', x + b / 2, r.y + r.h * 0.85, {
          groesse: 9, fett: 'halb', farbe: erwischbar ? ui.F.warnung : ui.F.gedaempft, ausrichtung: 'center',
        });
      }

      /* Antippen meldet jemanden, der zu rufen vergessen hat. */
      ui.merke('mit-' + uid, feld, 'knopf');
      if (erwischbar && ui.geklickt(feld)) app.melde(uid);

      x += b + lueckeB;
    }
  }

  function tischMitte(app, t, z, binDran, M) {
    const r = ui.reserviere(M.mitte, { abstand: 0 });
    const mx = r.x + r.b / 2;

    /* Die beiden Stapel füllen die Mitte aus. Unten bleibt Platz für die
       Statuszeile, seitlich muss das Paar plus Abstand in die Breite passen —
       auf einem schmalen Gerät begrenzt die Breite, auf einem hohen die Höhe. */
    const STATUS_H = 34;
    const lueckeMitte = Math.round(Math.max(24, r.b * 0.10));
    const nachHoehe = r.h - STATUS_H - 18;
    const nachBreite = kartenBreiteZuHoehe(1) > 0
      ? (r.b - lueckeMitte - 24) / 2 / KARTE_VERHAELTNIS
      : nachHoehe;
    const kh = Math.round(Math.max(84, Math.min(nachHoehe, nachBreite, 190)));
    const kb = kartenBreiteZuHoehe(kh);

    const ky = r.y + Math.max(6, (r.h - STATUS_H - kh) / 2);
    const stapelX = Math.round(mx - lueckeMitte / 2 - kb);
    const ablageX = Math.round(mx + lueckeMitte / 2);

    zeichneKarte(stapelX, ky, kb, kh, null, t.dunkel, { rueckseite: true });
    ui.schreibe(String(t.stapelRest || 0), stapelX + kb / 2, ky + kh / 2, {
      groesse: Math.round(kh * 0.22), fett: true, farbe: 'rgba(255,255,255,0.92)', ausrichtung: 'center',
    });

    const stapelFeld = { x: stapelX, y: ky, b: kb, h: kh };
    ui.merke('stapel', stapelFeld, 'knopf');
    if (binDran && !t.gezogen && ui.geklickt(stapelFeld)) app.ziehe();

    zeichneKarte(ablageX, ky, kb, kh, t.ablage, t.dunkel, {});

    /* Die geltende Farbe sitzt als Punkt an der Ecke der Ablage — bei einer
       Farbwahlkarte ist sie sonst nirgends abzulesen. */
    const ctx = ui.ctx;
    const punktR = Math.round(Math.max(10, kh * 0.11));
    ctx.beginPath();
    ctx.arc(ablageX + kb - punktR * 0.5, ky - punktR * 0.35, punktR, 0, Math.PI * 2);
    ctx.fillStyle = karten.FARBWERT[t.farbe] || '#888';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    /* Richtungspfeil zwischen den Stapeln. */
    ui.schreibe(t.richtung === 1 ? '↻' : '↺', mx, ky + kh / 2, {
      groesse: Math.round(Math.max(20, lueckeMitte * 0.8)), fett: true,
      farbe: ui.F.gedaempft, ausrichtung: 'center',
    });

    /* Statuszeile unten in der Mitte — immer an derselben Stelle, egal wie
       groß die Karten geraten sind. */
    const sy = r.y + r.h - STATUS_H;
    if (t.strafe > 0) {
      const sr = { x: r.x + 12, y: sy, b: r.b - 24, h: 28 };
      ui.fuelleRund(sr.x, sr.y, sr.b, sr.h, 8, '#fdecec');
      ui.schreibe(ui.kuerze('Es liegen ' + t.strafe + ' Karten an — kontern oder nehmen.', sr.b - 16, 12, 'halb'),
        sr.x + sr.b / 2, sr.y + sr.h / 2,
        { groesse: 12, fett: 'halb', farbe: ui.F.gefahr, ausrichtung: 'center' });
    } else {
      const wer = t.reihenfolge[t.dranIdx];
      const text = binDran ? 'Du bist dran.' : app.nameVon(wer) + ' ist dran.';
      ui.schreibe(ui.kuerze(text, r.b - 24, 14, 'halb'), mx, sy + 14, {
        groesse: 14, fett: 'halb', farbe: binDran ? ui.F.primaer : ui.F.gedaempft, ausrichtung: 'center',
      });
    }
  }

  function aktionsLeiste(app, t, z, binDran, hand, M) {
    const r = ui.reserviere(M.aktion, { links: 10, rechts: 10, abstand: 0 });
    const knoepfe = [];

    if (binDran) {
      if (t.strafe > 0 && !t.gezogen) knoepfe.push({ id: 'nehmen', text: t.strafe + ' nehmen', art: 'gefahr', tat: function () { app.ziehe(); } });
      else if (!t.gezogen) knoepfe.push({ id: 'ziehen', text: 'Ziehen', art: 'zweit', tat: function () { app.ziehe(); } });
      else if (!t.mussLegen) knoepfe.push({ id: 'passen', text: 'Weiter', art: 'zweit', tat: function () { app.passe(); } });

      if (t.anfechtbar && t.anfechtbar.uid !== z.uid) {
        knoepfe.push({ id: 'anfechten', text: 'Anfechten', art: 'gefahr', tat: function () { app.fechteAn(); } });
      }
    }

    if (hand.length === 2 && !(t.uno || {})[z.uid]) {
      knoepfe.push({ id: 'uno', text: 'Letzte Karte!', art: 'erfolg', tat: function () { app.rufeUno(); } });
    }
    if (t.erwischbar && t.erwischbar !== z.uid) {
      knoepfe.push({ id: 'melden', text: 'Erwischt!', art: 'erfolg', tat: function () { app.melde(t.erwischbar); } });
    }

    if (!knoepfe.length) {
      ui.schreibe(binDran ? 'Wähle eine Karte.' : 'Warte …', r.x + r.b / 2, r.y + r.h / 2,
        { groesse: 12, farbe: ui.F.gedaempft, ausrichtung: 'center' });
      return;
    }

    const lueckeB = 8;
    const b = (r.b - lueckeB * (knoepfe.length - 1)) / knoepfe.length;
    for (let i = 0; i < knoepfe.length; i++) {
      const k = knoepfe[i];
      const x = r.x + i * (b + lueckeB);
      const feld = { x: x, y: r.y, b: b, h: r.h };
      const farbe = k.art === 'gefahr' ? ui.F.gefahr : (k.art === 'erfolg' ? ui.F.erfolg : ui.F.karte);
      ui.fuelleRund(x, r.y, b, r.h, 10, farbe);
      if (k.art === 'zweit') { ui.rahmeRund(x, r.y, b, r.h, 10, ui.F.primaer, 1.5); ui.ctx.stroke(); }
      ui.schreibe(ui.kuerze(k.text, b - 12, 14, 'halb'), x + b / 2, r.y + r.h / 2, {
        groesse: 14, fett: 'halb', farbe: k.art === 'zweit' ? ui.F.primaer : '#fff', ausrichtung: 'center',
      });
      ui.merke('akt-' + k.id, feld, 'knopf');
      if (ui.geklickt(feld)) k.tat();
    }
  }

  /**
   * Der Fächer.
   *
   * Die Überlappung ergibt sich aus der Anzahl: solange alles nebeneinander
   * passt, liegen die Karten frei; danach rücken sie so weit zusammen, wie
   * nötig — mindestens 15 Pixel bleiben sichtbar, sonst wäre eine einzelne
   * Karte nicht mehr zu treffen. Gebrochen wird auf bis zu drei Reihen.
   */
  function handFaecher(app, t, z, binDran, hand, M) {
    /* Den ganzen Rest nehmen, nicht nur den zugeteilten Anteil: Rundungen in
       den Zeilen darüber sollen nicht als leerer Streifen am unteren Rand
       liegen bleiben. */
    const r = ui.reserviere(Math.max(M.hand, ui.hoeheRest()), { links: 6, rechts: 6, abstand: 0 });

    if (!hand.length) {
      ui.schreibe('Keine Karten mehr.', r.x + r.b / 2, r.y + r.h / 2,
        { groesse: 16, fett: 'halb', farbe: ui.F.erfolg, ausrichtung: 'center' });
      return;
    }

    const HINWEIS_H = 18;
    const RAND_OBEN = 8;
    const REIHEN_LUECKE = 6;
    const nutzbar = r.h - HINWEIS_H - RAND_OBEN;

    /* WIE VIELE REIHEN? Die, bei der die Karten am GRÖSSTEN werden.
       Zwei Grenzen begrenzen die Kartenhöhe gegeneinander:
         · die Höhe   — mehr Reihen heißt flachere Karten
         · die Breite — mehr Karten je Reihe heißt schmalere Karten, denn
                        sie sollen sich höchstens zu gut der Hälfte
                        überdecken; sonst stehen sie fast deckungsgleich
                        übereinander und man sieht von keiner mehr etwas
       Beide gegeneinander laufen zu lassen und die beste Reihenzahl zu
       nehmen, ist ehrlicher als eine Faustregel: sieben Karten passen zwar
       in eine Reihe, werden dort aber so breit gedrängt, dass zwei Reihen
       deutlich größere Karten ergeben. Bei Gleichstand gewinnt die kleinere
       Reihenzahl. */
    const UEBERDECKUNG = 0.55;
    const reihenMax = nutzbar >= 250 ? 3 : (nutzbar >= 150 ? 2 : 1);

    function hoeheBei(reihen) {
      const proReihe = Math.ceil(hand.length / reihen);
      const nachHoehe = (nutzbar - REIHEN_LUECKE * (reihen - 1)) / reihen;
      const kbMax = r.b / (1 + UEBERDECKUNG * Math.max(0, proReihe - 1));
      return Math.min(nachHoehe, kbMax / KARTE_VERHAELTNIS, ui.hoehe * 0.22);
    }

    let reihen = 1;
    let beste = hoeheBei(1);
    for (let n = 2; n <= Math.min(reihenMax, hand.length); n++) {
      const h = hoeheBei(n);
      if (h > beste + 0.5) { beste = h; reihen = n; }
    }

    const proReihe = Math.ceil(hand.length / reihen);
    const kh = Math.round(Math.max(64, beste));
    const kb = kartenBreiteZuHoehe(kh);

    /* Unter dieser Schrittweite ist eine verdeckte Karte nicht mehr zu
       treffen. Sie greift nur bei sehr vollen Händen auf schmalen Geräten. */
    const MIN_SCHRITT = 22;

    /* Schrittweite: volle Kartenbreite, wenn Platz ist, sonst gedrängt. */
    const schritt = Math.max(MIN_SCHRITT, Math.min(kb + 4, Math.floor((r.b - kb) / Math.max(1, proReihe - 1))));

    /* Der Block sitzt UNTEN in seiner Fläche — dort liegt der Daumen. */
    const blockH = reihen * kh + (reihen - 1) * REIHEN_LUECKE;
    const blockY = r.y + Math.max(RAND_OBEN, r.h - HINWEIS_H - blockH);

    const treffer = [];
    for (let reihe = 0; reihe < reihen; reihe++) {
      const von = reihe * proReihe;
      const bis = Math.min(hand.length, von + proReihe);
      const anzahl = bis - von;
      const breiteReihe = (anzahl - 1) * schritt + kb;
      const startX = r.x + Math.max(0, (r.b - breiteReihe) / 2);
      const y = blockY + reihe * (kh + REIHEN_LUECKE);
      const hub = Math.round(kh * 0.11);

      for (let i = von; i < bis; i++) {
        const x = startX + (i - von) * schritt;
        const gewaehlt = app.gewaehlt === i;
        const legbar = binDran && regeln.passt(t, hand[i]);
        zeichneKarte(x, gewaehlt ? y - hub : y, kb, kh, hand[i], t.dunkel, {
          angehoben: gewaehlt,
          gedaempft: binDran && !legbar,
        });
        treffer.push({ i: i, feld: { x: x, y: gewaehlt ? y - hub : y, b: kb, h: kh } });
      }
    }

    /* Von rechts nach links prüfen: die zuletzt gezeichnete Karte liegt
       oben, also muss sie den Tipper auch zuerst bekommen. */
    for (let k = treffer.length - 1; k >= 0; k--) {
      const eintrag = treffer[k];
      ui.merke('hand-' + eintrag.i, eintrag.feld, 'karte');
      if (ui.geklickt(eintrag.feld)) {
        if (app.gewaehlt === eintrag.i) app.legeGewaehlte();
        else app.gewaehlt = eintrag.i;
        break;
      }
    }

    if (app.gewaehlt !== null && app.gewaehlt < hand.length) {
      const legbar = binDran && regeln.passt(t, hand[app.gewaehlt]);
      ui.schreibe(legbar ? 'Nochmal antippen zum Legen' : (binDran ? 'Diese Karte passt nicht' : 'Du bist nicht dran'),
        r.x + r.b / 2, r.y + r.h - HINWEIS_H / 2,
        { groesse: 12, fett: 'halb', farbe: legbar ? ui.F.primaer : ui.F.gedaempft, ausrichtung: 'center' });
    }
  }

  /* ----------------------------------------------------------------------
     Farbwahl
     ---------------------------------------------------------------------- */

  function farbwahl(app) {
    const t = app.zustand.tisch;
    if (!t) return;
    const farben = karten.farbenFuer(t.modus, t.dunkel);
    const griff = ui.beginneDialog('farbwahl', { breite: 320 });
    ui.titel('Welche Farbe?', { zentriert: true, groesse: 19 });
    ui.absatz('Du legst eine Farbwahlkarte.', { zentriert: true, groesse: 12 });
    ui.luecke(4);

    for (let reihe = 0; reihe < 2; reihe++) {
      const r = ui.reserviere(56);
      const b = (r.b - 10) / 2;
      for (let s = 0; s < 2; s++) {
        const f = farben[reihe * 2 + s];
        const x = r.x + s * (b + 10);
        const feld = { x: x, y: r.y, b: b, h: r.h };
        ui.fuelleRund(x, r.y, b, r.h, 12, karten.FARBWERT[f]);
        ui.schreibe(karten.FARBNAME[f], x + b / 2, r.y + r.h / 2, {
          groesse: 15, fett: true, farbe: karten.SCHRIFTWERT[f], ausrichtung: 'center',
        });
        ui.merke('farbe-' + f, feld, 'knopf');
        if (ui.geklickt(feld)) app.bestaetigeFarbe(f);
      }
    }

    ui.luecke(2);
    if (ui.knopf('farbe-ab', 'Abbrechen', { art: 'link' })) app.farbwahlFuer = null;
    ui.beendeDialog(griff);
  }

  /* ----------------------------------------------------------------------
     Aufdeckung nach einer Anfechtung
     ---------------------------------------------------------------------- */

  function aufdeckung(app) {
    const t = app.zustand.tisch;
    const a = t.aufdeckung;
    if (!a) return;
    const griff = ui.beginneDialog('aufdeckung', { breite: 360 });
    ui.titel(a.schuldig ? 'Erwischt!' : 'Zu Unrecht angefochten', { zentriert: true, groesse: 18 });
    ui.absatz(app.nameVon(a.uid) + ' hatte diese Karten, als die Farbwahlkarte fiel. Gefragt war: ' +
      karten.FARBNAME[a.farbe] + '.', { zentriert: true, groesse: 12 });
    ui.luecke(4);

    const r = ui.reserviere(56);
    const kb = 32, kh = 48;
    const proReihe = Math.max(1, Math.floor(r.b / (kb + 4)));
    const zeigen = a.hand.slice(0, proReihe);
    let x = r.x + (r.b - (zeigen.length * (kb + 4) - 4)) / 2;
    for (const k of zeigen) {
      zeichneKarte(x, r.y, kb, kh, k, t.dunkel, { klein: true });
      x += kb + 4;
    }
    if (a.hand.length > zeigen.length) {
      ui.absatz('und ' + (a.hand.length - zeigen.length) + ' weitere', { zentriert: true, groesse: 11 });
    }

    ui.luecke(4);
    if (ui.knopf('auf-ok', 'Weiter')) app.schliesseAufdeckung();
    ui.beendeDialog(griff);
  }

  /* ----------------------------------------------------------------------
     Rundenende
     ---------------------------------------------------------------------- */

  function ende(app) {
    const z = app.zustand;
    const t = z.tisch;
    if (!t || !t.rundenPunkte) { ladeBild('Wird abgerechnet …'); return; }

    const rp = t.rundenPunkte;
    const serie = (z.raum.regeln || {}).serie;
    const m = karten.modus(t.modus);
    const serieFertig = !serie || t.serieVorbei;

    kopf(app, serieFertig ? 'Endstand' : 'Runde vorbei', {
      rechts: function () { app.frageAussteigen = true; },
      rechtsText: z.istHost ? 'Beenden' : 'Raus',
    });

    ui.seite('ende', function () {
      ui.luecke(4);
      if (rp.sieger) {
        ui.titel(app.nameVon(rp.sieger) + ' gewinnt', { zentriert: true, groesse: 22 });
        ui.absatz(rp.endart === 'letzterUebrig'
          ? 'Alle anderen sind an der 25-Karten-Grenze gescheitert.'
          : 'Als Erster keine Karte mehr — ' + rp.summe + ' Punkte aus fremden Händen.',
          { zentriert: true });
      } else {
        ui.titel('Runde vorbei', { zentriert: true, groesse: 22 });
      }

      ui.luecke(8);
      /* Rangliste nach Gesamtpunkten — bei einer einzelnen Runde ist das
         dieselbe Reihenfolge, nur ohne Vorgeschichte. */
      const liste = (t.reihenfolge || []).map(function (uid) {
        return {
          uid: uid,
          punkte: (t.punkte || {})[uid] || 0,
          rest: (rp.je || {})[uid] || 0,
          raus: !!(t.raus && t.raus[uid]),
        };
      });
      liste.sort(function (a, b) { return b.punkte - a.punkte; });

      let platz = 0;
      for (const e of liste) {
        platz++;
        const griff = ui.beginneKarte('erg-' + e.uid, {});
        const r = ui.reserviere(24);
        ui.schreibe(platz + '.', r.x + 4, r.y + r.h / 2, { groesse: 14, fett: true, farbe: ui.F.gedaempft });
        ui.schreibe(ui.kuerze(app.nameVon(e.uid), r.b - 130, 15, 'halb'), r.x + 30, r.y + r.h / 2,
          { groesse: 15, fett: 'halb', farbe: e.uid === rp.sieger ? ui.F.erfolg : ui.F.text });
        ui.schreibe(String(e.punkte), r.x + r.b - 4, r.y + r.h / 2,
          { groesse: 16, fett: true, farbe: ui.F.text, ausrichtung: 'right' });
        if (serie) {
          ui.schreibe(e.raus ? 'ausgeschieden' : ('+' + e.rest + ' offen'), r.x + r.b - 4, r.y + r.h / 2 + 14,
            { groesse: 10, farbe: ui.F.gedaempft, ausrichtung: 'right' });
        }
        ui.beendeKarte(griff);
      }

      if (serie && !serieFertig) {
        ui.luecke(6);
        ui.absatz('Gespielt wird bis ' + m.zielPunkte + ' Punkte.', { zentriert: true, groesse: 12 });
      }

      ui.luecke(10);
      if (z.istHost) {
        if (serie && !serieFertig) {
          if (ui.knopf('weiter', 'Nächste Runde')) gameService.naechsteRunde();
        } else {
          if (ui.knopf('nochmal', 'Neue Partie')) gameService.naechsteRunde();
        }
        if (ui.knopf('schluss', 'Partie beenden', { art: 'link' })) app.frageAussteigen = true;
      } else {
        ui.absatz('Der Eröffner entscheidet, wie es weitergeht.', { zentriert: true, groesse: 12 });
        if (ui.knopf('raus', 'Aussteigen', { art: 'link' })) app.frageAussteigen = true;
      }
    }, { maxBreite: 460 });
  }

  /* ----------------------------------------------------------------------
     Rückfragen
     ---------------------------------------------------------------------- */

  function aussteigenFrage(app) {
    const istHost = app.zustand.istHost;
    const griff = ui.beginneDialog('aussteigen', { breite: 340 });
    ui.titel(istHost ? 'Partie abbrechen?' : 'Aussteigen?', { zentriert: true, groesse: 19 });
    ui.absatz(istHost
      ? 'Die Partie wird für alle beendet und der Raum gelöscht.'
      : 'Du verlässt die Partie. Die anderen spielen weiter.',
      { zentriert: true, groesse: 13 });
    ui.luecke(6);
    if (ui.knopf('aus-ja', istHost ? 'Ja, abbrechen' : 'Ja, aussteigen', { art: 'gefahr' })) {
      app.frageAussteigen = false;
      app.steigeAus();
    }
    if (ui.knopf('aus-nein', 'Weiterspielen', { art: 'zweit' })) app.frageAussteigen = false;
    ui.beendeDialog(griff);
  }

  /* ----------------------------------------------------------------------
     Info
     ---------------------------------------------------------------------- */

  function info(app) {
    kopf(app, 'Regeln und Änderungen', { zurueck: function () { app.geheZurueckVonInfo(); } });
    ui.seite('info', function () {
      ui.titel('Letzte Karte', { groesse: 22 });
      ui.absatz('Ein Kartenspiel für die Busfahrt. Bis zu zehn Spieler an eigenen Handys, dazu KI-Mitspieler. Ein Raum-Code verbindet alle.',
        {});

      ui.luecke(6);
      ui.titel('Die drei Spielarten', { groesse: 17 });
      for (const m of karten.MODI) {
        const griff = ui.beginneKarte('info-' + m.id, {});
        ui.absatz(m.name, { fett: true, farbe: ui.F.text, groesse: 15 });
        ui.absatz(m.beschreibung, { groesse: 12 });
        ui.beendeKarte(griff);
      }

      ui.luecke(6);
      ui.titel('So wird gespielt', { groesse: 17 });
      for (const zeile of [
        'Lege eine Karte, die in Farbe oder Zeichen zur offenen Karte passt.',
        'Passt nichts, ziehst du eine Karte — und darfst sie sofort legen, wenn sie passt.',
        'Zieh-Karten lassen sich stapeln: Wer eine gleich hohe oder höhere drauflegt, reicht die ganze Strafe weiter.',
        'Bei der vorletzten Karte auf "Letzte Karte!" drücken. Wer es vergisst, kann von jedem erwischt werden und zieht zwei Karten nach.',
        'Eine Farbwahl-Ziehkarte darf angefochten werden. Hatte der Leger doch die geforderte Farbe, zieht er selbst. War die Anklage falsch, zahlt der Ankläger drauf.',
      ]) ui.absatz('•  ' + zeile, { groesse: 13 });

      ui.luecke(6);
      ui.titel('Änderungen', { groesse: 17 });
      for (const block of app.CHANGELOG) {
        const griff = ui.beginneKarte('cl-' + block.version, {});
        ui.absatz('Fassung ' + block.version, { fett: true, farbe: ui.F.primaer, groesse: 14 });
        for (const g of block.groups) {
          ui.absatz(g.title, { fett: true, farbe: ui.F.text, groesse: 13 });
          for (const punkt of g.items) ui.absatz('•  ' + punkt, { groesse: 12 });
        }
        ui.beendeKarte(griff);
      }

      ui.luecke(6);
      ui.titel('Daten und Datenschutz', { groesse: 17 });
      ui.absatz('Gespeichert werden nur dein selbst gewählter Anzeigename und der Spielstand der laufenden Partie. Die Anmeldung ist anonym — es gibt kein Konto, keine E-Mail-Adresse und keine Verbindung zu deinen Vereinsdaten. Mit dem Ende der Partie wird der Raum gelöscht.',
        { groesse: 12 });
      // ⚠️ Wo die Daten liegen, stand hier nicht. Der Standardsatz der Flotte
      // ("Server in Deutschland") gilt für dieses Repo NICHT: die Echtzeit-Datenbank
      // ist Google Firebase in europe-west1 (Belgien).
      ui.absatz('Die Spieldaten laufen über die Echtzeit-Datenbank von Google (Firebase), Rechenzentrum in Belgien. Wenn du das nicht möchtest, gib einen Spitznamen statt deines Namens ein.',
        { groesse: 12 });
      ui.absatz('Verantwortlich: 1. SC 1911 Heiligenstadt e.V., Leineberg 2, 37308 Heilbad Heiligenstadt, info@sc1911-heiligenstadt.de. Auskunft, Berichtigung, Löschung und Widerspruch unter dieser Anschrift; Beschwerden beim Thüringer Landesbeauftragten für den Datenschutz und die Informationsfreiheit.',
        { groesse: 12 });
      ui.luecke(4);
      ui.absatz('"Letzte Karte" ist ein eigenständiges Spiel des Vereins nach dem klassischen Ablegespiel-Prinzip. Es steht in keiner Verbindung zu Mattel oder einer seiner Marken.',
        { groesse: 11 });

      ui.luecke(8);
      ui.absatz('Fassung ' + app.APP_VERSION, { zentriert: true, groesse: 11 });
    }, { maxBreite: 480 });
  }

  return {
    zeichneKarte: zeichneKarte,
    kopf: kopf,
    start: start,
    neu: neu,
    beitreten: beitreten,
    lobby: lobby,
    spiel: spiel,
    ende: ende,
    info: info,
    farbwahl: farbwahl,
    aufdeckung: aufdeckung,
    aussteigenFrage: aussteigenFrage,
    ladeBild: ladeBild,
  };
})();
