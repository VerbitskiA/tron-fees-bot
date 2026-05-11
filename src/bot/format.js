/**
 * @param {number | string | undefined} v
 */
export function formatTrx(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

/**
 * @param {number} sun
 */
export function sunToTrx(sun) {
  return sun / 1_000_000;
}

/**
 * @param {number | string | undefined} v
 */
export function formatUsd(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return String(v ?? "—");
  return (
    n.toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "\u00a0$"
  );
}
