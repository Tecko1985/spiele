// Die Aufgaben-Minispiele. Reines DOM/Timer-Modul ohne Firebase-Bezug: jede Aufgabe bekommt
// einen leeren Container, eine onFertig-Funktion und ein optionales Optionen-Objekt und gibt
// eine Aufräumfunktion zurück (Timer/Listener stoppen, falls die Aufgabe vorzeitig geschlossen
// wird — z.B. weil ein Meeting startet).
//
// Maulwürfe sehen exakt dieselben Aufgaben und können sie auch "erledigen" — nur gezählt
// wird ihr Ergebnis nicht (siehe erledigeAufgabe in game-service.js). Genau das ist der
// Bluff: wer neben einer Station steht, sieht nicht, ob dort echt gearbeitet wird.
//
// Alle Inhalte hier sind statisch (Zahlen, Emojis, feste Texte) — es fließen keine
// Spielernamen oder andere Fremdeingaben in die Templates, deshalb ist innerHTML unkritisch.
//
// Zuschnitt: jede Aufgabe soll in 5–15 Sekunden zu schaffen sein und im Querformat auf ein
// Handydisplay passen. Deshalb sind die Spielfelder flach gehalten (kein hohes Gitter) und
// alle Bedienelemente mindestens fingergroß. Ausnahmen sind die beiden Warteaufgaben, deren
// ganzer Sinn die lange Pause ist.
//
// **Bewegung läuft über verstrichene Zeit, nicht über Tick-Zählung.** In einem versteckten
// Tab drosselt der Browser Timer um Faktor 8 bis 35; würde pro Tick ein fester Betrag
// addiert, liefen Asteroiden und Zeiger dort in Zeitlupe und jeder Test wäre wertlos.
//
// Das Optionen-Objekt (dritter Parameter) trägt alles, was die Aufgabe über ihren Platz in
// einer mehrteiligen Kette wissen muss:
//   teil / teile   — 1-basierte Nummer und Gesamtzahl der Teile (z.B. Kabel 2 von 3)
//   zielRaum       — Name des Raums, in dem der nächste Teil liegt (für Strom/Daten)
//   wartenSeit     — Zeitstempel, wann die Wartezeit gestartet wurde (0 = noch nicht)
//   starteWarten() — meldet dem Spiel, dass die Wartezeit jetzt losläuft
//   jetzt()        — Serverzeit, damit die Wartezeit auf allen Geräten gleich läuft

const WARTEZEIT_SEK = 60;   // Proben analysieren und WLAN-Neustart, wie in der Vorlage

function mischen(liste) {
  const kopie = liste.slice();
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const merk = kopie[i];
    kopie[i] = kopie[j];
    kopie[j] = merk;
  }
  return kopie;
}

