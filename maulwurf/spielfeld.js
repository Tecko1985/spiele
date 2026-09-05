/* ============================================================================
   spielfeld.js — Bedienoberfläche während der Partie
   ----------------------------------------------------------------------------
   Alles, was über der Karte liegt: Aufgabenbalken, Kopfzeile mit Raumnamen und
   Rolle, Verstecken-Anzeige, Warnzeile, Steuerkreuz, Aktionsleiste, das
   Schachtpanel und die fünf Dialoge (Aufgabe, Aufgabenliste, Sonderrolle,
   Sabotage, Kameras).

   Wird NACH app.js geladen und benutzt dessen Funktionen (`ermittleAktion`,
   `findeKillZiel`, `findeMeldbareLeiche`, `zeichneKamerabild`, …) sowie
   `gameService`, `karte`, `rollenModul` und `aufgabenModul`.

   Anders als früher gibt es kein „Öffnen" und „Schließen" von Elementen mehr:
   `offenerDialog` sagt, was zu sehen ist, und das Bild ergibt sich daraus. Die
   alte Fassung musste bei jeder Zustandsänderung daran denken, Knöpfe zu
   sperren, Beschriftungen zu setzen und Overlays zu schließen — genau dort
   saßen die meisten Fehler.
============================================================================ */

