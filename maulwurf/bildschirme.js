/* ============================================================================
   bildschirme.js — alle Menü-Oberflächen auf der Zeichenfläche
   ----------------------------------------------------------------------------
   Enthält Kopfzeile, Reiter, Info, Start, Namenseingabe, Warteraum, Rollen-
   ziehung, Besprechung, Ende, Abbruch und Bestenliste. Das Spielfeld selbst
   und die Aufgaben-Dialoge liegen weiter in app.js bzw. aufgaben.js.

   Wird NACH app.js geladen und nutzt dessen globale Zustandsvariablen
   (`ausstehenderModus`, `raumcodeEingabe`, `meineStimme`, `istAdmin`,
   `letzteZustand`) sowie `gameService`, `rollenModul` und `karte`. Klassische
   Skripte teilen sich einen globalen Gültigkeitsbereich — deshalb steht hier
   alles in einer Kapsel und nur `bildschirme` ist nach außen sichtbar.
   Siehe die Warnung zu doppelten Namen in CLAUDE.md.

   Aufbau jeder Zeichenfunktion: sie liest den Zustand und beschreibt daraus
   das Bild. Kein Element merkt sich etwas, nichts wird „aktualisiert" — genau
   deshalb kann die Darstellung nicht mehr vom Spielstand abweichen, was in der
   alten DOM-Fassung die häufigste Fehlerquelle war.
============================================================================ */

