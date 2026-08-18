# Imposter 🕵️

Alle bekommen dasselbe Wort – bis auf einen. Der weiß nur, um welche **Gruppe**
es geht: „Werkzeug", aber nicht, ob Hammer oder Säge. Reihum sagt jeder ein
Hinweiswort, dann wird abgestimmt. Wer zu deutlich wird, verrät das Wort; wer
zu vage bleibt, wird selbst verdächtigt.

Läuft auf **Deno**, ohne eine einzige externe Abhängigkeit. Kein Build-Schritt,
kein `node_modules`, ein Prozess.

---

## Starten

```bash
deno task dev          # http://localhost:8073/
PORT=9000 deno task dev
deno task check        # Typprüfung
deno task probe        # spielt zwei Runden mit fünf Clients durch
```

Zum Ausprobieren allein: die Seite in **mehreren Browserfenstern** öffnen. Jedes
Fenster ist ein eigener Spieler (die Sitzung hängt am `sessionStorage`, ein
zweiter Tab im selben Fenster wäre dieselbe Person).

## An den Tisch kommen

Wie bei den anderen Spielen: Name eintippen, **Raum eröffnen** oder über die
Liste bzw. den vierstelligen **Code** beitreten. Der geteilte Link mit `#CODE`
führt direkt hinein.

**Vier bis zehn** Leute. Vier ist die untere Grenze, nicht drei: zu dritt hat
der Imposter nur zwei Hinweise zum Anlehnen, und die Abstimmung ist ein
Münzwurf zwischen zwei Verdächtigen.

## Eine Runde

Fünf Schritte – mehr als in den anderen Spielen hier:

1. **Karten ansehen.** Jeder sieht sein Wort, der Imposter stattdessen, dass er
   es ist. Erst wenn **alle** auf „Hab ich" gedrückt haben, geht es weiter –
   sonst redet jemand los, während ein anderer noch nicht weiß, wer er ist.
2. **Hinweise.** Reihum sagt jeder laut ein Wort zu seinem Begriff. Die
   Reihenfolge wird jede Runde neu gemischt; wäre sie die Sitzordnung, säße der
   Imposter auf Dauer immer an derselben Stelle. Der Host stellt ein, ob jeder
   **einmal oder zweimal** drankommt, und kann die Runde abkürzen.
3. **Abstimmung.** Alle wählen, wen sie verdächtigen – sich selbst nicht, das
   wäre ein kostenloser Freispruch. Aufgedeckt wird erst, wenn alle gewählt
   haben.
4. **Raten.** Nur wenn der Imposter erwischt wurde: jetzt – und erst jetzt –
   bekommt er die Wortliste und darf einmal darauf tippen.
5. **Auflösung.** Wer es war, welches Wort es war, wer für wen gestimmt hat.

## Punkte

| Ausgang | Punkte |
|---|---|
| Imposter kommt durch | **2** für ihn |
| Imposter erwischt, rät das Wort richtig | **1** für ihn |
| Imposter erwischt, rät daneben | **1** für **jeden anderen** |

Ein erwischter Imposter mit gutem Rateschluss soll nicht genauso gut dastehen
wie einer, der gar nicht erst aufgefallen ist – deshalb 1 statt 2.

**Gleichstand zählt als „nicht geeinigt".** Erwischt ist der Imposter nur, wenn
er **allein** oben steht. Das ist eine bewusste Regel und keine Nachlässigkeit:
sonst entschiede bei zwei gleichauf liegenden Verdächtigen der Zufall der
Sortierung darüber, wer die Runde verliert.

## Die Begriffe

`begriffe.js` hat zwölf Gruppen mit je zwölf Begriffen. Jede Runde wählt der
Server eine Gruppe – nie zweimal dieselbe hintereinander – und daraus einen
Begriff.

**Die Wortliste sieht nur die Gruppe.** Der Imposter bekommt sie erst, wenn er
erwischt ist und raten darf – vorher wäre sein Rateschluss geschenkt.

Damit er trotzdem etwas hat, woran er sich entlanghangeln kann, gibt es das
**Hilfswort**: ein einzelnes Wort aus derselben Gruppe, nie das gesuchte. Der
Host schaltet es in der Lobby an oder aus (Voreinstellung: an).

