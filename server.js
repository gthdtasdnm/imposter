// IMPOSTER – Deno-Server: statische Dateien + WebSocket + Kartenausgabe.
// Keine Abhaengigkeiten, kein Build-Schritt. `deno task dev` oder direkt:
//   deno run --allow-net --allow-read --allow-env --allow-sys server.js
//
// Raum, Host, Karenzzeit und Bremse sind Zeile fuer Zeile wie in „Ich hab noch
// nie". Der Spielteil daneben ist absichtlich winzig: **das Handy teilt nur
// Karten aus**. Es gibt keine Reihenfolge, keine Hinweisschritte, keine
// Abstimmung und keine Punkte – gespielt wird am Tisch, das Geraet haelt nur
// das Wort geheim. Deshalb auch kein „Bereit" und kein „Weiter": jeder Knopf,
// auf den die Runde warten muss, haelt eine Runde auf, die laengst weiterredet.

import { zieheBegriff } from "./begriffe.js";
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

const MAX_PLAYERS = 10;
// Drei genuegt jetzt. Frueher waren vier noetig, weil die Abstimmung auf dem
// Handy lief und zu dritt ein Muenzwurf gewesen waere – abgestimmt wird aber
// am Tisch, und wie viele daran sinnvoll sitzen, weiss der Tisch selbst.
const MIN_PLAYERS = 3;

const ROOM_IDLE_MS = 5 * 60_000;
const SEAT_GRACE_MS = 60_000;

// Das Hilfswort ist die einzige Kruecke des Imposters: **ein** Wort aus
// derselben Gruppe, nie das gesuchte. Ohne es weiss er gar nichts – das ist
// die harte Fassung. Der Host schaltet es in der Lobby an oder aus.
const HILFSWORT_STANDARD = true;

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

function createRoom(isPublic) {
  const room = {
    code: newCode(),
    isPublic: !!isPublic,
    phase: "lobby",
    hostId: null,
    players: new Map(),
    settings: { hilfswort: HILFSWORT_STANDARD },
    letzteGruppe: null,
    letzterImposter: null,
    rundeNr: 0,
    aktuell: null,
    timers: new Set(),
    idleTimer: null,
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
  for (const p of room.players.values()) {
    if (p.dropTimer) clearTimeout(p.dropTimer);
  }
  rooms.delete(room.code);
  pushRoomList();
}

function ensureHost(room) {
  const current = room.players.get(room.hostId);
  if (current?.connected) return;
  const all = [...room.players.values()];
  const next = all.find((p) => p.connected) ?? all[0];
  room.hostId = next ? next.id : null;
}

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
    hostId: room.hostId,
    settings: room.settings,
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

/**
 * Eine Runde austeilen. Das ist der ganze Spielteil: ein Wort fuer alle, einer
 * bekommt es nicht. Danach passiert auf dem Server nichts mehr, bis der Host
 * aufloest oder neu austeilt – dazwischen redet der Tisch.
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

  const { gruppe, begriffe, begriff } = zieheBegriff(room.letzteGruppe);
  room.letzteGruppe = gruppe;

  // Ein Wort aus derselben Gruppe, das **nicht** das gesuchte ist. Einmal pro
  // Runde gezogen und gemerkt: waere es bei jedem Senden neu, bekaeme der
  // Imposter bei jedem Zustandswechsel ein anderes zu sehen.
  const andere = begriffe.filter((w) => w !== begriff);
  const hilfswort = andere.length
    ? andere[Math.floor(Math.random() * andere.length)]
    : null;

  // Nicht zweimal hintereinander dieselbe Person – sonst hoert die Runde auf,
  // ueberhaupt zu verdaechtigen, sobald es einmal jemanden erwischt hat.
  const kandidaten = da.length > 1
    ? da.filter((p) => p.id !== room.letzterImposter)
    : da;
  const imposter = kandidaten[Math.floor(Math.random() * kandidaten.length)];
  room.letzterImposter = imposter.id;

  room.rundeNr++;
  room.phase = "runde";
  room.aktuell = {
    gruppe,
    begriff,
    hilfswort,
    imposterId: imposter.id,
    // Wer beim Austeilen da war. Wer spaeter dazukommt, bekommt kein Wort
    // mehr – sonst haette der Tisch mitten im Reden einen zweiten Mitwisser.
    dabei: new Set(da.map((p) => p.id)),
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
 * ganze Spiel: `begriff` nur an alle **ausser** den Imposter, `hilfswort` nur
 * an ihn.
 */
function karteFuer(room, p) {
  const cur = room.aktuell;
  const dabei = cur.dabei.has(p.id);
  const binImposter = dabei && p.id === cur.imposterId;
  const imposter = room.players.get(cur.imposterId);
  return {
    t: "karte",
    n: room.rundeNr,
    dabei,
    binImposter,
    begriff: dabei && !binImposter ? cur.begriff : null,
    hilfswort: binImposter && room.settings.hilfswort ? cur.hilfswort : null,
    aufgedeckt: cur.aufgedeckt,
    // Erst beim Aufloesen erfaehrt der Bildschirm, wer es war und wie das Wort
    // hiess. Vorher ist beides nie beim Client angekommen.
    ergebnis: cur.aufgedeckt
      ? {
        imposterId: cur.imposterId,
        imposterName: imposter?.name ?? "?",
        begriff: cur.begriff,
        gruppe: cur.gruppe,
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
  room.letzterImposter = null;
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
    const r = createRoom(msg.isPublic);
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

    case "settings": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if (typeof msg.hilfswort === "boolean") room.settings.hilfswort = msg.hilfswort;
      if (typeof msg.isPublic === "boolean") room.isPublic = msg.isPublic;
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

  if (immediate || room.phase === "lobby") {
    releaseSeat(room, player.id);
    return;
  }

  if (player.dropTimer) clearTimeout(player.dropTimer);
  player.dropTimer = setTimeout(() => releaseSeat(room, player.id), SEAT_GRACE_MS);

  ensureHost(room);
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
  pushKarten(room);
}

function releaseSeat(room, id) {
  const player = room.players.get(id);
  if (!player) return;
  if (player.dropTimer) { clearTimeout(player.dropTimer); player.dropTimer = null; }
  room.players.delete(id);
  ensureHost(room);

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

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!anwesende(room).length && now - room.lastActivity > 10 * 60_000) {
      destroyRoom(room);
    }
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
