// Steuert ausschließlich Screens/Rendering/Events + die Wisch-Gesten. Redet nur über die
// gameService-API (siehe game-service.js) mit Firebase.

const SCREEN_FUER_PHASE = {
  start: "screen-start",
  lobby: "screen-lobby",
  bereit: "screen-bereit",
  eingabe: "screen-spiel",
  aufloesung: "screen-spiel",
  ergebnis: "screen-spiel",
  beendet: "screen-game-over",
  abgebrochen: "screen-abgebrochen"
};

const PHASEN_MIT_ABBRUCH_BUTTON = ["bereit", "eingabe", "aufloesung", "ergebnis"];
const TEXT_FUER_ERGEBNIS = { tor: "Tor! ⚽", gehalten: "Gehalten! 🧤", vorbei: "Vorbei! 😬" };

// Wisch-Gesten-Konstanten (Pixel-Referenzwerte, Tuning nach echtem Zwei-Handy-Test)
const MINDEST_BEWEGUNG_PX = 8;
const MINDEST_VORWAERTS_PX = 20;
const SCHUSS_REFERENZ_DISTANZ_PX = 140;
const SCHUSS_MAX_MACHT_ANIMATION = 1.6;
const WURF_REFERENZ_DISTANZ_PX = 100;

let ausstehenderModus = null; // "erstellen" | "beitreten"
let raumcodeEingabe = "";
let letzteEingabeRunde = null; // Rundennummer, für die Sprites schon auf Ruheposition zurückgesetzt wurden
let animierteRundenNummer = null; // Rundennummer, für die die Reveal-Animation schon lief

function getEigenerSpieler(zustand) {
  return zustand.spieler.find(s => s.id === zustand.eigenerSpielerId) || null;
}

