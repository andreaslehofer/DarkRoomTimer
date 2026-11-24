// Prozess-Ablauf ohne Handbedienung:
//   - DRAIN_LEAD_S Sekunden vor Ende eines Segments: Ereignis "drain" (Tank ausleeren)
//   - bei 0:00: nächstes Segment startet automatisch, Ereignis "segment"
//   - nach dem letzten Segment: Ereignis "done"
// Gerechnet wird gegen Endzeitpunkte (Date.now), nicht durch Mitzählen.
// War die App kurz im Hintergrund, holt der nächste Tick verpasste Übergänge nach.

export const DRAIN_LEAD_S = 10;

export class ProcessRunner extends EventTarget {
  #segments;
  #drainLeadMs;
  #index = -1;
  #endAt = 0;           // Ende des aktuellen Segments (Date.now()-Zeit)
  #pausedRemaining = 0; // Restzeit beim Pausieren
  #drainFired = false;
  #interval = null;

  state = 'idle'; // idle | running | paused | done

  constructor(segments, { drainLeadS = DRAIN_LEAD_S } = {}) {
    super();
    this.#segments = segments;
    this.#drainLeadMs = drainLeadS * 1000;
  }

  get segments() { return this.#segments; }
  get index() { return this.#index; }
  get current() { return this.#segments[this.#index] ?? null; }
  get next() { return this.#segments[this.#index + 1] ?? null; }

  /** Restzeit des aktuellen Segments in ms. */
  get remaining() {
    if (this.state === 'running') return Math.max(0, this.#endAt - Date.now());
    if (this.state === 'paused') return this.#pausedRemaining;
    return 0;
  }

  /** Restzeit des ganzen Prozesses in ms. */
  get totalRemaining() {
    if (this.state === 'idle') return this.#segments.reduce((s, x) => s + x.duration_s * 1000, 0);
    const rest = this.#segments.slice(this.#index + 1).reduce((s, x) => s + x.duration_s * 1000, 0);
    return this.remaining + rest;
  }

  /** Läuft gerade das Ausleer-Fenster (letzte DRAIN_LEAD_S Sekunden)? */
  get draining() {
    return this.state !== 'idle' && this.state !== 'done' && this.#drainFired && this.#hasDrainWindow(this.current);
  }

  start() {
    if (this.state !== 'idle') return;
    this.state = 'running';
    this.#enter(0, Date.now(), 'start');
    this.#startLoop();
  }

  pause() {
    if (this.state !== 'running') return;
    this.#pausedRemaining = this.remaining;
    this.state = 'paused';
    this.#stopLoop();
    this.#emit('state');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.#endAt = Date.now() + this.#pausedRemaining;
    this.state = 'running';
    this.#startLoop();
    this.#emit('state');
  }

  skip() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    if (this.#index >= this.#segments.length - 1) return this.#finish();
    const wasPaused = this.state === 'paused';
    this.#enter(this.#index + 1, Date.now(), 'skip');
    if (wasPaused) {
      this.#pausedRemaining = this.current.duration_s * 1000;
    }
  }

  stop() {
    this.#stopLoop();
    this.state = 'idle';
    this.#index = -1;
    this.#emit('state');
  }

  /** Sofort neu berechnen (z. B. nach Rückkehr aus dem Hintergrund). */
  tick = () => {
    if (this.state !== 'running') return;
    const now = Date.now();

    let advanced = false;
    while (now >= this.#endAt) {
      if (this.#index >= this.#segments.length - 1) return this.#finish();
      this.#index += 1;
      this.#endAt += this.current.duration_s * 1000;
      this.#drainFired = false;
      advanced = true;
    }
    if (advanced) this.#emit('segment', { reason: 'auto' });

    if (!this.#drainFired && this.#endAt - now <= this.#drainLeadMs) {
      this.#drainFired = true;
      if (this.#hasDrainWindow(this.current)) this.#emit('drain');
    }
    this.#emit('tick');
  };

  #hasDrainWindow(seg) {
    // Segmente, die nicht länger als das Ausleer-Fenster sind, bekommen kein eigenes Signal.
    return !!seg && seg.duration_s * 1000 > this.#drainLeadMs;
  }

  #enter(index, startTime, reason) {
    this.#index = index;
    this.#endAt = startTime + this.current.duration_s * 1000;
    this.#drainFired = false;
    this.#emit('segment', { reason });
    this.tick();
  }

  #finish() {
    this.#stopLoop();
    this.state = 'done';
    this.#emit('done');
  }

  #startLoop() {
    this.#stopLoop();
    this.#interval = setInterval(this.tick, 100);
  }

  #stopLoop() {
    clearInterval(this.#interval);
    this.#interval = null;
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail: { index: this.#index, ...detail } }));
  }
}
