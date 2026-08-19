// Probe für Imposter. Fünf Clients, ein Raum, ein paar Runden.
//
// Das Spiel ist absichtlich winzig – der Server teilt Karten aus, mehr nicht.
// Genau darauf zielt diese Probe: **die Geheimhaltung**. Nach dem Austeilen
// muss genau *ein* Client `binImposter` haben, genau dieser darf `begriff`
// nicht kennen, und das Wort darf bei ihm auch sonst nirgends ankommen –
// auch nicht in der Auflösung, bevor aufgelöst wurde.
//
// Das zweite Ziel ist seit dem 19.08.2026 **der Platz**: wer die Verbindung
// verliert, muss ihn behalten, seine Karte wiederfinden und darf den Tisch
// dabei nicht anfassen. Das wird hier mit echten Abbrüchen nachgestellt.
//
//   deno task dev            (in einer zweiten Sitzung)
//   deno task probe
// Gegen die Live-Fassung statt gegen den lokalen Server:
//   WS_URL=wss://inf-zeus.de/imposter/ws deno task probe

import { GRUPPEN } from "./begriffe.js";

const PORT = Deno.env.get("PORT") ?? "8073";
const URL_WS = Deno.env.get("WS_URL") ?? `ws://127.0.0.1:${PORT}/ws`;

function client(name) {
  const c = { name, ws: null, you: null, token: null, code: null, room: null, karte: null, fehler: [] };
  c.verbinde = () => {
    const ws = new WebSocket(URL_WS);
    c.ws = ws;
    c.offen = new Promise((res) => { ws.onopen = res; });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "joined") { c.you = m.you; c.token = m.token; c.code = m.code; }
      if (m.t === "room") c.room = m;
      if (m.t === "karte") c.karte = m;
      if (m.t === "pong") c.pong = m;
      if (m.t === "error") c.fehler.push(m.msg);
    };
    return c.offen;
  };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  // Verbindung weg wie im echten Leben: Bildschirm gesperrt, Tab weggewischt.
  c.kappen = () => new Promise((res) => { c.ws.onclose = res; c.ws.close(); });
  // Und zurück – genau so, wie es `public/app.js` tut: mit dem Token.
  c.zurueck = async () => {
    await c.verbinde();
    c.send({ t: "join", code: c.code, token: c.token, name: c.name });
  };
  c.verbinde();
  return c;
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function bis(bedingung, was, ms = 3000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (bedingung()) return;
    await warte(25);
  }
  throw new Error("Zeitüberschreitung: " + was);
}

// --- Erst die Begriffsgruppen, ohne Server ----------------------------------

const alleBegriffe = [];
for (const g of GRUPPEN) {
  // Acht ist die Untergrenze: darunter wiederholt sich an einem Abend dasselbe
  // Wort, und die nach dem Auflösen genannte Gruppe verriete für die nächste
  // Runde zu viel.
  if (g.begriffe.length < 8) throw new Error(`Gruppe „${g.name}" hat unter acht Begriffe`);
  if (new Set(g.begriffe).size !== g.begriffe.length) {
    throw new Error(`Gruppe „${g.name}" enthält Doppelte`);
  }
  alleBegriffe.push(...g.begriffe);
}
if (new Set(GRUPPEN.map((g) => g.name)).size !== GRUPPEN.length) {
  throw new Error("Zwei Gruppen heißen gleich");
}
if (new Set(alleBegriffe).size !== alleBegriffe.length) {
  throw new Error("Ein Begriff kommt in mehreren Gruppen vor");
}
console.log(`ok  ${GRUPPEN.length} Gruppen, ${alleBegriffe.length} Begriffe, alle eindeutig`);

// --- Jetzt der Server -------------------------------------------------------

const A = client("Anna"), B = client("Ben"), C = client("Cem"),
  D = client("Dana"), E = client("Eren");
const alleC = [A, B, C, D, E];
await Promise.all(alleC.map((c) => c.offen));

A.send({ t: "create", name: "Anna", isPublic: true });
await bis(() => A.room, "Raum angelegt");
const code = A.room.code;
console.log("Raum:", code);

for (const [c, n] of [[B, "Ben"], [C, "Cem"], [D, "Dana"]]) {
  c.send({ t: "join", code, name: n });
}
await bis(() => A.room.players.length === 4, "vier Spieler");

