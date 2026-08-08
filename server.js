// IMPOSTER – Deno-Server: statische Dateien + WebSocket + Rundenlogik.
// Keine Abhaengigkeiten, kein Build-Schritt. `deno task dev` oder direkt:
//   deno run --allow-net --allow-read --allow-env --allow-sys server.js
//
// Raum, Host, Bereit, Karenzzeit und Bremse sind Zeile fuer Zeile wie in „Ich
// hab noch nie". Eigen ist alles ab „Spielablauf" – und das ist hier mehr als
// bei den anderen: eine Runde hat fuenf Schritte statt zwei.

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
// Vier ist die untere Grenze, nicht drei: zu dritt hat der Imposter nur zwei
// Hinweise zum Anlehnen, und die Abstimmung ist ein Muenzwurf zwischen zwei
// Verdaechtigen.
const MIN_PLAYERS = 4;

const ROOM_IDLE_MS = 5 * 60_000;
const SEAT_GRACE_MS = 60_000;

const RUNDEN_OPTIONEN = [5, 8, 12, 0]; // 0 = ohne festes Ende
const HINWEIS_OPTIONEN = [1, 2];       // wie oft jeder drankommt

// Punkte. Bewusst so, dass ein erwischter Imposter mit einem guten Rateschluss
// nicht genauso gut dasteht wie einer, der gar nicht erst aufgefallen ist.
const PUNKTE_IMPOSTER_ENTKOMMEN = 2;
const PUNKTE_IMPOSTER_GERATEN = 1;
const PUNKTE_GRUPPE = 1;

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

function cleanName(raw) {
  // Steuerzeichen raus, sonst zerlegt ein Zeilenumbruch im Namen das Layout.
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s.slice(0, 12) || "Spieler";
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
    settings: { rounds: 8, hinweise: 1 },
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
    punkte: p.punkte,
    ready: p.ready,
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

function startGame(room) {
  clearTimers(room);
  room.phase = "playing";
  room.rundeNr = 0;
  room.letzteGruppe = null;
  room.letzterImposter = null;
  for (const p of room.players.values()) {
    p.punkte = 0;
    p.malImposter = 0;
    p.entkommen = 0;
    p.ready = false;
  }
  pushState(room);
  naechsteRunde(room);
  pushRoomList();
}

function naechsteRunde(room) {
  clearTimers(room);
  const rounds = room.settings.rounds;
  if (rounds > 0 && room.rundeNr >= rounds) return finishGame(room);

  const da = anwesende(room);
  if (da.length < MIN_PLAYERS) {
    // Zu wenige da – ohne genug Verdaechtige gibt die Runde nichts her.
    // Der Raumzustand bleibt stehen, bis jemand zurueckkommt.
    room.aktuell = null;
    pushState(room);
    return;
  }

  const { gruppe, begriffe, begriff } = zieheBegriff(room.letzteGruppe);
  room.letzteGruppe = gruppe;

  // Nicht zweimal hintereinander dieselbe Person – sonst hoert die Runde auf,
  // ueberhaupt zu verdaechtigen, sobald es einmal jemanden erwischt hat.
  const kandidaten = da.length > 1
    ? da.filter((p) => p.id !== room.letzterImposter)
    : da;
  const imposter = kandidaten[Math.floor(Math.random() * kandidaten.length)];
  room.letzterImposter = imposter.id;
  imposter.malImposter++;

  room.rundeNr++;
  room.aktuell = {
    gruppe,
    begriffe,
    begriff,
    imposterId: imposter.id,
    // Jede Runde neu gemischt: waere es die Sitzordnung, saesse der Imposter
    // auf Dauer immer an derselben Stelle in der Reihe.
    reihenfolge: shuffle(da.map((p) => p.id)),
    gesehen: new Set(),
    schritt: "rollen",
    hinweisIdx: 0,
    stimmen: new Map(),
    erkannt: false,
    verdaechtigtId: null,
    geraten: null,
    ratenRichtig: false,
    ergebnis: null,
  };
  pushRunde(room);
}

/** Wer gerade einen Hinweis sagen muss. */
function amHinweis(room) {
  const cur = room.aktuell;
  if (!cur) return null;
  const reihe = cur.reihenfolge.filter((id) => room.players.get(id)?.connected);
  if (!reihe.length) return null;
  return reihe[cur.hinweisIdx % reihe.length];
}

/**
 * Der Rundenzustand geht an jeden einzeln – und das ist hier keine Feinheit,
 * sondern das ganze Spiel: `begriff` darf nur an alle **ausser** den Imposter,
 * `binImposter` nur an ihn.
 */
function pushRunde(room) {
  const cur = room.aktuell;
  if (!cur) return;
  const reihe = cur.reihenfolge.filter((id) => room.players.get(id)?.connected);
  const dranId = amHinweis(room);
  const dran = dranId ? room.players.get(dranId) : null;
  const gesamtSchritte = reihe.length * room.settings.hinweise;

  for (const p of room.players.values()) {
    const binImposter = p.id === cur.imposterId;
    send(p, {
      t: "runde",
      n: room.rundeNr,
      total: room.settings.rounds,
      gruppe: cur.gruppe,
      // Die Wortliste sehen alle, auch der Imposter. Ohne sie koennte er nach
      // einem Satz nichts mehr sagen – und am Ende nicht sinnvoll raten.
      begriffe: cur.begriffe,
      // Der Begriff selbst: nur an die Gruppe.
      begriff: binImposter ? null : cur.begriff,
      binImposter,
      schritt: cur.schritt,
      gesehen: cur.gesehen.size,
      gesehenGesamt: reihe.length,
      habGesehen: cur.gesehen.has(p.id),
      reihenfolge: reihe.map((id) => ({
        id,
        name: room.players.get(id)?.name ?? "?",
      })),
      dranId,
      dranName: dran?.name ?? null,
      hinweisNr: cur.hinweisIdx + 1,
      hinweisGesamt: gesamtSchritte,
      stimmenAb: cur.stimmen.size,
      stimmenGesamt: reihe.length,
      meineStimme: cur.stimmen.get(p.id) ?? null,
      ergebnis: cur.ergebnis,
    });
  }
}

/** Alle haben ihre Karte gesehen? Dann kann die Hinweisrunde losgehen. */
function pruefeGesehen(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt !== "rollen") return;
  const reihe = cur.reihenfolge.filter((id) => room.players.get(id)?.connected);
  if (reihe.length && reihe.every((id) => cur.gesehen.has(id))) {
    cur.schritt = "hinweise";
  }
  pushRunde(room);
}

