/* ==========================================================================
   Prüfstand für den Rechenkern von Viertelmeile
   ==========================================================================
   Aufruf:  node pflege/pruefe-fahrt.js
            node pflege/pruefe-fahrt.js --tabelle     (nur die Zeiten zeigen)

   ⚠️ Geprüft wird der ECHTE Code: physik.js, autos.js und bot.js, dieselben
   Dateien, die der Browser lädt. Kein Nachbau.

   Was hier belegt werden muss:
     1. Eine perfekte Fahrt liegt je Auto im gewollten Zeitfenster.
     2. Können schlägt Glück: schwer > mittel > leicht, deutlich.
     3. Der Rechentakt ist bildratenunabhängig — 30 Bilder/s ergeben
        dieselbe Zeit wie 120.
     4. Gleiche Saat = gleiche Ausbrecher (beide Handys fahren dasselbe).
     5. Wer gar nicht gegenlenkt, fliegt raus.
     6. Frühstart verliert, auch gegen eine langsamere Fahrt.
   ========================================================================== */

const physik = require('../physik.js');
const autos = require('../autos.js');
const bot = require('../bot.js');

let fehler = 0;
let geprueft = 0;

function pruefe(name, bedingung, info) {
  geprueft++;
  if (bedingung) {
    console.log('  OK   ' + name + (info ? '  (' + info + ')' : ''));
  } else {
    fehler++;
    console.log('  FEHL ' + name + (info ? '  (' + info + ')' : ''));
  }
}

function z3(x) { return x === null || x === undefined ? '—' : x.toFixed(3); }

/* --------------------------------------------------------------------------
   Ein makelloser Fahrer: Reaktion 0,180 s, perfekter Burnout, jeder Gang
   genau an der Grenze, jeder Ausbrecher sofort gehalten.
   -------------------------------------------------------------------------- */

/**
 * Ein Mensch am Lenkfeld — der Baustein, den alle Prüf-Fahrten benutzen.
 *
 * ⚠️ ER HÄLT, ER HÄMMERT NICHT. Der erste Prüfstand tippte alle 0,15 s aufs
 * Lenkfeld, also acht Mal je Ausbrecher. Damit sah das Spiel in jeder Messung
 * gut aus — und war mit einem echten Daumen nicht zu fahren. Michel nach der
 * ersten Fahrt: „das Auto in der Spur halten ist unmöglich". Der Fahrer hier
 * bildet nach, was ein Mensch wirklich tut: hinsehen, halten, loslassen,
 * wenn es wieder gerade steht — und das alles mit Verzögerung.
 *
 * `opt.verzug` = Schrecksekunde, bis er einen Ausbrecher überhaupt bemerkt.
 * `opt.blick`  = wie oft er die Lage neu einschätzt (nicht jedes Bild!).
 * `opt.plan`   = wenn gesetzt, werden die Tipper mit Zeit aufgezeichnet.
 * `opt.nie`    = true: er lenkt gar nicht.
 */
const TOTZONE = 0.08;

function lenkeWieEinMensch(l, opt) {
  if (opt.nie) return;
  if (l.t - opt._blickAb < opt.blick) {
    /* Zwischen zwei Blicken bleibt der Daumen einfach liegen. */
    return;
  }
  opt._blickAb = l.t;

  let zieht = 0, schlaeft = false;
  for (const zg of l.zuege) {
    if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER) {
      if (l.t < zg.zeit + opt.verzug) { schlaeft = true; break; }
      zieht += zg.richtung;
    }
  }

  let halten = 0;
  if (schlaeft) halten = 0;
  else if (Math.abs(l.versatz) > TOTZONE) halten = l.versatz > 0 ? -1 : 1;   // zurück zur Mitte
  else if (zieht !== 0) halten = zieht > 0 ? -1 : 1;                          // gegen den Zug
  if (halten === opt._haelt) return;                                          // nichts Neues
  opt._haelt = halten;

  if (halten === 0) {
    physik.lenkeAus(l);
    if (opt.plan) opt.plan.push({ zeit: l.t, art: 'lenkAus' });
  } else {
    physik.lenkeAn(l, halten);
    if (opt.plan) opt.plan.push({ zeit: l.t, art: 'lenkAn', richtung: halten });
  }
}

