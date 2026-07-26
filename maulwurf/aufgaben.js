// Die Aufgaben-Minispiele. Reines DOM/Timer-Modul ohne Firebase-Bezug: jede Aufgabe bekommt
// einen leeren Container und eine onFertig-Funktion und gibt eine Aufräumfunktion zurück
// (Timer/Listener stoppen, falls die Aufgabe vorzeitig geschlossen wird — z.B. weil ein
// Meeting startet).
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
// alle Bedienelemente mindestens fingergroß.

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

// ============================================================
// 1–6: die Aufgaben der ersten Fassung
// ============================================================

// --- 1. Trikots nach Rückennummer sortieren ---
function aufgabeTrikots(container, onFertig) {
  const nummern = mischen([4, 7, 9, 11, 17, 23]).slice(0, 5);
  const sortiert = nummern.slice().sort((a, b) => a - b);
  let index = 0;

  const hilf = rahmen(container, "Häng die Trikots auf – aufsteigend nach Rückennummer.", `<div class="af-trikots"></div>`);
  hilf.status.textContent = "Als nächstes: die kleinste Nummer";
  const feld = hilf.q(".af-trikots");

  nummern.forEach(nr => {
    const btn = document.createElement("button");
    btn.className = "af-trikot";
    btn.type = "button";
    btn.textContent = nr;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("erledigt")) return;
      if (nr === sortiert[index]) {
        btn.classList.add("erledigt");
        index++;
        if (index >= sortiert.length) {
          hilf.status.textContent = "Fertig!";
          onFertig();
        } else {
          hilf.status.textContent = `Noch ${sortiert.length - index} Trikot(s)`;
        }
      } else {
        index = 0;
        feld.querySelectorAll(".af-trikot").forEach(e => e.classList.remove("erledigt"));
        hilf.status.textContent = "Falsche Nummer – noch mal von vorn.";
      }
    });
    feld.appendChild(btn);
  });

  return () => {};
}

// --- 2. Bälle auf Solldruck aufpumpen ---
// Halten lässt die Nadel steigen, Loslassen im grünen Bereich zählt. Drei Bälle.
function aufgabeBaelle(container, onFertig) {
  const ZIEL_MIN = 62;
  const ZIEL_MAX = 82;
  let druck = 0;
  let pumpt = false;
  let fertigeBaelle = 0;
  let timer = null;

  const hilf = rahmen(container, "Halte gedrückt zum Pumpen und lass im grünen Bereich los.", `
    <div class="af-manometer">
      <div class="af-zielzone" style="left:${ZIEL_MIN}%;width:${ZIEL_MAX - ZIEL_MIN}%"></div>
      <div class="af-nadel"></div>
    </div>
    <button class="btn btn-primary btn-grow af-pumpe" type="button">Pumpen</button>`);
  hilf.status.textContent = "Ball 1 von 3";
  const nadel = hilf.q(".af-nadel");

  function zeichne() {
    nadel.style.left = druck + "%";
    nadel.classList.toggle("im-ziel", druck >= ZIEL_MIN && druck <= ZIEL_MAX);
  }

  function starte() {
    if (pumpt) return;
    pumpt = true;
    timer = setInterval(() => {
      druck += 2.2;
      if (druck > 100) druck = 0; // übergepumpt: Ventil öffnet, von vorn
      zeichne();
    }, 40);
  }

  function stoppe() {
    if (!pumpt) return;
    pumpt = false;
    clearInterval(timer);
    timer = null;
    if (druck >= ZIEL_MIN && druck <= ZIEL_MAX) {
      fertigeBaelle++;
      if (fertigeBaelle >= 3) {
        hilf.status.textContent = "Alle Bälle prall!";
        onFertig();
        return;
      }
      hilf.status.textContent = `Ball ${fertigeBaelle + 1} von 3`;
    } else {
      hilf.status.textContent = druck > ZIEL_MAX ? "Zu viel Druck – noch mal." : "Zu wenig Druck – noch mal.";
    }
    druck = 0;
    zeichne();
  }

  const pumpe = hilf.q(".af-pumpe");
  pumpe.addEventListener("pointerdown", e => { e.preventDefault(); starte(); });
  pumpe.addEventListener("pointerup", stoppe);
  pumpe.addEventListener("pointercancel", stoppe);
  pumpe.addEventListener("pointerleave", stoppe);
  zeichne();

  return () => { if (timer) clearInterval(timer); };
}

// --- 3. Eckfahnen in der vorgegebenen Reihenfolge stecken (Merkspiel) ---
function aufgabeEckfahnen(container, onFertig) {
  const ECKEN = ["↖", "↗", "↙", "↘"];
  const folge = [];
  for (let i = 0; i < 4; i++) folge.push(Math.floor(Math.random() * 4));
  let eingabeIndex = 0;
  let zeigtVor = true;
  const timer = [];

  const hilf = rahmen(container, "Merk dir die Reihenfolge und tipp sie nach.", `<div class="af-ecken"></div>`);
  const feld = hilf.q(".af-ecken");
  const knoepfe = [];

  ECKEN.forEach((zeichen, i) => {
    const btn = document.createElement("button");
    btn.className = "af-ecke";
    btn.type = "button";
    btn.textContent = zeichen;
    btn.addEventListener("click", () => {
      if (zeigtVor) return;
      if (i === folge[eingabeIndex]) {
        eingabeIndex++;
        blinke(i, 220);
        if (eingabeIndex >= folge.length) {
          hilf.status.textContent = "Alle Fahnen stecken!";
          onFertig();
        } else {
          hilf.status.textContent = `Noch ${folge.length - eingabeIndex}`;
        }
      } else {
        eingabeIndex = 0;
        hilf.status.textContent = "Falsch – die Folge kommt noch mal.";
        spieleFolgeVor();
      }
    });
    knoepfe.push(btn);
    feld.appendChild(btn);
  });

  function blinke(i, dauer) {
    knoepfe[i].classList.add("aktiv");
    timer.push(setTimeout(() => knoepfe[i].classList.remove("aktiv"), dauer));
  }

  function spieleFolgeVor() {
    zeigtVor = true;
    hilf.status.textContent = "Aufpassen …";
    folge.forEach((eckIndex, pos) => {
      timer.push(setTimeout(() => blinke(eckIndex, 400), 400 + pos * 620));
    });
    timer.push(setTimeout(() => {
      zeigtVor = false;
      hilf.status.textContent = "Jetzt du!";
    }, 400 + folge.length * 620));
  }

  spieleFolgeVor();
  return () => timer.forEach(t => clearTimeout(t));
}

