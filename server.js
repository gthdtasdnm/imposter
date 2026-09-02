// IMPOSTER – Deno-Server: statische Dateien + WebSocket + Kartenausgabe.
// Keine Abhaengigkeiten, kein Build-Schritt. `deno task dev` oder direkt:
//   deno run --allow-net --allow-read --allow-env --allow-sys server.js
//
// Raum, Host, Karenzzeit und Bremse sind Zeile fuer Zeile wie in „Ich hab noch
// nie". Der Spielteil daneben ist absichtlich winzig: **das Handy teilt nur
// Karten aus**. Es gibt keine Hinweisschritte, keine Abstimmung und keine
// Punkte – gespielt wird am Tisch, das Geraet haelt nur das Wort geheim.
// Deshalb auch kein „Bereit" und kein „Weiter": jeder Knopf, auf den die Runde
// warten muss, haelt eine Runde auf, die laengst weiterredet.
//
// Zwei Dinge sagt es trotzdem an, weil sie sonst jede Runde neu ausdiskutiert
// werden: **wer anfaengt und wie herum es geht**. Das ist keine Reihenfolge,
// die der Server verwaltet – es ist ein Satz, den alle gleich lesen.

import { zieheBegriff } from "./begriffe.js";
import { STAPEL, ziehePaar } from "./paare.js";
import {
  absender,
  darfRaumOeffnen,
  darfVerbinden,
  raumVermerkt,
  verbindungAuf,
  verbindungZu,
} from "./bremse.js";

const PORT = Number(Deno.env.get("PORT") ?? 8073);
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";

const PUBLIC = new URL("./public/", import.meta.url);

// ---------------------------------------------------------------------------
// Spielkonstanten
// ---------------------------------------------------------------------------

// Zwei Betriebsarten. Sie unterscheiden sich in genau einer Sache – ob der
// Imposter weiss, dass er es ist:
//
//   klassisch  alle bekommen ein Wort, einer bekommt keins und weiss Bescheid.
//   blind      **jeder** bekommt ein Wort, eines davon ist ein anderes. Niemand
//              weiss, wer der Abweichler ist, auch der Abweichler nicht.
//
// Der Stapel gilt nur fuer „blind": die derben Woerter stehen in `paare.js` und
// sind dort ein **eigener** Stapel, der nie untergemischt wird. In der
// klassischen Art wird `paare.js` gar nicht erst angefasst.
const ARTEN = ["klassisch", "blind"];

const MAX_PLAYERS = 10;
// Drei genuegt jetzt. Frueher waren vier noetig, weil die Abstimmung auf dem
// Handy lief und zu dritt ein Muenzwurf gewesen waere – abgestimmt wird aber
// am Tisch, und wie viele daran sinnvoll sitzen, weiss der Tisch selbst.
const MIN_PLAYERS = 3;

// Ein Raum ueberlebt eine Kaffeepause.
//
// Wer sein Handy weglegt, den Bildschirm sperrt oder zwischendurch etwas
// anderes macht, ist die Regel und nicht die Ausnahme – und jedes Mal, wenn so
// jemand als *neuer* Spieler zurueckkam, spann der ganze Tisch: der Platz war
// weg, das Hostzeichen woanders, die Karte futsch. Deshalb bleibt der Platz
// reserviert, in **jeder** Phase, und zwar so lange, dass eine Zigarette,
// ein Anruf oder ein leerer Akku ihn nicht kostet. Zurueckkommen heisst dann:
// derselbe Platz, dieselbe Karte, dieselbe Runde – und der Rest hat nichts
// davon gemerkt.
//
// Endgueltig geht nur, wer selbst auf „Verlassen" tippt.
const ROOM_IDLE_MS = 30 * 60_000;    // leerer Raum bleibt so lange stehen
const SEAT_GRACE_MS = 20 * 60_000;   // Platz bleibt so lange reserviert
// Das Hostzeichen ist die eine Ausnahme: es muss wandern, sonst kann niemand
// mehr austeilen. Aber nicht sofort – eine Dreiviertelminute lang wartet der
// Tisch lieber, als dass das Zeichen bei jedem gesperrten Bildschirm springt.
// Ueber `HOST_MS` verkuerzbar – nicht fuer den Betrieb, sondern damit man den
// Wechsel von Hand nachstellen kann, ohne 45 Sekunden dazusitzen.
const HOST_GRACE_MS = (() => {
  const n = Number(Deno.env.get("HOST_MS"));
  return Number.isFinite(n) && n >= 200 ? n : 45_000;
})();