function zufallAus(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

function zufallZahl(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Einheitlicher Aufbau: Anleitung oben, Spielfeld, Statuszeile unten. Spart in jeder Aufgabe
// das Zusammensuchen der immer gleichen Elemente.
function rahmen(container, anleitung, koerper) {
  container.innerHTML = `<p class="af-anleitung">${anleitung}</p>${koerper}<p class="af-status"></p>`;
  return {
    q: sel => container.querySelector(sel),
    alle: sel => Array.prototype.slice.call(container.querySelectorAll(sel)),
    status: container.querySelector(".af-status")
  };
}

// Ziffernblock für die Aufgaben, bei denen ein Wert eingetippt wird. Ein eigenes Feld statt
// <input type="number">, weil auf dem Handy sonst die Systemtastatur das halbe Spielfeld
// verdeckt — im Querformat bliebe nichts übrig.
function ziffernblockHtml() {
  return `<div class="af-ziffernblock">
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(z => `<button type="button" data-ziffer="${z}">${z}</button>`).join("")}
    <button type="button" data-ziffer="loeschen">←</button>
    <button type="button" data-ziffer="0">0</button>
    <button type="button" data-ziffer="ok" class="af-ok">OK</button>
  </div>`;
}

function verdrahteZiffernblock(hilf, anzeigeSelektor, onBestaetigt) {
  const anzeige = hilf.q(anzeigeSelektor);
  let eingabe = "";
  hilf.alle(".af-ziffernblock button").forEach(btn => {
    btn.addEventListener("click", () => {
      const ziffer = btn.dataset.ziffer;
      if (ziffer === "loeschen") eingabe = eingabe.slice(0, -1);
      else if (ziffer === "ok") { onBestaetigt(eingabe); eingabe = ""; }
      else if (eingabe.length < 6) eingabe += ziffer;
      anzeige.textContent = eingabe || "–";
    });
  });
}

// Halten/Ziehen mit Zeiger: liefert den Anteil 0..1 innerhalb eines Elements. Wird von allen
// Schiebe- und Ziehaufgaben benutzt, damit Maus und Finger gleich reagieren.
function anteilIn(element, e, achse) {
  const rect = element.getBoundingClientRect();
  const roh = achse === "y"
    ? (e.clientY - rect.top) / rect.height
    : (e.clientX - rect.left) / rect.width;
  return Math.min(Math.max(roh, 0), 1);
}

function fangeZeiger(element, e) {
  try { element.setPointerCapture(e.pointerId); } catch (err) { /* Testartefakt, unkritisch */ }
}

// Zeitgesteuerte Schleife. Gibt die Stoppfunktion zurück; der Rückruf bekommt die seit dem
// letzten Aufruf verstrichenen Millisekunden.
function taktgeber(rueckruf, takt) {
  let vorher = Date.now();
  const id = setInterval(() => {
    const jetzt = Date.now();
    const delta = jetzt - vorher;
    vorher = jetzt;
    rueckruf(delta);
  }, takt || 40);
  return () => clearInterval(id);
}

// Gemeinsamer Unterbau der beiden Warteaufgaben (Proben analysieren, WLAN neu starten).
// Der Zeitstempel liegt im Spiel, nicht hier: wer die Aufgabe schließt und weggeht, soll
// beim Zurückkommen die abgelaufene Zeit vorfinden — genau das ist ihr Zweck als Alibi.
function warteAufgabe(container, onFertig, optionen, texte) {
  optionen = optionen || {};
  const jetzt = optionen.jetzt || (() => Date.now());
  const seit = optionen.wartenSeit || 0;
  const starteWarten = optionen.starteWarten || (() => {});
  const fertigBis = seit ? seit + WARTEZEIT_SEK * 1000 : 0;

  // Phase 1: noch nicht gestartet.
  if (!seit) {
    const hilf = rahmen(container, texte.anleitungStart, `
      <div class="af-warte">
        <div class="af-warte-symbol">${texte.symbol}</div>
        <button type="button" class="af-warte-start">${texte.startKnopf}</button>
      </div>`);
    hilf.status.textContent = `Dauert ${WARTEZEIT_SEK} Sekunden – du kannst so lange weggehen.`;
    hilf.q(".af-warte-start").addEventListener("click", () => {
      starteWarten();
      hilf.q(".af-warte-start").disabled = true;
      hilf.status.textContent = "Läuft. Komm später wieder.";
    });
    return () => {};
  }

  // Phase 2: läuft noch.
  if (jetzt() < fertigBis) {
    const hilf = rahmen(container, texte.anleitungWarten, `
      <div class="af-warte">
        <div class="af-warte-symbol dreht">${texte.symbol}</div>
        <div class="af-warte-balken"><div class="af-warte-fuellung"></div></div>
        <div class="af-warte-rest"></div>
      </div>`);
    const fuellung = hilf.q(".af-warte-fuellung");
    const rest = hilf.q(".af-warte-rest");
    const zeichne = () => {
      const uebrig = Math.max(fertigBis - jetzt(), 0);
      const anteil = 1 - uebrig / (WARTEZEIT_SEK * 1000);
      fuellung.style.width = `${Math.round(anteil * 100)}%`;
      rest.textContent = `noch ${Math.ceil(uebrig / 1000)} s`;
      if (uebrig <= 0) hilf.status.textContent = "Fertig – Aufgabe noch einmal öffnen.";
    };
    zeichne();
    hilf.status.textContent = "Du musst nicht danebenstehen.";
    return taktgeber(zeichne, 250);
  }

  // Phase 3: abgelaufen, Schlussschritt.
  return texte.schluss(container, onFertig);
}

// ============================================================
// Reaktoren, Zahlen & Muster
// ============================================================

// --- 1. Reaktor starten (Simon Says) ---
// Links leuchtet die Folge auf, rechts wird sie nachgetippt. Fünf Runden, pro Runde ein
// Feld mehr. Ein Fehler wirft auf Runde 1 zurück — das ist der Druck, der die Aufgabe
// gefährlich macht, wenn jemand im Türrahmen steht.
function aufgabeReaktor(container, onFertig) {
  const RUNDEN = 5;
  const ZEIGE_MS = 520;
  let folge = [];
  let eingabe = 0;
  let sperre = true;
  const timer = [];

  const gitter = seite => `<div class="af-reaktor-feld" data-seite="${seite}">${
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i =>
      `<button type="button" class="af-reaktor-zelle" data-i="${i}"${seite === "zeigen" ? " disabled" : ""}></button>`
    ).join("")}</div>`;

  const hilf = rahmen(container, "Merk dir die Reihenfolge links und tippe sie rechts nach.", `
    <div class="af-reaktor">
      <div class="af-reaktor-halb"><span class="af-reaktor-titel">Vorgabe</span>${gitter("zeigen")}</div>
      <div class="af-reaktor-halb"><span class="af-reaktor-titel">Eingabe</span>${gitter("tippen")}</div>
    </div>`);

  const zeigeZellen = hilf.alle('[data-seite="zeigen"] .af-reaktor-zelle');
  const tippZellen = hilf.alle('[data-seite="tippen"] .af-reaktor-zelle');

  function warte(ms, was) { timer.push(setTimeout(was, ms)); }

  function spieleFolgeVor() {
    sperre = true;
    hilf.status.textContent = `Runde ${folge.length} von ${RUNDEN} – zusehen …`;
    zeigeZellen.forEach(z => z.classList.remove("an"));
    folge.forEach((feld, i) => {
      warte(i * ZEIGE_MS + 260, () => zeigeZellen[feld].classList.add("an"));
      warte(i * ZEIGE_MS + 260 + ZEIGE_MS * 0.6, () => zeigeZellen[feld].classList.remove("an"));
    });
    warte(folge.length * ZEIGE_MS + 380, () => {
      sperre = false;
      eingabe = 0;
      hilf.status.textContent = `Runde ${folge.length} von ${RUNDEN} – jetzt du.`;
    });
  }

  function naechsteRunde() {
    folge = folge.concat([zufallZahl(0, 8)]);
    spieleFolgeVor();
  }

  tippZellen.forEach(zelle => {
    zelle.addEventListener("click", () => {
      if (sperre) return;
      const i = Number(zelle.dataset.i);
      if (i !== folge[eingabe]) {
        sperre = true;
        zelle.classList.add("falsch");
        hilf.status.textContent = "Falsch – der Reaktor fährt runter. Noch mal von vorn.";
        warte(700, () => {
          zelle.classList.remove("falsch");
          folge = [];
          naechsteRunde();
        });
        return;
      }
      zelle.classList.add("an");
      warte(220, () => zelle.classList.remove("an"));
      eingabe++;
      if (eingabe < folge.length) return;
      if (folge.length >= RUNDEN) {
        sperre = true;
        hilf.status.textContent = "Reaktor läuft!";
        onFertig();
        return;
      }
      sperre = true;
      hilf.status.textContent = "Richtig – nächste Runde.";
      warte(600, naechsteRunde);
    });
  });

  naechsteRunde();
  return () => timer.forEach(clearTimeout);
}

// --- 2. Manifold entsperren: 1 bis 10 in aufsteigender Reihenfolge ---
function aufgabeManifold(container, onFertig) {
  const zahlen = mischen([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  let naechste = 1;

  const hilf = rahmen(container, "Tippe die Zahlen von 1 bis 10 der Reihe nach an.", `
    <div class="af-manifold">${zahlen.map(z =>
      `<button type="button" class="af-manifold-taste" data-zahl="${z}">${z}</button>`).join("")}</div>`);
  hilf.status.textContent = "Als nächstes: 1";

  hilf.alle(".af-manifold-taste").forEach(btn => {
    btn.addEventListener("click", () => {
      const zahl = Number(btn.dataset.zahl);
      if (zahl !== naechste) {
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 380);
        hilf.status.textContent = `Nicht die ${zahl} – die ${naechste} ist dran.`;
        return;
      }
      btn.classList.add("gut");
      btn.disabled = true;
      naechste++;
      if (naechste > 10) {
        hilf.status.textContent = "Manifold entsperrt!";
        onFertig();
        return;
      }
      hilf.status.textContent = `Als nächstes: ${naechste}`;
    });
  });

  return () => {};
}

// --- 3. Proben analysieren: starten, 60 s weggehen, abweichende Probe wählen ---
function aufgabeProben(container, onFertig, optionen) {
  return warteAufgabe(container, onFertig, optionen, {
    symbol: "🧪",
    startKnopf: "Analyse starten",
    anleitungStart: "Starte die Analyse. Das Ergebnis liegt in einer Minute vor.",
    anleitungWarten: "Die Proben werden analysiert.",
    schluss(container, onFertig) {
      const ANZAHL = 5;
      const abweichend = zufallZahl(0, ANZAHL - 1);
      const hilf = rahmen(container, "Analyse fertig – wähl die auffällige Probe aus.", `
        <div class="af-proben">${Array.from({ length: ANZAHL }, (_, i) =>
          `<button type="button" class="af-probe${i === abweichend ? " auffaellig" : ""}" data-i="${i}">
             <span class="af-probe-glas"></span><span class="af-probe-nr">${i + 1}</span>
           </button>`).join("")}</div>`);
      hilf.status.textContent = "Eine Probe ist rot verfärbt.";
      hilf.alle(".af-probe").forEach(btn => {
        btn.addEventListener("click", () => {
          if (Number(btn.dataset.i) !== abweichend) {
            btn.classList.add("falsch");
            setTimeout(() => btn.classList.remove("falsch"), 380);
            hilf.status.textContent = "Die ist unauffällig – schau noch mal genau hin.";
            return;
          }
          hilf.alle(".af-probe").forEach(b => { b.disabled = true; });
          btn.classList.add("gut");
          hilf.status.textContent = "Probe erfasst!";
          onFertig();
        });
      });
      return () => {};
    }
  });
}

// ============================================================
// Strom & Verkabelung
// ============================================================

// --- 4. Kabel reparieren: vier Kabel verbinden, an drei Orten ---
// Farbe UND Symbol müssen zusammenpassen. Nur die Farbe wäre für Farbenblinde nicht lösbar,
// nur das Symbol wäre auf dem Handy zu klein.
function aufgabeKabel(container, onFertig, optionen) {
  optionen = optionen || {};
  const ADERN = [
    { farbe: "#dc2626", zeichen: "▲" },
    { farbe: "#2563eb", zeichen: "●" },
    { farbe: "#16a34a", zeichen: "■" },
    { farbe: "#f59e0b", zeichen: "★" }
  ];
  const rechts = mischen(ADERN);
  let gewaehlt = null;
  let verbunden = 0;

  const stecker = (a, seite) => `<button type="button" class="af-stecker" data-seite="${seite}"
      data-zeichen="${a.zeichen}" style="background:${a.farbe}">${a.zeichen}</button>`;

  const hilf = rahmen(container, "Verbinde die Kabel – erst links, dann rechts. Farbe und Zeichen müssen passen.", `
    <div class="af-kabel">
      <div class="af-kabel-spalte">${ADERN.map(a => stecker(a, "links")).join("")}</div>
      <div class="af-kabel-spalte">${rechts.map(a => stecker(a, "rechts")).join("")}</div>
    </div>`);

  const teilText = optionen.teile > 1 ? ` · Ort ${optionen.teil} von ${optionen.teile}` : "";
  hilf.status.textContent = `0 von ${ADERN.length} Adern${teilText}`;

  hilf.alle(".af-stecker").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (btn.dataset.seite === "links") {
        hilf.alle('.af-stecker[data-seite="links"]').forEach(b => b.classList.remove("aktiv"));
        btn.classList.add("aktiv");
        gewaehlt = btn;
        hilf.status.textContent = "… und jetzt das passende Gegenstück rechts.";
        return;
      }
      if (!gewaehlt) { hilf.status.textContent = "Erst links eine Ader wählen."; return; }
      if (gewaehlt.dataset.zeichen !== btn.dataset.zeichen) {
        hilf.status.textContent = "Passt nicht – das gibt einen Kurzschluss.";
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 400);
        return;
      }
      gewaehlt.disabled = btn.disabled = true;
      gewaehlt.classList.remove("aktiv");
      gewaehlt.classList.add("gut");
      btn.classList.add("gut");
      gewaehlt = null;
      verbunden++;
      hilf.status.textContent = `${verbunden} von ${ADERN.length} Adern${teilText}`;
      if (verbunden >= ADERN.length) {
        hilf.status.textContent = optionen.teil < optionen.teile
          ? "Fertig – der nächste Kabelkasten wartet woanders."
          : "Alles verkabelt!";
        onFertig();
      }
    });
  });

  return () => {};
}

