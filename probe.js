// Spielt den ganzen Ablauf mit fünf Clients durch: Raum, Warteraum,
// Rollenkarten, Hinweisrunde, Abstimmung, Raten, Punkte, Endstand, Neustart.
//
// Der Kern der Probe ist die Geheimhaltung: nach dem Austeilen muss genau
// **ein** Client `binImposter` haben, und genau dieser eine darf `begriff`
// **nicht** kennen.
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
    name, ws: new WebSocket(URL_WS), you: null, room: null, runde: null,
    final: null, fehler: [],
  };
  c.ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === "joined") c.you = m.you;
    if (m.t === "room") c.room = m;
    if (m.t === "runde") c.runde = m;
    if (m.t === "final") c.final = m;
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
  // Acht ist die Untergrenze: der Imposter darf am Ende raten, und bei vier
  // Wörtern wäre das kein Raten mehr, sondern eine Münze.
  if (g.begriffe.length < 8) throw new Error(`Gruppe „${g.name}" hat unter acht Begriffe`);
  if (new Set(g.begriffe).size !== g.begriffe.length) {
    throw new Error(`Gruppe „${g.name}" enthält Doppelte`);
  }
  alleBegriffe.push(...g.begriffe);
}
if (new Set(GRUPPEN.map((g) => g.name)).size !== GRUPPEN.length) {
  throw new Error("Zwei Gruppen heißen gleich");
}
// Ein Begriff in zwei Gruppen wäre ein verstecktes Leck: der Imposter sähe
// dieselbe Wortliste und könnte die Gruppe nicht mehr auseinanderhalten.
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

for (const [c, n] of [[B, "Ben"], [C, "Cem"], [D, "Dana"], [E, "Eren"]]) {
  c.send({ t: "join", code, name: n });
}
await bis(() => A.room.players.length === 5, "fünf Spieler");

A.send({ t: "start" });
await warte(150);
if (A.room.phase !== "lobby") throw new Error("Start ging ohne Bereit durch");
console.log("ok  Start blockiert, solange nicht alle bereit sind");

for (const c of [B, C, D, E]) c.send({ t: "ready", value: true });
await bis(() => A.room.players.every((p) => p.ready || p.host), "alle bereit");

A.send({ t: "settings", rounds: 8, hinweise: 1, hilfswort: true });
await bis(() => A.room.settings.hilfswort === true, "Hilfswort angeschaltet");
await warte(120);
A.send({ t: "start" });
await bis(() => A.runde && A.room.phase === "playing", "Runde 1 läuft");

const von = (id) => alleC.find((c) => c.you === id);

// --- Geheimhaltung: genau einer ist Imposter, und nur er kennt das Wort nicht

{
  const imposters = alleC.filter((c) => c.runde.binImposter);
  if (imposters.length !== 1) {
    throw new Error(`Es gibt ${imposters.length} Imposter statt genau einem`);
  }
  const imp = imposters[0];
  if (imp.runde.begriff !== null) throw new Error("Der Imposter kennt den Begriff!");
  const rest = alleC.filter((c) => c !== imp);
  const woerter = new Set(rest.map((c) => c.runde.begriff));
  if (woerter.size !== 1) throw new Error("Die Gruppe hat nicht alle dasselbe Wort");
  const wort = [...woerter][0];
  if (!wort) throw new Error("Die Gruppe hat gar kein Wort bekommen");
  // Die Wortliste sieht nur die Gruppe – der Imposter erst beim Raten.
  for (const c of rest) {
    if (!c.runde.begriffe?.includes(wort)) {
      throw new Error(`${c.name} sieht die Wortliste nicht oder sie passt nicht`);
    }
    if (c.runde.hilfswort !== null) {
      throw new Error(`${c.name} bekommt ein Hilfswort, obwohl er kein Imposter ist`);
    }
  }
  if (imp.runde.begriffe) throw new Error("Der Imposter sieht die Wortliste!");
  console.log(`ok  Imposter ist ${imp.name}, Wort „${wort}" (Gruppe „${A.runde.gruppe}")`);
  console.log("ok  nur die Gruppe kennt das Wort und sieht die Liste");

  // --- Hilfswort: an in der Lobby, also genau eines – und nie das gesuchte.
  const hw = imp.runde.hilfswort;
  if (!hw) throw new Error("Hilfswort ist an, der Imposter bekommt aber keines");
  if (hw === wort) throw new Error("Das Hilfswort ist das gesuchte Wort!");
  if (!rest[0].runde.begriffe.includes(hw)) {
    throw new Error("Das Hilfswort steht gar nicht in der Gruppe");
  }
  console.log(`ok  Imposter bekommt genau ein Hilfswort („${hw}"), nicht das gesuchte`);
}

