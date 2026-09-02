/* ============================================================================
   motive.js — generische Silhouetten je Kartentyp
   ----------------------------------------------------------------------------
   Eine Karte ohne eigenes Foto zeigte bisher nur ihren Anfangsbuchstaben auf
   farbigem Grund. Das ist bei 500 Karten viel leere Fläche und sagt nichts.
   Stattdessen wird hier eine Silhouette passend zum Typ der Karte gezeichnet
   (Sportwagen, SUV, Van, …) — generisch, nicht modellgenau.

   Warum gezeichnet und nicht als Bilddatei:
   - keine Urheberrechtsfrage (Fotos realer Fahrzeuge sind es fast immer)
   - kein Netzwerk, kein Cache-Bust, keine 500 Dateien im Repo
   - scharf auf jeder Auflösung, auch auf Retina-Displays
   - die Farbe kommt aus der Karte, die Form aus dem Typ

   Aufbau: alle Formen sind in einem festen Koordinatensystem von 100 × 50
   beschrieben (Seitenansicht, y = 50 ist die Fahrbahn) und werden beim
   Zeichnen auf den verfügbaren Platz skaliert. Wer eine Form ändert, ändert
   Zahlen in DIESEM System — nie Pixel.

   Erweitern: `MOTIVE` um einen Schlüssel ergänzen. Der Schlüssel wird gegen
   die `rolle` der Karte kleingeschrieben verglichen; unbekannte Typen fallen
   auf `standard` zurück, es gibt also nie eine leere Fläche.
============================================================================ */