// --- 5. Strom umleiten: Teil 1 Regler in der Elektrik, Teil 2 Schalter im Zielraum ---
function aufgabeStrom(container, onFertig, optionen) {
  optionen = optionen || {};
  const istQuelle = (optionen.teil || 1) === 1;
  return istQuelle ? stromRegler(container, onFertig, optionen) : stromSchalter(container, onFertig);
}

function stromRegler(container, onFertig, optionen) {
  const hilf = rahmen(container, "Schieb den leuchtenden Regler ganz nach oben.", `
    <div class="af-stromregler">
      <div class="af-regler-schacht">
        <div class="af-regler-ziel"></div>
        <div class="af-regler-griff" style="bottom:0%"></div>
      </div>
    </div>`);
  const zielRaum = optionen.zielRaum ? ` Danach den Schalter in ${optionen.zielRaum} umlegen.` : "";
  hilf.status.textContent = "Ganz nach oben ziehen." + zielRaum;

  const schacht = hilf.q(".af-regler-schacht");
  const griff = hilf.q(".af-regler-griff");
  let zieht = false;
  let fertig = false;

  function setze(e) {
    const anteil = 1 - anteilIn(schacht, e, "y");
    griff.style.bottom = `${Math.round(anteil * 100)}%`;
    if (anteil >= 0.94 && !fertig) {
      fertig = true;
      zieht = false;
      griff.style.bottom = "100%";
      griff.classList.add("gut");
      hilf.status.textContent = "Strom umgeleitet." + zielRaum;
      onFertig();
    }
  }

  schacht.addEventListener("pointerdown", e => { if (fertig) return; zieht = true; fangeZeiger(schacht, e); setze(e); });
  schacht.addEventListener("pointermove", e => { if (zieht) setze(e); });
  const los = () => {
    if (!zieht || fertig) return;
    zieht = false;
    griff.style.bottom = "0%";
    hilf.status.textContent = "Zurückgerutscht – bis ganz nach oben ziehen.";
  };
  schacht.addEventListener("pointerup", los);
  schacht.addEventListener("pointercancel", los);
  schacht.addEventListener("pointerleave", los);

  return () => {};
}

function stromSchalter(container, onFertig) {
  const hilf = rahmen(container, "Der Strom liegt an – leg den Hauptschalter um.", `
    <div class="af-stromschalter">
      <div class="af-lampe"></div>
      <button type="button" class="af-hauptschalter">AUS</button>
    </div>`);
  hilf.status.textContent = "Schalter umlegen.";
  const schalter = hilf.q(".af-hauptschalter");
  schalter.addEventListener("click", () => {
    if (schalter.disabled) return;
    schalter.disabled = true;
    schalter.textContent = "AN";
    hilf.q(".af-lampe").classList.add("an");
    hilf.status.textContent = "Raum ist versorgt!";
    onFertig();
  });
  return () => {};
}

