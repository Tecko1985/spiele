/* ==========================================================================
   Depot-Duell — Meldungskatalog
   ==========================================================================

   Die Nachrichten sind nicht Zierrat, sondern der einzige Hebel, mit dem
   Können statt Glück über den Sieg entscheidet: bei fünf Jahren Zeitraffer
   wäre eine reine Zufallskurve ein Würfelspiel. Wer die Meldung liest und
   handelt, fährt den Großteil der Bewegung mit.

   DESHALB: Die Meldung erscheint ZUERST, der Kurs wandert danach über
   mehrere Ticks (`dauer`). Ein sofortiger Sprung wäre realistischer — an
   echten Börsen ist alles sofort eingepreist — aber spielerisch tot.

   Jede Vorlage trägt ihre Wirkung fest im Bauch. Damit ist die Partie
   austarierbar und über ein Testskript nachrechenbar; eine erzeugende KI
   könnte den Text schreiben, aber nicht die Balance halten.

   ZIELARTEN:
     wert   — trifft genau einen Wert
     gruppe — trifft eine ganze Sektorgruppe (siehe GRUPPE_VON unten)
     markt  — trifft alles

   Ein Teil der Meldungen sind Gerüchte (`geruecht: true`). Sie wirken sofort,
   lösen sich aber später auf: bestätigt (Wirkung bleibt und verstärkt sich)
   oder dementiert (Wirkung dreht sich um). Ohne sie wäre jede Nachricht eine
   sichere Bank und das Spiel eine Reaktionsübung.
   ========================================================================== */

