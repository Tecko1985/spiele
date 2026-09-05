/* ==========================================================================
   Werwolf — Spielregeln
   ==========================================================================

   REINE LOGIK, KEIN FIREBASE, KEINE OBERFLÄCHE, KEINE UHR.

   Alles hier arbeitet auf einem einzigen Objekt `spiel`, das NUR der
   Erzähler (das Host-Gerät) vollständig hält:

     spiel.spieler        Sitzreihenfolge, je Spieler Rolle, lebt, verliebt,
                          verzaubert, Todesursache
     spiel.phase          'rollen' | 'nacht' | 'tag' | 'ende'
     spiel.nacht          der laufende Nachtablauf (Schritt, Eingaben, Opfer)
     spiel.tag            der laufende Tag (Schritt, Tote, Stimmen)
     spiel.chronik        Spielverlauf im Klartext
     spiel.ende           Sieger, sobald es einen gibt

   Die Zeit kennt diese Datei nicht. Wie lange ein Nachtschritt mindestens
   dauert, entscheidet game-service.js — hier gibt es nur „ist der Schritt
   fertig?" und „weiter".

   Aus `spiel` leiten sich zwei Sichten ab:
     oeffentlicheSicht(spiel)      was ALLE sehen dürfen
     sichtFuer(spiel, uid)         was EIN Spieler sehen darf

   Damit ist das Prüfskript möglich: Partien ohne Netz und Browser, mit
   festem Zufall, tausendfach in Sekunden.
   ========================================================================== */

