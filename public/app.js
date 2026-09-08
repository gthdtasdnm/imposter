// Client: Verbindung, Warteraum, Karte, Auflösung. Mehr gibt es nicht – der
// Spielbildschirm zeigt ein Wort und sonst nichts, und nur der Host hat
// überhaupt einen Knopf.

import { starteSprache, t, uebersetze } from "./sprache.js";
import { WOERTER } from "./texte.js";

// Vor allem, was zeichnet: der Warteraum soll gleich in der richtigen
// Sprache dastehen. Deutsch steht im HTML und in den Aufrufen hier.
starteSprache(WOERTER);

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
  art: "klassisch",
  stapel: "harmlos",
  gate: null,        // offene 18+-Abfrage: { dann, sonst }
};

const ART_TEXT = {
  klassisch: "Klassisch – einer kennt das Wort nicht",
  blind: "Zwei Wörter – niemand weiß, wer abweicht",
};
const artText = (a) => t("imp.art." + a, {}, ART_TEXT[a] ?? "");

const artHint = (a) => t("imp.artHint." + a, {}, ART_HINT[a] ?? "");

const ART_HINT = {
  klassisch: "Alle bekommen dasselbe Wort – einer keins, und der weiß es.",
  blind: "Jeder bekommt ein Wort. Eines ist ein anderes – und der, den es " +
    "trifft, weiß es selbst nicht.",
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

let wiederUhr = null;
let meldeUhr = null;

function connect() {
  clearTimeout(wiederUhr);
  wiederUhr = null;
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) {
    return;
  }
  // Muss aus dem Basispfad kommen: das Spiel läuft in Produktion unter
  // /imposter/, ein festes "/ws" landet auf der Domainwurzel.
  const url = new URL("ws", document.baseURI);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  sock = new WebSocket(url);

  sock.onopen = () => {
    retryIn = 500;
    clearTimeout(meldeUhr);
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
    // Nicht sofort Alarm schlagen: die allermeisten Abbrüche sind nach einer
    // halben Sekunde geheilt, und eine Warnung, die bei jedem Wimpernschlag
    // aufblinkt, liest irgendwann niemand mehr.
    clearTimeout(meldeUhr);
    meldeUhr = setTimeout(() => setStatus(t("c.weg", {}, "Verbindung weg – neuer Versuch …")), 1500);
    clearTimeout(wiederUhr);
    wiederUhr = setTimeout(connect, retryIn);
    retryIn = Math.min(retryIn * 1.8, 8000);
  };
}

// Zurück aus der Hosentasche.
//
// Auf dem Handy ist der weggelegte Bildschirm der Normalfall: Safari friert
// den Tab ein, kappt die Verbindung und lässt auch die Wartezeit oben nicht
// weiterlaufen. Wer dann zurückkommt, sitzt vor einer toten Seite, bis der
// Zähler irgendwann von selbst zuschlägt – bis zu acht Sekunden. Deshalb wird
// bei jedem Zeichen von Rückkehr sofort und ohne Wartezeit neu verbunden;
// `connect` bricht von selbst ab, wenn die Verbindung noch steht.
function sofortWieder() {
  if (document.visibilityState === "hidden") return;
  retryIn = 500;
  connect();
}

document.addEventListener("visibilitychange", sofortWieder);
globalThis.addEventListener("pageshow", sofortWieder);
globalThis.addEventListener("focus", sofortWieder);
globalThis.addEventListener("online", sofortWieder);

// Lebenszeichen alle 20 s. Der Server räumt Verbindungen ab, die 180 s lang
// schweigen (die Geisterwache in `server.js`) – das sind neun Pings Luft.
// Vorher: 25 s Takt gegen 65 s Frist, also zwei; wer eine Weile nur zusah und
// nichts drückte, flog dadurch mitten im Spiel aus dem Raum. Gleicher Takt wie
// in `gemeinsam/schale.js`.
setInterval(() => send({ t: "ping", c: Date.now() }), 20_000);

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
// 18+
// ---------------------------------------------------------------------------
//
// Gleiche Regel wie bei „Ich hab noch nie" und „Wer am ehesten": eine Abfrage
// vor dem Einschalten **und** eine vor dem Beitritt in einen Raum, der schon so
// eingestellt ist. Der zweite Fall ist der wichtigere – dort hat man die
// Entscheidung nicht selbst getroffen. Bestätigt wird einmal je Gerät.
const AB18_KEY = "imposter_ab18";

