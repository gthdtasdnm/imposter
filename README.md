# Imposter 🕵️

Alle bekommen dasselbe Wort – bis auf einen. Reihum sagt jeder laut ein Wort
dazu; wer zu deutlich wird, verrät das Wort, wer zu vage bleibt, wird selbst
verdächtigt. Am Ende zeigt ihr aufeinander.

Seit dem 02.09.2026 gibt es das Ganze in **zwei Arten** – siehe unten: in der
zweiten weiß auch der Imposter nicht, dass er einer ist.

**Das Handy teilt nur Karten aus.** Es gibt keine Hinweisschritte, keine
Abstimmung und keine Punkte – all das macht der Tisch unter sich aus. Der
Bildschirm zeigt eine zugedeckte Karte und darüber einen Satz: wer anfängt und
wie herum es geht.

Läuft auf **Deno**, ohne eine einzige externe Abhängigkeit. Kein Build-Schritt,
kein `node_modules`, ein Prozess.

---

## Starten

```bash
deno task dev          # http://localhost:8073/
PORT=9000 deno task dev
deno task check        # Typprüfung
deno task probe        # teilt mit fünf Clients aus und prüft die Geheimhaltung
```

Zum Ausprobieren allein: die Seite in **mehreren Browserfenstern** öffnen. Jedes
Fenster ist ein eigener Spieler (die Sitzung hängt am `sessionStorage`, ein
zweiter Tab im selben Fenster wäre dieselbe Person).

## Zwei Arten

Der Host stellt sie im Warteraum ein, gewechselt wird nur dort.

| | **Klassisch** | **Zwei Wörter** |
|---|---|---|
| Wer bekommt ein Wort | alle außer einem | **jeder** |
| Was der Imposter weiß | dass er es ist | **nichts** |
| Woher die Wörter | `begriffe.js` (Gruppe + Begriff) | `paare.js` (ein Wortpaar) |
| Was aufgelöst wird | wer es war, wie das Wort hieß | wer ein anderes Wort hatte, und welches |

**Zwei Wörter** dreht den Kniff um. Jeder bekommt ein Wort, aber eines davon ist
ein anderes: die einen haben *Museum*, einer hat *Bordell*. Niemand weiß, wer
abweicht – **auch der Abweichler nicht**. Alle reden also in gutem Glauben, und
es dauert ein paar Runden, bis jemand merkt, dass da etwas nicht zusammenpasst.
Der Reiz liegt darin, dass niemand schauspielert: es gibt keinen, der lügt.

### Was ein gutes Paar ausmacht

**Nicht** zwei Wörter aus derselben Schublade. Kajak und Kanu wären das
Langweiligste: dort passt jeder Satz auf beides, und es fällt nie etwas auf.

Gesucht ist das Gegenteil – zwei Wörter, deren **Bedeutung weit auseinander
liegt**, deren **Beschreibungen sich aber decken**. Museum und Bordell: man geht
hinein, zahlt Eintritt, sieht sich um, fasst besser nichts an, trifft Menschen,
sieht nackte Frauen. Jeder Satz stimmt für beide – und genau deshalb ist es
komisch, wenn am Ende herauskommt, wer woran gedacht hat.

Die Prüffrage für ein neues Paar: **Kann man fünf Sätze sagen, die auf beide
passen, und ist der Abstand trotzdem albern?**

Welche Seite die Mehrheit bekommt, wird **jede Runde ausgelost**. Läge das
harmlosere Wort immer bei der Mehrheit, wüsste jeder mit dem schrägen Wort
sofort, dass er der Abweichler ist – und das ganze Spiel wäre hin. `probe.js`
misst über 400 Züge nach, dass beide Seiten drankommen.

### Harmlos und 18+

Zwei getrennte Stapel in `paare.js`, und die Trennung ist streng:

* **Harmlos** ist die Voreinstellung – ohne Sex, Rausch und Körperliches. Der
  Witz liegt allein im Abstand (Hochzeit/Beerdigung, Katze/Chef,
  Sandkasten/Baustelle).