const spielfeld = (function () {
  "use strict";

  const F = ui.F;

  let offenerDialog = null;      // "aufgabe" | "liste" | "rolle" | "sabotage" | "kameras"
  let aktivesMinispiel = null;   // { zeichne, aufraeumen } aus aufgaben.js
  let aufgabeTitel = "";
  let aufgabeGesperrt = false;
  let aktiveStation = null;
  let sabotageHinweis = "";
  let rollenStatus = "";
  let kameraLetzterWrite = 0;
  let hudFehler = "";            // kurzlebige Rückmeldung, z.B. „zu früh"
  let hudFehlerBis = 0;
  let gezeigterAnteil = 0;       // der Fortschrittsbalken zieht dem echten Wert weich nach
  let aufleuchtenBis = 0;        // bis wann er nach einer erledigten Aufgabe leuchtet

  /* Maße der Bedienelemente. Der Daumen trifft im fahrenden Bus nichts
     Kleineres — deshalb großzügiger als am Schreibtisch nötig. */
  const KNOPF_R = 32;
  const HAUPT_R = 40;
  const KREUZ_R = 62;

  /* Untergrenze der Minispielfläche. Sie greift erst unterhalb von rund
     316 px Bildhöhe — dort ist ein Minispiel zwar gedrängt, aber noch
     bedienbar, und der Schließen-Knopf bleibt erreichbar. Ohne Untergrenze
     würde die Fläche auf einem sehr flachen Fenster gegen null gehen. */
  const MINISPIEL_MIN_HOEHE = 150;

  /* ==================================================================== */
  /*  Kopfleiste                                                          */
  /* ==================================================================== */

  function hud(zustand) {
    const c = ui.ctx;
    const pos = zustand.meinePosition;

    /* Fortschrittsbalken ganz oben über die volle Breite.
       Er wächst weich statt zu springen, und wenn eine Aufgabe fertig wird,
       leuchtet er kurz auf. Das ist die einzige Rückmeldung, dass die Arbeit von
       jemand anderem etwas gebracht hat — der Sprung allein ging im Spiel unter,
       weil man beim Laufen nicht auf einen 6 px hohen Streifen schaut. */
    const aufgaben = zustand.aufgaben || { erledigt: 0, gesamt: 0 };
    const anteil = aufgaben.gesamt > 0 ? Math.min(aufgaben.erledigt / aufgaben.gesamt, 1) : 0;
    if (anteil > gezeigterAnteil + 0.0005) aufleuchtenBis = zustand.jetzt + 900;
    gezeigterAnteil += (anteil - gezeigterAnteil) * Math.min(1, ui.delta * 6);
    if (Math.abs(anteil - gezeigterAnteil) < 0.0005) gezeigterAnteil = anteil;

    const leuchtet = zustand.jetzt < aufleuchtenBis;
    c.fillStyle = "rgba(8,14,26,0.55)";
    c.fillRect(0, 0, ui.breite, 6);
    c.fillStyle = leuchtet ? F.primaerHell : F.erfolg;
    c.fillRect(0, 0, ui.breite * gezeigterAnteil, 6);
    if (leuchtet) {
      /* Ein heller Kamm am vorderen Ende, der mit dem Aufleuchten ausklingt. */
      const rest = (aufleuchtenBis - zustand.jetzt) / 900;
      c.fillStyle = "rgba(255,255,255," + (0.75 * rest).toFixed(3) + ")";
      c.fillRect(Math.max(0, ui.breite * gezeigterAnteil - 26), 0, 26, 6);
    }

    /* Zeile mit Raumname links, Rolle mittig, Vollbild rechts */
    const y = 8;
    const zeilenH = 30;
    c.fillStyle = "rgba(8,14,26,0.5)";
    c.fillRect(0, 6, ui.breite, zeilenH + 4);

    ui.schreibe(pos ? karte.raumName(pos.x, pos.y) : "", 12, y + zeilenH / 2, {
      groesse: 14, fett: "halb", farbe: "#fff"
    });

    const rolleText = zustand.binGeist ? "👻 Geist" : rollenBezeichnung(zustand);
    const rolleFarbe = zustand.binGeist ? "#c7d2e5"
                     : zustand.meineRolle === "maulwurf" ? "#fca5a5" : "#86efac";
    ui.schreibe(rolleText, ui.breite / 2, y + zeilenH / 2, {
      groesse: 13, fett: "halb", farbe: rolleFarbe, ausrichtung: "center"
    });

    const vr = { x: ui.breite - 42, y: y, b: 32, h: zeilenH };
    ui.schreibe("⛶", vr.x + 16, y + zeilenH / 2, { groesse: 18, farbe: "#fff", ausrichtung: "center" });
    if (ui.geklickt(vr)) { if (vollbildAktiv()) verlasseVollbild(); else betreteVollbild(); }

    let untenY = 6 + zeilenH + 4;

    /* Verstecken-Modus: Uhr und Nähe */
    if (zustand.versteckModus) {
      untenY = versteckLeiste(zustand, untenY);
    }

    /* Sabotage-Warnung */
    const sab = zustand.sabotage;
    let warnung = "";
    let warnFarbe = F.gefahr;
    if (sab && sab.typ === "reaktor") {
      const rest = Math.max(Math.ceil((sab.endeAt - zustand.jetzt) / 1000), 0);
      warnung = "☢️ Reaktor überhitzt – " + rest + " s bis zur Kernschmelze. Beide Kühlventile gleichzeitig halten!";
    } else if (sab && sab.typ === "licht") {
      warnung = "💡 Licht aus – Sicherungskasten in der Elektrik.";
      warnFarbe = F.warnung;
    } else if (sab && sab.typ === "funk") {
      warnung = "📻 Funk gestört – keine Kameras, keine Aufgabenliste. Funkpult in der Kommunikation.";
      warnFarbe = F.warnung;
    }
    if (hudFehler && zustand.jetzt < hudFehlerBis) { warnung = hudFehler; warnFarbe = F.gefahr; }
    if (warnung) {
      const zeilen = ui.umbrich(warnung, ui.breite - 24, 13, "halb");
      const h = zeilen.length * 18 + 10;
      /* Der Balken pulst, solange eine Sabotage läuft — bei der Kernschmelze
         schneller, je näher das Ende rückt. Eine stehende Warnleiste übersieht
         man nach zwanzig Sekunden; eine, die atmet, bleibt im Augenwinkel.
         Eine EIGENE Fehlermeldung (hudFehler) pulst nicht: sie steht nur kurz
         und soll gelesen, nicht beachtet werden. */
      let staerke = 0;
      if (sab && (!hudFehler || zustand.jetzt >= hudFehlerBis)) {
        let takt = 1.6;
        if (sab.typ === "reaktor") {
          const restAnteil = Math.max(0, Math.min(1, (sab.endeAt - zustand.jetzt) / 30000));
          takt = 0.9 + restAnteil * 1.6;      // je knapper die Zeit, desto hektischer
        }
        staerke = 0.5 + 0.5 * Math.sin((zustand.jetzt / 1000) * (Math.PI * 2 / takt));
      }
      c.fillStyle = warnFarbe;
      c.globalAlpha = 0.72 + 0.28 * staerke;
      c.fillRect(0, untenY, ui.breite, h);
      c.globalAlpha = 1;
      zeilen.forEach((z, i) => {
        ui.schreibe(z, ui.breite / 2, untenY + 5 + i * 18 + 9, {
          groesse: 13, fett: "halb", farbe: F.aufFarbe, ausrichtung: "center"
        });
      });
    }
  }

  function versteckLeiste(zustand, y) {
    const c = ui.ctx;
    const binFaenger = zustand.eigenerSpielerId === zustand.faengerUid;
    const vorsprungRest = zustand.vorsprungBis ? zustand.vorsprungBis - zustand.jetzt : 0;

    let uhrText, uhrFarbe = "#fff";
    if (!zustand.zeitlimitBis) {
      uhrText = "⏳ …";                     // Startzeit steht noch nicht fest
    } else if (vorsprungRest > 0) {
      uhrText = binFaenger
        ? "⏳ Noch " + Math.ceil(vorsprungRest / 1000) + " s – du darfst noch nicht los"
        : "⏳ " + Math.ceil(vorsprungRest / 1000) + " s Vorsprung";
      uhrFarbe = "#fde68a";
    } else {
      const rest = zustand.zeitlimitBis - zustand.jetzt;
      uhrText = "⏱ " + mmss(rest);
      if (rest < 30000) uhrFarbe = "#fca5a5";
    }

    const d = zustand.binGeist ? null : naechsteGegenseite(zustand);
    const stufe = d === null ? null : NAEHE_STUFEN.find(s => d <= s.bis);
    const naeheText = stufe ? stufe.text : (binFaenger ? "🔍 niemand in der Nähe" : "🟢 Luft rein");

    const h = 26;
    c.fillStyle = "rgba(8,14,26,0.42)";
    c.fillRect(0, y, ui.breite, h);
    ui.schreibe(uhrText, 12, y + h / 2, { groesse: 12, fett: "halb", farbe: uhrFarbe });
    ui.schreibe(naeheText, ui.breite - 12, y + h / 2, {
      groesse: 12, fett: "halb", farbe: "#fff", ausrichtung: "right"
    });
    return y + h;
  }

  /* ==================================================================== */
  /*  Steuerkreuz                                                         */
  /* ==================================================================== */

  /* Beansprucht seinen Finger dauerhaft: er darf über den Kreis hinausgezogen
     werden, ohne dass unterwegs Knöpfe auslösen — und ohne dass er nach dem
     Verlassen des Kreises die Steuerung verliert. */
  function steuerkreuz(zustand) {
    if (zustand.schacht) return;              // im Schacht bewegt man sich nicht
    const mx = KREUZ_R + 22;
    const my = ui.hoehe - KREUZ_R - 22;
    const feld = { x: mx - KREUZ_R - 16, y: my - KREUZ_R - 16, b: (KREUZ_R + 16) * 2, h: (KREUZ_R + 16) * 2 };
    const c = ui.ctx;

    const finger = ui.beanspruche(feld, "steuerkreuz");
    let dx = 0, dy = 0;
    if (finger) {
      const vx = finger.x - mx, vy = finger.y - my;
      const laenge = Math.hypot(vx, vy);
      const begrenzt = laenge > KREUZ_R ? KREUZ_R / laenge : 1;
      dx = (vx * begrenzt) / KREUZ_R;
      dy = (vy * begrenzt) / KREUZ_R;
    }
    joystick.dx = dx;
    joystick.dy = dy;
    joystick.aktiv = !!finger;

    c.beginPath();
    c.arc(mx, my, KREUZ_R, 0, Math.PI * 2);
    c.fillStyle = "rgba(20,30,48,0.38)";
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "rgba(255,255,255,0.28)";
    c.stroke();

    c.beginPath();
    c.arc(mx + dx * KREUZ_R * 0.62, my + dy * KREUZ_R * 0.62, 26, 0, Math.PI * 2);
    c.fillStyle = finger ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.4)";
    c.fill();
  }

  /* ==================================================================== */
  /*  Aktionsleiste                                                       */
  /* ==================================================================== */

  function aktionsleiste(zustand) {
    const rechts = ui.breite - HAUPT_R - 22;
    const unten = ui.hoehe - HAUPT_R - 22;

    /* Hauptknopf unten rechts, die übrigen im Viertelkreis darüber/daneben. */
    const aktion = ermittleAktion(zustand);
    if (ui.rundKnopf("btn-interaktion", aktion ? aktion.zeichen : "✋", rechts, unten, HAUPT_R, {
      aus: !aktion, farbe: aktion ? F.erfolg : null, groesse: 30
    })) fuehreAktionAus();

    const plaetze = [];
    const abstand = KNOPF_R * 2 + 14;
    /* senkrecht über dem Hauptknopf, dann nach links */
    plaetze.push({ x: rechts, y: unten - HAUPT_R - KNOPF_R - 14 });
    plaetze.push({ x: rechts - HAUPT_R - KNOPF_R - 14, y: unten });
    plaetze.push({ x: rechts - abstand * 0.75, y: unten - abstand * 0.75 });
    plaetze.push({ x: rechts, y: unten - HAUPT_R - KNOPF_R - 14 - abstand });
    let n = 0;
    function naechster() { return plaetze[Math.min(n++, plaetze.length - 1)]; }

    /* Aufgabenliste — fällt mit dem Funk aus. Der eigene Fortschritt bleibt
       sichtbar (die Marker auf der Karte), nur der gemeinsame Überblick ist
       weg: man weiß nicht mehr, wie weit das Team wirklich ist. */
    const p1 = naechster();
    if (ui.rundKnopf("btn-aufgabenliste", "📋", p1.x, p1.y, KNOPF_R, { aus: !!zustand.funkGestoert })) {
      offenerDialog = "liste";
    }

    /* Melden erscheint nur, wenn wirklich etwas zu melden ist. */
    const leicheUid = findeMeldbareLeiche(zustand);
    if (leicheUid) {
      const p = naechster();
      if (ui.rundKnopf("btn-melden", "📣", p.x, p.y, KNOPF_R, { farbe: F.warnung })) {
        gameService.meldeLeiche(leicheUid);
      }
    }

    /* Sonderrolle: der Ingenieur hat keinen Knopf — seine Fähigkeit liegt auf
       der normalen Aktionstaste, sobald er auf einer Abkürzung steht. */
    const mitKnopf = ["wissenschaftler", "schutzengel", "gestaltwandler"].indexOf(zustand.meineSonderrolle) !== -1;
    if (mitKnopf) {
      const sonder = rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
      /* Der Schutzengel wirkt erst als Geist, alle anderen nur zu Lebzeiten. */
      const aus = zustand.meineSonderrolle === "schutzengel" ? !zustand.binGeist : zustand.binGeist;
      const p = naechster();
      if (ui.rundKnopf("btn-rollenfaehigkeit", sonder.icon, p.x, p.y, KNOPF_R, { aus: aus })) {
        rollenStatus = "";
        offenerDialog = "rolle";
      }
    }

    if (zustand.meineRolle === "maulwurf" && !zustand.binGeist) {
      /* Ausschalten: aus dem Schacht heraus geht nichts — erst aussteigen. Der
         Server lehnt es ohnehin ab; ein Knopf, der sich drücken lässt und dann
         nichts tut, wäre nur verwirrend. */
      const gesperrt = zustand.versteckModus && zustand.vorsprungBis > zustand.jetzt;
      const rest = Math.max(Math.ceil((zustand.killCooldownBis - zustand.jetzt) / 1000), 0);
      const ziel = findeKillZiel(zustand);
      const killAus = !!zustand.schacht || gesperrt || !ziel || rest > 0;
      const p = naechster();
      if (ui.rundKnopf("btn-ausschalten", gesperrt ? "⏳" : rest > 0 ? String(rest) : "🥾",
                       p.x, p.y, KNOPF_R, { aus: killAus, farbe: F.gefahr })) {
        schalteAus(ziel);
      }

      /* Im Verstecken-Modus gibt es keine Sabotage — der Knopf verschwindet
         ganz, statt dauerhaft ausgegraut zu bleiben. */
      if (!zustand.versteckModus) {
        const sabAus = !!zustand.schacht || (zustand.sabotageCooldownBis || 0) > zustand.jetzt;
        const p2 = naechster();
        if (ui.rundKnopf("btn-sabotage", "💥", p2.x, p2.y, KNOPF_R, { aus: sabAus, farbe: "#c084fc" })) {
          sabotageHinweis = "";
          offenerDialog = "sabotage";
        }
      }
    }
  }

  async function schalteAus(ziel) {
    if (!ziel) return;
    const ergebnis = await gameService.schalteAus(ziel.id);
    if (!ergebnis.erfolg && ergebnis.fehler) melde(ergebnis.fehler);
  }

  function melde(text) {
    hudFehler = text;
    hudFehlerBis = gameService.serverJetzt() + 2500;
    ui.anfordern();
  }

  /* ==================================================================== */
  /*  Schachtpanel                                                        */
  /* ==================================================================== */

  /* Kein Dialog, sondern die Anzeige eines Aufenthalts: es verdunkelt nichts
     und lässt die Karte frei, weil genau das der Sinn ist — am aktuellen Ende
     erst schauen, dann aussteigen. */
  function schachtpanel(zustand) {
    const schacht = zustand.schacht;
    if (!schacht) return;

    const b = Math.min(300, ui.breite - 32);
    const x = (ui.breite - b) / 2;
    const zeilen = schacht.ziele.length;
    const h = 62 + zeilen * 42 + 52;
    const y = Math.max(70, ui.hoehe - h - 20);

    ui.fuelleRund(x, y, b, h, ui.RADIUS, "rgba(12,18,32,0.93)");
    ui.rahmeRund(x, y, b, h, ui.RADIUS, schacht.tunnel.farbe, 2);

    ui.schreibe("↧ im Schacht", x + 14, y + 20, { groesse: 12, fett: "halb", farbe: "#94a3b8" });
    ui.schreibe(schacht.tunnel.name, x + b - 14, y + 20, {
      groesse: 12, fett: "halb", farbe: schacht.tunnel.farbe, ausrichtung: "right"
    });
    ui.schreibe(ui.kuerze(schacht.hier.ort, b - 28, 18, true), x + 14, y + 44, {
      groesse: 18, fett: true, farbe: "#fff"
    });

    ui.beginneKasten({ x: x + 14, y: y + 62, b: b - 28, h: h - 62 }, 8);
      schacht.ziele.forEach(ziel => {
        if (ui.knopf("schacht-ziel-" + ziel.index, "↝ " + ziel.ort, { art: "zweit", hoehe: 38 })) {
          gameService.wechsleSchachtEnde(ziel.index);
        }
      });
      ui.luecke(4);
      if (ui.knopf("btn-schacht-raus", "↥ Hier aussteigen", { hoehe: 42 })) {
        gameService.verlasseSchacht();
      }
    ui.beendeKasten();
  }

  /* ==================================================================== */
  /*  Dialoge                                                             */
  /* ==================================================================== */

  function dialoge(zustand) {
    if (!offenerDialog) return;
    if (offenerDialog === "aufgabe")  aufgabenDialog(zustand);
    if (offenerDialog === "liste")    listenDialog(zustand);
    if (offenerDialog === "rolle")    rollenDialog(zustand);
    if (offenerDialog === "sabotage") sabotageDialog(zustand);
    if (offenerDialog === "kameras")  kameraDialog(zustand);
  }

  function schliesse() {
    if (aktivesMinispiel && aktivesMinispiel.aufraeumen) aktivesMinispiel.aufraeumen();
    aktivesMinispiel = null;
    /* Wer die Kameras verlässt, meldet sich sofort ab, statt den Eintrag
       auslaufen zu lassen — sonst blinkt die Warnung noch acht Sekunden
       weiter, obwohl niemand mehr hinsieht. */
    if (offenerDialog === "kameras") gameService.kameraWegsehen();
    offenerDialog = null;
    aktiveStation = null;
    ui.anfordern();
  }

  /* ---------------------------------------------------------- Aufgabe */

  function oeffneAufgabe(station) {
    const typ = aufgabenModul.AUFGABEN_TYPEN[station.typ];
    if (!typ) return;
    const zustand = gameService.getZustand();
    const eintrag = zustand.meineAufgaben.find(a => a.id === station.id);

    schliesse();
    offenerDialog = "aufgabe";
    aktiveStation = station;
    aufgabeTitel = stationName(station);

    /* Ein gesperrter Kettenteil wird gar nicht erst geöffnet: das Minispiel
       ließe sich sonst durchspielen und `erledigeAufgabe` würde es hinterher
       stillschweigend ablehnen — der Eindruck wäre „die Aufgabe hakt", nicht
       „ich war in der falschen Reihenfolge dran". */
    aufgabeGesperrt = !!(eintrag && eintrag.gesperrt);
    if (aufgabeGesperrt) { aktivesMinispiel = null; return; }

    /* Die Optionen tragen alles, was das Minispiel über seinen Platz in einer
       mehrteiligen Aufgabe wissen muss. `jetzt` kommt bewusst aus dem Spiel
       (Serverzeit), damit eine Wartezeit auf allen Geräten gleich läuft. */
    aktivesMinispiel = typ.start({
      teil: eintrag ? eintrag.teil : 1,
      teile: eintrag ? eintrag.teile : 1,
      zielRaum: eintrag ? eintrag.zielRaum : null,
      wartenSeit: eintrag ? eintrag.wartenSeit : 0,
      jetzt: gameService.serverJetzt,
      starteWarten: () => gameService.starteWartezeit(station.id)
    }, async function () {
      await gameService.erledigeAufgabe(station.id);
      setTimeout(schliesse, 700);
    });
  }

  function oeffneReparaturLicht() {
    schliesse();
    offenerDialog = "aufgabe";
    aufgabeTitel = "Sicherungskasten";
    aufgabeGesperrt = false;
    aktivesMinispiel = aufgabenModul.reparaturLicht({}, async function () {
      await gameService.repariereLicht();
      setTimeout(schliesse, 600);
    });
  }

  function oeffneReparaturKuehlung(seite) {
    schliesse();
    offenerDialog = "aufgabe";
    aufgabeTitel = seite === "a" ? "Kühlventil Reaktor" : "Kühlventil O2";
    aufgabeGesperrt = false;
    aktivesMinispiel = aufgabenModul.reparaturKuehlung({
      beiHalten: () => gameService.setzeKuehlventil(seite, true),
      beiLoslassen: () => gameService.setzeKuehlventil(seite, false)
    });
  }

  function aufgabenDialog(zustand) {
    const d = ui.beginneDialog("aufgabe", { breite: 460 });
      const kopf = ui.titel(aufgabeTitel, { groesse: 19 });
      if (aufgabeGesperrt) {
        ui.absatz("Diese Aufgabe hat mehrere Schritte.", { groesse: 14, farbe: F.text });
        ui.absatz("Erst der vorherige Schritt – dann geht es hier weiter.", { groesse: 14 });
      } else if (aktivesMinispiel) {
        /* Das Minispiel bekommt den Platz, der nach Titel und Schließen-Knopf
           übrig bleibt — NICHT seine Wunschhöhe. Die 220–260 px aus
           `aufgaben.js` sind für einen Desktop gedacht; ein iPhone im
           Querformat hat je nach Gerät und Safari-Leiste nur 320–390 px
           Bildhöhe, und dann stand der Knopf unter dem Bildrand: die Aufgabe
           ließ sich öffnen, aber nicht mehr schließen (gemeldet 2026-08-02,
           betroffen waren die drei Minispiele mit 260 px — scan, triebwerk,
           lenkung — schon bei 375 px Bildhöhe, bei 330 px dann sechzehn von
           siebzehn).
           Dass sie kleiner dürfen, ist kein Zufall: alle Minispiele zeichnen
           sich relativ zu dem Rechteck, das sie hier bekommen.
           Der Abzug ist die Summe der festen Anteile — 16+16 Bildrand,
           2×`polster`, der Abstand unter dem Titel, der Abstand über dem
           Knopf, der Knopf selbst und der Abstand darunter. Die Titelhöhe
           kommt gemessen dazu, weil ein langer Stationsname im Hochformat
           umbricht. */
        const abzug = 32 + d.polster * 2 + kopf.h + 12 + 10 + 40 + 12;
        const platz = ui.hoehe - abzug;
        const hoehe = Math.max(MINISPIEL_MIN_HOEHE,
                               Math.min(aktivesMinispiel.hoehe || 260, platz));
        const r = ui.reserviere(hoehe, { abstand: 10 });
        aktivesMinispiel.zeichne(r);
      }
      if (ui.knopf("btn-aufgabe-schliessen", "Schließen", { art: "link" })) schliesse();
    ui.beendeDialog(d);
  }

  /* --------------------------------------------------- Aufgabenliste */

  function listenDialog(zustand) {
    const d = ui.beginneDialog("liste", { breite: 440 });
      ui.titel("📋 Deine Aufgaben", { groesse: 19 });

      const hoehe = Math.min(320, Math.max(120, ui.hoehe - 260));
      ui.scroll("liste-roll", hoehe, function (b) {
        zustand.meineAufgaben.forEach(a => {
          if (!a.station) return;
          const typ = aufgabenModul.AUFGABEN_TYPEN[a.station.typ];
          const wartetNoch = a.wartenSeit && gameService.serverJetzt() < a.wartenSeit + a.wartenSek * 1000;
          const zeichen = a.erledigt ? "✅" : (a.gesperrt ? "🔒" : "⬜");
          /* Mehrteilige Aufgaben stehen mit ihrer Schrittnummer da, sonst läse
             sich dieselbe Aufgabe dreimal identisch und man wüsste nicht,
             welcher Ort noch offen ist. */
          const schritt = a.teile > 1 ? "  " + a.teil + "/" + a.teile : "";
          const hinweis = wartetNoch ? "  läuft …"
                        : (a.wartenSeit && !a.erledigt ? "  fertig – hingehen" : "");

          const r = ui.reserviere(38, { abstand: 4 });
          if (a.erledigt) { ui.ctx.save(); ui.ctx.globalAlpha = 0.55; }
          ui.schreibe(zeichen, r.x + 10, r.y + 19, { groesse: 15 });
          const name = stationName(a.station) + schritt + hinweis + (typ && typ.sichtbar ? "  👁" : "");
          ui.schreibe(ui.kuerze(name, r.b - 130, 14, "halb"), r.x + 34, r.y + 19, {
            groesse: 14, fett: "halb", farbe: a.gesperrt ? F.gedaempft : F.text
          });
          ui.schreibe(ui.kuerze(raumNameZu(a.station.raum), 96, 12), r.x + r.b - 8, r.y + 19, {
            groesse: 12, farbe: F.gedaempft, ausrichtung: "right"
          });
          if (a.erledigt) ui.ctx.restore();
        });
      });

      const hatSichtbare = zustand.meineAufgaben.some(a => {
        const typ = a.station && aufgabenModul.AUFGABEN_TYPEN[a.station.typ];
        return typ && typ.sichtbar;
      });
      ui.absatz(zustand.meineRolle === "maulwurf"
        ? "Du bist Maulwurf – diese Aufgaben zählen nicht, sehen aber echt aus." +
          (hatSichtbare ? " Vorsicht bei 👁: dort bleibt sichtbar, dass jemand gearbeitet hat – bei dir passiert nichts." : "")
        : "Gemeinsamer Fortschritt: " + zustand.aufgaben.erledigt + " von " + zustand.aufgaben.gesamt +
          (hatSichtbare ? " · 👁 sehen alle in der Nähe – dein Alibi." : ""),
        { groesse: 12 });

      if (ui.knopf("btn-liste-schliessen", "Schließen", { art: "link" })) schliesse();
    ui.beendeDialog(d);
  }

  /* ------------------------------------------------------ Sonderrolle */

  /* Ein Dialog für drei Rollen: der Wissenschaftler liest hier nur ab,
     Schutzengel und Gestaltwandler wählen ein Ziel. */
  function rollenDialog(zustand) {
    const sonder = zustand.meineSonderrolle && rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
    if (!sonder) { schliesse(); return; }

    const d = ui.beginneDialog("rolle", { breite: 440 });
      ui.titel(sonder.icon + " " + sonder.name, { groesse: 19 });
      ui.absatz(sonder.beschreibung, { groesse: 13 });

      const andere = zustand.spieler.filter(s => s.id !== zustand.eigenerSpielerId);

      if (zustand.meineSonderrolle === "wissenschaftler") {
        andere.forEach(s => {
          bildschirme.spielerZeile("wiss-" + s.id, s, {
            notiz: s.lebt === false ? "💀 ausgeschaltet" : "❤️ lebt",
            notizFarbe: s.lebt === false ? F.gefahr : F.erfolg,
            blass: s.lebt === false, rechtsBreite: 110, abstand: 5
          });
        });
        const tot = andere.filter(s => s.lebt === false).length;
        rollenStatus = tot ? tot + " von " + andere.length + " sind ausgeschaltet." : "Noch sind alle im Spiel.";

      } else if (zustand.meineSonderrolle === "schutzengel") {
        if (!zustand.binGeist) {
          rollenStatus = "Das geht erst, wenn du selbst ausgeschaltet bist.";
        } else {
          const rest = Math.max(Math.ceil(((zustand.schutzCooldownBis || 0) - zustand.jetzt) / 1000), 0);
          const lebende = andere.filter(s => s.lebt !== false);
          lebende.forEach(s => {
            const geschuetzt = (zustand.schutz[s.id] || 0) > zustand.jetzt;
            const r = bildschirme.spielerZeile("schutz-" + s.id, s, { rechtsBreite: 108, abstand: 5 });
            const text = geschuetzt ? "geschützt" : rest > 0 ? "noch " + rest + " s" : "schützen";
            if (bildschirme.zeilenKnopf("sk-" + s.id, r, text, { aus: geschuetzt || rest > 0, breite: 98 })) {
              schuetze(s);
            }
          });
          if (!lebende.length) rollenStatus = "Niemand mehr da, den du schützen könntest.";
        }

      } else if (zustand.meineSonderrolle === "gestaltwandler") {
        const meine = zustand.verkleidungen[zustand.eigenerSpielerId];
        const verkleidet = meine && meine.bis > zustand.jetzt;
        const rest = Math.max(Math.ceil(((zustand.verkleidungCooldownBis || 0) - zustand.jetzt) / 1000), 0);
        if (verkleidet) {
          const ziel = zustand.spieler.find(s => s.id === meine.alsUid);
          rollenStatus = "Du siehst gerade aus wie " + (ziel ? ziel.name : "jemand anderes") + ".";
          if (ui.knopf("btn-verkleidung-ab", "Verkleidung ablegen", { art: "zweit" })) {
            legeVerkleidungAb();
          }
        } else {
          andere.filter(s => s.lebt !== false).forEach(s => {
            const r = bildschirme.spielerZeile("wandel-" + s.id, s, { rechtsBreite: 118, abstand: 5 });
            const text = rest > 0 ? "noch " + rest + " s" : "aussehen wie";
            if (bildschirme.zeilenKnopf("wk-" + s.id, r, text, { aus: rest > 0, breite: 108 })) {
              verkleide(s);
            }
          });
          if (rest > 0) rollenStatus = "Noch " + rest + " s, bis du dich wieder verwandeln kannst.";
        }
      }

      if (rollenStatus) ui.absatz(rollenStatus, { groesse: 13 });
      if (ui.knopf("btn-rolle-schliessen", "Schließen", { art: "link" })) schliesse();
    ui.beendeDialog(d);
  }

  async function schuetze(s) {
    const e = await gameService.schuetze(s.id);
    rollenStatus = e.erfolg ? s.name + " ist jetzt eine Weile sicher." : (e.fehler || "Geht gerade nicht.");
    ui.anfordern();
  }

  async function verkleide(s) {
    const e = await gameService.verkleideDich(s.id);
    rollenStatus = e.erfolg ? "Du siehst jetzt aus wie " + s.name + "." : (e.fehler || "Geht gerade nicht.");
    ui.anfordern();
  }

  // Auch das Ablegen wertet seinen Rückgabewert aus — sonst wäre es der einzige Knopf des
  // Rollendialogs, der bei einem "geht gerade nicht" wortlos nichts täte.
  async function legeVerkleidungAb() {
    const e = await gameService.verkleideDich(null);
    rollenStatus = e.erfolg ? "Du siehst wieder aus wie du selbst." : (e.fehler || "Geht gerade nicht.");
    ui.anfordern();
  }

  /* --------------------------------------------------------- Sabotage */

  function sabotageDialog(zustand) {
    const laeuft = !!zustand.sabotage;
    const d = ui.beginneDialog("sabotage", { breite: 440 });
      ui.titel("💥 Sabotieren", { groesse: 19 });

      if (ui.knopf("btn-sab-licht", "💡 Licht ausschalten", { art: "zweit", aus: laeuft })) sabotiere("licht", null, "Licht ist aus.");
      if (ui.knopf("btn-sab-reaktor", "☢️ Reaktor überhitzen", { art: "zweit", aus: laeuft })) sabotiere("reaktor", null, "Reaktor überhitzt.");
      if (ui.knopf("btn-sab-funk", "📻 Funk stören", { art: "zweit", aus: laeuft })) sabotiere("funk", null, "Funk ist gestört.");

      ui.luecke(4);
      ui.absatz("🚪 Raum verriegeln:", { groesse: 13, fett: "halb", farbe: F.text });

      /* Raumknöpfe in einem Raster, so viele je Zeile wie passen. */
      const k = ui.oben();
      const proZeile = Math.max(2, Math.floor(k.b / 118));
      const kb = (k.b - (proZeile - 1) * 6) / proZeile;
      let zeile = -1;
      karte.RAEUME.forEach((raum, i) => {
        const spalte = i % proZeile;
        if (spalte === 0) zeile++;
        const r = { x: k.x + spalte * (kb + 6), y: k.y + k.cursor + zeile * 40, b: kb, h: 34 };
        ui.fuelleRund(r.x, r.y, r.b, r.h, 6, ui.gedruecktAuf(r) ? "rgba(34,211,238,0.28)" : "rgba(34,211,238,0.1)");
        ui.rahmeRund(r.x, r.y, r.b, r.h, 6, F.rand, 1);
        ui.schreibe(ui.kuerze(raum.name, kb - 8, 11, "halb"), r.x + kb / 2, r.y + 17, {
          groesse: 11, fett: "halb", farbe: F.primaer, ausrichtung: "center"
        });
        if (ui.geklickt(r)) sabotiere("tueren", raum.id, "Verriegelt.");
      });
      ui.luecke((zeile + 1) * 40 + 6);

      if (sabotageHinweis || laeuft) {
        ui.absatz(sabotageHinweis || "Es läuft schon eine Sabotage.", { groesse: 13, zentriert: true });
      }
      if (ui.knopf("btn-sabotage-schliessen", "Schließen", { art: "link" })) schliesse();
    ui.beendeDialog(d);
  }

  async function sabotiere(typ, raumId, erfolgText) {
    const ergebnis = await gameService.sabotiere(typ, raumId);
    sabotageHinweis = ergebnis.erfolg ? erfolgText : (ergebnis.fehler || "Geht gerade nicht.");
    if (ergebnis.erfolg) setTimeout(schliesse, 500);
    ui.anfordern();
  }

  /* ---------------------------------------------------------- Kameras */

  const KAMERA_HINWEIS = "Solange du zusiehst, blinken die Kameras auf der Karte – für alle, die davorstehen.";
  const STOERUNGSTEXT = "📻 Kein Signal – der Funk ist gestört.";
  const SPALTEN_LUECKE = 8;
  const BESCHRIFTUNG_H = 26;   // Zeile mit dem Kameranamen unter jedem Bild

  /* Sucht die Aufteilung, die die größten Bilder ergibt und dabei im
     Höhenbudget bleibt. Vorher standen zwei Spalten fest im Code — bei vier
     Kameras also immer zwei Zeilen, unabhängig davon, ob dafür Platz war.
     Auf einem iPhone im Querformat ist das Bild flacher als hoch: dort sind
     vier Bilder nebeneinander nicht nur die einzige Aufteilung, die passt,
     sondern auch die mit der größeren Bildfläche.
     Nur Teiler der Kameraanzahl werden probiert, sonst bliebe in der letzten
     Zeile eine Lücke. */
  function waehleKameraAnordnung(innenB, budget) {
    const anzahl = karte.KAMERAS.length;
    const verh = karte.KAMERAS[0].hoehe / karte.KAMERAS[0].breite;
    let beste = null;
    for (let spalten = 1; spalten <= anzahl; spalten++) {
      if (anzahl % spalten !== 0) continue;
      const zeilen = anzahl / spalten;
      const spaltenB = (innenB - (spalten - 1) * SPALTEN_LUECKE) / spalten;
      if (spaltenB <= 0) continue;
      /* Begrenzend ist entweder die Spaltenbreite oder das Höhenbudget. */
      const bildH = Math.min(spaltenB * verh, budget / zeilen - BESCHRIFTUNG_H);
      if (bildH <= 0) continue;
      const flaeche = bildH * (bildH / verh);
      if (!beste || flaeche > beste.flaeche) {
        beste = { spalten, zeilen, bildH, bildB: bildH / verh, flaeche };
      }
    }
    /* Passt nichts (extrem flaches Fenster), lieber winzige Bilder in einer
       Zeile als gar kein Bild — der Schließen-Knopf bleibt so erreichbar. */
    if (!beste) {
      const bildH = 30;
      beste = { spalten: anzahl, zeilen: 1, bildH, bildB: bildH / verh, flaeche: 0 };
    }
    return beste;
  }

  function oeffneKameras() {
    schliesse();
    offenerDialog = "kameras";
    gameService.kameraZusehen();
    kameraLetzterWrite = gameService.serverJetzt();
  }

  function kameraDialog(zustand) {
    const gestoert = zustand.funkGestoert;

    /* Der Eintrag „ich sehe zu" muss nachgeschrieben werden, solange der
       Dialog offen ist — aber nur im Takt des Dienstes, nicht bei jedem Bild:
       sonst schriebe jedes zusehende Gerät sechzigmal je Sekunde in den Raum,
       den alle anderen mithören. */
    const jetzt = gameService.serverJetzt();
    if (jetzt - kameraLetzterWrite >= gameService.KAMERA_TAKT_MS) {
      kameraLetzterWrite = jetzt;
      gameService.kameraZusehen();
    }

    /* Auf einem flachen Bild darf das Pult breiter werden: vier Bilder
       nebeneinander brauchen eine Zeile statt zwei und passen dadurch
       überhaupt erst aufs Bild. Am Schreibtisch bleibt es bei 560. */
    const dialogB = Math.min(ui.hoehe < 460 ? 800 : 560, ui.breite - 24);
    const d = ui.beginneDialog("kameras", { breite: dialogB, polster: 14 });
      const kopf = ui.titel("📹 Kameras", { groesse: 19 });
      if (gestoert) {
        ui.absatz(STOERUNGSTEXT, { groesse: 13, farbe: F.gefahr, fett: "halb" });
      }

      const k = ui.oben();

      /* Höhenbudget für die Bilder: vom Bild abziehen, was fest darum
         herum steht. Ohne diese Rechnung bekamen die vier Bilder ihre
         Breite unabhängig von der Bildhöhe und der Dialog wurde 462 px
         hoch — auf einem 390 px hohen iPhone-Querbild lag der
         Schließen-Knopf 62 px unterhalb des Rands und war auf keinem Weg
         zu erreichen (gemeldet 2026-08-02: „bei der CCTV kommt man egal
         wie nicht an den Beenden-Button"). Im Hochformat war es noch
         mehr. */
      const hinweisH = ui.umbrich(KAMERA_HINWEIS, k.b, 12).length * 12 * 1.45;
      const stoerH = gestoert
        ? ui.umbrich(STOERUNGSTEXT, k.b, 13, "halb").length * 13 * 1.45 + 12
        : 0;
      const abzug = 32 + d.polster * 2 + kopf.h + 12 + stoerH + 6 + hinweisH + 12 + 40 + 12;
      const budget = ui.hoehe - abzug;

      const anordnung = waehleKameraAnordnung(k.b, budget);
      const bildB = anordnung.bildB, bildH = anordnung.bildH;
      /* Wird die Höhe vom Budget begrenzt, sind die Bilder schmaler als die
         Spalte — dann sitzt der Block mittig statt links zu kleben. */
      const blockB = anordnung.spalten * bildB + (anordnung.spalten - 1) * SPALTEN_LUECKE;
      const startX = k.x + Math.max(0, (k.b - blockB) / 2);

      karte.KAMERAS.forEach((kamera, i) => {
        const spalte = i % anordnung.spalten;
        const zeile = Math.floor(i / anordnung.spalten);
        const x = startX + spalte * (bildB + SPALTEN_LUECKE);
        const y = k.y + k.cursor + zeile * (bildH + BESCHRIFTUNG_H);

        if (gestoert) rauschen(x, y, bildB, bildH);
        else zeichneKamerabild(x, y, bildB, bildH, kamera, zustand);

        ui.schreibe(ui.kuerze(kamera.name, bildB, 12, "halb"), x + bildB / 2, y + bildH + 12, {
          groesse: 12, fett: "halb", farbe: F.gedaempft, ausrichtung: "center"
        });
      });
      ui.luecke(anordnung.zeilen * (bildH + BESCHRIFTUNG_H) + 6);

      ui.absatz(KAMERA_HINWEIS, { groesse: 12 });
      if (ui.knopf("btn-kameras-schliessen", "Schließen", { art: "link" })) schliesse();
    ui.beendeDialog(d);

    ui.anfordern();   // Kamerabilder laufen weiter
  }

  /* Rauschen statt Bild: man sieht sofort, dass hier etwas kaputt ist, statt
     zu glauben, der Gang sei einfach leer. */
  function rauschen(x, y, b, h) {
    const c = ui.ctx;
    c.save();
    c.beginPath(); c.rect(x, y, b, h); c.clip();
    c.fillStyle = "#04120a";
    c.fillRect(x, y, b, h);
    c.fillStyle = "rgba(125,252,174,0.20)";
    for (let n = 0; n < 260; n++) {
      c.fillRect(x + Math.random() * b, y + Math.random() * h, 2, 2);
    }
    c.restore();
  }

  /* ==================================================================== */
  /*  Einstieg                                                            */
  /* ==================================================================== */

  function zeichneSpielfeld(zustand) {
    zeichne(zustand);              // die Karte selbst, aus app.js

    hud(zustand);
    /* Während ein Dialog offen ist, wird nicht gelaufen — das Steuerkreuz
       verschwindet, damit kein Finger daran hängen bleibt. */
    if (!offenerDialog) {
      steuerkreuz(zustand);
      aktionsleiste(zustand);
      schachtpanel(zustand);
    }
    dialoge(zustand);
    querformatHinweis();
  }

  function querformatHinweis() {
    if (!brauchtQuerformatHinweis()) return;
    const d = ui.beginneDialog("querformat", { breite: 340 });
      ui.absatz("📱", { groesse: 40, zentriert: true, abstand: 4 });
      ui.absatz("Bitte quer halten.", { groesse: 17, fett: true, farbe: F.text, zentriert: true });
      ui.absatz("Das Gelände ist breiter als hoch – im Querformat siehst du deutlich mehr.",
                { groesse: 14, zentriert: true });
      if (ui.knopf("btn-querformat-egal", "Trotzdem hochkant spielen", { art: "zweit" })) {
        querformatHinweisWeggetippt = true;
      }
    ui.beendeDialog(d);
  }

  return {
    zeichneSpielfeld: zeichneSpielfeld,
    oeffneAufgabe: oeffneAufgabe,
    oeffneReparaturLicht: oeffneReparaturLicht,
    oeffneReparaturKuehlung: oeffneReparaturKuehlung,
    oeffneKameras: oeffneKameras,
    schliesse: schliesse,
    melde: melde,
    get offenerDialog() { return offenerDialog; },
    /* Beim Verlassen der Partie muss alles zu sein — sonst hinge ein
       Minispiel-Aufräumer in der Luft und der Kameraeintrag bliebe stehen. */
    zuruecksetzen: function () {
      if (offenerDialog) schliesse();
      sabotageHinweis = "";
      rollenStatus = "";
      hudFehler = "";
      /* Sonst kröche der Balken der nächsten Partie vom Stand der letzten
         herunter — bei 8/8 auf 0/6 sichtbar über eine halbe Sekunde. */
      gezeigterAnteil = 0;
      aufleuchtenBis = 0;
    }
  };
})();