// ---------------------------------------------------------------------------
// Raeume
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rooms = new Map();

const browsing = new Set();

function newCode() {
  for (let i = 0; i < 500; i++) {
    let c = "";
    for (let k = 0; k < 4; k++) {
      c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(c)) return c;
  }
  return "R" + Date.now().toString(36).slice(-3).toUpperCase();
}

const token = () => crypto.randomUUID();

/** Einmal anlegen, nicht bei jedem Namen neu - das Ding ist teuer. */
const ZEICHEN = new Intl.Segmenter("de", { granularity: "grapheme" });

function cleanName(raw) {
  // Steuerzeichen raus, sonst zerlegt ein Zeilenumbruch im Namen das Layout.
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  // Nach *Zeichen* kuerzen, nicht nach Code-Einheiten. `s.slice(0, 12)` zaehlt
  // UTF-16-Einheiten, und ein Emoji besteht aus zweien: abgeschnitten wurde
  // mitten im Zeichen, und im Raum stand ein Ersatzzeichen. Zweite Grenze bei
  // 48 Code-Einheiten gegen gestapelte Kombinationszeichen - abgebrochen wird
  // zwischen zwei Zeichen, nie mittendrin. Gleiche Fassung wie in raum.js.
  let kurz = "";
  for (const z of [...ZEICHEN.segment(s)].slice(0, 12)) {
    if (kurz.length + z.segment.length > 48) break;
    kurz += z.segment;
  }
  return kurz || "Spieler";
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function createRoom(isPublic, art, stapel) {
  const room = {
    code: newCode(),
    isPublic: !!isPublic,
    art: ARTEN.includes(art) ? art : "klassisch",
    // Voreinstellung ist der harmlose Stapel – wer die derben Woerter will,
    // muss sie ausdruecklich einschalten und dabei einmal bestaetigen.
    stapel: STAPEL.includes(stapel) ? stapel : "harmlos",
    phase: "lobby",
    hostId: null,
    players: new Map(),
    letzteGruppe: null,
    letztesPaar: null,
    letzterImposter: null,
    letzterStarter: null,
    rundeNr: 0,
    aktuell: null,
    timers: new Set(),
    idleTimer: null,
    hostTimer: null,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function scheduleIdleClose(room) {
  if (room.idleTimer) clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(() => {
    if (room.players.size === 0) destroyRoom(room);
  }, ROOM_IDLE_MS);
}

function cancelIdleClose(room) {
  if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
}

function clearTimers(room) {
  for (const id of room.timers) clearTimeout(id);
  room.timers.clear();
}

function destroyRoom(room) {
  clearTimers(room);
  cancelIdleClose(room);
  cancelHostWacht(room);
  for (const p of room.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
  }
  rooms.delete(room.code);
  pushRoomList();
}

/**
 * Es muss immer einen Host geben – aber **nur**, wenn der bisherige gar keinen
 * Platz mehr hat. Wer nur gerade nicht verbunden ist, behaelt sein Zeichen;
 * darum kuemmert sich `hostWacht` mit einer Uhr. Frueher zog diese Funktion
 * das Zeichen sofort weiter, sobald der Host einmal kurz wegwar.
 */
function ensureHost(room) {
  if (room.players.has(room.hostId)) return;
  const all = [...room.players.values()];
  const next = all.find((p) => p.connected) ?? all[0];
  room.hostId = next ? next.id : null;
}

function cancelHostWacht(room) {
  if (room.hostTimer) { clearTimeout(room.hostTimer); room.hostTimer = null; }
}

/**
 * Der Host ist weg. Sein Zeichen wandert erst nach `HOST_GRACE_MS` weiter –
 * vorher gilt er als jemand, der kurz aufs Klo ist. Ist er vorher zurueck, hat
 * der Tisch nichts gemerkt. Nach jeder Aenderung an den Plaetzen einmal
 * aufrufen: die Uhr stellt sich selbst ab, sobald der Host wieder da ist.
 */
function hostWacht(room) {
  const host = room.players.get(room.hostId);
  if (host?.connected) { cancelHostWacht(room); return; }
  if (room.hostTimer) return;
  room.hostTimer = setTimeout(() => {
    room.hostTimer = null;
    if (room.players.get(room.hostId)?.connected) return;
    const naechster = anwesende(room)[0];
    // Niemand da, der uebernehmen koennte: das Zeichen bleibt liegen, wo es
    // ist. Der Naechste, der hereinkommt, startet die Uhr erneut.
    if (!naechster) return;
    room.hostId = naechster.id;
    pushState(room);
    pushRoomList();
  }, HOST_GRACE_MS);
}

/**
 * Steht in diesem Raum der 18+-Stapel? Nur wenn beides zusammenkommt – die
 * blinde Art **und** der derbe Stapel. Der Wert geht an den Client und in die
 * Raumliste: die Abfrage vor dem Beitritt ist der wichtigere der beiden Faelle,
 * dort hat man die Einstellung schliesslich nicht selbst getroffen.
 */
const istAb18 = (room) => room.art === "blind" && room.stapel === "derb";

const anwesende = (room) => [...room.players.values()].filter((p) => p.connected);

// ---------------------------------------------------------------------------
// Senden
// ---------------------------------------------------------------------------

function send(player, msg) {
  const ws = player.ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* Verbindung stirbt gleich sowieso */ }
  }
}

function raw(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* egal */ }
  }
}

