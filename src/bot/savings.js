/**
 * Ориентировочная стоимость типовой транзакции без сервиса (TRX) для выбранного пакета по энергии.
 * 270000: 2 × 27.34578 (как два пакета по 135000).
 */
const BASELINE_TRX_WITHOUT_SERVICE = {
  65000: 13.49985,
  135000: 27.34578,
  270000: 54.69156,
};

/** Курс для отображения экономии в долларах (TRX → USD). */
export const TRX_USD_RATE = 0.35;

/**
 * @param {number} energy
 */
export function baselineTrxWithoutService(energy) {
  return BASELINE_TRX_WITHOUT_SERVICE[/** @type {keyof typeof BASELINE_TRX_WITHOUT_SERVICE} */ (energy)] ?? null;
}

/**
 * @param {number} energy
 * @param {number | string} clientPriceTrx из оценки сервиса
 */
export function savingsVersusBaseline(energy, clientPriceTrx) {
  if (energy === 270_000) return null;
  const baseline = baselineTrxWithoutService(energy);
  const price = typeof clientPriceTrx === "string" ? Number(clientPriceTrx) : clientPriceTrx;
  if (baseline == null || !Number.isFinite(price)) return null;
  const saveTrx = baseline - price;
  const saveUsd = saveTrx * TRX_USD_RATE;
  return { baseline, saveTrx, saveUsd };
}
