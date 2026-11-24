// Driftfreier Countdown: rechnet gegen einen Endzeitpunkt statt Ticks zu zählen,
// damit der Timer auch nach Tab-Wechsel oder gedrosseltem setInterval stimmt.
export class Timer extends EventTarget {
  #duration = 0;   // ms
  #remaining = 0;  // ms
  #endAt = null;   // performance.now()-Zeitpunkt, null = pausiert
  #raf = null;

  get running() { return this.#endAt !== null; }
  get remaining() {
    return this.running ? Math.max(0, this.#endAt - performance.now()) : this.#remaining;
  }

  set(seconds) {
    this.pause();
    this.#duration = this.#remaining = seconds * 1000;
    this.#emit('tick');
  }

  start() {
    if (this.running || this.#remaining <= 0) return;
    this.#endAt = performance.now() + this.#remaining;
    this.#emit('start');
    this.#loop();
  }

  pause() {
    if (!this.running) return;
    this.#remaining = this.remaining;
    this.#endAt = null;
    cancelAnimationFrame(this.#raf);
    this.#emit('pause');
  }

  reset() {
    this.set(this.#duration / 1000);
  }

  #loop = () => {
    const left = this.remaining;
    this.#emit('tick');
    if (left <= 0) {
      this.#remaining = 0;
      this.#endAt = null;
      this.#emit('done');
      return;
    }
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #emit(type) {
    this.dispatchEvent(new CustomEvent(type, { detail: { remaining: this.remaining } }));
  }
}

export function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}