function broadcast(room, msg) {
  for (const p of room.players.values()) send(p, msg);
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    host: p.id === room.hostId,
  }));
}

function roomState(room) {
  return {
    t: "room",
    code: room.code,
    isPublic: room.isPublic,
    phase: room.phase,
    art: room.art,
    stapel: room.stapel,
    ab18: istAb18(room),
    hostId: room.hostId,
    players: publicPlayers(room),
    rundeNr: room.rundeNr,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
  };
}

function pushState(room) {
  broadcast(room, roomState(room));
  if (room.isPublic) pushRoomList();
}

function roomList() {
  return [...rooms.values()]
    .map((r) => ({ room: r, count: anwesende(r).length }))
    .filter(({ room, count }) =>
      room.isPublic && room.phase === "lobby" &&
      count > 0 && room.players.size < MAX_PLAYERS
    )
    .map(({ room, count }) => ({
      code: room.code,
      host: room.players.get(room.hostId)?.name ?? "?",
      art: room.art,
      ab18: istAb18(room),
      count,
      max: MAX_PLAYERS,
      min: MIN_PLAYERS,
    }))
    .sort((a, b) => b.count - a.count);
}

function pushRoomList() {
  const msg = { t: "rooms", rooms: roomList() };
  for (const ws of browsing) raw(ws, msg);
}

// ---------------------------------------------------------------------------
// Spielablauf
// ---------------------------------------------------------------------------

/** Einer aus der Liste, moeglichst nicht derselbe wie beim letzten Mal. */
function zieheJemanden(leute, ausser) {
  const wahl = leute.length > 1 ? leute.filter((p) => p.id !== ausser) : leute;
  return wahl[Math.floor(Math.random() * wahl.length)];
}

/**
 * Eine Runde austeilen. Das ist der ganze Spielteil: ein Wort fuer alle, einer
 * bekommt es nicht, und dazu die Ansage, wer anfaengt und wie herum es geht.
 * Danach passiert auf dem Server nichts mehr, bis der Host aufloest oder neu
 * austeilt – dazwischen redet der Tisch.
 */
