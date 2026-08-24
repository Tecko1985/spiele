/* ==========================================================================
   Letzte Karte — Kartendecks und Kartenwerte
   ==========================================================================

   EINE KARTE IST EIN STRING, KEIN OBJEKT.

   Jede Karte fährt als `farbe:art` über das Netz — "r:7", "b:z2", "w:wz4".
   Bei sechs Spielern mit je bis zu 25 Karten liegen mehrere hundert Karten
   gleichzeitig in der Datenbank; als Objekte mit Feldnamen wäre jede Hand ein
   Vielfaches so groß, und im Funkloch zählt jedes Byte. Zerlegt wird mit
   `teile()`, nie von Hand mit substring.

   ZWEISEITIGE KARTEN TRAGEN BEIDE SEITEN IM SELBEN STRING.
   Im Modus "Wende" hat jede Karte eine helle und eine dunkle Seite:
   "r:7|p:3". Welche gilt, entscheidet NICHT die Karte, sondern der Tisch —
   deshalb nimmt jede Funktion hier ein `dunkel`-Flag entgegen, statt es sich
   aus der Karte zu holen. Ein Kartenstring allein sagt nie, was er gerade
   bedeutet.

   DIE PAARUNG DER SEITEN IST FEST, NICHT ZUFÄLLIG.
   Beim echten Spiel ist auf der Rückseite der roten Sieben immer dieselbe
   dunkle Karte — sonst könnte niemand mitdenken, was nach dem Wenden auf
   der Hand liegt. `baueDeck` mischt die dunkle Hälfte deshalb mit einem
   FESTEN Startwert: jede Partie bekommt dasselbe Kartenspiel, nur in anderer
   Reihenfolge.
   ========================================================================== */

