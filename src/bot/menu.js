import { Keyboard } from "grammy";

export const BUY_ENERGY_LABEL = "⚡ Buy energy";
export const REFERRALS_LABEL = "👥 Referrals";

/**
 * @param {{ affiliate?: boolean }} [opts]
 */
export function mainMenuKeyboard(opts = {}) {
  const kb = new Keyboard().text(BUY_ENERGY_LABEL);
  if (opts.affiliate) {
    kb.row().text(REFERRALS_LABEL);
  }
  return kb.resized();
}

/**
 * @param {import("../api/tronFeesClient.js").TronFeesApi} api
 * @param {number} telegramUserId
 */
export async function mainMenuKeyboardForTelegramUser(api, telegramUserId) {
  try {
    const me = await api.getMeByTelegram(telegramUserId);
    return mainMenuKeyboard({ affiliate: me.role === "Affiliate" });
  } catch {
    return mainMenuKeyboard({ affiliate: false });
  }
}

/** @type {{ remove_keyboard: true }} */
export const removeKeyboardMarkup = { remove_keyboard: true };