function neueRunde(room) {
  const da = anwesende(room);
  if (da.length < MIN_PLAYERS) {
    // Zu wenige da. Der Raumzustand bleibt stehen, bis jemand zurueckkommt.
    room.aktuell = null;
    room.phase = "lobby";
    pushState(room);
    return;
  }

  // Der einzige Unterschied zwischen den Arten steckt in diesen paar Zeilen:
  // welche Woerter gezogen werden. Alles danach – wer der Abweichler ist, wer
  // anfaengt, wie ausgeteilt wird – ist in beiden Arten dasselbe.
  let gruppe = null, begriff = null, sonderwort = null;
  if (room.art === "blind") {
    const { viele, einer, paar } = ziehePaar(room.stapel, room.letztesPaar);
    room.letztesPaar = paar;
    begriff = viele;
    sonderwort = einer;
  } else {
    const gezogen = zieheBegriff(room.letzteGruppe);
    gruppe = gezogen.gruppe;
    begriff = gezogen.begriff;
    room.letzteGruppe = gruppe;
  }

  // Nicht zweimal hintereinander dieselbe Person – sonst hoert die Runde auf,
  // ueberhaupt zu verdaechtigen, sobald es einmal jemanden erwischt hat.
  const imposter = zieheJemanden(da, room.letzterImposter);
  room.letzterImposter = imposter.id;

  // Wer anfaengt und wie herum es geht. Winzig, aber ohne die Ansage faengt
  // jede Runde mit derselben Diskussion an – und wer zuerst reden muss, hat es
  // am schwersten, das soll nicht immer denselben treffen.
  const starter = zieheJemanden(da, room.letzterStarter);
  room.letzterStarter = starter.id;
  const richtung = Math.random() < 0.5 ? "links" : "rechts";

  room.rundeNr++;
  room.phase = "runde";
  room.aktuell = {
    art: room.art,
    gruppe,
    begriff,
    // Nur in der blinden Art belegt: das abweichende Wort. Es geht an genau
    // einen Spieler und sonst an niemanden – auch nicht als Nebensatz in
    // irgendeiner anderen Nachricht.
    sonderwort,
    imposterId: imposter.id,
    starterId: starter.id,
    richtung,
    // Alle Plaetze des Raums, nicht nur die gerade verbundenen: wessen Handy
    // beim Austeilen zufaellig aus war, der findet seine Karte vor, wenn er
    // wieder hinsieht. Nur wer *spaeter* dazukommt, bekommt kein Wort mehr –
    // sonst haette der Tisch mitten im Reden einen zweiten Mitwisser.
    dabei: new Set(room.players.keys()),
    aufgedeckt: false,
  };
  // Erst die Karten, dann der Raumzustand: der Client zeichnet den
  // Spielbildschirm, sobald die Phase umspringt – laege dann noch die Karte
  // der letzten Runde da, blitzte sie kurz auf.
  pushKarten(room);
  pushState(room);
  pushRoomList();
}

/**
 * Die Karte geht an jeden einzeln – und das ist hier kein Detail, sondern das
 * ganze Spiel.
 *
 *   klassisch  `begriff` geht an alle **ausser** den Imposter, und der Imposter
 *              bekommt nichts als die Nachricht, dass er es ist.
 *   blind      jeder bekommt ein Wort, der Abweichler seines – und **niemand**
 *              bekommt `binImposter`. Wuerde hier auch nur ein `false` zu viel
 *              stehen, koennte man am eigenen Geraet ablesen, was man nicht
 *              wissen darf. Deshalb ist der Wert in dieser Art immer `false`,
 *              fuer alle, und die Wahrheit steht erst in der Aufloesung.
 */
function karteFuer(room, p) {
  const cur = room.aktuell;
  const blind = cur.art === "blind";
  const dabei = cur.dabei.has(p.id);
  const abweichler = dabei && p.id === cur.imposterId;
  const binImposter = !blind && abweichler;
  const imposter = room.players.get(cur.imposterId);
  const starter = room.players.get(cur.starterId);
  const meinWort = blind
    ? (dabei ? (abweichler ? cur.sonderwort : cur.begriff) : null)
    : (dabei && !abweichler ? cur.begriff : null);
  return {
    t: "karte",
    n: room.rundeNr,
    art: cur.art,
    dabei,
    binImposter,
    begriff: meinWort,
    // Kein Geheimnis: die Ansage ist fuer alle dieselbe und steht offen auf
    // dem Bildschirm, auch waehrend die Karte noch zugedeckt ist.
    ansage: {
      starterId: cur.starterId,
      starterName: starter?.name ?? "?",
      binStarter: p.id === cur.starterId,
      richtung: cur.richtung,
    },
    aufgedeckt: cur.aufgedeckt,
    // Erst beim Aufloesen erfaehrt der Bildschirm, wer es war und wie das Wort
    // hiess. Vorher ist beides nie beim Client angekommen.
    ergebnis: cur.aufgedeckt
      ? {
        imposterId: cur.imposterId,
        imposterName: imposter?.name ?? "?",
        begriff: cur.begriff,
        gruppe: cur.gruppe,
        sonderwort: cur.sonderwort,
      }
      : null,
  };
}

function pushKarten(room) {
  if (!room.aktuell) return;
  for (const p of room.players.values()) send(p, karteFuer(room, p));
}

