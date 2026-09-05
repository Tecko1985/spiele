/* ==========================================================================
   Letzte Karte — Ablaufsteuerung
   ==========================================================================
   Startet die Zeichenfläche, hält den Zustand des einzelnen Geräts und
   verteilt auf die Ansichten.

   WELCHE ANSICHT GILT, WIRD ABGELEITET — NICHT GESPEICHERT.
   `ansicht()` liest sie aus dem Raumzustand ab. Ein eigenes Feld dafür wäre
   eine zweite Wahrheit: nach einem Neuladen oder wenn der Eröffner die
   Partie startet, stünde dort noch die alte Ansicht, und das Gerät bliebe
   in einer Lobby stehen, die es längst nicht mehr gibt.
   ========================================================================== */

/* Bleibt bei 1.0. Neue Funktionen kommen als Block in die Änderungsliste,
   die Versionsnummer wird nicht hochgezählt (Flottenregel). */
const APP_VERSION = '1.0';

const CHANGELOG = [
  {
    version: '1.5',
    groups: [
      {
        title: 'Behoben',
        items: [
          'Sobald die Partie lief, zeigte die App keinen einzigen Fehler mehr an. Brach beim Gastgeber das Speichern ab, stand das Spiel für alle still — und niemand bekam einen Hinweis, nicht einmal er selbst. Jetzt erscheint eine Meldung oben am Bild, auf jedem Bildschirm, und sie verschwindet nach fünf Sekunden von allein.',
        ],
      },
    ],
  },
  {
    version: '1.4',
    groups: [
      {
        title: 'Behoben',
        items: [
          'Bei Gnadenlos gab es die 250 Punkte fürs Ausschalten nur über die Farbroulette. Wer jemanden mit einem gestapelten Zieh-Stapel über die 25-Karten-Grenze trieb — der häufigste Weg —, ging leer aus: die App suchte den Verursacher an einer Stelle, die es bei Gnadenlos gar nicht gibt. Jetzt merkt sich der Tisch, wer die anliegende Strafe gelegt hat.',
        ],
      },
    ],
  },
  {
    version: '1.3',
    groups: [
      {
        title: 'Behoben',
        items: [
          '„Letzte Karte!“ galt bisher die ganze Runde lang. Wer einmal gerufen hatte, war nie wieder zu erwischen — auch nicht, wenn er zwischendurch Karten nachziehen musste und später wieder auf eine Karte herunterspielte, ohne noch einmal zu rufen. Jetzt ist die Ansage verbraucht, sobald die Hand wieder wächst, und der Knopf „Letzte Karte!“ kommt zurück.',
        ],
      },
    ],
  },
  {
    version: '1.2',
    groups: [
      {
        title: 'Behoben',
        items: [
          'Wer eine Farbwahl-Ziehkarte legte, zeigte dabei jedem seine ganze Hand. Der Stand vor dem Zug wurde für die Anfechtung gemerkt — und landete mit im Tisch, den alle Geräte lesen. Er blieb auch liegen, wenn gar niemand anfocht. Jetzt behält ihn nur das Gerät des Gastgebers; aufgedeckt wird die Hand erst, wenn wirklich angefochten wird.',
        ],
      },
    ],
  },
  {
    version: '1.1',
    groups: [
      {
        title: 'Behoben',
        items: [
          'Wer „Erwischt!“, „Letzte Karte!“ oder „Anfechten“ im selben Augenblick wie ein anderer tippte, drückte oft ins Leere. Das Gerät des Gastgebers arbeitete immer nur einen Wunsch auf einmal ab und warf jeden weg, der währenddessen ankam — ohne Meldung, ohne dass ihn später noch jemand ansah. Jetzt stellen sich die Wünsche an und werden der Reihe nach abgearbeitet.',
        ],
      },
    ],
  },
  {
    version: '1.0',
    groups: [
      {
        title: 'Worum es geht',
        items: [
          'Ablegespiel für bis zu zehn Spieler an eigenen Handys, verbunden über einen sechsstelligen Raum-Code',
          'Drei Spielarten in einer App: Klassisch, Wende und Gnadenlos — der Eröffner wählt vor der Partie',
          'Bis zu fünf KI-Mitspieler mit erkennbaren Spielweisen, damit es auch zu zweit oder allein losgehen kann',
          'Kein Vereinskonto nötig: die Anmeldung ist anonym, gespeichert wird nur der selbst gewählte Anzeigename',
        ],
      },
      {
        title: 'Die drei Spielarten',
        items: [
          'Klassisch: 108 Karten, vier Farben, Null bis Neun, dazu Aussetzen, Richtungswechsel und Zwei ziehen',
          'Wende: 112 doppelseitige Karten. Eine Wendekarte dreht das ganze Spiel auf die dunkle Seite — andere Farben, Fünf ziehen statt Eins, und die eigene Hand ändert sich mit',
          'Gnadenlos: 168 Karten mit Vier, Sechs und Zehn ziehen. Wer nichts legen kann, zieht bis es passt. Bei 25 Karten auf der Hand ist man raus, gespielt wird bis nur einer steht',
        ],
      },
      {
        title: 'Regeln, die mitgebaut sind',
        items: [
          'Zieh-Karten lassen sich stapeln: eine gleich hohe oder höhere reicht die ganze Strafe weiter',
          'Wer eine Karte zieht und sie passt, darf sie sofort legen',
          'Bei der vorletzten Karte auf „Letzte Karte!“ drücken — wer es vergisst, kann von jedem anderen erwischt werden und zieht zwei nach',
          'Farbwahl-Ziehkarten lassen sich anfechten. Die Hand des Legers wird dabei für alle kurz aufgedeckt, damit das Urteil nachvollziehbar ist',
          'Zu zweit wirkt der Richtungswechsel wie Aussetzen',
        ],
      },
      {
        title: 'Damit die Partie nicht hängen bleibt',
        items: [
          'Bedenkzeit je Zug einstellbar (30, 60 oder 120 Sekunden, oder ganz aus)',
          'Läuft sie ab, wird für den Trödler gezogen und weitergeschaltet',
          'Wer dreimal hintereinander verpasst, wird von der KI übernommen — die Partie läuft immer zu Ende',
          'Nach einem Neuladen landet man wieder in der eigenen Partie statt auf dem Startbildschirm',
        ],
      },
      {
        title: 'Länge',
        items: [
          'Eine Runde für zwischendurch, oder eine Serie bis 500 Punkte (bei Gnadenlos 1000)',
          'Nach jeder Runde steht der Zwischenstand mit allen Punkten',
        ],
      },
      {
        title: 'Daten und Datenschutz',
        items: [
          'Gespeichert werden nur der selbst gewählte Anzeigename und der Spielstand der laufenden Partie; die Anmeldung ist anonym und Ergebnisse werden nicht aufgehoben',
          'Der Info-Bereich nennt offen, dass die Spieldaten über die Echtzeit-Datenbank von Google (Firebase) mit Rechenzentrum in Belgien laufen — mit der Bitte, einen Spitznamen statt des echten Namens einzugeben, wenn man das nicht möchte',
          'Dort stehen auch die Anschrift des Vereins und die Beschwerdestelle',
        ],
      },
    ],
  },
];

