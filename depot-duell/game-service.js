/* ==========================================================================
   Depot-Duell — Firebase-Anbindung
   ==========================================================================

   ÜBERTRAGEN WIRD NUR, WAS SICH NICHT ABLEITEN LÄSST.

   Kurse, Meldungen und alle Bot-Züge entstehen auf jedem Gerät aus der Saat
   des Raums — davon geht kein einziges Byte über das Netz. Gespeichert
   werden nur die Käufe und Verkäufe der Menschen und ihre Zustimmung zur
   nächsten Runde.

   DIE RUNDE WIRD NICHT GESPEICHERT, SIE WIRD ABGELEITET.
   Es gibt kein Feld `runde` im Raum. Stattdessen trägt jeder ein, dass er
   mit Runde n fertig ist; die laufende Runde ist die Zahl der Runden, für
   die ALLE Zustimmungen vorliegen. Der Vorteil ist nicht theoretisch: gäbe
   es einen Zähler, müsste ihn jemand hochzählen — und wenn ausgerechnet
   dieser jemand im Funkloch sitzt, steht die Partie für alle still. So
   rechnet jedes Gerät die Runde selbst aus denselben Ereignissen aus.

   DIE UHR KOMMT VOM SERVER, NICHT VOM HANDY.
   Sowohl die Zustimmungen als auch die Trades tragen einen Zeitstempel, den
   Firebase selbst setzt (`.sv: timestamp`). Zu welcher Runde ein Kauf
   gehört, ergibt sich aus dem Vergleich beider — nie aus einer Angabe des
   Clients. Ein Gerät mit verstellter Uhr kann sich damit keinen günstigeren
   Kurs erschleichen.

   ⚠️ Firebase liest die Rules NICHT aus dem Repo. `database.rules.json` muss
   von Hand in der Konsole veröffentlicht werden, sonst ist das Spiel live
   tot: die Wurzel steht auf false/false.
   ========================================================================== */

