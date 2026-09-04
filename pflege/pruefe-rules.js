// Wertet die Firebase-Regeln der drei Quartette gegen die ECHTEN Zugriffe aus,
// die game-service.js macht — und gegen die Angriffe, die sie verhindern sollen.
//
// Firebase-Ausdruecke sind JS-nah: auth, root.child(x).val(), $-Variablen.
// Nachgebaut wird genau so viel, wie diese Regeln benutzen.
const fs = require("fs");

const REGELN = JSON.parse(fs.readFileSync(__dirname + "/../database.rules.json", "utf8")).rules;

// Der Weltzustand, gegen den geprueft wird: ein laufender Raum mit Host + zwei Gaesten.
const WELT = {
  autoQuartett: { raeume: { ABCD: { hostId: "host-uid" } } },
  fussballQuartett: { raeume: { WXYZ: { hostId: "host-uid" } } },
  fussballVereineQuartett: { raeume: { QRST: { hostId: "host-uid" } } }
};

function wert(pfad) {
  return pfad.split("/").reduce((o, t) => (o == null ? null : o[t]), WELT) ?? null;
}

// Sucht die tiefste Regel des gegebenen Typs entlang des Pfades und sammelt dabei
// die $-Variablen ein. Firebase kaskadiert: eine Erlaubnis weiter oben genuegt.
function findeRegeln(pfadTeile, typ) {
  const treffer = [];
  let knoten = REGELN;
  const vars = {};
  for (let i = 0; i <= pfadTeile.length; i++) {
    if (knoten && knoten[typ] !== undefined) treffer.push({ ausdruck: knoten[typ], vars: { ...vars } });
    if (i === pfadTeile.length) break;
    const teil = pfadTeile[i];
    if (knoten && knoten[teil] !== undefined) { knoten = knoten[teil]; continue; }
    const platzhalter = knoten ? Object.keys(knoten).find((k) => k.startsWith("$")) : null;
    if (!platzhalter) { knoten = null; break; }
    vars[platzhalter] = teil;
    knoten = knoten[platzhalter];
  }
  return treffer;
}

function darf(pfad, typ, uid) {
  const teile = pfad.split("/");
  // ⚠️ Die Schluessel heissen ".read"/".write", nicht "read"/"write". Ohne den
  // Punkt findet die Suche NIE eine Regel und meldet alles als verboten — das
  // sieht wie ein sicherer Zustand aus und ist nur ein toter Test.
  const regeln = findeRegeln(teile, "." + typ);
  for (const { ausdruck, vars } of regeln) {
    if (ausdruck === true) return true;
    if (ausdruck === false) continue;
    const auth = uid ? { uid } : null;
    const root = { child: (p) => ({ val: () => wert(p) }) };
    let code = String(ausdruck);
    for (const [name, w] of Object.entries(vars)) {
      code = code.split(name).join(JSON.stringify(w));
    }
    let ok = false;
    try { ok = eval(code); } catch (e) { ok = false; }
    if (ok) return true;
  }
  return false;
}

const faelle = [
  // [Beschreibung, Pfad, read|write, uid, erwartet]
  ["MUSS: eigene Hand lesen (Gast)", "autoQuartett/geheime_karten/ABCD/gast-1/karten", "read", "gast-1", true],
  ["MUSS: Host liest fremde Hand (Schiedsrichter)", "autoQuartett/geheime_karten/ABCD/gast-1/karten", "read", "host-uid", true],
  ["MUSS: Host liest Bot-Hand", "autoQuartett/geheime_karten/ABCD/bot-x7/karten", "read", "host-uid", true],
  ["MUSS: Host verteilt Karten", "autoQuartett/geheime_karten/ABCD/gast-1/karten", "write", "host-uid", true],
  ["MUSS: Host loescht Hand beim Aufraeumen", "autoQuartett/geheime_karten/ABCD/gast-1", "write", "host-uid", true],
  ["MUSS: Raum ist oeffentlich lesbar", "autoQuartett/raeume/ABCD", "read", null, true],
  ["MUSS: Gast tritt dem Raum bei", "autoQuartett/raeume/ABCD/spieler/gast-1", "write", "gast-1", true],
  ["MUSS: Kartenkatalog oeffentlich lesbar", "autoQuartett/kartenUebersteuerungen", "read", null, true],
  ["MUSS: Kategorien oeffentlich lesbar", "autoQuartett/kategorienUebersteuerungen", "read", null, true],

  ["DARF NICHT: Fremder liest Hand OHNE Anmeldung", "autoQuartett/geheime_karten/ABCD/gast-1/karten", "read", null, false],
  ["DARF NICHT: Gast liest Hand des Mitspielers", "autoQuartett/geheime_karten/ABCD/gast-2/karten", "read", "gast-1", false],
  ["DARF NICHT: Gast liest Hand des Hosts", "autoQuartett/geheime_karten/ABCD/host-uid/karten", "read", "gast-1", false],
  ["DARF NICHT: Gast schreibt in fremde Hand", "autoQuartett/geheime_karten/ABCD/gast-2/karten", "write", "gast-1", false],
  ["DARF NICHT: Gast schreibt in EIGENE Hand", "autoQuartett/geheime_karten/ABCD/gast-1/karten", "write", "gast-1", false],
  ["DARF NICHT: Gast loescht alle Haende", "autoQuartett/geheime_karten/ABCD", "write", "gast-1", false],
  ["DARF NICHT: Host von Raum A liest Haende in Raum B", "autoQuartett/geheime_karten/ZZZZ/gast-1/karten", "read", "host-uid", false],

  ["MUSS: fussballQuartett — eigene Hand", "fussballQuartett/geheime_karten/WXYZ/gast-1/karten", "read", "gast-1", true],
  ["DARF NICHT: fussballQuartett — fremde Hand", "fussballQuartett/geheime_karten/WXYZ/gast-2/karten", "read", "gast-1", false],
  ["MUSS: vereineQuartett — Host liest alles", "fussballVereineQuartett/geheime_karten/QRST/gast-1/karten", "read", "host-uid", true],
  ["DARF NICHT: vereineQuartett — anonym lesen", "fussballVereineQuartett/geheime_karten/QRST/gast-1/karten", "read", null, false],

  ["Gegenprobe: letzteKarte war schon zu", "letzteKarte/haende/ABCD/gast-2", "read", "gast-1", false],
  ["Gegenprobe: werwolf war schon zu", "werwolf/privat/ABCD/gast-2", "read", "gast-1", false]
];

let fehler = 0;
for (const [text, pfad, typ, uid, erwartet] of faelle) {
  const ist = darf(pfad, typ, uid);
  const ok = ist === erwartet;
  if (!ok) fehler++;
  console.log((ok ? "  OK   " : "  FEHL ") + text + "   (erwartet " + erwartet + ", ist " + ist + ")");
}
console.log("\n" + (fehler ? fehler + " FEHLER" : "alle " + faelle.length + " Zusagen erfuellt"));
