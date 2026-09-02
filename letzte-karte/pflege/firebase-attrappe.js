/* ==========================================================================
   Letzte Karte — Firebase-Attrappe für den Test
   ==========================================================================

   Bildet genau den Ausschnitt der Firebase-API nach, den `game-service.js`
   benutzt — im Arbeitsspeicher, ohne Netz.

   WOZU.
   Im Vorschaufenster ist der Zugriff auf googleapis gesperrt, die Anmeldung
   scheitert und die App kommt nie über den Startbildschirm hinaus. Damit
   wäre die gesamte Oberfläche ungeprüft: Kartenfächer, Farbwahl, Abrechnung,
   Rechteck-Treffer — nichts davon ließe sich zeigen.

   ⚠️ WAS DIESE ATTRAPPE NICHT PRÜFT:
   die Sicherheitsregeln. Sie kennt keine `.read`/`.write`-Bedingungen und
   lässt jeden alles. Ob `haende/<code>/<uid>` wirklich nur der Besitzer
   lesen darf, ist damit NICHT belegt — das geht ausschließlich gegen echtes
   Firebase mit eingespielten Rules. Sie prüft die Oberfläche und den
   Spielablauf, nicht die Absicherung.

   Sie wird NIE von `index.html` geladen, nur von `pflege/test-harness.html`.
   ========================================================================== */

