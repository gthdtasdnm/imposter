// Client: Verbindung, Warteraum, Karte, Auflösung. Mehr gibt es nicht – der
// Spielbildschirm zeigt ein Wort und sonst nichts, und nur der Host hat
// überhaupt einen Knopf.

const $ = (id) => document.getElementById(id);

// Sitzplatz-Tierchen. Gleiche Liste und gleiche Ableitung wie in den anderen
// Spielen, damit dieselbe Person überall dasselbe Zeichen bekommt.
const AVATARS = ["🦊", "🐙", "🦅", "🐺", "🦁", "🐉"];
const avatarFor = (id) =>
  AVATARS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length];

const state = {
  you: null,
  code: null,
  room: null,
  karte: null,
  pendingIntent: null,
  visibility: "public",
};

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

let sock = null;
let retryIn = 500;

// Die eigene Kennung. Gleiche Regel wie in `gemeinsam/schale.js`, hier von
// Hand – dieser Client hat die Schale nicht.
//
// Bis zum 17.08.2026 lag sie im `sessionStorage` und starb mit dem Tab. Auf
// dem Handy schließt Safari Tabs von sich aus; wer zurückkam, war für den
// Server ein neuer Spieler, während sein alter Platz mit dem Hostzeichen
// stehenblieb – und niemand mehr starten konnte. Das war Bugreport 4.
//
// Jetzt `localStorage` plus Herzschlag: der Tab, dem die Kennung gehört,
// frischt sie alle vier Sekunden auf und schreibt seine Tabkennung dazu.
//
//   gleiche Tabkennung        → das sind wir selbst (Neuladen)
//   fremd, Herzschlag frisch  → ein anderer Tab spielt gerade, Finger weg
//   fremd, Herzschlag alt     → niemand da, Kennung übernehmen
//
// Ohne den mittleren Fall zögen sich zwei Tabs abwechselnd den Platz weg.
// Nach zwei Stunden verfällt der Eintrag: dann gibt es den Raum längst nicht
// mehr, und niemand will morgen früh in die Runde von gestern geworfen werden.
const SITZ_KEY = "imposter";
const HERZ_MS = 4000;
const HERZ_TOT = 12_000;
const SITZ_VERFALL = 2 * 60 * 60 * 1000;
const TAB = (() => {
  try {
    const t = sessionStorage.getItem("spiele_tab") ??
      (crypto.randomUUID?.() ?? String(Date.now()) + String(Math.random()).slice(2));
    sessionStorage.setItem("spiele_tab", t);
    return t;
  } catch {
    return "tab";
  }
})();
let herzUhr = null;

function session() {
  try {
    const s = JSON.parse(localStorage.getItem(SITZ_KEY) ?? "null");
    if (!s || !s.code || !s.token) return null;
    const alt = Date.now() - (s.herz ?? 0);
    if (alt > SITZ_VERFALL) { localStorage.removeItem(SITZ_KEY); return null; }
    if (s.tab !== TAB && alt < HERZ_TOT) return null;
    return s;
  } catch {
    return null;
  }
}

/** Token für genau diesen Raum – sonst nichts, damit kein fremder mitfährt. */
const tokenFuer = (code) => (session()?.code === code ? session().token : undefined);

function saveSession(data) {
  try {
    clearInterval(herzUhr);
    herzUhr = null;
    if (!data) { localStorage.removeItem(SITZ_KEY); return; }
    const schreibe = () => localStorage.setItem(
      SITZ_KEY,
      JSON.stringify({ ...data, tab: TAB, herz: Date.now() }),
    );
    schreibe();
    herzUhr = setInterval(schreibe, HERZ_MS);
  } catch { /* Privatmodus – dann eben ohne Wiedereinstieg */ }
}

function send(msg) {
  if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
}

