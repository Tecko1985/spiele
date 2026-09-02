/* ==========================================================================
   Letzte Karte — Prüfung auf doppelte globale Namen
   ==========================================================================

   Aufruf (im Ordner letzte-karte):   node pflege/pruefe-namen.js

   WARUM.
   Alle über <script src> geladenen Dateien teilen sich EINEN globalen Scope.
   Derselbe `const`-Name in zwei Dateien ist ein SyntaxError, der die zweite
   Datei komplett abwürgt — und zwar mit Symptomen, die wie ein Ladefehler
   aussehen ("bildschirme is not defined", obwohl die Datei mit 200
   ausgeliefert wurde).

   ⚠️ `node --check` findet das NIE, weil es jede Datei einzeln prüft. Auch
   die Konsole des Browser-Panes zeigt den Parse-Fehler nicht zuverlässig.
   Deshalb dieses Skript: es liest die Ladeliste aus `index.html` — nicht aus
   einer gepflegten Kopie davon, die auseinanderlaufen könnte — und sammelt
   alle Namen auf oberster Ebene ein.

   Siehe den Abschnitt "Gotchas" in `spiele/CLAUDE.md`.
   ========================================================================== */

'use strict';

const fs = require('fs');
const pfad = require('path');

const wurzel = pfad.join(__dirname, '..');
const html = fs.readFileSync(pfad.join(wurzel, 'index.html'), 'utf8');

/* Nur eigene Dateien; die Firebase-Bibliotheken von gstatic bringen ihren
   eigenen Scope mit und stehen nicht unter unserer Kontrolle. */
const dateien = [];
const muster = /<script src="([^"]+)"/g;
let treffer;
while ((treffer = muster.exec(html)) !== null) {
  const roh = treffer[1].split('?')[0];
  if (roh.indexOf('http') === 0) continue;
  dateien.push(roh);
}

/* Nur die oberste Ebene zählt: eine Zeile, die ohne Einrückung beginnt.
   Alles, was in einer Funktion oder einem Modulverschluss steht, ist
   eingerückt und kann per Definition nicht kollidieren. */
const NAME_MUSTER = /^(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm;

const gesehen = {};
const doppelt = [];
let fehlend = 0;

for (const datei of dateien) {
  const voll = pfad.join(wurzel, datei);
  if (!fs.existsSync(voll)) {
    console.log('  FEHLT: ' + datei + ' — in index.html verlinkt, aber nicht vorhanden');
    fehlend++;
    continue;
  }
  const text = fs.readFileSync(voll, 'utf8');
  let m;
  NAME_MUSTER.lastIndex = 0;
  while ((m = NAME_MUSTER.exec(text)) !== null) {
    const name = m[1];
    if (gesehen[name] && gesehen[name] !== datei) {
      doppelt.push(name + '   (' + gesehen[name] + '  und  ' + datei + ')');
    }
    gesehen[name] = datei;
  }
}

console.log('');
console.log('  Letzte Karte — globale Namen');
console.log('  ' + '-'.repeat(60));
console.log('  ' + dateien.length + ' eigene Dateien aus index.html gelesen');
console.log('  ' + Object.keys(gesehen).length + ' Namen auf oberster Ebene');

if (fehlend > 0) {
  console.log('');
  console.log('  ' + fehlend + ' verlinkte Datei(en) fehlen.');
  console.log('');
  process.exit(1);
}

if (doppelt.length) {
  console.log('');
  console.log('  DOPPELT VERGEBEN — die zweite Datei wird nicht geladen:');
  for (const d of doppelt) console.log('    ' + d);
  console.log('');
  process.exit(1);
}

console.log('  Keine Doppelung.');
console.log('');
process.exit(0);
