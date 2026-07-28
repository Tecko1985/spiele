// Die Aufgaben-Minispiele. Reines Zeichen-Modul ohne Firebase-Bezug: jede Aufgabe bekommt ein
// Optionen-Objekt und eine onFertig-Funktion und gibt ein Objekt zurück:
//
//   { zeichne(rechteck), hoehe?, aufraeumen? }
//     zeichne(r)  — malt sich in {x, y, b, h} und wertet dabei die Eingaben aus
//     hoehe       — gewünschte Höhe im Dialog (Vorgabe 260)
//     aufraeumen  — optional, falls etwas zurückzusetzen ist
//
// Gezeichnet wird auf die gemeinsame Fläche aus ui.js; Eingaben laufen über dieselben
// Treffer-Prüfungen wie jedes andere Bedienelement (`ui.geklickt`, `ui.beanspruche`). Es gibt
// keine DOM-Elemente und keine eigenen Timer mehr — beides hat der Umbau auf die
// Zeichenfläche ersetzt.
//
// Maulwürfe sehen exakt dieselben Aufgaben und können sie auch "erledigen" — nur gezählt
// wird ihr Ergebnis nicht (siehe erledigeAufgabe in game-service.js). Genau das ist der
// Bluff: wer neben einer Station steht, sieht nicht, ob dort echt gearbeitet wird.
//
// Zuschnitt: jede Aufgabe soll in 5–15 Sekunden zu schaffen sein und im Querformat auf ein
// Handydisplay passen. Deshalb sind die Spielfelder flach gehalten und alle Bedienelemente
// mindestens fingergroß. Ausnahmen sind die beiden Warteaufgaben, deren ganzer Sinn die
// lange Pause ist.
//
// **Bewegung läuft über verstrichene Zeit (`ui.delta`), nicht über Bildzählung.** In einem
// versteckten Tab drosselt der Browser um Faktor 8 bis 35; würde je Bild ein fester Betrag
// addiert, liefen Asteroiden und Zeiger dort in Zeitlupe und jeder Test wäre wertlos.
//
// **Animierte Aufgaben rufen `ui.anfordern()`**, sonst schläft die Zeichenschleife ein —
// gerendert wird nur auf Anforderung.
//
// Das Optionen-Objekt trägt alles, was die Aufgabe über ihren Platz in einer mehrteiligen
// Kette wissen muss:
//   teil / teile   — 1-basierte Nummer und Gesamtzahl der Teile (z.B. Kabel 2 von 3)
//   zielRaum       — Name des Raums, in dem der nächste Teil liegt (für Strom/Daten)
//   wartenSeit     — Zeitstempel, wann die Wartezeit gestartet wurde (0 = noch nicht)
//   starteWarten() — meldet dem Spiel, dass die Wartezeit jetzt losläuft
//   jetzt()        — Serverzeit, damit die Wartezeit auf allen Geräten gleich läuft

const WARTEZEIT_SEK = 60;   // Proben analysieren und WLAN-Neustart, wie in der Vorlage

