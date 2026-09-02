/* ============================================================================
   ui.js — Canvas-Oberfläche für „Der Maulwurf"
   ----------------------------------------------------------------------------
   Die gesamte Oberfläche wird auf EINE Zeichenfläche gemalt: Kopfzeile, Reiter,
   Menüs, Lobby, Besprechung, Aufgaben-Dialoge und das Spielfeld.
   Im Dokument steht nur noch das Canvas plus ein unsichtbares Eingabefeld.

   Arbeitsweise: unmittelbarer Modus (immediate mode). Die App beschreibt bei
   jedem Bild die komplette Oberfläche neu; ein Aufruf wie `ui.knopf(...)` malt
   den Knopf UND meldet zurück, ob er gerade gedrückt wurde. Es gibt keinen
   Baum aus Widget-Objekten, der mit dem Spielzustand synchron gehalten werden
   müsste — genau die Fehlerquelle, die in einer DOM-Oberfläche die meiste
   Arbeit macht.

   Zustand, der einen Bildwechsel überleben muss (Scroll-Stand, offene
   Auswahlliste, Tastaturfokus), liegt unter einer frei gewählten Kennung in
   `merker`. Deshalb braucht jedes Bedienelement eine solche Kennung.

   Es wird NICHT dauerhaft neu gezeichnet: `ui.anfordern()` markiert ein neues
   Bild als nötig, und die Schleife legt sich schlafen, sobald nichts mehr
   anliegt. Auf einer Busfahrt läuft das Spiel auf Akku — ein Menü, das mit
   60 Bildern je Sekunde vor sich hin rechnet, ist dort nicht vertretbar.
   Nur solange das Spielfeld läuft, fordert die Spielschleife jedes Bild an.

   Bewusst konservativ gehalten (keine optionale Verkettung, kein `??`, eigenes
   `rundesRechteck` statt `roundRect`) — in der Flotte sind alte iPhones
   unterwegs, siehe CLAUDE.md.
============================================================================ */