(function () {
  'use strict';

  const TIMESTAMP = { '.sv': 'timestamp' };
  let baum = {};
  let horcher = [];   // {pfad, art, rueckruf}
  let pushZaehler = 0;

  function teile(pfad) {
    return String(pfad || '').split('/').filter(function (x) { return x.length > 0; });
  }

  function lies(pfad) {
    let k = baum;
    for (const t of teile(pfad)) {
      if (k === null || typeof k !== 'object') return null;
      if (!(t in k)) return null;
      k = k[t];
    }
    return k === undefined ? null : k;
  }

  /* Firebase löscht Knoten, die auf null gesetzt werden — genau daran hängt
     das Aufräumen im Spiel, deshalb macht die Attrappe es auch so. */
  function schreib(pfad, wert) {
    const t = teile(pfad);
    if (t.length === 0) { baum = wert || {}; return; }
    let k = baum;
    for (let i = 0; i < t.length - 1; i++) {
      if (typeof k[t[i]] !== 'object' || k[t[i]] === null) k[t[i]] = {};
      k = k[t[i]];
    }
    const letzt = t[t.length - 1];
    if (wert === null || wert === undefined) delete k[letzt];
    else k[letzt] = aufloesen(wert);
  }

  /* Server-Zeitstempel auflösen. Firebase ersetzt das Markierungsobjekt
     beim Schreiben durch die echte Serverzeit. */
  function aufloesen(wert) {
    if (wert === null || typeof wert !== 'object') return wert;
    if (wert['.sv'] === 'timestamp') return Date.now();
    if (Array.isArray(wert)) return wert.map(aufloesen);
    const raus = {};
    for (const k in wert) raus[k] = aufloesen(wert[k]);
    return raus;
  }

  function schnappschuss(pfad, wert) {
    const t = teile(pfad);
    return {
      key: t.length ? t[t.length - 1] : null,
      ref: new Ref(pfad),
      val: function () { return wert === undefined ? null : wert; },
      exists: function () { return wert !== null && wert !== undefined; },
      forEach: function (rueckruf) {
        if (!wert || typeof wert !== 'object') return;
        for (const k in wert) rueckruf(schnappschuss(pfad + '/' + k, wert[k]));
      },
      child: function (unter) {
        let w = wert;
        for (const t2 of teile(unter)) w = (w && typeof w === 'object') ? w[t2] : undefined;
        return schnappschuss(pfad + '/' + unter, w);
      },
    };
  }

  /* Nach jeder Änderung alle betroffenen Horcher benachrichtigen: die auf
     genau diesem Pfad und die auf allen Elternpfaden. */
  function meldeAenderung(pfade) {
    const betroffen = Array.isArray(pfade) ? pfade : [pfade];
    for (const h of horcher.slice()) {
      let trifft = false;
      for (const p of betroffen) {
        if (p === h.pfad || p.indexOf(h.pfad + '/') === 0 || h.pfad.indexOf(p + '/') === 0) trifft = true;
      }
      if (!trifft) continue;
      const wert = lies(h.pfad);
      if (h.art === 'value') {
        h.rueckruf(schnappschuss(h.pfad, wert));
      } else if (h.art === 'child_added' || h.art === 'child_changed') {
        if (wert && typeof wert === 'object') {
          for (const k in wert) h.rueckruf(schnappschuss(h.pfad + '/' + k, wert[k]));
        }
      }
    }
  }

  function Ref(pfad) { this.pfad = pfad || ''; }

  Ref.prototype.child = function (unter) { return new Ref(this.pfad + '/' + unter); };

  Ref.prototype.set = function (wert) {
    schreib(this.pfad, wert);
    meldeAenderung(this.pfad);
    return Promise.resolve();
  };

  Ref.prototype.remove = function () {
    schreib(this.pfad, null);
    meldeAenderung(this.pfad);
    return Promise.resolve();
  };

  /* `update` auf der Wurzel ist das Mehrpfad-Update, mit dem der Gastgeber
     Tisch, Hände und den geheimen Rest in EINEM Rutsch schreibt. */
  Ref.prototype.update = function (teilObjekt) {
    const pfade = [];
    for (const k in teilObjekt) {
      const voll = this.pfad ? this.pfad + '/' + k : k;
      schreib(voll, teilObjekt[k]);
      pfade.push(voll);
    }
    meldeAenderung(pfade);
    return Promise.resolve();
  };

  Ref.prototype.push = function (wert) {
    pushZaehler++;
    const schluessel = '-Attrappe' + String(pushZaehler).padStart(6, '0');
    const voll = this.pfad + '/' + schluessel;
    if (wert !== undefined) {
      schreib(voll, wert);
      meldeAenderung(voll);
    }
    return Promise.resolve(new Ref(voll));
  };

  Ref.prototype.once = function () {
    const self = this;
    return Promise.resolve(schnappschuss(self.pfad, lies(self.pfad)));
  };

  Ref.prototype.on = function (art, rueckruf) {
    const eigenerPfad = this.pfad;
    horcher.push({ pfad: eigenerPfad, art: art, rueckruf: rueckruf });
    /* Firebase feuert beim Anmelden sofort mit dem aktuellen Stand — bei
       `value` einmal für den Knoten, bei `child_added` einmal je Kind. */
    const wert = lies(eigenerPfad);
    setTimeout(function () {
      if (art === 'value') {
        rueckruf(schnappschuss(eigenerPfad, wert));
      } else if (art === 'child_added' && wert && typeof wert === 'object') {
        for (const k in wert) rueckruf(schnappschuss(eigenerPfad + '/' + k, wert[k]));
      }
    }, 0);
    return rueckruf;
  };

  Ref.prototype.off = function () {
    const self = this;
    horcher = horcher.filter(function (h) { return h.pfad !== self.pfad; });
  };

  const dbAttrappe = {
    ref: function (pfad) {
      /* Die Zeitverschiebung zum Server ist im Test immer null. */
      if (pfad === '.info/serverTimeOffset') {
        return { once: function () { return Promise.resolve(schnappschuss('offset', 0)); } };
      }
      return new Ref(pfad || '');
    },
    _baum: function () { return baum; },
    _leeren: function () { baum = {}; horcher = []; pushZaehler = 0; },
  };

  let nutzer = null;
  const authRueckrufe = [];
  const authAttrappe = {
    signInAnonymously: function () {
      nutzer = { uid: 'test-' + Math.floor(Math.random() * 100000) };
      authRueckrufe.forEach(function (r) { r(nutzer); });
      return Promise.resolve({ user: nutzer });
    },
    onAuthStateChanged: function (rueckruf) {
      authRueckrufe.push(rueckruf);
      if (nutzer) rueckruf(nutzer);
    },
    get currentUser() { return nutzer; },
  };

  const datenbankFunktion = function () { return dbAttrappe; };
  datenbankFunktion.ServerValue = { TIMESTAMP: TIMESTAMP };

  window.firebase = {
    initializeApp: function () { return {}; },
    database: datenbankFunktion,
    auth: function () { return authAttrappe; },
  };

  window.__attrappe = dbAttrappe;
})();
