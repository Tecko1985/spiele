/* ==========================================================================
   Depot-Duell — Meldungskatalog
   ==========================================================================

   Die Nachrichten sind nicht Zierrat, sondern der einzige Hebel, mit dem
   Können statt Glück über den Sieg entscheidet: bei einem Zeitraffer über
   Jahre wäre eine reine Zufallskurve ein Würfelspiel. Wer die Meldung liest
   und richtig deutet, verdient daran.

   DESHALB IST DAS SPIEL RUNDENBASIERT: In Runde `r` liegen die Meldungen
   offen auf dem Tisch, jeder handelt in Ruhe, und erst wenn alle zugestimmt
   haben, wandern die Kurse — der Schritt von `r` nach `r+1` trägt genau die
   Wirkung dieser Meldungen. Ein sofortiger Sprung wäre realistischer (an
   echten Börsen ist alles sofort eingepreist), aber spielerisch tot: dann
   gäbe es nichts zu entscheiden.

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

     Angegeben als Kursbewegung, die eine Meldung im folgenden Kursschritt
     auslöst. 0.2 heißt: der Kurs läuft um rund 20 % in die genannte
     Richtung. Das kommt ZUSÄTZLICH zur normalen Schwankung.
     ---------------------------------------------------------------------- */
  const STAERKE = { klein: 0.05, mittel: 0.11, gross: 0.2, riesig: 0.34 };

  /* Wie breit eine Meldung streut, muss ihre Wucht bestimmen. Eine
     Einzelwertmeldung trifft einen von 141 Werten — sie darf voll
     durchschlagen und ist der Jackpot für den, der ihn hält. Eine
     Marktmeldung trifft dagegen JEDES Depot gleichzeitig; mit voller Stärke
     würde der Gesamtmarkt in jeder zweiten Runde zweistellig springen und
     die eigene Auswahl wäre neben dem Marktrauschen bedeutungslos. Zum
     Vergleich: die normale Schwankung einer Aktie liegt bei rund 9 % je
     Runde — dort sollen breite Meldungen landen, nicht darüber. */
  const ZIEL_WUCHT = { wert: 1, gruppe: 0.55, markt: 0.35 };

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

    /* --- Nachschub (2026-08-07) ------------------------------------------
       Der Katalog war nach wenigen Runden durchgespielt und dieselbe
       Schlagzeile kam mehrfach. Die Erweiterung ist bewusst über alle drei
       Zielarten verteilt: die Mischung entsteht zwar in `plane()` und nicht
       aus der Katalogzusammensetzung, aber ein Topf mit zu wenig Vorlagen
       wiederholt sich trotzdem sichtbar. -------------------------------- */

    /* Einzelwert, gut */
    { t: '{name} übertrifft die eigene Prognose zum zweiten Mal in Folge', z: 'wert', r: 1, s: 'gross', g: 0.13 },
    { t: 'Großinvestor steigt bei {name} ein', z: 'wert', r: 1, s: 'gross', g: 0 },
    { t: '{name} meldet Rekordabsatz im Auslandsgeschäft', z: 'wert', r: 1, s: 'mittel', g: 0.08 },
    { t: 'Neues Werk von {name} geht früher als geplant in Betrieb', z: 'wert', r: 1, s: 'klein', g: 0.05 },
    { t: '{name} sichert sich einen Rahmenvertrag über mehrere Jahre', z: 'wert', r: 1, s: 'gross', g: 0.11 },
    { t: 'Sparprogramm bei {name} zeigt Wirkung — Marge steigt deutlich', z: 'wert', r: 1, s: 'mittel', g: 0.15 },
    { t: '{name} löst sich vorzeitig von einer teuren Altlast', z: 'wert', r: 1, s: 'mittel', g: 0.09 },
    { t: 'Behörde erteilt {name} die lang erwartete Zulassung', z: 'wert', r: 1, s: 'gross', g: 0.12 },
    { t: '{name} verlängert den Vertrag mit dem größten Kunden', z: 'wert', r: 1, s: 'klein', g: 0.04 },
    { t: 'Belegschaft von {name} stimmt dem Zukunftspaket zu', z: 'wert', r: 1, s: 'klein', g: 0.06 },
    { t: '{name} kehrt in die Gewinnzone zurück', z: 'wert', r: 1, s: 'gross', g: 0.2 },
    { t: 'Wettbewerber von {name} muss ein Werk schließen', z: 'wert', r: 1, s: 'mittel', g: 0.07 },

    /* Einzelwert, schlecht */
    { t: '{name} verliert die Ausschreibung an einen Wettbewerber', z: 'wert', r: -1, s: 'mittel', g: -0.08 },
    { t: 'Finanzchef von {name} tritt überraschend zurück', z: 'wert', r: -1, s: 'mittel', g: 0 },
    { t: 'Aufsicht untersagt {name} den geplanten Zusammenschluss', z: 'wert', r: -1, s: 'mittel', g: -0.04 },
    { t: '{name} schreibt Firmenwert in Milliardenhöhe ab', z: 'wert', r: -1, s: 'gross', g: -0.16 },
    { t: 'Wichtiges Patent von {name} läuft aus', z: 'wert', r: -1, s: 'mittel', g: -0.11 },
    { t: 'Sammelklage gegen {name} eingereicht', z: 'wert', r: -1, s: 'mittel', g: -0.05 },
    { t: '{name} verschiebt den Marktstart des neuen Produkts', z: 'wert', r: -1, s: 'klein', g: -0.06 },
    { t: 'Rohstoffmangel bremst die Produktion bei {name}', z: 'wert', r: -1, s: 'mittel', g: -0.07 },
    { t: 'Großaktionär trennt sich von seinem Paket an {name}', z: 'wert', r: -1, s: 'gross', g: 0 },
    { t: '{name} senkt die Prognose zum dritten Mal in diesem Jahr', z: 'wert', r: -1, s: 'riesig', g: -0.22 },
    { t: 'Streik legt die Werke von {name} lahm', z: 'wert', r: -1, s: 'mittel', g: -0.06 },
    { t: 'Datenpanne bei {name} — Millionen Kundendaten betroffen', z: 'wert', r: -1, s: 'mittel', g: -0.03 },

    /* Gerüchte */
    { t: 'Am Markt wird über einen Großeinstieg bei {name} getuschelt', z: 'wert', r: 1, s: 'gross', g: 0, ger: true },
    { t: 'Gerücht: {name} soll eine Sparte abspalten wollen', z: 'wert', r: 1, s: 'mittel', g: 0, ger: true },
    { t: 'Unbestätigt: Ermittler sollen bei {name} vorstellig geworden sein', z: 'wert', r: -1, s: 'gross', g: 0, ger: true },
    { t: 'Händler sprechen von Problemen in der Fertigung bei {name}', z: 'wert', r: -1, s: 'mittel', g: 0, ger: true },
    { t: 'Berichte über einen Großauftrag für {name} machen die Runde', z: 'wert', r: 1, s: 'mittel', g: 0, ger: true },
    { t: 'Spekulationen über eine Kapitalerhöhung bei {name}', z: 'wert', r: -1, s: 'mittel', g: 0, ger: true },

    /* Gruppe */
    { t: 'Neue Auflagen verteuern die Produktion bei {gruppe}', z: 'gruppe', r: -1, s: 'mittel', g: -0.05 },
    { t: 'Fachkräftemangel bremst {gruppe}', z: 'gruppe', r: -1, s: 'klein', g: -0.04 },
    { t: 'Auftragseingang bei {gruppe} auf Rekordniveau', z: 'gruppe', r: 1, s: 'gross', g: 0.11 },
    { t: 'Analysehaus hebt den Daumen für {gruppe}', z: 'gruppe', r: 1, s: 'klein', g: 0 },
    { t: 'Energiepreise entspannen sich — {gruppe} atmen auf', z: 'gruppe', r: 1, s: 'mittel', g: 0.06 },
    { t: 'Neue Zölle treffen {gruppe} unmittelbar', z: 'gruppe', r: -1, s: 'gross', g: -0.09 },
    { t: 'Übernahmewelle bei {gruppe} erwartet', z: 'gruppe', r: 1, s: 'mittel', g: 0 },
    { t: 'Lieferengpässe bei {gruppe} lösen sich auf', z: 'gruppe', r: 1, s: 'klein', g: 0.05 },
    { t: 'Verband warnt vor einem schwachen Jahr für {gruppe}', z: 'gruppe', r: -1, s: 'mittel', g: -0.07 },
    { t: 'Investitionsprogramm treibt die Nachfrage bei {gruppe}', z: 'gruppe', r: 1, s: 'gross', g: 0.09 },
    { t: 'Preiskampf drückt die Margen bei {gruppe}', z: 'gruppe', r: -1, s: 'mittel', g: -0.1 },
    { t: 'Neue Technik eröffnet {gruppe} zusätzliche Märkte', z: 'gruppe', r: 1, s: 'mittel', g: 0.07 },

    /* Gesamtmarkt */
    { t: 'Arbeitsmarktdaten fallen besser aus als erwartet', z: 'markt', r: 1, s: 'mittel', g: 0.03 },
    { t: 'Notenbank deutet weitere Zinsschritte an — Anleger werden nervös', z: 'markt', r: -1, s: 'mittel', g: -0.03 },
    { t: 'Ölpreis springt nach einer Förderkürzung', z: 'markt', r: -1, s: 'klein', g: -0.02 },
    { t: 'Handelsabkommen unterzeichnet — die Börsen feiern', z: 'markt', r: 1, s: 'gross', g: 0.05 },
    { t: 'Großbank meldet Verluste, Zweifel an der ganzen Branche', z: 'markt', r: -1, s: 'gross', g: -0.05 },
    { t: 'Verbrauchervertrauen auf dem höchsten Stand seit Jahren', z: 'markt', r: 1, s: 'mittel', g: 0.04 },
    { t: 'Währungsturbulenzen verunsichern die Märkte', z: 'markt', r: -1, s: 'mittel', g: -0.03 },
    { t: 'Steuerreform beschlossen — Unternehmen deutlich entlastet', z: 'markt', r: 1, s: 'gross', g: 0.07 },

    /* Krypto */
    { t: 'Großer Vermögensverwalter legt einen Fonds auf {name} auf', z: 'wert', r: 1, s: 'riesig', g: 0, nur: 'krypto' },
    { t: 'Schwere Sicherheitslücke im Netzwerk von {name} entdeckt', z: 'wert', r: -1, s: 'riesig', g: 0, nur: 'krypto' },
    { t: 'Notenbank nennt {name} eine Gefahr für die Stabilität', z: 'wert', r: -1, s: 'gross', g: 0, nur: 'krypto' },
    { t: 'Wichtiges Netzwerk-Update für {name} erfolgreich abgeschlossen', z: 'wert', r: 1, s: 'gross', g: 0, nur: 'krypto' },
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

  /* Eine Meldung wirkt auf GENAU EINEN Kursschritt — den unmittelbar nach
     der Runde, in der sie zu lesen war. Über mehrere Runden verteilt wäre
     die Wirkung im Rundenmodus nicht mehr zuzuordnen: man sähe eine
     Bewegung und wüsste nicht, ob sie zur Schlagzeile von eben gehört oder
     zu einer von vorletzter Runde. */
  const WIRKDAUER = 1;

  /* Nach so vielen Runden löst sich ein Gerücht auf. Zwei Runden geben
     genug Zeit zum Ein- und Aussteigen, ohne dass man es vergisst. */
  const GERUECHT_FRIST = 2;

  /* Wie viele Meldungen eine Runde bringt. Zwei sind gesetzt, die dritte und
     vierte kommen mit abnehmender Wahrscheinlichkeit dazu — im Mittel 2,7.
     Weniger wäre eine leere Runde, in der es nichts zu entscheiden gibt;
     mehr passt nicht auf einen Handybildschirm, und niemand liest acht
     Schlagzeilen, bevor er auf "weiter" tippt. */
  function meldungenDieserRunde(rng) {
    let zahl = 2;
    if (rng() < 0.5) zahl++;
    if (rng() < 0.2) zahl++;
    return zahl;
  }

  function plane(rng, werte, runden) {
    const liste = [];
    const gruppen = {};
    for (const w of werte) {
      const g = gruppeVon(w);
      if (!gruppen[g]) gruppen[g] = [];
      gruppen[g].push(w);
    }
    const gruppenNamen = Object.keys(gruppen);
    const ohneKrypto = werte.filter((w) => w.art !== 'krypto');

    /* Vorlagen nach Zielart vorsortieren. Wählte man blind aus dem ganzen
       Katalog, entschiede dessen Zusammensetzung über die Mischung — gemessen
       kamen so 29 Einzelwert- gegen nur 6 Gruppenmeldungen heraus. Bei 141
       Werten trifft eine Einzelmeldung aber kaum je ein Depot, und die
       Meldung verpufft. Gruppen- und Marktmeldungen treffen dagegen fast
       jeden, und genau darum geht es: alle lesen dieselbe Schlagzeile und
       entscheiden gleichzeitig. */
    const nachZiel = { wert: [], gruppe: [], markt: [] };
    for (const v of VORLAGEN) nachZiel[v.z].push(v);
    const MISCHUNG = [
      { art: 'wert', anteil: 0.45 },
      { art: 'gruppe', anteil: 0.35 },
      { art: 'markt', anteil: 0.2 },
    ];

    /* Die letzte Runde bekommt keine Meldungen: nach ihr gibt es keinen
       Kursschritt mehr, auf den sie wirken könnten. Eine Schlagzeile ohne
       Folgen wäre schlimmer als keine — man würde noch darauf handeln. */
    for (let runde = 0; runde < runden; runde++) {
      const zahl = meldungenDieserRunde(rng);

      for (let i = 0; i < zahl; i++) {
        const wurf = rng();
        let summe = 0;
        let art = 'wert';
        for (const m of MISCHUNG) {
          summe += m.anteil;
          if (wurf < summe) { art = m.art; break; }
        }
        const topf = nachZiel[art];
        const v = topf[Math.floor(rng() * topf.length)];

        let ziel = null;
        let text = v.t;

        if (v.z === 'wert') {
          const auswahl = v.nur === 'krypto' ? (gruppen.krypto || []) : ohneKrypto;
          if (!auswahl.length) continue;
          ziel = auswahl[Math.floor(rng() * auswahl.length)];
          text = text.replace('{name}', ziel.name);
        } else if (v.z === 'gruppe') {
          const g = gruppenNamen[Math.floor(rng() * gruppenNamen.length)];
          ziel = g;
          text = text.replace('{gruppe}', GRUPPEN_NAME[g] || 'breite Marktwerte');
        }

        const eintrag = {
          runde: runde,
          text: text,
          zielArt: v.z,
          ziel: v.z === 'wert' ? ziel.id : ziel,
          zielName: v.z === 'wert' ? ziel.name : GRUPPEN_NAME[ziel] || null,
          richtung: v.r,
          staerke: STAERKE[v.s] * ZIEL_WUCHT[v.z],
          gewinn: (v.g || 0) * ZIEL_WUCHT[v.z],
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
          const aufRunde = runde + GERUECHT_FRIST;
          if (aufRunde < runden) {
            const muster = bestaetigt
              ? AUFLOESUNG_JA[Math.floor(rng() * AUFLOESUNG_JA.length)]
              : AUFLOESUNG_NEIN[Math.floor(rng() * AUFLOESUNG_NEIN.length)];
            liste.push({
              runde: aufRunde,
              text: muster.replace('{name}', eintrag.zielName).replace('{kurz}', eintrag.text),
              zielArt: 'wert',
              ziel: eintrag.ziel,
              zielName: eintrag.zielName,
              richtung: bestaetigt ? v.r : -v.r,
              staerke: eintrag.staerke * (bestaetigt ? 0.7 : 1.45),
              gewinn: 0,
              dauer: WIRKDAUER,
              geruecht: false,
              aufloesung: bestaetigt ? 'bestaetigt' : 'dementiert',
            });
          }
        }
      }
    }

    liste.sort((a, b) => a.runde - b.runde);
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
