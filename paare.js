// Die Wortpaare fuer die blinde Betriebsart („Zwei Woerter").
//
// Anders als `begriffe.js`: dort gibt es eine Gruppe und **einen** Begriff, und
// einer bekommt gar nichts. Hier bekommt **jeder** ein Wort – nur eines davon
// ist ein anderes. Niemand weiss, ob er die Mehrheit hat oder der Abweichler
// ist, auch der Abweichler nicht. Deshalb reden alle in gutem Glauben, und die
// Schieflage faellt erst nach ein paar Runden auf.
//
// **Wie ein gutes Paar aussieht.** Nicht Synonyme, nicht Nachbarn aus derselben
// Schublade – Kajak und Kanu waeren das Langweiligste, was man nehmen kann:
// dort passt jeder Satz auf beides, und es faellt nie etwas auf.
//
// Gesucht ist das Gegenteil: zwei Woerter, deren **Bedeutung weit auseinander
// liegt**, deren **Beschreibungen sich aber decken**. Museum und Bordell: man
// geht hinein, zahlt Eintritt, sieht sich um, schaut lieber als anzufassen,
// trifft Menschen, sieht nackte Frauen – jeder Satz stimmt fuer beide, und
// genau deshalb ist es komisch, wenn am Ende herauskommt, wer woran gedacht
// hat. Wer ein Paar dazuschreibt, prueft es an dieser Frage: **kann man fuenf
// Saetze sagen, die auf beide passen, und ist der Abstand trotzdem albern?**
//
// Zwei Stapel, streng getrennt (`doku/inhalte.md`):
//   HARMLOS – ohne Sex, Rausch und Koerperliches. Voreinstellung.
//   DERB    – 18+, geht genau dorthin. Nur nach ausdruecklicher Bestaetigung.
//
// Alles selbst geschrieben: keine Marken, keine Werktitel, keine Eigennamen,
// nichts aus einer fremden Liste abgetippt.

/** Ohne Sex, Rausch, Koerperliches. Der Witz liegt allein im Abstand. */
export const HARMLOS = [
  ["Hochzeit", "Beerdigung"],
  ["Fitnessstudio", "Umzug"],
  ["Kindergeburtstag", "Betriebsfeier"],
  ["Zahnarzt", "Tätowierer"],
  ["Bibliothek", "Kirche"],
  ["Sauna", "Wartezimmer"],
  ["Kindergarten", "Kaserne"],
  ["Klassenfahrt", "Gefängnis"],
  ["Krankenhaus", "Hotel"],
  ["Fußballstadion", "Gottesdienst"],
  ["Angeln", "Meditieren"],
  ["Friseurbesuch", "Therapiestunde"],
  ["Autowerkstatt", "Arztpraxis"],
  ["Flugzeug", "Kinosaal"],
  ["Aquarium", "Fernseher"],
  ["Katze", "Chef"],
  ["Möbelhaus", "Labyrinth"],
  ["Marathon", "Behördengang"],
  ["Weihnachten", "Steuererklärung"],
  ["Zoo", "Schwimmbad"],
  ["Achterbahn", "Bewerbungsgespräch"],
  ["Schweinestall", "WG-Küche"],
  ["Supermarktkasse", "Beichtstuhl"],
  ["Fahrstunde", "erste Verabredung"],
  ["Umkleidekabine", "Fotoautomat"],
  ["Weihnachtsmann", "Paketbote"],
  ["Bergwanderung", "Altbautreppenhaus"],
  ["Sandkasten", "Baustelle"],
  ["Puppenhaus", "Musterwohnung"],
  ["Zirkus", "Bundestag"],
];

/**
 * 18+. Derselbe Bauplan, nur ohne Bremse: die Beschreibungen decken sich, die
 * Bedeutung nicht. Dieser Stapel wird **nie** untergemischt – er kommt nur in
 * einen Raum, dessen Host ihn ausdruecklich eingestellt hat, und jedes Geraet
 * fragt einmal nach, bevor es ihn zeigt.
 */
//
// **Die Reihenfolge im Paar ist hier eine Zusage, kein Zufall:** links steht
// das unverfaengliche Wort, rechts das anstoessige. Nur so laesst sich in der
// Probe nachweisen, dass keines der rechten Woerter jemals in einem harmlosen
// Raum oder in der klassischen Art auftaucht – die linke Spalte darf sich mit
// `HARMLOS` und `begriffe.js` ueberschneiden (Sauna, Museum, Angeln), die
// rechte niemals. Wer ein Paar dazuschreibt, haelt sich daran, sonst faellt
// genau dieser Nachweis lautlos in sich zusammen.
export const DERB = [
  ["Museum", "Bordell"],
  ["Gurke", "Penis"],
  ["Erdnussbutter", "Vagina"],
  ["Eiswürfel", "Nippel"],
  ["Schlagsahne", "Sperma"],
  ["Rakete", "Erektion"],
  ["Zeltstange", "Morgenlatte"],
  ["Teebeutel", "Hodensack"],
  ["Luftballon", "Kondom"],
  ["Nonne", "Domina"],
  ["Zahnseide", "Tanga"],
  ["Bohrmaschine", "Vibrator"],
  ["Angeln", "Dating-App"],
  ["Puderzucker", "Kokain"],
  ["Desinfektionsmittel", "Wodka"],
  ["Schaufensterpuppe", "Sexpuppe"],
  ["Klempner", "Pornodarsteller"],
  ["Zäpfchen", "Analplug"],
  ["Grippe", "Kater"],
  ["Beichtstuhl", "Gloryhole"],
  ["Honigmelonen", "Brüste"],
  ["Sauna", "Swingerclub"],
  ["Teppichklopfer", "Peitsche"],
  ["Kerze", "Dildo"],
  ["Massagestudio", "Escort"],
  ["Achterbahn", "One-Night-Stand"],
  ["Handcreme", "Gleitgel"],
];

export const STAPEL = ["harmlos", "derb"];

export const stapelFuer = (name) => (name === "derb" ? DERB : HARMLOS);

/** Ein Schluessel, an dem sich dasselbe Paar wiedererkennen laesst. */
const schluessel = (paar) => paar[0] + "|" + paar[1];

/**
 * Ein Paar ziehen – nicht dasselbe wie beim letzten Mal – und **auslosen,
 * welche Seite die Mehrheit bekommt**. Das Auslosen ist kein Zierrat: laege
 * das harmlosere Wort immer bei der Mehrheit, wuesste jeder mit dem schraegen
 * Wort sofort, dass er der Abweichler ist, und das ganze Spiel waere hin.
 */
export function ziehePaar(stapelName, letztes) {
  const stapel = stapelFuer(stapelName);
  const auswahl = stapel.length > 1
    ? stapel.filter((p) => schluessel(p) !== letztes)
    : stapel;
  const paar = auswahl[Math.floor(Math.random() * auswahl.length)];
  const dreh = Math.random() < 0.5;
  return {
    viele: dreh ? paar[0] : paar[1],
    einer: dreh ? paar[1] : paar[0],
    paar: schluessel(paar),
  };
}
