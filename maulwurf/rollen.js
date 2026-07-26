// Sonderrollen: reine Daten + Deckbau. Kein Firebase, kein DOM — damit sich die Verteilung
// in Node testen lässt, so wie bei karte.js.
//
// WICHTIG, warum eine Sonderrolle NEBEN der Seite steht und nicht statt ihr:
// Die Datenbankregel für maulwurf_team prüft wörtlich, ob die eigene gezogene Rolle
// "maulwurf" ist. Stünde bei einem Gestaltwandler "gestaltwandler" im Feld rolle, könnte er
// seine Mitmaulwürfe nicht mehr sehen — und die Regel müsste in der Firebase-Konsole neu
// veröffentlicht werden, bevor die neue Fassung überhaupt spielbar wäre. Deshalb bleibt
// rolle immer "team" oder "maulwurf", und die Sonderrolle liegt in einem eigenen Feld.
// Nebeneffekt: sämtliche bestehenden Rollenvergleiche im Spiel gelten unverändert weiter.

const SONDERROLLEN = {
  ingenieur: {
    seite: "team", icon: "🔧", name: "Ingenieur",
    beschreibung: "Du darfst die Abkürzungen benutzen – genau wie die Maulwürfe. Vorsicht: Wer dich dabei sieht, hält dich für einen.",
    einstellung: "rolleIngenieur"
  },
  wissenschaftler: {
    seite: "team", icon: "🔬", name: "Wissenschaftler",
    beschreibung: "Du siehst jederzeit, wer noch lebt – auch ohne die Leiche gefunden zu haben.",
    einstellung: "rolleWissenschaftler"
  },
  schutzengel: {
    seite: "team", icon: "😇", name: "Schutzengel",
    beschreibung: "Sobald du ausgeschaltet bist, kannst du Lebende für kurze Zeit schützen. Ein Foulspiel an ihnen geht dann daneben.",
    einstellung: "rolleSchutzengel"
  },
  gestaltwandler: {
    seite: "maulwurf", icon: "🎭", name: "Gestaltwandler",
    beschreibung: "Du kannst kurzzeitig wie jemand anderes aussehen. Wer dich sieht, sieht dessen Namen und Farbe.",
    einstellung: "rolleGestaltwandler"
  }
};

function sonderrolleInfo(name) {
  return SONDERROLLEN[name] || null;
}

// Deck-Eintrag ist "team", "maulwurf" oder "seite:sonderrolle" ("team:ingenieur"). Der Host
// schreibt weiterhin nur diese anonyme Multimenge — sie verrät die vorkommenden Rollen, aber
// niemals, wer welche zieht. Wer selbst eine Sonderrolle zieht, kann daraus auf die Menge der
// übrigen schließen, nicht auf deren Verteilung; die Anzahl der Maulwürfe war ohnehin bekannt.
function teileDeckEintrag(eintrag) {
  const teile = String(eintrag || "team").split(":");
  return { rolle: teile[0] === "maulwurf" ? "maulwurf" : "team", sonder: teile[1] || null };
}

// Welche Sonderrollen sind laut Einstellungen an, sortiert nach Seite?
function aktiveSonderrollen(einstellungen, seite) {
  return Object.keys(SONDERROLLEN)
    .filter(n => SONDERROLLEN[n].seite === seite)
    .filter(n => (einstellungen || {})[SONDERROLLEN[n].einstellung]);
}

// Baut das Deck. Sonderrollen belegen bestehende Plätze ihrer Seite, sie schaffen keine neuen:
// die Zahl der Maulwürfe bleibt exakt so, wie sie eingestellt ist.
//
// Auf der Team-Seite bleibt bewusst mindestens ein gewöhnlicher Platz übrig. Nicht wegen der
// Geheimhaltung — die Multimenge verrät ohnehin nichts über die Zuordnung —, sondern damit
// eine kleine Runde nicht vollständig aus Sonderrollen besteht und das Grundspiel verschwindet.
function baueDeck(spielerAnzahl, anzahlMaulwuerfe, einstellungen) {
  const maulwurfPlaetze = Math.max(Math.min(anzahlMaulwuerfe, spielerAnzahl - 1), 0);
  const teamPlaetze = spielerAnzahl - maulwurfPlaetze;
  const deck = [];

  const mwSonder = aktiveSonderrollen(einstellungen, "maulwurf").slice(0, Math.max(maulwurfPlaetze - 0, 0));
  for (let i = 0; i < maulwurfPlaetze; i++) {
    deck.push(mwSonder[i] ? "maulwurf:" + mwSonder[i] : "maulwurf");
  }

  const teamSonder = aktiveSonderrollen(einstellungen, "team").slice(0, Math.max(teamPlaetze - 1, 0));
  for (let i = 0; i < teamPlaetze; i++) {
    deck.push(teamSonder[i] ? "team:" + teamSonder[i] : "team");
  }
  return deck;
}

const rollenModul = { SONDERROLLEN, sonderrolleInfo, teileDeckEintrag, aktiveSonderrollen, baueDeck };

if (typeof module !== "undefined" && module.exports) module.exports = rollenModul;
