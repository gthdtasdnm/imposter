// Client: Verbindung, Warteraum, Rollenkarte, Hinweisrunde, Abstimmung,
// Raten, Auflösung.

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
  runde: null,
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
      if (msg.phase !== "playing") state.runde = null;
      renderRoom();
      break;

    case "runde":
      state.runde = msg;
      renderRunde();
      break;

    case "final":
      renderFinal(msg);
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
  state.runde = null;
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

  if (r.phase === "final") return; // das Endbild steht schon
  if (r.phase === "playing") {
    renderPunktleiste();
    return;                        // den Spielbildschirm zeichnet renderRunde()
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
    card.className = "seat" + (p ? "" : " empty") +
      (p?.ready ? " ready" : "") + (p && !p.connected ? " off" : "");
    if (!p) {
      card.innerHTML =
        `<div class="av">🪑</div><div class="nm">frei</div><div class="st">wartet</div>`;
    } else {
      card.innerHTML = `
        <div class="av">${avatarFor(p.id)}</div>
        <div class="nm">${escapeHtml(p.name)}${p.id === state.you ? " (du)" : ""}</div>
        <div class="st">${
        !p.connected ? "weg" : p.host ? "startet" : p.ready ? "✓ bereit" : "wartet"
      }</div>
        ${p.host ? '<div class="host">HOST</div>' : ""}`;
    }
    list.append(card);
  }

  const isHost = r.hostId === state.you;
  const me = r.players.find((p) => p.id === state.you);
  $("hostControls").hidden = !isHost;
  $("guestControls").hidden = isHost;

  for (const b of document.querySelectorAll("[data-hinweise]")) {
    b.classList.toggle("sel", Number(b.dataset.hinweise) === r.settings.hinweise);
  }
  for (const b of document.querySelectorAll("[data-rounds]")) {
    b.classList.toggle("sel", Number(b.dataset.rounds) === r.settings.rounds);
  }
  for (const b of document.querySelectorAll("[data-lobbyvis]")) {
    b.classList.toggle("sel", (b.dataset.lobbyvis === "public") === r.isPublic);
  }

  // Wer gerade weg ist, zählt nicht mit – sonst blockiert er den Start.
  const here = r.players.filter((p) => p.connected);
  const others = here.filter((p) => p.id !== r.hostId);
  const allReady = others.every((p) => p.ready);
  $("startBtn").disabled = here.length < r.minPlayers || !allReady;
  $("startHint").textContent = here.length < r.minPlayers
    ? `Ab ${r.minPlayers} geht es los – darunter ist die Abstimmung ein Münzwurf.`
    : allReady
    ? "Alle bereit!"
    : "Warten auf die anderen …";

  $("readyBtn").textContent = me?.ready ? "Doch nicht bereit" : "Bereit!";
  $("readyBtn").classList.toggle("on", !!me?.ready);
}

$("readyBtn").addEventListener("click", () => {
  const me = state.room?.players.find((p) => p.id === state.you);
  send({ t: "ready", value: !me?.ready });
});

$("startBtn").addEventListener("click", () => send({ t: "start" }));
$("leaveBtn").addEventListener("click", verlassen);
// Derselbe Weg hinaus von ueberall: Lobby, Spielbildschirm, Endstand.
for (const b of document.querySelectorAll("[data-raus]")) {
  b.addEventListener("click", verlassen);
}


