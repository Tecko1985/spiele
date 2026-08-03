# Spiele (v1.0)

Kleine Spiele-Sammlung fürs Team – ideal, um auf der Busfahrt zum Auswärtsspiel ein bisschen Zeit zu überbrücken. Startet mit **Auto-Quartett**, **Fußball-Quartett** und **Fußball-Vereine-Quartett**, weitere Spiele folgen.

Die Kartenverwaltung (✏️ Karten bearbeiten) ist in allen Spielen nur für Admins der [ToolsUebersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) sichtbar — kein eigenes Login hier, wer dort im selben Browser als Admin angemeldet ist, sieht den Button automatisch.

**Live:** https://sc1911heiligenstadt.github.io/spiele/

## Auto-Quartett

Digitales Kartenspiel nach dem Vorbild des klassischen „Auto Quartett" (Top-Trumps-Prinzip). Bis zu 8 Spieler:innen, jede:r mit eigenem Handy.

- **Echte Mehrgeräte-Synchronisierung** über Firebase Realtime Database + anonyme Authentifizierung: ein Gerät erstellt einen Raum mit kurzem Raum-Code (ohne verwechselbare Zeichen wie 0/O/1/I), bis zu 8 Spieler:innen treten mit dem Code bei.
- **Datenschutz eigener Karten**: die geheime Hand jedes Geräts liegt in einem eigenen Datenbankpfad, den nur das eigene Gerät oder das Gastgeber-Gerät lesen kann. Das Gastgeber-Gerät fungiert als „Schiedsrichter" beim Vergleich und muss während der Partie geöffnet bleiben.
- **500 reale Fahrzeugmodelle** als Basisdeck, drei selektierbare Deckgrößen (5 Karten/Spieler:in, 10 Karten/Spieler:in, oder das komplette Kartenpool-Maximum).
- **Kartenverwaltung** (nur für Admins sichtbar): Karten (Name, Typ, Foto, einzelne Eigenschaftswerte) sowie die Kriterien-Labels/Icons bearbeiten — Änderungen liegen als Überschreibung über dem Basisdeck (`mock-data.js`).
- **Bestenliste** über alle Partien hinweg, frei einsehbar.
- Test-Spieler zum Auffüllen der Lobby für Solo-Tests, automatischer Spielablauf bis Sieg oder Abbruch.

### Architektur

Die Spiellogik liegt komplett gekapselt in `auto-quartett/game-service.js` hinter einer async/Promise-basierten API mit Subscription-Pattern (`getZustand()`/`onZustandsAenderung()`) und redet nie direkt mit den Datenquellen.

Die **Oberfläche ist seit 2026-07-28 gemeinsam** und liegt in `quartett/` (siehe unten) — die drei Spiele haben keine eigene `app.js` und keine eigene `style.css` mehr.

## Gemeinsame Oberfläche: `quartett/`

Die drei Quartetts waren bis auf ihr Kartendeck, ihren Firebase-Namensraum und vier Textstellen byte-identisch. Seit dem Umbau auf eine Zeichenfläche teilen sie sich deshalb eine Oberfläche:

- `quartett/ui.js` — das Zeichenwerkzeug (unmittelbarer Modus): Knöpfe, Eingabefelder, Auswahllisten, Rollbereiche, Dialoge, Bildbeschnitt, Dateiauswahl. Übernommen aus `maulwurf/ui.js` und um das erweitert, was ein Kartenspiel braucht.
- `quartett/bildschirme.js` — die einzelnen Ansichten (Start, Warteraum, Spiel, Vergleich, Endstand, Bestenliste, Kartenverwaltung, Karte/Kriterien bearbeiten, Info).
- `quartett/app.js` — Zustand der Ansicht, Kopfzeile, Reiter, Kartenzeichnung, Dialoge, Admin-Prüfung. Wird **zuletzt** geladen.
- `quartett/style.css` — nur noch das Nötigste fürs Dokument (Zeichenfläche formatfüllend, versteckte Felder).

Je Spiel bleiben: `index.html`, `spiel-config.js` (Titel, Zeichen, Beschreibungen), `game-service.js` (Namensraum!), `mock-data.js` (Deck), `firebase-config.js`, `manifest.json`, `sw.js`, `icon.svg`, `logo.png`.