function aufdecken(room) {
  const cur = room.aktuell;
  if (!cur || cur.aufgedeckt) return;
  cur.aufgedeckt = true;
  pushKarten(room);
}

function backToLobby(room) {
  clearTimers(room);
  room.phase = "lobby";
  room.aktuell = null;
  room.rundeNr = 0;
  room.letzteGruppe = null;
  room.letztesPaar = null;
  room.letzterImposter = null;
  room.letzterStarter = null;
  pushState(room);
  pushRoomList();
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------

function attach(ws, room, player) {
  browsing.delete(ws);
  cancelIdleClose(room);
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  ws._room = room;
  ws._player = player;
  player.ws = ws;
  player.connected = true;
  player.lastSeen = Date.now();
  ensureHost(room);
  // Ist der Host zurueck, stellt das die Uhr ab; ist er weiterhin weg und nun
  // jemand anders da, faengt sie an zu laufen.
  hostWacht(room);
  send(player, {
    t: "joined",
    you: player.id,
    token: player.token,
    code: room.code,
  });
  send(player, roomState(room));
  if (room.phase === "runde" && room.aktuell) send(player, karteFuer(room, player));
}

function makePlayer(name) {
  return {
    id: token(),
    token: token(),
    name: cleanName(name),
    ws: null,
    dropTimer: null,
    connected: true,
    lastSeen: Date.now(),
  };
}

function handle(ws, msg) {
  const room = ws._room;
  const player = ws._player;

  if (msg.t === "ping") {
    raw(ws, { t: "pong", c: msg.c, s: Date.now() });
    return;
  }

  if (msg.t === "browse") {
    if (!ws._room) {
      browsing.add(ws);
      raw(ws, { t: "rooms", rooms: roomList() });
    }
    return;
  }

  if (msg.t === "create") {
    if (room) return;
    if (!darfRaumOeffnen(ws._ip)) {
      return raw(ws, { t: "error", msg: "Zu viele Räume in kurzer Zeit. Warte kurz." });
    }
    raumVermerkt(ws._ip);
    const r = createRoom(msg.isPublic, msg.art, msg.stapel);
    const p = makePlayer(msg.name);
    r.hostId = p.id;
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    pushRoomList();
    return;
  }

  if (msg.t === "join") {
    if (room) return;
    const r = rooms.get(String(msg.code ?? "").toUpperCase().trim());
    if (!r) return raw(ws, { t: "error", msg: "Diesen Raum gibt es nicht" });

    if (msg.token) {
      const back = [...r.players.values()].find((p) => p.token === msg.token);
      if (back) {
        if (back.ws && back.ws !== ws && back.ws.readyState === WebSocket.OPEN) {
          try { back.ws.close(4001, "woanders geöffnet"); } catch { /* egal */ }
        }
        attach(ws, r, back);
        pushState(r);
        return;
      }
    }

    // Plaetze bleiben lange reserviert. Damit ein Raum daran nicht erstickt,
    // raeumt ein Neuling den am laengsten verwaisten Platz ab – aber erst,
    // wenn es sonst wirklich keinen freien mehr gibt.
    if (r.players.size >= MAX_PLAYERS) {
      const verwaist = [...r.players.values()]
        .filter((p) => !p.connected)
        .sort((a, b) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0))[0];
      if (verwaist) releaseSeat(r, verwaist.id);
    }
    if (r.players.size >= MAX_PLAYERS) {
      return raw(ws, { t: "error", msg: `Der Raum ist voll (${MAX_PLAYERS} Spieler)` });
    }
    const p = makePlayer(msg.name);
    r.players.set(p.id, p);
    attach(ws, r, p);
    pushState(r);
    return;
  }

  if (!room || !player) return;
  room.lastActivity = Date.now();

  switch (msg.t) {
    case "name":
      player.name = cleanName(msg.name);
      pushState(room);
      if (room.aktuell) pushKarten(room);
      break;

    // Drei Sachen: ob der Raum in der Liste steht, welche Betriebsart gilt und
    // – nur fuer die blinde Art – welcher Stapel. Alles nur im Warteraum und
    // nur vom Host: mitten in der Runde umzuschalten hiesse, dass die Haelfte
    // des Tisches mit Woertern aus dem einen und die andere aus dem anderen
    // Stapel dasitzt. Das Hilfswort ist am 19.08.2026 ersatzlos geflogen –
    // siehe README.
    case "settings": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if (typeof msg.isPublic === "boolean") room.isPublic = msg.isPublic;
      if (ARTEN.includes(msg.art)) room.art = msg.art;
      if (STAPEL.includes(msg.stapel)) room.stapel = msg.stapel;
      pushState(room);
      pushRoomList();
      break;
    }

    // Kein Bereit-Knopf, auf den der Host warten muesste: er teilt aus, wenn
    // der Tisch soweit ist. Das sieht er, er sitzt daneben.
    case "start": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if (anwesende(room).length < MIN_PLAYERS) break;
      room.rundeNr = 0;
      neueRunde(room);
      break;
    }

    // Der Tisch hat sich geeinigt: aufdecken, wer es war und wie das Wort hiess.
    case "aufloesen":
      if (player.id !== room.hostId || room.phase !== "runde") break;
      aufdecken(room);
      break;

    // Neu austeilen. Bewusst auch ohne vorheriges Aufloesen erlaubt – wenn
    // jemand sein Wort laut vorgelesen hat, ist die Runde hin, und dann will
    // niemand erst noch etwas aufdecken.
    case "neu":
      if (player.id !== room.hostId || room.phase !== "runde") break;
      neueRunde(room);
      break;

    case "ende":
      if (player.id !== room.hostId || room.phase !== "runde") break;
      backToLobby(room);
      break;

    case "leave":
      dropPlayer(ws, { immediate: true });
      break;
  }
}

