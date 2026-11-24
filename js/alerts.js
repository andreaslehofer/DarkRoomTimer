// Signale am Schrittende + Bildschirm wach halten.

let audioCtx;

// Muss einmal aus einer Nutzergeste heraus aufgerufen werden (iOS/Safari).
export function unlockAudio() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

export function beep({ times = 3, freq = 880, length = 0.15, gap = 0.15 } = {}) {
  if (!audioCtx) return;
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

// Screen Wake Lock: verhindert, dass das Display während eines Schritts ausgeht.
let wakeLock = null;

export async function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch {
    // z. B. bei niedrigem Akku verweigert – Timer läuft trotzdem.
  }
}
