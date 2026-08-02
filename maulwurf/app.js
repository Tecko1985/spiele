// Oberfläche, Canvas-Renderer und Steuerung. Redet ausschließlich über die gameService-API
// (game-service.js) mit Firebase und über karte.js/aufgaben.js mit Spielgeometrie bzw.
// Minispielen.

// Die KÜRZERE Bildschirmachse zeigt immer diesen Weltausschnitt. Eine feste Weltbreite (so
// war es vorher) funktioniert nur im Hochformat: quer gehalten würde sie oben und unten
// abschneiden, und der Sichtkreis passte nicht mehr aufs Bild. Über die kurze Achse gerechnet
// sieht man im Querformat mehr nach links und rechts – nie weniger als den vollen Sichtkreis.
// Der Wert muss über dem größten Sichtdurchmesser liegen (2 × SICHT_MAULWURF = 840 … hier
// bewusst knapp darunter, damit der Nebel am Rand noch sichtbar ausblendet statt abgeschnitten
// zu wirken) und ist mit dem Umbau auf das Original-Layout von 620 mitgewachsen.
const SICHT_KURZE_ACHSE = 893;

// Die Palette der Oberfläche. Nicht `F` wie in den anderen Dateien: app.js läuft im globalen
// Scope, und ein einbuchstabiger globaler Name kollidiert dort früher oder später mit etwas.
const FARBEN = ui.F;

// Bodenfarben der Karte. Türschwellen bekommen bewusst KEINE eigene Farbe, sondern übernehmen
// je Hälfte die der angrenzenden Fläche – sonst stehen sie als helle Klötze in der Landschaft.
const MAUERWERK = "#172136";
const BODEN_GANG = "#243044";
const BODEN_RAUM = "#2c3a52";      // Grundton; jeder Raum tönt ihn in karte.js leicht ein
const BODEN_GESPERRT = "#3a2230";
const WANDLINIE = "#48597a";
const TUERZARGE = "#63799e";   // heller als die Wand, damit Türen schon aus der Ferne auffallen
const ZARGE = 15;              // Länge einer Zarge je Seite der Wand, in Weltkoordinaten
const SCHNELL_PHRASEN = [
  "Ich war in der Kabine.",
  "Wo warst du?",
  "Ich hab Aufgaben gemacht.",
  "Das war verdächtig!",
  "Ich bin sauber.",
  "Lasst uns überspringen."
];

let ausstehenderModus = null; // "erstellen" | "beitreten"
let raumcodeEingabe = "";
let letzteZustand = null;
let letztePhase = null;
let letzteMeetingUnterphase = null;
let meineStimme = null;

const tasten = {};
const joystick = { aktiv: false, dx: 0, dy: 0, pointerId: null };
const angezeigtePositionen = {}; // uid -> {x,y}, weich nachgezogene Darstellung

// Der Anzeigename einer Station steht beim Minispiel, nicht bei der Karte: sonst müsste
// derselbe Text an zwei Stellen gepflegt werden und könnte auseinanderlaufen.
function stationName(station) {
  const typ = station && aufgabenModul.AUFGABEN_TYPEN[station.typ];
  return typ ? typ.name : "Aufgabe";
}

function raumNameZu(raumId) {
  const raum = karte.RAEUME.find(r => r.id === raumId);
  return raum ? raum.name : "";
}

// --- Wake Lock: auf ALLEN Geräten, es sind alle durchgehend aktiv ---
let bildschirmWakeLock = null;

async function sichereBildschirmWach() {
  if (!("wakeLock" in navigator) || bildschirmWakeLock) return;
  try {
    bildschirmWakeLock = await navigator.wakeLock.request("screen");
    bildschirmWakeLock.addEventListener("release", () => { bildschirmWakeLock = null; });
  } catch (e) {
    // unkritisch, z.B. wenn der Tab gerade nicht sichtbar ist
  }
}

function gibBildschirmFrei() {
  if (bildschirmWakeLock) {
    bildschirmWakeLock.release().catch(() => {});
    bildschirmWakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && gameService.getZustand().phase !== "start") sichereBildschirmWach();
});

// ============================================================
// Vollbild und Querformat
// ============================================================
//
// Gespielt wird quer und formatfüllend. Dafür zwei Wege, weil kein einzelner überall
// funktioniert: die Fullscreen-API (Android, Desktop) und – wenn die nicht greift, etwa in
// Safari auf dem iPhone – ein Layout, das Kopfzeile und Reiter im Spiel ausblendet und den
// Canvas über den ganzen Viewport zieht. Die Orientierungssperre gibt es nur im Vollbild und
// längst nicht auf jedem Gerät; schlägt sie fehl, bleibt der Hinweis "quer halten" als
// Rückfallebene, den man wegtippen kann (manche sperren die Drehung am Gerät).

let querformatHinweisWeggetippt = false;

function vollbildAktiv() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function betreteVollbild() {
  const ziel = document.documentElement;
  try {
    if (!vollbildAktiv()) {
      if (ziel.requestFullscreen) await ziel.requestFullscreen({ navigationUI: "hide" });
      else if (ziel.webkitRequestFullscreen) ziel.webkitRequestFullscreen();
    }
  } catch (e) {
    // z.B. iOS Safari: kein Vollbild für beliebige Elemente – das Layout trägt es dann allein
  }
  try {
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape");
  } catch (e) {
    // nicht überall erlaubt – dann übernimmt der Querformat-Hinweis
  }
}

function verlasseVollbild() {
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch (e) { /* unkritisch */ }
  if (!vollbildAktiv()) return;
  if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}

// Der Querformat-Hinweis ist keine eigene Ebene im Dokument mehr, sondern ein
// gezeichneter Dialog. Hier steht nur noch, OB er faellig ist.
function brauchtQuerformatHinweis() {
  const zustand = gameService.getZustand();
  const imSpiel = zustand.phase === "laeuft" && !zustand.meeting;
  const hochkant = ui.hoehe > ui.breite * 1.05;
  return imSpiel && hochkant && !querformatHinweisWeggetippt;
}

document.addEventListener("fullscreenchange", () => ui.passeGroesseAn());
document.addEventListener("webkitfullscreenchange", () => ui.passeGroesseAn());

// ============================================================
// Canvas
// ============================================================

// Gezeichnet wird auf die gemeinsame Flaeche aus ui.js — es gibt nur noch EIN
// Canvas fuer das ganze Spiel. `ctx` wird beim Start gesetzt und rechnet in
// CSS-Pixeln; die Geraetepunkte-Umrechnung erledigt ui.js einmal zentral.
let ctx = null;

function sichtweiteFuer(zustand) {
  if (zustand.binGeist) return karte.SICHT_GEIST;
  if (zustand.versteckModus) {
    return zustand.meineRolle === "maulwurf" ? karte.SICHT_VERSTECKEN_FAENGER : karte.SICHT_VERSTECKEN_TEAM;
  }
  if (zustand.meineRolle === "maulwurf") return karte.SICHT_MAULWURF;
  const sab = zustand.sabotage;
  if (sab && sab.typ === "licht") return karte.SICHT_TEAM_DUNKEL;
  return karte.SICHT_TEAM;
}