* **18+** geht genau dorthin, wo man es erwartet. Der Stapel wird **nie**
  untergemischt: er kommt nur in einen Raum, dessen Host ihn ausdrücklich
  eingestellt hat, und jedes Gerät fragt einmal nach – beim Einschalten **und**
  beim Beitritt in einen Raum, der schon so steht. Der zweite Fall ist der
  wichtigere: dort hat man die Entscheidung nicht selbst getroffen. Bestätigt
  wird im `localStorage` unter `imposter_ab18`.
* Die **klassische Art** fasst `paare.js` gar nicht erst an. Auch wenn „derb"
  noch eingestellt ist, kommt dort nichts davon vor.

Im Paar steht links immer das unverfängliche und rechts das anstößige Wort.
Das ist eine Zusage, keine Beschreibung: `probe.js` prüft, dass **kein** Wort
der rechten Spalte je in einem harmlosen Raum oder in der klassischen Art
auftaucht – und dass es auch nicht im harmlosen Stapel oder in `begriffe.js`
steht. Die linke Spalte darf sich überschneiden (Sauna, Museum, Angeln).

Gleiches Muster wie bei `/nochnie/` und `/amehesten/`, siehe `doku/inhalte.md`.

## An den Tisch kommen

Wie bei den anderen Spielen: Name eintippen, **Raum eröffnen** oder über die
Liste bzw. den vierstelligen **Code** beitreten. Der geteilte Link mit `#CODE`
führt direkt hinein.

**Drei bis zehn** Leute, jeder mit eigenem Gerät, alle am selben Tisch. Drei
reicht, seit die Abstimmung nicht mehr auf dem Handy läuft – wie viele daran
Spaß haben, weiß der Tisch besser als der Server.

Es gibt **kein „Bereit"**. Wer im Raum ist, ist dabei; der Host sieht ja, ob
alle das Handy vor sich haben, er sitzt daneben.

## Eine Runde

1. **Der Host tippt auf „Austeilen".** Sofort hat jeder seine Karte – nichts zu
   bestätigen, kein Warten auf den Letzten.
2. **Jeder schiebt seine Karte kurz auf** und sieht darunter sein Wort.
3. **Ihr redet.** Reihum ein Wort. Oben steht, wer anfängt und wie herum es
   geht; wer gerade dran ist, weiß der Tisch danach von selbst.
4. **Ihr zeigt aufeinander.** Laut, gleichzeitig, wie ihr wollt.
5. **Der Host tippt auf „Auflösen".** Alle sehen, wer der Imposter war und wie
   das Wort hieß. Dann „Nächste Runde".

Mehr Knöpfe gibt es nicht, und alle vier gehören dem Host. Jeder Knopf, auf den
die Runde warten muss, hält eine Runde auf, die längst weiterredet – der Deckel
ist deshalb reine Bildschirmsache: der Server weiß nicht, wer schon nachgesehen
hat, und niemand wartet darauf.

## Die Karte liegt zugedeckt

Bis zum 19.08.2026 stand das Wort offen auf dem Bildschirm. Wer es gelesen
hatte, drehte das Handy um oder schaltete es aus – und ein ausgeschaltetes Handy
ist eine gekappte Verbindung. Reihum fiel so der halbe Tisch aus dem Raum.

Jetzt liegt die Karte zugedeckt: **Deckel nach oben schieben und halten**, beim
Loslassen fällt er wieder zu. Ab der halben Höhe springt er ganz auf, damit man
nicht auf zwei Zentimeter genau halten muss; ein bloßes Antippen deckt nichts
auf. Ohne Finger geht es mit Leertaste oder Enter – ebenfalls gehalten. Das
Handy kann dabei offen liegen bleiben, und genau das ist der Sinn.

