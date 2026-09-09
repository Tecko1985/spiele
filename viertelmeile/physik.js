/* ==========================================================================
   Viertelmeile — Rechenkern
   ==========================================================================
   Die reine Fahrphysik. Kein Canvas, kein Firebase, kein DOM — damit sie
   in Node gegengerechnet werden kann (siehe pflege/pruefe-fahrt.js).

   ⚠️ FESTER RECHENTAKT. Gerechnet wird immer in Schritten von 1/120 s,
   egal wie oft das Gerät zeichnet. Ein langsames Handy zeichnet seltener,
   rechnet aber dieselbe Fahrt — sonst hätte das schnellere Gerät einen
   Vorteil, und genau das darf ein Turnier nicht haben.

   ⚠️ ALLES AUS DER SAAT. Wo das Auto zieht und wie stark, kommt aus einer
   Zahl, die der Gastgeber für das Rennen würfelt und beiden Fahrern
   schickt. Beide bekommen also dieselben Ausbrecher zur selben Zeit.
   ========================================================================== */

const physik = (function () {
  'use strict';

  const STRECKE = 402.34;       // Viertelmeile in Metern
  const SCHRITT = 1 / 120;      // fester Rechentakt in Sekunden
  const LUFT = 0.00055;         // Luftwiderstand (a = LUFT * v^2 * auto.luft)
  const SCHALT_LEER = 0.16;     // Sekunden ohne Vortrieb beim Gangwechsel
  const SCHUB = 0.8;            // m/s Extra für einen perfekten Treffer

  /* ----------------------------------------------------------------------
     Seitliches Ausbrechen
     ----------------------------------------------------------------------
     ⚠️ HIER WIRD TEMPO GESETZT, NICHT KRAFT. Der erste Entwurf beschleunigte
     die Seitwärtsbewegung (Kraft, Dämpfung, Rückstellung — ein Feder-Masse-
     System). Das fühlt sich beim Fahren wie ein Fehler an: hält man dagegen,
     dauert es, bis überhaupt etwas passiert, und dann schießt das Auto über
     die Mitte hinaus und man muss auf die andere Seite. Gemessen kam ein
     Fahrer, der nach einer halben Sekunde gegenhält, in vier von zehn Fällen
     trotzdem über die Linie — und zwar UNABHÄNGIG davon, wie stark man das
     Lenken machte: mehr Kraft hieß nur mehr Übersteuern.

     Jetzt bestimmen Zug und Lenken direkt, wie schnell das Auto zur Seite
     wandert. Halten bringt es sofort zurück, Loslassen stoppt es sofort. Kein
     Nachschwingen, kein Gegenpendeln — und man kann sich ausrechnen, was
     passiert, während man es tut. `ANSPRECH` glättet nur die Optik.
     ---------------------------------------------------------------------- */
  const ZUG_TEMPO = 0.70;       // Bahnbreiten je Sekunde, wenn es zieht
  const LENK_TEMPO = 1.05;      // Bahnbreiten je Sekunde beim Gegenhalten
  const RUECK_TEMPO = 0.10;     // sanftes Zurückwandern zur Mitte
  const ANSPRECH = 0.12;        // Sekunden, bis das Auto der Vorgabe folgt
  const SCHLEIFEN = 30;         // Tempoverlust beim Schleifen (quadratisch)
  const SCHLEIF_AB = 0.10;      // darunter kostet ein Wackeln nichts
  /* ⚠️ GELENKT WIRD DURCH HALTEN, NICHT DURCH TIPPEN.
     Der erste Entwurf ließ einen Tipper 0,30 s wirken — ein Ausbrecher dauert
     aber 1,25 s. Man musste also fünfmal hintereinander auf ein schmales Feld
     hämmern, während gleichzeitig der Tacho im Blick bleiben soll. Michels
     Urteil nach dem ersten Fahren: „das Auto in der Spur halten ist
     unmöglich". Der Prüf-Fahrer hatte es nicht gemerkt, weil er achtmal je
     Ausbrecher tippte — was kein Daumen tut.
     Jetzt wirkt das Lenkfeld, SOLANGE der Finger daraufliegt. `MIN_LENK` ist
     nur die Untergrenze, damit ein kurzer Tipper nicht wirkungslos bleibt. */
  const MIN_LENK = 0.20;        // so lange wirkt auch der kürzeste Tipper
  /* ⚠️ LANG UND SANFT, NICHT KURZ UND BRUTAL. Erst dauerte ein Ausbrecher
     1,25 s und war so stark, dass er in dieser Zeit bis über die Linie reichte.
     Damit war jede Zehntelsekunde Verzug tödlich: wer erst nach einer halben
     Sekunde griff, stand schon bei 0,6 und kippte beim kleinsten Nachfassen
     hinaus. Jetzt zieht es fast doppelt so lang, dafür halb so schnell — wer
     gar nichts tut, landet genauso an der Linie, aber man hat Zeit, in Ruhe
     dagegenzuhalten. Genau das ist der Unterschied zwischen "zackig" und
     "unmöglich". */
  const ZUG_DAUER = 1.80;       // wie lange ein Ausbrecher dauert
  const WARNUNG = 0.90;         // so früh blinkt der Pfeil

  /* ----------------------------------------------------------------------
     Zufall mit Saat — beide Geräte müssen dasselbe würfeln
     ---------------------------------------------------------------------- */

  function saatZufall(saat) {
    let z = (saat >>> 0) || 2463534242;
    return function () {
      z ^= z << 13; z >>>= 0;
      z ^= z >>> 17;
      z ^= z << 5; z >>>= 0;
      return z / 4294967296;
    };
  }

  /**
   * Die Ausbrecher einer Fahrt. Zeitpunkte in Sekunden nach Grün.
   * Gleiche Saat = gleiche Liste, auf beiden Handys.
   */
  function ausbrecher(saat, auto) {
    const w = saatZufall(saat);
    /* ⚠️ WIE OFT es zieht, hängt am Auto — WIE STARK nicht.
       Erster Entwurf hatte es andersherum: das Muscle-Car zog stärker, der
       Flitzer schwächer. Damit war das Versprechen „wer gar nicht gegenhält,
       fliegt raus" beim Flitzer schlicht falsch — ein schwacher Zug lief aus,
       ohne die Linie zu erreichen. Jetzt reicht JEDER ignorierte Zug bis über
       die Linie, und die Autos unterscheiden sich in der Anzahl. */
    const vonBis = (auto && auto.zuege) || [2, 4];
    const anzahl = vonBis[0] + Math.floor(w() * (vonBis[1] - vonBis[0] + 1));
    const liste = [];

    /* Ein Fach je Ausbrecher, gewürfelt wird nur innerhalb des Fachs.
       ⚠️ Der Spielraum ist um ZUG_DAUER gekürzt: ohne das konnten zwei
       Ausbrecher überlappen, und zwei gleichzeitige Züge in dieselbe
       Richtung sind nicht mehr zu halten — dann verliert man ohne Fehler. */
    const fach = (9.4 - 1.6) / anzahl;
    const spielraum = Math.max(0, fach - ZUG_DAUER - 0.2);
    for (let i = 0; i < anzahl; i++) {
      const t = 1.6 + i * fach + w() * spielraum;
      liste.push({
        zeit: Math.round(t * 100) / 100,
        richtung: w() < 0.5 ? -1 : 1,
        staerke: 0.95 + w() * 0.15,
      });
    }
    return liste;
  }

  /* ----------------------------------------------------------------------
     Drehmomentkurve
     ---------------------------------------------------------------------- */

  /* Schwach im Keller, Maximum bei mittlerer Drehzahl, fällt oben wieder ab.
     Auf Spitzenwert 1.0 normiert, damit `kraft` im Auto direkt in m/s^2 steht. */
  function drehmoment(r) {
    if (r > 1) return 0.30;                        // Begrenzer: es geht kaum noch was
    const roh = 0.55 + 0.90 * r - 0.75 * r * r;
    return roh / 0.82;
  }

  /**
   * Das grüne Fenster liegt direkt unter dem roten Bereich und wird mit
   * jedem Gang schmaler.
   */
  function fenster(auto, gang) {
    const breite = Math.max(auto.fensterEng, auto.fensterBreit - gang * auto.fensterSchritt);
    return { von: 1 - breite, bis: 1.0, perfektAb: 1 - breite * 0.30 };
  }

  function schaltNote(auto, gang, r) {
    const f = fenster(auto, gang);
    if (r > 1.0) return 'ueberdreht';
    if (r >= f.perfektAb) return 'perfekt';
    if (r >= f.von) return 'gut';
    return 'zufrueh';
  }

  /* ----------------------------------------------------------------------
     Griff aus dem Burnout
     ---------------------------------------------------------------------- */

  /** `waerme` ist der Balkenstand beim Loslassen (0 bis 1.4). */
  function griffAusBurnout(waerme) {
    if (waerme === null || waerme === undefined) return 0.86;   // Burnout abgeschaltet
    if (waerme < 0.75) return 0.62 + 0.38 * (waerme / 0.75);    // kalt
    if (waerme <= 1.00) return 1.0;                             // Punktlandung
    return Math.max(0.60, 1.0 - 0.95 * (waerme - 1.0));         // überhitzt
  }

  function burnoutNote(waerme) {
    if (waerme === null || waerme === undefined) return 'aus';
    if (waerme < 0.55) return 'kalt';
    if (waerme < 0.75) return 'lau';
    if (waerme <= 1.00) return 'perfekt';
    if (waerme <= 1.15) return 'heiss';
    return 'verbrannt';
  }

  /* ----------------------------------------------------------------------
     Ein Wagen in Fahrt
     ---------------------------------------------------------------------- */

  function neuerLauf(auto, saat, waerme) {
    return {
      auto: auto,
      saat: saat,
      zuege: ausbrecher(saat, auto),
      griff: griffAusBurnout(waerme),
      waerme: waerme === undefined ? null : waerme,

      t: 0,                 // Sekunden seit Grün
      s: 0,                 // gefahrene Strecke in Metern
      v: 0,                 // Tempo in m/s
      gang: 0,
      leerlaufBis: -1,      // solange kein Vortrieb (Kupplung)
      versatz: 0,           // seitlich, -1 bis 1
      seitTempo: 0,
      lenkBis: -1,              // Nachlauf eines kurzen Tippers
      lenkRichtung: 0,
      lenkGehalten: false,      // Finger liegt gerade auf dem Lenkfeld
      lenkAnZeit: -1,

      gestartet: false,
      reaktion: null,       // Sekunden nach Grün (negativ = Frühstart)
      fehlstart: false,
      aus: false,           // Linie berührt
      fertig: false,
      fahrzeit: null,
      zielZeit: null,       // Sekunden ab Grün bis zur Ziellinie

      noten: { perfekt: 0, gut: 0, zufrueh: 0, ueberdreht: 0 },
      spurVerlust: 0,       // wie viel Tempo das Schlingern gekostet hat (m/s)
    };
  }

  function drehzahl(l) {
    const g = l.auto.gaenge[l.gang];
    return l.v / g.vMax;
  }

  /** Der Fahrer tippt aufs Schaltfeld. */
  function schalte(l) {
    if (l.fertig || l.aus || !l.gestartet) return null;
    if (l.gang >= l.auto.gaenge.length - 1) return null;
    if (l.t < l.leerlaufBis) return null;              // Kupplung noch offen

    const r = drehzahl(l);
    const note = schaltNote(l.auto, l.gang, r);
    l.noten[note]++;
    l.gang++;
    if (note === 'perfekt') {
      l.v += SCHUB;
      l.leerlaufBis = l.t + SCHALT_LEER * 0.55;
    } else if (note === 'gut') {
      l.leerlaufBis = l.t + SCHALT_LEER;
    } else {
      /* Zu früh oder überdreht: die Kupplung hängt länger. Den Rest der
         Strafe erledigt die Physik von allein — im falschen Gang steht die
         Nadel im Keller oder im Begrenzer. */
      l.leerlaufBis = l.t + SCHALT_LEER * 1.7;
    }
    return note;
  }

  /** Der Finger geht auf das Lenkfeld und BLEIBT dort. */
  function lenkeAn(l, richtung) {
    if (l.fertig || l.aus || !l.gestartet) return;
    const r = richtung < 0 ? -1 : 1;
    if (l.lenkGehalten && l.lenkRichtung === r) return;   // liegt schon
    l.lenkRichtung = r;
    l.lenkGehalten = true;
    l.lenkAnZeit = l.t;
    l.lenkBis = -1;
  }

  /**
   * Der Finger geht wieder herunter.
   *
   * ⚠️ DER MINDEST-NACHLAUF ZÄHLT AB DEM AUFSETZEN, NICHT AB DEM LOSLASSEN.
   * Der erste Entwurf schob `lenkBis` bei jedem Bild auf „jetzt + 0,2 s" —
   * beim Loslassen lenkte das Auto also noch zwei Zehntel weiter und schoss
   * über die Mitte hinaus. Man musste sofort auf die andere Seite, kam wieder
   * zu weit, und genau daraus entstand das Gefühl, die Spur sei nicht zu
   * halten. Ein LANGER Halt hört jetzt sofort auf; nur ein kurzer Tipper
   * wirkt seine 0,2 s zu Ende.
   */
  function lenkeAus(l) {
    if (!l || !l.lenkGehalten) return;
    l.lenkGehalten = false;
    l.lenkBis = l.lenkAnZeit + MIN_LENK;
  }

  /** Kurzer Tipper: an und sofort wieder los — wirkt `MIN_LENK` lang. */
  function lenke(l, richtung) {
    lenkeAn(l, richtung);
    lenkeAus(l);
  }

  /**
   * Der Fuß geht vom Bremspedal. `versatzZuGruen` ist die Reaktionszeit in
   * Sekunden: negativ = vor Grün getippt (Frühstart), positiv = danach.
   *
   * ⚠️ `l.t` ZÄHLT AB GRÜN, NICHT AB DEM EIGENEN LOSFAHREN. Das Auto steht
   * die ersten `reaktion` Sekunden noch. Der erste Entwurf ließ es sofort
   * losrollen und schlug die Reaktion nur am Ende auf die Zeit — rechnerisch
   * dasselbe, aber die Ausbrecher kamen dann bei jedem Fahrer zu einem
   * anderen Zeitpunkt der Ampel. Zugesagt war: beide bekommen denselben Zug
   * im selben Moment. Also läuft die Uhr für beide ab Grün.
   */
  function starte(l, versatzZuGruen) {
    if (l.reaktion !== null || l.fertig) return;
    l.reaktion = versatzZuGruen;
    if (versatzZuGruen < 0) { l.fehlstart = true; l.fertig = true; l.fahrzeit = null; }
  }

  /* ----------------------------------------------------------------------
     Ein Rechenschritt
     ---------------------------------------------------------------------- */

  function schritt(l, dt) {
    if (l.fertig || l.aus) return;
    l.t += dt;
    /* Vor dem eigenen Losfahren steht das Auto — die Uhr läuft trotzdem. */
    if (l.reaktion === null || l.t < l.reaktion) return;
    l.gestartet = true;

    /* --- Längsrichtung --- */
    const g = l.auto.gaenge[l.gang];
    const r = l.v / g.vMax;
    let a = 0;
    if (l.t >= l.leerlaufBis) a = g.kraft * drehmoment(r);

    /* Der Griff aus dem Burnout zählt nur beim Anfahren. Ab 40 m ist es egal. */
    if (l.s < 40) {
      const anteil = 1 - l.s / 40;
      a *= l.griff * anteil + (1 - anteil);
    }

    a -= LUFT * l.v * l.v * l.auto.luft;

    /* --- Seitenrichtung --- */
    let zug = 0;
    for (const z of l.zuege) {
      if (l.t >= z.zeit && l.t < z.zeit + ZUG_DAUER) zug += z.richtung * z.staerke;
    }
    const lenk = (l.lenkGehalten || l.t < l.lenkBis) ? l.lenkRichtung : 0;

    /* Wunsch-Seitentempo aus Zug, Lenken und Selbstzentrierung … */
    const ziel = zug * ZUG_TEMPO + lenk * LENK_TEMPO - l.versatz * RUECK_TEMPO;
    /* … dem das Auto in `ANSPRECH` Sekunden folgt. */
    l.seitTempo += (ziel - l.seitTempo) * Math.min(1, dt / ANSPRECH);
    l.versatz += l.seitTempo * dt;

    /* Schräg stehende Reifen schleifen — das kostet direkt Tempo, nicht Kraft.
       ⚠️ Quadratisch, nicht linear. Linear war der erste Entwurf, und damit
       kostete ein spät gehaltener Ausbrecher GAR NICHTS: das bisschen Verlust
       holte die Beschleunigung sofort wieder auf, und wer früh gegenhielt,
       zahlte durch sein eigenes Pendeln sogar mehr. Quadratisch ist ein
       kleines Wackeln fast gratis und ein großer Ausschlag richtig teuer —
       genau so herum soll es sich anfühlen. */
    const schraeg = Math.abs(l.versatz);
    if (schraeg > SCHLEIF_AB) {
      const ueber = schraeg - SCHLEIF_AB;
      const verlust = SCHLEIFEN * ueber * ueber * dt;
      l.v -= verlust;
      l.spurVerlust += verlust;
    }
    if (schraeg >= 1) { l.aus = true; l.fertig = true; l.fahrzeit = null; return; }

    l.v += a * dt;
    if (l.v < 0) l.v = 0;
    l.s += l.v * dt;

    if (l.s >= STRECKE) {
      l.fertig = true;
      /* Auf den Zentimeter genau: den letzten Schritt anteilig zurückrechnen. */
      const zuViel = (l.s - STRECKE) / Math.max(l.v, 0.001);
      l.zielZeit = Math.max(0, l.t - zuViel);          // ab Grün
      l.fahrzeit = Math.max(0, l.zielZeit - l.reaktion); // reine Fahrt
      l.s = STRECKE;
    }
  }

  /**
   * Rechnet in festen Schritten bis zur Zielzeit weiter.
   *
   * `eingaben` ist eine nach Zeit sortierte Warteschlange von Tippern:
   *   { zeit: Sekunden nach Grün, art: 'schalt' | 'lenk', richtung: -1|1 }
   * Sie wird dabei geleert.
   *
   * ⚠️ WARUM DIE TIPPER EINE ZEIT MITBRINGEN. Ein Tipper kommt vom
   * Browser mit eigenem Zeitstempel, unabhängig davon, wann das Bild
   * gezeichnet wird. Würde er erst beim nächsten Bild angewandt, hätte ein
   * Handy mit 30 Bildern/s bis zu 33 ms Nachteil gegenüber einem mit 120 —
   * bei Reaktionszeiten, die auf Tausendstel verglichen werden, entscheidet
   * das Rennen. Deshalb wird jeder Tipper in genau dem Rechenschritt
   * eingesetzt, in dem er wirklich passiert ist.
   */
  function laufeBis(l, zielZeit, eingaben) {
    let wache = 0;
    while (!l.fertig && !l.aus && l.t + SCHRITT <= zielZeit && wache++ < 20000) {
      const bis = l.t + SCHRITT;
      while (eingaben && eingaben.length && eingaben[0].zeit <= bis) {
        const e = eingaben.shift();
        if (e.art === 'lenkAn') lenkeAn(l, e.richtung);
        else if (e.art === 'lenkAus') lenkeAus(l);
        else if (e.art === 'lenk') lenke(l, e.richtung);
        else schalte(l);
      }
      schritt(l, SCHRITT);
    }
    /* Tipper, die nach der Zielzeit liegen, bleiben für das nächste Bild
       liegen. Ist der Lauf vorbei, sind sie wertlos. */
    if ((l.fertig || l.aus) && eingaben) eingaben.length = 0;
  }

  /** Gesamtzeit = Reaktion + Fahrzeit. Das ist der Wert, der gewinnt. */
  function gesamtzeit(l) {
    if (!l || l.fehlstart || l.aus || l.fahrzeit === null) return null;
    return l.reaktion + l.fahrzeit;
  }

  /**
   * Wer hat gewonnen? `'a'`, `'b'` oder `null` für unentschieden.
   * Ein Ergebnis ist hier entweder ein Lauf oder ein gemeldeter Wert
   * { gesamt, fehlstart, aus, reaktion }.
   */
  function wertung(e) {
    if (!e) return null;
    if (typeof e.gesamt !== 'undefined') return e.fehlstart || e.aus ? null : e.gesamt;
    return gesamtzeit(e);
  }

  function vergleiche(a, b) {
    const za = wertung(a);
    const zb = wertung(b);
    if (za !== null && zb === null) return 'a';
    if (zb !== null && za === null) return 'b';
    if (za === null && zb === null) {
      /* Beide raus. Zwei Frühstarts entscheidet der spätere Fuß. */
      const fa = a && a.fehlstart, fb = b && b.fehlstart;
      if (fa && fb) return (a.reaktion || 0) > (b.reaktion || 0) ? 'a' : 'b';
      if (fa && !fb) return 'b';
      if (fb && !fa) return 'a';
      return null;
    }
    if (za === zb) return null;
    return za < zb ? 'a' : 'b';
  }

  const api = {
    STRECKE: STRECKE,
    SCHRITT: SCHRITT,
    ZUG_DAUER: ZUG_DAUER,
    MIN_LENK: MIN_LENK,
    WARNUNG: WARNUNG,
    saatZufall: saatZufall,
    ausbrecher: ausbrecher,
    drehmoment: drehmoment,
    fenster: fenster,
    schaltNote: schaltNote,
    griffAusBurnout: griffAusBurnout,
    burnoutNote: burnoutNote,
    neuerLauf: neuerLauf,
    drehzahl: drehzahl,
    schalte: schalte,
    lenke: lenke,
    lenkeAn: lenkeAn,
    lenkeAus: lenkeAus,
    starte: starte,
    schritt: schritt,
    laufeBis: laufeBis,
    gesamtzeit: gesamtzeit,
    wertung: wertung,
    vergleiche: vergleiche,
  };

  /* Damit pflege/pruefe-fahrt.js denselben Code prüft, der im Browser läuft. */
  if (typeof module === 'object' && module.exports) module.exports = api;
  return api;
})();
