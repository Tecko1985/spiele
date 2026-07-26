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
const SICHT_KURZE_ACHSE = 620;
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
  if (zustand.meineRolle === "maulwurf") return karte.SICHT_MAULWURF;
  const sab = zustand.sabotage;
  if (sab && sab.typ === "flutlicht") return karte.SICHT_TEAM_DUNKEL;
  return karte.SICHT_TEAM;
}

function zeichne(zustand) {
  if (!passeCanvasAn()) return;
  const mich = zustand.meinePosition || { x: karte.WELT_BREITE / 2, y: karte.WELT_HOEHE / 2 };
  const skala = Math.min(canvas.width, canvas.height) / SICHT_KURZE_ACHSE;
  const versatzX = canvas.width / 2 - mich.x * skala;
  const versatzY = canvas.height / 2 - mich.y * skala;

  const wx = x => x * skala + versatzX;
  const wy = y => y * skala + versatzY;

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Gänge zuerst, dann die Räume mit ihrer Umrandung, zuletzt die Türschwellen: die Schwellen
  // liegen bewusst ÜBER der Raumlinie und stanzen so die Öffnung in die gezeichnete Wand.
  ctx.fillStyle = "#243044";
  karte.KORRIDORE.forEach(k => ctx.fillRect(wx(k.x), wy(k.y), k.w * skala, k.h * skala));

  const jetzt = zustand.jetzt;
  karte.RAEUME.forEach(r => {
    const gesperrt = (zustand.tueren || {})[r.id] > jetzt;
    ctx.fillStyle = gesperrt ? "#3a2230" : "#2c3a52";
    ctx.fillRect(wx(r.x), wy(r.y), r.w * skala, r.h * skala);
    ctx.strokeStyle = gesperrt ? "#dc2626" : "#48597a";
    ctx.lineWidth = Math.max(2.5 * skala, 2);
    ctx.strokeRect(wx(r.x), wy(r.y), r.w * skala, r.h * skala);
    ctx.fillStyle = "rgba(255,255,255,0.36)";
    ctx.font = `${Math.round(26 * skala)}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(r.name, wx(r.x + r.w / 2), wy(r.y + 40));
  });

  ctx.fillStyle = "#33415c";
  karte.TUEREN.forEach(t => ctx.fillRect(wx(t.x), wy(t.y), t.w * skala, t.h * skala));

  // Notfallknopf
  zeichneMarker(wx(karte.NOTFALLKNOPF.x), wy(karte.NOTFALLKNOPF.y), skala, "#dc2626", "📣");

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

  // Abkürzungen nur für Maulwürfe
  if (zustand.meineRolle === "maulwurf") {
    karte.TUNNEL.forEach(t => {
      zeichneMarker(wx(t.a.x), wy(t.a.y), skala, "#a855f7", "↧");
      zeichneMarker(wx(t.b.x), wy(t.b.y), skala, "#a855f7", "↥");
    });
  }

  // Leichen
  Object.keys(zustand.leichen || {}).forEach(uid => {
    const leiche = zustand.leichen[uid];
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
  const sichtweite = sichtweiteFuer(zustand);
  zustand.spieler.forEach(s => {
    const eigenerZug = s.id === zustand.eigenerSpielerId;
    const pos = eigenerZug ? mich : angezeigtePositionen[s.id];
    if (!pos || s.lebt === false) return;
    if (!eigenerZug && karte.abstand(pos.x, pos.y, mich.x, mich.y) > sichtweite) return;
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

  if (!zustand.binGeist) zeichneNebel(wx(mich.x), wy(mich.y), sichtweite * skala);
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

function zeichneFigur(x, y, skala, spieler, zustand) {
  const istIch = spieler.id === zustand.eigenerSpielerId;
  const istMitMaulwurf = zustand.meineRolle === "maulwurf" && zustand.maulwurfTeam.indexOf(spieler.id) !== -1;

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
  ctx.fillText(spieler.name.slice(0, 12), x, y - 26 * skala);
}

// Nebel: alles außerhalb des Sichtkreises abdunkeln. Der Kreis wird als zweiter, gegenläufig
// gezeichneter Pfad ausgestanzt (evenodd).
function zeichneNebel(x, y, radius) {
  const rand = ctx.createRadialGradient(x, y, radius * 0.72, x, y, radius);
  rand.addColorStop(0, "rgba(5,10,20,0)");
  rand.addColorStop(1, "rgba(5,10,20,0.96)");

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(x, y, radius, 0, Math.PI * 2, true);
  ctx.fillStyle = "rgba(5,10,20,0.96)";
  ctx.fill("evenodd");
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = rand;
  ctx.fill();
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

function ermittleAktion(zustand) {
  const pos = zustand.meinePosition;
  if (!pos || zustand.binGeist) return null;
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
  if (!zustand.meeting && (zustand.eigener.notfallUebrig || 0) > 0 &&
      karte.abstand(pos.x, pos.y, karte.NOTFALLKNOPF.x, karte.NOTFALLKNOPF.y) <= karte.INTERAKTIONS_RADIUS) {
    return { typ: "notfall", zeichen: "📣", label: "Notfallknopf" };
  }

  const offeneIds = zustand.meineAufgaben.filter(a => !a.erledigt).map(a => a.id);
  const station = karte.stationAn(pos.x, pos.y, offeneIds);
  if (station) return { typ: "aufgabe", station, zeichen: "🛠️", label: stationName(station) };

  if (zustand.meineRolle === "maulwurf") {
    const tunnel = karte.tunnelAn(pos.x, pos.y);
    if (tunnel) return { typ: "tunnel", ziel: tunnel.ziel, zeichen: "↧", label: tunnel.tunnel.name };
  }
  return null;
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
    if (d <= besterAbstand) { besterAbstand = d; bestes = s; }
  });
  return bestes;
}

function findeMeldbareLeiche(zustand) {
  if (zustand.binGeist) return null;
  const pos = zustand.meinePosition;
  if (!pos) return null;
  const leichen = zustand.leichen || {};
  return Object.keys(leichen).find(uid => {
    const l = leichen[uid];
    return !l.gemeldet && karte.abstand(pos.x, pos.y, l.x, l.y) <= karte.INTERAKTIONS_RADIUS;
  }) || null;
}

function aktualisiereHud(zustand) {
  const pos = zustand.meinePosition;
  el("hud-raumname").textContent = pos ? karte.raumName(pos.x, pos.y) : "";

  const rolleEl = el("hud-rolle");
  rolleEl.className = "hud-rolle " + (zustand.meineRolle || "");
  rolleEl.textContent = zustand.binGeist
    ? "👻 Geist"
    : zustand.meineRolle === "maulwurf" ? "🕵️ Maulwurf" : zustand.meineRolle === "team" ? "⚽ Team" : "";

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

  const killBtn = el("btn-ausschalten");
  const sabBtn = el("btn-sabotage");
  if (zustand.meineRolle === "maulwurf" && !zustand.binGeist) {
    killBtn.style.display = "flex";
    sabBtn.style.display = "flex";
    const rest = Math.max(Math.ceil((zustand.killCooldownBis - zustand.jetzt) / 1000), 0);
    const ziel = findeKillZiel(zustand);
    killBtn.disabled = !ziel || rest > 0;
    killBtn.textContent = rest > 0 ? rest : "🥾";
    sabBtn.disabled = (zustand.sabotageCooldownBis || 0) > zustand.jetzt;
  } else {
    killBtn.style.display = "none";
    sabBtn.style.display = "none";
  }
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
    const li = document.createElement("li");
    li.className = a.erledigt ? "erledigt" : "";
    li.innerHTML = `<span>${a.erledigt ? "✅" : "⬜"}</span>
      <span>${escapeHtml(stationName(a.station))}</span>
      <span class="ort">${escapeHtml(raumNameZu(a.station.raum))}</span>`;
    liste.appendChild(li);
  });
  el("aufgaben-liste-hinweis").textContent = zustand.meineRolle === "maulwurf"
    ? "Du bist Maulwurf – diese Aufgaben zählen nicht, sehen aber echt aus."
    : `Gemeinsamer Fortschritt: ${zustand.aufgaben.erledigt} von ${zustand.aufgaben.gesamt}`;
  el("overlay-liste").classList.add("aktiv");
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

  // Auswahlfelder nur setzen, wenn sie nicht gerade bedient werden.
  if (document.activeElement && document.activeElement.tagName === "SELECT") return;
  const e = zustand.einstellungen;
  el("ein-maulwuerfe").value = String(zustand.anzahlMaulwuerfe);
  el("ein-aufgaben").value = String(e.aufgabenProSpieler);
  el("ein-killcooldown").value = String(e.killCooldownSek);
  el("ein-notfall").value = String(e.notfallKnoepfe);
  el("ein-diskussion").value = String(e.diskussionSek);
  el("ein-abstimmung").value = String(e.abstimmungSek);
  el("ein-tempo").value = String(e.tempo);
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
  if (zustand.meineRolle === "maulwurf") {
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
  el("ergebnis-rolle").textContent = ergebnis.ausgeschlossenName
    ? (ergebnis.warMaulwurf === undefined ? "Wird geprüft …"
       : ergebnis.warMaulwurf ? "🕵️ … und war tatsächlich ein Maulwurf!" : "⚽ … war kein Maulwurf.")
    : "Stimmengleichheit oder Mehrheit fürs Überspringen.";
  gameService.deckeAusgeschlosseneRolleAuf();
}

function renderEnde(zustand) {
  const teamGewinnt = zustand.sieger === "team";
  el("ende-titel").textContent = teamGewinnt ? "⚽ Das Team gewinnt!" : "🕵️ Die Maulwürfe gewinnen!";
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
      <span class="spieler-badge">${rolle === "maulwurf" ? "🕵️ Maulwurf" : rolle === "team" ? "⚽ Team" : "– unbekannt"}</span>`;
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
 ["ein-tempo", "tempo"]].forEach(([feldId, schluessel]) => {
  el(feldId).addEventListener("change", e => {
    gameService.speichereEinstellungen({ [schluessel]: parseInt(e.target.value, 10) });
  });
});

el("btn-interaktion").addEventListener("click", fuehreAktionAus);
el("btn-aufgabenliste").addEventListener("click", oeffneAufgabenliste);
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
          "16 Räume, über Flure und Türen verbunden, mit begrenztem Sichtfeld.",
          "25 verschiedene Aufgaben-Minispiele an 50 Stationen – jede Runde ist anders zusammengesetzt.",
          "Maulwürfe können Leute ausschalten, Abkürzungen nehmen, das Flutlicht kappen, die Heizung überdrehen und Räume verriegeln.",
          "Besprechung per Chat mit Schnellphrasen, danach Abstimmung – Ausgeschlossene spielen als Geist weiter."
      ]},
      { title: "Am Handy", items: [
          "Quer halten: Das Spielfeld läuft formatfüllend über den ganzen Bildschirm.",
          "Vollbild lässt sich jederzeit über das Symbol oben rechts ein- und ausschalten."
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