// --- 6. Verteiler kalibrieren: drei rotierende Zeiger im richtigen Moment stoppen ---
function aufgabeVerteiler(container, onFertig) {
  const ANZAHL = 3;
  const TOLERANZ = 14;              // Grad Abweichung, die noch zählt
  const zeiger = [];
  let index = 0;

  const hilf = rahmen(container, "Stopp jeden Zeiger genau auf der Markierung.", `
    <div class="af-verteiler">${Array.from({ length: ANZAHL }, (_, i) => `
      <div class="af-skala" data-i="${i}">
        <div class="af-skala-marke"></div>
        <div class="af-skala-zeiger"></div>
      </div>`).join("")}
    </div>
    <button type="button" class="af-stoppknopf">Stopp</button>`);
  hilf.status.textContent = `Zeiger 1 von ${ANZAHL}`;

  hilf.alle(".af-skala").forEach((el, i) => {
    zeiger.push({
      el: el.querySelector(".af-skala-zeiger"),
      winkel: zufallZahl(0, 359),
      tempo: 150 + i * 45,          // Grad pro Sekunde, jeder etwas anders
      steht: false
    });
  });

  const stopp = taktgeber(delta => {
    zeiger.forEach(z => {
      if (z.steht) return;
      z.winkel = (z.winkel + z.tempo * delta / 1000) % 360;
      z.el.style.transform = `rotate(${z.winkel}deg)`;
    });
  });

  // Abstand zur 0-Grad-Marke, über den Nullpunkt hinweg gerechnet.
  function abweichung(winkel) {
    const d = Math.abs(winkel % 360);
    return Math.min(d, 360 - d);
  }

  hilf.q(".af-stoppknopf").addEventListener("click", () => {
    if (index >= ANZAHL) return;
    const z = zeiger[index];
    if (abweichung(z.winkel) > TOLERANZ) {
      hilf.status.textContent = "Daneben – der Zeiger läuft weiter.";
      z.el.classList.add("falsch");
      setTimeout(() => z.el.classList.remove("falsch"), 380);
      return;
    }
    z.steht = true;
    z.winkel = 0;
    z.el.style.transform = "rotate(0deg)";
    z.el.classList.add("gut");
    index++;
    if (index >= ANZAHL) {
      hilf.status.textContent = "Verteiler kalibriert!";
      onFertig();
      return;
    }
    hilf.status.textContent = `Zeiger ${index + 1} von ${ANZAHL}`;
  });

  return stopp;
}

// ============================================================
// Navigation & Zielgenauigkeit
// ============================================================

// --- 8. Kurs stabilisieren: Schiff auf der gestrichelten Linie zum Ziel ziehen ---
// Die Strecke zwischen zwei pointermove-Ereignissen wird abgetastet, nicht nur ihr Endpunkt —
// sonst ließe sich die Bahn mit einem schnellen Wisch überspringen (siehe Gegenprobe, die das
// beim Vorgänger aufgedeckt hat).
function aufgabeKurs(container, onFertig) {
  const BAHN = [
    { x: 4,  y: 62, w: 26, h: 18 },
    { x: 24, y: 22, w: 18, h: 58 },
    { x: 24, y: 22, w: 36, h: 18 },
    { x: 54, y: 22, w: 18, h: 58 },
    { x: 54, y: 62, w: 42, h: 18 }
  ];

  const hilf = rahmen(container, "Zieh das Schiff auf der gestrichelten Linie zum Ziel.", `
    <div class="af-kursfeld">
      ${BAHN.map(s => `<div class="af-kursbahn" style="left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%"></div>`).join("")}
      <div class="af-kursstart">Start</div>
      <div class="af-kursziel">Ziel</div>
      <div class="af-kursschiff" style="left:10%;top:69%">🚀</div>
    </div>`);
  hilf.status.textContent = 'Am "Start" aufnehmen.';

  const feld = hilf.q(".af-kursfeld");
  const schiff = hilf.q(".af-kursschiff");
  let zieht = false;
  let letzter = null;

  function position(e) {
    const rect = feld.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 };
  }

  const aufBahn = p => BAHN.some(s => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h);

  function streckeAufBahn(von, bis) {
    const schritte = Math.max(Math.ceil(Math.hypot(bis.x - von.x, bis.y - von.y) / 1.5), 1);
    for (let i = 1; i <= schritte; i++) {
      const anteil = i / schritte;
      if (!aufBahn({ x: von.x + (bis.x - von.x) * anteil, y: von.y + (bis.y - von.y) * anteil })) return false;
    }
    return true;
  }

  function setzeSchiff(p) {
    schiff.style.left = `${p.x}%`;
    schiff.style.top = `${p.y}%`;
  }

  function abbruch(text) {
    zieht = false;
    letzter = null;
    feld.classList.remove("aktiv");
    setzeSchiff({ x: 10, y: 69 });
    hilf.status.textContent = text;
  }

  feld.addEventListener("pointerdown", e => {
    const p = position(e);
    if (p.x <= 16 && aufBahn(p)) {
      zieht = true;
      letzter = p;
      feld.classList.add("aktiv");
      setzeSchiff(p);
      fangeZeiger(feld, e);
      hilf.status.textContent = "Weiter …";
    }
  });

  feld.addEventListener("pointermove", e => {
    if (!zieht) return;
    const p = position(e);
    if (!streckeAufBahn(letzter, p)) { abbruch("Vom Kurs abgekommen – noch mal am Start."); return; }
    letzter = p;
    setzeSchiff(p);
    if (p.x >= 90) {
      zieht = false;
      feld.classList.remove("aktiv");
      hilf.status.textContent = "Kurs stabil!";
      onFertig();
    }
  });

  feld.addEventListener("pointerup", () => { if (zieht) abbruch("Losgelassen – noch mal am Start."); });
  feld.addEventListener("pointercancel", () => { if (zieht) abbruch("Abgebrochen – noch mal am Start."); });

  return () => {};
}

// --- 9. Triebwerke ausrichten: Hebel auf die Soll-Linie schieben ---
function aufgabeTriebwerk(container, onFertig) {
  const soll = zufallZahl(25, 75);
  const TOLERANZ = 4;

  const hilf = rahmen(container, "Schieb den Hebel, bis die Düse auf der Soll-Linie steht.", `
    <div class="af-triebwerk">
      <div class="af-triebwerk-soll" style="top:${soll}%"></div>
      <div class="af-triebwerk-duese" style="top:50%">◀</div>
    </div>
    <div class="af-triebwerk-schacht"><div class="af-triebwerk-griff" style="top:50%"></div></div>`);
  hilf.status.textContent = "Noch nicht ausgerichtet.";

  const schacht = hilf.q(".af-triebwerk-schacht");
  const griff = hilf.q(".af-triebwerk-griff");
  const duese = hilf.q(".af-triebwerk-duese");
  let zieht = false;
  let fertig = false;

  function setze(e) {
    const anteil = anteilIn(schacht, e, "y") * 100;
    griff.style.top = `${anteil}%`;
    duese.style.top = `${anteil}%`;
    const passt = Math.abs(anteil - soll) <= TOLERANZ;
    duese.classList.toggle("gut", passt);
    hilf.status.textContent = passt ? "Sitzt – loslassen." : "Noch nicht ausgerichtet.";
  }

  schacht.addEventListener("pointerdown", e => { if (fertig) return; zieht = true; fangeZeiger(schacht, e); setze(e); });
  schacht.addEventListener("pointermove", e => { if (zieht) setze(e); });

  const los = () => {
    if (!zieht || fertig) return;
    zieht = false;
    const ist = parseFloat(griff.style.top);
    if (Math.abs(ist - soll) <= TOLERANZ) {
      fertig = true;
      griff.classList.add("gut");
      hilf.status.textContent = "Triebwerk ausgerichtet!";
      onFertig();
    } else {
      hilf.status.textContent = "Daneben – noch mal schieben.";
    }
  };
  schacht.addEventListener("pointerup", los);
  schacht.addEventListener("pointercancel", los);

  return () => {};
}