| Hilfswort | Was der Imposter sieht |
|---|---|
| **an** | Gruppe + ein Wort daraus, z. B. „Werkzeug" + „Bohrmaschine" |
| **aus** | nur die Gruppe |

Gezogen wird das Hilfswort **einmal pro Runde** und gemerkt. Würde es bei jedem
Zustandswechsel neu gewürfelt, hätte der Imposter nach drei Hinweisen die halbe
Gruppe gesehen.

Jede Gruppe braucht **mindestens acht** Begriffe, sonst wäre das Raten am Ende
kein Raten mehr. `probe.js` prüft das, prüft auf Doppelte innerhalb einer
Gruppe – und darauf, dass **kein Begriff in zwei Gruppen** vorkommt. Der letzte
Punkt ist ein verstecktes Leck: käme „Säge" in zwei Gruppen vor, sähe der
Imposter unter Umständen eine Liste, die nicht eindeutig zu seiner Gruppe passt.

Alle Begriffe sind gewöhnliche Gattungsbegriffe: keine Marken, keine Werktitel,
keine Eigennamen. Regeln sind frei, fremde Wortlisten nicht – und ein
geschützter Titel auf dem Bildschirm wäre ein Problem, das dieses Spiel nicht
braucht.

## Warum das Wort beim Server bleibt

Das ganze Spiel hängt daran, dass der Imposter den Begriff nicht kennt. Deshalb
verlässt er den Server nur an die Gruppe; an den Imposter geht `begriff: null`,
`begriffe: null` und `binImposter: true`. Ein Blick in die Entwicklerwerkzeuge bringt ihm
nichts – dort ist das Wort nie angekommen.

`probe.js` prüft genau das mit fünf echten Verbindungen: nach dem Austeilen muss
**genau ein** Client `binImposter` haben, und genau dieser eine darf `begriff`
**nicht** kennen.

## Ein Imposter, nicht zwei

Bewusst genau einer, auch zu zehnt. Zwei Imposter, die sich nicht kennen, sind
ein anderes Spiel: die Abstimmung müsste mehrere Treffer zulassen, und die
Punktetabelle bekäme vier statt drei Ausgänge. Das wäre nachrüstbar, ist aber
kein Detail.

Wer zweimal hintereinander Imposter wäre, würde nicht mehr verdächtigt –
deshalb schließt der Server die Person der Vorrunde aus.

## Wenn jemand geht

Der Unterschied zwischen **Verbindungsabriss** und **wirklich weggehen** ist
hier wichtiger als in den anderen Spielen. Auf dem Handy stirbt der Socket
schon, wenn man kurz die Nachrichten-App aufmacht.

- **Verbindung weg:** die Runde läuft weiter. Alle Wartebedingungen zählen
  ohnehin nur Verbundene, und die Hinweisreihe überspringt Abwesende.
- **Der Imposter geht endgültig:** die Runde hat kein Ziel mehr. Sie wird
  **nicht gewertet** und neu ausgegeben.
- **Der Imposter hängt beim Raten:** der Host kann abbrechen, das zählt als
  danebengeraten. Ohne diesen Ausgang stünde die Runde bis zum Ablauf der
  Karenzzeit.
- Punkte für die Gruppe gehen auch an den, dessen Verbindung im letzten Moment
  hängt. Er hat die Runde mitgespielt; der Socket ist kein Spielzustand.

## Dateien

| Datei | Was |
|---|---|
| `server.js` | statische Dateien, WebSocket, Räume, die fünf Rundenschritte |
| `begriffe.js` | die zwölf Begriffsgruppen |
| `bremse.js` | gemeinsames Rate-Limiting, **wortgleich in allen Spielen** |
| `probe.js` | spielt zwei Runden mit fünf Clients durch und prüft die Geheimhaltung |
| `public/index.html` | alle vier Bildschirme plus die Hilfe |
| `public/style.css` | oben der gemeinsame Lobby-Block, darunter das Eigene |
| `public/app.js` | Verbindung, Warteraum, Rollenkarte, Hinweise, Abstimmung, Raten |

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
