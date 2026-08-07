/* ==========================================================================
   Depot-Duell — Ablaufsteuerung
   ==========================================================================
   Startet die Zeichenfläche, hält den Zustand und verteilt auf die Ansichten.
   ========================================================================== */

/* Bleibt bei 1.0. Neue Funktionen kommen als Block in die Änderungsliste,
   die Versionsnummer wird nicht hochgezählt (Flottenregel). */
const APP_VERSION = '1.0';

const CHANGELOG = [
  {
    version: '1.0',
    groups: [
      {
        title: 'Erste Fassung',
        items: [
          '141 echte Werte: 106 Aktien, 25 ETFs und 10 Kryptowährungen mit echten Startkursen und Kennzahlen',
          'Fünf Börsenjahre je Partie, wahlweise in 10, 30 oder 60 Minuten',
          'Nachrichten bewegen die Kurse — mit Gerüchten, die sich als falsch herausstellen können',
          'KGV, Dividendenrendite und Marktkapitalisierung rechnen während der Partie mit',
          'Bis zu fünf KI-Mitspieler mit erkennbaren Anlagestilen, auch allein spielbar',
          'Höchstens 25 % des Depots je Wert beim Kauf, Ordergebühr 0,25 %',
          'Bestenliste über alle Partien nach Siegen und bester Rendite',
        ],
      },
    ],
  },
];

/* Gateway-Anbindung: wer in der Toolsübersicht als Administrator angemeldet
   ist, sieht Zusatzfunktionen. Fail-closed — ohne Token oder bei jedem
   Fehler bleibt es verborgen. Dieses Snippet gehört in jedes Spiel des Hubs. */
const TU_WORKER_URL = 'https://landingpage.michel-brunner.workers.dev';
const TU_TOKEN_KEY = 'tu_session_token';
let istAdmin = false;

function pruefeAdminStatus() {
  let token = null;
  try { token = localStorage.getItem(TU_TOKEN_KEY); } catch (f) { /* Privatmodus */ }
  if (!token) { istAdmin = false; return; }
  fetch(TU_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ action: 'me' }),
  })
    .then(function (a) { return a.ok ? a.json() : null; })
    .then(function (d) { istAdmin = !!(d && d.isAdmin); ui.anfordern(); })
    .catch(function () { istAdmin = false; });
}

const NAME_SCHLUESSEL = 'spiele_depotduell_name';