// --- 10. Asteroiden zerstören: 20 Treffer ---
function aufgabeAsteroiden(container, onFertig) {
  const ZIEL = 20;
  const MAX_GLEICHZEITIG = 5;
  let getroffen = 0;
  const brocken = [];

  const hilf = rahmen(container, "Schieß alle Asteroiden ab – tippe sie an.", `
    <div class="af-asteroiden"><div class="af-fadenkreuz-mitte">+</div></div>`);
  hilf.status.textContent = `0 von ${ZIEL}`;
  const feld = hilf.q(".af-asteroiden");

  function neuerBrocken() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "af-asteroid";
    el.textContent = zufallAus(["🪨", "☄️"]);
    const b = {
      el,
      x: 100 + zufallZahl(0, 30),
      y: zufallZahl(8, 82),
      tempo: 14 + Math.random() * 16,        // Prozent Breite pro Sekunde
      weg: false
    };
    el.style.top = `${b.y}%`;
    el.addEventListener("click", () => {
      if (b.weg) return;
      b.weg = true;
      el.classList.add("treffer");
      getroffen++;
      hilf.status.textContent = `${getroffen} von ${ZIEL}`;
      setTimeout(() => el.remove(), 200);
      if (getroffen >= ZIEL) {
        hilf.status.textContent = "Feld geräumt!";
        onFertig();
      }
    });
    feld.appendChild(el);
    brocken.push(b);
  }

  const stopp = taktgeber(delta => {
    if (getroffen >= ZIEL) return;
    const lebend = brocken.filter(b => !b.weg);
    if (lebend.length < MAX_GLEICHZEITIG) neuerBrocken();
    lebend.forEach(b => {
      b.x -= b.tempo * delta / 1000;
      if (b.x < -12) {                        // links raus: hinten wieder anstellen
        b.x = 100 + zufallZahl(0, 25);
        b.y = zufallZahl(8, 82);
        b.el.style.top = `${b.y}%`;
      }
      b.el.style.left = `${b.x}%`;
    });
  });

  return () => { stopp(); };
}

// ============================================================
// Müll & Reinigung
// ============================================================

// --- 12. Müll entsorgen: Hebel ziehen und halten, bis die Luke leer ist ---
function aufgabeMuell(container, onFertig) {
  const DAUER_MS = 3200;
  let gehalten = 0;
  let haelt = false;
  let fertig = false;

  const hilf = rahmen(container, "Zieh den Hebel nach unten und halte ihn, bis alles draußen ist.", `
    <div class="af-muellschacht">
      <div class="af-muellhaufen">🗑️🍌📦🥤📰</div>
      <div class="af-muellfuellung"></div>
    </div>
    <button type="button" class="af-muellhebel">Hebel halten</button>`);
  hilf.status.textContent = "Schacht ist voll.";

  const hebel = hilf.q(".af-muellhebel");
  const fuellung = hilf.q(".af-muellfuellung");
  const haufen = hilf.q(".af-muellhaufen");

  const stopp = taktgeber(delta => {
    if (fertig) return;
    if (haelt) {
      gehalten = Math.min(gehalten + delta, DAUER_MS);
    } else if (gehalten > 0) {
      // Loslassen klappt die Luke zu: der Müll rutscht zurück, sonst wäre "halten" bedeutungslos.
      gehalten = Math.max(gehalten - delta * 1.6, 0);
    }
    const anteil = gehalten / DAUER_MS;
    fuellung.style.height = `${Math.round((1 - anteil) * 100)}%`;
    haufen.style.opacity = String(1 - anteil);
    if (anteil >= 1) {
      fertig = true;
      haelt = false;
      hebel.disabled = true;
      hebel.textContent = "Leer";
      hilf.status.textContent = "Schacht ist leer!";
      onFertig();
    } else {
      hilf.status.textContent = haelt ? `Läuft … ${Math.round(anteil * 100)} %` : "Hebel halten.";
    }
  });

  const halte = e => { if (fertig) return; haelt = true; fangeZeiger(hebel, e); hebel.classList.add("gedrueckt"); };
  const lasse = () => { haelt = false; hebel.classList.remove("gedrueckt"); };
  hebel.addEventListener("pointerdown", halte);
  hebel.addEventListener("pointerup", lasse);
  hebel.addEventListener("pointercancel", lasse);
  hebel.addEventListener("pointerleave", lasse);

  return stopp;
}

// --- 13. Filter reinigen: Blätter aus dem Gitter in den Abzugsschacht ziehen ---
function aufgabeFilter(container, onFertig) {
  const ANZAHL = 5;
  let entfernt = 0;

  const hilf = rahmen(container, "Zieh die Blätter aus dem Gitter in den Schacht rechts.", `
    <div class="af-filter">
      <div class="af-filtergitter">${Array.from({ length: ANZAHL }, (_, i) =>
        `<span class="af-blatt" data-i="${i}" style="left:${8 + (i % 3) * 26}%;top:${12 + Math.floor(i / 3) * 38}%">🍃</span>`).join("")}</div>
      <div class="af-filterschacht">⬇︎</div>
    </div>`);
  hilf.status.textContent = `0 von ${ANZAHL} Blättern`;

  const feld = hilf.q(".af-filter");
  const gitter = hilf.q(".af-filtergitter");
  const schacht = hilf.q(".af-filterschacht");
  let aktiv = null;

  // Die Zeiger-Ereignisse hängen am äußeren .af-filter, damit der Schacht als Ziel erreichbar
  // bleibt. Die Prozentwerte des Blattes zählen aber gegen .af-filtergitter, in dem es steckt —
  // rechnet man sie gegen den äußeren Rahmen, springt das Blatt beim Anfassen zur Seite.
  feld.addEventListener("pointerdown", e => {
    const blatt = e.target.closest(".af-blatt");
    if (!blatt || blatt.classList.contains("weg")) return;
    aktiv = blatt;
    blatt.classList.add("gezogen");
    fangeZeiger(feld, e);
  });

  feld.addEventListener("pointermove", e => {
    if (!aktiv) return;
    const rect = gitter.getBoundingClientRect();
    aktiv.style.left = `${((e.clientX - rect.left) / rect.width) * 100}%`;
    aktiv.style.top = `${((e.clientY - rect.top) / rect.height) * 100}%`;
  });

  function loslassen(e) {
    if (!aktiv) return;
    const s = schacht.getBoundingClientRect();
    const drin = e.clientX >= s.left && e.clientX <= s.right && e.clientY >= s.top && e.clientY <= s.bottom;
    if (drin) {
      aktiv.classList.add("weg");
      aktiv.classList.remove("gezogen");
      entfernt++;
      hilf.status.textContent = `${entfernt} von ${ANZAHL} Blättern`;
      if (entfernt >= ANZAHL) {
        hilf.status.textContent = "Filter ist frei!";
        onFertig();
      }
    } else {
      aktiv.classList.remove("gezogen");
    }
    aktiv = null;
  }

  feld.addEventListener("pointerup", loslassen);
  feld.addEventListener("pointercancel", () => { if (aktiv) { aktiv.classList.remove("gezogen"); aktiv = null; } });

  return () => {};
}