// --- 4. Getränkekisten stapeln (Timing) ---
function aufgabeKisten(container, onFertig) {
  let position = 0;
  let richtung = 1;
  let tempo = 1.6;
  let treffer = 0;
  const ZONE_MIN = 42;
  const ZONE_MAX = 58;

  const hilf = rahmen(container, "Tipp, wenn der Greifer über der Palette steht.", `
    <div class="af-bahn">
      <div class="af-zone" style="left:${ZONE_MIN}%;width:${ZONE_MAX - ZONE_MIN}%"></div>
      <div class="af-greifer">🟦</div>
    </div>
    <button class="btn btn-primary btn-grow af-absetzen" type="button">Absetzen</button>`);
  hilf.status.textContent = "Kiste 1 von 3";
  const greifer = hilf.q(".af-greifer");

  const timer = setInterval(() => {
    position += richtung * tempo;
    if (position >= 100) { position = 100; richtung = -1; }
    if (position <= 0) { position = 0; richtung = 1; }
    greifer.style.left = position + "%";
  }, 16);

  hilf.q(".af-absetzen").addEventListener("click", () => {
    if (position >= ZONE_MIN && position <= ZONE_MAX) {
      treffer++;
      if (treffer >= 3) {
        clearInterval(timer);
        hilf.status.textContent = "Alle Kisten gestapelt!";
        onFertig();
        return;
      }
      tempo += 0.5;
      hilf.status.textContent = `Kiste ${treffer + 1} von 3`;
    } else {
      hilf.status.textContent = "Daneben – Kiste zurück auf den Wagen.";
    }
  });

  return () => clearInterval(timer);
}

// --- 5. Linien nachziehen ---
// Der Finger muss von links nach rechts innerhalb der Segmente bleiben; einmal raus =
// zurück zum Start. Segmente sind Prozentangaben im Container (responsiv).
function aufgabeLinien(container, onFertig) {
  const SEGMENTE = [
    { x: 4,  y: 62, w: 26, h: 16 },
    { x: 26, y: 24, w: 16, h: 54 },
    { x: 26, y: 24, w: 34, h: 16 },
    { x: 56, y: 24, w: 16, h: 54 },
    { x: 56, y: 62, w: 40, h: 16 }
  ];

  const hilf = rahmen(container, "Zieh die Linie mit dem Finger nach – ohne den Rand zu verlassen.", `
    <div class="af-linienfeld">
      ${SEGMENTE.map(s => `<div class="af-segment" style="left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%"></div>`).join("")}
      <div class="af-linienstart">Start</div>
      <div class="af-linienziel">Ziel</div>
    </div>`);
  hilf.status.textContent = 'Am "Start" beginnen.';
  const feld = hilf.q(".af-linienfeld");
  let zieht = false;

  function prozentPosition(e) {
    const rect = feld.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 };
  }

  function aufDerLinie(p) {
    return SEGMENTE.some(s => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h);
  }

  // Zwischen zwei pointermove-Ereignissen liegt je nach Wischtempo eine ganze Strecke. Würde
  // nur deren Endpunkt geprüft, ließe sich die Aufgabe mit einem schnellen waagerechten Wisch
  // lösen: die Lücke zwischen zwei Segmenten wird dann schlicht übersprungen (gefunden mit
  // einer Gegenprobe, 2026-07-26). Deshalb wird die Strecke feinschrittig abgetastet.
  function streckeAufDerLinie(von, bis) {
    const schritte = Math.max(Math.ceil(Math.hypot(bis.x - von.x, bis.y - von.y) / 1.5), 1);
    for (let i = 1; i <= schritte; i++) {
      const anteil = i / schritte;
      if (!aufDerLinie({ x: von.x + (bis.x - von.x) * anteil, y: von.y + (bis.y - von.y) * anteil })) return false;
    }
    return true;
  }

  let letzterPunkt = null;

  feld.addEventListener("pointerdown", e => {
    const p = prozentPosition(e);
    if (p.x <= 14 && aufDerLinie(p)) {
      zieht = true;
      letzterPunkt = p;
      feld.classList.add("aktiv");
      hilf.status.textContent = "Weiter …";
      try { feld.setPointerCapture(e.pointerId); } catch (err) { /* Testartefakt, unkritisch */ }
    }
  });

  feld.addEventListener("pointermove", e => {
    if (!zieht) return;
    const p = prozentPosition(e);
    if (!streckeAufDerLinie(letzterPunkt, p)) {
      zieht = false;
      letzterPunkt = null;
      feld.classList.remove("aktiv");
      hilf.status.textContent = "Verrutscht – noch mal am Start beginnen.";
      return;
    }
    letzterPunkt = p;
    if (p.x >= 90) {
      zieht = false;
      feld.classList.remove("aktiv");
      hilf.status.textContent = "Linie sitzt!";
      onFertig();
    }
  });

  const abbruch = () => {
    if (!zieht) return;
    zieht = false;
    letzterPunkt = null;
    feld.classList.remove("aktiv");
    hilf.status.textContent = "Losgelassen – noch mal am Start beginnen.";
  };
  feld.addEventListener("pointerup", abbruch);
  feld.addEventListener("pointercancel", abbruch);

  return () => {};
}

