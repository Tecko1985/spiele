/* ==========================================================================
   Letzte Karte — Spielregeln
   ==========================================================================

   REINE LOGIK, KEIN FIREBASE, KEINE ZEICHENFLÄCHE.

   Alles hier arbeitet auf einem einzigen Objekt `spiel`:

     spiel.tisch        was ALLE sehen dürfen (Ablage, Richtung, wer dran ist,
                        wie viele Karten jeder hat)
     spiel.haende       {uid: [Karte, ...]} — geheim, nur der Gastgeber hält
                        das vollständig
     spiel.stapel       Nachziehstapel, gezogen wird vom Ende (pop)
     spiel.ablagestapel alles bereits Abgelegte AUSSER der obersten Karte;
                        Nachschub, wenn der Nachziehstapel leer läuft
     spiel.protokoll    die letzten Ereignisse im Klartext

   Damit ist das Prüfskript möglich: es baut ein `spiel`, lässt Bots ziehen
   und prüft nach jedem Zug, dass die Kartenzahl stimmt. Ohne Netz, ohne
   Browser, tausende Partien in Sekunden.

   WER PRÜFT, PRÜFT HIER — NICHT IN DER OBERFLÄCHE.
   Jede `lege`/`ziehe`/`passe`-Funktion prüft selbst, ob der Zug erlaubt ist,
   und gibt bei Verstoß `{ok:false, grund:'...'}` zurück. Die Oberfläche darf
   Knöpfe ausgrauen, aber sie ist nie die Instanz, die entscheidet: am Ende
   ruft auch ein Bot dieselbe Funktion, und ein manipulierter Client soll an
   derselben Stelle abprallen wie ein Tippfehler.
   ========================================================================== */