// ============================================================
// Daten & Signale
// ============================================================

// --- 15. Daten herunterladen / hochladen: Teil 1 irgendwo, Teil 2 am Hauptserver ---
function aufgabeDaten(container, onFertig, optionen) {
  optionen = optionen || {};
  const laden = (optionen.teil || 1) === 1;
  const DAUER_MS = 4000;
  let gestartet = false;
  let vergangen = 0;

  const wort = laden ? "Download" : "Upload";
  const zielRaum = laden && optionen.zielRaum ? ` Danach am Hauptserver in ${optionen.zielRaum} hochladen.` : "";

  const hilf = rahmen(container, laden
    ? "Lade die Daten herunter und warte, bis der Balken voll ist."
    : "Lade die Daten am Hauptserver hoch.", `
    <div class="af-daten">
      <div class="af-daten-symbol">${laden ? "⬇︎" : "⬆︎"}</div>
      <div class="af-daten-balken"><div class="af-daten-fuellung"></div></div>
      <div class="af-daten-prozent">0 %</div>
      <button type="button" class="af-daten-start">${wort} starten</button>
    </div>`);
  hilf.status.textContent = "Bereit." + zielRaum;

  const fuellung = hilf.q(".af-daten-fuellung");
  const prozent = hilf.q(".af-daten-prozent");
  const knopf = hilf.q(".af-daten-start");

  knopf.addEventListener("click", () => {
    if (gestartet) return;
    gestartet = true;
    knopf.disabled = true;
    knopf.textContent = `${wort} läuft …`;
    hilf.status.textContent = "Bitte warten.";
  });

  const stopp = taktgeber(delta => {
    if (!gestartet || vergangen >= DAUER_MS) return;
    vergangen = Math.min(vergangen + delta, DAUER_MS);
    const anteil = vergangen / DAUER_MS;
    fuellung.style.width = `${Math.round(anteil * 100)}%`;
    prozent.textContent = `${Math.round(anteil * 100)} %`;
    if (anteil >= 1) {
      knopf.textContent = "Fertig";
      hilf.status.textContent = laden
        ? "Daten geladen." + zielRaum
        : "Daten sind auf dem Server!";
      onFertig();
    }
  }, 100);

  return stopp;
}

// ============================================================
// Sichtbare Aufgaben und Spezialgeräte
// ============================================================

// --- Scan durchführen (MedBay): die sichtbarste Aufgabe des Originals ---
// Wer hier steht, kann von niemandem verdächtigt werden — deshalb ist der Scan das härteste
// Alibi im Spiel und deshalb dauert er absichtlich lange. Abbrechen zählt nicht.
function aufgabeScan(container, onFertig) {
  const DAUER_MS = 9000;
  let vergangen = 0;
  let laeuft = false;

  const hilf = rahmen(container, "Stell dich auf die Plattform und halte still.", `
    <div class="af-scanner">
      <div class="af-scan-figur">🧍</div>
      <div class="af-scan-strahl"></div>
      <div class="af-scan-werte">
        <span data-wert="groesse">Größe –</span>
        <span data-wert="gewicht">Gewicht –</span>
        <span data-wert="blut">Blutgruppe –</span>
      </div>
    </div>
    <button type="button" class="af-scan-start">Scan starten</button>`);
  hilf.status.textContent = "Bereit.";

  const strahl = hilf.q(".af-scan-strahl");
  const knopf = hilf.q(".af-scan-start");
  const werte = hilf.alle(".af-scan-werte span");
  const ergebnisse = [`Größe ${zufallZahl(160, 195)} cm`, `Gewicht ${zufallZahl(55, 95)} kg`,
                      `Blutgruppe ${zufallAus(["A", "B", "AB", "0"])}${zufallAus(["+", "−"])}`];

  knopf.addEventListener("click", () => {
    if (laeuft) return;
    laeuft = true;
    knopf.disabled = true;
    knopf.textContent = "Scan läuft …";
    hilf.status.textContent = "Nicht bewegen.";
  });

  return taktgeber(delta => {
    if (!laeuft || vergangen >= DAUER_MS) return;
    vergangen = Math.min(vergangen + delta, DAUER_MS);
    const anteil = vergangen / DAUER_MS;
    strahl.style.top = `${Math.round(anteil * 100)}%`;
    // Die drei Werte erscheinen nacheinander — das macht den Fortschritt ohne Balken sichtbar.
    werte.forEach((el, i) => { if (anteil > (i + 1) / 4) el.textContent = ergebnisse[i]; });
    if (anteil >= 1) {
      knopf.textContent = "Fertig";
      hilf.status.textContent = "Scan übermittelt!";
      onFertig();
    }
  }, 80);
}

// --- Triebwerk betanken: Kanister im Lager füllen, dann im Motorraum leeren ---
// Zweiteilig wie im Original, und beide Hälften sind Halten-Aufgaben: man steht sichtbar
// still, erst an der Tankstation, dann am Triebwerk.
function aufgabeBetanken(container, onFertig, optionen) {
  optionen = optionen || {};
  const fuellen = (optionen.teil || 1) === 1;
  const DAUER_MS = 3000;
  let gehalten = 0;
  let haelt = false;
  let fertig = false;

  const zielRaum = fuellen && optionen.zielRaum ? ` Danach ab damit nach ${optionen.zielRaum}.` : "";
  const hilf = rahmen(container, fuellen
    ? "Halte den Zapfhahn, bis der Kanister voll ist."
    : "Halte den Kanister über den Einfüllstutzen, bis er leer ist.", `
    <div class="af-tank">
      <div class="af-kanister"><div class="af-kanister-inhalt"></div><span>⛽</span></div>
    </div>
    <button type="button" class="af-tankhebel">${fuellen ? "Zapfhahn halten" : "Kanister kippen"}</button>`);
  hilf.status.textContent = fuellen ? "Kanister ist leer." : "Kanister ist voll.";

  const inhalt = hilf.q(".af-kanister-inhalt");
  const hebel = hilf.q(".af-tankhebel");
  if (!fuellen) inhalt.style.height = "100%";

  const stopp = taktgeber(delta => {
    if (fertig) return;
    if (haelt) gehalten = Math.min(gehalten + delta, DAUER_MS);
    else if (gehalten > 0) gehalten = Math.max(gehalten - delta * 1.4, 0);
    const anteil = gehalten / DAUER_MS;
    inhalt.style.height = `${Math.round((fuellen ? anteil : 1 - anteil) * 100)}%`;
    if (anteil >= 1) {
      fertig = true;
      haelt = false;
      hebel.disabled = true;
      hebel.classList.remove("gedrueckt");
      hilf.status.textContent = fuellen ? "Kanister ist voll." + zielRaum : "Triebwerk betankt!";
      onFertig();
    } else {
      hilf.status.textContent = haelt ? `Läuft … ${Math.round(anteil * 100)} %` : "Halten." + zielRaum;
    }
  });

  const halte = e => { if (fertig) return; haelt = true; fangeZeiger(hebel, e); hebel.classList.add("gedrueckt"); };
  const lasse = () => { haelt = false; hebel.classList.remove("gedrueckt"); };
  hebel.addEventListener("pointerdown", halte);
  hebel.addEventListener("pointerup", lasse);
  hebel.addEventListener("pointercancel", lasse);
  hebel.addEventListener("pointerleave", lasse);

  return stopp;
}

