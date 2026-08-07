/* ==========================================================================
   Depot-Duell — Firebase-Anbindung
   ==========================================================================

   ÜBERTRAGEN WIRD NUR, WAS SICH NICHT ABLEITEN LÄSST.

   Kurse, Meldungen und alle Bot-Züge entstehen auf jedem Gerät aus der Saat
   des Raums — davon geht kein einziges Byte über das Netz. Gespeichert
   werden nur die Käufe und Verkäufe der Menschen. Bei 141 Werten über 300
   Ticks wären es sonst rund 42.000 Kurswerte je Partie.

   DIE UHR KOMMT VOM SERVER, NICHT VOM HANDY.
   Der Tick eines Trades wird aus dem Zeitstempel abgeleitet, den Firebase
   selbst setzt (`.sv: timestamp`). Ein Gerät mit verstellter Uhr kann sich
   damit keinen günstigeren Kurs erschleichen — es kann höchstens seine
   eigene Anzeige verstellen und dann anders kaufen, als es dachte.

   ⚠️ Firebase liest die Rules NICHT aus dem Repo. `database.rules.json` muss
   von Hand in der Konsole veröffentlicht werden, sonst ist das Spiel live
   tot: die Wurzel steht auf false/false.
   ========================================================================== */

const gameService = (function () {
  'use strict';

  const NAMENSRAUM = 'depotDuell';
  const RAEUME_PFAD = NAMENSRAUM + '/raeume';
  const TRADES_PFAD = NAMENSRAUM + '/trades';
  const BESTENLISTE_PFAD = NAMENSRAUM + '/bestenliste';

  /* Eigener Schlüssel — alle Spiele des Hubs teilen sich Origin UND
     Pfadpräfix, ein geteilter Name würde die Räume gegenseitig überschreiben. */
  const SPEICHER_SCHLUESSEL = 'spiele_depotduell_raumcode';

  /* Ohne 0/O und 1/I: der Code wird im fahrenden Bus vorgelesen. */
  const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const MAX_SPIELER = 10;

  /* Alle drei Stufen haben dieselbe Tickzahl. Nur so bleiben die Renditen
     einer kurzen und einer langen Partie vergleichbar — sonst wäre die
     Bestenliste wertlos, weil jede Länge anders schwer ist. */
  const DAUERSTUFEN = {
    kurz: { name: 'Kurz', minuten: 10, tickMs: 2000 },
    normal: { name: 'Normal', minuten: 30, tickMs: 6000 },
    lang: { name: 'Lang', minuten: 60, tickMs: 12000 },
  };

  let eigeneUid = null;
  let zeitVersatz = 0;          // Serverzeit minus Gerätezeit
  let aktuellerCode = null;
  let raumRef = null;
  let tradesRef = null;
  let raumZustand = null;
  let alleTrades = {};          // uid -> Liste
  let melder = null;
  let raumHorcher = null;
  let tradesHorcher = null;

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
     Tickrechnung — die einzige Stelle, die aus Zeit einen Tick macht

     Anzeige, Kaufprüfung und Auswertung müssen zwingend dieselbe Funktion
     benutzen. Rechnete die Anzeige anders als die Verbuchung, zeigte das
     Spiel einen Kurs an und rechnete mit einem anderen.
     ---------------------------------------------------------------------- */
  function tickAus(zeitpunkt, raum) {
    if (!raum || !raum.startZeit) return 0;
    const stufe = DAUERSTUFEN[raum.dauerStufe] || DAUERSTUFEN.normal;
    const t = Math.floor((zeitpunkt - raum.startZeit) / stufe.tickMs);
    if (!(t > 0)) return 0;
    return t > markt.TICKS ? markt.TICKS : t;
  }

  function aktuellerTick() { return tickAus(serverJetzt(), raumZustand); }

  function partieVorbei() {
    if (!raumZustand) return false;
    if (raumZustand.phase === 'beendet') return true;
    return raumZustand.phase === 'laeuft' && aktuellerTick() >= markt.TICKS;
  }

  /* Restzeit in Sekunden, für die Kopfzeile. */
  function restSekunden() {
    if (!raumZustand || raumZustand.phase !== 'laeuft' || !raumZustand.startZeit) return 0;
    const stufe = DAUERSTUFEN[raumZustand.dauerStufe] || DAUERSTUFEN.normal;
    const ende = raumZustand.startZeit + stufe.tickMs * markt.TICKS;
    return Math.max(0, Math.round((ende - serverJetzt()) / 1000));
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

  async function erstelleRaum(name, dauerStufe, botAnzahl) {
    await bereit;
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
      dauerStufe: DAUERSTUFEN[dauerStufe] ? dauerStufe : 'normal',
      botAnzahl: Math.max(0, Math.min(5, botAnzahl | 0)),
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

  async function starteRaum() {
    if (!raumZustand || raumZustand.hostId !== eigeneUid) return;
    if (raumZustand.phase !== 'lobby') return;
    await raumRef.update({
      phase: 'laeuft',
      startZeit: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  /* ----------------------------------------------------------------------
     Handel
     ---------------------------------------------------------------------- */

  /**
   * Schreibt einen Kauf oder Verkauf.
   * Der Tick wird NICHT mitgeschickt — er entsteht beim Lesen aus der
   * Serverzeit. Was der Client für den aktuellen Tick hält, ist nur seine
   * Anzeige; verbindlich ist der Server.
   */
  async function handle(art, wertId, stueck) {
    await bereit;
    if (!aktuellerCode) throw new Error('Du bist in keinem Raum.');
    if (!raumZustand || raumZustand.phase !== 'laeuft') throw new Error('Es läuft gerade keine Partie.');
    if (aktuellerTick() >= markt.TICKS) throw new Error('Die Partie ist vorbei.');

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

  function horcheAufRaum(code) {
    loeseHorcher();
    aktuellerCode = code;
    raumRef = db.ref(RAEUME_PFAD + '/' + code);
    tradesRef = db.ref(TRADES_PFAD + '/' + code);

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
      melde();
    });

    /* Trades des ganzen Raums: jedes Gerät braucht sie, um die Rangliste
       selbst zu rechnen. Ein Depotwert wird nie geschrieben. */
    tradesHorcher = tradesRef.on('value', function (s) {
      const roh = s.val() || {};
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
            /* HIER entsteht der verbindliche Tick — aus der Serverzeit. */
            tick: tickAus(e.zeit || 0, raumZustand),
          });
        }
        liste.sort(function (a, b) { return a.zeit - b.zeit; });
        alleTrades[uid] = liste;
      }
      depot.leereSpeicher();
      melde();
    });
  }

  function loeseHorcher() {
    if (raumRef && raumHorcher) raumRef.off('value', raumHorcher);
    if (tradesRef && tradesHorcher) tradesRef.off('value', tradesHorcher);
    raumHorcher = null;
    tradesHorcher = null;
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
    return {
      uid: eigeneUid,
      code: aktuellerCode,
      raum: raumZustand,
      trades: alleTrades,
      tick: aktuellerTick(),
      restSekunden: restSekunden(),
      vorbei: partieVorbei(),
      istHost: !!(raumZustand && raumZustand.hostId === eigeneUid),
      dauerStufe: raumZustand ? DAUERSTUFEN[raumZustand.dauerStufe] || DAUERSTUFEN.normal : null,
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
    raumRef = null;
    tradesRef = null;
    depot.leereSpeicher();
    vergissCode();
  }

  async function verlasseRaum() {
    const code = aktuellerCode;
    const raum = raumZustand;
    if (code && raum && raum.phase === 'lobby' && eigeneUid) {
      /* In der Lobby ganz austragen. Mitten in der Partie bleibt der
         Eintrag stehen — sonst verschwände ein Depot aus der Rangliste,
         nur weil jemand kurz das Netz verliert. */
      try { await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).remove(); } catch (f) { /* egal */ }
    }
    verlasseLokal();
    melde();
  }

  /**
   * Räumt einen Raum vollständig ab. Nur der Host.
   *
   * ⚠️ Der Raum wird ZULETZT gelöscht. Die Schreibregel für die Trades
   * prüft gegen `raeume/$code/hostId` — ist der Raum weg, erfüllt niemand
   * mehr die Bedingung und die Trades liegen dauerhaft fest. Dieselbe Falle
   * hat beim Maulwurf acht verwaiste Räume hinterlassen.
   */
  async function raeumeRaumAuf() {
    if (!aktuellerCode || !raumZustand || raumZustand.hostId !== eigeneUid) return;
    const code = aktuellerCode;
    try { await db.ref(TRADES_PFAD + '/' + code).remove(); } catch (f) { console.warn('Trades nicht geräumt:', f); }
    try { await db.ref(RAEUME_PFAD + '/' + code).remove(); } catch (f) { console.warn('Raum nicht geräumt:', f); }
    verlasseLokal();
    melde();
  }

  async function beendeRaum() {
    if (!raumRef || !raumZustand || raumZustand.hostId !== eigeneUid) return;
    await raumRef.update({ phase: 'beendet' });
  }

  /* ----------------------------------------------------------------------
     Bestenliste

     Jedes Gerät trägt NUR sein eigenes Ergebnis ein. Ein Gerät, das für
     alle schreibt, müsste dafür verbunden bleiben — und wer als Letzter
     rausgeht, hätte am Ende die Liste in der Hand.

     Partien mit KI zählen bewusst nicht: sonst poliert man seine Zahlen
     gegen schwache Bots auf.
     ---------------------------------------------------------------------- */
  async function meldeErgebnis(name, rendite, gewonnen, mitBots) {
    if (mitBots) return;
    if (!name) return;
    const schluessel = String(name).trim().slice(0, 24).replace(/[.#$/\[\]]/g, '_');
    if (!schluessel) return;
    const ref = db.ref(BESTENLISTE_PFAD + '/' + schluessel);
    try {
      await ref.transaction(function (alt) {
        const neu = alt || { partien: 0, siege: 0, besteRendite: -1e9 };
        neu.partien = (neu.partien || 0) + 1;
        if (gewonnen) neu.siege = (neu.siege || 0) + 1;
        if (rendite > (neu.besteRendite === undefined ? -1e9 : neu.besteRendite)) neu.besteRendite = rendite;
        return neu;
      });
    } catch (f) {
      console.warn('Bestenliste nicht aktualisiert:', f);
    }
  }

  async function ladeBestenliste() {
    const s = await db.ref(BESTENLISTE_PFAD).once('value');
    const roh = s.val() || {};
    const liste = [];
    for (const name in roh) {
      liste.push({
        name: name,
        partien: roh[name].partien || 0,
        siege: roh[name].siege || 0,
        besteRendite: roh[name].besteRendite === undefined ? null : roh[name].besteRendite,
      });
    }
    liste.sort(function (a, b) {
      if (b.siege !== a.siege) return b.siege - a.siege;
      return (b.besteRendite || -1e9) - (a.besteRendite || -1e9);
    });
    return liste;
  }

  return {
    MAX_SPIELER: MAX_SPIELER,
    DAUERSTUFEN: DAUERSTUFEN,
    bereit: bereit,
    serverJetzt: serverJetzt,
    tickAus: tickAus,
    aktuellerTick: aktuellerTick,
    erstelleRaum: erstelleRaum,
    betreteRaum: betreteRaum,
    starteRaum: starteRaum,
    beendeRaum: beendeRaum,
    handle: handle,
    onZustandsAenderung: onZustandsAenderung,
    getZustand: getZustand,
    verlasseRaum: verlasseRaum,
    raeumeRaumAuf: raeumeRaumAuf,
    meldeErgebnis: meldeErgebnis,
    ladeBestenliste: ladeBestenliste,
  };
})();