const aufgabenModul = (function () {
  "use strict";

  const F = ui.F;

  /* Farben der Minispiele — dunkles Gerätepult, damit sich die Aufgabe vom hellen
     Dialog absetzt und wie ein Bedienfeld wirkt. */
  const PULT = "#1b2536";
  const PULT_HELL = "#26334a";
  const LINIE = "#3d4f6d";
  const GUT = "#22c55e";
  const SCHLECHT = "#ef4444";
  const GELB = "#facc15";

  /* ==================================================================== */
  /*  Helfer                                                              */
  /* ==================================================================== */

  function mischen(liste) {
    const kopie = liste.slice();
    for (let i = kopie.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const merk = kopie[i];
      kopie[i] = kopie[j];
      kopie[j] = merk;
    }
    return kopie;
  }

  function zufallAus(liste) { return liste[Math.floor(Math.random() * liste.length)]; }
  function zufallZahl(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function begrenze(w, min, max) { return Math.max(min, Math.min(max, w)); }

  /* Einheitlicher Aufbau: Anleitung oben, Spielfeld in der Mitte, Statuszeile unten.
     Gibt den Innenbereich für das Spielfeld zurück. */
  function rahmen(r, anleitung, status) {
    const zeilen = ui.umbrich(anleitung, r.b, 13);
    const kopfH = zeilen.length * 17 + 4;
    zeilen.forEach((z, i) => {
      ui.schreibe(z, r.x + r.b / 2, r.y + i * 17 + 9, {
        groesse: 13, farbe: F.gedaempft, ausrichtung: "center"
      });
    });
    const fussH = status ? 22 : 0;
    if (status) {
      ui.schreibe(status, r.x + r.b / 2, r.y + r.h - 9, {
        groesse: 13, fett: "halb", farbe: F.text, ausrichtung: "center"
      });
    }
    return { x: r.x, y: r.y + kopfH, b: r.b, h: r.h - kopfH - fussH };
  }

  /* Dunkles Pult als Grund eines Spielfelds. */
  function pult(r, farbe) {
    ui.fuelleRund(r.x, r.y, r.b, r.h, 10, farbe || PULT);
  }

  /* Rechteckige Taste. Gibt true bei Treffer. */
  function taste(id, r, beschriftung, opt) {
    const o = opt || {};
    const aus = !!o.aus;
    const gedrueckt = !aus && ui.gedruecktAuf(r);
    const treffer = !aus && ui.geklickt(r);
    ui.fuelleRund(r.x, r.y, r.b, r.h, o.radius === undefined ? 8 : o.radius,
      o.farbe || (aus ? "#33405a" : gedrueckt ? "#4a5f85" : PULT_HELL));
    if (o.rand) ui.rahmeRund(r.x, r.y, r.b, r.h, o.radius === undefined ? 8 : o.radius, o.rand, 2);
    if (beschriftung) {
      ui.schreibe(beschriftung, r.x + r.b / 2, r.y + r.h / 2, {
        groesse: o.groesse || 18, fett: "halb", ausrichtung: "center",
        farbe: aus ? "#64748b" : (o.textFarbe || "#e2e8f0")
      });
    }
    ui.merke(id, r, "aufgabe-taste");
    return treffer;
  }

  /* Zieht einen Finger innerhalb des Feldes nach und liefert seine Position.
     Beansprucht ihn, damit er unterwegs keine Knöpfe auslöst. */
  function zieher(feld, kennung) {
    return ui.beanspruche(feld, kennung);
  }

  /* Fortschrittsbalken im Pult-Stil */
  function balken(x, y, b, h, anteil, farbe) {
    ui.fuelleRund(x, y, b, h, h / 2, "#0f1726");
    const a = begrenze(anteil, 0, 1);
    if (a > 0) ui.fuelleRund(x, y, Math.max(h, b * a), h, h / 2, farbe || GUT);
  }

  /* Ziffernblock 1–9 + 0 + OK, für Aufgaben mit Zahleneingabe. */
  function ziffernblock(r, wert, opt) {
    const o = opt || {};
    const spalten = 5;
    const zeilen = 2;
    const luecke = 6;
    const tb = (r.b - (spalten - 1) * luecke) / spalten;
    const th = Math.min(46, (r.h - (zeilen - 1) * luecke) / zeilen);
    const tasten = ["1","2","3","4","5","6","7","8","9","0"];
    let neu = wert;
    tasten.forEach((z, i) => {
      const sp = i % spalten, ze = Math.floor(i / spalten);
      const tr = { x: r.x + sp * (tb + luecke), y: r.y + ze * (th + luecke), b: tb, h: th };
      if (taste("ziffer-" + z, tr, z, { groesse: 17 })) {
        if (neu.length < (o.maxLaenge || 4)) neu += z;
      }
    });
    return neu;
  }

  /* ==================================================================== */
  /*  Warteaufgaben                                                       */
  /* ==================================================================== */

  /* Gemeinsamer Unterbau von „Proben analysieren" und dem WLAN-Neustart.
     Der Zeitstempel liegt im Spiel, nicht hier: wer die Aufgabe schließt und weggeht, soll
     beim Zurückkommen die abgelaufene Zeit vorfinden — genau das ist ihr Zweck als Alibi. */
  function warteAufgabe(optionen, onFertig, texte) {
    optionen = optionen || {};
    const jetzt = optionen.jetzt || (() => Date.now());
    const seit = optionen.wartenSeit || 0;
    const starteWarten = optionen.starteWarten || (() => {});
    const fertigBis = seit ? seit + WARTEZEIT_SEK * 1000 : 0;
    let gestartet = false;
    const schluss = texte.schluss ? texte.schluss(optionen, onFertig) : null;

    return {
      hoehe: 240,
      zeichne: function (r) {
        /* Phase 1: noch nicht gestartet. */
        if (!seit && !gestartet) {
          const innen = rahmen(r, texte.anleitungStart,
            "Dauert " + WARTEZEIT_SEK + " Sekunden – du kannst so lange weggehen.");
          ui.schreibe(texte.symbol, innen.x + innen.b / 2, innen.y + innen.h / 2 - 24,
                      { groesse: 46, ausrichtung: "center" });
          const kr = { x: innen.x + innen.b / 2 - 90, y: innen.y + innen.h - 52, b: 180, h: 46 };
          if (taste("warte-start", kr, texte.startKnopf, { farbe: F.primaer, groesse: 15 })) {
            starteWarten();
            gestartet = true;
          }
          return;
        }

        /* Phase 2: läuft noch. */
        if (gestartet && !seit) {
          rahmen(r, texte.anleitungWarten, "Läuft. Komm später wieder.");
          ui.schreibe(texte.symbol, r.x + r.b / 2, r.y + r.h / 2, { groesse: 46, ausrichtung: "center" });
          return;
        }
        if (jetzt() < fertigBis) {
          const uebrig = Math.max(fertigBis - jetzt(), 0);
          const anteil = 1 - uebrig / (WARTEZEIT_SEK * 1000);
          const innen = rahmen(r, texte.anleitungWarten, "Du musst nicht danebenstehen.");
          ui.schreibe(texte.symbol, innen.x + innen.b / 2, innen.y + 34, { groesse: 40, ausrichtung: "center" });
          balken(innen.x + 20, innen.y + innen.h - 54, innen.b - 40, 12, anteil, F.primaer);
          ui.schreibe("noch " + Math.ceil(uebrig / 1000) + " s",
                      innen.x + innen.b / 2, innen.y + innen.h - 24,
                      { groesse: 14, fett: "halb", ausrichtung: "center", farbe: F.text });
          ui.anfordern();
          return;
        }

        /* Phase 3: abgelaufen, Schlussschritt. */
        if (schluss) schluss.zeichne(r);
      }
    };
  }

  /* ==================================================================== */
  /*  1. Reaktor starten (Simon Says)                                     */
  /* ==================================================================== */

  /* Links leuchtet die Folge auf, rechts wird sie nachgetippt. Fünf Runden, pro Runde ein
     Feld mehr. Ein Fehler wirft auf Runde 1 zurück — das ist der Druck, der die Aufgabe
     gefährlich macht, wenn jemand im Türrahmen steht. */
  function aufgabeReaktor(optionen, onFertig) {
    const RUNDEN = 5;
    const FELDER = 4;
    let runde = 1;
    let folge = [zufallZahl(0, FELDER - 1)];
    let zeigeIndex = 0;         // welches Feld gerade aufleuchtet
    let zeigeBis = 0;           // Zeitpunkt, bis der Blitz steht
    let zeigt = true;
    let eingabe = [];
    let fehler = false;
    let fertig = false;
    let uhr = 0;

    function neueRunde() {
      folge = [];
      for (let i = 0; i < runde; i++) folge.push(zufallZahl(0, FELDER - 1));
      zeigeIndex = 0; zeigt = true; eingabe = []; zeigeBis = 0;
    }
    neueRunde();

    return {
      hoehe: 250,
      zeichne: function (r) {
        uhr += ui.delta;
        const status = fertig ? "Reaktor läuft."
                     : fehler ? "Falsch – von vorn."
                     : zeigt ? "Merken …" : "Runde " + runde + " von " + RUNDEN;
        const innen = rahmen(r, "Merk dir die Folge und tippe sie nach.", status);
        pult(innen);

        /* Ablauf des Vorzeigens über verstrichene Zeit, nicht über Bildzählung. */
        if (zeigt && !fertig) {
          if (uhr > zeigeBis) { zeigeBis = uhr + 620; zeigeIndex++; }
          if (zeigeIndex > folge.length) { zeigt = false; zeigeIndex = -1; }
          ui.anfordern();
        }

        const luecke = 10;
        const tb = (innen.b - 2 * 16 - (FELDER - 1) * luecke) / FELDER;
        const th = Math.min(78, innen.h - 32);
        const ty = innen.y + (innen.h - th) / 2;
        const leuchtend = zeigt && zeigeIndex >= 1 && (uhr < zeigeBis - 180)
                        ? folge[zeigeIndex - 1] : -1;

        for (let i = 0; i < FELDER; i++) {
          const tr = { x: innen.x + 16 + i * (tb + luecke), y: ty, b: tb, h: th };
          const an = leuchtend === i;
          const farben = ["#38bdf8", "#f472b6", "#fbbf24", "#4ade80"];
          ui.fuelleRund(tr.x, tr.y, tr.b, tr.h, 10, an ? farben[i] : "#2b3a54");
          ui.rahmeRund(tr.x, tr.y, tr.b, tr.h, 10, farben[i], an ? 3 : 1.5);
          ui.merke("reaktor-" + i, tr, "aufgabe-taste");

          if (!zeigt && !fertig && ui.geklickt(tr)) {
            eingabe.push(i);
            const pos = eingabe.length - 1;
            if (eingabe[pos] !== folge[pos]) {
              fehler = true; runde = 1; neueRunde();
            } else if (eingabe.length === folge.length) {
              fehler = false;
              if (runde >= RUNDEN) { fertig = true; onFertig(); }
              else { runde++; neueRunde(); }
            }
          }
        }

        /* Rundenpunkte unter dem Feld */
        for (let i = 0; i < RUNDEN; i++) {
          const px = innen.x + innen.b / 2 - (RUNDEN * 14) / 2 + i * 14 + 7;
          ui.ctx.beginPath();
          ui.ctx.arc(px, innen.y + innen.h - 10, 4, 0, Math.PI * 2);
          ui.ctx.fillStyle = i < runde - 1 || fertig ? GUT : "#3d4f6d";
          ui.ctx.fill();
        }
      }
    };
  }

  /* ==================================================================== */
  /*  2. Manifold entsperren: 1 bis 10 in aufsteigender Reihenfolge       */
  /* ==================================================================== */

  function aufgabeManifold(optionen, onFertig) {
    const ZAHLEN = 10;
    let plaetze = mischen([0,1,2,3,4,5,6,7,8,9]);
    let naechste = 1;
    let falsch = -1;
    let falschBis = 0;
    let uhr = 0;
    let fertig = false;

    return {
      hoehe: 250,
      zeichne: function (r) {
        uhr += ui.delta;
        const innen = rahmen(r, "Tippe 1 bis 10 der Reihe nach.",
          fertig ? "Entsperrt." : "Als Nächstes: " + naechste);
        pult(innen);

        const spalten = 5, zeilen = 2, luecke = 8;
        const tb = (innen.b - 2 * 14 - (spalten - 1) * luecke) / spalten;
        const th = Math.min(62, (innen.h - 20 - (zeilen - 1) * luecke) / zeilen);
        const oy = innen.y + (innen.h - (zeilen * th + luecke)) / 2;

        for (let i = 0; i < ZAHLEN; i++) {
          const zahl = plaetze[i] + 1;
          const sp = i % spalten, ze = Math.floor(i / spalten);
          const tr = { x: innen.x + 14 + sp * (tb + luecke), y: oy + ze * (th + luecke), b: tb, h: th };
          const erledigt = zahl < naechste;
          const istFalsch = falsch === zahl && uhr < falschBis;
          ui.fuelleRund(tr.x, tr.y, tr.b, tr.h, 8,
            erledigt ? "#14532d" : istFalsch ? "#7f1d1d" : PULT_HELL);
          ui.schreibe(String(zahl), tr.x + tr.b / 2, tr.y + tr.h / 2, {
            groesse: 20, fett: true, ausrichtung: "center",
            farbe: erledigt ? "#4ade80" : "#e2e8f0"
          });
          ui.merke("manifold-" + zahl, tr, "aufgabe-taste");

          if (!fertig && !erledigt && ui.geklickt(tr)) {
            if (zahl === naechste) {
              naechste++;
              if (naechste > ZAHLEN) { fertig = true; onFertig(); }
            } else {
              falsch = zahl; falschBis = uhr + 400;
            }
          }
        }
        if (uhr < falschBis) ui.anfordern();
      }
    };
  }

  /* ==================================================================== */
  /*  3. Proben analysieren                                               */
  /* ==================================================================== */

  function aufgabeProben(optionen, onFertig) {
    return warteAufgabe(optionen, onFertig, {
      symbol: "🧪",
      anleitungStart: "Proben in den Analysator geben und starten.",
      anleitungWarten: "Die Analyse läuft.",
      startKnopf: "Analyse starten",
      schluss: function (opt, fertig) {
        /* Fünf Proben, eine weicht ab — die muss gewählt werden. */
        const ANZAHL = 5;
        const auffaellig = zufallZahl(0, ANZAHL - 1);
        let gewaehlt = -1;
        let geloest = false;
        return {
          zeichne: function (r) {
            const innen = rahmen(r, "Analyse fertig. Welche Probe weicht ab?",
              geloest ? "Richtig – Probe gemeldet." : gewaehlt >= 0 ? "Das war eine normale Probe." : "");
            pult(innen);
            const luecke = 8;
            const tb = (innen.b - 2 * 14 - (ANZAHL - 1) * luecke) / ANZAHL;
            const th = Math.min(84, innen.h - 24);
            const ty = innen.y + (innen.h - th) / 2;
            for (let i = 0; i < ANZAHL; i++) {
              const tr = { x: innen.x + 14 + i * (tb + luecke), y: ty, b: tb, h: th };
              const ist = i === auffaellig;
              const zeige = geloest && ist;
              ui.fuelleRund(tr.x, tr.y, tr.b, tr.h, 8, zeige ? "#14532d" : PULT_HELL);
              /* Die abweichende Probe ist an ihrer Färbung zu erkennen. */
              const fuell = ist ? "#f97316" : "#38bdf8";
              ui.fuelleRund(tr.x + tb / 2 - 9, tr.y + 16, 18, th - 40, 4, fuell);
              ui.schreibe(String(i + 1), tr.x + tb / 2, tr.y + th - 12, {
                groesse: 12, ausrichtung: "center", farbe: "#94a3b8"
              });
              ui.merke("probe-" + i, tr, "aufgabe-taste");
              if (!geloest && ui.geklickt(tr)) {
                gewaehlt = i;
                if (ist) { geloest = true; fertig(); }
              }
            }
          }
        };
      }
    });
  }

  /* ==================================================================== */
  /*  4. Kabel reparieren (drei Orte, je vier Kabel)                      */
  /* ==================================================================== */

  /* Farbe UND Symbol müssen zusammenpassen. Nur die Farbe wäre für Farbenblinde nicht
     lösbar, nur das Symbol wäre auf dem Handy zu klein. */
  function aufgabeKabel(optionen, onFertig) {
    const ADERN = [
      { farbe: "#ef4444", zeichen: "▲" },
      { farbe: "#3b82f6", zeichen: "●" },
      { farbe: "#eab308", zeichen: "■" },
      { farbe: "#22c55e", zeichen: "◆" }
    ];
    const links = mischen([0, 1, 2, 3]);
    const rechts = mischen([0, 1, 2, 3]);
    const verbunden = {};
    let ziehtVon = -1;
    let fertig = false;

    return {
      hoehe: 250,
      zeichne: function (r) {
        const teil = optionen.teile > 1 ? " (" + optionen.teil + " von " + optionen.teile + ")" : "";
        const anzahl = Object.keys(verbunden).length;
        const innen = rahmen(r, "Gleiche Farbe und gleiches Zeichen verbinden." + teil,
          fertig ? "Kabel repariert." : anzahl + " von 4 verbunden");
        pult(innen);

        const rand = 18;
        const hoeheJe = Math.min(34, (innen.h - 24) / 4);
        const abstand = (innen.h - 4 * hoeheJe) / 5;
        const bx = 62;
        const lx = innen.x + rand;
        const rx = innen.x + innen.b - rand - bx;

        function platz(spalte, i) {
          return {
            x: spalte === 0 ? lx : rx,
            y: innen.y + abstand + i * (hoeheJe + abstand),
            b: bx, h: hoeheJe
          };
        }

        /* Bereits gelegte Leitungen */
        Object.keys(verbunden).forEach(ader => {
          const li = links.indexOf(Number(ader));
          const ri = rechts.indexOf(Number(ader));
          const a = platz(0, li), b = platz(1, ri);
          ui.ctx.beginPath();
          ui.ctx.moveTo(a.x + a.b, a.y + a.h / 2);
          ui.ctx.lineTo(b.x, b.y + b.h / 2);
          ui.ctx.strokeStyle = ADERN[ader].farbe;
          ui.ctx.lineWidth = 5;
          ui.ctx.stroke();
        });

        /* Leitung am Finger */
        const finger = ui.beanspruche(innen, "kabel");
        if (ziehtVon >= 0 && finger) {
          const li = links.indexOf(ziehtVon);
          const a = platz(0, li);
          ui.ctx.beginPath();
          ui.ctx.moveTo(a.x + a.b, a.y + a.h / 2);
          ui.ctx.lineTo(finger.x, finger.y);
          ui.ctx.strokeStyle = ADERN[ziehtVon].farbe;
          ui.ctx.lineWidth = 5;
          ui.ctx.stroke();
          ui.anfordern();
        }

        /* Anschlüsse zeichnen und Eingaben auswerten */
        [0, 1].forEach(spalte => {
          const reihe = spalte === 0 ? links : rechts;
          reihe.forEach((ader, i) => {
            const p = platz(spalte, i);
            const fest = verbunden[ader];
            ui.fuelleRund(p.x, p.y, p.b, p.h, 6, fest ? "#14532d" : PULT_HELL);
            ui.fuelleRund(spalte === 0 ? p.x + p.b - 8 : p.x, p.y, 8, p.h, 2, ADERN[ader].farbe);
            ui.schreibe(ADERN[ader].zeichen, p.x + p.b / 2 - (spalte === 0 ? 4 : -4), p.y + p.h / 2, {
              groesse: 15, ausrichtung: "center", farbe: ADERN[ader].farbe
            });
            ui.merke("kabel-" + (spalte === 0 ? "l" : "r") + ader, p, "aufgabe-taste");

            /* Aufsetzen links beginnt eine Leitung, Loslassen rechts schließt sie. */
            if (spalte === 0 && !fest && finger && ziehtVon < 0 &&
                ui.inRechteck(finger.startX, finger.startY, p)) {
              ziehtVon = ader;
            }
          });
        });

        /* Loslassen auswerten */
        const los = ui.beanspruchungGeloest("kabel");
        if (ziehtVon >= 0 && los) {
          rechts.forEach((ader, i) => {
            const p = platz(1, i);
            if (ader === ziehtVon && ui.inRechteck(los.x, los.y, p)) verbunden[ader] = true;
          });
          ziehtVon = -1;
          if (!fertig && Object.keys(verbunden).length === 4) { fertig = true; onFertig(); }
        }
        if (ziehtVon >= 0 && !finger) ziehtVon = -1;
      }
    };
  }

  /* ==================================================================== */
  /*  5. Strom umleiten (Teil 1 Regler, Teil 2 Schalter)                  */
  /* ==================================================================== */

  function aufgabeStrom(optionen, onFertig) {
    return (optionen.teil || 1) <= 1 ? stromRegler(optionen, onFertig) : stromSchalter(optionen, onFertig);
  }

  /* Regler auf den markierten Bereich schieben und dort loslassen. */
  function stromRegler(optionen, onFertig) {
    const soll = 0.25 + Math.random() * 0.5;
    const TOLERANZ = 0.06;
    let wert = 0;
    let fertig = false;

    return {
      hoehe: 230,
      zeichne: function (r) {
        const ziel = optionen.zielRaum ? " Danach weiter in: " + optionen.zielRaum : "";
        const innen = rahmen(r, "Schieb den Regler in den markierten Bereich." + ziel,
          fertig ? "Strom umgeleitet." : Math.round(wert * 100) + " %");
        pult(innen);

        const sx = innen.x + 26, sb = innen.b - 52;
        const sy = innen.y + innen.h / 2 - 16, sh = 32;
        /* Sollbereich */
        ui.fuelleRund(sx + sb * (soll - TOLERANZ), sy - 6, sb * TOLERANZ * 2, sh + 12, 6, "rgba(34,197,94,0.28)");
        ui.fuelleRund(sx, sy, sb, sh, 8, "#0f1726");

        const griffB = 34;
        const gx = sx + (sb - griffB) * wert;
        const gr = { x: gx, y: sy - 8, b: griffB, h: sh + 16 };
        const feld = { x: sx - 20, y: sy - 24, b: sb + 40, h: sh + 48 };
        const finger = ui.beanspruche(feld, "stromregler");
        if (finger && !fertig) {
          wert = begrenze((finger.x - sx - griffB / 2) / (sb - griffB), 0, 1);
          ui.anfordern();
        }
        const gut = Math.abs(wert - soll) <= TOLERANZ;
        ui.fuelleRund(gr.x, gr.y, gr.b, gr.h, 6, gut ? GUT : "#94a3b8");
        ui.merke("strom-griff", gr, "aufgabe-griff");

        if (!fertig && gut && ui.beanspruchungGeloest("stromregler")) { fertig = true; onFertig(); }
      }
    };
  }

  /* Schalter im Zielraum umlegen. */
  function stromSchalter(optionen, onFertig) {
    let an = false;
    return {
      hoehe: 220,
      zeichne: function (r) {
        const innen = rahmen(r, "Hauptschalter umlegen.", an ? "Strom liegt an." : "");
        pult(innen);
        const b = 120, h = 76;
        const tr = { x: innen.x + innen.b / 2 - b / 2, y: innen.y + innen.h / 2 - h / 2, b: b, h: h };
        ui.fuelleRund(tr.x, tr.y, tr.b, tr.h, 10, an ? "#14532d" : PULT_HELL);
        ui.rahmeRund(tr.x, tr.y, tr.b, tr.h, 10, an ? GUT : LINIE, 2);
        /* Kipphebel */
        ui.fuelleRund(tr.x + 16, an ? tr.y + 12 : tr.y + tr.h / 2 + 4, tr.b - 32, tr.h / 2 - 16, 6,
                      an ? GUT : "#94a3b8");
        ui.schreibe(an ? "AN" : "AUS", tr.x + tr.b / 2, tr.y + tr.h - 14, {
          groesse: 13, fett: "halb", ausrichtung: "center", farbe: an ? "#bbf7d0" : "#94a3b8"
        });
        ui.merke("strom-schalter", tr, "aufgabe-taste");
        if (!an && ui.geklickt(tr)) { an = true; onFertig(); }
      }
    };
  }

  /* ==================================================================== */
  /*  6. Verteiler kalibrieren: drei Zeiger im richtigen Moment stoppen   */
  /* ==================================================================== */

  function aufgabeVerteiler(optionen, onFertig) {
    const ANZAHL = 3;
    const zeiger = [];
    for (let i = 0; i < ANZAHL; i++) {
      zeiger.push({ pos: Math.random(), tempo: (0.45 + Math.random() * 0.4) * (i % 2 ? -1 : 1),
                    fest: false, gut: false, wiederAb: 0 });
    }
    const TOLERANZ = 0.07;
    let fertig = false;
    /* Eigene Uhr aus `ui.delta` statt `setTimeout`. Ein Timer wird in einem
       Hintergrund-Tab um Faktor 8 bis 35 gedrosselt — ein danebengetroffener
       Zeiger bliebe dann minutenlang stehen statt eine halbe Sekunde. */
    let uhr = 0;

    return {
      hoehe: 250,
      zeichne: function (r) {
        uhr += ui.delta;
        const fertigeZahl = zeiger.filter(z => z.fest && z.gut).length;
        const innen = rahmen(r, "Stopp jeden Zeiger in der grünen Zone.",
          fertig ? "Verteiler kalibriert." : fertigeZahl + " von " + ANZAHL);
        pult(innen);

        const hoeheJe = (innen.h - 16) / ANZAHL;
        zeiger.forEach((z, i) => {
          /* Danebengetroffen: nach kurzer Anzeige läuft dieser Zeiger weiter. */
          if (z.fest && !z.gut && uhr >= z.wiederAb) { z.fest = false; }
          if (!z.fest) {
            z.pos += z.tempo * (ui.delta / 1000);
            if (z.pos > 1) { z.pos = 1; z.tempo *= -1; }
            if (z.pos < 0) { z.pos = 0; z.tempo *= -1; }
            ui.anfordern();
          }
          const sx = innen.x + 20, sb = innen.b - 40;
          const sy = innen.y + 8 + i * hoeheJe + hoeheJe / 2 - 11;
          ui.fuelleRund(sx, sy, sb, 22, 6, "#0f1726");
          /* Zielzone in der Mitte */
          ui.fuelleRund(sx + sb * (0.5 - TOLERANZ), sy, sb * TOLERANZ * 2, 22, 4,
                        z.fest && z.gut ? "rgba(34,197,94,0.5)" : "rgba(34,197,94,0.25)");
          const zx = sx + sb * z.pos;
          ui.ctx.fillStyle = z.fest ? (z.gut ? GUT : SCHLECHT) : "#e2e8f0";
          ui.ctx.fillRect(zx - 2.5, sy - 5, 5, 32);

          const feld = { x: sx - 12, y: sy - 10, b: sb + 24, h: 42 };
          ui.merke("verteiler-" + i, feld, "aufgabe-taste");
          if (!z.fest && ui.geklickt(feld)) {
            z.fest = true;
            z.gut = Math.abs(z.pos - 0.5) <= TOLERANZ;
            if (!z.gut) { z.wiederAb = uhr + 500; ui.anfordern(); }
          }
        });

        if (!fertig && zeiger.every(z => z.fest && z.gut)) { fertig = true; onFertig(); }
      }
    };
  }

  /* ==================================================================== */
  /*  7. Kurs stabilisieren: Schiff auf der Bahn zum Ziel ziehen          */
  /* ==================================================================== */

  /* Die Strecke ZWISCHEN zwei Zeigerpositionen wird abgetastet, nicht nur ihr Endpunkt —
     sonst ließe sich die Bahn mit einem schnellen Wisch überspringen. Genau das hat die
     Gegenprobe beim Vorgänger aufgedeckt. */
  function aufgabeKurs(optionen, onFertig) {
    let fortschritt = 0;       // 0..1 entlang der Bahn
    let zieht = false;
    let letzteX = null, letzteY = null;
    let fertig = false;
    let abgerutscht = false;

    /* Die Bahn ist eine Sinuswelle von links nach rechts. */
    function bahnY(feld, t) {
      return feld.y + feld.h / 2 + Math.sin(t * Math.PI * 2) * (feld.h * 0.26);
    }
    function bahnX(feld, t) { return feld.x + 26 + (feld.b - 52) * t; }

    return {
      hoehe: 250,
      zeichne: function (r) {
        const innen = rahmen(r, "Zieh das Schiff auf der Linie bis zum Ziel.",
          fertig ? "Kurs stabil." : abgerutscht ? "Abgerutscht – neu ansetzen." :
          Math.round(fortschritt * 100) + " %");
        pult(innen);

        /* Bahn zeichnen */
        ui.ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = i / 60;
          const x = bahnX(innen, t), y = bahnY(innen, t);
          if (i === 0) ui.ctx.moveTo(x, y); else ui.ctx.lineTo(x, y);
        }
        ui.ctx.strokeStyle = LINIE;
        ui.ctx.lineWidth = 16;
        ui.ctx.lineCap = "round";
        ui.ctx.stroke();
        ui.ctx.strokeStyle = "#4c6084";
        ui.ctx.lineWidth = 2;
        ui.ctx.setLineDash([6, 6]);
        ui.ctx.stroke();
        ui.ctx.setLineDash([]);

        /* Ziel */
        ui.schreibe("🎯", bahnX(innen, 1), bahnY(innen, 1), { groesse: 20, ausrichtung: "center" });

        const sx = bahnX(innen, fortschritt), sy = bahnY(innen, fortschritt);
        const finger = ui.beanspruche(innen, "kurs");

        if (finger && !fertig) {
          if (!zieht) {
            /* Nur aufnehmen, wenn wirklich am Schiff angesetzt wurde. */
            if (Math.hypot(finger.startX - sx, finger.startY - sy) < 46) {
              zieht = true; abgerutscht = false;
              letzteX = finger.x; letzteY = finger.y;
            }
          } else {
            /* Die Strecke seit der letzten Position in Schritten abtasten. */
            const schritte = Math.max(1, Math.ceil(Math.hypot(finger.x - letzteX, finger.y - letzteY) / 4));
            for (let s = 1; s <= schritte && zieht; s++) {
              const px = letzteX + (finger.x - letzteX) * s / schritte;
              const py = letzteY + (finger.y - letzteY) * s / schritte;
              /* Nächstgelegener Punkt der Bahn — nur vorwärts. */
              let besterT = fortschritt, besterAbstand = Infinity;
              for (let k = 0; k <= 40; k++) {
                const t = fortschritt + (k / 40) * 0.09;
                if (t > 1) break;
                const d = Math.hypot(bahnX(innen, t) - px, bahnY(innen, t) - py);
                if (d < besterAbstand) { besterAbstand = d; besterT = t; }
              }
              if (besterAbstand > 30) { zieht = false; abgerutscht = true; fortschritt = 0; break; }
              fortschritt = Math.max(fortschritt, besterT);
            }
            letzteX = finger.x; letzteY = finger.y;
          }
          ui.anfordern();
        }
        if (!finger) zieht = false;

        /* Schiff */
        const nx = bahnX(innen, fortschritt), ny = bahnY(innen, fortschritt);
        ui.ctx.beginPath();
        ui.ctx.arc(nx, ny, 15, 0, Math.PI * 2);
        ui.ctx.fillStyle = zieht ? "#38bdf8" : "#e2e8f0";
        ui.ctx.fill();
        ui.schreibe("🚀", nx, ny, { groesse: 15, ausrichtung: "center" });
        ui.merke("kurs-schiff", { x: nx - 24, y: ny - 24, b: 48, h: 48 }, "aufgabe-griff");

        if (!fertig && fortschritt >= 0.995) { fertig = true; onFertig(); }
      }
    };
  }

  /* ==================================================================== */
  /*  8. Triebwerke ausrichten: Hebel auf die Soll-Linie                  */
  /* ==================================================================== */

  function aufgabeTriebwerk(optionen, onFertig) {
    const ANZAHL = 2;
    const hebel = [];
    for (let i = 0; i < ANZAHL; i++) hebel.push({ wert: Math.random() * 0.4, soll: 0.55 + Math.random() * 0.4 });
    const TOLERANZ = 0.05;
    let fertig = false;

    return {
      hoehe: 260,
      zeichne: function (r) {
        const gut = hebel.filter(h => Math.abs(h.wert - h.soll) <= TOLERANZ).length;
        const innen = rahmen(r, "Schieb beide Hebel auf ihre Marke.",
          fertig ? "Triebwerke ausgerichtet." : gut + " von " + ANZAHL + " auf Marke");
        pult(innen);

        const breiteJe = innen.b / ANZAHL;
        hebel.forEach((h, i) => {
          const sx = innen.x + breiteJe * i + breiteJe / 2;
          const sy = innen.y + 16, sh = innen.h - 44;
          ui.fuelleRund(sx - 15, sy, 30, sh, 8, "#0f1726");
          /* Sollmarke */
          const my = sy + sh * (1 - h.soll);
          ui.ctx.fillStyle = GELB;
          ui.ctx.fillRect(sx - 30, my - 2, 60, 4);

          const griffH = 30;
          const gy = sy + (sh - griffH) * (1 - h.wert);
          const gr = { x: sx - 26, y: gy, b: 52, h: griffH };
          const feld = { x: sx - 40, y: sy - 16, b: 80, h: sh + 32 };
          const finger = ui.beanspruche(feld, "triebwerk" + i);
          if (finger && !fertig) {
            h.wert = begrenze(1 - (finger.y - sy - griffH / 2) / (sh - griffH), 0, 1);
            ui.anfordern();
          }
          const passt = Math.abs(h.wert - h.soll) <= TOLERANZ;
          ui.fuelleRund(gr.x, gr.y, gr.b, gr.h, 6, passt ? GUT : "#94a3b8");
          ui.merke("triebwerk-" + i, gr, "aufgabe-griff");
        });

        if (!fertig && hebel.every(h => Math.abs(h.wert - h.soll) <= TOLERANZ)) {
          fertig = true; onFertig();
        }
      }
    };
  }

  /* ==================================================================== */
  /*  9. Triebwerk betanken (zweiteilig, beide Hälften Halten-Aufgaben)   */
  /* ==================================================================== */

  function aufgabeBetanken(optionen, onFertig) {
    const fuellen = (optionen.teil || 1) <= 1;
    let stand = fuellen ? 0 : 1;
    let fertig = false;

    return {
      hoehe: 250,
      zeichne: function (r) {
        const ziel = fuellen && optionen.zielRaum ? " Danach zum Triebwerk in: " + optionen.zielRaum : "";
        const innen = rahmen(r,
          (fuellen ? "Hebel gedrückt halten, bis der Kanister voll ist."
                   : "Hebel gedrückt halten, bis der Kanister leer ist.") + ziel,
          fertig ? (fuellen ? "Kanister ist voll." : "Triebwerk betankt.")
                 : Math.round(stand * 100) + " %");
        pult(innen);

        /* Kanister */
        const kb = 92, kh = Math.min(112, innen.h - 30);
        const kx = innen.x + innen.b / 2 - kb - 16;
        const ky = innen.y + (innen.h - kh) / 2;
        ui.fuelleRund(kx, ky, kb, kh, 8, "#0f1726");
        const fh = kh * stand;
        if (fh > 2) ui.fuelleRund(kx + 5, ky + kh - fh + 5, kb - 10, Math.max(0, fh - 10), 5, "#f59e0b");
        ui.rahmeRund(kx, ky, kb, kh, 8, LINIE, 2);
        ui.schreibe("⛽", kx + kb / 2, ky + kh / 2, { groesse: 26, ausrichtung: "center" });

        /* Hebel zum Halten */
        const hr = { x: innen.x + innen.b / 2 + 16, y: innen.y + (innen.h - 76) / 2, b: 110, h: 76 };
        const gehalten = !fertig && !!ui.beanspruche(hr, "tankhebel");
        ui.fuelleRund(hr.x, hr.y, hr.b, hr.h, 10, gehalten ? "#166534" : PULT_HELL);
        ui.rahmeRund(hr.x, hr.y, hr.b, hr.h, 10, gehalten ? GUT : LINIE, 2);
        ui.schreibe(gehalten ? "hält …" : "halten", hr.x + hr.b / 2, hr.y + hr.h / 2, {
          groesse: 14, fett: "halb", ausrichtung: "center", farbe: gehalten ? "#bbf7d0" : "#cbd5e1"
        });
        ui.merke("tank-hebel", hr, "aufgabe-halten");

        if (gehalten) {
          const schritt = (ui.delta / 1000) / 3.2;     // gut drei Sekunden
          stand = begrenze(fuellen ? stand + schritt : stand - schritt, 0, 1);
          ui.anfordern();
          if (!fertig && (fuellen ? stand >= 1 : stand <= 0)) { fertig = true; onFertig(); }
        }
      }
    };
  }

  /* ==================================================================== */
  /*  10. Lenkung ausrichten: Fadenkreuz driftet weg                      */
  /* ==================================================================== */

  function aufgabeLenkung(optionen, onFertig) {
    let px = 0.5, py = 0.5;          // Position des Fadenkreuzes (0..1)
    let dx = 0.16, dy = -0.12;       // Drift je Sekunde
    let gehalten = 0;                // Sekunden im Zentrum
    const NOETIG = 2.2;
    const ZONE = 0.13;
    let fertig = false;

    return {
      hoehe: 260,
      zeichne: function (r) {
        const innen = rahmen(r, "Halte das Fadenkreuz in der Mitte, bis der Balken voll ist.",
          fertig ? "Lenkung ausgerichtet." : "");
        pult(innen);

        const feld = { x: innen.x + 16, y: innen.y + 8, b: innen.b - 32, h: innen.h - 34 };
        ui.fuelleRund(feld.x, feld.y, feld.b, feld.h, 8, "#0f1726");

        const finger = ui.beanspruche(feld, "lenkung");
        const sek = ui.delta / 1000;

        if (finger && !fertig) {
          px = begrenze((finger.x - feld.x) / feld.b, 0, 1);
          py = begrenze((finger.y - feld.y) / feld.h, 0, 1);
        } else if (!fertig) {
          /* Ohne Hand driftet es weg und prallt an den Rändern ab. */
          px += dx * sek; py += dy * sek;
          if (px < 0.04 || px > 0.96) { dx *= -1; px = begrenze(px, 0.04, 0.96); }
          if (py < 0.06 || py > 0.94) { dy *= -1; py = begrenze(py, 0.06, 0.94); }
        }

        const mitte = Math.hypot(px - 0.5, py - 0.5) < ZONE;
        if (!fertig) {
          gehalten = mitte ? gehalten + sek : Math.max(0, gehalten - sek * 0.8);
          if (gehalten >= NOETIG) { fertig = true; onFertig(); }
        }
        ui.anfordern();

        /* Zielzone */
        ui.ctx.beginPath();
        ui.ctx.arc(feld.x + feld.b / 2, feld.y + feld.h / 2, Math.min(feld.b, feld.h) * ZONE, 0, Math.PI * 2);
        ui.ctx.strokeStyle = mitte ? GUT : LINIE;
        ui.ctx.lineWidth = 2;
        ui.ctx.stroke();

        /* Fadenkreuz */
        const cx = feld.x + feld.b * px, cy = feld.y + feld.h * py;
        ui.ctx.strokeStyle = mitte ? GUT : "#e2e8f0";
        ui.ctx.lineWidth = 2;
        ui.ctx.beginPath();
        ui.ctx.moveTo(cx - 14, cy); ui.ctx.lineTo(cx + 14, cy);
        ui.ctx.moveTo(cx, cy - 14); ui.ctx.lineTo(cx, cy + 14);
        ui.ctx.stroke();
        ui.ctx.beginPath();
        ui.ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ui.ctx.stroke();
        ui.merke("lenkung-kreuz", { x: cx - 24, y: cy - 24, b: 48, h: 48 }, "aufgabe-griff");

        balken(innen.x + 16, innen.y + innen.h - 18, innen.b - 32, 10, gehalten / NOETIG, GUT);
      }
    };
  }

  /* ==================================================================== */
  /*  11. Asteroiden zerstören: 20 Treffer                                */
  /* ==================================================================== */

  function aufgabeAsteroiden(optionen, onFertig) {
    const ZIEL = 20;
    const MAX = 5;
    let getroffen = 0;
    const brocken = [];
    let fertig = false;

    function neuer(feld) {
      brocken.push({
        x: 1.05 + Math.random() * 0.3,
        y: 0.08 + Math.random() * 0.78,
        tempo: 0.14 + Math.random() * 0.16,     // Anteil der Breite je Sekunde
        zeichen: zufallAus(["🪨", "☄️"]),
        weg: false, blitzBis: 0
      });
    }

    return {
      hoehe: 250,
      zeichne: function (r) {
        const innen = rahmen(r, "Tippe die Asteroiden ab.",
          fertig ? "Feld geräumt!" : getroffen + " von " + ZIEL);
        pult(innen);
        const feld = { x: innen.x + 10, y: innen.y + 6, b: innen.b - 20, h: innen.h - 16 };
        ui.ctx.save();
        ui.ctx.beginPath(); ui.ctx.rect(feld.x, feld.y, feld.b, feld.h); ui.ctx.clip();

        /* Fadenkreuz in der Mitte */
        ui.schreibe("+", feld.x + feld.b / 2, feld.y + feld.h / 2, {
          groesse: 22, farbe: "rgba(226,232,240,0.25)", ausrichtung: "center"
        });

        const lebend = brocken.filter(b => !b.weg);
        if (!fertig && lebend.length < MAX) neuer(feld);

        const sek = ui.delta / 1000;
        brocken.forEach((b, i) => {
          if (b.weg) return;
          b.x -= b.tempo * sek;
          if (b.x < -0.1) { b.x = 1.05 + Math.random() * 0.25; b.y = 0.08 + Math.random() * 0.78; }
          const bx = feld.x + feld.b * b.x, by = feld.y + feld.h * b.y;
          const tr = { x: bx - 24, y: by - 24, b: 48, h: 48 };
          ui.schreibe(b.zeichen, bx, by, { groesse: 26, ausrichtung: "center" });
          ui.merke("asteroid-" + i, tr, "aufgabe-taste");
          if (!fertig && ui.geklickt(tr)) {
            b.weg = true;
            getroffen++;
            if (getroffen >= ZIEL) { fertig = true; onFertig(); }
          }
        });
        ui.ctx.restore();
        if (!fertig) ui.anfordern();
      }
    };
  }

  /* ==================================================================== */
  /*  12. Schilde aktivieren: alle roten Segmente antippen                */
  /* ==================================================================== */

  function aufgabeSchilde(optionen, onFertig) {
    const ANZAHL = 7;
    const offen = [];
    for (let i = 0; i < ANZAHL; i++) offen.push(Math.random() < 0.6);
    if (!offen.some(o => o)) offen[zufallZahl(0, ANZAHL - 1)] = true;
    let fertig = false;

    return {
      hoehe: 250,
      zeichne: function (r) {
        const rest = offen.filter(o => o).length;
        const innen = rahmen(r, "Tippe alle roten Segmente an.",
          fertig ? "Schilde aktiv." : rest + " offen");
        pult(innen);

        const cx = innen.x + innen.b / 2, cy = innen.y + innen.h / 2;
        const radius = Math.min(innen.b, innen.h) / 2 - 14;
        const innenR = radius * 0.42;

        for (let i = 0; i < ANZAHL; i++) {
          const a0 = (i / ANZAHL) * Math.PI * 2 - Math.PI / 2;
          const a1 = ((i + 1) / ANZAHL) * Math.PI * 2 - Math.PI / 2 - 0.05;
          ui.ctx.beginPath();
          ui.ctx.arc(cx, cy, radius, a0, a1);
          ui.ctx.arc(cx, cy, innenR, a1, a0, true);
          ui.ctx.closePath();
          ui.ctx.fillStyle = offen[i] ? "rgba(239,68,68,0.85)" : "rgba(34,197,94,0.8)";
          ui.ctx.fill();

          /* Trefferfläche als Rechteck um die Segmentmitte — genau genug bei sieben
             Segmenten und ohne aufwendige Winkelprüfung. */
          const am = (a0 + a1) / 2;
          const mr = (radius + innenR) / 2;
          const tr = { x: cx + Math.cos(am) * mr - 22, y: cy + Math.sin(am) * mr - 22, b: 44, h: 44 };
          ui.merke("schild-" + i, tr, "aufgabe-taste");
          if (!fertig && offen[i] && ui.geklickt(tr)) {
            offen[i] = false;
            if (!offen.some(o => o)) { fertig = true; onFertig(); }
          }
        }
        ui.ctx.beginPath();
        ui.ctx.arc(cx, cy, innenR - 6, 0, Math.PI * 2);
        ui.ctx.fillStyle = fertig ? "rgba(34,197,94,0.35)" : "#0f1726";
        ui.ctx.fill();
        ui.schreibe("🛡️", cx, cy, { groesse: 22, ausrichtung: "center" });
      }
    };
  }

  /* ==================================================================== */
  /*  13. Müll entsorgen: Hebel ziehen und halten                         */
  /* ==================================================================== */

  function aufgabeMuell(optionen, onFertig) {
    let stand = 1;      // 1 = voll
    let fertig = false;

    return {
      hoehe: 250,
      zeichne: function (r) {
        const innen = rahmen(r, "Hebel nach unten ziehen und halten, bis die Luke leer ist.",
          fertig ? "Müll entsorgt." : Math.round(stand * 100) + " % voll");
        pult(innen);

        /* Schacht mit Inhalt */
        const sb = innen.b * 0.5, sh = innen.h - 24;
        const sx = innen.x + 16, sy = innen.y + 12;
        ui.fuelleRund(sx, sy, sb, sh, 8, "#0f1726");
        const fh = (sh - 12) * stand;
        if (fh > 2) {
          ui.ctx.save();
          ui.ctx.beginPath(); ui.ctx.rect(sx + 6, sy + sh - 6 - fh, sb - 12, fh); ui.ctx.clip();
          for (let i = 0; i < 22; i++) {
            const gx = sx + 12 + (i * 37) % (sb - 30);
            const gy = sy + sh - 12 - (i * 23) % Math.max(10, fh);
            ui.schreibe(zufallAus(["🗑️"]), gx, gy, { groesse: 14 });
          }
          ui.ctx.restore();
          ui.fuelleRund(sx + 6, sy + sh - 6 - fh, sb - 12, fh, 4, "rgba(120,113,108,0.55)");
        }
        ui.rahmeRund(sx, sy, sb, sh, 8, LINIE, 2);

        /* Hebel: die Bahn läuft senkrecht, unten heißt „gezogen". */
        const hx = innen.x + innen.b - 74;
        const bahnY = innen.y + 16, bahnH = innen.h - 44;
        ui.fuelleRund(hx - 9, bahnY, 18, bahnH, 8, "#0f1726");
        const feld = { x: hx - 46, y: bahnY - 12, b: 92, h: bahnH + 24 };
        const finger = ui.beanspruche(feld, "muellhebel");
        const gezogen = !fertig && finger && finger.y > bahnY + bahnH * 0.55;
        const gy = gezogen ? bahnY + bahnH - 34 : bahnY + 4;
        ui.fuelleRund(hx - 26, gy, 52, 32, 6, gezogen ? GUT : "#94a3b8");
        ui.merke("muell-hebel", { x: hx - 26, y: gy, b: 52, h: 32 }, "aufgabe-halten");
        ui.schreibe("↓", hx, gy + 16, { groesse: 16, fett: true, ausrichtung: "center", farbe: "#0f1726" });

        if (gezogen) {
          stand = begrenze(stand - (ui.delta / 1000) / 2.6, 0, 1);
          ui.anfordern();
          if (!fertig && stand <= 0) { fertig = true; onFertig(); }
        }
      }
    };
  }

  /* ==================================================================== */
  /*  14. Filter reinigen: Blätter in den Abzugsschacht ziehen            */
  /* ==================================================================== */

  function aufgabeFilter(optionen, onFertig) {
    const ANZAHL = 5;
    const blaetter = [];
    for (let i = 0; i < ANZAHL; i++) {
      blaetter.push({
        x: 0.08 + (i % 3) * 0.16 + Math.random() * 0.05,
        y: 0.16 + Math.floor(i / 3) * 0.42 + Math.random() * 0.08,
        weg: false, zeichen: zufallAus(["🍂", "🍁", "🌿"])
      });
    }
    let zieht = -1;
    let fertig = false;

    return {
      hoehe: 250,
      zeichne: function (r) {
        const rest = blaetter.filter(b => !b.weg).length;
        const innen = rahmen(r, "Zieh die Blätter in den Schacht rechts.",
          fertig ? "Filter sauber." : rest + " übrig");
        pult(innen);

        const gitter = { x: innen.x + 10, y: innen.y + 6, b: innen.b * 0.64, h: innen.h - 14 };
        ui.fuelleRund(gitter.x, gitter.y, gitter.b, gitter.h, 8, "#0f1726");
        /* Gittermuster */
        ui.ctx.strokeStyle = "rgba(120,140,175,0.25)";
        ui.ctx.lineWidth = 1;
        for (let gx = gitter.x + 12; gx < gitter.x + gitter.b; gx += 14) {
          ui.ctx.beginPath(); ui.ctx.moveTo(gx, gitter.y + 4); ui.ctx.lineTo(gx, gitter.y + gitter.h - 4); ui.ctx.stroke();
        }

        const schacht = { x: innen.x + innen.b - innen.b * 0.28 - 8, y: innen.y + 14,
                          b: innen.b * 0.28, h: innen.h - 30 };
        ui.fuelleRund(schacht.x, schacht.y, schacht.b, schacht.h, 8,
                      zieht >= 0 ? "rgba(34,197,94,0.25)" : "#132033");
        ui.rahmeRund(schacht.x, schacht.y, schacht.b, schacht.h, 8, zieht >= 0 ? GUT : LINIE, 2);
        ui.schreibe("Abzug", schacht.x + schacht.b / 2, schacht.y + schacht.h - 14, {
          groesse: 11, ausrichtung: "center", farbe: "#94a3b8"
        });

        const finger = ui.beanspruche(innen, "filter");

        blaetter.forEach((b, i) => {
          if (b.weg) return;
          let bx = gitter.x + gitter.b * b.x, by = gitter.y + gitter.h * b.y;
          if (zieht === i && finger) { bx = finger.x; by = finger.y; ui.anfordern(); }
          const tr = { x: bx - 22, y: by - 22, b: 44, h: 44 };
          ui.schreibe(b.zeichen, bx, by, { groesse: 24, ausrichtung: "center" });
          ui.merke("blatt-" + i, tr, "aufgabe-griff");
          if (zieht < 0 && finger && ui.inRechteck(finger.startX, finger.startY, tr)) zieht = i;
        });

        const losF = ui.beanspruchungGeloest("filter");
        if (zieht >= 0 && losF) {
          if (ui.inRechteck(losF.x, losF.y, schacht)) {
            blaetter[zieht].weg = true;
            if (!fertig && blaetter.every(b => b.weg)) { fertig = true; onFertig(); }
          }
          zieht = -1;
        }
        if (zieht >= 0 && !finger) zieht = -1;
      }
    };
  }

  /* ==================================================================== */
  /*  15. Daten übertragen (zweiteilig)                                   */
  /* ==================================================================== */

  function aufgabeDaten(optionen, onFertig) {
    const hoch = (optionen.teil || 1) > 1;
    let anteil = 0;
    let laeuft = false;
    let fertig = false;

    return {
      hoehe: 240,
      zeichne: function (r) {
        const ziel = !hoch && optionen.zielRaum ? " Danach zum Hauptserver in: " + optionen.zielRaum : "";
        const innen = rahmen(r,
          (hoch ? "Daten auf den Hauptserver hochladen." : "Daten herunterladen.") + ziel,
          fertig ? (hoch ? "Übertragung abgeschlossen." : "Daten liegen auf dem Gerät.")
                 : laeuft ? Math.round(anteil * 100) + " %" : "");
        pult(innen);

        ui.schreibe(hoch ? "📡" : "💾", innen.x + innen.b / 2, innen.y + 42, {
          groesse: 34, ausrichtung: "center"
        });

        if (!laeuft) {
          const kr = { x: innen.x + innen.b / 2 - 84, y: innen.y + innen.h - 60, b: 168, h: 46 };
          if (taste("daten-start", kr, hoch ? "Hochladen" : "Herunterladen",
                    { farbe: F.primaer, groesse: 15 })) laeuft = true;
        } else {
          anteil = begrenze(anteil + (ui.delta / 1000) / 4.5, 0, 1);
          balken(innen.x + 24, innen.y + innen.h - 44, innen.b - 48, 12, anteil, F.primaer);
          ui.anfordern();
          if (!fertig && anteil >= 1) { fertig = true; onFertig(); }
        }
      }
    };
  }

  /* ==================================================================== */
  /*  16. Scan durchführen (MedBay) — das härteste Alibi                  */
  /* ==================================================================== */

  /* Wer hier steht, kann von niemandem verdächtigt werden — deshalb dauert der Scan
     absichtlich lange. Abbrechen zählt nicht. */
  function aufgabeScan(optionen, onFertig) {
    const DAUER = 9;
    let laeuft = false;
    let vergangen = 0;
    let fertig = false;

    return {
      hoehe: 260,
      zeichne: function (r) {
        const innen = rahmen(r, "Auf die Plattform stellen und still halten.",
          fertig ? "Scan abgeschlossen." : laeuft ? "Scan läuft – " + Math.ceil(DAUER - vergangen) + " s" : "");
        pult(innen);

        const cx = innen.x + innen.b / 2;
        const oben = innen.y + 8, hoehe = innen.h - 46;

        /* Figur auf der Plattform */
        ui.schreibe("🧍", cx, oben + hoehe / 2, { groesse: 40, ausrichtung: "center" });
        ui.fuelleRund(cx - 52, oben + hoehe - 10, 104, 10, 5, PULT_HELL);

        /* Scanstrahl wandert über die verstrichene Zeit */
        if (laeuft && !fertig) {
          vergangen += ui.delta / 1000;
          const t = (vergangen % 2) / 2;
          const sy = oben + hoehe * t;
          ui.ctx.fillStyle = "rgba(56,189,248,0.55)";
          ui.ctx.fillRect(cx - 62, sy - 2, 124, 4);
          ui.anfordern();
          if (vergangen >= DAUER) { fertig = true; onFertig(); }
        }

        balken(innen.x + 24, innen.y + innen.h - 30, innen.b - 48, 10,
               laeuft ? vergangen / DAUER : 0, "#38bdf8");

        if (!laeuft) {
          const kr = { x: cx - 84, y: innen.y + innen.h - 62, b: 168, h: 44 };
          if (taste("scan-start", kr, "Scan starten", { farbe: F.primaer, groesse: 15 })) laeuft = true;
        }
      }
    };
  }

  /* ==================================================================== */
  /*  17. Karte durchziehen (Swipe Card)                                  */
  /* ==================================================================== */

  /* Die berüchtigtste Aufgabe des Originals. Genau deshalb prüft sie die
     Geschwindigkeit und nicht nur, DASS gewischt wurde. */
  function aufgabeSwipe(optionen, onFertig) {
    let zieht = false;
    let anteil = 0;
    let start = 0;
    let meldung = "";
    let fertig = false;

    return {
      hoehe: 240,
      zeichne: function (r) {
        const innen = rahmen(r, "Karte gleichmäßig durchziehen – nicht zu schnell, nicht zu langsam.",
          fertig ? "Akzeptiert." : meldung);
        pult(innen);

        const schlitzY = innen.y + 28;
        const sx = innen.x + 20, sb = innen.b - 40;
        ui.fuelleRund(sx, schlitzY, sb, 14, 7, "#0f1726");
        ui.schreibe("Leser", innen.x + innen.b / 2, schlitzY - 12, {
          groesse: 11, ausrichtung: "center", farbe: "#94a3b8"
        });

        const kb = 96, kh = 58;
        const ky = schlitzY + 26;
        const kx = sx + (sb - kb) * anteil;
        const feld = { x: sx - 10, y: ky - 14, b: sb + 20, h: kh + 28 };
        const finger = ui.beanspruche(feld, "swipe");

        if (finger && !fertig) {
          if (!zieht && ui.inRechteck(finger.startX, finger.startY, { x: kx - 20, y: ky - 10, b: kb + 40, h: kh + 20 })) {
            zieht = true;
            start = Date.now();
            meldung = "";
          }
          if (zieht) {
            anteil = begrenze((finger.x - sx - kb / 2) / (sb - kb), 0, 1);
            ui.anfordern();
          }
        }

        if (zieht && ui.beanspruchungGeloest("swipe")) {
          zieht = false;
          if (anteil >= 0.97) {
            const dauer = Date.now() - start;
            /* Fenster wie im Original: schnelles Durchziehen wird abgelehnt,
               zu langsames ebenfalls. */
            if (dauer < 420) { meldung = "Zu schnell."; anteil = 0; }
            else if (dauer > 1500) { meldung = "Zu langsam."; anteil = 0; }
            else { fertig = true; onFertig(); }
          } else {
            meldung = "Nicht ganz durch.";
            anteil = 0;
          }
        }
        if (!finger && zieht) { zieht = false; anteil = 0; }

        ui.fuelleRund(kx, ky, kb, kh, 6, fertig ? GUT : "#e2e8f0");
        ui.schreibe("💳", kx + kb / 2, ky + kh / 2, { groesse: 20, ausrichtung: "center" });
        ui.merke("swipe-karte", { x: kx, y: ky, b: kb, h: kh }, "aufgabe-griff");
      }
    };
  }

  /* ==================================================================== */
  /*  Reparaturen (keine Aufgaben aus Michels Liste)                      */
  /* ==================================================================== */

  /* Sicherungskasten: alle Schalter nach oben. */
  function reparaturLicht(optionen, onFertig) {
    const ANZAHL = 5;
    const an = [];
    for (let i = 0; i < ANZAHL; i++) an.push(false);
    let fertig = false;

    return {
      hoehe: 230,
      zeichne: function (r) {
        const offen = an.filter(a => !a).length;
        const innen = rahmen(r, "Alle Sicherungen wieder einschalten.",
          fertig ? "Licht ist an." : offen + " offen");
        pult(innen);

        const luecke = 10;
        const tb = (innen.b - 2 * 16 - (ANZAHL - 1) * luecke) / ANZAHL;
        const th = Math.min(96, innen.h - 24);
        const ty = innen.y + (innen.h - th) / 2;
        for (let i = 0; i < ANZAHL; i++) {
          const tr = { x: innen.x + 16 + i * (tb + luecke), y: ty, b: tb, h: th };
          ui.fuelleRund(tr.x, tr.y, tr.b, tr.h, 8, "#0f1726");
          ui.fuelleRund(tr.x + 5, an[i] ? tr.y + 6 : tr.y + th / 2 + 2, tb - 10, th / 2 - 8, 5,
                        an[i] ? GELB : "#64748b");
          ui.merke("sicherung-" + i, tr, "aufgabe-taste");
          if (!fertig && !an[i] && ui.geklickt(tr)) {
            an[i] = true;
            if (an.every(a => a)) { fertig = true; onFertig(); }
          }
        }
      }
    };
  }

  /* Kühlventil: gehalten wird hier nur die eigene Seite — die Gleichzeitigkeit
     prüft das Spiel, weil die beiden Ventile an entgegengesetzten Enden der
     Karte liegen. */
  function reparaturKuehlung(optionen) {
    const beiHalten = (optionen && optionen.beiHalten) || function () {};
    const beiLoslassen = (optionen && optionen.beiLoslassen) || function () {};
    let haelt = false;

    return {
      hoehe: 230,
      aufraeumen: function () { if (haelt) { haelt = false; beiLoslassen(); } },
      zeichne: function (r) {
        const innen = rahmen(r, "Ventil gedrückt halten. Beide Ventile müssen gleichzeitig gehalten werden.",
          haelt ? "Wird gehalten …" : "Nicht gehalten");
        pult(innen);

        const b = 132, h = Math.min(112, innen.h - 16);
        const vr = { x: innen.x + innen.b / 2 - b / 2, y: innen.y + (innen.h - h) / 2, b: b, h: h };
        const finger = ui.beanspruche(vr, "kuehlventil");
        const jetztHaelt = !!finger;
        if (jetztHaelt !== haelt) {
          haelt = jetztHaelt;
          if (haelt) beiHalten(); else beiLoslassen();
        }
        ui.ctx.beginPath();
        ui.ctx.arc(vr.x + b / 2, vr.y + h / 2, Math.min(b, h) / 2 - 4, 0, Math.PI * 2);
        ui.ctx.fillStyle = haelt ? "rgba(34,197,94,0.35)" : PULT_HELL;
        ui.ctx.fill();
        ui.ctx.strokeStyle = haelt ? GUT : LINIE;
        ui.ctx.lineWidth = 3;
        ui.ctx.stroke();
        ui.schreibe("❄️", vr.x + b / 2, vr.y + h / 2, { groesse: 30, ausrichtung: "center" });
        ui.merke("kuehl-ventil", vr, "aufgabe-halten");
        if (haelt) ui.anfordern();
      }
    };
  }

  /* ==================================================================== */
  /*  Registry                                                            */
  /* ==================================================================== */

  // Zusatzfelder steuern, wie das Spiel die Aufgabe verteilt:
  //   sichtbar: "…"      — sichtbare Aufgabe (visual task), hinterlässt eine Spur für alle
  //   teile: 3            — drei Standorte in drei verschiedenen Räumen, Reihenfolge egal
  //   kette: [a, b]       — feste Reihenfolge; "*" heißt "beliebiger anderer Raum"
  //   wartenSek           — die Aufgabe hat eine Pause, in der man weggehen kann
  // waehleAufgaben() in game-service.js liest diese Felder; wer hier eins ergänzt, muss die
  // Standorte in STATIONS_TABELLE passend vorhalten.
  const AUFGABEN_TYPEN = {
    // Reaktoren, Zahlen & Muster
    reaktor:      { name: "Reaktor starten",       start: aufgabeReaktor },
    manifold:     { name: "Manifold entsperren",   start: aufgabeManifold },
    proben:       { name: "Proben analysieren",    start: aufgabeProben, wartenSek: WARTEZEIT_SEK },
    scan:         { name: "Scan durchführen",      start: aufgabeScan, sichtbar: "🩺" },
    // Strom & Verkabelung
    kabel:        { name: "Kabel reparieren",      start: aufgabeKabel, teile: 3 },
    strom:        { name: "Strom umleiten",        start: aufgabeStrom, kette: ["electrical", "*"] },
    verteiler:    { name: "Verteiler kalibrieren", start: aufgabeVerteiler },
    // Antrieb & Navigation
    triebwerk:    { name: "Triebwerke ausrichten", start: aufgabeTriebwerk },
    betanken:     { name: "Triebwerk betanken",    start: aufgabeBetanken, kette: ["storage", "*"], sichtbar: "⛽" },
    kurs:         { name: "Kurs stabilisieren",    start: aufgabeKurs },
    lenkung:      { name: "Lenkung ausrichten",    start: aufgabeLenkung },
    asteroiden:   { name: "Asteroiden zerstören",  start: aufgabeAsteroiden, sichtbar: "💥" },
    schilde:      { name: "Schilde aktivieren",    start: aufgabeSchilde, sichtbar: "🛡️" },
    // Versorgung & Daten
    muell:        { name: "Müll entsorgen",        start: aufgabeMuell, sichtbar: "🗑️" },
    filter:       { name: "Filter reinigen",       start: aufgabeFilter },
    daten:        { name: "Daten übertragen",      start: aufgabeDaten, kette: ["*", "admin"] },
    swipe:        { name: "Karte durchziehen",     start: aufgabeSwipe }
  };

  return {
    AUFGABEN_TYPEN: AUFGABEN_TYPEN,
    reparaturLicht: reparaturLicht,
    reparaturKuehlung: reparaturKuehlung,
    mischen: mischen,
    WARTEZEIT_SEK: WARTEZEIT_SEK
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = aufgabenModul;
