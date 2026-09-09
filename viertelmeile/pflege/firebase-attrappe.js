/* ==========================================================================
   Viertelmeile — Firebase-Attrappe für Node
   ==========================================================================
   Bildet genau den Ausschnitt der Firebase-API nach, den `game-service.js`
   benutzt: `db.ref(pfad)` mit `once/on/off/set/remove/onDisconnect`,
   `firebase.database.ServerValue.TIMESTAMP` und die anonyme Anmeldung.
   Alles im Arbeitsspeicher, ohne Netz.

   Mehrere „Geräte" teilen sich EINEN Datenbaum — nur so lässt sich ein
   Turnier mit zwanzig Fahrern in einem Prozess durchspielen.

   ⚠️ WAS DIESE ATTRAPPE NICHT PRÜFT: die Sicherheitsregeln. Sie kennt keine
   `.read`/`.write`-Bedingungen und lässt jeden alles. Ob ein fremdes Gerät
   wirklich kein Ergebnis überschreiben kann, ist damit NICHT belegt — das
   geht ausschließlich gegen echtes Firebase mit eingespielten Rules.
   ========================================================================== */

'use strict';

function neuerBaum() {
  const bus = { baum: {}, horcher: [], zeitVersatz: 0 };

  function teile(pfad) {
    return String(pfad || '').split('/').filter(function (x) { return x.length > 0; });
  }

  function kopie(w) {
    if (w === null || typeof w !== 'object') return w;
    if (Array.isArray(w)) return w.map(kopie);
    const raus = {};
    for (const k in w) raus[k] = kopie(w[k]);
    return raus;
  }

  function aufloesen(w) {
    if (w && typeof w === 'object') {
      if (w['.sv'] === 'timestamp') return Date.now();
      if (Array.isArray(w)) return w.map(aufloesen);
      const raus = {};
      for (const k in w) raus[k] = aufloesen(w[k]);
      return raus;
    }
    return w;
  }

  function lies(pfad) {
    let k = bus.baum;
    for (const t of teile(pfad)) {
      if (k === null || typeof k !== 'object' || !(t in k)) return null;
      k = k[t];
    }
    return k === undefined ? null : k;
  }

  function schreibe(pfad, wert) {
    const t = teile(pfad);
    if (!t.length) { bus.baum = wert === null ? {} : aufloesen(wert); return; }
    let k = bus.baum;
    for (let i = 0; i < t.length - 1; i++) {
      if (k[t[i]] === undefined || k[t[i]] === null || typeof k[t[i]] !== 'object') k[t[i]] = {};
      k = k[t[i]];
    }
    if (wert === null) delete k[t[t.length - 1]];
    else k[t[t.length - 1]] = aufloesen(wert);
  }

  /** Ein Horcher wird geweckt, wenn sein Pfad den geschriebenen berührt. */
  function melde(pfad) {
    const gesetzt = teile(pfad).join('/');
    for (const h of bus.horcher.slice()) {
      const seiner = teile(h.pfad).join('/');
      const betroffen = gesetzt === seiner ||
        gesetzt.indexOf(seiner + '/') === 0 ||
        seiner.indexOf(gesetzt + '/') === 0 ||
        seiner === '' || gesetzt === '';
      if (betroffen) h.rueckruf(schnappschuss(h.pfad));
    }
  }

  function schnappschuss(pfad) {
    const w = kopie(lies(pfad));
    return {
      val: function () { return w; },
      exists: function () { return w !== null && w !== undefined; },
      key: teile(pfad).pop() || null,
    };
  }

  function ref(pfad) {
    if (pfad === '.info/serverTimeOffset') {
      return {
        once: function () { return Promise.resolve({ val: function () { return bus.zeitVersatz; } }); },
        on: function () {}, off: function () {},
      };
    }
    return {
      pfad: pfad,
      once: function () { return Promise.resolve(schnappschuss(pfad)); },
      on: function (art, rueckruf) {
        const h = { pfad: pfad, rueckruf: rueckruf };
        bus.horcher.push(h);
        this.__h = h;
        rueckruf(schnappschuss(pfad));
        return rueckruf;
      },
      off: function () {
        if (this.__h) bus.horcher = bus.horcher.filter(function (x) { return x !== this.__h; }.bind(this));
        this.__h = null;
      },
      set: function (wert) { schreibe(pfad, wert === undefined ? null : wert); melde(pfad); return Promise.resolve(); },
      remove: function () { schreibe(pfad, null); melde(pfad); return Promise.resolve(); },
      onDisconnect: function () {
        return { remove: function () { return Promise.resolve(); }, cancel: function () { return Promise.resolve(); } };
      },
    };
  }

  bus.db = { ref: ref };
  bus.firebase = { database: { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } } };
  bus.lies = lies;
  bus.pfade = function () { return kopie(bus.baum); };
  return bus;
}

/** Eine anonyme Anmeldung mit fester Kennung. */
function neueAnmeldung(uid) {
  const rueckrufe = [];
  return {
    onAuthStateChanged: function (fn) { rueckrufe.push(fn); setTimeout(function () { fn({ uid: uid }); }, 0); },
    signInAnonymously: function () { return Promise.resolve({ user: { uid: uid } }); },
  };
}

/** Ein Speicher je Gerät — sonst teilen sich alle „Handys" einen Raum-Code. */
function neuerSpeicher() {
  const inhalt = {};
  return {
    getItem: function (k) { return k in inhalt ? inhalt[k] : null; },
    setItem: function (k, v) { inhalt[k] = String(v); },
    removeItem: function (k) { delete inhalt[k]; },
  };
}

module.exports = { neuerBaum: neuerBaum, neueAnmeldung: neueAnmeldung, neuerSpeicher: neuerSpeicher };
