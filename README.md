# 🎲 Spiele

Sammlung kleiner Spiele für Vereinsabende und Trainingspausen — mehrere Mitspieler an verschiedenen Geräten.

**➡️ [Spiele öffnen](https://sc1911heiligenstadt.github.io/spiele/)**

## Seiten

| Seite | Wofür |
|---|---|
| [Spiele](https://sc1911heiligenstadt.github.io/spiele/) | Mini-Spiele-Sammlung fürs Team: Auto-, Fußball- und Fußball-Vereine-Quartett sowie Der Maulwurf als Verräterspiel (auch solo … |
| [Auto-Quartett](https://sc1911heiligenstadt.github.io/spiele/auto-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Fußball-Quartett](https://sc1911heiligenstadt.github.io/spiele/fussball-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Fußball-Vereine-Quartett](https://sc1911heiligenstadt.github.io/spiele/fussball-vereine-quartett/) | Kartenspiel für mehrere Mitspieler |
| [Der Maulwurf](https://sc1911heiligenstadt.github.io/spiele/maulwurf/) | Ratespiel für die Gruppe |

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (nur ansehen), **Bearbeiten** (Einträge pflegen) und **Administrieren** (Einstellungen und Verwaltung). Wer welche Stufe hat, legt die Tools-Übersicht fest.

## Lokal starten

Über den Eintrag `spiele` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8782/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser. Die Live-Daten liegen in einer Firebase-Datenbank, damit mehrere Geräte denselben Stand sehen.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