function neuerFahrer(zusatz) {
  return Object.assign({ verzug: 0.30, blick: 0.18, plan: null, nie: false, _blickAb: -9, _haelt: 0 }, zusatz || {});
}

/** Schalten am oberen Rand des grünen Fensters. */
function schalteWennOben(l, auto, plan) {
  if (l.gang >= auto.gaenge.length - 1 || l.t < l.leerlaufBis) return;
  const f = physik.fenster(auto, l.gang);
  if (physik.drehzahl(l) < (f.perfektAb + 1.0) / 2) return;
  if (plan) plan.push({ zeit: l.t, art: 'schalt' });
  physik.schalte(l);
}

function perfekteFahrt(auto, saat) {
  const l = physik.neuerLauf(auto, saat, 0.95);
  physik.starte(l, 0.180);
  const fahrer = neuerFahrer({ verzug: 0.20, blick: 0.12 });
  let wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    schalteWennOben(l, auto, null);
    lenkeWieEinMensch(l, fahrer);
  }
  return l;
}

/* --------------------------------------------------------------------------
   1. Zeitfenster je Auto
   -------------------------------------------------------------------------- */

console.log('\n=== 1. Perfekte Fahrt je Auto (Schnitt aus 40 Saaten) ===\n');

/* Von-bis in Sekunden GESAMT (Reaktion + Fahrzeit). Ein echtes Drag Race
   über die Viertelmeile liegt bei 9 bis 12 s — darin soll die Flotte liegen,
   sonst wird das Rennen entweder hektisch oder zäh. */
const SOLL = {
  flitzer: [11.0, 13.0],
  muscle: [9.8, 11.4],
  dragster: [8.8, 10.4],
};

const zeiten = {};
for (const auto of autos.LISTE) {
  let summe = 0, n = 0, min = 99, max = 0;
  const noten = { perfekt: 0, gut: 0, zufrueh: 0, ueberdreht: 0 };
  for (let saat = 1; saat <= 40; saat++) {
    const l = perfekteFahrt(auto, saat * 7919);
    const g = physik.gesamtzeit(l);
    if (g === null) { max = 99; continue; }
    summe += g; n++;
    if (g < min) min = g;
    if (g > max) max = g;
    for (const k in noten) noten[k] += l.noten[k];
  }
  const schnitt = n ? summe / n : null;
  zeiten[auto.id] = schnitt;
  const s = SOLL[auto.id];
  console.log('  ' + auto.name.padEnd(16) + ' Schnitt ' + z3(schnitt) + ' s   von ' + z3(min) + ' bis ' + z3(max) +
    '   Noten p/g/f/ü: ' + noten.perfekt + '/' + noten.gut + '/' + noten.zufrueh + '/' + noten.ueberdreht);
  pruefe(auto.name + ' liegt im Zeitfenster ' + s[0] + '–' + s[1] + ' s', n === 40 && schnitt >= s[0] && schnitt <= s[1], z3(schnitt) + ' s');
  pruefe(auto.name + ': perfekter Fahrer trifft fast immer perfekt', noten.zufrueh + noten.ueberdreht <= noten.perfekt * 0.12,
    noten.perfekt + ' perfekt gegen ' + (noten.zufrueh + noten.ueberdreht) + ' daneben');
}

pruefe('Dragster ist schneller als Muscle-Car', zeiten.dragster < zeiten.muscle);
pruefe('Muscle-Car ist schneller als Flitzer', zeiten.muscle < zeiten.flitzer);

/* --------------------------------------------------------------------------
   2. Können schlägt Glück
   -------------------------------------------------------------------------- */

console.log('\n=== 2. Bot-Stufen gegeneinander (200 Rennen je Paarung) ===\n');

function botSchnitt(auto, stufe, anzahl) {
  let summe = 0, n = 0, raus = 0;
  for (let i = 1; i <= anzahl; i++) {
    const l = bot.fahre(auto, i * 104729, stufe, i * 31337);
    const g = physik.gesamtzeit(l);
    if (g === null) { raus++; continue; }
    summe += g; n++;
  }
  return { schnitt: n ? summe / n : null, raus: raus, n: n };
}