function dropPlayer(ws, { immediate = false } = {}) {
  const room = ws._room;
  const player = ws._player;
  browsing.delete(ws);
  if (!room || !player) return;
  ws._room = null;
  ws._player = null;

  player.connected = false;
  player.ws = null;
  player.lastSeen = Date.now();

  // Endgueltig geht nur, wer selbst auf „Verlassen" getippt hat. Alles andere
  // – gesperrter Bildschirm, weggewischter Tab, Funkloch, leerer Akku – ist
  // eine Pause, und eine Pause kostet den Platz nicht. Frueher gab der
  // Warteraum ihn sofort frei; wer wiederkam, sass auf einem neuen Platz und
  // der Host womoeglich woanders.
  if (immediate) {
    releaseSeat(room, player.id);
    return;
  }

  if (player.dropTimer) clearTimeout(player.dropTimer);
  player.dropTimer = setTimeout(() => releaseSeat(room, player.id), SEAT_GRACE_MS);

  hostWacht(room);
  // Ist niemand mehr da, faengt die Uhr des leeren Raums an zu laufen. Sie
  // wird von `attach` wieder abgeraeumt, sobald der Erste zurueck ist.
  if (!anwesende(room).length) scheduleIdleClose(room);
  pushState(room);
  pushRoomList();
}

/**
 * Jemand ist endgueltig weg. Fuer die Runde heisst das fast nichts – es gibt
 * nichts, worauf sie warten koennte. Nur wenn ausgerechnet der Imposter geht,
 * hat sie kein Ziel mehr und wird neu ausgeteilt.
 *
 * Der blosse Verbindungsabriss macht das ausdruecklich **nicht**: auf dem
 * Handy stirbt die Verbindung schon, wenn man kurz die Nachrichten-App
 * aufmacht. Wuerde das neu austeilen, waere das Spiel unspielbar.
 */
function ohneIhnWeiter(room, id) {
  const cur = room.aktuell;
  if (!cur) return;
  if (cur.imposterId === id && !cur.aufgedeckt) {
    room.rundeNr--;
    room.letzterImposter = null;
    neueRunde(room);
    return;
  }
  cur.dabei.delete(id);
  // War es der Angesagte, bekommt die Runde einen neuen Anfang – sonst stuende
  // dort der Name von jemandem, der gar nicht mehr am Tisch sitzt.
  if (cur.starterId === id) {
    const da = anwesende(room);
    if (da.length) {
      const neu = zieheJemanden(da, null);
      cur.starterId = neu.id;
      room.letzterStarter = neu.id;
    }
  }
  pushKarten(room);
}

