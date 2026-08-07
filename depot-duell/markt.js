/* ==========================================================================
   Depot-Duell — Kursmotor
   ==========================================================================

   DER KERN DES SPIELS: Aus EINER Zufallszahl (der Saat) entsteht der
   komplette Verlauf einer Partie — alle Kurse, alle Meldungen, alle Züge der
   KI. Jedes Gerät rechnet ihn selbst und kommt zwangsläufig aufs selbe
   Ergebnis. Übertragen wird davon nichts.

   RUNDEN STATT UHR:
   Eine Partie hat 20, 50 oder 100 Runden. In jeder Runde erscheinen
   Meldungen, alle handeln in Ruhe, und erst wenn ALLE zugestimmt haben,
   springen die Kurse. Der Kursschritt von Runde n nach n+1 trägt genau die
   Wirkung der Meldungen aus Runde n — wer sie liest und richtig deutet,
   verdient daran. Ein Zeittakt hätte das kaputt gemacht: wer im Funkloch
   sitzt oder langsamer liest, hätte strukturell verloren.

   WARUM DER VERLAUF NICHT ÜBERTRAGEN WIRD:
   141 Werte über 100 Runden sind über 14.000 Kurswerte je Partie. Würde das
   Gerät des Eröffners sie verteilen, flösse mehr Datenverkehr als bei den
   Maulwurf-Positionen (dort gemessen: ~27 MB für zehn Minuten zu fünfzehnt)
   — und die Partie stünde still, sobald er durch ein Funkloch fährt. So
   laufen Kurse und Meldungen auf jedem Handy, auch ganz ohne Netz; nur die
   Zustimmungen und Käufe holen auf, wenn das Netz zurückkommt.

   ZWINGEND BEIM ÄNDERN BEACHTEN:
   Die Reihenfolge der Zufallsaufrufe IST das Ergebnis. Wer hier eine Zeile
   einfügt, die den Zufallsgeber anzapft, verschiebt alles danach — zwei
   Geräte mit unterschiedlichem Stand sähen dann verschiedene Kurse, ohne
   dass irgendetwas nach einem Fehler aussieht. Nach jeder Änderung den
   Bestimmtheitstest laufen lassen (pflege/pruefe-markt.js).

   Kein Math.random(). Nirgends.
   ========================================================================== */