// --- Rollen bestätigen: erst wenn alle gedrückt haben, geht es los ----------

for (const c of alleC.slice(0, 4)) c.send({ t: "gesehen" });
await bis(() => A.runde.gesehen === 4, "vier haben gesehen");
if (A.runde.schritt !== "rollen") throw new Error("Vor dem letzten Bestätigen gestartet");
alleC[4].send({ t: "gesehen" });
await bis(() => A.runde.schritt === "hinweise", "Hinweisrunde offen");
console.log("ok  Hinweisrunde startet erst, wenn alle fünf ihre Karte bestätigt haben");

// --- Hinweisreihe -----------------------------------------------------------

{
  const reihe = A.runde.reihenfolge.map((p) => p.name);
  if (reihe.length !== 5) throw new Error("Die Reihe hat nicht fünf Einträge");
  console.log("    Reihe:", reihe.join(" → "));

  // Wer nicht dran ist, darf nicht weiterschalten.
  const dranId = A.runde.dranId;
  const fremd = alleC.find((c) => c.you !== dranId && c.you !== A.room.hostId);
  fremd.send({ t: "hinweis" });
  await warte(150);
  if (A.runde.dranId !== dranId) throw new Error("Ein Fremder konnte weiterschalten");
  console.log("ok  nur wer dran ist (oder der Host) schaltet den Hinweis weiter");

  for (let i = 0; i < 5; i++) {
    const dran = von(A.runde.dranId);
    dran.send({ t: "hinweis" });
    await warte(120);
  }
  await bis(() => A.runde.schritt === "abstimmen", "Abstimmung offen");
  console.log("ok  nach fünf Hinweisen geht es automatisch zur Abstimmung");
}

// --- Abstimmung: den Imposter erwischen ------------------------------------

const imp1 = alleC.find((c) => c.runde.binImposter);
{
  // Sich selbst wählen muss abprallen.
  A.send({ t: "stimme", ziel: A.you });
  await warte(150);
  if (A.runde.stimmenAb !== 0) throw new Error("Man konnte sich selbst wählen");
  console.log("ok  sich selbst zu wählen prallt ab");

  // Alle ausser dem Imposter zeigen auf ihn; er zeigt irgendwohin.
  for (const c of alleC) {
    const ziel = c === imp1 ? alleC.find((x) => x !== imp1).you : imp1.you;
    c.send({ t: "stimme", ziel });
    await warte(60);
  }
  await bis(() => A.runde.schritt === "raten", "Imposter erwischt, darf raten");
  console.log("ok  einstimmig erkannt → der Imposter kommt zum Raten");

  // Erst jetzt bekommt er die Wortliste – ohne sie hätte er nichts zum Raten.
  if (!imp1.runde.begriffe?.length) {
    throw new Error("Der Imposter bekommt beim Raten keine Wortliste");
  }
  console.log("ok  die Wortliste bekommt der Imposter erst zum Raten");

  // Nur der Imposter darf raten.
  const anderer = alleC.find((c) => c !== imp1);
  anderer.send({ t: "raten", begriff: A.runde.begriffe[0] });
  await warte(150);
  if (A.runde.schritt !== "raten") throw new Error("Ein anderer konnte raten");
  console.log("ok  nur der Imposter darf raten");
}