function connect() {
  // Muss aus dem Basispfad kommen: das Spiel läuft in Produktion unter
  // /imposter/, ein festes "/ws" landet auf der Domainwurzel.
  const url = new URL("ws", document.baseURI);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  sock = new WebSocket(url);

  sock.onopen = () => {
    retryIn = 500;
    setStatus("");
    const s = session();
    if (state.pendingIntent) {
      send(state.pendingIntent);
      state.pendingIntent = null;
    } else if (s && s.code && s.token) {
      send({ t: "join", code: s.code, token: s.token, name: s.name });
    } else {
      send({ t: "browse" });
    }
  };

  sock.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    onMessage(msg);
  };

  sock.onclose = () => {
    setStatus("Verbindung weg – neuer Versuch …");
    setTimeout(connect, retryIn);
    retryIn = Math.min(retryIn * 1.8, 8000);
  };
}

// ---------------------------------------------------------------------------
// Bildschirme
// ---------------------------------------------------------------------------

function show(name) {
  for (const s of document.querySelectorAll(".screen")) {
    s.classList.toggle("active", s.id === `screen-${name}`);
  }
  if (name === "home") send({ t: "browse" });
}

function setStatus(text) {
  $("status").textContent = text;
  $("status").classList.toggle("show", !!text);
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toast._id);
  toast._id = setTimeout(() => t.classList.remove("show"), 2600);
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// ---------------------------------------------------------------------------
// Nachrichten vom Server
// ---------------------------------------------------------------------------

function onMessage(msg) {
  switch (msg.t) {
    case "rooms":
      renderRooms(msg.rooms);
      break;

    case "joined":
      state.you = msg.you;
      state.code = msg.code;
      saveSession({ code: msg.code, token: msg.token, name: $("name").value.trim() });
      location.hash = msg.code;
      break;

    case "room":
      state.room = msg;
      if (msg.phase !== "runde") state.karte = null;
      renderRoom();
      break;

    case "karte":
      state.karte = msg;
      renderKarte();
      break;

    case "error":
      toast(msg.msg);
      show("home");
      break;
  }
}

// ---------------------------------------------------------------------------
// Offene Räume
// ---------------------------------------------------------------------------

function renderRooms(list) {
  const box = $("roomList");
  $("roomsCount").textContent = list.length ? `(${list.length})` : "";
  if (!list.length) {
    box.innerHTML = `<p class="rooms-empty">Gerade ist kein Raum offen.
      Eröffne einen – er erscheint dann bei den anderen in der Liste.</p>`;
    return;
  }
  box.innerHTML = list.map((r) => `
    <button class="roomrow" data-code="${escapeHtml(r.code)}">
      <span class="roomrow-name">${escapeHtml(r.host)}</span>
      <span class="roomrow-meta">ab ${r.min}</span>
      <span class="roomrow-count">${r.count}/${r.max}</span>
    </button>`).join("");

  for (const b of box.querySelectorAll(".roomrow")) {
    b.addEventListener("click", () => joinCode(b.dataset.code));
  }
}

// Gemeinsam mit den anderen Spielen: wer bei einem seinen Namen eintippt,
// findet ihn beim nächsten schon vor.
const NAME_KEY = "spiele_name";

function meinName() {
  return $("name").value.trim();
}

function joinCode(code) {
  try {
    localStorage.setItem(NAME_KEY, meinName());
  } catch { /* egal */ }
  state.pendingIntent = { t: "join", code, token: tokenFuer(code), name: meinName() };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
}

function verlassen() {
  send({ t: "leave" });
  saveSession(null);
  state.room = null;
  state.karte = null;
  state.you = null;
  location.hash = "";
  show("home");
}

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------

for (const b of document.querySelectorAll("[data-vis]")) {
  b.addEventListener("click", () => {
    state.visibility = b.dataset.vis;
    for (const x of document.querySelectorAll("[data-vis]")) {
      x.classList.toggle("sel", x === b);
    }
  });
}

