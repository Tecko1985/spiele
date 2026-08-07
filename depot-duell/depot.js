/* ==========================================================================
   Depot-Duell — Depotrechnung
   ==========================================================================

   Ein Depotwert wird NIE gespeichert, immer nur abgeleitet. Gespeichert
   werden ausschließlich die Käufe und Verkäufe als unveränderliche
   Ereignisse; Bestand, Gewinn und Platzierung entstehen daraus neu.

   Der Grund: ein fortgeschriebener Zähler ist später nicht mehr
   nachrechenbar. Läuft er einmal auseinander — durch einen verlorenen
   Schreibvorgang, einen doppelt verarbeiteten Kauf, einen Reload im
   falschen Moment — merkt es niemand, und die Rangliste lügt für den Rest
   der Partie. Aus den Ereignissen lässt sich dagegen jeder Stand jederzeit
   von jedem Gerät neu herleiten und gegenprüfen.

   Dieselbe Rechnung benutzen Oberfläche, Rangliste, Endabrechnung und die
   KI-Mitspieler. Zwei Rechenwege für dieselbe Zahl wären die sicherste Art,
   dass Anzeige und Prüfung auseinanderlaufen.
   ========================================================================== */

const depot = (function () {
  'use strict';

  const STARTBUDGET = 100000;
  const GEBUEHR_SATZ = 0.0025;   // 0,25 %
  const GEBUEHR_MIND = 1;        // mindestens 1 Euro
  const HOECHSTANTEIL = 0.25;    // je Wert, siehe pruefeKauf

  function gebuehr(betrag) {
    return Math.max(GEBUEHR_MIND, betrag * GEBUEHR_SATZ);
  }

  /* Krypto in Bruchteilen, alles andere nur in ganzen Stücken. */
  function rundeStueck(wert, stueck) {
    if (wert.art === 'krypto') return Math.floor(stueck * 1e8) / 1e8;
    return Math.floor(stueck);
  }

  /* ----------------------------------------------------------------------
     Stand zu einem Zeitpunkt

     Rechnet die Trades chronologisch durch. Muss chronologisch laufen, weil
     die Dividende von der Stückzahl abhängt, die zum Zahltag gehalten wurde
     — wer erst danach kauft, bekommt sie nicht.
     ---------------------------------------------------------------------- */
  function berechne(trades, lauf, bisTick, werteNachId) {
    let cash = STARTBUDGET;
    let gebuehrenGesamt = 0;
    let dividendenGesamt = 0;
    const bestand = {};   // id -> { stueck, einstand }

    const sortiert = (trades || []).slice().sort(function (a, b) {
      if (a.tick !== b.tick) return a.tick - b.tick;
      return (a.zeit || 0) - (b.zeit || 0);
    });

    let idx = 0;
    const bis = Math.max(0, Math.min(bisTick, markt.TICKS));

    for (let t = 0; t <= bis; t++) {
      while (idx < sortiert.length && sortiert[idx].tick <= t) {
        const h = sortiert[idx];
        idx++;
        const w = werteNachId[h.id];
        if (!w) continue;
        const kurs = markt.kurs(lauf, h.id, h.tick);
        if (!(kurs > 0)) continue;

        if (h.art === 'kauf') {
          const betrag = kurs * h.stueck;
          const g = gebuehr(betrag);
          /* Defensiv: ein Kauf, für den das Geld nicht reicht, wird
             übersprungen statt das Konto ins Minus zu ziehen. Kann nur
             auftreten, wenn jemand am Client vorbei schreibt. */
          if (betrag + g > cash + 0.0001) continue;
          cash -= betrag + g;
          gebuehrenGesamt += g;
          if (!bestand[h.id]) bestand[h.id] = { stueck: 0, einstand: 0 };
          bestand[h.id].stueck += h.stueck;
          bestand[h.id].einstand += betrag;
        } else if (h.art === 'verkauf') {
          const b = bestand[h.id];
          if (!b || b.stueck <= 0) continue;
          const stueck = Math.min(h.stueck, b.stueck);
          const betrag = kurs * stueck;
          const g = gebuehr(betrag);
          cash += betrag - g;
          gebuehrenGesamt += g;
          /* Einstand anteilig mitziehen, sonst stimmt der Gewinn der
             Restposition nach einem Teilverkauf nicht mehr. */
          b.einstand -= (b.einstand / b.stueck) * stueck;
          b.stueck -= stueck;
          if (b.stueck <= 1e-9) delete bestand[h.id];
        }
      }

      /* Dividenden einmal je simuliertem Jahr auf den dann gehaltenen
         Bestand. Ohne sie wäre die Dividendenrendite eine reine Zierzahl
         und Dividendenwerte im Spiel sinnlos. */
      if (t > 0 && t % markt.TICKS_JE_JAHR === 0) {
        for (const id in bestand) {
          const w = werteNachId[id];
          if (w && w.dividende > 0) {
            const betrag = w.dividende * bestand[id].stueck;
            cash += betrag;
            dividendenGesamt += betrag;
          }
        }
      }
    }

    /* Bewertung zum Stichtag. */
    const positionen = [];
    let anlagewert = 0;
    for (const id in bestand) {
      const b = bestand[id];
      const w = werteNachId[id];
      const kurs = markt.kurs(lauf, id, bis);
      const wert = kurs * b.stueck;
      anlagewert += wert;
      positionen.push({
        id: id,
        wert: w,
        stueck: b.stueck,
        einstand: b.einstand,
        einstandJeStueck: b.stueck > 0 ? b.einstand / b.stueck : 0,
        kurs: kurs,
        marktwert: wert,
        gewinn: wert - b.einstand,
        gewinnProzent: b.einstand > 0 ? ((wert - b.einstand) / b.einstand) * 100 : 0,
      });
    }
    positionen.sort(function (a, b) { return b.marktwert - a.marktwert; });

    const gesamt = cash + anlagewert;
    for (const p of positionen) p.anteil = gesamt > 0 ? p.marktwert / gesamt : 0;

    return {
      cash: cash,
      anlagewert: anlagewert,
      gesamt: gesamt,
      rendite: ((gesamt - STARTBUDGET) / STARTBUDGET) * 100,
      positionen: positionen,
      gebuehren: gebuehrenGesamt,
      dividenden: dividendenGesamt,
      anzahlTrades: sortiert.filter(function (h) { return h.tick <= bis; }).length,
    };
  }

  /* ----------------------------------------------------------------------
     Zwischenspeicher

     Rangliste und Depotansicht fragen denselben Stand mehrfach je Bild ab.
     Der Tick ändert sich aber nur alle 2 bis 12 Sekunden — ohne Speicher
     würde bei acht Mitspielenden jedes Bild achtmal die volle Partie
     durchgerechnet.
     ---------------------------------------------------------------------- */
  const speicher = new Map();

  function stand(schluessel, trades, lauf, bisTick, werteNachId) {
    const kennung = schluessel + '|' + bisTick + '|' + (trades ? trades.length : 0) + '|' + lauf.saat;
    const treffer = speicher.get(kennung);
    if (treffer) return treffer;
    const ergebnis = berechne(trades, lauf, bisTick, werteNachId);
    /* Klein halten: bei jedem Tick kommt je Mitspieler ein Eintrag dazu. */
    if (speicher.size > 400) speicher.clear();
    speicher.set(kennung, ergebnis);
    return ergebnis;
  }

  function leereSpeicher() { speicher.clear(); }

  /* ----------------------------------------------------------------------
     Kaufprüfung

     Gibt IMMER zurück, wie viel noch ginge — ein Kauf, der nur abgelehnt
     wird, ohne zu sagen wie viel erlaubt wäre, ist im fahrenden Bus eine
     Zumutung.

     Die 25-Prozent-Grenze wird gegen den Depotwert NACH dem Kauf gerechnet.
     Gegen den Wert davor wäre sie umgehbar: man kauft in mehreren kleinen
     Schritten und liegt nach jedem einzelnen knapp darunter, am Ende aber
     weit darüber.
     ---------------------------------------------------------------------- */
  function pruefeKauf(zustand, wert, stueck, kurs) {
    stueck = rundeStueck(wert, stueck);
    if (!(stueck > 0)) return { ok: false, grund: 'Stückzahl muss größer als null sein.', hoechstStueck: 0 };

    const betrag = kurs * stueck;
    const g = gebuehr(betrag);

    if (betrag + g > zustand.cash + 1e-9) {
      const moeglich = hoechstBezahlbar(zustand, wert, kurs);
      return {
        ok: false,
        grund: 'Dafür reicht das Guthaben nicht. Möglich sind ' + moeglich + '.',
        hoechstStueck: moeglich,
      };
    }

    /* Anteil nach dem Kauf. Der Depotwert ändert sich durch den Kauf selbst
       nur um die Gebühr — die zieht ihn minimal. */
    const bisher = bestandVon(zustand, wert.id);
    const neuerWertDerPosition = (bisher + stueck) * kurs;
    const gesamtDanach = zustand.gesamt - g;
    if (gesamtDanach > 0 && neuerWertDerPosition / gesamtDanach > HOECHSTANTEIL + 1e-9) {
      const erlaubt = hoechstNachAnteil(zustand, wert, kurs);
      return {
        ok: false,
        grund:
          'Höchstens ' + Math.round(HOECHSTANTEIL * 100) + ' % des Depots dürfen in einem Wert stecken. ' +
          (erlaubt > 0 ? 'Möglich sind noch ' + erlaubt + '.' : 'Diese Position ist bereits voll.'),
        hoechstStueck: erlaubt,
      };
    }

    return { ok: true, betrag: betrag, gebuehr: g, stueck: stueck };
  }

  function bestandVon(zustand, id) {
    const p = zustand.positionen.find(function (x) { return x.id === id; });
    return p ? p.stueck : 0;
  }

  function hoechstBezahlbar(zustand, wert, kurs) {
    /* Gebühr ist anteilig, deshalb einmal auflösen statt zu probieren. */
    const roh = zustand.cash / (kurs * (1 + GEBUEHR_SATZ));
    return rundeStueck(wert, Math.max(0, roh - (wert.art === 'krypto' ? 0 : 0)));
  }

  function hoechstNachAnteil(zustand, wert, kurs) {
    const bisher = bestandVon(zustand, wert.id);
    /* Erlaubter Positionswert bezogen auf den Depotwert (Gebühr vernachlässigt,
       sie verschiebt die Grenze um Promille). */
    const erlaubterWert = zustand.gesamt * HOECHSTANTEIL;
    const restWert = erlaubterWert - bisher * kurs;
    if (restWert <= 0) return 0;
    return rundeStueck(wert, restWert / kurs);
  }

  /** Wie viele Stücke sind unter allen Regeln zusammen möglich? */
  function hoechstKaufbar(zustand, wert, kurs) {
    if (!(kurs > 0)) return 0;
    return Math.min(hoechstBezahlbar(zustand, wert, kurs), hoechstNachAnteil(zustand, wert, kurs));
  }

  function pruefeVerkauf(zustand, wert, stueck) {
    const bestand = bestandVon(zustand, wert.id);
    if (bestand <= 0) return { ok: false, grund: 'Diesen Wert hältst du nicht.', hoechstStueck: 0 };
    stueck = rundeStueck(wert, stueck);
    if (!(stueck > 0)) return { ok: false, grund: 'Stückzahl muss größer als null sein.', hoechstStueck: bestand };
    if (stueck > bestand + 1e-9) {
      return { ok: false, grund: 'So viele hältst du nicht. Möglich sind ' + bestand + '.', hoechstStueck: bestand };
    }
    return { ok: true, stueck: stueck };
  }

  return {
    STARTBUDGET: STARTBUDGET,
    GEBUEHR_SATZ: GEBUEHR_SATZ,
    GEBUEHR_MIND: GEBUEHR_MIND,
    HOECHSTANTEIL: HOECHSTANTEIL,
    gebuehr: gebuehr,
    rundeStueck: rundeStueck,
    berechne: berechne,
    stand: stand,
    leereSpeicher: leereSpeicher,
    pruefeKauf: pruefeKauf,
    pruefeVerkauf: pruefeVerkauf,
    hoechstKaufbar: hoechstKaufbar,
    bestandVon: bestandVon,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = depot;