const gameService = (function () {
  'use strict';

  const NAMENSRAUM = 'depotDuell';
  const RAEUME_PFAD = NAMENSRAUM + '/raeume';
  const TRADES_PFAD = NAMENSRAUM + '/trades';
  const BEREIT_PFAD = NAMENSRAUM + '/bereit';
  const WEITER_PFAD = NAMENSRAUM + '/weiter';

  /* Eigener Schlüssel — alle Spiele des Hubs teilen sich Origin UND
     Pfadpräfix, ein geteilter Name würde die Räume gegenseitig überschreiben. */
  const SPEICHER_SCHLUESSEL = 'spiele_depotduell_raumcode';

  /* Ohne 0/O und 1/I: der Code wird im fahrenden Bus vorgelesen. */
  const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const MAX_SPIELER = 10;

  /* Die drei wählbaren Partielängen. Eine Runde ist immer derselbe
     Zeitsprung (zehn Runden = ein Börsenjahr), eine lange Partie ist also
     kein anderes Spiel, sondern ein längerer Ausschnitt derselben Welt. */
  const RUNDENSTUFEN = [
    { runden: 20, name: 'Kurz', unter: '2 Jahre' },
    { runden: 50, name: 'Normal', unter: '5 Jahre' },
    { runden: 100, name: 'Lang', unter: '10 Jahre' },
  ];

  function stufeFuer(runden) {
    for (const s of RUNDENSTUFEN) if (s.runden === runden) return s;
    return RUNDENSTUFEN[1];
  }

  let eigeneUid = null;
  let zeitVersatz = 0;          // Serverzeit minus Gerätezeit
  let aktuellerCode = null;
  let raumRef = null;
  let tradesRef = null;
  let bereitRef = null;
  let weiterRef = null;
  let raumZustand = null;
  let alleTrades = {};          // uid -> Liste
  let bereitDaten = {};         // runde -> { uid: {zeit} }
  let weiterDaten = {};         // runde -> { zeit }
  let melder = null;
  let raumHorcher = null;
  let tradesHorcher = null;
  let bereitHorcher = null;
  let weiterHorcher = null;

  /* ----------------------------------------------------------------------
     Anmeldung und Uhr
     ---------------------------------------------------------------------- */

  const bereit = new Promise(function (aufloesen) {
    auth.onAuthStateChanged(function (nutzer) {
      if (nutzer) { eigeneUid = nutzer.uid; aufloesen(nutzer.uid); }
    });
  });
  auth.signInAnonymously().catch(function (f) {
    console.error('Anonyme Anmeldung fehlgeschlagen:', f);
  });

  db.ref('.info/serverTimeOffset').on('value', function (schnappschuss) {
    zeitVersatz = schnappschuss.val() || 0;
  });

  function serverJetzt() { return Date.now() + zeitVersatz; }

  /* ----------------------------------------------------------------------
     Die Runde — abgeleitet, nie gespeichert

     Diese drei Funktionen sind der Kern des Rundenmodus. Anzeige,
     Kaufprüfung und Auswertung müssen zwingend dieselben benutzen: rechnete
     die Anzeige anders als die Verbuchung, zeigte das Spiel einen Kurs an
     und rechnete mit einem anderen.
     ---------------------------------------------------------------------- */

  /* Wer zählt mit? Wer die laufende Partie verlassen hat, blockiert sie
     nicht länger — sein Depot bleibt aber in der Rangliste stehen, denn
     seine Trades sind gemacht und gehören zum Ergebnis. */
  function aktiveSpieler() {
    if (!raumZustand || !raumZustand.spieler) return [];
    const raus = [];
    for (const uid in raumZustand.spieler) {
      if (!raumZustand.spieler[uid].raus) raus.push(uid);
    }
    return raus;
  }

  /**
   * Wann wurde Runde `r` freigegeben? Serverzeit, oder Infinity solange sie
   * noch läuft.
   *
   * Freigegeben ist sie, sobald ENTWEDER alle aktiven Spieler zugestimmt
   * haben ODER der Host weitergeschaltet hat. Maßgeblich ist der frühere
   * der beiden Momente — sonst könnte ein Erzwingen im Nachhinein Trades in
   * eine andere Runde schieben, die längst zum alten Kurs abgerechnet waren.
   */
  function rundenEnde(r) {
    let ende = Infinity;

    const b = bereitDaten[r];
    if (b) {
      const menschen = aktiveSpieler();
      let alle = menschen.length > 0;
      let spaetester = 0;
      for (const uid of menschen) {
        const e = b[uid];
        if (!e) { alle = false; break; }
        if (e.zeit > spaetester) spaetester = e.zeit;
      }
      if (alle) ende = spaetester;
    }

    const w = weiterDaten[r];
    if (w && w.zeit && w.zeit < ende) ende = w.zeit;

    return ende;
  }

  /* Die laufende Runde: so viele Runden, wie vollständig freigegeben sind. */
  function aktuelleRunde() {
    if (!raumZustand || raumZustand.phase === 'lobby') return 0;
    const max = raumZustand.runden || markt.STANDARD_RUNDEN;
    let r = 0;
    while (r < max && rundenEnde(r) !== Infinity) r++;
    return r;
  }

  /* Zu welcher Runde gehört ein Trade? Ausschließlich aus Serverzeiten
     abgeleitet — der Client teilt seine Runde nie mit. */
  function rundeAus(zeitpunkt) {
    if (!raumZustand) return 0;
    const max = raumZustand.runden || markt.STANDARD_RUNDEN;
    let r = 0;
    while (r < max) {
      const e = rundenEnde(r);
      if (!(e <= zeitpunkt)) break;
      r++;
    }
    return r;
  }

  /* Habe ich diese Runde schon abgeschlossen? Danach ist Handeln gesperrt:
     sonst könnte man abwarten, bis alle anderen fertig sind, und im letzten
     Moment noch kaufen, während niemand mehr reagieren kann. */
  function habeAbgeschlossen(r) {
    const b = bereitDaten[r];
    return !!(b && eigeneUid && b[eigeneUid]);
  }

  /* Auf wen wartet die Runde noch? Für die Anzeige unter dem Knopf. */
  function fehlendeNamen(r) {
    if (!raumZustand || !raumZustand.spieler) return [];
    const b = bereitDaten[r] || {};
    const raus = [];
    for (const uid of aktiveSpieler()) {
      if (!b[uid]) raus.push(raumZustand.spieler[uid].name);
    }
    return raus;
  }

  function partieVorbei() {
    if (!raumZustand) return false;
    if (raumZustand.phase === 'beendet') return true;
    if (raumZustand.phase !== 'laeuft') return false;
    /* Sind alle ausgestiegen, ist die Partie zu Ende — sonst liefe sie mit
       einer leeren Bereitschaftsprüfung sofort bis zur letzten Runde durch. */
    if (!aktiveSpieler().length) return true;
    return aktuelleRunde() >= (raumZustand.runden || markt.STANDARD_RUNDEN);
  }

  /* ----------------------------------------------------------------------
     Raum anlegen und betreten
     ---------------------------------------------------------------------- */

  function erzeugeCode() {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ZEICHEN[Math.floor(Math.random() * CODE_ZEICHEN.length)];
    return code;
  }

  async function freierCode() {
    for (let versuch = 0; versuch < 5; versuch++) {
      const code = erzeugeCode();
      const s = await db.ref(RAEUME_PFAD + '/' + code).once('value');
      if (!s.exists()) return code;
    }
    throw new Error('Konnte keinen freien Raum-Code finden.');
  }

  /**
   * Legt einen Raum an.
   * @param {string} name    Anzeigename des Eröffners
   * @param {object} entwurf { runden, botAnzahl, startgeld, gebuehrSatz,
   *                           gebuehrMind, hoechstanteil }
   *
   * Die Regeln wandern MIT IN DEN RAUM. Läge Startgeld oder Gebühr als
   * Konstante im Programm, spielten zwei Geräte mit unterschiedlichem Stand
   * dieselbe Partie nach verschiedenen Regeln — und die Rangliste wäre
   * stillschweigend falsch, ohne dass irgendetwas nach einem Fehler aussieht.
   */
  async function erstelleRaum(name, entwurf) {
    await bereit;
    const e = entwurf || {};
    const code = await freierCode();

    /* Die Saat ist die einzige Zahl, aus der die ganze Partie entsteht.
       Hier darf Math.random stehen — sie wird EINMAL gezogen und dann
       verteilt; ab da ist alles bestimmt. */
    const saat = Math.floor(Math.random() * 0xffffffff) >>> 0;

    const raum = {
      hostId: eigeneUid,
      erstellt: firebase.database.ServerValue.TIMESTAMP,
      phase: 'lobby',
      saat: saat,
      runden: markt.normiereRunden(e.runden),
      botAnzahl: Math.max(0, Math.min(5, e.botAnzahl | 0)),
      regeln: depot.normiereRegeln(e),
      startZeit: 0,
      spieler: {},
    };
    raum.spieler[eigeneUid] = { name: name, beigetreten: firebase.database.ServerValue.TIMESTAMP };

    await db.ref(RAEUME_PFAD + '/' + code).set(raum);
    merkeCode(code);
    horcheAufRaum(code);
    return code;
  }

  async function betreteRaum(code, name) {
    await bereit;
    code = String(code || '').trim().toUpperCase();
    if (code.length !== 6) throw new Error('Ein Raum-Code hat sechs Zeichen.');

    const s = await db.ref(RAEUME_PFAD + '/' + code).once('value');
    const raum = s.val();
    if (!raum) throw new Error('Diesen Raum gibt es nicht.');

    const dabei = raum.spieler && raum.spieler[eigeneUid];
    /* Wer schon drin ist, darf immer zurück — sonst sperrt ein Neuladen
       mitten in der Partie aus dem eigenen Depot aus. */
    if (!dabei) {
      if (raum.phase !== 'lobby') throw new Error('Diese Partie läuft bereits.');
      if (raum.spieler && Object.keys(raum.spieler).length >= MAX_SPIELER) {
        throw new Error('Der Raum ist voll.');
      }
      await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).set({
        name: name,
        beigetreten: firebase.database.ServerValue.TIMESTAMP,
      });
    }

    merkeCode(code);
    horcheAufRaum(code);
    return code;
  }

  /**
   * Startet die Partie. Nur der Host.
   *
   * ⚠️ Verlässt sich NICHT auf `raumZustand`: unmittelbar nach dem Anlegen
   * hat der Horcher noch nicht gefeuert, das Feld ist dann null und der
   * Start liefe still ins Leere. Genau daran ist der Solo-Modus hängen
   * geblieben — er ruft `starteRaum` direkt nach `erstelleRaum` auf, und in
   * der Lobby blieb dann eine Partie stehen, die niemand losschicken
   * konnte. Ein Rennen, das mal aufging und mal nicht.
   */
  async function starteRaum() {
    await bereit;
    if (!aktuellerCode) return;
    let raum = raumZustand;
    if (!raum) {
      const s = await db.ref(RAEUME_PFAD + '/' + aktuellerCode).once('value');
      raum = s.val();
    }
    if (!raum || raum.hostId !== eigeneUid || raum.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode).update({
      phase: 'laeuft',
      startZeit: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  /* ----------------------------------------------------------------------
     Runde abschließen
     ---------------------------------------------------------------------- */

  /**
   * Meldet, dass man mit der laufenden Runde fertig ist. Sobald alle
   * aktiven Spieler das getan haben, springt die Runde auf jedem Gerät von
   * selbst weiter — es gibt niemanden, der sie weiterschaltet.
   */
  async function schliesseRundeAb() {
    await bereit;
    if (!aktuellerCode || !raumZustand || raumZustand.phase !== 'laeuft') return;
    const r = aktuelleRunde();
    if (r >= (raumZustand.runden || markt.STANDARD_RUNDEN)) return;
    if (habeAbgeschlossen(r)) return;
    await db.ref(BEREIT_PFAD + '/' + aktuellerCode + '/' + r + '/' + eigeneUid).set({
      zeit: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  /**
   * Der Host schaltet weiter, ohne auf alle zu warten. Notwendig, weil sonst
   * ein einziger Mitspieler, dessen Handy im Rucksack liegt, die Partie für
   * alle anderen dauerhaft anhält.
   */
  async function schalteWeiter() {
    await bereit;
    if (!aktuellerCode || !raumZustand) return;
    if (raumZustand.hostId !== eigeneUid || raumZustand.phase !== 'laeuft') return;
    const r = aktuelleRunde();
    if (r >= (raumZustand.runden || markt.STANDARD_RUNDEN)) return;
    await db.ref(WEITER_PFAD + '/' + aktuellerCode + '/' + r).set({
      zeit: firebase.database.ServerValue.TIMESTAMP,
      von: eigeneUid,
    });
  }

  /* ----------------------------------------------------------------------
     Handel
     ---------------------------------------------------------------------- */

  /**
   * Schreibt einen Kauf oder Verkauf.
   * Die Runde wird NICHT mitgeschickt — sie entsteht beim Lesen aus dem
   * Vergleich der Serverzeiten. Was der Client für die aktuelle Runde hält,
   * ist nur seine Anzeige; verbindlich ist der Server.
   */
  async function handle(art, wertId, stueck) {
    await bereit;
    if (!aktuellerCode) throw new Error('Du bist in keinem Raum.');
    if (!raumZustand || raumZustand.phase !== 'laeuft') throw new Error('Es läuft gerade keine Partie.');
    const r = aktuelleRunde();
    if (r >= (raumZustand.runden || markt.STANDARD_RUNDEN)) throw new Error('Die Partie ist vorbei.');
    if (habeAbgeschlossen(r)) throw new Error('Du hast diese Runde bereits abgeschlossen.');

    const eintrag = {
      art: art,
      id: wertId,
      stueck: stueck,
      zeit: firebase.database.ServerValue.TIMESTAMP,
    };
    await db.ref(TRADES_PFAD + '/' + aktuellerCode + '/' + eigeneUid).push(eintrag);
  }

  /* ----------------------------------------------------------------------
     Zuhören
     ---------------------------------------------------------------------- */

  /* Trades neu einordnen. Muss nach JEDER Änderung an Trades, Bereitschaft
     oder Spielerliste laufen: die Runde eines Trades hängt davon ab, wann
     die Runden endeten — und das kann sich rückwirkend noch klären, wenn
     eine Zustimmung verspätet eintrifft. */
  function ordneTradesEin(roh) {
    alleTrades = {};
    for (const uid in roh) {
      const liste = [];
      for (const schluessel in roh[uid]) {
        const e = roh[uid][schluessel];
        if (!e || !e.id || !(e.stueck > 0)) continue;
        liste.push({
          art: e.art,
          id: e.id,
          stueck: e.stueck,
          zeit: e.zeit || 0,
          /* HIER entsteht die verbindliche Runde — aus Serverzeiten. */
          runde: rundeAus(e.zeit || 0),
        });
      }
      liste.sort(function (a, b) { return a.zeit - b.zeit; });
      alleTrades[uid] = liste;
    }
    depot.leereSpeicher();
  }

  let tradesRoh = {};

  function horcheAufRaum(code) {
    loeseHorcher();
    aktuellerCode = code;
    raumRef = db.ref(RAEUME_PFAD + '/' + code);
    tradesRef = db.ref(TRADES_PFAD + '/' + code);
    bereitRef = db.ref(BEREIT_PFAD + '/' + code);
    weiterRef = db.ref(WEITER_PFAD + '/' + code);

    raumHorcher = raumRef.on('value', function (s) {
      const raum = s.val();
      if (!raum) {
        /* Der Raum wurde aufgeräumt — zurück auf Anfang statt in einem
           Zustand hängen zu bleiben, der nicht mehr existiert. */
        verlasseLokal();
        melde();
        return;
      }
      raumZustand = raum;
      /* Die Spielerliste bestimmt mit, wann eine Runde endet — tritt jemand
         bei oder steigt aus, verschiebt sich womöglich die Zuordnung. */
      ordneTradesEin(tradesRoh);
      melde();
    });

    /* Trades des ganzen Raums: jedes Gerät braucht sie, um die Rangliste
       selbst zu rechnen. Ein Depotwert wird nie geschrieben. */
    tradesHorcher = tradesRef.on('value', function (s) {
      tradesRoh = s.val() || {};
      ordneTradesEin(tradesRoh);
      melde();
    });

    bereitHorcher = bereitRef.on('value', function (s) {
      bereitDaten = s.val() || {};
      ordneTradesEin(tradesRoh);
      melde();
    });

    weiterHorcher = weiterRef.on('value', function (s) {
      weiterDaten = s.val() || {};
      ordneTradesEin(tradesRoh);
      melde();
    });
  }

  function loeseHorcher() {
    if (raumRef && raumHorcher) raumRef.off('value', raumHorcher);
    if (tradesRef && tradesHorcher) tradesRef.off('value', tradesHorcher);
    if (bereitRef && bereitHorcher) bereitRef.off('value', bereitHorcher);
    if (weiterRef && weiterHorcher) weiterRef.off('value', weiterHorcher);
    raumHorcher = null;
    tradesHorcher = null;
    bereitHorcher = null;
    weiterHorcher = null;
  }

  function melde() { if (melder) melder(getZustand()); }

  function onZustandsAenderung(rueckruf) {
    melder = rueckruf;
    let gemerkt = null;
    try { gemerkt = localStorage.getItem(SPEICHER_SCHLUESSEL); } catch (f) { /* Privatmodus */ }
    if (gemerkt) bereit.then(function () { horcheAufRaum(gemerkt); });
    else rueckruf(getZustand());
  }

  function getZustand() {
    const runde = aktuelleRunde();
    return {
      uid: eigeneUid,
      code: aktuellerCode,
      raum: raumZustand,
      trades: alleTrades,
      runde: runde,
      runden: raumZustand ? raumZustand.runden || markt.STANDARD_RUNDEN : markt.STANDARD_RUNDEN,
      abgeschlossen: habeAbgeschlossen(runde),
      fehlende: fehlendeNamen(runde),
      /* Wer die laufende Runde schon abgeschlossen hat — die Rangliste
         zeigt es an, sonst rätselt man, auf wen noch gewartet wird. */
      bereitJetzt: bereitDaten[runde] || {},
      vorbei: partieVorbei(),
      abgebrochen: !!(raumZustand && raumZustand.abgebrochen),
      istHost: !!(raumZustand && raumZustand.hostId === eigeneUid),
      stufe: raumZustand ? stufeFuer(raumZustand.runden) : null,
      regeln: raumZustand ? depot.normiereRegeln(raumZustand.regeln) : depot.normiereRegeln(null),
      botAnzahl: raumZustand ? raumZustand.botAnzahl || 0 : 0,
    };
  }

  function merkeCode(code) {
    try { localStorage.setItem(SPEICHER_SCHLUESSEL, code); } catch (f) { /* egal */ }
  }

  function vergissCode() {
    try { localStorage.removeItem(SPEICHER_SCHLUESSEL); } catch (f) { /* egal */ }
  }

  function verlasseLokal() {
    loeseHorcher();
    aktuellerCode = null;
    raumZustand = null;
    alleTrades = {};
    tradesRoh = {};
    bereitDaten = {};
    weiterDaten = {};
    raumRef = null;
    tradesRef = null;
    bereitRef = null;
    weiterRef = null;
    depot.leereSpeicher();
    vergissCode();
  }

  async function verlasseRaum() {
    const code = aktuellerCode;
    const raum = raumZustand;
    if (code && raum && eigeneUid && raum.spieler && raum.spieler[eigeneUid]) {
      if (raum.phase === 'lobby') {
        /* In der Lobby ganz austragen. */
        try { await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).remove(); } catch (f) { /* egal */ }
      } else if (raum.phase === 'laeuft') {
        /* Mitten in der Partie nur abmelden, nicht löschen: die Trades sind
           gemacht und gehören in die Rangliste. Ohne die Markierung würde
           die Runde aber für immer auf eine Zustimmung warten, die nie
           kommt — und die Partie stünde für alle anderen still. */
        try {
          await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid + '/raus').set(true);
        } catch (f) { /* egal */ }
      }
    }
    verlasseLokal();
    melde();
  }

  /**
   * Bricht die laufende Partie ab. Nur der Host.
   */
  async function brichAb() {
    if (!raumRef || !raumZustand || raumZustand.hostId !== eigeneUid) return;
    if (raumZustand.phase === 'beendet') return;
    await raumRef.update({ phase: 'beendet', abgebrochen: true });
  }

  /**
   * Räumt einen Raum vollständig ab. Nur der Host.
   *
   * ⚠️ Der Raum wird ZULETZT gelöscht. Die Schreibregeln für Trades,
   * Bereitschaft und Weiterschaltung prüfen gegen `raeume/$code/hostId` —
   * ist der Raum weg, erfüllt niemand mehr die Bedingung und die Daten
   * liegen dauerhaft fest. Dieselbe Falle hat beim Maulwurf acht verwaiste
   * Räume hinterlassen.
   */
  async function raeumeRaumAuf() {
    if (!aktuellerCode || !raumZustand || raumZustand.hostId !== eigeneUid) return;
    const code = aktuellerCode;

    /* Zuerst die Partie förmlich beenden. Die Rules lassen das Abräumen NUR
       bei `phase === 'beendet'` zu — sonst könnte der Host mitten im
       laufenden Spiel einzelne Trades löschen: eigene, um einen Verlust zu
       vertuschen, oder fremde, um jemanden zu sabotieren. Eine
       .write-Erlaubnis gilt in Firebase nämlich auch für alles darunter, die
       feinere Regel je Trade wäre damit wirkungslos. Dasselbe gilt für die
       Zustimmungen: einzeln löschbar wäre eine bereits abgeschlossene Runde
       wieder aufreißbar. */
    try { await db.ref(RAEUME_PFAD + '/' + code + '/phase').set('beendet'); } catch (f) {
      console.warn('Phase nicht auf beendet gesetzt:', f);
    }
    try { await db.ref(TRADES_PFAD + '/' + code).remove(); } catch (f) { console.warn('Trades nicht geräumt:', f); }
    try { await db.ref(BEREIT_PFAD + '/' + code).remove(); } catch (f) { console.warn('Bereitschaft nicht geräumt:', f); }
    try { await db.ref(WEITER_PFAD + '/' + code).remove(); } catch (f) { console.warn('Weiterschaltung nicht geräumt:', f); }
    try { await db.ref(RAEUME_PFAD + '/' + code).remove(); } catch (f) { console.warn('Raum nicht geräumt:', f); }
    verlasseLokal();
    melde();
  }

  async function beendeRaum() {
    if (!raumRef || !raumZustand || raumZustand.hostId !== eigeneUid) return;
    await raumRef.update({ phase: 'beendet' });
  }

  /**
   * Ändert die Einstellungen eines Raums, der noch in der Lobby steht.
   * Nur der Host. Sobald die Partie läuft, geht es nicht mehr — Regeln, die
   * sich mitten im Spiel ändern, würden jeden bereits getätigten Kauf
   * rückwirkend anders bewerten.
   */
  async function aendereEinstellungen(entwurf) {
    await bereit;
    if (!aktuellerCode || !raumZustand) return;
    if (raumZustand.hostId !== eigeneUid || raumZustand.phase !== 'lobby') return;
    const e = entwurf || {};
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode).update({
      runden: markt.normiereRunden(e.runden),
      botAnzahl: Math.max(0, Math.min(5, e.botAnzahl | 0)),
      regeln: depot.normiereRegeln(e),
    });
  }

  return {
    MAX_SPIELER: MAX_SPIELER,
    RUNDENSTUFEN: RUNDENSTUFEN,
    stufeFuer: stufeFuer,
    bereit: bereit,
    serverJetzt: serverJetzt,
    rundeAus: rundeAus,
    aktuelleRunde: aktuelleRunde,
    erstelleRaum: erstelleRaum,
    betreteRaum: betreteRaum,
    starteRaum: starteRaum,
    beendeRaum: beendeRaum,
    aendereEinstellungen: aendereEinstellungen,
    brichAb: brichAb,
    schliesseRundeAb: schliesseRundeAb,
    schalteWeiter: schalteWeiter,
    handle: handle,
    onZustandsAenderung: onZustandsAenderung,
    getZustand: getZustand,
    verlasseRaum: verlasseRaum,
    raeumeRaumAuf: raeumeRaumAuf,
  };
})();
