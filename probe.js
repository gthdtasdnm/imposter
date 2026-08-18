// Probe für Imposter. Fünf Clients, ein Raum, ein paar Runden.
//
// Das Spiel ist absichtlich winzig – der Server teilt Karten aus, mehr nicht.
// Genau darauf zielt diese Probe: **die Geheimhaltung**. Nach dem Austeilen
// muss genau *ein* Client `binImposter` haben, genau dieser darf `begriff`
// nicht kennen, und das Wort darf bei ihm auch sonst nirgends ankommen –
// nicht im Hilfswort, nicht in der Auflösung, bevor aufgelöst wurde.
//
//   deno task dev            (in einer zweiten Sitzung)
//   deno task probe
// Gegen die Live-Fassung statt gegen den lokalen Server:
//   WS_URL=wss://inf-zeus.de/imposter/ws deno task probe

import { GRUPPEN } from "./begriffe.js";

const PORT = Deno.env.get("PORT") ?? "8073";
const URL_WS = Deno.env.get("WS_URL") ?? `ws://127.0.0.1:${PORT}/ws`;

function client(name) {
  const c = {
    name, ws: new WebSocket(URL_WS), you: null, room: null, karte: null,
    fehler: [],
  };
  c.ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "joined") c.you = m.you;
    if (m.t === "room") c.room = m;
    if (m.t === "karte") c.karte = m;
    if (m.t === "error") c.fehler.push(m.msg);
  };
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.offen = new Promise((res) => { c.ws.onopen = res; });
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
  // Acht ist die Untergrenze. Nicht mehr wegen des Ratens – das gibt es nicht
  // mehr –, sondern wegen des Hilfsworts: bei vier Wörtern wäre es fast schon
  // die Antwort.
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

// --- Kein Bereit-Knopf: der Host teilt aus, wann er will --------------------

if ("ready" in A.room.players[0]) {
  throw new Error("Der Raumzustand kennt immer noch ein „bereit\"");
}
A.send({ t: "settings", hilfswort: true });
await bis(() => A.room.settings.hilfswort === true, "Hilfswort an");
if ("rounds" in A.room.settings || "hinweise" in A.room.settings) {
  throw new Error("Es gibt immer noch Runden- oder Hinweiseinstellungen");
}
console.log("ok  Warteraum kennt nur Hilfswort und Sichtbarkeit, kein Bereit");

A.send({ t: "start" });
await bis(() => alleC.slice(0, 4).every((c) => c.karte), "ausgeteilt");
await bis(() => A.room.phase === "runde", "Phase Runde");
console.log("ok  ein Druck des Hosts teilt aus – niemand muss bestätigen");

// --- Geheimhaltung: genau einer ist Imposter, und nur er kennt das Wort nicht

const dabei = alleC.slice(0, 4);
let wort, imp;
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
  for (const c of rest) {
    if (c.karte.hilfswort !== null) {
      throw new Error(`${c.name} bekommt ein Hilfswort, ist aber kein Imposter`);
    }
  }
  console.log(`ok  Imposter ist ${imp.name}, Wort „${wort}"`);
  console.log("ok  nur die Gruppe kennt das Wort, sonst kommt es nirgends an");
}

// --- Hilfswort: genau eines, aus derselben Gruppe, nie das gesuchte ---------

{
  const hw = imp.karte.hilfswort;
  if (!hw) throw new Error("Hilfswort ist an, der Imposter bekommt aber keines");
  if (hw === wort) throw new Error("Das Hilfswort ist das gesuchte Wort!");
  const gruppe = GRUPPEN.find((g) => g.begriffe.includes(wort));
  if (!gruppe.begriffe.includes(hw)) {
    throw new Error("Das Hilfswort kommt aus einer anderen Gruppe");
  }
  console.log(`ok  genau ein Hilfswort („${hw}"), aus derselben Gruppe, nicht das gesuchte`);

  // Und es bleibt stehen. Ein neuer Name schickt allen ihre Karte noch einmal –
  // würfelte das ein neues Hilfswort, hätte der Imposter nach fünf Umbenennungen
  // die halbe Gruppe gesehen.
  B.send({ t: "name", name: "Benno" });
  await bis(() => A.room.players.some((p) => p.name === "Benno"), "umbenannt");
  await warte(120);
  if (imp.karte.hilfswort !== hw) throw new Error("Das Hilfswort hat sich zwischendurch geändert");
  if (imp.karte.begriff !== null) throw new Error("Nach dem Umbenennen kam der Begriff durch");
  console.log("ok  das Hilfswort bleibt die ganze Runde dasselbe");
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
  console.log(`ok  Runde 2: neuer Imposter (${imp2.name}), fünf gleiche Wörter, alles zurück auf Anfang`);
}

// --- Hilfswort aus: der Imposter bekommt gar nichts ------------------------

{
  A.send({ t: "ende" });
  await bis(() => A.room.phase === "lobby", "zurück im Warteraum");
  A.send({ t: "settings", hilfswort: false });
  await bis(() => A.room.settings.hilfswort === false, "Hilfswort aus");
  A.send({ t: "start" });
  await bis(() => A.room.phase === "runde" && alleC.every((c) => c.karte?.n === 1), "neu ausgeteilt");

  const imp3 = alleC.find((c) => c.karte.binImposter);
  if (!imp3) throw new Error("Keine Rolle vergeben");
  if (imp3.karte.hilfswort !== null) {
    throw new Error(`Hilfswort ist aus, der Imposter bekommt trotzdem „${imp3.karte.hilfswort}"`);
  }
  if (imp3.karte.begriff !== null) throw new Error("Der Imposter kennt das Wort");
  for (const c of alleC.filter((c) => c !== imp3)) {
    if (!c.karte.begriff) throw new Error(`${c.name} hat kein Wort`);
  }
  console.log("ok  Hilfswort aus → der Imposter sieht nur, dass er es ist. Sonst nichts");
}

if (alleC.some((c) => c.fehler.length)) {
  throw new Error("Fehlermeldungen: " + JSON.stringify(alleC.map((c) => c.fehler)));
}
console.log("\nALLES GRÜN");
Deno.exit(0);