$("createBtn").addEventListener("click", () => {
  try {
    localStorage.setItem(NAME_KEY, meinName());
  } catch { /* egal */ }
  state.pendingIntent = {
    t: "create",
    name: meinName(),
    isPublic: state.visibility === "public",
  };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
});

$("joinBtn").addEventListener("click", () => {
  const code = $("codeInput").value.toUpperCase().trim();
  if (code.length < 3) return toast("Bitte den vierstelligen Code eingeben");
  joinCode(code);
});

$("codeInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("joinBtn").click();
});

$("helpBtn").addEventListener("click", () => { $("help").hidden = false; });
$("helpClose").addEventListener("click", () => { $("help").hidden = true; });

// ---------------------------------------------------------------------------
// Warteraum
// ---------------------------------------------------------------------------

function renderRoom() {
  const r = state.room;
  if (!r) return;

  if (r.phase === "runde") {
    renderKarte();   // den Spielbildschirm zeichnet die Karte
    return;
  }

  show("lobby");

  $("roomCode").textContent = r.code;
  const da = r.players.filter((p) => p.connected).length;
  $("lobbyCount").textContent = `${da}/${r.maxPlayers}`;
  $("roomVis").textContent = r.isPublic
    ? "Öffentlich – steht in der Liste"
    : "Privat – nur mit Code";

  const list = $("playerList");
  list.textContent = "";
  const plaetze = Math.max(r.players.length + 1, 4);
  for (let i = 0; i < Math.min(plaetze, r.maxPlayers); i++) {
    const p = r.players[i];
    const card = document.createElement("div");
    card.className = "seat" + (p ? "" : " empty") + (p && !p.connected ? " off" : "");
    if (!p) {
      card.innerHTML =
        `<div class="av">🪑</div><div class="nm">frei</div><div class="st">wartet</div>`;
    } else {
      card.innerHTML = `
        <div class="av">${avatarFor(p.id)}</div>
        <div class="nm">${escapeHtml(p.name)}${p.id === state.you ? " (du)" : ""}</div>
        <div class="st">${!p.connected ? "weg" : p.host ? "teilt aus" : "dabei"}</div>
        ${p.host ? '<div class="host">HOST</div>' : ""}`;
    }
    list.append(card);
  }

  const isHost = r.hostId === state.you;
  $("hostControls").hidden = !isHost;
  $("guestControls").hidden = isHost;

  for (const b of document.querySelectorAll("[data-hilfswort]")) {
    b.classList.toggle("sel", (b.dataset.hilfswort === "an") === !!r.settings.hilfswort);
  }
  for (const b of document.querySelectorAll("[data-lobbyvis]")) {
    b.classList.toggle("sel", (b.dataset.lobbyvis === "public") === r.isPublic);
  }

  // Wer gerade weg ist, zählt nicht mit – sonst blockiert er den Start.
  const here = r.players.filter((p) => p.connected).length;
  $("startBtn").disabled = here < r.minPlayers;
  $("startHint").textContent = here < r.minPlayers
    ? `Ab ${r.minPlayers} geht es los.`
    : "Wenn alle das Handy vor sich haben: austeilen.";
}

$("startBtn").addEventListener("click", () => send({ t: "start" }));
$("leaveBtn").addEventListener("click", verlassen);
// Derselbe Weg hinaus von ueberall: Lobby und Spielbildschirm.
for (const b of document.querySelectorAll("[data-raus]")) {
  b.addEventListener("click", verlassen);
}

for (const b of document.querySelectorAll("[data-hilfswort]")) {
  b.addEventListener("click", () =>
    send({ t: "settings", hilfswort: b.dataset.hilfswort === "an" })
  );
}
for (const b of document.querySelectorAll("[data-lobbyvis]")) {
  b.addEventListener("click", () =>
    send({ t: "settings", isPublic: b.dataset.lobbyvis === "public" })
  );
}

$("copyBtn").addEventListener("click", async () => {
  const link = location.origin + location.pathname + "#" + (state.code ?? "");
  try {
    await navigator.clipboard.writeText(link);
    toast("Link kopiert");
  } catch {
    // Ohne Zwischenablage (http, altes Handy) bleibt nur Vorlesen.
    toast(link);
  }
});