/** Ein Hinweis ist gesagt – weiter an den Naechsten oder ab zur Abstimmung. */
function naechsterHinweis(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt !== "hinweise") return;
  const reihe = cur.reihenfolge.filter((id) => room.players.get(id)?.connected);
  const gesamt = reihe.length * room.settings.hinweise;
  cur.hinweisIdx++;
  if (cur.hinweisIdx >= gesamt) {
    cur.schritt = "abstimmen";
  }
  pushRunde(room);
}

function pruefeStimmen(room) {
  const cur = room.aktuell;
  if (!cur || cur.schritt !== "abstimmen") return;
  const reihe = cur.reihenfolge.filter((id) => room.players.get(id)?.connected);
  if (reihe.length && reihe.every((id) => cur.stimmen.has(id))) {
    auswerten(room);
  } else {
    pushRunde(room);
  }
}

/**
 * Abstimmung auswerten. Erwischt ist der Imposter nur, wenn er **allein** oben
 * steht: bei Gleichstand hat sich die Runde nicht geeinigt, und dann ist er
 * durchgekommen.
 */
function auswerten(room) {
  const cur = room.aktuell;
  if (!cur || (cur.schritt !== "abstimmen")) return;
  clearTimers(room);

  const zaehler = new Map();
  for (const id of cur.reihenfolge) {
    if (room.players.get(id)?.connected) {
      zaehler.set(id, { id, name: room.players.get(id).name, stimmen: 0, waehler: [] });
    }
  }
  for (const [waehlerId, zielId] of cur.stimmen) {
    const e = zaehler.get(zielId);
    if (!e) continue;
    e.stimmen++;
    const w = room.players.get(waehlerId);
    if (w) e.waehler.push(w.name);
  }
  const sortiert = [...zaehler.values()].sort((a, b) => b.stimmen - a.stimmen);
  const hoechst = sortiert[0]?.stimmen ?? 0;
  const spitze = sortiert.filter((e) => e.stimmen === hoechst && hoechst > 0);

  cur.stimmenTabelle = sortiert;
  cur.verdaechtigtId = spitze.length === 1 ? spitze[0].id : null;
  cur.erkannt = cur.verdaechtigtId === cur.imposterId;

  if (cur.erkannt) {
    // Erwischt – aber er darf noch einmal raten.
    cur.schritt = "raten";
    pushRunde(room);
  } else {
    abrechnen(room);
  }
}