// --- 6. Schlüssel im Schlüsselkasten finden (Memory) ---
function aufgabeSchluessel(container, onFertig) {
  const paare = ["🔑", "🗝️", "🔐"];
  const karten = mischen(paare.concat(paare));
  let offen = [];
  let gefunden = 0;
  let blockiert = false;
  const timer = [];

  const hilf = rahmen(container, "Finde die drei Schlüsselpaare.", `<div class="af-gitter" style="--spalten:6"></div>`);
  hilf.status.textContent = "0 von 3 Paaren";
  const feld = hilf.q(".af-gitter");

  karten.forEach(symbol => {
    const btn = document.createElement("button");
    btn.className = "af-kachel zu";
    btn.type = "button";
    btn.dataset.symbol = symbol;
    btn.textContent = "?";
    btn.addEventListener("click", () => {
      if (blockiert || btn.classList.contains("offen") || btn.classList.contains("gut")) return;
      btn.classList.remove("zu");
      btn.classList.add("offen");
      btn.textContent = symbol;
      offen.push(btn);
      if (offen.length < 2) return;

      if (offen[0].dataset.symbol === offen[1].dataset.symbol) {
        offen.forEach(k => { k.classList.remove("offen"); k.classList.add("gut"); });
        offen = [];
        gefunden++;
        hilf.status.textContent = `${gefunden} von 3 Paaren`;
        if (gefunden >= 3) {
          hilf.status.textContent = "Alle Schlüssel gefunden!";
          onFertig();
        }
      } else {
        blockiert = true;
        timer.push(setTimeout(() => {
          offen.forEach(k => { k.classList.remove("offen"); k.classList.add("zu"); k.textContent = "?"; });
          offen = [];
          blockiert = false;
        }, 750));
      }
    });
    feld.appendChild(btn);
  });

  return () => timer.forEach(t => clearTimeout(t));
}

// ============================================================
// 7–25: die weiteren Aufgaben
// ============================================================

// --- 7. Tornetz flicken: alle Löcher stopfen ---
function aufgabeNetz(container, onFertig) {
  const FELDER = 24;
  const loecher = mischen(Array.from({ length: FELDER }, (unused, i) => i)).slice(0, 5);
  let gestopft = 0;

  const hilf = rahmen(container, "Stopf alle Löcher im Tornetz.", `<div class="af-gitter af-netz" style="--spalten:8"></div>`);
  const feld = hilf.q(".af-netz");
  hilf.status.textContent = `0 von ${loecher.length} Löchern`;

  for (let i = 0; i < FELDER; i++) {
    const btn = document.createElement("button");
    btn.className = "af-kachel" + (loecher.indexOf(i) !== -1 ? " loch" : " heil");
    btn.type = "button";
    btn.textContent = loecher.indexOf(i) !== -1 ? "🕳️" : "";
    btn.addEventListener("click", () => {
      if (loecher.indexOf(i) === -1) {
        hilf.status.textContent = "Da ist kein Loch.";
        return;
      }
      if (btn.classList.contains("gut")) return;
      btn.classList.remove("loch");
      btn.classList.add("gut");
      btn.textContent = "✓";
      gestopft++;
      hilf.status.textContent = `${gestopft} von ${loecher.length} Löchern`;
      if (gestopft >= loecher.length) {
        hilf.status.textContent = "Netz ist wieder dicht!";
        onFertig();
      }
    });
    feld.appendChild(btn);
  }

  return () => {};
}

// --- 8. Waschgang einstellen: drei Regler auf Sollwert ---
function aufgabeWaschgang(container, onFertig) {
  const REGLER = [
    { name: "Temperatur", einheit: "°C", min: 20, max: 90, schritt: 10 },
    { name: "Schleudern", einheit: "U/min", min: 400, max: 1400, schritt: 200 },
    { name: "Dauer", einheit: "min", min: 30, max: 120, schritt: 15 }
  ];
  const ziele = REGLER.map(r => {
    const stufen = Math.floor((r.max - r.min) / r.schritt);
    return r.min + zufallZahl(1, stufen - 1) * r.schritt;
  });

  const hilf = rahmen(container, "Stell das Waschprogramm auf die Vorgaben ein.", `
    <div class="af-regler-liste">
      ${REGLER.map((r, i) => `
        <label class="af-regler">
          <span class="af-regler-kopf">${r.name}<b>Soll: ${ziele[i]} ${r.einheit}</b></span>
          <input type="range" min="${r.min}" max="${r.max}" step="${r.schritt}" value="${r.min}" data-index="${i}">
          <span class="af-regler-wert">${r.min} ${r.einheit}</span>
        </label>`).join("")}
    </div>`);

  function pruefe() {
    const passt = hilf.alle("input[type=range]").every((el, i) => parseInt(el.value, 10) === ziele[i]);
    hilf.status.textContent = passt ? "Programm läuft!" : "Noch nicht alle Werte stimmen.";
    if (passt) onFertig();
  }

  hilf.alle("input[type=range]").forEach((el, i) => {
    el.addEventListener("input", () => {
      const wert = el.parentElement.querySelector(".af-regler-wert");
      wert.textContent = `${el.value} ${REGLER[i].einheit}`;
      wert.classList.toggle("gut", parseInt(el.value, 10) === ziele[i]);
      pruefe();
    });
  });

  return () => {};
}