// --- Falsch geraten: die Gruppe bekommt je einen Punkt ----------------------

{
  const richtig = alleC.find((c) => !c.runde.binImposter).runde.begriff;
  const falsch = A.runde.begriffe.find((w) => w !== richtig);
  imp1.send({ t: "raten", begriff: falsch });
  await bis(() => A.runde.schritt === "aufloesung", "aufgelöst");

  const e = A.runde.ergebnis;
  if (!e.erkannt) throw new Error("Die Auflösung meldet nicht-erkannt, obwohl alle richtig lagen");
  if (e.ratenRichtig) throw new Error("Falsch geraten gilt als richtig");
  if (e.begriff !== richtig) throw new Error("Die Auflösung nennt das falsche Wort");
  // Jetzt kennt jeder alles – vorher niemand zu viel.
  for (const c of alleC) {
    if (c.runde.ergebnis?.imposterId !== imp1.you) {
      throw new Error(`${c.name} sieht den Imposter in der Auflösung nicht`);
    }
  }
  console.log(`ok  Auflösung: erkannt, „${falsch}" statt „${richtig}" geraten`);

  await bis(() => A.room.players.find((p) => p.id === imp1.you)?.punkte === 0, "Imposter ohne Punkt");
  const gruppe = A.room.players.filter((p) => p.id !== imp1.you);
  if (!gruppe.every((p) => p.punkte === 1)) {
    throw new Error("Nicht jeder in der Gruppe bekam genau einen Punkt: " +
      JSON.stringify(gruppe.map((p) => [p.name, p.punkte])));
  }
  console.log("ok  erwischt und danebengeraten → je 1 Punkt für die vier anderen, 0 für ihn");
}

// --- Runde 2: der Imposter kommt durch --------------------------------------

A.send({ t: "weiter" });
await bis(() => A.runde.n === 2 && A.runde.schritt === "rollen", "Runde 2");

const imp2 = alleC.find((c) => c.runde.binImposter);
if (imp2.you === imp1.you) throw new Error("Zweimal hintereinander derselbe Imposter");
console.log(`ok  Runde 2: neuer Imposter (${imp2.name}), nicht zweimal derselbe`);
if (A.runde.gruppe === "" || A.runde.gruppe == null) throw new Error("Runde 2 ohne Gruppe");

for (const c of alleC) c.send({ t: "gesehen" });
await bis(() => A.runde.schritt === "hinweise", "Hinweisrunde 2");
A.send({ t: "abstimmung" });
await bis(() => A.runde.schritt === "abstimmen", "Abstimmung vorgezogen");
console.log("ok  der Host kann die Hinweisrunde abkürzen");

{
  // Diesmal Gleichstand: zwei Unschuldige bekommen je zwei Stimmen.
  const unschuldig = alleC.filter((c) => c !== imp2);
  const [u1, u2, u3, u4] = unschuldig;
  u1.send({ t: "stimme", ziel: u2.you });
  u2.send({ t: "stimme", ziel: u1.you });
  u3.send({ t: "stimme", ziel: u2.you });
  u4.send({ t: "stimme", ziel: u1.you });
  imp2.send({ t: "stimme", ziel: u3.you });
  await bis(() => A.runde.schritt === "aufloesung", "Runde 2 aufgelöst");

  const e = A.runde.ergebnis;
  if (e.erkannt) throw new Error("Bei Gleichstand wurde jemand als erkannt gewertet");
  if (e.verdaechtigtId !== null) throw new Error("Bei Gleichstand steht trotzdem ein Verdächtigter fest");
  console.log("ok  Gleichstand zählt als nicht-geeinigt – der Imposter ist durch");

  // imp2 war in Runde 1 nicht der Imposter, hat dort also mit der Gruppe
  // 1 Punkt bekommen. Jetzt kommt er durch: +2. Macht 3.
  const punkte = A.room.players.find((p) => p.id === imp2.you).punkte;
  if (punkte !== 3) {
    throw new Error(`Erwartet 1 (Runde 1) + 2 (durchgekommen) = 3, gezählt: ${punkte}`);
  }
  // Und die Gruppe darf für diese Runde nichts bekommen haben.
  for (const c of unschuldig) {
    const p = A.room.players.find((x) => x.id === c.you);
    const soll = c.you === imp1.you ? 0 : 1;
    if (p.punkte !== soll) {
      throw new Error(`${c.name}: erwartet ${soll} Punkte, hat ${p.punkte}`);
    }
  }
  console.log(`ok  durchgekommen → +2 für ${imp2.name} (Stand: 3), Gruppe bekommt nichts`);
}