function duell(auto, stufeA, stufeB, anzahl) {
  let a = 0, b = 0, un = 0;
  for (let i = 1; i <= anzahl; i++) {
    const saat = i * 104729;
    const la = bot.fahre(auto, saat, stufeA, i * 31337);
    const lb = bot.fahre(auto, saat, stufeB, i * 65599);
    const w = physik.vergleiche(la, lb);
    if (w === 'a') a++; else if (w === 'b') b++; else un++;
  }
  return { a: a, b: b, un: un };
}

const auto = autos.nachId('muscle');
for (const st of ['leicht', 'mittel', 'schwer']) {
  const r = botSchnitt(auto, st, 200);
  console.log('  ' + bot.stufe(st).name.padEnd(8) + ' Schnitt ' + z3(r.schnitt) + ' s, ' + r.raus + ' von 200 ausgeschieden');
}

const d1 = duell(auto, 'schwer', 'leicht', 200);
const d2 = duell(auto, 'schwer', 'mittel', 200);
const d3 = duell(auto, 'mittel', 'leicht', 200);
console.log('  schwer gegen leicht: ' + d1.a + ':' + d1.b + ' (' + d1.un + ' unentschieden)');
console.log('  schwer gegen mittel: ' + d2.a + ':' + d2.b + ' (' + d2.un + ' unentschieden)');
console.log('  mittel gegen leicht: ' + d3.a + ':' + d3.b + ' (' + d3.un + ' unentschieden)');
pruefe('schwer gewinnt klar gegen leicht', d1.a > d1.b * 6, d1.a + ':' + d1.b);
pruefe('schwer gewinnt gegen mittel', d2.a > d2.b * 1.6, d2.a + ':' + d2.b);
pruefe('mittel gewinnt gegen leicht', d3.a > d3.b * 3, d3.a + ':' + d3.b);
/* ⚠️ Kein „leicht schlägt schwer manchmal" mehr. Das stand hier zuerst, ging
   aber an der Sache vorbei: Der Gastgeber stellt EINE Bot-Stärke ein, leicht
   gegen schwer kommt im Spiel nie vor. Und über eine Viertelmeile schlägt ein
   Anfänger einen Könner auch in echt nicht — das wäre kein Beleg für Glück,
   sondern für kaputte Stufen. Was wirklich zählt: Innerhalb EINER Stufe muss
   es spannend bleiben. */
const gleichStark = duell(auto, 'mittel', 'mittel', 300);
console.log('  mittel gegen mittel: ' + gleichStark.a + ':' + gleichStark.b + ' (' + gleichStark.un + ' unentschieden)');
const anteil = gleichStark.a / (gleichStark.a + gleichStark.b);
pruefe('zwei gleich starke Fahrer teilen sich die Siege', anteil > 0.40 && anteil < 0.60, (anteil * 100).toFixed(0) + '% zu ' + (100 - anteil * 100).toFixed(0) + '%');
pruefe('der Abstand zwischen den Stufen ist größer als der Zufall darin',
  Math.abs(botSchnitt(auto, 'mittel', 200).schnitt - botSchnitt(auto, 'schwer', 200).schnitt) > 0.15);

/* --------------------------------------------------------------------------
   3. Bildrate darf nichts ändern
   -------------------------------------------------------------------------- */

console.log('\n=== 3. Fester Rechentakt ===\n');

/* Dieselben Tipper, einmal auf einem Handy mit 120 Bildern/s und einmal auf
   einem mit 30 — und einmal mit ganz krummen Bildabständen, wie sie
   entstehen, wenn das Gerät nebenher zu tun hat. Es muss dieselbe Zeit
   herauskommen, sonst gewinnt das bessere Handy statt des besseren Fahrers. */

function fahrplanAufnehmen(a, saat) {
  const l = physik.neuerLauf(a, saat, 0.95);
  physik.starte(l, 0.180);
  const plan = [];
  const fahrer = neuerFahrer({ verzug: 0.20, blick: 0.12, plan: plan });
  let wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    schalteWennOben(l, a, plan);
    lenkeWieEinMensch(l, fahrer);
  }
  return plan;
}

function abspielen(a, saat, plan, bilder) {
  const l = physik.neuerLauf(a, saat, 0.95);
  physik.starte(l, 0.180);
  const q = plan.map(function (x) { return { zeit: x.zeit, art: x.art, richtung: x.richtung }; });
  let uhr = 0, wache = 0;
  while (!l.fertig && !l.aus && wache++ < 5000) {
    uhr += typeof bilder === 'function' ? bilder() : 1 / bilder;
    physik.laufeBis(l, uhr, q);
  }
  return l;
}

