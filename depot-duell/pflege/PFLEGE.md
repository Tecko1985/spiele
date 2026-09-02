# Depot-Duell: Kurse pflegen

Einmal die Woche, wenn Zeit ist. Der ganze Lauf dauert etwa fünf Minuten, das
meiste davon sind die 250 Abrufe und die beiden Prüfskripte.

Diese Datei ist die Anleitung dahinter. Ausgelöst wird sie über eine Routine —
deren Prompt steht ganz unten und verweist hierher, damit es nur **eine**
Wahrheit gibt.

## Was hier NICHT passieren darf

Diese vier Punkte sind der Grund, warum es die Routine gibt. Wer sie einhält,
kann beim Rest wenig falsch machen.

1. **Keine halbe Datei.** `baue-werte.js` und `hole-kurse.js` brechen ab und
   lassen ihr Ziel unberührt, wenn ein Kurs fehlt. Diese Eigenschaft ist kein
   Beiwerk, sondern der Schutz davor, dass die App mit einem Nullkurs startet
   und der Kursmotor bei der ersten Division auseinanderfliegt. **Nie einen
   Abbruch mit einem Platzhalter umgehen.**
2. **Nichts schätzen.** Fehlt eine Kennzahl (KGV, Dividendenrendite, TER),
   bleibt sie `null` und die App zeigt einen Strich. Das ist der gewollte
   Zustand, kein Mangel — beim Lauf am 2026-08-08 traf es 9 von 188 Aktien.
   Eine plausibel aussehende erfundene Zahl ist schlimmer als ein Strich,
   weil man ihr nicht ansieht, dass sie erfunden ist.
3. **Das Datum zieht mit.** `STAND` steht in `werte.js` und erscheint in der
   App unter „Die Werte sind echt" und in der Quellenangabe.
   `hole-kurse.js --schreiben` setzt es selbst auf das Tagesdatum.
4. **Kurse ändern nur die Startwerte.** Ein Kursverlauf entsteht aus der Saat
   des Raums, nicht aus einer Übertragung — wer gerade spielt, merkt von der
   Pflege nichts. ⚠️ Eine Einschränkung, die man kennen muss: Wer **mitten in
   einer laufenden Partie neu lädt**, bekommt die neue `werte.js` und rechnet
   ab da eine andere Welt als seine Mitspieler. Deshalb die Pflege nicht
   starten, während jemand spielt — sonntagvormittags ist es sicher.

## 1. Lage prüfen

```bash
git -C E:\spiele status --short
```

Es laufen Parallelsitzungen auf denselben Repos. Fremde uncommittete
Änderungen dürfen nicht mitcommittet werden. Branch ist **`main`**.

Der aktuelle Stand steht im Kopf von `werte.js` und in `pflege/baue-werte.js`
als `const STAND`.

## 2. Kurse holen (Trockenlauf zuerst)

```bash
node E:\spiele\depot-duell\pflege\hole-kurse.js
```

Ohne `--schreiben` wird nichts angefasst. Das Skript ruft je Wert seine
Quelle ab — der Pfad steht in der letzten Spalte jeder Tabellenzeile:

| Quelle in der Tabelle | Was dahinter steckt |
|---|---|
| `stocks/nvda` | Aktie an einer US-Börse |
| `quote/etr/SAP` | Auslandsbörse: `etr` Xetra, `epa` Paris, `ams` Amsterdam, `bit` Mailand, `bme` Madrid, `ebr` Brüssel, `lon` London, `swx` Zürich, `tyo` Tokio, `tsx` Toronto, `krx` Seoul, `hkg` Hongkong |
| `etf/voo` | ETF |
| `coingecko/bitcoin` | Kryptowährung |

Alles bei stockanalysis.com hängt an derselben Datenstruktur unter
`<pfad>/__data.json`; Krypto kommt von CoinGecko direkt in Euro, die
Wechselkurse in einem Abruf von frankfurter.dev (EZB).

**Der Bericht ist zum Lesen da, nicht zum Wegklicken:**

- **Die größten Kursbewegungen.** Über eine Woche sind zweistellige
  Bewegungen normal. **Alles jenseits von etwa 50 % ist ein Verdachtsfall**
  und will angesehen werden: meist ein Aktiensplit oder ein Kürzel, das die
  Quelle inzwischen jemand anderem gegeben hat. Beim Umstellen von SK hynix
  auf die Heimatbörse stand dort einmal `+990633 %` — das war korrekt (USD
  auf KRW), sah aber genauso aus wie ein Fehler. **Hinsehen, nicht raten.**
- **Hinweise.** „kein KGV" ist in Ordnung (siehe Punkt 2 oben). „ETF notiert
  in EUR, erwartet USD" ist es nicht — dann zeigt die Quelle ein anderes
  Papier als gemeint.