const ab18Bestaetigt = () => {
  try {
    return localStorage.getItem(AB18_KEY) === "ja";
  } catch {
    return false;
  }
};

/** `dann` läuft, sobald es entweder harmlos ist oder bestätigt wurde. */
function mitAb18(typ, ab18, dann, sonst) {
  if (!ab18 || ab18Bestaetigt()) return dann();
  state.gate = { dann, sonst };
  $("ab18Text").textContent = typ === "beitritt"
    ? t("imp.ab18Beitritt", {}, "In diesem Raum sind die Wörter ab 18 eingestellt: es geht um Sex, Körper und Rausch. Nur bleiben, wenn du volljährig bist und Lust darauf hast.")
    : t("imp.ab18Wahl", {}, "In diesem Stapel geht es um Sex, Körper und Rausch – die Paare sind mit Absicht derb. Nur weiterspielen, wenn alle am Tisch volljährig sind und Lust darauf haben.");
  $("ab18Nein").textContent = typ === "beitritt"
    ? t("imp.raumVerlassen", {}, "Raum verlassen")
    : t("imp.lieberHarmlos", {}, "Lieber harmlos");
  $("ab18Gate").hidden = false;
}

$("ab18Ja").addEventListener("click", () => {
  try {
    localStorage.setItem(AB18_KEY, "ja");
  } catch { /* Privatmodus – dann fragt es beim nächsten Mal wieder */ }
  $("ab18Gate").hidden = true;
  const g = state.gate;
  state.gate = null;
  g?.dann();
});

$("ab18Nein").addEventListener("click", () => {
  $("ab18Gate").hidden = true;
  const g = state.gate;
  state.gate = null;
  g?.sonst();
});

// ---------------------------------------------------------------------------
// Offene Räume
// ---------------------------------------------------------------------------