const markt = (function () {
  'use strict';

  /* Zur Wahl stehende Partielängen. Die Rundenzahl bestimmt zugleich den
     simulierten Zeitraum — eine Runde ist immer derselbe Zeitsprung, egal
     wie lang die Partie ist. Dadurch bleiben Schwankung und Trend je Runde
     überall gleich und eine kurze Partie ist einfach ein kürzerer Ausschnitt
     derselben Welt, kein anderes Spiel. */
  const RUNDENZAHLEN = [20, 50, 100];
  const STANDARD_RUNDEN = 50;

  /* Zehn Runden sind ein Börsenjahr. Damit gilt: 20 Runden = 2 Jahre,
     50 = 5 Jahre, 100 = 10 Jahre. Der Wert steuert zwei Dinge zugleich —
     wie weit ein Kurs je Runde springen kann und wie oft Dividende fließt.
     Höher gewählt wäre eine 20-Runden-Partie ereignislos, niedriger würde
     jede einzelne Runde zum Glücksspiel. */
  const RUNDEN_JE_JAHR = 10;
  const DT = 1 / RUNDEN_JE_JAHR;   // Jahresbruchteil je Runde, konstant

  /* ----------------------------------------------------------------------
     Zufallsgeber (mulberry32)

     Klein, schnell, und aus einer 32-Bit-Saat vollständig bestimmt. Läuft in
     jeder JS-Umgebung bitgleich, weil ausschließlich ganzzahlige Operationen
     und Math.imul verwendet werden — bei Fließkomma-Tricks wäre das nicht
     garantiert.
     ---------------------------------------------------------------------- */
  function zufallsgeber(saat) {
    let a = saat >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Normalverteilte Zufallszahl (Box-Muller). Zieht IMMER genau zwei Werte
     aus dem Geber — kein Zwischenspeichern des zweiten Ergebnisses, weil ein
     Speicher die Aufrufreihenfolge vom Aufrufmuster abhängig machen würde
     und damit die Bestimmtheit bricht. */
  function normal(rng) {
    let u = rng();
    if (u < 1e-12) u = 1e-12;
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function normiereRunden(runden) {
    return RUNDENZAHLEN.indexOf(runden | 0) >= 0 ? runden | 0 : STANDARD_RUNDEN;
  }

  /* ----------------------------------------------------------------------
     Risikoprofile — Jahresschwankung und Jahrestrend

     Die Zahlen sind an der Wirklichkeit orientiert: breite Aktien-ETFs
     schwanken um die 15 %, Einzelaktien um die 30 %, Kryptowährungen um die
     80 %, Anleihen um die 6 %. Über die Partie wird daraus eine Spreizung,
     die spannend bleibt, ohne dass ein einziger Treffer alles entscheidet —
     dafür sorgt zusätzlich die 25-Prozent-Grenze je Wert.
     ---------------------------------------------------------------------- */
  /* `trend` ist bewusst der Trend der MITTLEREN Partie (Median), nicht der
     Erwartungswert. Der Unterschied ist bei diesem Kursmodell gewaltig: zieht
     man wie im Lehrbuch die halbe quadrierte Schwankung ab, landet Krypto bei
     0.12 − 0.85²/2 = −0.24 im Jahr — der Median einer Partie läge dann bei
     −74 %, gemessen im ersten Balancelauf. Krypto wäre damit ein
     systematisches Verlustgeschäft, das jeder meidet, sobald er es merkt.
     Hier steht deshalb der Trend direkt im Exponenten. */
  const PROFILE = {
    aktie: { vol: 0.3, trend: 0.07, marktBeta: 0.62 },
    etf: { vol: 0.16, trend: 0.06, marktBeta: 0.88 },
    krypto: { vol: 0.65, trend: 0.1, marktBeta: 0.25 },
  };

  /* ETFs sind untereinander sehr verschieden — ein Anleihen-ETF hat mit
     einem Halbleiter-ETF nichts gemein. Ohne diese Feinabstufung wären
     Anleihen im Spiel genauso wild wie Technologie und die Entscheidung
     "sicher oder riskant" bedeutungslos. */
  const ETF_ABWEICHUNG = {
    Anleihen: { vol: 0.07, trend: 0.03, marktBeta: 0.15 },
    Rohstoff: { vol: 0.19, trend: 0.05, marktBeta: 0.1 },
    Krypto: { vol: 0.8, trend: 0.12, marktBeta: 0.25 },
  };

  /* Einzelne Sektoren schwanken stärker als der Durchschnitt. */
  const SEKTOR_FAKTOR = {
    Halbleiter: 1.45, Technologie: 1.25, Ruestung: 1.4, Automobil: 1.15,
    Banken: 1.1, Medien: 1.15, Luxus: 1.1,
    Versorger: 0.75, Nahrung: 0.7, Konsum: 0.8, Telekom: 0.7,
    Pharma: 0.9, Gesundheit: 0.9, Immobilien: 0.95,
  };

  function profilFuer(wert) {
    const grund = PROFILE[wert.art] || PROFILE.aktie;
    let vol = grund.vol;
    let trend = grund.trend;
    let marktBeta = grund.marktBeta;

    if (wert.art === 'etf') {
      const ab = ETF_ABWEICHUNG[wert.anlageklasse];
      if (ab) { vol = ab.vol; trend = ab.trend; marktBeta = ab.marktBeta; }
      else if (wert.sektor === 'Halbleiter' || wert.sektor === 'Technologie') vol = 0.26;
      else if (wert.sektor === 'USA klein') vol = 0.22;
    } else if (wert.art === 'aktie') {
      vol *= SEKTOR_FAKTOR[wert.sektor] || 1;
    }
    return { vol: vol, trend: trend, marktBeta: marktBeta };
  }

  /* ----------------------------------------------------------------------
     Der Lauf
     ---------------------------------------------------------------------- */

  /**
   * Rechnet eine komplette Partie aus.
   * @param {number} saat   Zufallszahl des Raums
   * @param {Array}  werte  Liste aus werte.js
   * @param {number} runden 20, 50 oder 100
   * @returns {object} Lauf mit Kursen, Kennzahlen und Meldungen
   */
  function erzeuge(saat, werte, runden) {
    const R = normiereRunden(runden);
    const rng = zufallsgeber(saat);

    /* SCHRITT 1: Meldungen planen — VOR den Kursen, weil sie die Kurse
       schieben. Verschiebt man die Reihenfolge, ändert sich alles. */
    const meldungen = nachrichten.plane(rng, werte, R);

    /* SCHRITT 2: gemeinsame Marktbewegung. Ein einziger Pfad, an dem alle
       Werte je nach ihrem Beta hängen. Ohne ihn liefe jeder Wert für sich
       und es gäbe nie eine Runde, in der "alles rot" ist — genau die Runden
       machen aber die Stimmung im Bus aus. */
    const marktSchritte = new Float64Array(R + 1);
    for (let t = 1; t <= R; t++) marktSchritte[t] = normal(rng);

    /* SCHRITT 3: Gruppenbewegung je Sektorgruppe. */
    const gruppenListe = [];
    const gruppeIndex = {};
    for (const w of werte) {
      const g = nachrichten.gruppeVon(w);
      if (!(g in gruppeIndex)) { gruppeIndex[g] = gruppenListe.length; gruppenListe.push(g); }
    }
    const gruppenSchritte = [];
    for (let i = 0; i < gruppenListe.length; i++) {
      const reihe = new Float64Array(R + 1);
      for (let t = 1; t <= R; t++) reihe[t] = normal(rng);
      gruppenSchritte.push(reihe);
    }

    /* SCHRITT 4: Meldungswirkung je Wert und Runde einsammeln.

       ENTSCHEIDEND: Eine Meldung aus Runde `r` wirkt auf den Kursschritt
       `r -> r+1`, also auf den Sprung NACH der Runde, in der sie zu lesen
       war. Genau daraus entsteht das Spiel: die Schlagzeile liegt offen auf
       dem Tisch, jeder darf in Ruhe entscheiden, und erst mit der
       Rundenfreigabe zeigt sich, wer richtig lag. */
    const schub = {};      // wertId -> Float64Array(R+1)
    const gewinnSchub = {};
    const profile = {};
    for (const w of werte) {
      schub[w.id] = new Float64Array(R + 1);
      gewinnSchub[w.id] = new Float64Array(R + 1);
      profile[w.id] = profilFuer(w);   // verbraucht keinen Zufall
    }

    for (const m of meldungen) {
      let betroffen;
      if (m.zielArt === 'wert') betroffen = werte.filter((w) => w.id === m.ziel);
      else if (m.zielArt === 'gruppe') betroffen = werte.filter((w) => nachrichten.gruppeVon(w) === m.ziel);
      else betroffen = werte;

      /* Logarithmisch aufteilen: die Teilschritte multiplizieren sich zur
         angekündigten Gesamtbewegung auf. Bei linearer Aufteilung käme bei
         großen Bewegungen spürbar etwas anderes heraus als angegeben. */
      const gesamt = Math.log(1 + m.richtung * m.staerke);
      const jeRunde = gesamt / m.dauer;
      const gewinnJeRunde = m.gewinn ? Math.log(1 + m.gewinn) / m.dauer : 0;

      for (const w of betroffen) {
        /* Kryptowährungen ziehen bei allgemeinen Marktmeldungen nur
           abgeschwächt mit — sie folgen ihrer eigenen Logik. */
        let daempfung = m.zielArt === 'markt' && w.art === 'krypto' ? 0.35 : 1;

        /* Eine Meldung trifft nicht jeden Wert gleich hart. Ohne diese
           Abstufung riss eine Rezessionsmeldung einen Anleihen-ETF genauso
           mit wie eine Halbleiteraktie — gemessen kam der ruhigste Wert des
           Spiels damit auf 164 Punkte Spanne und die Entscheidung zwischen
           sicher und riskant war bedeutungslos. Maßstab ist die eigene
           Schwankungsbreite im Verhältnis zur normalen Aktie. */
        daempfung *= Math.min(1.5, profile[w.id].vol / 0.3);
        for (let d = 0; d < m.dauer; d++) {
          const t = m.runde + 1 + d;      // +1: der Sprung NACH der Meldung
          if (t > R) break;
          schub[w.id][t] += jeRunde * daempfung;
          gewinnSchub[w.id][t] += gewinnJeRunde * daempfung;
        }
      }
    }

    /* SCHRITT 5: Kurse rechnen. */
    const kurse = {};
    const gewinne = {};   // Gewinn je Aktie, laesst das KGV mitwandern

    for (const w of werte) {
      const p = profile[w.id];

      const reihe = new Float64Array(R + 1);
      const gReihe = new Float64Array(R + 1);
      reihe[0] = w.kurs;
      gReihe[0] = w.gewinnJeAktie || 0;

      /* Eigenanteil so bemessen, dass Markt-, Gruppen- und Eigenanteil
         zusammen wieder die gewünschte Gesamtschwankung ergeben. Ohne diese
         Normierung wäre jeder Wert umso wilder, je mehr Faktoren mitwirken. */
      const bM = p.marktBeta;
      const bG = w.art === 'krypto' ? 0.5 : 0.42;
      const restQuadrat = 1 - bM * bM - bG * bG;
      const bE = Math.sqrt(Math.max(0.04, restQuadrat));

      const gIdx = gruppeIndex[nachrichten.gruppeVon(w)];
      const sigma = p.vol * Math.sqrt(DT);
      const mu = p.trend * DT;   // Median-Trend, siehe Kommentar bei PROFILE

      for (let t = 1; t <= R; t++) {
        const z = bM * marktSchritte[t] + bG * gruppenSchritte[gIdx][t] + bE * normal(rng);
        reihe[t] = reihe[t - 1] * Math.exp(mu + sigma * z + schub[w.id][t]);

        /* Ein Kurs, der praktisch auf null fällt, macht jede
           Prozentrechnung unbrauchbar und sieht wie ein Fehler aus.
           Unter einem Tausendstel des Startkurses wird abgefangen. */
        const boden = w.kurs * 0.001;
        if (reihe[t] < boden) reihe[t] = boden;

        gReihe[t] = gReihe[t - 1] * Math.exp(gewinnSchub[w.id][t]);
      }

      kurse[w.id] = reihe;
      gewinne[w.id] = gReihe;
    }

    /* Meldungen nach Runde vorsortiert bereitlegen. Der Block über der
       Oberfläche fragt sie bei jedem Bild ab — ohne Register liefe dafür
       jedes Mal die ganze Liste durch. */
    const nachRunde = [];
    for (let t = 0; t <= R; t++) nachRunde.push([]);
    for (const m of meldungen) if (m.runde >= 0 && m.runde <= R) nachRunde[m.runde].push(m);

    return {
      saat: saat,
      runden: R,
      rundenJeJahr: RUNDEN_JE_JAHR,
      jahre: R / RUNDEN_JE_JAHR,
      kurse: kurse,
      gewinne: gewinne,
      meldungen: meldungen,
      meldungenJeRunde: nachRunde,
      profile: profile,
    };
  }

  /* ----------------------------------------------------------------------
     Abfragen

     Alle nehmen den Lauf entgegen und lesen die Rundenzahl daraus — es gibt
     keine globale Rundenzahl mehr, seit die Partielänge wählbar ist.
     ---------------------------------------------------------------------- */

  function begrenze(lauf, runde) {
    const max = lauf && lauf.runden ? lauf.runden : STANDARD_RUNDEN;
    if (!(runde >= 0)) return 0;
    return runde > max ? max : Math.floor(runde);
  }

  function kurs(lauf, id, runde) {
    const reihe = lauf.kurse[id];
    return reihe ? reihe[begrenze(lauf, runde)] : 0;
  }

  /* Veränderung gegenüber der Vorrunde — im Spiel das Gegenstück zur
     Tagesveränderung an der echten Börse. */
  function veraenderung(lauf, id, runde) {
    const t = begrenze(lauf, runde);
    if (t === 0) return 0;
    const reihe = lauf.kurse[id];
    if (!reihe || !reihe[t - 1]) return 0;
    return (reihe[t] / reihe[t - 1] - 1) * 100;
  }

  function seitStart(lauf, id, runde) {
    const reihe = lauf.kurse[id];
    if (!reihe || !reihe[0]) return 0;
    return (reihe[begrenze(lauf, runde)] / reihe[0] - 1) * 100;
  }

  /* KGV zum Zeitpunkt: Kurs geteilt durch den mitgewanderten Gewinn.
     Genau das macht die Kennzahl im Spiel brauchbar — ein Wert, der sich
     verdreifacht hat, zeigt dann auch ein dreifaches KGV, sofern der Gewinn
     nicht mitgewachsen ist. */
  function kgv(lauf, wert, runde) {
    const g = lauf.gewinne[wert.id];
    if (!g || !g[0]) return null;
    const gew = g[begrenze(lauf, runde)];
    if (!(gew > 0)) return null;
    return kurs(lauf, wert.id, runde) / gew;
  }

  function gewinnJeAktie(lauf, id, runde) {
    const g = lauf.gewinne[id];
    return g ? g[begrenze(lauf, runde)] : 0;
  }

  /* Dividendenrendite auf den aktuellen Kurs: die Ausschüttung selbst bleibt
     nominal gleich, die Rendite steigt also, wenn der Kurs fällt. */
  function divRendite(lauf, wert, runde) {
    if (!wert.dividende) return 0;
    const k = kurs(lauf, wert.id, runde);
    return k > 0 ? (wert.dividende / k) * 100 : 0;
  }

  function marktkapitalisierung(lauf, wert, runde) {
    if (wert.art === 'krypto') {
      if (!wert.umlaufmenge) return null;
      return kurs(lauf, wert.id, runde) * wert.umlaufmenge;
    }
    return null;
  }

  /* Höchst- und Tiefstand bis zur aktuellen Runde — im Spiel das Gegenstück
     zum 52-Wochen-Hoch. */
  function spanne(lauf, id, runde) {
    const reihe = lauf.kurse[id];
    if (!reihe) return { hoch: 0, tief: 0 };
    const t = begrenze(lauf, runde);
    let hoch = reihe[0];
    let tief = reihe[0];
    for (let i = 1; i <= t; i++) {
      if (reihe[i] > hoch) hoch = reihe[i];
      if (reihe[i] < tief) tief = reihe[i];
    }
    return { hoch: hoch, tief: tief };
  }

  /* Meldungen bis einschließlich Runde, neueste zuerst. */
  function meldungenBis(lauf, runde) {
    const t = begrenze(lauf, runde);
    const raus = [];
    for (let i = lauf.meldungen.length - 1; i >= 0; i--) {
      if (lauf.meldungen[i].runde <= t) raus.push(lauf.meldungen[i]);
    }
    return raus;
  }

  /* Genau die Meldungen einer Runde — der Stapel, den der Block über der
     Oberfläche durchblättert. Sie wirken auf den nächsten Kursschritt. */
  function meldungenIn(lauf, runde) {
    const t = begrenze(lauf, runde);
    return lauf.meldungenJeRunde[t] || [];
  }

  /* Wie viele Dividendenzahlungen bis zu dieser Runde fällig waren.
     Ausgeschüttet wird einmal je simuliertem Jahr. */
  function dividendenZahlungen(lauf, runde) {
    return Math.floor(begrenze(lauf, runde) / RUNDEN_JE_JAHR);
  }

  /* Das simulierte Datum — macht den Zeitraffer sichtbar. */
  function spieljahr(lauf, runde) {
    return begrenze(lauf, runde) / RUNDEN_JE_JAHR;
  }

  return {
    RUNDENZAHLEN: RUNDENZAHLEN,
    STANDARD_RUNDEN: STANDARD_RUNDEN,
    RUNDEN_JE_JAHR: RUNDEN_JE_JAHR,
    normiereRunden: normiereRunden,
    zufallsgeber: zufallsgeber,
    erzeuge: erzeuge,
    kurs: kurs,
    veraenderung: veraenderung,
    seitStart: seitStart,
    kgv: kgv,
    gewinnJeAktie: gewinnJeAktie,
    divRendite: divRendite,
    marktkapitalisierung: marktkapitalisierung,
    spanne: spanne,
    meldungenBis: meldungenBis,
    meldungenIn: meldungenIn,
    dividendenZahlungen: dividendenZahlungen,
    spieljahr: spieljahr,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = markt;
