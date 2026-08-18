# Imposter 🕵️

Alle bekommen dasselbe Wort – bis auf einen. Reihum sagt jeder laut ein Wort
dazu; wer zu deutlich wird, verrät das Wort, wer zu vage bleibt, wird selbst
verdächtigt. Am Ende zeigt ihr aufeinander.

**Das Handy teilt nur Karten aus.** Es gibt keine Reihenfolge, keine
Hinweisschritte, keine Abstimmung und keine Punkte – all das macht der Tisch
unter sich aus. Der Bildschirm zeigt ein Wort und sonst nichts.

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
2. **Ihr redet.** Reihum ein Wort, wer anfängt und wie herum es geht, macht ihr
   selbst aus. Das Handy sagt niemandem, dass er dran ist.
3. **Ihr zeigt aufeinander.** Laut, gleichzeitig, wie ihr wollt.
4. **Der Host tippt auf „Auflösen".** Alle sehen, wer der Imposter war und wie
   das Wort hieß. Dann „Nächste Runde".

Mehr Knöpfe gibt es nicht, und alle vier gehören dem Host. Jeder Knopf, auf den
die Runde warten muss, hält eine Runde auf, die längst weiterredet.

Wer **mitten in einer laufenden Runde** dazukommt, bekommt kein Wort mehr,
sondern wartet auf das nächste Austeilen – sonst hätte der Tisch unbemerkt einen
zweiten Mitwisser.

## Was der Imposter sieht

Nur, dass er es ist. Kein Wort, keine Gruppe, keine Wortliste.

Damit er nicht völlig blank dasteht, gibt es das **Hilfswort**: ein einzelnes
Wort aus derselben Gruppe, nie das gesuchte. Der Host schaltet es in der Lobby
an oder aus (Voreinstellung: an).

| Hilfswort | Was der Imposter sieht |
|---|---|
| **an** | „Du bist der Imposter" + ein Wort aus der Gruppe, z. B. „Bohrmaschine" |
| **aus** | „Du bist der Imposter". Sonst nichts |

Gezogen wird das Hilfswort **einmal pro Runde** und gemerkt. Würde es bei jedem
Senden neu gewürfelt, hätte der Imposter nach ein paar Zustandswechseln die
halbe Gruppe gesehen – und die gibt es ja gerade nicht zu sehen. `probe.js`
prüft das, indem sie jemanden umbenennt und schaut, ob dasselbe Wort stehen
bleibt.

## Die Begriffe

`begriffe.js` hat zwölf Gruppen mit je zwölf Begriffen. Jede Runde wählt der
Server eine Gruppe – nie zweimal dieselbe hintereinander – und daraus einen
Begriff.

Jede Gruppe braucht **mindestens acht** Begriffe: bei vier wäre das Hilfswort
fast schon die Antwort. `probe.js` prüft das, prüft auf Doppelte innerhalb einer
Gruppe – und darauf, dass **kein Begriff in zwei Gruppen** vorkommt.

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
**genau ein** Client `binImposter` haben, genau dieser darf `begriff` nicht
kennen, und sein Hilfswort darf nie das gesuchte Wort sein.

## Ein Imposter, nicht zwei

Bewusst genau einer, auch zu zehnt. Zwei Imposter, die sich nicht kennen, sind
ein anderes Spiel.

Wer zweimal hintereinander Imposter wäre, würde nicht mehr verdächtigt –
deshalb schließt der Server die Person der Vorrunde aus.

## Wenn jemand geht

Der Unterschied zwischen **Verbindungsabriss** und **wirklich weggehen** ist
hier wichtiger als in den anderen Spielen. Auf dem Handy stirbt der Socket
schon, wenn man kurz die Nachrichten-App aufmacht.

- **Verbindung weg:** nichts passiert. Die Runde wartet auf niemanden, also
  kann sie auch von niemandem aufgehalten werden. Wer zurückkommt, bekommt
  seine Karte erneut geschickt – dieselbe.
- **Der Imposter geht endgültig:** die Runde hat kein Ziel mehr und wird neu
  ausgeteilt.

## Dateien

| Datei | Was |
|---|---|
| `server.js` | statische Dateien, WebSocket, Räume, Kartenausgabe |
| `begriffe.js` | die zwölf Begriffsgruppen |
| `bremse.js` | gemeinsames Rate-Limiting, **wortgleich in allen Spielen** |
| `probe.js` | teilt mit fünf Clients aus und prüft die Geheimhaltung |
| `public/index.html` | drei Bildschirme plus die Hilfe |
| `public/style.css` | oben der gemeinsame Lobby-Block, darunter das Eigene |
| `public/app.js` | Verbindung, Warteraum, Karte, Auflösung |

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