function renderRooms(list) {
  const box = $("roomList");
  $("roomsCount").textContent = list.length ? `(${list.length})` : "";
  if (!list.length) {
    box.innerHTML = `<p class="rooms-empty">${
      t("c.keinRaum", {}, "Gerade ist kein Raum offen. Eröffne einen – er erscheint dann bei den anderen in der Liste.")
    }</p>`;
    return;
  }
  box.innerHTML = list.map((r) => `
    <button class="roomrow${r.ab18 ? " rot" : ""}" data-code="${escapeHtml(r.code)}"
            data-ab18="${r.ab18 ? "ja" : "nein"}">
      <span class="roomrow-name">${escapeHtml(r.host)}</span>
      <span class="roomrow-meta">${
      r.ab18
        ? "18+"
        : r.art === "blind"
        ? t("imp.zweiWoerter", {}, "Zwei Wörter")
        : t("imp.abN", { n: r.min }, `ab ${r.min}`)
    }</span>
      <span class="roomrow-count">${r.count}/${r.max}</span>
    </button>`).join("");

  for (const b of box.querySelectorAll(".roomrow")) {
    b.addEventListener("click", () => {
      mitAb18("beitritt", b.dataset.ab18 === "ja", () => joinCode(b.dataset.code), () => {});
    });
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

// Die Spielart – und mit ihr die Frage, ob der Stapel überhaupt zur Wahl
// steht: in der klassischen Art kommen die Wortpaare gar nicht vor.
function setArt(a) {
  state.art = a;
  for (const b of document.querySelectorAll("[data-art]")) {
    b.classList.toggle("sel", b.dataset.art === a);
  }
  $("artHint").textContent = artHint(a);
  $("stapelZeile").hidden = a !== "blind";
}

for (const b of document.querySelectorAll("[data-art]")) {
  b.addEventListener("click", () => setArt(b.dataset.art));
}

function setStapel(st) {
  state.stapel = st;
  for (const b of document.querySelectorAll("[data-stapel]")) {
    b.classList.toggle("sel", b.dataset.stapel === st);
  }
}

for (const b of document.querySelectorAll("[data-stapel]")) {
  b.addEventListener("click", () => {
    mitAb18("wahl", b.dataset.stapel === "derb",
      () => setStapel(b.dataset.stapel), () => setStapel("harmlos"));
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
    art: state.art,
    // Sicherheitsgurt: die derben Wörter gehen nur mit der Art mit, zu der sie
    // gehören. Ein „derb" aus einem alten Zustand kann so nicht durchrutschen.
    stapel: state.art === "blind" ? state.stapel : "harmlos",
  };
  if (sock?.readyState === WebSocket.OPEN) {
    send(state.pendingIntent);
    state.pendingIntent = null;
  }
});

$("joinBtn").addEventListener("click", () => {
  const code = $("codeInput").value.toUpperCase().trim();
  if (code.length < 3) return toast(t("c.codeBitte", {}, "Bitte den vierstelligen Code eingeben"));
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

  // Wer über einen Link in einem 18+-Raum landet, hat die Einstellung nicht
  // selbst getroffen – deshalb fragt es hier noch einmal, unabhängig davon,
  // wie er hereingekommen ist.
  if (r.ab18 && !ab18Bestaetigt() && !state.gate) {
    mitAb18("beitritt", true, () => {}, verlassen);
  }

  $("roomCode").textContent = r.code;
  const da = r.players.filter((p) => p.connected).length;
  $("lobbyCount").textContent = `${da}/${r.maxPlayers}`;
  $("roomVis").textContent = r.isPublic
    ? t("c.oeffentlich", {}, "Öffentlich – steht in der Liste")
    : t("c.privat", {}, "Privat – nur mit Code");

  const list = $("playerList");
  list.textContent = "";
  const plaetze = Math.max(r.players.length + 1, 4);
  for (let i = 0; i < Math.min(plaetze, r.maxPlayers); i++) {
    const p = r.players[i];
    const card = document.createElement("div");
    card.className = "seat" + (p ? "" : " empty") + (p && !p.connected ? " off" : "");
    if (!p) {
      card.innerHTML =
        `<div class="av">🪑</div><div class="nm">${t("c.frei", {}, "frei")}</div>` +
        `<div class="st">${t("c.wartet", {}, "wartet")}</div>`;
    } else {
      card.innerHTML = `
        <div class="av">${avatarFor(p.id)}</div>
        <div class="nm">${escapeHtml(p.name)}${p.id === state.you ? t("c.du", {}, " (du)") : ""}</div>
        <div class="st">${
          !p.connected
            ? t("c.kommtWieder", {}, "kommt wieder")
            : p.host
            ? t("c.teiltAus", {}, "teilt aus")
            : t("c.dabei", {}, "dabei")
        }</div>
        ${p.host ? `<div class="host">${t("c.host", {}, "HOST")}</div>` : ""}`;
    }
    list.append(card);
  }

  const isHost = r.hostId === state.you;
  $("hostControls").hidden = !isHost;
  $("guestControls").hidden = isHost;

  for (const b of document.querySelectorAll("[data-lobbyvis]")) {
    b.classList.toggle("sel", (b.dataset.lobbyvis === "public") === r.isPublic);
  }
  for (const b of document.querySelectorAll("[data-lobbyart]")) {
    b.classList.toggle("sel", b.dataset.lobbyart === r.art);
  }
  for (const b of document.querySelectorAll("[data-lobbystapel]")) {
    b.classList.toggle("sel", b.dataset.lobbystapel === r.stapel);
  }
  $("lobbyStapelZeile").hidden = r.art !== "blind";
  // Steht auch für die Gäste da: sonst wüsste nur der Host, was gleich kommt.
  $("lobbyArt").textContent = artText(r.art) +
    (r.ab18 ? " · " + t("imp.woerterAb18", {}, "Wörter ab 18") : "");

  // Wer gerade weg ist, zählt nicht mit – sonst blockiert er den Start.
  const here = r.players.filter((p) => p.connected).length;
  $("startBtn").disabled = here < r.minPlayers;
  $("startHint").textContent = here < r.minPlayers
    ? t("c.abGehtLos", { n: r.minPlayers }, `Ab ${r.minPlayers} geht es los.`)
    : t("imp.wennAlle", {}, "Wenn alle das Handy vor sich haben: austeilen.");
}

$("startBtn").addEventListener("click", () => send({ t: "start" }));
// Zwei Stufen, aber nur wo es weh tut: im Warteraum kostet ein Fehlgriff
// nichts, in der laufenden Runde das Blatt. Seit dem 08.09.2026 ist dieser
// Knopf der einzige Weg, den Platz wirklich aufzugeben – alles andere
// (weggewischt, gesperrt, Funkloch) hält der Server minutenlang frei. Der
// Knopf schreibt sich dafür kurz um, statt einen Dialog aufzumachen:
// `confirm()` blockiert auf dem Handy die ganze Seite, und die Verbindung
// läuft derweil weiter.
const BEDENK_MS = 4000;

function knopfRaus(b) {
  if (!b) return;
  let scharf = null;
  const zurueck = () => {
    clearTimeout(scharf);
    scharf = null;
    if (b.dataset.wortlaut != null) b.textContent = b.dataset.wortlaut;
    b.classList.remove("fragt");
  };
  b.addEventListener("click", () => {
    const raum = state.room;
    if (!raum || raum.phase === "lobby") return verlassen();
    if (scharf) { zurueck(); return verlassen(); }
    b.dataset.wortlaut = b.textContent;
    b.textContent = t("schale.wirklichRaus", {}, "Wirklich raus?");
    b.classList.add("fragt");
    scharf = setTimeout(zurueck, BEDENK_MS);
  });
}

knopfRaus($("leaveBtn"));
// Derselbe Weg hinaus von überall: Lobby, Spielbildschirm, Endstand.
for (const b of document.querySelectorAll("[data-raus]")) knopfRaus(b);

for (const b of document.querySelectorAll("[data-lobbyvis]")) {
  b.addEventListener("click", () =>
    send({ t: "settings", isPublic: b.dataset.lobbyvis === "public" })
  );
}

for (const b of document.querySelectorAll("[data-lobbyart]")) {
  b.addEventListener("click", () => {
    // Zurück auf die klassische Art heißt auch zurück auf den harmlosen
    // Stapel: die Paare gehören zur blinden Art, sonst nirgendwohin.
    const art = b.dataset.lobbyart;
    send(art === "blind" ? { t: "settings", art } : { t: "settings", art, stapel: "harmlos" });
  });
}

for (const b of document.querySelectorAll("[data-lobbystapel]")) {
  b.addEventListener("click", () => {
    const stapel = b.dataset.lobbystapel;
    mitAb18("wahl", stapel === "derb",
      () => send({ t: "settings", stapel }),
      () => send({ t: "settings", stapel: "harmlos" }));
  });
}

$("copyBtn").addEventListener("click", async () => {
  const link = location.origin + location.pathname + "#" + (state.code ?? "");
  try {
    await navigator.clipboard.writeText(link);
    toast(t("schale.kopiert", {}, "Link kopiert"));
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

// --- Der Deckel ------------------------------------------------------------
//
// Bis zum 19.08.2026 lag das Wort offen auf dem Bildschirm. Wer es gelesen
// hatte, drehte das Handy um oder schaltete es aus – und ein ausgeschaltetes
// Handy ist eine gekappte Verbindung. Genau daran ist die Runde reihum
// auseinandergefallen.
//
// Jetzt liegt die Karte zugedeckt. Der Deckel folgt dem Finger nach oben, ab
// der Hälfte springt er ganz auf, und beim Loslassen fällt er wieder zu. Das
// Handy kann offen liegen bleiben; niemand muss es anfassen, um es geheim zu
// halten.
//
// Wichtig: der Deckel ist reine Bildschirmsache. Der Server weiß nichts davon,
// niemand wartet darauf, dass jemand nachgesehen hat.
const stapel = () => $("stapel");
let deckelAuf = 0;      // 0 = zu, 1 = ganz offen
let zieht = null;       // Fingerkennung und Startpunkt, solange geschoben wird
let schonGesehen = false;

function setzeDeckel(wert) {
  deckelAuf = Math.max(0, Math.min(1, wert));
  stapel().style.setProperty("--auf", deckelAuf.toFixed(3));
  if (deckelAuf > .98 && !schonGesehen) {
    schonGesehen = true;
    $("deckel").classList.add("gesehen");
    $("deckelKlein").textContent = "schon angesehen – nochmal geht immer";
  }
}

/** Zugedeckt wird nur, was auch geheim ist. */
const deckelNoetig = () => !!(state.karte?.dabei && !state.karte.aufgedeckt);

function deckelZurueck() {
  schonGesehen = false;
  $("deckel").classList.remove("gesehen");
  $("deckelKlein").textContent = "und halten – Loslassen deckt zu";
  setzeDeckel(0);
}

{
  const el = stapel();

  const runter = (e) => {
    if (!deckelNoetig() || zieht) return;
    zieht = { id: e.pointerId, y: e.clientY };
    try { el.setPointerCapture(e.pointerId); } catch { /* Maus ohne Capture */ }
    el.classList.add("zieht");
  };

  const bewegt = (e) => {
    if (!zieht || e.pointerId !== zieht.id) return;
    e.preventDefault();
    // Die ersten Pixel zählen nicht, sonst deckt schon ein Antippen auf.
    const weg = zieht.y - e.clientY - 12;
    const wert = weg / Math.max(80, el.offsetHeight * .45);
    // Ab der Hälfte springt er ganz auf und bleibt es, solange der Finger
    // liegt – sonst müsste man auf zwei Zentimeter genau halten, um zu lesen.
    setzeDeckel(wert > .5 ? 1 : wert);
  };

  const hoch = (e) => {
    if (!zieht || (e && e.pointerId !== zieht.id)) return;
    zieht = null;
    el.classList.remove("zieht");
    setzeDeckel(0);
  };

  el.addEventListener("pointerdown", runter);
  el.addEventListener("pointermove", bewegt);
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) {
    el.addEventListener(t, hoch);
  }
  // Ohne Finger: Leertaste oder Enter halten. Gleiche Regel – Loslassen deckt
  // wieder zu.
  $("deckel").addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (deckelNoetig()) setzeDeckel(1);
  });
  $("deckel").addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") setzeDeckel(0);
  });
  // Der Deckel ist ein Knopf, damit ihn die Tastatur erreicht – klicken soll
  // er aber nichts, sonst blitzt das Wort bei einem Fehltipper auf.
  $("deckel").addEventListener("click", (e) => e.preventDefault());
}

// --- Die Ansage ------------------------------------------------------------

/**
 * Wer anfängt und wie herum es geht. Winzige Sache, riesiger Unterschied: ohne
 * sie fängt jede Runde mit „wer fängt an?" und „nach links oder rechts?" an,
 * und mitten im Reden weiß plötzlich niemand mehr, wer dran gewesen wäre.
 * Alle lesen denselben Satz, das Handy verwaltet aber keine Reihenfolge – es
 * sagt sie einmal an, und dann redet der Tisch.
 */
function renderAnsage(k) {
  const el = $("ansage");
  const a = k.ansage;
  if (!a || !k.dabei) { el.hidden = true; return; }
  const wer = a.binStarter
    ? t("imp.duFaengstAn", {}, "<b>Du</b> fängst an")
    : t("imp.faengtAn", { name: `<b>${escapeHtml(a.starterName)}</b>` },
      `<b>${escapeHtml(a.starterName)}</b> fängt an`);
  const pfeil = a.richtung === "links" ? "←" : "→";
  const richtung = t("imp.richtung." + a.richtung, {}, a.richtung);
  el.innerHTML = `${wer}
    <span class="ansage-richtung">
      <span class="ansage-pfeil">${pfeil}</span> ${
    t("imp.reihumNach", { richtung: escapeHtml(richtung) }, `dann reihum nach ${escapeHtml(richtung)}`)
  }
    </span>`;
  el.hidden = false;
}

/**
 * Die Karte. Sie hat drei Zustände und keinen davon muss jemand wegklicken:
 * das eigene Wort, „du bist der Imposter", und nach dem Auflösen die Wahrheit.
 * Die ersten beiden liegen unter dem Deckel, das Ergebnis liegt offen.
 * Wer mitten in einer laufenden Runde dazukommt, wartet auf die nächste.
 */
let gezeichneteRunde = null;

function renderKarte() {
  const k = state.karte;
  if (!k || state.room?.phase !== "runde") return;
  show("game");

  const isHost = state.room.hostId === state.you;
  const blind = k.art === "blind";
  $("rundeNo").textContent = String(k.n);
  $("endeBtn").hidden = !isHost;
  $("artTag").textContent = blind ? t("imp.zweiWoerter", {}, "Zwei Wörter") : "";

  // Neue Runde oder gerade aufgelöst: der Deckel fängt von vorne an.
  const marke = `${k.n}/${k.aufgedeckt}/${k.dabei}`;
  if (marke !== gezeichneteRunde) {
    gezeichneteRunde = marke;
    deckelZurueck();
  }

  renderAnsage(k);

  const karte = $("karte");
  const auf = $("aufloesung");
  stapel().hidden = false;
  auf.hidden = true;
  $("deckel").hidden = !deckelNoetig();

  if (k.aufgedeckt) {
    const e = k.ergebnis;
    const ichWars = e.imposterId === state.you;
    karte.classList.toggle("imposter", ichWars);
    if (blind) {
      // In dieser Art ist die Auflösung die Pointe: erst jetzt erfährt der
      // Tisch, dass überhaupt zwei Wörter im Spiel waren – und welches.
      $("karteKopf").textContent = t("imp.fastAlle", {}, "Fast alle hatten");
      $("karteWort").textContent = e.begriff;
      auf.hidden = false;
      auf.innerHTML = `<span class="auf-av">${avatarFor(e.imposterId)}</span>
        <p class="auf-wer">${
        ichWars
          ? t("imp.duHattest", {}, "<b>Du</b> hattest ein anderes Wort:")
          : t("imp.hatteAnderes", { name: `<b>${escapeHtml(e.imposterName)}</b>` },
            `<b>${escapeHtml(e.imposterName)}</b> hatte ein anderes Wort:`)
      }</p>
        <p class="auf-wort">${escapeHtml(e.sonderwort ?? "")}</p>`;
    } else {
      $("karteKopf").textContent = t("imp.dasWortWar", {}, "Das Wort war");
      $("karteWort").textContent = e.begriff;
      auf.hidden = false;
      auf.innerHTML = `<span class="auf-av">${avatarFor(e.imposterId)}</span>
        <p class="auf-wer">${
        t("imp.warDerImposter", { name: `<b>${escapeHtml(e.imposterName)}</b>` },
          `<b>${escapeHtml(e.imposterName)}</b> war der Imposter.`)
      }</p>
        <p class="auf-klein">${
        t("imp.gruppe", { gruppe: escapeHtml(e.gruppe) }, `Gruppe: ${escapeHtml(e.gruppe)}`)
      }</p>`;
    }
  } else if (!k.dabei) {
    // Mitten in die laufende Runde gekommen: kein Wort, sonst hätte der Tisch
    // unbemerkt einen zweiten Mitwisser.
    karte.classList.remove("imposter");
    $("karteKopf").textContent = t("imp.imRaum", {}, "Du bist im Raum");
    $("karteWort").textContent = "⏳";
    auf.hidden = false;
    auf.innerHTML =
      `<p class="auf-klein">${
        t("imp.laeuftSchon", {}, "Diese Runde läuft schon. Beim nächsten Austeilen bist du dabei.")
      }</p>`;
  } else if (k.binImposter) {
    karte.classList.add("imposter");
    $("karteKopf").textContent = t("imp.duBistDer", {}, "Du bist der");
    $("karteWort").textContent = "IMPOSTER";
  } else {
    // Auch der Abweichler landet hier: er sieht sein Wort wie alle anderen und
    // hat keine Möglichkeit zu erkennen, dass es ein anderes ist. Genau das
    // ist der Sinn der blinden Art – der Client bekommt die Wahrheit nicht,
    // also kann er sie auch nicht verraten.
    karte.classList.remove("imposter");
    $("karteKopf").textContent = t("imp.deinWort", {}, "Dein Wort");
    $("karteWort").textContent = k.begriff ?? "";
  }

  // Knöpfe hat nur der Host, und immer nur einen.
  const box = $("aktionen");
  box.textContent = "";
  let hint = "";
  if (isHost) {
    if (k.aufgedeckt) {
      box.append(knopf(t("imp.naechsteRunde", {}, "Nächste Runde"), "primary big",
        () => send({ t: "neu" })));
    } else {
      box.append(knopf(t("imp.aufloesen", {}, "Auflösen"), "primary big",
        () => send({ t: "aufloesen" })));
      hint = blind
        ? t("imp.erstRedenBlind", {}, "Erst reden. Auflösen zeigt, wer das andere Wort hatte.")
        : t("imp.erstReden", {}, "Erst reden. Auflösen zeigt allen, wer es war.");
    }
  } else if (k.aufgedeckt) {
    hint = t("imp.teiltNeuAus", {}, "Der Host teilt gleich neu aus.");
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
