# Spiele (v1.0)

Kleine Spiele-Sammlung fürs Team – ideal, um auf der Busfahrt zum Auswärtsspiel ein bisschen Zeit zu überbrücken. Startet mit **Auto-Quartett**, **Fußball-Quartett**, **Fußball-Vereine-Quartett** und **Elfmeterschießen**, weitere Spiele folgen.

Die Kartenverwaltung (✏️ Karten bearbeiten) ist in allen Spielen nur für Admins der [ToolsUebersicht](https://tecko1985.github.io/ToolsUebersicht/) sichtbar — kein eigenes Login hier, wer dort im selben Browser als Admin angemeldet ist, sieht den Button automatisch.

**Live:** https://tecko1985.github.io/spiele/

## Auto-Quartett

Digitales Kartenspiel nach dem Vorbild des klassischen „Auto Quartett" (Top-Trumps-Prinzip). Bis zu 8 Spieler:innen, jede:r mit eigenem Handy.

- **Echte Mehrgeräte-Synchronisierung** über Firebase Realtime Database + anonyme Authentifizierung: ein Gerät erstellt einen Raum mit kurzem Raum-Code (ohne verwechselbare Zeichen wie 0/O/1/I), bis zu 8 Spieler:innen treten mit dem Code bei.
- **Datenschutz eigener Karten**: die geheime Hand jedes Geräts liegt in einem eigenen Datenbankpfad, den nur das eigene Gerät oder das Gastgeber-Gerät lesen kann. Das Gastgeber-Gerät fungiert als „Schiedsrichter" beim Vergleich und muss während der Partie geöffnet bleiben.
- **500 reale Fahrzeugmodelle** als Basisdeck, drei selektierbare Deckgrößen (5 Karten/Spieler:in, 10 Karten/Spieler:in, oder das komplette Kartenpool-Maximum).
- **Kartenverwaltung** (nur für Admins sichtbar): Karten (Name, Typ, Foto, einzelne Eigenschaftswerte) sowie die Kriterien-Labels/Icons bearbeiten — Änderungen liegen als Überschreibung über dem Basisdeck (`mock-data.js`).
- **Bestenliste** über alle Partien hinweg, frei einsehbar.
- Test-Spieler zum Auffüllen der Lobby für Solo-Tests, automatischer Spielablauf bis Sieg oder Abbruch.

### Architektur

Die Spiellogik liegt komplett gekapselt in `auto-quartett/game-service.js` hinter einer async/Promise-basierten API mit Subscription-Pattern (`getZustand()`/`onZustandsAenderung()`); `auto-quartett/app.js` steuert ausschließlich Screens/Rendering/Events und redet nie direkt mit den Datenquellen.

## Fußball-Quartett

Zweites Spiel nach exakt demselben Prinzip wie Auto-Quartett (gleicher Code-Aufbau, eigener Firebase-Namensraum `fussballQuartett/`, damit sich die beiden Spiele nicht in die Quere kommen).

- **500 reale Fußballspieler** (aktuelle Stars und Legenden) als Basisdeck, mit Position (Torwart/Verteidiger/Mittelfeld/Stürmer) statt Fahrzeugtyp.
- **Kriterien**: Marktwert, Karriere-Tore, Karriere-Vorlagen, Länderspiele, Länderspieltore, große Titel, Größe, Tempo-Wert — alle Werte sind ungefähre, gerundete Schätzwerte (wie schon beim Auto-Quartett), keine exakten, tagesaktuellen Statistiken.
- Ansonsten identisches Spielprinzip: Mehrgeräte-Synchronisierung, Kartenverwaltung, Bestenliste, Test-Spieler — siehe Auto-Quartett oben.

### Architektur

Identisch zu Auto-Quartett: `fussball-quartett/game-service.js` (Spiellogik) und `fussball-quartett/app.js` (Screens/Rendering), nur mit eigenem Basisdeck in `fussball-quartett/mock-data.js`.

## Fußball-Vereine-Quartett

Drittes Spiel nach demselben Prinzip, mit **500 realen Fußballvereinen** aus aller Welt statt Spielern oder Autos.

- **Kriterien**: Marktwert Kader, Meistertitel, Pokaltitel, Internationale Titel, Stadion-Kapazität, Mitgliederzahl, Vereinsalter, Social-Media-Follower — ebenfalls ungefähre, gerundete Schätzwerte.
- Eigener Firebase-Namensraum `fussballVereineQuartett/`, ansonsten identisches Spielprinzip wie die anderen beiden Spiele.

### Architektur

Identisch zu Auto-Quartett: `fussball-vereine-quartett/game-service.js` und `fussball-vereine-quartett/app.js`, eigenes Basisdeck in `fussball-vereine-quartett/mock-data.js`.

## Elfmeterschießen

Viertes Spiel, aber ein anderes Genre: kein Kartenspiel, sondern ein **Echtzeit-Duell zu zweit per Wisch-Geste**. Ein Handy schießt (Ball per Wisch nach vorne/links/rechts steuern), das andere hält (Torwart per Wisch in eine beliebige Richtung, inkl. diagonal, tauchen lassen) — 1v1 auf zwei Geräten, kein Einzelspieler-/Bot-Modus.

- **Klassisches Format**: 5 Schüsse pro Spieler:in, abwechselnd (A, B, A, B, …). Bei Gleichstand nach 10 Schüssen läuft die Partie als Sudden Death paarweise weiter, bis nach einem abgeschlossenen Paar ein Punkteunterschied besteht.
- **Wisch-Steuerung, kein Zufall**: Schuss-Zielposition und -Höhe ergeben sich aus Richtung/Distanz der Wisch-Geste (zu kräftig gewischt = Ball fliegt über die Latte); Torwart-Sprungziel ebenso frei aus der Wisch-Richtung. Auflösung rein geometrisch (Abstand Schussziel zu Torwart-Reichweite).
- **Bestenliste** über alle Partien hinweg, frei einsehbar; Zurücksetzen nur für Admins sichtbar (gleiches Muster wie die Kartenverwaltung der Quartett-Spiele).
- Eigener Firebase-Namensraum `elfmeterschiessen/`.

### Architektur

Anders als die drei Quartett-Spiele **kein Host-Schiedsrichter-Modell** — beide Geräte sind gleichberechtigte Peers, die Rundenauflösung läuft über eine Firebase-`transaction()`-geschützte Race-Condition-Vermeidung statt über ein einzelnes autoritatives Gerät. Details siehe `CLAUDE.md` im Repo.

## Lokal starten

Über das Preview-Tool dieses Workspaces (Eintrag `spiele` in `.claude/launch.json`, Port 8782). Hub unter `http://localhost:8782/`, Auto-Quartett unter `http://localhost:8782/auto-quartett/`, Fußball-Quartett unter `http://localhost:8782/fussball-quartett/`, Fußball-Vereine-Quartett unter `http://localhost:8782/fussball-vereine-quartett/`, Elfmeterschießen unter `http://localhost:8782/elfmeterschiessen/`.

## Testdurchlauf

**Kartenspiele (Auto-/Fußball-/Fußball-Vereine-Quartett):**
1. „Raum erstellen" → eigenen Namen eingeben → Lobby
2. Über „Test-Spieler hinzufügen" auf 2–8 Spieler auffüllen
3. „Spiel starten"
4. Wenn du am Zug bist: Eigenschaft auf der eigenen Karte antippen
5. Vergleich ansehen, „Weiter" antippen, bis ein:e Spieler:in alle Karten hat

**Elfmeterschießen** (braucht zwei Geräte/Browser-Fenster mit demselben Raum-Code):
1. Gerät A: „Raum erstellen" → Name eingeben
2. Gerät B: Raum-Code eingeben → „Raum beitreten" → Name eingeben
3. Gerät A (Gastgeber): „Spiel starten"
4. Abwechselnd: wer laut Anzeige schießt, wischt den Ball nach vorne/links/rechts; wer hält, wischt den Torwart in die vermutete Richtung
5. Nach 10 Schüssen (bzw. Sudden Death) zeigt der Sieg-Screen das Endergebnis

## Akzeptierte Limitierungen

- Firebase-Security-Rules sind aus diesem Repo nicht einsehbar – echter Schutz hängt an den Regeln in der Firebase-Konsole, nicht am Code hier.
- Die Sichtbarkeitseinstellung einer Kachel in der ToolsUebersicht versteckt nur den Dashboard-Link, kein echter Zugriffsschutz auf die Seiten selbst.
- Der Admin-Only-Kartenbutton ist ein UI-Gate: Die Firebase-Config ist öffentlich im Repo, wer die Konsole öffnet, kann Kartenänderungen weiterhin direkt aufrufen. Der Button verbirgt den Weg nur für normale Nutzer:innen.
- Elfmeterschießen: Das gegnerische Ziel wird nur clientseitig vor der eigenen Entscheidung verborgen, nicht per Firebase-Regel erzwungen (gleiche Kategorie Limitierung wie oben).