- **Abbruch.** Kommt „Seite liefert keine Daten (Kürzel falsch?)", ist die
  Quelle umgezogen. Varianten durchprobieren, ohne etwas zu schreiben:

  ```bash
  node E:\spiele\depot-duell\pflege\hole-kurse.js --pruefe quote/swx/RO quote/swx/ROG
  ```

  Dann die Quellenspalte in `pflege/baue-werte.js` berichtigen und den
  Trockenlauf wiederholen.

## 3. Schreiben und bauen

```bash
node E:\spiele\depot-duell\pflege\hole-kurse.js --schreiben
```

Trägt Kurse, KGV, Dividendenrenditen, ETF-Kennzahlen, Kryptodaten,
Wechselkurse und den neuen `STAND` in `pflege/baue-werte.js` ein.

```bash
node E:\spiele\depot-duell\pflege\baue-werte.js
```

Erzeugt `werte.js`. Die Ausgabe nennt die Zahl der Werte je Art, wie viele
ohne KGV und ohne TER dastehen und die Länderverteilung. **Die Sollzahlen
sind fest** (`SOLL_AKTIEN`, `SOLL_ETF`, `SOLL_KRYPTO`) — weicht die Zahl ab,
bricht es ab. Das ist Absicht: Die Mischung der drei Arten ist Balance, und
markt.js gibt ihnen sehr verschiedene Schwankungsprofile.

## 4. Prüfen

Beide, immer, in dieser Reihenfolge:

```bash
node E:\spiele\depot-duell\pflege\pruefe-markt.js
```

```bash
node E:\spiele\depot-duell\pflege\pruefe-spiel.js
```

Erwartet wird jeweils **ALLES GRÜN**. Zwei Abschnitte lohnen einen Blick,
auch wenn sie grün sind:

- **Balance über 300 Partien** — Aktien-Median um +40 %, Krypto deutlich
  darüber, ETFs darunter. Wandert der Krypto-Median ins Minus, ist etwas mit
  den Kryptokursen faul.
- **Rundensprünge** — eine Aktie soll im Median unter 12 % je Runde
  springen. Deutlich mehr heißt: ein Kurs ist um eine Größenordnung falsch,
  meist eine Währung.

## 5. Live bringen

Der Rest ist der normale Weg aus `meine-app-release`; hier nur, was für
dieses Spiel besonders ist.

- **`APP_VERSION` bleibt `1.0`.** Immer.
- **Changelog:** Ein reiner Kursstand braucht **keinen** Changelog-Block —
  „die Zahlen sind eine Woche neuer" ist keine Neuerung. Kommen Werte hinzu
  oder fallen welche weg, dann schon: neuer Block **über** dem obersten in
  `depot-duell/app.js`, und wenn sich die Zahl der Werte ändert, auch die
  Kachelbeschreibung und ein Block in `E:\spiele\index.html` (der Hub nennt
  die Anzahl im Text).
- **Cache-Bust in `depot-duell/index.html`:** `werte.js?v=` **immer**, dazu
  jede weitere geänderte Datei. Abgleichen mit `git status` — jede geänderte
  Datei, die dort referenziert ist, braucht ihren eigenen Bump:

  ```bash
  git -C E:\spiele status --short
  ```

  ```bash
  grep -n "?v=" E:\spiele\depot-duell\index.html
  ```

- Committen und pushen (stehende Freigabe, nicht nachfragen). Die
  Push-Ausgabe nicht filtern.

## 6. Belegen, dass es live ist

„Gepusht" ist nicht „live" — GitHub-Pages-Builds hängen regelmäßig.

```bash
curl -s https://sc1911heiligenstadt.github.io/spiele/depot-duell/index.html | grep "werte.js?"
```

Erst wenn dort die **neue** `?v=`-Nummer steht, ist der Cache-Bust draußen.
Danach der eigentliche Beleg — die Kurse selbst:

```bash
curl -s "https://sc1911heiligenstadt.github.io/spiele/depot-duell/werte.js" | head -c 300
```

Dort muss der neue `stand` stehen. Hängt der Build:

```bash
gh api -X POST repos/sc1911heiligenstadt/spiele/pages/builds
```

## Werte hinzufügen oder entfernen

Die Zusammensetzung ist Handarbeit und bleibt es — sie ist das Spiel. Beim
Ändern der Tabellen in `pflege/baue-werte.js`:

- **Sollzahl mitziehen.** `SOLL_AKTIEN` / `SOLL_ETF` / `SOLL_KRYPTO` oben bei
  den Prüfungen, sonst bricht der Bau ab.