const nachrichten = (function () {
  'use strict';

  /* ----------------------------------------------------------------------
     Sektorgruppen

     Die echten Sektoren sind sehr ungleich besetzt: Halbleiter 14 Werte,
     Banken 13 — aber Telekom, Medien, Rüstung und Immobilien je nur einer.
     Eine Sektor-Nachricht würde damit mal 14 Depotpositionen bewegen und mal
     eine einzige; die Wirkung wäre reine Glückssache. Deshalb werden sie zu
     acht ähnlich großen Gruppen zusammengefasst.
     ---------------------------------------------------------------------- */
  const GRUPPE_VON = {
    Technologie: 'tech', Halbleiter: 'tech',
    Banken: 'finanz', Versicherung: 'finanz', Finanzen: 'finanz',
    Industrie: 'industrie', Automobil: 'industrie', Luftfahrt: 'industrie',
    Ruestung: 'industrie', Bau: 'industrie', Logistik: 'industrie',
    Pharma: 'gesundheit', Gesundheit: 'gesundheit',
    Konsum: 'konsum', Handel: 'konsum', Nahrung: 'konsum',
    Luxus: 'konsum', Medien: 'konsum',
    Energie: 'energie', Versorger: 'energie', Chemie: 'energie',
    Immobilien: 'immobilien',
    Krypto: 'krypto',
  };

  const GRUPPEN_NAME = {
    tech: 'Technologiewerte',
    finanz: 'Finanzwerte',
    industrie: 'Industriewerte',
    gesundheit: 'Gesundheitswerte',
    konsum: 'Konsumwerte',
    energie: 'Energiewerte',
    immobilien: 'Immobilienwerte',
    krypto: 'Kryptowährungen',
  };

  /* Alles, was keiner Gruppe zugeordnet ist (ETF-Bereiche wie "USA breit"),
     landet in einer Sammelgruppe statt undefined zu werden — sonst bekämen
     ETFs nie eine Gruppennachricht ab. */
  function gruppeVon(wert) {
    if (wert.art === 'krypto') return 'krypto';
    if (wert.art === 'etf') return 'breit';
    return GRUPPE_VON[wert.sektor] || 'breit';
  }

  /* ----------------------------------------------------------------------
     Wirkungsstärken

     Angegeben als Kursbewegung über die gesamte Wirkdauer. 0.08 heißt: der
     Kurs läuft um rund 8 % in die genannte Richtung, verteilt über `dauer`
     Ticks. Das kommt ZUSÄTZLICH zur normalen Schwankung.
     ---------------------------------------------------------------------- */
  const STAERKE = { klein: 0.05, mittel: 0.11, gross: 0.2, riesig: 0.34 };

  /* ----------------------------------------------------------------------
     Vorlagen

     {name} wird durch den Namen des betroffenen Werts ersetzt,
     {gruppe} durch den Gruppennamen.

     gewinn: wie stark der Gewinn je Aktie mitwandert. Das ist der Grund,
     warum das KGV im Spiel eine echte Kennzahl bleibt und nicht Deko wird —
     eine Gewinnwarnung hebt das KGV, ein Rekordquartal senkt es. Nur bei
     Meldungen sinnvoll, die wirklich das Geschäft betreffen: eine
     Übernahmefantasie bewegt den Kurs, nicht den Gewinn.
     ---------------------------------------------------------------------- */
  const VORLAGEN = [
    /* --- Einzelwert, gut --- */
    { t: '{name} meldet Rekordquartal — Gewinn über den Erwartungen', z: 'wert', r: 1, s: 'gross', g: 0.14 },
    { t: '{name} hebt die Jahresprognose an', z: 'wert', r: 1, s: 'mittel', g: 0.09 },
    { t: 'Großauftrag für {name} — Auftragsbuch so voll wie nie', z: 'wert', r: 1, s: 'gross', g: 0.1 },
    { t: '{name} kündigt Aktienrückkauf an', z: 'wert', r: 1, s: 'mittel', g: 0 },
    { t: '{name} erhöht die Dividende deutlich', z: 'wert', r: 1, s: 'klein', g: 0.03 },
    { t: 'Analysten stufen {name} hoch — Kursziel angehoben', z: 'wert', r: 1, s: 'klein', g: 0 },
    { t: '{name} gewinnt Marktanteile im Kerngeschäft', z: 'wert', r: 1, s: 'mittel', g: 0.07 },
    { t: 'Durchbruch in der Forschung bei {name}', z: 'wert', r: 1, s: 'gross', g: 0.06 },
    { t: '{name} steigt in einen bedeutenden Leitindex auf', z: 'wert', r: 1, s: 'mittel', g: 0 },
    { t: 'Neuer Vorstand bei {name} — Anleger reagieren erleichtert', z: 'wert', r: 1, s: 'klein', g: 0 },
    { t: '{name} verkauft die verlustreiche Sparte', z: 'wert', r: 1, s: 'mittel', g: 0.12 },
    { t: 'Patentstreit endet zugunsten von {name}', z: 'wert', r: 1, s: 'mittel', g: 0.05 },

    /* --- Einzelwert, schlecht --- */
    { t: 'Gewinnwarnung bei {name} — Prognose kassiert', z: 'wert', r: -1, s: 'gross', g: -0.18 },
    { t: '{name} verfehlt die Erwartungen deutlich', z: 'wert', r: -1, s: 'mittel', g: -0.12 },
    { t: '{name} ruft Millionen Geräte zurück', z: 'wert', r: -1, s: 'gross', g: -0.09 },
    { t: 'Bilanzskandal bei {name} — Aufsicht ermittelt', z: 'wert', r: -1, s: 'riesig', g: -0.2 },
    { t: '{name} streicht die Dividende', z: 'wert', r: -1, s: 'gross', g: -0.05 },
    { t: 'Analysten stufen {name} ab', z: 'wert', r: -1, s: 'klein', g: 0 },
    { t: 'Produktionsstopp bei {name} nach Störfall', z: 'wert', r: -1, s: 'mittel', g: -0.07 },
    { t: '{name} verliert Großkunden an die Konkurrenz', z: 'wert', r: -1, s: 'mittel', g: -0.1 },
    { t: 'Kartellamt verhängt Millionenstrafe gegen {name}', z: 'wert', r: -1, s: 'mittel', g: -0.06 },
    { t: 'Cyberangriff legt Systeme von {name} lahm', z: 'wert', r: -1, s: 'mittel', g: -0.04 },
    { t: '{name} muss Werke schließen — Tausende Stellen betroffen', z: 'wert', r: -1, s: 'gross', g: -0.08 },
    { t: 'Lieferkette von {name} bricht zusammen', z: 'wert', r: -1, s: 'mittel', g: -0.09 },

    /* --- Gerüchte: wirken sofort, lösen sich später auf --- */
    { t: 'Marktgerüchte um eine Übernahme bei {name}', z: 'wert', r: 1, s: 'gross', g: 0, ger: true },
    { t: 'Gerücht: {name} soll vor einem Milliardenauftrag stehen', z: 'wert', r: 1, s: 'mittel', g: 0, ger: true },
    { t: 'Unbestätigte Berichte über Liquiditätsprobleme bei {name}', z: 'wert', r: -1, s: 'gross', g: 0, ger: true },
    { t: 'Insider wollen von einer Klagewelle gegen {name} wissen', z: 'wert', r: -1, s: 'mittel', g: 0, ger: true },
    { t: 'Spekulationen über einen Einstieg bei {name}', z: 'wert', r: 1, s: 'mittel', g: 0, ger: true },
    { t: 'Unruhe um {name}: Vorstand soll vor dem Rücktritt stehen', z: 'wert', r: -1, s: 'mittel', g: 0, ger: true },

    /* --- Gruppe --- */
    { t: 'Leitzins steigt — {gruppe} unter Druck', z: 'gruppe', r: -1, s: 'mittel', g: -0.04 },
    { t: 'Zinssenkung beflügelt {gruppe}', z: 'gruppe', r: 1, s: 'mittel', g: 0.04 },
    { t: 'Neue Regulierung trifft {gruppe} hart', z: 'gruppe', r: -1, s: 'mittel', g: -0.06 },
    { t: 'Staatliches Förderprogramm für {gruppe} beschlossen', z: 'gruppe', r: 1, s: 'gross', g: 0.08 },
    { t: 'Rohstoffpreise ziehen an — {gruppe} verlieren Marge', z: 'gruppe', r: -1, s: 'klein', g: -0.05 },
    { t: 'Starke Quartalszahlen der Branche heben {gruppe}', z: 'gruppe', r: 1, s: 'mittel', g: 0.07 },
    { t: 'Handelsstreit eskaliert — {gruppe} besonders betroffen', z: 'gruppe', r: -1, s: 'gross', g: -0.07 },
    { t: 'Nachfrageboom bei {gruppe} hält an', z: 'gruppe', r: 1, s: 'gross', g: 0.1 },
    { t: 'Warnung vor Überbewertung bei {gruppe}', z: 'gruppe', r: -1, s: 'mittel', g: 0 },
    { t: 'Große Fonds schichten in {gruppe} um', z: 'gruppe', r: 1, s: 'klein', g: 0 },
    { t: 'Streik legt Teile der Branche lahm — {gruppe} schwach', z: 'gruppe', r: -1, s: 'klein', g: -0.03 },
    { t: 'Technologiesprung verändert die Aussichten für {gruppe}', z: 'gruppe', r: 1, s: 'mittel', g: 0.05 },

    /* --- Gesamtmarkt --- */
    { t: 'Konjunkturdaten überraschen positiv — Kurse ziehen an', z: 'markt', r: 1, s: 'mittel', g: 0.04 },
    { t: 'Rezessionsangst geht um — breiter Ausverkauf', z: 'markt', r: -1, s: 'gross', g: -0.06 },
    { t: 'Notenbank stützt die Märkte', z: 'markt', r: 1, s: 'gross', g: 0 },
    { t: 'Inflation zieht kräftig an — Anleger werden nervös', z: 'markt', r: -1, s: 'mittel', g: -0.03 },
    { t: 'Geopolitische Krise verunsichert die Börsen', z: 'markt', r: -1, s: 'gross', g: -0.04 },
    { t: 'Entspannung im Handelskonflikt — Erleichterung an den Märkten', z: 'markt', r: 1, s: 'mittel', g: 0.03 },
    { t: 'Rekordstände: Anleger greifen auf breiter Front zu', z: 'markt', r: 1, s: 'mittel', g: 0 },
    { t: 'Crash-Warnung eines bekannten Investors sorgt für Abgaben', z: 'markt', r: -1, s: 'mittel', g: 0 },

    /* --- Krypto (eigene Sprache, eigene Wucht) --- */
    { t: 'Große Börse listet {name} neu', z: 'wert', r: 1, s: 'riesig', g: 0, nur: 'krypto' },
    { t: 'Aufsichtsbehörde geht gegen {name} vor', z: 'wert', r: -1, s: 'riesig', g: 0, nur: 'krypto' },
    { t: 'Wal-Adresse bewegt Milliarden in {name}', z: 'wert', r: 1, s: 'gross', g: 0, nur: 'krypto' },
    { t: 'Netzwerk von {name} nach Angriff stundenlang gestört', z: 'wert', r: -1, s: 'gross', g: 0, nur: 'krypto' },
    { t: 'Großkonzern nimmt {name} als Zahlungsmittel an', z: 'wert', r: 1, s: 'gross', g: 0, nur: 'krypto' },
    { t: 'Ein Land verbietet den Handel mit {name}', z: 'wert', r: -1, s: 'gross', g: 0, nur: 'krypto' },
  ];

  /* Auflösungstexte für Gerüchte. */
  const AUFLOESUNG_JA = [
    'Bestätigt: {kurz}',
    'Amtlich — die Berichte über {name} treffen zu',
    'Offiziell bestätigt, was über {name} kursierte',
  ];
  const AUFLOESUNG_NEIN = [
    'Dementi: Die Berichte über {name} sind haltlos',
    '{name} widerspricht den Gerüchten deutlich',
    'Nichts dran — die Spekulation um {name} löst sich auf',
  ];

  /* ----------------------------------------------------------------------
     Planung

     Erzeugt aus der Saat den kompletten Nachrichtenverlauf einer Partie.
     Deterministisch: derselbe Zufallsgeber in derselben Reihenfolge liefert
     auf jedem Gerät dieselbe Liste. Nichts davon wird je übertragen.
     ---------------------------------------------------------------------- */

  const WIRKDAUER = 10;       // Ticks, über die eine Meldung den Kurs schiebt
  const ABSTAND_MIN = 3;      // frühestens so viele Ticks bis zur nächsten
  const ABSTAND_MAX = 9;
  const GERUECHT_FRIST = 22;  // nach so vielen Ticks löst sich ein Gerücht auf

  function plane(rng, werte, ticks) {
    const liste = [];
    const gruppen = {};
    for (const w of werte) {
      const g = gruppeVon(w);
      if (!gruppen[g]) gruppen[g] = [];
      gruppen[g].push(w);
    }
    const gruppenNamen = Object.keys(gruppen);

    /* Die erste Meldung kommt bewusst nicht sofort: die ersten Ticks gehören
       dem ersten Kauf, sonst verpasst jeder die Eröffnung. */
    let tick = 6;

    /* Vorlagen nach Zielart vorsortieren. Wählte man blind aus dem ganzen
       Katalog, entschiede dessen Zusammensetzung über die Mischung — gemessen
       kamen so 29 Einzelwert- gegen nur 6 Gruppenmeldungen heraus. Bei 141
       Werten trifft eine Einzelmeldung aber kaum je ein Depot, und die
       Meldung verpufft. Gruppen- und Marktmeldungen treffen dagegen fast
       jeden, und genau darum geht es: alle lesen dieselbe Schlagzeile und
       handeln gleichzeitig. */
    const nachZiel = { wert: [], gruppe: [], markt: [] };
    for (const v of VORLAGEN) nachZiel[v.z].push(v);
    const MISCHUNG = [
      { art: 'wert', anteil: 0.45 },
      { art: 'gruppe', anteil: 0.35 },
      { art: 'markt', anteil: 0.2 },
    ];

    while (tick < ticks - WIRKDAUER) {
      const wurf = rng();
      let summe = 0;
      let topf = nachZiel.wert;
      for (const m of MISCHUNG) {
        summe += m.anteil;
        if (wurf < summe) { topf = nachZiel[m.art]; break; }
      }
      const v = topf[Math.floor(rng() * topf.length)];

      let ziel = null;
      let text = v.t;

      if (v.z === 'wert') {
        let auswahl = werte;
        if (v.nur === 'krypto') auswahl = gruppen.krypto || [];
        else auswahl = werte.filter((w) => w.art !== 'krypto');
        if (!auswahl.length) { tick += ABSTAND_MIN; continue; }
        ziel = auswahl[Math.floor(rng() * auswahl.length)];
        text = text.replace('{name}', ziel.name);
      } else if (v.z === 'gruppe') {
        const g = gruppenNamen[Math.floor(rng() * gruppenNamen.length)];
        ziel = g;
        text = text.replace('{gruppe}', GRUPPEN_NAME[g] || 'breite Marktwerte');
      }

      const eintrag = {
        tick: tick,
        text: text,
        zielArt: v.z,
        ziel: v.z === 'wert' ? ziel.id : ziel,
        zielName: v.z === 'wert' ? ziel.name : GRUPPEN_NAME[ziel] || null,
        richtung: v.r,
        staerke: STAERKE[v.s],
        gewinn: v.g || 0,
        dauer: WIRKDAUER,
        geruecht: !!v.ger,
      };
      liste.push(eintrag);

      /* Auflösung eines Gerüchts. Bestätigung verstärkt die ursprüngliche
         Richtung, ein Dementi dreht sie um — und zwar stärker als die
         ursprüngliche Bewegung, sonst bliebe unterm Strich ein Gewinn und
         das Gerücht wäre risikolos. */
      if (v.ger) {
        const bestaetigt = rng() < 0.5;
        const aufTick = tick + GERUECHT_FRIST;
        if (aufTick < ticks - 2) {
          const muster = bestaetigt
            ? AUFLOESUNG_JA[Math.floor(rng() * AUFLOESUNG_JA.length)]
            : AUFLOESUNG_NEIN[Math.floor(rng() * AUFLOESUNG_NEIN.length)];
          liste.push({
            tick: aufTick,
            text: muster.replace('{name}', eintrag.zielName).replace('{kurz}', eintrag.text),
            zielArt: 'wert',
            ziel: eintrag.ziel,
            zielName: eintrag.zielName,
            richtung: bestaetigt ? v.r : -v.r,
            staerke: bestaetigt ? STAERKE[v.s] * 0.7 : STAERKE[v.s] * 1.45,
            gewinn: 0,
            dauer: 6,
            geruecht: false,
            aufloesung: bestaetigt ? 'bestaetigt' : 'dementiert',
          });
        }
      }

      tick += ABSTAND_MIN + Math.floor(rng() * (ABSTAND_MAX - ABSTAND_MIN + 1));
    }

    liste.sort((a, b) => a.tick - b.tick);
    return liste;
  }

  return {
    plane: plane,
    gruppeVon: gruppeVon,
    GRUPPEN_NAME: GRUPPEN_NAME,
    anzahlVorlagen: VORLAGEN.length,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = nachrichten;