// Sichtbar ist, was nah genug UND nicht hinter einer Wand ist. Der Abstand wird zuerst
// geprüft, weil er billiger ist als die Strahlabtastung.
function istEinsehbar(mich, punkt, sichtweite, binGeist) {
  if (binGeist) return true; // Geister sehen durch alles hindurch
  if (karte.abstand(punkt.x, punkt.y, mich.x, mich.y) > sichtweite) return false;
  return karte.sichtlinieFrei(mich.x, mich.y, punkt.x, punkt.y);
}

function zeichne(zustand) {
  const mich = zustand.meinePosition || { x: karte.WELT_BREITE / 2, y: karte.WELT_HOEHE / 2 };
  const skala = Math.min(ui.breite, ui.hoehe) / SICHT_KURZE_ACHSE;
  const versatzX = ui.breite / 2 - mich.x * skala;
  const versatzY = ui.hoehe / 2 - mich.y * skala;

  // Das Sichtfeld wird einmal pro Bild bestimmt und danach für alles benutzt: Figuren,
  // Leichen, Alibi-Spuren und die Abdunklung. Für Geister entfällt es — sie sehen ohnehin
  // alles, und ein Polygon mit Radius SICHT_GEIST wäre nur Rechenarbeit ohne Wirkung.
  const sichtweite = sichtweiteFuer(zustand);
  const sichtfeld = zustand.binGeist ? null : karte.sichtPolygon(mich.x, mich.y, sichtweite);

  const wx = x => x * skala + versatzX;
  const wy = y => y * skala + versatzY;

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, ui.breite, ui.hoehe);

  // Mauerwerk als Untergrund, darauf die Gänge, dann die Räume mit ihrer Umrandung, dann die
  // Türschwellen: die Schwellen liegen bewusst ÜBER der Raumlinie und stanzen so die Öffnung
  // in die gezeichnete Wand.
  ctx.fillStyle = MAUERWERK;
  ctx.fillRect(wx(karte.GEBAEUDE.x), wy(karte.GEBAEUDE.y), karte.GEBAEUDE.w * skala, karte.GEBAEUDE.h * skala);

  ctx.fillStyle = BODEN_GANG;
  karte.KORRIDORE.forEach(k => ctx.fillRect(wx(k.x), wy(k.y), k.w * skala, k.h * skala));

  const jetzt = zustand.jetzt;
  const istGesperrt = raum => (zustand.tueren || {})[raum.id] > jetzt;
  karte.RAEUME.forEach(r => {
    const gesperrt = istGesperrt(r);
    // Jeder Raum tönt den Boden leicht ein (karte.js). Gesperrt schlägt die Tönung: dass eine
    // Tür zu ist, muss auf den ersten Blick stärker sprechen als die Frage, wo man steht.
    ctx.fillStyle = gesperrt ? BODEN_GESPERRT : (r.farbe || BODEN_RAUM);
    ctx.fillRect(wx(r.x), wy(r.y), r.w * skala, r.h * skala);
    ctx.strokeStyle = gesperrt ? FARBEN.gefahr : WANDLINIE;
    ctx.lineWidth = Math.max(2.5 * skala, 2);
    ctx.strokeRect(wx(r.x), wy(r.y), r.w * skala, r.h * skala);
  });

  // Türschwellen. Jede Hälfte bekommt die Farbe der Fläche, in die sie ragt — eine eigene,
  // hellere Türfarbe hatte sich als leuchtender Klotz beidseits der Wand abgezeichnet statt
  // wie ein Durchgang auszusehen (gemeldet 2026-07-26). Sichtbar bleibt nur die Lücke in der
  // Wandlinie, dazu zwei kurze Pfosten, damit eine Tür auch aus der Ferne als solche auffällt.
  karte.TUEREN.forEach(t => {
    const waagerecht = t.achse === "h";
    const mx = t.x + t.w / 2;
    const my = t.y + t.h / 2;

    // Die Türmitte liegt konstruktionsbedingt genau auf einer Raumkante. Eine kurze Probe zu
    // beiden Seiten sagt daher, welche Hälfte im Raum liegt — ganz ohne Annahme darüber, wie
    // dick die Wand an dieser Stelle ist.
    const raumSeiteA = karte.raumAn(waagerecht ? mx - 4 : mx, waagerecht ? my : my - 4);
    const raum = raumSeiteA || karte.raumAn(waagerecht ? mx + 4 : mx, waagerecht ? my : my + 4);
    const raumfarbe = raum && istGesperrt(raum) ? BODEN_GESPERRT : ((raum && raum.farbe) || BODEN_RAUM);
    const farbeA = raumSeiteA ? raumfarbe : BODEN_GANG;
    const farbeB = raumSeiteA ? BODEN_GANG : raumfarbe;

    ctx.fillStyle = farbeA;
    if (waagerecht) ctx.fillRect(wx(t.x), wy(t.y), (t.w / 2) * skala, t.h * skala);
    else ctx.fillRect(wx(t.x), wy(t.y), t.w * skala, (t.h / 2) * skala);
    ctx.fillStyle = farbeB;
    if (waagerecht) ctx.fillRect(wx(mx), wy(t.y), (t.w / 2) * skala, t.h * skala);
    else ctx.fillRect(wx(t.x), wy(my), t.w * skala, (t.h / 2) * skala);

    // Zargen quer zur Wand an beiden Rändern der Öffnung. In der Wandlinie liegend wären sie
    // von ihr nicht zu unterscheiden — quer gestellt lesen sie sich als Durchgang.
    ctx.strokeStyle = raum && istGesperrt(raum) ? FARBEN.gefahr : TUERZARGE;
    ctx.lineWidth = Math.max(2.5 * skala, 2);
    ctx.beginPath();
    if (waagerecht) {
      ctx.moveTo(wx(mx - ZARGE), wy(t.y));         ctx.lineTo(wx(mx + ZARGE), wy(t.y));
      ctx.moveTo(wx(mx - ZARGE), wy(t.y + t.h));   ctx.lineTo(wx(mx + ZARGE), wy(t.y + t.h));
    } else {
      ctx.moveTo(wx(t.x), wy(my - ZARGE));         ctx.lineTo(wx(t.x), wy(my + ZARGE));
      ctx.moveTo(wx(t.x + t.w), wy(my - ZARGE));   ctx.lineTo(wx(t.x + t.w), wy(my + ZARGE));
    }
    ctx.stroke();
  });

  // Raumnamen erst jetzt: bei Türen in der oberen Wand hat die Schwelle den Schriftzug sonst
  // mittendrin ausgestanzt ("Ge…raum"). Der weiche Schatten hält die Schrift auch dort lesbar,
  // wo der Nebel schon abdunkelt; die Untergrenze der Schriftgröße rettet kleine Displays.
  ctx.font = `600 ${Math.max(Math.round(32 * skala), 13)}px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(226,232,240,0.6)";
  ctx.shadowColor = "rgba(3,7,15,0.85)";
  ctx.shadowBlur = Math.max(5 * skala, 3);
  karte.RAEUME.forEach(r => ctx.fillText(r.name, wx(r.x + r.w / 2), wy(r.y + 40)));
  ctx.shadowBlur = 0;

  // Notfallknopf — im Verstecken-Modus gibt es keine Besprechung, also auch keinen Knopf
  if (!zustand.versteckModus) zeichneMarker(wx(karte.NOTFALLKNOPF.x), wy(karte.NOTFALLKNOPF.y), skala, FARBEN.gefahr, "📣");

  // Reparaturstellen nur, solange die passende Sabotage läuft
  const sab = zustand.sabotage;
  if (sab && sab.typ === "licht") zeichneMarker(wx(karte.SICHERUNGSKASTEN.x), wy(karte.SICHERUNGSKASTEN.y), skala, FARBEN.warnung, "💡");
  if (sab && sab.typ === "funk") zeichneMarker(wx(karte.FUNKPULT.x), wy(karte.FUNKPULT.y), skala, FARBEN.warnung, "📻");
  if (sab && sab.typ === "reaktor") {
    zeichneMarker(wx(karte.KUEHLUNG_A.x), wy(karte.KUEHLUNG_A.y), skala, FARBEN.warnung, "🔧");
    zeichneMarker(wx(karte.KUEHLUNG_B.x), wy(karte.KUEHLUNG_B.y), skala, FARBEN.warnung, "🔧");
  }

  // Kamerapult
  zeichneMarker(wx(karte.KAMERAPULT.x), wy(karte.KAMERAPULT.y), skala, "#64748b", "📹");

  // Die vier Kamerastandorte stehen dauerhaft auf der Karte — man soll wissen, wo man gefilmt
  // wird. Das Gegengewicht zum Zusehen: sieht gerade jemand hin, blinken sie rot.
  //
  // Sichtbar ist das nur für den, der den Standort im eigenen Sichtfeld hat — dadurch bleibt
  // es eine Beobachtung vor Ort und keine kostenlose Warnung an alle. Ohne dieses Signal wäre
  // Zusehen risikofrei und die Loge der beste Platz im Spiel.
  const kameraBlinkt = zustand.kameraBeobachtet && Math.floor(jetzt / 450) % 2 === 0;
  karte.KAMERAS.forEach(k => {
    if (!istEinsehbar(mich, k, sichtweite, zustand.binGeist)) return;
    zeichneMarker(wx(k.x), wy(k.y), skala, kameraBlinkt ? FARBEN.gefahr : "#475569", kameraBlinkt ? "🔴" : "📹");
  });

  // Eigene Aufgabenstationen (nur die eigenen — fremde Aufgaben sieht niemand)
  zustand.meineAufgaben.forEach(a => {
    if (!a.station) return;
    // Gesperrte Kettenteile bekommen ein eigenes Zeichen: sonst liefe man zu einem grünen
    // Stern, der sich nicht öffnen lässt, und hielte das für einen Fehler.
    const farbe = a.erledigt ? "#4b5563" : (a.gesperrt ? FARBEN.gedaempft : FARBEN.erfolg);
    const zeichen = a.erledigt ? "✓" : (a.gesperrt ? "🔒" : "★");
    zeichneMarker(wx(a.station.x), wy(a.station.y), skala, farbe, zeichen);
  });

  // Sichtbare Aufgaben: die Spur, die jemand beim Arbeiten hinterlässt. Anders als die eigenen
  // Aufgabenmarker sehen das ALLE — deshalb taugt es als Alibi. Ein Alibi durch die Wand wäre
  // keins, deshalb dieselbe Sichtprüfung wie bei den Figuren.
  Object.keys(zustand.visuell || {}).forEach(stationId => {
    const spur = zustand.visuell[stationId];
    const station = karte.stationNachId(stationId);
    if (!station || !spur || spur.bis <= jetzt) return;
    if (!istEinsehbar(mich, station, sichtweite, zustand.binGeist)) return;
    zeichneArbeitsspur(wx(station.x), wy(station.y), skala, spur, (spur.bis - jetzt) / gameService.SICHTBARE_WIRKUNG_MS);
  });

  // Abkürzungen sehen nur, wer sie auch benutzen darf. Jedes Netz hat seine eigene Farbe —
  // die Netze sind voneinander getrennt, und ohne Farbe wüsste man nie, welche Enden
  // zusammengehören. Auf einer Karte mit sechs Netzen wäre das reines Auswendiglernen.
  if (darfTunnelSehen(zustand)) {
    karte.TUNNEL.forEach(t => {
      t.enden.forEach(e => zeichneMarker(wx(e.x), wy(e.y), skala, t.farbe, "↧"));
    });
  }

  // Leichen — auch die nur, wenn nichts dazwischensteht
  Object.keys(zustand.leichen || {}).forEach(uid => {
    const leiche = zustand.leichen[uid];
    if (!istEinsehbar(mich, leiche, sichtweite, zustand.binGeist)) return;
    ctx.fillStyle = leiche.farbe || FARBEN.gefahr;
    ctx.beginPath();
    ctx.ellipse(wx(leiche.x), wy(leiche.y), 19 * skala, 12 * skala, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(23 * skala)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("✖", wx(leiche.x), wy(leiche.y) + 7 * skala);
  });

  // Mitspielende. Die eigene Figur kommt aus der lokalen Position (flüssig), fremde aus den
  // interpolierten Werten — die Rohdaten treffen nur mit 5 Hz ein und würden sonst hüpfen.
  zustand.spieler.forEach(s => {
    const eigenerZug = s.id === zustand.eigenerSpielerId;
    const pos = eigenerZug ? mich : angezeigtePositionen[s.id];
    if (!pos || s.lebt === false) return;
    // Wer im Schacht sitzt, ist für alle anderen weg — auch für Mitmaulwürfe und für Geister.
    // Sich selbst sieht man weiterhin, sonst wüsste man nicht, wo man gerade steckt.
    if (!eigenerZug && imSchachtLaut(zustand, s.id)) return;
    if (!eigenerZug && !istEinsehbar(mich, pos, sichtweite, zustand.binGeist)) return;
    zeichneFigur(wx(pos.x), wy(pos.y), skala, s, zustand);
  });

  // Geister sehen einander, Lebende sehen sie nicht
  if (zustand.binGeist) {
    zustand.spieler.forEach(s => {
      const pos = s.id === zustand.eigenerSpielerId ? mich : angezeigtePositionen[s.id];
      if (!pos || s.lebt !== false) return;
      ctx.globalAlpha = 0.45;
      zeichneFigur(wx(pos.x), wy(pos.y), skala, s, zustand);
      ctx.globalAlpha = 1;
    });
  }

  if (sichtfeld) zeichneSichtfeld(wx, wy, wx(mich.x), wy(mich.y), sichtweite * skala, sichtfeld);
}

function zeichneMarker(x, y, skala, farbe, zeichen) {
  ctx.fillStyle = farbe;
  ctx.beginPath();
  ctx.arc(x, y, 17 * skala, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(21 * skala)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(zeichen, x, y + 7 * skala);
}

// Arbeitsspur einer sichtbaren Aufgabe: ein Ring, der nach außen läuft und dabei verblasst,
// dazu Zeichen und Name. Der Name gehört dazu — ohne ihn wüsste man zwar, dass hier gearbeitet
// wurde, aber nicht von wem, und genau das ist der Punkt eines Alibis.
function zeichneArbeitsspur(x, y, skala, spur, anteilUebrig) {
  const puls = 1 - anteilUebrig;                      // 0 → frisch, 1 → gleich vorbei
  const radius = (29 + 34 * (puls % 0.34) / 0.34) * skala;

  ctx.save();
  ctx.globalAlpha = 0.25 + 0.55 * anteilUebrig;
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(3 * skala, 2);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.45 + 0.45 * anteilUebrig;
  ctx.fillStyle = "#0ea5e9";
  ctx.beginPath();
  ctx.arc(x, y, 21 * skala, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = `${Math.round(24 * skala)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(spur.zeichen || "🛠️", x, y + 7 * skala);

  // Der Name sitzt bewusst weit unterhalb: wer gerade gearbeitet hat, steht meist noch auf der
  // Station, und dessen eigener Name schwebt über der Figur. Zu dicht beieinander überlagern
  // sich beide zu einem unlesbaren Klumpen.
  if (spur.name) {
    ctx.font = `600 ${Math.max(Math.round(21 * skala), 11)}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillStyle = "#bae6fd";
    ctx.shadowColor = "rgba(3,7,15,0.9)";
    ctx.shadowBlur = Math.max(5 * skala, 4);
    ctx.fillText(spur.name.slice(0, 12), x, y + 60 * skala);
    ctx.shadowBlur = 0;
  }
}

// Wie sieht diese Figur für MICH aus? Gestaltwandler: für alle anderen sieht er aus wie sein
// Ziel. Sich selbst und den eigenen Mitmaulwürfen zeigt er sich unverändert — sonst würden sie
// ihn verlieren, und der Gestaltwandler selbst wüsste nicht mehr, welche Figur er steuert.
//
// **Diese Regel gehört an EINE Stelle.** Karte und Kamerabild zeigen beide Namen und Farbe;
// würde nur die Karte die Verkleidung berücksichtigen, verriete ein Blick auf die Kameras den
// Gestaltwandler und die Rolle wäre wertlos.
function sichtbareIdentitaet(spieler, zustand) {
  const istIch = spieler.id === zustand.eigenerSpielerId;
  const istMitMaulwurf = zustand.meineRolle === "maulwurf" && zustand.maulwurfTeam.indexOf(spieler.id) !== -1;
  const verkleidung = (zustand.verkleidungen || {})[spieler.id];
  if (verkleidung && verkleidung.bis > zustand.jetzt && !istIch && !istMitMaulwurf) {
    const vorbild = zustand.spieler.find(s => s.id === verkleidung.alsUid);
    if (vorbild) return { id: spieler.id, name: vorbild.name, farbe: vorbild.farbe, lebt: spieler.lebt };
  }
  return spieler;
}

function zeichneFigur(x, y, skala, spieler, zustand) {
  const istIch = spieler.id === zustand.eigenerSpielerId;
  const istMitMaulwurf = zustand.meineRolle === "maulwurf" && zustand.maulwurfTeam.indexOf(spieler.id) !== -1;
  spieler = sichtbareIdentitaet(spieler, zustand);

  // Der Fänger im Verstecken-Modus ist für alle als solcher erkennbar — daran hängt der
  // ganze Modus. Der Ring liegt außen um die Figur, damit er auch bei fremder Farbe auffällt.
  const istFaenger = zustand.versteckModus && spieler.id === zustand.faengerUid;
  if (istFaenger) {
    ctx.strokeStyle = FARBEN.gefahr;
    ctx.lineWidth = Math.max(3.5 * skala, 2.5);
    ctx.beginPath();
    ctx.arc(x, y, (karte.SPIELER_RADIUS + 8) * skala, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = spieler.farbe || FARBEN.randStark;
  ctx.beginPath();
  ctx.arc(x, y, karte.SPIELER_RADIUS * skala, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2.5 * skala, 2);
  ctx.strokeStyle = istIch ? "#ffffff" : istMitMaulwurf ? FARBEN.gefahr : "rgba(0,0,0,0.35)";
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(24 * skala)}px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText((istFaenger ? "🥅 " : "") + spieler.name.slice(0, 12), x, y - 26 * skala);
}

// Abdunklung außerhalb des Sichtfelds. Zwei Lagen, die sich multiplizieren:
//
// 1. **Wandschatten** — alles außerhalb des Sichtpolygons, aber nur mäßig abgedunkelt. Was
//    hinter einer Wand liegt, bleibt als Raumumriss angedeutet erkennbar. Das ist Absicht:
//    man kennt das Gelände ja, und ohne diese Andeutung verliert man auf einer Karte dieser
//    Größe schlicht die Orientierung. Ausgestanzt wird das Polygon über einen zweiten Pfad
//    im selben fill() mit "evenodd".
// 2. **Entfernung** — ein Radialverlauf über das GANZE Bild, unabhängig von Wänden: innen
//    klar, zum Sichtrand hin dicht. Er liegt bewusst NICHT auf das Polygon geclippt, sonst
//    entstünde an dessen Grenze eine harte Kante mitten im Nichts.
//
// Zusammen ergibt das vier Abstufungen: im Sichtfeld nah = klar, im Sichtfeld weit = dämmrig,
// hinter der Wand nah = angedeutet, hinter der Wand weit = praktisch schwarz.
//
// Wichtig: **Figuren, Leichen und Alibi-Spuren hängen NICHT an dieser Abdunklung.** Sie werden
// schon gar nicht erst gezeichnet, wenn die Sichtlinie blockiert ist (siehe istEinsehbar). Der
// weiche Wandschatten darf also beliebig hell werden, ohne zu verraten, wo jemand steht — wer
// hinter einer Wand ist, bleibt unsichtbar, auch wenn man den Raum dahinter erahnt.
const SCHATTEN_HINTER_WAND = "rgba(5,10,20,0.58)";
const NEBEL_FERN = "rgba(5,10,20,0.93)";

function zeichneSichtfeld(wx, wy, mitteX, mitteY, radius, polygon) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ui.breite, ui.hoehe);
  ctx.moveTo(wx(polygon[0].x), wy(polygon[0].y));
  for (let i = 1; i < polygon.length; i++) ctx.lineTo(wx(polygon[i].x), wy(polygon[i].y));
  ctx.closePath();
  ctx.fillStyle = SCHATTEN_HINTER_WAND;
  ctx.fill("evenodd");
  ctx.restore();

  const rand = ctx.createRadialGradient(mitteX, mitteY, radius * 0.62, mitteX, mitteY, radius);
  rand.addColorStop(0, "rgba(5,10,20,0)");
  rand.addColorStop(1, NEBEL_FERN);
  ctx.fillStyle = rand;
  ctx.fillRect(0, 0, ui.breite, ui.hoehe);
}

// ============================================================
// Steuerung
// ============================================================

document.addEventListener("keydown", e => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
  tasten[e.key.toLowerCase()] = true;
});
document.addEventListener("keyup", e => { tasten[e.key.toLowerCase()] = false; });

function tastenRichtung() {
  let dx = 0;
  let dy = 0;
  if (tasten["a"] || tasten["arrowleft"]) dx -= 1;
  if (tasten["d"] || tasten["arrowright"]) dx += 1;
  if (tasten["w"] || tasten["arrowup"]) dy -= 1;
  if (tasten["s"] || tasten["arrowdown"]) dy += 1;
  return { dx, dy };
}

// Fremde Positionen treffen nur mit 5 Hz ein. Ohne Nachziehen würden die Figuren sichtbar
// springen — deshalb wird die Darstellung pro Frame an den zuletzt empfangenen Wert
// angenähert, statt ihn hart zu übernehmen.
function interpolierePositionen(zustand, delta) {
  const faktor = Math.min(delta * 12, 1);
  Object.keys(zustand.positionen).forEach(uid => {
    const ziel = zustand.positionen[uid];
    if (!ziel) return;
    const aktuell = angezeigtePositionen[uid];
    if (!aktuell) {
      angezeigtePositionen[uid] = { x: ziel.x, y: ziel.y };
      return;
    }
    // Bei einem Sprung (Abkürzung, Positions-Reset nach dem Meeting) nicht hinterherkriechen.
    if (karte.abstand(aktuell.x, aktuell.y, ziel.x, ziel.y) > 249) {
      aktuell.x = ziel.x;
      aktuell.y = ziel.y;
      return;
    }
    aktuell.x += (ziel.x - aktuell.x) * faktor;
    aktuell.y += (ziel.y - aktuell.y) * faktor;
  });
  Object.keys(angezeigtePositionen).forEach(uid => {
    if (!zustand.positionen[uid]) delete angezeigtePositionen[uid];
  });
}

// Wird aus der Zeichenschleife gerufen, solange die Partie laeuft: Eingabe
// auswerten, bewegen, Positionen weich nachziehen. Gezeichnet wird danach von
// spielfeld.js.
function bewegeUndZiehNach(zustand) {
  const delta = Math.min(ui.delta / 1000, 0.1);

  // Waehrend ein Dialog offen ist, wird nicht gelaufen.
  if (!spielfeld.offenerDialog && !zustand.meeting) {
    const taste = tastenRichtung();
    const dx = joystick.dx + taste.dx;
    const dy = joystick.dy + taste.dy;
    if (Math.hypot(dx, dy) > 0.06) {
      gameService.bewege(dx, dy, delta);
      gameService.schreibePosition(false);
    }
  }
  interpolierePositionen(gameService.getZustand(), delta);
}

// ============================================================
// Kontextabhängige Aktionen
// ============================================================

function offeneStationAn(zustand, pos) {
  const offeneIds = zustand.meineAufgaben.filter(a => !a.erledigt).map(a => a.id);
  return karte.stationAn(pos.x, pos.y, offeneIds);
}

function ermittleAktion(zustand) {
  const pos = zustand.meinePosition;
  if (!pos) return null;

  // Geister erledigen ihre Aufgaben weiter. Ohne das wäre der Aufgaben-Sieg ab dem ersten
  // Todesfall unerreichbar: der Balken wird zu Rundenbeginn auf teamAnzahl × Aufgaben pro
  // Person festgelegt und nie wieder gesenkt, die Aufgaben der Toten fehlten also für immer.
  // Alles andere bleibt ihnen verwehrt — melden, Notfallknopf, Reparatur, Tunnel, Foulspiel.
  if (zustand.binGeist) {
    const station = offeneStationAn(zustand, pos);
    return station ? { typ: "aufgabe", station, zeichen: "🛠️", label: stationName(station) } : null;
  }

  const sab = zustand.sabotage;

  if (sab && sab.typ === "licht" &&
      karte.abstand(pos.x, pos.y, karte.SICHERUNGSKASTEN.x, karte.SICHERUNGSKASTEN.y) <= karte.INTERAKTIONS_RADIUS) {
    return { typ: "reparatur-licht", zeichen: "💡", label: "Sicherungskasten" };
  }
  if (sab && sab.typ === "reaktor") {
    if (karte.abstand(pos.x, pos.y, karte.KUEHLUNG_A.x, karte.KUEHLUNG_A.y) <= karte.INTERAKTIONS_RADIUS) {
      return { typ: "reparatur-reaktor", seite: "a", zeichen: "🔧", label: "Kühlventil Reaktor" };
    }
    if (karte.abstand(pos.x, pos.y, karte.KUEHLUNG_B.x, karte.KUEHLUNG_B.y) <= karte.INTERAKTIONS_RADIUS) {
      return { typ: "reparatur-reaktor", seite: "b", zeichen: "🔧", label: "Kühlventil O2" };
    }
  }
  if (sab && sab.typ === "funk" &&
      karte.abstand(pos.x, pos.y, karte.FUNKPULT.x, karte.FUNKPULT.y) <= karte.INTERAKTIONS_RADIUS) {
    return { typ: "reparatur-funk", zeichen: "📻", label: "Funkpult" };
  }
  // Das Kamerapult steht vor den Aufgaben in der Reihenfolge, weil in der Loge ohnehin
  // Stationen liegen — sonst käme man nie an die Kameras heran.
  if (karte.abstand(pos.x, pos.y, karte.KAMERAPULT.x, karte.KAMERAPULT.y) <= karte.INTERAKTIONS_RADIUS) {
    return { typ: "kameras", zeichen: "📹", label: zustand.funkGestoert ? "Kameras (kein Signal)" : "Kameras" };
  }
  if (!zustand.versteckModus && !zustand.meeting && (zustand.eigener.notfallUebrig || 0) > 0 &&
      karte.abstand(pos.x, pos.y, karte.NOTFALLKNOPF.x, karte.NOTFALLKNOPF.y) <= karte.INTERAKTIONS_RADIUS) {
    return { typ: "notfall", zeichen: "📣", label: "Notfallknopf" };
  }

  const station = offeneStationAn(zustand, pos);
  if (station) return { typ: "aufgabe", station, zeichen: "🛠️", label: stationName(station) };

  // Der Ingenieur darf dieselben Abkürzungen nehmen wie die Maulwürfe — das ist der ganze
  // Reiz der Rolle: nützlich, aber wer ihn dabei sieht, hält ihn für einen Maulwurf.
  if (zustand.meineRolle === "maulwurf" || zustand.meineSonderrolle === "ingenieur") {
    const tunnel = karte.tunnelAn(pos.x, pos.y);
    if (tunnel) {
      // Bei zwei Enden steht das Ziel schon im Knopf, bei dreien muss man wählen — dann sagt
      // der Knopf, worauf man sich einlässt, statt einen Namen zu versprechen.
      const label = tunnel.ziele.length === 1
        ? "→ " + tunnel.ziele[0].ort
        : tunnel.ziele.map(z => z.ort).join(" / ");
      return { typ: "tunnel", tunnel: tunnel.tunnel, ziele: tunnel.ziele, zeichen: "↧", label };
    }
  }
  return null;
}

function darfTunnelSehen(zustand) {
  return zustand.meineRolle === "maulwurf" || zustand.meineSonderrolle === "ingenieur";
}

// Sitzt diese Person gerade in einem Schacht? Steht als Flag an ihrer Position — welches Netz
// und welches Ende, erfährt niemand außer ihr selbst.
function imSchachtLaut(zustand, uid) {
  const p = zustand.positionen[uid];
  return !!(p && p.schacht);
}

function findeKillZiel(zustand) {
  if (zustand.meineRolle !== "maulwurf" || zustand.binGeist) return null;
  const pos = zustand.meinePosition;
  if (!pos) return null;
  let bestes = null;
  let besterAbstand = karte.KILL_REICHWEITE;
  zustand.spieler.forEach(s => {
    if (s.id === zustand.eigenerSpielerId || s.lebt === false) return;
    if (zustand.maulwurfTeam.indexOf(s.id) !== -1) return;
    const p = zustand.positionen[s.id];
    if (!p) return;
    const d = karte.abstand(pos.x, pos.y, p.x, p.y);
    // Die Kill-Reichweite (74) ist größer als eine Wand dick ist (35) — ohne Sichtlinie
    // ließe sich quer durch die Wand foulen.
    if (d <= besterAbstand && karte.sichtlinieFrei(pos.x, pos.y, p.x, p.y)) { besterAbstand = d; bestes = s; }
  });
  return bestes;
}

function findeMeldbareLeiche(zustand) {
  if (zustand.binGeist || zustand.versteckModus) return null; // ohne Besprechung nichts zu melden
  const pos = zustand.meinePosition;
  if (!pos) return null;
  const leichen = zustand.leichen || {};
  return Object.keys(leichen).find(uid => {
    const l = leichen[uid];
    return !l.gemeldet && karte.abstand(pos.x, pos.y, l.x, l.y) <= karte.INTERAKTIONS_RADIUS;
  }) || null;
}

// Die Sonderrolle ersetzt die Seitenbezeichnung nicht, sie ergänzt sie — man soll auf einen
// Blick sehen, für welche Seite man spielt, ohne die Sonderrolle erst deuten zu müssen.
function rollenBezeichnung(zustand) {
  const basis = zustand.versteckModus
    ? (zustand.meineRolle === "maulwurf" ? "🥅 Fänger" : zustand.meineRolle === "team" ? "🙈 Versteckt" : "")
    : (zustand.meineRolle === "maulwurf" ? "🕵️ Maulwurf" : zustand.meineRolle === "team" ? "⚽ Team" : "");
  const sonder = zustand.meineSonderrolle && rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
  return sonder ? `${basis} · ${sonder.icon} ${sonder.name}` : basis;
}

function mmss(millis) {
  const rest = Math.max(Math.ceil(millis / 1000), 0);
  return Math.floor(rest / 60) + ":" + String(rest % 60).padStart(2, "0");
}

// Nähe-Anzeige im Verstecken-Modus: der einzige Ersatz für die fehlende Besprechung. Sie sagt
// nur, WIE nah der jeweils andere ist, nie aus welcher Richtung — sonst wäre Verstecken
// sinnlos. Gemessen wird die Luftlinie, bewusst ohne Rücksicht auf Wände: eine Warnung, die
// hinter der Wand verstummt, wiegt in falscher Sicherheit.
function naechsteGegenseite(zustand) {
  const pos = zustand.meinePosition;
  if (!pos || !zustand.faengerUid) return null;
  const binFaenger = zustand.eigenerSpielerId === zustand.faengerUid;
  let bester = Infinity;
  zustand.spieler.forEach(s => {
    if (s.id === zustand.eigenerSpielerId || s.lebt === false) return;
    if (binFaenger ? s.id === zustand.faengerUid : s.id !== zustand.faengerUid) return;
    const p = zustand.positionen[s.id];
    if (p) bester = Math.min(bester, karte.abstand(pos.x, pos.y, p.x, p.y));
  });
  return bester === Infinity ? null : bester;
}

const NAEHE_STUFEN = [
  { bis: 170, text: "🔴 Ganz nah!",  klasse: "naehe-rot" },
  { bis: 340, text: "🟠 In der Nähe", klasse: "naehe-orange" },
  { bis: 600, text: "🟡 Irgendwo da", klasse: "naehe-gelb" }
];

async function fuehreAktionAus() {
  const zustand = gameService.getZustand();
  const aktion = ermittleAktion(zustand);
  if (!aktion) return;

  if (aktion.typ === "tunnel") {
    // **Nur einsteigen, nicht springen.** Wohin es geht, entscheidet man drinnen — dort sieht
    // man an jedem Ende erst die Umgebung, bevor man auftaucht.
    gameService.betreteSchacht();
    return;
  }
  if (aktion.typ === "notfall") {
    const ergebnis = await gameService.drueckeNotfallknopf();
    if (!ergebnis.erfolg && ergebnis.fehler) spielfeld.melde(ergebnis.fehler);
    return;
  }
  if (aktion.typ === "aufgabe") {
    spielfeld.oeffneAufgabe(aktion.station);
    return;
  }
  if (aktion.typ === "reparatur-licht") {
    spielfeld.oeffneReparaturLicht();
    return;
  }
  if (aktion.typ === "reparatur-reaktor") {
    spielfeld.oeffneReparaturKuehlung(aktion.seite);
    return;
  }
  if (aktion.typ === "reparatur-funk") {
    await gameService.repariereFunk();
    return;
  }
  if (aktion.typ === "kameras") {
    spielfeld.oeffneKameras();
  }
}

// ============================================================
// Overlays
// ============================================================

// ---------- Kameras ----------
//
// Bewusst EIGENE, grobe Darstellung statt des Hauptrenderers: erstens muss der geprüfte
// Spielfeld-Code dafür nicht umgebaut werden, zweitens soll ein Kamerabild anders aussehen
// als der eigene Blick — grün, körnig, ohne Beschriftung. Was man sieht, sind Punkte in
// Bewegung, nicht wer sie sind.
//
// Seit dem 2026-07-27 zeigt das Band Namen und Spielerfarben — Michels Vorgabe und näher am
// Original. Die Verkleidung des Gestaltwandlers wird dabei über sichtbareIdentitaet
// mitgeführt, sonst wäre ein Blick aufs Band die einfachste Art ihn zu enttarnen.
//
// Gezeichnet wird seit dem Umbau auf eine Zeichenfläche direkt in ein Rechteck der
// gemeinsamen Leinwand statt in ein eigenes Canvas-Element. Alles innerhalb wird auf das
// Rechteck beschnitten und um dessen Ursprung verschoben, damit der Zeichencode unverändert
// in Bildkoordinaten ab (0,0) rechnen kann.
function zeichneKamerabild(bx, by, b, h, kamera, zustand) {
  const ctx2 = ui.ctx;
  const s = b / kamera.breite;
  const kx = x => (x - kamera.links) * s;
  const ky = y => (y - kamera.oben) * s;

  ctx2.save();
  ctx2.beginPath();
  ctx2.rect(bx, by, b, h);
  ctx2.clip();
  ctx2.translate(bx, by);

  ctx2.fillStyle = "#04120a";
  ctx2.fillRect(0, 0, b, h);

  ctx2.fillStyle = "#0d2a18";
  karte.KORRIDORE.forEach(k => ctx2.fillRect(kx(k.x), ky(k.y), k.w * s, k.h * s));
  ctx2.fillStyle = "#123520";
  karte.RAEUME.forEach(r => ctx2.fillRect(kx(r.x), ky(r.y), r.w * s, r.h * s));
  karte.TUEREN.forEach(t => ctx2.fillRect(kx(t.x), ky(t.y), t.w * s, t.h * s));
  ctx2.strokeStyle = "#1f6b3d";
  ctx2.lineWidth = 1.5;
  karte.RAEUME.forEach(r => ctx2.strokeRect(kx(r.x), ky(r.y), r.w * s, r.h * s));

  // Beschriftung mit dunklem Träger darunter: auf dem grünen Boden wäre weiße Schrift bei
  // manchen Spielerfarben nicht zu lesen.
  const schrift = Math.max(Math.round(22 * s), 10);
  function beschrifte(text, cx, cy) {
    ctx2.font = `bold ${schrift}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx2.textAlign = "center";
    const breite = ctx2.measureText(text).width + 8;
    ctx2.fillStyle = "rgba(2,18,10,0.72)";
    ctx2.fillRect(cx - breite / 2, cy - schrift, breite, schrift + 4);
    ctx2.fillStyle = "#eafff2";
    ctx2.fillText(text, cx, cy);
  }

  // Nur Lebende, und nur wer wirklich im Ausschnitt steht. Geister tauchen nirgends auf —
  // sie könnten sonst durch Wände laufend die halbe Karte ausleuchten.
  //
  // Namen und Spielerfarben wie im Original: die Kamera sagt WER, nicht nur DASS jemand da ist.
  // Die Verkleidung des Gestaltwandlers wird dabei mitgeführt (sichtbareIdentitaet) — sonst
  // wäre ein Blick aufs Band die einfachste Art, ihn zu enttarnen.
  let gesehen = 0;
  zustand.spieler.forEach(sp => {
    if (sp.lebt === false) return;
    const p = sp.id === zustand.eigenerSpielerId ? zustand.meinePosition : angezeigtePositionen[sp.id];
    if (!p || !karte.imKamerabild(kamera, p.x, p.y)) return;
    gesehen++;
    const wie = sichtbareIdentitaet(sp, zustand);
    const r = Math.max(karte.SPIELER_RADIUS * s, 5);
    ctx2.fillStyle = wie.farbe || "#7dfcae";
    ctx2.beginPath();
    ctx2.arc(kx(p.x), ky(p.y), r, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.lineWidth = 1.5;
    ctx2.strokeStyle = "rgba(2,18,10,0.65)";
    ctx2.stroke();
    beschrifte(wie.name.slice(0, 12), kx(p.x), ky(p.y) - r - 3);
  });

  // Leichen sind auch auf dem Band zu sehen — das ist der eigentliche Wert der Kameras.
  // Auch sie in ihrer Farbe und mit Namen: "in der Elektrik liegt Sabine" ist eine ganz
  // andere Meldung als "in der Elektrik liegt jemand".
  Object.keys(zustand.leichen || {}).forEach(uid => {
    const l = zustand.leichen[uid];
    if (!karte.imKamerabild(kamera, l.x, l.y)) return;
    const cx = kx(l.x), cy = ky(l.y), r = Math.max(karte.SPIELER_RADIUS * s, 5);
    ctx2.strokeStyle = l.farbe || FARBEN.gefahr;
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.moveTo(cx - r, cy - r); ctx2.lineTo(cx + r, cy + r);
    ctx2.moveTo(cx + r, cy - r); ctx2.lineTo(cx - r, cy + r);
    ctx2.stroke();
    if (l.name) beschrifte("✖ " + l.name.slice(0, 12), cx, cy - r - 3);
  });

  // Scanzeilen über alles — ohne sie sieht das Bild aus wie eine zweite, bessere Karte.
  // Schwächer als früher (0.22): seit die Namen mit im Bild stehen, fraßen die Balken die
  // Schrift an. Der Röhrencharakter bleibt, die Lesbarkeit gewinnt.
  ctx2.fillStyle = "rgba(0,0,0,0.14)";
  for (let y = 0; y < h; y += 4) ctx2.fillRect(0, y, b, 2);

  ctx2.restore();
  return gesehen;
}

// ============================================================
// Rendering pro Phase
// ============================================================

// Der Dienst meldet jede Zustandsaenderung hierher. Frueher wurde daraufhin das
// Dokument umgebaut; jetzt wird nur noch ein neues Bild angefordert — was zu
// sehen ist, ergibt sich beim Zeichnen aus dem Zustand.
function render(zustand) {
  const neu = zustand || gameService.getZustand();
  letzteZustand = neu;

  if (neu.phase === "start") gibBildschirmFrei(); else sichereBildschirmWach();

  if (letztePhase !== neu.phase) {
    letztePhase = neu.phase;
    bildschirme.phaseGewechselt(neu.phase);
    if (neu.phase === "start") {
      querformatHinweisWeggetippt = false;
      verlasseVollbild();
      spielfeld.zuruecksetzen();
      bildschirme.zurueckZumStart();
    }
    if (neu.phase === "lobby") { meineStimme = null; letzteMeetingUnterphase = null; }
    if (neu.phase === "laeuft") {
      gameService.setzeStartposition();
      gameService.startePositionsSchleife();
    }
    if (neu.phase !== "laeuft") spielfeld.zuruecksetzen();
  }

  // Ein Meeting beendet jeden offenen Dialog — sonst stuende man nach der
  // Besprechung wieder vor einem halb gespielten Minispiel.
  if (neu.meeting && spielfeld.offenerDialog) spielfeld.schliesse();
  if (neu.phase === "laeuft" && !neu.meeting && letzteMeetingUnterphase) {
    letzteMeetingUnterphase = null;
    meineStimme = null;
  }

  ui.anfordern();
}

// Nutzt dieselbe Anmeldung wie die ToolsUebersicht-Landingpage (gleicher Origin
// tecko1985.github.io, localStorage-Key "tu_session_token") — kein eigenes Login hier.
// Reiner UI-Gate ohne Backend-Durchsetzung, fail-closed bei jedem Fehler.
const TU_WORKER_URL = "https://landingpage.michel-brunner.workers.dev";
const TU_TOKEN_KEY = "tu_session_token";
let istAdmin = false;

async function pruefeAdminStatus() {
  let token = null;
  try {
    token = localStorage.getItem(TU_TOKEN_KEY);
  } catch (e) {
    // unkritisch, falls localStorage nicht verfügbar ist
  }
  if (!token) { istAdmin = false; return; }
  try {
    const resp = await fetch(TU_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ action: "me" })
    });
    const daten = resp.ok ? await resp.json() : null;
    istAdmin = !!(daten && daten.isAdmin);
  } catch (e) {
    istAdmin = false; // fail-closed
  }
  ui.anfordern();
}

