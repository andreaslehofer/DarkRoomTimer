// Akustische Signale + Bildschirm wach halten.

let audioCtx = null;

// iOS legt Web Audio nach Unterbrechungen oder längerer Pause (z. B. zwischen zwei Läufen)
// schlafen ("suspended"/"interrupted") – dann fallen Signale stillschweigend aus.
// Gegenmittel: frischer Kontext bei jedem Start und Wiederbeleben bei jeder Gelegenheit.

function tryResume() {
  if (audioCtx && audioCtx.state !== 'running' && audioCtx.state !== 'closed') {
    audioCtx.resume().catch(() => {});
  }
}

/** Bei jedem Start aus der Nutzergeste aufrufen (iOS lässt Audio nur dort sicher anlaufen). */
export function unlockAudio() {
  // "playback" spielt auch bei Lautlos-Schalter (Safari/iOS 17+); hält Musik anderer Apps an.
  if (navigator.audioSession) navigator.audioSession.type = 'playback';

  audioCtx?.close().catch(() => {});
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.addEventListener('statechange', tryResume);
  audioCtx.resume().catch(() => {});

  // Kurzer stiller Puffer innerhalb der Geste – entsperrt die Wiedergabe auf iOS zuverlässig.
  const silent = audioCtx.createBufferSource();
  silent.buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
  silent.connect(audioCtx.destination);
  silent.start();
}

// Jede Berührung ist eine Nutzergeste → bester Moment, einen schlafenden Kontext zu wecken.
document.addEventListener('pointerdown', tryResume, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tryResume();
});

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

export async function signal(type) {
  const def = SIGNALS[type];
  if (!def) return;
  navigator.vibrate?.(def.vibrate);
  if (!audioCtx || audioCtx.state === 'closed') return;
  if (audioCtx.state !== 'running') {
    // Erst aufwecken, dann spielen – sonst landen die Töne im schlafenden Kontext.
    await Promise.race([audioCtx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  }
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