/* Gateway-Anbindung: wer in der Toolsübersicht als Administrator angemeldet
   ist, sieht Zusatzfunktionen. Fail-closed — ohne Token oder bei jedem
   Fehler bleibt es verborgen. Dieses Snippet gehört laut CLAUDE.md in jedes
   Spiel des Hubs.
   ⚠️ In diesem Spiel wertet KEINE Ansicht `istAdmin` aus: es gibt nichts
   Administratives zu verbergen — die Kartendecks stehen fest in `karten.js`
   und werden nicht über die Oberfläche gepflegt. Das Snippet steht
   vorgehalten da, damit eine künftige Verwaltungsansicht nicht wieder von
   vorn anfangen muss; wer eine baut, hängt sie an dieses Flag. */
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

const NAME_SCHLUESSEL = 'spiele_letztekarte_name';

/* So lange steht eine Meldung, bevor sie sich selbst wegräumt. */
const MELDUNG_MS = 5000;
let meldungTimer = null;

const app = {
  APP_VERSION: APP_VERSION,
  CHANGELOG: CHANGELOG,

  /* Reine Geräte-Ansichten, solange man in keinem Raum ist. */
  lokal: 'start',           // start | neu | beitreten | info
  vorInfo: 'start',

  name: '',
  codeEingabe: '',
  fehler: null,
  laeuft: false,
  meldung: null,            // Text der schwebenden Meldung, null = keine

  gewaehlt: null,           // Index der angetippten Handkarte
  farbwahlFuer: null,       // Karte, für die gerade eine Farbe zu wählen ist
  frageAussteigen: false,
  aufdeckungGesehen: 0,     // Zugnummer der zuletzt weggeklickten Aufdeckung

  entwurf: {
    modus: 'klassisch',
    botAnzahl: 2,
    zugSekunden: 60,
    serie: false,
  },

  zustand: {
    uid: null, code: null, raum: null, tisch: null, protokoll: [],
    hand: [], istHost: false, fehler: null,
  },

  /* --------------------------------------------------------------------
     Welche Ansicht gilt gerade?
     -------------------------------------------------------------------- */

  ansicht: function () {
    const z = this.zustand;
    if (this.lokal === 'info') return 'info';
    if (!z.raum) return this.lokal;
    if (z.raum.phase === 'lobby') return 'lobby';
    if (z.tisch && z.tisch.phase === 'rundeVorbei') return 'ende';
    if (z.raum.phase === 'laeuft') return 'spiel';
    return 'start';
  },

  geheZu: function (wohin) {
    if (wohin === 'info') this.vorInfo = this.lokal;
    this.lokal = wohin;
    this.fehler = null;
    ui.loeseFokus();
    ui.anfordern();
  },

  geheZurueckVonInfo: function () {
    this.lokal = this.vorInfo || 'start';
    ui.anfordern();
  },

  nameVon: function (uid) {
    const z = this.zustand;
    if (z.raum && z.raum.spieler && z.raum.spieler[uid]) return z.raum.spieler[uid].name;
    for (const b of ((z.raum && z.raum.botListe) || [])) if (b.uid === uid) return b.zeichen + ' ' + b.name;
    if (bots.istBot(uid)) {
      for (let i = 0; i < bots.CHARAKTERE.length; i++) {
        if (bots.uidFuer(i) === uid) return bots.CHARAKTERE[i].zeichen + ' ' + bots.CHARAKTERE[i].name;
      }
    }
    return 'Jemand';
  },

  merkeName: function () {
    try { localStorage.setItem(NAME_SCHLUESSEL, this.name); } catch (f) { /* Privatmodus */ }
  },

  /* --------------------------------------------------------------------
     Raum eröffnen und beitreten
     -------------------------------------------------------------------- */

  eroeffne: function () {
    if (this.laeuft) return;
    this.laeuft = true;
    this.fehler = null;
    const self = this;
    gameService.erstelleRaum(this.name.trim(), this.entwurf)
      .then(function () { self.laeuft = false; ui.anfordern(); })
      .catch(function (f) { self.laeuft = false; self.fehler = f.message; ui.anfordern(); });
  },

  tritteBei: function () {
    if (this.laeuft) return;
    this.laeuft = true;
    this.fehler = null;
    const self = this;
    gameService.betreteRaum(this.codeEingabe, this.name.trim())
      .then(function () { self.laeuft = false; ui.anfordern(); })
      .catch(function (f) { self.laeuft = false; self.fehler = f.message; ui.anfordern(); });
  },

  aendereRegeln: function (teil) {
    const z = this.zustand;
    const jetzt = (z.raum && z.raum.regeln) || this.entwurf;
    const neu = {
      modus: jetzt.modus, botAnzahl: jetzt.botAnzahl,
      zugSekunden: jetzt.zugSekunden, serie: jetzt.serie,
    };
    for (const k in teil) neu[k] = teil[k];
    gameService.setzeRegeln(neu);
  },

  steigeAus: function () {
    const self = this;
    gameService.verlasse().then(function () {
      self.lokal = 'start';
      self.gewaehlt = null;
      self.farbwahlFuer = null;
      ui.anfordern();
    });
  },

  /* --------------------------------------------------------------------
     Züge
     --------------------------------------------------------------------
     Jeder Zug trägt die Zugnummer mit, auf die er sich bezieht. Kommt er
     verspätet an — Funkloch, doppelter Tipper — verwirft ihn der Gastgeber,
     statt ihn auf einen Tisch anzuwenden, den der Spieler nie gesehen hat. */

  zugNr: function () {
    return this.zustand.tisch ? this.zustand.tisch.zugNr : -1;
  },

  legeGewaehlte: function () {
    const z = this.zustand;
    const t = z.tisch;
    if (!t || this.gewaehlt === null) return;
    const karte = z.hand[this.gewaehlt];
    if (!karte) { this.gewaehlt = null; return; }
    if (regeln.dran({ tisch: t }) !== z.uid) return;
    if (!regeln.passt(t, karte)) return;

    const teil = karten.teile(karte, t.dunkel);
    if (karten.brauchtFarbe(teil.art)) {
      /* Erst die Farbe, dann der Zug — sonst müsste der Gastgeber raten. */
      this.farbwahlFuer = karte;
      ui.anfordern();
      return;
    }
    this.schickeLegen(karte, null);
  },

  bestaetigeFarbe: function (farbe) {
    const karte = this.farbwahlFuer;
    this.farbwahlFuer = null;
    if (karte) this.schickeLegen(karte, farbe);
  },

  schickeLegen: function (karte, farbe) {
    const z = this.zustand;
    /* "Letzte Karte" wird automatisch mitgeschickt, wenn der Spieler den
       Knopf schon gedrückt hatte — er soll nicht in derselben Sekunde
       zweimal tippen müssen. */
    const schonGesagt = !!(z.tisch && z.tisch.uno && z.tisch.uno[z.uid]);
    this.gewaehlt = null;
    gameService.sendeZug({
      art: 'legen', karte: karte, farbe: farbe,
      sagtUno: schonGesagt, zugNr: this.zugNr(),
    }).catch(this.zeigeFehler);
    ui.anfordern();
  },

  ziehe: function () {
    this.gewaehlt = null;
    gameService.sendeZug({ art: 'ziehen', zugNr: this.zugNr() }).catch(this.zeigeFehler);
    ui.anfordern();
  },

  passe: function () {
    this.gewaehlt = null;
    gameService.sendeZug({ art: 'passen', zugNr: this.zugNr() }).catch(this.zeigeFehler);
    ui.anfordern();
  },

  rufeUno: function () {
    gameService.sendeZug({ art: 'uno' }).catch(this.zeigeFehler);
    ui.anfordern();
  },

  melde: function (ziel) {
    gameService.sendeZug({ art: 'melden', ziel: ziel }).catch(this.zeigeFehler);
    ui.anfordern();
  },

  fechteAn: function () {
    gameService.sendeZug({ art: 'anfechten' }).catch(this.zeigeFehler);
    ui.anfordern();
  },

  schliesseAufdeckung: function () {
    const t = this.zustand.tisch;
    this.aufdeckungGesehen = t ? t.zugNr : 0;
    ui.anfordern();
  },

  zeigeFehler: function (f) {
    app.fehler = f && f.message ? f.message : String(f);
    app.zeigeMeldung(app.fehler);
    ui.anfordern();
  },

  /**
   * Eine Meldung, die über allem liegt und von selbst wieder verschwindet.
   *
   * ⚠️ Ohne sie endeten beide Fehlerwege im Nichts: der Zustandsfehler des
   * Gastgebers (`z.fehler`, unter anderem „Speichern fehlgeschlagen" —
   * genau der Schreibvorgang, der Tisch und Hände veröffentlicht) wurde
   * nirgends gelesen, und `app.fehler` wird nur auf „Neue Partie" und
   * „Beitreten" gezeichnet. Brach beim Gastgeber das Veröffentlichen ab,
   * stand die Partie für alle still, und niemand bekam einen Hinweis —
   * nicht einmal er selbst.
   */
  zeigeMeldung: function (text) {
    const t = text && text.message ? text.message : String(text || '');
    if (!t) return;
    app.meldung = t;
    clearTimeout(meldungTimer);
    meldungTimer = setTimeout(function () { app.meldung = null; ui.anfordern(); }, MELDUNG_MS);
    ui.anfordern();
  },
};

