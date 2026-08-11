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

  /* ----------------------------------------------------------------------
     Spielregeln

     Werden beim Eröffnen im Raum festgehalten und von dort gelesen — nicht
     hier als Konstante. Sonst spielten zwei Geräte mit unterschiedlichem
     Programmstand dieselbe Partie nach verschiedenen Regeln, und die
     Rangliste wäre stillschweigend falsch.

     Die Vorgabe greift für Räume, die vor der Einstellbarkeit angelegt
     wurden, und für die Testskripte.
     ---------------------------------------------------------------------- */
  const VORGABE = {
    startgeld: 100000,
    gebuehrSatz: 0.0025,      // 0,25 %
    gebuehrMind: 1,           // mindestens 1 Euro
    hoechstanteil: 0.25,      // je Wert, siehe pruefeKauf
    startdepotAnteil: 0.10,   // schon angelegt zu Partiebeginn, siehe startdepot
  };

  /* Nimmt an, was gültig ist, und füllt den Rest aus der Vorgabe. Ein
     einzelnes fehlendes Feld darf nicht die ganze Partie unbrauchbar machen. */
  function normiereRegeln(r) {
    if (!r) return Object.assign({}, VORGABE);
    return {
      startgeld: r.startgeld > 0 ? r.startgeld : VORGABE.startgeld,
      gebuehrSatz: r.gebuehrSatz >= 0 ? r.gebuehrSatz : VORGABE.gebuehrSatz,
      gebuehrMind: r.gebuehrMind >= 0 ? r.gebuehrMind : VORGABE.gebuehrMind,
      hoechstanteil: r.hoechstanteil > 0 && r.hoechstanteil <= 1
        ? r.hoechstanteil : VORGABE.hoechstanteil,
      /* Null ist ein gültiger Wert (kein Startdepot) und muss deshalb die
         Vorgabe schlagen — anders als bei den Feldern darüber, wo null
         unsinnig wäre. */
      startdepotAnteil: r.startdepotAnteil >= 0 && r.startdepotAnteil < 1
        ? r.startdepotAnteil : VORGABE.startdepotAnteil,
    };
  }

  function gebuehr(betrag, regeln) {
    const R = regeln || VORGABE;
    if (!R.gebuehrSatz && !R.gebuehrMind) return 0;
    return Math.max(R.gebuehrMind, betrag * R.gebuehrSatz);
  }

  /* Krypto in Bruchteilen, alles andere nur in ganzen Stücken. */
  function rundeStueck(wert, stueck) {
    if (wert.art === 'krypto') return Math.floor(stueck * 1e8) / 1e8;
    return Math.floor(stueck);
  }

  /* ----------------------------------------------------------------------
     Startdepot

     Wer bei null anfängt, hat in der ersten Runde nichts zu entscheiden:
     eine Schlagzeile über einen Wert, den man nicht hält, ist bloß eine
     Kaufempfehlung. Deshalb liegt zu Partiebeginn ein Teil des Geldes
     bereits in sechs Positionen — drei Aktien, zwei ETFs, eine
     Kryptowährung. Damit steht schon vor der ersten Freigabe die Frage im
     Raum, was man behält und was man loswird.

     Das Depot wird NICHT gespeichert, sondern wie alles andere in diesem
     Spiel aus der Saat abgeleitet — hier zusätzlich aus der uid, damit
     jeder ein eigenes bekommt und trotzdem jedes Gerät für jeden
     Mitspieler dasselbe rechnet. Übertragen wird dafür kein einziges Byte.

     Gekauft wird zum Kurs der Runde 0 und ohne Gebühr. Der Depotwert zu
     Beginn ist damit auf den Cent das Startgeld, und niemand steht mit
     einer Rendite unter null da, bevor er das erste Mal gehandelt hat.
     ---------------------------------------------------------------------- */
  const STARTDEPOT_MISCHUNG = [
    { art: 'aktie', anzahl: 3 },
    { art: 'etf', anzahl: 2 },
    { art: 'krypto', anzahl: 1 },
  ];
  const STARTDEPOT_POSITIONEN = STARTDEPOT_MISCHUNG.reduce(function (s, m) {
    return s + m.anzahl;
  }, 0);

  /* Aus der uid eine Zahl. Muss auf jedem Gerät dieselbe sein, deshalb von
     Hand gerechnet und nicht aus der Laufzeitumgebung geholt. */
  function saatVonUid(uid) {
    const s = String(uid || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* Die Werte nach Art, innerhalb der Art nach id sortiert.

     Die Reihenfolge MUSS unabhängig davon sein, wie das Verzeichnis
     zusammengesetzt wurde: würfelte man über Object.keys, hinge das
     Startdepot daran, in welcher Reihenfolge die Werteliste einmal gebaut
     wurde — und eine spätere Umsortierung in werte.js verschöbe rückwirkend
     jedes Startdepot, ohne dass irgendetwas nach einer Änderung aussieht. */
  const artenSpeicher = new WeakMap();
  function nachArt(werteNachId) {
    const treffer = artenSpeicher.get(werteNachId);
    if (treffer) return treffer;
    const raus = {};
    for (const id of Object.keys(werteNachId).sort()) {
      const w = werteNachId[id];
      if (!w || !w.art) continue;
      if (!raus[w.art]) raus[w.art] = [];
      raus[w.art].push(w);
    }
    artenSpeicher.set(werteNachId, raus);
    return raus;
  }

  /* Je Mitspieler einmal gerechnet. Ohne Speicher liefe die Auswahl bei
     jedem Durchrechnen erneut — und die Bots rechnen ihre Züge rundenweise
     durch, also hundertfach je Partie. */
  const startdepotSpeicher = new Map();

  /**
   * Die Käufe, mit denen ein Mitspieler in die Partie startet.
   * @returns {Array} Trades in Runde 0, oder [] wenn die Regel aus ist.
   */
  function startdepot(lauf, uid, werteNachId, regeln) {
    const R = normiereRegeln(regeln);
    if (!lauf || !uid || !werteNachId) return [];
    if (!(R.startdepotAnteil > 0) || !(R.startgeld > 0)) return [];

    const kennung = lauf.saat + '|' + uid + '|' + R.startgeld + '|' + R.startdepotAnteil;
    const treffer = startdepotSpeicher.get(kennung);
    if (treffer) return treffer;

    const rng = markt.zufallsgeber((lauf.saat ^ saatVonUid(uid)) >>> 0);
    const koerbe = nachArt(werteNachId);
    const budget = (R.startgeld * R.startdepotAnteil) / STARTDEPOT_POSITIONEN;
    const trades = [];

    for (const m of STARTDEPOT_MISCHUNG) {
      /* Nur Werte, von denen mindestens ein Stück ins Budget passt. Sonst
         käme bei einer 4.000-Euro-Aktie eine Position über null Stücke
         heraus, und das Depot hätte stillschweigend fünf Einträge statt
         sechs — bei kleinem Startgeld für jeden anders. */
      const topf = (koerbe[m.art] || []).filter(function (w) {
        const k = markt.kurs(lauf, w.id, 0);
        return k > 0 && rundeStueck(w, budget / k) > 0;
      });
      for (let i = 0; i < m.anzahl && topf.length; i++) {
        const w = topf.splice(Math.floor(rng() * topf.length), 1)[0];
        const kurs = markt.kurs(lauf, w.id, 0);
        const stueck = rundeStueck(w, budget / kurs);
        if (!(stueck > 0)) continue;
        trades.push({
          id: w.id,
          art: 'kauf',
          stueck: stueck,
          runde: 0,
          zeit: 0,            // vor jedem echten Trade, der eine Serverzeit trägt
          ohneGebuehr: true,
          start: true,
        });
      }
    }

    if (startdepotSpeicher.size > 200) startdepotSpeicher.clear();
    startdepotSpeicher.set(kennung, trades);
    return trades;
  }

  /* ----------------------------------------------------------------------
     Stand zu einem Zeitpunkt

     Rechnet die Trades chronologisch durch. Muss chronologisch laufen, weil
     die Dividende von der Stückzahl abhängt, die zum Zahltag gehalten wurde
     — wer erst danach kauft, bekommt sie nicht.
     ---------------------------------------------------------------------- */
  function berechne(trades, lauf, bisRunde, werteNachId, regeln, uid) {
    const R = normiereRegeln(regeln);
    let cash = R.startgeld;
    let gebuehrenGesamt = 0;
    let dividendenGesamt = 0;
    const bestand = {};   // id -> { stueck, einstand }

    /* Das Startdepot wird nicht übergeben, sondern hier abgeleitet — an
       EINER Stelle, damit Depotansicht, Rangliste, Endabrechnung und die
       KI-Mitspieler unmöglich mit verschiedenen Startbeständen rechnen
       können. */
    const eigene = (trades || []).slice();
    const vorgelegt = startdepot(lauf, uid, werteNachId, R);
    const startIds = {};
    for (const h of vorgelegt) startIds[h.id] = true;

    /* Das Startdepot steht VORN, nicht nur wegen `zeit: 0`. Die Züge der
       KI tragen überhaupt keine Zeit; bei Gleichstand entscheidet die
       Eingangsreihenfolge (sort ist stabil), und ein Verkauf in Runde 0
       liefe sonst ins Leere, weil der Bestand noch nicht da wäre. */
    const sortiert = vorgelegt.concat(eigene).sort(function (a, b) {
      if (a.runde !== b.runde) return a.runde - b.runde;
      return (a.zeit || 0) - (b.zeit || 0);
    });

    let idx = 0;
    const bis = Math.max(0, Math.min(bisRunde, lauf.runden));

    for (let t = 0; t <= bis; t++) {
      while (idx < sortiert.length && sortiert[idx].runde <= t) {
        const h = sortiert[idx];
        idx++;
        const w = werteNachId[h.id];
        if (!w) continue;
        const kurs = markt.kurs(lauf, h.id, h.runde);
        if (!(kurs > 0)) continue;

        if (h.art === 'kauf') {
          const betrag = kurs * h.stueck;
          /* Das Startdepot ist gestellt, keine Order — sonst begänne jeder
             mit einer Rendite unter null, ohne etwas getan zu haben. */
          const g = h.ohneGebuehr ? 0 : gebuehr(betrag, R);
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
          const g = gebuehr(betrag, R);
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
      if (t > 0 && t % lauf.rundenJeJahr === 0) {
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
        ausStart: !!startIds[id],
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

    /* Auf Cent runden, und zwar BEVOR irgendwer vergleicht.

       Sechs Startkäufe ziehen sechsmal vom Bargeld ab und addieren sechs
       Positionswerte wieder auf — rechnerisch dasselbe, in Fließkomma aber
       nicht: heraus kam 99.999,99999999999 statt 100.000. In der Rangliste
       stand der Mensch damit hinter zwei KI-Mitspielern, die nichts anderes
       getan hatten, und die Renditespalte zeigte "-0,0 %".

       Gerundet wird nur der Vergleichs- und Anzeigewert. `cash` bleibt roh:
       ein aufgerundetes Guthaben ließe die Kaufprüfung einen Auftrag
       durchwinken, den die Verbuchung danach still verwirft. */
    const gesamt = Math.round((cash + anlagewert) * 100) / 100;
    for (const p of positionen) p.anteil = gesamt > 0 ? p.marktwert / gesamt : 0;

    return {
      cash: cash,
      anlagewert: anlagewert,
      gesamt: gesamt,
      rendite: ((gesamt - R.startgeld) / R.startgeld) * 100,
      positionen: positionen,
      gebuehren: gebuehrenGesamt,
      dividenden: dividendenGesamt,
      /* Nur die eigenen Aufträge. Das gestellte Startdepot mitzuzählen
         würde in der Rangliste als Handeln erscheinen, das nie stattfand. */
      anzahlTrades: eigene.filter(function (h) { return h.runde <= bis; }).length,
      startdepot: vorgelegt.length,
      /* Die Regeln reisen im Ergebnis mit. Dadurch braucht keine der
         Pruefungen unten einen zusaetzlichen Parameter — und es kann nicht
         passieren, dass ein Stand nach den einen und die Kaufpruefung nach
         anderen Regeln rechnet. */
      regeln: R,
    };
  }

  /* ----------------------------------------------------------------------
     Zwischenspeicher

     Rangliste und Depotansicht fragen denselben Stand mehrfach je Bild ab.
     Die Runde wechselt aber nur, wenn alle zugestimmt haben — ohne Speicher
     würde bei acht Mitspielenden jedes Bild achtmal die volle Partie
     durchgerechnet.
     ---------------------------------------------------------------------- */
  const speicher = new Map();

  function stand(schluessel, trades, lauf, bisRunde, werteNachId, regeln, uid) {
    const R = normiereRegeln(regeln);
    /* Die Regeln MUESSEN in den Schluessel: sonst liefert der Speicher nach
       einer Regelaenderung stillschweigend den Stand der alten Regeln.
       Die uid ebenso — sie entscheidet ueber das Startdepot. */
    const kennung = schluessel + '|' + (uid || '') + '|' + bisRunde + '|' + (trades ? trades.length : 0) + '|' + lauf.saat +
      '|' + R.startgeld + '|' + R.gebuehrSatz + '|' + R.gebuehrMind + '|' + R.hoechstanteil +
      '|' + R.startdepotAnteil;
    const treffer = speicher.get(kennung);
    if (treffer) return treffer;
    const ergebnis = berechne(trades, lauf, bisRunde, werteNachId, R, uid);
    /* Klein halten: bei jeder Runde kommt je Mitspieler ein Eintrag dazu. */
    if (speicher.size > 400) speicher.clear();
    speicher.set(kennung, ergebnis);
    return ergebnis;
  }

  function leereSpeicher() { speicher.clear(); startdepotSpeicher.clear(); }

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

    const R = zustand.regeln || VORGABE;
    const betrag = kurs * stueck;
    const g = gebuehr(betrag, R);

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
    if (gesamtDanach > 0 && neuerWertDerPosition / gesamtDanach > R.hoechstanteil + 1e-9) {
      const erlaubt = hoechstNachAnteil(zustand, wert, kurs);
      return {
        ok: false,
        grund:
          'Höchstens ' + Math.round(R.hoechstanteil * 100) + ' % des Depots dürfen in einem Wert stecken. ' +
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
    const roh = zustand.cash / (kurs * (1 + (zustand.regeln || VORGABE).gebuehrSatz));
    return rundeStueck(wert, Math.max(0, roh - (wert.art === 'krypto' ? 0 : 0)));
  }

  function hoechstNachAnteil(zustand, wert, kurs) {
    const bisher = bestandVon(zustand, wert.id);
    /* Erlaubter Positionswert bezogen auf den Depotwert (Gebühr vernachlässigt,
       sie verschiebt die Grenze um Promille). */
    const erlaubterWert = zustand.gesamt * (zustand.regeln || VORGABE).hoechstanteil;
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
    VORGABE: VORGABE,
    STARTDEPOT_MISCHUNG: STARTDEPOT_MISCHUNG,
    STARTDEPOT_POSITIONEN: STARTDEPOT_POSITIONEN,
    normiereRegeln: normiereRegeln,
    gebuehr: gebuehr,
    rundeStueck: rundeStueck,
    startdepot: startdepot,
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