// --- 9. Getränkekasten auffüllen: nur die richtige Sorte einräumen ---
function aufgabeGetraenke(container, onFertig) {
  const SORTEN = ["🧃", "🥤", "🍶", "🧋"];
  const gesucht = zufallAus(SORTEN);
  const flaschen = [];
  for (let i = 0; i < 12; i++) flaschen.push(i < 5 ? gesucht : zufallAus(SORTEN.filter(s => s !== gesucht)));
  const gemischt = mischen(flaschen);
  const anzahlGesucht = gemischt.filter(f => f === gesucht).length;
  let eingeraeumt = 0;

  const hilf = rahmen(container, `Räum nur ${gesucht} in den Kasten – nichts anderes.`, `<div class="af-gitter" style="--spalten:6"></div>`);
  const feld = hilf.q(".af-gitter");
  hilf.status.textContent = `0 von ${anzahlGesucht}`;

  gemischt.forEach(sorte => {
    const btn = document.createElement("button");
    btn.className = "af-kachel";
    btn.type = "button";
    btn.textContent = sorte;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (sorte !== gesucht) {
        hilf.status.textContent = "Falsche Sorte – die gehört woanders hin.";
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 400);
        return;
      }
      btn.disabled = true;
      btn.classList.add("gut");
      eingeraeumt++;
      hilf.status.textContent = `${eingeraeumt} von ${anzahlGesucht}`;
      if (eingeraeumt >= anzahlGesucht) {
        hilf.status.textContent = "Kasten ist voll!";
        onFertig();
      }
    });
    feld.appendChild(btn);
  });

  return () => {};
}

// --- 10. Rasen mähen: mit dem Finger über alle Bahnen ---
function aufgabeMaehen(container, onFertig) {
  const SPALTEN = 8;
  const ZEILEN = 3;
  let gemaeht = 0;

  const hilf = rahmen(container, "Fahr mit dem Finger über den ganzen Rasen.", `<div class="af-gitter af-rasen" style="--spalten:${SPALTEN}"></div>`);
  const feld = hilf.q(".af-rasen");
  const gesamt = SPALTEN * ZEILEN;
  hilf.status.textContent = `0 von ${gesamt} Bahnen`;

  for (let i = 0; i < gesamt; i++) {
    const zelle = document.createElement("div");
    zelle.className = "af-kachel af-halm";
    feld.appendChild(zelle);
  }

  function maehe(el) {
    if (!el || !el.classList.contains("af-halm") || el.classList.contains("gut")) return;
    el.classList.add("gut");
    gemaeht++;
    hilf.status.textContent = `${gemaeht} von ${gesamt} Bahnen`;
    if (gemaeht >= gesamt) {
      hilf.status.textContent = "Platz ist gemäht!";
      onFertig();
    }
  }

  let zieht = false;
  feld.addEventListener("pointerdown", e => {
    zieht = true;
    maehe(document.elementFromPoint(e.clientX, e.clientY));
  });
  feld.addEventListener("pointermove", e => {
    if (!zieht) return;
    maehe(document.elementFromPoint(e.clientX, e.clientY));
  });
  const stopp = () => { zieht = false; };
  feld.addEventListener("pointerup", stopp);
  feld.addEventListener("pointercancel", stopp);
  feld.addEventListener("pointerleave", stopp);

  return () => {};
}

// --- 11. Trillerpfeife prüfen: Ton im grünen Bereich halten ---
function aufgabePfeife(container, onFertig) {
  const ZIEL_MIN = 55;
  const ZIEL_MAX = 78;
  const HALTEN_MS = 1800;
  let ton = 0;
  let haelt = false;
  let imZielSeit = 0;
  let timer = null;

  const hilf = rahmen(container, "Pfeif gleichmäßig – halte den Ton 2 Sekunden im grünen Feld.", `
    <div class="af-saeule">
      <div class="af-zielband" style="bottom:${ZIEL_MIN}%;height:${ZIEL_MAX - ZIEL_MIN}%"></div>
      <div class="af-pegel"></div>
    </div>
    <button class="btn btn-primary btn-grow af-pusten" type="button">Pusten (halten)</button>`);
  const pegel = hilf.q(".af-pegel");
  hilf.status.textContent = "Noch nichts im grünen Feld.";

  timer = setInterval(() => {
    ton += haelt ? 2.6 : -3.4;
    ton = Math.max(0, Math.min(100, ton));
    pegel.style.height = ton + "%";
    const drin = ton >= ZIEL_MIN && ton <= ZIEL_MAX;
    pegel.classList.toggle("gut", drin);
    if (drin) {
      imZielSeit += 60;
      hilf.status.textContent = `Halten … ${Math.max(0, Math.ceil((HALTEN_MS - imZielSeit) / 100) / 10).toFixed(1)} s`;
      if (imZielSeit >= HALTEN_MS) {
        clearInterval(timer);
        timer = null;
        hilf.status.textContent = "Pfeife ist in Ordnung!";
        onFertig();
      }
    } else if (imZielSeit > 0) {
      imZielSeit = 0;
      hilf.status.textContent = ton > ZIEL_MAX ? "Zu kräftig." : "Zu schwach.";
    }
  }, 60);

  const pusten = hilf.q(".af-pusten");
  pusten.addEventListener("pointerdown", e => { e.preventDefault(); haelt = true; });
  const los = () => { haelt = false; };
  pusten.addEventListener("pointerup", los);
  pusten.addEventListener("pointercancel", los);
  pusten.addEventListener("pointerleave", los);

  return () => { if (timer) clearInterval(timer); };
}

// --- 12. Verbandskasten auffüllen: die fehlenden Teile heraussuchen ---
function aufgabeVerbandskasten(container, onFertig) {
  const ALLES = ["🩹", "🧴", "✂️", "🧤", "🩺", "💊", "🧊", "🧻", "🩸"];
  const fehlt = mischen(ALLES).slice(0, 3);
  let gefunden = 0;

  const hilf = rahmen(container, "Diese Teile fehlen – such sie im Regal heraus.", `
    <div class="af-merkzettel">${fehlt.map(s => `<span>${s}</span>`).join("")}</div>
    <div class="af-gitter" style="--spalten:${ALLES.length > 6 ? 5 : 3}"></div>`);
  const feld = hilf.q(".af-gitter");
  hilf.status.textContent = `0 von ${fehlt.length}`;

  mischen(ALLES).forEach(symbol => {
    const btn = document.createElement("button");
    btn.className = "af-kachel";
    btn.type = "button";
    btn.textContent = symbol;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (fehlt.indexOf(symbol) === -1) {
        hilf.status.textContent = "Das ist noch genug da.";
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 400);
        return;
      }
      btn.disabled = true;
      btn.classList.add("gut");
      gefunden++;
      hilf.status.textContent = `${gefunden} von ${fehlt.length}`;
      if (gefunden >= fehlt.length) {
        hilf.status.textContent = "Verbandskasten ist komplett!";
        onFertig();
      }
    });
    feld.appendChild(btn);
  });

  return () => {};
}