const regeln = (function () {
  'use strict';

  const K = (typeof karten !== 'undefined') ? karten : require('./karten.js');

  /* Wie viele Karten der Erwischte zieht, wenn er "Letzte Karte" vergessen hat. */
  const UNO_STRAFE = 2;

  /* Zuschlag für den, der zu Unrecht anficht. Er zieht die vier der Karte
     PLUS diesen Aufschlag. */
  const ANFECHT_ZUSCHLAG = 2;

  /* Bonus für das Ausschalten eines Mitspielers im Modus Gnadenlos. */
  const MERCY_BONUS = 250;

  /* Nur diese Arten lassen sich anfechten: der Leger behauptet damit, keine
     Karte der geltenden Farbe zu haben. Bei Gnadenlos gibt es das nicht —
     dort ist Vier-ziehen eine farbige Karte, die diese Behauptung gar nicht
     aufstellt. */
  const ANFECHTBAR = { wz4: true, wz2: true };

  /* ----------------------------------------------------------------------
     Aufbau einer Runde
     ---------------------------------------------------------------------- */

  /**
   * Baut eine frische Runde auf.
   * @param {string} modusId   klassisch | wende | gnadenlos
   * @param {string[]} uids    Sitzordnung, so wie sie am Tisch gilt
   * @param {function} zufall  optionaler Zufallsgenerator (Prüfskript)
   * @param {object} punkte    bisheriger Punktestand einer Serie
   */
  function neueRunde(modusId, uids, zufall, punkte) {
    const m = K.modus(modusId);
    const stapel = K.mische(K.baueDeck(m.id), zufall);

    const haende = {};
    for (const uid of uids) haende[uid] = [];
    for (let i = 0; i < m.startkarten; i++) {
      for (const uid of uids) haende[uid].push(stapel.pop());
    }

    /* Die erste offene Karte darf keine Farbwahlkarte sein — sonst müsste
       jemand eine Farbe bestimmen, bevor überhaupt jemand dran war. Solche
       Karten wandern zurück und der Stapel wird neu gemischt. */
    let start = null;
    for (let versuch = 0; versuch < 200; versuch++) {
      const k = stapel.pop();
      const t = K.teile(k, false);
      if (t.farbe !== 'w') { start = k; break; }
      stapel.unshift(k);
    }
    if (!start) start = stapel.pop();

    const startTeil = K.teile(start, false);

    const spiel = {
      tisch: {
        modus: m.id,
        dunkel: false,
        ablage: start,
        farbe: startTeil.farbe,
        richtung: 1,
        reihenfolge: uids.slice(),
        dranIdx: 0,
        strafe: 0,
        strafeWert: 0,
        gezogen: false,
        mussLegen: false,
        raus: {},
        fertig: [],
        uno: {},
        erwischbar: null,
        erwischbarBis: 0,
        anfechtbar: null,
        aufdeckung: null,
        handAnzahl: {},
        stapelRest: 0,
        zugNr: 0,
        phase: 'laeuft',
        endart: null,
        gewinner: null,
        punkte: punkte ? JSON.parse(JSON.stringify(punkte)) : {},
        rundenPunkte: null,
      },
      haende: haende,
      stapel: stapel,
      ablagestapel: [],
      protokoll: [],
    };

    /* Wirkt die Startkarte? Beim echten Spiel ja — eine offene Aussetzen-Karte
       trifft den ersten Spieler. Umgesetzt wird sie über denselben Weg wie
       jede gelegte Karte, damit es keine zweite Regelstelle gibt. */
    wendeStartkarteAn(spiel, startTeil);

    aktualisiere(spiel);
    return spiel;
  }

  function wendeStartkarteAn(spiel, t) {
    const tisch = spiel.tisch;
    const zieh = K.zieht(t.art);
    if (zieh > 0) {
      tisch.strafe = zieh;
      tisch.strafeWert = zieh;
      protokoll(spiel, 'Startkarte ' + K.name(tisch.ablage, tisch.dunkel) + ' — es liegen ' + zieh + ' Karten an.');
      return;
    }
    if (t.art === 's') { rueckeWeiter(spiel, 2); protokoll(spiel, 'Startkarte setzt den ersten Spieler aus.'); return; }
    if (t.art === 'e') { protokoll(spiel, 'Startkarte: alle ausgesetzt — der erste Spieler legt weiter.'); return; }
    if (t.art === 'u') {
      tisch.richtung = -1;
      /* Bei umgekehrter Richtung beginnt der letzte in der Sitzordnung. */
      tisch.dranIdx = tisch.reihenfolge.length - 1;
      protokoll(spiel, 'Startkarte dreht die Richtung.');
      return;
    }
    if (t.art === 'f') { tisch.dunkel = true; tisch.farbe = K.teile(tisch.ablage, true).farbe; protokoll(spiel, 'Startkarte wendet auf die dunkle Seite.'); }
  }

  /* ----------------------------------------------------------------------
     Kleine Helfer
     ---------------------------------------------------------------------- */

  function protokoll(spiel, text) {
    spiel.protokoll.push(text);
    if (spiel.protokoll.length > 12) spiel.protokoll.shift();
  }

  function modusVon(spiel) { return K.modus(spiel.tisch.modus); }

  /** Alle, die noch mitspielen: nicht ausgeschieden und nicht fertig. */
  function aktive(spiel) {
    const t = spiel.tisch;
    return t.reihenfolge.filter(function (u) { return !t.raus[u] && t.fertig.indexOf(u) < 0; });
  }

  function dran(spiel) { return spiel.tisch.reihenfolge[spiel.tisch.dranIdx]; }

  /**
   * Rückt den Zeiger um `schritte` aktive Spieler weiter.
   * Ausgeschiedene und fertige Spieler werden übersprungen, zählen also
   * nicht als Schritt — sonst könnte ein Aussetzen ins Leere gehen.
   */
  function rueckeWeiter(spiel, schritte) {
    const t = spiel.tisch;
    const n = t.reihenfolge.length;
    if (aktive(spiel).length === 0) return;
    let i = t.dranIdx;
    let gemacht = 0;
    let sicherung = 0;
    while (gemacht < schritte && sicherung < n * 40) {
      sicherung++;
      i = (i + t.richtung + n) % n;
      const u = t.reihenfolge[i];
      if (t.raus[u] || t.fertig.indexOf(u) >= 0) continue;
      gemacht++;
    }
    t.dranIdx = i;
  }

  /** Der Spieler, der nach dem aktuellen an der Reihe wäre. */
  function naechster(spiel) {
    const t = spiel.tisch;
    const merk = t.dranIdx;
    rueckeWeiter(spiel, 1);
    const u = t.reihenfolge[t.dranIdx];
    t.dranIdx = merk;
    return u;
  }

  /** Schreibt die abgeleiteten Felder neu, die alle sehen dürfen. */
  function aktualisiere(spiel) {
    const t = spiel.tisch;
    t.handAnzahl = {};
    for (const uid in spiel.haende) t.handAnzahl[uid] = spiel.haende[uid].length;
    t.stapelRest = spiel.stapel.length;
  }

  /* ----------------------------------------------------------------------
     Ziehen
     ---------------------------------------------------------------------- */

  /**
   * Holt eine Karte vom Nachziehstapel. Ist er leer, wird der Ablagestapel
   * gemischt und zum neuen Nachziehstapel — die oberste Karte bleibt liegen.
   * Gibt null zurück, wenn wirklich keine Karte mehr da ist (alles auf den
   * Händen). Dann darf nicht gezogen werden; der Zug geht weiter.
   */
  function hebeAb(spiel, zufall) {
    if (spiel.stapel.length === 0) {
      if (spiel.ablagestapel.length === 0) return null;
      spiel.stapel = K.mische(spiel.ablagestapel, zufall);
      spiel.ablagestapel = [];
      protokoll(spiel, 'Der Ablagestapel wurde neu gemischt.');
    }
    return spiel.stapel.pop();
  }

  /**
   * Gibt einem Spieler `anzahl` Karten. Prüft danach die Mercy-Grenze.
   * @returns {number} wie viele Karten wirklich gegeben wurden
   */
  function gib(spiel, uid, anzahl, zufall) {
    let gegeben = 0;
    for (let i = 0; i < anzahl; i++) {
      const k = hebeAb(spiel, zufall);
      if (k === null) break;
      spiel.haende[uid].push(k);
      gegeben++;
    }
    return gegeben;
  }

  /**
   * Prüft die Mercy-Grenze für einen Spieler und schaltet ihn nötigenfalls
   * aus. Seine Karten wandern in den Ablagestapel — sie sind wieder im
   * Spiel, sonst blutet das Kartenspiel bei jedem Ausscheiden aus.
   * @returns {boolean} ist er ausgeschieden?
   */
  function pruefeMercy(spiel, uid, verursacher) {
    const m = modusVon(spiel);
    if (!m.mercy) return false;
    const t = spiel.tisch;
    if (t.raus[uid]) return false;
    if (spiel.haende[uid].length < m.mercy) return false;

    t.raus[uid] = true;
    for (const k of spiel.haende[uid]) spiel.ablagestapel.push(k);
    spiel.haende[uid] = [];
    protokoll(spiel, name(spiel, uid) + ' hat ' + m.mercy + ' Karten erreicht und ist raus.');

    if (verursacher && verursacher !== uid) {
      t.punkte[verursacher] = (t.punkte[verursacher] || 0) + MERCY_BONUS;
      protokoll(spiel, name(spiel, verursacher) + ' bekommt ' + MERCY_BONUS + ' Punkte dafür.');
    }
    return true;
  }

  /* Der Anzeigename wird von außen gesetzt (die Regeln kennen nur uids).
     Fehlt er, steht die uid da — im Prüfskript völlig ausreichend. */
  let namen = {};
  function setzeNamen(n) { namen = n || {}; }
  function name(spiel, uid) { return namen[uid] || uid; }

  /* ----------------------------------------------------------------------
     Passt diese Karte?
     ---------------------------------------------------------------------- */

  /**
   * Darf `karte` gerade abgelegt werden?
   *
   * ⚠️ Bei offener Strafe (jemand hat eine Ziehkarte gelegt) gelten NUR die
   * Ziehkarten, und zwar nach ihrem Wert: gleich viel oder mehr. Farbe und
   * Art spielen dann keine Rolle. Andernfalls könnte man eine Vier-ziehen
   * nicht mit einer Sechs-ziehen kontern, nur weil die Farbe nicht stimmt —
   * und der Stapel bräche an einer Stelle ab, an der ihn niemand erwartet.
   */
  function passt(tisch, karte) {
    const t = K.teile(karte, tisch.dunkel);

    if (tisch.strafe > 0) {
      const z = K.zieht(t.art);
      return z > 0 && z >= tisch.strafeWert;
    }

    if (t.farbe === 'w') return true;
    if (t.farbe === tisch.farbe) return true;

    const oben = K.teile(tisch.ablage, tisch.dunkel);
    if (oben.farbe === 'w') return false;      // Farbwahl: nur die Farbe zählt
    return t.art === oben.art;
  }

  /** Indizes der Handkarten, die gerade gelegt werden dürfen. */
  function legbare(tisch, hand) {
    const raus = [];
    for (let i = 0; i < hand.length; i++) if (passt(tisch, hand[i])) raus.push(i);
    return raus;
  }

  function kannLegen(spiel, uid) {
    return legbare(spiel.tisch, spiel.haende[uid] || []).length > 0;
  }

  /* ----------------------------------------------------------------------
     Der Zug: Karte legen
     ---------------------------------------------------------------------- */

  /**
   * Legt eine Karte.
   * @param {object} spiel
   * @param {string} uid
   * @param {number} idx          Index in der Hand
   * @param {string} wunschFarbe  bei Farbwahlkarten Pflicht
   * @param {boolean} sagtUno     hat er gleichzeitig "Letzte Karte" gedrückt?
   * @param {function} zufall
   */
  function lege(spiel, uid, idx, wunschFarbe, sagtUno, zufall) {
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return { ok: false, grund: 'Die Runde ist vorbei.' };
    if (dran(spiel) !== uid) return { ok: false, grund: 'Du bist nicht dran.' };

    const hand = spiel.haende[uid] || [];
    if (idx < 0 || idx >= hand.length) return { ok: false, grund: 'Diese Karte hast du nicht.' };

    const karte = hand[idx];
    if (!passt(t, karte)) return { ok: false, grund: 'Diese Karte passt nicht.' };

    const teil = K.teile(karte, t.dunkel);
    if (K.brauchtFarbe(teil.art)) {
      const erlaubt = K.farbenFuer(t.modus, t.dunkel);
      if (erlaubt.indexOf(wunschFarbe) < 0) return { ok: false, grund: 'Du musst eine Farbe wählen.' };
    }

    /* Ab hier wird gehandelt — vorher darf nichts verändert worden sein. */
    hand.splice(idx, 1);
    if (t.ablage) spiel.ablagestapel.push(t.ablage);
    t.ablage = karte;
    t.gezogen = false;
    t.mussLegen = false;
    t.aufdeckung = null;

    /* Wer angefochten werden könnte, merkt sich, mit welcher Hand er die
       Karte gelegt hat — die Prüfung schaut auf den Stand VOR dem Legen. */
    t.anfechtbar = null;
    if (ANFECHTBAR[teil.art] && t.modus !== 'gnadenlos') {
      t.anfechtbar = { uid: uid, farbe: t.farbe, zugNr: t.zugNr + 1, hand: hand.slice() };
    }

    t.farbe = K.brauchtFarbe(teil.art) ? wunschFarbe : teil.farbe;

    /* "Letzte Karte" gilt nur, wenn danach genau eine übrig ist. Früher
       gedrückt hilft nicht, später ist zu spät. */
    if (sagtUno && hand.length === 1) t.uno[uid] = true;

    protokoll(spiel, name(spiel, uid) + ' legt ' + K.name(karte, t.dunkel) +
      (K.brauchtFarbe(teil.art) ? ' und wählt ' + K.FARBNAME[wunschFarbe] : ''));

    const ergebnis = wendeWirkungAn(spiel, uid, teil, wunschFarbe, zufall);

    /* Hand leer? Dann ist dieser Spieler durch. */
    if (hand.length === 0) {
      t.fertig.push(uid);
      protokoll(spiel, name(spiel, uid) + ' hat keine Karte mehr.');
      t.uno[uid] = true;
      t.erwischbar = null;
    } else if (hand.length === 1 && !t.uno[uid]) {
      /* Vergessen zu rufen — bis zum Ende des nächsten Zuges erwischbar. */
      t.erwischbar = uid;
      t.erwischbarBis = t.zugNr + 2;
    }

    t.zugNr++;
    if (t.erwischbar && t.zugNr >= t.erwischbarBis) t.erwischbar = null;

    if (!ergebnis.bleibtDran) rueckeWeiter(spiel, ergebnis.schritte === undefined ? 1 : ergebnis.schritte);

    aktualisiere(spiel);
    pruefeRundenEnde(spiel);
    ziehePflichtNach(spiel, zufall);
    return { ok: true };
  }

  /**
   * Setzt die Wirkung einer gelegten Karte um.
   * Rückgabe steuert nur den Zeiger — alles andere ist schon passiert.
   */
  function wendeWirkungAn(spiel, uid, teil, wunschFarbe, zufall) {
    const t = spiel.tisch;
    const nurZwei = aktive(spiel).length <= 2;

    const zieh = K.zieht(teil.art);
    if (zieh > 0) {
      /* Ziehkarten werden NICHT sofort ausgeführt: der Nächste darf kontern.
         Erst wer nicht kontern kann, schluckt den ganzen Stapel. */
      t.strafe += zieh;
      t.strafeWert = zieh;
      if (teil.art === 'wu4') {
        t.richtung *= -1;
        protokoll(spiel, 'Die Richtung dreht.');
      }
      protokoll(spiel, 'Es liegen jetzt ' + t.strafe + ' Karten an.');
      return { bleibtDran: false, schritte: 1 };
    }

    switch (teil.art) {
      case 's':
        /* Bei zwei Spielern ist Aussetzen und Weiterrücken dasselbe — man
           kommt selbst wieder dran. Zwei Schritte tun genau das. */
        return { bleibtDran: false, schritte: 2 };

      case 'e':
        /* Alle anderen übersprungen: der Leger ist sofort wieder dran. */
        protokoll(spiel, 'Alle anderen setzen aus.');
        return { bleibtDran: true };

      case 'u':
        if (nurZwei) {
          protokoll(spiel, 'Richtungswechsel wirkt zu zweit wie Aussetzen.');
          return { bleibtDran: false, schritte: 2 };
        }
        t.richtung *= -1;
        protokoll(spiel, 'Die Richtung dreht.');
        return { bleibtDran: false, schritte: 1 };

      case 'f': {
        t.dunkel = !t.dunkel;
        t.farbe = K.teile(t.ablage, t.dunkel).farbe;
        protokoll(spiel, t.dunkel ? 'Gewendet — die dunkle Seite gilt.' : 'Zurückgewendet — die helle Seite gilt.');
        return { bleibtDran: false, schritte: 1 };
      }

      case 'a': {
        /* Alles ablegen: jede weitere Handkarte in der Farbe der gelegten
           Karte fliegt mit. Die Farbe bleibt, die oberste Karte auch. */
        const hand = spiel.haende[uid];
        const behalten = [];
        let mit = 0;
        for (const k of hand) {
          if (K.teile(k, t.dunkel).farbe === teil.farbe) { spiel.ablagestapel.push(k); mit++; }
          else behalten.push(k);
        }
        spiel.haende[uid] = behalten;
        if (mit > 0) protokoll(spiel, name(spiel, uid) + ' legt ' + mit + ' weitere ' + K.FARBNAME[teil.farbe] + '-Karten mit ab.');
        return { bleibtDran: false, schritte: 1 };
      }

      case 'wr': {
        /* Farbroulette lässt sich nicht kontern und wird deshalb sofort
           ausgeführt: der Nächste zieht, bis die gewünschte Farbe kommt. */
        const opfer = naechster(spiel);
        let gezogen = 0;
        let sicherung = 0;
        while (sicherung < 300) {
          sicherung++;
          const k = hebeAb(spiel, zufall);
          if (k === null) break;
          spiel.haende[opfer].push(k);
          gezogen++;
          if (K.teile(k, t.dunkel).farbe === wunschFarbe) break;
        }
        protokoll(spiel, name(spiel, opfer) + ' zieht ' + gezogen + ' Karten bis ' + K.FARBNAME[wunschFarbe] + '.');
        aktualisiere(spiel);
        pruefeMercy(spiel, opfer, uid);
        return { bleibtDran: false, schritte: 2 };
      }

      default:
        return { bleibtDran: false, schritte: 1 };
    }
  }

  /* ----------------------------------------------------------------------
     Der Zug: ziehen und passen
     ---------------------------------------------------------------------- */

  /**
   * Ziehen. Drei Fälle, die auseinandergehalten werden müssen:
   *
   *   1. Es liegt eine Strafe an und der Spieler kann oder will nicht
   *      kontern — er schluckt den ganzen Stapel und ist durch.
   *   2. Modus Gnadenlos ohne Strafe — er zieht so lange, bis etwas passt,
   *      und MUSS es dann legen.
   *   3. Sonst — genau eine Karte. Passt sie, darf er sie legen, sonst
   *      passen.
   */
  function ziehe(spiel, uid, zufall) {
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return { ok: false, grund: 'Die Runde ist vorbei.' };
    if (dran(spiel) !== uid) return { ok: false, grund: 'Du bist nicht dran.' };
    if (t.gezogen) return { ok: false, grund: 'Du hast in diesem Zug schon gezogen.' };

    const m = modusVon(spiel);

    if (t.strafe > 0) {
      const wieviel = t.strafe;
      const gegeben = gib(spiel, uid, wieviel, zufall);
      t.strafe = 0;
      t.strafeWert = 0;
      protokoll(spiel, name(spiel, uid) + ' nimmt ' + gegeben + ' Karten.');
      aktualisiere(spiel);
      if (!pruefeMercy(spiel, uid, letzterLeger(spiel))) {
        /* Wer die Strafe geschluckt hat, setzt aus — so ist es überall
           üblich und macht das Stapeln erst gefährlich. */
      }
      t.zugNr++;
      beendeErwischbar(spiel);
      rueckeWeiter(spiel, 1);
      aktualisiere(spiel);
      pruefeRundenEnde(spiel);
      ziehePflichtNach(spiel, zufall);
      return { ok: true, gezogen: gegeben, weiter: true };
    }

    if (m.ziehtBisPassend) {
      let gezogen = 0;
      let sicherung = 0;
      while (sicherung < 300) {
        sicherung++;
        const k = hebeAb(spiel, zufall);
        if (k === null) break;
        spiel.haende[uid].push(k);
        gezogen++;
        if (passt(t, k)) break;
      }
      protokoll(spiel, name(spiel, uid) + ' zieht ' + gezogen + ' Karten.');
      aktualisiere(spiel);
      t.gezogen = true;
      if (pruefeMercy(spiel, uid, null)) {
        t.gezogen = false;
        t.zugNr++;
        rueckeWeiter(spiel, 1);
        aktualisiere(spiel);
        pruefeRundenEnde(spiel);
        ziehePflichtNach(spiel, zufall);
        return { ok: true, gezogen: gezogen, weiter: true };
      }
      /* Er hat jetzt etwas Passendes — und muss es auch legen. */
      t.mussLegen = kannLegen(spiel, uid);
      if (!t.mussLegen) {
        /* Kein Nachschub mehr da: dann geht es einfach weiter. */
        t.gezogen = false;
        t.zugNr++;
        rueckeWeiter(spiel, 1);
        aktualisiere(spiel);
        pruefeRundenEnde(spiel);
        ziehePflichtNach(spiel, zufall);
        return { ok: true, gezogen: gezogen, weiter: true };
      }
      return { ok: true, gezogen: gezogen, weiter: false };
    }

    const gegeben = gib(spiel, uid, 1, zufall);
    aktualisiere(spiel);
    if (gegeben === 0) {
      /* Nichts mehr zu ziehen — der Zug endet, sonst hinge die Partie. */
      protokoll(spiel, 'Es sind keine Karten mehr da — ' + name(spiel, uid) + ' setzt aus.');
      t.zugNr++;
      beendeErwischbar(spiel);
      rueckeWeiter(spiel, 1);
      pruefeRundenEnde(spiel);
      ziehePflichtNach(spiel, zufall);
      return { ok: true, gezogen: 0, weiter: true };
    }
    protokoll(spiel, name(spiel, uid) + ' zieht eine Karte.');
    t.gezogen = true;
    return { ok: true, gezogen: 1, weiter: false };
  }

  /** Nach dem Ziehen weiterrücken, ohne zu legen. */
  function passe(spiel, uid, zufall) {
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return { ok: false, grund: 'Die Runde ist vorbei.' };
    if (dran(spiel) !== uid) return { ok: false, grund: 'Du bist nicht dran.' };
    if (!t.gezogen) return { ok: false, grund: 'Erst ziehen.' };
    if (t.mussLegen) return { ok: false, grund: 'Du musst die passende Karte legen.' };

    t.gezogen = false;
    t.zugNr++;
    beendeErwischbar(spiel);
    rueckeWeiter(spiel, 1);
    aktualisiere(spiel);
    pruefeRundenEnde(spiel);
    ziehePflichtNach(spiel, zufall);
    return { ok: true };
  }

  function beendeErwischbar(spiel) {
    const t = spiel.tisch;
    if (t.erwischbar && t.zugNr >= t.erwischbarBis) t.erwischbar = null;
  }

  function letzterLeger(spiel) {
    const a = spiel.tisch.anfechtbar;
    return a ? a.uid : null;
  }

  /* ----------------------------------------------------------------------
     "Letzte Karte" rufen und melden
     ---------------------------------------------------------------------- */

  /** Vor dem Legen der vorletzten Karte drücken — dann ist man sicher. */
  function rufeLetzteKarte(spiel, uid) {
    const t = spiel.tisch;
    const hand = spiel.haende[uid] || [];
    /* Zulässig, wenn genau zwei Karten auf der Hand liegen (gleich wird
       gelegt) oder schon nur noch eine (nachgeholt, solange erwischbar). */
    if (hand.length > 2) return { ok: false, grund: 'Dafür hast du noch zu viele Karten.' };
    t.uno[uid] = true;
    if (t.erwischbar === uid) t.erwischbar = null;
    protokoll(spiel, name(spiel, uid) + ' sagt: letzte Karte!');
    return { ok: true };
  }

  /** Jemanden erwischen, der vergessen hat zu rufen. */
  function melde(spiel, klaeger, ziel, zufall) {
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return { ok: false, grund: 'Die Runde ist vorbei.' };
    if (t.erwischbar !== ziel) return { ok: false, grund: 'Da ist gerade nichts zu melden.' };
    if (klaeger === ziel) return { ok: false, grund: 'Sich selbst kann man nicht melden.' };

    t.erwischbar = null;
    const gegeben = gib(spiel, ziel, UNO_STRAFE, zufall);
    protokoll(spiel, name(spiel, klaeger) + ' erwischt ' + name(spiel, ziel) + ' — ' + gegeben + ' Karten Strafe.');
    aktualisiere(spiel);
    pruefeMercy(spiel, ziel, klaeger);
    aktualisiere(spiel);
    return { ok: true };
  }

  /* ----------------------------------------------------------------------
     Anfechten
     ----------------------------------------------------------------------
     Wer eine Farbwahl-Ziehkarte legt, behauptet damit, keine Karte der
     geltenden Farbe zu haben. Der Nächste darf das prüfen lassen.
     Stimmt die Behauptung nicht, zieht der Leger; stimmt sie, zahlt der
     Ankläger drauf. Die Hand wird dabei kurz für alle offengelegt — anders
     wäre das Urteil nicht nachvollziehbar. */

  function fechteAn(spiel, klaeger, zufall) {
    const t = spiel.tisch;
    const a = t.anfechtbar;
    if (!a) return { ok: false, grund: 'Da ist nichts anzufechten.' };
    if (a.uid === klaeger) return { ok: false, grund: 'Die eigene Karte kann man nicht anfechten.' };
    if (dran(spiel) !== klaeger) return { ok: false, grund: 'Nur wer als Nächster dran ist, darf anfechten.' };
    if (t.zugNr > a.zugNr) return { ok: false, grund: 'Dafür ist es zu spät.' };

    /* Hatte er eine Karte der Farbe, die vor seinem Zug galt? */
    let hatteFarbe = false;
    for (const k of a.hand) {
      if (K.teile(k, t.dunkel).farbe === a.farbe) { hatteFarbe = true; break; }
    }

    t.aufdeckung = { uid: a.uid, hand: a.hand.slice(), farbe: a.farbe, schuldig: hatteFarbe };
    t.anfechtbar = null;

    const strafe = t.strafe;
    t.strafe = 0;
    t.strafeWert = 0;

    if (hatteFarbe) {
      const gegeben = gib(spiel, a.uid, strafe, zufall);
      protokoll(spiel, name(spiel, klaeger) + ' fechtet an — zu Recht. ' + name(spiel, a.uid) + ' zieht ' + gegeben + ' Karten.');
      aktualisiere(spiel);
      pruefeMercy(spiel, a.uid, klaeger);
      /* Der Ankläger ist regulär dran und darf legen. */
      aktualisiere(spiel);
      return { ok: true, schuldig: true };
    }

    const gegeben = gib(spiel, klaeger, strafe + ANFECHT_ZUSCHLAG, zufall);
    protokoll(spiel, name(spiel, klaeger) + ' fechtet an — zu Unrecht und zieht ' + gegeben + ' Karten.');
    aktualisiere(spiel);
    pruefeMercy(spiel, klaeger, a.uid);
    t.zugNr++;
    rueckeWeiter(spiel, 1);
    aktualisiere(spiel);
    pruefeRundenEnde(spiel);
    ziehePflichtNach(spiel, zufall);
    return { ok: true, schuldig: false };
  }

  /* ----------------------------------------------------------------------
     Zwangszüge
     ----------------------------------------------------------------------
     Nach jedem Zug kann es sein, dass der neue Dransteher gar nichts tun
     KANN — etwa weil der Nachziehstapel leer ist und nichts passt. Ohne
     diese Auflösung stünde die Partie still und niemand wüsste warum. */

  function ziehePflichtNach(spiel, zufall) {
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return;
    let sicherung = 0;
    while (sicherung < 40) {
      sicherung++;
      const uid = dran(spiel);
      if (!uid) return;
      if (t.raus[uid] || t.fertig.indexOf(uid) >= 0) { rueckeWeiter(spiel, 1); continue; }
      if (spiel.stapel.length > 0 || spiel.ablagestapel.length > 0) return;
      if (kannLegen(spiel, uid)) return;
      if (t.strafe > 0) return;   // schlucken geht immer, auch ohne Nachschub
      protokoll(spiel, name(spiel, uid) + ' kann nichts legen und nichts ziehen — übersprungen.');
      t.zugNr++;
      rueckeWeiter(spiel, 1);
      if (t.zugNr > 5000) { t.phase = 'rundeVorbei'; return; }
    }
  }

  /* ----------------------------------------------------------------------
     Rundenende und Punkte
     ---------------------------------------------------------------------- */

  function pruefeRundenEnde(spiel) {
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return;
    const m = modusVon(spiel);
    const uebrig = aktive(spiel);

    if (m.mercy) {
      /* Gnadenlos kennt ZWEI Wege zu gewinnen, und sie sehen von außen
         gleich aus, sind es aber nicht:
           'leer'          jemand ist als Erster alle Karten los und kassiert
                           die Handwerte der anderen
           'letzterUebrig' alle anderen sind an der 25er-Grenze gescheitert;
                           der Letzte gewinnt MIT Karten auf der Hand
         Ohne diese Unterscheidung sähe der zweite Fall wie ein Fehler aus —
         ein Sieger, der noch zwölf Karten hält. */
      if (t.fertig.length > 0) { t.endart = 'leer'; beendeRunde(spiel); return; }
      if (uebrig.length <= 1) {
        t.endart = 'letzterUebrig';
        if (uebrig.length === 1) t.fertig.push(uebrig[0]);
        beendeRunde(spiel);
      }
      return;
    }

    if (t.fertig.length > 0 || uebrig.length === 0) {
      t.endart = t.fertig.length > 0 ? 'leer' : 'niemand';
      beendeRunde(spiel);
    }
  }

  /**
   * Zählt ab. Der Sieger bekommt die Kartenwerte ALLER anderen Hände —
   * gezählt nach der Seite, auf der die Runde geendet hat.
   */
  function beendeRunde(spiel) {
    const t = spiel.tisch;
    t.phase = 'rundeVorbei';
    const sieger = t.fertig[0] || null;
    t.gewinner = sieger;

    let summe = 0;
    const je = {};
    for (const uid of t.reihenfolge) {
      if (uid === sieger) { je[uid] = 0; continue; }
      let p = 0;
      for (const k of (spiel.haende[uid] || [])) p += K.punkte(k, t.modus, t.dunkel);
      je[uid] = p;
      summe += p;
    }

    if (sieger) {
      t.punkte[sieger] = (t.punkte[sieger] || 0) + summe;
      protokoll(spiel, name(spiel, sieger) + ' gewinnt die Runde und bekommt ' + summe + ' Punkte.');
    }
    t.rundenPunkte = { sieger: sieger, summe: summe, je: je, endart: t.endart || 'leer' };
    aktualisiere(spiel);
  }

  /** Hat jemand das Serienziel erreicht? */
  function serieVorbei(spiel) {
    const t = spiel.tisch;
    const ziel = modusVon(spiel).zielPunkte;
    for (const uid in t.punkte) if (t.punkte[uid] >= ziel) return uid;
    return null;
  }

  /* ----------------------------------------------------------------------
     Gegenprobe für das Prüfskript
     ----------------------------------------------------------------------
     Zählt alle Karten im Umlauf. Muss IMMER die Deckgröße ergeben — Hände
     plus Nachziehstapel plus Ablagestapel plus die eine offene Karte. Wenn
     hier etwas fehlt, ist irgendwo eine Karte verschwunden oder doppelt
     vergeben worden, und genau das merkt man im Spiel erst Wochen später. */

  function zaehleKarten(spiel) {
    let n = spiel.stapel.length + spiel.ablagestapel.length + (spiel.tisch.ablage ? 1 : 0);
    for (const uid in spiel.haende) n += spiel.haende[uid].length;
    return n;
  }

  return {
    UNO_STRAFE: UNO_STRAFE,
    MERCY_BONUS: MERCY_BONUS,
    ANFECHT_ZUSCHLAG: ANFECHT_ZUSCHLAG,

    neueRunde: neueRunde,
    setzeNamen: setzeNamen,

    passt: passt,
    legbare: legbare,
    kannLegen: kannLegen,
    dran: dran,
    naechster: naechster,
    aktive: aktive,

    lege: lege,
    ziehe: ziehe,
    passe: passe,
    rufeLetzteKarte: rufeLetzteKarte,
    melde: melde,
    fechteAn: fechteAn,

    beendeRunde: beendeRunde,
    serieVorbei: serieVorbei,
    aktualisiere: aktualisiere,
    zaehleKarten: zaehleKarten,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = regeln;