const motive = (function () {
  "use strict";

  const BREITE = 100;
  const HOEHE = 50;

  /* Ein Fahrzeug entsteht aus wenigen Kennzahlen statt aus einer Punktliste —
     so bleiben die zwölf Typen untereinander stimmig und lassen sich gezielt
     verändern („SUV etwas höher") ohne jeden Punkt neu zu setzen.

       laenge      Anteil der Breite, den das Fahrzeug einnimmt
       dachH       Höhe der Dachlinie (kleiner = höheres Fahrzeug)
       haubeH      Höhe der Motorhaube
       dachVon/Bis Anteil der Länge, über den das Dach reicht
       radR        Radradius
       radVorn/Hinten  Radmittelpunkte als Anteil der Länge
       heck        "stufe" | "schraeg" | "steil" | "pritsche"
       bug         "flach" | "steil" | "rund"                                */
  const MOTIVE = {
    /* Flach und lang, Dach weit hinten, kleine Räder dicht am Boden. */
    sportwagen:    { laenge: 0.98, dachH: 26, haubeH: 34, dachVon: 0.42, dachBis: 0.64, radR: 7,   radVorn: 0.81, radHinten: 0.21, heck: "schraeg", bug: "keil" },
    /* Klassisches Stufenheck: erkennbarer Kofferraumdeckel hinter dem Dach. */
    limousine:     { laenge: 0.96, dachH: 19, haubeH: 30, dachVon: 0.36, dachBis: 0.64, radR: 7.5, radVorn: 0.80, radHinten: 0.20, heck: "stufe",   bug: "flach" },
    kompaktklasse: { laenge: 0.82, dachH: 16, haubeH: 29, dachVon: 0.34, dachBis: 0.74, radR: 7.5, radVorn: 0.78, radHinten: 0.22, heck: "schraeg", bug: "flach" },
    kleinwagen:    { laenge: 0.68, dachH: 14, haubeH: 28, dachVon: 0.32, dachBis: 0.80, radR: 7,   radVorn: 0.79, radHinten: 0.21, heck: "steil",   bug: "steil" },
    /* Deutlich kürzer als der Kleinwagen — der Unterschied muss ins Auge fallen. */
    kleinstwagen:  { laenge: 0.48, dachH: 13, haubeH: 27, dachVon: 0.28, dachBis: 0.84, radR: 6.5, radVorn: 0.80, radHinten: 0.20, heck: "steil",   bug: "steil" },
    /* Dach läuft bis fast ans Heck durch, dann senkrecht herunter. */
    kombi:         { laenge: 0.98, dachH: 15, haubeH: 29, dachVon: 0.33, dachBis: 0.90, radR: 7.5, radVorn: 0.81, radHinten: 0.19, heck: "senkrecht", bug: "flach" },
    /* Hoch auf großen Rädern, aber mit Pkw-Haube. */
    suv:           { laenge: 0.88, dachH: 12, haubeH: 25, dachVon: 0.34, dachBis: 0.80, radR: 10,  radVorn: 0.78, radHinten: 0.22, heck: "steil",   bug: "steil" },
    /* Kürzer, kantiger, noch größere Räder, Dachlinie eben — plus Reserverad. */
    gelaendewagen: { laenge: 0.76, dachH: 9,  haubeH: 24, dachVon: 0.26, dachBis: 0.84, radR: 11,  radVorn: 0.77, radHinten: 0.23, heck: "senkrecht", bug: "kasten", reserverad: true },
    /* Der Van ist das höchste Fahrzeug und hat als einziges eine Front, die
       vom Boden aus fast senkrecht in die Scheibe übergeht. */
    van:           { laenge: 0.92, dachH: 6,  haubeH: 16, dachVon: 0.16, dachBis: 0.92, radR: 8,   radVorn: 0.82, radHinten: 0.18, heck: "senkrecht", bug: "kasten" },
    pickup:        { laenge: 0.98, dachH: 13, haubeH: 26, dachVon: 0.30, dachBis: 0.56, radR: 9.5, radVorn: 0.81, radHinten: 0.23, heck: "pritsche", bug: "steil" },
    elektro:       { laenge: 0.90, dachH: 14, haubeH: 26, dachVon: 0.24, dachBis: 0.78, radR: 8,   radVorn: 0.80, radHinten: 0.20, heck: "schraeg", bug: "rund", blitz: true },
    /* Hohes, kurzes Dach, sehr kleines Fenster, freistehende Kotflügel und
       Trittbrett — ohne die drei sieht ein Oldtimer aus wie eine Limousine. */
    oldtimer:      { laenge: 0.80, dachH: 11, haubeH: 30, dachVon: 0.42, dachBis: 0.68, radR: 9,   radVorn: 0.82, radHinten: 0.18, heck: "rundheck", bug: "steil", kotfluegel: true, trittbrett: true },
    standard:      { laenge: 0.90, dachH: 17, haubeH: 28, dachVon: 0.33, dachBis: 0.74, radR: 8,   radVorn: 0.79, radHinten: 0.21, heck: "schraeg", bug: "flach" }
  };

  /* Schreibweisen, die im Deck vorkommen, auf einen Schlüssel bringen. */
  function schluesselFuer(rolle) {
    const r = String(rolle || "").toLowerCase().trim();
    if (MOTIVE[r]) return r;
    if (r.indexOf("gelände") !== -1 || r.indexOf("gelaende") !== -1) return "gelaendewagen";
    if (r.indexOf("sport") !== -1) return "sportwagen";
    if (r.indexOf("kompakt") !== -1) return "kompaktklasse";
    if (r.indexOf("kleinst") !== -1) return "kleinstwagen";
    if (r.indexOf("klein") !== -1) return "kleinwagen";
    if (r.indexOf("suv") !== -1) return "suv";
    if (r.indexOf("elektro") !== -1) return "elektro";
    if (r.indexOf("oldtimer") !== -1 || r.indexOf("klassiker") !== -1) return "oldtimer";
    if (r.indexOf("pick") !== -1) return "pickup";
    if (r.indexOf("kombi") !== -1) return "kombi";
    if (r.indexOf("van") !== -1 || r.indexOf("bus") !== -1) return "van";
    if (r.indexOf("limousine") !== -1) return "limousine";
    return "standard";
  }

  /* Baut den Umriss der Karosserie im 100×50-System. */
  function umriss(m) {
    const l = m.laenge * BREITE;
    const x0 = (BREITE - l) / 2;
    const x1 = x0 + l;
    const boden = 42;                       // Unterkante der Karosserie
    const dachA = x0 + l * m.dachVon;
    const dachB = x0 + l * m.dachBis;
    const p = [];

    /* Bug — bestimmt maßgeblich, als was die Form gelesen wird */
    if (m.bug === "kasten")      p.push([x0, boden], [x0, m.haubeH - 3], [x0 + l * 0.02, m.haubeH - 5]);
    else if (m.bug === "steil")  p.push([x0, boden], [x0, m.haubeH + 2], [x0 + l * 0.05, m.haubeH]);
    else if (m.bug === "rund")   p.push([x0, boden], [x0 + l * 0.01, m.haubeH + 5], [x0 + l * 0.08, m.haubeH]);
    else if (m.bug === "keil")   p.push([x0, boden], [x0 + l * 0.06, m.haubeH + 3], [x0 + l * 0.20, m.haubeH]);
    else                         p.push([x0, boden], [x0 + l * 0.02, m.haubeH + 4], [x0 + l * 0.12, m.haubeH]);

    /* Windschutzscheibe hoch aufs Dach */
    p.push([dachA, m.dachH]);

    if (m.heck === "pritsche") {
      /* Kabine endet früh, dahinter die offene Ladefläche */
      p.push([dachB, m.dachH], [dachB + l * 0.03, m.haubeH - 1], [x1 - l * 0.02, m.haubeH - 1], [x1, m.haubeH + 2], [x1, boden]);
    } else {
      p.push([dachB, m.dachH]);
      if (m.heck === "stufe") {
        /* Erst runter auf Kofferraumhöhe, dann waagerecht bis zum Heck — das
           ist die Stufe, die eine Limousine ausmacht. */
        p.push([dachB + l * 0.12, m.haubeH - 4], [x1 - l * 0.01, m.haubeH - 4], [x1, m.haubeH + 1], [x1, boden]);
      } else if (m.heck === "senkrecht") {
        p.push([x1, m.dachH + 2], [x1, boden]);
      } else if (m.heck === "rundheck") {
        p.push([dachB + l * 0.10, m.dachH + 6], [x1 - l * 0.01, m.haubeH - 2], [x1, m.haubeH + 3], [x1, boden]);
      } else if (m.heck === "steil") {
        p.push([dachB + l * 0.06, m.haubeH + 1], [x1, m.haubeH + 4], [x1, boden]);
      } else {
        p.push([x1 - l * 0.04, m.haubeH + 2], [x1, m.haubeH + 6], [x1, boden]);
      }
    }
    return { punkte: p, x0: x0, x1: x1, laenge: l, boden: boden, dachA: dachA, dachB: dachB };
  }

  /* Zeichnet die Silhouette in das Rechteck (x, y, b, h).
     `farbe` ist die Silhouettenfarbe, `deckkraft` steuert die Zurückhaltung —
     das Motiv soll die Karte schmücken, nicht von den Werten ablenken. */
  function zeichne(ctx, rolle, x, y, b, h, farbe, deckkraft) {
    const m = MOTIVE[schluesselFuer(rolle)];
    const f = Math.min(b / BREITE, h / HOEHE);
    const versatzX = x + (b - BREITE * f) / 2;
    const versatzY = y + (h - HOEHE * f) / 2;
    const P = (px, py) => [versatzX + px * f, versatzY + py * f];
    const g = umriss(m);

    ctx.save();
    ctx.globalAlpha = deckkraft === undefined ? 0.5 : deckkraft;
    ctx.fillStyle = farbe;
    ctx.strokeStyle = farbe;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    /* Karosserie */
    ctx.beginPath();
    g.punkte.forEach((pt, i) => {
      const q = P(pt[0], pt[1]);
      if (i === 0) ctx.moveTo(q[0], q[1]);
      else ctx.lineTo(q[0], q[1]);
    });
    ctx.closePath();
    ctx.fill();

    /* Ladefläche des Pickups als Rahmen, damit sie offen wirkt */
    if (m.heck === "pritsche") {
      const a = P(g.dachB + g.laenge * 0.05, m.haubeH - 1);
      const bb = P(g.x1 - g.laenge * 0.03, m.haubeH + 8);
      ctx.globalAlpha = (deckkraft === undefined ? 0.5 : deckkraft) * 0.45;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(a[0], a[1], bb[0] - a[0], bb[1] - a[1]);
      ctx.fillStyle = farbe;
      ctx.globalAlpha = deckkraft === undefined ? 0.5 : deckkraft;
    }

    /* Fenster als helle Aussparung — erst dadurch liest sich die Form als
       Fahrzeug und nicht als Klotz. */
    const fensterA = g.dachA + g.laenge * 0.035;
    const fensterB = (m.heck === "pritsche" ? g.dachB : g.dachB) - g.laenge * 0.035;
    if (fensterB > fensterA) {
      ctx.globalAlpha = (deckkraft === undefined ? 0.5 : deckkraft) * 0.5;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      const oben = m.dachH + 2.5;
      const unten = m.haubeH - 2.5;
      const q1 = P(fensterA + g.laenge * 0.04, oben);
      const q2 = P(fensterB, oben);
      const q3 = P(fensterB, unten);
      const q4 = P(fensterA, unten);
      ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]);
      ctx.lineTo(q3[0], q3[1]); ctx.lineTo(q4[0], q4[1]);
      ctx.closePath();
      ctx.fill();
      /* Senkrechte Fensterteilung */
      if (fensterB - fensterA > g.laenge * 0.2) {
        const mitte = (fensterA + fensterB) / 2;
        const s1 = P(mitte, oben), s2 = P(mitte, unten);
        ctx.strokeStyle = farbe;
        ctx.lineWidth = Math.max(1, 1.2 * f);
        ctx.globalAlpha = deckkraft === undefined ? 0.5 : deckkraft;
        ctx.beginPath();
        ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]);
        ctx.stroke();
      }
      ctx.fillStyle = farbe;
      ctx.globalAlpha = deckkraft === undefined ? 0.5 : deckkraft;
    }

    /* Trittbrett zwischen den Kotflügeln (Oldtimer) */
    if (m.trittbrett) {
      const a = P(g.x0 + g.laenge * m.radHinten + m.radR * 0.9, g.boden - 5);
      const bb = P(g.x0 + g.laenge * m.radVorn - m.radR * 0.9, g.boden - 2);
      ctx.fillRect(a[0], a[1], bb[0] - a[0], bb[1] - a[1]);
    }

    /* Freistehende Kotflügel — ohne sie liest sich ein Oldtimer als Limousine */
    if (m.kotfluegel) {
      [m.radVorn, m.radHinten].forEach(anteil => {
        const mx = g.x0 + g.laenge * anteil;
        const c = P(mx, g.boden);
        ctx.beginPath();
        ctx.arc(c[0], c[1], (m.radR + 4) * f, Math.PI, 0);
        ctx.lineTo(c[0] + m.radR * f, c[1]);
        ctx.arc(c[0], c[1], m.radR * f, 0, Math.PI, true);
        ctx.closePath();
        ctx.fill();
      });
    }

    /* Reserverad am Heck (Geländewagen) */
    if (m.reserverad) {
      const c = P(g.x1 + 2, (m.dachH + m.haubeH) / 2 + 2);
      ctx.lineWidth = Math.max(1.5, 3 * f);
      ctx.beginPath();
      ctx.arc(c[0], c[1], m.radR * 0.62 * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* Räder als offener Ring. Ein gefüllter Kreis mit `destination-out`-Loch
       sah milchig aus, weil das Ausschneiden mit gesetzter Deckkraft nur
       teilweise greift — der Ring braucht diesen Umweg gar nicht erst. */
    ctx.lineWidth = Math.max(2, m.radR * 0.56 * f);
    [m.radVorn, m.radHinten].forEach(anteil => {
      const mx = g.x0 + g.laenge * anteil;
      const c = P(mx, g.boden);
      ctx.beginPath();
      ctx.arc(c[0], c[1], m.radR * 0.72 * f, 0, Math.PI * 2);
      ctx.stroke();
    });

    /* Blitz über dem Dach beim Elektroauto */
    if (m.blitz) {
      const s = P(g.x0 + g.laenge * 0.5, m.dachH - 7);
      const e = 4.2 * f;
      ctx.beginPath();
      ctx.moveTo(s[0] + e * 0.35, s[1] - e);
      ctx.lineTo(s[0] - e * 0.55, s[1] + e * 0.25);
      ctx.lineTo(s[0] + e * 0.02, s[1] + e * 0.25);
      ctx.lineTo(s[0] - e * 0.30, s[1] + e);
      ctx.lineTo(s[0] + e * 0.60, s[1] - e * 0.15);
      ctx.lineTo(s[0] - e * 0.02, s[1] - e * 0.15);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  return {
    zeichne: zeichne,
    schluesselFuer: schluesselFuer,
    typen: function () { return Object.keys(MOTIVE); }
  };
})();
