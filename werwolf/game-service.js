/* ==========================================================================
   Werwolf — Firebase-Anbindung
   ==========================================================================

   DER ERZÄHLER IST DAS HOST-GERÄT.

   Es hält den vollständigen Spielzustand (`spiel`, siehe regeln.js), wendet
   jede Aktion an und veröffentlicht danach drei Sichten:

     raeume/<code>/sicht     was ALLE sehen dürfen — Phase, wer lebt, Tote,
                             Stimmen, Chronik
     privat/<code>/<uid>     was EIN Spieler sehen darf — seine Rolle,
                             seine Mitwölfe, seine Aufgabe in dieser Nacht
     geheim/<code>           der ganze Zustand, nur für den Erzähler —
                             damit er nach einem Neuladen weitermachen kann

   Mitspieler schreiben nie in den Raum. Sie legen eine Aktion in
   aktionen/<code>/<uid> ab; der Erzähler prüft sie gegen seinen Zustand
   und wendet sie an oder verwirft sie. Damit gilt dieselbe Regelprüfung für
   jedes Gerät, auch für ein manipuliertes.

   ⚠️ WISSENSVORSPRUNG DES ERZÄHLERS — BEWUSST HINGENOMMEN.
   Spielt der Host mit, könnte er mit den Entwicklerwerkzeugen alle Rollen
   sehen. Anders geht es nicht: irgendein Gerät muss die Nacht auflösen, und
   dafür muss es alle Aktionen kennen. Alle ANDEREN sehen nichts — die Rules
   geben `privat/<code>/<uid>` nur an den Besitzer und `geheim/<code>` nur
   an den Erzähler heraus. Wer das nicht will, wählt „Nur Erzähler" und legt
   ein Gerät in die Mitte.

   ⚠️ Firebase liest die Rules NICHT aus dem Repo. `database.rules.json`
   muss von Hand in der Konsole veröffentlicht werden, sonst ist das Spiel
   live tot: die Wurzel steht auf false/false.
   ========================================================================== */

