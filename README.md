# DarkRoomTimer

Progressive Web App als Timer für die analoge Dunkelkammer – Film und Papier, Trommel/Tank.
Rotlicht-taugliche Oberfläche, läuft offline und lässt sich auf dem Homescreen installieren.

**Kernidee: freihändig.** Ein Prozess läuft nach dem Start ohne weitere Bedienung durch:

| Zeitpunkt | Signal | Bedeutung |
|---|---|---|
| 10 s vor Schrittende | 3× kurz, hoch | Tank ausleeren |
| 0:00 | 1× lang | nächster Schritt startet automatisch – einfüllen |
| Prozessende | absteigende Tonfolge | fertig |

Schritte, die höchstens 10 s dauern, bekommen kein eigenes Ausleer-Signal.

## Prozessprofile

Jede Datei `profiles/*.json` ist ein Prozess. Das Format ist **1:1 kompatibel mit CPPTouch**
(`cpp2-ui/profiles/README.md`) – dieselben Dateien funktionieren in App und Gerät.
Zusätzliche, nur von der App genutzte Felder (vom Gerät ignoriert):

| Feld | Bedeutung |
|---|---|
| `process_type` | Gruppe auf der Startseite: `film-rotation`, `paper-rotation`, `paper-tray`. Fehlt es, landet das Profil unter „Sonstige“ |
| `option_label` | Beschriftung der Auswahl für `option[]`, z. B. „Film“ oder „Durchsatz“ (Default „Variante“) |
| `steps[].one_shot` | `true` = Chemie wird nach Gebrauch verworfen (One-shot), fehlt/`false` = Re-use. Wird in Vorbereitung und Lauf angezeigt |

`purge_s` wird in der App zu einem eigenen Segment „Spülen“ nach dem Schritt.

**Nach jeder Änderung an Profilen oder App-Dateien:**

```sh
npm run build
```

Das prüft alle Profile, schreibt `profiles/index.json` (GitHub Pages kann keine Ordner auflisten)
und setzt `CACHE_VERSION` in `sw.js`, damit installierte Apps das Update bekommen.
Fehlerhafte Profile erscheinen in der App als rot gestrichelte Kachel mit Fehlermeldung.

## Starten

```sh
npm start          # http://localhost:8080
# oder
python3 -m http.server 8080
```

Service Worker brauchen `localhost` oder HTTPS.

## Struktur

```
index.html             App-Shell mit drei Ansichten (Übersicht, Vorbereitung, Lauf)
manifest.webmanifest   PWA-Manifest
sw.js                  Service Worker (Cache-first, offline)
css/styles.css         Rot-auf-Schwarz-Theme
js/app.js              UI und Ansichten
js/profile.js          Profil-Validierung (Regeln wie CPPTouch), Ablauf, Ansatztabelle
js/runner.js           Freihändiger Prozessablauf (Ausleeren, Auto-Weiter)
js/alerts.js           Signaltöne, Vibration, Screen Wake Lock
js/format.js           Zeit-/Temperaturformatierung
profiles/              Prozessprofile + generierter index.json
scripts/build.mjs      Build: Profile prüfen, Index + Cache-Version schreiben
```