/* ==========================================================================
   Die Szene
   ========================================================================== */

function szene() {
  const ctx = ui.ctx;
  ctx.fillStyle = ui.F.hintergrund;
  ctx.fillRect(0, 0, ui.breite, ui.hoehe);

  ui.beginneKasten({ x: 0, y: 0, b: ui.breite, h: ui.hoehe }, 0);

  const ansicht = app.ansicht();
  switch (ansicht) {
    case 'neu':       bildschirme.neu(app); break;
    case 'beitreten': bildschirme.beitreten(app); break;
    case 'info':      bildschirme.info(app); break;
    case 'lobby':     bildschirme.lobby(app); break;
    case 'spiel':     bildschirme.spiel(app); break;
    case 'ende':      bildschirme.ende(app); break;
    default:          bildschirme.start(app); break;
  }

  /* Überlagerungen, von der harmlosesten zur wichtigsten: eine Rückfrage
     zum Aussteigen muss über allem liegen. */
  const t = app.zustand.tisch;
  if (ansicht === 'spiel' && t && t.aufdeckung && t.zugNr > app.aufdeckungGesehen) {
    bildschirme.aufdeckung(app);
  }
  if (app.farbwahlFuer) bildschirme.farbwahl(app);
  if (app.frageAussteigen) bildschirme.aussteigenFrage(app);

  ui.zeichneOffeneListen();
  ui.beendeKasten();

  /* Die schwebende Meldung liegt über allem — auch über einer Aufdeckung
     oder der Aussteigen-Frage. Auf „Neue Partie" und „Beitreten" steht der
     Text schon im Formular, dort wäre sie doppelt. */
  if (app.meldung && ansicht !== 'neu' && ansicht !== 'beitreten') zeichneMeldung(app.meldung);

  /* ⚠️ NACH JEDEM TIPPER EIN WEITERES BILD.
     Im unmittelbaren Modus wird eine Karte gezeichnet, BEVOR geprüft wird,
     ob sie getroffen wurde. Was ein Klick am Zustand ändert — eine
     angehobene Karte, ein gewählter Modus — ist deshalb erst im nächsten
     Bild zu sehen. `bild()` fordert von sich aus keins an (nur im
     Dauerlauf), und so blieb die Auswahl hängen, bis zufällig etwas anderes
     ein Neuzeichnen auslöste: ein Firebase-Update, ein Bot-Zug, der nächste
     Tipper. Genau das war die Meldung "es dauert recht lang, bis die Karte
     ausgewählt ist" — ohne Bots am Tisch konnte es beliebig lange dauern.
     Diese eine Zeile deckt jede Klickstelle ab, auch künftige; ein
     `ui.anfordern()` je Bedienelement wäre eine Liste, die man vergisst. */
  if (ui.zeiger.losgelassen) ui.anfordern();
}