// --- 13. Tabelle sortieren: Mannschaften nach Punkten ---
function aufgabeTabelle(container, onFertig) {
  const NAMEN = ["SC 1911", "SV Eichsfeld", "FC Leinetal", "TSV Rhume", "SG Werra"];
  const punkte = mischen([12, 18, 24, 31, 37]);
  const teams = NAMEN.map((name, i) => ({ name, punkte: punkte[i] }));
  const reihenfolge = teams.slice().sort((a, b) => b.punkte - a.punkte);
  let index = 0;

  const hilf = rahmen(container, "Tipp die Mannschaften an – Tabellenführer zuerst.", `<div class="af-zeilen"></div>`);
  const feld = hilf.q(".af-zeilen");
  hilf.status.textContent = "Platz 1 …";

  mischen(teams).forEach(team => {
    const btn = document.createElement("button");
    btn.className = "af-zeile";
    btn.type = "button";
    btn.innerHTML = `<span>${team.name}</span><b>${team.punkte}</b>`;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("gut")) return;
      if (team.name === reihenfolge[index].name) {
        btn.classList.add("gut");
        index++;
        if (index >= reihenfolge.length) {
          hilf.status.textContent = "Tabelle steht!";
          onFertig();
        } else {
          hilf.status.textContent = `Platz ${index + 1} …`;
        }
      } else {
        index = 0;
        feld.querySelectorAll(".af-zeile").forEach(e => e.classList.remove("gut"));
        hilf.status.textContent = "Falsch – noch mal bei Platz 1 anfangen.";
      }
    });
    feld.appendChild(btn);
  });

  return () => {};
}

// --- 14. Stollen schrauben: jeden Stollen festhalten, bis er sitzt ---
function aufgabeStollen(container, onFertig) {
  const ANZAHL = 6;
  const DAUER_MS = 700;
  let fertig = 0;
  let timer = null;

  const hilf = rahmen(container, "Halte jeden Stollen gedrückt, bis er festsitzt.", `<div class="af-gitter" style="--spalten:6"></div>`);
  const feld = hilf.q(".af-gitter");
  hilf.status.textContent = `0 von ${ANZAHL} festgeschraubt`;

  for (let i = 0; i < ANZAHL; i++) {
    const btn = document.createElement("button");
    btn.className = "af-kachel af-stollen";
    btn.type = "button";
    btn.innerHTML = `<span class="af-fuellung"></span>⚙️`;
    const fuellung = btn.querySelector(".af-fuellung");
    let start = 0;

    const beginne = e => {
      e.preventDefault();
      if (btn.classList.contains("gut") || timer) return;
      start = Date.now();
      timer = setInterval(() => {
        const anteil = Math.min((Date.now() - start) / DAUER_MS, 1);
        fuellung.style.height = anteil * 100 + "%";
        if (anteil >= 1) {
          clearInterval(timer);
          timer = null;
          btn.classList.add("gut");
          fertig++;
          hilf.status.textContent = `${fertig} von ${ANZAHL} festgeschraubt`;
          if (fertig >= ANZAHL) {
            hilf.status.textContent = "Alle Stollen sitzen!";
            onFertig();
          }
        }
      }, 40);
    };
    const beende = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      if (!btn.classList.contains("gut")) fuellung.style.height = "0%";
    };

    btn.addEventListener("pointerdown", beginne);
    btn.addEventListener("pointerup", beende);
    btn.addEventListener("pointercancel", beende);
    btn.addEventListener("pointerleave", beende);
    feld.appendChild(btn);
  }

  return () => { if (timer) clearInterval(timer); };
}

// --- 15. Kabel verbinden: gleiche Farben zusammenführen ---
function aufgabeKabel(container, onFertig) {
  const FARBEN = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b"];
  const rechts = mischen(FARBEN);
  let gewaehlt = null;
  let verbunden = 0;

  const hilf = rahmen(container, "Verbinde die Kabel – erst links, dann rechts.", `
    <div class="af-kabel">
      <div class="af-kabel-spalte">${FARBEN.map((f, i) => `<button type="button" class="af-stecker" data-seite="links" data-farbe="${f}" data-i="${i}" style="background:${f}"></button>`).join("")}</div>
      <div class="af-kabel-spalte">${rechts.map((f, i) => `<button type="button" class="af-stecker" data-seite="rechts" data-farbe="${f}" data-i="${i}" style="background:${f}"></button>`).join("")}</div>
    </div>`);
  hilf.status.textContent = `0 von ${FARBEN.length} Kabeln`;

  hilf.alle(".af-stecker").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (btn.dataset.seite === "links") {
        hilf.alle('.af-stecker[data-seite="links"]').forEach(b => b.classList.remove("aktiv"));
        btn.classList.add("aktiv");
        gewaehlt = btn;
        hilf.status.textContent = "… und jetzt die passende Farbe rechts.";
        return;
      }
      if (!gewaehlt) { hilf.status.textContent = "Erst links ein Kabel wählen."; return; }
      if (gewaehlt.dataset.farbe !== btn.dataset.farbe) {
        hilf.status.textContent = "Andere Farbe – das gibt einen Kurzschluss.";
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
      hilf.status.textContent = `${verbunden} von ${FARBEN.length} Kabeln`;
      if (verbunden >= FARBEN.length) {
        hilf.status.textContent = "Alles verkabelt!";
        onFertig();
      }
    });
  });

  return () => {};
}