Wer schon nachgesehen hat, sieht das dem Deckel an („schon angesehen"). Sonst
schiebt man aus Unsicherheit dreimal nach und hält die Karte länger offen als
nötig.

Offen liegt die Karte nur in zwei Fällen: nach dem **Auflösen** – da ist nichts
mehr geheim – und bei jemandem, der mitten in die Runde gekommen ist und
ohnehin kein Wort hat.

## Wer anfängt, und wie herum

Ein Satz über der Karte, für alle gleich:

> **Mira** fängt an → dann reihum nach rechts

Klein, aber ohne ihn fängt jede Runde mit derselben Diskussion an, und mitten im
Reden weiß plötzlich niemand mehr, wer dran gewesen wäre. Der Anfänger wird
jede Runde neu gezogen und ist **nie zweimal hintereinander** derselbe – zuerst
reden ist die undankbarste Rolle. Die Richtung wird gewürfelt.

Es ist eine **Ansage, keine Reihenfolge**: der Server verwaltet nichts davon,
niemand bekommt ein „du bist dran", und niemand wartet auf einen Knopf. Gesagt
wird es einmal, dann redet der Tisch.

Wer **mitten in einer laufenden Runde** dazukommt, bekommt kein Wort mehr,
sondern wartet auf das nächste Austeilen – sonst hätte der Tisch unbemerkt einen
zweiten Mitwisser.

## Was der Imposter sieht

In der klassischen Art: nur, dass er es ist. Kein Wort, keine Gruppe, keine
Wortliste.

In der Art **Zwei Wörter** sieht er *sein Wort* – und sonst nichts. `binImposter`
kommt dort bei niemandem an, auch nicht als `false` bei den anderen: stünde der
Wert auch nur an einer Stelle, ließe er sich am eigenen Gerät ablesen. Was der
Client nicht bekommt, kann er nicht verraten.

Bis zum 19.08.2026 gab es dazu ein **Hilfswort**: ein einzelnes Wort aus
derselben Gruppe, nie das gesuchte. Es ist ersatzlos geflogen. Es war entweder
zu nah am gesuchten Wort und damit die halbe Antwort, oder zu weit weg und damit
eine Fährte, die den Imposter im ersten Satz auffliegen ließ. Ohne es bleibt
ihm, was das Spiel eigentlich ausmacht: zuhören und mitreden.

## Die Begriffe

`begriffe.js` hat zwölf Gruppen mit je zwölf Begriffen. Jede Runde wählt der
Server eine Gruppe – nie zweimal dieselbe hintereinander – und daraus einen
Begriff.

Jede Gruppe braucht **mindestens acht** Begriffe: darunter wiederholt sich an
einem Abend dasselbe Wort, und die nach dem Auflösen genannte Gruppe verriete
für die nächste Runde zu viel. `probe.js` prüft das, prüft auf Doppelte
innerhalb einer Gruppe – und darauf, dass **kein Begriff in zwei Gruppen**
vorkommt.

Alle Begriffe sind gewöhnliche Gattungsbegriffe: keine Marken, keine Werktitel,
keine Eigennamen. Regeln sind frei, fremde Wortlisten nicht – und ein
geschützter Titel auf dem Bildschirm wäre ein Problem, das dieses Spiel nicht
braucht.

## Warum das Wort beim Server bleibt

Das ganze Spiel hängt daran, dass der Imposter den Begriff nicht kennt. Deshalb
verlässt er den Server nur an die Gruppe; an den Imposter geht `begriff: null`
und `binImposter: true`, und `ergebnis` bleibt `null`, bis aufgelöst wurde. Ein
Blick in die Entwicklerwerkzeuge bringt ihm nichts – dort ist das Wort nie
angekommen.

`probe.js` prüft genau das mit fünf echten Verbindungen: nach dem Austeilen muss
**genau ein** Client `binImposter` haben, und in seiner ganzen Karte darf das
gesuchte Wort an keiner Stelle vorkommen.

Für die Art **Zwei Wörter** gilt dasselbe in beide Richtungen: vier weitere
Clients teilen aus, und in keiner Karte darf das jeweils *andere* Wort stehen –
weder bei der Mehrheit das des Abweichlers noch umgekehrt. Geprüft wird gegen
den rohen Nachrichtentext, nicht gegen einzelne Felder.

## Ein Imposter, nicht zwei

Bewusst genau einer, auch zu zehnt. Zwei Imposter, die sich nicht kennen, sind
ein anderes Spiel.

Wer zweimal hintereinander Imposter wäre, würde nicht mehr verdächtigt –
deshalb schließt der Server die Person der Vorrunde aus.

## Wenn jemand geht

Der Unterschied zwischen **Verbindungsabriss** und **wirklich weggehen** ist
hier wichtiger als in den anderen Spielen. Auf dem Handy stirbt der Socket
schon, wenn man kurz die Nachrichten-App aufmacht – und genau das machen Leute
an einem Tisch dauernd.

Seit dem 19.08.2026 gilt deshalb: **endgültig geht nur, wer selbst auf
„Verlassen" tippt.** Alles andere ist eine Pause, und eine Pause kostet nichts.

| Was passiert | Was der Server tut |
|---|---|
| Bildschirm gesperrt, Tab weggewischt, Funkloch | Der Platz bleibt **20 Minuten** reserviert. Im Warteraum genauso wie mitten in der Runde. |
| Zurückgekommen | Derselbe Platz, dieselbe Karte, dieselbe Runde. Der Tisch hat nichts gemerkt. |
| Der **Host** ist weg | Sein Zeichen bleibt **45 Sekunden** liegen. Erst dann wandert es weiter, sonst könnte niemand mehr austeilen. |
| Ausgeteilt, während jemand weg war | Er ist trotzdem dabei und findet seine Karte vor, sobald er wieder hinsieht. |
| Alle sind weg | Der Raum steht noch **30 Minuten**. Der Code funktioniert so lange weiter. |
| „Verlassen" getippt | Platz weg. War es der Imposter, wird die Runde neu ausgeteilt – sie hätte sonst kein Ziel mehr. |

Vorher gab der Warteraum den Platz **sofort** frei: wer wiederkam, war ein
neuer Spieler, das Hostzeichen stand woanders, und der halbe Tisch spann.

Der Client hilft mit: er meldet sich alle 25 s (die Geisterwache im Server wirft
sonst raus, wer schweigt), und sobald der Bildschirm wieder angeht, verbindet er
**sofort** neu, statt die Wartezeit abzusitzen – auf dem Handy laufen Timer im
Hintergrund nicht weiter.

Nachgestellt wird das alles in `probe.js` mit echten Abbrüchen: kappen,
weiterspielen, wiederkommen, vergleichen.

## Dateien

| Datei | Was |
|---|---|
| `server.js` | statische Dateien, WebSocket, Räume, Kartenausgabe |
| `begriffe.js` | die zwölf Begriffsgruppen der klassischen Art |
| `paare.js` | die Wortpaare der blinden Art, harmlos und 18+ streng getrennt |
| `bremse.js` | gemeinsames Rate-Limiting, **wortgleich in allen Spielen** |
| `probe.js` | teilt mit fünf bzw. vier Clients aus, prüft Geheimhaltung, Ansage, Plätze und die Trennung der Stapel |
| `public/index.html` | drei Bildschirme plus die Hilfe |
| `public/style.css` | oben der gemeinsame Lobby-Block, darunter das Eigene |
| `public/app.js` | Verbindung, Warteraum, Karte, Auflösung |

Dazu im Browser, weil eine Rechenprobe keinen Deckel schiebt:

```bash
cd /var/www/html/imposter
PORT=8086 HOST=127.0.0.1 deno run --allow-net --allow-read --allow-env --allow-sys server.js &
cd /root/werkzeug-screenshots && node pruefe-imposter.mjs
ss -tlnp | grep ':8086 '   # danach über den Port beenden, nie per pkill
```

Sie fragt den Browser mit `elementFromPoint`, wer an der Stelle des Wortes
obenauf liegt – gemessen wird, was man **sieht**, nicht was im HTML steht.

`bremse.js` und der CSS-Block bis `══ Gemeinsame Lobby-Basis ══ Ende ══` sind in
allen Spielen identisch und werden **von Hand** synchron gehalten. Wer dort
etwas ändert, ändert es überall.

## Betrieb

Port **8073**, gebunden auf `127.0.0.1`, davor Apache als Reverse Proxy unter
`/imposter/`. Dienst: `imposter.service` (systemd, läuft als `www-data`).

```bash
systemctl status imposter
journalctl -u imposter -f
```

Der Zustand liegt vollständig im RAM. Ein Neustart wirft alle laufenden Partien
weg – das ist gewollt, es gibt nichts zu sichern.
