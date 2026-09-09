/* ==========================================================================
   Viertelmeile — das Rennbild
   ==========================================================================
   Zeichnet die Fahrt auf eine Canvas (Zeichenfläche), nimmt die Tipper
   entgegen und meldet am Ende das Ergebnis. Die Physik steckt in physik.js,
   hier ist nur Bild und Bedienung.

   BEDIENUNG, QUER GEHALTEN:
     linke Bildhälfte  = lenken. GEDRÜCKT HALTEN, nicht tippen: links halten
                         zieht nach links, daneben halten nach rechts.
     rechte Bildhälfte = Burnout halten, bei Grün losfahren, dann schalten

   ⚠️ JEDER TIPPER BRINGT SEINE ZEIT MIT. Er wird nicht beim nächsten Bild
   verrechnet, sondern in genau dem Rechenschritt, in dem er passiert ist
   (siehe physik.laufeBis). Sonst hätte ein Handy mit 120 Bildern/s einen
   messbaren Vorteil gegenüber einem mit 30.

   ⚠️ RAF STIRBT IM VERSTECKTEN TAB. Geht die App während der Fahrt in den
   Hintergrund (Anruf, Bildschirmsperre), hört das Zeichnen sofort auf. Das
   Rennen wird dann als verloren gewertet — so ist es abgesprochen, und der
   Gastgeber kann es bei Bedarf wiederholen lassen.
   ========================================================================== */