const app = {
  APP_VERSION: APP_VERSION,
  CHANGELOG: CHANGELOG,

  ansicht: 'start',       // start | beitreten | lobby-neu | lobby | spiel | detail | ende | bestenliste | info
  reiter: 'markt',        // markt | depot | rang | news
  klasse: 'aktie',
  sortierung: 'name',
  detailId: null,
  handel: null,           // { id, art, stueck }
  fehler: null,
  name: '',
  dauerStufe: 'normal',
  botAnzahl: 0,

  zustand: { uid: null, code: null, raum: null, trades: {}, tick: 0, restSekunden: 0, vorbei: false, istHost: false, dauerStufe: null },
  lauf: null,
  botFeld: [],
  wertNachId: {},
  werteListe: [],

  bestenlisteDaten: null,
  bestenlisteLaedt: false,
  ergebnisGemeldet: false,

  /* --------------------------------------------------------------------
     Zeit
     -------------------------------------------------------------------- */

  tick: function () {
    if (!this.zustand.raum || this.zustand.raum.phase === 'lobby') return 0;
    return gameService.aktuellerTick();
  },

  /* --------------------------------------------------------------------
     Ableitungen — nie gespeichert, immer gerechnet
     -------------------------------------------------------------------- */

  eigenerStand: function () {
    if (!this.lauf) return depot.berechne([], { saat: 0, kurse: {}, gewinne: {}, meldungen: [] }, 0, {});
    const meine = this.zustand.trades[this.zustand.uid] || [];
    return depot.stand('ich', meine, this.lauf, this.tick(), this.wertNachId);
  },

  rangliste: function () {
    if (!this.lauf || !this.zustand.raum) return [];
    const t = this.tick();
    const raus = [];

    const spieler = this.zustand.raum.spieler || {};
    for (const uid in spieler) {
      const trades = this.zustand.trades[uid] || [];
      const stand = depot.stand(uid, trades, this.lauf, t, this.wertNachId);
      raus.push({
        uid: uid, name: spieler[uid].name, zeichen: null, istBot: false,
        gesamt: stand.gesamt, rendite: stand.rendite, trades: stand.anzahlTrades,
      });
    }
    for (const b of this.botFeld) {
      const stand = depot.stand(b.uid, b.trades, this.lauf, t, this.wertNachId);
      raus.push({
        uid: b.uid, name: b.name, zeichen: b.zeichen, istBot: true,
        gesamt: stand.gesamt, rendite: stand.rendite, trades: stand.anzahlTrades,
      });
    }

    raus.sort(function (a, b) { return b.gesamt - a.gesamt; });
    return raus;
  },

  gefilterteWerte: function (suche, tick) {
    const s = String(suche || '').trim().toLowerCase();
    const self = this;
    let liste = this.werteListe.filter(function (w) { return w.art === self.klasse; });
    if (s) {
      liste = liste.filter(function (w) {
        return w.name.toLowerCase().indexOf(s) >= 0 || w.kuerzel.toLowerCase().indexOf(s) >= 0;
      });
    }
    const sort = this.sortierung;
    liste = liste.slice();
    if (sort === 'name') {
      liste.sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    } else if (sort === 'tag') {
      liste.sort(function (a, b) {
        return markt.veraenderung(self.lauf, b.id, tick) - markt.veraenderung(self.lauf, a.id, tick);
      });
    } else if (sort === 'kgv') {
      liste.sort(function (a, b) {
        const ka = markt.kgv(self.lauf, a, tick);
        const kb = markt.kgv(self.lauf, b, tick);
        /* Werte ohne KGV ans Ende, nicht als "günstigste" an den Anfang. */
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1;
        if (kb === null) return -1;
        return ka - kb;
      });
    } else if (sort === 'div') {
      liste.sort(function (a, b) {
        return markt.divRendite(self.lauf, b, tick) - markt.divRendite(self.lauf, a, tick);
      });
    }
    return liste;
  },

  /* --------------------------------------------------------------------
     Aktionen
     -------------------------------------------------------------------- */

  merkeName: function () {
    try { localStorage.setItem(NAME_SCHLUESSEL, this.name); } catch (f) { /* egal */ }
  },

  erstelleRaum: function () {
    const self = this;
    gameService.erstelleRaum(this.name.trim(), this.dauerStufe, this.botAnzahl)
      .then(function () { self.ansicht = 'lobby'; ui.anfordern(); })
      .catch(function (f) { self.fehler = f.message; self.ansicht = 'start'; ui.anfordern(); });
  },

  beitreten: function (code) {
    const self = this;
    this.fehler = null;
    gameService.betreteRaum(code, this.name.trim())
      .then(function () { self.ansicht = 'lobby'; ui.anfordern(); })
      .catch(function (f) { self.fehler = f.message; ui.anfordern(); });
  },

  /* Solo läuft über einen ganz normalen Raum — ein zweiter Weg wäre ein
     zweiter Satz Fehler. Beim Maulwurf war der Bot-Pfad genau deshalb
     komplett tot, während der Mehrspielerpfad sauber lief. */
  starteSolo: function () {
    const self = this;
    gameService.erstelleRaum(this.name.trim(), this.dauerStufe, 4)
      .then(function () { return gameService.starteRaum(); })
      .then(function () { self.ansicht = 'spiel'; self.reiter = 'markt'; ui.anfordern(); })
      .catch(function (f) { self.fehler = f.message; self.ansicht = 'start'; ui.anfordern(); });
  },

  starte: function () {
    gameService.starteRaum().catch(function (f) { console.warn(f); });
  },

  verlassen: function () {
    const self = this;
    gameService.verlasseRaum().then(function () {
      self.ansicht = 'start';
      self.lauf = null;
      self.botFeld = [];
      self.ergebnisGemeldet = false;
      ui.anfordern();
    });
  },

  raeumeAufUndZurueck: function () {
    const self = this;
    gameService.raeumeRaumAuf().then(function () {
      self.ansicht = 'start';
      self.lauf = null;
      self.botFeld = [];
      self.ergebnisGemeldet = false;
      ui.anfordern();
    });
  },

  oeffneHandel: function (id, art) {
    this.handel = { id: id, art: art, stueck: null };
    ui.setzeEingabe('eing-stueck', '');
  },

  fuehreHandelAus: function (wert, stueck) {
    const self = this;
    const art = this.handel.art;
    this.handel = null;
    gameService.handle(art, wert.id, stueck).catch(function (f) {
      self.fehler = f.message;
      console.warn('Auftrag abgelehnt:', f);
      ui.anfordern();
    });
  },

  ladeBestenliste: function () {
    const self = this;
    this.bestenlisteLaedt = true;
    gameService.ladeBestenliste()
      .then(function (l) { self.bestenlisteDaten = l; self.bestenlisteLaedt = false; ui.anfordern(); })
      .catch(function () { self.bestenlisteDaten = []; self.bestenlisteLaedt = false; ui.anfordern(); });
  },

  /* --------------------------------------------------------------------
     Zustandswechsel
     -------------------------------------------------------------------- */

  uebernehmeZustand: function (z) {
    const vorherigePhase = this.zustand.raum ? this.zustand.raum.phase : null;
    this.zustand = z;

    /* Lauf erzeugen, sobald eine Saat vorliegt. Einmal je Partie — die
       Berechnung kostet ein paar Millisekunden, aber sie bei jedem Bild zu
       wiederholen wäre Unsinn. */
    if (z.raum && z.raum.saat !== undefined && (!this.lauf || this.lauf.saat !== z.raum.saat)) {
      this.lauf = markt.erzeuge(z.raum.saat, this.werteListe);
      this.botFeld = z.raum.botAnzahl > 0
        ? bots.stelleAuf(this.lauf, this.werteListe, this.wertNachId, z.raum.botAnzahl)
        : [];
      depot.leereSpeicher();
      this.ergebnisGemeldet = false;
    }

    /* Ansicht nachziehen, wenn sich die Phase geändert hat. */
    if (z.raum) {
      if (z.raum.phase === 'lobby' && this.ansicht !== 'lobby' && this.ansicht !== 'info' && this.ansicht !== 'bestenliste') {
        this.ansicht = 'lobby';
      }
      if (z.raum.phase === 'laeuft' && (this.ansicht === 'lobby' || this.ansicht === 'lobby-neu' || this.ansicht === 'beitreten')) {
        this.ansicht = 'spiel';
        this.reiter = 'markt';
      }
    } else if (vorherigePhase && !z.raum) {
      /* Der Raum wurde abgeräumt. */
      this.ansicht = 'start';
      this.lauf = null;
      this.botFeld = [];
    }

    this.pruefeEnde();
    ui.anfordern();
  },

  pruefeEnde: function () {
    if (!this.zustand.vorbei || !this.lauf) return;
    if (this.ansicht === 'spiel' || this.ansicht === 'detail') this.ansicht = 'ende';

    /* Jedes Gerät meldet NUR sein eigenes Ergebnis. Ein Gerät, das für alle
       schreibt, müsste dafür verbunden bleiben — und wer als Letzter
       rausgeht, hätte die Liste in der Hand. */
    if (this.ergebnisGemeldet) return;
    const reihen = this.rangliste();
    if (!reihen.length) return;
    const eigener = reihen.find((e) => e.uid === this.zustand.uid);
    if (!eigener) return;
    this.ergebnisGemeldet = true;
    gameService.meldeErgebnis(
      eigener.name,
      eigener.rendite,
      reihen[0].uid === this.zustand.uid,
      this.botFeld.length > 0
    );
  },
};

