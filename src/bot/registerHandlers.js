import { Bot } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import { createBuyEnergyConversation } from "./conversations/buyEnergy.js";
import { createPartnerApplicationConversation } from "./conversations/partnerApplication.js";
import {
  handlePartner,
  handlePendingWebhookEdit,
  registerPartnerCallbacks,
  createOwnerNotifier,
  handlePendingTopUpAmount,
} from "./handlers/partner.js";
import { handleHelp } from "./handlers/help.js";
import { handleReferrals } from "./handlers/referrals.js";
import { handleStart } from "./handlers/start.js";
import { BUY_ENERGY_LABEL, PARTNER_LABEL, REFERRALS_LABEL } from "./menu.js";
import { log } from "../logger.js";

/**
 * @param {Bot} bot
 * @param {{ api: import("../api/tronFeesClient.js").TronFeesApi; config?: { ownerId?: number } }} deps
 */
export function registerHandlers(bot, deps) {
  bot.catch((err) => {
    log.error("bot_error", err);
  });

  const partnerDeps = { api: deps.api, ownerId: deps.config?.weeklyReport?.ownerId ?? 0 };

  bot.use(conversations());
  bot.use(createConversation(createBuyEnergyConversation(deps), "buyEnergy"));
  bot.use(
    createConversation(
      createPartnerApplicationConversation({
        api: deps.api,
        ownerId: partnerDeps.ownerId,
        notifyOwnerOfApplication: createOwnerNotifier(bot, partnerDeps),
      }),
      "partnerApplication",
    ),
  );

  registerPartnerCallbacks(bot, partnerDeps);

  bot.command("start", (ctx) => handleStart(ctx, deps));
  bot.command("help", (ctx) => handleHelp(ctx, deps));
  bot.command("partner", (ctx) => handlePartner(ctx, partnerDeps));

  // Awaiting a partner top-up amount or webhook URL: swallow the message here.
  bot.on("message:text", async (ctx, next) => {
    if (await handlePendingWebhookEdit(ctx, deps)) {
      return;
    }
    if (await handlePendingTopUpAmount(ctx, deps)) {
      return;
    }
    await next();
  });

  bot.on("message:text").filter(
    (ctx) => ctx.message.text.trim() === BUY_ENERGY_LABEL,
    async (ctx) => {
      await ctx.conversation.enter("buyEnergy");
    },
  );

  bot.on("message:text").filter(
    (ctx) => ctx.message.text.trim() === REFERRALS_LABEL,
    async (ctx) => {
      await handleReferrals(ctx, deps);
    },
  );

  bot.on("message:text").filter(
    (ctx) => ctx.message.text.trim() === PARTNER_LABEL,
    async (ctx) => {
      await handlePartner(ctx, partnerDeps);
    },
  );
}
