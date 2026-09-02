/* ==========================================================================
   Werwolf — Firebase-Attrappe für den Test MIT MEHREREN GERÄTEN
   ==========================================================================

   Bildet den Ausschnitt der Firebase-API nach, den `game-service.js`
   benutzt — im Arbeitsspeicher, ohne Netz. Anders als die Attrappe von
   Letzte Karte kennt sie MEHRERE Clients: jedes iframe im Testrahmen
   (`test-harness.html`) ist ein eigenes „Handy" mit eigener uid, alle
   teilen sich den Datenbaum des Elternfensters. Nur so lässt sich eine
   Partie mit acht Spielern in einem einzigen Browserfenster durchspielen.

   WOZU.
   Im Vorschaufenster ist der Zugriff auf googleapis gesperrt, die Anmeldung
   scheitert und die App kommt nie über den Startbildschirm hinaus.

   ⚠️ WAS DIESE ATTRAPPE NICHT PRÜFT:
   die Sicherheitsregeln. Sie kennt keine `.read`/`.write`-Bedingungen und
   lässt jeden alles. Ob `privat/<code>/<uid>` wirklich nur der Besitzer
   lesen darf, ist damit NICHT belegt — das geht ausschließlich gegen echtes
   Firebase mit eingespielten Rules.

   Sie wird NIE von `index.html` geladen, nur von `pflege/client.html`.
   ========================================================================== */