// --- Lenkung ausrichten: das Fadenkreuz driftet weg, zurückziehen und halten ---
function aufgabeLenkung(container, onFertig) {
  const HALTEN_MS = 1800;
  const TOLERANZ = 12;          // Prozent Abstand zur Mitte
  let pos = { x: zufallZahl(20, 80), y: zufallZahl(20, 80) };
  let zieht = false;
  let imZiel = 0;
  let fertig = false;

  const hilf = rahmen(container, "Zieh das Fadenkreuz in die Mitte und halte es dort.", `
    <div class="af-lenkung">
      <div class="af-lenk-mitte"></div>
      <div class="af-lenk-kreuz">✛</div>
      <div class="af-lenk-balken"><div class="af-lenk-fuellung"></div></div>
    </div>`);
  hilf.status.textContent = "Der Kurs läuft weg.";

  const feld = hilf.q(".af-lenkung");
  const kreuz = hilf.q(".af-lenk-kreuz");
  const fuellung = hilf.q(".af-lenk-fuellung");

  function zeichne() {
    kreuz.style.left = `${pos.x}%`;
    kreuz.style.top = `${pos.y}%`;
  }
  zeichne();

  feld.addEventListener("pointerdown", e => { if (!fertig) { zieht = true; fangeZeiger(feld, e); } });
  feld.addEventListener("pointermove", e => {
    if (!zieht || fertig) return;
    pos = { x: anteilIn(feld, e, "x") * 100, y: anteilIn(feld, e, "y") * 100 };
    zeichne();
  });
  const los = () => { zieht = false; };
  feld.addEventListener("pointerup", los);
  feld.addEventListener("pointercancel", los);

  return taktgeber(delta => {
    if (fertig) return;
    const ab = Math.hypot(pos.x - 50, pos.y - 50);
    // Ohne Hand driftet der Kurs weiter weg — sonst könnte man einmal ziehen und warten.
    if (!zieht && ab < 95) {
      const richtung = ab < 0.5 ? { x: 1, y: 0 } : { x: (pos.x - 50) / ab, y: (pos.y - 50) / ab };
      pos = { x: Math.min(Math.max(pos.x + richtung.x * delta * 0.012, 0), 100),
              y: Math.min(Math.max(pos.y + richtung.y * delta * 0.012, 0), 100) };
      zeichne();
    }
    if (ab <= TOLERANZ) imZiel += delta; else imZiel = Math.max(imZiel - delta, 0);
    fuellung.style.width = `${Math.round(Math.min(imZiel / HALTEN_MS, 1) * 100)}%`;
    kreuz.classList.toggle("gut", ab <= TOLERANZ);
    if (imZiel >= HALTEN_MS) {
      fertig = true;
      hilf.status.textContent = "Lenkung stabil!";
      onFertig();
    } else {
      hilf.status.textContent = ab <= TOLERANZ ? "Halten …" : "Zurück in die Mitte.";
    }
  });
}

// --- Schilde aktivieren: alle roten Segmente antippen ---
function aufgabeSchilde(container, onFertig) {
  const ANZAHL = 7;
  const aus = mischen([0, 1, 2, 3, 4, 5, 6]).slice(0, zufallZahl(4, 6));
  let offen = aus.length;

  const hilf = rahmen(container, "Tippe alle roten Segmente an, bis der Schild steht.", `
    <div class="af-schild">${Array.from({ length: ANZAHL }, (_, i) =>
      `<button type="button" class="af-schild-teil${aus.indexOf(i) === -1 ? " an" : ""}" data-i="${i}"></button>`).join("")}
      <div class="af-schild-kern">🛡️</div>
    </div>`);
  hilf.status.textContent = `${offen} von ${ANZAHL} Segmenten aus`;

  hilf.alle(".af-schild-teil").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("an")) return;
      btn.classList.add("an");
      offen--;
      if (offen <= 0) {
        hilf.q(".af-schild-kern").classList.add("an");
        hilf.status.textContent = "Schild steht!";
        onFertig();
        return;
      }
      hilf.status.textContent = `${offen} von ${ANZAHL} Segmenten aus`;
    });
  });

  return () => {};
}

// --- Karte durchziehen (Swipe Card): weder zu schnell noch zu langsam ---
// Die berüchtigtste Aufgabe des Originals. Genau deshalb prüft sie die Geschwindigkeit und
// nicht nur, DASS gewischt wurde.
function aufgabeSwipe(container, onFertig) {
  const MIN_MS = 350, MAX_MS = 1200;
  let start = null;

  const hilf = rahmen(container, "Zieh die Karte gleichmäßig durch den Leser – nicht zu schnell, nicht zu langsam.", `
    <div class="af-leser">
      <div class="af-leser-schlitz"></div>
      <div class="af-karte" style="left:2%">💳</div>
    </div>`);
  hilf.status.textContent = "Karte von links nach rechts ziehen.";

  const leser = hilf.q(".af-leser");
  const karte = hilf.q(".af-karte");

  leser.addEventListener("pointerdown", e => {
    const p = anteilIn(leser, e, "x");
    if (p > 0.25) { hilf.status.textContent = "Ganz links anfassen."; return; }
    start = { zeit: Date.now(), x: p };
    fangeZeiger(leser, e);
  });

  leser.addEventListener("pointermove", e => {
    if (!start) return;
    karte.style.left = `${anteilIn(leser, e, "x") * 100}%`;
  });

  function ende(e) {
    if (!start) return;
    const p = anteilIn(leser, e, "x");
    const dauer = Date.now() - start.zeit;
    start = null;
    if (p < 0.8) {
      karte.style.left = "2%";
      hilf.status.textContent = "Zu kurz – ganz durchziehen.";
      return;
    }
    if (dauer < MIN_MS) { karte.style.left = "2%"; hilf.status.textContent = "Zu schnell. Noch mal."; return; }
    if (dauer > MAX_MS) { karte.style.left = "2%"; hilf.status.textContent = "Zu langsam. Noch mal."; return; }
    karte.style.left = "92%";
    hilf.status.textContent = "Akzeptiert!";
    onFertig();
  }
  leser.addEventListener("pointerup", ende);
  leser.addEventListener("pointercancel", () => { start = null; });

  return () => {};
}