// --- Lebenszeichen: ohne ping wirft die Geisterwache alle raus --------------

// Der Server schliesst jede Verbindung, die 65 s lang schweigt (GEIST_MS in
// `server.js`). Geredet wird bei diesem Spiel am Tisch, gedrueckt wird nur vom
// Host – ohne Ping schweigen also alle, und mitten in der Runde flog reihum
// jeder heraus. Der Client hat die gemeinsame Schale nicht, die den Ping
// mitbringt; er schickt ihn selbst, und das wird hier nachgehalten.
{
  A.send({ t: "ping", c: 4711 });
  await bis(() => A.pong?.c === 4711, "Server antwortet auf ping");

  const client = await Deno.readTextFile(new URL("./public/app.js", import.meta.url));
  const takt = client.match(
    /setInterval\(\s*\(\)\s*=>\s*send\(\{\s*t:\s*"ping"[^]*?\}\)\s*,\s*(\d[\d_]*)\s*\)/,
  );
  if (!takt) {
    throw new Error("Der Client schickt keinen ping - die Geisterwache wirft nach 65 s jeden raus");
  }
  const ms = Number(takt[1].replaceAll("_", ""));
  if (!(ms > 0 && ms <= 30_000)) {
    throw new Error(`Der Ping-Takt ist ${ms} ms - das ist zu selten fuer eine Wache bei 65 s`);
  }
  console.log(`ok  der Client meldet sich alle ${ms / 1000} s, die Wache laesst ihn sitzen`);
}

// --- Kein Bereit-Knopf: der Host teilt aus, wann er will --------------------

if ("ready" in A.room.players[0]) {
  throw new Error("Der Raumzustand kennt immer noch ein „bereit\"");
}
// Einzustellen gibt es genau eine Sache: ob der Raum in der Liste steht.
A.send({ t: "settings", isPublic: false });
await bis(() => A.room.isPublic === false, "Raum auf privat");
A.send({ t: "settings", isPublic: true });
await bis(() => A.room.isPublic === true, "Raum wieder öffentlich");
if ("settings" in A.room) {
  throw new Error("Der Raumzustand schleppt immer noch Einstellungen mit");
}
console.log("ok  Warteraum kennt nur die Sichtbarkeit – kein Bereit, keine Einstellungen");

A.send({ t: "start" });
await bis(() => alleC.slice(0, 4).every((c) => c.karte), "ausgeteilt");
await bis(() => A.room.phase === "runde", "Phase Runde");
console.log("ok  ein Druck des Hosts teilt aus – niemand muss bestätigen");

// --- Geheimhaltung: genau einer ist Imposter, und nur er kennt das Wort nicht

const dabei = alleC.slice(0, 4);
let wort, imp, starterEins;
{
  const imposters = dabei.filter((c) => c.karte.binImposter);
  if (imposters.length !== 1) {
    throw new Error(`Es gibt ${imposters.length} Imposter statt genau einem`);
  }
  imp = imposters[0];
  if (imp.karte.begriff !== null) throw new Error("Der Imposter kennt den Begriff!");
  if (imp.karte.ergebnis !== null) throw new Error("Die Auflösung kommt vor dem Auflösen");

  const rest = dabei.filter((c) => c !== imp);
  const woerter = new Set(rest.map((c) => c.karte.begriff));
  if (woerter.size !== 1) throw new Error("Die Gruppe hat nicht alle dasselbe Wort");
  wort = [...woerter][0];
  if (!wort) throw new Error("Die Gruppe hat gar kein Wort bekommen");
  // Das Hilfswort ist am 19.08.2026 ersatzlos geflogen: es war zu oft die halbe
  // Antwort und hat den Imposter mehr verraten als getragen. Es darf auch nicht
  // als Rest irgendwo mitfahren.
  for (const c of dabei) {
    if ("hilfswort" in c.karte) {
      throw new Error(`${c.name} bekommt immer noch ein Feld „hilfswort"`);
    }
  }
  if (JSON.stringify(imp.karte).includes(wort)) {
    throw new Error("Das gesuchte Wort steckt irgendwo in der Karte des Imposters");
  }
  console.log(`ok  Imposter ist ${imp.name}, Wort „${wort}"`);
  console.log("ok  nur die Gruppe kennt das Wort, sonst kommt es nirgends an");
  console.log(`ok  kein Hilfswort mehr – der Imposter bekommt nichts als „du bist es"`);
}