// --- 16. Spind aufschließen: Zahlenschloss stellen ---
function aufgabeSpind(container, onFertig) {
  const code = [zufallZahl(0, 9), zufallZahl(0, 9), zufallZahl(0, 9)];
  const stand = [0, 0, 0];

  const hilf = rahmen(container, `Stell das Zahlenschloss auf ${code.join("-")}.`, `
    <div class="af-schloss">
      ${code.map((unused, i) => `
        <div class="af-rad">
          <button type="button" data-i="${i}" data-richtung="1">▲</button>
          <span class="af-radwert">0</span>
          <button type="button" data-i="${i}" data-richtung="-1">▼</button>
        </div>`).join("")}
    </div>`);
  hilf.status.textContent = "Schloss ist zu.";
  const werte = hilf.alle(".af-radwert");

  hilf.alle(".af-rad button").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i, 10);
      stand[i] = (stand[i] + parseInt(btn.dataset.richtung, 10) + 10) % 10;
      werte[i].textContent = stand[i];
      werte[i].classList.toggle("gut", stand[i] === code[i]);
      if (stand.every((wert, index) => wert === code[index])) {
        hilf.status.textContent = "Spind ist offen!";
        onFertig();
      } else {
        hilf.status.textContent = "Schloss ist zu.";
      }
    });
  });

  return () => {};
}

// --- 17. Kaffeemaschine entkalken: Schritte der Reihe nach ---
function aufgabeKaffee(container, onFertig) {
  const SCHRITTE = [
    "1. Wassertank füllen",
    "2. Entkalker zugeben",
    "3. Programm starten",
    "4. Klarspülen",
    "5. Tank trocknen"
  ];
  let index = 0;

  const hilf = rahmen(container, "Arbeite die Schritte in der richtigen Reihenfolge ab.", `<div class="af-zeilen"></div>`);
  const feld = hilf.q(".af-zeilen");
  hilf.status.textContent = "Schritt 1 …";

  mischen(SCHRITTE).forEach(text => {
    const btn = document.createElement("button");
    btn.className = "af-zeile";
    btn.type = "button";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("gut")) return;
      if (text === SCHRITTE[index]) {
        btn.classList.add("gut");
        index++;
        if (index >= SCHRITTE.length) {
          hilf.status.textContent = "Maschine ist entkalkt!";
          onFertig();
        } else {
          hilf.status.textContent = `Schritt ${index + 1} …`;
        }
      } else {
        index = 0;
        feld.querySelectorAll(".af-zeile").forEach(e => e.classList.remove("gut"));
        hilf.status.textContent = "Falsche Reihenfolge – noch mal von vorn.";
      }
    });
    feld.appendChild(btn);
  });

  return () => {};
}

// --- 18. Elfmeterpunkt ausmessen ---
function aufgabeElfmeterpunkt(container, onFertig) {
  const ZIEL = 11.0;
  const TOLERANZ = 0.1;

  const hilf = rahmen(container, "Miss den Elfmeterpunkt genau aus: 11,00 m ab Torlinie.", `
    <div class="af-massband">
      <div class="af-massband-wert">0,00 m</div>
      <input type="range" min="700" max="1500" step="5" value="700">
    </div>`);
  hilf.status.textContent = "Noch nicht auf Maß.";
  const regler = hilf.q("input[type=range]");
  const anzeige = hilf.q(".af-massband-wert");
  let fertig = false;

  regler.addEventListener("input", () => {
    const meter = parseInt(regler.value, 10) / 100;
    anzeige.textContent = meter.toFixed(2).replace(".", ",") + " m";
    const passt = Math.abs(meter - ZIEL) <= TOLERANZ + 0.001;
    anzeige.classList.toggle("gut", passt);
    if (passt && !fertig) {
      fertig = true;
      hilf.status.textContent = "Punkt sitzt!";
      onFertig();
    } else if (!passt) {
      hilf.status.textContent = meter < ZIEL ? "Noch zu kurz." : "Zu weit.";
    }
  });

  return () => {};
}

// --- 19. Vereinswappen zusammensetzen (Tauschpuzzle) ---
function aufgabeWappen(container, onFertig) {
  const TEILE = ["🛡️", "⚽", "🦅", "🏆", "🌟", "🔵"];
  let anordnung = mischen(TEILE);
  // Ein bereits gelöstes Startbild wäre ein Nullaufwand-Treffer – dann neu mischen.
  while (anordnung.every((t, i) => t === TEILE[i])) anordnung = mischen(TEILE);
  let gewaehlt = null;

  const hilf = rahmen(container, "Bring die Wappenteile in die richtige Reihenfolge – tipp zwei zum Tauschen.", `
    <div class="af-vorlage">${TEILE.map(t => `<span>${t}</span>`).join("")}</div>
    <div class="af-gitter" style="--spalten:6"></div>`);
  const feld = hilf.q(".af-gitter");
  hilf.status.textContent = "Noch nicht richtig.";

  function zeichne() {
    feld.innerHTML = "";
    anordnung.forEach((teil, i) => {
      const btn = document.createElement("button");
      btn.className = "af-kachel" + (gewaehlt === i ? " aktiv" : "") + (teil === TEILE[i] ? " gut" : "");
      btn.type = "button";
      btn.textContent = teil;
      btn.addEventListener("click", () => {
        if (gewaehlt === null) { gewaehlt = i; zeichne(); return; }
        if (gewaehlt === i) { gewaehlt = null; zeichne(); return; }
        const merk = anordnung[gewaehlt];
        anordnung[gewaehlt] = anordnung[i];
        anordnung[i] = merk;
        gewaehlt = null;
        zeichne();
        if (anordnung.every((t, index) => t === TEILE[index])) {
          hilf.status.textContent = "Wappen ist komplett!";
          onFertig();
        }
      });
      feld.appendChild(btn);
    });
  }

  zeichne();
  return () => {};
}

