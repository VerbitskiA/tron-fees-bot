/**
 * In-memory dedup cache for webhook eventId values with TTL.
 * @param {{ ttlMs: number; maxSize?: number; sweepIntervalMs?: number }} opts
 */
export function createEventIdCache({
  ttlMs,
  maxSize = 10_000,
  sweepIntervalMs = 5 * 60 * 1000,
}) {
  /** @type {Map<string, number>} */
  const map = new Map();

  function sweep() {
    const now = Date.now();
    for (const [id, expiresAt] of map) {
      if (expiresAt <= now) map.delete(id);
    }
  }

  const interval = setInterval(sweep, sweepIntervalMs);
  if (typeof interval.unref === "function") interval.unref();

  return {
    /**
     * @param {string} eventId
     * @returns {boolean} true if this eventId was newly claimed
     */
    claim(eventId) {
      const now = Date.now();
      const existing = map.get(eventId);
      if (existing != null && existing > now) return false;

      if (map.size >= maxSize) {
        const oldest = map.keys().next().value;
        if (oldest != null) map.delete(oldest);
      }

      map.set(eventId, now + ttlMs);
      return true;
    },

    destroy() {
      clearInterval(interval);
      map.clear();
    },
  };
}