// --- Die Ansage: wer anfängt, wie herum – und für alle dieselbe ------------

{
  const ansagen = dabei.map((c) => c.karte.ansage);
  if (ansagen.some((a) => !a)) throw new Error("Jemand bekommt keine Ansage");
  if (new Set(ansagen.map((a) => a.starterId)).size !== 1) {
    throw new Error("Nicht alle sehen denselben Anfänger");
  }
  if (new Set(ansagen.map((a) => a.richtung)).size !== 1) {
    throw new Error("Nicht alle sehen dieselbe Richtung");
  }
  const a0 = ansagen[0];
  if (a0.richtung !== "links" && a0.richtung !== "rechts") {
    throw new Error(`Richtung ist „${a0.richtung}" statt links oder rechts`);
  }
  const starter = dabei.find((c) => c.you === a0.starterId);
  if (!starter) throw new Error("Der Angesagte sitzt gar nicht am Tisch");
  if (starter.karte.ansage.binStarter !== true) {
    throw new Error(`${starter.name} fängt an, weiß es aber selbst nicht`);
  }
  if (dabei.filter((c) => c.karte.ansage.binStarter).length !== 1) {
    throw new Error("Mehr als einer glaubt, dass er anfängt");
  }
  if (a0.starterName !== starter.name) {
    throw new Error("Der angesagte Name gehört nicht zum angesagten Platz");
  }
  console.log(`ok  Ansage: ${a0.starterName} fängt an, dann nach ${a0.richtung} – alle lesen dasselbe`);

  // Die Ansage bleibt stehen. Ein neuer Name schickt allen ihre Karte noch
  // einmal – würfelte das einen neuen Anfänger, stünde der Tisch mitten in der
  // Runde vor einer zweiten Reihenfolge.
  B.send({ t: "name", name: "Benno" });
  await bis(() => A.room.players.some((p) => p.name === "Benno"), "umbenannt");
  await warte(120);
  if (imp.karte.ansage.starterId !== a0.starterId) {
    throw new Error("Der Anfänger hat sich mitten in der Runde geändert");
  }
  if (imp.karte.ansage.richtung !== a0.richtung) {
    throw new Error("Die Richtung hat sich mitten in der Runde geändert");
  }
  if (imp.karte.begriff !== null) throw new Error("Nach dem Umbenennen kam der Begriff durch");
  console.log("ok  Anfänger und Richtung bleiben die ganze Runde stehen");
  starterEins = a0.starterId;
}

// --- Kein Bestätigen, kein Weiter, keine Abstimmung ------------------------

{
  const vorher = JSON.stringify(imp.karte);
  for (const t of ["gesehen", "hinweis", "abstimmung", "weiter", "ready", "again"]) {
    for (const c of dabei) c.send({ t });
  }
  // Und ein Gast darf nicht auflösen oder neu austeilen.
  B.send({ t: "aufloesen" });
  B.send({ t: "neu" });
  await warte(250);
  if (JSON.stringify(imp.karte) !== vorher) {
    throw new Error("Eine alte Nachricht hat die Runde noch bewegt");
  }
  if (A.room.phase !== "runde") throw new Error("Die Runde ist von selbst weitergegangen");
  console.log("ok  alte Knöpfe (gesehen/hinweis/abstimmung/weiter/bereit) tun nichts mehr");
  console.log("ok  auflösen und neu austeilen darf nur der Host");
}

// --- Wer mitten in der Runde dazukommt, bekommt kein Wort ------------------

{
  E.send({ t: "join", code, name: "Eren" });
  await bis(() => E.karte, "Nachzügler bekommt eine Karte");
  if (E.karte.dabei) throw new Error("Der Nachzügler ist in der laufenden Runde dabei");
  if (E.karte.begriff !== null || E.karte.binImposter) {
    throw new Error("Der Nachzügler hat ein Wort oder eine Rolle bekommen");
  }
  console.log("ok  wer mitten hinein kommt, wartet auf die nächste Runde");
}

