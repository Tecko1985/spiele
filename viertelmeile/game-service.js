/* ==========================================================================
   Viertelmeile — Firebase-Anbindung
   ==========================================================================
   DAS GERÄT DES GASTGEBERS IST SCHIEDSRICHTER — wie bei Maulwurf,
   Depot-Duell, Letzte Karte und Werwolf.

   Ablauf einer Runde:
     1. Der Gastgeber prüft die Bereitschaft (praesenz/<code>/<uid>). Fehlt
        jemand, wartet die Runde. Erst dann wird gestartet.
     2. Er schreibt die Paarungen und EINEN gemeinsamen Grün-Zeitpunkt in
        raeume/<code>/sicht. Alle Geräte zählen daraufhin selbst herunter —
        auf derselben Serveruhr, nicht auf ihrer eigenen.
     3. Jedes Gerät fährt sein Rennen und legt sein Ergebnis in
        laeufe/<code>/<rundenschluessel>/<uid> ab. Die beiden Fahrer eines
        Paares schicken sich nebenbei ihren Stand über
        positionen/<code>/<rundenschluessel>/<uid>, damit man das andere Auto
        neben sich sieht.
     4. Der Gastgeber vergleicht, schreibt Sieger, Tabelle und Baum.

   ⚠️ EIN GERÄT KÖNNTE EINE FALSCHE ZEIT MELDEN. Das ist hingenommen: es ist
   ein Spiel für die Busfahrt, und jede serverseitige Prüfung müsste die
   ganze Fahrt nachrechnen. Was die Regeln SEHR WOHL verhindern: fremde
   Ergebnisse überschreiben, in fremde Räume schreiben, Ergebnisse nach der
   Auswertung ändern.

   ⚠️ Firebase liest die Rules NICHT aus dem Repo. `database.rules.json` muss
   von Hand in der Konsole veröffentlicht werden, sonst ist das Spiel live
   tot: die Wurzel steht auf false/false.
   ========================================================================== */

