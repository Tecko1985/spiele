/* ==========================================================================
   Werwolf — Bildschirme
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

  function mmss(sek) {
    sek = Math.max(0, sek | 0);
    const m = Math.floor(sek / 60), s = sek % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  const TEAM_TEXT = { dorf: 'Du gehörst zum Dorf.', wolf: 'Du gehörst zu den Werwölfen.', weiss: 'Du spielst allein.', floete: 'Du spielst allein.' };

  /* ----------------------------------------------------------------------
     Kopf und Reiter
     ---------------------------------------------------------------------- */

  function kopf(z) {
    const code = z && z.code ? '<span class="code">' + esc(z.code) + '</span>' : '';
    return '<div class="titel"><a href="../index.html" aria-label="Zurück zum Spiele-Hub">‹</a>🐺 Werwolf</div>' + code;
  }

  function reiter(z, ui) {
    const im = z && z.code;
    const liste = im
      ? [['spiel', 'Spiel'], ['uebersicht', 'Übersicht'], ['regeln', 'Regeln'], ['info', 'Info']]
      : [['spiel', 'Start'], ['regeln', 'Regeln'], ['info', 'Info']];
    return liste.map(function (r) {
      return '<button data-aktion="reiter" data-reiter="' + r[0] + '" class="' + (ui.reiter === r[0] ? 'aktiv' : '') + '">' + r[1] + '</button>';
    }).join('');
  }

  /* ----------------------------------------------------------------------
     Start
     ---------------------------------------------------------------------- */

  function start(z, ui) {
    let h = '<h1 class="mitte">🐺 Werwolf</h1>';
    h += '<p class="leise mitte">Die Werwölfe von Düsterwald am eigenen Handy. Die App ist der Erzähler.</p>';

    if (ui.formular === 'neu') {
      h += '<div class="karte akzent"><h2>Neues Spiel</h2>';
      h += '<label class="schalter"><div class="txt">Ich spiele selbst mit<small>Aus: Dieses Gerät ist nur der Erzähler und liegt in der Mitte.</small></div>';
      h += '<input type="checkbox" id="spieltMit" ' + (ui.spieltMit !== false ? 'checked' : '') + '></label>';
      h += '<label class="feld" for="name">Dein Name</label><input type="text" id="name" maxlength="24" autocomplete="off" value="' + esc(z.gemerkterName || '') + '" placeholder="Spitzname reicht">';
      h += '<button class="btn primaer" data-aktion="raumErstellen">Raum eröffnen</button>';
      h += '<button class="btn leise" data-aktion="formular" data-formular="">Abbrechen</button></div>';
    } else if (ui.formular === 'beitreten') {
      h += '<div class="karte akzent"><h2>Beitreten</h2>';
      h += '<label class="feld" for="code">Raum-Code</label><input type="text" id="code" class="code-feld" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="ABC123">';
      h += '<label class="feld" for="name">Dein Name</label><input type="text" id="name" maxlength="24" autocomplete="off" value="' + esc(z.gemerkterName || '') + '" placeholder="Spitzname reicht">';
      h += '<button class="btn primaer" data-aktion="raumBeitreten">Beitreten</button>';
      h += '<button class="btn leise" data-aktion="formular" data-formular="">Abbrechen</button></div>';
    } else {
      if (z.gemerkterCode) h += '<button class="btn primaer" data-aktion="fortsetzen">Spiel fortsetzen (' + esc(z.gemerkterCode) + ')</button>';
      h += '<button class="btn ' + (z.gemerkterCode ? '' : 'primaer') + '" data-aktion="formular" data-formular="neu">Neues Spiel eröffnen</button>';
      h += '<button class="btn" data-aktion="formular" data-formular="beitreten">Einem Spiel beitreten</button>';
      h += '<p class="leise mitte" style="margin-top:20px">Jeder braucht sein eigenes Handy. Einer eröffnet, die anderen tippen den Code ein. Mindestens ' + gameService.MIN_SPIELER + ' Spieler.</p>';
    }
    h += einstellungenLokal();
    return h;
  }

  function einstellungenLokal() {
    let h = '<div class="karte"><h3>Dieses Gerät</h3>';
    h += '<label class="schalter"><div class="txt">Ansagen vorlesen<small>' + (sprecher.kannSprechen() ? 'Nur das Erzähler-Gerät spricht.' : 'Dieses Gerät kann nicht sprechen.') + '</small></div><input type="checkbox" data-einstellung="sprache" ' + (sprecher.hole('sprache') ? 'checked' : '') + '></label>';
    h += '<label class="schalter"><div class="txt">Vibration<small>Wenn du dran bist. iPhone kann das nicht.</small></div><input type="checkbox" data-einstellung="vibration" ' + (sprecher.hole('vibration') ? 'checked' : '') + '></label>';
    h += '<label class="schalter"><div class="txt">Helles Design</div><input type="checkbox" data-einstellung="hell" ' + (sprecher.hole('hell') ? 'checked' : '') + '></label>';
    h += '</div>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Lobby
     ---------------------------------------------------------------------- */

  function lobby(z, ui) {
    const raum = z.raum;
    const liste = z.spielerListe;
    const zus = raum.zusammenstellung || {};
    const p = rollen.pruefe(liste.length, zus);
    let h = '';

    h += '<div class="karte akzent mitte"><p class="leise">Raum-Code — die anderen tippen ihn ein</p><div class="riesig">' + esc(z.code) + '</div>';
    h += '<p class="leise">' + (z.istHost ? (z.spieltMit ? 'Du bist Erzähler und spielst mit.' : 'Dieses Gerät ist nur der Erzähler.') : 'Warte, bis der Erzähler startet.') + '</p></div>';

    h += '<h2>Spieler (' + liste.length + ')</h2><ul class="liste">';
    liste.forEach(function (s, i) {
      h += '<li><span class="leise" style="min-width:24px">' + (i + 1) + '.</span><span class="name">' + esc(s.name) + (s.uid === z.uid ? ' <span class="leise">(du)</span>' : '') + '</span>';
      if (z.istHost) {
        h += '<button class="mini" data-aktion="spielerHoch" data-uid="' + esc(s.uid) + '" aria-label="nach oben" ' + (i === 0 ? 'disabled' : '') + '>↑</button>';
        h += '<button class="mini" data-aktion="spielerRunter" data-uid="' + esc(s.uid) + '" aria-label="nach unten" ' + (i === liste.length - 1 ? 'disabled' : '') + '>↓</button>';
        h += '<button class="mini rot" data-aktion="spielerRaus" data-uid="' + esc(s.uid) + '" aria-label="entfernen">✕</button>';
      }
      h += '</li>';
    });
    h += '</ul>';
    if (liste.length < gameService.MIN_SPIELER) h += '<div class="hinweis info">Noch ' + (gameService.MIN_SPIELER - liste.length) + ' fehlen. Sitzreihenfolge = Reihenfolge hier.</div>';

    h += '<h2>Rollen (' + p.karten + ' von ' + p.soll + ')</h2>';
    if (z.istHost) h += '<button class="btn klein" data-aktion="empfehlung">Empfehlung für ' + liste.length + ' Spieler laden</button>';
    h += '<div class="karte">';
    for (const r of rollen.LISTE) {
      const n = zus[r.id] | 0;
      if (!z.istHost && n === 0) continue;
      h += '<div class="rollen-zeile"><span class="icon">' + r.icon + '</span><div class="txt">' + esc(r.name) + '<small>' + esc(r.beschreibung) + '</small></div>';
      if (z.istHost) {
        h += '<button class="mini" data-aktion="rolleMinus" data-rolle="' + r.id + '" aria-label="weniger" ' + (n === 0 ? 'disabled' : '') + '>−</button>';
        h += '<span class="zahl">' + n + '</span>';
        h += '<button class="mini" data-aktion="rollePlus" data-rolle="' + r.id + '" aria-label="mehr" ' + (n >= r.max ? 'disabled' : '') + '>+</button>';
      } else {
        h += '<span class="zahl">' + n + '</span>';
      }
      h += '</div>';
    }
    h += '</div>';

    const b = rollen.balance(zus);
    const pos = Math.max(5, Math.min(95, 50 + b * 4));
    h += '<div class="balance"><span class="leise">Wölfe</span><div class="balken"><div class="marke" style="left:' + pos + '%"></div></div><span class="leise">Dorf</span></div>';
    for (const f of p.fehler) h += '<div class="hinweis warn">' + esc(f) + '</div>';
    for (const w of p.warnungen) h += '<div class="hinweis info">' + esc(w) + '</div>';

    if (z.istHost) {
      const e = raum.einstellungen || {};
      h += '<h2>Einstellungen</h2><div class="karte">';
      h += '<div class="schalter"><div class="txt">Diskussionszeit</div><select data-einstellung-raum="diskussionSek">' +
        [0, 60, 120, 180, 300, 420, 600].map(function (s) { return '<option value="' + s + '" ' + (e.diskussionSek === s ? 'selected' : '') + '>' + (s === 0 ? 'ohne Uhr' : (s / 60) + ' Min') + '</option>'; }).join('') + '</select></div>';
      h += '<label class="schalter"><div class="txt">Rollen der Toten aufdecken</div><input type="checkbox" data-einstellung-raum="rollenAufdecken" ' + (e.rollenAufdecken !== false ? 'checked' : '') + '></label>';
      h += '<div class="schalter"><div class="txt">Gleichstand<small>Mit Sündenbock im Spiel stirbt immer er.</small></div><select data-einstellung-raum="gleichstand">' +
        '<option value="stichwahl" ' + (e.gleichstand !== 'niemand' ? 'selected' : '') + '>Stichwahl</option><option value="niemand" ' + (e.gleichstand === 'niemand' ? 'selected' : '') + '>Niemand stirbt</option></select></div>';
      h += '<div class="schalter"><div class="txt">Wartezeit je Rolle<small>So lange steht jeder Nachtaufruf mindestens — auch für tote Rollen, damit nichts verrät, wer noch lebt.</small></div><select data-einstellung-raum="wartezeitSek">' +
        [10, 15, 20, 30, 45].map(function (s) { return '<option value="' + s + '" ' + (e.wartezeitSek === s ? 'selected' : '') + '>' + s + ' s</option>'; }).join('') + '</select></div>';
      h += '</div>';
      h += '<button class="btn primaer" data-aktion="starten" ' + (p.ok && liste.length >= gameService.MIN_SPIELER ? '' : 'disabled') + '>Spiel starten</button>';
    }
    h += '<button class="btn gefahr" data-aktion="verlassen">' + (z.istHost ? 'Raum schließen' : 'Raum verlassen') + '</button>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Rollenvergabe
     ---------------------------------------------------------------------- */

  function rollenkarte(privat, ui) {
    const r = rollen.rolle(privat.rolle);
    let extra = '';
    if (privat.mitwoelfe && privat.mitwoelfe.length) extra += '<div class="extra">Mit dir heulen: ' + privat.mitwoelfe.map(function (w) { return esc(w.name); }).join(', ') + '</div>';
    if (privat.verliebtMit) extra += '<div class="extra">💞 Du bist verliebt in ' + esc(privat.verliebtMit.name) + '</div>';
    return '<div class="rollenkarte ' + (ui.kartenOffen ? 'offen' : '') + '" id="rollenkarte">' +
      '<div class="rueckseite"><div class="symbol">🂠</div><div class="gross">Halten zum Sehen</div><div class="leise">Finger drauf lassen — loslassen verdeckt wieder.</div></div>' +
      '<div class="vorderseite"><div class="icon">' + r.icon + '</div><div class="rname">' + esc(r.name) + '</div><div class="team">' + TEAM_TEXT[r.team] + '</div><div class="beschreibung">' + esc(r.beschreibung) + '</div>' + extra + '</div>' +
      '</div>';
  }

  function rollenPhase(z, ui) {
    const sicht = z.sicht;
    let h = '<h1>Deine Rolle</h1>';
    if (!z.privat) {
      h += '<div class="karte mitte"><p class="leise">' + (z.spieltMit ? 'Die Karten werden verteilt …' : 'Die Spieler sehen sich ihre Rollen an.') + '</p></div>';
    } else {
      h += rollenkarte(z.privat, ui);
      if (!ui.rolleGesehen) h += '<button class="btn primaer" data-aktion="rolleGesehen">Ich habe meine Rolle gesehen</button>';
      else h += '<div class="hinweis ok">Gemerkt. Warte auf die anderen.</div>';
    }
    h += '<p class="leise mitte">' + (sicht.bereit || 0) + ' von ' + sicht.spieler.length + ' haben ihre Rolle gesehen.</p>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Nacht
     ---------------------------------------------------------------------- */

  function wahlListe(kandidaten, gewaehlt, aktion, extra) {
    let h = '<ul class="wahl">';
    for (const k of kandidaten) {
      const ist = gewaehlt.indexOf(k.uid) >= 0;
      h += '<li><button data-aktion="' + aktion + '" data-uid="' + esc(k.uid) + '" class="' + (ist ? 'gewaehlt' : '') + '"><span class="n">' + esc(k.name) + '</span>' + (extra && extra[k.uid] ? '<span class="z">' + esc(extra[k.uid]) + '</span>' : '') + '</button></li>';
    }
    h += '</ul>';
    return h;
  }

  function nacht(z, ui) {
    const sicht = z.sicht;
    const p = z.privat;
    const schritt = sicht.schritt;
    let h = '';

    if (p && p.dran && p.aufgabe && p.lebt) return aufgabe(z, ui);

    h += '<div class="nachtbild"><div class="mond">🌙</div><h1>Nacht ' + sicht.nachtNr + '</h1>';
    if (schritt) h += '<div class="schritt">' + schritt.icon + ' ' + esc(schritt.name) + ' ist wach</div>';
    if (p && p.hinweis) h += '<div class="hinweis info" style="margin-top:16px">' + esc(p.hinweis) + '</div>';
    else if (p && !p.lebt) h += '<p class="leise">Du bist tot. Schau zu, aber verrate nichts.</p>';
    else h += '<p class="leise">Augen zu. Dein Handy sagt dir, wenn du dran bist.</p>';
    h += '</div>';
    if (p && p.lebt) h += '<div class="karte"><p class="leise">Du bist ' + rollen.rolle(p.rolle).icon + ' ' + esc(p.rolleName) + '.</p></div>';
    return h;
  }

  function aufgabe(z, ui) {
    const p = z.privat;
    const a = p.aufgabe;
    const k = a.kandidaten || [];
    let h = '<div class="aufgabe"><h2>' + rollen.rolle(p.rolle).icon + ' ' + esc(p.rolleName) + ', du bist dran</h2>';

    switch (a.schritt) {
      case 'dieb':
        h += '<p>Die zwei übrigen Karten. Nimm eine oder behalte den Dieb.' + (a.mussTauschen ? ' <strong>Beide sind Werwölfe — du musst eine nehmen.</strong>' : '') + '</p>';
        if (a.fertig) { h += '<div class="hinweis ok">Entschieden.</div>'; break; }
        a.karten.forEach(function (kt, i) {
          h += '<button class="btn" data-aktion="diebKarte" data-idx="' + i + '">' + kt.icon + ' ' + esc(kt.name) + ' nehmen</button>';
        });
        if (!a.mussTauschen) h += '<button class="btn leise" data-aktion="diebBehalten">Dieb behalten</button>';
        break;

      case 'amor':
        h += '<p>Wähle zwei Spieler, die sich verlieben. Du darfst dich selbst wählen.</p>';
        if (a.fertig) { h += '<div class="hinweis ok">Verkuppelt.</div>'; break; }
        h += wahlListe(k, ui.auswahl, 'auswahl');
        h += '<button class="btn primaer" data-aktion="amorBestaetigen" ' + (ui.auswahl.length === 2 ? '' : 'disabled') + '>Verkuppeln</button>';
        break;

      case 'verliebte':
        h += '<div class="karte akzent mitte"><div style="font-size:60px">💞</div><p class="gross">Du bist verliebt in ' + esc(p.verliebtMit ? p.verliebtMit.name : '?') + '</p><p class="leise">Stirbt einer von euch, stirbt der andere mit.' + (p.verliebtMit ? '' : '') + '</p></div>';
        break;

      case 'beschuetzer':
        h += '<p>Wen beschützt du in dieser Nacht? Nicht denselben wie letzte Nacht.</p>';
        if (a.fertig) { h += '<div class="hinweis ok">Beschützt.</div>'; break; }
        h += wahlListe(k, ui.auswahl, 'auswahl');
        h += '<button class="btn primaer" data-aktion="einzelBestaetigen" data-art="beschuetzer" ' + (ui.auswahl.length === 1 ? '' : 'disabled') + '>Beschützen</button>';
        break;

      case 'werwolf': {
        h += '<p>Wählt gemeinsam ein Opfer. Ihr seht die Stimmen der anderen Wölfe. Bei Gleichstand stirbt niemand.</p>';
        const extra = {};
        for (const uid in (a.stimmen || {})) {
          const st = a.stimmen[uid];
          if (st.ziel) extra[st.ziel] = (extra[st.ziel] ? extra[st.ziel] + ', ' : '') + st.name;
        }
        const eigene = a.eingabe && a.eingabe.ziel ? [a.eingabe.ziel] : [];
        h += wahlListe(k, eigene, 'wolfStimme', extra);
        if (p.mitwoelfe && p.mitwoelfe.length) h += '<p class="leise">Mit dir: ' + p.mitwoelfe.filter(function (w) { return w.lebt; }).map(function (w) { return esc(w.name); }).join(', ') + '</p>';
        break;
      }

      case 'weisserWerwolf':
        h += '<p>Willst du in dieser Nacht einen Werwolf töten?</p>';
        if (a.fertig) { h += '<div class="hinweis ok">Entschieden.</div>'; break; }
        h += wahlListe(k, ui.auswahl, 'auswahl');
        h += '<button class="btn primaer" data-aktion="einzelBestaetigen" data-art="weisserWerwolf" ' + (ui.auswahl.length === 1 ? '' : 'disabled') + '>Töten</button>';
        h += '<button class="btn leise" data-aktion="einzelLeer" data-art="weisserWerwolf">Niemanden</button>';
        break;

      case 'hexe':
        h += '<div class="karte ' + (a.opfer ? 'rot' : '') + '"><p class="leise">Die Wölfe haben gerissen:</p><p class="gross">' + (a.opfer ? esc(a.opfer.name) : 'niemanden') + '</p></div>';
        if (a.fertig) { h += '<div class="hinweis ok">Entschieden.</div>'; break; }
        if (a.heil && a.opfer) {
          h += '<label class="schalter"><div class="txt">🧪 Heiltrank einsetzen<small>Rettet ' + esc(a.opfer.name) + '. Nur einmal im Spiel.</small></div><input type="checkbox" data-aktion-change="hexeHeilen" ' + (ui.hexeHeilen ? 'checked' : '') + '></label>';
        } else if (!a.heil) h += '<p class="leise">Dein Heiltrank ist verbraucht.</p>';
        if (a.gift) {
          h += '<h3>☠️ Gifttrank (einmal im Spiel)</h3><p class="leise">Antippen zum Vergiften, nochmal antippen zum Zurücknehmen.</p>';
          h += wahlListe(k, ui.hexeGift ? [ui.hexeGift] : [], 'hexeGift');
        } else h += '<p class="leise">Dein Gifttrank ist verbraucht.</p>';
        h += '<button class="btn primaer" data-aktion="hexeBestaetigen">' + ((ui.hexeHeilen || ui.hexeGift) ? 'So machen' : 'Nichts tun') + '</button>';
        break;

      case 'seherin':
        if (a.ergebnis) {
          h += '<div class="karte akzent mitte"><p class="leise">' + esc(a.ergebnis.name) + ' ist</p><div style="font-size:60px">' + a.ergebnis.icon + '</div><p class="gross">' + esc(a.ergebnis.rolleName) + '</p></div>';
          if (!a.fertig) h += '<button class="btn primaer" data-aktion="seherinFertig">Gesehen</button>';
          else h += '<div class="hinweis ok">Gemerkt.</div>';
          break;
        }
        h += '<p>Wessen Rolle willst du sehen?</p>';
        h += wahlListe(k, ui.auswahl, 'auswahl');
        h += '<button class="btn primaer" data-aktion="einzelBestaetigen" data-art="seherin" ' + (ui.auswahl.length === 1 ? '' : 'disabled') + '>Ansehen</button>';
        break;

      case 'floetenspieler':
        h += '<p>Verzaubere ' + a.anzahl + ' Spieler.</p>';
        if (a.fertig) { h += '<div class="hinweis ok">Verzaubert.</div>'; break; }
        h += wahlListe(k, ui.auswahl, 'auswahl');
        h += '<button class="btn primaer" data-aktion="floeteBestaetigen" ' + (ui.auswahl.length === a.anzahl ? '' : 'disabled') + '>Verzaubern</button>';
        break;

      case 'verzauberte':
        h += '<div class="karte akzent mitte"><div style="font-size:60px">🎶</div><p class="gross">Du bist verzaubert</p>';
        if (a.mitverzauberte && a.mitverzauberte.length) h += '<p>Ebenfalls verzaubert: ' + a.mitverzauberte.map(function (x) { return esc(x.name); }).join(', ') + '</p>';
        h += '<p class="leise">Sind alle Lebenden verzaubert, gewinnt der Flötenspieler.</p></div>';
        break;
    }
    h += '</div>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Tag
     ---------------------------------------------------------------------- */

  function toteListe(tote, ueberschrift) {
    if (!tote || !tote.length) return '<div class="karte mitte"><p class="gross">Niemand ist gestorben.</p></div>';
    let h = '<div class="karte rot">' + (ueberschrift ? '<h3>' + ueberschrift + '</h3>' : '') + '<ul class="tote-liste">';
    for (const t of tote) {
      h += '<li>☠️ <strong>' + esc(t.name) + '</strong>' + (t.rolleName ? ' <span class="rolle">— ' + esc(t.rolleName) + '</span>' : '') + '<div class="rolle">' + esc(t.ursacheText) + '</div></li>';
    }
    h += '</ul></div>';
    return h;
  }

  function tag(z, ui) {
    const sicht = z.sicht;
    const t = sicht.tag;
    const p = z.privat;
    let h = '<h1>☀️ Tag ' + sicht.nachtNr + '</h1>';

    switch (t.schritt) {
      case 'morgen':
        h += '<p class="leise">Der Morgen bricht an.</p>';
        h += toteListe(t.tote, 'In der Nacht gestorben');
        if (sicht.dorfOhneFaehigkeit) h += '<div class="hinweis warn">Das Dorf hat den Alten getötet — alle Dorfrollen haben ihre Fähigkeiten verloren.</div>';
        break;

      case 'ergebnis':
        if (t.meldung) h += '<div class="karte"><p class="gross">' + esc(t.meldung) + '</p></div>';
        h += toteListe(t.tote);
        if (sicht.dorfOhneFaehigkeit) h += '<div class="hinweis warn">Das Dorf hat den Alten getötet — alle Dorfrollen haben ihre Fähigkeiten verloren.</div>';
        break;

      case 'jaeger':
        if (p && p.jaeger) {
          h += '<div class="karte akzent"><h2>🏹 Dein letzter Schuss</h2><p>Du stirbst — aber du nimmst jemanden mit. Wen?</p>';
          h += wahlListe(p.jaeger.kandidaten, ui.auswahl, 'auswahl');
          h += '<button class="btn primaer" data-aktion="jaegerSchuss" ' + (ui.auswahl.length === 1 ? '' : 'disabled') + '>Schießen</button></div>';
        } else {
          h += '<div class="karte rot mitte"><div style="font-size:60px">🏹</div><p class="gross">' + esc(t.meldung || 'Der Jäger schießt.') + '</p><p class="leise">' + esc(t.jaegerName || '') + ' zielt …</p></div>';
        }
        break;

      case 'diskussion':
        h += '<div class="karte mitte"><p class="leise">Diskussion</p>';
        if (sicht.regeln.diskussionSek > 0) h += '<div class="uhr ' + (z.restDiskussion <= 30 ? 'knapp' : '') + '">' + mmss(z.restDiskussion) + '</div>';
        h += '<p>Wer ist der Werwolf? Redet, verdächtigt, verteidigt euch.</p></div>';
        break;

      case 'abstimmung':
      case 'stichwahl': {
        h += '<div class="karte"><p class="gross">' + (t.schritt === 'stichwahl' ? 'Stichwahl' : 'Abstimmung') + '</p>';
        if (t.meldung && t.schritt === 'stichwahl') h += '<p class="leise">' + esc(t.meldung) + '</p>';
        h += '<p class="leise">Offene Wahl: alle sehen, wer wen wählt. Du kannst umstimmen, bis der Erzähler schließt.</p></div>';
        const lebende = sicht.spieler.filter(function (s) { return s.lebt; });
        const kand = t.kandidaten ? lebende.filter(function (s) { return t.kandidaten.indexOf(s.uid) >= 0; }) : lebende;
        const zaehler = {};
        const wer = {};
        for (const w in (t.stimmen || {})) {
          const ziel = t.stimmen[w];
          if (!ziel) continue;
          zaehler[ziel] = (zaehler[ziel] || 0) + 1;
          const ws = sicht.spieler.find(function (s) { return s.uid === w; });
          wer[ziel] = (wer[ziel] ? wer[ziel] + ', ' : '') + (ws ? ws.name : '?');
        }
        const extra = {};
        for (const uid in zaehler) extra[uid] = zaehler[uid] + ' ' + (zaehler[uid] === 1 ? 'Stimme' : 'Stimmen') + ': ' + wer[uid];
        const darf = p && p.stimmeAbgeben;
        const meine = p && p.meineStimme ? [p.meineStimme] : [];
        if (darf) h += wahlListe(kand, meine, 'stimme', extra);
        else {
          h += '<ul class="wahl">' + kand.map(function (k) { return '<li><button disabled><span class="n">' + esc(k.name) + '</span>' + (extra[k.uid] ? '<span class="z">' + esc(extra[k.uid]) + '</span>' : '') + '</button></li>'; }).join('') + '</ul>';
          if (p && !p.lebt) h += '<p class="leise mitte">Tote stimmen nicht ab.</p>';
        }
        const abgegeben = Object.keys(t.stimmen || {}).length;
        h += '<p class="leise mitte">' + abgegeben + ' von ' + lebende.length + ' haben gestimmt.</p>';
        break;
      }
    }
    return h;
  }

  /* ----------------------------------------------------------------------
     Ende
     ---------------------------------------------------------------------- */

  function ende(z) {
    const sicht = z.sicht;
    const e = sicht.ende;
    const SYMBOL = { dorf: '🏘️', wolf: '🐺', weiss: '🐺', floete: '🎶', verliebte: '💞', niemand: '💀' };
    let h = '<div class="sieger"><div class="symbol">' + (SYMBOL[e.sieger] || '🏁') + '</div><h1>' + esc(e.siegerName) + '</h1><p class="gross">' + esc(e.text) + '</p>';
    const gewinner = sicht.spieler.filter(function (s) { return e.gewinner.indexOf(s.uid) >= 0; });
    if (gewinner.length) h += '<p>Gewonnen haben: ' + gewinner.map(function (s) { return esc(s.name); }).join(', ') + '</p>';
    if (z.privat) h += '<p class="leise">' + (e.gewinner.indexOf(z.uid) >= 0 ? '🎉 Du hast gewonnen!' : 'Du hast verloren.') + '</p>';
    h += '</div>';

    h += '<h2>Alle Rollen</h2><ul class="liste">';
    for (const s of sicht.spieler) {
      const r = rollen.rolle(s.rolle);
      h += '<li class="' + (s.lebt ? '' : 'tot') + '"><span class="icon">' + (r ? r.icon : '') + '</span><span class="name">' + esc(s.name) + (s.verliebt ? ' 💞' : '') + '</span><span class="rolle">' + esc(s.rolleName || '') + (s.lebt ? '' : ' · †') + '</span></li>';
    }
    h += '</ul>';

    h += '<h2>Chronik</h2><div class="karte">' + chronik(sicht.chronik) + '</div>';
    if (z.istHost) {
      h += '<button class="btn primaer" data-aktion="neueRunde">Nochmal mit derselben Runde</button>';
      h += '<button class="btn gefahr" data-aktion="verlassen">Raum schließen</button>';
    } else {
      h += '<p class="leise mitte">Der Erzähler kann eine neue Runde starten — bleib im Raum.</p>';
      h += '<button class="btn gefahr" data-aktion="verlassen">Raum verlassen</button>';
    }
    return h;
  }

  function chronik(liste) {
    if (!liste || !liste.length) return '<p class="leise">Noch nichts passiert.</p>';
    return '<ul class="chronik">' + liste.map(function (c) { return '<li><span class="wo">' + esc(c.wo) + '</span><span>' + esc(c.text) + '</span></li>'; }).join('') + '</ul>';
  }

  /* ----------------------------------------------------------------------
     Übersicht
     ---------------------------------------------------------------------- */

  function uebersicht(z) {
    const sicht = z.sicht;
    const raum = z.raum;
    let h = '<h1>Übersicht</h1>';
    if (!sicht) {
      h += '<p class="leise">Die Partie hat noch nicht begonnen.</p>';
      return h;
    }
    const erz = z.erzaehlerSicht;
    h += '<p class="leise">' + (sicht.phase === 'nacht' ? 'Nacht ' : sicht.phase === 'tag' ? 'Tag ' : '') + sicht.nachtNr + ' · ' + sicht.spieler.filter(function (s) { return s.lebt; }).length + ' von ' + sicht.spieler.length + ' leben</p>';
    if (erz) h += '<div class="hinweis info">Du bist nur Erzähler — du siehst alle Rollen. Zeig das niemandem.</div>';
    h += '<ul class="liste">';
    sicht.spieler.forEach(function (s) {
      let rolleText = s.rolleName || '';
      let icon = s.rolle ? rollen.rolle(s.rolle).icon : (s.lebt ? '🙂' : '☠️');
      if (erz) {
        const es = erz.spieler.find(function (x) { return x.uid === s.uid; });
        if (es) { rolleText = rollen.name(es.rolle) + (es.verliebt ? ' 💞' : '') + (es.verzaubert ? ' 🎶' : ''); icon = rollen.rolle(es.rolle).icon; }
      }
      h += '<li class="' + (s.lebt ? '' : 'tot') + '"><span class="icon">' + icon + '</span><span class="name">' + esc(s.name) + '</span><span class="rolle">' + esc(rolleText) + (s.lebt ? '' : ' · ' + esc(s.gestorben || '†')) + '</span>';
      if (z.istHost && s.lebt && sicht.phase !== 'ende') h += '<button class="mini rot" data-aktion="toeten" data-uid="' + esc(s.uid) + '" data-name="' + esc(s.name) + '" aria-label="aus dem Spiel nehmen">✕</button>';
      h += '</li>';
    });
    h += '</ul>';
    if (z.istHost && sicht.phase !== 'ende') h += '<p class="leise">✕ nimmt einen Spieler aus dem Spiel (Handy leer, gegangen). Er gilt dann als tot.</p>';

    h += '<h2>Rollen im Spiel</h2><div class="karte">';
    for (const r of rollen.LISTE) { const n = (sicht.zusammenstellung || {})[r.id] | 0; if (n) h += '<div>' + r.icon + ' ' + n + '× ' + esc(r.name) + '</div>'; }
    h += '</div>';
    if (erz && erz.uebrigeKarten && erz.uebrigeKarten.length) h += '<p class="leise">Übrige Karten (Dieb): ' + erz.uebrigeKarten.map(function (k) { return esc(rollen.name(k)); }).join(', ') + '</p>';
    h += '<h2>Chronik</h2><div class="karte">' + chronik(sicht.chronik) + '</div>';
    if (raum && raum.phase !== 'lobby') h += '<button class="btn gefahr" data-aktion="verlassen">' + (z.istHost ? 'Raum schließen' : 'Raum verlassen') + '</button>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Regeln und Info
     ---------------------------------------------------------------------- */

  function regelnSeite() {
    let h = '<h1>Regeln</h1>';
    h += '<div class="karte"><p>Ein Dorf, darin versteckt ein paar Werwölfe. Nachts reißen die Wölfe einen Dorfbewohner, tagsüber berät das Dorf und verurteilt einen Verdächtigen. <strong>Das Dorf gewinnt</strong>, wenn alle Wölfe tot sind. <strong>Die Wölfe gewinnen</strong>, wenn sie mindestens so viele sind wie der Rest.</p>';
    h += '<p>Jeder spielt am eigenen Handy. Das Erzähler-Gerät sagt an, wer wach wird; nur auf dem Handy dieser Rolle erscheint dann die Auswahl. Alle anderen halten die Augen zu.</p></div>';
    h += '<h2>Nachtreihenfolge</h2><div class="karte"><p>Erste Nacht zusätzlich: Dieb → Amor → Verliebte erkennen sich.</p><p>Jede Nacht: Beschützer → Werwölfe (das Mädchen darf blinzeln) → Weißer Werwolf (jede zweite Nacht) → Hexe → Seherin → Flötenspieler.</p><p class="leise">Aufgelöst wird erst nach der letzten Rolle: Schutz vor Heiltrank vor Wolfsangriff vor Gift, dann Verliebte und Jäger.</p></div>';
    h += '<h2>Rollen</h2><div class="karte">';
    for (const r of rollen.LISTE) h += '<div class="rollen-zeile"><span class="icon">' + r.icon + '</span><div class="txt">' + esc(r.name) + ' <span class="leise">· ' + (r.team === 'dorf' ? 'Dorf' : r.team === 'wolf' ? 'Werwölfe' : 'allein') + '</span><small>' + esc(r.beschreibung) + '</small></div></div>';
    h += '</div>';
    h += '<h2>Sieg</h2><div class="karte"><ul style="padding-left:20px;margin:0"><li>Verliebte aus zwei Lagern gewinnen, wenn nur noch sie beide leben — das schlägt alles andere.</li><li>Der Weiße Werwolf gewinnt, wenn er als Einziger übrig ist. Sonst zählt er als Wolf.</li><li>Der Flötenspieler gewinnt, wenn alle anderen Lebenden verzaubert sind.</li><li>Das Dorf gewinnt, wenn alle Wölfe tot sind.</li><li>Die Wölfe gewinnen, wenn sie mindestens so viele sind wie der Rest.</li></ul></div>';
    h += '<h2>Gleichstand</h2><div class="karte"><p>Lebt ein Sündenbock, stirbt er an Stelle der Kandidaten. Sonst gibt es je nach Einstellung eine Stichwahl (wieder gleich: niemand stirbt) oder es stirbt gleich niemand.</p></div>';
    h += '<h2>Empfehlung</h2><div class="karte"><p>5–7 Spieler: 1–2 Wölfe, Seherin, Hexe.<br>8–11: 2 Wölfe, dazu Jäger und Amor.<br>12–15: 3 Wölfe, dazu Beschützer und Mädchen.<br>16+: 4 Wölfe, dazu der Alte und Sündenbock.</p></div>';
    return h;
  }

  // Was das Spiel kann. Steht seit 07.09.2026 an der Stelle, an der bis dahin
  // die Aenderungsliste stand: der Info-Reiter zeigt den Zustand, nicht die
  // Historie. Quelle ist FUNKTIONEN in app.js; CHANGELOG bleibt dort gepflegt
  // und wird nur nicht mehr gezeichnet. Die Fassungsnummer stand als Fussnote
  // unter der Liste und ist mit ihr weg.
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
    h += '<p>Gespeichert werden nur dein selbst gewählter Anzeigename und der Spielstand der laufenden Partie. Die Anmeldung ist anonym — es gibt kein Konto, keine E-Mail-Adresse und keine Verbindung zu deinen Vereinsdaten. Firebase legt dafür in deinem Browser eine zufällige Kennung ab; sie bleibt, bis du die Website-Daten löschst.</p>';
    h += '<p>Schließt der Erzähler den Raum, werden Raum, Namen und Spielstand gelöscht. Macht er stattdessen nur den Browser zu, bleibt der Raum mit den Anzeigenamen in der Datenbank stehen. Wer sicher gehen will, tippt am Ende „Raum schließen".</p>';
    h += '<p>Die Spieldaten laufen über die Echtzeit-Datenbank von Google (Firebase), Rechenzentrum in Belgien. Wenn du das nicht möchtest, gib einen Spitznamen statt deines Namens ein.</p>';
    h += '<p class="leise">Verantwortlich: 1. SC 1911 Heiligenstadt e.V., Leineberg 2, 37308 Heilbad Heiligenstadt, <a href="mailto:info@sc1911-heiligenstadt.de" style="color:var(--akzent)">info@sc1911-heiligenstadt.de</a>. Auskunft, Berichtigung, Löschung und Widerspruch unter dieser Anschrift; Beschwerden beim Thüringer Landesbeauftragten für den Datenschutz und die Informationsfreiheit.</p>';
    h += '<p class="leise">„Werwolf" ist ein eigenständiges Spiel des Vereins nach dem bekannten Gesellschaftsspiel-Prinzip. Es steht in keiner Verbindung zum Verlag von „Die Werwölfe von Düsterwald".</p></div>';
    return h;
  }

  /* ----------------------------------------------------------------------
     Erzähler-Leiste
     ---------------------------------------------------------------------- */

  function erzaehlerLeiste(z, ui) {
    if (!z.istHost || !z.raum || z.raum.phase !== 'laeuft' || !z.sicht) return '';
    const sicht = z.sicht;
    let h = '<div class="inner">';
    if (ui.ansage) h += '<div class="ansage"><span class="punkt"></span><span>' + esc(ui.ansage) + '</span></div>';

    if (sicht.phase === 'rollen') {
      h += '<button class="btn primaer" data-aktion="nachtBeginnen" ' + (z.alleBereit ? '' : 'disabled') + '>' + (z.alleBereit ? 'Erste Nacht beginnen' : 'Warte, bis alle ihre Rolle gesehen haben') + '</button>';
      if (!z.alleBereit) h += '<button class="btn klein leise" data-aktion="nachtBeginnen" data-erzwingen="1">Trotzdem beginnen</button>';
    } else if (sicht.phase === 'nacht') {
      const s = sicht.schritt;
      if (s) {
        h += '<div class="leise">' + s.icon + ' ' + esc(s.name) + ' · ' + (z.restWartezeit > 0 ? 'noch ' + z.restWartezeit + ' s' : (z.schrittFertig ? 'fertig, geht gleich weiter' : 'wartet auf Eingabe')) + '</div>';
        if (z.restWartezeit <= 0 && !z.schrittFertig) h += '<button class="btn klein" data-aktion="ueberspringen">Überspringen (keine Eingabe)</button>';
      }
    } else if (sicht.phase === 'tag') {
      const t = sicht.tag;
      if (t.schritt === 'morgen' || t.schritt === 'ergebnis') h += '<button class="btn primaer" data-aktion="weiter">Weiter</button>';
      else if (t.schritt === 'jaeger') h += '<button class="btn klein" data-aktion="jaegerUeberspringen">Jäger überspringen (nicht mehr da)</button>';
      else if (t.schritt === 'diskussion') h += '<button class="btn primaer" data-aktion="weiter">Zur Abstimmung</button>';
      else if (t.schritt === 'abstimmung' || t.schritt === 'stichwahl') h += '<button class="btn primaer" data-aktion="weiter">Abstimmung schließen</button>';
    }
    h += '</div>';
    return h;
  }

  return {
    esc: esc,
    kopf: kopf,
    reiter: reiter,
    start: start,
    lobby: lobby,
    rollenPhase: rollenPhase,
    nacht: nacht,
    tag: tag,
    ende: ende,
    uebersicht: uebersicht,
    regelnSeite: regelnSeite,
    info: info,
    erzaehlerLeiste: erzaehlerLeiste,
  };
})();