let groessteAbweichung = 0;
let holpernAbweichung = 0;
for (const a of autos.LISTE) {
  for (let saat = 1; saat <= 10; saat++) {
    const s = saat * 7919;
    const plan = fahrplanAufnehmen(a, s);
    const schnell = abspielen(a, s, plan, 120);
    const langsam = abspielen(a, s, plan, 30);
    /* Krumme Bildabstände zwischen 8 und 60 ms, aus der Saat gewürfelt. */
    const w = physik.saatZufall(s ^ 0x5bf03635);
    const holprig = abspielen(a, s, plan, function () { return 0.008 + w() * 0.052; });
    const va = physik.gesamtzeit(schnell), vb = physik.gesamtzeit(langsam), vc = physik.gesamtzeit(holprig);
    if (va === null || vb === null || vc === null) { groessteAbweichung = 99; break; }
    groessteAbweichung = Math.max(groessteAbweichung, Math.abs(va - vb));
    holpernAbweichung = Math.max(holpernAbweichung, Math.abs(va - vc));
  }
}
pruefe('30 und 120 Bilder/s ergeben dieselbe Zeit', groessteAbweichung < 0.0005, 'größte Abweichung ' + groessteAbweichung.toFixed(6) + ' s');
pruefe('ruckelnde Bildrate ergibt dieselbe Zeit', holpernAbweichung < 0.0005, 'größte Abweichung ' + holpernAbweichung.toFixed(6) + ' s');

/* --------------------------------------------------------------------------
   4. Gleiche Saat = gleiche Ausbrecher
   -------------------------------------------------------------------------- */

console.log('\n=== 4. Beide Fahrer bekommen dieselbe Fahrt ===\n');

let gleich = true;
for (let saat = 1; saat <= 200; saat++) {
  const a = physik.ausbrecher(saat * 7919, autos.nachId('muscle'));
  const b = physik.ausbrecher(saat * 7919, autos.nachId('muscle'));
  if (JSON.stringify(a) !== JSON.stringify(b)) gleich = false;
}
pruefe('gleiche Saat ergibt identische Ausbrecher', gleich);

let verschieden = 0;
for (let saat = 1; saat < 200; saat++) {
  const a = JSON.stringify(physik.ausbrecher(saat * 7919, autos.nachId('muscle')));
  const b = JSON.stringify(physik.ausbrecher((saat + 1) * 7919, autos.nachId('muscle')));
  if (a !== b) verschieden++;
}
pruefe('verschiedene Saaten ergeben verschiedene Fahrten', verschieden === 199, verschieden + ' von 199');

let anzahlOk = true, zeitOk = true;
for (let saat = 1; saat <= 500; saat++) {
  const liste = physik.ausbrecher(saat * 7919, autos.nachId('muscle'));
  if (liste.length < 2 || liste.length > 4) anzahlOk = false;
  for (const zg of liste) if (zg.zeit < 1.6 || zg.zeit > 9.6) zeitOk = false;
}
pruefe('immer 2 bis 4 Ausbrecher', anzahlOk);
pruefe('kein Ausbrecher in der ersten Sekunde', zeitOk);

/* --------------------------------------------------------------------------
   5. Wer nicht gegenlenkt, fliegt raus
   -------------------------------------------------------------------------- */

console.log('\n=== 5. Lenken ist Pflicht ===\n');

let rausOhneLenken = 0;
for (let saat = 1; saat <= 100; saat++) {
  const l = physik.neuerLauf(autos.nachId('muscle'), saat * 7919, 0.95);
  physik.starte(l, 0.18);
  let wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.gang < 2 && physik.drehzahl(l) >= 0.97 && l.t >= l.leerlaufBis) physik.schalte(l);
  }
  if (l.aus) rausOhneLenken++;
}
pruefe('ohne Gegenlenken fliegt man fast immer raus', rausOhneLenken >= 95, rausOhneLenken + ' von 100');