/**
 * Zeichnet die schwebende Meldung oben am Bild.
 * Bewusst ohne Bedienelement: sie ist nicht anzutippen, sondern geht von
 * selbst weg — ein Knopf mitten im Spiel wäre ein Tippziel, das man beim
 * Kartenlegen versehentlich trifft.
 */
function zeichneMeldung(text) {
  const rand = 12;
  const maxB = Math.min(ui.breite - rand * 2, 460);
  const x = (ui.breite - maxB) / 2;
  const zeilen = ui.umbrich(text, maxB - 24, 13, 'halb');
  const h = 14 + zeilen.length * 18;
  const y = 10;

  ui.schatten(14);
  ui.fuelleRund(x, y, maxB, h, 10, ui.F.gefahr);
  ui.keinSchatten();
  for (let i = 0; i < zeilen.length; i++) {
    ui.schreibe(zeilen[i], x + maxB / 2, y + 7 + 9 + i * 18, {
      groesse: 13, fett: 'halb', farbe: '#fff', ausrichtung: 'center',
    });
  }
}

/* ==========================================================================
   Start
   ========================================================================== */

(function () {
  try { app.name = localStorage.getItem(NAME_SCHLUESSEL) || ''; } catch (f) { /* Privatmodus */ }
  pruefeAdminStatus();

  ui.starte(
    document.getElementById('buehne'),
    document.getElementById('tastatur-proxy'),
    szene
  );

  gameService.onZustandsAenderung(function (z) {
    const vorher = app.zustand.tisch ? app.zustand.tisch.zugNr : -1;
    app.zustand = z;

    /* Der Gastgeber meldet hier, wenn etwas schiefgegangen ist —
       „Speichern fehlgeschlagen", „Verbindung zum Raum verloren". Das Feld
       wurde bis 05.09.2026 nirgends gelesen. */
    if (z.fehler) app.zeigeMeldung(z.fehler);

    /* Nach jedem fremden Zug ist die eigene Auswahl hinfällig: die Karte
       liegt jetzt an einer anderen Stelle der Hand, oder es sind Strafkarten
       dazugekommen. Ohne das würde der zweite Tipper eine andere Karte
       legen als die, die angehoben war. */
    if (z.tisch && z.tisch.zugNr !== vorher) app.gewaehlt = null;
    if (app.gewaehlt !== null && app.gewaehlt >= (z.hand || []).length) app.gewaehlt = null;

    ui.anfordern();
  });

  gameService.stelleVerbindungWiederHer().catch(function () { /* dann eben Startbildschirm */ });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ohne PWA geht es auch */ });
    });
  }
})();
