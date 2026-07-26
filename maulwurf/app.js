// Oberfläche, Canvas-Renderer und Steuerung. Redet ausschließlich über die gameService-API
// (game-service.js) mit Firebase und über karte.js/aufgaben.js mit Spielgeometrie bzw.
// Minispielen.

const SCREEN_FUER_PHASE = {
  start: "screen-start",
  lobby: "screen-lobby",
  zuteilung: "screen-reveal",
  laeuft: "screen-spiel",
  beendet: "screen-ende",
  abgebrochen: "screen-abgebrochen"
};

const PHASEN_MIT_VERLASSEN_BUTTON = ["lobby", "zuteilung", "laeuft"];

// Die KÜRZERE Bildschirmachse zeigt immer diesen Weltausschnitt. Eine feste Weltbreite (so
// war es vorher) funktioniert nur im Hochformat: quer gehalten würde sie oben und unten
// abschneiden, und der Sichtkreis passte nicht mehr aufs Bild. Über die kurze Achse gerechnet
// sieht man im Querformat mehr nach links und rechts – nie weniger als den vollen Sichtkreis.
// Der Wert muss über dem größten Sichtdurchmesser liegen (2 × SICHT_MAULWURF = 840 … hier
// bewusst knapp darunter, damit der Nebel am Rand noch sichtbar ausblendet statt abgeschnitten
// zu wirken) und ist mit dem Umbau auf das Original-Layout von 620 mitgewachsen.
const SICHT_KURZE_ACHSE = 790;

// Bodenfarben der Karte. Türschwellen bekommen bewusst KEINE eigene Farbe, sondern übernehmen
// je Hälfte die der angrenzenden Fläche – sonst stehen sie als helle Klötze in der Landschaft.
const MAUERWERK = "#172136";
const BODEN_GANG = "#243044";
const BODEN_RAUM = "#2c3a52";
const BODEN_GESPERRT = "#3a2230";
const WANDLINIE = "#48597a";
const TUERZARGE = "#63799e";   // heller als die Wand, damit Türen schon aus der Ferne auffallen
const ZARGE = 13;              // Länge einer Zarge je Seite der Wand, in Weltkoordinaten
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
let laufAnimation = null;
let letzterFrameZeit = 0;
let overlayOffen = null;       // "aufgabe" | "liste" | "sabotage" | null
let aktiveAufgabeAufraeumen = null;
let aktiveStationId = null;
let meineStimme = null;

const tasten = {};
const joystick = { aktiv: false, dx: 0, dy: 0, pointerId: null };
const angezeigtePositionen = {}; // uid -> {x,y}, weich nachgezogene Darstellung

function avatarInitiale(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

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

// Pflicht für alle innerHTML-Templates: Namen und Chat-Texte kommen aus Firebase, sind also
// Eingaben der Mitspielenden (siehe XSS-Vorfall im Schwesterprojekt familien-quartett).
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  const el = document.getElementById(screenId);
  if (el) el.classList.add("active");
}

