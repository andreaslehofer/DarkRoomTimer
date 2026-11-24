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

/**
 * Zeiteingabe → Sekunden, null bei ungültig.
 * "8:30", "8.30", "8,30" → 510 · "830" → 510 (letzte zwei Ziffern = Sekunden) · "90" → 90
 * Ziffern ohne Doppelpunkt, damit die iOS-Zifferntastatur reicht.
 */
export function parseDuration(text) {
  const t = String(text).trim().replace(/[.,]/g, ':');
  let total;
  if (t.includes(':')) {
    const m = /^(\d*):(\d{1,2})$/.exec(t);
    if (!m || Number(m[2]) > 59) return null;
    total = Number(m[1] || 0) * 60 + Number(m[2]);
  } else {
    if (!/^\d+$/.test(t)) return null;
    if (t.length <= 2) total = Number(t);
    else {
      const sec = Number(t.slice(-2));
      if (sec > 59) return null;
      total = Number(t.slice(0, -2)) * 60 + sec;
    }
  }
  return total > 0 ? total : null;
}