// ============================================================
// Reparaturen der Sabotagen (keine regulären Aufgaben)
// ============================================================

// Unverändert aus der Vorfassung: die beiden Reparaturen sind keine Aufgaben aus Michels
// Liste und werden vom Umbau nicht berührt.
function reparaturLicht(container, onFertig) {
  const ANZAHL = 5;
  const oben = new Array(ANZAHL).fill(false);
  const timer = [];

  const hilf = rahmen(container, "Alle Sicherungen hochlegen – sie fallen einzeln wieder zurück.", `<div class="af-sicherungen"></div>`);
  const feld = hilf.q(".af-sicherungen");
  hilf.status.textContent = `0 von ${ANZAHL} oben`;

  function aktualisiere() {
    const anzahl = oben.filter(Boolean).length;
    hilf.status.textContent = `${anzahl} von ${ANZAHL} oben`;
    if (anzahl >= ANZAHL) {
      hilf.status.textContent = "Licht ist wieder an!";
      onFertig();
    }
  }

  for (let i = 0; i < ANZAHL; i++) {
    const btn = document.createElement("button");
    btn.className = "af-sicherung";
    btn.type = "button";
    btn.textContent = "▼";
    btn.addEventListener("click", () => {
      if (oben[i]) return;
      oben[i] = true;
      btn.classList.add("oben");
      btn.textContent = "▲";
      timer.push(setTimeout(() => {
        if (!oben[i] || oben.filter(Boolean).length >= ANZAHL) return;
        oben[i] = false;
        btn.classList.remove("oben");
        btn.textContent = "▼";
        aktualisiere();
      }, 2600));
      aktualisiere();
    });
    feld.appendChild(btn);
  }

  return () => timer.forEach(t => clearTimeout(t));
}

// Das Kühlventil braucht zwei Personen an entgegengesetzten Enden der Karte: gehalten
// wird hier nur die eigene Seite, die Gleichzeitigkeit prüft das Spiel.
function reparaturKuehlung(container, onHalten, onLoslassen) {
  const hilf = rahmen(container, "Ventil gedrückt halten – beide Ventile müssen gleichzeitig offen sein.", `
    <button class="af-ventil" type="button">🔧<span>halten</span></button>`);
  const ventil = hilf.q(".af-ventil");
  hilf.status.textContent = "Ventil geschlossen";
  let haelt = false;

  function starte(e) {
    e.preventDefault();
    if (haelt) return;
    haelt = true;
    ventil.classList.add("aktiv");
    hilf.status.textContent = "Ventil offen – halten!";
    onHalten();
  }
  function ende() {
    if (!haelt) return;
    haelt = false;
    ventil.classList.remove("aktiv");
    hilf.status.textContent = "Ventil geschlossen";
    onLoslassen();
  }

  ventil.addEventListener("pointerdown", starte);
  ventil.addEventListener("pointerup", ende);
  ventil.addEventListener("pointercancel", ende);
  ventil.addEventListener("pointerleave", ende);

  return () => { if (haelt) onLoslassen(); };
}

// Die Schlüssel hier müssen exakt den Typen in karte.js STATIONS_TABELLE entsprechen —
// eine Station ohne passenden Eintrag wäre eine Aufgabe, die sich nicht öffnen lässt.
//
// sichtbar: Wer dabei zusieht, weiß, dass hier wirklich gearbeitet wurde — das einzige harte
// Alibi im Spiel. Nur fünf Typen tragen die Markierung, und zwar solche, deren Wirkung auch
// außerhalb des Minispiels plausibel zu sehen oder zu hören ist (im Original sind das genau
// die "visual tasks"). Maulwürfe dürfen dieselbe Aufgabe spielen, lösen die Anzeige aber
// nicht aus (siehe erledigeAufgabe).
//
// teile / kette / wartenSek machen eine Aufgabe mehrteilig:
//   teile: 3            — drei Standorte in drei verschiedenen Räumen, Reihenfolge egal
//   kette: [a, b]       — feste Reihenfolge; "*" heißt "beliebiger anderer Raum"
//   wartenSek           — die Aufgabe hat eine Pause, in der man weggehen kann
// waehleAufgaben() in game-service.js liest diese Felder; wer hier eins ergänzt, muss die
// Standorte in STATIONS_TABELLE passend vorhalten.
const AUFGABEN_TYPEN = {
  // Reaktoren, Zahlen & Muster
  reaktor:      { name: "Reaktor starten",       start: aufgabeReaktor },
  manifold:     { name: "Manifold entsperren",   start: aufgabeManifold },
  proben:       { name: "Proben analysieren",    start: aufgabeProben, wartenSek: WARTEZEIT_SEK },
  scan:         { name: "Scan durchführen",      start: aufgabeScan, sichtbar: "🩺" },
  // Strom & Verkabelung
  kabel:        { name: "Kabel reparieren",      start: aufgabeKabel, teile: 3 },
  strom:        { name: "Strom umleiten",        start: aufgabeStrom, kette: ["electrical", "*"] },
  verteiler:    { name: "Verteiler kalibrieren", start: aufgabeVerteiler },
  // Antrieb & Navigation
  triebwerk:    { name: "Triebwerke ausrichten", start: aufgabeTriebwerk },
  betanken:     { name: "Triebwerk betanken",    start: aufgabeBetanken, kette: ["storage", "*"], sichtbar: "⛽" },
  kurs:         { name: "Kurs stabilisieren",    start: aufgabeKurs },
  lenkung:      { name: "Lenkung ausrichten",    start: aufgabeLenkung },
  asteroiden:   { name: "Asteroiden zerstören",  start: aufgabeAsteroiden, sichtbar: "💥" },
  schilde:      { name: "Schilde aktivieren",    start: aufgabeSchilde, sichtbar: "🛡️" },
  // Versorgung & Daten
  muell:        { name: "Müll entsorgen",        start: aufgabeMuell, sichtbar: "🗑️" },
  filter:       { name: "Filter reinigen",       start: aufgabeFilter },
  daten:        { name: "Daten übertragen",      start: aufgabeDaten, kette: ["*", "admin"] },
  swipe:        { name: "Karte durchziehen",     start: aufgabeSwipe }
};

const aufgabenModul = { AUFGABEN_TYPEN, reparaturLicht, reparaturKuehlung, mischen, WARTEZEIT_SEK };

if (typeof module !== "undefined" && module.exports) module.exports = aufgabenModul;
