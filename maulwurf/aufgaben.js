// Die sechs Aufgaben-Minispiele. Reines DOM/Timer-Modul ohne Firebase-Bezug: jede Aufgabe
// bekommt einen leeren Container und eine onFertig-Funktion und gibt eine Aufräumfunktion
// zurück (Timer/Listener stoppen, falls die Aufgabe vorzeitig geschlossen wird — z.B. weil
// ein Meeting startet).
//
// Maulwürfe sehen exakt dieselben Aufgaben und können sie auch "erledigen" — nur gezählt
// wird ihr Ergebnis nicht (siehe erledigeAufgabe in game-service.js). Genau das ist der
// Bluff: wer neben einer Station steht, sieht nicht, ob dort echt gearbeitet wird.
//
// Alle Inhalte hier sind statisch (Zahlen, Emojis) — es fließen keine Spielernamen oder
// andere Fremdeingaben in die Templates, deshalb ist innerHTML hier unkritisch.

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

// --- 1. Trikots nach Rückennummer sortieren ---
function aufgabeTrikots(container, onFertig) {
  const nummern = mischen([4, 7, 9, 11, 17, 23]).slice(0, 5).sort(() => Math.random() - 0.5);
  const sortiert = nummern.slice().sort((a, b) => a - b);
  let index = 0;

  container.innerHTML = `
    <p class="af-anleitung">Häng die Trikots auf – aufsteigend nach Rückennummer.</p>
    <div class="af-trikots"></div>
    <p class="af-status" id="af-status">Als nächstes: die kleinste Nummer</p>
  `;
  const feld = container.querySelector(".af-trikots");
  const status = container.querySelector("#af-status");

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
          status.textContent = "Fertig!";
          onFertig();
        } else {
          status.textContent = `Noch ${sortiert.length - index} Trikot(s)`;
        }
      } else {
        index = 0;
        feld.querySelectorAll(".af-trikot").forEach(el => el.classList.remove("erledigt"));
        status.textContent = "Falsche Nummer – noch mal von vorn.";
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

  container.innerHTML = `
    <p class="af-anleitung">Halte gedrückt zum Pumpen und lass im grünen Bereich los.</p>
    <div class="af-manometer">
      <div class="af-zielzone" style="left:${ZIEL_MIN}%;width:${ZIEL_MAX - ZIEL_MIN}%"></div>
      <div class="af-nadel" id="af-nadel"></div>
    </div>
    <button class="btn btn-primary btn-grow af-pumpe" id="af-pumpe" type="button">Pumpen</button>
    <p class="af-status" id="af-status">Ball 1 von 3</p>
  `;
  const nadel = container.querySelector("#af-nadel");
  const status = container.querySelector("#af-status");
  const pumpe = container.querySelector("#af-pumpe");

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
        status.textContent = "Alle Bälle prall!";
        onFertig();
        return;
      }
      status.textContent = `Ball ${fertigeBaelle + 1} von 3`;
    } else {
      status.textContent = druck > ZIEL_MAX ? "Zu viel Druck – noch mal." : "Zu wenig Druck – noch mal.";
    }
    druck = 0;
    zeichne();
  }

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

  container.innerHTML = `
    <p class="af-anleitung">Merk dir die Reihenfolge und tipp sie nach.</p>
    <div class="af-ecken"></div>
    <p class="af-status" id="af-status">Aufpassen …</p>
  `;
  const feld = container.querySelector(".af-ecken");
  const status = container.querySelector("#af-status");
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
          status.textContent = "Alle Fahnen stecken!";
          onFertig();
        } else {
          status.textContent = `Noch ${folge.length - eingabeIndex}`;
        }
      } else {
        eingabeIndex = 0;
        status.textContent = "Falsch – die Folge kommt noch mal.";
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
    status.textContent = "Aufpassen …";
    folge.forEach((eckIndex, pos) => {
      timer.push(setTimeout(() => blinke(eckIndex, 400), 400 + pos * 620));
    });
    timer.push(setTimeout(() => {
      zeigtVor = false;
      status.textContent = "Jetzt du!";
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

  container.innerHTML = `
    <p class="af-anleitung">Tipp, wenn der Greifer über der Palette steht.</p>
    <div class="af-kistenbahn">
      <div class="af-kistenzone" style="left:${ZONE_MIN}%;width:${ZONE_MAX - ZONE_MIN}%"></div>
      <div class="af-greifer" id="af-greifer">🟦</div>
    </div>
    <button class="btn btn-primary btn-grow" id="af-absetzen" type="button">Absetzen</button>
    <p class="af-status" id="af-status">Kiste 1 von 3</p>
  `;
  const greifer = container.querySelector("#af-greifer");
  const status = container.querySelector("#af-status");

  const timer = setInterval(() => {
    position += richtung * tempo;
    if (position >= 100) { position = 100; richtung = -1; }
    if (position <= 0) { position = 0; richtung = 1; }
    greifer.style.left = position + "%";
  }, 16);

  container.querySelector("#af-absetzen").addEventListener("click", () => {
    if (position >= ZONE_MIN && position <= ZONE_MAX) {
      treffer++;
      if (treffer >= 3) {
        clearInterval(timer);
        status.textContent = "Alle Kisten gestapelt!";
        onFertig();
        return;
      }
      tempo += 0.5;
      status.textContent = `Kiste ${treffer + 1} von 3`;
    } else {
      status.textContent = "Daneben – Kiste zurück auf den Wagen.";
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

  container.innerHTML = `
    <p class="af-anleitung">Zieh die Linie mit dem Finger nach – ohne den Rand zu verlassen.</p>
    <div class="af-linienfeld" id="af-linienfeld">
      ${SEGMENTE.map(s => `<div class="af-segment" style="left:${s.x}%;top:${s.y}%;width:${s.w}%;height:${s.h}%"></div>`).join("")}
      <div class="af-linienstart">Start</div>
      <div class="af-linienziel">Ziel</div>
    </div>
    <p class="af-status" id="af-status">Am "Start" beginnen.</p>
  `;
  const feld = container.querySelector("#af-linienfeld");
  const status = container.querySelector("#af-status");
  let zieht = false;

  function prozentPosition(e) {
    const rect = feld.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 };
  }

  function aufDerLinie(p) {
    return SEGMENTE.some(s => p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h);
  }

  feld.addEventListener("pointerdown", e => {
    const p = prozentPosition(e);
    if (p.x <= 14 && aufDerLinie(p)) {
      zieht = true;
      feld.classList.add("aktiv");
      status.textContent = "Weiter …";
      try { feld.setPointerCapture(e.pointerId); } catch (err) { /* Testartefakt, unkritisch */ }
    }
  });

  feld.addEventListener("pointermove", e => {
    if (!zieht) return;
    const p = prozentPosition(e);
    if (!aufDerLinie(p)) {
      zieht = false;
      feld.classList.remove("aktiv");
      status.textContent = "Verrutscht – noch mal am Start beginnen.";
      return;
    }
    if (p.x >= 90) {
      zieht = false;
      feld.classList.remove("aktiv");
      status.textContent = "Linie sitzt!";
      onFertig();
    }
  });

  const abbruch = () => {
    if (!zieht) return;
    zieht = false;
    feld.classList.remove("aktiv");
    status.textContent = "Losgelassen – noch mal am Start beginnen.";
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

  container.innerHTML = `
    <p class="af-anleitung">Finde die drei Schlüsselpaare.</p>
    <div class="af-memory"></div>
    <p class="af-status" id="af-status">0 von 3 Paaren</p>
  `;
  const feld = container.querySelector(".af-memory");
  const status = container.querySelector("#af-status");

  karten.forEach(symbol => {
    const btn = document.createElement("button");
    btn.className = "af-karte";
    btn.type = "button";
    btn.dataset.symbol = symbol;
    btn.textContent = "?";
    btn.addEventListener("click", () => {
      if (blockiert || btn.classList.contains("offen") || btn.classList.contains("gefunden")) return;
      btn.classList.add("offen");
      btn.textContent = symbol;
      offen.push(btn);
      if (offen.length < 2) return;

      if (offen[0].dataset.symbol === offen[1].dataset.symbol) {
        offen.forEach(k => { k.classList.remove("offen"); k.classList.add("gefunden"); });
        offen = [];
        gefunden++;
        status.textContent = `${gefunden} von 3 Paaren`;
        if (gefunden >= 3) {
          status.textContent = "Alle Schlüssel gefunden!";
          onFertig();
        }
      } else {
        blockiert = true;
        timer.push(setTimeout(() => {
          offen.forEach(k => { k.classList.remove("offen"); k.textContent = "?"; });
          offen = [];
          blockiert = false;
        }, 750));
      }
    });
    feld.appendChild(btn);
  });

  return () => timer.forEach(t => clearTimeout(t));
}

// --- Sabotage-Reparaturen (gleiches Modul-Muster wie die Aufgaben) ---

// Sicherungskasten: fünf Schalter hochschieben. Ein einzelner Schalter fällt nach kurzer
// Zeit wieder zurück, wenn nicht alle oben sind – dadurch muss man zügig arbeiten.
function reparaturFlutlicht(container, onFertig) {
  const ANZAHL = 5;
  let oben = new Array(ANZAHL).fill(false);
  const timer = [];

  container.innerHTML = `
    <p class="af-anleitung">Alle Sicherungen hochlegen – sie fallen einzeln wieder zurück.</p>
    <div class="af-sicherungen"></div>
    <p class="af-status" id="af-status">0 von ${ANZAHL} oben</p>
  `;
  const feld = container.querySelector(".af-sicherungen");
  const status = container.querySelector("#af-status");
  const knoepfe = [];

  function aktualisiere() {
    const anzahl = oben.filter(Boolean).length;
    status.textContent = `${anzahl} von ${ANZAHL} oben`;
    if (anzahl >= ANZAHL) {
      status.textContent = "Flutlicht ist wieder an!";
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
    knoepfe.push(btn);
    feld.appendChild(btn);
  }

  return () => timer.forEach(t => clearTimeout(t));
}

// Heizungsventil: gedrückt halten. Die Aufgabe meldet Halten/Loslassen laufend nach oben,
// weil beide Ventile GLEICHZEITIG gehalten werden müssen (die Prüfung passiert in
// game-service.js, nicht hier).
function reparaturHeizung(container, onHalten, onLoslassen) {
  container.innerHTML = `
    <p class="af-anleitung">Ventil gedrückt halten – beide Ventile müssen gleichzeitig offen sein.</p>
    <button class="af-ventil" id="af-ventil" type="button">🔧<span>halten</span></button>
    <p class="af-status" id="af-status">Ventil geschlossen</p>
  `;
  const ventil = container.querySelector("#af-ventil");
  const status = container.querySelector("#af-status");
  let haelt = false;

  function starte(e) {
    e.preventDefault();
    if (haelt) return;
    haelt = true;
    ventil.classList.add("aktiv");
    status.textContent = "Ventil offen – halten!";
    onHalten();
  }
  function ende() {
    if (!haelt) return;
    haelt = false;
    ventil.classList.remove("aktiv");
    status.textContent = "Ventil geschlossen";
    onLoslassen();
  }

  ventil.addEventListener("pointerdown", starte);
  ventil.addEventListener("pointerup", ende);
  ventil.addEventListener("pointercancel", ende);
  ventil.addEventListener("pointerleave", ende);

  return () => { if (haelt) onLoslassen(); };
}

const AUFGABEN_TYPEN = {
  trikots:    { name: "Trikots sortieren",  start: aufgabeTrikots },
  baelle:     { name: "Bälle aufpumpen",    start: aufgabeBaelle },
  eckfahnen:  { name: "Eckfahnen stecken",  start: aufgabeEckfahnen },
  kisten:     { name: "Kisten stapeln",     start: aufgabeKisten },
  linien:     { name: "Linien nachziehen",  start: aufgabeLinien },
  schluessel: { name: "Schlüssel finden",   start: aufgabeSchluessel }
};

const aufgabenModul = { AUFGABEN_TYPEN, reparaturFlutlicht, reparaturHeizung, mischen };
