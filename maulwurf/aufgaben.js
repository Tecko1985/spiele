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

// --- 7. Sicherungen zurücksetzen: sieben Hebel in der Reihenfolge 1 bis 7 ---
function aufgabeSicherungen(container, onFertig) {
  const ANZAHL = 7;
  const reihenfolge = mischen(Array.from({ length: ANZAHL }, (_, i) => i + 1));
  let naechste = 1;

  // Eigene Klassennamen, NICHT .af-sicherung: die trägt die Licht-Reparatur mit ganz
  // anderem Aufbau, und zwei Layouts unter einem Namen brechen sich gegenseitig.
  const hilf = rahmen(container, "Leg die Sicherungen in der aufgedruckten Reihenfolge um.", `
    <div class="af-reset-block">${reihenfolge.map(nr => `
      <button type="button" class="af-reset-hebel" data-nr="${nr}">
        <span class="af-reset-griff"></span><span class="af-reset-nr">${nr}</span>
      </button>`).join("")}</div>`);
  hilf.status.textContent = "Als nächstes: Sicherung 1";

  hilf.alle(".af-reset-hebel").forEach(btn => {
    btn.addEventListener("click", () => {
      const nr = Number(btn.dataset.nr);
      if (nr !== naechste) {
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 380);
        hilf.status.textContent = `Nicht die ${nr} – die ${naechste} ist dran.`;
        return;
      }
      btn.classList.add("gut");
      btn.disabled = true;
      naechste++;
      if (naechste > ANZAHL) {
        hilf.status.textContent = "Alle Sicherungen drin!";
        onFertig();
        return;
      }
      hilf.status.textContent = `Als nächstes: Sicherung ${naechste}`;
    });
  });

  return () => {};
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

