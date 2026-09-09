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

function perfekteFahrt(auto, saat) {
  const l = physik.neuerLauf(auto, saat, 0.95);
  physik.starte(l, 0.180);
  let naechste = -1;
  let wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    if (l.gang < auto.gaenge.length - 1 && l.t >= l.leerlaufBis) {
      const f = physik.fenster(auto, l.gang);
      if (physik.drehzahl(l) >= (f.perfektAb + 1.0) / 2) physik.schalte(l);
    }
    let zieht = 0;
    for (const zg of l.zuege) if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER + 0.3) zieht += zg.richtung;
    const schief = Math.abs(l.versatz) > 0.05 ? (l.versatz > 0 ? 1 : -1) : 0;
    const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
    if (noetig !== 0 && l.t >= naechste) { naechste = l.t + 0.15; physik.lenke(l, -noetig); }
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
  let naechste = -1, wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    if (l.gang < a.gaenge.length - 1 && l.t >= l.leerlaufBis) {
      const f = physik.fenster(a, l.gang);
      if (physik.drehzahl(l) >= (f.perfektAb + 1.0) / 2) { plan.push({ zeit: l.t, art: 'schalt' }); physik.schalte(l); }
    }
    let zieht = 0;
    for (const zg of l.zuege) if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER + 0.3) zieht += zg.richtung;
    const schief = Math.abs(l.versatz) > 0.05 ? (l.versatz > 0 ? 1 : -1) : 0;
    const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
    if (noetig !== 0 && l.t >= naechste) {
      naechste = l.t + 0.15;
      plan.push({ zeit: l.t, art: 'lenk', richtung: -noetig });
      physik.lenke(l, -noetig);
    }
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
  let naechste = -1, wache = 0;
  const a2 = autos.nachId('muscle');
  while (!l2.fertig && !l2.aus && wache++ < 20000) {
    physik.schritt(l2, physik.SCHRITT);
    if (l2.fertig || l2.aus) break;
    if (l2.gang < a2.gaenge.length - 1 && l2.t >= l2.leerlaufBis) {
      const f = physik.fenster(a2, l2.gang);
      if (physik.drehzahl(l2) >= (f.perfektAb + 1.0) / 2) physik.schalte(l2);
    }
    let zieht = 0;
    for (const zg of l2.zuege) if (l2.t >= zg.zeit && l2.t < zg.zeit + physik.ZUG_DAUER + 0.3) zieht += zg.richtung;
    const schief = Math.abs(l2.versatz) > 0.05 ? (l2.versatz > 0 ? 1 : -1) : 0;
    const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
    if (noetig !== 0 && l2.t >= naechste) { naechste = l2.t + 0.15; physik.lenke(l2, -noetig); }
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
  let naechste = -1, wache = 0;
  while (!l.fertig && !l.aus && wache++ < 20000) {
    physik.schritt(l, physik.SCHRITT);
    if (l.fertig || l.aus) break;
    if (l.gang < a.gaenge.length - 1 && l.t >= l.leerlaufBis) {
      const f = physik.fenster(a, l.gang);
      const ziel = opt.schaltZiel === undefined ? (f.perfektAb + 1.0) / 2 : opt.schaltZiel;
      if (physik.drehzahl(l) >= ziel) physik.schalte(l);
    }
    if (opt.lenkVerzug === null) continue;             // gar nicht lenken
    const verzug = opt.lenkVerzug || 0;
    /* ⚠️ Die Schrecksekunde muss AUCH das Nachsteuern anhalten. Der erste
       Entwurf ließ den Fahrer weiter nach dem eigenen Schiefstand greifen —
       damit reagierte der „träge" Fahrer in Wahrheit sofort, sobald sich das
       Auto einen Fingerbreit bewegte, und ein später Griff kostete nichts.
       Gemessen wurde also nichts. */
    let schlaeft = false, zieht = 0;
    for (const zg of l.zuege) {
      if (l.t >= zg.zeit && l.t < zg.zeit + physik.ZUG_DAUER + 0.4) {
        if (l.t < zg.zeit + verzug) schlaeft = true; else zieht += zg.richtung;
      }
    }
    if (schlaeft) continue;
    const schief = Math.abs(l.versatz) > 0.05 ? (l.versatz > 0 ? 1 : -1) : 0;
    const noetig = zieht !== 0 ? (zieht > 0 ? 1 : -1) : schief;
    if (noetig !== 0 && l.t >= naechste) { naechste = l.t + 0.15; physik.lenke(l, -noetig); }
  }
  return l;
}

const makellos = fahrtMit({});
const spaetGelenkt = fahrtMit({ lenkVerzug: 0.55 });
const nieGelenkt = fahrtMit({ lenkVerzug: null });
const vielZuSpaet = fahrtMit({ lenkVerzug: 0.95 });
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

pruefe('spätes Gegenlenken kostet Zeit, wirft aber nicht raus', !spaetGelenkt.aus && kosten(spaetGelenkt) > 0.15, z3(kosten(spaetGelenkt)) + ' s');
pruefe('wer fast eine Sekunde schläft, fliegt raus', vielZuSpaet.aus === true);
pruefe('gar nicht lenken fliegt raus', nieGelenkt.aus === true);
pruefe('zu früh schalten kostet Zeit', kosten(zuFrueh) > 0.15, z3(kosten(zuFrueh)) + ' s');
pruefe('überdrehen kostet Zeit', kosten(ueberdreht) > 0.10, z3(kosten(ueberdreht)) + ' s');
pruefe('die Reaktion geht 1:1 in die Gesamtzeit', Math.abs(kosten(traegerFuss) - 0.320) < 0.02, z3(kosten(traegerFuss)) + ' s statt 0.320');
pruefe('perfekt schalten ist besser als nur gut', makellos.noten.perfekt > 0 && kosten(zuFrueh) > 0);

/* --------------------------------------------------------------------------
   Ergebnis
   -------------------------------------------------------------------------- */

console.log('\n' + (fehler === 0 ? 'ALLES GRÜN' : fehler + ' FEHLER') + ' — ' + geprueft + ' Prüfungen\n');
process.exit(fehler === 0 ? 0 : 1);