const gameService = (function () {
  'use strict';

  const NAMENSRAUM = 'viertelmeile';
  const RAEUME_PFAD = NAMENSRAUM + '/raeume';
  const PRAESENZ_PFAD = NAMENSRAUM + '/praesenz';
  const LAEUFE_PFAD = NAMENSRAUM + '/laeufe';
  const POSITIONEN_PFAD = NAMENSRAUM + '/positionen';
  const GEHEIM_PFAD = NAMENSRAUM + '/geheim';

  /* Eigener Schlüssel — alle Spiele des Hubs teilen sich denselben Origin. */
  const SPEICHER_SCHLUESSEL = 'spiele_viertelmeile_raumcode';

  /* Ohne 0/O und 1/I: der Code wird im Bus vorgelesen. */
  const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const MIN_SPIELER = 2;
  const MAX_SPIELER = 20;

  const PRAESENZ_TAKT = 2500;          // ms zwischen zwei Lebenszeichen
  const PRAESENZ_FRIST = 8000;         // so alt darf ein Lebenszeichen sein
  const START_PUFFER = 1200;           // ms Vorsprung, damit alle die Runde sehen
  const ERGEBNIS_FRIST = 6000;         // ms nach dem spätesten Rennende

  let eigeneUid = null;
  let zeitVersatz = 0;
  let aktuellerCode = null;
  let raumRef = null;
  let laeufeRef = null;
  let positionenRef = null;
  let praesenzRef = null;
  let praesenzUhr = null;
  let melder = null;
  let fehlerText = null;

  let raumZustand = null;              // Spiegel von raeume/<code>
  let laeufeZustand = {};              // Spiegel der laufenden Runde (nur Host)
  let gegnerPosition = null;           // Spiegel des Gegners im laufenden Rennen
  let gegnerRef = null;

  /* Nur beim Gastgeber gefüllt */
  let spiel = null;                    // { form, runde, lauf, plan, stand, gefahren, baum, ... }
  let hostUhr = null;
  let schreibtGerade = false;

  /* ⚠️ Alles, was `spiel` verändert, läuft NACHEINANDER über diese Kette —
     dieselbe Lehre wie bei Werwolf: ein Guard (`if (inArbeit) return`) wirft
     jede Aktion weg, die während eines Netz-Roundtrips eintrifft. */
  let kette = Promise.resolve();
  function nacheinander(fn) {
    const p = kette.then(fn, fn);
    kette = p.catch(function () { /* Fehler meldet fn selbst */ });
    return p;
  }

  /* ----------------------------------------------------------------------
     Anmeldung
     ---------------------------------------------------------------------- */

  const bereit = new Promise(function (aufloesen, ablehnen) {
    auth.onAuthStateChanged(function (nutzer) {
      if (nutzer) {
        eigeneUid = nutzer.uid;
        holeZeitVersatz().then(aufloesen).catch(function () { aufloesen(); });
      }
    });
    auth.signInAnonymously().catch(function (f) {
      fehlerText = 'Anmeldung fehlgeschlagen: ' + f.message;
      ablehnen(f);
    });
  });

  function holeZeitVersatz() {
    return db.ref('.info/serverTimeOffset').once('value').then(function (s) {
      zeitVersatz = s.val() || 0;
    });
  }

  /**
   * ⚠️ DIE EINZIGE UHR, DIE ZÄHLT. Reaktionszeiten werden auf Tausendstel
   * verglichen; die Uhr im Handy geht dafür zu ungenau. `serverTimeOffset`
   * gleicht den Versatz gegen die Firebase-Serverzeit aus.
   */
  function serverJetzt() { return Date.now() + zeitVersatz; }

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

  function sauberName(name) { return String(name || '').trim().slice(0, 24); }

  function normiereEinstellungen(e) {
    e = e || {};
    return {
      form: e.form === 'ko' ? 'ko' : 'liga',
      burnout: e.burnout === false ? false : true,
      botStufe: bot.STUFEN[e.botStufe] ? e.botStufe : 'mittel',
    };
  }

  async function erstelleRaum(name, spieltMit, einstellungen) {
    await bereit;
    name = sauberName(name);
    if (spieltMit && !name) throw new Error('Bitte einen Namen eingeben.');
    const code = await freierCode();
    const raum = {
      hostId: eigeneUid,
      hostSpieltMit: !!spieltMit,
      erstellt: firebase.database.ServerValue.TIMESTAMP,
      phase: 'lobby',
      einstellungen: normiereEinstellungen(einstellungen),
      spieler: {},
      sicht: null,
      abgebrochen: false,
    };
    if (spieltMit) {
      raum.spieler[eigeneUid] = {
        name: name, lack: ton.hole('lack') || 'rot',
        beigetreten: firebase.database.ServerValue.TIMESTAMP, reihe: 0,
      };
    }
    await db.ref(RAEUME_PFAD + '/' + code).set(raum);
    merkeCode(code);
    ton.setze('name', name);
    horche(code);
    return code;
  }

  async function betreteRaum(code, name) {
    await bereit;
    code = String(code || '').trim().toUpperCase();
    name = sauberName(name);
    if (code.length !== 6) throw new Error('Ein Raum-Code hat sechs Zeichen.');

    const s = await db.ref(RAEUME_PFAD + '/' + code).once('value');
    const raum = s.val();
    if (!raum) throw new Error('Diesen Raum gibt es nicht.');

    const dabei = (raum.spieler && raum.spieler[eigeneUid]) || raum.hostId === eigeneUid;
    /* Wer schon drin ist, darf immer zurück — sonst sperrt ein Neuladen
       mitten im Turnier aus dem eigenen Rennen aus. */
    if (!dabei) {
      if (!name) throw new Error('Bitte einen Namen eingeben.');
      if (raum.phase !== 'lobby') throw new Error('Dieses Turnier läuft bereits.');
      const anzahl = raum.spieler ? Object.keys(raum.spieler).length : 0;
      if (anzahl >= MAX_SPIELER) throw new Error('Der Raum ist voll.');
      const belegt = [];
      for (const u in (raum.spieler || {})) belegt.push(raum.spieler[u].lack);
      await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).set({
        name: name,
        lack: autos.freierLack(belegt),
        beigetreten: firebase.database.ServerValue.TIMESTAMP,
        reihe: anzahl,
      });
    }
    merkeCode(code);
    if (name) ton.setze('name', name);
    horche(code);
    return code;
  }

  function istHost() { return !!raumZustand && raumZustand.hostId === eigeneUid; }
  function spieltMit() { return !!raumZustand && !!(raumZustand.spieler && raumZustand.spieler[eigeneUid]); }

  function spielerSortiert(raum) {
    const liste = [];
    for (const uid in ((raum && raum.spieler) || {})) {
      const s = raum.spieler[uid];
      liste.push({ uid: uid, name: s.name, lack: s.lack || 'rot', reihe: s.reihe | 0, beigetreten: s.beigetreten || 0 });
    }
    liste.sort(function (a, b) { return (a.reihe - b.reihe) || (a.beigetreten - b.beigetreten); });
    return liste;
  }

  /* ----------------------------------------------------------------------
     Lobby — nur der Gastgeber ändert etwas
     ---------------------------------------------------------------------- */

  async function setzeEinstellungen(e) {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/einstellungen').set(normiereEinstellungen(e));
  }

  async function setzeLack(lack) {
    if (!aktuellerCode || !spieltMit()) { ton.setze('lack', lack); return; }
    ton.setze('lack', lack);
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/spieler/' + eigeneUid + '/lack').set(lack);
  }

  async function entferneSpieler(uid) {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/spieler/' + uid).remove();
  }

  /* ----------------------------------------------------------------------
     Lebenszeichen
     ---------------------------------------------------------------------- */

  function startePraesenz(code) {
    stoppePraesenz();
    praesenzRef = db.ref(PRAESENZ_PFAD + '/' + code + '/' + eigeneUid);
    const schlagen = function () {
      praesenzRef.set({ zeit: firebase.database.ServerValue.TIMESTAMP }).catch(function () { /* Netz weg, gleich wieder */ });
    };
    schlagen();
    praesenzUhr = setInterval(schlagen, PRAESENZ_TAKT);
    try { praesenzRef.onDisconnect().remove(); } catch (f) { /* egal */ }
  }

  function stoppePraesenz() {
    if (praesenzUhr) { clearInterval(praesenzUhr); praesenzUhr = null; }
    if (praesenzRef) { try { praesenzRef.onDisconnect().cancel(); } catch (f) { /* egal */ } praesenzRef = null; }
  }

  async function wachListe(code) {
    const s = await db.ref(PRAESENZ_PFAD + '/' + code).once('value');
    const alle = s.val() || {};
    const jetzt = serverJetzt();
    const wach = {};
    for (const uid in alle) {
      if (jetzt - (alle[uid].zeit || 0) < PRAESENZ_FRIST) wach[uid] = true;
    }
    return wach;
  }

  /* ----------------------------------------------------------------------
     Turnier starten (Gastgeber)
     ---------------------------------------------------------------------- */

  /**
   * Der Schlüssel, unter dem die Ergebnisse einer Runde liegen.
   *
   * ⚠️ MIT ANLAUF-ZÄHLER. Ohne ihn trug eine wiederholte Runde denselben
   * Schlüssel wie der erste Versuch — und jedes Gerät, das diesen Schlüssel
   * schon einmal gesehen hatte, überging das Rennen wortlos. Der Gastgeber
   * wartete dann auf Ergebnisse, die niemand mehr schickte.
   */
  function rundenSchluessel(runde, lauf, anlauf) {
    return 'r' + runde + '_l' + (lauf || 1) + (anlauf ? '_v' + anlauf : '');
  }

  async function starteUebung() {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    const liste = spielerSortiert(raumZustand);
    if (!liste.length) throw new Error('Es ist noch niemand da.');
    spiel = {
      form: 'uebung',
      runde: 0,
      lauf: 1,
      stand: {},
      gefahren: {},
      baum: null,
      saat: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
    };
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/phase').set('uebung');
    await neueRunde();
  }

  async function starteTurnier() {
    if (!istHost()) return;
    const liste = spielerSortiert(raumZustand);
    if (liste.length < MIN_SPIELER) throw new Error('Mindestens ' + MIN_SPIELER + ' Fahrer.');
    const e = normiereEinstellungen(raumZustand.einstellungen);
    const ids = liste.map(function (s) { return s.uid; });
    const saat = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

    spiel = {
      form: e.form,
      runde: 0,
      lauf: 1,
      stand: {},
      gefahren: {},
      saat: saat,
      baum: e.form === 'ko' ? turnier.koBaum(ids, saat) : null,
      runden: e.form === 'liga' ? turnier.ligaRunden(ids.length) : 0,
      chronik: [],
    };
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/phase').set('laeuft');
    await neueRunde();
  }

  /** Baut die Paarungen der nächsten Runde und setzt den Grün-Zeitpunkt. */
  async function neueRunde() {
    return nacheinander(async function () {
      if (!istHost() || !spiel) return;
      const raum = raumZustand;
      const liste = spielerSortiert(raum);
      const ids = liste.map(function (s) { return s.uid; });
      const e = normiereEinstellungen(raum.einstellungen);

      spiel.runde++;
      spiel.lauf = 1;

      let paarungen = [];
      let name = '';

      if (spiel.form === 'uebung') {
        name = 'Übungslauf';
        paarungen = ids.map(function (id) { return { a: id, b: null, alleine: true }; });
      } else if (spiel.form === 'liga') {
        name = 'Runde ' + spiel.runde + ' von ' + spiel.runden;
        const roh = turnier.ligaPaarungen(ids, spiel.runde, spiel.saat, spiel.stand, spiel.gefahren);
        paarungen = roh.map(function (pa) {
          /* ⚠️ Der Platzhalter für den Bot kann auf BEIDEN Seiten stehen —
             das Kreis-Verfahren dreht jede zweite Runde um, damit nicht immer
             derselbe links steht. Der erste Entwurf prüfte nur `pa.b === null`
             und ließ in jeder zweiten Runde eine Paarung mit `a: null` stehen:
             der Mensch bekam nie einen Gegner, der Gastgeber wartete auf ein
             Ergebnis, das niemand schreiben konnte, und gewann erst nach
             Ablauf der Frist kampflos. */
          if (pa.a === null || pa.b === null) {
            const mensch = pa.a === null ? pa.b : pa.a;
            return { a: mensch, b: 'bot-' + spiel.runde, bot: e.botStufe };
          }
          return { a: pa.a, b: pa.b };
        });
      } else {
        const runde = turnier.offeneRunde(spiel.baum);
        if (!runde) { await beendeTurnier(); return; }
        name = runde.name + (runde.paare[0].noetig > 1 ? ' · Lauf ' + (runde.paare[0].siegeA + runde.paare[0].siegeB + 1) : '');
        paarungen = runde.paare.filter(function (pa) { return !pa.sieger; }).map(function (pa) { return { a: pa.a, b: pa.b }; });
      }

      if (!paarungen.length) { await beendeTurnier(); return; }
      await starteRennen(paarungen, name, e);
    });
  }

  /** Wartet auf Bereitschaft und schreibt dann die Runde. */
  async function starteRennen(paarungen, name, e) {
    const wach = await wachListe(aktuellerCode);
    const fehlen = [];
    for (const pa of paarungen) {
      for (const id of [pa.a, pa.b]) {
        if (!id || turnier.istBot(id) || id.indexOf('bot-') === 0) continue;
        if (!wach[id]) fehlen.push(id);
      }
    }
    if (fehlen.length) {
      /* ⚠️ NICHT LOSFAHREN, WENN JEMAND FEHLT. Zugesagt war: die
         Bereit-Prüfung hält das Rennen an, statt es den Abwesenden
         verlieren zu lassen. Der Gastgeber sieht, auf wen gewartet wird. */
      spiel.wartetAuf = fehlen;
      spiel.offenePaarungen = paarungen;
      spiel.offenerName = name;
      await schreibeSicht({ zustand: 'wartet', rundenName: name, wartetAuf: fehlen, paarungen: paarungen });
      if (!hostUhr) hostUhr = setInterval(hostTick, 1500);
      return;
    }
    spiel.wartetAuf = null;
    spiel.offenePaarungen = null;

    const vorlauf = rennen.vorlaufMs(e.burnout);
    const gruenZeit = serverJetzt() + vorlauf + START_PUFFER;
    const autoRunde = spiel.form === 'uebung' ? 2 : spiel.runde;
    const auto = autos.fuerRunde(autoRunde);

    const fertig = paarungen.map(function (pa, i) {
      return {
        a: pa.a,
        b: pa.b || null,
        bot: pa.bot || null,
        alleine: !!pa.alleine,
        saat: (spiel.saat + spiel.runde * 7919 + spiel.lauf * 104729 + i * 65599) >>> 0,
        botSaat: (spiel.saat ^ (spiel.runde * 2654435761) ^ (i * 40503)) >>> 0,
      };
    });

    spiel.aktuell = {
      schluessel: rundenSchluessel(spiel.runde, spiel.lauf, spiel.anlauf | 0),
      paarungen: fertig,
      gruenZeit: gruenZeit,
      autoId: auto.id,
      name: name,
      frist: gruenZeit + rennen.ABBRUCH * 1000 + ERGEBNIS_FRIST,
      ausgewertet: false,
    };

    await schreibeSicht({
      zustand: 'rennen',
      rundenName: name,
      rundeNr: spiel.runde,
      lauf: spiel.lauf,
      schluessel: spiel.aktuell.schluessel,
      autoId: auto.id,
      burnout: e.burnout,
      gruenZeit: gruenZeit,
      paarungen: fertig,
    });
    hoereLaeufe(spiel.aktuell.schluessel);
    if (!hostUhr) hostUhr = setInterval(hostTick, 1500);
  }

  async function schreibeSicht(zusatz) {
    const sicht = Object.assign({
      zustand: 'wartet',
      stand: spiel ? spiel.stand : {},
      form: spiel ? spiel.form : 'liga',
      runden: spiel ? spiel.runden || 0 : 0,
      baum: spiel && spiel.baum ? vereinfacheBaum(spiel.baum) : null,
      letzte: spiel ? spiel.letzte || null : null,
      gesamtSieger: spiel ? spiel.gesamtSieger || null : null,
    }, zusatz || {});
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/sicht').set(sicht);
    /* Damit der Gastgeber nach einem Neuladen weitermachen kann. */
    await db.ref(GEHEIM_PFAD + '/' + aktuellerCode).set(JSON.parse(JSON.stringify(spiel || {})));
  }

  function vereinfacheBaum(baum) {
    return {
      sieger: baum.sieger || null,
      zweiter: baum.zweiter || null,
      runden: (baum.runden || []).map(function (r) {
        return {
          name: r.name,
          paare: r.paare.map(function (pa) {
            return { a: pa.a, b: pa.b, siegeA: pa.siegeA, siegeB: pa.siegeB, sieger: pa.sieger || null, noetig: pa.noetig };
          }),
        };
      }),
    };
  }

  /* ----------------------------------------------------------------------
     Auswerten (Gastgeber)
     ---------------------------------------------------------------------- */

  function hoereLaeufe(schluessel) {
    if (laeufeRef) laeufeRef.off();
    laeufeZustand = {};
    laeufeRef = db.ref(LAEUFE_PFAD + '/' + aktuellerCode + '/' + schluessel);
    laeufeRef.on('value', function (s) {
      laeufeZustand = s.val() || {};
      hostTick();
    });
  }

  function hostTick() {
    if (!istHost() || !spiel) return;
    nacheinander(async function () {
      if (!spiel) return;

      /* Warten wir noch auf jemanden? */
      if (spiel.wartetAuf && spiel.offenePaarungen) {
        const wach = await wachListe(aktuellerCode);
        const fehlen = spiel.wartetAuf.filter(function (id) { return !wach[id]; });
        if (!fehlen.length) {
          const e = normiereEinstellungen(raumZustand.einstellungen);
          await starteRennen(spiel.offenePaarungen, spiel.offenerName, e);
        } else if (fehlen.join() !== spiel.wartetAuf.join()) {
          spiel.wartetAuf = fehlen;
          await schreibeSicht({ zustand: 'wartet', rundenName: spiel.offenerName, wartetAuf: fehlen, paarungen: spiel.offenePaarungen });
        }
        return;
      }

      const a = spiel.aktuell;
      if (!a || a.ausgewertet) return;
      if (serverJetzt() < a.gruenZeit) return;

      const alleDa = a.paarungen.every(function (pa) {
        if (pa.alleine) return !!laeufeZustand[pa.a];
        return !!laeufeZustand[pa.a] && !!laeufeZustand[pa.b];
      });
      const ueberfaellig = serverJetzt() > a.frist;
      if (!alleDa && !ueberfaellig) return;

      a.ausgewertet = true;
      await werteAus(a);
    });
  }

  function fehlendesErgebnis() {
    return { gesamt: null, fehlstart: false, aus: true, reaktion: null, fehlt: true };
  }

  function tiefeKopie(x) { return x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)); }

  async function werteAus(a) {
    /* ⚠️ VOR dem Buchen einen Stand sichern. „Runde wiederholen" löschte
       zwar die gemeldeten Ergebnisse, aber Tabelle und Turnierbaum waren
       schon fortgeschrieben — die wiederholte Runde zählte danach doppelt.
       Mit dieser Sicherung wird der Stand vor dem ersten Anlauf
       zurückgeholt. */
    spiel.vorher = {
      stand: tiefeKopie(spiel.stand),
      gefahren: tiefeKopie(spiel.gefahren),
      baum: tiefeKopie(spiel.baum),
      letzte: tiefeKopie(spiel.letzte),
    };
    const ergebnisse = [];
    for (const pa of a.paarungen) {
      const ea = laeufeZustand[pa.a] || fehlendesErgebnis();
      const eb = pa.alleine ? null : (laeufeZustand[pa.b] || fehlendesErgebnis());

      if (pa.alleine) {
        ergebnisse.push({ a: pa.a, b: null, alleine: true, ergA: ea, ergB: null, sieger: null });
        continue;
      }
      const wer = physik.vergleiche(ea, eb);
      let sieger = wer === 'a' ? pa.a : wer === 'b' ? pa.b : null;
      let notEntscheidung = false;

      if (spiel.form === 'ko') {
        const runde = turnier.offeneRunde(spiel.baum);
        const paar = runde ? runde.paare.find(function (x) { return x.a === pa.a && x.b === pa.b; }) : null;
        if (paar && !sieger) {
          /* ⚠️ Unentschieden: der Lauf wird wiederholt — aber höchstens
             zweimal. Danach entscheidet die Notentscheidung. Ohne die Grenze
             hing das ganze Turnier, wenn beide dreimal hintereinander
             ausschieden oder zu früh starteten. */
          const notSieger = turnier.koRemis(paar, ea, eb);
          if (notSieger) { sieger = notSieger; notEntscheidung = true; }
        }
        if (paar && sieger) turnier.koEintragen(spiel.baum, paar, sieger);
      }

      ergebnisse.push({
        a: pa.a, b: pa.b, bot: pa.bot || null,
        ergA: ea, ergB: eb, sieger: sieger,
        notEntscheidung: notEntscheidung,
      });

      if (spiel.form === 'liga') {
        spiel.gefahren[turnier.paarSchluessel(pa.a, pa.bot ? turnier.BOT_MARKE : pa.b)] = true;
        buche(pa.a, ea, sieger === pa.a, sieger === null);
        if (!pa.bot) buche(pa.b, eb, sieger === pa.b, sieger === null);
      } else if (spiel.form === 'ko') {
        buche(pa.a, ea, sieger === pa.a, sieger === null);
        buche(pa.b, eb, sieger === pa.b, sieger === null);
      }
    }

    spiel.letzte = { name: a.name, autoId: a.autoId, ergebnisse: ergebnisse };

    if (spiel.form === 'uebung') {
      await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/phase').set('lobby');
      spiel = null;
      await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/sicht').set({
        zustand: 'uebungFertig', rundenName: 'Übungslauf', letzte: { name: a.name, autoId: a.autoId, ergebnisse: ergebnisse },
      });
      haltHostUhr();
      return;
    }

    if (spiel.form === 'ko') {
      const weiter = turnier.koWeiter(spiel.baum);
      const runde = turnier.offeneRunde(spiel.baum);
      spiel.fertigNachher = !weiter && !runde;
      if (!weiter && !runde) spiel.gesamtSieger = spiel.baum.sieger;
    } else if (spiel.runde >= spiel.runden) {
      const ids = spielerSortiert(raumZustand).map(function (s) { return s.uid; });
      const t = turnier.tabelle(ids, spiel.stand);
      spiel.gesamtSieger = t.length ? t[0].id : null;
      spiel.fertigNachher = true;
    }

    await schreibeSicht({
      zustand: spiel.fertigNachher ? 'ende' : 'ergebnis',
      rundenName: a.name,
      rundeNr: spiel.runde,
      autoId: a.autoId,
    });
    if (spiel.fertigNachher) await beendeTurnier();
  }

  function buche(uid, erg, gewonnen, unentschieden) {
    if (!uid || turnier.istBot(uid) || uid.indexOf('bot-') === 0) return;
    const s = spiel.stand[uid] || { siege: 0, niederlagen: 0, unentschieden: 0, rennen: 0, besteZeit: null };
    s.rennen++;
    if (gewonnen) s.siege++;
    else if (unentschieden) s.unentschieden++;
    else s.niederlagen++;
    const zeit = erg && typeof erg.gesamt === 'number' ? erg.gesamt : null;
    if (zeit !== null && (s.besteZeit === null || zeit < s.besteZeit)) s.besteZeit = zeit;
    spiel.stand[uid] = s;
  }

  async function beendeTurnier() {
    haltHostUhr();
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/phase').set('beendet');
    await schreibeSicht({ zustand: 'ende', gesamtSieger: spiel ? spiel.gesamtSieger || null : null });
  }

  function haltHostUhr() {
    if (hostUhr) { clearInterval(hostUhr); hostUhr = null; }
    if (laeufeRef) { laeufeRef.off(); laeufeRef = null; }
  }

  /** Gastgeber: Runde noch einmal fahren (unverschuldeter Abbruch). */
  async function wiederhole() {
    if (!istHost() || !spiel || !spiel.aktuell) return;
    const schluessel = spiel.aktuell.schluessel;
    await db.ref(LAEUFE_PFAD + '/' + aktuellerCode + '/' + schluessel).remove().catch(function () { /* egal */ });
    await db.ref(POSITIONEN_PFAD + '/' + aktuellerCode + '/' + schluessel).remove().catch(function () { /* egal */ });
    /* Tabelle, Turnierbaum und gefahrene Paarungen auf den Stand VOR dieser
       Runde zurückdrehen — sonst zählt die wiederholte Runde doppelt. */
    if (spiel.vorher) {
      spiel.stand = spiel.vorher.stand || {};
      spiel.gefahren = spiel.vorher.gefahren || {};
      if (spiel.vorher.baum) spiel.baum = spiel.vorher.baum;
      spiel.letzte = spiel.vorher.letzte || null;
      spiel.vorher = null;
    }
    spiel.gesamtSieger = null;
    spiel.fertigNachher = false;

    /* Dieselbe Runde, dieselben Paarungen — nur ein neuer Anlauf. */
    spiel.anlauf = (spiel.anlauf | 0) + 1;
    if (spiel.form === 'liga') spiel.runde--;
    spiel.lauf = 1;
    spiel.aktuell = null;
    await neueRunde();
  }

  /** Gastgeber: weiter zur nächsten Runde bzw. zum nächsten Lauf. */
  async function weiter() {
    if (!istHost() || !spiel) return;
    if (spiel.form === 'ko') {
      const runde = turnier.offeneRunde(spiel.baum);
      if (!runde) { await beendeTurnier(); return; }
      /* Im K.-o. bleibt die Rundennummer, nur der Lauf zählt hoch, solange
         dieselbe Runde noch offen ist. */
      const schonGefahren = runde.paare.some(function (pa) { return pa.siegeA + pa.siegeB > 0; });
      if (schonGefahren) {
        spiel.lauf++;
        const e = normiereEinstellungen(raumZustand.einstellungen);
        const offen = runde.paare.filter(function (pa) { return !pa.sieger; }).map(function (pa) { return { a: pa.a, b: pa.b }; });
        if (!offen.length) { await neueRunde(); return; }
        const name = runde.name + (runde.paare[0].noetig > 1 ? ' · Lauf ' + (runde.paare[0].siegeA + runde.paare[0].siegeB + 1) : '');
        spiel.aktuell = null;
        await nacheinander(function () { return starteRennen(offen, name, e); });
        return;
      }
    }
    spiel.aktuell = null;
    await neueRunde();
  }

  /* ----------------------------------------------------------------------
     Ergebnisse und Positionen (jedes Gerät)
     ---------------------------------------------------------------------- */

  function meinePaarung() {
    const sicht = raumZustand && raumZustand.sicht;
    if (!sicht || !sicht.paarungen) return null;
    for (const pa of sicht.paarungen) {
      if (pa.a === eigeneUid || pa.b === eigeneUid) return pa;
    }
    return null;
  }

  async function meldeErgebnis(ergebnis, gegnerErgebnis) {
    const sicht = raumZustand && raumZustand.sicht;
    if (!sicht || !sicht.schluessel) return;
    const pfad = LAEUFE_PFAD + '/' + aktuellerCode + '/' + sicht.schluessel;
    await db.ref(pfad + '/' + eigeneUid).set(ergebnis).catch(function () { /* Netz weg */ });
    const pa = meinePaarung();
    /* ⚠️ Der Bot hat kein eigenes Konto — sein Ergebnis schreibt das Gerät
       des Menschen mit, gegen den er gefahren ist. */
    if (pa && pa.bot && gegnerErgebnis) {
      await db.ref(pfad + '/' + pa.b).set(gegnerErgebnis).catch(function () { /* egal */ });
    }
  }

  function meldePosition(daten) {
    const sicht = raumZustand && raumZustand.sicht;
    if (!sicht || !sicht.schluessel || !positionenRef) return;
    positionenRef.set(daten).catch(function () { /* Netz weg, nächstes Bild */ });
  }

  /** Hört auf den Stand des Gegners im laufenden Rennen. */
  function horcheGegner(schluessel, gegnerUid, rueckruf) {
    loeseGegner();
    positionenRef = db.ref(POSITIONEN_PFAD + '/' + aktuellerCode + '/' + schluessel + '/' + eigeneUid);
    try { positionenRef.onDisconnect().remove(); } catch (f) { /* egal */ }
    if (!gegnerUid) return;
    gegnerRef = db.ref(POSITIONEN_PFAD + '/' + aktuellerCode + '/' + schluessel + '/' + gegnerUid);
    gegnerRef.on('value', function (s) {
      gegnerPosition = s.val();
      if (rueckruf && gegnerPosition) rueckruf(gegnerPosition);
    });
  }

  function loeseGegner() {
    if (gegnerRef) { gegnerRef.off(); gegnerRef = null; }
    if (positionenRef) { try { positionenRef.onDisconnect().cancel(); } catch (f) { /* egal */ } positionenRef = null; }
    gegnerPosition = null;
  }

  /* ----------------------------------------------------------------------
     Horchen
     ---------------------------------------------------------------------- */

  function horche(code) {
    loese();
    aktuellerCode = code;
    raumRef = db.ref(RAEUME_PFAD + '/' + code);
    raumRef.on('value', function (s) {
      raumZustand = s.val();
      if (!raumZustand) { vergissCode(); loese(); if (melder) melder(); return; }
      if (istHost() && !spiel && raumZustand.phase !== 'lobby' && raumZustand.phase !== 'beendet') stelleHostWiederHer();
      if (melder) melder();
    });
    startePraesenz(code);
  }

  /** Nach einem Neuladen des Gastgeber-Geräts: Spielstand zurückholen. */
  function stelleHostWiederHer() {
    if (spiel) return;
    spiel = {};                              // Platzhalter gegen Doppelaufruf
    db.ref(GEHEIM_PFAD + '/' + aktuellerCode).once('value').then(function (s) {
      const gespeichert = s.val();
      if (!gespeichert || !gespeichert.form) { spiel = null; return; }
      spiel = gespeichert;
      if (spiel.aktuell) {
        spiel.aktuell.ausgewertet = false;
        hoereLaeufe(spiel.aktuell.schluessel);
      }
      if (!hostUhr) hostUhr = setInterval(hostTick, 1500);
      if (melder) melder();
    }).catch(function () { spiel = null; });
  }

  function loese() {
    if (raumRef) { raumRef.off(); raumRef = null; }
    haltHostUhr();
    loeseGegner();
    stoppePraesenz();
    raumZustand = null;
  }

  async function verlasse() {
    const warHost = istHost();
    const code = aktuellerCode;
    loese();
    vergissCode();
    spiel = null;
    aktuellerCode = null;
    if (code) {
      if (warHost) {
        /* ⚠️ Reihenfolge: erst die Unterknoten, dann der Raum. Steht der Raum
           nicht mehr, greift keine `.write`-Regel mehr, die auf hostId zeigt —
           und die Reste blieben für immer liegen (Lehre aus dem Löschen von
           Elfmeterschießen). */
        await db.ref(LAEUFE_PFAD + '/' + code).remove().catch(function () { /* egal */ });
        await db.ref(POSITIONEN_PFAD + '/' + code).remove().catch(function () { /* egal */ });
        await db.ref(GEHEIM_PFAD + '/' + code).remove().catch(function () { /* egal */ });
        await db.ref(PRAESENZ_PFAD + '/' + code).remove().catch(function () { /* egal */ });
        await db.ref(RAEUME_PFAD + '/' + code).remove().catch(function () { /* egal */ });
      } else {
        await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).remove().catch(function () { /* egal */ });
        await db.ref(PRAESENZ_PFAD + '/' + code + '/' + eigeneUid).remove().catch(function () { /* egal */ });
      }
    }
    if (melder) melder();
  }

  /** Neues Turnier mit denselben Leuten. */
  async function nochmal() {
    if (!istHost()) return;
    const code = aktuellerCode;
    await db.ref(LAEUFE_PFAD + '/' + code).remove().catch(function () { /* egal */ });
    await db.ref(POSITIONEN_PFAD + '/' + code).remove().catch(function () { /* egal */ });
    spiel = null;
    await db.ref(RAEUME_PFAD + '/' + code + '/sicht').remove();
    await db.ref(RAEUME_PFAD + '/' + code + '/phase').set('lobby');
  }

  /* ----------------------------------------------------------------------
     Zustand nach außen
     ---------------------------------------------------------------------- */

  function getZustand() {
    const raum = raumZustand;
    const sicht = raum && raum.sicht;
    const liste = spielerSortiert(raum);
    const namen = {};
    const lacke = {};
    for (const s of liste) { namen[s.uid] = s.name; lacke[s.uid] = s.lack; }
    return {
      uid: eigeneUid,
      code: aktuellerCode,
      raum: raum,
      sicht: sicht || null,
      spielerListe: liste,
      namen: namen,
      lacke: lacke,
      istHost: istHost(),
      spieltMit: spieltMit(),
      meinePaarung: meinePaarung(),
      gemerkterCode: gemerkterCode(),
      gemerkterName: ton.hole('name') || '',
      fehler: fehlerText,
      serverJetzt: serverJetzt,
    };
  }

  function setzeMelder(fn) { melder = fn; }

  function merkeCode(code) { try { localStorage.setItem(SPEICHER_SCHLUESSEL, code); } catch (f) { /* Privatmodus */ } }
  function vergissCode() { try { localStorage.removeItem(SPEICHER_SCHLUESSEL); } catch (f) { /* Privatmodus */ } }
  function gemerkterCode() { try { return localStorage.getItem(SPEICHER_SCHLUESSEL); } catch (f) { return null; } }

  return {
    MIN_SPIELER: MIN_SPIELER,
    MAX_SPIELER: MAX_SPIELER,
    bereit: bereit,
    serverJetzt: serverJetzt,
    erstelleRaum: erstelleRaum,
    betreteRaum: betreteRaum,
    setzeEinstellungen: setzeEinstellungen,
    setzeLack: setzeLack,
    entferneSpieler: entferneSpieler,
    starteUebung: starteUebung,
    starteTurnier: starteTurnier,
    weiter: weiter,
    wiederhole: wiederhole,
    nochmal: nochmal,
    verlasse: verlasse,
    meldeErgebnis: meldeErgebnis,
    meldePosition: meldePosition,
    horcheGegner: horcheGegner,
    loeseGegner: loeseGegner,
    meinePaarung: meinePaarung,
    getZustand: getZustand,
    setzeMelder: setzeMelder,
    normiereEinstellungen: normiereEinstellungen,
  };
})();