function avatarInitiale(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

// Für alle innerHTML-Templates: Spielernamen kommen aus Firebase (Mitspieler-Eingaben) —
// ohne Escaping könnte ein Beitritt mit einem HTML-Namen Skript auf beiden Geräten ausführen.
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(el => el.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

// Browser drosseln Timer/Firebase-Listener stark, sobald der Bildschirm sperrt. Wake Lock
// hält den Bildschirm während einer aktiven Partie wach — auf BEIDEN Geräten (kein Host-
// Gerät, das besonders wach bleiben müsste, siehe Architektur-Hinweis in game-service.js).
let bildschirmWakeLock = null;

async function sichereBildschirmWach() {
  if (!("wakeLock" in navigator) || bildschirmWakeLock) return;
  try {
    bildschirmWakeLock = await navigator.wakeLock.request("screen");
    bildschirmWakeLock.addEventListener("release", () => {
      bildschirmWakeLock = null;
    });
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
  if (document.visibilityState === "visible" && gameService.getZustand().phase !== "start") {
    sichereBildschirmWach();
  }
});

// --- Rendering ---

function render(zustand) {
  if (zustand.phase === "start") {
    gibBildschirmFrei();
  } else {
    sichereBildschirmWach();
  }
  showScreen(SCREEN_FUER_PHASE[zustand.phase] || "screen-start");
  renderAbbrechenButton(zustand);
  if (zustand.phase === "lobby") renderLobby(zustand);
  if (zustand.phase === "bereit") renderBereit(zustand);
  if (zustand.phase === "eingabe" || zustand.phase === "aufloesung" || zustand.phase === "ergebnis") renderSpiel(zustand);
  if (zustand.phase === "beendet") renderGameOver(zustand);
}

function renderAbbrechenButton(zustand) {
  const btn = document.getElementById("btn-spiel-abbrechen");
  btn.style.display = PHASEN_MIT_ABBRUCH_BUTTON.includes(zustand.phase) ? "inline-block" : "none";
}

function renderLobby(zustand) {
  document.getElementById("lobby-raumcode").textContent = zustand.raumCode || "------";
  document.getElementById("lobby-zaehler").textContent = `${zustand.spieler.length}/${zustand.maxSpieler} Spieler:innen`;

  const liste = document.getElementById("lobby-spielerliste");
  liste.innerHTML = "";
  zustand.spieler.forEach(s => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="spieler-avatar" style="background:${escapeHtml(s.avatarFarbe)}">${escapeHtml(avatarInitiale(s.name))}</span>
      <span class="spieler-name">${escapeHtml(s.name)}</span>
      <span class="spieler-badge">${s.istHost ? "Gastgeber:in" : s.istSimuliert ? "🤖 KI" : ""}</span>
    `;
    liste.appendChild(li);
  });

  const eigener = getEigenerSpieler(zustand);
  const istHost = !!(eigener && eigener.istHost);
  const raumVoll = zustand.spieler.length >= zustand.maxSpieler;
  document.getElementById("btn-spiel-starten").style.display = istHost ? "block" : "none";
  document.getElementById("btn-spiel-starten").disabled = zustand.spieler.length < 2;
  document.getElementById("btn-ki-gegner-hinzufuegen").style.display = istHost && !raumVoll ? "block" : "none";
  document.getElementById("lobby-warte-hinweis").style.display = zustand.spieler.length < 2 ? "block" : "none";
  document.getElementById("lobby-modus").textContent = istHost ? "Du bist Gastgeber:in" : "";
}

function renderBereit(zustand) {
  const rolle = zustand.aktuelleRunde ? zustand.aktuelleRunde.meineRolle : null;
  document.getElementById("bereit-rundenlabel").textContent = zustand.rundenLabel;
  document.getElementById("bereit-rollentext").textContent =
    rolle === "schuetze" ? "Du schießt ⚽" : rolle === "torwart" ? "Du hältst 🧤" : "Bereit machen …";
}

function renderSpiel(zustand) {
  const runde = zustand.aktuelleRunde;
  if (!runde) return;

  document.getElementById("ep-rundenlabel").textContent = zustand.rundenLabel;
  document.getElementById("ep-punktestand").textContent = `${zustand.punkte.eigene} : ${zustand.punkte.gegner}`;

  const ballEl = document.getElementById("ep-ball");
  const torwartEl = document.getElementById("ep-torwart");

  // Sprites bei jedem NEUEN Rundenstart (Phase "eingabe" erstmals für diese Runde erreicht)
  // auf Ruheposition zurücksetzen, sonst "teleportiert" ein Sprite, das von der letzten
  // Reveal-Animation noch mitten in Bewegung war.
  if (zustand.phase === "eingabe" && letzteEingabeRunde !== runde.nummer) {
    letzteEingabeRunde = runde.nummer;
    ballEl.style.transform = "";
    torwartEl.style.transform = "";
    document.getElementById("ep-ergebnis-overlay").classList.remove("aktiv");
  }

  const binSchuetze = runde.meineRolle === "schuetze";
  const binTorwart = runde.meineRolle === "torwart";
  const inEingabe = zustand.phase === "eingabe";

  ballEl.classList.toggle("inaktiv", inEingabe && !(binSchuetze && !runde.habeIchCommittet));
  torwartEl.classList.toggle("inaktiv", inEingabe && !(binTorwart && !runde.habeIchCommittet));

  const rollentextEl = document.getElementById("ep-rollentext");
  if (inEingabe) {
    if (binSchuetze) {
      rollentextEl.textContent = runde.habeIchCommittet ? "Schuss abgegeben – warte auf den Torwart …" : "Wisch den Ball nach vorne ins Tor!";
    } else if (binTorwart) {
      rollentextEl.textContent = runde.habeIchCommittet ? "Sprung festgelegt – warte auf den Schuss …" : "Wisch in die Richtung, in die du springen willst!";
    }
  } else {
    rollentextEl.textContent = binSchuetze ? "Du warst am Schuss" : binTorwart ? "Du warst im Tor" : "";
  }

  document.getElementById("ep-gegner-status").textContent =
    inEingabe && !runde.gegnerBereit ? "Warte auf den Gegner …" : "";

  document.getElementById("btn-ep-weiter").style.display = zustand.phase === "ergebnis" ? "block" : "none";

  if ((zustand.phase === "aufloesung" || zustand.phase === "ergebnis") && animierteRundenNummer !== runde.nummer) {
    animierteRundenNummer = runde.nummer;
    animiereAufloesung(zustand);
  }
}

function renderGameOver(zustand) {
  document.getElementById("game-over-sieger").textContent = zustand.binSieger
    ? "🏆 Du hast gewonnen!"
    : `${zustand.gegnerName || "Der Gegner"} hat gewonnen.`;
  document.getElementById("game-over-endstand").textContent = `Endstand: ${zustand.punkte.eigene} : ${zustand.punkte.gegner}`;
}

// --- Reveal-Animation: Ball/Torwart per CSS-transform zur Zielposition bewegen ---
// Alles live aus getBoundingClientRect() berechnet, nichts hartkodiert, damit es bei jeder
// Bildschirmgröße stimmt. Torraum-Koordinaten: x -1..1 (linker/rechter Pfosten), y 0..1
// (Boden/Latte).

function torBereichInnerhalbSpielfeld() {
  const feldRect = document.getElementById("ep-spielfeld").getBoundingClientRect();
  const torRect = document.getElementById("ep-tor").getBoundingClientRect();
  return {
    breite: torRect.width,
    hoehe: torRect.height,
    mitteX: torRect.left - feldRect.left + torRect.width / 2,
    boden: torRect.top - feldRect.top + torRect.height
  };
}

function zielZuSpielfeldPosition(ziel, torBereich) {
  return {
    x: torBereich.mitteX + ziel.x * (torBereich.breite / 2),
    y: torBereich.boden - ziel.y * torBereich.hoehe
  };
}

function verschiebeSpriteZuZiel(el, ziel, torBereich, feldRect, zusatzTransform) {
  const ruhe = el.getBoundingClientRect();
  const ruheLokal = { x: ruhe.left - feldRect.left + ruhe.width / 2, y: ruhe.top - feldRect.top + ruhe.height / 2 };
  const zielLokal = zielZuSpielfeldPosition(ziel, torBereich);
  el.style.transform = `translate(${zielLokal.x - ruheLokal.x}px, ${zielLokal.y - ruheLokal.y}px)${zusatzTransform || ""}`;
}

function animiereAufloesung(zustand) {
  const runde = zustand.aktuelleRunde;
  if (!runde || !runde.schussZiel || !runde.wurfZiel) return;

  const feldRect = document.getElementById("ep-spielfeld").getBoundingClientRect();
  const torBereich = torBereichInnerhalbSpielfeld();

  verschiebeSpriteZuZiel(document.getElementById("ep-ball"), runde.schussZiel, torBereich, feldRect, " scale(0.65)");
  verschiebeSpriteZuZiel(document.getElementById("ep-torwart"), runde.wurfZiel, torBereich, feldRect, "");

  const overlay = document.getElementById("ep-ergebnis-overlay");
  const label = document.getElementById("ep-ergebnis-label");
  label.textContent = TEXT_FUER_ERGEBNIS[runde.ergebnis] || "";
  label.className = runde.ergebnis || "";
  overlay.classList.add("aktiv");
}

// --- Wisch-Gesten: Pointer Events, Skelett analog zu startCardDrag() in
// E:\ToolsUebersicht\app.js (pointerdown + setPointerCapture + document-weite move/up/
// cancel-Listener für die Dauer der Geste). Die Vektor-Mathematik selbst ist neu.

function richteGesteEin(element, istBerechtigtFn, onSwipeFn) {
  let start = null;

  element.addEventListener("pointerdown", e => {
    if (!istBerechtigtFn()) return;
    e.preventDefault();
    element.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  });

  element.addEventListener("pointermove", e => {
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) < MINDEST_BEWEGUNG_PX) return;
    element.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  const beenden = e => {
    if (!start || e.pointerId !== start.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    element.style.transform = ""; // optisch zurück an die Ruheposition; das eigentliche Ziel
    // fliegt erst in animiereAufloesung() sichtbar dorthin, sobald beide Seiten committet haben.
    onSwipeFn(dx, dy);
  };

  element.addEventListener("pointerup", beenden);
  element.addEventListener("pointercancel", beenden);
}

function clamp(wert, min, max) {
  return Math.min(Math.max(wert, min), max);
}

function istSchuetzeDran() {
  const z = gameService.getZustand();
  return z.phase === "eingabe" && z.aktuelleRunde && z.aktuelleRunde.meineRolle === "schuetze" && !z.aktuelleRunde.habeIchCommittet;
}

function istTorwartDran() {
  const z = gameService.getZustand();
  return z.phase === "eingabe" && z.aktuelleRunde && z.aktuelleRunde.meineRolle === "torwart" && !z.aktuelleRunde.habeIchCommittet;
}

// Schütze: muss überwiegend "nach vorne" (= nach oben auf dem Bildschirm) wischen, sonst
// wird die Geste verworfen (erzwingt "wirklich nach vorne wischen", kein versehentlicher
// Seitwärts-Tap). zielY > 1 (zu kräftig gewischt) löst später in loeseAuf() automatisch
// "vorbei" aus — bewusstes Skill/Risiko-Element, kein Zufall.
function beiBallSwipe(dx, dy) {
  const vorwaerts = -dy;
  if (vorwaerts < MINDEST_VORWAERTS_PX) return;
  const zielX = dx / SCHUSS_REFERENZ_DISTANZ_PX;
  const zielY = vorwaerts / SCHUSS_REFERENZ_DISTANZ_PX;
  const macht = clamp(zielY, 0.4, SCHUSS_MAX_MACHT_ANIMATION);
  gameService.commitSchuss(zielX, zielY, macht);
}

// Torwart: freier Vektor in jede Richtung (links/rechts/links-oben/rechts-unten, …), keine
// festen 4-Wege-Buttons.
function beiTorwartSwipe(dx, dy) {
  if (Math.hypot(dx, dy) < MINDEST_BEWEGUNG_PX) return;
  const zielX = clamp(dx / WURF_REFERENZ_DISTANZ_PX, -1.3, 1.3);
  const zielY = clamp(-dy / WURF_REFERENZ_DISTANZ_PX, 0, 1.3);
  gameService.commitWurf(zielX, zielY);
}

// --- Bestenliste ---

async function zeigeBestenliste() {
  showScreen("screen-bestenliste");
  const koerper = document.getElementById("bestenliste-koerper");
  koerper.innerHTML = "";
  document.getElementById("btn-bestenliste-zuruecksetzen").style.display = istAdmin ? "block" : "none";

  const eintraege = await gameService.ladeBestenliste();
  document.getElementById("bestenliste-leer").style.display = eintraege.length === 0 ? "block" : "none";
  eintraege.forEach(eintrag => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(eintrag.name)}</td>
      <td>${eintrag.gespielt}</td>
      <td>${eintrag.gewonnen}</td>
      <td>${eintrag.prozent}%</td>
    `;
    koerper.appendChild(tr);
  });
}

// --- Admin-Check (Bestenliste-Reset ist nur für ToolsUebersicht-Admins sichtbar) ---
// Nutzt dieselbe Anmeldung wie die ToolsUebersicht-Landingpage (gleicher Origin
// tecko1985.github.io, localStorage-Key "tu_session_token") — kein eigenes Login hier, wer
// dort als Admin angemeldet ist, sieht den Button auch hier automatisch. Reiner UI-Gate,
// keine echte Backend-Durchsetzung (siehe Kommentar in game-service.js).
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
  if (!token) {
    istAdmin = false;
    return;
  }
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
  if (document.getElementById("screen-bestenliste").classList.contains("active")) {
    zeigeBestenliste();
  } else {
    render(gameService.getZustand());
  }
}