// ---------------------------------------------------------------------------
// Spielbildschirm
// ---------------------------------------------------------------------------

function knopf(label, cls, fn) {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

/**
 * Die Karte. Sie hat drei Zustände und keinen davon muss jemand wegklicken:
 * das eigene Wort, „du bist der Imposter", und nach dem Auflösen die Wahrheit.
 * Wer mitten in einer laufenden Runde dazukommt, wartet auf die nächste.
 */
function renderKarte() {
  const k = state.karte;
  if (!k || state.room?.phase !== "runde") return;
  show("game");

  const isHost = state.room.hostId === state.you;
  $("rundeNo").textContent = String(k.n);
  $("endeBtn").hidden = !isHost;

  const karte = $("karte");
  const hilf = $("karteHilf");
  const auf = $("aufloesung");
  karte.hidden = false;
  auf.hidden = true;
  hilf.hidden = true;

  if (k.aufgedeckt) {
    const e = k.ergebnis;
    karte.classList.toggle("imposter", e.imposterId === state.you);
    $("karteKopf").textContent = "Das Wort war";
    $("karteWort").textContent = e.begriff;
    auf.hidden = false;
    auf.innerHTML = `<span class="auf-av">${avatarFor(e.imposterId)}</span>
      <p class="auf-wer"><b>${escapeHtml(e.imposterName)}</b> war der Imposter.</p>
      <p class="auf-klein">Gruppe: ${escapeHtml(e.gruppe)}</p>`;
  } else if (!k.dabei) {
    // Mitten in die laufende Runde gekommen: kein Wort, sonst hätte der Tisch
    // unbemerkt einen zweiten Mitwisser.
    karte.classList.remove("imposter");
    $("karteKopf").textContent = "Du bist im Raum";
    $("karteWort").textContent = "⏳";
    hilf.hidden = false;
    hilf.textContent = "Diese Runde läuft schon. Beim nächsten Austeilen bist du dabei.";
  } else if (k.binImposter) {
    karte.classList.add("imposter");
    $("karteKopf").textContent = "Du bist der Imposter";
    $("karteWort").textContent = "🕵️";
    hilf.hidden = !k.hilfswort;
    hilf.textContent = k.hilfswort ? `Hilfswort: „${k.hilfswort}“` : "";
  } else {
    karte.classList.remove("imposter");
    $("karteKopf").textContent = "Dein Wort";
    $("karteWort").textContent = k.begriff ?? "";
  }

  // Knöpfe hat nur der Host, und immer nur einen.
  const box = $("aktionen");
  box.textContent = "";
  let hint = "";
  if (isHost) {
    if (k.aufgedeckt) {
      box.append(knopf("Nächste Runde", "primary big", () => send({ t: "neu" })));
    } else {
      box.append(knopf("Auflösen", "primary big", () => send({ t: "aufloesen" })));
      hint = "Erst reden. Auflösen zeigt allen, wer es war.";
    }
  } else if (k.aufgedeckt) {
    hint = "Der Host teilt gleich neu aus.";
  }
  $("rundenHint").textContent = hint;
}

$("endeBtn").addEventListener("click", () => send({ t: "ende" }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  const gemerkt = localStorage.getItem(NAME_KEY);
  if (gemerkt) $("name").value = gemerkt;
} catch { /* egal */ }

// Geteilter Link mit #CODE: Code eintragen und – wenn der Name schon feststeht –
// direkt beitreten.
const hash = location.hash.replace("#", "").toUpperCase().trim();
if (hash.length >= 3 && hash.length <= 5) {
  $("codeInput").value = hash;
  if (!session()?.token && $("name").value.trim()) {
    state.pendingIntent = { t: "join", code: hash, token: tokenFuer(hash), name: meinName() };
  }
}

connect();