function el(id) {
  return document.getElementById(id);
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

function aktualisiereVollbildKnopf() {
  const btn = el("btn-vollbild");
  if (!btn) return;
  btn.textContent = vollbildAktiv() ? "🗗" : "⛶";
  btn.title = vollbildAktiv() ? "Vollbild verlassen" : "Vollbild";
}

function pruefeAusrichtung() {
  const zustand = gameService.getZustand();
  const imSpiel = zustand.phase === "laeuft" && !zustand.meeting;
  const hochkant = window.innerHeight > window.innerWidth * 1.05;
  const box = el("hinweis-querformat");
  if (box) box.style.display = imSpiel && hochkant && !querformatHinweisWeggetippt ? "flex" : "none";
}

document.addEventListener("fullscreenchange", () => { aktualisiereVollbildKnopf(); passeCanvasAn(); });
document.addEventListener("webkitfullscreenchange", () => { aktualisiereVollbildKnopf(); passeCanvasAn(); });
window.addEventListener("orientationchange", () => {
  // Die neuen Maße stehen erst nach dem Umbruch fest, deshalb ein Frame warten.
  requestAnimationFrame(() => { passeCanvasAn(); pruefeAusrichtung(); });
});
window.addEventListener("resize", pruefeAusrichtung);

// ============================================================
// Canvas
// ============================================================

const canvas = el("spielfeld-canvas");
const ctx = canvas.getContext("2d");

// Ein Canvas, das beim Setzen der Größe noch in einem display:none-Screen liegt, behält die
// Standardgröße 300x150 und rendert verzerrt. Deshalb wird die Größe hier IMMER gegen das
// echte Rect geprüft und erst übernommen, wenn der Screen sichtbar ist.
function passeCanvasAn() {
  const huelle = el("spielfeld-huelle");
  const rect = huelle.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const breite = Math.round(rect.width * dpr);
  const hoehe = Math.round(rect.height * dpr);
  if (canvas.width !== breite || canvas.height !== hoehe) {
    canvas.width = breite;
    canvas.height = hoehe;
  }
  return true;
}

window.addEventListener("resize", () => passeCanvasAn());

function sichtweiteFuer(zustand) {
  if (zustand.binGeist) return karte.SICHT_GEIST;
  if (zustand.versteckModus) {
    return zustand.meineRolle === "maulwurf" ? karte.SICHT_VERSTECKEN_FAENGER : karte.SICHT_VERSTECKEN_TEAM;
  }
  if (zustand.meineRolle === "maulwurf") return karte.SICHT_MAULWURF;
  const sab = zustand.sabotage;
  if (sab && sab.typ === "flutlicht") return karte.SICHT_TEAM_DUNKEL;
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
  if (!passeCanvasAn()) return;
  const mich = zustand.meinePosition || { x: karte.WELT_BREITE / 2, y: karte.WELT_HOEHE / 2 };
  const skala = Math.min(canvas.width, canvas.height) / SICHT_KURZE_ACHSE;
  const versatzX = canvas.width / 2 - mich.x * skala;
  const versatzY = canvas.height / 2 - mich.y * skala;

  // Das Sichtfeld wird einmal pro Bild bestimmt und danach für alles benutzt: Figuren,
  // Leichen, Alibi-Spuren und die Abdunklung. Für Geister entfällt es — sie sehen ohnehin
  // alles, und ein Polygon mit Radius SICHT_GEIST wäre nur Rechenarbeit ohne Wirkung.
  const sichtweite = sichtweiteFuer(zustand);
  const sichtfeld = zustand.binGeist ? null : karte.sichtPolygon(mich.x, mich.y, sichtweite);

  const wx = x => x * skala + versatzX;
  const wy = y => y * skala + versatzY;

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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
    ctx.fillStyle = gesperrt ? BODEN_GESPERRT : BODEN_RAUM;
    ctx.fillRect(wx(r.x), wy(r.y), r.w * skala, r.h * skala);
    ctx.strokeStyle = gesperrt ? "#dc2626" : WANDLINIE;
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
    const raumfarbe = raum && istGesperrt(raum) ? BODEN_GESPERRT : BODEN_RAUM;
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
    ctx.strokeStyle = raum && istGesperrt(raum) ? "#dc2626" : TUERZARGE;
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
  ctx.font = `600 ${Math.max(Math.round(28 * skala), 13)}px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(226,232,240,0.6)";
  ctx.shadowColor = "rgba(3,7,15,0.85)";
  ctx.shadowBlur = Math.max(5 * skala, 3);
  karte.RAEUME.forEach(r => ctx.fillText(r.name, wx(r.x + r.w / 2), wy(r.y + 40)));
  ctx.shadowBlur = 0;

  // Notfallknopf — im Verstecken-Modus gibt es keine Besprechung, also auch keinen Knopf
  if (!zustand.versteckModus) zeichneMarker(wx(karte.NOTFALLKNOPF.x), wy(karte.NOTFALLKNOPF.y), skala, "#dc2626", "📣");

  // Reparaturstellen nur, solange die passende Sabotage läuft
  const sab = zustand.sabotage;
  if (sab && sab.typ === "flutlicht") zeichneMarker(wx(karte.SICHERUNGSKASTEN.x), wy(karte.SICHERUNGSKASTEN.y), skala, "#fbbf24", "💡");
  if (sab && sab.typ === "heizung") {
    zeichneMarker(wx(karte.HEIZUNG_A.x), wy(karte.HEIZUNG_A.y), skala, "#fbbf24", "🔧");
    zeichneMarker(wx(karte.HEIZUNG_B.x), wy(karte.HEIZUNG_B.y), skala, "#fbbf24", "🔧");
  }

  // Eigene Aufgabenstationen (nur die eigenen — fremde Aufgaben sieht niemand)
  zustand.meineAufgaben.forEach(a => {
    if (!a.station) return;
    zeichneMarker(wx(a.station.x), wy(a.station.y), skala, a.erledigt ? "#4b5563" : "#22c55e", a.erledigt ? "✓" : "★");
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

  // Abkürzungen sehen nur, wer sie auch benutzen darf
  if (darfTunnelSehen(zustand)) {
    karte.TUNNEL.forEach(t => {
      zeichneMarker(wx(t.a.x), wy(t.a.y), skala, "#a855f7", "↧");
      zeichneMarker(wx(t.b.x), wy(t.b.y), skala, "#a855f7", "↥");
    });
  }

  // Leichen — auch die nur, wenn nichts dazwischensteht
  Object.keys(zustand.leichen || {}).forEach(uid => {
    const leiche = zustand.leichen[uid];
    if (!istEinsehbar(mich, leiche, sichtweite, zustand.binGeist)) return;
    ctx.fillStyle = leiche.farbe || "#dc2626";
    ctx.beginPath();
    ctx.ellipse(wx(leiche.x), wy(leiche.y), 19 * skala, 12 * skala, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.round(20 * skala)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("✖", wx(leiche.x), wy(leiche.y) + 7 * skala);
  });

  // Mitspielende. Die eigene Figur kommt aus der lokalen Position (flüssig), fremde aus den
  // interpolierten Werten — die Rohdaten treffen nur mit 5 Hz ein und würden sonst hüpfen.
  zustand.spieler.forEach(s => {
    const eigenerZug = s.id === zustand.eigenerSpielerId;
    const pos = eigenerZug ? mich : angezeigtePositionen[s.id];
    if (!pos || s.lebt === false) return;
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
  ctx.font = `${Math.round(19 * skala)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(zeichen, x, y + 7 * skala);
}

// Arbeitsspur einer sichtbaren Aufgabe: ein Ring, der nach außen läuft und dabei verblasst,
// dazu Zeichen und Name. Der Name gehört dazu — ohne ihn wüsste man zwar, dass hier gearbeitet
// wurde, aber nicht von wem, und genau das ist der Punkt eines Alibis.
function zeichneArbeitsspur(x, y, skala, spur, anteilUebrig) {
  const puls = 1 - anteilUebrig;                      // 0 → frisch, 1 → gleich vorbei
  const radius = (26 + 30 * (puls % 0.34) / 0.34) * skala;

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
  ctx.font = `${Math.round(21 * skala)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(spur.zeichen || "🛠️", x, y + 7 * skala);

  // Der Name sitzt bewusst weit unterhalb: wer gerade gearbeitet hat, steht meist noch auf der
  // Station, und dessen eigener Name schwebt über der Figur. Zu dicht beieinander überlagern
  // sich beide zu einem unlesbaren Klumpen.
  if (spur.name) {
    ctx.font = `600 ${Math.max(Math.round(19 * skala), 11)}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillStyle = "#bae6fd";
    ctx.shadowColor = "rgba(3,7,15,0.9)";
    ctx.shadowBlur = Math.max(5 * skala, 4);
    ctx.fillText(spur.name.slice(0, 12), x, y + 60 * skala);
    ctx.shadowBlur = 0;
  }
}

function zeichneFigur(x, y, skala, spieler, zustand) {
  const istIch = spieler.id === zustand.eigenerSpielerId;
  const istMitMaulwurf = zustand.meineRolle === "maulwurf" && zustand.maulwurfTeam.indexOf(spieler.id) !== -1;

  // Gestaltwandler: für alle anderen sieht er aus wie sein Ziel. Sich selbst und den eigenen
  // Mitmaulwürfen zeigt er sich unverändert — sonst würden sie ihn verlieren, und der
  // Gestaltwandler selbst wüsste nicht mehr, welche Figur er steuert.
  const verkleidung = (zustand.verkleidungen || {})[spieler.id];
  if (verkleidung && verkleidung.bis > zustand.jetzt && !istIch && !istMitMaulwurf) {
    const vorbild = zustand.spieler.find(s => s.id === verkleidung.alsUid);
    if (vorbild) spieler = { id: spieler.id, name: vorbild.name, farbe: vorbild.farbe, lebt: spieler.lebt };
  }

  // Der Fänger im Verstecken-Modus ist für alle als solcher erkennbar — daran hängt der
  // ganze Modus. Der Ring liegt außen um die Figur, damit er auch bei fremder Farbe auffällt.
  const istFaenger = zustand.versteckModus && spieler.id === zustand.faengerUid;
  if (istFaenger) {
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(3.5 * skala, 2.5);
    ctx.beginPath();
    ctx.arc(x, y, (karte.SPIELER_RADIUS + 8) * skala, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = spieler.farbe || "#1a56a0";
  ctx.beginPath();
  ctx.arc(x, y, karte.SPIELER_RADIUS * skala, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2.5 * skala, 2);
  ctx.strokeStyle = istIch ? "#ffffff" : istMitMaulwurf ? "#ef4444" : "rgba(0,0,0,0.35)";
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(21 * skala)}px -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText((istFaenger ? "🥅 " : "") + spieler.name.slice(0, 12), x, y - 26 * skala);
}

// Abdunklung außerhalb des Sichtfelds. Zwei Lagen, die zusammen erst den Eindruck ergeben:
//
// 1. Alles außerhalb des Sichtpolygons wird flächig abgedunkelt — das erzeugt die harten
//    Schattenkanten hinter Wänden und Türpfosten. Ausgestanzt wird das Polygon über einen
//    zweiten Pfad im selben fill() mit "evenodd".
// 2. Innerhalb des Polygons blendet ein Radialverlauf zum Sichtrand hin weich aus, damit die
//    Sicht nicht an einer scharfen Kreiskante endet, wo gar keine Wand ist. Er wird auf das
//    Polygon geclippt, sonst würde er über die Schatten laufen und sie wieder aufhellen.
//
// Die Restdeckkraft von 0.96 ist Absicht: der abgedunkelte Rest der Karte bleibt schemenhaft
// als Orientierung erhalten. Figuren und Leichen werden davon NICHT verdeckt, sondern schon
// vorher gar nicht erst gezeichnet (siehe istEinsehbar) — Restlicht dürfte sonst verraten,
// wo jemand steht.
function zeichneSichtfeld(wx, wy, mitteX, mitteY, radius, polygon) {
  function pfad() {
    ctx.moveTo(wx(polygon[0].x), wy(polygon[0].y));
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(wx(polygon[i].x), wy(polygon[i].y));
    ctx.closePath();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  pfad();
  ctx.fillStyle = "rgba(5,10,20,0.96)";
  ctx.fill("evenodd");
  ctx.restore();

  const rand = ctx.createRadialGradient(mitteX, mitteY, radius * 0.72, mitteX, mitteY, radius);
  rand.addColorStop(0, "rgba(5,10,20,0)");
  rand.addColorStop(1, "rgba(5,10,20,0.96)");
  ctx.save();
  ctx.beginPath();
  pfad();
  ctx.clip();
  ctx.fillStyle = rand;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

// ============================================================
// Steuerung
// ============================================================

function richteJoystickEin() {
  const feld = el("joystick");
  const knopf = el("joystick-knopf");
  const maxWeg = 34;

  function setzeAus(dx, dy) {
    const laenge = Math.hypot(dx, dy);
    const begrenzt = laenge > maxWeg ? maxWeg / laenge : 1;
    knopf.style.transform = `translate(${dx * begrenzt}px, ${dy * begrenzt}px)`;
    joystick.dx = (dx * begrenzt) / maxWeg;
    joystick.dy = (dy * begrenzt) / maxWeg;
  }

  feld.addEventListener("pointerdown", e => {
    e.preventDefault();
    joystick.aktiv = true;
    joystick.pointerId = e.pointerId;
    try { feld.setPointerCapture(e.pointerId); } catch (err) { /* Testartefakt, unkritisch */ }
    const rect = feld.getBoundingClientRect();
    setzeAus(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
  });

  feld.addEventListener("pointermove", e => {
    if (!joystick.aktiv || e.pointerId !== joystick.pointerId) return;
    const rect = feld.getBoundingClientRect();
    setzeAus(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
  });

  const beenden = e => {
    if (!joystick.aktiv || (e && e.pointerId !== joystick.pointerId)) return;
    joystick.aktiv = false;
    joystick.pointerId = null;
    joystick.dx = 0;
    joystick.dy = 0;
    knopf.style.transform = "";
  };
  feld.addEventListener("pointerup", beenden);
  feld.addEventListener("pointercancel", beenden);
}

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
    if (karte.abstand(aktuell.x, aktuell.y, ziel.x, ziel.y) > 220) {
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

function schleife(zeit) {
  laufAnimation = requestAnimationFrame(schleife);
  const zustand = gameService.getZustand();
  if (zustand.phase !== "laeuft") { letzterFrameZeit = 0; return; }

  const delta = letzterFrameZeit ? Math.min((zeit - letzterFrameZeit) / 1000, 0.1) : 0;
  letzterFrameZeit = zeit;

  // Im Meeting läuft nur der Countdown weiter — render() feuert dort nur bei Firebase-
  // Updates, und während eines Countdowns schreibt oft niemand.
  if (zustand.meeting) {
    const rest = Math.max(Math.ceil((zustand.meeting.endeAt - zustand.jetzt) / 1000), 0);
    const timer = el("meeting-timer");
    if (timer.textContent !== String(rest)) timer.textContent = rest;
    return;
  }

  if (!overlayOffen) {
    const taste = tastenRichtung();
    const dx = joystick.dx + taste.dx;
    const dy = joystick.dy + taste.dy;
    if (Math.hypot(dx, dy) > 0.06) {
      gameService.bewege(dx, dy, delta);
      gameService.schreibePosition(false);
    }
  }

  const aktuell = gameService.getZustand();
  interpolierePositionen(aktuell, delta);
  zeichne(aktuell);
  aktualisiereHud(aktuell);
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

  if (sab && sab.typ === "flutlicht" &&
      karte.abstand(pos.x, pos.y, karte.SICHERUNGSKASTEN.x, karte.SICHERUNGSKASTEN.y) <= karte.INTERAKTIONS_RADIUS) {
    return { typ: "reparatur-flutlicht", zeichen: "💡", label: "Sicherungskasten" };
  }
  if (sab && sab.typ === "heizung") {
    if (karte.abstand(pos.x, pos.y, karte.HEIZUNG_A.x, karte.HEIZUNG_A.y) <= karte.INTERAKTIONS_RADIUS) {
      return { typ: "reparatur-heizung", seite: "a", zeichen: "🔧", label: "Ventil Keller" };
    }
    if (karte.abstand(pos.x, pos.y, karte.HEIZUNG_B.x, karte.HEIZUNG_B.y) <= karte.INTERAKTIONS_RADIUS) {
      return { typ: "reparatur-heizung", seite: "b", zeichen: "🔧", label: "Ventil Küche" };
    }
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
    if (tunnel) return { typ: "tunnel", ziel: tunnel.ziel, zeichen: "↧", label: tunnel.tunnel.name };
  }
  return null;
}

function darfTunnelSehen(zustand) {
  return zustand.meineRolle === "maulwurf" || zustand.meineSonderrolle === "ingenieur";
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

function aktualisiereVersteckHud(zustand) {
  const leiste = el("hud-verstecken");
  if (!zustand.versteckModus) { leiste.style.display = "none"; return; }
  leiste.style.display = "flex";

  const binFaenger = zustand.eigenerSpielerId === zustand.faengerUid;
  const vorsprungRest = zustand.vorsprungBis ? zustand.vorsprungBis - zustand.jetzt : 0;
  const uhr = el("hud-uhr");
  if (!zustand.zeitlimitBis) {
    uhr.textContent = "⏳ …";       // Startzeit steht noch nicht fest
    uhr.className = "hud-uhr";
  } else if (vorsprungRest > 0) {
    uhr.textContent = binFaenger
      ? `⏳ Noch ${Math.ceil(vorsprungRest / 1000)} s – du darfst noch nicht los`
      : `⏳ ${Math.ceil(vorsprungRest / 1000)} s Vorsprung`;
    uhr.className = "hud-uhr vorsprung";
  } else {
    uhr.textContent = "⏱ " + mmss(zustand.zeitlimitBis - zustand.jetzt);
    uhr.className = "hud-uhr" + (zustand.zeitlimitBis - zustand.jetzt < 30000 ? " knapp" : "");
  }

  const naehe = el("hud-naehe");
  const d = zustand.binGeist ? null : naechsteGegenseite(zustand);
  const stufe = d === null ? null : NAEHE_STUFEN.find(s => d <= s.bis);
  if (!stufe) {
    naehe.textContent = binFaenger ? "🔍 niemand in der Nähe" : "🟢 Luft rein";
    naehe.className = "hud-naehe";
  } else {
    naehe.textContent = stufe.text;
    naehe.className = "hud-naehe " + stufe.klasse;
  }
}

function aktualisiereHud(zustand) {
  const pos = zustand.meinePosition;
  el("hud-raumname").textContent = pos ? karte.raumName(pos.x, pos.y) : "";

  const rolleEl = el("hud-rolle");
  rolleEl.className = "hud-rolle " + (zustand.meineRolle || "");
  rolleEl.textContent = zustand.binGeist ? "👻 Geist" : rollenBezeichnung(zustand);

  const aufgaben = zustand.aufgaben || { erledigt: 0, gesamt: 0 };
  const anteil = aufgaben.gesamt > 0 ? Math.min(aufgaben.erledigt / aufgaben.gesamt, 1) : 0;
  el("hud-aufgaben-fuellung").style.width = Math.round(anteil * 100) + "%";

  const warnung = el("hud-warnung");
  const sab = zustand.sabotage;
  if (sab && sab.typ === "heizung") {
    const rest = Math.max(Math.ceil((sab.endeAt - zustand.jetzt) / 1000), 0);
    warnung.style.display = "block";
    warnung.textContent = `🔥 Heizung überdreht – ${rest} s bis zum Knall. Beide Ventile gleichzeitig halten!`;
  } else if (sab && sab.typ === "flutlicht") {
    warnung.style.display = "block";
    warnung.textContent = "💡 Flutlicht aus – Sicherungskasten in der Werkstatt.";
  } else {
    warnung.style.display = "none";
  }

  const aktion = ermittleAktion(zustand);
  const interaktion = el("btn-interaktion");
  interaktion.disabled = !aktion;
  interaktion.textContent = aktion ? aktion.zeichen : "✋";
  interaktion.title = aktion ? aktion.label : "Nichts in Reichweite";

  const leicheUid = findeMeldbareLeiche(zustand);
  el("btn-melden").style.display = leicheUid ? "flex" : "none";

  // Der Ingenieur hat keinen Knopf — seine Fähigkeit liegt auf der normalen Aktionstaste,
  // sobald er auf einer Abkürzung steht.
  const rollenBtn = el("btn-rollenfaehigkeit");
  const sonder = zustand.meineSonderrolle && rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
  const mitKnopf = ["wissenschaftler", "schutzengel", "gestaltwandler"].indexOf(zustand.meineSonderrolle) !== -1;
  rollenBtn.style.display = mitKnopf ? "flex" : "none";
  if (mitKnopf) {
    rollenBtn.textContent = sonder.icon;
    rollenBtn.title = sonder.name;
    // Schutzengel wirkt erst als Geist, alle anderen nur zu Lebzeiten
    rollenBtn.disabled = zustand.meineSonderrolle === "schutzengel" ? !zustand.binGeist : zustand.binGeist;
  }

  const killBtn = el("btn-ausschalten");
  const sabBtn = el("btn-sabotage");
  if (zustand.meineRolle === "maulwurf" && !zustand.binGeist) {
    killBtn.style.display = "flex";
    // Im Verstecken-Modus gibt es keine Sabotage — der Knopf verschwindet ganz, statt nur
    // dauerhaft ausgegraut zu bleiben.
    sabBtn.style.display = zustand.versteckModus ? "none" : "flex";
    const gesperrt = zustand.versteckModus && zustand.vorsprungBis > zustand.jetzt;
    const rest = Math.max(Math.ceil((zustand.killCooldownBis - zustand.jetzt) / 1000), 0);
    const ziel = findeKillZiel(zustand);
    killBtn.disabled = gesperrt || !ziel || rest > 0;
    killBtn.textContent = gesperrt ? "⏳" : rest > 0 ? rest : "🥾";
    sabBtn.disabled = (zustand.sabotageCooldownBis || 0) > zustand.jetzt;
  } else {
    killBtn.style.display = "none";
    sabBtn.style.display = "none";
  }

  aktualisiereVersteckHud(zustand);
}

async function fuehreAktionAus() {
  const zustand = gameService.getZustand();
  const aktion = ermittleAktion(zustand);
  if (!aktion) return;

  if (aktion.typ === "tunnel") {
    gameService.springeZu(aktion.ziel.x, aktion.ziel.y);
    return;
  }
  if (aktion.typ === "notfall") {
    const ergebnis = await gameService.drueckeNotfallknopf();
    if (!ergebnis.erfolg && ergebnis.fehler) alert(ergebnis.fehler);
    return;
  }
  if (aktion.typ === "aufgabe") {
    oeffneAufgabe(aktion.station);
    return;
  }
  if (aktion.typ === "reparatur-flutlicht") {
    oeffneReparaturFlutlicht();
    return;
  }
  if (aktion.typ === "reparatur-heizung") {
    oeffneReparaturHeizung(aktion.seite);
  }
}

// ============================================================
// Overlays
// ============================================================

function schliesseOverlay() {
  if (aktiveAufgabeAufraeumen) {
    aktiveAufgabeAufraeumen();
    aktiveAufgabeAufraeumen = null;
  }
  document.querySelectorAll(".overlay").forEach(o => o.classList.remove("aktiv"));
  overlayOffen = null;
  aktiveStationId = null;
}

function oeffneAufgabe(station) {
  const typ = aufgabenModul.AUFGABEN_TYPEN[station.typ];
  if (!typ) return;
  schliesseOverlay();
  overlayOffen = "aufgabe";
  aktiveStationId = station.id;
  el("aufgabe-titel").textContent = stationName(station);
  const inhalt = el("aufgabe-inhalt");
  inhalt.innerHTML = "";
  aktiveAufgabeAufraeumen = typ.start(inhalt, async () => {
    await gameService.erledigeAufgabe(station.id);
    setTimeout(schliesseOverlay, 700);
  });
  el("overlay-aufgabe").classList.add("aktiv");
}

function oeffneReparaturFlutlicht() {
  schliesseOverlay();
  overlayOffen = "aufgabe";
  el("aufgabe-titel").textContent = "Sicherungskasten";
  const inhalt = el("aufgabe-inhalt");
  inhalt.innerHTML = "";
  aktiveAufgabeAufraeumen = aufgabenModul.reparaturFlutlicht(inhalt, async () => {
    await gameService.repariereFlutlicht();
    setTimeout(schliesseOverlay, 600);
  });
  el("overlay-aufgabe").classList.add("aktiv");
}

function oeffneReparaturHeizung(seite) {
  schliesseOverlay();
  overlayOffen = "aufgabe";
  el("aufgabe-titel").textContent = seite === "a" ? "Ventil Materialkeller" : "Ventil Küche";
  const inhalt = el("aufgabe-inhalt");
  inhalt.innerHTML = "";
  aktiveAufgabeAufraeumen = aufgabenModul.reparaturHeizung(
    inhalt,
    () => gameService.setzeHeizungsventil(seite, true),
    () => gameService.setzeHeizungsventil(seite, false)
  );
  el("overlay-aufgabe").classList.add("aktiv");
}

function oeffneAufgabenliste() {
  const zustand = gameService.getZustand();
  schliesseOverlay();
  overlayOffen = "liste";
  const liste = el("aufgaben-liste");
  liste.innerHTML = "";
  zustand.meineAufgaben.forEach(a => {
    if (!a.station) return;
    const typ = aufgabenModul.AUFGABEN_TYPEN[a.station.typ];
    const li = document.createElement("li");
    li.className = a.erledigt ? "erledigt" : "";
    li.innerHTML = `<span>${a.erledigt ? "✅" : "⬜"}</span>
      <span>${escapeHtml(stationName(a.station))}${typ && typ.sichtbar ? ' <b class="sichtbar-marke" title="Wer zusieht, sieht dass du wirklich arbeitest">👁</b>' : ""}</span>
      <span class="ort">${escapeHtml(raumNameZu(a.station.raum))}</span>`;
    liste.appendChild(li);
  });
  const hatSichtbare = zustand.meineAufgaben.some(a => {
    const typ = a.station && aufgabenModul.AUFGABEN_TYPEN[a.station.typ];
    return typ && typ.sichtbar;
  });
  el("aufgaben-liste-hinweis").textContent = zustand.meineRolle === "maulwurf"
    ? "Du bist Maulwurf – diese Aufgaben zählen nicht, sehen aber echt aus." +
      (hatSichtbare ? " Vorsicht bei 👁: dort bleibt sichtbar, dass jemand gearbeitet hat – bei dir passiert nichts." : "")
    : `Gemeinsamer Fortschritt: ${zustand.aufgaben.erledigt} von ${zustand.aufgaben.gesamt}` +
      (hatSichtbare ? " · 👁 sehen alle in der Nähe – dein Alibi." : "");
  el("overlay-liste").classList.add("aktiv");
}

// Ein Knopf für drei Rollen: der Wissenschaftler liest hier nur ab, Schutzengel und
// Gestaltwandler wählen ein Ziel. Die Liste wird bei jedem Öffnen neu gebaut, weil sich
// Lebensstatus und Cooldowns laufend ändern.
function oeffneRollenPanel() {
  const zustand = gameService.getZustand();
  const sonder = zustand.meineSonderrolle && rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
  if (!sonder) return;
  schliesseOverlay();
  overlayOffen = "rolle";

  el("rolle-titel").textContent = `${sonder.icon} ${sonder.name}`;
  el("rolle-beschreibung").textContent = sonder.beschreibung;
  const liste = el("rolle-liste");
  liste.innerHTML = "";
  const status = el("rolle-status");
  status.textContent = "";

  const andere = zustand.spieler.filter(s => s.id !== zustand.eigenerSpielerId);

  if (zustand.meineSonderrolle === "wissenschaftler") {
    andere.forEach(s => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${s.lebt === false ? "💀" : "❤️"}</span>
        <span>${escapeHtml(s.name)}</span>
        <span class="ort">${s.lebt === false ? "ausgeschaltet" : "lebt"}</span>`;
      liste.appendChild(li);
    });
    const tot = andere.filter(s => s.lebt === false).length;
    status.textContent = tot ? `${tot} von ${andere.length} sind ausgeschaltet.` : "Noch sind alle im Spiel.";
  } else if (zustand.meineSonderrolle === "schutzengel") {
    if (!zustand.binGeist) {
      status.textContent = "Das geht erst, wenn du selbst ausgeschaltet bist.";
    } else {
      const rest = Math.max(Math.ceil(((zustand.schutzCooldownBis || 0) - zustand.jetzt) / 1000), 0);
      andere.filter(s => s.lebt !== false).forEach(s => {
        const geschuetzt = (zustand.schutz[s.id] || 0) > zustand.jetzt;
        liste.appendChild(zielZeile(s, geschuetzt ? "geschützt" : rest > 0 ? `noch ${rest} s` : "schützen",
          !geschuetzt && rest === 0, async () => {
            const e = await gameService.schuetze(s.id);
            status.textContent = e.erfolg ? `${s.name} ist jetzt eine Weile sicher.` : (e.fehler || "Geht gerade nicht.");
            if (e.erfolg) setTimeout(oeffneRollenPanel, 400);
          }));
      });
      if (!liste.children.length) status.textContent = "Niemand mehr da, den du schützen könntest.";
    }
  } else if (zustand.meineSonderrolle === "gestaltwandler") {
    const meine = zustand.verkleidungen[zustand.eigenerSpielerId];
    const verkleidet = meine && meine.bis > zustand.jetzt;
    const rest = Math.max(Math.ceil(((zustand.verkleidungCooldownBis || 0) - zustand.jetzt) / 1000), 0);
    if (verkleidet) {
      const ziel = zustand.spieler.find(s => s.id === meine.alsUid);
      status.textContent = `Du siehst gerade aus wie ${ziel ? ziel.name : "jemand anderes"}.`;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-grow";
      btn.textContent = "Verkleidung ablegen";
      btn.addEventListener("click", async () => { await gameService.verkleideDich(null); setTimeout(oeffneRollenPanel, 400); });
      li.appendChild(btn);
      liste.appendChild(li);
    } else {
      andere.filter(s => s.lebt !== false).forEach(s => {
        liste.appendChild(zielZeile(s, rest > 0 ? `noch ${rest} s` : "aussehen wie", rest === 0, async () => {
          const e = await gameService.verkleideDich(s.id);
          status.textContent = e.erfolg ? `Du siehst jetzt aus wie ${s.name}.` : (e.fehler || "Geht gerade nicht.");
          if (e.erfolg) setTimeout(oeffneRollenPanel, 400);
        }));
      });
      if (rest > 0) status.textContent = `Noch ${rest} s, bis du dich wieder verwandeln kannst.`;
    }
  }
  el("overlay-rolle").classList.add("aktiv");
}

function zielZeile(spieler, knopfText, aktiv, beiKlick) {
  const li = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = spieler.name;
  const btn = document.createElement("button");
  btn.className = "btn btn-secondary rolle-ziel-btn";
  btn.textContent = knopfText;
  btn.disabled = !aktiv;
  btn.addEventListener("click", beiKlick);
  li.appendChild(name);
  li.appendChild(btn);
  return li;
}

function oeffneSabotageMenue() {
  const zustand = gameService.getZustand();
  schliesseOverlay();
  overlayOffen = "sabotage";
  const gitter = el("sab-tueren-gitter");
  gitter.innerHTML = "";
  karte.RAEUME.forEach(r => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = r.name;
    btn.addEventListener("click", async () => {
      const ergebnis = await gameService.sabotiere("tueren", r.id);
      el("sabotage-hinweis").textContent = ergebnis.erfolg ? "Verriegelt." : (ergebnis.fehler || "Geht gerade nicht.");
      if (ergebnis.erfolg) setTimeout(schliesseOverlay, 500);
    });
    gitter.appendChild(btn);
  });
  el("btn-sab-heizung").disabled = !!zustand.sabotage;
  el("btn-sab-flutlicht").disabled = !!zustand.sabotage;
  el("sabotage-hinweis").textContent = zustand.sabotage ? "Es läuft schon eine Sabotage." : "";
  el("overlay-sabotage").classList.add("aktiv");
}

// ============================================================
// Rendering pro Phase
// ============================================================

function render(zustand) {
  letzteZustand = zustand;

  if (zustand.phase === "start") gibBildschirmFrei(); else sichereBildschirmWach();

  const phasenWechsel = letztePhase !== zustand.phase;
  letztePhase = zustand.phase;

  // Nur auf dem Spielfeld wird formatfüllend gerendert – Lobby, Meeting und Ende bleiben im
  // normalen Seitenlayout, dort ist die Kopfzeile mit dem Verlassen-Knopf wichtiger.
  document.body.classList.toggle("im-spiel", zustand.phase === "laeuft" && !zustand.meeting);
  if (zustand.phase === "start") {
    querformatHinweisWeggetippt = false;
    verlasseVollbild();
  }
  pruefeAusrichtung();

  el("btn-spiel-abbrechen").style.display = PHASEN_MIT_VERLASSEN_BUTTON.includes(zustand.phase) ? "inline-block" : "none";

  // Das Meeting hat einen eigenen Screen, läuft aber innerhalb der Phase "laeuft".
  if (zustand.phase === "laeuft" && zustand.meeting) {
    showScreen("screen-meeting");
    if (overlayOffen) schliesseOverlay();
    renderMeeting(zustand);
    return;
  }

  showScreen(SCREEN_FUER_PHASE[zustand.phase] || "screen-start");

  if (zustand.phase === "lobby") {
    renderLobby(zustand);
    if (phasenWechsel) { meineStimme = null; letzteMeetingUnterphase = null; }
  }
  if (zustand.phase === "zuteilung") renderReveal(zustand);
  if (zustand.phase === "laeuft") {
    if (phasenWechsel || !zustand.meinePosition) {
      gameService.setzeStartposition();
      gameService.startePositionsSchleife();
      // Der Screen ist erst nach showScreen sichtbar – die Canvas-Größe deshalb im
      // nächsten Frame setzen, sonst greift der 300x150-Fallback.
      requestAnimationFrame(() => passeCanvasAn());
    }
    if (letzteMeetingUnterphase) { letzteMeetingUnterphase = null; meineStimme = null; }
    aktualisiereHud(zustand);
  }
  if (zustand.phase === "beendet") renderEnde(zustand);
}

function renderLobby(zustand) {
  el("lobby-raumcode").textContent = zustand.raumCode || "------";
  el("lobby-zaehler").textContent = `${zustand.spieler.length}/${zustand.maxSpieler} Mitspielende`;
  el("lobby-modus").textContent = zustand.istHost ? "Du bist Gastgeber:in" : "";

  const liste = el("lobby-spielerliste");
  liste.innerHTML = "";
  zustand.spieler.forEach(s => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="spieler-avatar" style="background:${escapeHtml(s.farbe)}">${escapeHtml(avatarInitiale(s.name))}</span>
      <span class="spieler-name">${escapeHtml(s.name)}</span>
      <span class="spieler-badge">${s.istHost ? "Gastgeber:in" : s.istSimuliert ? "🤖 KI" : ""}</span>`;
    if (s.istSimuliert && zustand.istHost) {
      const btn = document.createElement("button");
      btn.className = "btn-mini";
      btn.type = "button";
      btn.textContent = "entfernen";
      btn.addEventListener("click", () => gameService.entferneKiMitspieler(s.id));
      li.appendChild(btn);
    }
    liste.appendChild(li);
  });

  const genug = zustand.spieler.length >= zustand.minSpieler;
  el("btn-spiel-starten").style.display = zustand.istHost ? "block" : "none";
  el("btn-spiel-starten").disabled = !genug;
  el("btn-ki-hinzufuegen").style.display = zustand.istHost && zustand.spieler.length < zustand.maxSpieler ? "block" : "none";
  el("lobby-einstellungen").style.display = zustand.istHost ? "block" : "none";
  el("lobby-warte-hinweis").textContent = genug
    ? (zustand.istHost ? "" : "Warte auf den Start …")
    : `Noch ${zustand.minSpieler - zustand.spieler.length} Mitspielende nötig (oder KI hinzufügen).`;

  // Der Modus bestimmt, welche Einstellungen überhaupt etwas bewirken. Was im gewählten Modus
  // wirkungslos wäre, wird ausgeblendet statt nur ignoriert — sonst stellt man Diskussionszeit
  // für ein Spiel ohne Besprechung ein und wundert sich.
  const versteckt = zustand.einstellungen.modus === "verstecken";
  document.querySelectorAll("[data-nur-klassisch]").forEach(n => { n.style.display = versteckt ? "none" : ""; });
  document.querySelectorAll("[data-nur-verstecken]").forEach(n => { n.style.display = versteckt ? "" : "none"; });

  // Auswahlfelder nur setzen, wenn sie nicht gerade bedient werden.
  if (document.activeElement && document.activeElement.tagName === "SELECT") return;
  const e = zustand.einstellungen;
  el("ein-modus").value = e.modus;
  el("ein-vorsprung").value = String(e.vorsprungSek);
  el("ein-zeitlimit").value = String(e.zeitlimitMin);
  el("ein-maulwuerfe").value = String(zustand.anzahlMaulwuerfe);
  el("ein-aufgaben").value = String(e.aufgabenProSpieler);
  el("ein-killcooldown").value = String(e.killCooldownSek);
  el("ein-notfall").value = String(e.notfallKnoepfe);
  el("ein-diskussion").value = String(e.diskussionSek);
  el("ein-abstimmung").value = String(e.abstimmungSek);
  el("ein-tempo").value = String(e.tempo);
  el("ein-rolle-rauswurf").value = String(e.rolleNachRauswurf ? 1 : 0);
  el("ein-rolle-ingenieur").value = String(e.rolleIngenieur ? 1 : 0);
  el("ein-rolle-wissenschaftler").value = String(e.rolleWissenschaftler ? 1 : 0);
  el("ein-rolle-schutzengel").value = String(e.rolleSchutzengel ? 1 : 0);
  el("ein-rolle-gestaltwandler").value = String(e.rolleGestaltwandler ? 1 : 0);
}

function renderReveal(zustand) {
  const karteEl = el("reveal-karte");
  if (!zustand.meineRolle) {
    karteEl.className = "reveal-karte";
    el("reveal-icon").textContent = "❓";
    el("reveal-rolle").textContent = "Rolle wird gezogen …";
    el("reveal-text").textContent = "Dein Gerät zieht gerade verdeckt eine Rolle aus dem gemischten Stapel.";
    el("reveal-team").textContent = "";
    return;
  }
  // Verstecken-Modus: hier ist nichts geheim. Beide Seiten erfahren denselben Namen — das
  // Spannende ist nicht, WER der Fänger ist, sondern wo er gerade steckt.
  if (zustand.versteckModus) {
    const faenger = zustand.spieler.find(s => s.id === zustand.faengerUid);
    const binFaenger = zustand.meineRolle === "maulwurf";
    karteEl.className = "reveal-karte " + (binFaenger ? "maulwurf" : "team");
    el("reveal-icon").textContent = binFaenger ? "🥅" : "🙈";
    el("reveal-rolle").textContent = binFaenger ? "Du bist der Fänger" : "Versteck dich!";
    el("reveal-text").textContent = binFaenger
      ? "Alle wissen, wer du bist. Dafür siehst du selbst kaum etwas – die Nähe-Anzeige führt dich."
      : "Erledigt eure Aufgaben oder haltet einfach durch, bis die Zeit um ist. Besprechungen gibt es keine.";
    el("reveal-team").textContent = binFaenger
      ? `Du bekommst ${zustand.einstellungen.vorsprungSek} Sekunden Vorsprung – so lange stehst du fest.`
      : faenger ? `Der Fänger ist: ${faenger.name}` : "Der Fänger wird gerade ausgelost …";
  } else if (zustand.meineRolle === "maulwurf") {
    karteEl.className = "reveal-karte maulwurf";
    el("reveal-icon").textContent = "🕵️";
    el("reveal-rolle").textContent = "Du bist Maulwurf";
    el("reveal-text").textContent = "Tu so, als würdest du arbeiten. Sabotiere, schalte Leute aus – und lass dich nicht erwischen.";
    const mit = zustand.maulwurfTeam
      .filter(uid => uid !== zustand.eigenerSpielerId)
      .map(uid => (zustand.spieler.find(s => s.id === uid) || {}).name)
      .filter(Boolean);
    el("reveal-team").textContent = mit.length ? "Mit dir im Bunde: " + mit.join(", ") : "Du bist allein unterwegs.";
  } else {
    karteEl.className = "reveal-karte team";
    el("reveal-icon").textContent = "⚽";
    el("reveal-rolle").textContent = "Du gehörst zum Team";
    el("reveal-text").textContent = "Erledige deine Aufgaben auf dem Gelände und finde heraus, wer sabotiert.";
    el("reveal-team").textContent = `Achtung: ${zustand.anzahlMaulwuerfe === 1 ? "Ein Maulwurf ist" : zustand.anzahlMaulwuerfe + " Maulwürfe sind"} unter euch.`;
  }

  // Sonderrolle überschreibt Symbol und Überschrift, behält aber die Seitenfarbe der Karte —
  // die Zugehörigkeit ist die wichtigere Information und darf nicht untergehen.
  const sonder = zustand.meineSonderrolle && rollenModul.sonderrolleInfo(zustand.meineSonderrolle);
  if (sonder) {
    el("reveal-icon").textContent = sonder.icon;
    el("reveal-rolle").textContent = "Du bist " + sonder.name;
    el("reveal-text").textContent = sonder.beschreibung;
  }
}

function renderMeeting(zustand) {
  const meeting = zustand.meeting;
  const rest = Math.max(Math.ceil((meeting.endeAt - zustand.jetzt) / 1000), 0);
  el("meeting-timer").textContent = rest;

  const wechsel = letzteMeetingUnterphase !== meeting.unterphase;
  letzteMeetingUnterphase = meeting.unterphase;
  if (wechsel && meeting.unterphase === "abstimmung") meineStimme = null;

  el("meeting-anlass").textContent = meeting.grund === "leiche"
    ? `${escapeHtml(meeting.ausgeloestVon)} hat ${escapeHtml(meeting.opferName || "jemanden")} gefunden.`
    : `${escapeHtml(meeting.ausgeloestVon)} hat den Notfallknopf gedrückt.`;

  el("meeting-diskussion").style.display = meeting.unterphase === "diskussion" ? "block" : "none";
  el("meeting-abstimmung").style.display = meeting.unterphase === "abstimmung" ? "block" : "none";
  el("meeting-ergebnis").style.display = meeting.unterphase === "ergebnis" ? "block" : "none";

  el("meeting-titel").textContent = meeting.unterphase === "diskussion" ? "🗣️ Besprechung"
    : meeting.unterphase === "abstimmung" ? "🗳️ Abstimmung" : "📢 Ergebnis";

  if (meeting.unterphase === "diskussion") renderChat(zustand);
  if (meeting.unterphase === "abstimmung") renderAbstimmung(zustand);
  if (meeting.unterphase === "ergebnis") renderMeetingErgebnis(zustand);
}

function renderChat(zustand) {
  const box = el("chat-verlauf");
  box.innerHTML = zustand.chat.map(n =>
    `<p class="chat-zeile"><span class="cn" style="color:${escapeHtml(n.farbe || "#111827")}">${escapeHtml(n.name)}:</span> ${escapeHtml(n.text)}</p>`
  ).join("");
  box.scrollTop = box.scrollHeight;
  el("input-chat").disabled = zustand.binGeist;
  el("btn-chat-senden").disabled = zustand.binGeist;
  el("input-chat").placeholder = zustand.binGeist ? "Geister können nicht reden …" : "Nachricht …";
}

function renderAbstimmung(zustand) {
  const liste = el("stimm-liste");
  const stimmen = (zustand.meeting.stimmen) || {};
  liste.innerHTML = "";

  zustand.spieler.forEach(s => {
    const li = document.createElement("li");
    const anzahl = Object.keys(stimmen).filter(uid => stimmen[uid] === s.id).length;
    li.className = (s.lebt === false ? "tot " : "") + (meineStimme === s.id ? "gewaehlt" : "");
    li.innerHTML = `
      <span class="spieler-avatar" style="background:${escapeHtml(s.farbe)}">${escapeHtml(avatarInitiale(s.name))}</span>
      <span class="spieler-name">${escapeHtml(s.name)}${s.lebt === false ? " (raus)" : ""}</span>
      <span class="stimm-zaehler">${anzahl > 0 ? "▮".repeat(anzahl) : ""}</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "wählen";
    btn.disabled = s.lebt === false || zustand.binGeist || !!stimmen[zustand.eigenerSpielerId];
    btn.addEventListener("click", async () => {
      const ergebnis = await gameService.stimmeAb(s.id);
      if (ergebnis.erfolg) { meineStimme = s.id; renderAbstimmung(gameService.getZustand()); }
    });
    li.appendChild(btn);
    liste.appendChild(li);
  });

  const habeGestimmt = !!stimmen[zustand.eigenerSpielerId];
  el("btn-stimme-skip").disabled = zustand.binGeist || habeGestimmt;
  const lebende = zustand.spieler.filter(s => s.lebt !== false).length;
  const abgegeben = Object.keys(stimmen).length;
  el("abstimmung-status").textContent = zustand.binGeist
    ? "Als Geist stimmst du nicht mit ab."
    : habeGestimmt ? `Stimme abgegeben – ${abgegeben} von ${lebende}` : `${abgegeben} von ${lebende} haben gewählt`;
}

function renderMeetingErgebnis(zustand) {
  const ergebnis = zustand.meeting.ergebnis || {};
  el("ergebnis-text").textContent = ergebnis.ausgeschlossenName
    ? `${ergebnis.ausgeschlossenName} muss gehen.`
    : "Niemand muss gehen.";
  // Ohne die Einstellung bliebe hier für immer "Wird geprüft …" stehen, weil dann niemand
  // warMaulwurf schreibt.
  const deckeAuf = !!zustand.einstellungen.rolleNachRauswurf;
  el("ergebnis-rolle").textContent = !ergebnis.ausgeschlossenName
    ? "Stimmengleichheit oder Mehrheit fürs Überspringen."
    : !deckeAuf ? "Ob das richtig war, bleibt offen."
    : ergebnis.warMaulwurf === undefined ? "Wird geprüft …"
    : ergebnis.warMaulwurf ? "🕵️ … und war tatsächlich ein Maulwurf!" : "⚽ … war kein Maulwurf.";
  gameService.deckeAusgeschlosseneRolleAuf();
}

function renderEnde(zustand) {
  const teamGewinnt = zustand.sieger === "team";
  el("ende-titel").textContent = zustand.versteckModus
    ? (teamGewinnt ? "🙈 Die Versteckten gewinnen!" : "🥅 Der Fänger gewinnt!")
    : (teamGewinnt ? "⚽ Das Team gewinnt!" : "🕵️ Die Maulwürfe gewinnen!");
  const seite = el("ende-seite");
  seite.className = "sieger-name " + (zustand.sieger || "");
  const habeGewonnen = (teamGewinnt && zustand.meineRolle === "team") || (!teamGewinnt && zustand.meineRolle === "maulwurf");
  seite.textContent = zustand.meineRolle ? (habeGewonnen ? "Du hast gewonnen 🎉" : "Du hast verloren") : "";
  el("ende-grund").textContent = zustand.siegGrund || "";

  const liste = el("ende-aufdeckung");
  const aufdeckung = zustand.aufdeckung || {};
  liste.innerHTML = "";
  zustand.spieler.forEach(s => {
    const rolle = aufdeckung[s.id];
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="spieler-avatar" style="background:${escapeHtml(s.farbe)}">${escapeHtml(avatarInitiale(s.name))}</span>
      <span class="spieler-name">${escapeHtml(s.name)}</span>
      <span class="spieler-badge">${rolle === "maulwurf" ? (zustand.versteckModus ? "🥅 Fänger" : "🕵️ Maulwurf")
                                  : rolle === "team" ? (zustand.versteckModus ? "🙈 Versteckt" : "⚽ Team")
                                  : "– unbekannt"}</span>`;
    liste.appendChild(li);
  });

  el("btn-neue-runde").style.display = zustand.istHost ? "block" : "none";
}

// ============================================================
// Bestenliste + Admin-Gate
// ============================================================

async function zeigeBestenliste() {
  showScreen("screen-bestenliste");
  const koerper = el("bestenliste-koerper");
  koerper.innerHTML = "";
  el("btn-bestenliste-zuruecksetzen").style.display = istAdmin ? "block" : "none";

  const eintraege = await gameService.ladeBestenliste();
  el("bestenliste-leer").style.display = eintraege.length === 0 ? "block" : "none";
  eintraege.forEach(eintrag => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(eintrag.name)}</td><td>${eintrag.gespielt}</td><td>${eintrag.gewonnen}</td><td>${eintrag.prozent}%</td>`;
    koerper.appendChild(tr);
  });
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
  if (el("screen-bestenliste").classList.contains("active")) zeigeBestenliste();
}

// ============================================================
// Event-Wiring
// ============================================================

el("btn-raum-erstellen").addEventListener("click", () => {
  ausstehenderModus = "erstellen";
  el("input-spielername").value = "";
  el("name-eingabe-fehler").textContent = "";
  showScreen("screen-name-eingabe");
});

el("btn-raum-beitreten").addEventListener("click", () => {
  const code = el("input-raumcode").value.trim();
  if (!code) { el("start-fehler").textContent = "Bitte einen Raum-Code eingeben."; return; }
  el("start-fehler").textContent = "";
  raumcodeEingabe = code;
  ausstehenderModus = "beitreten";
  el("input-spielername").value = "";
  el("name-eingabe-fehler").textContent = "";
  showScreen("screen-name-eingabe");
});

el("input-raumcode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });

el("btn-name-bestaetigen").addEventListener("click", async () => {
  const name = el("input-spielername").value.trim();
  // Vollbild muss aus einer Nutzergeste heraus angefordert werden. Dieser Klick ist der
  // einzige, den ALLE machen – wer nur beitritt, tippt später nichts mehr an, bis die Partie
  // schon läuft. Bewusst vor dem await, sonst gilt die Geste als abgelaufen.
  betreteVollbild();
  const ergebnis = ausstehenderModus === "erstellen"
    ? await gameService.erstelleRaum(name)
    : await gameService.tritRaumBei(raumcodeEingabe, name);
  if (!ergebnis.erfolg) el("name-eingabe-fehler").textContent = ergebnis.fehler || "Das hat nicht funktioniert.";
});

el("btn-vollbild").addEventListener("click", () => {
  if (vollbildAktiv()) verlasseVollbild(); else betreteVollbild();
});

el("btn-querformat-egal").addEventListener("click", () => {
  querformatHinweisWeggetippt = true;
  pruefeAusrichtung();
});

el("btn-name-zurueck").addEventListener("click", () => showScreen("screen-start"));
el("btn-bestenliste-oeffnen").addEventListener("click", zeigeBestenliste);
el("btn-ende-bestenliste").addEventListener("click", zeigeBestenliste);
el("btn-bestenliste-zurueck").addEventListener("click", () => render(gameService.getZustand()));

el("btn-bestenliste-zuruecksetzen").addEventListener("click", async () => {
  if (!window.confirm("Bestenliste wirklich unwiderruflich zurücksetzen?")) return;
  await gameService.setzeBestenlisteZurueck();
  zeigeBestenliste();
});

el("btn-ki-hinzufuegen").addEventListener("click", () => gameService.fuegeKiMitspielerHinzu());
el("btn-spiel-starten").addEventListener("click", async () => {
  const ergebnis = await gameService.starteSpiel();
  if (!ergebnis.erfolg && ergebnis.fehler) el("lobby-warte-hinweis").textContent = ergebnis.fehler;
});

[["ein-maulwuerfe", "anzahlMaulwuerfe"], ["ein-aufgaben", "aufgabenProSpieler"], ["ein-killcooldown", "killCooldownSek"],
 ["ein-notfall", "notfallKnoepfe"], ["ein-diskussion", "diskussionSek"], ["ein-abstimmung", "abstimmungSek"],
 ["ein-tempo", "tempo"], ["ein-rolle-rauswurf", "rolleNachRauswurf"],
 ["ein-rolle-ingenieur", "rolleIngenieur"], ["ein-rolle-wissenschaftler", "rolleWissenschaftler"],
 ["ein-rolle-schutzengel", "rolleSchutzengel"], ["ein-rolle-gestaltwandler", "rolleGestaltwandler"],
 ["ein-vorsprung", "vorsprungSek"], ["ein-zeitlimit", "zeitlimitMin"]].forEach(([feldId, schluessel]) => {
  el(feldId).addEventListener("change", e => {
    gameService.speichereEinstellungen({ [schluessel]: parseInt(e.target.value, 10) });
  });
});

// Der Spielmodus ist die einzige Einstellung mit einem Text statt einer Zahl — deshalb ein
// eigener Handler und kein parseInt. In der Datenbank steht damit "verstecken" statt einer 1,
// was beim Nachsehen im Zweifelsfall den Unterschied macht.
el("ein-modus").addEventListener("change", e => {
  gameService.speichereEinstellungen({ modus: e.target.value === "verstecken" ? "verstecken" : "klassisch" });
});

el("btn-interaktion").addEventListener("click", fuehreAktionAus);
el("btn-aufgabenliste").addEventListener("click", oeffneAufgabenliste);
el("btn-rollenfaehigkeit").addEventListener("click", oeffneRollenPanel);
el("btn-rolle-schliessen").addEventListener("click", schliesseOverlay);
el("btn-sabotage").addEventListener("click", oeffneSabotageMenue);
el("btn-liste-schliessen").addEventListener("click", schliesseOverlay);
el("btn-sabotage-schliessen").addEventListener("click", schliesseOverlay);
el("btn-aufgabe-schliessen").addEventListener("click", schliesseOverlay);

el("btn-sab-flutlicht").addEventListener("click", async () => {
  const ergebnis = await gameService.sabotiere("flutlicht");
  el("sabotage-hinweis").textContent = ergebnis.erfolg ? "Flutlicht ist aus." : (ergebnis.fehler || "Geht gerade nicht.");
  if (ergebnis.erfolg) setTimeout(schliesseOverlay, 500);
});

el("btn-sab-heizung").addEventListener("click", async () => {
  const ergebnis = await gameService.sabotiere("heizung");
  el("sabotage-hinweis").textContent = ergebnis.erfolg ? "Heizung überdreht." : (ergebnis.fehler || "Geht gerade nicht.");
  if (ergebnis.erfolg) setTimeout(schliesseOverlay, 500);
});

el("btn-ausschalten").addEventListener("click", async () => {
  const ziel = findeKillZiel(gameService.getZustand());
  if (!ziel) return;
  const ergebnis = await gameService.schalteAus(ziel.id);
  if (!ergebnis.erfolg && ergebnis.fehler) el("hud-raumname").textContent = ergebnis.fehler;
});

el("btn-melden").addEventListener("click", async () => {
  const leicheUid = findeMeldbareLeiche(gameService.getZustand());
  if (leicheUid) await gameService.meldeLeiche(leicheUid);
});

el("btn-chat-senden").addEventListener("click", async () => {
  const eingabe = el("input-chat");
  if (!eingabe.value.trim()) return;
  await gameService.sendeChat(eingabe.value);
  eingabe.value = "";
});

el("input-chat").addEventListener("keydown", e => {
  if (e.key === "Enter") el("btn-chat-senden").click();
});

el("btn-stimme-skip").addEventListener("click", async () => {
  const ergebnis = await gameService.stimmeAb("skip");
  if (ergebnis.erfolg) { meineStimme = "skip"; renderAbstimmung(gameService.getZustand()); }
});

el("btn-neue-runde").addEventListener("click", () => gameService.neueRunde());
el("btn-ende-verlassen").addEventListener("click", () => gameService.raeumeRaumAuf());
el("btn-abbruch-zurueck").addEventListener("click", () => gameService.raeumeRaumAuf());

el("btn-spiel-abbrechen").addEventListener("click", async () => {
  const zustand = gameService.getZustand();
  const frage = zustand.istHost && zustand.phase !== "lobby"
    ? "Partie wirklich beenden? Sie ist damit für alle vorbei."
    : "Wirklich verlassen?";
  if (!window.confirm(frage)) return;
  await gameService.verlasseSpiel();
});

// Schnellphrasen für die Diskussion (schneller als tippen, gerade im fahrenden Bus)
const schnellBox = el("chat-schnell");
SCHNELL_PHRASEN.forEach(text => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.addEventListener("click", () => gameService.sendeChat(text));
  schnellBox.appendChild(btn);
});

richteJoystickEin();
aktualisiereVollbildKnopf();
gameService.onZustandsAenderung(render);
pruefeAdminStatus();
laufAnimation = requestAnimationFrame(schleife);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- Info-Tab / Versionshistorie ----------
const APP_VERSION = "1.0";
const APP_CHANGELOG = [
  {
    version: "1.0",
    groups: [
      { title: "Spielen", items: [
          "Verräterspiel für 4 bis 10 Mitspielende auf dem Vereinsgelände, live auf allen Handys.",
          "Das Gelände ist dem Original-Grundriss von Among Us nachempfunden: 14 Räume, ein Drehkreuz in der Mitte, ein Rundlauf außen herum – und zwei Sackgassen (Hausmeisterloge, Sanitätsraum) mit nur einer Tür.",
          "Wände nehmen die Sicht: Wer hinter einer Mauer steht, ist nicht zu sehen – nur durch offene Türen fällt Licht in den Nachbarraum. Auch ein Foulspiel quer durch die Wand geht nicht mehr.",
          "25 verschiedene Aufgaben-Minispiele an 50 Stationen – jede Runde ist anders zusammengesetzt.",
          "Fünf Aufgaben sind sichtbar (👁): wer dabei zusieht, weiß, dass wirklich gearbeitet wurde – bei Maulwürfen passiert nichts. Das einzige harte Alibi im Spiel.",
          "Maulwürfe können Leute ausschalten, Abkürzungen nehmen, das Flutlicht kappen, die Heizung überdrehen und Räume verriegeln.",
          "Besprechung per Chat mit Schnellphrasen, danach Abstimmung – Ausgeschlossene spielen als Geist weiter und arbeiten ihre Aufgaben zu Ende.",
          "Einstellbar, ob nach einem Rauswurf verraten wird, ob es wirklich ein Maulwurf war."
      ]},
      { title: "Zwei Spielmodi", items: [
          "🕵️ Klassisch: verdeckte Maulwürfe, Leiche melden, Besprechung und Abstimmung – das volle Spiel.",
          "🥅 Verstecken: genau ein Fänger, von Beginn an für alle sichtbar. Keine Besprechung, keine Abstimmung, keine Sabotage.",
          "Im Verstecken-Modus dreht sich die Sicht um: Der Fänger sieht am wenigsten und tastet sich an einer Nähe-Anzeige entlang, die nur die Entfernung verrät, nie die Richtung.",
          "Das Team gewinnt durch alle Aufgaben oder indem es die Zeit übersteht; der Fänger, wenn er alle erwischt hat. Vorsprung und Zeitlimit sind einstellbar."
      ]},
      { title: "Am Handy", items: [
          "Quer halten: Das Spielfeld läuft formatfüllend über den ganzen Bildschirm.",
          "Vollbild lässt sich jederzeit über das Symbol oben rechts ein- und ausschalten."
      ]},
      { title: "Sonderrollen (einzeln zuschaltbar)", items: [
          "🔧 Ingenieur: darf die Abkürzungen benutzen wie ein Maulwurf – wer ihn dabei sieht, hält ihn für einen.",
          "🔬 Wissenschaftler: sieht jederzeit, wer noch lebt, auch ohne die Leiche gefunden zu haben.",
          "😇 Schutzengel: kann nach dem eigenen Ausscheiden Lebende kurz schützen – ein Foulspiel geht dann daneben.",
          "🎭 Gestaltwandler: Maulwurf, der zeitweise wie jemand anderes aussieht. Nur seine Mitmaulwürfe erkennen ihn."
      ]},
      { title: "Fair verteilt", items: [
          "Die Rollen zieht jedes Handy selbst aus einem anonym gemischten Stapel – auch das Gerät der Gastgeberin oder des Gastgebers erfährt nichts.",
          "Fremde Rollen sind serverseitig gesperrt, nicht nur ausgeblendet."
      ]},
      { title: "Drumherum", items: [
          "Bestenliste über alle Partien.",
          "KI-Mitspieler zum Ausprobieren, wenn gerade niemand sonst da ist.",
          "Neue Runde mit denselben Leuten und neu gemischten Rollen."
      ]}
    ]
  }
];

function activateTab(name) {
  document.querySelectorAll("nav.tabs button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-section").forEach(s => s.classList.toggle("active", s.id === "tab-" + name));
}

function renderVersionInfo() {
  document.querySelectorAll("#version-badge, #version-badge-2").forEach(elem => { if (elem) elem.textContent = "v" + APP_VERSION; });
  const box = el("changelog-list");
  if (!box) return;
  box.innerHTML = APP_CHANGELOG.map(entry => `
    <div class="changelog-entry">
      <div class="cv">Version ${entry.version}</div>
      ${entry.groups.map(g => `
        <div class="cgt">${g.title}</div>
        <ul>${g.items.map(i => `<li>${i}</li>`).join("")}</ul>`).join("")}
    </div>`).join("");
}

function setupInfoTab() {
  document.querySelectorAll("nav.tabs button[data-tab]").forEach(b => {
    b.addEventListener("click", () => activateTab(b.dataset.tab));
  });
  const badge = el("version-badge");
  if (badge) {
    badge.addEventListener("click", () => activateTab("info"));
    badge.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateTab("info"); }
    });
  }
  renderVersionInfo();
}

document.addEventListener("DOMContentLoaded", setupInfoTab);