/** Punkte vergeben und die Auflösung zeigen. */
function abrechnen(room) {
  const cur = room.aktuell;
  if (!cur) return;
  const imposter = room.players.get(cur.imposterId);

  if (!cur.erkannt) {
    if (imposter) {
      imposter.punkte += PUNKTE_IMPOSTER_ENTKOMMEN;
      imposter.entkommen++;
    }
  } else if (cur.ratenRichtig) {
    if (imposter) imposter.punkte += PUNKTE_IMPOSTER_GERATEN;
  } else {
    for (const id of cur.reihenfolge) {
      const p = room.players.get(id);
      // Bewusst ohne `connected`: wer die Runde mitgespielt hat, bekommt
      // seinen Punkt auch dann, wenn die Verbindung im letzten Moment haengt.
      if (p && p.id !== cur.imposterId) p.punkte += PUNKTE_GRUPPE;
    }
  }

  cur.ergebnis = {
    imposterId: cur.imposterId,
    imposterName: imposter?.name ?? "?",
    begriff: cur.begriff,
    gruppe: cur.gruppe,
    erkannt: cur.erkannt,
    verdaechtigtId: cur.verdaechtigtId,
    verdaechtigtName: cur.verdaechtigtId
      ? room.players.get(cur.verdaechtigtId)?.name ?? "?"
      : null,
    geraten: cur.geraten,
    ratenRichtig: cur.ratenRichtig,
    tabelle: cur.stimmenTabelle ?? [],
  };
  cur.schritt = "aufloesung";
  pushRunde(room);
  pushState(room);
}

function finishGame(room) {
  clearTimers(room);
  room.phase = "final";
  const gespielt = room.aktuell && room.aktuell.schritt !== "aufloesung"
    ? room.rundeNr - 1
    : room.rundeNr;
  room.aktuell = null;
  const tabelle = [...room.players.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      punkte: p.punkte,
      malImposter: p.malImposter,
      entkommen: p.entkommen,
    }))
    .sort((a, b) => b.punkte - a.punkte || b.entkommen - a.entkommen);
  for (const p of room.players.values()) p.ready = false;
  broadcast(room, { t: "final", tabelle, runden: Math.max(gespielt, 0) });
  pushState(room);
  pushRoomList();
}

function backToLobby(room) {
  clearTimers(room);
  room.phase = "lobby";
  room.aktuell = null;
  room.rundeNr = 0;
  room.letzteGruppe = null;
  room.letzterImposter = null;
  for (const p of room.players.values()) {
    p.ready = false;
    p.punkte = 0;
    p.malImposter = 0;
    p.entkommen = 0;
  }
  pushState(room);
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
  ensureHost(room);
  send(player, {
    t: "joined",
    you: player.id,
    token: player.token,
    code: room.code,
  });
  send(player, roomState(room));
  if (room.phase === "playing" && room.aktuell) pushRunde(room);
}

