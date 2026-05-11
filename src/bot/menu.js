import { Keyboard } from "grammy";

export const BUY_ENERGY_LABEL = "⚡ Купить энергию";

export function mainMenuKeyboard() {
  return new Keyboard().text(BUY_ENERGY_LABEL).resized();
}

/** @type {{ remove_keyboard: true }} */
export const removeKeyboardMarkup = { remove_keyboard: true };