// --- Event-Wiring ---

document.getElementById("btn-raum-erstellen").addEventListener("click", () => {
  ausstehenderModus = "erstellen";
  document.getElementById("name-eingabe-titel").textContent = "Wie heißt du?";
  document.getElementById("input-spielername").value = "";
  document.getElementById("name-eingabe-fehler").textContent = "";
  showScreen("screen-name-eingabe");
});

document.getElementById("btn-raum-beitreten").addEventListener("click", () => {
  const code = document.getElementById("input-raumcode").value.trim();
  if (!code) {
    document.getElementById("start-fehler").textContent = "Bitte einen Raum-Code eingeben.";
    return;
  }
  document.getElementById("start-fehler").textContent = "";
  raumcodeEingabe = code;
  ausstehenderModus = "beitreten";
  document.getElementById("name-eingabe-titel").textContent = "Wie heißt du?";
  document.getElementById("input-spielername").value = "";
  document.getElementById("name-eingabe-fehler").textContent = "";
  showScreen("screen-name-eingabe");
});

document.getElementById("input-raumcode").addEventListener("input", e => {
  e.target.value = e.target.value.toUpperCase();
});

document.getElementById("btn-name-bestaetigen").addEventListener("click", async () => {
  const name = document.getElementById("input-spielername").value.trim();
  const fehlerEl = document.getElementById("name-eingabe-fehler");
  const ergebnis = ausstehenderModus === "erstellen"
    ? await gameService.erstelleRaum(name)
    : await gameService.tritRaumBei(raumcodeEingabe, name);
  if (!ergebnis.erfolg) {
    fehlerEl.textContent = ergebnis.fehler || "Das hat nicht funktioniert.";
  }
});

