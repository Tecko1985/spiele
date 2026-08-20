/* ============================================================================
   bildschirme.js — die einzelnen Ansichten der Quartett-Spiele
   ----------------------------------------------------------------------------
   Jeder Eintrag beschreibt einen Bildschirm vollständig neu; gemeinsame
   Bestandteile (Kopfzeile, Reiter, Dialoge) liegen in app.js. Der Zustand der
   Ansicht steht in `ansicht` (app.js), der Spielzustand kommt als Argument.

   Aufgerufen wird ausschließlich aus `szene()`. Beim Laden dieser Datei
   existiert `ansicht` noch nicht — das ist in Ordnung, weil hier nur
   Funktionen definiert werden und app.js zuletzt geladen wird.
============================================================================ */

const bildschirme = {

  /* ------------------------------------------------------------------ Start */
  start: function (zustand) {
    ui.seite("start", function () {
      ui.luecke(4);
      ui.titel(SPIEL_CONFIG.zeichen + " " + SPIEL_CONFIG.titel, { groesse: 28, zentriert: true });
      ui.absatz(SPIEL_CONFIG.untertitel, { zentriert: true, groesse: 15 });
      ui.luecke(10);

      if (ui.knopf("btn-raum-erstellen", "Raum erstellen")) {
        geheZuNamenseingabe("erstellen");
      }

      ui.luecke(2);
      ui.absatz("Kartendeck-Größe", { groesse: 13, fett: "halb", abstand: 4 });
      ansicht.deckgroesse = ui.auswahl("auswahl-deckgroesse", [
        { wert: "klein",  text: "Klein – 5 Karten pro Spieler:in" },
        { wert: "normal", text: "Normal – 10 Karten pro Spieler:in" },
        { wert: "gross",  text: "Groß – Maximum aus dem Kartenpool" }
      ], ansicht.deckgroesse);

      ui.trenner("oder");

      const code = ui.eingabe("eingabe-raumcode", {
        platzhalter: "Raum-Code eingeben",
        maxLaenge: 6,
        grossschreiben: true,
        zentriert: true,
        fett: "halb"
      });
      /* Der Code wird immer groß geschrieben — auf dem Handy tippt sich das
         sonst je nach Tastatur unterschiedlich. */
      if (code !== code.toUpperCase()) ui.setzeEingabe("eingabe-raumcode", code.toUpperCase());

      const abgeschickt = ui.eingabeAbgeschickt("eingabe-raumcode");
      if (ui.knopf("btn-raum-beitreten", "Raum beitreten", { art: "zweit" }) || abgeschickt) {
        const eingetippt = String(ui.leseEingabe("eingabe-raumcode") || "").trim().toUpperCase();
        if (!eingetippt) {
          ansicht.fehler = "Bitte einen Raum-Code eingeben.";
        } else {
          ansicht.fehler = "";
          ansicht.beitrittsCode = eingetippt;
          geheZuNamenseingabe("beitreten");
        }
      }

      if (ansicht.fehler) {
        ui.absatz(ansicht.fehler, { farbe: ui.F.gefahr, groesse: 14, zentriert: true });
      }

      ui.luecke(6);
      if (ui.knopf("btn-bestenliste", "🏆 Bestenliste", { art: "link" })) {
        oeffneBestenliste();
      }
    }, { zentriert: true, maxBreite: 480 });
  },

  /* -------------------------------------------------------- Namenseingabe */
  name: function (zustand) {
    ui.seite("name", function () {
      ui.titel("Wie heißt du?", { groesse: 24, zentriert: true });
      ui.luecke(4);
      ui.eingabe("eingabe-name", { platzhalter: "Dein Name", maxLaenge: 20, zentriert: true });

      const abgeschickt = ui.eingabeAbgeschickt("eingabe-name");
      if (ui.knopf("btn-name-weiter", "Weiter") || abgeschickt) {
        bestaetigeNamen();
      }
      if (ansicht.fehler) {
        ui.absatz(ansicht.fehler, { farbe: ui.F.gefahr, groesse: 14, zentriert: true });
      }
      if (ui.knopf("btn-name-zurueck", "Zurück", { art: "link" })) {
        ansicht.ueberlagert = null;
        ansicht.fehler = "";
        ui.loeseFokus();
      }
    }, { zentriert: true, maxBreite: 420 });
  },

  /* ------------------------------------------------------------- Warteraum */
  lobby: function (zustand) {
    const istHost = binIchHost(zustand);
    ui.seite("lobby", function () {
      ui.titel("Warteraum", { groesse: 24 });

      /* Raumcode gestrichelt umrandet — die auffälligste Angabe des Bildschirms,
         weil alle anderen sie zum Beitreten abtippen müssen. */
      const r = ui.reserviere(76);
      ui.ctx.save();
      ui.ctx.setLineDash([7, 5]);
      ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS, ui.F.karte);
      ui.rahmeRund(r.x, r.y, r.b, r.h, ui.RADIUS, ui.F.primaer, 2);
      ui.ctx.restore();
      ui.schreibe("Raum-Code", r.x + r.b / 2, r.y + 20, { groesse: 13, farbe: ui.F.gedaempft, ausrichtung: "center" });
      const code = zustand.raumCode || "------";
      ui.ctx.save();
      ui.setzeSchrift(28, true);
      /* Sperrsatz von 4 px wie in der abgelösten Oberfläche */
      let cx = r.x + r.b / 2 - (ui.textBreite(code, 28, true) + code.length * 4) / 2;
      for (let i = 0; i < code.length; i++) {
        ui.schreibe(code[i], cx, r.y + 50, { groesse: 28, fett: true, farbe: ui.F.primaer });
        cx += ui.textBreite(code[i], 28, true) + 4;
      }
      ui.ctx.restore();

      const groesse = DECKGROESSE_LABEL[zustand.deckgroesse] || DECKGROESSE_LABEL.normal;
      ui.absatz(SPIEL_CONFIG.zeichen + " " + SPIEL_CONFIG.titel + " · " + groesse, {
        zentriert: true, groesse: 14
      });
      ui.absatz(zustand.spieler.length + "/" + zustand.maxSpieler + " Spieler:innen", { groesse: 14 });

      zustand.spieler.forEach(s => {
        const z = ui.reserviere(52);
        ui.fuelleRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN, ui.F.karte);
        ui.rahmeRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN, ui.F.rand, 1);
        zeichneAvatar(z.x + 12, z.y + 10, 32, s.avatarFarbe, s.name, null);
        ui.schreibe(ui.kuerze(s.name, z.b - 150, 15, "halb"), z.x + 54, z.y + z.h / 2, { groesse: 15, fett: "halb" });
        if (s.istHost) {
          ui.schreibe("Gastgeber:in", z.x + z.b - 12, z.y + z.h / 2, {
            groesse: 12, farbe: ui.F.gedaempft, ausrichtung: "right"
          });
        }
      });

      ui.luecke(8);
      if (istHost) {
        if (ui.knopf("btn-test-spieler", "+ Test-Spieler hinzufügen", { art: "zweit" })) {
          gameService.fuegeTestSpielerHinzu();
        }
        const zuWenige = zustand.spieler.length < 2;
        if (ui.knopf("btn-spiel-starten", "Spiel starten", { aus: zuWenige }) && !zuWenige) {
          gameService.starteSpiel();
        }
        if (zuWenige) {
          ui.absatz("Mindestens 2 Spieler:innen nötig.", { groesse: 14, zentriert: true });
        }
      } else {
        ui.absatz("Warte, bis der Gastgeber das Spiel startet …", { groesse: 14, zentriert: true });
      }
    }, { maxBreite: 480 });
  },

  /* ------------------------------------------------------------------ Spiel */
  spiel: function (zustand) {
    const amZug = zustand.phase === "amZug";
    const karte = zustand.eigeneKarten[0];

    ui.seite("spiel", function () {
      /* Statuszeile: eigener Kartenvorrat links, wer am Zug ist rechts */
      const z = ui.reserviere(24);
      ui.schreibe("🂠 " + zustand.eigeneKarten.length + " Karten", z.x, z.y + 12, { groesse: 15, fett: "halb" });
      ui.schreibe(
        amZug ? "Du bist am Zug" : "Warte auf " + spielerNameVon(zustand, zustand.amZugSpielerId) + " …",
        z.x + z.b, z.y + 12,
        { groesse: 15, fett: "halb", farbe: ui.F.primaer, ausrichtung: "right" }
      );

      if (karte) {
        const kastenB = ui.oben().b;
        const kartenB = Math.min(kastenB, 340);
        const h = karteHoehe(karte, kartenB);
        const r = ui.reserviere(h + 10);
        const gewaehlt = zeichneQuartettKarte(karte, r.x + (r.b - kartenB) / 2, r.y + 4, kartenB, {
          waehlbar: amZug
        });
        if (gewaehlt) gameService.waehleKategorie(gewaehlt);
      } else {
        ui.absatz("Keine Karten mehr.", { zentriert: true });
      }

      ui.absatz(
        amZug ? "Wähle eine Eigenschaft deiner Karte aus." : "Die Karten werden gleich aufgedeckt.",
        { groesse: 14, zentriert: true }
      );
    }, { maxBreite: 380 });
  },

  /* -------------------------------------------------------------- Vergleich */
  vergleich: function (zustand) {
    const runde = zustand.aktuelleRunde;
    const meta = kategorieMeta(runde.gewaehlteKategorie);

    ui.seite("vergleich", function () {
      ui.titel("Vergleich: " + meta.icon + " " + meta.label, { groesse: 20 });

      const sortiert = runde.ausgespielteKarten.slice().sort((a, b) =>
        b.karte.eigenschaften[runde.gewaehlteKategorie] - a.karte.eigenschaften[runde.gewaehlteKategorie]
      );

      sortiert.forEach(eintrag => {
        const name = spielerNameVon(zustand, eintrag.spielerId);
        const istGewinner = eintrag.spielerId === runde.gewinnerSpielerId;
        const istEigene = eintrag.spielerId === zustand.eigenerSpielerId;
        const z = ui.reserviere(56);

        ui.fuelleRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN, ui.F.karte);
        ui.rahmeRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN,
          istGewinner ? ui.F.erfolg : (istEigene ? ui.F.primaer : ui.F.rand),
          istGewinner ? 2.5 : 1.5);

        const quelle = kartenBild(eintrag.karte);
        zeichneAvatar(z.x + 10, z.y + 10, 36, eintrag.karte.avatarFarbe, name, quelle);
        if (quelle) {
          const bildR = { x: z.x + 10, y: z.y + 10, b: 36, h: 36 };
          ui.merke("vergleich-bild-" + eintrag.spielerId, bildR, "bild");
          if (ui.geklickt(bildR)) ansicht.grossansicht = quelle;
        }

        const wert = zahlLesbar(eintrag.karte.eigenschaften[runde.gewaehlteKategorie]);
        const wertB = ui.textBreite(wert, 18, true);
        const textB = z.b - 56 - wertB - 24;
        ui.schreibe(ui.kuerze(name, textB, 14, "halb"), z.x + 56, z.y + 20, { groesse: 14, fett: "halb" });
        ui.schreibe(ui.kuerze(eintrag.karte.name, textB, 13), z.x + 56, z.y + 38, {
          groesse: 13, farbe: ui.F.gedaempft
        });
        ui.schreibe(wert, z.x + z.b - 14, z.y + z.h / 2, { groesse: 18, fett: true, ausrichtung: "right" });
      });

      ui.luecke(6);
      if (!runde.gewinnerSpielerId) {
        ui.absatz("Gleichstand! Die nächste Karte wird automatisch in derselben Kategorie verglichen …", {
          zentriert: true, groesse: 15, farbe: ui.F.warnung, fett: "halb"
        });
      } else {
        ui.absatz(spielerNameVon(zustand, runde.gewinnerSpielerId) + " gewinnt die Runde!", {
          zentriert: true, groesse: 16, farbe: ui.F.erfolg, fett: true
        });
        const bereits = runde.habeIchBestaetigt;
        if (ui.knopf("btn-weiter", bereits ? "Du bist bereit – warte auf die anderen …" : "Weiter", { aus: bereits })) {
          gameService.bestaetigeWeiter();
        }
        ui.absatz(
          runde.weiterBestaetigtAnzahl + "/" + runde.weiterBestaetigtGesamt +
          " Spieler:innen bereit – spätestens nach 10 Sekunden geht’s automatisch weiter.",
          { groesse: 13, zentriert: true }
        );
      }
    }, { maxBreite: 480 });
  },

  /* --------------------------------------------------------------- Endstand */
  endstand: function (zustand) {
    ui.seite("endstand", function () {
      ui.titel("🏆 Spiel beendet!", { groesse: 28, zentriert: true });
      ui.absatz(spielerNameVon(zustand, zustand.siegerSpielerId) + " hat alle Karten gesammelt!", {
        zentriert: true, groesse: 19, fett: true, farbe: ui.F.primaer
      });
      ui.luecke(8);

      zustand.spieler.slice().sort((a, b) => b.kartenAnzahl - a.kartenAnzahl).forEach((s, i) => {
        const z = ui.reserviere(38, { abstand: 4 });
        ui.schreibe((i + 1) + ".", z.x + 6, z.y + z.h / 2, { groesse: 15, fett: "halb", farbe: ui.F.gedaempft });
        ui.schreibe(ui.kuerze(s.name, z.b - 130, 15), z.x + 34, z.y + z.h / 2, { groesse: 15 });
        ui.schreibe(s.kartenAnzahl + " Karten", z.x + z.b - 6, z.y + z.h / 2, {
          groesse: 15, fett: "halb", ausrichtung: "right", farbe: ui.F.gedaempft
        });
      });

      ui.luecke(10);
      if (ui.knopf("btn-neues-spiel", "Neues Spiel")) gameService.neuesSpiel();
    }, { zentriert: true, maxBreite: 440 });
  },

  /* ------------------------------------------------------------ Abgebrochen */
  abgebrochen: function (zustand) {
    ui.seite("abgebrochen", function () {
      ui.titel("🚫 Spiel abgebrochen", { groesse: 26, zentriert: true });
      ui.absatz("Der Gastgeber hat das Spiel beendet.", { zentriert: true, groesse: 15 });
      ui.luecke(10);
      if (ui.knopf("btn-abbruch-zurueck", "Zurück zum Start")) gameService.neuesSpiel();
    }, { zentriert: true, maxBreite: 420 });
  },

  /* ------------------------------------------------------------ Bestenliste */
  bestenliste: function (zustand) {
    ui.seite("bestenliste", function () {
      ui.titel("🏆 Bestenliste", { groesse: 24 });

      if (ansicht.bestenliste === null) {
        ui.absatz("Lade Bestenliste …", { groesse: 15 });
      } else if (ansicht.bestenlisteFehler) {
        ui.absatz(ansicht.bestenlisteFehler, { groesse: 15, farbe: ui.F.gefahr });
      } else if (ansicht.bestenliste.length === 0) {
        ui.absatz("Noch keine beendeten Spiele.", { groesse: 15 });
      } else {
        /* Kopfzeile der Tabelle */
        const k = ui.reserviere(28, { abstand: 0 });
        const spalte = (i) => k.x + k.b - (3 - i) * (k.b * 0.17) - 4;
        ui.schreibe("Name", k.x + 4, k.y + 14, { groesse: 13, fett: "halb", farbe: ui.F.gedaempft });
        ["Gespielt", "Gewonnen", "%"].forEach((t, i) => {
          ui.schreibe(t, spalte(i) + k.b * 0.17 - 4, k.y + 14, {
            groesse: 13, fett: "halb", farbe: ui.F.gedaempft, ausrichtung: "right"
          });
        });

        ansicht.bestenliste.forEach(e => {
          const z = ui.reserviere(38, { abstand: 0 });
          ui.ctx.strokeStyle = ui.F.rand;
          ui.ctx.lineWidth = 1;
          ui.ctx.beginPath();
          ui.ctx.moveTo(z.x, z.y + 0.5);
          ui.ctx.lineTo(z.x + z.b, z.y + 0.5);
          ui.ctx.stroke();
          ui.schreibe(ui.kuerze(e.name, z.b * 0.45, 14), z.x + 4, z.y + z.h / 2, { groesse: 14 });
          [e.gespielt, e.gewonnen, e.prozent + "%"].forEach((wert, i) => {
            ui.schreibe(String(wert), spalte(i) + z.b * 0.17 - 4, z.y + z.h / 2, {
              groesse: 14, ausrichtung: "right", fett: i === 2 ? "halb" : null
            });
          });
        });
      }

      ui.luecke(10);
      if (ui.knopf("btn-bestenliste-zurueck", "Zurück", { art: "link" })) {
        ansicht.ueberlagert = null;
      }
    }, { maxBreite: 520 });
  },

  /* ------------------------------------------------------- Kartenverwaltung */
  verwaltung: function (zustand) {
    const kasten = ui.oben();
    const alle = ansicht.verwaltungsKarten;

    /* Kopfbereich mit fester Höhe, damit die Liste den Rest bekommt und beim
       Rollen nichts wandert. */
    ui.beginneKasten({ x: kasten.x, y: kasten.y, b: kasten.b, h: kasten.h }, 0);
    ui.luecke(14);
    ui.beginneSeite({ maxBreite: 560 });

    ui.titel("✏️ Karten bearbeiten", { groesse: 22, abstand: 8 });

    if (alle === null) {
      ui.absatz("Lade Karten …", { groesse: 15 });
      ui.beendeKasten();
      ui.beendeKasten();
      return;
    }
    if (ansicht.verwaltungsFehler) {
      ui.absatz(ansicht.verwaltungsFehler, { groesse: 15, farbe: ui.F.gefahr });
    }

    /* Suchfeld. In der abgelösten Oberfläche übernahm das die Suchfunktion des
       Browsers (Strg+F) — auf einer Zeichenfläche gibt es die nicht mehr, und
       500 Karten von Hand durchzurollen ist keine Bedienung. */
    ansicht.suche = ui.eingabe("kv-suche", {
      platzhalter: "Karte suchen …", maxLaenge: 40, hoehe: 42
    });
    const suche = String(ansicht.suche || "").trim().toLowerCase();
    const karten = suche
      ? alle.filter(k => String(k.name).toLowerCase().indexOf(suche) !== -1 ||
                         String(k.rolle).toLowerCase().indexOf(suche) !== -1)
      : alle;

    ui.absatz(
      suche ? karten.length + " von " + alle.length + " Karten" : alle.length + " Karten",
      { groesse: 13, abstand: 6 }
    );

    /* Die Liste bekommt, was nach den Knöpfen unten übrig bleibt. */
    const knoepfeH = 3 * (ui.TIPPZIEL + 6) + 3 * 12 + 8;
    const listenH = Math.max(140, ui.hoeheRest() - knoepfeH);
    const zeileH = 56;
    const abstandY = 8;

    ui.scroll("kv-liste", listenH, function (breite) {
      if (karten.length === 0) {
        ui.absatz("Keine Karte gefunden.", { groesse: 15 });
        return;
      }
      /* NUR die sichtbaren Zeilen zeichnen. Bei 500 Karten wären es sonst 500
         gezeichnete Zeilen je Bild — der Rollbereich misst seine Inhaltshöhe,
         indem er den Inhalt beschreiben lässt, und das würde jedes Bild
         unbedienbar langsam machen. Der Platz der übersprungenen Zeilen wird
         über `luecke()` reserviert, damit Höhe und Rollstand stimmen. */
      const gesamt = zeileH + abstandY;
      const versatz = ui.zustand("kv-liste", {}).versatz || 0;
      const erste = Math.max(0, Math.floor(versatz / gesamt) - 2);
      const letzte = Math.min(karten.length, Math.ceil((versatz + listenH) / gesamt) + 2);

      if (erste > 0) ui.luecke(erste * gesamt);
      for (let i = erste; i < letzte; i++) {
        const karte = karten[i];
        const z = ui.reserviere(zeileH, { abstand: abstandY });
        const gedrueckt = ui.gedruecktAuf(z);
        ui.fuelleRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN, gedrueckt ? ui.F.hintergrund : ui.F.karte);
        ui.rahmeRund(z.x, z.y, z.b, z.h, ui.RADIUS_KLEIN, ui.F.rand, 1);
        zeichneAvatar(z.x + 10, z.y + 8, 40, karte.avatarFarbe, karte.name, kartenBild(karte));
        ui.schreibe(ui.kuerze(karte.name, z.b - 200, 15, "halb"), z.x + 60, z.y + z.h / 2, {
          groesse: 15, fett: "halb"
        });
        ui.schreibe(ui.kuerze(karte.rolle, 130, 13), z.x + z.b - 12, z.y + z.h / 2, {
          groesse: 13, farbe: ui.F.gedaempft, ausrichtung: "right"
        });
        ui.merke("kv-karte-" + karte.id, z, "listeneintrag");
        if (ui.geklickt(z)) oeffneKartenBearbeitung(karte);
      }
      if (letzte < karten.length) ui.luecke((karten.length - letzte) * gesamt);
    }, { abstand: 0 });

    ui.luecke(10);
    if (ui.knopf("btn-neue-karte", "+ Neue Karte anlegen", { art: "zweit" })) neueKarteAnlegen();
    if (ui.knopf("btn-kriterien", "📊 Kriterien bearbeiten", { art: "link" })) oeffneKriterien();
    if (ui.knopf("btn-verwaltung-zurueck", "Zurück", { art: "link" })) {
      ansicht.ueberlagert = null;
      ui.loeseFokus();
    }

    ui.beendeKasten();
    ui.beendeKasten();
  },

  /* --------------------------------------------------------- Karte bearbeiten */
  bearbeiten: function (zustand) {
    const karte = ansicht.karte;
    if (!karte) { ansicht.ueberlagert = "verwaltung"; return; }
    const istEigene = String(karte.id).indexOf("custom-") === 0;

    ui.seite("bearbeiten", function () {
      ui.titel(karte.istNeu ? "Neue Karte anlegen" : "Karte bearbeiten", { groesse: 22 });

      /* Fotozeile: Vorschau plus Auswahlknopf */
      const z = ui.reserviere(88);
      const quelle = ansicht.karteNeuesFoto !== undefined ? ansicht.karteNeuesFoto : kartenBild(karte);
      zeichneAvatar(z.x, z.y + 4, 80, karte.avatarFarbe, ui.leseEingabe("kb-name") || karte.name, quelle);
      if (quelle) {
        const bildR = { x: z.x, y: z.y + 4, b: 80, h: 80 };
        ui.merke("kb-foto-vorschau", bildR, "bild");
        if (ui.geklickt(bildR)) ansicht.grossansicht = quelle;
      }
      const knopfR = { x: z.x + 96, y: z.y + 26, b: Math.min(180, z.b - 96), h: 40 };
      const aktiv = ui.gedruecktAuf(knopfR);
      ui.fuelleRund(knopfR.x, knopfR.y, knopfR.b, knopfR.h, ui.RADIUS_KLEIN + 4, aktiv ? "#e8eefa" : ui.F.karte);
      ui.rahmeRund(knopfR.x, knopfR.y, knopfR.b, knopfR.h, ui.RADIUS_KLEIN + 4, ui.F.primaer, 1.5);
      ui.schreibe("Foto auswählen", knopfR.x + knopfR.b / 2, knopfR.y + knopfR.h / 2, {
        groesse: 15, fett: "halb", farbe: ui.F.primaer, ausrichtung: "center"
      });
      ui.merke("btn-foto", knopfR, "knopf");
      /* Der Dateidialog MUSS direkt aus dem Klick heraus geöffnet werden —
         aus einem späteren Rückruf verweigert Safari ihn wortlos. */
      if (ui.geklickt(knopfR)) waehleKartenFoto();

      ui.absatz("Name", { groesse: 13, fett: "halb", abstand: 4 });
      ui.eingabe("kb-name", { maxLaenge: 30 });
      ui.absatz("Rolle / Typ", { groesse: 13, fett: "halb", abstand: 4 });
      ui.eingabe("kb-rolle", { maxLaenge: 30 });

      Object.keys(kategorienJetzt()).forEach(sch => {
        const meta = kategorieMeta(sch);
        ui.absatz(meta.icon + " " + meta.label, { groesse: 13, fett: "halb", abstand: 4 });
        ui.eingabe("kb-eig-" + sch, { maxLaenge: 12, nurZiffern: true });
      });

      if (ansicht.fehler) {
        ui.absatz(ansicht.fehler, { groesse: 14, farbe: ui.F.gefahr });
      }

      ui.luecke(4);
      if (ui.knopf("btn-kb-speichern", "Speichern")) speichereKarte();

      if (!karte.istNeu) {
        const text = istEigene ? "Karte löschen" : "Auf Original zurücksetzen";
        if (ui.knopf("btn-kb-zuruecksetzen", text, { art: istEigene ? "gefahr" : "zweit" })) {
          if (istEigene) {
            ansicht.frage = {
              titel: "Karte löschen",
              text: "Diese Karte wirklich endgültig löschen?",
              jaText: "Löschen",
              art: "gefahr",
              ja: karteZuruecksetzen
            };
          } else {
            karteZuruecksetzen();
          }
        }
      }
      if (ui.knopf("btn-kb-abbrechen", "Abbrechen", { art: "link" })) {
        ansicht.ueberlagert = "verwaltung";
        ansicht.fehler = "";
        ui.loeseFokus();
      }
    }, { maxBreite: 480 });
  },

  /* ----------------------------------------------------- Kriterien bearbeiten */
  kriterien: function (zustand) {
    ui.seite("kriterien", function () {
      ui.titel("📊 Kriterien bearbeiten", { groesse: 22 });
      ui.absatz("Bezeichnung und Icon der Eigenschaften für dieses Kartenset.", { groesse: 14 });

      if (ansicht.kriterien === null) {
        ui.absatz("Lade Kriterien …", { groesse: 15 });
      } else {
        Object.keys(ansicht.kriterien).forEach(sch => {
          const z = ui.reserviere(ui.TIPPZIEL + 6, { abstand: 10 });

          /* Drei Elemente nebeneinander: Zeichen, Bezeichnung, Zurücksetzen.
             Sie werden als eigener Kasten gesetzt, weil `reserviere` immer
             über die volle Breite geht. */
          const resetB = 44, iconB = 60, spalt = 8;
          const labelB = z.b - iconB - resetB - spalt * 2;

          ui.beginneKasten({ x: z.x, y: z.y, b: iconB, h: z.h }, 0);
          ui.eingabe("kr-icon-" + sch, { maxLaenge: 4, zentriert: true });
          ui.beendeKasten();

          ui.beginneKasten({ x: z.x + iconB + spalt, y: z.y, b: labelB, h: z.h }, 0);
          ui.eingabe("kr-label-" + sch, { maxLaenge: 30 });
          ui.beendeKasten();

          const rr = { x: z.x + z.b - resetB, y: z.y, b: resetB, h: z.h };
          const aktiv = ui.gedruecktAuf(rr);
          ui.fuelleRund(rr.x, rr.y, rr.b, rr.h, ui.RADIUS_KLEIN, aktiv ? ui.F.hintergrund : ui.F.karte);
          ui.rahmeRund(rr.x, rr.y, rr.b, rr.h, ui.RADIUS_KLEIN, ui.F.rand, 1.5);
          ui.schreibe("↺", rr.x + rr.b / 2, rr.y + rr.h / 2, {
            groesse: 18, farbe: ui.F.gedaempft, ausrichtung: "center"
          });
          ui.merke("kr-reset-" + sch, rr, "knopf");
          if (ui.geklickt(rr)) {
            gameService.setzeKategorieZurueck(sch).then(() => {
              kategorienCache = null;
              oeffneKriterien();
            });
          }
        });
      }

      if (ansicht.kriterienFehler) {
        ui.absatz(ansicht.kriterienFehler, { groesse: 14, farbe: ui.F.gefahr });
      }

      ui.luecke(4);
      if (ui.knopf("btn-kr-speichern", "Speichern")) speichereKriterien();
      if (ui.knopf("btn-kr-zurueck", "Zurück", { art: "link" })) {
        ansicht.ueberlagert = "verwaltung";
        ui.loeseFokus();
      }
    }, { maxBreite: 520 });
  },

  /* ------------------------------------------------------------------- Info */
  info: function () {
    ui.seite("info", function () {
      const griff = ui.beginneKarte("info-ueber");
      ui.titel("Über das " + SPIEL_CONFIG.titel, { groesse: 17, farbe: ui.F.primaer, abstand: 8 });
      ui.absatz(SPIEL_CONFIG.infoText, { groesse: 14, zeilenhoehe: 1.55 });
      ui.luecke(4);
      ui.absatz("Version " + APP_VERSION, { groesse: 13, fett: "halb", farbe: ui.F.primaer });
      ui.beendeKarte(griff);

      const griff2 = ui.beginneKarte("info-changelog");
      ui.titel("Änderungen", { groesse: 17, farbe: ui.F.primaer, abstand: 8 });
      CHANGELOG.forEach(eintrag => {
        ui.absatz("Version " + eintrag.version, { groesse: 14, fett: true, farbe: ui.F.primaer, abstand: 6 });
        eintrag.groups.forEach(gruppe => {
          ui.absatz(gruppe.title, { groesse: 13, fett: "halb", farbe: ui.F.text, abstand: 4 });
          gruppe.items.forEach(zeile => {
            ui.absatz("•  " + zeile, { groesse: 13, links: 8, zeilenhoehe: 1.5, abstand: 4 });
          });
        });
        ui.luecke(6);
      });
      ui.beendeKarte(griff2);
    }, { maxBreite: 560 });
  }
};
