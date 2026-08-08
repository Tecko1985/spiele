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
    version: '1.3',
    groups: [
      {
        title: '250 Werte statt 141',
        items: [
          '109 neue Werte: jetzt 188 Aktien, 44 ETFs und 18 Kryptowährungen — die Mischung bleibt dieselbe, es ist nur mehr Auswahl da',
          'Die Länder holen auf: Japan hatte einen einzigen Wert und hat jetzt 16, die Schweiz 11 statt 1, Kanada 11 statt 1, Südkorea 8 statt 1, Großbritannien 13 statt 4. Der Anteil der USA sinkt von 38 auf 29 Prozent',
          'Neu dabei sind unter anderem Toyota, Sony, Nintendo, Samsung, Nestlé, Roche, Tencent, Shopify, Unilever, Boeing und Disney — dazu Länder-ETFs auf Japan, China, Indien und die Eurozone',
          'Kurse aus dem Ausland kommen jetzt von der Heimatbörse statt über einen dünn gehandelten US-Schein: Tokio in Yen, Zürich in Franken, London in Pence, Seoul in Won, Toronto in kanadischen Dollar',
          'Bei 9 Aktien fehlt das KGV und bei keinem ETF mehr die laufende Kostenquote — wo eine Kennzahl fehlt, steht weiterhin ein Strich statt einer geschätzten Zahl',
        ],
      },
      {
        title: 'Nachrichten treffen wieder gleichmäßig',
        items: [
          'Telekomwerte gehörten zu gar keiner Branchengruppe und wurden von Branchenmeldungen nie erfasst',
          'Die Gruppe "Immobilienwerte" bestand aus zwei Werten, wurde aber genauso oft gezogen wie die größte Gruppe — eine solche Meldung traf in aller Regel kein einziges Depot. Versorger, Telekom und Immobilien bilden jetzt zusammen die Gruppe "Versorger und Netzbetreiber"',
        ],
      },
      {
        title: 'Unter der Haube',
        items: [
          'Die Kurse werden für die wöchentliche Pflege jetzt automatisch abgerufen statt abgeschrieben — 250 Kurse von Hand einzutragen war die sicherste Art, einen Zahlendreher einzubauen',
        ],
      },
    ],
  },
  {
    version: '1.2',
    groups: [
      {
        title: 'Der Eröffner stellt die Partie ein',
        items: [
          'Startgeld wählbar: 10.000, 50.000, 100.000 oder eine Million',
          'Ordergebühr wählbar: keine, 0,25 % oder 1 %',
          'Höchstanteil je Wert wählbar: 10, 25, 50 Prozent oder ohne Grenze',
          'Die Einstellungen lassen sich in der Lobby noch ändern, solange die Partie nicht läuft — danach nicht mehr, sonst würde jeder bereits getätigte Kauf rückwirkend anders bewertet',
          'Auch der Weg "Allein gegen die KI üben" führt jetzt durch die Einstellungen statt sofort loszulaufen',
        ],
      },
      {
        title: 'Kleinigkeiten',
        items: [
          'Der Startbildschirm sitzt mittig statt am oberen Rand',
          'Nach einem Neuladen mitten in der Partie landet man wieder im Spiel statt auf dem Startbildschirm',
          'Der Knopf zum Beenden sitzt jetzt oben rechts in der Kopfzeile und ist in jeder Ansicht erreichbar',
          'Die Leiste zum Rundenabschluss lag auf dem iPhone unter dem Home-Indicator und war dort nicht zu treffen',
        ],
      },
    ],
  },
  {
    version: '1.1',
    groups: [
      {
        title: 'Rundenmodus statt Zeitdruck',
        items: [
          'Das Spiel läuft jetzt in Runden: 20, 50 oder 100 zur Wahl — es tickt keine Uhr mehr mit',
          'Die Kurse bewegen sich erst, wenn alle Mitspieler die Runde abgeschlossen haben',
          'Unter dem Knopf steht, auf wen noch gewartet wird; der Eröffner kann weiterschalten, wenn jemand nicht mehr reagiert',
          'Wer abgeschlossen hat, kann in dieser Runde nicht mehr handeln — sonst könnte man als Letzter noch zuschlagen',
        ],
      },
      {
        title: 'Nachrichten stehen ganz oben',
        items: [
          'Die Meldungen der laufenden Runde stehen über allem und sind durchblätterbar',
          'Sie wirken erst auf den nächsten Kursschritt — man hat also Zeit, darauf zu reagieren',
          'Der Nachrichtenblock lässt sich zuklappen, wenn der Platz für die Marktliste gebraucht wird',
          'Der alte News-Reiter heißt jetzt Archiv und sammelt alle bisherigen Meldungen',
        ],
      },
      {
        title: 'Kopfzeile und Marktliste',
        items: [
          'Das freie Guthaben steht jetzt in der Kopfzeile — man muss für eine Kaufentscheidung nicht mehr ins Depot wechseln',
          'Rundenstand statt Restzeit, mit Fortschrittsbalken',
          'Sortierung dreht beim zweiten Antippen die Richtung um',
          'Eigene Sortierkriterien je Anlageklasse: ETFs und Kryptowährungen haben weder KGV noch Dividende, die Knöpfe sortierten dort nichts',
        ],
      },
      {
        title: 'Partie beenden',
        items: [
          'Der Eröffner kann die Partie abbrechen, jeder andere kann aussteigen — beides mit Rückfrage',
          'Wer aussteigt, hält die Runden nicht länger auf; sein Depot bleibt in der Rangliste stehen',
          'Eine abgebrochene Partie zählt nicht für die Bestenliste',
        ],
      },
    ],
  },
  {
    version: '1.0',
    groups: [
      {
        title: 'Erste Fassung',
        items: [
          '141 echte Werte: 106 Aktien, 25 ETFs und 10 Kryptowährungen mit echten Startkursen und Kennzahlen',
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
   Fehler bleibt es verborgen. Dieses Snippet gehört in jedes Spiel des Hubs.
   ⚠️ In diesem Spiel wird `istAdmin` derzeit von KEINER Ansicht ausgewertet:
   es gibt nichts Administratives zu verbergen (die Werteliste wird über das
   Pflegeskript im Repo gepflegt, nicht über die Oberfläche). Das Snippet
   steht vorgehalten da, damit eine künftige Verwaltungsansicht nicht wieder
   von vorn anfangen muss — wer eine baut, hängt sie an dieses Flag. */
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
  sortAb: false,          // absteigend?
  detailId: null,
  handel: null,           // { id, art, stueck }
  abbruchFrage: false,
  newsOffen: true,
  newsIndex: 0,
  fehler: null,
  name: '',

  /* Was in der Einstellansicht gerade eingestellt wird. Erst beim Eröffnen
     wandert es in den Raum — ab da gilt es für alle und ist nicht mehr
     Sache des einzelnen Geräts. */
  entwurf: {
    runden: markt.STANDARD_RUNDEN,
    botAnzahl: 0,
    startgeld: depot.VORGABE.startgeld,
    gebuehrSatz: depot.VORGABE.gebuehrSatz,
    gebuehrMind: depot.VORGABE.gebuehrMind,
    hoechstanteil: depot.VORGABE.hoechstanteil,
  },

  zustand: {
    uid: null, code: null, raum: null, trades: {}, runde: 0,
    runden: markt.STANDARD_RUNDEN, abgeschlossen: false, fehlende: [],
    bereitJetzt: {}, vorbei: false, abgebrochen: false, istHost: false, stufe: null,
  },
  lauf: null,
  botFeld: [],
  wertNachId: {},
  werteListe: [],

  bestenlisteDaten: null,
  bestenlisteLaedt: false,
  ergebnisGemeldet: false,

  /* --------------------------------------------------------------------
     Die Runde
     -------------------------------------------------------------------- */

  runde: function () {
    if (!this.zustand.raum || this.zustand.raum.phase === 'lobby') return 0;
    return this.zustand.runde;
  },

  /* Die geltenden Regeln — aus dem Raum, nicht aus dem Entwurf. Solange man
     noch keinen Raum hat (Startbildschirm, Info), zeigt die Oberfläche den
     Entwurf, damit dort keine Zahlen stehen, die niemand eingestellt hat. */
  regeln: function () {
    if (this.zustand.raum && this.zustand.raum.regeln) {
      return depot.normiereRegeln(this.zustand.raum.regeln);
    }
    if (this.zustand.raum) return depot.normiereRegeln(null);
    return depot.normiereRegeln(this.entwurf);
  },

  /* --------------------------------------------------------------------
     Ableitungen — nie gespeichert, immer gerechnet
     -------------------------------------------------------------------- */

  eigenerStand: function () {
    if (!this.lauf) {
      return depot.berechne([], { saat: 0, runden: 0, rundenJeJahr: 10, kurse: {}, gewinne: {}, meldungen: [] }, 0, {}, this.regeln());
    }
    const meine = this.zustand.trades[this.zustand.uid] || [];
    return depot.stand('ich', meine, this.lauf, this.runde(), this.wertNachId, this.regeln());
  },

  rangliste: function () {
    if (!this.lauf || !this.zustand.raum) return [];
    const t = this.runde();
    const raus = [];
    const bereitJetzt = this.zustand.bereitJetzt || {};
    const R = this.regeln();

    const spieler = this.zustand.raum.spieler || {};
    for (const uid in spieler) {
      const trades = this.zustand.trades[uid] || [];
      const stand = depot.stand(uid, trades, this.lauf, t, this.wertNachId, R);
      raus.push({
        uid: uid, name: spieler[uid].name, zeichen: null, istBot: false,
        raus: !!spieler[uid].raus, fertig: !!bereitJetzt[uid],
        gesamt: stand.gesamt, rendite: stand.rendite, trades: stand.anzahlTrades,
      });
    }
    for (const b of this.botFeld) {
      const stand = depot.stand(b.uid, b.trades, this.lauf, t, this.wertNachId, R);
      raus.push({
        uid: b.uid, name: b.name, zeichen: b.zeichen, istBot: true,
        raus: false, fertig: true,
        gesamt: stand.gesamt, rendite: stand.rendite, trades: stand.anzahlTrades,
      });
    }

    raus.sort(function (a, b) { return b.gesamt - a.gesamt; });
    return raus;
  },

  gefilterteWerte: function (suche, runde) {
    const s = String(suche || '').trim().toLowerCase();
    const self = this;
    let liste = this.werteListe.filter(function (w) { return w.art === self.klasse; });
    if (s) {
      liste = liste.filter(function (w) {
        return w.name.toLowerCase().indexOf(s) >= 0 || w.kuerzel.toLowerCase().indexOf(s) >= 0;
      });
    }
    liste = liste.slice();

    /* Der Vergleich liefert immer die AUFSTEIGENDE Ordnung; die Richtung
       kommt am Ende durch ein einziges Vorzeichen dazu. Zwei getrennte
       Sortierzweige wären zwei Stellen, an denen dieselbe Regel auseinander
       laufen kann. */
    const sort = this.sortierung;
    let vergleich;
    if (sort === 'tag') {
      vergleich = function (a, b) {
        return markt.veraenderung(self.lauf, a.id, runde) - markt.veraenderung(self.lauf, b.id, runde);
      };
    } else if (sort === 'kgv') {
      vergleich = function (a, b) {
        const ka = markt.kgv(self.lauf, a, runde);
        const kb = markt.kgv(self.lauf, b, runde);
        /* Werte ohne KGV IMMER ans Ende — auch wenn umgekehrt sortiert wird.
           Sonst führte ein Dreh der Richtung neunzehn Werte ohne Kennzahl
           an die Spitze, als wären sie die teuersten. */
        if (ka === null && kb === null) return 0;
        if (ka === null) return self.sortAb ? -1 : 1;
        if (kb === null) return self.sortAb ? 1 : -1;
        return ka - kb;
      };
    } else if (sort === 'div') {
      vergleich = function (a, b) {
        return markt.divRendite(self.lauf, a, runde) - markt.divRendite(self.lauf, b, runde);
      };
    } else if (sort === 'kurs') {
      vergleich = function (a, b) {
        return markt.kurs(self.lauf, a.id, runde) - markt.kurs(self.lauf, b.id, runde);
      };
    } else if (sort === 'seit') {
      vergleich = function (a, b) {
        return markt.seitStart(self.lauf, a.id, runde) - markt.seitStart(self.lauf, b.id, runde);
      };
    } else if (sort === 'groesse') {
      vergleich = function (a, b) {
        return (markt.marktkapitalisierung(self.lauf, a, runde) || 0) -
          (markt.marktkapitalisierung(self.lauf, b, runde) || 0);
      };
    } else {
      vergleich = function (a, b) { return a.name.localeCompare(b.name, 'de'); };
    }

    const richtung = this.sortAb ? -1 : 1;
    liste.sort(function (a, b) { return richtung * vergleich(a, b); });
    return liste;
  },

  /* --------------------------------------------------------------------
     Aktionen
     -------------------------------------------------------------------- */

  merkeName: function () {
    try { localStorage.setItem(NAME_SCHLUESSEL, this.name); } catch (f) { /* egal */ }
  },

  /* Beim Wechsel der Anlageklasse muss die Sortierung mitziehen: nach KGV
     sortierte Aktien, dann auf Krypto gewechselt — dort gibt es kein KGV,
     die Liste stünde in willkürlicher Reihenfolge und der aktive Knopf wäre
     gar nicht sichtbar. */
  setzeKlasse: function (klasse) {
    if (this.klasse === klasse) return;
    this.klasse = klasse;
    const erlaubt = bildschirme.sortenFuer(klasse);
    if (!erlaubt.some((s) => s.id === this.sortierung)) {
      this.sortierung = erlaubt[0].id;
      this.sortAb = !erlaubt[0].auf;
    }
  },

  /* Erstes Antippen: das Kriterium mit seiner sinnvollen Richtung. Erneutes
     Antippen: umdrehen. */
  setzeSortierung: function (sorte) {
    if (this.sortierung === sorte.id) this.sortAb = !this.sortAb;
    else { this.sortierung = sorte.id; this.sortAb = !sorte.auf; }
  },

  /* Beim Öffnen den Entwurf aus dem Raum füllen — sonst stünden dort die
     zuletzt auf DIESEM Gerät eingestellten Werte statt der Werte, die für
     alle im Raum gelten. */
  oeffneEinstellungen: function () {
    const R = this.regeln();
    this.entwurf = {
      runden: this.zustand.runden || markt.STANDARD_RUNDEN,
      botAnzahl: this.zustand.botAnzahl || 0,
      startgeld: R.startgeld,
      gebuehrSatz: R.gebuehrSatz,
      gebuehrMind: R.gebuehrMind,
      hoechstanteil: R.hoechstanteil,
    };
    this.ansicht = 'lobby-neu';
  },

  uebernehmeEinstellungen: function () {
    const self = this;
    gameService.aendereEinstellungen(this.entwurf)
      .then(function () { self.ansicht = 'lobby'; ui.anfordern(); })
      .catch(function (f) { self.fehler = f.message; ui.anfordern(); });
  },

  erstelleRaum: function () {
    const self = this;
    gameService.erstelleRaum(this.name.trim(), this.entwurf)
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
    gameService.erstelleRaum(this.name.trim(), this.entwurf)
      .then(function () { return gameService.starteRaum(); })
      .then(function () { self.ansicht = 'spiel'; self.reiter = 'markt'; ui.anfordern(); })
      .catch(function (f) { self.fehler = f.message; self.ansicht = 'start'; ui.anfordern(); });
  },

  starte: function () {
    gameService.starteRaum().catch(function (f) { console.warn(f); });
  },

  /* Übersetzt, woran ein Schreibvorgang gescheitert ist. "PERMISSION_DENIED"
     allein lässt jeden ratlos zurück — und der mit Abstand häufigste Grund
     dafür ist, dass die Firebase-Rules nicht veröffentlicht wurden. */
  fehlertext: function (f) {
    const roh = (f && f.message) || String(f);
    if (/permission_denied/i.test(roh)) {
      return 'Der Server hat den Zug abgelehnt (PERMISSION_DENIED). Vermutlich fehlen die Firebase-Regeln.';
    }
    return roh;
  },

  schliesseRundeAb: function () {
    const self = this;
    /* Ein offener Kaufdialog wäre nach dem Abschließen wirkungslos — der
       Auftrag würde abgelehnt und nur eine Fehlermeldung hinterlassen. */
    this.handel = null;
    this.fehler = null;
    gameService.schliesseRundeAb().catch(function (f) {
      self.fehler = self.fehlertext(f);
      console.warn('Runde nicht abgeschlossen:', f);
      ui.anfordern();
    });
  },

  schalteWeiter: function () {
    const self = this;
    this.fehler = null;
    gameService.schalteWeiter().catch(function (f) {
      self.fehler = self.fehlertext(f);
      console.warn('Nicht weitergeschaltet:', f);
      ui.anfordern();
    });
  },

  brichAb: function () {
    const self = this;
    gameService.brichAb().catch(function (f) {
      self.fehler = self.fehlertext(f);
      console.warn('Nicht abgebrochen:', f);
      ui.anfordern();
    });
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
      self.fehler = self.fehlertext(f);
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
    const vorherigeRunde = this.zustand.runde;
    this.zustand = z;

    /* Lauf erzeugen, sobald Saat und Rundenzahl vorliegen. Einmal je Partie
       — die Berechnung kostet ein paar Millisekunden, aber sie bei jedem
       Bild zu wiederholen wäre Unsinn. */
    if (z.raum && z.raum.saat !== undefined &&
        (!this.lauf || this.lauf.saat !== z.raum.saat || this.lauf.runden !== z.runden)) {
      this.lauf = markt.erzeuge(z.raum.saat, this.werteListe, z.runden);
      this.botFeld = z.raum.botAnzahl > 0
        ? bots.stelleAuf(this.lauf, this.werteListe, this.wertNachId, z.raum.botAnzahl, this.regeln())
        : [];
      depot.leereSpeicher();
      this.ergebnisGemeldet = false;
    }

    /* Neue Runde: die neuen Meldungen sollen sichtbar sein und von vorn
       beginnen. Wer zugeklappt hatte, bekommt sie wieder eingeblendet —
       sie sind die Grundlage der nächsten Entscheidung. */
    if (z.runde !== vorherigeRunde) {
      this.newsIndex = 0;
      this.newsOffen = true;
    }

    /* Ansicht nachziehen, wenn sich die Phase geändert hat. */
    if (z.raum) {
      if (z.raum.phase === 'lobby' && this.ansicht !== 'lobby' && this.ansicht !== 'info' &&
          this.ansicht !== 'bestenliste' && this.ansicht !== 'lobby-neu') {
        this.ansicht = 'lobby';
      }
      /* 'start' MUSS mit in die Liste. Nach einem Neuladen mitten in der
         Partie steht die Ansicht auf ihrem Anfangswert 'start' — ohne diesen
         Fall landete man auf "Wer bist du?", während oben der eigene
         Depotwert und die laufende Runde standen. Der Raumcode liegt ja im
         Speicher, die Partie läuft weiter. */
      if (z.raum.phase === 'laeuft' &&
          (this.ansicht === 'start' || this.ansicht === 'lobby' ||
           this.ansicht === 'lobby-neu' || this.ansicht === 'beitreten')) {
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
    this.abbruchFrage = false;
    this.handel = null;

    /* Jedes Gerät meldet NUR sein eigenes Ergebnis. Ein Gerät, das für alle
       schreibt, müsste dafür verbunden bleiben — und wer als Letzter
       rausgeht, hätte die Liste in der Hand. */
    if (this.ergebnisGemeldet) return;
    const reihen = this.rangliste();
    if (!reihen.length) return;
    const eigener = reihen.find((e) => e.uid === this.zustand.uid);
    if (!eigener) return;
    this.ergebnisGemeldet = true;
    /* Eine abgebrochene Partie zählt nicht — sonst bräche der Führende
       genau dann ab, wenn er vorn liegt. */
    gameService.meldeErgebnis(
      eigener.name,
      eigener.rendite,
      reihen[0].uid === this.zustand.uid,
      this.botFeld.length > 0 || this.zustand.abgebrochen
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
  else if (a.abbruchFrage) bildschirme.abbruchDialog(a);

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

  /* Kein Zeittakt mehr: seit die Runde aus den Zustimmungen abgeleitet wird,
     ändert sich am Bild nichts von selbst. Jede Änderung kommt über den
     Firebase-Horcher herein und zeichnet dort neu — ein Dauerlauf hätte auf
     einer Busfahrt nur Akku gekostet. */

  gameService.onZustandsAenderung(function (z) { app.uebernehmeZustand(z); });

  pruefeAdminStatus();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { pruefeAdminStatus(); ui.anfordern(); }
  });
})();