// ---------- Info-Tab / Versionshistorie ----------
const APP_VERSION = "1.0";
const CHANGELOG = [
  {
    version: "1.0",
    groups: [
      { title: "Spielen", items: [
          "Verräterspiel für 4 bis 15 Mitspielende auf dem Vereinsgelände, live auf allen Handys.",
          "Das Gelände folgt dem Original-Grundriss von Among Us: 14 Räume, 10 Flure, 25 Türen — jede Tür an der richtigen Wandseite. Die Elektrik wird von unten betreten, die Krankenstation von oben, der Untere Motor nach Osten, das Lager nach Westen.",
          "Fünf Sackgassen mit nur einer Tür: Sicherheit, Krankenstation, Elektrik, Kommunikation und Verwaltung. Wer dort hineingeht, kommt nur auf demselben Weg wieder heraus. Die Verwaltung ist die einzige davon mit Aufgaben darin — und mit einer Abkürzung.",
          "Es gibt keinen durchgehenden Mittelgang: Von der Cafeteria geht es nicht geradewegs nach unten, zur Elektrik führt der Weg über das Lager oder den Unteren Motor. Der untere Quergang läuft in Stufen um die Elektrik herum und erschließt sie dabei.",
          "Wände nehmen die Sicht: Wer hinter einer Mauer steht, ist nicht zu sehen — nur durch offene Türen fällt Licht in den Nachbarraum. Die Räume bleiben schwach angedeutet, damit man sich zurechtfindet; Mitspielende sieht man aber wirklich nur in direkter Sichtlinie. Auch ein Foulspiel quer durch die Wand geht nicht.",
          "17 verschiedene Aufgaben-Minispiele an 35 Stationen — jede Runde ist anders zusammengesetzt.",
          "Fünf Aufgaben sind sichtbar (👁): wer dabei zusieht, weiß, dass wirklich gearbeitet wurde — bei Maulwürfen passiert nichts. Das einzige harte Alibi im Spiel.",
          "Maulwürfe können Leute ausschalten, Abkürzungen nehmen, das Licht kappen, den Reaktor überhitzen, den Funk stören und Räume verriegeln.",
          "↧ In den Abkürzungen hält man sich auf, statt nur durchzuspringen: drinnen ist man für alle unsichtbar, kann zwischen den Enden eines Netzes wechseln und sieht bei jedem Ende erst die Umgebung. Ausgestiegen wird per Knopf, wenn die Luft rein ist. Ausschalten und Sabotieren gehen aus dem Schacht heraus nicht.",
          "Die ersten 10 Sekunden einer Runde ist der Ausschalten-Knopf gesperrt und zählt sichtbar herunter — so kommen alle erst einmal aus der Cafeteria heraus, statt dass die Partie in der ersten Sekunde entschieden wird.",
          "📹 Vier Kameras hängen an den Stellen des Originals: vor Navigation, Verwaltung, Krankenstation und Reaktor, alle im Flur. Drei davon bewachen den Zugang zu einer Sackgasse. Am Pult in der Sicherheit zeigen sie die Bereiche mit Namen und Spielerfarben — und wer zusieht, wird verraten: die Kameras blinken dann rot für jeden, der davorsteht.",
          "📻 Ist der Funk gestört, fallen Kameras und Aufgabenliste aus, bis jemand am Funkpult in der Kommunikation war.",
          "Besprechung per Chat mit Schnellphrasen, danach Abstimmung — Ausgeschlossene spielen als Geist weiter und arbeiten ihre Aufgaben zu Ende.",
          "Einstellbar, ob nach einem Rauswurf verraten wird, ob es wirklich ein Maulwurf war."
      ]},
      { title: "Zwei Spielmodi", items: [
          "🕵️ Klassisch: verdeckte Maulwürfe, Leiche melden, Besprechung und Abstimmung — das volle Spiel.",
          "🥅 Verstecken: genau ein Fänger, von Beginn an für alle sichtbar. Keine Besprechung, keine Abstimmung, keine Sabotage.",
          "Im Verstecken-Modus dreht sich die Sicht um: Der Fänger sieht am wenigsten und tastet sich an einer Nähe-Anzeige entlang, die nur die Entfernung verrät, nie die Richtung.",
          "Das Team gewinnt durch alle Aufgaben oder indem es die Zeit übersteht; der Fänger, wenn er alle erwischt hat. Vorsprung und Zeitlimit sind einstellbar."
      ]},
      // **Aus rollen.js erzeugt, nicht abgeschrieben.** Die Beschreibungen standen hier
      // doppelt und liefen bei jeder Rollenänderung auseinander — im Info-Tab stand dann
      // etwas anderes als beim Ziehen der Rolle. Jede Zeile nennt Können UND Preis: eine
      // Rolle ohne Einschränkung liest sich wie ein Geschenk.
      { title: "Sonderrollen (einzeln zuschaltbar)", items:
          Object.keys(rollenModul.SONDERROLLEN).map(id => {
            const r = rollenModul.SONDERROLLEN[id];
            const seite = r.seite === "maulwurf" ? "Maulwurf-Rolle" : "Team-Rolle";
            return `${r.icon} ${r.name} (${seite}): ${r.koennen} ⚖️ ${r.haken}`;
          })
      },
      { title: "Fair verteilt", items: [
          "Die Rollen zieht jedes Handy selbst aus einem anonym gemischten Stapel – auch das Gerät der Gastgeberin oder des Gastgebers erfährt nichts.",
          "Fremde Rollen sind serverseitig gesperrt, nicht nur ausgeblendet."
      ]},
      { title: "Aussehen und Bedienung", items: [
          "Die ganze Oberfläche wird gezeichnet: Menüs, Warteraum, Besprechung, Aufgaben und Bestenliste laufen auf derselben Fläche wie das Spielfeld. Das Spiel sieht dadurch überall gleich aus.",
          "Alles ist dunkel gehalten, passend zum Spielfeld. Leuchtfarben gibt es nur, wo etwas bedeutet oder bedienbar ist: Cyan für Schaltflächen, Rot für Gefahr, Gelb für Sabotagen. Auf dem Handy färbt sich die Statusleiste mit.",
          "Jeder Raum tönt seinen Boden ein wenig ein — der Motorraum ins Rostrote, die Cafeteria ins Warme, die Krankenstation ins Grüne. Gedacht für den Augenwinkel: man weiß, wo man ist, ohne den Namen zu lesen. Lager und Kommunikation bleiben absichtlich neutral.",
          "Die Spielerfarben sind kräftig und gut zu unterscheiden, auch auf dem dunklen Boden.",
          "Steuerkreuz und Aktionsknöpfe lassen sich gleichzeitig bedienen: ein Daumen läuft, der andere tippt.",
          "Rückfragen wie „Partie wirklich beenden?“ erscheinen als Fenster im Spiel statt als Browser-Hinweis, der die Seite einfriert.",
          "Warteräume und Listen rollen mit Schwung, und ein Wisch darüber löst keine Schaltfläche versehentlich aus.",
          "Der Wechsel zwischen Bildschirmen blendet auf. Der gemeinsame Aufgabenbalken wächst weich und leuchtet kurz auf, wenn jemand eine Aufgabe fertig macht. Die Sabotage-Warnung pulsiert, bei der Kernschmelze umso hektischer, je knapper die Zeit wird."
      ]},
      { title: "Am Handy", items: [
          "Quer halten: Das Spielfeld läuft formatfüllend über den ganzen Bildschirm.",
          "Vollbild lässt sich jederzeit über das Symbol oben rechts ein- und ausschalten.",
          "Die Aufgaben-Minispiele sitzen im dunklen Pult-Look, im Querformat gut lesbar und mit großen Bedienflächen für den Daumen."
      ]},
      { title: "Drumherum", items: [
          "Bestenliste über alle Partien.",
          "KI-Mitspieler zum Ausprobieren, wenn gerade niemand sonst da ist.",
          "Neue Runde mit denselben Leuten und neu gemischten Rollen."
      ]}
    ]
  }
];

// ============================================================
// Start
// ============================================================

// Eine einzige Szene beschreibt das gesamte Bild. Im Spielbetrieb uebernimmt
// spielfeld.js, sonst bildschirme.js — dazwischen gibt es nichts, was
// „aktualisiert" werden muesste.
function szene() {
  const zustand = gameService.getZustand();
  const imSpiel = zustand.phase === "laeuft" && !zustand.meeting;

  ui.setzeDauerlauf(imSpiel);

  if (imSpiel) {
    bewegeUndZiehNach(zustand);
    spielfeld.zeichneSpielfeld(gameService.getZustand());
  } else {
    bildschirme.zeichneMenue(zustand);
  }
  ui.zeichneOffeneListen();
}

function starteOberflaeche() {
  const leinwand = document.getElementById("buehne");
  const proxy = document.getElementById("tastatur-proxy");
  ui.starte(leinwand, proxy, szene);
  ctx = ui.ctx;

  gameService.onZustandsAenderung(render);
  pruefeAdminStatus();
  render(gameService.getZustand());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", starteOberflaeche);
} else {
  starteOberflaeche();
}