document.getElementById("btn-name-zurueck").addEventListener("click", () => {
  showScreen("screen-start");
});

document.getElementById("btn-bestenliste-oeffnen").addEventListener("click", () => {
  zeigeBestenliste();
});

document.getElementById("btn-game-over-bestenliste").addEventListener("click", () => {
  zeigeBestenliste();
});

document.getElementById("btn-bestenliste-zurueck").addEventListener("click", () => {
  render(gameService.getZustand());
});

document.getElementById("btn-bestenliste-zuruecksetzen").addEventListener("click", async () => {
  if (!window.confirm("Bestenliste wirklich unwiderruflich zurücksetzen?")) return;
  await gameService.setzeBestenlisteZurueck();
  zeigeBestenliste();
});

document.getElementById("btn-ki-gegner-hinzufuegen").addEventListener("click", () => {
  gameService.fuegeKiGegnerHinzu();
});

document.getElementById("btn-spiel-starten").addEventListener("click", () => {
  gameService.starteSpiel();
});

document.getElementById("btn-ep-weiter").addEventListener("click", () => {
  gameService.bestaetigeWeiter();
});

document.getElementById("btn-neues-spiel").addEventListener("click", () => {
  gameService.neuesSpiel();
});

document.getElementById("btn-abbruch-zurueck").addEventListener("click", () => {
  gameService.neuesSpiel();
});

