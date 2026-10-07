import { Keyboard } from "grammy";

export const BUY_ENERGY_LABEL = "⚡ Buy energy";
export const REFERRALS_LABEL = "👥 Referrals";

/** Main reply keyboard shown to every user. */
export function mainMenuKeyboard() {
  return new Keyboard().text(BUY_ENERGY_LABEL).row().text(REFERRALS_LABEL).resized();
}

/** @type {{ remove_keyboard: true }} */
export const removeKeyboardMarkup = { remove_keyboard: true };