const gameService = (function () {
  'use strict';

  const NAMENSRAUM = 'werwolf';
  const RAEUME_PFAD = NAMENSRAUM + '/raeume';
  const PRIVAT_PFAD = NAMENSRAUM + '/privat';
  const GEHEIM_PFAD = NAMENSRAUM + '/geheim';
  const AKTIONEN_PFAD = NAMENSRAUM + '/aktionen';

  /* Eigener Schlüssel — alle Spiele des Hubs teilen sich Origin UND
     Pfadpräfix, ein geteilter Name würde die Räume gegenseitig überschreiben. */
  const SPEICHER_SCHLUESSEL = 'spiele_werwolf_raumcode';
  const NAME_SCHLUESSEL = 'spiele_werwolf_name';

  /* Ohne 0/O und 1/I: der Code wird am Tisch vorgelesen. */
  const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const MAX_SPIELER = 20;
  const MIN_SPIELER = 5;

  let eigeneUid = null;
  let zeitVersatz = 0;
  let aktuellerCode = null;
  let raumRef = null;
  let privatRef = null;
  let aktionenRef = null;
  let melder = null;
  let ansager = null;         // Rückruf für Ansagen (Sprachausgabe), nur Host

  let raumZustand = null;     // Spiegel von raeume/<code>
  let meineSicht = null;      // Spiegel von privat/<code>/<uid>
  let fehlerText = null;

  /* Nur beim Erzähler gefüllt. */
  let spiel = null;
  let schrittSeit = 0;        // Serverzeit, seit der der laufende Nachtschritt steht
  let hostUhr = null;
  let schreibtGerade = false;
  let nochmalSchreiben = false;
  let inArbeit = false;
  let angesagt = null;        // Schlüssel des zuletzt angesagten Zustands

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

  function sauberName(name) {
    return String(name || '').trim().slice(0, 24);
  }

  /**
   * Legt einen Raum an. `spieltMit` = der Host sitzt selbst am Tisch;
   * sonst ist sein Gerät nur der Erzähler in der Mitte.
   */
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
      einstellungen: regeln.normiereEinstellungen(einstellungen),
      zusammenstellung: {},
      spieler: {},
      sicht: null,
      abgebrochen: false,
    };
    if (spieltMit) raum.spieler[eigeneUid] = { name: name, beigetreten: firebase.database.ServerValue.TIMESTAMP, reihe: 0 };
    await db.ref(RAEUME_PFAD + '/' + code).set(raum);
    merkeCode(code);
    merkeName(name);
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
       mitten in der Nacht aus der eigenen Rolle aus. */
    if (!dabei) {
      if (!name) throw new Error('Bitte einen Namen eingeben.');
      if (raum.phase !== 'lobby') throw new Error('Diese Partie läuft bereits.');
      const anzahl = raum.spieler ? Object.keys(raum.spieler).length : 0;
      if (anzahl >= MAX_SPIELER) throw new Error('Der Raum ist voll.');
      await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).set({
        name: name,
        beigetreten: firebase.database.ServerValue.TIMESTAMP,
        reihe: anzahl,
      });
    }
    merkeCode(code);
    if (name) merkeName(name);
    horche(code);
    return code;
  }

  function istHost() { return !!raumZustand && raumZustand.hostId === eigeneUid; }
  function spieltMit() { return !!raumZustand && !!(raumZustand.spieler && raumZustand.spieler[eigeneUid]); }

  /* ----------------------------------------------------------------------
     Lobby — nur der Host ändert etwas
     ---------------------------------------------------------------------- */

  function spielerSortiert(raum) {
    const liste = [];
    for (const uid in (raum.spieler || {})) liste.push({ uid: uid, name: raum.spieler[uid].name, reihe: raum.spieler[uid].reihe | 0, beigetreten: raum.spieler[uid].beigetreten || 0 });
    liste.sort(function (a, b) { return (a.reihe - b.reihe) || (a.beigetreten - b.beigetreten); });
    return liste;
  }

  async function setzeZusammenstellung(z) {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/zusammenstellung').set(z);
  }

  async function setzeEinstellungen(e) {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/einstellungen').set(regeln.normiereEinstellungen(e));
  }

  async function entferneSpieler(uid) {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode + '/spieler/' + uid).remove();
  }

  async function verschiebeSpieler(uid, richtung) {
    if (!istHost() || raumZustand.phase !== 'lobby') return;
    const liste = spielerSortiert(raumZustand);
    const i = liste.findIndex(function (s) { return s.uid === uid; });
    const j = i + richtung;
    if (i < 0 || j < 0 || j >= liste.length) return;
    const t = liste[i]; liste[i] = liste[j]; liste[j] = t;
    const daten = {};
    liste.forEach(function (s, k) { daten[RAEUME_PFAD + '/' + aktuellerCode + '/spieler/' + s.uid + '/reihe'] = k; });
    await db.ref().update(daten);
  }

  /**
   * Startet die Partie. Nur der Erzähler.
   *
   * ⚠️ Verlässt sich NICHT allein auf `raumZustand`: unmittelbar nach dem
   * Anlegen hat der Horcher noch nicht gefeuert.
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

    const liste = spielerSortiert(raum);
    if (liste.length < MIN_SPIELER) throw new Error('Es braucht mindestens ' + MIN_SPIELER + ' Spieler.');
    const p = rollen.pruefe(liste.length, raum.zusammenstellung || {});
    if (!p.ok) throw new Error(p.fehler.join(' '));

    spiel = regeln.neuesSpiel(liste.map(function (s) { return { uid: s.uid, name: s.name }; }), raum.zusammenstellung, raum.einstellungen, Math.random);
    angesagt = null;
    await db.ref(RAEUME_PFAD + '/' + aktuellerCode).update({
      phase: 'laeuft',
      startZeit: firebase.database.ServerValue.TIMESTAMP,
    });
    await veroeffentliche();
    starteHostUhr();
  }

  /* ----------------------------------------------------------------------
     Veröffentlichen — die drei Sichten
     ---------------------------------------------------------------------- */

  function sauber(x) {
    return JSON.parse(JSON.stringify(x === undefined ? null : x));
  }

  /**
   * ⚠️ In-Flight-Guard: läuft schon ein Schreibvorgang, wird kein zweiter
   * gestartet, sondern nur gemerkt, dass danach noch einmal geschrieben
   * werden muss. Sonst überholen sich zwei Aktionen, die kurz hintereinander
   * kommen, und der ältere Stand landet zuletzt in der Datenbank.
   */
  async function veroeffentliche() {
    if (!spiel || !aktuellerCode) return;
    if (schreibtGerade) { nochmalSchreiben = true; return; }
    schreibtGerade = true;
    try {
      const code = aktuellerCode;
      const daten = {};
      daten[RAEUME_PFAD + '/' + code + '/sicht'] = sauber(regeln.oeffentlicheSicht(spiel));
      for (const s of spiel.spieler) {
        const sicht = regeln.sichtFuer(spiel, s.uid);
        sicht.jaeger = regeln.jaegerSicht(spiel, s.uid);
        daten[PRIVAT_PFAD + '/' + code + '/' + s.uid] = sauber(sicht);
      }
      daten[GEHEIM_PFAD + '/' + code] = sauber({ spiel: spiel, schrittSeit: schrittSeit });
      await db.ref().update(daten);
    } catch (f) {
      fehlerText = 'Speichern fehlgeschlagen: ' + f.message;
    } finally {
      schreibtGerade = false;
      if (nochmalSchreiben) { nochmalSchreiben = false; veroeffentliche(); }
    }
  }

  /**
   * Stellt den Zustand des Erzählers nach einem Neuladen wieder her.
   * Ohne das stünde die Partie: die Sichten sind da, aber niemand kann mehr
   * Aktionen anwenden.
   */
  async function stelleHostWiederHer() {
    if (!aktuellerCode || !raumZustand) return false;
    if (raumZustand.hostId !== eigeneUid) return false;
    if (raumZustand.phase !== 'laeuft') return false;
    if (spiel) return true;
    const s = await db.ref(GEHEIM_PFAD + '/' + aktuellerCode).once('value');
    const g = s.val();
    if (!g || !g.spiel) return false;
    spiel = g.spiel;
    /* Firebase lässt leere Objekte und Listen weg — die Regeln erwarten sie. */
    spiel.spieler = spiel.spieler || [];
    spiel.uebrigeKarten = spiel.uebrigeKarten || [];
    spiel.bereit = spiel.bereit || {};
    spiel.jaegerAusstehend = spiel.jaegerAusstehend || [];
    spiel.chronik = spiel.chronik || [];
    spiel.zusammenstellung = spiel.zusammenstellung || {};
    if (spiel.nacht) {
      spiel.nacht.eingaben = spiel.nacht.eingaben || {};
      spiel.nacht.zusatzTote = spiel.nacht.zusatzTote || [];
    }
    if (spiel.tag) {
      spiel.tag.stimmen = spiel.tag.stimmen || {};
      spiel.tag.tote = spiel.tag.tote || [];
    }
    for (const sp of spiel.spieler) {
      sp.lebt = !!sp.lebt; sp.verliebt = !!sp.verliebt; sp.verzaubert = !!sp.verzaubert;
    }
    schrittSeit = g.schrittSeit || serverJetzt();
    angesagt = zustandsSchluessel();   // nicht noch einmal ansagen, was schon lief
    starteHostUhr();
    return true;
  }

  /* ----------------------------------------------------------------------
     Aktionen der Spieler
     ---------------------------------------------------------------------- */

  /**
   * Schickt eine Aktion ab. Der Erzähler wendet seine eigene sofort an —
   * spart im Funkloch eine Rundreise.
   */
  async function sendeAktion(aktion) {
    await bereit;
    if (!aktuellerCode) throw new Error('Du bist in keinem Raum.');
    const eintrag = sauber(aktion);
    eintrag.zeit = firebase.database.ServerValue.TIMESTAMP;
    if (istHost() && spiel) {
      const r = wendeAktionAn(eigeneUid, eintrag);
      await veroeffentliche();
      melde();
      if (!r.ok) throw new Error(r.fehler);
      return;
    }
    await db.ref(AKTIONEN_PFAD + '/' + aktuellerCode + '/' + eigeneUid).push(eintrag);
  }

  /** Wendet eine Aktion an. Läuft NUR beim Erzähler. */
  function wendeAktionAn(uid, a) {
    if (!spiel) return { ok: false, fehler: 'Kein Spiel.' };
    let r;
    switch (a.art) {
      case 'rolleGesehen': r = regeln.rolleGesehen(spiel, uid); break;
      case 'nacht': r = regeln.nachtAktion(spiel, uid, a); break;
      case 'stimme': r = regeln.stimme(spiel, uid, a.ziel || null); break;
      case 'jaeger': r = regeln.jaegerSchuss(spiel, uid, a.ziel); break;
      default: r = { ok: false, fehler: 'Unbekannte Aktion.' };
    }
    if (r.ok) nachAenderung();
    return r;
  }

  /** Nach jeder Zustandsänderung: Ansagen, Siegprüfung, Zeitmarken. */
  function nachAenderung() {
    if (!spiel) return;
    if (spiel.phase === 'tag' && spiel.tag && spiel.tag.schritt === 'diskussion' && !spiel.tag.diskussionStart) {
      regeln.diskussionGestartet(spiel, serverJetzt());
    }
    sageAn();
  }

  /* ----------------------------------------------------------------------
     Erzähler-Befehle
     ---------------------------------------------------------------------- */

  async function hostBefehl(fn) {
    if (!istHost() || !spiel) return;
    const r = fn(spiel);
    if (r && r.ok === false) { fehlerText = r.fehler; melde(); return; }
    nachAenderung();
    await veroeffentliche();
    melde();
  }

  function nachtBeginnen() {
    return hostBefehl(function (sp) {
      const r = regeln.starteNacht(sp);
      if (r.ok) schrittSeit = serverJetzt();
      return r;
    });
  }

  function schrittErzwingen() {
    return hostBefehl(function (sp) {
      const r = regeln.schrittErzwingen(sp);
      if (r.ok) schrittSeit = serverJetzt();
      return r;
    });
  }

  function tagWeiter() {
    return hostBefehl(function (sp) {
      const r = regeln.tagWeiter(sp);
      if (r.ok && sp.phase === 'nacht') schrittSeit = serverJetzt();
      return r;
    });
  }

  function jaegerUeberspringen() { return hostBefehl(regeln.jaegerUeberspringen); }
  function toeteManuell(uid) { return hostBefehl(function (sp) { return regeln.toeteManuell(sp, uid); }); }

  /* ----------------------------------------------------------------------
     Die Erzähler-Schleife
     ----------------------------------------------------------------------
     Eingegangene Aktionen anwenden, die Nacht Schritt für Schritt
     weiterschalten, die Diskussionsuhr überwachen. Läuft nur auf einem Gerät. */

  function starteHostUhr() {
    stoppeHostUhr();
    aktionenRef = db.ref(AKTIONEN_PFAD + '/' + aktuellerCode);
    aktionenRef.on('child_added', function (spielerSchnappschuss) {
      const uid = spielerSchnappschuss.key;
      spielerSchnappschuss.forEach(function (a) { verarbeite(uid, a); });
    });
    aktionenRef.on('child_changed', function (spielerSchnappschuss) {
      const uid = spielerSchnappschuss.key;
      spielerSchnappschuss.forEach(function (a) { verarbeite(uid, a); });
    });
    hostUhr = setInterval(tick, 1000);
    sageAn();
  }

  function stoppeHostUhr() {
    if (aktionenRef) { aktionenRef.off(); aktionenRef = null; }
    if (hostUhr) { clearInterval(hostUhr); hostUhr = null; }
  }

  async function verarbeite(uid, schnappschuss) {
    if (!spiel || inArbeit) return;
    const a = schnappschuss.val();
    if (!a) return;
    inArbeit = true;
    try {
      wendeAktionAn(uid, a);
      await schnappschuss.ref.remove();
      await veroeffentliche();
      melde();
    } catch (f) {
      fehlerText = 'Aktion konnte nicht angewendet werden: ' + f.message;
    } finally {
      inArbeit = false;
    }
  }

  /** Wie viele Sekunden der laufende Nachtschritt mindestens noch steht. */
  function restWartezeit() {
    if (!spiel || spiel.phase !== 'nacht' || !spiel.nacht || !spiel.nacht.schritt) return 0;
    const soll = (spiel.regeln.wartezeitSek || 20) * 1000;
    return Math.max(0, Math.ceil((soll - (serverJetzt() - schrittSeit)) / 1000));
  }

  /** Wie viele Sekunden Diskussion noch bleiben (0 = keine Uhr oder vorbei). */
  function restDiskussion() {
    const t = spiel ? spiel.tag : (raumZustand && raumZustand.sicht ? raumZustand.sicht.tag : null);
    const r = spiel ? spiel.regeln : (raumZustand && raumZustand.sicht ? raumZustand.sicht.regeln : null);
    if (!t || t.schritt !== 'diskussion' || !r || !r.diskussionSek || !t.diskussionStart) return 0;
    return Math.max(0, Math.ceil((r.diskussionSek * 1000 - (serverJetzt() - t.diskussionStart)) / 1000));
  }

  /** Sekundentakt des Erzählers. */
  async function tick() {
    if (!spiel || inArbeit) return;

    if (spiel.phase === 'nacht' && spiel.nacht && spiel.nacht.schritt) {
      /* Ein Schritt endet erst, wenn die Mindestzeit um ist UND alle
         Eingaben da sind. Attrappen (tote Rollen) sind sofort „fertig" und
         stehen genau die Mindestzeit — von außen nicht zu unterscheiden. */
      if (restWartezeit() > 0) return;
      if (!regeln.schrittFertig(spiel)) return;
      inArbeit = true;
      try {
        const alt = regeln.aktuellerSchritt(spiel);
        if (alt && alt.schlafEin && ansager) ansager(alt.schlafEin, 'schlafEin');
        regeln.weiter(spiel);
        schrittSeit = serverJetzt();
        nachAenderung();
        await veroeffentliche();
        melde();
      } finally { inArbeit = false; }
      return;
    }

    if (spiel.phase === 'tag' && spiel.tag && spiel.tag.schritt === 'diskussion') {
      if (!spiel.tag.diskussionStart) { regeln.diskussionGestartet(spiel, serverJetzt()); await veroeffentliche(); melde(); return; }
      if (restDiskussion() > 0) { melde(); return; }
      inArbeit = true;
      try {
        regeln.tagWeiter(spiel);
        nachAenderung();
        await veroeffentliche();
        melde();
      } finally { inArbeit = false; }
    }
  }

  /* ----------------------------------------------------------------------
     Ansagen — nur der Erzähler spricht
     ---------------------------------------------------------------------- */

  function zustandsSchluessel() {
    if (!spiel) return null;
    if (spiel.phase === 'nacht') return 'nacht:' + spiel.nachtNr + ':' + (spiel.nacht ? spiel.nacht.schrittNr : '');
    if (spiel.phase === 'tag') return 'tag:' + spiel.nachtNr + ':' + spiel.tag.schritt + ':' + (spiel.tag.tote || []).length + ':' + (spiel.tag.meldung || '');
    if (spiel.phase === 'ende') return 'ende';
    return spiel.phase;
  }

  /** Text, der zum aktuellen Zustand gesprochen wird. */
  function ansageText() {
    if (!spiel) return '';
    if (spiel.phase === 'rollen') return 'Jeder sieht sich jetzt seine Rolle an.';
    if (spiel.phase === 'nacht') {
      const s = regeln.aktuellerSchritt(spiel);
      if (!s) return '';
      const vorspann = spiel.nacht.schrittNr === 0 ? 'Es wird Nacht. Das Dorf schläft ein. ' : '';
      return vorspann + s.wachAuf;
    }
    if (spiel.phase === 'tag') {
      const t = spiel.tag;
      if (t.schritt === 'morgen' || t.schritt === 'ergebnis') {
        const tote = t.tote || [];
        let text = t.schritt === 'morgen' ? 'Der Morgen bricht an. ' : '';
        if (t.meldung) text += t.meldung + ' ';
        if (tote.length === 0) text += t.schritt === 'morgen' ? 'Niemand ist gestorben.' : '';
        else {
          const zeigen = spiel.regeln.rollenAufdecken;
          text += tote.map(function (x) {
            return x.name + (zeigen ? ' war ' + rollen.name(x.rolle) + ' und' : '') + ' ist ' + (regeln.URSACHE_TEXT[x.ursache] || 'gestorben');
          }).join('. ') + '.';
        }
        return text;
      }
      if (t.schritt === 'jaeger') return t.meldung || 'Der Jäger schießt.';
      if (t.schritt === 'diskussion') {
        const min = Math.round(spiel.regeln.diskussionSek / 60);
        return 'Das Dorf berät sich. ' + (min > 0 ? 'Ihr habt ' + min + (min === 1 ? ' Minute.' : ' Minuten.') : '');
      }
      if (t.schritt === 'abstimmung') return 'Das Dorf stimmt ab. Jeder wählt auf seinem Handy.';
      if (t.schritt === 'stichwahl') return t.meldung || 'Stichwahl.';
    }
    if (spiel.phase === 'ende') return spiel.ende.text;
    return '';
  }

  function sageAn() {
    if (!spiel || !ansager) return;
    const k = zustandsSchluessel();
    if (k === angesagt) return;
    angesagt = k;
    const text = ansageText();
    if (text) ansager(text, spiel.phase);
  }

  /* ----------------------------------------------------------------------
     Neue Runde, Verlassen, Aufräumen
     ---------------------------------------------------------------------- */

  /** Nochmal mit derselben Runde: zurück in die Lobby, Spieler bleiben. */
  async function neueRunde() {
    if (!istHost()) return;
    stoppeHostUhr();
    spiel = null;
    angesagt = null;
    const code = aktuellerCode;
    const daten = {};
    daten[RAEUME_PFAD + '/' + code + '/phase'] = 'lobby';
    daten[RAEUME_PFAD + '/' + code + '/sicht'] = null;
    daten[PRIVAT_PFAD + '/' + code] = null;
    daten[GEHEIM_PFAD + '/' + code] = null;
    daten[AKTIONEN_PFAD + '/' + code] = null;
    await db.ref().update(daten);
  }

  /**
   * Verlässt den Raum. Der Erzähler räumt dabei alles ab.
   * ⚠️ Der Raum wird ZULETZT gelöscht — die Rules prüfen gegen
   * raeume/<code>/hostId; ist der weg, kommt niemand mehr an privat, geheim
   * und aktionen heran.
   */
  async function verlasse() {
    const code = aktuellerCode;
    const host = istHost();
    const mitspieler = spieltMit();
    const phase = raumZustand ? raumZustand.phase : null;
    verlasseLokal();
    if (!code) return;
    try {
      if (host) {
        await db.ref(RAEUME_PFAD + '/' + code + '/phase').set('beendet');
        const daten = {};
        daten[PRIVAT_PFAD + '/' + code] = null;
        daten[GEHEIM_PFAD + '/' + code] = null;
        daten[AKTIONEN_PFAD + '/' + code] = null;
        await db.ref().update(daten);
        await db.ref(RAEUME_PFAD + '/' + code).remove();
      } else if (mitspieler && phase === 'lobby') {
        await db.ref(RAEUME_PFAD + '/' + code + '/spieler/' + eigeneUid).remove();
      }
    } catch (f) { /* Raum ist vielleicht schon weg */ }
  }

  function verlasseLokal() {
    stoppeHostUhr();
    loeseHorcher();
    vergissCode();
    aktuellerCode = null;
    raumZustand = null;
    meineSicht = null;
    spiel = null;
    angesagt = null;
    melde();
  }

  /* ----------------------------------------------------------------------
     Horcher und Zustand
     ---------------------------------------------------------------------- */

  function horche(code) {
    loeseHorcher();
    aktuellerCode = code;
    raumRef = db.ref(RAEUME_PFAD + '/' + code);
    raumRef.on('value', function (s) {
      raumZustand = s.val();
      if (!raumZustand) {
        /* Der Erzähler hat den Raum aufgelöst. */
        verlasseLokal();
        fehlerText = 'Der Raum wurde geschlossen.';
        melde();
        return;
      }
      if (raumZustand.phase === 'laeuft' && raumZustand.hostId === eigeneUid && !spiel) {
        stelleHostWiederHer().then(melde);
      }
      if (raumZustand.phase === 'lobby' && raumZustand.hostId === eigeneUid && spiel) {
        /* Neue Runde von einem anderen Fenster des Hosts — nachziehen. */
        stoppeHostUhr(); spiel = null;
      }
      melde();
    }, function (f) {
      fehlerText = 'Verbindung verloren: ' + f.message;
      melde();
    });
    privatRef = db.ref(PRIVAT_PFAD + '/' + code + '/' + eigeneUid);
    privatRef.on('value', function (s) {
      meineSicht = s.val();
      melde();
    }, function () { /* vor der Rollenvergabe gibt es die Sicht noch nicht */ });
  }

  function loeseHorcher() {
    if (raumRef) { raumRef.off(); raumRef = null; }
    if (privatRef) { privatRef.off(); privatRef = null; }
  }

  function melde() { if (melder) melder(getZustand()); }

  function onZustandsAenderung(rueckruf) {
    melder = rueckruf;
    bereit.then(function () {
      const code = gemerkterCode();
      if (code && !aktuellerCode) {
        betreteRaum(code, gemerkterName()).catch(function () { vergissCode(); melde(); });
      }
      melde();
    }).catch(melde);
  }

  function onAnsage(rueckruf) { ansager = rueckruf; }

  function getZustand() {
    const f = fehlerText;
    fehlerText = null;
    return {
      uid: eigeneUid,
      code: aktuellerCode,
      raum: raumZustand,
      sicht: raumZustand ? raumZustand.sicht : null,
      privat: meineSicht,
      istHost: istHost(),
      spieltMit: spieltMit(),
      spielerListe: raumZustand ? spielerSortiert(raumZustand) : [],
      /* Der Erzähler sieht mehr — aber nur, wenn er nicht mitspielt. */
      erzaehlerSicht: (istHost() && spiel && !spieltMit()) ? spiel : null,
      restWartezeit: restWartezeit(),
      restDiskussion: restDiskussion(),
      schrittFertig: spiel ? regeln.schrittFertig(spiel) : true,
      alleBereit: spiel ? regeln.alleBereit(spiel) : false,
      fehler: f,
      gemerkterCode: gemerkterCode(),
      gemerkterName: gemerkterName(),
    };
  }

  function merkeCode(code) { try { localStorage.setItem(SPEICHER_SCHLUESSEL, code); } catch (f) { /* Privatmodus */ } }
  function vergissCode() { try { localStorage.removeItem(SPEICHER_SCHLUESSEL); } catch (f) { /* Privatmodus */ } }
  function gemerkterCode() { try { return localStorage.getItem(SPEICHER_SCHLUESSEL); } catch (f) { return null; } }
  function merkeName(name) { if (!name) return; try { localStorage.setItem(NAME_SCHLUESSEL, name); } catch (f) { /* Privatmodus */ } }
  function gemerkterName() { try { return localStorage.getItem(NAME_SCHLUESSEL) || ''; } catch (f) { return ''; } }

  return {
    MAX_SPIELER: MAX_SPIELER,
    MIN_SPIELER: MIN_SPIELER,
    bereit: bereit,
    erstelleRaum: erstelleRaum,
    betreteRaum: betreteRaum,
    starteRaum: starteRaum,
    setzeZusammenstellung: setzeZusammenstellung,
    setzeEinstellungen: setzeEinstellungen,
    entferneSpieler: entferneSpieler,
    verschiebeSpieler: verschiebeSpieler,
    sendeAktion: sendeAktion,
    nachtBeginnen: nachtBeginnen,
    schrittErzwingen: schrittErzwingen,
    tagWeiter: tagWeiter,
    jaegerUeberspringen: jaegerUeberspringen,
    toeteManuell: toeteManuell,
    neueRunde: neueRunde,
    verlasse: verlasse,
    onZustandsAenderung: onZustandsAenderung,
    onAnsage: onAnsage,
    getZustand: getZustand,
    serverJetzt: serverJetzt,
  };
})();