document.getElementById("btn-spiel-abbrechen").addEventListener("click", () => {
  if (!window.confirm("Spiel wirklich verlassen? Die Partie ist damit für beide vorbei.")) return;
  gameService.verlasseSpiel();
});

richteGesteEin(document.getElementById("ep-ball"), istSchuetzeDran, beiBallSwipe);
richteGesteEin(document.getElementById("ep-torwart"), istTorwartDran, beiTorwartSwipe);

gameService.onZustandsAenderung(render);
pruefeAdminStatus();

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
          "1-gegen-1 in Echtzeit: eine Seite schießt, die andere hält — beide per Wisch-Geste.",
          "Klassisches Format mit fünf Schüssen je Seite, danach Sudden Death.",
          "Das Ziel der Gegenseite wird erst bei der Auflösung sichtbar."
      ]},
      { title: "Drumherum", items: [
          "Bestenliste über alle bisherigen Duelle.",
          "Gegen eine einfache KI spielen, wenn gerade niemand sonst da ist."
      ]}
    ]
  }
];

function activateTab(name) {
  document.querySelectorAll("nav.tabs button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
}

function renderVersionInfo() {
  document.querySelectorAll("#version-badge, #version-badge-2").forEach((el) => { if (el) el.textContent = "v" + APP_VERSION; });
  const box = document.getElementById("changelog-list");
  if (!box) return;
  box.innerHTML = APP_CHANGELOG.map((entry) => `
    <div class="changelog-entry">
      <div class="cv">Version ${entry.version}</div>
      ${entry.groups.map((g) => `
        <div class="cgt">${g.title}</div>
        <ul>${g.items.map((i) => `<li>${i}</li>`).join("")}</ul>`).join("")}
    </div>`).join("");
}

function setupInfoTab() {
  document.querySelectorAll("nav.tabs button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => activateTab(b.dataset.tab));
  });
  const badge = document.getElementById("version-badge");
  if (badge) {
    badge.addEventListener("click", () => activateTab("info"));
    badge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateTab("info"); }
    });
  }
  renderVersionInfo();
}

document.addEventListener("DOMContentLoaded", setupInfoTab);
