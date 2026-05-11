import { Bot } from "grammy";
import { registerHandlers } from "./registerHandlers.js";

/**
 * @param {string} token
 * @param {{ api: import("../api/tronFeesClient.js").TronFeesApi }} deps
 */
export function createBot(token, deps) {
  const bot = new Bot(token);
  registerHandlers(bot, deps);
  return bot;
}