const karten = (function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Farben
     ---------------------------------------------------------------------- */

  /* Die vier hellen Farben sind in allen drei Modi dieselben. Die dunklen
     gibt es nur im Wende-Modus. `w` ist keine Farbe, sondern "noch offen" —
     eine Farbwahlkarte bekommt ihre Farbe erst beim Ablegen. */
  const HELL = ['r', 'g', 'b', 'y'];
  const DUNKEL = ['o', 'p', 't', 'l'];

  const FARBNAME = {
    r: 'Rot', g: 'Grün', b: 'Blau', y: 'Gelb',
    o: 'Orange', p: 'Pink', t: 'Türkis', l: 'Lila',
    w: 'Offen',
  };

  /* Die Farbwerte werden von bildschirme.js zum Zeichnen benutzt und stehen
     bewusst hier: Farbe und Bedeutung einer Karte gehören zusammen. Kein Ton
     ist dem Original entnommen — die vier Grundfarben sind Spielregel, ihre
     konkreten Werte sind unsere. */
  const FARBWERT = {
    r: '#d63c3c', g: '#1d9a5a', b: '#2b6fc4', y: '#e8a317',
    o: '#e2661f', p: '#c93a86', t: '#0f9aa0', l: '#7c4dbd',
    w: '#3a3f4b',
  };

  /* Schrift auf der Karte. Gelb und Türkis tragen dunkle Schrift, sonst wäre
     die Zahl auf hellem Grund nicht zu lesen. */
  const SCHRIFTWERT = {
    r: '#ffffff', g: '#ffffff', b: '#ffffff', y: '#3a2c00',
    o: '#ffffff', p: '#ffffff', t: '#04343a', l: '#ffffff',
    w: '#ffffff',
  };

  /* ----------------------------------------------------------------------
     Kartenarten
     ----------------------------------------------------------------------
     Eine Art ist ein Kürzel. `z` heißt ziehen, die Zahl dahinter sagt
     wie viele; `w` davor heißt, dass der Leger die Farbe bestimmt. */

  const ART = {
    aussetzen:     's',     // der Nächste ist nicht dran
    umkehr:        'u',     // Richtung dreht
    wenden:        'f',     // heller/dunkler Satz tauscht (nur Wende-Modus)
    alleAussetzen: 'e',     // alle anderen übersprungen, der Leger nochmal
    allesAblegen:  'a',     // alle eigenen Karten dieser Farbe fliegen mit
    farbwahl:      'w',     // Farbe frei wählbar
    roulette:      'wr',    // Nächster zieht, bis die gewählte Farbe kommt
    umkehrZiehen4: 'wu4',   // Richtung dreht, dann zieht der Nächste vier
  };

  /* Wie viele Karten eine Ziehkarte auslöst. Nur diese Arten stapeln sich. */
  const ZIEHT = {
    z1: 1, z2: 2, z4: 4, z5: 5,
    wz2: 2, wz4: 4, wz6: 6, wz10: 10,
    wu4: 4,
  };

  /* Arten, bei denen der Leger eine Farbe bestimmen muss. */
  const BRAUCHT_FARBE = { w: true, wz2: true, wz4: true, wz6: true, wz10: true, wu4: true, wr: true };

  /* ----------------------------------------------------------------------
     Die drei Modi
     ---------------------------------------------------------------------- */

  const MODI = [
    {
      id: 'klassisch',
      name: 'Klassisch',
      kurz: 'Das gewohnte Spiel',
      beschreibung: '108 Karten, vier Farben, Null bis Neun. Aussetzen, Richtungswechsel und Zwei ziehen. Wer zuerst keine Karte mehr hat, gewinnt die Runde.',
      zweiseitig: false,
      zielPunkte: 500,
      ziehtBisPassend: false,
      startkarten: 7,
      mercy: 0,
    },
    {
      id: 'wende',
      name: 'Wende',
      kurz: 'Karten mit zwei Seiten',
      beschreibung: '112 doppelseitige Karten. Eine Wendekarte dreht das ganze Spiel auf die dunkle Seite: andere Farben, härtere Strafen, Fünf ziehen statt Eins. Was auf deiner Hand liegt, ändert sich mit.',
      zweiseitig: true,
      zielPunkte: 500,
      ziehtBisPassend: false,
      startkarten: 7,
      mercy: 0,
    },
    {
      id: 'gnadenlos',
      name: 'Gnadenlos',
      kurz: 'Bis nur einer übrig ist',
      beschreibung: '168 Karten mit Vier, Sechs und Zehn ziehen. Wer nichts legen kann, zieht bis es passt. Bei 25 Karten auf der Hand ist man raus — gespielt wird, bis nur noch einer steht.',
      zweiseitig: false,
      zielPunkte: 1000,
      ziehtBisPassend: true,
      startkarten: 7,
      mercy: 25,
    },
  ];

  function modus(id) {
    for (let i = 0; i < MODI.length; i++) if (MODI[i].id === id) return MODI[i];
    return MODI[0];
  }

  /* ----------------------------------------------------------------------
     Zerlegen und Zusammensetzen
     ---------------------------------------------------------------------- */

  /**
   * Zerlegt einen Kartenstring in Farbe und Art — für die Seite, die
   * gerade gilt.
   * @param {string} karte    "r:7" oder "r:7|p:3"
   * @param {boolean} dunkel  liegt der Tisch auf der dunklen Seite?
   * @returns {{farbe: string, art: string}}
   */
  function teile(karte, dunkel) {
    const s = seite(karte, dunkel);
    const i = s.indexOf(':');
    if (i < 0) return { farbe: 'w', art: 'w' };
    return { farbe: s.slice(0, i), art: s.slice(i + 1) };
  }

  /** Der Teilstring der geltenden Seite. Einseitige Karten liefern sich selbst. */
  function seite(karte, dunkel) {
    const k = String(karte || '');
    const i = k.indexOf('|');
    if (i < 0) return k;
    return dunkel ? k.slice(i + 1) : k.slice(0, i);
  }

  /** Die andere Seite — für die Vorschau "was wird daraus, wenn gewendet wird". */
  function rueckseite(karte, dunkel) {
    return seite(karte, !dunkel);
  }

  function istZahl(art) {
    return art.length === 1 && art >= '0' && art <= '9';
  }

  /** Wie viele Karten diese Art ziehen lässt. 0 heißt: keine Ziehkarte. */
  function zieht(art) {
    return ZIEHT[art] || 0;
  }

  function brauchtFarbe(art) {
    return !!BRAUCHT_FARBE[art];
  }

  /* ----------------------------------------------------------------------
     Punkte
     ----------------------------------------------------------------------
     Gezählt wird immer nach der Seite, auf der die Runde geendet hat —
     eine dunkle Fünf-ziehen ist teurer als eine helle Eins-ziehen. */

  function punkte(karte, modusId, dunkel) {
    const t = teile(karte, dunkel);
    if (istZahl(t.art)) return Number(t.art);

    if (modusId === 'wende') {
      if (t.farbe === 'w') {
        /* Farbwahl ist auf beiden Seiten dieselbe Karte, die harte
           Farbwahl-Ziehkarte kostet mehr. */
        if (t.art === 'w') return dunkel ? 40 : 20;
        return dunkel ? 50 : 30;
      }
      return dunkel ? 20 : 10;
    }

    /* Klassisch und Gnadenlos zählen gleich: Aktionskarte 20, Farbwahl 50. */
    if (t.farbe === 'w') return 50;
    return 20;
  }

  /* ----------------------------------------------------------------------
     Anzeigenamen
     ----------------------------------------------------------------------
     Wird für Vorlesetexte gebraucht (Zugprotokoll, Prüfskript). Auf der
     Karte selbst steht ein Zeichen, kein Wort — dafür ist `zeichen()`. */

  function name(karte, dunkel) {
    const t = teile(karte, dunkel);
    const f = FARBNAME[t.farbe] || '?';
    if (istZahl(t.art)) return f + ' ' + t.art;
    switch (t.art) {
      case 's':    return f + ' Aussetzen';
      case 'u':    return f + ' Richtungswechsel';
      case 'f':    return f + ' Wenden';
      case 'e':    return f + ' Alle aussetzen';
      case 'a':    return f + ' Alles ablegen';
      case 'z1':   return f + ' Eine ziehen';
      case 'z2':   return f + ' Zwei ziehen';
      case 'z4':   return f + ' Vier ziehen';
      case 'z5':   return f + ' Fünf ziehen';
      case 'w':    return 'Farbwahl';
      case 'wz2':  return 'Farbwahl + Zwei ziehen';
      case 'wz4':  return 'Farbwahl + Vier ziehen';
      case 'wz6':  return 'Farbwahl + Sechs ziehen';
      case 'wz10': return 'Farbwahl + Zehn ziehen';
      case 'wu4':  return 'Farbwahl + Umkehr + Vier ziehen';
      case 'wr':   return 'Farbroulette';
      default:     return f + ' ' + t.art;
    }
  }

  /* Das Zeichen, das groß auf der Karte steht. Bewusst kurz — auf einem
     Kartenfächer stehen bis zu 25 Karten nebeneinander. */
  function zeichen(karte, dunkel) {
    const t = teile(karte, dunkel);
    if (istZahl(t.art)) return t.art;
    switch (t.art) {
      case 's':    return 'X';
      case 'u':    return '⇄';
      case 'f':    return '⟳';
      case 'e':    return 'XX';
      case 'a':    return '≡';
      case 'z1':   return '+1';
      case 'z2':   return '+2';
      case 'z4':   return '+4';
      case 'z5':   return '+5';
      case 'w':    return '★';
      case 'wz2':  return '+2';
      case 'wz4':  return '+4';
      case 'wz6':  return '+6';
      case 'wz10': return '+10';
      case 'wu4':  return '⇄+4';
      case 'wr':   return '?';
      default:     return '?';
    }
  }

  /* ----------------------------------------------------------------------
     Mischen
     ----------------------------------------------------------------------
     Fisher-Yates. `zufall` ist einsetzbar, damit das Prüfskript
     wiederholbare Partien fahren kann; ohne Angabe echter Zufall. */

  function mische(liste, zufall) {
    const z = zufall || Math.random;
    const a = liste.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(z() * (i + 1));
      const h = a[i]; a[i] = a[j]; a[j] = h;
    }
    return a;
  }

  /* Ein winziger, reproduzierbarer Zufallsgenerator (mulberry32). Nur für
     die feste Seitenpaarung des Wende-Decks und für das Prüfskript —
     NICHT zum Mischen einer echten Partie. */
  function generator(saat) {
    let a = saat >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------------------------------------------------------
     Die Decks
     ---------------------------------------------------------------------- */

  /* Klassisch: je Farbe eine Null, zwei von Eins bis Neun, je zwei
     Aussetzen, Richtungswechsel und Zwei-ziehen. Dazu vier Farbwahl und
     vier Farbwahl+Vier. Macht 4 × 25 + 8 = 108. */
  function deckKlassisch() {
    const d = [];
    for (const f of HELL) {
      d.push(f + ':0');
      for (let n = 1; n <= 9; n++) { d.push(f + ':' + n); d.push(f + ':' + n); }
      for (const a of ['s', 'u', 'z2']) { d.push(f + ':' + a); d.push(f + ':' + a); }
    }
    for (let i = 0; i < 4; i++) { d.push('w:w'); d.push('w:wz4'); }
    return d;
  }

  /* Gnadenlos: je Farbe eine Null, zwei von Eins bis Neun (76 Zahlen), dazu
     DREI je Farbe von Aussetzen, Richtungswechsel, Zwei-, Vier-ziehen, Alle
     aussetzen und Alles ablegen (72). Farbwahl, Farbwahl+Umkehr+Vier,
     +Sechs, +Zehn und Farbroulette je vier (20). Zusammen 168.
     ⚠️ Vier-ziehen ist hier eine FARBIGE Karte, keine Farbwahlkarte. */
  function deckGnadenlos() {
    const d = [];
    for (const f of HELL) {
      d.push(f + ':0');
      for (let n = 1; n <= 9; n++) { d.push(f + ':' + n); d.push(f + ':' + n); }
      for (const a of ['s', 'u', 'z2', 'z4', 'e', 'a']) {
        d.push(f + ':' + a); d.push(f + ':' + a); d.push(f + ':' + a);
      }
    }
    for (let i = 0; i < 4; i++) {
      d.push('w:w'); d.push('w:wu4'); d.push('w:wz6'); d.push('w:wz10'); d.push('w:wr');
    }
    return d;
  }

  /* Wende: 112 doppelseitige Karten.
     Helle Seite je Farbe: zwei von Eins bis Neun (KEINE Null), je zwei
     Aussetzen, Richtungswechsel, Wenden und Eins-ziehen — 26 je Farbe.
     Dunkle Seite genauso, nur mit Fünf-ziehen statt Eins-ziehen und
     Alle-aussetzen statt Aussetzen.
     Dazu je Seite vier Farbwahl und vier harte Farbwahlkarten.

     Die Wildkarten werden PAARWEISE zusammengelegt: eine helle Farbwahl hat
     immer eine dunkle Farbwahl auf der Rückseite. Andernfalls stünde nach
     dem Wenden eine farbige Karte dort, wo eben noch eine Farbwahl lag —
     und eine bereits abgelegte Farbwahl hätte plötzlich eine Farbe. */
  function deckWende() {
    function haelfte(farben, ziehArt, aussetzArt) {
      const d = [];
      for (const f of farben) {
        for (let n = 1; n <= 9; n++) { d.push(f + ':' + n); d.push(f + ':' + n); }
        for (const a of [aussetzArt, 'u', 'f', ziehArt]) { d.push(f + ':' + a); d.push(f + ':' + a); }
      }
      return d;
    }

    const hell = haelfte(HELL, 'z1', 's');
    const dunkel = haelfte(DUNKEL, 'z5', 'e');

    /* Feste Saat: jede Partie bekommt dieselben Vorder-/Rückseiten-Paare.
       Wer die Karte einmal kennt, kann mitdenken — genau wie am Tisch. */
    const gemischt = mische(dunkel, generator(19110607));

    const d = [];
    for (let i = 0; i < hell.length; i++) d.push(hell[i] + '|' + gemischt[i]);
    for (let i = 0; i < 4; i++) {
      d.push('w:w|w:w');
      d.push('w:wz2|w:wr');
    }
    return d;
  }

  function baueDeck(modusId) {
    if (modusId === 'wende') return deckWende();
    if (modusId === 'gnadenlos') return deckGnadenlos();
    return deckKlassisch();
  }

  /** Die Farben, die im gegebenen Modus auf der geltenden Seite gültig sind. */
  function farbenFuer(modusId, dunkel) {
    if (modusId === 'wende' && dunkel) return DUNKEL.slice();
    return HELL.slice();
  }

  return {
    MODI: MODI,
    HELL: HELL,
    DUNKEL: DUNKEL,
    FARBNAME: FARBNAME,
    FARBWERT: FARBWERT,
    SCHRIFTWERT: SCHRIFTWERT,
    ART: ART,

    modus: modus,
    baueDeck: baueDeck,
    farbenFuer: farbenFuer,

    teile: teile,
    seite: seite,
    rueckseite: rueckseite,
    istZahl: istZahl,
    zieht: zieht,
    brauchtFarbe: brauchtFarbe,
    punkte: punkte,
    name: name,
    zeichen: zeichen,

    mische: mische,
    generator: generator,
  };
})();

/* Für das Prüfskript, das unter Node läuft. Im Browser gibt es kein `module`. */
if (typeof module !== 'undefined' && module.exports) module.exports = karten;
