/* ==========================================================================
   Letzte Karte — Firebase-Anbindung
   ==========================================================================

   DER GASTGEBER IST DER KARTENGEBER.

   Es gibt keinen Server, der mischt. Das Gerät des Gastgebers hält den
   vollständigen Spielzustand, wendet jeden Zug an und veröffentlicht danach
   zwei Sichten:

     raeume/<code>/tisch      was ALLE sehen dürfen — offene Karte, Richtung,
                              wer dran ist, wie viele Karten jeder hat
     haende/<code>/<uid>      die Hand EINES Spielers, lesbar nur für ihn

   Mitspieler schreiben nie in den Tisch. Sie legen einen Zugwunsch in
   zuege/<code>/<uid> ab; der Gastgeber prüft ihn gegen seinen Zustand und
   wendet ihn an oder verwirft ihn. Damit gilt dieselbe Regelprüfung für
   Mensch, Bot und einen manipulierten Client.

   ⚠️ WISSENSVORSPRUNG DES GASTGEBERS — BEWUSST HINGENOMMEN.
   Wer die Partie eröffnet, könnte mit den Entwicklerwerkzeugen alle Hände
   sehen. Das ließe sich nur mit einem eigenen Server abstellen; für eine
   Busfahrt steht der Aufwand in keinem Verhältnis. Alle ANDEREN sehen
   nichts: die Rules geben `haende/<code>/<uid>` nur an den Besitzer heraus
   und `geheim/<code>` (Nachziehstapel, Bot-Hände) nur an den Gastgeber.

   ⚠️ Firebase liest die Rules NICHT aus dem Repo. `database.rules.json` muss
   von Hand in der Konsole veröffentlicht werden, sonst ist das Spiel live
   tot: die Wurzel steht auf false/false.
   ========================================================================== */