const rennen = (function () {
  'use strict';

  /* ---- Zeitplan, alles in Sekunden relativ zu GRÜN ---------------------- */

  const PLAN = {
    mitBurnout: { anfang: -9.0, burnoutVon: -7.2, burnoutBis: -3.0 },
    ohneBurnout: { anfang: -5.0, burnoutVon: null, burnoutBis: null },
  };
  const T_STAGING = -2.2;                 // Autos rollen an die Linie
  const T_GELB = [-1.5, -1.0, -0.5];      // die drei gelben Lichter
  const NACHLAUF = 2.2;                   // Ausrollen nach dem Ziel
  const ABBRUCH = 20.0;                   // spätestens dann ist Schluss
  const OHNE_START_BIS = 6.0;             // wer bis dahin nicht losfährt, hat verloren

  const WAERME_TEMPO = 1 / 2.2;           // Balkenfüllung je Sekunde
  const WAERME_MAX = 1.4;

  const POSITION_TAKT = 100;              // ms zwischen zwei Standmeldungen

  /* ---- Bildmaße --------------------------------------------------------- */

  const TIEFE = 14;                       // Tiefenmaßstab der Perspektive
  const KAMERA_ABSTAND = 4;               // wie weit die Kamera hinter dem Auto liegt
  const STREIFEN = 9;                     // Meter je Farbwechsel am Rand
  const MARKE_ALLE = 50;                  // Meter zwischen den Streckenmarken

  let z = null;
  let laufNummer = 0;

  /* ----------------------------------------------------------------------
     Start und Ende
     ---------------------------------------------------------------------- */

  /**
   * opt = {
   *   canvas, jetzt() -> ms (serverbezogen), gruenZeit (ms),
   *   auto, saat, burnout (bool),
   *   meinName, meinLack, gegnerName, gegnerLack,
   *   gegner: null | { art:'bot', stufe, botSaat } | { art:'fern' },
   *   aufPosition(d), aufMeldung(text, art), aufPhase(name), fertig(ergebnis)
   * }
   */
  function starte(opt) {
    stopp();
    const plan = opt.burnout ? PLAN.mitBurnout : PLAN.ohneBurnout;

    z = {
      opt: opt,
      plan: plan,
      canvas: opt.canvas,
      ctx: opt.canvas.getContext('2d'),
      dpr: 1,
      breite: 0,
      hoehe: 0,

      lauf: null,                       // wird beim Grün angelegt (Wärme muss feststehen)
      eingaben: [],
      waerme: opt.burnout ? 0 : null,
      haelt: false,
      burnoutFertig: !opt.burnout,

      gegnerSpur: null,
      gegnerLauf: null,
      fern: null,                       // letzte Meldung des Gegners
      fernFertig: false,

      phase: '',
      gelbGespielt: -1,
      gruenGespielt: false,
      meldung: null,
      meldungBis: 0,
      letztePosition: 0,
      nichtGestartet: false,
      beendet: false,
      raf: null,
      abgebrochen: false,
      nummer: ++laufNummer,
      lenkRichtungJetzt: 0,
    };

    /* Der Bot wird komplett vorausgerechnet — sein ganzer Lauf steht schon
       fest, bevor es losgeht. Gezeichnet wird er aus der Spur. */
    if (opt.gegner && opt.gegner.art === 'bot') {
      const r = bot.mitSpur(opt.auto, opt.saat, opt.gegner.stufe, opt.gegner.botSaat);
      z.gegnerLauf = r.lauf;
      z.gegnerSpur = r.spur;
    }

    passeGroesseAn();
    window.addEventListener('resize', passeGroesseAn);
    document.addEventListener('visibilitychange', beiVerstecken);
    haengeTipperAn();
    const nr = z.nummer;
    z.raf = requestAnimationFrame(function () { bild(nr); });
  }

  function stopp() {
    if (!z) return;
    if (z.raf) cancelAnimationFrame(z.raf);
    window.removeEventListener('resize', passeGroesseAn);
    document.removeEventListener('visibilitychange', beiVerstecken);
    loeseTipper();
    ton.stoppAlles();
    z = null;
  }

  function laeuft() { return !!z && !z.beendet; }

  function beiVerstecken() {
    if (!z || z.beendet) return;
    if (document.visibilityState !== 'hidden') return;
    /* Wegdrücken mitten im Rennen = verloren. Der Gastgeber hat den Knopf
       „Rennen wiederholen", falls es unverschuldet war. */
    if (tRel() >= T_STAGING) { z.abgebrochen = true; beende(); }
  }

  function tRel() { return (z.opt.jetzt() - z.opt.gruenZeit) / 1000; }

  /* ----------------------------------------------------------------------
     Tipper
     ---------------------------------------------------------------------- */

  /* ⚠️ ZWEI FINGER, ZWEI ZEIGER. Links wird GEHALTEN (lenken), rechts wird
     gehalten (Burnout) und getippt (Start, Schalten) — oft gleichzeitig.
     Deshalb wird je Aufgabe die `pointerId` gemerkt; ein einzelner Merker
     hätte den Daumen, der gerade schaltet, als „Lenken losgelassen"
     verbucht. */
  let gasZeiger = null;
  let lenkZeiger = null;

  function zone(x) { return x < z.breite * 0.45 ? (x < z.breite * 0.225 ? 'links' : 'rechts') : 'gas'; }

  function zeigerId(e) { return e.pointerId === undefined ? 1 : e.pointerId; }

  function beiRunter(e) {
    if (!z || z.beendet) return;
    e.preventDefault();
    ton.entsperre();
    const rect = z.canvas.getBoundingClientRect();
    const x = (e.clientX !== undefined ? e.clientX : 0) - rect.left;
    const t = tRel();
    const zn = zone(x);

    if (zn === 'gas') {
      gasZeiger = zeigerId(e);
      /* Burnout: halten, im grünen Bereich loslassen. */
      if (!z.burnoutFertig && t >= z.plan.burnoutVon && t < z.plan.burnoutBis) { z.haelt = true; return; }
      if (!z.lauf) return;
      if (z.lauf.reaktion === null) {
        if (t < T_STAGING) return;                 // vor dem Anrollen zählt nichts
        physik.starte(z.lauf, t);
        if (z.lauf.fehlstart) {
          melde('FRÜHSTART', 'schlecht');
          ton.piep('fehler');
          ton.vibriere([220, 90, 220]);
        } else {
          ton.vibriere(45);
        }
        return;
      }
      z.eingaben.push({ zeit: t, art: 'schalt' });
      return;
    }
    if (!z.lauf || !z.lauf.gestartet) return;
    lenkZeiger = zeigerId(e);
    z.lenkRichtungJetzt = zn === 'links' ? -1 : 1;
    z.eingaben.push({ zeit: t, art: 'lenkAn', richtung: z.lenkRichtungJetzt });
    ton.vibriere(14);
  }

  function beiHoch(e) {
    if (!z) return;
    const id = zeigerId(e);
    if (lenkZeiger !== null && id === lenkZeiger) {
      lenkZeiger = null;
      z.eingaben.push({ zeit: tRel(), art: 'lenkAus' });
    }
    if (gasZeiger !== null && id !== gasZeiger) return;
    gasZeiger = null;
    if (z.haelt) { z.haelt = false; z.burnoutFertig = true; ton.quietschenAus(); zeigeBurnoutNote(); }
  }

  function zeigeBurnoutNote() {
    const note = physik.burnoutNote(z.waerme);
    if (note === 'perfekt') { melde('REIFEN PERFEKT', 'gut'); ton.piep('perfekt'); ton.vibriere(50); }
    else if (note === 'kalt' || note === 'lau') melde('REIFEN ZU KALT', 'schlecht');
    else if (note === 'heiss') melde('ETWAS ZU HEISS', 'mittel');
    else if (note === 'verbrannt') melde('REIFEN VERBRANNT', 'schlecht');
  }

  /** Der Daumen rutscht von einer Lenkhälfte in die andere. */
  function beiZug(e) {
    if (!z || z.beendet || lenkZeiger === null) return;
    if (zeigerId(e) !== lenkZeiger) return;
    const rect = z.canvas.getBoundingClientRect();
    const zn = zone((e.clientX !== undefined ? e.clientX : 0) - rect.left);
    const t = tRel();
    if (zn === 'gas') {
      lenkZeiger = null;
      z.eingaben.push({ zeit: t, art: 'lenkAus' });
      return;
    }
    const richtung = zn === 'links' ? -1 : 1;
    if (z.lenkRichtungJetzt === richtung) return;
    z.lenkRichtungJetzt = richtung;
    z.eingaben.push({ zeit: t, art: 'lenkAn', richtung: richtung });
  }

  function haengeTipperAn() {
    const c = z.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', beiRunter);
    window.addEventListener('pointermove', beiZug);
    window.addEventListener('pointerup', beiHoch);
    window.addEventListener('pointercancel', beiHoch);
  }

  function loeseTipper() {
    if (!z) return;
    z.canvas.removeEventListener('pointerdown', beiRunter);
    window.removeEventListener('pointermove', beiZug);
    window.removeEventListener('pointerup', beiHoch);
    window.removeEventListener('pointercancel', beiHoch);
    gasZeiger = null;
    lenkZeiger = null;
  }

  function melde(text, art) {
    if (!z) return;
    z.meldung = { text: text, art: art || 'mittel' };
    z.meldungBis = z.opt.jetzt() + 900;
    if (z.opt.aufMeldung) z.opt.aufMeldung(text, art);
  }

  /* ----------------------------------------------------------------------
     Gegner über das Netz
     ---------------------------------------------------------------------- */

  function setzeGegner(d) {
    if (!z || !d) return;
    z.fern = d;
    if (d.fertig || d.aus) z.fernFertig = true;
  }

  /** Wo steht der Gegner gerade? Gibt {s, versatz, fertig} oder null. */
  function gegnerStand(t) {
    if (z.gegnerSpur) {
      const p = bot.ausSpur(z.gegnerSpur, t);
      if (!p) return null;
      return { s: z.gegnerLauf.aus ? p.s : p.s, versatz: p.versatz, aus: z.gegnerLauf.aus && t >= z.gegnerLauf.t, fertig: t >= z.gegnerLauf.t };
    }
    if (!z.fern) return null;
    /* Zwischen zwei Meldungen wird mit dem letzten Tempo weitergerechnet —
       sonst ruckelt das gegnerische Auto im Sekundentakt vor sich hin. */
    const alter = Math.max(0, Math.min(0.6, t - (z.fern.t || 0)));
    return {
      s: Math.min(physik.STRECKE, (z.fern.s || 0) + (z.fern.v || 0) * alter),
      versatz: z.fern.versatz || 0,
      aus: !!z.fern.aus,
      fertig: !!z.fern.fertig,
    };
  }

  /* ----------------------------------------------------------------------
     Schleife
     ---------------------------------------------------------------------- */

  /**
   * ⚠️ MIT LAUFNUMMER. `cancelAnimationFrame` verhindert nicht, dass ein
   * schon eingereihtes Bild noch losläuft. Ohne die Nummer bediente ein
   * Nachzügler des ALTEN Rennens den Zustand des NEUEN — dann liefen zwei
   * Schleifen auf demselben Wagen und jede Sekunde wurde doppelt gerechnet.
   */
  function bild(meineNummer) {
    if (!z || z.beendet || meineNummer !== z.nummer) return;
    const t = tRel();
    rechne(t);
    /* ⚠️ `rechne` kann das Rennen beenden — und `beende` räumt den Zustand
       ab. Ohne diese zweite Prüfung zeichnete das letzte Bild jedes Rennens
       auf ein `null` und warf einen Fehler aus der Zeichenschleife heraus. */
    if (!z || z.beendet || meineNummer !== z.nummer) return;
    zeichne(t);
    z.raf = requestAnimationFrame(function () { bild(meineNummer); });
  }

  function rechne(t) {
    const o = z.opt;

    /* --- Burnout --- */
    if (!z.burnoutFertig) {
      if (t >= z.plan.burnoutVon && t < z.plan.burnoutBis) {
        if (z.haelt) {
          z.waerme = Math.min(WAERME_MAX, z.waerme + WAERME_TEMPO / 60);
          ton.quietschen(z.waerme);
          ton.motor(0.45 + z.waerme * 0.5, 1);
        } else {
          ton.quietschenAus();
          ton.leerlauf();
        }
      } else if (t >= z.plan.burnoutBis) {
        z.burnoutFertig = true;
        z.haelt = false;
        ton.quietschenAus();
        zeigeBurnoutNote();
      }
    }

    /* --- Der Lauf wird angelegt, sobald die Reifentemperatur feststeht --- */
    if (!z.lauf && (z.burnoutFertig || t >= T_STAGING)) {
      z.burnoutFertig = true;
      z.lauf = physik.neuerLauf(o.auto, o.saat, z.waerme);
    }

    /* --- Ampel --- */
    for (let i = 0; i < T_GELB.length; i++) {
      if (t >= T_GELB[i] && z.gelbGespielt < i) { z.gelbGespielt = i; ton.piep('gelb'); }
    }
    if (t >= 0 && !z.gruenGespielt) { z.gruenGespielt = true; ton.piep('gruen'); ton.vibriere(70); }

    /* --- Fahrt --- */
    if (z.lauf && t > 0) {
      const vorGang = z.lauf.gang;
      const vorNoten = z.lauf.noten.perfekt + z.lauf.noten.gut + z.lauf.noten.zufrueh + z.lauf.noten.ueberdreht;
      const warAus = z.lauf.aus;
      physik.laufeBis(z.lauf, t, z.eingaben);
      const nachNoten = z.lauf.noten.perfekt + z.lauf.noten.gut + z.lauf.noten.zufrueh + z.lauf.noten.ueberdreht;
      if (nachNoten > vorNoten && z.lauf.gang > vorGang) meldeSchaltung();
      if (z.lauf.aus && !warAus) { melde('SPUR VERLASSEN', 'schlecht'); ton.piep('fehler'); ton.vibriere([300, 100, 300]); }
      if (z.lauf.fertig && z.lauf.fahrzeit !== null && !z.zielGemeldet) {
        z.zielGemeldet = true;
        ton.piep('ziel');
        ton.vibriere([90, 60, 90]);
      }
    }

    /* Wer nicht losfährt, hat verloren. */
    if (z.lauf && z.lauf.reaktion === null && t > OHNE_START_BIS) {
      z.nichtGestartet = true;
      z.lauf.aus = true;
      z.lauf.fertig = true;
    }

    /* --- Motorton --- */
    if (z.lauf && z.lauf.gestartet && !z.lauf.fertig) {
      ton.motor(physik.drehzahl(z.lauf), z.lauf.t >= z.lauf.leerlaufBis ? 1 : 0);
    } else if (t > z.plan.burnoutBis && t < 0.2 && z.burnoutFertig) {
      ton.leerlauf();
    } else if (z.lauf && z.lauf.fertig) {
      ton.motorStopp();
    }

    /* --- Standmeldung ans andere Handy --- */
    const jetzt = o.jetzt();
    if (o.aufPosition && z.lauf && t >= 0 && jetzt - z.letztePosition >= POSITION_TAKT) {
      z.letztePosition = jetzt;
      o.aufPosition({
        t: Math.round(z.lauf.t * 1000) / 1000,
        s: Math.round(z.lauf.s * 100) / 100,
        v: Math.round(z.lauf.v * 100) / 100,
        versatz: Math.round(z.lauf.versatz * 1000) / 1000,
        fertig: !!z.lauf.fertig,
        aus: !!z.lauf.aus,
      });
    }

    /* --- Ende --- */
    if (z.lauf && z.lauf.fertig) {
      const seitFertig = t - (z.lauf.zielZeit !== null ? z.lauf.zielZeit : z.lauf.t);
      const gegner = gegnerStand(t);
      const gegnerDurch = !gegner || gegner.fertig || gegner.aus || z.fernFertig;
      if ((gegnerDurch && seitFertig > 0.8) || seitFertig > NACHLAUF) beende();
    }
    if (t > ABBRUCH) beende();
  }

  function meldeSchaltung() {
    const l = z.lauf;
    /* Welche Note gerade dazugekommen ist, steht nicht im Lauf — also die
       zuletzt erhöhte suchen. Dafür merken wir uns den Stand. */
    const n = l.noten;
    const vor = z.notenStand || { perfekt: 0, gut: 0, zufrueh: 0, ueberdreht: 0 };
    let neu = null;
    for (const k in n) if (n[k] > (vor[k] | 0)) neu = k;
    z.notenStand = { perfekt: n.perfekt, gut: n.gut, zufrueh: n.zufrueh, ueberdreht: n.ueberdreht };
    if (neu === 'perfekt') { melde('PERFEKT', 'gut'); ton.piep('perfekt'); ton.vibriere(40); }
    else if (neu === 'gut') melde('GUT', 'mittel');
    else if (neu === 'zufrueh') melde('ZU FRÜH', 'schlecht');
    else if (neu === 'ueberdreht') melde('ÜBERDREHT', 'schlecht');
  }

  function beende() {
    if (!z || z.beendet) return;
    z.beendet = true;
    ton.stoppAlles();
    const l = z.lauf;
    const ergebnis = {
      auto: z.opt.auto.id,
      saat: z.opt.saat,
      reaktion: l && l.reaktion !== null ? Math.round(l.reaktion * 1000) / 1000 : null,
      fehlstart: !!(l && l.fehlstart),
      aus: !!(l && l.aus),
      abgebrochen: !!z.abgebrochen,
      nichtGestartet: !!z.nichtGestartet,
      fahrzeit: l && l.fahrzeit !== null ? Math.round(l.fahrzeit * 1000) / 1000 : null,
      gesamt: l && l.zielZeit !== null && !l.aus && !l.fehlstart ? Math.round(l.zielZeit * 1000) / 1000 : null,
      noten: l ? { perfekt: l.noten.perfekt, gut: l.noten.gut, zufrueh: l.noten.zufrueh, ueberdreht: l.noten.ueberdreht } : null,
      waerme: z.waerme === null ? null : Math.round(z.waerme * 1000) / 1000,
      burnout: physik.burnoutNote(z.waerme),
      spurVerlust: l ? Math.round(l.spurVerlust * 100) / 100 : 0,
      spitze: l ? Math.round(l.v * 3.6) : 0,
    };
    const gegnerErgebnis = z.gegnerLauf ? {
      auto: z.opt.auto.id,
      reaktion: Math.round(z.gegnerLauf.reaktion * 1000) / 1000,
      fehlstart: !!z.gegnerLauf.fehlstart,
      aus: !!z.gegnerLauf.aus,
      fahrzeit: z.gegnerLauf.fahrzeit !== null ? Math.round(z.gegnerLauf.fahrzeit * 1000) / 1000 : null,
      gesamt: z.gegnerLauf.zielZeit !== null && !z.gegnerLauf.aus && !z.gegnerLauf.fehlstart ? Math.round(z.gegnerLauf.zielZeit * 1000) / 1000 : null,
      noten: z.gegnerLauf.noten,
      waerme: z.gegnerLauf.waerme,
      burnout: physik.burnoutNote(z.gegnerLauf.waerme),
      spurVerlust: Math.round(z.gegnerLauf.spurVerlust * 100) / 100,
      spitze: Math.round(z.gegnerLauf.v * 3.6),
    } : null;
    const fertig = z.opt.fertig;
    stopp();
    if (fertig) fertig(ergebnis, gegnerErgebnis);
  }

  /* ----------------------------------------------------------------------
     Zeichnen
     ---------------------------------------------------------------------- */

  function passeGroesseAn() {
    if (!z) return;
    const c = z.canvas;
    const b = c.clientWidth || 320;
    const h = c.clientHeight || 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(b * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(b * dpr);
      c.height = Math.round(h * dpr);
    }
    z.dpr = dpr;
    z.breite = b;
    z.hoehe = h;
  }

  const FARBEN = {
    himmelOben: '#101528',
    himmelUnten: '#4a3157',
    sonne: '#f5a524',
    gras1: '#1c2b1e',
    gras2: '#182618',
    asphalt1: '#2e2f33',
    asphalt2: '#292a2e',
    linie: '#e8e2d8',
    mittellinie: '#8d8578',
    text: '#f3ede4',
    leise: '#b3a89b',
    gut: '#6cc070',
    schlecht: '#e0533f',
    akzent: '#f5a524',
  };

  function zeichne(t) {
    const g = z.ctx;
    const b = z.breite, h = z.hoehe;
    g.setTransform(z.dpr, 0, 0, z.dpr, 0, 0);
    g.clearRect(0, 0, b, h);

    const horizont = h * 0.30;
    const boden = h * 1.02;
    const mitte = b / 2;
    /* ⚠️ Straßenhalbbreite ganz vorn. Der erste Entwurf stand auf 0.88 —
       damit lagen die beiden Bahnen bei u = ±0.5 fast am Bildschirmrand und
       die Autos klebten links und rechts außen statt nebeneinander auf einer
       Bahn. 0.60 setzt sie in vernünftigen Abstand zueinander. */
    const halb = b * 0.60;
    const meineS = z.lauf ? z.lauf.s : 0;

    zeichneHimmel(g, b, h, horizont);
    zeichneStrecke(g, b, h, horizont, boden, mitte, halb, meineS);

    /* Autos: das weiter entfernte zuerst, damit es hinten liegt. */
    const gegner = gegnerStand(t);
    const meinU = -0.5 + (z.lauf ? z.lauf.versatz : 0) * 0.44;
    const meinD = KAMERA_ABSTAND;
    const wagen = [{ d: meinD, u: meinU, lack: z.opt.meinLack, name: null, aus: z.lauf && z.lauf.aus }];
    if (gegner) {
      wagen.push({
        d: KAMERA_ABSTAND + (gegner.s - meineS),
        u: 0.5 + (gegner.versatz || 0) * 0.44,
        lack: z.opt.gegnerLack,
        name: z.opt.gegnerName,
        aus: gegner.aus,
      });
    }
    wagen.sort(function (x, y) { return y.d - x.d; });
    for (const wa of wagen) zeichneAuto(g, horizont, boden, mitte, halb, wa);

    zeichneKopfleiste(g, b, meineS, gegner);
    if (z.lauf && z.lauf.gestartet && !z.lauf.fertig) {
      zeichneTacho(g, b, h);
      zeichneSpurbalken(g, b, h);
      zeichneWarnung(g, b, h, t);
      /* Liegt der Gegner hinter der Kamera, sieht man ihn nicht mehr. */
      if (gegner && Math.abs(gegner.s - meineS) > 2) zeichneGegnerHinweis(g, b, h, gegner.s - meineS);
    }
    if (t < T_STAGING && (!z.plan.burnoutVon || t < z.plan.burnoutVon)) zeichneVorstellung(g, b, h, t);
    if (t < 0) zeichneAmpel(g, b, h, t);
    if (!z.burnoutFertig && t >= z.plan.burnoutVon && t < z.plan.burnoutBis) zeichneBurnout(g, b, h, t);
    zeichneZonen(g, b, h, t);
    zeichneMeldung(g, b, h);
    zeichneUhr(g, b, h, t);
  }

  function zeichneHimmel(g, b, h, horizont) {
    const grad = g.createLinearGradient(0, 0, 0, horizont);
    grad.addColorStop(0, FARBEN.himmelOben);
    grad.addColorStop(1, FARBEN.himmelUnten);
    g.fillStyle = grad;
    g.fillRect(0, 0, b, horizont);
    /* Abendsonne knapp über dem Horizont — dezent, sie ist Kulisse und darf
       den Blick nicht von der Ampel wegziehen. */
    const sonne = g.createLinearGradient(0, horizont - Math.min(b, h) * 0.18, 0, horizont);
    sonne.addColorStop(0, 'rgba(245,165,36,0.04)');
    sonne.addColorStop(1, 'rgba(245,165,36,0.22)');
    g.fillStyle = sonne;
    g.beginPath();
    g.arc(b * 0.5, horizont, Math.min(b, h) * 0.18, Math.PI, 0);
    g.fill();
  }

  /**
   * Die Strecke wird zeilenweise gemalt: für jede Bildzeile wird
   * zurückgerechnet, wie weit sie entfernt ist. Das ist der einfachste Weg
   * zu einer perspektivischen Fahrbahn — und die wechselnden Farbstreifen
   * geben ganz nebenbei das Tempogefühl.
   */
  function zeichneStrecke(g, b, h, horizont, boden, mitte, halb, s) {
    const schritt = 3;
    let weltVorher = null;
    for (let y = horizont; y < boden; y += schritt) {
      const k = (y - horizont) / (boden - horizont);
      if (k <= 0.002) continue;
      const d = TIEFE * (1 - k) / k;
      const bb = halb * k;
      const welt = s + d;
      const hell = Math.floor(welt / STREIFEN) % 2 === 0;

      g.fillStyle = hell ? FARBEN.gras1 : FARBEN.gras2;
      g.fillRect(0, y, b, schritt + 1);
      g.fillStyle = hell ? FARBEN.asphalt1 : FARBEN.asphalt2;
      g.fillRect(mitte - bb, y, bb * 2, schritt + 1);

      /* Streckenmarken alle 50 m, damit man sieht, wie weit es noch ist.
         ⚠️ Verglichen wird mit der VORIGEN Bildzeile. Der erste Entwurf
         rechnete `welt + schritt` — `schritt` sind aber Bildpunkte, keine
         Meter. Ganz vorn liegen zwei Zeilen nur Zentimeter auseinander, und
         die Bedingung traf dutzende Zeilen hintereinander zu: die Marken
         stapelten sich am unteren Rand zu gelben Treppen. */
      /* ⚠️ Und nur, solange eine Bildzeile weniger als eine Marke weit
         reicht. Nahe am Horizont überspringt eine einzige Zeile hundert
         Meter — dann trifft die Bedingung auf JEDE Zeile zu und der
         Fahrbahnrand wird zur gelben Perlenkette. */
      if (weltVorher !== null && d > 3 && d < 220 &&
          welt - weltVorher < MARKE_ALLE * 0.8 &&
          Math.floor(welt / MARKE_ALLE) !== Math.floor(weltVorher / MARKE_ALLE)) {
        g.fillStyle = FARBEN.akzent;
        const dick = Math.max(2, schritt * 1.6);
        g.fillRect(mitte - bb * 1.12, y, Math.max(2, bb * 0.09), dick);
        g.fillRect(mitte + bb * 1.03, y, Math.max(2, bb * 0.09), dick);
      }
      weltVorher = welt;
    }

    /* ⚠️ Die Linien werden NICHT zeilenweise gemalt. Der erste Entwurf setzte
       je Bildzeile ein 1 px breites Kästchen — weit hinten rückt die Straße
       je Zeile um mehrere Pixel enger, und die Kästchen berührten sich nicht
       mehr. Die Fahrbahnbegrenzung sah aus wie eine gepunktete Linie. Als
       durchgehender Streckenzug stimmt es. */
    zeichneLinie(g, horizont, boden, mitte, halb, -1, FARBEN.linie, false, s);
    zeichneLinie(g, horizont, boden, mitte, halb, 1, FARBEN.linie, false, s);
    zeichneLinie(g, horizont, boden, mitte, halb, 0, FARBEN.mittellinie, true, s);

    /* Die Ziellinie */
    const dZiel = physik.STRECKE - s;
    if (dZiel > -2 && dZiel < 160) {
      const k = TIEFE / (TIEFE + Math.max(dZiel, -1.9));
      const y = horizont + (boden - horizont) * k;
      const bb = halb * k;
      const hoehe = Math.max(3, 26 * k);
      const kaestchen = 10;
      for (let i = 0; i < kaestchen; i++) {
        g.fillStyle = i % 2 === 0 ? '#f3ede4' : '#1a1a1a';
        g.fillRect(mitte - bb + (i * 2 * bb) / kaestchen, y - hoehe / 2, (2 * bb) / kaestchen + 1, hoehe);
      }
    }
  }

  /**
   * Eine Fahrbahnlinie als durchgehender Streifen. `u` ist die Querlage
   * (-1 = linker Rand, 0 = Mitte, 1 = rechter Rand). `gestrichelt` malt sie
   * in 6-Meter-Stücken.
   */
  function zeichneLinie(g, horizont, boden, mitte, halb, u, farbe, gestrichelt, s) {
    const punkte = [];
    /* Gleichmäßig über den Bildschirm abtasten, nicht über die Entfernung —
       dann sitzen die Stützstellen dort, wo es aufs Auge ankommt. */
    for (let i = 0; i <= 40; i++) {
      const k = 0.02 + (1 - 0.02) * (i / 40);
      const d = TIEFE * (1 - k) / k;
      punkte.push({
        y: horizont + (boden - horizont) * k,
        x: mitte + u * halb * k,
        w: Math.max(0.8, halb * k * 0.016),
        welt: s + d,
      });
    }
    g.fillStyle = farbe;
    for (let i = 0; i < punkte.length - 1; i++) {
      const a = punkte[i], c = punkte[i + 1];
      if (gestrichelt && Math.floor(a.welt / 6) % 2 !== 0) continue;
      g.beginPath();
      g.moveTo(a.x - a.w, a.y);
      g.lineTo(a.x + a.w, a.y);
      g.lineTo(c.x + c.w, c.y);
      g.lineTo(c.x - c.w, c.y);
      g.closePath();
      g.fill();
    }
  }

  function zeichneAuto(g, horizont, boden, mitte, halb, wa) {
    /* ⚠️ Wer weiter als sechs Meter zurückliegt, wird NICHT mehr gezeichnet.
       Vorher wurde der Abstand auf -7,5 m geklemmt: ein Gegner dreißig Meter
       hinter einem stand trotzdem riesig am unteren Bildrand, als klebte er
       an der Stoßstange. Wie weit er zurückliegt, sagt jetzt der Hinweis
       oben rechts. */
    if (wa.d < -6) return;
    const d = Math.max(-6, wa.d);
    const k = TIEFE / (TIEFE + d);
    if (k <= 0.02 || k > 8) return;
    const y = horizont + (boden - horizont) * k;
    const x = mitte + wa.u * halb * k;
    const breite = halb * 0.30 * k;
    const hoehe = breite * 0.60;
    const lack = autos.lack(wa.lack);

    g.save();
    g.globalAlpha = wa.aus ? 0.45 : 1;

    /* Schatten */
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath();
    g.ellipse(x, y + hoehe * 0.06, breite * 0.56, hoehe * 0.13, 0, 0, Math.PI * 2);
    g.fill();

    /* Räder */
    g.fillStyle = '#15130f';
    g.fillRect(x - breite * 0.54, y - hoehe * 0.42, breite * 0.16, hoehe * 0.46);
    g.fillRect(x + breite * 0.38, y - hoehe * 0.42, breite * 0.16, hoehe * 0.46);

    /* Karosserie */
    g.fillStyle = lack.farbe;
    rundesRechteck(g, x - breite * 0.46, y - hoehe * 0.92, breite * 0.92, hoehe * 0.92, breite * 0.10);
    g.fill();
    g.fillStyle = lack.dunkel;
    g.fillRect(x - breite * 0.46, y - hoehe * 0.22, breite * 0.92, hoehe * 0.16);

    /* Heckscheibe */
    g.fillStyle = 'rgba(12,16,24,0.85)';
    rundesRechteck(g, x - breite * 0.33, y - hoehe * 0.84, breite * 0.66, hoehe * 0.38, breite * 0.06);
    g.fill();

    /* Rückleuchten */
    g.fillStyle = '#ff4d3a';
    g.fillRect(x - breite * 0.42, y - hoehe * 0.40, breite * 0.20, hoehe * 0.12);
    g.fillRect(x + breite * 0.22, y - hoehe * 0.40, breite * 0.20, hoehe * 0.12);

    /* Heckflügel */
    g.fillStyle = lack.dunkel;
    g.fillRect(x - breite * 0.50, y - hoehe * 1.02, breite * 1.00, hoehe * 0.10);

    g.restore();

    if (wa.name && k > 0.08) {
      g.font = '600 ' + Math.max(11, Math.min(20, 22 * k)) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const tb = g.measureText(wa.name).width;
      rundesRechteck(g, x - tb / 2 - 6, y - hoehe * 1.42, tb + 12, 20, 6);
      g.fill();
      g.fillStyle = FARBEN.text;
      g.fillText(wa.name, x, y - hoehe * 1.42 + 14);
      g.textAlign = 'left';
    }
  }

  function rundesRechteck(g, x, y, b, h, r) {
    const rr = Math.max(0, Math.min(r, b / 2, h / 2));
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + b - rr, y);
    g.quadraticCurveTo(x + b, y, x + b, y + rr);
    g.lineTo(x + b, y + h - rr);
    g.quadraticCurveTo(x + b, y + h, x + b - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  /** Beide Bahnen von oben — auf einen Blick, wer vorn liegt. */
  function zeichneKopfleiste(g, b, meineS, gegner) {
    const x0 = b * 0.06, x1 = b * 0.94, y = 12, abstand = 9;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    rundesRechteck(g, x0 - 8, y - 7, x1 - x0 + 16, abstand + 16, 8);
    g.fill();

    for (let i = 0; i < 2; i++) {
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fillRect(x0, y + i * abstand, x1 - x0, 3);
    }
    const punkt = function (anteil, reihe, farbe) {
      const x = x0 + (x1 - x0) * Math.max(0, Math.min(1, anteil));
      g.fillStyle = farbe;
      g.beginPath();
      g.arc(x, y + reihe * abstand + 1.5, 4.5, 0, Math.PI * 2);
      g.fill();
    };
    if (gegner) punkt(gegner.s / physik.STRECKE, 1, autos.lack(z.opt.gegnerLack).farbe);
    punkt(meineS / physik.STRECKE, 0, autos.lack(z.opt.meinLack).farbe);

    const rest = Math.max(0, Math.round(physik.STRECKE - meineS));
    g.font = '600 12px ui-monospace, Menlo, monospace';
    g.fillStyle = FARBEN.leise;
    g.textAlign = 'right';
    g.fillText(rest + ' m', x1, y + abstand + 22);
    g.textAlign = 'left';
  }

  function zeichneTacho(g, b, h) {
    const l = z.lauf;
    const r = physik.drehzahl(l);
    /* ⚠️ Weit genug von der Ecke weg: mit rad 46 bei (b-62, h-58) hing der
       Ring halb außerhalb des Bildes. */
    const rad = Math.min(46, h * 0.14);
    const cx = b - rad - 26, cy = h - rad - 24;
    const von = Math.PI * 0.75, bis = Math.PI * 2.25;
    const f = physik.fenster(l.auto, l.gang);

    g.save();
    g.lineCap = 'butt';

    /* Dunkle Scheibe darunter, damit der Ring auch über heller Fahrbahn steht */
    g.fillStyle = 'rgba(8,7,6,0.62)';
    g.beginPath(); g.arc(cx, cy, rad + 9, 0, Math.PI * 2); g.fill();

    /* Grundring */
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 13;
    g.beginPath(); g.arc(cx, cy, rad, von, bis); g.stroke();

    /* Grünes Fenster */
    g.strokeStyle = FARBEN.gut;
    g.lineWidth = 13;
    g.beginPath(); g.arc(cx, cy, rad, von + (bis - von) * f.von, von + (bis - von) * 1.0); g.stroke();

    /* Roter Bereich */
    g.strokeStyle = FARBEN.schlecht;
    g.beginPath(); g.arc(cx, cy, rad, von + (bis - von) * 1.0, bis); g.stroke();

    /* Nadel */
    const w = von + (bis - von) * Math.max(0, Math.min(1.14, r));
    g.strokeStyle = r > 1 ? FARBEN.schlecht : FARBEN.text;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(w) * (rad - 4), cy + Math.sin(w) * (rad - 4));
    g.stroke();

    /* Gang */
    g.fillStyle = FARBEN.text;
    g.font = '800 26px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(l.gang + 1), cx, cy + 9);
    g.font = '600 11px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.fillStyle = FARBEN.leise;
    g.fillText('von ' + l.auto.gaenge.length, cx, cy + 26);
    g.textAlign = 'left';
    g.restore();
  }

  /** Der Pfeil, der kurz vor einem Ausbrecher blinkt. */
  function zeichneWarnung(g, b, h, t) {
    const l = z.lauf;
    let richtung = 0, dringend = 0;
    for (const zg of l.zuege) {
      if (l.t >= zg.zeit - physik.WARNUNG && l.t < zg.zeit) { richtung = zg.richtung; dringend = 1; }
      else if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER) { richtung = zg.richtung; dringend = 2; }
    }
    /* Auch ohne aktiven Zug: wer schief steht, soll es sehen. */
    if (!richtung && Math.abs(l.versatz) > 0.18) { richtung = l.versatz > 0 ? 1 : -1; dringend = 2; }
    if (!richtung) return;

    /* Gegenlenken heißt: in die ANDERE Richtung tippen. */
    const zeigt = -richtung;

    /* ⚠️ Der Pfeil sitzt ÜBER DER FLÄCHE, die gedrückt werden soll — nicht
       mittig im Bild. Beide Lenkflächen liegen links (0 bis 22,5 % und 22,5
       bis 45 % der Breite); ein Pfeil in der Bildmitte, der nach rechts
       zeigt, schickte den Daumen auf die Gasfläche. */
    const x = zeigt < 0 ? b * 0.1125 : b * 0.3375;
    const y = h * 0.50;
    const gr = Math.min(b * 0.085, h * 0.13);
    const blink = dringend === 1 ? (Math.floor(t * 8) % 2 === 0 ? 1 : 0.3) : 1;

    g.save();
    g.globalAlpha = blink * (dringend === 2 ? 0.95 : 0.75);
    /* Heller Schein, damit die Fläche selbst als Ziel lesbar wird */
    g.fillStyle = dringend === 2 ? 'rgba(224,83,63,0.16)' : 'rgba(245,165,36,0.12)';
    g.fillRect(zeigt < 0 ? 0 : b * 0.225, h * 0.38, b * 0.225, h * 0.62);
    g.fillStyle = dringend === 2 ? FARBEN.schlecht : FARBEN.akzent;
    g.beginPath();
    g.moveTo(x + zeigt * gr, y);
    g.lineTo(x - zeigt * gr * 0.45, y - gr * 0.8);
    g.lineTo(x - zeigt * gr * 0.45, y + gr * 0.8);
    g.closePath();
    g.fill();
    g.restore();

  }

  /**
   * Spurbalken ganz oben: wie nah man an der Linie ist.
   * ⚠️ Nicht mitten aufs Bild. Dort lag er quer über der Fahrbahn und
   * verdeckte genau die Stelle, auf die man beim Lenken schaut.
   */
  function zeichneSpurbalken(g, b, h) {
    const l = z.lauf;
    const bw = b * 0.26, bx = b / 2 - bw / 2, by = 44, bh = 7;
    g.fillStyle = 'rgba(8,7,6,0.55)';
    rundesRechteck(g, bx - 4, by - 4, bw + 8, bh + 8, 6); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.14)';
    rundesRechteck(g, bx, by, bw, bh, 3); g.fill();
    /* Die Linien links und rechts, die man nicht berühren darf */
    g.fillStyle = FARBEN.schlecht;
    g.fillRect(bx, by, 2, bh);
    g.fillRect(bx + bw - 2, by, 2, bh);
    const pos = bx + bw / 2 + (Math.max(-1, Math.min(1, l.versatz)) * bw) / 2;
    g.fillStyle = Math.abs(l.versatz) > 0.7 ? FARBEN.schlecht : FARBEN.akzent;
    g.beginPath(); g.arc(pos, by + bh / 2, 6.5, 0, Math.PI * 2); g.fill();
  }

  /** Kleiner Hinweis, wenn der Gegner hinter einem liegt und nicht im Bild ist. */
  function zeichneGegnerHinweis(g, b, h, abstand) {
    const text = Math.round(Math.abs(abstand)) + ' m ' + (abstand < 0 ? 'zurück' : 'voraus');
    g.font = '700 13px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    const x = b * 0.88, y = 78;
    const tb = g.measureText(text).width;
    g.fillStyle = 'rgba(8,7,6,0.6)';
    rundesRechteck(g, x - tb / 2 - 10, y - 15, tb + 20, 22, 8); g.fill();
    g.fillStyle = autos.lack(z.opt.gegnerLack).farbe;
    g.fillText(text, x, y);
    g.textAlign = 'left';
  }

  function zeichneAmpel(g, b, h, t) {
    const cx = b / 2, oben = h * 0.13;
    const r = Math.min(b, h) * 0.035;
    const abstand = r * 2.6;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    rundesRechteck(g, cx - r * 1.7, oben - r * 1.6, r * 3.4, abstand * 3 + r * 3.2, r * 0.8);
    g.fill();
    for (let i = 0; i < 3; i++) {
      const an = t >= T_GELB[i];
      g.fillStyle = an ? '#f5a524' : 'rgba(245,165,36,0.16)';
      g.beginPath(); g.arc(cx, oben + i * abstand, r, 0, Math.PI * 2); g.fill();
    }
    const gruenAn = t >= 0;
    g.fillStyle = gruenAn ? '#4ade5f' : 'rgba(74,222,95,0.14)';
    g.beginPath(); g.arc(cx, oben + 3 * abstand, r, 0, Math.PI * 2); g.fill();
    g.restore();

  }

  /**
   * Die Vorstellung liegt als Schleier ÜBER dem ganzen Bild.
   * ⚠️ Erst stand der Text frei zwischen Ampel und Autos — dort ist auf einem
   * quer gehaltenen Handy schlicht kein Platz, er lag auf den Motorhauben.
   * Ein Schleier über allem hat immer Platz und verschwindet beim Anrollen.
   */
  function zeichneVorstellung(g, b, h, t) {
    const rest = T_STAGING - t;
    g.save();
    g.fillStyle = 'rgba(10,9,8,0.72)';
    g.fillRect(0, 0, b, h);
    g.textAlign = 'center';

    g.fillStyle = FARBEN.leise;
    g.font = '600 14px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.fillText('Gleich geht es los', b / 2, h * 0.26);

    g.fillStyle = FARBEN.text;
    g.font = '800 ' + Math.round(Math.min(30, b * 0.045)) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.fillText(z.opt.meinName + '  gegen  ' + z.opt.gegnerName, b / 2, h * 0.42);

    g.fillStyle = FARBEN.akzent;
    g.font = '700 18px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.fillText(z.opt.auto.icon + '  ' + z.opt.auto.name, b / 2, h * 0.56);

    g.fillStyle = FARBEN.leise;
    g.font = '500 14px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.fillText(z.opt.auto.gaenge.length + ' Gänge · ' + z.opt.auto.kurz, b / 2, h * 0.68);

    if (rest > 0) {
      g.fillStyle = FARBEN.text;
      g.font = '700 15px ui-monospace, Menlo, monospace';
      g.fillText(rest.toFixed(1) + ' s', b / 2, h * 0.85);
    }
    g.textAlign = 'left';
    g.restore();
  }

  function zeichneBurnout(g, b, h, t) {
    const bx = b * 0.30, bw = b * 0.40, by = h * 0.60, bh = 22;
    const anteil = Math.max(0, Math.min(1, z.waerme / WAERME_MAX));
    const gruenVon = 0.75 / WAERME_MAX, gruenBis = 1.0 / WAERME_MAX;

    g.fillStyle = 'rgba(0,0,0,0.55)';
    rundesRechteck(g, bx - 4, by - 4, bw + 8, bh + 8, 8); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.10)';
    rundesRechteck(g, bx, by, bw, bh, 5); g.fill();
    g.fillStyle = 'rgba(108,192,112,0.55)';
    g.fillRect(bx + bw * gruenVon, by, bw * (gruenBis - gruenVon), bh);
    g.fillStyle = z.waerme > 1.0 ? FARBEN.schlecht : FARBEN.akzent;
    rundesRechteck(g, bx, by, bw * anteil, bh, 5); g.fill();

    g.fillStyle = FARBEN.text;
    g.font = '700 16px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    g.fillText(z.haelt ? 'im Grünen loslassen' : 'rechts halten: Reifen aufwärmen', b / 2, by - 14);
    g.textAlign = 'left';
  }

  /** Ganz dezent: wo ist links, wo ist rechts, wo ist Gas. */
  function zeichneZonen(g, b, h, t) {
    const zeigen = t < 0.6;
    g.save();
    g.globalAlpha = zeigen ? 0.30 : 0.10;
    g.strokeStyle = FARBEN.leise;
    g.lineWidth = 1;
    g.setLineDash([5, 6]);
    g.beginPath();
    g.moveTo(b * 0.225, h * 0.42); g.lineTo(b * 0.225, h);
    g.moveTo(b * 0.45, h * 0.42); g.lineTo(b * 0.45, h);
    g.stroke();
    g.setLineDash([]);
    if (zeigen) {
      g.globalAlpha = 0.55;
      g.fillStyle = FARBEN.leise;
      g.font = '700 13px -apple-system, "Segoe UI", Roboto, sans-serif';
      g.textAlign = 'center';
      g.fillText('◀ LINKS', b * 0.11, h - 28);
      g.fillText('RECHTS ▶', b * 0.34, h - 28);
      g.fillText(z.lauf && z.lauf.gestartet ? 'SCHALTEN' : 'GAS', b * 0.72, h - 28);
      /* Der wichtigste Satz des ganzen Spiels — deshalb steht er im Bild. */
      g.font = '600 11px -apple-system, "Segoe UI", Roboto, sans-serif';
      g.fillText('gedrückt halten', b * 0.225, h - 12);
      g.fillText('tippen', b * 0.72, h - 12);
      g.textAlign = 'left';
    }
    g.restore();
  }

  function zeichneMeldung(g, b, h) {
    if (!z.meldung || z.opt.jetzt() > z.meldungBis) return;
    const farbe = z.meldung.art === 'gut' ? FARBEN.gut : z.meldung.art === 'schlecht' ? FARBEN.schlecht : FARBEN.akzent;
    g.font = '800 30px -apple-system, "Segoe UI", Roboto, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.45)';
    const tb = g.measureText(z.meldung.text).width;
    rundesRechteck(g, b / 2 - tb / 2 - 14, h * 0.36 - 30, tb + 28, 44, 10);
    g.fill();
    g.fillStyle = farbe;
    g.fillText(z.meldung.text, b / 2, h * 0.36);
    g.textAlign = 'left';
  }

  function zeichneUhr(g, b, h, t) {
    let text;
    if (t < 0) text = t > -3 ? (-t).toFixed(1) : '';
    else if (z.lauf && z.lauf.zielZeit !== null) text = z.lauf.zielZeit.toFixed(3);
    else text = t.toFixed(2);
    if (!text) return;
    /* ⚠️ Links, nicht mittig. In der Mitte steht die Ampelsäule — dort lag
       die Uhr genau auf dem obersten gelben Licht. */
    g.font = '700 20px ui-monospace, Menlo, monospace';
    g.textAlign = 'left';
    const tb = g.measureText(text).width;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    rundesRechteck(g, b * 0.05, 40, tb + 16, 26, 6);
    g.fill();
    g.fillStyle = z.lauf && z.lauf.zielZeit !== null ? FARBEN.gut : FARBEN.text;
    g.fillText(text, b * 0.05 + 8, 59);
  }

  return {
    PLAN: PLAN,
    T_STAGING: T_STAGING,
    NACHLAUF: NACHLAUF,
    ABBRUCH: ABBRUCH,
    /** Wie lange der Vorlauf vor Grün dauert (ms) — der Gastgeber braucht das. */
    vorlaufMs: function (mitBurnout) { return Math.round(-(mitBurnout ? PLAN.mitBurnout.anfang : PLAN.ohneBurnout.anfang) * 1000); },
    starte: starte,
    stopp: stopp,
    laeuft: laeuft,
    setzeGegner: setzeGegner,
    /* Nur zum Nachmessen von außen (Konsole, Prüflauf): der laufende Wagen,
       die Ausbrecher und die Uhr. Wird vom Spiel selbst nicht benutzt. */
    stand: function () { return z ? { lauf: z.lauf, t: tRel(), waerme: z.waerme, phase: z.phase, plan: z.plan } : null; },
  };
})();