const bildschirme = (function () {
  "use strict";

  const F = ui.F;

  /* Eigener Zustand dieser Oberfläche — nichts davon gehört zum Spiel. */
  let reiter = "spiel";                 // "spiel" | "info"
  let bestenlisteOffen = false;
  let bestenlisteDaten = null;          // null = lädt noch
  let bestenlisteLaeuft = false;
  let startFehler = "";
  let nameFehler = "";
  let lobbyHinweis = "";
  let einstellungenOffen = false;
  let abfrage = null;                   // { text, jaText, beiJa }

  const KOPF_HOEHE = 52;
  const REITER_HOEHE = 44;

  /* ---------------------------------------------------------------- Helfer */

  function zustandJetzt() {
    return typeof gameService !== "undefined" ? gameService.getZustand() : null;
  }

  function initiale(name) {
    return (name || "?").trim().charAt(0).toUpperCase();
  }

  /* Farbiger Kreis mit dem ersten Buchstaben — ersetzt `.spieler-avatar`. */
  function avatar(x, y, r, name, farbe) {
    const c = ui.ctx;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    const grund = farbe || F.randStark;
    c.fillStyle = grund;
    c.fill();
    /* Ein feiner heller Ring hebt die Figur vom dunklen Grund ab — ohne ihn
       verschwimmen dunkle Spielerfarben mit der Zeile darunter. */
    c.lineWidth = 1.5;
    c.strokeStyle = "rgba(255,255,255,0.22)";
    c.stroke();
    /* Die Schriftfarbe richtet sich nach der Figur: auf Gelb steht sie dunkel,
       auf Violett hell. Festes Weiß wäre auf den hellen Farben nicht zu lesen. */
    ui.schreibe(initiale(name), x, y + 1, {
      groesse: r, fett: true, farbe: ui.lesbarAuf(grund), ausrichtung: "center"
    });
  }

  /* Zeile mit Avatar, Name und Randnotiz — Warteraum, Abstimmung, Aufdeckung
     benutzen dieselbe. Gibt das Rechteck zurück, damit die Aufrufer noch
     einen Knopf hineinsetzen können. */
  function spielerZeile(id, spieler, opt) {
    const o = opt || {};
    const h = o.hoehe || 52;
    const r = ui.reserviere(h, o);
    const c = ui.ctx;

    const grund = o.hervorgehoben ? "rgba(34,211,238,0.14)" : F.karte;
    ui.fuelleRund(r.x, r.y, r.b, r.h, ui.RADIUS_KLEIN + 2, grund);
    if (o.hervorgehoben) ui.rahmeRund(r.x, r.y, r.b, r.h, ui.RADIUS_KLEIN + 2, F.primaer, 2);
    else ui.rahmeRund(r.x, r.y, r.b, r.h, ui.RADIUS_KLEIN + 2, F.rand, 1);

    const blass = o.blass;
    if (blass) { c.save(); c.globalAlpha = 0.5; }

    avatar(r.x + 26, r.y + h / 2, 15, spieler.name, spieler.farbe);
    const rechtsBreite = o.rechtsBreite || 0;
    const nameMax = r.b - 52 - 14 - rechtsBreite;
    ui.schreibe(ui.kuerze(spieler.name + (o.namenszusatz || ""), nameMax, 15, "halb"),
                r.x + 52, r.y + h / 2, { groesse: 15, fett: "halb", farbe: F.text });

    if (blass) c.restore();

    if (o.notiz) {
      ui.schreibe(o.notiz, r.x + r.b - 14, r.y + h / 2, {
        groesse: 13, farbe: o.notizFarbe || F.gedaempft, ausrichtung: "right"
      });
    }
    return r;
  }

  /* Kleiner Knopf innerhalb einer Zeile (rechtsbündig). */
  function zeilenKnopf(id, r, text, opt) {
    const o = opt || {};
    const b = o.breite || Math.max(74, ui.textBreite(text, 13, "halb") + 22);
    const h = 32;
    const kr = { x: r.x + r.b - b - 10, y: r.y + (r.h - h) / 2, b: b, h: h };
    const aus = !!o.aus;
    const treffer = !aus && ui.geklickt(kr);
    const gedrueckt = !aus && ui.gedruecktAuf(kr);

    ui.fuelleRund(kr.x, kr.y, kr.b, kr.h, 6,
      aus ? "rgba(255,255,255,0.05)"
          : (o.art === "gefahr" ? (gedrueckt ? "#e94f66" : F.gefahr)
                                : (gedrueckt ? "rgba(34,211,238,0.28)" : "rgba(34,211,238,0.12)")));
    if (!aus && o.art !== "gefahr") ui.rahmeRund(kr.x, kr.y, kr.b, kr.h, 6, F.primaer, 1);
    ui.schreibe(text, kr.x + kr.b / 2, kr.y + kr.h / 2, {
      groesse: 13, fett: "halb", ausrichtung: "center",
      farbe: aus ? F.randStark : (o.art === "gefahr" ? F.aufFarbe : F.primaer)
    });
    return treffer;
  }

  /* ------------------------------------------------------------- Kopfzeile */

  function kopfzeile(zustand) {
    const c = ui.ctx;
    /* Kopfzeile und Reiter sind Chrome, kein Akzent: eine zusammenhängende
       dunkle Zone im selben Ton. Eine durchgehend leuchtende Leiste über jedem
       Bildschirm wäre auf Dauer nicht auszuhalten — Cyan trägt hier nur der
       aktive Reiter und die Versionsplakette. */
    c.fillStyle = F.kopf;
    c.fillRect(0, 0, ui.breite, KOPF_HOEHE);

    let x = 14;
    ui.schreibe("🕵️", x, KOPF_HOEHE / 2, { groesse: 17 });
    x += 24;
    const titelBreit = ui.breite > 380;
    if (titelBreit) {
      ui.schreibe("Der Maulwurf", x, KOPF_HOEHE / 2, { groesse: 16, fett: true, farbe: F.text });
      x += ui.textBreite("Der Maulwurf", 16, true) + 10;
    }

    /* Versionsplakette — führt auf den Info-Reiter, wie bisher der Klick auf
       das Abzeichen. */
    const vTxt = "v" + APP_VERSION;
    const vB = ui.textBreite(vTxt, 11, "halb") + 14;
    const vR = { x: x, y: KOPF_HOEHE / 2 - 10, b: vB, h: 20 };
    ui.fuelleRund(vR.x, vR.y, vR.b, vR.h, 10, "rgba(34,211,238,0.16)");
    ui.schreibe(vTxt, vR.x + vB / 2, vR.y + 10, { groesse: 11, fett: "halb", farbe: F.primaer, ausrichtung: "center" });
    ui.merke("version-badge", vR, "plakette");
    if (ui.geklickt(vR)) { reiter = "info"; bestenlisteOffen = false; }
    x += vB + 10;

    /* Verlassen — nur in den Phasen, in denen es etwas zu verlassen gibt. */
    const zeigeVerlassen = zustand && ["lobby", "zuteilung", "laeuft"].indexOf(zustand.phase) >= 0;
    if (zeigeVerlassen) {
      const t = "Verlassen";
      const b = ui.textBreite(t, 12, "halb") + 20;
      const r = { x: x, y: KOPF_HOEHE / 2 - 13, b: b, h: 26 };
      ui.fuelleRund(r.x, r.y, r.b, r.h, 6, ui.gedruecktAuf(r) ? "rgba(251,113,133,0.3)" : "rgba(251,113,133,0.12)");
      ui.rahmeRund(r.x, r.y, r.b, r.h, 6, F.gefahr, 1);
      ui.schreibe(t, r.x + b / 2, r.y + 13, { groesse: 12, fett: "halb", farbe: F.gefahr, ausrichtung: "center" });
      ui.merke("btn-spiel-abbrechen", r, "knopf");
      if (ui.geklickt(r)) frageVerlassen(zustand);
    }

    /* Vereinslogo rechts */
    ui.zeichneBild("logo.png", ui.breite - 74, 10, 60, KOPF_HOEHE - 20);
  }

  function frageVerlassen(zustand) {
    const istHost = zustand && zustand.istHost && zustand.phase !== "lobby";
    abfrage = {
      text: istHost
        ? "Partie wirklich beenden? Sie ist damit für alle vorbei."
        : "Wirklich verlassen?",
      jaText: istHost ? "Beenden" : "Verlassen",
      beiJa: function () { gameService.verlasseSpiel(); }
    };
  }

  /* ---------------------------------------------------------------- Reiter */

  function reiterLeiste() {
    const c = ui.ctx;
    const y = KOPF_HOEHE;
    c.fillStyle = F.kopf;
    c.fillRect(0, y, ui.breite, REITER_HOEHE);
    c.strokeStyle = F.rand;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, y + REITER_HOEHE - 0.5); c.lineTo(ui.breite, y + REITER_HOEHE - 0.5); c.stroke();

    /* „Spiel" links, „Info" ganz rechts — wie in der Flotte üblich. */
    zeichneReiter("spiel", "Spiel", 0, 96, y);
    zeichneReiter("info", "Info", ui.breite - 88, 88, y);
    ui.luecke(KOPF_HOEHE + REITER_HOEHE);
  }

  function zeichneReiter(name, text, x, b, y) {
    const r = { x: x, y: y, b: b, h: REITER_HOEHE };
    const aktiv = reiter === name;
    ui.schreibe(text, x + b / 2, y + REITER_HOEHE / 2, {
      groesse: 15, fett: aktiv ? true : "halb",
      farbe: aktiv ? F.primaer : F.gedaempft, ausrichtung: "center"
    });
    if (aktiv) {
      ui.ctx.fillStyle = F.primaer;
      ui.ctx.fillRect(x + 14, y + REITER_HOEHE - 3, b - 28, 3);
    }
    ui.merke("reiter-" + name, r, "reiter");
    if (ui.geklickt(r)) { reiter = name; bestenlisteOffen = false; }
  }

  /* ------------------------------------------------------------------ Info */

  function infoReiter() {
    ui.seite("info", function () {
      infoKarte("info-1", "Über den Maulwurf",
        "Ein Verräterspiel auf einem Grundriss nach dem Vorbild von Among Us: Das Team erledigt " +
        "Aufgaben in der Cafeteria, in der Elektrik, in den Motorräumen und überall dazwischen, " +
        "während ein oder zwei Maulwürfe sabotieren und Leute aus dem Verkehr ziehen. Wer eine " +
        "Leiche findet oder den Notfallknopf drückt, ruft alle zur Besprechung – danach wird " +
        "abgestimmt.");

      infoKarte("info-2", "Wie die Rollen verteilt werden",
        "Auch das Gerät der Gastgeberin oder des Gastgebers erfährt nicht, wer Maulwurf ist: Es " +
        "mischt nur einen anonymen Stapel Rollen, jedes Handy zieht sich danach selbst eine " +
        "daraus. Die gezogene Rolle ist serverseitig auf das eigene Gerät beschränkt.");

      const k = ui.beginneKarte("info-changelog");
        ui.titel("Änderungen", { groesse: 17 });
        APP_CHANGELOG.forEach(eintrag => {
          ui.luecke(6);
          ui.absatz("Version " + eintrag.version, { groesse: 14, fett: true, farbe: F.primaer, abstand: 6 });
          eintrag.groups.forEach(gruppe => {
            ui.absatz(gruppe.title, { groesse: 13, fett: "halb", farbe: F.text, abstand: 4 });
            gruppe.items.forEach(zeile => {
              punktZeile(zeile);
            });
            ui.luecke(4);
          });
        });
      ui.beendeKarte(k);
    });
  }

  function infoKarte(id, ueberschrift, text) {
    const k = ui.beginneKarte(id);
      ui.titel(ueberschrift, { groesse: 17 });
      ui.absatz(text, { groesse: 14 });
    ui.beendeKarte(k);
  }

  /* Aufzählungszeile mit hängendem Einzug — ein Punkt links, Text daneben. */
  function punktZeile(text) {
    const k = ui.oben();
    const einzug = 14;
    const vorher = k.cursor;
    ui.absatz(text, { groesse: 13, links: einzug, abstand: 5 });
    const c = ui.ctx;
    c.beginPath();
    c.arc(k.x + 4, k.y + vorher + 9, 2.5, 0, Math.PI * 2);
    c.fillStyle = F.gedaempft;
    c.fill();
  }

  /* ----------------------------------------------------------------- Start */

  function startBildschirm() {
    ui.seite("start", function () {
      ui.luecke(10);
      ui.titel("🕵️ Der Maulwurf", { zentriert: true, groesse: 30 });
      ui.absatz("Auf dem Vereinsgelände sind Maulwürfe unterwegs. Erledigt eure Aufgaben – " +
                "oder findet heraus, wer sie sabotiert. 4 bis 15 Mitspielende, je ein Handy.",
                { zentriert: true, groesse: 14 });
      ui.luecke(8);

      if (ui.knopf("btn-raum-erstellen", "Raum erstellen")) {
        ausstehenderModus = "erstellen";
        ui.setzeEingabe("input-spielername", "");
        nameFehler = "";
        startFehler = "";
        zeigeNameEingabe = true;
      }

      ui.trenner("oder");

      const code = ui.eingabe("input-raumcode", {
        platzhalter: "Raum-Code eingeben", maxLaenge: 6,
        zentriert: true, fett: true, grossschreiben: true
      });
      /* Der Code wird immer groß geschrieben — wie bisher das `input`-Ereignis. */
      if (code !== code.toUpperCase()) ui.setzeEingabe("input-raumcode", code.toUpperCase());

      const beitreten = ui.knopf("btn-raum-beitreten", "Raum beitreten", { art: "zweit" })
                     || ui.eingabeAbgeschickt("input-raumcode");
      if (beitreten) {
        const eingegeben = ui.leseEingabe("input-raumcode").trim().toUpperCase();
        if (!eingegeben) {
          startFehler = "Bitte einen Raum-Code eingeben.";
        } else {
          startFehler = "";
          raumcodeEingabe = eingegeben;
          ausstehenderModus = "beitreten";
          ui.setzeEingabe("input-spielername", "");
          nameFehler = "";
          zeigeNameEingabe = true;
        }
      }

      if (startFehler) ui.absatz(startFehler, { zentriert: true, groesse: 13, farbe: F.gefahr });

      ui.luecke(4);
      if (ui.knopf("btn-bestenliste-oeffnen", "🏆 Bestenliste", { art: "link" })) oeffneBestenliste();
    }, { zentriert: true });
  }

  /* ---------------------------------------------------------- Namenseingabe */

  let zeigeNameEingabe = false;

  function nameBildschirm() {
    ui.seite("name", function () {
      ui.titel("Wie heißt du?", { zentriert: true });
      ui.luecke(4);
      ui.eingabe("input-spielername", { platzhalter: "Dein Name", maxLaenge: 20, zentriert: true });

      const los = ui.knopf("btn-name-bestaetigen", "Weiter")
               || ui.eingabeAbgeschickt("input-spielername");
      if (los) bestaetigeName();

      if (nameFehler) ui.absatz(nameFehler, { zentriert: true, groesse: 13, farbe: F.gefahr });
      ui.luecke(4);
      if (ui.knopf("btn-name-zurueck", "Zurück", { art: "link" })) {
        zeigeNameEingabe = false;
        ui.loeseFokus();
      }
    }, { zentriert: true });
  }

  async function bestaetigeName() {
    const name = ui.leseEingabe("input-spielername").trim();
    /* Vollbild muss aus einer Nutzergeste kommen. Dieser Klick ist der einzige,
       den ALLE machen — wer nur beitritt, tippt danach nichts mehr an, bis die
       Partie längst läuft. Bewusst VOR dem await, sonst gilt die Geste als
       abgelaufen. */
    betreteVollbild();
    ui.loeseFokus();
    const ergebnis = ausstehenderModus === "erstellen"
      ? await gameService.erstelleRaum(name)
      : await gameService.tritRaumBei(raumcodeEingabe, name);
    if (ergebnis.erfolg) { zeigeNameEingabe = false; nameFehler = ""; }
    else nameFehler = ergebnis.fehler || "Das hat nicht funktioniert.";
    ui.anfordern();
  }

  /* ------------------------------------------------------------- Warteraum */

  function lobbyBildschirm(zustand) {
    ui.seite("lobby", function () {
      ui.titel("Warteraum", { groesse: 22 });

      /* Raumcode groß und gut ablesbar — er wird laut vorgelesen. */
      const k = ui.beginneKarte("lobby-code", { farbe: F.primaer, polster: 12 });
        ui.absatz("Raum-Code", { groesse: 12, fett: "halb", farbe: "rgba(8,19,31,0.7)", zentriert: true, abstand: 2 });
        ui.absatz(zustand.raumCode || "------", { groesse: 30, fett: true, farbe: F.aufFarbe, zentriert: true });
      ui.beendeKarte(k);

      if (zustand.istHost) {
        ui.absatz("Du bist Gastgeber:in", { groesse: 13, zentriert: true, abstand: 4 });
      }
      ui.absatz(zustand.spieler.length + "/" + zustand.maxSpieler + " Mitspielende",
                { groesse: 13, fett: "halb", zentriert: true });

      zustand.spieler.forEach(s => {
        const entfernbar = s.istSimuliert && zustand.istHost;
        const r = spielerZeile("sp-" + s.id, s, {
          notiz: entfernbar ? "" : (s.istHost ? "Gastgeber:in" : s.istSimuliert ? "🤖 KI" : ""),
          rechtsBreite: entfernbar ? 90 : 80,
          abstand: 6
        });
        if (entfernbar && zeilenKnopf("weg-" + s.id, r, "entfernen")) {
          gameService.entferneKiMitspieler(s.id);
        }
      });

      const genug = zustand.spieler.length >= zustand.minSpieler;

      if (zustand.istHost) {
        ui.luecke(4);
        einstellungenKlappe(zustand);
      }

      if (zustand.istHost && zustand.spieler.length < zustand.maxSpieler) {
        if (ui.knopf("btn-ki-hinzufuegen", "🤖 KI-Mitspieler hinzufügen", { art: "zweit" })) {
          gameService.fuegeKiMitspielerHinzu();
        }
      }
      if (zustand.istHost) {
        if (ui.knopf("btn-spiel-starten", "Partie starten", { aus: !genug })) starteSpiel();
      }

      const hinweis = lobbyHinweis || (genug
        ? (zustand.istHost ? "" : "Warte auf den Start …")
        : "Noch " + (zustand.minSpieler - zustand.spieler.length) + " Mitspielende nötig (oder KI hinzufügen).");
      if (hinweis) ui.absatz(hinweis, { groesse: 13, zentriert: true, farbe: lobbyHinweis ? F.gefahr : F.gedaempft });
    });
  }

  async function starteSpiel() {
    lobbyHinweis = "";
    const ergebnis = await gameService.starteSpiel();
    if (!ergebnis.erfolg && ergebnis.fehler) lobbyHinweis = ergebnis.fehler;
    ui.anfordern();
  }

  /* Die Einstellungen als aufklappbarer Block — entspricht dem `<details>`.
     Welche Felder erscheinen, hängt vom Modus ab: was im gewählten Modus
     wirkungslos wäre, wird ausgeblendet statt nur ignoriert. Sonst stellt man
     eine Diskussionszeit für ein Spiel ohne Besprechung ein und wundert sich. */
  function einstellungenKlappe(zustand) {
    const kopf = ui.reserviere(44, { abstand: 6 });
    ui.fuelleRund(kopf.x, kopf.y, kopf.b, kopf.h, ui.RADIUS_KLEIN, F.karte);
    ui.rahmeRund(kopf.x, kopf.y, kopf.b, kopf.h, ui.RADIUS_KLEIN, F.rand, 1);
    ui.schreibe("⚙️ Einstellungen", kopf.x + 14, kopf.y + 22, { groesse: 15, fett: "halb", farbe: F.text });
    ui.schreibe(einstellungenOffen ? "▴" : "▾", kopf.x + kopf.b - 18, kopf.y + 22,
                { groesse: 14, farbe: F.gedaempft, ausrichtung: "center" });
    ui.merke("lobby-einstellungen", kopf, "klappe");
    if (ui.geklickt(kopf)) einstellungenOffen = !einstellungenOffen;
    if (!einstellungenOffen) return;

    const e = zustand.einstellungen;
    const versteckt = e.modus === "verstecken";
    const k = ui.beginneKarte("lobby-einstellungen", { polster: 14, schatten: false, rand: F.rand });

      setze("ein-modus", "Spielmodus", [
        { wert: "klassisch", text: "🕵️ Klassisch – mit Besprechung" },
        { wert: "verstecken", text: "🥅 Verstecken – Fänger bekannt" }
      ], e.modus, function (w) {
        gameService.speichereEinstellungen({ modus: w === "verstecken" ? "verstecken" : "klassisch" });
      });

      if (!versteckt) {
        zahl("ein-maulwuerfe", "Maulwürfe", [1, 2, 3, 4], zustand.anzahlMaulwuerfe, "anzahlMaulwuerfe");
      }
      zahl("ein-aufgaben", "Aufgaben pro Person", [3, 4, 5, 6, 7], e.aufgabenProSpieler, "aufgabenProSpieler");
      zahl("ein-killcooldown", "Abklingzeit Foulspiel", [10, 20, 30, 45], e.killCooldownSek, "killCooldownSek", " s");

      if (versteckt) {
        zahl("ein-vorsprung", "Vorsprung", [10, 15, 25, 40], e.vorsprungSek, "vorsprungSek", " s");
        zahl("ein-zeitlimit", "Zeitlimit", [3, 5, 8, 12], e.zeitlimitMin, "zeitlimitMin", " min");
      } else {
        zahl("ein-notfall", "Notfallknöpfe je Person", [0, 1, 2], e.notfallKnoepfe, "notfallKnoepfe");
        zahl("ein-diskussion", "Diskussion", [30, 45, 60], e.diskussionSek, "diskussionSek", " s");
        zahl("ein-abstimmung", "Abstimmung", [45, 60, 90], e.abstimmungSek, "abstimmungSek", " s");
      }

      tempoFeld(e);

      if (!versteckt) {
        anAus("ein-rolle-rauswurf", "Rolle nach Rauswurf", e.rolleNachRauswurf, "rolleNachRauswurf",
              "verraten", "geheim halten");
      }
      anAus("ein-rolle-ingenieur", "🔧 Ingenieur", e.rolleIngenieur, "rolleIngenieur");
      anAus("ein-rolle-wissenschaftler", "🔬 Wissenschaftler", e.rolleWissenschaftler, "rolleWissenschaftler");
      anAus("ein-rolle-schutzengel", "😇 Schutzengel", e.rolleSchutzengel, "rolleSchutzengel");
      if (!versteckt) {
        anAus("ein-rolle-gestaltwandler", "🎭 Gestaltwandler", e.rolleGestaltwandler, "rolleGestaltwandler");
      }
    ui.beendeKarte(k);
  }

  function setze(id, beschriftung, optionen, wert, beiAenderung) {
    const neu = ui.feld(beschriftung, id, optionen, wert, { abstand: 10 });
    if (String(neu) !== String(wert)) beiAenderung(neu);
  }

  function zahl(id, beschriftung, werte, wert, schluessel, einheit) {
    const optionen = werte.map(w => ({ wert: w, text: w + (einheit || "") }));
    setze(id, beschriftung, optionen, naheliegend(werte, wert), function (neu) {
      const aenderung = {};
      aenderung[schluessel] = parseInt(neu, 10);
      gameService.speichereEinstellungen(aenderung);
    });
  }

  function anAus(id, beschriftung, wert, schluessel, anText, ausText) {
    setze(id, beschriftung, [
      { wert: 1, text: anText || "an" },
      { wert: 0, text: ausText || "aus" }
    ], wert ? 1 : 0, function (neu) {
      const aenderung = {};
      aenderung[schluessel] = parseInt(neu, 10);
      gameService.speichereEinstellungen(aenderung);
    });
  }

  /* Ein Raum kann ein Lauftempo aus einer früheren Fassung tragen (die Stufen
     wurden am 2026-07-27 gesenkt). Ein Wert ohne passenden Eintrag ließe das
     Feld LEER stehen — sichtbar kaputt, obwohl der Raum in Ordnung ist. */
  function tempoFeld(e) {
    const stufen = [{ wert: 150, text: "gemütlich" }, { wert: 186, text: "normal" }, { wert: 226, text: "flott" }];
    setze("ein-tempo", "Lauftempo", stufen,
          naheliegend(stufen.map(s => s.wert), e.tempo), function (neu) {
      gameService.speichereEinstellungen({ tempo: parseInt(neu, 10) });
    });
  }

  function naheliegend(werte, wert) {
    const zahl2 = Number(wert);
    for (let i = 0; i < werte.length; i++) if (Number(werte[i]) === zahl2) return werte[i];
    let beste = werte[0], abstand = Math.abs(Number(werte[0]) - zahl2);
    werte.forEach(w => {
      const a = Math.abs(Number(w) - zahl2);
      if (a < abstand) { abstand = a; beste = w; }
    });
    return beste;
  }

  /* --------------------------------------------------------- Rollenziehung */

  function revealBildschirm(zustand) {
    ui.seite("reveal", function () {
      /* Die Rollenkarte ist der einzige Bildschirm, der ganz von einer Farbe
         lebt — hier steht die wichtigste Information der Partie. Rot glüht,
         Grün beruhigt, beide dunkel genug für helle Schrift darauf. */
      let farbe = "#2a3556", icon = "❓", rolle = "Rolle wird gezogen …";
      let text = "Dein Gerät zieht gerade verdeckt eine Rolle aus dem gemischten Stapel.";
      let team = "";

      if (zustand.meineRolle) {
        if (zustand.versteckModus) {
          /* Hier ist nichts geheim. Beide Seiten erfahren denselben Namen — das
             Spannende ist nicht, WER der Fänger ist, sondern wo er steckt. */
          const faenger = zustand.spieler.find(s => s.id === zustand.faengerUid);
          const binFaenger = zustand.meineRolle === "maulwurf";
          farbe = binFaenger ? "#8e1733" : "#0d5344";
          icon = binFaenger ? "🥅" : "🙈";
          rolle = binFaenger ? "Du bist der Fänger" : "Versteck dich!";
          text = binFaenger
            ? "Alle wissen, wer du bist. Dafür siehst du selbst kaum etwas – die Nähe-Anzeige führt dich."
            : "Erledigt eure Aufgaben oder haltet einfach durch, bis die Zeit um ist. Besprechungen gibt es keine.";
          team = binFaenger
            ? "Du bekommst " + zustand.einstellungen.vorsprungSek + " Sekunden Vorsprung – so lange stehst du fest."
            : faenger ? "Der Fänger ist: " + faenger.name : "Der Fänger wird gerade ausgelost …";
        } else if (zustand.meineRolle === "maulwurf") {
          farbe = "#8e1733";
          icon = "🕵️";
          rolle = "Du bist Maulwurf";
          text = "Tu so, als würdest du arbeiten. Sabotiere, schalte Leute aus – und lass dich nicht erwischen.";
          const mit = zustand.maulwurfTeam
            .filter(uid => uid !== zustand.eigenerSpielerId)
            .map(uid => (zustand.spieler.find(s => s.id === uid) || {}).name)
            .filter(Boolean);
          team = mit.length ? "Mit dir im Bunde: " + mit.join(", ") : "Du bist allein unterwegs.";
        } else {
          farbe = "#0d5344";
          icon = "⚽";
          rolle = "Du gehörst zum Team";
          text = "Erledige deine Aufgaben auf dem Gelände und finde heraus, wer sabotiert.";
          team = "Achtung: " + (zustand.anzahlMaulwuerfe === 1
            ? "Ein Maulwurf ist" : zustand.anzahlMaulwuerfe + " Maulwürfe sind") + " unter euch.";
        }

        /* Die Sonderrolle ersetzt Symbol und Überschrift, behält aber die
           Seitenfarbe: die Zugehörigkeit ist die wichtigere Information. */
        const sonder = zustand.meineSonderrolle && rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
        if (sonder) {
          icon = sonder.icon;
          rolle = "Du bist " + sonder.name;
          text = sonder.beschreibung;
        }
      }

      const k = ui.beginneKarte("reveal-karte", { farbe: farbe, polster: 22 });
        ui.absatz(icon, { groesse: 54, zentriert: true, abstand: 6 });
        ui.titel(rolle, { zentriert: true, groesse: 24, farbe: "#fff" });
        ui.absatz(text, { zentriert: true, groesse: 15, farbe: "rgba(255,255,255,0.85)" });
        if (team) {
          ui.luecke(4);
          ui.absatz(team, { zentriert: true, groesse: 14, fett: "halb", farbe: "#fff" });
        }
      ui.beendeKarte(k);
    }, { zentriert: true });
  }

  /* ------------------------------------------------------------ Besprechung */

  function meetingBildschirm(zustand) {
    const meeting = zustand.meeting;
    const rest = Math.max(Math.ceil((meeting.endeAt - zustand.jetzt) / 1000), 0);

    if (letzteMeetingUnterphase !== meeting.unterphase) {
      letzteMeetingUnterphase = meeting.unterphase;
      if (meeting.unterphase === "abstimmung") meineStimme = null;
    }

    ui.seite("meeting", function () {
      const titelText = meeting.unterphase === "diskussion" ? "🗣️ Besprechung"
                      : meeting.unterphase === "abstimmung" ? "🗳️ Abstimmung" : "📢 Ergebnis";

      /* Überschrift links, Restzeit rechts in derselben Zeile */
      const kopf = ui.reserviere(38, { abstand: 4 });
      ui.schreibe(titelText, kopf.x, kopf.y + 19, { groesse: 20, fett: true, farbe: F.text });
      const zeitB = 52;
      const zr = { x: kopf.x + kopf.b - zeitB, y: kopf.y + 3, b: zeitB, h: 32 };
      ui.fuelleRund(zr.x, zr.y, zr.b, zr.h, 8, rest <= 10 ? F.gefahr : F.primaer);
      ui.schreibe(String(rest), zr.x + zeitB / 2, zr.y + 16,
                  { groesse: 16, fett: true, farbe: F.aufFarbe, ausrichtung: "center" });

      ui.absatz(meeting.grund === "leiche"
        ? meeting.ausgeloestVon + " hat " + (meeting.opferName || "jemanden") + " gefunden."
        : meeting.ausgeloestVon + " hat den Notfallknopf gedrückt.", { groesse: 13 });

      if (meeting.unterphase === "diskussion") diskussion(zustand);
      if (meeting.unterphase === "abstimmung") abstimmung(zustand);
      if (meeting.unterphase === "ergebnis") meetingErgebnis(zustand);
    });
  }

  function diskussion(zustand) {
    /* Chatverlauf: fester Bereich, der von selbst nach unten mitläuft. */
    const hoehe = Math.max(140, Math.min(300, ui.hoehe - 420));
    const z = ui.zustand("chat-roll", { versatz: 0, inhaltH: 0 });
    const vorherH = z.inhaltH;

    const k = ui.beginneKarte("chat-rahmen", { polster: 8, schatten: false, rand: F.rand });
      ui.scroll("chat-roll", hoehe, function (b) {
        if (!zustand.chat.length) {
          ui.absatz("Noch nichts gesagt.", { groesse: 13, zentriert: true });
        }
        zustand.chat.forEach((n, i) => {
          const nameB = ui.textBreite(n.name + ": ", 13, "halb");
          const zeilen = ui.umbrich(n.text, b - nameB - 8, 13);
          const r = ui.reserviere(Math.max(20, zeilen.length * 18), { abstand: 2 });
          ui.schreibe(n.name + ":", r.x, r.y + 10, { groesse: 13, fett: "halb", farbe: n.farbe || F.text });
          zeilen.forEach((zeile, j) => {
            ui.schreibe(zeile, r.x + (j === 0 ? nameB : 0), r.y + 10 + j * 18, { groesse: 13, farbe: F.text });
          });
        });
      }, { abstand: 2 });
    ui.beendeKarte(k);

    /* Neue Nachricht: ans Ende springen, aber nur wenn nicht gerade
       zurückgeblättert wird — sonst reißt es einem den Verlauf weg. */
    if (z.inhaltH > vorherH) {
      const maxV = Math.max(0, z.inhaltH - hoehe);
      if (maxV - z.versatz < (z.inhaltH - vorherH) + 40) z.versatz = maxV;
    }

    if (zustand.binGeist) {
      ui.absatz("Geister können nicht reden.", { groesse: 13, zentriert: true, farbe: F.gedaempft });
      return;
    }

    /* Schnellsätze: schneller als tippen, gerade im fahrenden Bus. */
    schnellSaetze();

    /* Eingabezeile: Feld links, Senden rechts */
    const zeile = ui.reserviere(50, { abstand: 8 });
    const knopfB = 54;
    ui.beginneKasten({ x: zeile.x, y: zeile.y, b: zeile.b - knopfB - 8, h: zeile.h }, 0);
      ui.eingabe("input-chat", { platzhalter: "Nachricht …", maxLaenge: 140, hoehe: 50 });
    ui.beendeKasten();
    ui.beginneKasten({ x: zeile.x + zeile.b - knopfB, y: zeile.y, b: knopfB, h: zeile.h }, 0);
      const senden = ui.knopf("btn-chat-senden", "➤", { hoehe: 50, groesse: 18 });
    ui.beendeKasten();

    if (senden || ui.eingabeAbgeschickt("input-chat")) {
      const text = ui.leseEingabe("input-chat").trim();
      if (text) {
        gameService.sendeChat(text);
        ui.setzeEingabe("input-chat", "");
      }
    }
  }

  function schnellSaetze() {
    const k = ui.oben();
    let x = 0, zeilenY = 0;
    const hoeheProZeile = 34;
    const rechtecke = [];
    SCHNELL_PHRASEN.forEach((text, i) => {
      const b = ui.textBreite(text, 12, "halb") + 20;
      if (x + b > k.b && x > 0) { x = 0; zeilenY += hoeheProZeile; }
      rechtecke.push({ text: text, x: x, y: zeilenY, b: b });
      x += b + 6;
    });
    const gesamt = zeilenY + hoeheProZeile;
    const r = ui.reserviere(gesamt, { abstand: 6 });
    rechtecke.forEach((e, i) => {
      const er = { x: r.x + e.x, y: r.y + e.y, b: e.b, h: 30 };
      ui.fuelleRund(er.x, er.y, er.b, er.h, 15, ui.gedruecktAuf(er) ? "rgba(34,211,238,0.28)" : "rgba(34,211,238,0.1)");
      ui.rahmeRund(er.x, er.y, er.b, er.h, 15, F.rand, 1);
      ui.schreibe(e.text, er.x + e.b / 2, er.y + 15, { groesse: 12, fett: "halb", farbe: F.primaer, ausrichtung: "center" });
      ui.merke("schnell-" + i, er, "knopf");
      if (ui.geklickt(er)) gameService.sendeChat(e.text);
    });
  }

  function abstimmung(zustand) {
    const stimmen = zustand.meeting.stimmen || {};
    const habeGestimmt = !!stimmen[zustand.eigenerSpielerId];

    ui.absatz("Wer ist der Maulwurf?", { groesse: 13, fett: "halb" });

    zustand.spieler.forEach(s => {
      const anzahl = Object.keys(stimmen).filter(uid => stimmen[uid] === s.id).length;
      const tot = s.lebt === false;
      const r = spielerZeile("st-" + s.id, s, {
        namenszusatz: tot ? " (raus)" : "",
        notiz: anzahl > 0 ? "▮".repeat(anzahl) : "",
        notizFarbe: F.primaer,
        hervorgehoben: meineStimme === s.id,
        blass: tot,
        rechtsBreite: 96,
        abstand: 6
      });
      const gesperrt = tot || zustand.binGeist || habeGestimmt;
      if (zeilenKnopf("wahl-" + s.id, r, "wählen", { aus: gesperrt })) waehle(s.id);
    });

    if (ui.knopf("btn-stimme-skip", "Überspringen", {
      art: "zweit", aus: zustand.binGeist || habeGestimmt
    })) waehle("skip");

    const lebende = zustand.spieler.filter(s => s.lebt !== false).length;
    const abgegeben = Object.keys(stimmen).length;
    ui.absatz(zustand.binGeist
      ? "Als Geist stimmst du nicht mit ab."
      : habeGestimmt ? "Stimme abgegeben – " + abgegeben + " von " + lebende
      : abgegeben + " von " + lebende + " haben gewählt",
      { groesse: 13, zentriert: true });
  }

  async function waehle(id) {
    const ergebnis = await gameService.stimmeAb(id);
    if (ergebnis.erfolg) { meineStimme = id; ui.anfordern(); }
  }

  function meetingErgebnis(zustand) {
    const ergebnis = zustand.meeting.ergebnis || {};
    /* Ohne die Einstellung bliebe hier für immer „Wird geprüft …" stehen, weil
       dann niemand `warMaulwurf` schreibt. */
    const deckeAuf = !!zustand.einstellungen.rolleNachRauswurf;
    const zeile2 = !ergebnis.ausgeschlossenName
      ? "Stimmengleichheit oder Mehrheit fürs Überspringen."
      : !deckeAuf ? "Ob das richtig war, bleibt offen."
      : ergebnis.warMaulwurf === undefined ? "Wird geprüft …"
      : ergebnis.warMaulwurf ? "🕵️ … und war tatsächlich ein Maulwurf!" : "⚽ … war kein Maulwurf.";

    const k = ui.beginneKarte("meeting-ergebnis", { polster: 20 });
      ui.absatz(ergebnis.ausgeschlossenName
        ? ergebnis.ausgeschlossenName + " muss gehen."
        : "Niemand muss gehen.", { groesse: 19, fett: true, farbe: F.text, zentriert: true });
      ui.absatz(zeile2, { groesse: 14, zentriert: true });
    ui.beendeKarte(k);

    gameService.deckeAusgeschlosseneRolleAuf();
  }

  /* ------------------------------------------------------------------ Ende */

  function endeBildschirm(zustand) {
    ui.seite("ende", function () {
      const teamGewinnt = zustand.sieger === "team";
      ui.titel(zustand.versteckModus
        ? (teamGewinnt ? "🙈 Die Versteckten gewinnen!" : "🥅 Der Fänger gewinnt!")
        : (teamGewinnt ? "⚽ Das Team gewinnt!" : "🕵️ Die Maulwürfe gewinnen!"),
        { zentriert: true, groesse: 24 });

      if (zustand.meineRolle) {
        const habeGewonnen = (teamGewinnt && zustand.meineRolle === "team")
                          || (!teamGewinnt && zustand.meineRolle === "maulwurf");
        ui.absatz(habeGewonnen ? "Du hast gewonnen 🎉" : "Du hast verloren", {
          zentriert: true, groesse: 18, fett: true,
          farbe: habeGewonnen ? F.erfolg : F.gefahr
        });
      }
      if (zustand.siegGrund) ui.absatz(zustand.siegGrund, { zentriert: true, groesse: 14 });

      ui.luecke(6);
      const aufdeckung = zustand.aufdeckung || {};
      zustand.spieler.forEach(s => {
        const rolle = aufdeckung[s.id];
        spielerZeile("auf-" + s.id, s, {
          notiz: rolle === "maulwurf" ? (zustand.versteckModus ? "🥅 Fänger" : "🕵️ Maulwurf")
               : rolle === "team" ? (zustand.versteckModus ? "🙈 Versteckt" : "⚽ Team")
               : "– unbekannt",
          notizFarbe: rolle === "maulwurf" ? F.gefahr : rolle === "team" ? F.erfolg : F.gedaempft,
          rechtsBreite: 90,
          abstand: 6
        });
      });

      ui.luecke(6);
      if (zustand.istHost) {
        if (ui.knopf("btn-neue-runde", "Neue Runde (gleiche Leute)")) gameService.neueRunde();
      }
      if (ui.knopf("btn-ende-verlassen", "Zurück zum Start", { art: "zweit" })) gameService.raeumeRaumAuf();
      if (ui.knopf("btn-ende-bestenliste", "🏆 Bestenliste", { art: "link" })) oeffneBestenliste();
    });
  }

  function abgebrochenBildschirm() {
    ui.seite("abgebrochen", function () {
      ui.titel("🚫 Partie abgebrochen", { zentriert: true, groesse: 24 });
      ui.absatz("Die Gastgeberin oder der Gastgeber hat die Partie beendet.",
                { zentriert: true, groesse: 14 });
      ui.luecke(6);
      if (ui.knopf("btn-abbruch-zurueck", "Zurück zum Start")) gameService.raeumeRaumAuf();
    }, { zentriert: true });
  }

  /* ------------------------------------------------------------ Bestenliste */

  function oeffneBestenliste() {
    bestenlisteOffen = true;
    bestenlisteDaten = null;
    ladeBestenliste();
  }

  async function ladeBestenliste() {
    if (bestenlisteLaeuft) return;
    bestenlisteLaeuft = true;
    try {
      bestenlisteDaten = await gameService.ladeBestenliste();
    } catch (e) {
      bestenlisteDaten = [];
    }
    bestenlisteLaeuft = false;
    ui.anfordern();
  }

  function bestenlisteBildschirm() {
    ui.seite("bestenliste", function () {
      ui.titel("🏆 Bestenliste", { groesse: 22 });

      if (bestenlisteDaten === null) {
        ui.absatz("Wird geladen …", { zentriert: true, groesse: 14 });
      } else if (!bestenlisteDaten.length) {
        ui.absatz("Noch keine beendeten Partien.", { zentriert: true, groesse: 14 });
      } else {
        tabelle(bestenlisteDaten);
      }

      ui.luecke(6);
      if (istAdmin && bestenlisteDaten && bestenlisteDaten.length) {
        if (ui.knopf("btn-bestenliste-zuruecksetzen", "🗑️ Bestenliste zurücksetzen", { art: "gefahr" })) {
          abfrage = {
            text: "Bestenliste wirklich unwiderruflich zurücksetzen?",
            jaText: "Zurücksetzen",
            beiJa: async function () {
              await gameService.setzeBestenlisteZurueck();
              bestenlisteDaten = null;
              ladeBestenliste();
            }
          };
        }
      }
      if (ui.knopf("btn-bestenliste-zurueck", "Zurück", { art: "link" })) bestenlisteOffen = false;
    });
  }

  /* Vier Spalten als gezeichnetes Raster — ersetzt die `<table>`. */
  function tabelle(eintraege) {
    const k = ui.beginneKarte("bl-tabelle", { polster: 0 });
      const spalten = [0.46, 0.18, 0.2, 0.16];
      const kopf = ui.reserviere(38, { abstand: 0 });
      ui.fuelleRund(kopf.x, kopf.y, kopf.b, kopf.h, 0, "rgba(255,255,255,0.05)");
      spaltenText(kopf, spalten, ["Name", "Gespielt", "Gewonnen", "%"], 12, "halb", F.gedaempft);

      eintraege.forEach((e, i) => {
        const r = ui.reserviere(40, { abstand: 0 });
        if (i % 2 === 1) {
          ui.ctx.fillStyle = "rgba(255,255,255,0.03)";
          ui.ctx.fillRect(r.x, r.y, r.b, r.h);
        }
        spaltenText(r, spalten, [e.name, String(e.gespielt), String(e.gewonnen), e.prozent + "%"],
                    14, i === 0 ? "halb" : null, F.text);
      });
    ui.beendeKarte(k);
  }

  function spaltenText(r, anteile, texte, groesse, fett, farbe) {
    let x = r.x + 12;
    anteile.forEach((anteil, i) => {
      const b = r.b * anteil;
      const rechts = i > 0;
      ui.schreibe(ui.kuerze(texte[i], b - 10, groesse, fett),
                  rechts ? x + b - 14 : x, r.y + r.h / 2,
                  { groesse: groesse, fett: fett, farbe: farbe, ausrichtung: rechts ? "right" : "left" });
      x += b;
    });
  }

  /* -------------------------------------------------------------- Rückfrage */

  /* Ersetzt `window.confirm`. Der eingebaute Dialog friert auf dem Handy die
     Seite ein und sieht in einem Vollbildspiel wie ein Absturz aus. */
  function rueckfrage() {
    if (!abfrage) return;
    const d = ui.beginneDialog("abfrage", { breite: 380 });
      ui.absatz(abfrage.text, { groesse: 16, farbe: F.text, zentriert: true });
      ui.luecke(4);
      if (ui.knopf("abfrage-ja", abfrage.jaText || "Ja", { art: "gefahr" })) {
        const tun = abfrage.beiJa;
        abfrage = null;
        if (tun) tun();
      }
      if (ui.knopf("abfrage-nein", "Abbrechen", { art: "zweit" })) abfrage = null;
    ui.beendeDialog(d);
  }

  /* ==================================================================== */
  /*  Einstieg: eine Szene, aus der alles hervorgeht                      */
  /* ==================================================================== */

  /* Welcher Bildschirm zuletzt zu sehen war, und wie weit er eingeblendet ist.
     Ein Wechsel ohne Übergang wirkt auf einer einzigen Zeichenfläche wie ein
     Aussetzer — es gibt ja keinen Seitenaufbau, den das Auge als Wechsel
     lesen könnte. 160 ms genügen dafür; alles darüber fühlt sich zäh an,
     wenn man in der Besprechung schnell hin und her tippt. */
  let letzterBildschirm = "";
  let einblendung = 1;
  const EINBLENDDAUER = 0.16;

  function welcherBildschirm(zustand) {
    if (reiter === "info") return "info";
    if (bestenlisteOffen) return "bestenliste";
    if (!zustand || zustand.phase === "start") return zeigeNameEingabe ? "name" : "start";
    if (zustand.phase === "laeuft" && zustand.meeting) return "meeting:" + zustand.meeting.unterphase;
    return zustand.phase;
  }

  function zeichneMenue(zustand) {
    const c = ui.ctx;
    c.fillStyle = F.hintergrund;
    c.fillRect(0, 0, ui.breite, ui.hoehe);

    kopfzeile(zustand);
    reiterLeiste();

    const jetzigerBildschirm = welcherBildschirm(zustand);
    if (jetzigerBildschirm !== letzterBildschirm) {
      letzterBildschirm = jetzigerBildschirm;
      einblendung = 0;
    }

    /* Der Inhalt blendet auf; Kopfzeile und Reiter bleiben stehen — sie sind
       Rahmen, kein Inhalt.
       BEWUSST nur Deckkraft, kein Hereinwandern: `ctx.translate` verschiebt die
       Pixel, nicht die gemerkten Trefferflächen. Wer in den ersten Millisekunden
       tippt, träfe dann einen Knopf, der sichtbar woanders steht. Bewegung gibt
       es dort, wo es nichts zu treffen gibt — Aufgabenbalken und Sabotagewarnung. */
    const bewegt = einblendung < 1;
    if (bewegt) {
      c.save();
      c.globalAlpha = einblendung;
    }

    if (reiter === "info") { infoReiter(); }
    else if (bestenlisteOffen) { bestenlisteBildschirm(); }
    else if (!zustand || zustand.phase === "start") {
      if (zeigeNameEingabe) nameBildschirm(); else startBildschirm();
    }
    else if (zustand.phase === "lobby") lobbyBildschirm(zustand);
    else if (zustand.phase === "zuteilung") revealBildschirm(zustand);
    else if (zustand.phase === "laeuft" && zustand.meeting) meetingBildschirm(zustand);
    else if (zustand.phase === "beendet") endeBildschirm(zustand);
    else if (zustand.phase === "abgebrochen") abgebrochenBildschirm();
    else startBildschirm();

    if (bewegt) {
      c.restore();
      einblendung = Math.min(1, einblendung + ui.delta / EINBLENDDAUER);
      ui.anfordern();
    }

    /* Die Rückfrage liegt AUSSERHALB der Einblendung: sie erscheint über dem
       Bildschirm, der stehen bleibt, und darf nicht mitwandern. */
    rueckfrage();
  }

  return {
    zeichneMenue: zeichneMenue,
    rueckfrage: rueckfrage,
    /* Ein Wechsel in eine neue Phase soll den Warteraum-Hinweis und die
       Fehlertexte nicht mitschleppen. */
    phaseGewechselt: function (phase) {
      lobbyHinweis = "";
      nameFehler = "";
      if (phase !== "start") { startFehler = ""; }
      if (phase === "lobby" || phase === "start") bestenlisteOffen = false;
      if (phase !== "start") zeigeNameEingabe = false;
    },
    zurueckZumStart: function () { zeigeNameEingabe = false; bestenlisteOffen = false; reiter = "spiel"; },
    get reiter() { return reiter; },
    set reiter(v) { reiter = v; },
    get imMenue() { return true; },
    avatar: avatar,
    spielerZeile: spielerZeile,
    zeilenKnopf: zeilenKnopf,
    frageNach: function (text, jaText, beiJa) { abfrage = { text: text, jaText: jaText, beiJa: beiJa }; },
    KOPF_HOEHE: KOPF_HOEHE,
    REITER_HOEHE: REITER_HOEHE
  };
})();