const gameService = (function () {
  'use strict';

  const NAMENSRAUM = 'letzteKarte';
  const RAEUME_PFAD = NAMENSRAUM + '/raeume';
  const HAENDE_PFAD = NAMENSRAUM + '/haende';
  const GEHEIM_PFAD = NAMENSRAUM + '/geheim';
  const ZUEGE_PFAD = NAMENSRAUM + '/zuege';

  /* Eigener Schlüssel — alle Spiele des Hubs teilen sich Origin UND
     Pfadpräfix, ein geteilter Name würde die Räume gegenseitig überschreiben. */
  const SPEICHER_SCHLUESSEL = 'spiele_letztekarte_raumcode';

  /* Ohne 0/O und 1/I: der Code wird im fahrenden Bus vorgelesen. */
  const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const MAX_SPIELER = 10;
  const MAX_BOTS = 5;

  /* Zugzeiten zur Auswahl. 0 heißt: keine Uhr. */
  const ZUGZEITEN = [0, 30, 60, 120];

  /* So oft darf jemand die Uhr verstreichen lassen, bevor ein Bot für ihn
     übernimmt. Beim dritten Mal ist klar, dass das Handy im Rucksack liegt. */
  const VERPASST_BIS_BOT = 3;

  let eigeneUid = null;
  let zeitVersatz = 0;
  let aktuellerCode = null;
  let raumRef = null;
  let handRef = null;
  let zuegeRef = null;
  let melder = null;

  let raumZustand = null;      // Spiegel von raeume/<code>
  let meineHand = [];          // Spiegel von haende/<code>/<uid>
  let fehlerText = null;

  /* Nur beim Gastgeber gefüllt: der vollständige Spielzustand. */
  let spiel = null;
  let hostUhr = null;
  let botUhr = null;
  let verpasst = {};
  let schreibtGerade = false;
  let nochmalSchreiben = false;

  /* ----------------------------------------------------------------------
     Anmeldung
     ---------------------------------------------------------------------- */

  /* Anonyme Anmeldung — das Spiel braucht kein Vereinskonto. Die uid ist
     nur dafür da, die eigene Hand von fremden zu unterscheiden. */
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

  function normiereEntwurf(e) {
    const roh = e || {};
    const m = karten.modus(roh.modus);
    let zeit = Number(roh.zugSekunden);
    if (ZUGZEITEN.indexOf(zeit) < 0) zeit = 60;
    return {
      modus: m.id,
      botAnzahl: Math.max(0, Math.min(MAX_BOTS, roh.botAnzahl | 0)),
      zugSekunden: zeit,
      serie: !!roh.serie,
    };
  }

  /**
   * Legt einen Raum an. Die Einstellungen wandern MIT in den Raum — läge
   * der Modus als Konstante im Programm, spielten zwei Geräte mit
   * unterschiedlichem Stand nach verschiedenen Regeln.
   */
  async function erstelleRaum(name, entwurf) {
    await bereit;
    const e = normiereEntwurf(entwurf);
    const code = await freierCode();

    const raum = {
      hostId: eigeneUid,
      erstellt: firebase.database.ServerValue.TIMESTAMP,
      phase: 'lobby',
      regeln: e,
      spieler: {},
      tisch: null,
      protokoll: [],
      abgebrochen: false,
    };
    raum.spieler[eigeneUid] = { name: name, beigetreten: firebase.database.ServerValue.TIMESTAMP };

    await db.ref(RAEUME_PFAD + '/' + code).set(raum);
    merkeCode(code);
    horche(code);
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
       mitten in der Partie aus der eigenen Hand aus. */
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
    horche(code);
    return code;
  }

  /**
   * Startet die Partie. Nur der Gastgeber.
   *
   * ⚠️ Verlässt sich NICHT auf `raumZustand`: unmittelbar nach dem Anlegen
   * hat der Horcher noch nicht gefeuert, das Feld ist dann null und der
   * Start liefe still ins Leere. Genau daran ist der Solo-Weg im Depot-Duell
   * hängen geblieben.
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

    const e = normiereEntwurf(raum.regeln);
    const menschen = Object.keys(raum.spieler || {});
    const botListe = bots.feld(e.botAnzahl);

    /* Sitzordnung: Menschen zuerst in Beitrittsreihenfolge, dann die Bots.
       Danach einmal durchmischen, damit der Gastgeber nicht immer anfängt. */
    const uids = karten.mische(menschen.concat(botListe.map(function (b) { return b.uid; })));

    const namen = {};
    for (const uid of menschen) namen[uid] = raum.spieler[uid].name;
    for (const b of botListe) namen[b.uid] = b.name;
    regeln.setzeNamen(namen);

    spiel = regeln.neueRunde(e.modus, uids, null, {});
    spiel.tisch.zugSeit = serverJetzt();
    verpasst = {};

    await db.ref(RAEUME_PFAD + '/' + aktuellerCode).update({
      phase: 'laeuft',
      startZeit: firebase.database.ServerValue.TIMESTAMP,
      botListe: botListe.map(function (b) { return { uid: b.uid, name: b.name, zeichen: b.zeichen }; }),
    });
    await veroeffentliche();
    starteHostUhr();
  }

  /* ----------------------------------------------------------------------
     Veröffentlichen — die zwei Sichten
     ----------------------------------------------------------------------
     ⚠️ In Firebase darf kein `undefined` landen; JSON.parse(JSON.stringify)
     räumt das mit weg. Der Umweg ist billiger als eine Feldliste, die bei
     jeder neuen Regel nachgepflegt werden müsste. */

  function sauber(x) {
    return JSON.parse(JSON.stringify(x === undefined ? null : x));
  }

  /**
   * Schreibt Tisch, Hände und den geheimen Rest.
   *
   * ⚠️ In-Flight-Guard: Läuft schon ein Schreibvorgang, wird kein zweiter
   * gestartet, sondern nur gemerkt, dass danach noch einmal geschrieben
   * werden muss. Ohne das überholen sich zwei Züge, die kurz hintereinander
   * kommen, und der ältere Tisch landet zuletzt in der Datenbank.
   */
  async function veroeffentliche() {
    if (!spiel || !aktuellerCode) return;
    if (schreibtGerade) { nochmalSchreiben = true; return; }
    schreibtGerade = true;
    try {
      const code = aktuellerCode;
      const daten = {};
      daten[RAEUME_PFAD + '/' + code + '/tisch'] = sauber(spiel.tisch);
      daten[RAEUME_PFAD + '/' + code + '/protokoll'] = sauber(spiel.protokoll);

      /* Nur Menschen brauchen eine veröffentlichte Hand. Bot-Hände bleiben
         im geheimen Knoten — eine `bot-`Kennung ist nie die eigene uid,
         niemand könnte sie je lesen. */
      for (const uid in spiel.haende) {
        if (bots.istBot(uid)) continue;
        daten[HAENDE_PFAD + '/' + code + '/' + uid] = sauber(spiel.haende[uid]);
      }

      daten[GEHEIM_PFAD + '/' + code] = sauber({
        stapel: spiel.stapel,
        ablagestapel: spiel.ablagestapel,
        haende: spiel.haende,
        verpasst: verpasst,
      });

      await db.ref().update(daten);
    } catch (f) {
      fehlerText = 'Speichern fehlgeschlagen: ' + f.message;
    } finally {
      schreibtGerade = false;
      if (nochmalSchreiben) { nochmalSchreiben = false; veroeffentliche(); }
    }
  }

  /**
   * Stellt den Spielzustand des Gastgebers nach einem Neuladen wieder her.
   * Ohne das steht die Partie: der Tisch ist da, aber niemand kann mehr
   * Züge anwenden, weil der Kartengeber sein Blatt vergessen hat.
   */
  async function stelleHostWiederHer() {
    if (!aktuellerCode || !raumZustand) return false;
    if (raumZustand.hostId !== eigeneUid) return false;
    if (raumZustand.phase !== 'laeuft' || !raumZustand.tisch) return false;
    if (spiel) return true;

    const s = await db.ref(GEHEIM_PFAD + '/' + aktuellerCode).once('value');
    const g = s.val();
    if (!g || !g.haende) return false;

    spiel = {
      tisch: raumZustand.tisch,
      haende: g.haende,
      stapel: g.stapel || [],
      ablagestapel: g.ablagestapel || [],
      protokoll: raumZustand.protokoll || [],
    };
    verpasst = g.verpasst || {};
    setzeNamenAusRaum();
    starteHostUhr();
    return true;
  }

  function setzeNamenAusRaum() {
    if (!raumZustand) return;
    const namen = {};
    for (const uid in (raumZustand.spieler || {})) namen[uid] = raumZustand.spieler[uid].name;
    for (const b of (raumZustand.botListe || [])) namen[b.uid] = b.name;
    regeln.setzeNamen(namen);
  }

  /* ----------------------------------------------------------------------
     Zugwünsche
     ---------------------------------------------------------------------- */

  /**
   * Schickt einen Zugwunsch ab.
   *
   * Übertragen wird die KARTE, nicht ihr Platz in der Hand: bis der Wunsch
   * beim Gastgeber ankommt, kann sich die Hand verschoben haben (eine Strafe
   * ist eingetroffen), und ein Index zeigte dann auf etwas anderes als das,
   * worauf der Finger gedrückt hat.
   */
  async function sendeZug(zug) {
    await bereit;
    if (!aktuellerCode) throw new Error('Du bist in keinem Raum.');
    const eintrag = {
      art: zug.art,
      karte: zug.karte === undefined ? null : zug.karte,
      farbe: zug.farbe === undefined ? null : zug.farbe,
      sagtUno: !!zug.sagtUno,
      ziel: zug.ziel === undefined ? null : zug.ziel,
      zugNr: zug.zugNr === undefined ? -1 : zug.zugNr,
      zeit: firebase.database.ServerValue.TIMESTAMP,
    };

    /* Der Gastgeber braucht den Umweg über die Datenbank nicht — er wendet
       seinen eigenen Zug sofort an. Das spart im Funkloch eine Rundreise
       und macht das eigene Spiel spürbar flüssiger. */
    if (raumZustand && raumZustand.hostId === eigeneUid && spiel) {
      wendeZugAn(eigeneUid, eintrag);
      await veroeffentliche();
      melde();
      return;
    }

    await db.ref(ZUEGE_PFAD + '/' + aktuellerCode + '/' + eigeneUid).push(eintrag);
  }

  /**
   * Wendet einen Zugwunsch an. Läuft NUR beim Gastgeber.
   *
   * `zugNr` ist der Stand, auf den sich der Wunsch bezieht. Passt er nicht
   * mehr, wird verworfen — sonst löst ein doppelt angekommener Tipper
   * (Netzwiederholung, ungeduldiger Finger) zwei Züge aus.
   */
  function wendeZugAn(uid, z) {
    if (!spiel) return;
    const t = spiel.tisch;

    /* Melden und Anfechten sind KEINE Züge im Sinne der Reihenfolge — sie
       dürfen auch von jemandem kommen, der gerade nicht dran ist. Sie
       tragen deshalb keine Zugnummer. */
    if (z.art === 'melden') { regeln.melde(spiel, uid, z.ziel || t.erwischbar, null); return; }
    if (z.art === 'uno') { regeln.rufeLetzteKarte(spiel, uid); return; }
    if (z.art === 'anfechten') { regeln.fechteAn(spiel, uid, null); zugGemacht(uid); return; }

    if (z.zugNr >= 0 && z.zugNr !== t.zugNr) return;

    if (z.art === 'legen') {
      const hand = spiel.haende[uid] || [];
      const idx = hand.indexOf(z.karte);
      if (idx < 0) return;
      regeln.lege(spiel, uid, idx, z.farbe, z.sagtUno, null);
      zugGemacht(uid);
      return;
    }
    if (z.art === 'ziehen') { regeln.ziehe(spiel, uid, null); zugGemacht(uid); return; }
    if (z.art === 'passen') { regeln.passe(spiel, uid, null); zugGemacht(uid); return; }
  }

  /** Nach jedem echten Zug: Uhr zurücksetzen, Verpasst-Zähler löschen. */
  function zugGemacht(uid) {
    if (!spiel) return;
    spiel.tisch.zugSeit = serverJetzt();
    verpasst[uid] = 0;
    pruefeSerienEnde();
  }

  function pruefeSerienEnde() {
    const t = spiel.tisch;
    if (t.phase !== 'rundeVorbei') return;
    if (!raumZustand || !raumZustand.regeln || !raumZustand.regeln.serie) {
      t.serieVorbei = true;
      return;
    }
    t.serieVorbei = !!regeln.serieVorbei(spiel);
  }

  /* ----------------------------------------------------------------------
     Die Gastgeber-Schleife
     ----------------------------------------------------------------------
     Sie tut drei Dinge: eingegangene Zugwünsche abarbeiten, Bots ziehen
     lassen und die Zug-Uhr überwachen. Sie läuft nur auf einem Gerät. */

  function starteHostUhr() {
    stoppeHostUhr();
    zuegeRef = db.ref(ZUEGE_PFAD + '/' + aktuellerCode);
    zuegeRef.on('child_added', function (spielerSchnappschuss) {
      const uid = spielerSchnappschuss.key;
      spielerSchnappschuss.forEach(function (zugSchnappschuss) {
        verarbeite(uid, zugSchnappschuss);
      });
    });
    zuegeRef.on('child_changed', function (spielerSchnappschuss) {
      const uid = spielerSchnappschuss.key;
      spielerSchnappschuss.forEach(function (zugSchnappschuss) {
        verarbeite(uid, zugSchnappschuss);
      });
    });

    hostUhr = setInterval(tick, 1000);
    /* Die Bots ticken schneller als die Uhr, sonst wirkt eine Runde mit
       fünf KI-Spielern wie eine Diashow. */
    botUhr = setInterval(botTick, 350);
  }

  function stoppeHostUhr() {
    if (zuegeRef) { zuegeRef.off(); zuegeRef = null; }
    if (hostUhr) { clearInterval(hostUhr); hostUhr = null; }
    if (botUhr) { clearInterval(botUhr); botUhr = null; }
    gesehen = {};
  }

  /* ⚠️ Alles, was `spiel` verändert, läuft NACHEINANDER über diese Kette.
     Vorher stand hier ein Guard (`if (inArbeit) return`) — der warf jeden
     Zugwunsch weg, der während eines Netz-Roundtrips eintraf. Er wurde nicht
     angewendet, nicht gelöscht, und nichts holte ihn nach: `child_added`
     feuert für denselben Schlüssel kein zweites Mal. Genau das traf
     „Erwischt!", „Letzte Karte!" und „Anfechten" — die drei Wünsche, die
     mehrere Leute im selben Augenblick tippen. Werwolf löst es seit dem
     02.09. so; eine Kette verliert nichts. */
  let kette = Promise.resolve();
  function nacheinander(fn) {
    const p = kette.then(fn, fn);
    kette = p.catch(function () { /* Fehler meldet fn selbst */ });
    return p;
  }
  let gesehen = {};   // uid/zugId → schon eingereiht (gegen Doppelverarbeitung)

  /**
   * Reiht einen Zugwunsch in die Kette ein. Jeden genau einmal —
   * `child_added` und `child_changed` liefern denselben Wunsch gern zweimal.
   */
  function verarbeite(uid, schnappschuss) {
    const schluessel = uid + '/' + schnappschuss.key;
    if (gesehen[schluessel]) return;
    gesehen[schluessel] = true;
    nacheinander(async function () {
      if (!spiel) return;
      const z = schnappschuss.val();
      if (!z) return;
      try {
        wendeZugAn(uid, z);
        await schnappschuss.ref.remove();
        await veroeffentliche();
        melde();
      } catch (f) {
        fehlerText = 'Zug konnte nicht angewendet werden: ' + f.message;
        melde();
      }
    });
  }

  /**
   * Nachlese: liest `zuege/<code>` einmal ganz und reiht ein, was noch
   * liegt. Fängt alles, was ein Horcher-Ereignis je verpassen könnte
   * (Verbindungsabriss, Neustart des Gastgebers). Dank `gesehen` doppelt
   * nichts.
   */
  function nachlese() {
    if (!aktuellerCode || !spiel) return;
    db.ref(ZUEGE_PFAD + '/' + aktuellerCode).once('value').then(function (s) {
      s.forEach(function (spielerSchnappschuss) {
        const uid = spielerSchnappschuss.key;
        spielerSchnappschuss.forEach(function (zugSchnappschuss) {
          verarbeite(uid, zugSchnappschuss);
        });
        return false;
      });
    }).catch(function () { /* nächster Versuch beim nächsten Takt */ });
  }

  /** Sekundentakt: Zug-Uhr prüfen. Läuft in derselben Kette wie die Züge. */
  let tickLaeuft = false;
  let tickZaehler = 0;
  function tick() {
    if (!spiel || tickLaeuft) return;
    if (++tickZaehler % 5 === 0) nachlese();
    tickLaeuft = true;
    nacheinander(async function () {
      try { await tickInnen(); } finally { tickLaeuft = false; }
    });
  }

  async function tickInnen() {
    if (!spiel || !raumZustand) return;
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return;

    const sekunden = (raumZustand.regeln && raumZustand.regeln.zugSekunden) || 0;
    if (!sekunden) return;

    const uid = regeln.dran(spiel);
    if (!uid || bots.istBot(uid) || t.abwesend && t.abwesend[uid]) return;

    const vergangen = (serverJetzt() - (t.zugSeit || serverJetzt())) / 1000;
    if (vergangen < sekunden) return;

    /* Zeit ist um: eine Karte ziehen und weiter. Legen darf niemand für
       einen anderen — was gespielt wird, ist eine Entscheidung. */
    verpasst[uid] = (verpasst[uid] || 0) + 1;
    if (!t.gezogen) regeln.ziehe(spiel, uid, null);
    if (spiel.tisch.phase === 'laeuft' && regeln.dran(spiel) === uid) regeln.passe(spiel, uid, null);

    if (verpasst[uid] >= VERPASST_BIS_BOT) {
      if (!t.abwesend) t.abwesend = {};
      t.abwesend[uid] = true;
      spiel.protokoll.push((raumZustand.spieler[uid] ? raumZustand.spieler[uid].name : uid) +
        ' ist nicht mehr da — die KI übernimmt.');
    }
    t.zugSeit = serverJetzt();
    await veroeffentliche();
    melde();
  }

  /** Häufiger Takt: sind Bots (oder Abwesende) am Zug? */
  let botLaeuft = false;
  function botTick() {
    if (!spiel || botLaeuft) return;
    botLaeuft = true;
    nacheinander(async function () {
      try { await botTickInnen(); } finally { botLaeuft = false; }
    });
  }

  async function botTickInnen() {
    if (!spiel) return;
    const t = spiel.tisch;
    if (t.phase !== 'laeuft') return;

    const uid = regeln.dran(spiel);
    if (!uid) return;
    const steuertKi = bots.istBot(uid) || (t.abwesend && t.abwesend[uid]);
    if (!steuertKi) {
      /* Auch wenn ein Mensch dran ist, dürfen Bots melden — sonst käme
         niemand jemals durch, der "Letzte Karte" vergisst. */
      pruefeBotMeldung();
      return;
    }

    const c = bots.charakter(indexVon(uid));
    if (!warteAbgelaufen(c)) return;

    const hand = spiel.haende[uid] || [];
    const zug = bots.waehleZug(t, hand, c, null);

    if (zug.art === 'legen') {
      regeln.lege(spiel, uid, zug.idx, zug.farbe, zug.sagtUno, null);
    } else if (zug.art === 'ziehen') {
      regeln.ziehe(spiel, uid, null);
    } else {
      regeln.passe(spiel, uid, null);
    }
    zugGemacht(uid);
    await veroeffentliche();
    melde();
  }

  /* Der Bot denkt kurz nach, bevor er zieht. Ohne diese Pause springt eine
     Runde mit fünf Bots in einem einzigen Bild durch und niemand sieht,
     was passiert ist. */
  let botWarteBis = 0;
  function warteAbgelaufen(c) {
    const jetzt = Date.now();
    if (botWarteBis === 0) { botWarteBis = jetzt + c.denkzeit; return false; }
    if (jetzt < botWarteBis) return false;
    botWarteBis = 0;
    return true;
  }

  function indexVon(uid) {
    for (let i = 0; i < bots.CHARAKTERE.length; i++) if (bots.uidFuer(i) === uid) return i;
    return 0;
  }

  let meldeWarteBis = 0;
  function pruefeBotMeldung() {
    const t = spiel.tisch;
    if (!t.erwischbar) { meldeWarteBis = 0; return; }
    const jetzt = Date.now();
    if (meldeWarteBis === 0) { meldeWarteBis = jetzt + 1200; return; }
    if (jetzt < meldeWarteBis) return;
    meldeWarteBis = 0;

    for (const uid of t.reihenfolge) {
      if (!bots.istBot(uid) && !(t.abwesend && t.abwesend[uid])) continue;
      const c = bots.charakter(indexVon(uid));
      if (bots.willMelden(t, c, uid, null)) {
        regeln.melde(spiel, uid, t.erwischbar, null);
        veroeffentliche();
        melde();
        return;
      }
    }
  }

  /* ----------------------------------------------------------------------
     Nächste Runde einer Serie
     ---------------------------------------------------------------------- */

  async function naechsteRunde() {
    await bereit;
    if (!spiel || !raumZustand || raumZustand.hostId !== eigeneUid) return;
    if (spiel.tisch.phase !== 'rundeVorbei') return;

    const uids = spiel.tisch.reihenfolge.slice();
    const punkte = spiel.tisch.punkte;
    setzeNamenAusRaum();
    spiel = regeln.neueRunde(raumZustand.regeln.modus, uids, null, punkte);
    spiel.tisch.zugSeit = serverJetzt();
    verpasst = {};
    await veroeffentliche();
    melde();
  }

  /* ----------------------------------------------------------------------
     Zuhören
     ---------------------------------------------------------------------- */

  function horche(code) {
    loeseHorcher();
    aktuellerCode = code;

    raumRef = db.ref(RAEUME_PFAD + '/' + code);
    raumRef.on('value', function (s) {
      raumZustand = s.val();
      if (!raumZustand) { verlasseLokal(); melde(); return; }
      setzeNamenAusRaum();

      if (raumZustand.hostId === eigeneUid) {
        if (raumZustand.phase === 'laeuft' && !spiel) {
          stelleHostWiederHer().then(melde);
        } else if (raumZustand.phase === 'laeuft' && spiel && !hostUhr) {
          starteHostUhr();
        }
      }
      melde();
    }, function (f) {
      fehlerText = 'Verbindung zum Raum verloren: ' + f.message;
      melde();
    });

    handRef = db.ref(HAENDE_PFAD + '/' + code + '/' + eigeneUid);
    handRef.on('value', function (s) {
      meineHand = s.val() || [];
      melde();
    }, function () { /* vor dem Austeilen gibt es die Hand noch nicht */ });
  }

  function loeseHorcher() {
    if (raumRef) { raumRef.off(); raumRef = null; }
    if (handRef) { handRef.off(); handRef = null; }
    stoppeHostUhr();
  }

  function melde() { if (melder) melder(getZustand()); }

  function onZustandsAenderung(rueckruf) {
    melder = rueckruf;
    melde();
  }

  /**
   * Der Zustand, den die Oberfläche sieht.
   *
   * `meineHand` kommt beim Gastgeber aus seinem eigenen Spielzustand, bei
   * allen anderen aus der veröffentlichten Sicht. Beides ist dieselbe Liste
   * — der Gastgeber spart sich nur den Umweg über das Netz.
   */
  function getZustand() {
    const istHost = !!(raumZustand && raumZustand.hostId === eigeneUid);
    let hand = meineHand;
    if (istHost && spiel && spiel.haende[eigeneUid]) hand = spiel.haende[eigeneUid];

    return {
      uid: eigeneUid,
      code: aktuellerCode,
      raum: raumZustand,
      tisch: raumZustand ? raumZustand.tisch : null,
      protokoll: raumZustand ? (raumZustand.protokoll || []) : [],
      hand: hand || [],
      istHost: istHost,
      fehler: fehlerText,
      serverJetzt: serverJetzt(),
    };
  }

  /* ----------------------------------------------------------------------
     Verlassen und Aufräumen
     ---------------------------------------------------------------------- */

  function merkeCode(code) {
    try { localStorage.setItem(SPEICHER_SCHLUESSEL, code); } catch (f) { /* Privatmodus */ }
  }

  function vergissCode() {
    try { localStorage.removeItem(SPEICHER_SCHLUESSEL); } catch (f) { /* Privatmodus */ }
  }

  function gemerkterCode() {
    try { return localStorage.getItem(SPEICHER_SCHLUESSEL); } catch (f) { return null; }
  }

  function verlasseLokal() {
    loeseHorcher();
    aktuellerCode = null;
    raumZustand = null;
    meineHand = [];
    spiel = null;
    verpasst = {};
    vergissCode();
  }

  /** Aussteigen. Der Gastgeber räumt den ganzen Raum ab. */
  async function verlasse() {
    await bereit;
    const code = aktuellerCode;
    const warHost = !!(raumZustand && raumZustand.hostId === eigeneUid);
    if (!code) { verlasseLokal(); melde(); return; }

    try {
      if (warHost) {
        /* ⚠️ Reihenfolge: die Nebenpfade zuerst, der Raum ZULETZT. Die Rules
           prüfen gegen `raeume/<code>/hostId` — wäre der Raum schon weg,
           erfüllte niemand mehr die Bedingung und die Nebenpfade blieben
           für immer liegen. */
        await db.ref(RAEUME_PFAD + '/' + code + '/phase').set('beendet');
        await db.ref(HAENDE_PFAD + '/' + code).remove();
        await db.ref(GEHEIM_PFAD + '/' + code).remove();
        await db.ref(ZUEGE_PFAD + '/' + code).remove();
        await db.ref(RAEUME_PFAD + '/' + code).remove();
      } else {
        await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).remove();
        await db.ref(HAENDE_PFAD + '/' + code + '/' + eigeneUid).remove();
      }
    } catch (f) {
      /* Aufräumen darf nie den Ausstieg verhindern. */
    }
    verlasseLokal();
    melde();
  }

  /** Nach einem Neuladen: war ich in einem Raum? */
  async function stelleVerbindungWiederHer() {
    await bereit;
    const code = gemerkterCode();
    if (!code) return null;
    const s = await db.ref(RAEUME_PFAD + '/' + code).once('value');
    const raum = s.val();
    if (!raum || !raum.spieler || !raum.spieler[eigeneUid]) { vergissCode(); return null; }
    horche(code);
    return code;
  }

  /* Nur der Gastgeber kann die Einstellungen ändern, und nur in der Lobby —
     danach würde eine Änderung eine bereits laufende Partie rückwirkend
     nach anderen Regeln bewerten. */
  async function setzeRegeln(entwurf) {
    await bereit;
    if (!aktuellerCode || !raumZustand) return;
    if (raumZustand.hostId !== eigeneUid || raumZustand.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/regeln').set(normiereEntwurf(entwurf));
  }

  return {
    MAX_SPIELER: MAX_SPIELER,
    MAX_BOTS: MAX_BOTS,
    ZUGZEITEN: ZUGZEITEN,
    bereit: bereit,

    erstelleRaum: erstelleRaum,
    betreteRaum: betreteRaum,
    starteRaum: starteRaum,
    setzeRegeln: setzeRegeln,
    naechsteRunde: naechsteRunde,
    verlasse: verlasse,
    stelleVerbindungWiederHer: stelleVerbindungWiederHer,

    sendeZug: sendeZug,
    onZustandsAenderung: onZustandsAenderung,
    getZustand: getZustand,
    serverJetzt: serverJetzt,
  };
})();