// --- Endstand ----------------------------------------------------------------

A.send({ t: "ende" });
await bis(() => A.final, "Endstand");
console.log(`\nEndstand nach ${A.final.runden} Runden:`);
for (const p of A.final.tabelle) {
  console.log(`  ${p.name.padEnd(6)} ${p.punkte} Punkte, ${p.malImposter}× Imposter,` +
    ` ${p.entkommen}× durchgekommen`);
}
if (A.final.runden !== 2) throw new Error("Rundenzahl im Endstand stimmt nicht");
for (let i = 1; i < A.final.tabelle.length; i++) {
  if (A.final.tabelle[i - 1].punkte < A.final.tabelle[i].punkte) {
    throw new Error("Der Endstand ist nicht absteigend sortiert");
  }
}
const impGesamt = A.final.tabelle.reduce((s, p) => s + p.malImposter, 0);
if (impGesamt !== 2) throw new Error("Es wurden nicht genau zwei Imposter verteilt: " + impGesamt);
console.log("ok  Endstand sortiert, genau ein Imposter je Runde");

A.send({ t: "again" });
await bis(() => A.room.phase === "lobby", "zurück im Warteraum");
if (A.room.players.some((p) => p.punkte !== 0)) throw new Error("Punkte nicht zurückgesetzt");
console.log("ok  Nochmal setzt alles zurück");

// --- Hilfswort aus: der Imposter bekommt gar nichts -------------------------

A.send({ t: "settings", hilfswort: false });
await bis(() => A.room.settings.hilfswort === false, "Hilfswort abgeschaltet");
for (const c of [B, C, D, E]) c.send({ t: "ready", value: true });
await bis(() => A.room.players.every((p) => p.ready || p.host), "wieder alle bereit");
A.send({ t: "start" });
await bis(() => A.runde && A.room.phase === "playing", "Runde mit Hilfswort aus");

{
  const imp = alleC.find((c) => c.runde.binImposter);
  if (imp.runde.hilfswort !== null) {
    throw new Error(`Hilfswort ist aus, der Imposter bekommt trotzdem „${imp.runde.hilfswort}"`);
  }
  if (imp.runde.begriffe) throw new Error("Hilfswort aus, aber die Liste kommt trotzdem");
  if (!imp.runde.gruppe) throw new Error("Der Imposter kennt nicht einmal die Gruppe");
  // Die Gruppe merkt vom Schalter nichts.
  for (const c of alleC.filter((c) => c !== imp)) {
    if (!c.runde.begriffe?.includes(c.runde.begriff)) {
      throw new Error(`${c.name} sieht seine Wortliste nicht mehr`);
    }
  }
  console.log("ok  Hilfswort aus → nur die Gruppe, kein Wort, keine Liste für den Imposter");
}

if (alleC.some((c) => c.fehler.length)) {
  throw new Error("Fehlermeldungen: " + JSON.stringify(alleC.map((c) => c.fehler)));
}
console.log("\nALLES GRÜN");
Deno.exit(0);