// --- 20. Anpfiff abwarten (Reaktion) ---
function aufgabeAnpfiff(container, onFertig) {
  let phase = "warten";
  let timer = null;
  let start = 0;

  const hilf = rahmen(container, "Warte auf den Pfiff – und dann so schnell wie möglich tippen.", `
    <button class="af-ampel" type="button">⏳<span>warten …</span></button>`);
  const ampel = hilf.q(".af-ampel");
  hilf.status.textContent = "Noch nicht tippen!";

  function starteRunde() {
    phase = "warten";
    ampel.className = "af-ampel";
    ampel.innerHTML = "⏳<span>warten …</span>";
    timer = setTimeout(() => {
      phase = "los";
      start = Date.now();
      ampel.className = "af-ampel los";
      ampel.innerHTML = "📣<span>JETZT!</span>";
    }, zufallZahl(1200, 3200));
  }

  ampel.addEventListener("click", () => {
    if (phase === "warten") {
      clearTimeout(timer);
      hilf.status.textContent = "Fehlstart! Noch mal.";
      starteRunde();
      return;
    }
    if (phase !== "los") return;
    phase = "fertig";
    hilf.status.textContent = `Reaktion: ${Date.now() - start} ms – passt!`;
    ampel.className = "af-ampel gut";
    ampel.innerHTML = "✅<span>angepfiffen</span>";
    onFertig();
  });

  starteRunde();
  return () => { clearTimeout(timer); };
}

// --- 21. Müll trennen ---
function aufgabeMuell(container, onFertig) {
  const DINGE = [
    { symbol: "📰", tonne: "papier" }, { symbol: "🧃", tonne: "plastik" },
    { symbol: "🍌", tonne: "rest" },   { symbol: "📦", tonne: "papier" },
    { symbol: "🥤", tonne: "plastik" }, { symbol: "🦴", tonne: "rest" }
  ];
  const runde = mischen(DINGE).slice(0, 4);
  let index = 0;

  const hilf = rahmen(container, "Wirf jedes Teil in die richtige Tonne.", `
    <div class="af-muellstueck"></div>
    <div class="af-tonnen">
      <button type="button" data-tonne="papier">📘<span>Papier</span></button>
      <button type="button" data-tonne="plastik">💛<span>Gelber Sack</span></button>
      <button type="button" data-tonne="rest">🗑️<span>Restmüll</span></button>
    </div>`);
  const stueck = hilf.q(".af-muellstueck");

  function zeige() {
    stueck.textContent = runde[index].symbol;
    hilf.status.textContent = `Teil ${index + 1} von ${runde.length}`;
  }

  hilf.alle(".af-tonnen button").forEach(btn => {
    btn.addEventListener("click", () => {
      if (index >= runde.length) return;
      if (btn.dataset.tonne !== runde[index].tonne) {
        hilf.status.textContent = "Falsche Tonne – noch mal schauen.";
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 400);
        return;
      }
      index++;
      if (index >= runde.length) {
        stueck.textContent = "✅";
        hilf.status.textContent = "Alles richtig getrennt!";
        onFertig();
        return;
      }
      zeige();
    });
  });

  zeige();
  return () => {};
}

// --- 22. Zählerstand ablesen und eintragen ---
function aufgabeZaehler(container, onFertig) {
  const stand = zufallZahl(10000, 99999);

  const hilf = rahmen(container, "Lies den Zählerstand ab und trag ihn ein.", `
    <div class="af-zaehlwerk">${String(stand).split("").map(z => `<span>${z}</span>`).join("")}</div>
    <div class="af-eingabefeld">–</div>
    ${ziffernblockHtml()}`);
  hilf.status.textContent = "Zählerstand eintragen.";

  verdrahteZiffernblock(hilf, ".af-eingabefeld", eingabe => {
    if (eingabe === String(stand)) {
      hilf.status.textContent = "Stand ist notiert!";
      onFertig();
    } else {
      hilf.status.textContent = "Das stimmt nicht – noch mal ablesen.";
      hilf.q(".af-eingabefeld").textContent = "–";
    }
  });

  return () => {};
}

// --- 23. Fahne hissen: Seil im Takt ziehen ---
function aufgabeFahne(container, onFertig) {
  const ZUEGE = 8;
  let gezogen = 0;
  let startY = null;

  const hilf = rahmen(container, "Zieh das Seil mit dem Finger nach unten – immer wieder.", `
    <div class="af-mast">
      <div class="af-fahne">🚩</div>
      <div class="af-seil">Seil ziehen</div>
    </div>`);
  const fahne = hilf.q(".af-fahne");
  const seil = hilf.q(".af-seil");
  hilf.status.textContent = `0 von ${ZUEGE} Zügen`;

  seil.addEventListener("pointerdown", e => {
    startY = e.clientY;
    try { seil.setPointerCapture(e.pointerId); } catch (err) { /* Testartefakt, unkritisch */ }
  });
  seil.addEventListener("pointermove", e => {
    if (startY === null) return;
    if (e.clientY - startY < 42) return;
    startY = null;
    gezogen++;
    fahne.style.bottom = Math.min(gezogen / ZUEGE, 1) * 82 + "%";
    hilf.status.textContent = `${gezogen} von ${ZUEGE} Zügen`;
    if (gezogen >= ZUEGE) {
      hilf.status.textContent = "Fahne weht!";
      onFertig();
    }
  });
  const los = () => { startY = null; };
  seil.addEventListener("pointerup", los);
  seil.addEventListener("pointercancel", los);

  return () => {};
}