(function () {
  'use strict';

  const TIMESTAMP = { '.sv': 'timestamp' };

  /* Der Bus lebt im obersten Fenster; iframes greifen darauf zu. */
  function holeBus() {
    let w = window;
    try { while (w.parent && w.parent !== w && w.parent.__werwolfBus !== undefined) w = w.parent; } catch (f) { /* fremder Origin */ }
    if (!w.__werwolfBus) {
      w.__werwolfBus = { baum: {}, horcher: [], pushZaehler: 0 };
    }
    return w.__werwolfBus;
  }
  const bus = holeBus();

  function teile(pfad) {
    return String(pfad || '').split('/').filter(function (x) { return x.length > 0; });
  }

  function lies(pfad) {
    let k = bus.baum;
    for (const t of teile(pfad)) {
      if (k === null || typeof k !== 'object') return null;
      if (!(t in k)) return null;
      k = k[t];
    }
    return k === undefined ? null : k;
  }

  function aufloesen(wert) {
    if (wert && typeof wert === 'object') {
      if (wert['.sv'] === 'timestamp') return Date.now();
      if (Array.isArray(wert)) return wert.map(aufloesen);
      const raus = {};
      for (const k in wert) {
        const v = aufloesen(wert[k]);
        if (v !== null && v !== undefined) raus[k] = v;
      }
      return raus;
    }
    return wert;
  }

  /* Firebase löscht Knoten, die auf null gesetzt werden, und entfernt
     leere Elternknoten — die Attrappe auch, sonst sähe `exists()` anders aus. */
  function schreib(pfad, wert) {
    const t = teile(pfad);
    if (t.length === 0) { bus.baum = aufloesen(wert) || {}; return; }
    let k = bus.baum;
    const kette = [k];
    for (let i = 0; i < t.length - 1; i++) {
      if (typeof k[t[i]] !== 'object' || k[t[i]] === null) k[t[i]] = {};
      k = k[t[i]];
      kette.push(k);
    }
    const letzt = t[t.length - 1];
    if (wert === null || wert === undefined) delete k[letzt];
    else k[letzt] = aufloesen(wert);
    /* Leere Objekte nach oben wegräumen. */
    for (let i = t.length - 1; i >= 1; i--) {
      const eltern = kette[i - 1];
      const kind = eltern[t[i - 1]];
      if (kind && typeof kind === 'object' && Object.keys(kind).length === 0) delete eltern[t[i - 1]];
      else break;
    }
  }

  function kopie(x) { return x === null || x === undefined ? null : JSON.parse(JSON.stringify(x)); }

  function schnappschuss(pfad, wert) {
    const t = teile(pfad);
    return {
      key: t.length ? t[t.length - 1] : null,
      ref: new Ref(pfad),
      val: function () { return kopie(wert); },
      exists: function () { return wert !== null && wert !== undefined; },
      forEach: function (rueckruf) {
        if (!wert || typeof wert !== 'object') return false;
        for (const k of Object.keys(wert)) {
          if (rueckruf(schnappschuss(pfad + '/' + k, wert[k])) === true) return true;
        }
        return false;
      },
      child: function (unter) {
        const w = wert && typeof wert === 'object' ? wert[unter] : null;
        return schnappschuss(pfad + '/' + unter, w === undefined ? null : w);
      },
    };
  }

  function istUnter(pfad, eltern) {
    return pfad === eltern || pfad.indexOf(eltern + '/') === 0 || eltern === '';
  }

  /**
   * Nach jedem Schreiben: alle Horcher benachrichtigen, deren Pfad den
   * geschriebenen berührt. `vorher` ist der Baum vor dem Schreiben — nur so
   * lässt sich child_added von child_changed unterscheiden.
   */
  function meldeAenderung(pfade, vorher) {
    const liste = Array.isArray(pfade) ? pfade : [pfade];
    for (const h of bus.horcher.slice()) {
      const betroffen = liste.some(function (p) { return istUnter(p, h.pfad) || istUnter(h.pfad, p); });
      if (!betroffen) continue;
      if (h.art === 'value') {
        const wert = lies(h.pfad);
        setTimeout(function () { if (h.aktiv) h.rueckruf(schnappschuss(h.pfad, wert)); }, 0);
        continue;
      }
      /* child_added / child_changed: welche Kinder des Horcherpfads sind betroffen? */
      const kinder = {};
      for (const p of liste) {
        if (istUnter(p, h.pfad) && p !== h.pfad) {
          const rest = teile(p.slice(h.pfad.length));
          if (rest.length) kinder[rest[0]] = true;
        } else if (istUnter(h.pfad, p)) {
          const jetzt = lies(h.pfad) || {};
          for (const k of Object.keys(jetzt)) kinder[k] = true;
        }
      }
      for (const k of Object.keys(kinder)) {
        const neu = lies(h.pfad + '/' + k);
        if (neu === null) continue;
        const alt = liesIn(vorher, h.pfad + '/' + k);
        const art = alt === null ? 'child_added' : 'child_changed';
        if (art !== h.art) continue;
        setTimeout(function () { if (h.aktiv) h.rueckruf(schnappschuss(h.pfad + '/' + k, neu)); }, 0);
      }
    }
  }

  function liesIn(baum, pfad) {
    let k = baum;
    for (const t of teile(pfad)) {
      if (k === null || typeof k !== 'object') return null;
      if (!(t in k)) return null;
      k = k[t];
    }
    return k === undefined ? null : k;
  }

  function Ref(pfad) { this.pfad = teile(pfad).join('/'); }

  Ref.prototype.set = function (wert) {
    const vorher = kopie(bus.baum);
    schreib(this.pfad, wert);
    meldeAenderung(this.pfad, vorher);
    return Promise.resolve();
  };
  Ref.prototype.remove = function () {
    const vorher = kopie(bus.baum);
    schreib(this.pfad, null);
    meldeAenderung(this.pfad, vorher);
    return Promise.resolve();
  };
  Ref.prototype.update = function (teilObjekt) {
    const vorher = kopie(bus.baum);
    const pfade = [];
    for (const k in teilObjekt) {
      const voll = teile(this.pfad + '/' + k).join('/');
      schreib(voll, teilObjekt[k]);
      pfade.push(voll);
    }
    meldeAenderung(pfade, vorher);
    return Promise.resolve();
  };
  Ref.prototype.push = function (wert) {
    const vorher = kopie(bus.baum);
    bus.pushZaehler++;
    const id = '-P' + String(bus.pushZaehler).padStart(8, '0');
    const voll = this.pfad + '/' + id;
    schreib(voll, wert);
    meldeAenderung(voll, vorher);
    return Promise.resolve(new Ref(voll));
  };
  Ref.prototype.once = function (art) {
    const pfad = this.pfad;
    if (pfad === '.info/serverTimeOffset') return Promise.resolve(schnappschuss(pfad, 0));
    return Promise.resolve(schnappschuss(pfad, lies(pfad)));
  };
  Ref.prototype.on = function (art, rueckruf) {
    const h = { pfad: this.pfad, art: art, rueckruf: rueckruf, aktiv: true, fenster: window };
    bus.horcher.push(h);
    const pfad = this.pfad;
    /* Firebase liefert beim Anmelden sofort den aktuellen Stand. */
    setTimeout(function () {
      if (!h.aktiv) return;
      if (art === 'value') rueckruf(schnappschuss(pfad, lies(pfad)));
      else if (art === 'child_added') {
        const jetzt = lies(pfad);
        if (jetzt && typeof jetzt === 'object') for (const k of Object.keys(jetzt)) rueckruf(schnappschuss(pfad + '/' + k, jetzt[k]));
      }
    }, 0);
    return rueckruf;
  };
  Ref.prototype.off = function () {
    const pfad = this.pfad;
    for (const h of bus.horcher) if (h.pfad === pfad && h.fenster === window) h.aktiv = false;
    bus.horcher = bus.horcher.filter(function (h) { return h.aktiv; });
  };

  /* Jedes Fenster ist ein eigenes Gerät: uid aus der Adresse. */
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') || ('geraet-' + Math.random().toString(36).slice(2, 8));

  const authAttrappe = {
    currentUser: null,
    signInAnonymously: function () {
      authAttrappe.currentUser = { uid: uid };
      for (const r of authAttrappe._rueckrufe) setTimeout(function () { r(authAttrappe.currentUser); }, 0);
      return Promise.resolve({ user: authAttrappe.currentUser });
    },
    onAuthStateChanged: function (rueckruf) {
      authAttrappe._rueckrufe.push(rueckruf);
      if (authAttrappe.currentUser) setTimeout(function () { rueckruf(authAttrappe.currentUser); }, 0);
    },
    _rueckrufe: [],
  };

  const datenbankFunktion = function () {
    return { ref: function (pfad) { return new Ref(pfad); } };
  };
  datenbankFunktion.ServerValue = { TIMESTAMP: TIMESTAMP };

  window.firebase = {
    initializeApp: function () { return {}; },
    database: datenbankFunktion,
    auth: function () { return authAttrappe; },
  };

  /* Alle iframes teilen sich den echten localStorage — jedes Gerät bekommt
     deshalb einen eigenen im Arbeitsspeicher, sonst wäre der gemerkte
     Raum-Code von Gerät 1 auch der von Gerät 2. */
  /* Der Speicher liegt im Bus (Elternfenster), damit er wie ein echter
     localStorage das Neuladen eines Geräts überlebt. */
  if (!bus.speicher) bus.speicher = {};
  const speicher = bus.speicher[uid] || (bus.speicher[uid] = {});
  const eigenerSpeicher = {
    getItem: function (k) { return k in speicher ? speicher[k] : null; },
    setItem: function (k, v) { speicher[k] = String(v); },
    removeItem: function (k) { delete speicher[k]; },
  };
  try { Object.defineProperty(window, 'localStorage', { value: eigenerSpeicher, configurable: true }); } catch (f) { /* dann eben geteilt */ }

  window.__attrappe = { lies: lies, baum: function () { return bus.baum; }, uid: uid };
})();