for (const b of document.querySelectorAll("[data-hinweise]")) {
  b.addEventListener("click", () => send({ t: "settings", hinweise: Number(b.dataset.hinweise) }));
}
for (const b of document.querySelectorAll("[data-rounds]")) {
  b.addEventListener("click", () => send({ t: "settings", rounds: Number(b.dataset.rounds) }));
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

function renderRunde() {
  const r = state.runde;
  if (!r || state.room?.phase !== "playing") return;
  show("game");

  const isHost = state.room.hostId === state.you;
  const binDran = r.dranId === state.you;

  $("rundeNo").textContent = String(r.n);
  $("rundeTotal").textContent = r.total ? ` / ${r.total}` : "";
  $("gruppeTag").textContent = r.gruppe ?? "";
  $("endeBtn").hidden = !isHost;

  const karte = $("karte");
  const liste = $("liste");
  const reihe = $("reihenListe");
  const gitter = $("wahlGitter");
  const auf = $("aufloesung");

  // --- Rollenkarte ---------------------------------------------------------
  // Sie bleibt bis zur Auflösung stehen: wer sein Wort vergisst, während er
  // auf seinen Hinweis wartet, hat sonst verloren.
  karte.hidden = r.schritt === "aufloesung";
  karte.classList.toggle("imposter", !!r.binImposter);
  if (!karte.hidden) {
    if (r.binImposter) {
      $("karteKopf").textContent = "Du bist der Imposter";
      $("karteWort").textContent = "🕵️";
      $("karteSub").textContent =
        `Du kennst das Wort nicht – nur die Gruppe „${r.gruppe}“. Hör zu und häng dich an.`;
    } else {
      $("karteKopf").textContent = "Dein Wort";
      $("karteWort").textContent = r.begriff ?? "";
      $("karteSub").textContent = "Einer am Tisch kennt es nicht. Verrate es nicht zu früh.";
    }
  }

  // --- Wortliste -----------------------------------------------------------
  liste.hidden = r.schritt === "aufloesung";
  $("listeKopf").textContent = `Mögliche Wörter · ${r.gruppe ?? ""}`;
  const woerter = $("listeWoerter");
  woerter.textContent = "";
  for (const w of r.begriffe ?? []) {
    const s = document.createElement("span");
    s.className = "wort" + (!r.binImposter && w === r.begriff ? " meins" : "");
    s.textContent = w;
    woerter.append(s);
  }

  // --- Phasen --------------------------------------------------------------
  reihe.hidden = r.schritt !== "hinweise";
  gitter.hidden = !(r.schritt === "abstimmen" || (r.schritt === "raten" && r.binImposter));
  auf.hidden = r.schritt !== "aufloesung";

  const box = $("aktionen");
  box.textContent = "";
  let phase = "";
  let hint = "";

  if (r.schritt === "rollen") {
    phase = `${r.gesehen} von ${r.gesehenGesamt} haben ihre Karte gesehen`;
    if (!r.habGesehen) {
      box.append(knopf("Hab ich", "primary big", () => send({ t: "gesehen" })));
      hint = "Erst wenn alle gedrückt haben, geht es los – sonst redet jemand los, während ein anderer noch nicht weiß, wer er ist.";
    } else {
      hint = "Warten auf die anderen …";
    }
  } else if (r.schritt === "hinweise") {
    phase = `Hinweis ${r.hinweisNr} von ${r.hinweisGesamt}`;
    reihe.textContent = "";
    // Wie weit die Reihe im *aktuellen* Durchgang ist. Bei zwei Hinweisen pro
    // Person fängt die Markierung im zweiten Durchgang wieder vorne an –
    // sonst wären am Ende alle grau und man sähe nicht mehr, wer noch kommt.
    const imDurchgang = (r.hinweisNr - 1) % r.reihenfolge.length;
    r.reihenfolge.forEach((p, idx) => {
      const li = document.createElement("li");
      li.className = "reihe-p" + (p.id === r.dranId ? " jetzt" : "") +
        (idx < imDurchgang ? " fertig" : "") + (p.id === state.you ? " ich" : "");
      li.innerHTML = `<span class="reihe-av">${avatarFor(p.id)}</span>
        <span class="reihe-name">${escapeHtml(p.name)}</span>`;
      reihe.append(li);
    });
    if (binDran) {
      box.append(knopf("Gesagt", "primary big", () => send({ t: "hinweis" })));
      hint = "Sag laut ein Wort, das zu deinem Begriff passt. Nicht zu deutlich – aber deutlich genug.";
    } else {
      hint = `${r.dranName ?? "?"} ist dran.`;
      if (isHost) box.append(knopf("Weiter", "ghost sm", () => send({ t: "hinweis" })));
    }
    if (isHost) {
      box.append(knopf("Zur Abstimmung", "ghost sm", () => send({ t: "abstimmung" })));
    }
  } else if (r.schritt === "abstimmen") {
    phase = `${r.stimmenAb} von ${r.stimmenGesamt} haben gewählt`;
    gitter.textContent = "";
    for (const p of r.reihenfolge) {
      if (p.id === state.you) continue; // sich selbst zu wählen wäre ein Freispruch
      const b = document.createElement("button");
      b.className = "wahl" + (r.meineStimme === p.id ? " gewaehlt" : "");
      b.innerHTML = `<span class="wahl-av">${avatarFor(p.id)}</span>
        <span class="wahl-name">${escapeHtml(p.name)}</span>`;
      b.addEventListener("click", () => send({ t: "stimme", ziel: p.id }));
      gitter.append(b);
    }
    hint = r.meineStimme == null
      ? "Wer ist es? Aufgedeckt wird erst, wenn alle gewählt haben."
      : "Gewählt. Umentscheiden geht, solange nicht alle durch sind.";
    if (isHost) box.append(knopf("Trotzdem auflösen", "ghost sm", () => send({ t: "aufloesen" })));
  } else if (r.schritt === "raten") {
    if (r.binImposter) {
      phase = "Erwischt! Ein Versuch bleibt dir.";
      gitter.textContent = "";
      for (const w of r.begriffe ?? []) {
        const b = document.createElement("button");
        b.className = "wahl raten";
        b.textContent = w;
        b.addEventListener("click", () => send({ t: "raten", begriff: w }));
        gitter.append(b);
      }
      hint = "Triffst du das Wort, rettest du einen Punkt. Sonst bekommt jeder andere einen.";
    } else {
      phase = "Erwischt!";
      hint = "Der Imposter rät jetzt, welches Wort es war.";
      if (isHost) {
        box.append(knopf("Abbrechen", "ghost sm", () => send({ t: "ratenAufgeben" })));
      }
    }
  } else if (r.schritt === "aufloesung") {
    const e = r.ergebnis;
    phase = "";
    renderAufloesung(e);
    if (isHost) {
      box.append(knopf("Weiter", "primary big", () => send({ t: "weiter" })));
      hint = r.total && r.n >= r.total ? "Das war die letzte Runde." : "";
    } else {
      hint = "Weiter geht’s, sobald der Host drückt.";
    }
  }

  $("phasenText").textContent = phase;
  $("rundenHint").textContent = hint;
  renderPunktleiste();
}

function renderAufloesung(e) {
  const auf = $("aufloesung");
  auf.textContent = "";
  if (!e) return;

  const urteil = document.createElement("p");
  urteil.className = "auf-urteil " + (e.erkannt ? "gefasst" : "entkommen");
  urteil.textContent = e.erkannt ? "Erwischt!" : "Durchgekommen.";
  auf.append(urteil);

  const wer = document.createElement("p");
  wer.className = "auf-wer";
  wer.innerHTML = `Der Imposter war <b>${escapeHtml(e.imposterName)}</b>${
    e.imposterId === state.you ? " – also du" : ""
  }. Das Wort war <b>${escapeHtml(e.begriff ?? "?")}</b>.`;
  auf.append(wer);

  if (!e.erkannt && e.verdaechtigtName) {
    const falsch = document.createElement("p");
    falsch.className = "auf-klein";
    falsch.textContent = `Verdächtigt wurde ${e.verdaechtigtName}.`;
    auf.append(falsch);
  } else if (!e.erkannt && !e.verdaechtigtId) {
    const patt = document.createElement("p");
    patt.className = "auf-klein";
    patt.textContent = "Gleichstand – die Runde konnte sich nicht einigen.";
    auf.append(patt);
  }

  if (e.erkannt) {
    const raten = document.createElement("p");
    raten.className = "auf-klein";
    raten.textContent = e.geraten == null
      ? "Geraten wurde nicht."
      : e.ratenRichtig
      ? `Und hat mit „${e.geraten}“ richtig geraten – ein Punkt gerettet.`
      : `Geraten hat er „${e.geraten}“ – daneben.`;
    auf.append(raten);
  }

  const tab = document.createElement("ul");
  tab.className = "auf-tabelle";
  for (const z of e.tabelle ?? []) {
    const li = document.createElement("li");
    li.className = "auf-zeile" + (z.id === e.imposterId ? " imposter" : "");
    li.innerHTML = `<span class="auf-av">${avatarFor(z.id)}</span>
      <span class="auf-name">${escapeHtml(z.name)}${
      z.id === e.imposterId ? " 🕵️" : ""
    }<small>${z.waehler.length ? escapeHtml(z.waehler.join(", ")) : "—"}</small></span>
      <span class="auf-zahl">${z.stimmen}</span>`;
    tab.append(li);
  }
  auf.append(tab);
}

function renderPunktleiste() {
  const r = state.room;
  if (!r) return;
  const bar = $("punktleiste");
  bar.textContent = "";
  const sorted = r.players.slice().sort((a, b) => b.punkte - a.punkte);
  for (const p of sorted) {
    const chip = document.createElement("div");
    chip.className = "chip" + (p.id === state.you ? " me" : "") +
      (p.connected ? "" : " gone");
    chip.innerHTML = `
      <span class="chip-av">${avatarFor(p.id)}</span>
      <span class="chip-name">${escapeHtml(p.name)}</span>
      <span class="chip-zahl">${p.punkte}</span>`;
    bar.append(chip);
  }
}

$("endeBtn").addEventListener("click", () => send({ t: "ende" }));

// ---------------------------------------------------------------------------
// Endstand
// ---------------------------------------------------------------------------

function renderFinal(msg) {
  show("final");
  const t = msg.tabelle;
  $("finalSub").textContent = `${msg.runden} Runde${msg.runden === 1 ? "" : "n"} gespielt`;

  const ol = $("podium");
  ol.textContent = "";
  const maxPunkte = Math.max(...t.map((p) => p.punkte), 0);
  for (const p of t) {
    const li = document.createElement("li");
    li.className = "podest" + (p.id === state.you ? " me" : "") +
      (maxPunkte > 0 && p.punkte === maxPunkte ? " sieg" : "");
    const titel = p.entkommen
      ? `${p.entkommen}× unerkannt durchgekommen`
      : p.malImposter
      ? `${p.malImposter}× Imposter, nie durchgekommen`
      : "nie Imposter gewesen";
    li.innerHTML = `
      <span class="podest-av">${avatarFor(p.id)}</span>
      <span class="podest-name">${escapeHtml(p.name)}
        <small>${escapeHtml(titel)}</small></span>
      <span class="podest-zahl">${p.punkte}<small>Punkte</small></span>`;
    ol.append(li);
  }

  const isHost = state.room?.hostId === state.you;
  $("againBtn").hidden = !isHost;
  $("againHint").textContent = isHost
    ? "Zurück in den Warteraum – dort könnt ihr die Rundenzahl umstellen."
    : "Der Host holt alle zurück in den Warteraum.";
}

$("againBtn").addEventListener("click", () => send({ t: "again" }));

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