const ui = (function () {
  "use strict";

  /* ---------------------------------------------------------------- Farben */
  /* Die Oberfläche spielt an Bord eines Raumschiffs, und das Spielfeld war
     schon immer dunkel (#0b1220). Solange die Menüs im hellen Grau der
     Verwaltungs-Tools standen, brach der Übergang ins Spiel jedes Mal.
     Seit 2026-07-28 ist die ganze App dunkel gehalten: gedeckte Flächen,
     Leuchtfarben nur da, wo etwas bedeutet oder bedienbar ist.

     Wer hier etwas ändert, ändert das ganze Spiel. Zwei Regeln halten die
     Sache zusammen:
       · Flächen werden nach oben heller (hintergrund → karte → karteHell),
         nie durch Schatten getrennt — Schatten sind auf Dunkel unsichtbar.
       · Auf einer LEUCHTENDEN Fläche steht dunkle Schrift (aufFarbe), nie
         weiße. Weiß auf Cyan ist unlesbar. */
  const F = {
    /* Leitfarbe: das Cyan der Bordanzeigen. */
    primaer:      "#22d3ee",
    primaerDunkel: "#0e9cba",     // gedrückter Zustand
    primaerHell:  "#7ce6f8",
    erfolg:       "#34d399",
    gefahr:       "#fb7185",
    warnung:      "#fbbf24",

    /* Flächen, von unten nach oben. */
    hintergrund:  "#0d1424",      // Rumpf
    kopf:         "#111c38",      // Kopfzeile und Reiter — Chrome, kein Akzent
    karte:        "#182444",      // Karte, Dialog, Panel
    karteHell:    "#22305a",      // hervorgehobene Zeile, gedrückte Fläche
    rand:         "#33406b",
    randStark:    "#4d5f95",

    text:         "#e9edf9",
    gedaempft:    "#95a1c4",
    platzhalter:  "#6f80ad",      // zwischen Rand und gedämpft: sichtbar, aber nicht wie Inhalt
    weiss:        "#ffffff",
    aufFarbe:     "#08131f",      // Schrift auf primaer/erfolg/gefahr/warnung
    schleier:     "rgba(5, 9, 20, 0.72)"
  };

  const SCHRIFT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const RADIUS = 16;
  const RADIUS_KLEIN = 8;

  /* Kleinste Kantenlänge eines Bedienelements. Auf dem Handy mit dem Daumen
     bedient — alles darunter trifft man im fahrenden Bus nicht mehr. */
  const TIPPZIEL = 44;

  /* ------------------------------------------------------------- Grundlage */
  let leinwand = null;
  let ctx = null;
  let dpr = 1;
  let breite = 0;          // in CSS-Pixeln, nicht in Gerätepunkten
  let hoehe = 0;
  let szene = null;        // Funktion, die die Oberfläche beschreibt
  let laeuft = false;
  let bildAngefordert = false;
  /* Fortlaufende Nummer des gezeichneten Bildes. Ein Rollbereich erkennt
     daran, ob er im vorigen Bild überhaupt sichtbar war. */
  let bildNr = 0;
  let dauerlauf = false;   // true, solange das Spielfeld läuft
  let letzteZeit = 0;
  let delta = 0;

  /* MEHRERE Finger gleichzeitig. Beim Spielen liegt ein Daumen auf dem
     Steuerkreuz, während der andere einen Aktionsknopf trifft — mit nur einem
     verfolgten Zeiger wäre das Spiel auf dem Handy nicht bedienbar.
     `zeigerListe` hält jeden aktiven Finger, `losgelassene` die, die in diesem
     Bild abgehoben haben (ein Bedienelement wertet sie sofort aus).
     Ein Finger kann von einem Bedienteil BEANSPRUCHT werden (Steuerkreuz,
     Wischaufgabe); beanspruchte Finger lösen keine Knöpfe mehr aus. */
  const zeigerListe = new Map();   // id -> Finger
  let losgelassene = [];

  /* Spiegelt den zuletzt bewegten Finger — für Überfahren und Rollen, wo eine
     einzelne Position genügt. */
  const zeiger = {
    x: -9999, y: -9999,
    unten: false,
    gedrueckt: false,
    losgelassen: false,
    startX: 0, startY: 0,
    verschobenX: 0, verschobenY: 0,
    id: null,
    gezogen: false          // seit dem Aufsetzen mehr als ein paar Pixel bewegt
  };

  let radAbstand = 0;       // Mausrad seit dem letzten Bild

  const merker = new Map();       // Kennung -> beliebiger Zustand
  const eingabeZonen = [];        // Eingabefelder des letzten Bildes
  let eingabeZonenNeu = [];       // die des laufenden Bildes
  let fokusId = null;
  let proxy = null;               // das echte, unsichtbare <input>

  /* Ebenen: ein Dialog liegt über dem Bild darunter und schluckt Klicks.
     Bedienelemente nehmen einen Klick nur an, wenn sie auf der obersten Ebene
     liegen. Welche das ist, steht erst am Ende eines Bildes fest — deshalb
     entscheidet der Stand des VORIGEN Bildes. Die Ebenenstruktur ändert sich
     zwischen zwei Bildern praktisch nie, und wenn doch, ist ein Bild
     Verzögerung folgenlos. */
  let ebene = 0;
  let ebeneMax = 0;
  let ebeneMaxVorher = 0;

  /* Layout: ein Stapel aus Kästen. Der oberste bestimmt, wo das nächste
     Element landet. `reserviere()` schneidet oben eine Zeile ab. */
  const stapel = [];

  /* Bilder (Logo) werden einmal geladen und dann gezeichnet. */
  const bilder = new Map();

  /* Verzeichnis aller bedienbaren Elemente des letzten Bildes: Kennung ->
     Rechteck. Auf einer Zeichenfläche gibt es kein DOM, das ein Test abfragen
     könnte — ohne dieses Verzeichnis müsste jeder Test Pixelkoordinaten fest
     verdrahten und bräche bei jeder Layoutänderung. Kostet ein Map-Eintrag je
     Element und Bild. */
  let elemente = new Map();
  let elementeNeu = new Map();

  function merkeElement(id, r, art) {
    if (id === undefined || id === null) return;
    elementeNeu.set(String(id), { x: r.x, y: r.y, b: r.b, h: r.h, art: art, ebene: ebene });
  }

  /* ====================================================================== */
  /*  Aufbau                                                                */
  /* ====================================================================== */

  function starte(leinwandElement, proxyElement, szenenFunktion) {
    leinwand = leinwandElement;
    proxy = proxyElement;
    szene = szenenFunktion;
    ctx = leinwand.getContext("2d");

    passeGroesseAn();
    verdrahteZeiger();
    verdrahteTastatur();

    window.addEventListener("resize", () => { passeGroesseAn(); anfordern(); });
    if (window.visualViewport) {
      /* Wenn die Bildschirmtastatur aufgeht, schrumpft der sichtbare Bereich.
         Ohne das hier läge das gerade beschriebene Feld darunter. */
      window.visualViewport.addEventListener("resize", () => { passeGroesseAn(); anfordern(); });
    }
    window.addEventListener("orientationchange", () => {
      setTimeout(() => { passeGroesseAn(); anfordern(); }, 120);
    });

    laeuft = true;
    anfordern();
  }

  function passeGroesseAn() {
    if (!leinwand) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = leinwand.getBoundingClientRect();
    /* Im verborgenen Vorschaufenster meldet der Browser 0×0 (siehe CLAUDE.md).
       Dann auf die Fenstermaße ausweichen, sonst bleibt die Fläche auf dem
       300×150-Notnagel stehen und nichts ist mehr zu treffen. */
    let b = Math.round(rect.width  || window.innerWidth  || 360);
    let h = Math.round(rect.height || window.innerHeight || 640);

    /* Sicherung gegen eine Rückkopplung: Fehlt dem Canvas die CSS-Größe, dann
       bestimmt sein width-Attribut die Layoutgröße — die wir hier auslesen und
       zurückschreiben. Jedes Bild verdoppelt die Fläche, bis nichts mehr zu
       treffen ist. Das Fenster ist die harte Obergrenze; größer als der
       Bildschirm kann die Zeichenfläche nie sinnvoll sein.
       Die eigentliche Ursache gehört ins CSS (`#buehne { width/height }`),
       aber ein Layoutfehler darf die Bedienbarkeit nicht sprengen. */
    const maxB = (window.innerWidth || 360) * 1.5;
    const maxH = (window.innerHeight || 640) * 1.5;
    if (b > maxB || h > maxH) {
      b = Math.min(b, Math.round(maxB));
      h = Math.min(h, Math.round(maxH));
      if (!passeGroesseAn.gewarnt) {
        passeGroesseAn.gewarnt = true;
        console.warn("ui.js: Zeichenfläche größer als das Fenster — fehlt #buehne die CSS-Größe?");
      }
    }

    breite = b;
    hoehe = h;
    leinwand.width  = Math.round(breite * dpr);
    leinwand.height = Math.round(hoehe  * dpr);
  }

  function anfordern() {
    if (!laeuft || bildAngefordert) return;
    bildAngefordert = true;
    requestAnimationFrame(bild);
  }

  /* Solange das Spielfeld läuft, muss jedes Bild neu gezeichnet werden. */
  function setzeDauerlauf(an) {
    dauerlauf = !!an;
    if (dauerlauf) anfordern();
  }

  /* Zeichnet sofort ein Bild, ohne auf die Bildschirmschleife zu warten.
     Nötig nach einem Vollbild- oder Drehwechsel, wenn das nächste Bild sonst
     erst nach der Neuberechnung des Layouts käme — und im Test, weil ein
     verborgenes Vorschaufenster `requestAnimationFrame` überhaupt nicht
     ausführt (siehe CLAUDE.md). */
  function zeichneJetzt(vorgabeDelta) {
    /* Mit `vorgabeDelta` (in Millisekunden) lässt sich die verstrichene Zeit
       vorgeben, statt sie zu messen. Nötig für Tests zeitabhängiger Aufgaben:
       im verborgenen Vorschaufenster sind Timer um Faktor 35 gedrosselt, echtes
       Warten ist also unbrauchbar. Damit läuft ein Minispiel mit Halte- und
       Ladephasen deterministisch in einem einzigen Aufruf durch. */
    if (vorgabeDelta !== undefined && letzteZeit) bild(letzteZeit + vorgabeDelta);
    else bild(performance.now());
  }

  function bild(zeit) {
    bildAngefordert = false;
    bildNr++;
    delta = letzteZeit ? Math.min(zeit - letzteZeit, 100) : 16;
    letzteZeit = zeit;

    /* Größe kann sich ohne resize-Ereignis geändert haben (Vollbildwechsel). */
    const rect = leinwand.getBoundingClientRect();
    if (rect.width && Math.abs(rect.width - breite) > 1) passeGroesseAn();
    else if (rect.height && Math.abs(rect.height - hoehe) > 1) passeGroesseAn();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, breite, hoehe);
    ctx.textBaseline = "alphabetic";

    ebene = 0;
    ebeneMax = 0;
    stapel.length = 0;
    eingabeZonenNeu = [];
    elementeNeu = new Map();
    stapel.push({ x: 0, y: 0, b: breite, h: hoehe, cursor: 0, abstand: 0 });

    if (szene) szene();

    ebeneMaxVorher = ebeneMax;
    eingabeZonen.length = 0;
    Array.prototype.push.apply(eingabeZonen, eingabeZonenNeu);
    elemente = elementeNeu;

    /* Zeigerzustand für genau ein Bild */
    zeiger.gedrueckt = false;
    zeiger.losgelassen = false;
    zeiger.verschobenX = 0;
    zeiger.verschobenY = 0;
    losgelassene = [];
    zeigerListe.forEach(f => { f.verschobenX = 0; f.verschobenY = 0; });
    radAbstand = 0;

    if (dauerlauf) anfordern();
  }

  /* ====================================================================== */
  /*  Zeiger und Tastatur                                                   */
  /* ====================================================================== */

  function zeigerAus(e) {
    const rect = leinwand.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function verdrahteZeiger() {
    const unterstuetzt = typeof window.PointerEvent === "function";

    function idVon(e) { return e.pointerId === undefined ? 1 : e.pointerId; }

    function runter(e) {
      const p = zeigerAus(e);
      const id = idVon(e);
      zeigerListe.set(id, {
        id: id, x: p.x, y: p.y, startX: p.x, startY: p.y,
        gezogen: false, beansprucht: null, verschobenX: 0, verschobenY: 0
      });
      zeiger.x = p.x; zeiger.y = p.y;
      zeiger.startX = p.x; zeiger.startY = p.y;
      zeiger.unten = true;
      zeiger.gedrueckt = true;
      zeiger.gezogen = false;
      zeiger.id = id;

      /* Der Tastaturfokus MUSS hier fallen, unmittelbar in der Berührung.
         Ein `focus()` aus der Zeichenschleife heraus öffnet auf dem iPhone
         keine Tastatur — Safari verlangt eine echte Nutzergeste. Geprüft wird
         gegen die Felder des letzten Bildes; die stehen bereits fest. */
      pruefeEingabeFokus(p.x, p.y);
      anfordern();
    }

    function bewegt(e) {
      const p = zeigerAus(e);
      const f = zeigerListe.get(idVon(e));
      if (f) {
        f.verschobenX += p.x - f.x;
        f.verschobenY += p.y - f.y;
        f.x = p.x; f.y = p.y;
        const dx = p.x - f.startX, dy = p.y - f.startY;
        if (dx * dx + dy * dy > 100) f.gezogen = true;
      }
      /* Der Spiegel folgt nur einem unbeanspruchten Finger — sonst risse das
         Steuerkreuz jeden Rollbereich mit sich. */
      if (!f || !f.beansprucht) {
        zeiger.verschobenX += p.x - zeiger.x;
        zeiger.verschobenY += p.y - zeiger.y;
        zeiger.x = p.x; zeiger.y = p.y;
        if (f) { zeiger.startX = f.startX; zeiger.startY = f.startY; zeiger.gezogen = f.gezogen; }
      }
      anfordern();
    }

    function hoch(e) {
      const id = idVon(e);
      const p = zeigerAus(e);
      const f = zeigerListe.get(id);
      if (f) {
        f.x = p.x; f.y = p.y;
        losgelassene.push(f);
        zeigerListe.delete(id);
      }
      if (!f || !f.beansprucht) {
        zeiger.x = p.x; zeiger.y = p.y;
        zeiger.losgelassen = true;
      }
      if (zeigerListe.size === 0) zeiger.unten = false;
      anfordern();
    }

    if (unterstuetzt) {
      leinwand.addEventListener("pointerdown", runter);
      window.addEventListener("pointermove", bewegt);
      window.addEventListener("pointerup", hoch);
      window.addEventListener("pointercancel", hoch);

      /* MIT MAUS UNVERZICHTBAR: `mousedown` folgt auf `pointerdown` und setzt
         den Fokus auf das angeklickte Element. Das Canvas ist nicht
         fokussierbar, also landet der Fokus auf `body` — und nimmt ihn dem
         Tastatur-Stellvertreter wieder weg, den `runter()` gerade gesetzt hat.
         Ergebnis: Am Rechner ließ sich in kein Feld tippen, am Handy schon,
         weil es dort kein `mousedown` gibt.
         `preventDefault` unterbindet genau diese Fokusverschiebung (und
         nebenbei das Aufziehen einer Textmarkierung). Auf `click` verlässt
         sich hier nichts, der Verlust ist folgenlos.
         Nicht testbar mit synthetischen Ereignissen: die lösen kein
         Standardverhalten aus, deshalb fiel es erst am echten Gerät auf. */
      leinwand.addEventListener("mousedown", e => e.preventDefault());
    } else {
      /* Notfallweg für alte Geräte ohne Pointer-Events */
      leinwand.addEventListener("touchstart", e => { runter(e.changedTouches[0]); }, { passive: true });
      window.addEventListener("touchmove", e => { bewegt(e.changedTouches[0]); }, { passive: true });
      window.addEventListener("touchend", e => { hoch(e.changedTouches[0]); });
      leinwand.addEventListener("mousedown", runter);
      window.addEventListener("mousemove", bewegt);
      window.addEventListener("mouseup", hoch);
    }

    leinwand.addEventListener("wheel", e => {
      radAbstand += e.deltaY;
      e.preventDefault();
      anfordern();
    }, { passive: false });

    /* Auf dem Canvas soll nichts markiert oder aufgezogen werden. */
    leinwand.addEventListener("contextmenu", e => e.preventDefault());
    leinwand.style.touchAction = "none";
  }

  function pruefeEingabeFokus(x, y) {
    let getroffen = null;
    for (let i = eingabeZonen.length - 1; i >= 0; i--) {
      const z = eingabeZonen[i];
      if (z.ebene !== ebeneMaxVorher) continue;
      if (x >= z.x && x <= z.x + z.b && y >= z.y && y <= z.y + z.h) { getroffen = z; break; }
    }
    if (getroffen) {
      setzeFokus(getroffen);
    } else if (fokusId !== null) {
      fokusId = null;
      proxy.blur();
    }
  }

  function setzeFokus(zone) {
    fokusId = zone.id;
    const z = zustand(zone.id, { wert: "" });
    proxy.value = z.wert;
    proxy.maxLength = zone.maxLaenge || 200;
    proxy.setAttribute("inputmode", zone.nurZiffern ? "numeric" : "text");
    proxy.setAttribute("autocapitalize", zone.grossschreiben ? "characters" : "off");
    proxy.focus();
    /* Caret ans Ende */
    try { proxy.setSelectionRange(proxy.value.length, proxy.value.length); } catch (e) {}

    /* Zweite Sicherung gegen den Fokusklau durch `mousedown` (siehe dort).
       Sollte irgendein Browser den Fokus trotz `preventDefault` verschieben,
       holen wir ihn im nächsten Durchlauf zurück — dann ist das Standard-
       verhalten bereits gelaufen. Greift nur, wenn wirklich etwas schiefging,
       und kann nicht kreisen: `fokusId` wird ausschließlich durch einen Tipp
       daneben oder `loeseFokus()` zurückgesetzt. */
    setTimeout(function () {
      if (fokusId !== null && document.activeElement !== proxy) {
        proxy.focus();
        anfordern();
      }
    }, 0);
  }

  function verdrahteTastatur() {
    proxy.addEventListener("input", () => {
      if (fokusId === null) return;
      const z = zustand(fokusId, { wert: "" });
      z.wert = proxy.value;
      z.caret = proxy.selectionStart;
      anfordern();
    });
    proxy.addEventListener("keydown", e => {
      if (fokusId === null) return;
      if (e.key === "Enter") {
        const z = zustand(fokusId, { wert: "" });
        z.abgeschickt = true;
        anfordern();
      } else if (e.key === "Escape") {
        fokusId = null;
        proxy.blur();
        anfordern();
      }
      /* Pfeiltasten verschieben das Caret — nur neu zeichnen. */
      setTimeout(anfordern, 0);
    });
    proxy.addEventListener("blur", () => {
      fokusId = null;
      anfordern();
    });
    /* Tastendruck außerhalb eines Eingabefelds: das Spielfeld nutzt WASD. */
    window.addEventListener("keydown", e => {
      if (fokusId === null) anfordern();
    });
  }

  function zustand(id, anfangs) {
    let z = merker.get(id);
    if (!z) {
      z = {};
      for (const k in anfangs) if (Object.prototype.hasOwnProperty.call(anfangs, k)) z[k] = anfangs[k];
      merker.set(id, z);
    }
    return z;
  }

  /* ====================================================================== */
  /*  Layout                                                                */
  /* ====================================================================== */

  function oben() { return stapel[stapel.length - 1]; }

  /* Schneidet oben aus dem laufenden Kasten eine Zeile ab. */
  function reserviere(h, opt) {
    const k = oben();
    const o = opt || {};
    const randL = o.links || 0;
    const randR = o.rechts || 0;
    const r = {
      x: k.x + randL,
      y: k.y + k.cursor,
      b: k.b - randL - randR,
      h: h
    };
    k.cursor += h + (o.abstand === undefined ? k.abstand : o.abstand);
    return r;
  }

  /* Verschiebt den Schreibkopf ohne etwas zu zeichnen. */
  function luecke(h) { oben().cursor += h; }

  function beginneKasten(r, abstand) {
    stapel.push({ x: r.x, y: r.y, b: r.b, h: r.h, cursor: 0, abstand: abstand === undefined ? 10 : abstand });
    return stapel[stapel.length - 1];
  }

  function beendeKasten() {
    const k = stapel.pop();
    return k.cursor;   // verbrauchte Höhe
  }

  /* Mittiger Streifen mit Höchstbreite — entspricht `main#app { max-width }`. */
  function beginneSeite(opt) {
    const o = opt || {};
    const maxB = o.maxBreite || 520;
    const seitenrand = o.seitenrand === undefined ? 16 : o.seitenrand;
    const k = oben();
    const b = Math.min(k.b - seitenrand * 2, maxB);
    const r = { x: k.x + (k.b - b) / 2, y: k.y + k.cursor, b: b, h: k.h - k.cursor };
    return beginneKasten(r, o.abstand === undefined ? 12 : o.abstand);
  }

  function hoeheRest() {
    const k = oben();
    return k.h - k.cursor;
  }

  function verbraucht() { return oben().cursor; }

  /* ====================================================================== */
  /*  Zeichenhelfer                                                         */
  /* ====================================================================== */

  function rundesRechteck(x, y, b, h, r) {
    /* `ctx.roundRect` gibt es erst ab Safari 16 — die Flotte fährt älter. */
    const rr = Math.min(r, b / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + b - rr, y);
    ctx.arcTo(x + b, y, x + b, y + rr, rr);
    ctx.lineTo(x + b, y + h - rr);
    ctx.arcTo(x + b, y + h, x + b - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function fuelleRund(x, y, b, h, r, farbe) {
    rundesRechteck(x, y, b, h, r);
    ctx.fillStyle = farbe;
    ctx.fill();
  }

  function rahmeRund(x, y, b, h, r, farbe, staerke) {
    rundesRechteck(x, y, b, h, r);
    ctx.strokeStyle = farbe;
    ctx.lineWidth = staerke || 1;
    ctx.stroke();
  }

  /* Welche Schriftfarbe liegt auf DIESEM Grund? Nötig, weil Spielerfarben frei
     vergeben werden: auf Gelb muss die Initiale dunkel stehen, auf Dunkelblau
     hell. Fest verdrahtetes Weiß verschwindet sonst auf jeder hellen Figur.
     Gewichtet nach Wahrnehmung — Grün wirkt heller als Blau derselben Zahl. */
  function lesbarAuf(farbe) {
    const c = String(farbe || "");
    let r = 0, g = 0, b = 0;
    if (c.charAt(0) === "#") {
      const h = c.length === 4
        ? c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2) + c.charAt(3) + c.charAt(3)
        : c.slice(1, 7);
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    } else {
      const teile = c.replace(/[^0-9,.]/g, "").split(",");
      r = parseInt(teile[0], 10) || 0;
      g = parseInt(teile[1], 10) || 0;
      b = parseInt(teile[2], 10) || 0;
    }
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? F.aufFarbe : F.weiss;
  }

  function setzeSchrift(groesse, fett) {
    ctx.font = (fett ? (fett === "halb" ? "600 " : "700 ") : "") + groesse + "px " + SCHRIFT;
  }

  function textBreite(text, groesse, fett) {
    setzeSchrift(groesse, fett);
    return ctx.measureText(text).width;
  }

  /* Bricht auf die Breite um und gibt die Zeilen zurück. Bricht auch innerhalb
     überlanger Wörter, sonst schiebt ein langer Name die Karte auseinander. */
  function umbrich(text, maxB, groesse, fett) {
    setzeSchrift(groesse, fett);
    const zeilen = [];
    const absaetze = String(text).split("\n");
    absaetze.forEach(absatz => {
      const woerter = absatz.split(" ");
      let zeile = "";
      woerter.forEach(wort => {
        const versuch = zeile ? zeile + " " + wort : wort;
        if (ctx.measureText(versuch).width <= maxB) { zeile = versuch; return; }
        if (zeile) { zeilen.push(zeile); zeile = ""; }
        if (ctx.measureText(wort).width <= maxB) { zeile = wort; return; }
        /* Wort ist allein zu lang: hart trennen */
        let rest = wort;
        while (ctx.measureText(rest).width > maxB && rest.length > 1) {
          let n = 1;
          while (n < rest.length && ctx.measureText(rest.slice(0, n + 1)).width <= maxB) n++;
          zeilen.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        zeile = rest;
      });
      zeilen.push(zeile);
    });
    return zeilen;
  }

  function schreibe(text, x, y, opt) {
    const o = opt || {};
    setzeSchrift(o.groesse || 15, o.fett);
    ctx.fillStyle = o.farbe || F.text;
    ctx.textAlign = o.ausrichtung || "left";
    ctx.textBaseline = o.grundlinie || "middle";
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  /* Kürzt mit Auslassungspunkten, wenn der Platz nicht reicht. */
  function kuerze(text, maxB, groesse, fett) {
    setzeSchrift(groesse, fett);
    if (ctx.measureText(text).width <= maxB) return text;
    let t = String(text);
    while (t.length > 1 && ctx.measureText(t + "…").width > maxB) t = t.slice(0, -1);
    return t + "…";
  }

  /* Auf dunklem Grund trennt ein Schatten kaum noch — getrennt wird über die
     Flächenstufen. Er bleibt trotzdem, damit ein Dialog über der Karte
     erkennbar davor liegt; deshalb schwarz und weich statt farbig. */
  function schatten(staerke) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = staerke || 18;
    ctx.shadowOffsetY = 6;
  }
  function keinSchatten() {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  /* ====================================================================== */
  /*  Treffer                                                               */
  /* ====================================================================== */

  function inRechteck(x, y, r) {
    return x >= r.x && x <= r.x + r.b && y >= r.y && y <= r.y + r.h;
  }

  function darfKlicken() { return ebene === ebeneMaxVorher; }

  function ueber(r) { return darfKlicken() && inRechteck(zeiger.x, zeiger.y, r); }

  /* true genau in dem Bild, in dem innerhalb des Rechtecks losgelassen wurde,
     ohne dass vorher gezogen wurde (sonst löst jedes Rollen Knöpfe aus).
     Geprüft werden ALLE Finger, nicht nur der erste: sonst bliebe ein Knopf
     tot, solange ein anderer Daumen auf dem Steuerkreuz liegt. */
  function geklickt(r) {
    if (!darfKlicken()) return false;
    for (let i = 0; i < losgelassene.length; i++) {
      const f = losgelassene[i];
      if (f.beansprucht || f.gezogen) continue;
      if (inRechteck(f.x, f.y, r) && inRechteck(f.startX, f.startY, r)) return true;
    }
    return false;
  }

  function gedruecktAuf(r) {
    if (!darfKlicken()) return false;
    let treffer = false;
    zeigerListe.forEach(f => {
      if (f.beansprucht) return;
      if (inRechteck(f.startX, f.startY, r) && inRechteck(f.x, f.y, r)) treffer = true;
    });
    return treffer;
  }

  /* Sucht einen freien Finger, der innerhalb des Rechtecks aufgesetzt hat, und
     beansprucht ihn dauerhaft für `kennung`. Damit hält das Steuerkreuz seinen
     Finger fest, auch wenn er darüber hinausgezogen wird, und löst unterwegs
     keine Knöpfe aus. Gibt den Finger zurück oder null. */
  function beanspruche(r, kennung) {
    let gefunden = null;
    zeigerListe.forEach(f => {
      if (gefunden) return;
      if (f.beansprucht === kennung) { gefunden = f; return; }
      if (f.beansprucht) return;
      if (inRechteck(f.startX, f.startY, r)) { f.beansprucht = kennung; gefunden = f; }
    });
    return gefunden;
  }

  /* Wurde der für `kennung` beanspruchte Finger in diesem Bild abgehoben?
     Gibt den Finger MIT seiner Endposition zurück (sonst null). Die Position
     ist wichtig: Wer etwas irgendwohin zieht, entscheidet erst beim Loslassen,
     ob es angekommen ist — und `ui.zeiger` wird für beanspruchte Finger
     bewusst nicht mitgeführt, taugt hier also nicht. */
  function beanspruchungGeloest(kennung) {
    for (let i = 0; i < losgelassene.length; i++) {
      if (losgelassene[i].beansprucht === kennung) return losgelassene[i];
    }
    return null;
  }

  /* ====================================================================== */
  /*  Bedienelemente                                                        */
  /* ====================================================================== */

  function titel(text, opt) {
    const o = opt || {};
    const groesse = o.groesse || 24;
    const maxB = oben().b;
    const zeilen = umbrich(text, maxB, groesse, true);
    const zh = groesse * 1.25;
    const r = reserviere(zeilen.length * zh, o);
    zeilen.forEach((z, i) => {
      schreibe(z, o.zentriert ? r.x + r.b / 2 : r.x, r.y + zh * i + zh / 2, {
        groesse: groesse, fett: true, farbe: o.farbe || F.text,
        ausrichtung: o.zentriert ? "center" : "left"
      });
    });
    return r;
  }

  function absatz(text, opt) {
    const o = opt || {};
    const groesse = o.groesse || 15;
    const maxB = oben().b - (o.links || 0) - (o.rechts || 0);
    const zeilen = umbrich(text, maxB, groesse, o.fett);
    const zh = groesse * (o.zeilenhoehe || 1.45);
    const r = reserviere(zeilen.length * zh, o);
    zeilen.forEach((z, i) => {
      schreibe(z, o.zentriert ? r.x + r.b / 2 : r.x, r.y + zh * i + zh / 2, {
        groesse: groesse, fett: o.fett, farbe: o.farbe || F.gedaempft,
        ausrichtung: o.zentriert ? "center" : "left"
      });
    });
    return r;
  }

  /* Knopfarten: primaer, zweit, link, gefahr, erfolg */
  function knopf(id, text, opt) {
    const o = opt || {};
    const art = o.art || "primaer";
    const h = o.hoehe || (art === "link" ? 40 : TIPPZIEL + 6);
    const r = reserviere(h, o);
    const aus = !!o.aus;
    const aktiv = !aus && gedruecktAuf(r);
    const treffer = !aus && geklickt(r);
    merkeElement(id, r, aus ? "knopf-aus" : "knopf");

    if (art === "link") {
      schreibe(text, r.x + r.b / 2, r.y + h / 2, {
        groesse: o.groesse || 15, fett: "halb",
        farbe: aus ? F.randStark : (aktiv ? F.primaerDunkel : F.primaer),
        ausrichtung: "center"
      });
    } else {
      /* Leuchtende Fläche trägt dunkle Schrift — weiß auf Cyan liest sich nicht. */
      let fuell = F.primaer, schrift = F.aufFarbe, rand = null;
      if (art === "zweit")  { fuell = "transparent"; schrift = F.primaer; rand = F.primaer; }
      if (art === "gefahr") { fuell = F.gefahr; schrift = F.aufFarbe; }
      if (art === "erfolg") { fuell = F.erfolg; schrift = F.aufFarbe; }
      if (aus) { fuell = art === "zweit" ? "transparent" : F.karteHell; schrift = F.gedaempft; rand = art === "zweit" ? F.rand : null; }
      else if (aktiv) { fuell = art === "zweit" ? F.karteHell : (art === "primaer" ? F.primaerDunkel : fuell); }

      fuelleRund(r.x, r.y, r.b, r.h, o.radius === undefined ? RADIUS_KLEIN + 4 : o.radius, fuell);
      if (rand) rahmeRund(r.x, r.y, r.b, r.h, o.radius === undefined ? RADIUS_KLEIN + 4 : o.radius, rand, 1.5);
      const beschriftung = kuerze(text, r.b - 24, o.groesse || 16, "halb");
      schreibe(beschriftung, r.x + r.b / 2, r.y + h / 2, {
        groesse: o.groesse || 16, fett: "halb", farbe: schrift, ausrichtung: "center"
      });
    }
    return treffer;
  }

  /* Runder Knopf für die Aktionsleiste des Spielfelds. */
  function rundKnopf(id, zeichen, x, y, radius, opt) {
    const o = opt || {};
    const r = { x: x - radius, y: y - radius, b: radius * 2, h: radius * 2 };
    const aus = !!o.aus;
    const aktiv = !aus && gedruecktAuf(r);
    const treffer = !aus && geklickt(r);
    merkeElement(id, r, aus ? "rundknopf-aus" : "rundknopf");

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    /* Ausgeschaltet heißt „hier ist nichts zu holen", nicht „hier ist nichts".
       Der Knopf bleibt sichtbar: auf dem sehr dunklen Spielfeld verschwindet er
       sonst ganz, und man sucht ihn, statt ihn zu ignorieren. */
    ctx.fillStyle = aus ? "rgba(54,68,108,0.62)"
                  : (o.farbe || (aktiv ? F.primaerDunkel : F.primaer));
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = aus ? "rgba(149,161,196,0.42)" : "rgba(255,255,255,0.55)";
    ctx.stroke();

    /* Ein eingefärbter Knopf (o.farbe) leuchtet ebenfalls — auch dort dunkle
       Schrift, sonst verschwindet das Zeichen auf Gelb oder Grün. */
    schreibe(zeichen, x, y + 1, {
      groesse: o.groesse || radius, ausrichtung: "center",
      farbe: aus ? "rgba(180,192,222,0.62)" : F.aufFarbe
    });
    if (o.hinweis) {
      schreibe(o.hinweis, x, y + radius + 12, { groesse: 11, fett: "halb", ausrichtung: "center", farbe: F.weiss });
    }
    return treffer;
  }

  /* Karte — der Rahmen der meisten Abschnitte, eine Stufe heller als der Grund.
     Der Grund muss VOR dem Inhalt gemalt werden, seine Höhe steht aber erst
     danach fest. Auflösung: gemalt wird mit der Höhe des vorigen Bildes, und
     weicht die gemessene ab, wird sofort ein weiteres Bild angefordert.
     Nur beim allerersten Erscheinen fehlt der Grund für ein Bild (~16 ms).
     Über `destination-over` ginge es NICHT: das malt ausschließlich in noch
     durchsichtige Flächen, und der Seitenhintergrund liegt bereits darunter —
     die Karte bliebe unsichtbar. */
  function beginneKarte(id, opt) {
    const o = opt || {};
    const k = oben();
    const z = zustand("karte:" + id, { hoehe: 0, gemessen: false });
    const polster = o.polster === undefined ? 16 : o.polster;
    const radius = o.radius === undefined ? RADIUS : o.radius;
    const r = { x: k.x + (o.links || 0), y: k.y + k.cursor, b: k.b - (o.links || 0) - (o.rechts || 0), h: z.hoehe };

    if (z.gemessen && z.hoehe > 0) {
      if (o.schatten !== false) schatten(14);
      fuelleRund(r.x, r.y, r.b, z.hoehe, radius, o.farbe || F.karte);
      keinSchatten();
      if (o.rand) rahmeRund(r.x, r.y, r.b, z.hoehe, radius, o.rand, 1.5);
    }

    beginneKasten({ x: r.x + polster, y: r.y + polster, b: r.b - polster * 2, h: k.h - k.cursor - polster * 2 },
                  o.abstand === undefined ? 10 : o.abstand);
    return { r: r, polster: polster, z: z, o: o };
  }

  function beendeKarte(griff) {
    const innen = beendeKasten();
    const h = innen + griff.polster * 2;
    if (!griff.z.gemessen || Math.abs(h - griff.z.hoehe) > 0.5) {
      griff.z.hoehe = h;
      griff.z.gemessen = true;
      anfordern();
    }
    oben().cursor += h + oben().abstand;
    return h;
  }

  /* Eingabefeld. Gibt den aktuellen Text zurück. */
  function eingabe(id, opt) {
    const o = opt || {};
    const z = zustand(id, { wert: o.anfangswert || "", caret: 0, abgeschickt: false });
    if (o.setze !== undefined && o.setze !== null && z.wert !== o.setze && fokusId !== id) z.wert = o.setze;

    const h = o.hoehe || TIPPZIEL + 6;
    const r = reserviere(h, o);
    const hatFokus = fokusId === id;
    merkeElement(id, r, "eingabe");

    /* Eingabefelder liegen VERTIEFT: dunkler als die Karte, auf der sie stehen.
       Gleicher Ton wie die Karte wäre auf dunklem Grund nicht zu erkennen. */
    fuelleRund(r.x, r.y, r.b, r.h, RADIUS_KLEIN + 2, F.hintergrund);
    rahmeRund(r.x, r.y, r.b, r.h, RADIUS_KLEIN + 2, hatFokus ? F.primaer : F.rand, hatFokus ? 2 : 1.5);

    const polster = 14;
    const groesse = o.groesse || 16;
    const leer = !z.wert;
    const anzeige = leer ? (o.platzhalter || "") : z.wert;
    const mitte = r.y + r.h / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + polster - 2, r.y, r.b - polster * 2 + 4, r.h);
    ctx.clip();

    if (o.zentriert) {
      schreibe(anzeige, r.x + r.b / 2, mitte, {
        groesse: groesse, farbe: leer ? F.platzhalter : F.text, ausrichtung: "center",
        fett: o.fett
      });
    } else {
      schreibe(anzeige, r.x + polster, mitte, {
        groesse: groesse, farbe: leer ? F.platzhalter : F.text, fett: o.fett
      });
    }

    /* Schreibmarke: blinkt im Sekundentakt und sitzt an der echten Caret-
       Position des unsichtbaren Feldes. */
    if (hatFokus) {
      const caret = Math.max(0, Math.min(proxy.selectionStart === null ? z.wert.length : proxy.selectionStart, z.wert.length));
      const vorher = z.wert.slice(0, caret);
      const bVor = textBreite(vorher, groesse, o.fett);
      const bGes = textBreite(z.wert, groesse, o.fett);
      const startX = o.zentriert ? r.x + r.b / 2 - bGes / 2 : r.x + polster;
      if (Math.floor(Date.now() / 530) % 2 === 0) {
        ctx.fillStyle = F.primaer;
        ctx.fillRect(startX + bVor, mitte - groesse * 0.6, 2, groesse * 1.2);
      }
      anfordern();   // damit die Marke weiterblinkt
    }
    ctx.restore();

    eingabeZonenNeu.push({
      id: id, x: r.x, y: r.y, b: r.b, h: r.h, ebene: ebene,
      maxLaenge: o.maxLaenge || 60,
      nurZiffern: !!o.nurZiffern,
      grossschreiben: !!o.grossschreiben
    });

    return z.wert;
  }

  /* Wurde in diesem Feld Enter gedrückt? Setzt die Meldung zurück. */
  function eingabeAbgeschickt(id) {
    const z = merker.get(id);
    if (z && z.abgeschickt) { z.abgeschickt = false; return true; }
    return false;
  }

  function setzeEingabe(id, wert) {
    const z = zustand(id, { wert: "" });
    z.wert = wert;
    if (fokusId === id) proxy.value = wert;
  }

  function leseEingabe(id) {
    const z = merker.get(id);
    return z ? z.wert : "";
  }

  /* Auswahlfeld. `optionen` = [{wert, text}], gibt den gewählten Wert zurück.
     Die aufgeklappte Liste wird nicht hier gezeichnet, sondern gesammelt und
     ganz am Ende des Bildes über allem anderen (`zeichneOffeneListen`). Sonst
     verschwände sie hinter später gezeichneten Elementen. */
  const offeneListen = [];

  function auswahl(id, optionen, wert, opt) {
    const o = opt || {};
    const z = zustand(id, { offen: false });
    const h = o.hoehe || TIPPZIEL;
    const r = reserviere(h, o);
    merkeElement(id, r, "auswahl");
    let neuerWert = wert;

    let gewaehlt = null;
    for (let i = 0; i < optionen.length; i++) {
      if (String(optionen[i].wert) === String(wert)) { gewaehlt = optionen[i]; break; }
    }
    const beschriftung = gewaehlt ? gewaehlt.text : (o.leerText || "—");
    const aus = !!o.aus;

    fuelleRund(r.x, r.y, r.b, r.h, RADIUS_KLEIN, F.hintergrund);
    rahmeRund(r.x, r.y, r.b, r.h, RADIUS_KLEIN, z.offen ? F.primaer : F.rand, z.offen ? 2 : 1.5);
    schreibe(kuerze(beschriftung, r.b - 40, 15), r.x + 12, r.y + r.h / 2, {
      groesse: 15, farbe: aus ? F.randStark : F.text
    });
    /* Pfeil */
    ctx.beginPath();
    const px = r.x + r.b - 18, py = r.y + r.h / 2 + (z.offen ? 2 : -1);
    ctx.moveTo(px - 5, py - (z.offen ? 0 : 2));
    ctx.lineTo(px + 5, py - (z.offen ? 0 : 2));
    ctx.lineTo(px, py + (z.offen ? -6 : 5));
    ctx.closePath();
    ctx.fillStyle = aus ? F.randStark : F.gedaempft;
    ctx.fill();

    if (!aus && geklickt(r)) {
      z.offen = !z.offen;
      /* Nur eine Liste gleichzeitig offen halten. */
      if (z.offen) merker.forEach((andere, schluessel) => {
        if (schluessel !== id && andere && andere.offen) andere.offen = false;
      });
    }

    /* Die Auswahl fällt in `zeichneOffeneListen`, also NACH diesem Aufruf, und
       schließt die Liste zugleich. Der Wert muss deshalb im nächsten Bild
       abgeholt werden — und zwar unabhängig davon, ob die Liste noch offen
       ist. Stünde diese Prüfung innerhalb von `if (z.offen)`, käme sie nie
       zum Zug und die Auswahl bliebe wirkungslos. */
    if (z.frischGewaehlt !== undefined && z.frischGewaehlt !== null) {
      neuerWert = z.frischGewaehlt;
      z.frischGewaehlt = null;
    }
    if (z.offen) {
      offeneListen.push({ id: id, anker: r, optionen: optionen, wert: wert, ebene: ebene });
    }
    return neuerWert;
  }

  function zeichneOffeneListen() {
    if (!offeneListen.length) return;
    const ebeneVorher = ebene;
    ebene = ebeneMaxVorher;   // aufgeklappte Listen liegen immer obenauf
    offeneListen.forEach(l => {
      const zeilenH = TIPPZIEL - 4;
      const maxSicht = Math.min(l.optionen.length, 7);
      const listeH = maxSicht * zeilenH + 8;
      let ly = l.anker.y + l.anker.h + 4;
      if (ly + listeH > hoehe - 8) ly = Math.max(8, l.anker.y - listeH - 4);
      const lr = { x: l.anker.x, y: ly, b: l.anker.b, h: listeH };

      schatten(20);
      /* Die aufgeklappte Liste schwebt über allem — eine Stufe heller als die
         Karte darunter, sonst verschwimmt sie damit. */
      fuelleRund(lr.x, lr.y, lr.b, lr.h, RADIUS_KLEIN, F.karteHell);
      keinSchatten();
      rahmeRund(lr.x, lr.y, lr.b, lr.h, RADIUS_KLEIN, F.randStark, 1);

      const z = zustand(l.id, { offen: true, rollen: 0 });
      const gesamtH = l.optionen.length * zeilenH;
      if (gesamtH > listeH - 8 && inRechteck(zeiger.x, zeiger.y, lr)) {
        z.rollen = Math.max(0, Math.min((z.rollen || 0) + radAbstand + (zeiger.unten && zeiger.gezogen ? -zeiger.verschobenY : 0), gesamtH - listeH + 8));
      }
      const versatz = z.rollen || 0;

      ctx.save();
      ctx.beginPath();
      ctx.rect(lr.x, lr.y + 4, lr.b, lr.h - 8);
      ctx.clip();
      l.optionen.forEach((op, i) => {
        const zr = { x: lr.x, y: lr.y + 4 + i * zeilenH - versatz, b: lr.b, h: zeilenH };
        if (zr.y + zr.h < lr.y || zr.y > lr.y + lr.h) return;
        const istGewaehlt = String(op.wert) === String(l.wert);
        if (istGewaehlt) {
          fuelleRund(zr.x + 4, zr.y + 2, zr.b - 8, zr.h - 4, 6, "rgba(34,211,238,0.18)");
        } else if (inRechteck(zeiger.x, zeiger.y, zr) && zeiger.unten) {
          fuelleRund(zr.x + 4, zr.y + 2, zr.b - 8, zr.h - 4, 6, "rgba(255,255,255,0.07)");
        }
        schreibe(kuerze(op.text, zr.b - 28, 15), zr.x + 12, zr.y + zr.h / 2, {
          groesse: 15, farbe: istGewaehlt ? F.primaerHell : F.text, fett: istGewaehlt ? "halb" : null
        });
        merkeElement(l.id + ":" + op.wert, zr, "auswahl-eintrag");
        if (geklickt(zr)) {
          zustand(l.id, {}).frischGewaehlt = op.wert;
          zustand(l.id, {}).offen = false;
          anfordern();
        }
      });
      ctx.restore();

      /* Klick daneben schließt */
      if (zeiger.losgelassen && !zeiger.gezogen &&
          !inRechteck(zeiger.x, zeiger.y, lr) && !inRechteck(zeiger.x, zeiger.y, l.anker)) {
        zustand(l.id, {}).offen = false;
      }
    });
    ebene = ebeneVorher;
    offeneListen.length = 0;
  }

  /* Beschriftetes Auswahlfeld, wie die `<label>`-Blöcke der Lobby. */
  function feld(beschriftung, id, optionen, wert, opt) {
    const o = opt || {};
    absatz(beschriftung, { groesse: 13, fett: "halb", farbe: F.gedaempft, abstand: 4 });
    return auswahl(id, optionen, wert, o);
  }

  /* Fortschrittsbalken */
  function balken(anteil, opt) {
    const o = opt || {};
    const h = o.hoehe || 10;
    const r = reserviere(h, o);
    fuelleRund(r.x, r.y, r.b, r.h, r.h / 2, o.grund || "rgba(0,0,0,0.32)");
    const a = Math.max(0, Math.min(1, anteil));
    if (a > 0) fuelleRund(r.x, r.y, Math.max(r.h, r.b * a), r.h, r.h / 2, o.farbe || F.erfolg);
    return r;
  }

  /* Waagerechter Trenner mit Wort in der Mitte („oder") */
  function trenner(text, opt) {
    const o = opt || {};
    const r = reserviere(o.hoehe || 26, o);
    const mitte = r.y + r.h / 2;
    ctx.strokeStyle = F.rand;
    ctx.lineWidth = 1;
    if (text) {
      const tb = textBreite(text, 13) + 20;
      ctx.beginPath();
      ctx.moveTo(r.x, mitte); ctx.lineTo(r.x + (r.b - tb) / 2, mitte);
      ctx.moveTo(r.x + (r.b + tb) / 2, mitte); ctx.lineTo(r.x + r.b, mitte);
      ctx.stroke();
      schreibe(text, r.x + r.b / 2, mitte, { groesse: 13, farbe: F.gedaempft, ausrichtung: "center" });
    } else {
      ctx.beginPath();
      ctx.moveTo(r.x, mitte); ctx.lineTo(r.x + r.b, mitte);
      ctx.stroke();
    }
    return r;
  }

  /* Rollbarer Bereich fester Höhe. `inhalt` beschreibt den Inhalt; die
     tatsächliche Höhe wird dabei gemessen und begrenzt im nächsten Bild. */
  function scroll(id, h, inhalt, opt) {
    const o = opt || {};
    const z = zustand(id, { versatz: 0, inhaltH: 0, schwung: 0, bild: 0 });
    const r = reserviere(h, o);
    merkeElement(id, r, "rollbereich");

    /* War dieser Bereich im vorigen Bild gar nicht zu sehen (Ansichtswechsel,
       Dialog davor), dann liegt hier noch der eingefrorene Schwung von damals.
       Er liefe beim Wiedereintritt weiter, die Liste rutschte unter dem Finger
       weg, und der nächste Tipper träfe eine andere Zeile als die, auf die er
       gezielt hat. */
    if (z.bild !== bildNr - 1) z.schwung = 0;
    z.bild = bildNr;

    const maxVersatz = Math.max(0, z.inhaltH - h);
    const drin = inRechteck(zeiger.x, zeiger.y, r);

    /* Ein Finger, der hier aufsetzt, stoppt die Trägheit sofort — so wie jede
       Liste des Betriebssystems. Ohne das läuft der Inhalt unter dem
       aufliegenden Finger weiter (ein Tipper zieht ja nicht, der Zweig unten
       greift also nicht), und beim Loslassen liegt an derselben Bildschirm-
       stelle ein anderes Element als beim Aufsetzen: man drückt "Zurück" und
       öffnet einen Wert. `geklickt()` merkt davon nichts, weil es Start- und
       Endpunkt gegen dasselbe, inzwischen verschobene Rechteck prüft. */
    if (drin && zeiger.gedrueckt) z.schwung = 0;

    if (drin && radAbstand) z.versatz += radAbstand;
    if (drin && zeiger.unten && zeiger.gezogen) {
      z.versatz -= zeiger.verschobenY;
      z.schwung = -zeiger.verschobenY;
    } else if (Math.abs(z.schwung) > 0.2) {
      z.versatz += z.schwung;
      z.schwung *= 0.92;
      anfordern();
    } else {
      z.schwung = 0;
    }
    z.versatz = Math.max(0, Math.min(z.versatz, maxVersatz));

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.b, r.h);
    ctx.clip();

    beginneKasten({ x: r.x, y: r.y - z.versatz, b: r.b, h: 100000 }, o.abstand === undefined ? 8 : o.abstand);
    inhalt(r.b);
    z.inhaltH = beendeKasten();
    ctx.restore();

    /* Rollbalken nur andeuten, wenn es etwas zu rollen gibt. */
    if (maxVersatz > 2) {
      const bh = Math.max(30, h * (h / z.inhaltH));
      const by = r.y + (h - bh) * (z.versatz / maxVersatz);
      fuelleRund(r.x + r.b - 5, by, 4, bh, 2, "rgba(233,237,249,0.28)");
    }
    return r;
  }

  /* Eine ganze Seite: mittige Spalte mit Höchstbreite, die rollt sobald der
     Inhalt höher wird als der Platz. Passt der Inhalt, steht er wahlweise
     mittig — das entspricht `.screen-inhalt.zentriert` der alten Oberfläche.
     Ohne diesen Helfer müsste jeder der neun Bildschirme sein eigenes Rollen
     bauen, und die Lobby mit fünfzehn Einstellungen passt auf kein Handy. */
  function seite(id, inhalt, opt) {
    const o = opt || {};
    const k = oben();
    const verfuegbar = k.h - k.cursor;
    /* Eigene Kennung, NICHT die des Rollbereichs: der misst die Höhe
       einschließlich des Ausgleichs, den wir zum Zentrieren selbst einfügen.
       Läge beides unter derselben Kennung, machte der Ausgleich den Inhalt
       jedes Mal zu hoch, das Zentrieren fiele weg, der Inhalt schrumpfte
       wieder — die Seite flackerte zwischen zwei Zuständen. */
    const z = zustand("seite:" + id, { rohH: 0 });
    const randOben = o.randOben === undefined ? 16 : o.randOben;
    const randUnten = o.randUnten === undefined ? 24 : o.randUnten;
    const passt = z.rohH > 0 && z.rohH + randOben + randUnten <= verfuegbar;
    let gemessen = 0;

    scroll("seiteRoll:" + id, verfuegbar, function () {
      luecke(passt && o.zentriert
        ? Math.max(randOben, (verfuegbar - z.rohH) / 2)
        : randOben);
      const vorher = oben().cursor;
      beginneSeite({ maxBreite: o.maxBreite, seitenrand: o.seitenrand, abstand: o.abstand });
      inhalt();
      const innen = beendeKasten();
      gemessen = innen;
      oben().cursor = vorher + innen;
      luecke(randUnten);
    }, { abstand: 0 });

    if (Math.abs(gemessen - z.rohH) > 0.5) { z.rohH = gemessen; anfordern(); }
  }

  /* Abdunkeln und eine Ebene höher gehen — alles danach liegt über dem Rest
     und nimmt die Klicks entgegen. */
  function abdunkeln(deckkraft) {
    ctx.fillStyle = "rgba(5, 9, 20, " + (deckkraft === undefined ? 0.72 : deckkraft) + ")";
    ctx.fillRect(0, 0, breite, hoehe);
    ebene++;
    if (ebene > ebeneMax) ebeneMax = ebene;
  }

  /* Dialogkarte in der Bildmitte. Gleiches Verfahren wie bei der Karte: die
     Höhe des vorigen Bildes bestimmt, wo der Dialog sitzt und wie hoch sein
     Grund gemalt wird. Läuft der Inhalt über den Bildschirm hinaus, wird der
     Dialog oben angeheftet — dann gehört ein `scroll()` hinein. */
  function beginneDialog(id, opt) {
    const o = opt || {};
    abdunkeln(o.deckkraft);
    const z = zustand("dialog:" + id, { hoehe: 0, gemessen: false });
    const maxB = Math.min(breite - 32, o.breite || 460);
    const x = (breite - maxB) / 2;
    const polster = o.polster === undefined ? 18 : o.polster;
    const randOben = 16;

    let y;
    if (o.oben !== undefined) y = o.oben;
    else if (!z.gemessen) y = randOben;
    else y = Math.max(randOben, Math.min((hoehe - z.hoehe) / 2, hoehe - z.hoehe - randOben));

    if (z.gemessen && z.hoehe > 0) {
      schatten(28);
      fuelleRund(x, y, maxB, z.hoehe, RADIUS, o.farbe || F.karte);
      keinSchatten();
    }

    beginneKasten({ x: x + polster, y: y + polster, b: maxB - polster * 2, h: hoehe },
                  o.abstand === undefined ? 12 : o.abstand);
    return { x: x, y: y, maxB: maxB, polster: polster, z: z, o: o };
  }

  function beendeDialog(griff) {
    const innen = beendeKasten();
    const h = innen + griff.polster * 2;
    if (!griff.z.gemessen || Math.abs(h - griff.z.hoehe) > 0.5) {
      griff.z.hoehe = h;
      griff.z.gemessen = true;
      anfordern();
    }
    ebene--;
    return { x: griff.x, y: griff.y, b: griff.maxB, h: h };
  }

  /* Höhe, die ein Dialog beim letzten Bild hatte — damit die App entscheiden
     kann, ob ihr Inhalt in einen Rollbereich gehört. 0 heißt „noch unbekannt". */
  function dialogHoehe(id) {
    const z = merker.get("dialog:" + id);
    return z && z.gemessen ? z.hoehe : 0;
  }

  /* Bild laden und zeichnen (Vereinslogo). Solange es lädt, passiert nichts. */
  function zeichneBild(pfad, x, y, b, h) {
    let eintrag = bilder.get(pfad);
    if (!eintrag) {
      eintrag = { bild: new Image(), fertig: false };
      eintrag.bild.onload = () => { eintrag.fertig = true; anfordern(); };
      /* Absolute URL (Vereinswappen vom Wurzelverzeichnis): live derselbe
         Ursprung, in der lokalen Vorschau ein fremder. Ohne diese Zeile wäre
         die Zeichenfläche dort „vergiftet" und `getImageData()` würde werfen —
         genau der Weg, über den die Prüfungen dieses Spiels laufen. */
      if (/^https?:/.test(pfad)) eintrag.bild.crossOrigin = "anonymous";
      eintrag.bild.src = pfad;
      bilder.set(pfad, eintrag);
    }
    if (!eintrag.fertig) return false;
    const nb = eintrag.bild.naturalWidth, nh = eintrag.bild.naturalHeight;
    if (!nb || !nh) return false;
    /* Seitenverhältnis wahren, in den Rahmen einpassen */
    const f = Math.min(b / nb, h / nh);
    ctx.drawImage(eintrag.bild, x + (b - nb * f) / 2, y + (h - nh * f) / 2, nb * f, nh * f);
    return true;
  }

  /* ====================================================================== */
  /*  Nach außen                                                            */
  /* ====================================================================== */

  return {
    /* Aufbau */
    starte: starte,
    anfordern: anfordern,
    zeichneJetzt: zeichneJetzt,
    setzeDauerlauf: setzeDauerlauf,
    passeGroesseAn: passeGroesseAn,

    /* Maße und Werkzeug */
    get breite() { return breite; },
    get hoehe() { return hoehe; },
    get ctx() { return ctx; },
    get delta() { return delta; },
    get dpr() { return dpr; },
    get zeiger() { return zeiger; },
    F: F,
    SCHRIFT: SCHRIFT,
    RADIUS: RADIUS,
    RADIUS_KLEIN: RADIUS_KLEIN,
    TIPPZIEL: TIPPZIEL,

    /* Layout */
    reserviere: reserviere,
    luecke: luecke,
    beginneKasten: beginneKasten,
    beendeKasten: beendeKasten,
    beginneSeite: beginneSeite,
    hoeheRest: hoeheRest,
    verbraucht: verbraucht,
    oben: oben,

    /* Zeichnen */
    rundesRechteck: rundesRechteck,
    fuelleRund: fuelleRund,
    rahmeRund: rahmeRund,
    lesbarAuf: lesbarAuf,
    schreibe: schreibe,
    umbrich: umbrich,
    kuerze: kuerze,
    textBreite: textBreite,
    setzeSchrift: setzeSchrift,
    schatten: schatten,
    keinSchatten: keinSchatten,
    zeichneBild: zeichneBild,

    /* Treffer */
    inRechteck: inRechteck,
    ueber: ueber,
    geklickt: geklickt,
    gedruecktAuf: gedruecktAuf,
    darfKlicken: darfKlicken,
    beanspruche: beanspruche,
    beanspruchungGeloest: beanspruchungGeloest,
    zeigerAnzahl: function () { return zeigerListe.size; },

    /* Bedienelemente */
    titel: titel,
    absatz: absatz,
    knopf: knopf,
    rundKnopf: rundKnopf,
    beginneKarte: beginneKarte,
    beendeKarte: beendeKarte,
    eingabe: eingabe,
    eingabeAbgeschickt: eingabeAbgeschickt,
    setzeEingabe: setzeEingabe,
    leseEingabe: leseEingabe,
    auswahl: auswahl,
    feld: feld,
    balken: balken,
    trenner: trenner,
    scroll: scroll,
    seite: seite,
    abdunkeln: abdunkeln,
    beginneDialog: beginneDialog,
    beendeDialog: beendeDialog,
    dialogHoehe: dialogHoehe,
    zeichneOffeneListen: zeichneOffeneListen,

    /* Verzeichnis der bedienbaren Elemente (Kennung -> Rechteck).
       `merke` ist für von Hand gezeichnete Klickflächen (Reiter, Plaketten,
       Raster) — ohne Eintrag sind sie für einen Test unauffindbar und müssten
       über feste Pixelkoordinaten angesteuert werden. */
    merke: merkeElement,
    finde: function (id) { return elemente.get(String(id)) || null; },
    elemente: function () {
      const liste = [];
      elemente.forEach((r, id) => liste.push({
        id: id, art: r.art, ebene: r.ebene,
        x: Math.round(r.x), y: Math.round(r.y), b: Math.round(r.b), h: Math.round(r.h)
      }));
      return liste;
    },
    get obersteEbene() { return ebeneMaxVorher; },

    /* Zustand */
    zustand: zustand,
    merker: merker,
    get fokus() { return fokusId; },
    loeseFokus: function () { if (fokusId !== null) { fokusId = null; proxy.blur(); anfordern(); } }
  };
})();
