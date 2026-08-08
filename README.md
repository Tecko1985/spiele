# 🎲 Spiele

Sammlung kleiner Spiele für Vereinsabende, Trainingspausen und die Busfahrt zum Auswärtsspiel — mehrere Mitspieler an verschiedenen Geräten, ohne Login über einen Raum-Code.

**➡️ [Spiele öffnen](https://sc1911heiligenstadt.github.io/spiele/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Spiele](https://sc1911heiligenstadt.github.io/spiele/) | Die Übersicht mit allen fünf Spielen |
| [Auto-Quartett](https://sc1911heiligenstadt.github.io/spiele/auto-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Fußball-Quartett](https://sc1911heiligenstadt.github.io/spiele/fussball-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Fußball-Vereine-Quartett](https://sc1911heiligenstadt.github.io/spiele/fussball-vereine-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Der Maulwurf](https://sc1911heiligenstadt.github.io/spiele/maulwurf/) | Verräterspiel auf einer gemeinsamen Karte, für 4 bis 15 Mitspielende — auch als Verstecken-Modus |
| [Depot-Duell](https://sc1911heiligenstadt.github.io/spiele/depot-duell/) | Börsenspiel mit Spielgeld: 250 echte Werte, rundenweise, mit KI-Mitspielern |

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (nur ansehen), **Bearbeiten** (Einträge pflegen) und **Administrieren** (Einstellungen und Verwaltung). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `spiele` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8782/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages.

**Anders als die übrigen Werkzeuge nutzen die Spiele nicht die Vereins-Nextcloud**, sondern eine Firebase-Datenbank, damit mehrere Geräte denselben Stand sehen. Ein Login ist dafür nicht nötig — man tritt über einen Raum-Code bei. Nur die Kartenverwaltung der Quartetts erkennt Administratoren, und zwar über die Anmeldung in der Tools-Übersicht.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