// --- 24. Wäsche trennen: hell und dunkel ---
function aufgabeWaesche(container, onFertig) {
  const STUECKE = [
    { symbol: "👕", hell: true }, { symbol: "🧦", hell: false },
    { symbol: "🩳", hell: false }, { symbol: "🥼", hell: true },
    { symbol: "🧤", hell: false }, { symbol: "👔", hell: true }
  ];
  const runde = mischen(STUECKE).slice(0, 5);
  let index = 0;

  const hilf = rahmen(container, "Sortier die Wäsche in den richtigen Korb.", `
    <div class="af-muellstueck"></div>
    <div class="af-tonnen">
      <button type="button" data-hell="ja">🧺<span>Helle Wäsche</span></button>
      <button type="button" data-hell="nein">🧺<span>Dunkle Wäsche</span></button>
    </div>`);
  const stueck = hilf.q(".af-muellstueck");

  function zeige() {
    stueck.textContent = runde[index].symbol;
    hilf.status.textContent = `Teil ${index + 1} von ${runde.length}`;
  }

  hilf.alle(".af-tonnen button").forEach(btn => {
    btn.addEventListener("click", () => {
      if (index >= runde.length) return;
      if ((btn.dataset.hell === "ja") !== runde[index].hell) {
        hilf.status.textContent = "Falscher Korb – das färbt ab.";
        btn.classList.add("falsch");
        setTimeout(() => btn.classList.remove("falsch"), 400);
        return;
      }
      index++;
      if (index >= runde.length) {
        stueck.textContent = "✅";
        hilf.status.textContent = "Wäsche ist sortiert!";
        onFertig();
        return;
      }
      zeige();
    });
  });

  zeige();
  return () => {};
}

// --- 25. Inventur: Bälle zählen ---
function aufgabeInventur(container, onFertig) {
  const anzahl = zufallZahl(7, 18);
  const stoerer = zufallZahl(3, 7);
  const felder = mischen(
    Array.from({ length: anzahl }, () => "⚽").concat(Array.from({ length: stoerer }, () => zufallAus(["🏐", "🏀", "🎾"])))
  );

  const hilf = rahmen(container, "Wie viele Fußbälle liegen im Netz? Nur ⚽ zählen.", `
    <div class="af-streufeld">${felder.map(f => `<span>${f}</span>`).join("")}</div>
    <div class="af-eingabefeld">–</div>
    ${ziffernblockHtml()}`);
  hilf.status.textContent = "Anzahl eintragen.";

  verdrahteZiffernblock(hilf, ".af-eingabefeld", eingabe => {
    if (parseInt(eingabe, 10) === anzahl) {
      hilf.status.textContent = "Inventur stimmt!";
      onFertig();
    } else {
      hilf.status.textContent = "Falsch gezählt – noch mal.";
      hilf.q(".af-eingabefeld").textContent = "–";
    }
  });

  return () => {};
}

// ============================================================
// Sabotage-Reparaturen (gleiches Modul-Muster wie die Aufgaben)
// ============================================================

// Sicherungskasten: fünf Schalter hochschieben. Ein einzelner Schalter fällt nach kurzer
// Zeit wieder zurück, wenn nicht alle oben sind – dadurch muss man zügig arbeiten.
function reparaturFlutlicht(container, onFertig) {
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
      hilf.status.textContent = "Flutlicht ist wieder an!";
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

// Heizungsventil: gedrückt halten. Die Aufgabe meldet Halten/Loslassen laufend nach oben,
// weil beide Ventile GLEICHZEITIG gehalten werden müssen (die Prüfung passiert in
// game-service.js, nicht hier).
function reparaturHeizung(container, onHalten, onLoslassen) {
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
// sichtbar: Wer dabei zusieht, weiß, dass hier wirklich gearbeitet wurde — das einzige harte
// Alibi im Spiel. Nur fünf Typen tragen die Markierung, und zwar solche, deren Wirkung auch
// außerhalb des Minispiels plausibel zu sehen oder zu hören ist. Maulwürfe dürfen dieselbe
// Aufgabe spielen, lösen die Anzeige aber nicht aus (siehe erledigeAufgabe).
const AUFGABEN_TYPEN = {
  trikots:        { name: "Trikots sortieren",     start: aufgabeTrikots },
  baelle:         { name: "Bälle aufpumpen",       start: aufgabeBaelle },
  eckfahnen:      { name: "Eckfahnen stecken",     start: aufgabeEckfahnen },
  kisten:         { name: "Kisten stapeln",        start: aufgabeKisten },
  linien:         { name: "Linien nachziehen",     start: aufgabeLinien },
  schluessel:     { name: "Schlüssel finden",      start: aufgabeSchluessel },
  netz:           { name: "Tornetz flicken",       start: aufgabeNetz },
  waschgang:      { name: "Waschgang einstellen",  start: aufgabeWaschgang, sichtbar: "🫧" },
  getraenke:      { name: "Getränke einräumen",    start: aufgabeGetraenke },
  maehen:         { name: "Rasen mähen",           start: aufgabeMaehen, sichtbar: "🚜" },
  pfeife:         { name: "Trillerpfeife prüfen",  start: aufgabePfeife },
  verbandskasten: { name: "Verbandskasten füllen", start: aufgabeVerbandskasten },
  tabelle:        { name: "Tabelle sortieren",     start: aufgabeTabelle },
  stollen:        { name: "Stollen schrauben",     start: aufgabeStollen },
  kabel:          { name: "Kabel verbinden",       start: aufgabeKabel },
  spind:          { name: "Spind aufschließen",    start: aufgabeSpind },
  kaffee:         { name: "Maschine entkalken",    start: aufgabeKaffee },
  elfmeterpunkt:  { name: "Elfmeterpunkt messen",  start: aufgabeElfmeterpunkt },
  wappen:         { name: "Wappen zusammensetzen", start: aufgabeWappen },
  anpfiff:        { name: "Anpfiff abwarten",      start: aufgabeAnpfiff, sichtbar: "🔔" },
  muell:          { name: "Müll trennen",          start: aufgabeMuell, sichtbar: "♻️" },
  zaehler:        { name: "Zählerstand ablesen",   start: aufgabeZaehler },
  fahne:          { name: "Fahne hissen",          start: aufgabeFahne, sichtbar: "🚩" },
  waesche:        { name: "Wäsche sortieren",      start: aufgabeWaesche },
  inventur:       { name: "Bälle zählen",          start: aufgabeInventur }
};

const aufgabenModul = { AUFGABEN_TYPEN, reparaturFlutlicht, reparaturHeizung, mischen };

if (typeof module !== "undefined" && module.exports) module.exports = aufgabenModul;