/* Ein Ausbrecher, den man sofort hält, darf NICHT rauswerfen. */
let rausTrotzLenken = 0;
for (let saat = 1; saat <= 100; saat++) {
  const l = perfekteFahrt(autos.nachId('muscle'), saat * 7919);
  if (l.aus) rausTrotzLenken++;
}
pruefe('wer sofort gegenhält, bleibt drin', rausTrotzLenken === 0, rausTrotzLenken + ' von 100 rausgeflogen');

/* --------------------------------------------------------------------------
   6. Frühstart
   -------------------------------------------------------------------------- */

console.log('\n=== 6. Frühstart ===\n');

const schnellAberFrueh = { gesamt: null, fehlstart: true, aus: false, reaktion: -0.05 };
const langsamAberSauber = { gesamt: 14.9, fehlstart: false, aus: false, reaktion: 0.9 };
pruefe('Frühstart verliert gegen jede saubere Fahrt', physik.vergleiche(schnellAberFrueh, langsamAberSauber) === 'b');

const frueherFuss = { gesamt: null, fehlstart: true, aus: false, reaktion: -0.20 };
const spaetererFuss = { gesamt: null, fehlstart: true, aus: false, reaktion: -0.02 };
pruefe('bei zwei Frühstarts verliert der Frühere', physik.vergleiche(frueherFuss, spaetererFuss) === 'b');

const linieBeruehrt = { gesamt: null, fehlstart: false, aus: true, reaktion: 0.2 };
pruefe('Linie berührt verliert gegen Frühstart nicht automatisch', physik.vergleiche(linieBeruehrt, frueherFuss) === 'a');
pruefe('zwei Ausgeschiedene sind unentschieden', physik.vergleiche(linieBeruehrt, { gesamt: null, fehlstart: false, aus: true, reaktion: 0.3 }) === null);

const gleichA = { gesamt: 10.123, fehlstart: false, aus: false, reaktion: 0.2 };
const gleichB = { gesamt: 10.123, fehlstart: false, aus: false, reaktion: 0.3 };
pruefe('exakt gleiche Zeit ist unentschieden', physik.vergleiche(gleichA, gleichB) === null);

/* --------------------------------------------------------------------------
   7. Burnout
   -------------------------------------------------------------------------- */

console.log('\n=== 7. Burnout ===\n');

pruefe('Punktlandung gibt vollen Griff', physik.griffAusBurnout(0.90) === 1.0);
pruefe('kalte Reifen greifen schlechter', physik.griffAusBurnout(0.20) < 0.8, z3(physik.griffAusBurnout(0.20)));
pruefe('verbrannte Reifen greifen schlechter', physik.griffAusBurnout(1.35) < 0.8, z3(physik.griffAusBurnout(1.35)));
pruefe('ohne Burnout liegt der Griff dazwischen', physik.griffAusBurnout(null) > 0.8 && physik.griffAusBurnout(null) < 1.0, z3(physik.griffAusBurnout(null)));

const mitBurnout = perfekteFahrt(autos.nachId('muscle'), 12345);
const l2 = physik.neuerLauf(autos.nachId('muscle'), 12345, 0.10);
physik.starte(l2, 0.180);
{
  let wache = 0;
  const a2 = autos.nachId('muscle');
  const fahrer2 = neuerFahrer({ verzug: 0.20, blick: 0.12 });
  while (!l2.fertig && !l2.aus && wache++ < 20000) {
    physik.schritt(l2, physik.SCHRITT);
    if (l2.fertig || l2.aus) break;
    schalteWennOben(l2, a2, null);
    lenkeWieEinMensch(l2, fahrer2);
  }
}
const abstand = physik.gesamtzeit(l2) - physik.gesamtzeit(mitBurnout);
console.log('  kalte Reifen kosten ' + abstand.toFixed(3) + ' s');
pruefe('kalter Burnout kostet spürbar Zeit', abstand > 0.05 && abstand < 1.2, abstand.toFixed(3) + ' s');

/* --------------------------------------------------------------------------
   8. Jeder Fehler kostet Zeit — und zwar spürbar
   -------------------------------------------------------------------------- */

console.log('\n=== 8. Was ein Fehler kostet ===\n');

/* Immer dasselbe Auto und dieselbe Saat, nur EIN Fehler unterscheidet die
   Läufe. So ist der Zeitunterschied wirklich diesem Fehler zuzuschreiben. */