- **Nur bekannte Sektoren verwenden.** Ein Sektor, den `GRUPPE_VON` in
  `nachrichten.js` nicht kennt, landet stillschweigend in der Sammelgruppe
  `breit` und bekommt nie eine Branchenmeldung ab. Genau das war bis
  2026-08-08 bei `Telekom` der Fall.
- **Auf die Gruppengrößen achten.** `plane()` würfelt **gleichverteilt über
  die belegten Gruppen**, nicht gewichtet nach ihrer Größe. Eine Gruppe mit
  zwei Werten wird also genauso oft gezogen wie eine mit fünfzig — und trifft
  dann kein einziges Depot. Nach einer Änderung nachzählen:

  ```bash
  cd E:/spiele/depot-duell && node -e "const fs=require('fs');const W=new Function(fs.readFileSync('werte.js','utf8')+';return WERTE;')();const nachrichten=new Function(fs.readFileSync('nachrichten.js','utf8')+';return nachrichten;')();const z={};W.werte.forEach(w=>{const g=nachrichten.gruppeVon(w);z[g]=(z[g]||0)+1});console.log(z)"
  ```

- **Keine Coins unter etwa einem Cent.** `kursText()` in `bildschirme.js`
  zeigt Kurse unter einem Euro mit vier Nachkommastellen — Shiba Inu
  (0,0000041 EUR) stünde in der ganzen App als „0,0000 €".
- **Ein Unternehmen nur einmal.** Novartis als US-Schein `NVS` und als
  `swx/NOVN` wären zwei Zeilen mit verschiedenen Kürzeln, ein Unternehmen und
  zwei Positionen im selben Depot. `baue-werte.js` prüft deshalb auf doppelte
  Namen und doppelte Quellen.
- **Länder im Blick behalten.** Die Ausgabe von `baue-werte.js` nennt die
  Verteilung. Ein Land mit einem einzigen Wert ist für eine Ländermeldung so
  gut wie nicht vorhanden.

## Was NICHT zu dieser Routine gehört

Änderungen an `markt.js` — dort ist **die Reihenfolge der Zufallsaufrufe das
Ergebnis**. Wer eine Zeile einfügt, die den Zufallsgeber anzapft, verschiebt
alles danach, und zwei Geräte mit unterschiedlichem Stand sehen verschiedene
Kurse, ohne dass etwas nach einem Fehler aussieht. Das ist ein eigener
Vorgang mit eigener Sorgfalt, keine Pflegerunde.

---

## Der Prompt für die Routine

Das ist der Text, der in der Routine hinterlegt ist. Er bleibt bewusst kurz
und verweist auf diese Datei — sonst gäbe es zwei Fassungen der Anleitung,
die auseinanderlaufen.

```text
Pflegerunde für Depot-Duell: die Kurse und Kennzahlen aller 250 Werte auf
den heutigen Stand bringen und live stellen.

Arbeite in E:\spiele (Branch main). Lies zuerst
E:\spiele\depot-duell\pflege\PFLEGE.md und halte dich an den dortigen
Ablauf — die Datei ist die Wahrheit, dieser Text nur der Auslöser.

Kurzfassung des Ablaufs:
1. git status prüfen (Parallelsitzungen! fremde Änderungen nicht
   mitcommitten)
2. node pflege/hole-kurse.js            (Trockenlauf, Bericht lesen)
3. node pflege/hole-kurse.js --schreiben
4. node pflege/baue-werte.js
5. node pflege/pruefe-markt.js und node pflege/pruefe-spiel.js
   — beide müssen ALLES GRÜN melden
6. werte.js?v= in depot-duell/index.html bumpen, committen, pushen
7. gegen die Live-URL belegen, dass der neue stand ausgeliefert wird

Vier Dinge sind nicht verhandelbar:
- Bricht ein Skript ab, ist das die Schutzfunktion. NICHT umgehen, nichts
  von Hand nachtragen, nicht pushen — melden, was fehlt, und aufhören.
- Nichts schätzen. Eine fehlende Kennzahl bleibt null, die App zeigt einen
  Strich. Das ist gewollt.
- Ein reiner Kursstand bekommt KEINEN Changelog-Block und APP_VERSION
  bleibt 1.0. Nur wenn Werte hinzukommen oder wegfallen, ein neuer Block.
- Nicht laufen lassen, während jemand spielt: wer mitten in einer Partie
  neu lädt, bekommt die neue werte.js und rechnet ab da eine andere Welt
  als seine Mitspieler.

Melde am Ende in drei, vier Sätzen: Stand vorher/nachher, die größten
Kursbewegungen, ob beide Prüfskripte grün waren, und die Live-URL mit dem
belegten neuen Stand. Bei einem Abbruch stattdessen: woran es lag und was
zu tun ist.
```
