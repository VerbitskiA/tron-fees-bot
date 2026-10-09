import { Keyboard } from "grammy";

export const BUY_ENERGY_LABEL = "⚡ Buy energy";
export const REFERRALS_LABEL = "👥 Referrals";
export const PARTNER_LABEL = "🤝 API access";

/** Main reply keyboard shown to every user. */
export function mainMenuKeyboard() {
  return new Keyboard().text(BUY_ENERGY_LABEL).row().text(REFERRALS_LABEL).row().text(PARTNER_LABEL).resized();
}

/** @type {{ remove_keyboard: true }} */
export const removeKeyboardMarkup = { remove_keyboard: true };