function makePlayer(name, ready) {
  return {
    id: token(),
    token: token(),
    name: cleanName(name),
    ws: null,
    dropTimer: null,
    punkte: 0,
    malImposter: 0,
    entkommen: 0,
    ready,
    connected: true,
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
    const p = makePlayer(msg.name, true);
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
    if (r.phase !== "lobby") {
      return raw(ws, { t: "error", msg: "Die Runde läuft schon" });
    }
    const p = makePlayer(msg.name, false);
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
      if (room.aktuell) pushRunde(room);
      break;

    case "ready":
      player.ready = !!msg.value;
      pushState(room);
      break;

    case "settings": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      if (RUNDEN_OPTIONEN.includes(msg.rounds)) room.settings.rounds = msg.rounds;
      if (HINWEIS_OPTIONEN.includes(msg.hinweise)) room.settings.hinweise = msg.hinweise;
      if (typeof msg.isPublic === "boolean") room.isPublic = msg.isPublic;
      pushState(room);
      pushRoomList();
      break;
    }

    case "start": {
      if (player.id !== room.hostId || room.phase !== "lobby") break;
      const da = anwesende(room);
      if (da.length < MIN_PLAYERS) break;
      if (!da.every((p) => p.ready || p.id === room.hostId)) break;
      startGame(room);
      break;
    }

    // „Karte gesehen" – erst wenn alle gedrückt haben, geht es los. Sonst
    // fängt jemand an zu reden, während ein anderer noch nicht weiß, wer er ist.
    case "gesehen": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "rollen") break;
      cur.gesehen.add(player.id);
      pruefeGesehen(room);
      break;
    }

    case "hinweis": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "hinweise") break;
      if (player.id !== amHinweis(room) && player.id !== room.hostId) break;
      naechsterHinweis(room);
      break;
    }

    // Der Host kann die Hinweisrunde abkürzen, wenn die Runde schon weiß, was
    // sie denkt.
    case "abstimmung": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "hinweise") break;
      if (player.id !== room.hostId) break;
      cur.schritt = "abstimmen";
      pushRunde(room);
      break;
    }

    case "stimme": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      const ziel = room.players.get(String(msg.ziel ?? ""));
      if (!ziel || !ziel.connected) break;
      // Sich selbst zu verdächtigen wäre ein kostenloser Freispruch.
      if (ziel.id === player.id) break;
      cur.stimmen.set(player.id, ziel.id);
      pruefeStimmen(room);
      break;
    }

    case "aufloesen": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "abstimmen") break;
      if (player.id !== room.hostId) break;
      auswerten(room);
      break;
    }

    // Erwischt – der Imposter rät den Begriff. Nur er, und nur einmal.
    case "raten": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "raten") break;
      if (player.id !== cur.imposterId) break;
      const wahl = String(msg.begriff ?? "");
      if (!cur.begriffe.includes(wahl)) break;
      cur.geraten = wahl;
      cur.ratenRichtig = wahl === cur.begriff;
      abrechnen(room);
      break;
    }

    // Der Imposter haengt beim Raten – der Host bricht ab, das zaehlt als
    // danebengeraten. Ohne diesen Ausgang stuende die Runde bis zum Ablauf
    // der Karenzzeit.
    case "ratenAufgeben": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "raten") break;
      if (player.id !== room.hostId) break;
      const imposter = room.players.get(cur.imposterId);
      if (imposter?.connected) break;
      cur.geraten = null;
      cur.ratenRichtig = false;
      abrechnen(room);
      break;
    }

    case "weiter": {
      const cur = room.aktuell;
      if (!cur || cur.schritt !== "aufloesung") break;
      if (player.id !== room.hostId) break;
      naechsteRunde(room);
      break;
    }

    case "ende":
      if (player.id !== room.hostId || room.phase !== "playing") break;
      finishGame(room);
      break;

    case "again":
      if (player.id !== room.hostId || room.phase !== "final") break;
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
  player.ready = false;

  if (immediate || room.phase === "lobby") {
    releaseSeat(room, player.id);
    return;
  }

  if (player.dropTimer) clearTimeout(player.dropTimer);
  player.dropTimer = setTimeout(() => releaseSeat(room, player.id), SEAT_GRACE_MS);

  ensureHost(room);
  weiterOhne(room, player.id, false);
  pushState(room);
  pushRoomList();
}

/**
 * Jemand ist weg – die Runde darf nicht auf ihn warten. Je nach Schritt heisst
 * das etwas anderes, deshalb an einer Stelle gebuendelt.
 *
 * `endgueltig` unterscheidet den abgerissenen Socket vom wirklichen Weggehen.
 * Der Unterschied ist wichtiger, als er aussieht: auf dem Handy stirbt die
 * Verbindung schon, wenn man kurz die Nachrichten-App aufmacht. Wuerde das die
 * Runde abbrechen, waere das Spiel unspielbar.
 */
function weiterOhne(room, id, endgueltig) {
  const cur = room.aktuell;
  if (!cur) return;

  // Der Imposter ist endgueltig weg: die Runde hat kein Ziel mehr, sie wird
  // nicht gewertet und neu ausgegeben. Bei einem blossen Verbindungsabriss
  // passiert das ausdruecklich *nicht* – die Runde laeuft ohne ihn weiter, und
  // alle Wartepruefungen zaehlen ohnehin nur Verbundene.
  if (endgueltig && cur.imposterId === id && cur.schritt !== "aufloesung") {
    room.rundeNr--;
    room.letzterImposter = null;
    naechsteRunde(room);
    return;
  }

  cur.gesehen.delete(id);
  cur.stimmen.delete(id);
  for (const [waehlerId, zielId] of [...cur.stimmen]) {
    if (zielId === id) cur.stimmen.delete(waehlerId);
  }

  if (cur.schritt === "rollen") pruefeGesehen(room);
  else if (cur.schritt === "abstimmen") pruefeStimmen(room);
  else pushRunde(room);
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

  if (room.phase === "playing" && room.aktuell) {
    room.aktuell.reihenfolge = room.aktuell.reihenfolge.filter((x) => x !== id);
    weiterOhne(room, id, true);
  }

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

console.log(`IMPOSTER läuft auf http://${HOST}:${PORT}/`);
