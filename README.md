# DarkRoomTimer

Progressive Web App als Timer für die analoge Dunkelkammer (Entwickler → Stoppbad → Fixierer → Wässern).
Rotlicht-taugliche Oberfläche, läuft offline und lässt sich auf dem Homescreen installieren.

## Starten

```sh
npm start          # http://localhost:8080
# oder
python3 -m http.server 8080
```

Service Worker brauchen `localhost` oder HTTPS. Zum Testen auf dem Handy im LAN daher z. B. über einen HTTPS-Tunnel ausliefern.

## Struktur

```
index.html             App-Shell
manifest.webmanifest   PWA-Manifest (Name, Icons, Farben)
sw.js                  Service Worker (Cache-first, offline)
css/styles.css         Rot-auf-Schwarz-Theme
js/app.js              UI-Verdrahtung, SW-Registrierung
js/timer.js            Driftfreier Countdown (EventTarget)
js/steps.js            Standard-Prozessschritte
js/alerts.js           Ton, Vibration, Screen Wake Lock
icons/                 App-Icons (SVG + PNG 192/512)
```

Nach Änderungen an gecachten Dateien `CACHE_VERSION` in `sw.js` erhöhen.