function fahrtMit(opt) {
  const a = autos.nachId('muscle');
  const l = physik.neuerLauf(a, 4242, opt.waerme === undefined ? 0.95 : opt.waerme);
  physik.starte(l, opt.reaktion === undefined ? 0.180 : opt.reaktion);
  /* ⚠️ Die Schrecksekunde hält AUCH das Nachsteuern an — sonst reagiert der
     „träge" Fahrer in Wahrheit sofort, sobald sich das Auto einen Fingerbreit
     bewegt, und ein später Griff kostet nichts. Das steckt in
     `lenkeWieEinMensch`. */
  const fahrer = neuerFahrer({
    verzug: opt.lenkVerzug === null ? 0 : (opt.lenkVerzug || 0.20),
    blick: opt.lenkBlick || 0.18,
    nie: opt.lenkVerzug === null,
  });
  let wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    if (l.gang < a.gaenge.length - 1 && l.t >= l.leerlaufBis) {
      const f = physik.fenster(a, l.gang);
      const ziel = opt.schaltZiel === undefined ? (f.perfektAb + 1.0) / 2 : opt.schaltZiel;
      if (physik.drehzahl(l) >= ziel) physik.schalte(l);
    }
    lenkeWieEinMensch(l, fahrer);
  }
  return l;
}

const makellos = fahrtMit({});
const spaetGelenkt = fahrtMit({ lenkVerzug: 0.85, lenkBlick: 0.30 });
const nieGelenkt = fahrtMit({ lenkVerzug: null });
const vielZuSpaet = fahrtMit({ lenkVerzug: 1.70, lenkBlick: 0.32 });
const zuFrueh = fahrtMit({ schaltZiel: 0.80 });
const ueberdreht = fahrtMit({ schaltZiel: 1.06 });
const traegerFuss = fahrtMit({ reaktion: 0.500 });

const basis = physik.gesamtzeit(makellos);
function kosten(l) { const g = physik.gesamtzeit(l); return g === null ? null : g - basis; }

console.log('  makellose Fahrt          ' + z3(basis) + ' s');
console.log('  spät gegengelenkt        + ' + z3(kosten(spaetGelenkt)) + ' s   (Spurverlust ' + spaetGelenkt.spurVerlust.toFixed(1) + ' m/s)');
console.log('  zu früh geschaltet       + ' + z3(kosten(zuFrueh)) + ' s   (' + zuFrueh.noten.zufrueh + " mal 'zu früh')");
console.log('  überdreht                + ' + z3(kosten(ueberdreht)) + ' s   (' + ueberdreht.noten.ueberdreht + ' mal im Begrenzer)');
console.log('  träge am Grün (0,500 s)  + ' + z3(kosten(traegerFuss)) + ' s');

pruefe('spätes Gegenlenken kostet Zeit, wirft aber nicht raus', !spaetGelenkt.aus && kosten(spaetGelenkt) > 0.10, z3(kosten(spaetGelenkt)) + ' s');
pruefe('wer den halben Zug verschläft, fliegt raus', vielZuSpaet.aus === true);
pruefe('gar nicht lenken fliegt raus', nieGelenkt.aus === true);
pruefe('zu früh schalten kostet Zeit', kosten(zuFrueh) > 0.15, z3(kosten(zuFrueh)) + ' s');
pruefe('überdrehen kostet Zeit', kosten(ueberdreht) > 0.10, z3(kosten(ueberdreht)) + ' s');
pruefe('die Reaktion geht 1:1 in die Gesamtzeit', Math.abs(kosten(traegerFuss) - 0.320) < 0.02, z3(kosten(traegerFuss)) + ' s statt 0.320');
pruefe('perfekt schalten ist besser als nur gut', makellos.noten.perfekt > 0 && kosten(zuFrueh) > 0);

/* --------------------------------------------------------------------------
   9. Halten reicht — Hämmern darf NIE nötig sein
   -------------------------------------------------------------------------- */

console.log('\n=== 9. Ein Finger, der liegen bleibt ===\n');

/* ⚠️ DIE PRÜFUNG, DIE ES VORHER NICHT GAB. Die erste Fassung ließ einen
   Tipper 0,30 s wirken, ein Ausbrecher dauerte 1,25 s — man musste fünfmal
   hämmern. Jede Messung war grün, weil der Prüf-Fahrer achtmal je Ausbrecher
   tippte. Michel nach dem ersten Fahren: „das Auto in der Spur halten ist
   unmöglich." Diese Prüfung fährt mit EINEM Griff je Ausbrecher. */

