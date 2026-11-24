// Anzeige-Helfer.

/** Millisekunden → "m:ss" (aufgerundet, damit 0:00 erst am echten Ende erscheint). */
export function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return formatDuration(total);
}

/** Sekunden → "m:ss" bzw. "h:mm:ss". */
export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatTemp(temp, tolerance) {
  const fmt = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${fmt(temp)} °C ± ${fmt(tolerance)}`;
}
