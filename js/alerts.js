// Signale am Schrittende + Bildschirm wach halten.

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

export function beep({ times = 3, freq = 880, length = 0.15, gap = 0.15 } = {}) {
  if (!audioCtx) return;
  // iOS setzt den Kontext nach Unterbrechungen (Anruf, Siri) auf "interrupted".
  if (audioCtx.state !== 'running') audioCtx.resume();
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < times; i++) {
    const start = t0 + i * (length + gap);
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + length);
  }
}

export function vibrate() {
  navigator.vibrate?.([200, 100, 200, 100, 200]);
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
