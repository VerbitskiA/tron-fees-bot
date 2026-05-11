const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * @param {string | undefined} s
 */
export function isValidTronAddress(s) {
  if (!s || typeof s !== "string") return false;
  return TRON_ADDRESS_RE.test(s.trim());
}
