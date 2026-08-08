// Die Begriffsgruppen. Jede Runde waehlt der Server **eine Gruppe** und daraus
// **einen Begriff**. Alle ausser dem Imposter erfahren den Begriff; die Gruppe
// selbst sehen alle, auch der Imposter.
//
// Genau das ist der Kniff: der Imposter weiss, dass es um Werkzeug geht, aber
// nicht, ob um Hammer oder Bohrmaschine. Ohne die sichtbare Gruppe koennte er
// gar nichts sagen und waere nach einem Satz enttarnt; mit ihr hat er eine
// Chance – und am Ende eine begruendete Rateoption.
//
// Alle Begriffe sind bewusst gewoehnliche Gattungsbegriffe: keine Marken, keine
// Werktitel, keine Eigennamen. Regeln sind frei, fremde Wortlisten nicht – und
// ein geschuetzter Titel auf dem Bildschirm waere ein Problem, das dieses Spiel
// nicht braucht.
//
// Jede Gruppe braucht **mindestens acht** Begriffe: der Imposter darf am Ende
// raten, und bei vier Woertern waere das kein Raten mehr.

export const GRUPPEN = [
  {
    name: "Orte in der Stadt",
    begriffe: [
      "Bahnhof", "Schwimmbad", "Bibliothek", "Friseursalon", "Baumarkt",
      "Zahnarztpraxis", "Kino", "Wochenmarkt", "Fitnessstudio", "Museum",
      "Postfiliale", "Parkhaus",
    ],
  },
  {
    name: "Urlaub",
    begriffe: [
      "Strand", "Skipiste", "Kreuzfahrtschiff", "Berghütte", "Campingplatz",
      "Flughafen", "Ferienwohnung", "Wanderweg", "Hotelbuffet", "Zeltlager",
      "Badesee", "Reisebus",
    ],
  },
  {
    name: "Bei der Arbeit",
    begriffe: [
      "Großraumbüro", "Baustelle", "Küche im Restaurant", "Krankenhaus",
      "Fabrikhalle", "Callcenter", "Labor", "Werkstatt", "Lagerhalle",
      "Klassenzimmer", "Serverraum", "Kassenbereich",
    ],
  },
  {
    name: "Werkzeug",
    begriffe: [
      "Hammer", "Bohrmaschine", "Zollstock", "Wasserwaage", "Schraubenzieher",
      "Zange", "Säge", "Schleifpapier", "Leiter", "Pinsel", "Cuttermesser",
      "Akkuschrauber",
    ],
  },
  {
    name: "Essen und Trinken",
    begriffe: [
      "Suppe", "Pfannkuchen", "Käseplatte", "Grillwurst", "Salat",
      "Nudelauflauf", "Eisbecher", "Brötchen", "Currywurst", "Obstsalat",
      "Kaffee", "Limonade",
    ],
  },
  {
    name: "Sport",
    begriffe: [
      "Marathon", "Turmspringen", "Klettern", "Tischtennis", "Reiten",
      "Rudern", "Boxen", "Turnen", "Radrennen", "Segeln", "Eishockey",
      "Bogenschießen",
    ],
  },
  {
    name: "Tiere",
    begriffe: [
      "Igel", "Pinguin", "Kamel", "Eichhörnchen", "Waschbär", "Adler",
      "Delfin", "Fledermaus", "Schildkröte", "Wildschwein", "Biene", "Wolf",
    ],
  },
  {
    name: "Musik",
    begriffe: [
      "Schlagzeug", "Geige", "Blockflöte", "Konzertflügel", "Trompete",
      "Akkordeon", "Chorprobe", "Kirchenorgel", "Kontrabass", "Mundharmonika",
      "Gitarre", "Xylofon",
    ],
  },
  {
    name: "Unterwegs",
    begriffe: [
      "Straßenbahn", "Fahrrad", "Fähre", "Nachtzug", "Heißluftballon",
      "Motorrad", "Rolltreppe", "Seilbahn", "Taxi", "Lastwagen", "Ruderboot",
      "Skateboard",
    ],
  },
  {
    name: "Im Haushalt",
    begriffe: [
      "Waschmaschine", "Bügelbrett", "Staubsauger", "Kühlschrank", "Besen",
      "Nähmaschine", "Geschirrspüler", "Wäscheleine", "Backofen", "Mülltrennung",
      "Gefriertruhe", "Wasserkocher",
    ],
  },
  {
    name: "Wetter und Jahreszeit",
    begriffe: [
      "Gewitter", "Schneesturm", "Nebel", "Hitzewelle", "Herbstlaub",
      "Frühlingsregen", "Hagel", "Sonnenaufgang", "Glatteis", "Sturmflut",
      "Regenbogen", "Dauerfrost",
    ],
  },
  {
    name: "Feste und Anlässe",
    begriffe: [
      "Hochzeit", "Kindergeburtstag", "Umzug", "Abschlussfeier", "Silvester",
      "Beerdigung", "Jahrmarkt", "Konzertabend", "Familientreffen",
      "Vereinsfest", "Flohmarkt", "Grillabend",
    ],
  },
];

/** Eine zufaellige Gruppe samt einem Begriff daraus. */
export function zieheBegriff(letzteGruppe) {
  // Nicht zweimal dieselbe Gruppe hintereinander – sonst faellt die Runde
  // spuerbar flach ab, weil alle noch die alte Liste im Kopf haben.
  const auswahl = GRUPPEN.length > 1
    ? GRUPPEN.filter((g) => g.name !== letzteGruppe)
    : GRUPPEN;
  const gruppe = auswahl[Math.floor(Math.random() * auswahl.length)];
  const begriff = gruppe.begriffe[Math.floor(Math.random() * gruppe.begriffe.length)];
  return { gruppe: gruppe.name, begriffe: gruppe.begriffe, begriff };
}