/* ========================================================================
   Szene
   ======================================================================== */

function szene() {
  const a = app;

  if (a.ansicht === 'start') bildschirme.start(a);
  else if (a.ansicht === 'beitreten') bildschirme.beitreten(a);
  else if (a.ansicht === 'lobby-neu') bildschirme.lobbyNeu(a);
  else if (a.ansicht === 'lobby') bildschirme.lobby(a);
  else if (a.ansicht === 'detail') bildschirme.detail(a);
  else if (a.ansicht === 'ende') bildschirme.ende(a);
  else if (a.ansicht === 'bestenliste') bildschirme.bestenliste(a);
  else if (a.ansicht === 'info') bildschirme.info(a);
  else bildschirme.spiel(a);

  /* Dialoge zuletzt, sie liegen über allem. */
  if (a.handel) bildschirme.handelDialog(a);

  /* Aufklappbare Auswahllisten gehören ganz nach oben. */
  ui.zeichneOffeneListen();
}

/* ========================================================================
   Start
   ======================================================================== */

(function () {
  app.werteListe = WERTE.werte;
  for (const w of WERTE.werte) app.wertNachId[w.id] = w;

  try {
    const gemerkt = localStorage.getItem(NAME_SCHLUESSEL);
    if (gemerkt) app.name = gemerkt;
  } catch (f) { /* Privatmodus */ }

  ui.starte(
    document.getElementById('buehne'),
    document.getElementById('tastatur-proxy'),
    szene
  );

  gameService.onZustandsAenderung(function (z) { app.uebernehmeZustand(z); });

  /* Die Kurse laufen weiter, auch wenn niemand etwas antippt. Ein halber
     Sekundentakt reicht: der Tick wechselt frühestens alle zwei Sekunden,
     und der Countdown in der Kopfzeile soll flüssig zählen. Bewusst KEIN
     Dauerlauf mit 60 Bildern je Sekunde — auf einer Busfahrt ist das
     Akkuverschwendung. */
  setInterval(function () {
    if (app.zustand.raum && app.zustand.raum.phase === 'laeuft') {
      app.pruefeEnde();
      ui.anfordern();
    }
  }, 500);

  pruefeAdminStatus();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { pruefeAdminStatus(); ui.anfordern(); }
  });
})();