// --- Auflösen: jetzt erfahren alle alles -----------------------------------

{
  A.send({ t: "aufloesen" });
  await bis(() => dabei.every((c) => c.karte.aufgedeckt), "aufgelöst");
  for (const c of [...dabei, E]) {
    const e = c.karte.ergebnis;
    if (!e) throw new Error(`${c.name} sieht keine Auflösung`);
    if (e.imposterId !== imp.you) throw new Error(`${c.name} sieht den falschen Imposter`);
    if (e.begriff !== wort) throw new Error(`${c.name} sieht das falsche Wort`);
  }
  console.log(`ok  aufgelöst: ${imp.name} war es, das Wort war „${wort}" – alle sehen dasselbe`);
}

// --- Nächste Runde: neuer Imposter, und der Nachzügler ist dabei -----------

{
  A.send({ t: "neu" });
  await bis(() => alleC.every((c) => c.karte?.n === 2 && !c.karte.aufgedeckt), "Runde 2");
  const imp2 = alleC.find((c) => c.karte.binImposter);
  if (!imp2) throw new Error("Runde 2 hat keinen Imposter");
  if (imp2.you === imp.you) throw new Error("Zweimal hintereinander derselbe Imposter");
  if (!E.karte.dabei) throw new Error("Der Nachzügler ist auch in Runde 2 nicht dabei");
  const w2 = alleC.find((c) => !c.karte.binImposter).karte.begriff;
  if (!w2) throw new Error("Runde 2 hat kein Wort");
  for (const c of alleC) {
    if (c === imp2) continue;
    if (c.karte.begriff !== w2) throw new Error(`${c.name} hat ein anderes Wort als der Rest`);
  }
  if (imp2.karte.ansage.starterId === starterEins) {
    throw new Error("Zweimal hintereinander fängt derselbe an");
  }
  console.log(`ok  Runde 2: neuer Imposter (${imp2.name}), neuer Anfänger, fünf gleiche Wörter`);
}

// --- Der Platz bleibt: mitten in der Runde die Verbindung verlieren --------
//
// Das ist der Kern des Umbaus vom 19.08.2026. Vorher kostete jeder gesperrte
// Bildschirm den Platz: der Rückkehrer war ein neuer Spieler, seine Karte war
// weg, und das Hostzeichen stand woanders. Jetzt darf ein Abbruch nichts
// kosten – und vor allem darf der Rest des Tisches nichts davon merken.

{
  const merk = { you: D.you, karte: JSON.stringify(D.karte), host: A.room.hostId };
  const spielerVorher = A.room.players.length;
  const impVorher = alleC.find((c) => c.karte.binImposter).you;

  await D.kappen();
  await bis(() => A.room.players.some((p) => p.id === merk.you && !p.connected), "Dana gilt als weg");

  if (A.room.players.length !== spielerVorher) throw new Error("Der Platz wurde sofort geräumt");
  if (A.room.hostId !== merk.host) throw new Error("Das Hostzeichen ist gesprungen, obwohl der Host da ist");
  if (A.room.phase !== "runde") throw new Error("Die Runde ist durch den Abbruch stehengeblieben");
  if (alleC.find((c) => c.karte.binImposter)?.you !== impVorher) {
    throw new Error("Der Abbruch hat die Rollen neu gewürfelt");
  }
  console.log("ok  Verbindung weg: Platz bleibt stehen, Runde und Host bleiben unberührt");

  await D.zurueck();
  await bis(() => D.karte && D.you === merk.you, "Dana ist zurück");
  if (D.you !== merk.you) throw new Error("Dana sitzt auf einem neuen Platz");
  if (JSON.stringify(D.karte) !== merk.karte) throw new Error("Dana bekommt eine andere Karte als vorher");
  await bis(
    () => A.room.players.find((p) => p.id === merk.you)?.connected,
    "der Tisch sieht Dana wieder",
  );
  console.log("ok  und zurück: derselbe Platz, dieselbe Karte, dieselbe Runde");
}

// --- Auch der Host darf kurz weg sein -------------------------------------

