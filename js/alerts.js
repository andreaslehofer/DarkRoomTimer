// Akustische Signale + Bildschirm wach halten.

let audioCtx;

// Muss einmal aus einer Nutzergeste heraus aufgerufen werden (iOS/Safari).
export function unlockAudio() {
  // iOS: Web Audio läuft standardmäßig in der "ambient"-Session und verstummt
  // beim Lautlos-Schalter. "playback" spielt trotzdem (Safari/iOS 17+).
  // Nebenwirkung: Musik aus anderen Apps wird dabei angehalten.
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== 'running') audioCtx.resume();
}

// Ein Ton mit kurzer Ein-/Ausblende (vermeidet Knacken), Lautstärke über die gesamte Länge konstant.
function tone(start, freq, length, volume = 0.5) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square'; // obertonreich → im Raum besser hörbar als ein Sinus
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.005);
  gain.gain.setValueAtTime(volume, start + length - 0.03);
  gain.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(start);
  osc.stop(start + length);
}

// Drei klar unterscheidbare Signale – man hört sie, ohne aufs Display zu schauen.
const SIGNALS = {
  // Ausleeren: schnelles, hohes Dreifach-Piepen
  drain: { tones: [[1320, 0.12], [1320, 0.12], [1320, 0.12]], gap: 0.08, vibrate: [100, 60, 100, 60, 100] },
  // Nächster Schritt / einfüllen: ein langer tiefer Ton
  next:  { tones: [[880, 0.7]], gap: 0, vibrate: [600] },
  // Prozess fertig: absteigende Tonfolge
  done:  { tones: [[1320, 0.3], [990, 0.3], [660, 0.6]], gap: 0.1, vibrate: [300, 100, 300, 100, 600] },
};

export function signal(type) {
  const def = SIGNALS[type];
  if (!def) return;
  navigator.vibrate?.(def.vibrate);
  if (!audioCtx) return;
  // iOS setzt den Kontext nach Unterbrechungen (Anruf, Siri) auf "interrupted".
  if (audioCtx.state !== 'running') audioCtx.resume();
  let t = audioCtx.currentTime + 0.02;
  for (const [freq, length] of def.tones) {
    tone(t, freq, length);
    t += length + def.gap;
  }
}

// Screen Wake Lock: Display bleibt an, solange die App sichtbar ist –
// in der Dunkelkammer will niemand mit nassen Händen das Handy entsperren.
// Das System gibt die Sperre bei jedem Tab-/App-Wechsel frei, daher neu anfordern.
let wakeLock = null;
let onChange = () => {};

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    onChange(true);
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      onChange(false);
    });
  } catch {
    // Verweigert (z. B. Stromsparmodus oder noch keine Nutzergeste) – beim nächsten Tippen erneut.
  }
}

export function initWakeLock(callback = () => {}) {
  onChange = callback;
  onChange(false);
  requestWakeLock();
  // Manche Browser (u. a. Safari) gewähren die Sperre erst nach einer Nutzergeste.
  document.addEventListener('pointerdown', requestWakeLock);
  document.addEventListener('visibilitychange', requestWakeLock);
}
