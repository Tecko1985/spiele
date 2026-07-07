# Spiele (v1.0)

Kleine Spiele-Sammlung fürs Team – ideal, um auf der Busfahrt zum Auswärtsspiel ein bisschen Zeit zu überbrücken. Startet mit **Auto-Quartett**, weitere Spiele folgen.

**Live:** https://tecko1985.github.io/spiele/

## Auto-Quartett

Digitales Kartenspiel nach dem Vorbild des klassischen „Auto Quartett" (Top-Trumps-Prinzip). Bis zu 8 Spieler:innen, jede:r mit eigenem Handy.

- **Echte Mehrgeräte-Synchronisierung** über Firebase Realtime Database + anonyme Authentifizierung: ein Gerät erstellt einen Raum mit kurzem Raum-Code (ohne verwechselbare Zeichen wie 0/O/1/I), bis zu 8 Spieler:innen treten mit dem Code bei.
- **Datenschutz eigener Karten**: die geheime Hand jedes Geräts liegt in einem eigenen Datenbankpfad, den nur das eigene Gerät oder das Gastgeber-Gerät lesen kann. Das Gastgeber-Gerät fungiert als „Schiedsrichter" beim Vergleich und muss während der Partie geöffnet bleiben.
- **500 reale Fahrzeugmodelle** als Basisdeck, drei selektierbare Deckgrößen (5 Karten/Spieler:in, 10 Karten/Spieler:in, oder das komplette Kartenpool-Maximum).
- **Kartenverwaltung**: Karten (Name, Typ, Foto, einzelne Eigenschaftswerte) sowie die Kriterien-Labels/Icons frei bearbeiten — Änderungen liegen als Überschreibung über dem Basisdeck (`mock-data.js`), ganz ohne Zugangscode.
- **Bestenliste** über alle Partien hinweg, ebenfalls frei einsehbar.
- Test-Spieler zum Auffüllen der Lobby für Solo-Tests, automatischer Spielablauf bis Sieg oder Abbruch.

### Architektur

Die Spiellogik liegt komplett gekapselt in `auto-quartett/game-service.js` hinter einer async/Promise-basierten API mit Subscription-Pattern (`getZustand()`/`onZustandsAenderung()`); `auto-quartett/app.js` steuert ausschließlich Screens/Rendering/Events und redet nie direkt mit den Datenquellen.

## Lokal starten

Über das Preview-Tool dieses Workspaces (Eintrag `spiele` in `.claude/launch.json`, Port 8782). Hub unter `http://localhost:8782/`, Auto-Quartett unter `http://localhost:8782/auto-quartett/`.

## Testdurchlauf (Auto-Quartett)

1. „Raum erstellen" → eigenen Namen eingeben → Lobby
2. Über „Test-Spieler hinzufügen" auf 2–8 Spieler auffüllen
3. „Spiel starten"
4. Wenn du am Zug bist: Eigenschaft auf der eigenen Karte antippen
5. Vergleich ansehen, „Weiter" antippen, bis ein:e Spieler:in alle Karten hat

## Akzeptierte Limitierungen

- Firebase-Security-Rules sind aus diesem Repo nicht einsehbar – echter Schutz hängt an den Regeln in der Firebase-Konsole, nicht am Code hier.
- Die Sichtbarkeitseinstellung einer Kachel in der ToolsUebersicht versteckt nur den Dashboard-Link, kein echter Zugriffsschutz auf die Seiten selbst.
