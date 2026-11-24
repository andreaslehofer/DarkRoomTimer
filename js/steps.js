// Standard-Prozessschritte für die Papierverarbeitung (Zeiten in Sekunden).
// Später konfigurierbar machen (z. B. via localStorage / Einstellungsseite).
export const DEFAULT_STEPS = [
  { id: 'dev',  name: 'Entwickler', duration: 60 },
  { id: 'stop', name: 'Stoppbad',   duration: 10 }, // TODO: nach Test wieder auf 30
  { id: 'fix',  name: 'Fixierer',   duration: 120 },
  { id: 'wash', name: 'Wässern',    duration: 300 },
];