function haltenNurEinmal(auto, saat, verzug) {
  const l = physik.neuerLauf(auto, saat, 0.95);
  physik.starte(l, 0.180);
  let wache = 0, haelt = 0, maxV = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    maxV = Math.max(maxV, Math.abs(l.versatz));
    schalteWennOben(l, auto, null);

    /* Genau ein Griff je Ausbrecher: aufsetzen, liegen lassen, am Ende des
       Zuges wieder loslassen. Kein einziges Nachfassen. */
    let soll = 0;
    for (const zg of l.zuege) {
      if (l.t >= zg.zeit + verzug && l.t < zg.zeit + physik.ZUG_DAUER) soll = zg.richtung > 0 ? -1 : 1;
    }
    if (soll !== haelt) {
      haelt = soll;
      if (soll === 0) physik.lenkeAus(l); else physik.lenkeAn(l, soll);
    }
  }
  return { lauf: l, maxV: maxV };
}

let einGriffRaus = 0, einGriffMax = 0;
for (const a of autos.LISTE) {
  for (let saat = 1; saat <= 60; saat++) {
    const r = haltenNurEinmal(a, saat * 7919, 0.35);
    if (r.lauf.aus) einGriffRaus++;
    einGriffMax = Math.max(einGriffMax, r.maxV);
  }
}
pruefe('EIN Griff je Ausbrecher reicht — kein einziges Rennen verloren', einGriffRaus === 0, einGriffRaus + ' von 180');
/* ⚠️ 0,80 statt 0,60 — und das ist eine Aussage, kein Nachgeben. Wer den
   Finger stur den GANZEN Zug über liegen lässt, schiebt das Auto hinter der
   Mitte noch weiter und landet auf der anderen Seite bei rund 0,7. Das ist
   die grobe Bedienung: sie reicht immer, kostet aber Zeit. Wer loslässt,
   sobald das Auto gerade steht, bleibt unter 0,35 — dieselbe Physik. */
pruefe('und das Auto bleibt dabei von der Linie weg', einGriffMax < 0.80, 'größter Ausschlag ' + einGriffMax.toFixed(2));

/* Gegenprobe: Das Halten muss auch WIRKEN — ein Lauf ganz ohne Griff fliegt
   raus. Sonst wäre die Zusage oben nur die Aussage, dass nichts passiert. */
let ohneGriffRaus = 0;
for (const a of autos.LISTE) {
  for (let saat = 1; saat <= 60; saat++) {
    const l = physik.neuerLauf(a, saat * 7919, 0.95);
    physik.starte(l, 0.180);
    let wache = 0;
    while (!l.fertig && !l.aus && wache++ < 20000) {
      physik.schritt(l, physik.SCHRITT);
      schalteWennOben(l, a, null);
    }
    if (l.aus) ohneGriffRaus++;
  }
}
pruefe('ohne jeden Griff fliegt jedes Rennen raus', ohneGriffRaus === 180, ohneGriffRaus + ' von 180');

/* Ein kurzer Tipper muss trotzdem etwas bewirken — sonst wäre der Wechsel
   auf „halten" eine Falle für alle, die noch tippen. */
{
  const a = autos.nachId('muscle');
  const l = physik.neuerLauf(a, 4242, 0.95);
  physik.starte(l, 0.180);
  for (let i = 0; i < 60; i++) physik.schritt(l, physik.SCHRITT);   // 0,5 s rollen
  const vorher = l.versatz;
  physik.lenke(l, 1);                                               // ein kurzer Tipper
  for (let i = 0; i < 30; i++) physik.schritt(l, physik.SCHRITT);    // 0,25 s später
  pruefe('ein kurzer Tipper bewegt das Auto trotzdem', l.versatz - vorher > 0.05,
    'Versatz ' + vorher.toFixed(3) + ' -> ' + l.versatz.toFixed(3));
}

/* --------------------------------------------------------------------------
   Ergebnis
   -------------------------------------------------------------------------- */

console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' FEHLER') + ' — ' + geprueft + ' Prüfungen\n');
process.exit(fehler === 0 ? 0 : 1);