{
  const hostVorher = A.room.hostId;
  await A.kappen();
  await bis(() => B.room.players.some((p) => p.id === hostVorher && !p.connected), "Host gilt als weg");
  await warte(400);
  if (B.room.hostId !== hostVorher) {
    throw new Error("Das Hostzeichen ist sofort weitergewandert – die Karenzzeit greift nicht");
  }
  await A.zurueck();
  await bis(() => A.room?.hostId === hostVorher && A.you === hostVorher, "Host ist zurück");
  console.log("ok  der Host verliert sein Zeichen nicht, wenn er kurz wegwischt");
}

// --- Im Warteraum genauso – und wer beim Austeilen weg ist, ist trotzdem dabei

{
  A.send({ t: "ende" });
  await bis(() => A.room.phase === "lobby", "zurück im Warteraum");

  const cVorher = C.you;
  await C.kappen();
  await bis(() => A.room.players.some((p) => p.id === cVorher && !p.connected), "Cem gilt als weg");
  if (!A.room.players.some((p) => p.id === cVorher)) {
    throw new Error("Im Warteraum wird der Platz immer noch sofort geräumt");
  }
  console.log("ok  auch im Warteraum bleibt der Platz stehen");

  // Und jetzt wird ausgeteilt, während Cem noch weg ist.
  A.send({ t: "start" });
  await bis(() => A.room.phase === "runde" && A.karte?.n === 1, "neu ausgeteilt");
  const dieRunde = alleC.filter((c) => c !== C);
  const impNeu = dieRunde.find((c) => c.karte.binImposter);
  if (!impNeu) throw new Error("Keine Rolle vergeben");
  if (impNeu.you === cVorher) throw new Error("Ein Abwesender wurde zum Imposter gemacht");
  const wortNeu = dieRunde.find((c) => !c.karte.binImposter).karte.begriff;
  if (A.karte.ansage.starterId === cVorher) {
    throw new Error("Ein Abwesender soll anfangen");
  }

  await C.zurueck();
  await bis(() => C.karte?.n === 1, "Cem ist zurück");
  if (C.you !== cVorher) throw new Error("Cem sitzt auf einem neuen Platz");
  if (!C.karte.dabei) throw new Error("Cem war beim Austeilen weg und ist deshalb draußen");
  if (C.karte.begriff !== wortNeu && !C.karte.binImposter) {
    throw new Error("Cem hat ein anderes Wort als der Rest");
  }
  console.log("ok  wer beim Austeilen gerade weg war, findet seine Karte trotzdem vor");
}

// --- Der Deckel liegt drauf ------------------------------------------------
//
// Der Server weiß vom Deckel nichts – er ist reine Bildschirmsache und deshalb
// hier nur mit dem Auge auf der Datei geprüft. Fiele er weg, läge das Wort
// wieder offen da, und genau davon drehen die Leute ihr Handy um oder schalten
// es aus. Was das kostet, steht drei Abschnitte weiter oben.

{
  const html = await Deno.readTextFile(new URL("./public/index.html", import.meta.url));
  const client = await Deno.readTextFile(new URL("./public/app.js", import.meta.url));
  if (!html.includes('id="deckel"') || !html.includes('id="stapel"')) {
    throw new Error("Der Spielbildschirm hat keinen Deckel mehr – das Wort läge offen da");
  }
  if (!/pointerdown/.test(client) || !/--auf/.test(client)) {
    throw new Error("Der Deckel lässt sich nicht mehr schieben");
  }
  if (!/setzeDeckel\(0\)/.test(client)) {
    throw new Error("Der Deckel fällt beim Loslassen nicht mehr zu");
  }
  console.log("ok  die Karte liegt zugedeckt und fällt beim Loslassen wieder zu");
}

if (alleC.some((c) => c.fehler.length)) {
  throw new Error("Fehlermeldungen: " + JSON.stringify(alleC.map((c) => c.fehler)));
}

// Aufraeumen. Seit die Plaetze zwanzig Minuten reserviert bleiben, wuerde ein
// blosses Beenden des Prozesses einen Raum hinterlassen, der eine Dreiviertel-
// stunde herumsteht – gegen die Live-Fassung waere das unhoeflich.
for (const c of alleC) c.send({ t: "leave" });
await warte(200);

console.log("\nALLES GRÜN");
Deno.exit(0);