**Im Dokument steht nur noch** eine `<canvas>`, ein unsichtbares Eingabefeld (ohne das öffnet iOS keine Bildschirmtastatur) und ein verstecktes Dateifeld fürs Kartenfoto — eine Dateiauswahl lässt sich nicht zeichnen. `escapeHtml` ist damit entfallen: fremde Namen werden gezeichnet, nicht in Markup eingesetzt.

**Maulwurf hat bewusst seine eigene `ui.js`** und wird davon nicht berührt: es hat ein Spielfeld mit Dauerlauf, die Quartetts haben Menüs.

## Fußball-Quartett

Zweites Spiel nach exakt demselben Prinzip wie Auto-Quartett (gleicher Code-Aufbau, eigener Firebase-Namensraum `fussballQuartett/`, damit sich die beiden Spiele nicht in die Quere kommen).

- **500 reale Fußballspieler** (aktuelle Stars und Legenden) als Basisdeck, mit Position (Torwart/Verteidiger/Mittelfeld/Stürmer) statt Fahrzeugtyp.
- **Kriterien**: Marktwert, Karriere-Tore, Karriere-Vorlagen, Länderspiele, Länderspieltore, große Titel, Größe, Tempo-Wert — alle Werte sind ungefähre, gerundete Schätzwerte (wie schon beim Auto-Quartett), keine exakten, tagesaktuellen Statistiken.
- Ansonsten identisches Spielprinzip: Mehrgeräte-Synchronisierung, Kartenverwaltung, Bestenliste, Test-Spieler — siehe Auto-Quartett oben.

### Architektur

Identisch zu Auto-Quartett: `fussball-quartett/game-service.js` (Spiellogik), eigenes Basisdeck in `fussball-quartett/mock-data.js`, Oberfläche gemeinsam aus `quartett/`.

## Fußball-Vereine-Quartett

Drittes Spiel nach demselben Prinzip, mit **500 realen Fußballvereinen** aus aller Welt statt Spielern oder Autos.

- **Kriterien**: Marktwert Kader, Meistertitel, Pokaltitel, Internationale Titel, Stadion-Kapazität, Mitgliederzahl, Vereinsalter, Social-Media-Follower — ebenfalls ungefähre, gerundete Schätzwerte.
- Eigener Firebase-Namensraum `fussballVereineQuartett/`, ansonsten identisches Spielprinzip wie die anderen beiden Spiele.

### Architektur

Identisch zu Auto-Quartett: `fussball-vereine-quartett/game-service.js`, eigenes Basisdeck in `fussball-vereine-quartett/mock-data.js`, Oberfläche gemeinsam aus `quartett/`.

## Lokal starten

Über das Preview-Tool dieses Workspaces (Eintrag `spiele` in `.claude/launch.json`, Port 8782). Hub unter `http://localhost:8782/`, Auto-Quartett unter `http://localhost:8782/auto-quartett/`, Fußball-Quartett unter `http://localhost:8782/fussball-quartett/`, Fußball-Vereine-Quartett unter `http://localhost:8782/fussball-vereine-quartett/`.

## Testdurchlauf

**Kartenspiele (Auto-/Fußball-/Fußball-Vereine-Quartett):**
1. „Raum erstellen" → eigenen Namen eingeben → Lobby
2. Über „Test-Spieler hinzufügen" auf 2–8 Spieler auffüllen
3. „Spiel starten"
4. Wenn du am Zug bist: Eigenschaft auf der eigenen Karte antippen
5. Vergleich ansehen, „Weiter" antippen, bis ein:e Spieler:in alle Karten hat

## Akzeptierte Limitierungen

- Firebase-Security-Rules sind aus diesem Repo nicht einsehbar – echter Schutz hängt an den Regeln in der Firebase-Konsole, nicht am Code hier.
- Die Sichtbarkeitseinstellung einer Kachel in der ToolsUebersicht versteckt nur den Dashboard-Link, kein echter Zugriffsschutz auf die Seiten selbst.
- Der Admin-Only-Kartenbutton ist ein UI-Gate: Die Firebase-Config ist öffentlich im Repo, wer die Konsole öffnet, kann Kartenänderungen weiterhin direkt aufrufen. Der Button verbirgt den Weg nur für normale Nutzer:innen.