function releaseSeat(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  room.players.delete(id);
  ensureHost(room);
  hostWacht(room);

  if (room.players.size === 0) {
    backToLobby(room);
    scheduleIdleClose(room);
    pushRoomList();
    return;
  }

  if (room.phase === "runde" && room.aktuell) ohneIhnWeiter(room, id);

  pushState(room);
  pushRoomList();
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.split("/").some((seg) => seg === "..")) {
    return new Response("Nope", { status: 400 });
  }
  const url = new URL(rel, PUBLIC);
  if (!url.href.startsWith(PUBLIC.href)) {
    return new Response("Nope", { status: 400 });
  }
  try {
    const body = await Deno.readFile(url);
    const ext = rel.slice(rel.lastIndexOf("."));
    return new Response(body, {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "cache-control": "no-cache",
      },
    });
  } catch {
    return new Response("Nicht gefunden", { status: 404 });
  }
}

Deno.serve({ port: PORT, hostname: HOST }, (req, info) => {
  const url = new URL(req.url);

  if (url.pathname === "/ws" || url.pathname.endsWith("/ws")) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket erwartet", { status: 400 });
    }
    const ip = absender(req, info);
    if (!darfVerbinden(ip)) {
      return new Response("Zu viele Verbindungen", { status: 429 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket._ip = ip;
    let gezaehlt = false;
    const abmelden = () => {
      if (!gezaehlt) return;
      gezaehlt = false;
      verbindungZu(ip);
    };
    socket.onopen = () => { gezaehlt = true; verbindungAuf(ip); };
    socket.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === "string") {
        // Lebenszeichen fuer die Geisterwache weiter unten.
        if (socket._player) socket._player.lastSeen = Date.now();
        try {
          handle(socket, msg);
        } catch (err) {
          console.error("Fehler beim Verarbeiten:", err);
        }
      }
    };
    socket.onclose = () => { abmelden(); dropPlayer(socket); };
    socket.onerror = () => { abmelden(); dropPlayer(socket); };
    return response;
  }

  return serveStatic(url.pathname);
});

// Sicherheitsnetz gegen liegengebliebene Raeume – etwa wenn ein Timer beim
// Neustart des Dienstes verlorenging. Es darf niemandem den Platz wegnehmen,
// deshalb die grosszuegige Grenze: erst wenn selbst ein reservierter Platz
// laengst abgelaufen waere, ist der Raum wirklich tot.
const RAUM_TOT_MS = ROOM_IDLE_MS + SEAT_GRACE_MS;

setInterval(() => {
  const jetzt = Date.now();
  for (const room of [...rooms.values()]) {
    if (anwesende(room).length) continue;
    const zuletzt = Math.max(
      room.lastActivity ?? 0,
      ...[...room.players.values()].map((p) => p.lastSeen ?? 0),
    );
    if (jetzt - zuletzt > RAUM_TOT_MS) destroyRoom(room);
  }
}, 60_000);


/**
 * Die Geisterwache. Gleiche Regel wie in `gemeinsam/raum.js`, hier von Hand:
 * ein Socket, der offen aussieht und keiner mehr ist, ist auf dem Handy der
 * Normalfall - wer wegwischt oder den Bildschirm sperrt, schickt kein FIN.
 * Steht so ein Geist auf dem Hostplatz, wartet die ganze Lobby auf einen
 * Startknopf, den niemand mehr druecken kann (Bugreport 4).
 *
 * `connected` allein ist deshalb kein Nachweis. Der Client meldet sich alle
 * 25 s mit `ping`, auch wenn niemand spielt; jede eingehende Nachricht
 * stempelt `lastSeen`. Wer zwei Pings lang schweigt, wird behandelt wie einer,
 * dessen Verbindung ordentlich zuging.
 */
const GEIST_MS = (() => {
  const n = Number(Deno.env.get("GEIST_MS"));
  return Number.isFinite(n) && n >= 1000 ? n : 65_000;
})();

setInterval(() => {
  const jetzt = Date.now();
  for (const room of [...rooms.values()]) {
    for (const player of [...room.players.values()]) {
      if (!player.connected || !player.ws) continue;
      if (jetzt - (player.lastSeen ?? jetzt) <= GEIST_MS) continue;
      const ws = player.ws;
      try { ws.close(4002, "stumm"); } catch { /* war ja schon tot */ }
      dropPlayer(ws);
    }
  }
}, Math.max(5_000, Math.floor(GEIST_MS / 4)));

console.log(`IMPOSTER läuft auf http://${HOST}:${PORT}/`);