// --- 11. Teleskop ausrichten: Objekt ins Fadenkreuz holen ---
function aufgabeTeleskop(container, onFertig) {
  const TOLERANZ = 7;                          // Prozent Abstand zur Mitte
  const ziel = { x: zufallZahl(12, 88), y: zufallZahl(12, 88) };
  const objekt = zufallAus(["🪐", "🌙", "⭐", "🛰️"]);
  let blick = { x: 50, y: 50 };
  let zieht = false;
  let start = null;
  let fertig = false;

  const hilf = rahmen(container, `Schwenk das Teleskop, bis ${objekt} im Fadenkreuz liegt.`, `
    <div class="af-teleskop">
      <div class="af-himmel"><span class="af-himmelsobjekt">${objekt}</span></div>
      <div class="af-fadenkreuz"><span></span><span></span></div>
    </div>
    <p class="af-teleskop-hinweis">Gesucht: <b>${objekt}</b></p>`);
  hilf.status.textContent = "Zum Schwenken über das Bild ziehen.";

  const sichtfeld = hilf.q(".af-teleskop");
  const himmel = hilf.q(".af-himmel");
  const marke = hilf.q(".af-himmelsobjekt");

  function zeichne() {
    // Der Himmel wandert gegenläufig zum Blick: schwenkt man nach rechts, zieht das Bild nach links.
    himmel.style.transform = `translate(${50 - blick.x}%, ${50 - blick.y}%)`;
    marke.style.left = `${ziel.x}%`;
    marke.style.top = `${ziel.y}%`;
    const abstand = Math.hypot(blick.x - ziel.x, blick.y - ziel.y);
    sichtfeld.classList.toggle("im-ziel", abstand <= TOLERANZ);
    if (abstand <= TOLERANZ && !fertig) {
      fertig = true;
      zieht = false;
      hilf.status.textContent = "Objekt erfasst!";
      onFertig();
    } else if (!fertig) {
      hilf.status.textContent = abstand < 22 ? "Fast – ganz leicht nachführen." : "Weiter suchen.";
    }
  }

  sichtfeld.addEventListener("pointerdown", e => {
    if (fertig) return;
    zieht = true;
    start = { x: e.clientX, y: e.clientY, blick: { ...blick } };
    fangeZeiger(sichtfeld, e);
  });
  sichtfeld.addEventListener("pointermove", e => {
    if (!zieht || fertig) return;
    const rect = sichtfeld.getBoundingClientRect();
    blick = {
      x: Math.min(Math.max(start.blick.x - (e.clientX - start.x) / rect.width * 100, 0), 100),
      y: Math.min(Math.max(start.blick.y - (e.clientY - start.y) / rect.height * 100, 0), 100)
    };
    zeichne();
  });
  const los = () => { zieht = false; };
  sichtfeld.addEventListener("pointerup", los);
  sichtfeld.addEventListener("pointercancel", los);

  zeichne();
  return () => {};
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

// --- 14. Pömpel bedienen: auf und ab, bis der Druck im grünen Bereich ist ---
function aufgabePoempel(container, onFertig) {
  const ZUEGE = 6;
  let zuege = 0;
  let obenGewesen = false;
  let zieht = false;
  let fertig = false;

  const hilf = rahmen(container, "Beweg den Pömpel auf und ab, bis der Druck im grünen Bereich ist.", `
    <div class="af-poempel">
      <div class="af-poempel-schacht"><div class="af-poempel-griff" style="top:20%">🪠</div></div>
      <div class="af-druckanzeige"><div class="af-druckgrenze"></div><div class="af-druckpegel"></div></div>
    </div>`);
  hilf.status.textContent = `0 von ${ZUEGE} Zügen`;

  const schacht = hilf.q(".af-poempel-schacht");
  const griff = hilf.q(".af-poempel-griff");
  const pegel = hilf.q(".af-druckpegel");

  function setze(e) {
    const anteil = anteilIn(schacht, e, "y");
    griff.style.top = `${Math.round(anteil * 100)}%`;
    // Ein Zug zählt erst, wenn beide Endlagen berührt wurden — sonst reichte Zappeln in der Mitte.
    if (anteil > 0.8) obenGewesen = true;
    if (anteil < 0.2 && obenGewesen) {
      obenGewesen = false;
      zuege++;
      pegel.style.height = `${Math.round((zuege / ZUEGE) * 100)}%`;
      if (zuege >= ZUEGE) {
        fertig = true;
        zieht = false;
        pegel.classList.add("gut");
        hilf.status.textContent = "Druck im grünen Bereich!";
        onFertig();
        return;
      }
      hilf.status.textContent = `${zuege} von ${ZUEGE} Zügen`;
    }
  }

  schacht.addEventListener("pointerdown", e => { if (fertig) return; zieht = true; fangeZeiger(schacht, e); setze(e); });
  schacht.addEventListener("pointermove", e => { if (zieht && !fertig) setze(e); });
  const los = () => { zieht = false; };
  schacht.addEventListener("pointerup", los);
  schacht.addEventListener("pointercancel", los);

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

// --- 16. WLAN-Router neu starten: Hebel runter, 60 s warten, Hebel hoch ---
function aufgabeWlan(container, onFertig, optionen) {
  return warteAufgabe(container, onFertig, optionen, {
    symbol: "📶",
    startKnopf: "Hebel nach unten",
    anleitungStart: "Zieh den Hebel nach unten – der Router braucht danach eine Minute.",
    anleitungWarten: "Der Router startet neu.",
    schluss(container, onFertig) {
      const hilf = rahmen(container, "Der Router ist hochgefahren – Hebel wieder nach oben.", `
        <div class="af-wlan">
          <div class="af-wlan-symbol">📶</div>
          <button type="button" class="af-wlan-hebel">Hebel nach oben</button>
        </div>`);
      hilf.status.textContent = "Letzter Schritt.";
      hilf.q(".af-wlan-hebel").addEventListener("click", () => {
        const knopf = hilf.q(".af-wlan-hebel");
        if (knopf.disabled) return;
        knopf.disabled = true;
        hilf.q(".af-wlan-symbol").classList.add("an");
        hilf.status.textContent = "WLAN läuft wieder!";
        onFertig();
      });
      return () => {};
    }
  });
}

// --- 17. Knotenpunkt aktivieren: Schalter umlegen, dann Pfad durchs Labyrinth ziehen ---
function aufgabeKnoten(container, onFertig) {
  // Feste kleine Labyrinthe (5x5, 1 = Wand). Fest statt generiert, weil ein zufälliges
  // Labyrinth auch unlösbar sein kann und niemand mitten im Spiel ein Rätsel ohne Ausgang will.
  const LABYRINTHE = [
    [[0,0,1,0,0],[1,0,1,0,1],[0,0,0,0,0],[0,1,1,1,0],[0,0,0,1,0]],
    [[0,1,0,0,0],[0,1,0,1,0],[0,0,0,1,0],[1,1,0,1,0],[0,0,0,1,0]],
    [[0,0,0,1,0],[1,1,0,1,0],[0,0,0,0,0],[0,1,1,1,0],[0,0,0,0,0]]
  ];
  const feldPlan = zufallAus(LABYRINTHE);
  const N = 5;
  let schalterAn = false;
  let pfad = [];
  let zieht = false;

  const hilf = rahmen(container, "Erst den Schalter umlegen, dann den Weg zum Ausgang ziehen.", `
    <button type="button" class="af-knotenschalter">Schalter umlegen</button>
    <div class="af-labyrinth">${feldPlan.map((zeile, y) => zeile.map((z, x) =>
      `<div class="af-lab-zelle${z ? " wand" : ""}" data-x="${x}" data-y="${y}"></div>`).join("")).join("")}</div>`);
  hilf.status.textContent = "Schalter ist aus.";

  const feld = hilf.q(".af-labyrinth");
  const zellen = hilf.alle(".af-lab-zelle");
  const zelleAn = (x, y) => zellen[y * N + x];
  zelleAn(0, 0).classList.add("start");
  zelleAn(N - 1, N - 1).classList.add("ziel");

  hilf.q(".af-knotenschalter").addEventListener("click", () => {
    const knopf = hilf.q(".af-knotenschalter");
    if (schalterAn) return;
    schalterAn = true;
    knopf.disabled = true;
    knopf.textContent = "Schalter ist an";
    feld.classList.add("aktiv");
    hilf.status.textContent = "Jetzt oben links starten und zum Ausgang ziehen.";
  });

  function zelleUnter(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.classList.contains("af-lab-zelle") ? el : null;
  }

  function zuruecksetzen(text) {
    zieht = false;
    pfad.forEach(z => z.classList.remove("weg"));
    pfad = [];
    hilf.status.textContent = text;
  }

  feld.addEventListener("pointerdown", e => {
    if (!schalterAn) { hilf.status.textContent = "Erst den Schalter umlegen."; return; }
    const zelle = zelleUnter(e);
    if (!zelle || zelle.dataset.x !== "0" || zelle.dataset.y !== "0") return;
    zieht = true;
    pfad = [zelle];
    zelle.classList.add("weg");
    fangeZeiger(feld, e);
    hilf.status.textContent = "Weiter …";
  });

  feld.addEventListener("pointermove", e => {
    if (!zieht) return;
    const zelle = zelleUnter(e);
    if (!zelle || zelle === pfad[pfad.length - 1]) return;
    if (zelle.classList.contains("wand")) { zuruecksetzen("Gegen die Wand – noch mal von oben links."); return; }
    const letzte = pfad[pfad.length - 1];
    const dx = Math.abs(Number(zelle.dataset.x) - Number(letzte.dataset.x));
    const dy = Math.abs(Number(zelle.dataset.y) - Number(letzte.dataset.y));
    if (dx + dy !== 1) { zuruecksetzen("Zu weit gesprungen – noch mal von oben links."); return; }
    pfad.push(zelle);
    zelle.classList.add("weg");
    if (zelle.classList.contains("ziel")) {
      zieht = false;
      hilf.status.textContent = "Knotenpunkt aktiv!";
      onFertig();
    }
  });

  feld.addEventListener("pointerup", () => { if (zieht) zuruecksetzen("Losgelassen – noch mal von oben links."); });
  feld.addEventListener("pointercancel", () => { if (zieht) zuruecksetzen("Abgebrochen – noch mal von oben links."); });

  return () => {};
}

// ============================================================
// Interaktive Spezial-Aufgaben
// ============================================================

// --- 18. Schaufensterpuppe anziehen: Vorlage nachstellen ---
function aufgabePuppe(container, onFertig) {
  const TEILE = [
    { id: "hut",    label: "Kopf",  auswahl: ["🎩", "🧢", "⛑️"] },
    { id: "brille", label: "Brille", auswahl: ["🕶️", "👓", "🥽"] },
    { id: "kleid",  label: "Kleidung", auswahl: ["🧥", "👕", "🦺"] }
  ];
  const vorlage = {};
  TEILE.forEach(t => { vorlage[t.id] = zufallAus(t.auswahl); });
  const gewaehlt = {};

  const hilf = rahmen(container, "Zieh die Puppe genau so an wie auf der Vorlage.", `
    <div class="af-puppe">
      <div class="af-puppe-vorlage">
        <span class="af-puppe-titel">Vorlage</span>
        <div class="af-puppe-figur">${TEILE.map(t => `<span>${vorlage[t.id]}</span>`).join("")}</div>
      </div>
      <div class="af-puppe-eigen">
        <span class="af-puppe-titel">Deine Puppe</span>
        <div class="af-puppe-figur">${TEILE.map(t => `<span data-slot="${t.id}">·</span>`).join("")}</div>
      </div>
    </div>
    <div class="af-puppe-auswahl">${TEILE.map(t => `
      <div class="af-puppe-reihe" data-teil="${t.id}">
        <span class="af-puppe-label">${t.label}</span>
        ${t.auswahl.map(a => `<button type="button" class="af-puppe-knopf" data-teil="${t.id}" data-wert="${a}">${a}</button>`).join("")}
      </div>`).join("")}</div>`);
  hilf.status.textContent = "Noch nichts angezogen.";

  function pruefe() {
    const fehlend = TEILE.filter(t => !gewaehlt[t.id]).length;
    if (fehlend > 0) { hilf.status.textContent = `Noch ${fehlend} Teil(e) offen.`; return; }
    const passt = TEILE.every(t => gewaehlt[t.id] === vorlage[t.id]);
    if (!passt) { hilf.status.textContent = "Etwas stimmt noch nicht mit der Vorlage überein."; return; }
    hilf.alle(".af-puppe-knopf").forEach(b => { b.disabled = true; });
    hilf.status.textContent = "Sitzt genau wie auf der Vorlage!";
    onFertig();
  }

  hilf.alle(".af-puppe-knopf").forEach(btn => {
    btn.addEventListener("click", () => {
      const teil = btn.dataset.teil;
      gewaehlt[teil] = btn.dataset.wert;
      hilf.alle(`.af-puppe-knopf[data-teil="${teil}"]`).forEach(b => b.classList.remove("aktiv"));
      btn.classList.add("aktiv");
      hilf.q(`[data-slot="${teil}"]`).textContent = btn.dataset.wert;
      pruefe();
    });
  });

  return () => {};
}

// --- 19. Marshmallows rösten: über dem Feuer halten, bis er goldbraun ist ---
// Loslassen im Fenster zählt; zu lange halten verbrennt ihn und man fängt von vorn an.
function aufgabeMarshmallow(container, onFertig) {
  const GUT_AB = 2400;
  const VERBRANNT_AB = 3800;
  let zeit = 0;
  let haelt = false;
  let fertig = false;

  const hilf = rahmen(container, "Halte den Marshmallow über das Feuer – goldbraun, nicht schwarz.", `
    <div class="af-lagerfeuer">
      <div class="af-marshmallow">🍡</div>
      <div class="af-feuer">🔥</div>
      <div class="af-roestbalken">
        <div class="af-roestzone"></div>
        <div class="af-roestpegel"></div>
      </div>
    </div>
    <button type="button" class="af-roestknopf">Über das Feuer halten</button>`);
  hilf.status.textContent = "Roh.";

  const marsh = hilf.q(".af-marshmallow");
  const pegel = hilf.q(".af-roestpegel");
  const knopf = hilf.q(".af-roestknopf");

  const stopp = taktgeber(delta => {
    if (fertig) return;
    if (haelt) zeit += delta;
    const anteil = Math.min(zeit / VERBRANNT_AB, 1);
    pegel.style.width = `${Math.round(anteil * 100)}%`;
    if (zeit >= VERBRANNT_AB) {
      zeit = 0;
      haelt = false;
      knopf.classList.remove("gedrueckt");
      marsh.textContent = "🌑";
      hilf.status.textContent = "Verbrannt – nimm einen neuen.";
      setTimeout(() => { if (!fertig) marsh.textContent = "🍡"; }, 900);
      return;
    }
    if (zeit >= GUT_AB) { marsh.textContent = "🟤"; hilf.status.textContent = "Goldbraun – jetzt loslassen!"; }
    else if (zeit > 800) { marsh.textContent = "🍡"; hilf.status.textContent = "Wird warm …"; }
  });

  const halte = e => { if (fertig) return; haelt = true; fangeZeiger(knopf, e); knopf.classList.add("gedrueckt"); };
  const lasse = () => {
    if (fertig || !haelt) return;
    haelt = false;
    knopf.classList.remove("gedrueckt");
    if (zeit >= GUT_AB && zeit < VERBRANNT_AB) {
      fertig = true;
      knopf.disabled = true;
      marsh.textContent = "🟤";
      hilf.status.textContent = "Perfekt geröstet!";
      onFertig();
    } else {
      zeit = 0;
      pegel.style.width = "0%";
      hilf.status.textContent = "Zu früh – noch mal.";
    }
  };
  knopf.addEventListener("pointerdown", halte);
  knopf.addEventListener("pointerup", lasse);
  knopf.addEventListener("pointercancel", lasse);
  knopf.addEventListener("pointerleave", lasse);

  return stopp;
}

// --- 20. Gemüse hacken: mit Wischgesten quer über die Zutat ---
function aufgabeGemuese(container, onFertig) {
  const ZUTATEN = ["🥕", "🥒", "🌶️", "🍆"];
  const runde = mischen(ZUTATEN).slice(0, 3);
  let index = 0;
  let hiebe = 0;
  const HIEBE_PRO_ZUTAT = 3;
  let start = null;

  const hilf = rahmen(container, "Wisch quer über die Zutat, um sie zu zerkleinern.", `
    <div class="af-brett">
      <div class="af-zutat"></div>
      <div class="af-stuecke"></div>
    </div>`);

  const brett = hilf.q(".af-brett");
  const zutat = hilf.q(".af-zutat");
  const stuecke = hilf.q(".af-stuecke");

  function zeige() {
    zutat.textContent = runde[index];
    stuecke.textContent = "";
    hiebe = 0;
    hilf.status.textContent = `Zutat ${index + 1} von ${runde.length}`;
  }

  brett.addEventListener("pointerdown", e => {
    start = { x: e.clientX, y: e.clientY };
    fangeZeiger(brett, e);
  });

  brett.addEventListener("pointerup", e => {
    if (!start || index >= runde.length) { start = null; return; }
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    // Ein Hieb ist ein deutlicher, überwiegend senkrechter Wisch — ein Tippen zählt nicht,
    // sonst wäre die Aufgabe mit dreimal Antippen erledigt.
    if (Math.abs(dy) < 40 || Math.abs(dy) < Math.abs(dx)) {
      hilf.status.textContent = "Zu zaghaft – kräftig von oben nach unten wischen.";
      return;
    }
    hiebe++;
    stuecke.textContent += runde[index];
    zutat.classList.add("hieb");
    setTimeout(() => zutat.classList.remove("hieb"), 160);
    if (hiebe < HIEBE_PRO_ZUTAT) {
      hilf.status.textContent = `Zutat ${index + 1}: noch ${HIEBE_PRO_ZUTAT - hiebe} Schnitte`;
      return;
    }
    index++;
    if (index >= runde.length) {
      zutat.textContent = "🥗";
      hilf.status.textContent = "Alles klein!";
      onFertig();
      return;
    }
    zeige();
  });

  brett.addEventListener("pointercancel", () => { start = null; });

  zeige();
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
  proben:       { name: "Proben analysieren",    start: aufgabeProben, wartenSek: WARTEZEIT_SEK, sichtbar: "🧪" },
  // Strom & Verkabelung
  kabel:        { name: "Kabel reparieren",      start: aufgabeKabel, teile: 3 },
  strom:        { name: "Strom umleiten",        start: aufgabeStrom, kette: ["electrical", "*"] },
  verteiler:    { name: "Verteiler kalibrieren", start: aufgabeVerteiler },
  sicherungen:  { name: "Sicherungen zurücksetzen", start: aufgabeSicherungen },
  // Navigation & Zielgenauigkeit
  kurs:         { name: "Kurs stabilisieren",    start: aufgabeKurs },
  triebwerk:    { name: "Triebwerke ausrichten", start: aufgabeTriebwerk },
  asteroiden:   { name: "Asteroiden zerstören",  start: aufgabeAsteroiden, sichtbar: "💥" },
  teleskop:     { name: "Teleskop ausrichten",   start: aufgabeTeleskop },
  // Müll & Reinigung
  muell:        { name: "Müll entsorgen",        start: aufgabeMuell, sichtbar: "🗑️" },
  filter:       { name: "Filter reinigen",       start: aufgabeFilter, sichtbar: "🍃" },
  poempel:      { name: "Pömpel bedienen",       start: aufgabePoempel },
  // Daten & Signale
  daten:        { name: "Daten übertragen",      start: aufgabeDaten, kette: ["*", "admin"] },
  wlan:         { name: "WLAN-Router neustarten", start: aufgabeWlan, wartenSek: WARTEZEIT_SEK },
  knoten:       { name: "Knotenpunkt aktivieren", start: aufgabeKnoten },
  // Interaktive Spezial-Aufgaben
  puppe:        { name: "Schaufensterpuppe anziehen", start: aufgabePuppe },
  marshmallow:  { name: "Marshmallows rösten",   start: aufgabeMarshmallow, sichtbar: "🔥" },
  gemuese:      { name: "Gemüse hacken",         start: aufgabeGemuese }
};

const aufgabenModul = { AUFGABEN_TYPEN, reparaturLicht, reparaturKuehlung, mischen, WARTEZEIT_SEK };

if (typeof module !== "undefined" && module.exports) module.exports = aufgabenModul;
