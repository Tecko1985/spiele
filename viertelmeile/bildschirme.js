/* ==========================================================================
   Viertelmeile — Bildschirme
   ==========================================================================
   Reine Ansichten: jede Funktion bekommt den Zustand und gibt HTML zurück.
   Kein Firebase, keine Ereignisse — die hängen in app.js an
   `data-aktion`-Attributen.

   ⚠️ Alles, was von anderen Geräten kommt (Namen!), geht durch `esc()`.
   Ein Spielername ist Fremdtext aus Firebase.
   ========================================================================== */

const bildschirme = (function () {
  'use strict';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function zeit(x) { return typeof x === 'number' ? x.toFixed(3) + ' s' : '—'; }
  function zeitKurz(x) { return typeof x === 'number' ? x.toFixed(3) : '—'; }

  function nameVon(z, uid) {
    if (!uid) return 'Bot';
    if (uid.indexOf('bot-') === 0) return '🤖 Bot';
    return z.namen[uid] || 'Weg';
  }

  function lackVon(z, uid) {
    if (!uid || uid.indexOf('bot-') === 0) return autos.lack('weiss');
    return autos.lack(z.lacke[uid]);
  }

  function ergebnisGrund(e) {
    if (!e) return '—';
    if (e.fehlt) return 'kein Ergebnis';
    if (e.fehlstart) return 'Frühstart';
    if (e.nichtGestartet) return 'nicht losgefahren';
    if (e.abgebrochen) return 'App weggedrückt';
    if (e.aus) return 'Spur verlassen';
    return zeit(e.gesamt);
  }

  /* ----------------------------------------------------------------------
     Kopf und Reiter
     ---------------------------------------------------------------------- */

  function kopf(z) {
    const code = z && z.code ? '<span class="code">' + esc(z.code) + '</span>' : '';
    return '<div class="titel"><a href="../index.html" aria-label="Zurück zum Spiele-Hub">‹</a>🏁 Viertelmeile</div>' + code;
  }

  function reiter(z, ui) {
    const liste = z && z.code
      ? [['spiel', 'Spiel'], ['stand', 'Stand'], ['hilfe', 'Anleitung'], ['info', 'Info']]
      : [['spiel', 'Start'], ['hilfe', 'Anleitung'], ['info', 'Info']];
    return liste.map(function (r) {
      return '<button data-aktion="reiter" data-reiter="' + r[0] + '" class="' + (ui.reiter === r[0] ? 'aktiv' : '') + '">' + r[1] + '</button>';
    }).join('');
  }

  /* ----------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */

  function start(z, ui) {
    let h = '<h1 class="mitte">🏁 Viertelmeile</h1>';
    h += '<p class="leise mitte">Drag Race am eigenen Handy, quer gehalten. Immer einer gegen einen.</p>';

    if (ui.formular === 'neu') {
      h += '<div class="karte akzent"><h2>Neues Turnier</h2>';
      h += '<label class="schalter"><div class="txt">Ich fahre selbst mit<small>Aus: Dieses Gerät führt nur die Tabelle.</small></div>';
      h += '<input type="checkbox" id="spieltMit" ' + (ui.spieltMit !== false ? 'checked' : '') + '></label>';
      h += '<label class="feld" for="name">Dein Name</label><input type="text" id="name" maxlength="24" autocomplete="off" value="' + esc(z.gemerkterName || '') + '" placeholder="Spitzname reicht">';
      h += '<button class="btn primaer" data-aktion="raumErstellen">Turnier eröffnen</button>';
      h += '<button class="btn leise" data-aktion="formular" data-formular="">Abbrechen</button></div>';
    } else if (ui.formular === 'beitreten') {
      h += '<div class="karte akzent"><h2>Beitreten</h2>';
      h += '<label class="feld" for="code">Raum-Code</label><input type="text" id="code" class="code-feld" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="ABC123">';
      h += '<label class="feld" for="name">Dein Name</label><input type="text" id="name" maxlength="24" autocomplete="off" value="' + esc(z.gemerkterName || '') + '" placeholder="Spitzname reicht">';
      h += '<button class="btn primaer" data-aktion="raumBeitreten">Beitreten</button>';
      h += '<button class="btn leise" data-aktion="formular" data-formular="">Abbrechen</button></div>';
    } else if (ui.formular === 'allein') {
      h += '<div class="karte akzent"><h2>Allein üben</h2>';
      h += '<p class="leise">Ein Rennen gegen den Computer. Zählt für nichts — nur zum Reinkommen.</p>';
      h += feldAuswahl('uebAuto', 'Auto', autos.LISTE.map(function (a) { return [a.id, a.icon + ' ' + a.name]; }), ui.uebAuto || 'muscle');
      h += feldAuswahl('uebStufe', 'Gegner', [['leicht', 'Leicht'], ['mittel', 'Mittel'], ['schwer', 'Schwer']], ui.uebStufe || 'mittel');
      h += '<label class="schalter"><div class="txt">Mit Burnout<small>Reifen vor dem Start aufwärmen.</small></div><input type="checkbox" id="uebBurnout" ' + (ui.uebBurnout !== false ? 'checked' : '') + '></label>';
      h += '<button class="btn primaer" data-aktion="alleinStarten">Losfahren</button>';
      h += '<button class="btn leise" data-aktion="formular" data-formular="">Abbrechen</button></div>';
    } else {
      if (z.gemerkterCode) h += '<button class="btn primaer" data-aktion="fortsetzen">Turnier fortsetzen (' + esc(z.gemerkterCode) + ')</button>';
      h += '<button class="btn ' + (z.gemerkterCode ? '' : 'primaer') + '" data-aktion="formular" data-formular="neu">Neues Turnier eröffnen</button>';
      h += '<button class="btn" data-aktion="formular" data-formular="beitreten">Einem Turnier beitreten</button>';
      h += '<button class="btn" data-aktion="formular" data-formular="allein">Allein üben</button>';
      h += '<p class="leise mitte" style="margin-top:18px">Jeder braucht sein eigenes Handy. Einer eröffnet, die anderen tippen den Code ein. ' + gameService.MIN_SPIELER + ' bis ' + gameService.MAX_SPIELER + ' Fahrer.</p>';
    }
    h += lackWahl(ui);
    h += geraet();
    return h;
  }

  function feldAuswahl(id, beschriftung, paare, wert) {
    let h = '<label class="feld" for="' + id + '">' + esc(beschriftung) + '</label><select id="' + id + '">';
    for (const p of paare) h += '<option value="' + esc(p[0]) + '"' + (p[0] === wert ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    return h + '</select>';
  }

  function lackWahl(ui) {
    const meiner = ton.hole('lack') || 'rot';
    let h = '<div class="karte"><h3>Deine Lackierung</h3><p class="leise" style="margin-top:0">Nur Optik — am Rennen ändert sie nichts.</p><div class="lacke">';
    for (const l of autos.LACKE) {
      h += '<button class="lack' + (l.id === meiner ? ' gewaehlt' : '') + '" data-aktion="lack" data-lack="' + l.id + '" style="background:' + l.farbe + '" aria-label="' + esc(l.name) + '"></button>';
    }
    return h + '</div></div>';
  }

  function geraet() {
    let h = '<div class="karte"><h3>Dieses Gerät</h3>';
    h += '<label class="schalter"><div class="txt">Motorgeräusch<small>' + (ton.kannTon() ? 'Hilft beim Schalten — du hörst, wann die Nadel oben ist.' : 'Dieses Gerät kann keinen Ton.') + '</small></div><input type="checkbox" data-einstellung="ton" ' + (ton.hole('ton') ? 'checked' : '') + '></label>';
    h += '<label class="schalter"><div class="txt">Vibration<small>Beim perfekten Treffer. iPhone kann das nicht.</small></div><input type="checkbox" data-einstellung="vibration" ' + (ton.hole('vibration') ? 'checked' : '') + '></label>';
    return h + '</div>';
  }

  /* ----------------------------------------------------------------------
     Lobby
     ---------------------------------------------------------------------- */

  function lobby(z, ui) {
    const raum = z.raum;
    const liste = z.spielerListe;
    const e = gameService.normiereEinstellungen(raum.einstellungen);
    let h = '';

    h += '<div class="karte akzent mitte"><p class="leise">Raum-Code — die anderen tippen ihn ein</p><div class="riesig">' + esc(z.code) + '</div>';
    h += '<p class="leise">' + (z.istHost ? (z.spieltMit ? 'Du bist Gastgeber und fährst mit.' : 'Dieses Gerät führt nur die Tabelle.') : 'Warte, bis der Gastgeber startet.') + '</p></div>';

    if (z.sicht && z.sicht.zustand === 'uebungFertig') h += uebungErgebnis(z);

    h += '<h2>Fahrer (' + liste.length + ')</h2><ul class="liste">';
    liste.forEach(function (s, i) {
      const l = autos.lack(s.lack);
      h += '<li><span class="punkt" style="background:' + l.farbe + '"></span>';
      h += '<span class="name">' + esc(s.name) + (s.uid === z.uid ? ' <span class="leise">(du)</span>' : '') + '</span>';
      if (z.istHost && s.uid !== z.uid) h += '<button class="mini rot" data-aktion="spielerRaus" data-uid="' + esc(s.uid) + '" aria-label="entfernen">✕</button>';
      h += '</li>';
    });
    h += '</ul>';

    if (liste.length < gameService.MIN_SPIELER) {
      h += '<div class="hinweis info">Es fehlt noch mindestens ' + (gameService.MIN_SPIELER - liste.length) + ' Fahrer.</div>';
    }

    if (z.istHost) {
      h += '<h2>Einstellungen</h2><div class="karte">';
      h += '<div class="schalter"><div class="txt">Turnierform<small>' + (e.form === 'liga'
        ? (liste.length <= turnier.JEDER_GEGEN_JEDEN_BIS ? 'Jeder gegen jeden, ' + turnier.ligaRunden(Math.max(2, liste.length)) + ' Runden.' : turnier.SCHWEIZER_RUNDEN + ' Runden, gepaart nach Tabellenstand.')
        : 'Verlierer raus. Ab dem Halbfinale drei Läufe.') + '</small></div>';
      h += '<select data-aktion="form"><option value="liga"' + (e.form === 'liga' ? ' selected' : '') + '>Liga</option><option value="ko"' + (e.form === 'ko' ? ' selected' : '') + '>K.-o.</option></select></div>';
      h += '<label class="schalter"><div class="txt">Mit Burnout<small>Reifen vor dem Start aufwärmen. Kostet 4 Sekunden je Rennen.</small></div><input type="checkbox" data-aktion="burnout" ' + (e.burnout ? 'checked' : '') + '></label>';
      h += '<div class="schalter"><div class="txt">Bot-Stärke<small>Springt ein, wenn ihr ungerade viele seid.</small></div>';
      h += '<select data-aktion="botStufe">';
      for (const k of ['leicht', 'mittel', 'schwer']) h += '<option value="' + k + '"' + (e.botStufe === k ? ' selected' : '') + '>' + bot.stufe(k).name + '</option>';
      h += '</select></div>';
      h += '</div>';

      h += '<button class="btn" data-aktion="uebung">Übungslauf für alle</button>';
      h += '<p class="leise" style="margin-top:-4px">Jeder fährt gleichzeitig allein gegen die Uhr. Zählt nicht.</p>';
      h += '<button class="btn primaer" data-aktion="starten"' + (liste.length < gameService.MIN_SPIELER ? ' disabled' : '') + '>Turnier starten</button>';
    } else {
      h += '<div class="karte"><h3>So wird gefahren</h3><ul style="padding-left:20px;margin:6px 0">';
      h += '<li>' + (e.form === 'liga' ? 'Liga — jeder gegen jeden, die meisten Siege gewinnen.' : 'K.-o. — wer verliert, ist raus.') + '</li>';
      h += '<li>' + (e.burnout ? 'Mit Burnout vor dem Start.' : 'Ohne Burnout, direkt zur Ampel.') + '</li>';
      h += '</ul></div>';
    }

    h += lackWahl(ui);
    h += '<button class="btn gefahr" data-aktion="verlassen">' + (z.istHost ? 'Raum schließen' : 'Raum verlassen') + '</button>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Warten auf Bereitschaft
     ---------------------------------------------------------------------- */

  function warten(z) {
    const s = z.sicht || {};
    const fehlen = s.wartetAuf || [];
    let h = '<div class="karte akzent mitte"><h2>' + esc(s.rundenName || 'Nächste Runde') + '</h2>';
    h += '<p class="gross">Warte auf …</p><ul class="liste">';
    for (const uid of fehlen) h += '<li><span class="name">' + esc(nameVon(z, uid)) + '</span><span class="leise">nicht bereit</span></li>';
    h += '</ul>';
    h += '<p class="leise">Das Rennen startet erst, wenn alle wieder da sind. Wer die App weggedrückt hat, muss sie nur wieder öffnen.</p></div>';
    if (z.istHost) h += '<button class="btn gefahr" data-aktion="verlassen">Turnier abbrechen</button>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Ergebnis einer Runde
     ---------------------------------------------------------------------- */

  function meinDetail(e, gegner, name) {
    if (!e) return '';
    let h = '<div class="karte"><h3>' + esc(name) + '</h3>';
    h += '<div class="werte">';
    h += wert('Reaktion', e.reaktion === null || e.reaktion === undefined ? '—' : (e.reaktion < 0 ? 'Frühstart' : e.reaktion.toFixed(3) + ' s'), e.fehlstart ? 'schlecht' : (e.reaktion !== null && e.reaktion < 0.25 ? 'gut' : ''));
    const bn = { perfekt: 'Punktlandung', kalt: 'zu kalt', lau: 'zu kalt', heiss: 'etwas heiß', verbrannt: 'verbrannt', aus: 'aus' };
    h += wert('Burnout', bn[e.burnout] || '—', e.burnout === 'perfekt' ? 'gut' : (e.burnout === 'aus' ? '' : 'schlecht'));
    const n = e.noten || { perfekt: 0, gut: 0, zufrueh: 0, ueberdreht: 0 };
    h += wert('Schalten', n.perfekt + ' perfekt · ' + n.gut + ' gut · ' + (n.zufrueh + n.ueberdreht) + ' daneben', n.zufrueh + n.ueberdreht === 0 ? 'gut' : 'schlecht');
    h += wert('Spurverlust', (e.spurVerlust || 0).toFixed(1) + ' m/s', (e.spurVerlust || 0) < 2 ? 'gut' : 'schlecht');
    h += wert('Spitze', (e.spitze || 0) + ' km/h', '');
    h += '</div></div>';
    return h;
  }

  function wert(name, text, art) {
    return '<div class="wert ' + (art || '') + '"><span class="w-name">' + esc(name) + '</span><span class="w-text">' + esc(text) + '</span></div>';
  }

  function ergebnis(z, ui) {
    const s = z.sicht || {};
    const letzte = s.letzte;
    if (!letzte) return '<p class="leise mitte">Wird ausgewertet …</p>';

    const auto = autos.nachId(letzte.autoId);
    let h = '<h1>' + esc(letzte.name) + '</h1>';
    h += '<p class="leise">' + auto.icon + ' ' + esc(auto.name) + '</p>';

    /* Zuerst das eigene Rennen, ausführlich. */
    const meins = (letzte.ergebnisse || []).find(function (r) { return r.a === z.uid || r.b === z.uid; });
    if (meins) {
      const ichBinA = meins.a === z.uid;
      const meinE = ichBinA ? meins.ergA : meins.ergB;
      const gegnerUid = ichBinA ? meins.b : meins.a;
      const gegnerE = ichBinA ? meins.ergB : meins.ergA;
      const gewonnen = meins.sieger === z.uid;

      h += '<div class="karte ' + (gewonnen ? 'gruen' : (meins.sieger === null ? '' : 'rot')) + ' mitte">';
      h += '<div class="riesig-text">' + (gewonnen ? '🏆 Gewonnen' : (meins.sieger === null ? 'Unentschieden' : 'Verloren')) + '</div>';
      h += '<div class="duell">';
      h += '<div class="seite"><div class="dname">' + esc(nameVon(z, z.uid)) + '</div><div class="dzeit">' + esc(ergebnisGrund(meinE)) + '</div></div>';
      h += '<div class="gegen">gegen</div>';
      h += '<div class="seite"><div class="dname">' + esc(nameVon(z, gegnerUid)) + '</div><div class="dzeit">' + esc(ergebnisGrund(gegnerE)) + '</div></div>';
      h += '</div>';
      if (meinE && gegnerE && typeof meinE.gesamt === 'number' && typeof gegnerE.gesamt === 'number') {
        h += '<p class="leise">Abstand: ' + Math.abs(meinE.gesamt - gegnerE.gesamt).toFixed(3) + ' s</p>';
      }
      if (meins.notEntscheidung) {
        h += '<p class="leise">Dreimal unentschieden — entschieden hat die bessere Reaktionszeit.</p>';
      }
      h += '</div>';
      h += meinDetail(meinE, gegnerE, 'Wo deine Zeit hingegangen ist');
    }

    /* Dann die anderen Paarungen, knapp. */
    const andere = (letzte.ergebnisse || []).filter(function (r) { return r.a !== z.uid && r.b !== z.uid; });
    if (andere.length) {
      h += '<h2>Die anderen Rennen</h2><ul class="liste">';
      for (const r of andere) {
        h += '<li><span class="name' + (r.sieger === r.a ? ' sieg' : '') + '">' + esc(nameVon(z, r.a)) + '</span>';
        h += '<span class="leise">' + zeitKurz(r.ergA && r.ergA.gesamt) + '</span>';
        h += '<span class="gegen">:</span>';
        h += '<span class="leise">' + zeitKurz(r.ergB && r.ergB.gesamt) + '</span>';
        h += '<span class="name' + (r.sieger === r.b ? ' sieg' : '') + '" style="text-align:right">' + esc(nameVon(z, r.b)) + '</span></li>';
      }
      h += '</ul>';
    }

    if (z.istHost) {
      h += '<button class="btn primaer" data-aktion="weiter">Nächstes Rennen</button>';
      h += '<button class="btn klein leise" data-aktion="wiederholen">Runde wiederholen</button>';
    } else {
      h += '<p class="leise mitte">Warte auf den Gastgeber …</p>';
    }
    return h;
  }

  function uebungErgebnis(z) {
    const letzte = z.sicht.letzte;
    if (!letzte) return '';
    const reihe = (letzte.ergebnisse || []).slice().sort(function (a, b) {
      const x = a.ergA && typeof a.ergA.gesamt === 'number' ? a.ergA.gesamt : 999;
      const y = b.ergA && typeof b.ergA.gesamt === 'number' ? b.ergA.gesamt : 999;
      return x - y;
    });
    let h = '<div class="karte"><h3>Übungslauf — nur zur Information</h3><ul class="liste">';
    for (const r of reihe) {
      h += '<li><span class="name">' + esc(nameVon(z, r.a)) + '</span><span class="leise">' + esc(ergebnisGrund(r.ergA)) + '</span></li>';
    }
    return h + '</ul></div>';
  }

  /* ----------------------------------------------------------------------
     Stand: Tabelle oder Baum
     ---------------------------------------------------------------------- */

  function stand(z) {
    const s = z.sicht || {};
    if (!s.form && !s.baum) return '<p class="leise mitte">Noch kein Turnier gestartet.</p>';
    if (s.form === 'ko' || s.baum) return baum(z);
    return tabelle(z);
  }

  function tabelle(z) {
    const s = z.sicht || {};
    const ids = z.spielerListe.map(function (x) { return x.uid; });
    const t = turnier.tabelle(ids, s.stand || {});
    let h = '<h1>Tabelle</h1>';
    if (s.rundenName) h += '<p class="leise">' + esc(s.rundenName) + '</p>';
    h += '<table class="tabelle"><thead><tr><th>#</th><th>Fahrer</th><th>S</th><th>N</th><th>beste Zeit</th></tr></thead><tbody>';
    for (const zeile of t) {
      h += '<tr' + (zeile.id === z.uid ? ' class="ich"' : '') + '><td>' + zeile.platz + '</td>';
      h += '<td><span class="punkt" style="background:' + lackVon(z, zeile.id).farbe + '"></span>' + esc(nameVon(z, zeile.id)) + '</td>';
      h += '<td>' + zeile.siege + '</td><td>' + zeile.niederlagen + '</td>';
      h += '<td class="zahl">' + zeitKurz(zeile.besteZeit) + '</td></tr>';
    }
    return h + '</tbody></table>';
  }

  function baum(z) {
    const b = (z.sicht || {}).baum;
    if (!b) return '<p class="leise mitte">Der Turnierbaum steht noch nicht.</p>';
    let h = '<h1>Turnierbaum</h1>';
    for (const r of b.runden) {
      h += '<h2>' + esc(r.name) + (r.paare[0] && r.paare[0].noetig > 1 ? ' <span class="leise" style="font-size:14px">— wer zwei Läufe gewinnt</span>' : '') + '</h2>';
      h += '<ul class="liste">';
      for (const pa of r.paare) {
        const a = pa.sieger === pa.a, bb = pa.sieger === pa.b;
        h += '<li><span class="name' + (a ? ' sieg' : (pa.sieger ? ' raus' : '')) + '">' + esc(nameVon(z, pa.a)) + '</span>';
        h += '<span class="gegen">' + (pa.noetig > 1 ? pa.siegeA + ':' + pa.siegeB : 'gegen') + '</span>';
        h += '<span class="name' + (bb ? ' sieg' : (pa.sieger ? ' raus' : '')) + '" style="text-align:right">' + esc(nameVon(z, pa.b)) + '</span></li>';
      }
      h += '</ul>';
    }
    return h;
  }

  /* ----------------------------------------------------------------------
     Ende
     ---------------------------------------------------------------------- */

  function ende(z) {
    const s = z.sicht || {};
    const sieger = s.gesamtSieger;
    let h = '<div class="sieger"><div class="symbol">🏆</div>';
    h += '<h1>' + esc(nameVon(z, sieger)) + '</h1>';
    h += '<p class="leise">' + (sieger === z.uid ? 'Du hast das Turnier gewonnen.' : 'gewinnt das Turnier') + '</p></div>';
    h += stand(z);
    if (z.istHost) {
      h += '<button class="btn primaer" data-aktion="nochmal">Neues Turnier, gleiche Leute</button>';
      h += '<button class="btn gefahr" data-aktion="verlassen">Raum schließen</button>';
    } else {
      h += '<button class="btn gefahr" data-aktion="verlassen">Raum verlassen</button>';
    }
    return h;
  }

  /* ----------------------------------------------------------------------
     Ergebnis einer Übungsfahrt allein
     ---------------------------------------------------------------------- */

  function alleinErgebnis(ui) {
    const e = ui.alleinErgebnis, g = ui.alleinGegner;
    if (!e) return '';
    const gewonnen = physik.vergleiche(e, g) === 'a';
    let h = '<h1>Übungsfahrt</h1>';
    h += '<div class="karte ' + (gewonnen ? 'gruen' : 'rot') + ' mitte">';
    h += '<div class="riesig-text">' + (gewonnen ? '🏆 Gewonnen' : 'Verloren') + '</div>';
    h += '<div class="duell">';
    h += '<div class="seite"><div class="dname">Du</div><div class="dzeit">' + esc(ergebnisGrund(e)) + '</div></div>';
    h += '<div class="gegen">gegen</div>';
    h += '<div class="seite"><div class="dname">🤖 Bot</div><div class="dzeit">' + esc(ergebnisGrund(g)) + '</div></div>';
    h += '</div></div>';
    h += meinDetail(e, g, 'Wo deine Zeit hingegangen ist');
    h += '<button class="btn primaer" data-aktion="alleinStarten">Noch einmal</button>';
    h += '<button class="btn leise" data-aktion="formular" data-formular="">Zurück</button>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Anleitung
     ---------------------------------------------------------------------- */

  function hilfe() {
    let h = '<h1>Anleitung</h1>';
    h += '<div class="hinweis info">Handy quer halten. Linker Daumen lenkt — <b>gedrückt halten, nicht tippen</b>. Rechter Daumen macht alles andere.</div>';

    h += '<div class="karte"><h3>1. Burnout</h3>';
    h += '<p>Vor der Ampel: <b>rechts halten</b>. Ein Balken füllt sich — das sind die Reifen, die warm werden. Im <b>grünen Bereich loslassen</b>.</p>';
    h += '<p class="leise">Zu kalt = die Reifen drehen beim Start durch. Zu heiß = auch schlecht. Genau richtig = bester Start.</p></div>';

    h += '<div class="karte"><h3>2. Der Start</h3>';
    h += '<p>Drei gelbe Lichter, dann grün. Der Abstand ist <b>immer gleich</b> (eine halbe Sekunde) — man kann den Takt lernen.</p>';
    h += '<p>Bei Grün <b>rechts tippen</b>. Deine Reaktionszeit zählt voll zur Endzeit.</p>';
    h += '<p class="warn"><b>Vor</b> Grün getippt = Frühstart = sofort verloren. Tippen beide zu früh, verliert der Frühere.</p></div>';

    h += '<div class="karte"><h3>3. Schalten</h3>';
    h += '<p>Unten rechts ist der Tacho. Die Nadel klettert. Ganz oben ist der <b>grüne Bereich</b> — dort <b>rechts tippen</b>.</p>';
    h += '<p class="leise">Zu früh: das Auto zieht schlecht weiter. Zu spät: der Motor kreischt im Begrenzer. Beides kostet ungefähr eine halbe Sekunde.</p>';
    h += '<p class="leise">Der grüne Bereich wird mit jedem Gang <b>schmaler</b>. Ein ganz knapper Treffer gibt einen kleinen Extra-Schub.</p>';
    h += '<p class="leise">Der Motorton steigt mit der Drehzahl. Wer auf den Ton hört, muss nicht auf den Tacho schauen.</p></div>';

    h += '<div class="karte"><h3>4. Spur halten</h3>';
    h += '<p>Zwei- bis dreimal pro Rennen zieht das Auto zur Seite. Kurz vorher blinkt ein <b>Pfeil</b> und die Fläche leuchtet auf, die du drücken sollst.</p>';
    h += '<p class="hinweis info" style="margin:8px 0"><b>Gedrückt halten, nicht tippen.</b> Solange dein Daumen unten links liegt, lenkt das Auto. Nimmst du ihn weg, hört es sofort auf.</p>';
    h += '<p><b>Ganz links halten</b> lenkt nach links, <b>daneben halten</b> nach rechts. Du kannst den Daumen auch von einer Hälfte in die andere schieben.</p>';
    h += '<p class="leise">Ein Zug dauert knapp zwei Sekunden. Halte dagegen, bis das Auto wieder mittig steht — oben in der Mitte zeigt ein Punkt, wo du stehst.</p>';
    h += '<p class="leise">Spät reagiert = du wirst langsamer. Gar nicht reagiert = du berührst die Linie und hast verloren.</p>';
    h += '<p class="leise">Beide Fahrer bekommen denselben Ausbrecher zur selben Zeit. Da hat niemand Pech.</p></div>';

    h += '<div class="karte"><h3>5. Wer gewinnt</h3>';
    h += '<p>Die <b>Gesamtzeit</b> entscheidet: Reaktion plus Fahrzeit. Wer die Spur verlässt oder zu früh startet, verliert.</p>';
    h += '<p class="leise">Beide fahren im selben Rennen <b>dasselbe Auto</b>. Welches, das wechselt von Runde zu Runde. Die Lackierung darf sich jeder selbst aussuchen, sie ändert nichts.</p></div>';

    h += '<div class="karte"><h3>Die Autos</h3>';
    for (const a of autos.LISTE) {
      h += '<div class="auto-zeile"><span class="icon">' + a.icon + '</span><div class="txt"><b>' + esc(a.name) + '</b><small>' + esc(a.kurz) + '</small>';
      const wieOft = a.zuege[0] === a.zuege[1] ? a.zuege[0] + ' mal' : a.zuege[0] + ' bis ' + a.zuege[1] + ' mal';
      h += '<small class="leise">' + a.gaenge.length + ' Gänge · zieht ' + wieOft + ' zur Seite</small></div></div>';
    }
    return h + '</div>';
  }

  /* ----------------------------------------------------------------------
     Info
     ---------------------------------------------------------------------- */

  function info(funktionen) {
    let h = '<h1>Info</h1>';
    h += '<h2>Funktionen</h2>';
    for (const g of funktionen) {
      h += '<div class="karte"><h3>' + esc(g.title) + '</h3>';
      h += '<ul style="padding-left:20px">' + g.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
      h += '</div>';
    }
    h += '<h2>Datenschutz</h2>';
    h += '<div class="karte"><h3>Daten und Datenschutz</h3>';
    h += '<p>Gespeichert werden nur dein selbst gewählter Anzeigename, deine Lackierung und der Stand des laufenden Turniers. Die Anmeldung ist anonym — es gibt kein Konto, keine E-Mail-Adresse und keine Verbindung zu deinen Vereinsdaten. Firebase legt dafür in deinem Browser eine zufällige Kennung ab; sie bleibt, bis du die Website-Daten löschst.</p>';
    h += '<p>Es gibt keine Bestenliste. Zeiten und Tabelle leben nur, solange das Turnier läuft. Schließt der Gastgeber den Raum, werden Raum, Namen, Zeiten und Tabelle gelöscht. Macht er stattdessen nur den Browser zu, bleibt der Raum mit den Anzeigenamen in der Datenbank stehen. Wer sicher gehen will, tippt am Ende „Raum schließen".</p>';
    h += '<p>Die Spieldaten laufen über die Echtzeit-Datenbank von Google (Firebase), Rechenzentrum in Belgien. Wenn du das nicht möchtest, gib einen Spitznamen statt deines Namens ein.</p>';
    h += '<p class="leise">Verantwortlich: 1. SC 1911 Heiligenstadt e.V., Leineberg 2, 37308 Heilbad Heiligenstadt, <a href="mailto:info@sc1911-heiligenstadt.de" style="color:var(--akzent)">info@sc1911-heiligenstadt.de</a>. Auskunft, Berichtigung, Löschung und Widerspruch unter dieser Anschrift; Beschwerden beim Thüringer Landesbeauftragten für den Datenschutz und die Informationsfreiheit.</p>';
    h += '<p class="leise">„Viertelmeile" ist ein eigenständiges Spiel des Vereins. Es bildet keinen realen Rennsport und keine realen Fahrzeuge ab.</p></div>';
    return h;
  }

  return {
    esc: esc,
    zeit: zeit,
    nameVon: nameVon,
    kopf: kopf,
    reiter: reiter,
    start: start,
    lobby: lobby,
    warten: warten,
    ergebnis: ergebnis,
    stand: stand,
    tabelle: tabelle,
    baum: baum,
    ende: ende,
    alleinErgebnis: alleinErgebnis,
    hilfe: hilfe,
    info: info,
  };
})();
