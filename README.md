# 🎲 Spiele

Sammlung kleiner Spiele für Vereinsabende, Trainingspausen und die Busfahrt zum Auswärtsspiel — mehrere Mitspieler an verschiedenen Geräten, ohne Login über einen Raum-Code.

**➡️ [Spiele öffnen](https://sc1911heiligenstadt.github.io/spiele/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Spiele](https://sc1911heiligenstadt.github.io/spiele/) | Die Übersicht mit allen Spielen |
| [Auto-Quartett](https://sc1911heiligenstadt.github.io/spiele/auto-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Fußball-Quartett](https://sc1911heiligenstadt.github.io/spiele/fussball-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Fußball-Vereine-Quartett](https://sc1911heiligenstadt.github.io/spiele/fussball-vereine-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Der Maulwurf](https://sc1911heiligenstadt.github.io/spiele/maulwurf/) | Verräterspiel auf einer gemeinsamen Karte, für 4 bis 15 Mitspielende — auch als Verstecken-Modus |
| [Depot-Duell](https://sc1911heiligenstadt.github.io/spiele/depot-duell/) | Börsenspiel mit Spielgeld: 250 echte Werte, rundenweise, mit KI-Mitspielern |
| [Letzte Karte](https://sc1911heiligenstadt.github.io/spiele/letzte-karte/) | Ablegespiel (Uno-Klon) in drei Spielarten, 2 bis 10 Mitspielende |
| [Werwolf](https://sc1911heiligenstadt.github.io/spiele/werwolf/) | Die Werwölfe von Düsterwald an eigenen Handys, 5 bis 20 Mitspielende — die App ist der Erzähler |
| [Viertelmeile](https://sc1911heiligenstadt.github.io/spiele/viertelmeile/) | Drag Race quer am Handy, 2 bis 20 Fahrende — einer gegen einen, als Liga oder K.-o. |

## Nur zum Testen

Zwei Spiele bringen eine Testfassung mit, die dieselben Dateien lädt wie das
Spiel, Firebase aber durch eine Attrappe im Arbeitsspeicher ersetzt. Sie sind
für die Entwicklung gedacht, nicht für Mitspielende:

| Seite | Wofür |
|---|---|
| `letzte-karte/pflege/test-harness.html` | Letzte Karte ohne Firebase, mehrere Handys nebeneinander im selben Fenster |
| `werwolf/pflege/test-harness.html` | Werwolf-Testrahmen mit mehreren Geräten |
| `werwolf/pflege/client.html` | Ein einzelnes „Handy“ innerhalb des Werwolf-Testrahmens |

Viertelmeile hat statt eines Browser-Rahmens vier Prüfstände für Node, die
ohne Fenster laufen — Aufruf jeweils aus `viertelmeile/`:

| Aufruf | Was geprüft wird |
|---|---|
| `node pflege/pruefe-fahrt.js` | Fahrphysik: Zeiten je Auto, Bot-Stufen, fester Rechentakt, Frühstart, Burnout, was ein Fehler kostet |
| `node pflege/pruefe-turnier.js` | Paarungen und Tabelle für Liga und K.-o., 2 bis 20 Fahrende |
| `node pflege/pruefe-rennen.js` | Das Rennbild selbst: Zeitplan, Tipper, Abbruchbedingungen — mit Attrappen für Zeichenfläche und Uhr |
| `node pflege/pruefe-turnierlauf.js` | Ein ganzes Turnier über den echten `game-service.js`, mehrere Geräte auf einem Datenbaum |

Die Kurse des Depot-Duells werden über die Skripte in `depot-duell/pflege/`
aufgefrischt; die Anleitung dazu steht in `depot-duell/pflege/PFLEGE.md`.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Gespielt wird ohne Rechte-Stufen — wer die Sammlung sieht, kann jedes Spiel starten. Ob das Werkzeug überhaupt sichtbar ist, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `spiele` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8782/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages.

**Anders als die übrigen Werkzeuge nutzen die Spiele nicht die Vereins-Nextcloud**, sondern eine Firebase-Datenbank (Rechenzentrum Belgien), damit mehrere Geräte denselben Stand sehen. Ein Login ist dafür nicht nötig — man tritt über einen Raum-Code bei. Nur die Kartenverwaltung der Quartetts erkennt Administratoren, und zwar über die Anmeldung in der Tools-Übersicht.

Gespeichert werden nur der selbst gewählte Anzeigename und der Spielstand der laufenden Partie. Ergebnisse werden nicht aufgehoben — es gibt in keinem Spiel eine Bestenliste. Der Hinweis dazu steht im Info-Bereich der Sammlung und in jedem einzelnen Spiel.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