const regeln = (function () {
  'use strict';

  const R = (typeof rollen !== 'undefined') ? rollen : require('./rollen.js');

  const TEAM_NAME = {
    dorf: 'Das Dorf',
    wolf: 'Die Werwölfe',
    weiss: 'Der Weiße Werwolf',
    floete: 'Der Flötenspieler',
    verliebte: 'Die Verliebten',
    niemand: 'Niemand',
  };

  const URSACHE_TEXT = {
    woelfe: 'von den Werwölfen gerissen',
    gift: 'vergiftet',
    weisserWerwolf: 'vom Weißen Werwolf getötet',
    liebe: 'aus Liebeskummer gestorben',
    jaeger: 'vom Jäger erschossen',
    dorf: 'vom Dorf verurteilt',
    suendenbock: 'als Sündenbock geopfert',
    verlassen: 'hat das Spiel verlassen',
  };

  /* ----------------------------------------------------------------------
     Hilfen
     ---------------------------------------------------------------------- */

  function spielerVon(spiel, uid) {
    for (const s of spiel.spieler) if (s.uid === uid) return s;
    return null;
  }

  function nameVon(spiel, uid) {
    const s = spielerVon(spiel, uid);
    return s ? s.name : '?';
  }

  function lebende(spiel) { return spiel.spieler.filter(function (s) { return s.lebt; }); }

  function lebendeMitRolle(spiel, rolleId) {
    return lebende(spiel).filter(function (s) { return s.rolle === rolleId; });
  }

  function lebendeWoelfe(spiel) {
    return lebende(spiel).filter(function (s) { return R.istWolf(s.rolle); });
  }

  /** Hat diese Dorfrolle ihre Fähigkeit noch? (Der Alte kann sie allen nehmen.) */
  function faehig(spiel, rolleId) {
    if (!spiel.dorfOhneFaehigkeit) return true;
    return R.VERLIERT_FAEHIGKEIT.indexOf(rolleId) < 0;
  }

  function mische(liste, zufall) {
    const a = liste.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(zufall() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Ein Chronik-Eintrag ist ÖFFENTLICH, sofern nicht anders gesagt.
     ⚠️ Die öffentliche Sicht ist für alle lesbar (auch per REST ohne
     Anmeldung). Jeder Satz, der eine Nachtaktion oder eine Rolle nennt,
     bekommt deshalb `geheim` (erscheint erst am Ende) oder `offen` (eine
     Fassung ohne Rolle, solange „Rollen aufdecken" aus ist). Die
     Abnahme am 2026-09-02 fand „Amor verkuppelt X und Y" in der
     Übersicht jedes Spielers — mitten in Nacht 1. */
  const GEHEIM = { geheim: true };

  function notiere(spiel, text, extra) {
    const wo = spiel.phase === 'nacht' ? 'Nacht ' + spiel.nachtNr
      : spiel.phase === 'tag' ? 'Tag ' + spiel.nachtNr
      : spiel.phase === 'ende' ? 'Ende' : 'Start';
    spiel.chronik.push(Object.assign({ wo: wo, text: text }, extra || {}));
  }

  /** Die Chronik, wie ALLE sie sehen dürfen: Geheimes erst am Ende, Rollen nur wenn aufgedeckt. */
  function chronikOeffentlich(spiel) {
    const raus = [];
    for (const c of (spiel.chronik || [])) {
      if (spiel.ende) { raus.push({ wo: c.wo, text: c.text }); continue; }
      if (c.geheim) continue;
      if (c.offen && !spiel.regeln.rollenAufdecken) { raus.push({ wo: c.wo, text: c.offen }); continue; }
      raus.push({ wo: c.wo, text: c.text });
    }
    return raus;
  }

  function fehler(text) { return { ok: false, fehler: text }; }
  const OK = { ok: true };

  /* ----------------------------------------------------------------------
     Neues Spiel
     ---------------------------------------------------------------------- */

  function normiereEinstellungen(e) {
    const roh = e || {};
    let disk = Number(roh.diskussionSek);
    if (!(disk >= 0)) disk = 180;
    let warte = Number(roh.wartezeitSek);
    if (!(warte >= 3)) warte = 20;
    return {
      diskussionSek: Math.min(600, Math.round(disk)),
      wartezeitSek: Math.min(120, Math.round(warte)),
      rollenAufdecken: roh.rollenAufdecken !== false,
      gleichstand: roh.gleichstand === 'niemand' ? 'niemand' : 'stichwahl',
    };
  }

  /**
   * Legt ein Spiel an und teilt die Rollen aus.
   *
   * `spielerListe` ist die Sitzreihenfolge [{uid, name}]. Mit Dieb liegen
   * zwei Karten mehr im Stapel; die zwei, die übrig bleiben, sieht nur er.
   */
  function neuesSpiel(spielerListe, zusammenstellung, einstellungen, zufall) {
    zufall = zufall || Math.random;
    const pruefung = R.pruefe(spielerListe.length, zusammenstellung);
    if (!pruefung.ok) throw new Error(pruefung.fehler.join(' '));

    let karten = [];
    for (const id in zusammenstellung) {
      for (let i = 0; i < (zusammenstellung[id] | 0); i++) karten.push(id);
    }
    karten = mische(karten, zufall);

    const spiel = {
      regeln: normiereEinstellungen(einstellungen),
      zusammenstellung: JSON.parse(JSON.stringify(zusammenstellung)),
      spieler: [],
      uebrigeKarten: [],
      phase: 'rollen',
      bereit: {},
      nachtNr: 0,
      nacht: null,
      tag: null,
      hexe: { heil: true, gift: true },
      beschuetzer: { letztes: null },
      alte: { angriffe: 0 },
      dorfOhneFaehigkeit: false,
      verliebte: null,
      jaegerAusstehend: [],
      chronik: [],
      ende: null,
    };

    spielerListe.forEach(function (p, i) {
      spiel.spieler.push({
        uid: p.uid, name: p.name, rolle: karten[i],
        lebt: true, verliebt: false, verzaubert: false,
        todesursache: null, gestorben: null,
      });
    });
    spiel.uebrigeKarten = karten.slice(spielerListe.length);
    notiere(spiel, spielerListe.length + ' Spieler, Rollen verteilt.');
    return spiel;
  }

  /** Spieler hat seine Rolle gesehen. */
  function rolleGesehen(spiel, uid) {
    if (spiel.phase !== 'rollen') return fehler('Die Rollen sind schon verteilt.');
    if (!spielerVon(spiel, uid)) return fehler('Unbekannter Spieler.');
    spiel.bereit[uid] = true;
    return OK;
  }

  function alleBereit(spiel) {
    return spiel.spieler.every(function (s) { return spiel.bereit[s.uid]; });
  }

  /* ----------------------------------------------------------------------
     Die Nacht
     ---------------------------------------------------------------------- */

  /**
   * Alle Schritte, die in dieser Nacht gerufen werden, in Reihenfolge.
   *
   * ⚠️ Gerufen wird jede Rolle, die in der ZUSAMMENSTELLUNG liegt — ob sie
   * lebt oder nicht. Sonst hörte das Dorf am Morgen, welche Rolle in der
   * Nacht nicht mehr gerufen wurde, und wüsste, wer gestorben ist. Die
   * Zusammenstellung selbst ist öffentlich (sie steht im Warteraum).
   */
  function nachtSchritte(spiel) {
    const z = spiel.zusammenstellung;
    const erste = spiel.nachtNr === 1;
    const liste = [];
    for (const r of R.LISTE) {
      if (!z[r.id] || r.nachtPosition <= 0) continue;
      if (r.nurErsteNacht && !erste) continue;
      if (r.id === 'weisserWerwolf' && spiel.nachtNr % 2 !== 0) continue;
      liste.push({ id: r.id, position: r.nachtPosition });
    }
    if (z.amor && erste) liste.push({ id: 'verliebte', position: R.SCHRITTE_OHNE_KARTE.verliebte.nachtPosition });
    if (z.floetenspieler) liste.push({ id: 'verzauberte', position: R.SCHRITTE_OHNE_KARTE.verzauberte.nachtPosition });
    liste.sort(function (a, b) { return a.position - b.position; });
    return liste.map(function (x) { return x.id; });
  }

  /** Wer handelt in diesem Schritt wirklich? Leer = nur Attrappe. */
  function handelnde(spiel, schrittId) {
    switch (schrittId) {
      case 'dieb': return lebendeMitRolle(spiel, 'dieb');
      case 'amor': return lebendeMitRolle(spiel, 'amor');
      case 'verliebte':
        return spiel.verliebte ? lebende(spiel).filter(function (s) { return s.verliebt; }) : [];
      case 'beschuetzer': return faehig(spiel, 'beschuetzer') ? lebendeMitRolle(spiel, 'beschuetzer') : [];
      case 'werwolf': return lebendeWoelfe(spiel);
      case 'weisserWerwolf': return lebendeMitRolle(spiel, 'weisserWerwolf');
      case 'hexe': return faehig(spiel, 'hexe') ? lebendeMitRolle(spiel, 'hexe') : [];
      case 'seherin': return faehig(spiel, 'seherin') ? lebendeMitRolle(spiel, 'seherin') : [];
      case 'floetenspieler': return lebendeMitRolle(spiel, 'floetenspieler');
      case 'verzauberte': return lebende(spiel).filter(function (s) { return s.verzaubert; });
      default: return [];
    }
  }

  function schrittInfo(schrittId) {
    return R.rolle(schrittId) || R.SCHRITTE_OHNE_KARTE[schrittId] || null;
  }

  function starteNacht(spiel) {
    if (spiel.ende) return fehler('Das Spiel ist vorbei.');
    if (spiel.phase !== 'rollen' && spiel.phase !== 'tag') return fehler('Jetzt beginnt keine Nacht.');
    spiel.phase = 'nacht';
    spiel.nachtNr += 1;
    spiel.tag = null;
    spiel.nacht = {
      schritt: null, schrittNr: -1, eingaben: {},
      opfer: null, schutz: null, heil: false, gift: null, weissOpfer: null,
      seherinErgebnis: null, zusatzTote: [],
    };
    notiere(spiel, 'Die Nacht beginnt.');
    return weiter(spiel);
  }

  /** Der Schritt, der gerade läuft — mit allem, was der Erzähler wissen muss. */
  function aktuellerSchritt(spiel) {
    if (spiel.phase !== 'nacht' || !spiel.nacht || !spiel.nacht.schritt) return null;
    const id = spiel.nacht.schritt;
    const h = handelnde(spiel, id);
    const info = schrittInfo(id);
    return {
      id: id,
      name: info ? info.name : id,
      icon: info ? info.icon : '',
      wachAuf: info ? info.wachAuf : '',
      schlafEin: info ? info.schlafEin : '',
      aktiv: h.length > 0,
      handelnde: h.map(function (s) { return s.uid; }),
      fertig: schrittFertig(spiel),
    };
  }

  /** Sind alle Eingaben da, die der Schritt braucht? Attrappen sind sofort fertig. */
  /* Eingaben liegen JE SCHRITT — der Weiße Werwolf handelt in zwei
     Schritten derselben Nacht, und ein Dieb kann zur Seherin werden. */
  function eingabenVon(n, schrittId) {
    if (!n.eingaben[schrittId]) n.eingaben[schrittId] = {};
    return n.eingaben[schrittId];
  }

  function schrittFertig(spiel) {
    const n = spiel.nacht;
    if (!n || !n.schritt) return true;
    const h = handelnde(spiel, n.schritt);
    if (h.length === 0) return true;
    const ein = eingabenVon(n, n.schritt);
    switch (n.schritt) {
      case 'verliebte':
      case 'verzauberte':
        return true;
      case 'werwolf':
        return h.every(function (s) { return !!ein[s.uid]; });
      case 'seherin': {
        const e = ein[h[0].uid];
        return !!(e && e.ziel && e.bestaetigt);
      }
      default:
        return !!ein[h[0].uid];
    }
  }

  /** Nächster Schritt — oder die Auflösung, wenn keiner mehr kommt. */
  function weiter(spiel) {
    if (spiel.phase !== 'nacht' || !spiel.nacht) return fehler('Es ist nicht Nacht.');
    const n = spiel.nacht;
    if (n.schritt === 'werwolf') n.opfer = wolfsOpfer(spiel);
    const liste = nachtSchritte(spiel);
    let i = n.schrittNr + 1;
    if (i >= liste.length) {
      n.schritt = null;
      loeseNachtAuf(spiel);
      return OK;
    }
    n.schrittNr = i;
    n.schritt = liste[i];
    return OK;
  }

  /**
   * Beendet den laufenden Schritt ohne Eingabe (Handy weg, Spieler schläft).
   * Fehlende Eingaben zählen als „nichts". Wolfsstimmen, die schon da sind,
   * gelten.
   */
  function schrittErzwingen(spiel) {
    if (spiel.phase !== 'nacht' || !spiel.nacht || !spiel.nacht.schritt) return fehler('Kein Schritt offen.');
    const n = spiel.nacht;
    const ein = eingabenVon(n, n.schritt);
    for (const s of handelnde(spiel, n.schritt)) {
      if (!ein[s.uid]) ein[s.uid] = { erzwungen: true, ziel: null, bestaetigt: true };
      else if (n.schritt === 'seherin') ein[s.uid].bestaetigt = true;
    }
    return weiter(spiel);
  }

  function wolfsOpfer(spiel) {
    const n = spiel.nacht;
    const zaehler = {};
    let max = 0;
    const ein = eingabenVon(n, 'werwolf');
    for (const w of lebendeWoelfe(spiel)) {
      const e = ein[w.uid];
      if (!e || !e.ziel) continue;
      zaehler[e.ziel] = (zaehler[e.ziel] || 0) + 1;
      if (zaehler[e.ziel] > max) max = zaehler[e.ziel];
    }
    const spitze = Object.keys(zaehler).filter(function (uid) { return zaehler[uid] === max; });
    if (spitze.length !== 1) return null;
    return spitze[0];
  }

  /** Wen darf dieser Schritt anwählen? */
  function kandidaten(spiel, schrittId, uid) {
    const alle = lebende(spiel);
    switch (schrittId) {
      case 'werwolf':
        return alle.filter(function (s) { return !R.istWolf(s.rolle); });
      case 'weisserWerwolf':
        return alle.filter(function (s) { return s.rolle === 'werwolf'; });
      case 'beschuetzer':
        return alle.filter(function (s) { return s.uid !== spiel.beschuetzer.letztes; });
      case 'seherin':
        return alle.filter(function (s) { return s.uid !== uid; });
      case 'floetenspieler':
        return alle.filter(function (s) { return s.uid !== uid && !s.verzaubert; });
      case 'hexe':
      case 'amor':
        return alle;
      case 'jaeger':
        return alle.filter(function (s) { return s.uid !== uid; });
      default:
        return [];
    }
  }

  /**
   * Eine Nachtaktion eines Spielers. Wird vom Erzähler geprüft und
   * angewendet — auch ein manipulierter Client kommt nicht an der Prüfung
   * vorbei.
   */
  function nachtAktion(spiel, uid, aktion) {
    if (spiel.phase !== 'nacht' || !spiel.nacht || !spiel.nacht.schritt) return fehler('Es ist nicht Nacht.');
    const n = spiel.nacht;
    const s = spielerVon(spiel, uid);
    if (!s || !s.lebt) return fehler('Du bist nicht im Spiel.');
    const h = handelnde(spiel, n.schritt);
    if (!h.some(function (x) { return x.uid === uid; })) return fehler('Du bist gerade nicht dran.');
    const a = aktion || {};
    const erlaubt = kandidaten(spiel, n.schritt, uid).map(function (x) { return x.uid; });
    const ein = eingabenVon(n, n.schritt);

    switch (n.schritt) {
      case 'dieb': {
        if (ein[uid]) return fehler('Du hast schon gewählt.');
        const k = spiel.uebrigeKarten;
        const beideWoelfe = k.length === 2 && R.istWolf(k[0]) && R.istWolf(k[1]);
        if (a.karte === null || a.karte === undefined) {
          if (beideWoelfe) return fehler('Beide Karten sind Werwölfe — du musst eine nehmen.');
          ein[uid] = { karte: null };
          notiere(spiel, 'Der Dieb behält seine Karte.', GEHEIM);
          return OK;
        }
        const idx = a.karte | 0;
        if (idx < 0 || idx >= k.length) return fehler('Diese Karte gibt es nicht.');
        const neu = k[idx];
        k[idx] = s.rolle;
        s.rolle = neu;
        ein[uid] = { karte: idx };
        notiere(spiel, 'Der Dieb tauscht und ist jetzt ' + R.name(neu) + '.', GEHEIM);
        return OK;
      }
      case 'amor': {
        if (ein[uid]) return fehler('Du hast schon gewählt.');
        const z = Array.isArray(a.ziele) ? a.ziele : [];
        if (z.length !== 2 || z[0] === z[1]) return fehler('Wähle zwei verschiedene Spieler.');
        if (erlaubt.indexOf(z[0]) < 0 || erlaubt.indexOf(z[1]) < 0) return fehler('Ungültige Wahl.');
        spiel.verliebte = [z[0], z[1]];
        spielerVon(spiel, z[0]).verliebt = true;
        spielerVon(spiel, z[1]).verliebt = true;
        ein[uid] = { ziele: z.slice() };
        notiere(spiel, 'Amor verkuppelt ' + nameVon(spiel, z[0]) + ' und ' + nameVon(spiel, z[1]) + '.', GEHEIM);
        return OK;
      }
      case 'beschuetzer': {
        if (ein[uid]) return fehler('Du hast schon gewählt.');
        if (!a.ziel || erlaubt.indexOf(a.ziel) < 0) return fehler('Diesen Spieler darfst du nicht wählen.');
        n.schutz = a.ziel;
        spiel.beschuetzer.letztes = a.ziel;
        ein[uid] = { ziel: a.ziel };
        notiere(spiel, 'Der Beschützer wacht über ' + nameVon(spiel, a.ziel) + '.', GEHEIM);
        return OK;
      }
      case 'werwolf': {
        if (!a.ziel || erlaubt.indexOf(a.ziel) < 0) return fehler('Diesen Spieler darfst du nicht wählen.');
        ein[uid] = { ziel: a.ziel };
        return OK;
      }
      case 'weisserWerwolf': {
        if (ein[uid]) return fehler('Du hast schon gewählt.');
        if (a.ziel) {
          if (erlaubt.indexOf(a.ziel) < 0) return fehler('Du kannst nur einen Werwolf töten.');
          n.weissOpfer = a.ziel;
          notiere(spiel, 'Der Weiße Werwolf fällt über ' + nameVon(spiel, a.ziel) + ' her.', GEHEIM);
        }
        ein[uid] = { ziel: a.ziel || null };
        return OK;
      }
      case 'hexe': {
        if (ein[uid]) return fehler('Du hast schon entschieden.');
        const heilen = !!a.heilen;
        const gift = a.gift || null;
        if (heilen && !spiel.hexe.heil) return fehler('Der Heiltrank ist verbraucht.');
        if (heilen && !n.opfer) return fehler('Es gibt kein Opfer zu retten.');
        if (gift && !spiel.hexe.gift) return fehler('Der Gifttrank ist verbraucht.');
        if (gift && erlaubt.indexOf(gift) < 0) return fehler('Diesen Spieler kannst du nicht vergiften.');
        if (heilen) { spiel.hexe.heil = false; n.heil = true; notiere(spiel, 'Die Hexe rettet ' + nameVon(spiel, n.opfer) + '.', GEHEIM); }
        if (gift) { spiel.hexe.gift = false; n.gift = gift; notiere(spiel, 'Die Hexe vergiftet ' + nameVon(spiel, gift) + '.', GEHEIM); }
        ein[uid] = { heilen: heilen, gift: gift };
        return OK;
      }
      case 'seherin': {
        const e = ein[uid];
        if (a.bestaetigt) {
          if (!e || !e.ziel) return fehler('Erst einen Spieler ansehen.');
          e.bestaetigt = true;
          return OK;
        }
        if (e && e.ziel) return fehler('Du hast schon jemanden angesehen.');
        if (!a.ziel || erlaubt.indexOf(a.ziel) < 0) return fehler('Diesen Spieler darfst du nicht wählen.');
        const ziel = spielerVon(spiel, a.ziel);
        n.seherinErgebnis = { uid: ziel.uid, rolle: ziel.rolle };
        ein[uid] = { ziel: a.ziel, bestaetigt: false };
        notiere(spiel, 'Die Seherin sieht sich ' + ziel.name + ' an.', GEHEIM);
        return OK;
      }
      case 'floetenspieler': {
        if (ein[uid]) return fehler('Du hast schon gewählt.');
        const z = Array.isArray(a.ziele) ? a.ziele : [];
        const soll = Math.min(2, erlaubt.length);
        if (z.length !== soll) return fehler('Wähle ' + soll + ' Spieler.');
        if (z.length === 2 && z[0] === z[1]) return fehler('Zwei verschiedene Spieler.');
        for (const x of z) if (erlaubt.indexOf(x) < 0) return fehler('Ungültige Wahl.');
        for (const x of z) spielerVon(spiel, x).verzaubert = true;
        ein[uid] = { ziele: z.slice() };
        notiere(spiel, 'Der Flötenspieler verzaubert ' + z.map(function (x) { return nameVon(spiel, x); }).join(' und ') + '.', GEHEIM);
        return OK;
      }
      default:
        return fehler('In diesem Schritt gibt es nichts zu tun.');
    }
  }

  /**
   * Auflösung nach dem letzten Schritt:
   * Schutz > Heiltrank > Wolfsangriff > Gift > Verliebten-Kettentod > Jägerschuss.
   * (Der Jäger schießt am Morgen — sein Ziel ist eine Entscheidung.)
   */
  function loeseNachtAuf(spiel) {
    const n = spiel.nacht;
    const tote = [];

    if (n.opfer) {
      const o = spielerVon(spiel, n.opfer);
      if (n.schutz === n.opfer) {
        notiere(spiel, 'Die Wölfe greifen ' + o.name + ' an, doch der Beschützer hält stand.', GEHEIM);
      } else if (n.heil) {
        /* ⚠️ Der Heiltrank steht VOR dem Freischuss des Alten — so wie es
           die Reihenfolge oben sagt. Andersherum verbrannte eine einzige
           Wolfsnacht BEIDE Einmal-Rettungen des Dorfes: der Trank war in
           `nachtAktion` schon verbraucht, der Alte überlebte über den
           anderen Zweig, und `alte.angriffe` stand danach ebenfalls auf 1.
           In der nächsten Nacht reichte derselbe Angriff. Die Hexe kann dem
           nicht ausweichen — sie sieht nur den Namen des Opfers, nicht
           seine Rolle. */
        notiere(spiel, 'Die Wölfe greifen ' + o.name + ' an, die Hexe heilt.', GEHEIM);
      } else if (o.rolle === 'alte' && spiel.alte.angriffe === 0) {
        spiel.alte.angriffe = 1;
        notiere(spiel, 'Die Wölfe greifen ' + o.name + ' an — der Alte überlebt den ersten Angriff.', GEHEIM);
      } else {
        tote.push({ uid: n.opfer, ursache: 'woelfe' });
      }
    } else {
      notiere(spiel, 'Die Wölfe reißen niemanden.', GEHEIM);
    }
    if (n.gift) tote.push({ uid: n.gift, ursache: 'gift' });
    if (n.weissOpfer) tote.push({ uid: n.weissOpfer, ursache: 'weisserWerwolf' });

    const gestorben = verarbeiteTode(spiel, tote).concat(n.zusatzTote);

    spiel.phase = 'tag';
    spiel.nacht = null;
    spiel.tag = { schritt: 'morgen', tote: gestorben, meldung: null, stimmen: {}, kandidaten: null, jaegerUid: null, abgestimmt: false, diskussionStart: null };
    if (gestorben.length === 0) notiere(spiel, 'Der Morgen bricht an — niemand ist gestorben.');
  }

  /* ----------------------------------------------------------------------
     Tode — mit Kette
     ---------------------------------------------------------------------- */

  /**
   * Wendet eine Liste von Toden an und zieht die Kette nach:
   *   Verliebte sterben mit, ein Jäger bekommt seinen Schuss vorgemerkt,
   *   der Alte nimmt dem Dorf die Fähigkeiten, wenn das Dorf ihn tötet.
   * Gibt alle zurück, die WIRKLICH gestorben sind (schon Tote fallen raus).
   */
  function verarbeiteTode(spiel, liste) {
    const schlange = liste.slice();
    const gestorben = [];
    while (schlange.length) {
      const t = schlange.shift();
      const s = spielerVon(spiel, t.uid);
      if (!s || !s.lebt) continue;
      s.lebt = false;
      s.todesursache = t.ursache;
      s.gestorben = (spiel.phase === 'nacht' ? 'Nacht ' : 'Tag ') + spiel.nachtNr;
      gestorben.push({ uid: s.uid, name: s.name, rolle: s.rolle, ursache: t.ursache });
      notiere(spiel, s.name + ' (' + R.name(s.rolle) + ') ' + (URSACHE_TEXT[t.ursache] || 'stirbt') + '.', { offen: s.name + ' ' + (URSACHE_TEXT[t.ursache] || 'stirbt') + '.' });

      if (spiel.verliebte && s.verliebt) {
        const partnerUid = spiel.verliebte[0] === s.uid ? spiel.verliebte[1] : spiel.verliebte[0];
        const partner = spielerVon(spiel, partnerUid);
        if (partner && partner.lebt) schlange.push({ uid: partnerUid, ursache: 'liebe' });
      }
      if (s.rolle === 'jaeger' && t.ursache !== 'verlassen' && faehig(spiel, 'jaeger')) {
        spiel.jaegerAusstehend.push(s.uid);
      }
      if (s.rolle === 'alte' && (t.ursache === 'dorf' || t.ursache === 'gift' || t.ursache === 'jaeger' || t.ursache === 'suendenbock')) {
        spiel.dorfOhneFaehigkeit = true;
        notiere(spiel, 'Das Dorf hat den Alten getötet — alle Dorfrollen verlieren ihre Fähigkeiten.');
      }
    }
    return gestorben;
  }

  /** Erzähler wirft einen Spieler raus (Handy leer, gegangen). */
  function toeteManuell(spiel, uid) {
    if (spiel.ende) return fehler('Das Spiel ist vorbei.');
    const s = spielerVon(spiel, uid);
    if (!s || !s.lebt) return fehler('Dieser Spieler lebt nicht mehr.');
    if (spiel.phase === 'rollen') {
      s.lebt = false; s.todesursache = 'verlassen'; s.gestorben = 'Start';
      spiel.bereit[uid] = true;
      notiere(spiel, s.name + ' hat das Spiel verlassen.');
      return OK;
    }
    if (spiel.phase === 'nacht') {
      /* Nachts wird nichts verkündet — der Tod (samt Kette) kommt mit der
         Auflösung ans Licht. */
      const g = verarbeiteTode(spiel, [{ uid: uid, ursache: 'verlassen' }]);
      spiel.nacht.zusatzTote = spiel.nacht.zusatzTote.concat(g);
      return OK;
    }
    const gestorben = verarbeiteTode(spiel, [{ uid: uid, ursache: 'verlassen' }]);
    if (spiel.tag) {
      spiel.tag.tote = (spiel.tag.tote || []).concat(gestorben);
      if (spiel.tag.stimmen) {
        delete spiel.tag.stimmen[uid];
        for (const w in spiel.tag.stimmen) if (spiel.tag.stimmen[w] === uid) spiel.tag.stimmen[w] = null;
      }
      if (spiel.tag.kandidaten) spiel.tag.kandidaten = spiel.tag.kandidaten.filter(function (k) { return k !== uid; });
      if (spiel.tag.jaegerUid === uid) spiel.tag.jaegerUid = null;
    }
    spiel.jaegerAusstehend = spiel.jaegerAusstehend.filter(function (j) { return j !== uid; });
    if (spiel.tag && spiel.tag.schritt === 'jaeger' && !spiel.tag.jaegerUid) {
      /* Der Jäger selbst ist gegangen — sein Schuss verfällt, der Tag geht weiter. */
      spiel.tag.schritt = 'ergebnis';
      spiel.tag.meldung = s.name + ' hat das Spiel verlassen.';
    }
    pruefeSieg(spiel);
    return OK;
  }

  /* ----------------------------------------------------------------------
     Der Tag
     ---------------------------------------------------------------------- */

  /** Der Erzähler drückt „Weiter". Was danach kommt, hängt vom Schritt ab. */
  function tagWeiter(spiel) {
    if (spiel.phase !== 'tag' || !spiel.tag) return fehler('Es ist nicht Tag.');
    const t = spiel.tag;
    switch (t.schritt) {
      case 'morgen':
      case 'ergebnis':
        return nachMeldung(spiel);
      case 'diskussion':
        t.schritt = 'abstimmung';
        t.stimmen = {};
        notiere(spiel, 'Das Dorf stimmt ab.');
        return OK;
      case 'abstimmung':
      case 'stichwahl':
        return abstimmungSchliessen(spiel);
      case 'jaeger':
        return fehler('Der Jäger muss erst schießen.');
      default:
        return fehler('Unbekannter Schritt.');
    }
  }

  /** Nach einer Verkündung: Jäger? Sieg? Dann Diskussion oder Nacht. */
  function nachMeldung(spiel) {
    const t = spiel.tag;
    if (spiel.jaegerAusstehend.length) {
      t.jaegerUid = spiel.jaegerAusstehend[0];
      t.schritt = 'jaeger';
      t.meldung = nameVon(spiel, t.jaegerUid) + ' war der Jäger und gibt einen letzten Schuss ab.';
      return OK;
    }
    if (pruefeSieg(spiel)) return OK;
    if (t.abgestimmt) return starteNacht(spiel);
    if (spiel.regeln.diskussionSek > 0) {
      t.schritt = 'diskussion';
      t.meldung = null;
    } else {
      t.schritt = 'abstimmung';
      t.stimmen = {};
      notiere(spiel, 'Das Dorf stimmt ab.');
    }
    return OK;
  }

  function jaegerSchuss(spiel, uid, ziel) {
    if (spiel.phase !== 'tag' || !spiel.tag || spiel.tag.schritt !== 'jaeger') return fehler('Der Jäger ist nicht dran.');
    if (spiel.tag.jaegerUid !== uid) return fehler('Du bist nicht der Jäger.');
    const erlaubt = kandidaten(spiel, 'jaeger', uid).map(function (x) { return x.uid; });
    if (!ziel || erlaubt.indexOf(ziel) < 0) return fehler('Diesen Spieler kannst du nicht treffen.');
    spiel.jaegerAusstehend.shift();
    const gestorben = verarbeiteTode(spiel, [{ uid: ziel, ursache: 'jaeger' }]);
    spiel.tag.schritt = 'ergebnis';
    spiel.tag.tote = gestorben;
    spiel.tag.meldung = nameVon(spiel, uid) + ' schießt auf ' + nameVon(spiel, ziel) + '.';
    spiel.tag.jaegerUid = null;
    return OK;
  }

  /** Der Erzähler überspringt den Jäger (Spieler nicht mehr da). */
  function jaegerUeberspringen(spiel) {
    if (spiel.phase !== 'tag' || !spiel.tag || spiel.tag.schritt !== 'jaeger') return fehler('Der Jäger ist nicht dran.');
    const uid = spiel.tag.jaegerUid;
    spiel.jaegerAusstehend = spiel.jaegerAusstehend.filter(function (j) { return j !== uid; });
    notiere(spiel, nameVon(spiel, uid) + ' gibt keinen Schuss ab.');
    spiel.tag.schritt = 'ergebnis';
    spiel.tag.tote = [];
    spiel.tag.meldung = nameVon(spiel, uid) + ' gibt keinen Schuss ab.';
    spiel.tag.jaegerUid = null;
    return OK;
  }

  function diskussionGestartet(spiel, zeit) {
    if (spiel.phase === 'tag' && spiel.tag && spiel.tag.schritt === 'diskussion') spiel.tag.diskussionStart = zeit;
  }

  /** Stimme abgeben oder ändern. `ziel` null = Enthaltung. */
  function stimme(spiel, uid, ziel) {
    if (spiel.phase !== 'tag' || !spiel.tag) return fehler('Es ist nicht Tag.');
    const t = spiel.tag;
    if (t.schritt !== 'abstimmung' && t.schritt !== 'stichwahl') return fehler('Gerade wird nicht abgestimmt.');
    const s = spielerVon(spiel, uid);
    if (!s || !s.lebt) return fehler('Nur Lebende stimmen ab.');
    if (ziel) {
      const z = spielerVon(spiel, ziel);
      if (!z || !z.lebt) return fehler('Diesen Spieler kannst du nicht wählen.');
      if (t.kandidaten && t.kandidaten.indexOf(ziel) < 0) return fehler('In der Stichwahl stehen nur die Kandidaten zur Wahl.');
    }
    t.stimmen[uid] = ziel || null;
    return OK;
  }

  function abstimmungSchliessen(spiel) {
    if (spiel.phase !== 'tag' || !spiel.tag) return fehler('Es ist nicht Tag.');
    const t = spiel.tag;
    if (t.schritt !== 'abstimmung' && t.schritt !== 'stichwahl') return fehler('Gerade wird nicht abgestimmt.');

    const zaehler = {};
    let max = 0;
    for (const w in t.stimmen) {
      const z = t.stimmen[w];
      if (!z) continue;
      const wähler = spielerVon(spiel, w);
      if (!wähler || !wähler.lebt) continue;
      zaehler[z] = (zaehler[z] || 0) + 1;
      if (zaehler[z] > max) max = zaehler[z];
    }
    const spitze = Object.keys(zaehler).filter(function (uid) { return zaehler[uid] === max; });
    t.abgestimmt = true;
    t.letzteStimmen = JSON.parse(JSON.stringify(t.stimmen));

    if (max === 0) {
      t.schritt = 'ergebnis';
      t.tote = [];
      t.meldung = 'Niemand hat abgestimmt — niemand stirbt.';
      notiere(spiel, t.meldung);
      return OK;
    }

    if (spitze.length === 1) {
      const gestorben = verarbeiteTode(spiel, [{ uid: spitze[0], ursache: 'dorf' }]);
      t.schritt = 'ergebnis';
      t.tote = gestorben;
      t.meldung = 'Das Dorf hat entschieden: ' + nameVon(spiel, spitze[0]) + '.';
      t.kandidaten = null;
      return OK;
    }

    /* Gleichstand. */
    const bock = lebendeMitRolle(spiel, 'suendenbock')[0];
    if (bock) {
      const gestorben = verarbeiteTode(spiel, [{ uid: bock.uid, ursache: 'suendenbock' }]);
      t.schritt = 'ergebnis';
      t.tote = gestorben;
      t.meldung = 'Gleichstand — der Sündenbock ' + bock.name + ' stirbt an Stelle der Kandidaten.';
      t.kandidaten = null;
      return OK;
    }
    if (t.schritt === 'abstimmung' && spiel.regeln.gleichstand === 'stichwahl') {
      t.schritt = 'stichwahl';
      t.kandidaten = spitze;
      t.stimmen = {};
      t.abgestimmt = false;
      t.meldung = 'Gleichstand zwischen ' + spitze.map(function (u) { return nameVon(spiel, u); }).join(' und ') + ' — Stichwahl.';
      notiere(spiel, t.meldung);
      return OK;
    }
    t.schritt = 'ergebnis';
    t.tote = [];
    t.meldung = 'Gleichstand — niemand stirbt.';
    t.kandidaten = null;
    notiere(spiel, t.meldung);
    return OK;
  }

  /* ----------------------------------------------------------------------
     Sieg
     ---------------------------------------------------------------------- */

  function verliebteGetrennt(spiel) {
    if (!spiel.verliebte) return false;
    const a = spielerVon(spiel, spiel.verliebte[0]);
    const b = spielerVon(spiel, spiel.verliebte[1]);
    if (!a || !b) return false;
    const ta = R.rolle(a.rolle).team, tb = R.rolle(b.rolle).team;
    return ta !== tb;
  }

  /**
   * Prüft die Siegbedingungen in fester Reihenfolge:
   *   Verliebte aus zwei Lagern allein > Weißer Werwolf allein >
   *   Flötenspieler (alle verzaubert) > Dorf (alle Wölfe tot) >
   *   Wölfe (mindestens so viele wie die anderen).
   * Solange ein Jäger noch schießen muss, wird NICHT entschieden.
   */
  function pruefeSieg(spiel) {
    if (spiel.ende) return spiel.ende;
    if (spiel.jaegerAusstehend.length) return null;
    const l = lebende(spiel);
    const woelfe = l.filter(function (s) { return R.istWolf(s.rolle); });
    let sieger = null;

    if (l.length === 0) sieger = 'niemand';
    else if (spiel.verliebte && verliebteGetrennt(spiel) && l.length === 2 && l.every(function (s) { return s.verliebt; })) sieger = 'verliebte';
    else if (l.length === 1 && l[0].rolle === 'weisserWerwolf') sieger = 'weiss';
    else if (l.some(function (s) { return s.rolle === 'floetenspieler'; }) && l.length > 1 &&
      l.every(function (s) { return s.rolle === 'floetenspieler' || s.verzaubert; })) sieger = 'floete';
    else if (woelfe.length === 0) sieger = 'dorf';
    else if (woelfe.length >= l.length - woelfe.length) sieger = 'wolf';

    if (!sieger) return null;

    const gewinner = spiel.spieler.filter(function (s) {
      const team = R.rolle(s.rolle).team;
      if (sieger === 'verliebte') return s.verliebt;
      if (sieger === 'dorf') return team === 'dorf' && !(spiel.verliebte && verliebteGetrennt(spiel) && s.verliebt);
      if (sieger === 'wolf') return team === 'wolf' && !(spiel.verliebte && verliebteGetrennt(spiel) && s.verliebt);
      if (sieger === 'weiss') return s.rolle === 'weisserWerwolf';
      if (sieger === 'floete') return s.rolle === 'floetenspieler';
      return false;
    }).map(function (s) { return s.uid; });

    const TEXT = {
      niemand: 'Alle sind tot. Das Dorf liegt still.',
      verliebte: 'Nur die Verliebten sind übrig — die Liebe gewinnt.',
      weiss: 'Der Weiße Werwolf steht allein auf der Lichtung.',
      floete: 'Alle tanzen nach seiner Flöte — der Flötenspieler gewinnt.',
      dorf: 'Alle Werwölfe sind tot — das Dorf hat gewonnen.',
      wolf: 'Die Werwölfe haben das Dorf überrannt.',
    };
    spiel.ende = { sieger: sieger, siegerName: TEAM_NAME[sieger], text: TEXT[sieger], gewinner: gewinner };
    spiel.phase = 'ende';
    notiere(spiel, TEXT[sieger]);
    return spiel.ende;
  }

  /* ----------------------------------------------------------------------
     Sichten
     ---------------------------------------------------------------------- */

  function rolleOeffentlich(spiel, s) {
    if (spiel.ende) return true;
    if (!s.lebt && spiel.regeln.rollenAufdecken) return true;
    return false;
  }

  function toteFuerAnzeige(spiel, tote) {
    return (tote || []).map(function (t) {
      const zeigen = spiel.ende || spiel.regeln.rollenAufdecken;
      return { uid: t.uid, name: t.name, rolle: zeigen ? t.rolle : null, rolleName: zeigen ? R.name(t.rolle) : null, ursache: t.ursache, ursacheText: URSACHE_TEXT[t.ursache] || '' };
    });
  }

  /** Was ALLE sehen dürfen. */
  function oeffentlicheSicht(spiel) {
    const schritt = aktuellerSchritt(spiel);
    const t = spiel.tag;
    const sicht = {
      phase: spiel.phase,
      nachtNr: spiel.nachtNr,
      regeln: spiel.regeln,
      zusammenstellung: spiel.zusammenstellung,
      dorfOhneFaehigkeit: spiel.dorfOhneFaehigkeit,
      bereit: spiel.phase === 'rollen' ? Object.keys(spiel.bereit).length : null,
      spieler: spiel.spieler.map(function (s) {
        const zeigen = rolleOeffentlich(spiel, s);
        return {
          uid: s.uid, name: s.name, lebt: s.lebt,
          rolle: zeigen ? s.rolle : null, rolleName: zeigen ? R.name(s.rolle) : null,
          ursache: s.lebt ? null : s.todesursache, gestorben: s.gestorben,
          verliebt: spiel.ende ? s.verliebt : false,
        };
      }),
      schritt: schritt ? { id: schritt.id, name: schritt.name, icon: schritt.icon, wachAuf: schritt.wachAuf, schlafEin: schritt.schlafEin } : null,
      tag: t ? {
        schritt: t.schritt,
        tote: toteFuerAnzeige(spiel, t.tote),
        meldung: t.meldung,
        stimmen: t.stimmen || {},
        kandidaten: t.kandidaten,
        jaegerUid: t.jaegerUid,
        jaegerName: t.jaegerUid ? nameVon(spiel, t.jaegerUid) : null,
        abgestimmt: t.abgestimmt,
        diskussionStart: t.diskussionStart,
      } : null,
      chronik: chronikOeffentlich(spiel),
      ende: spiel.ende ? {
        sieger: spiel.ende.sieger, siegerName: spiel.ende.siegerName, text: spiel.ende.text,
        gewinner: spiel.ende.gewinner,
      } : null,
    };
    return sicht;
  }

  /** Was EIN Spieler sehen darf — seine Rolle, seine Mitwisser, seine Aufgabe. */
  function sichtFuer(spiel, uid) {
    const s = spielerVon(spiel, uid);
    if (!s) return null;
    const r = R.rolle(s.rolle);
    const sicht = {
      uid: uid,
      rolle: s.rolle, rolleName: r.name, icon: r.icon, beschreibung: r.beschreibung, team: r.team,
      lebt: s.lebt,
      verliebtMit: null,
      verzaubert: s.verzaubert,
      mitwoelfe: [],
      hexe: s.rolle === 'hexe' ? { heil: spiel.hexe.heil, gift: spiel.hexe.gift } : null,
      faehig: faehig(spiel, s.rolle),
      dran: false,
      aufgabe: null,
      hinweis: null,
      stimmeAbgeben: false,
      meineStimme: null,
    };
    if (spiel.verliebte && s.verliebt) {
      const p = spiel.verliebte[0] === uid ? spiel.verliebte[1] : spiel.verliebte[0];
      sicht.verliebtMit = { uid: p, name: nameVon(spiel, p) };
    }
    if (R.istWolf(s.rolle)) {
      sicht.mitwoelfe = spiel.spieler.filter(function (x) { return R.istWolf(x.rolle) && x.uid !== uid; })
        .map(function (x) { return { uid: x.uid, name: x.name, lebt: x.lebt }; });
    }
    if (!s.lebt) return sicht;

    if (spiel.phase === 'nacht' && spiel.nacht && spiel.nacht.schritt) {
      const n = spiel.nacht;
      const h = handelnde(spiel, n.schritt);
      const dran = h.some(function (x) { return x.uid === uid; });
      if (n.schritt === 'werwolf' && s.rolle === 'maedchen' && faehig(spiel, 'maedchen')) {
        sicht.hinweis = 'Die Wölfe sind wach. Du darfst jetzt blinzeln — aber lass dich nicht erwischen.';
      }
      if (dran) {
        sicht.dran = true;
        const ein = eingabenVon(n, n.schritt);
        const e = ein[uid] || null;
        const k = kandidaten(spiel, n.schritt, uid).map(function (x) { return { uid: x.uid, name: x.name }; });
        const aufgabe = { schritt: n.schritt, kandidaten: k, eingabe: e, fertig: false };
        switch (n.schritt) {
          case 'dieb':
            aufgabe.karten = spiel.uebrigeKarten.map(function (id) { return { id: id, name: R.name(id), icon: R.rolle(id).icon }; });
            aufgabe.mussTauschen = spiel.uebrigeKarten.length === 2 && R.istWolf(spiel.uebrigeKarten[0]) && R.istWolf(spiel.uebrigeKarten[1]);
            aufgabe.fertig = !!e;
            break;
          case 'amor':
            aufgabe.anzahl = 2; aufgabe.fertig = !!e; break;
          case 'verliebte':
            aufgabe.fertig = true; break;
          case 'beschuetzer':
            aufgabe.fertig = !!e; break;
          case 'werwolf': {
            aufgabe.stimmen = {};
            for (const w of h) {
              const ew = ein[w.uid];
              aufgabe.stimmen[w.uid] = { name: w.name, ziel: ew && ew.ziel ? ew.ziel : null, zielName: ew && ew.ziel ? nameVon(spiel, ew.ziel) : null };
            }
            aufgabe.fertig = !!e;
            break;
          }
          case 'weisserWerwolf':
            aufgabe.fertig = !!e; break;
          case 'hexe':
            aufgabe.opfer = n.opfer ? { uid: n.opfer, name: nameVon(spiel, n.opfer) } : null;
            aufgabe.heil = spiel.hexe.heil; aufgabe.gift = spiel.hexe.gift;
            aufgabe.fertig = !!e;
            break;
          case 'seherin':
            if (e && e.ziel && n.seherinErgebnis) {
              aufgabe.ergebnis = { uid: n.seherinErgebnis.uid, name: nameVon(spiel, n.seherinErgebnis.uid), rolle: n.seherinErgebnis.rolle, rolleName: R.name(n.seherinErgebnis.rolle), icon: R.rolle(n.seherinErgebnis.rolle).icon };
            }
            aufgabe.fertig = !!(e && e.bestaetigt);
            break;
          case 'floetenspieler':
            aufgabe.anzahl = Math.min(2, k.length); aufgabe.fertig = !!e; break;
          case 'verzauberte':
            aufgabe.mitverzauberte = h.filter(function (x) { return x.uid !== uid; }).map(function (x) { return { uid: x.uid, name: x.name }; });
            aufgabe.fertig = true;
            break;
        }
        sicht.aufgabe = aufgabe;
      }
    }

    if (spiel.phase === 'tag' && spiel.tag) {
      const t = spiel.tag;
      if (t.schritt === 'jaeger' && t.jaegerUid === uid) {
        /* Der Jäger ist tot, aber er schießt — deshalb steht das VOR der Lebend-Prüfung unten. */
      }
      if ((t.schritt === 'abstimmung' || t.schritt === 'stichwahl') && s.lebt) {
        sicht.stimmeAbgeben = true;
        sicht.meineStimme = t.stimmen[uid] || null;
      }
    }
    return sicht;
  }

  /** Der Jäger ist tot und darf trotzdem handeln — eigene Sicht. */
  function jaegerSicht(spiel, uid) {
    if (spiel.phase !== 'tag' || !spiel.tag || spiel.tag.schritt !== 'jaeger' || spiel.tag.jaegerUid !== uid) return null;
    return {
      kandidaten: kandidaten(spiel, 'jaeger', uid).map(function (x) { return { uid: x.uid, name: x.name }; }),
    };
  }

  return {
    TEAM_NAME: TEAM_NAME,
    URSACHE_TEXT: URSACHE_TEXT,
    normiereEinstellungen: normiereEinstellungen,
    neuesSpiel: neuesSpiel,
    rolleGesehen: rolleGesehen,
    alleBereit: alleBereit,
    starteNacht: starteNacht,
    nachtSchritte: nachtSchritte,
    handelnde: handelnde,
    aktuellerSchritt: aktuellerSchritt,
    schrittFertig: schrittFertig,
    weiter: weiter,
    schrittErzwingen: schrittErzwingen,
    kandidaten: kandidaten,
    nachtAktion: nachtAktion,
    verarbeiteTode: verarbeiteTode,
    toeteManuell: toeteManuell,
    tagWeiter: tagWeiter,
    jaegerSchuss: jaegerSchuss,
    jaegerUeberspringen: jaegerUeberspringen,
    diskussionGestartet: diskussionGestartet,
    stimme: stimme,
    abstimmungSchliessen: abstimmungSchliessen,
    pruefeSieg: pruefeSieg,
    oeffentlicheSicht: oeffentlicheSicht,
    sichtFuer: sichtFuer,
    jaegerSicht: jaegerSicht,
    lebende: lebende,
    spielerVon: spielerVon,
    faehig: faehig,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = regeln;
