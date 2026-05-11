import { Bot } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { createBuyEnergyConversation } from "./conversations/buyEnergy.js";
import { handleHelp } from "./handlers/help.js";
import { handleStart } from "./handlers/start.js";
import { BUY_ENERGY_LABEL } from "./menu.js";
import { log } from "../logger.js";

/**
 * @param {Bot} bot
 * @param {{ api: import("../api/tronFeesClient.js").TronFeesApi }} deps
 */
export function registerHandlers(bot, deps) {
  bot.catch((err) => {
    log.error("bot_error", err);
  });

  bot.use(conversations());
  bot.use(createConversation(createBuyEnergyConversation(deps), "buyEnergy"));

  bot.command("start", (ctx) => handleStart(ctx, deps));
  bot.command("help", (ctx) => handleHelp(ctx));

  bot.on("message:text").filter(
    (ctx) => ctx.message.text.trim() === BUY_ENERGY_LABEL,
    async (ctx) => {
      await ctx.conversation.enter("buyEnergy");
    },
  );
}
