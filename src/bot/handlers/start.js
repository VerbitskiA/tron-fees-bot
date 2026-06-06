import { log } from "../../logger.js";
import { commandArgs } from "../commandArgs.js";
import { formatUserError } from "../errors.js";
import { mainMenuKeyboardForTelegramUser } from "../menu.js";

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export async function handleStart(ctx, deps) {
  const from = ctx.from;
  if (!from) {
    await ctx.reply("Could not identify your Telegram profile.");
    return;
  }

  const { args } = commandArgs(ctx);
  const raw = args.length > 0 ? args.join(" ").trim() : null;

  let referralStartPayload = null;
  let invitedByTelegramId = null;
  if (raw) {
    if (/^\d+$/.test(raw)) {
      invitedByTelegramId = Number(raw);
    } else {
      referralStartPayload = raw;
    }
  }

  try {
    const { userId } = await deps.api.registerUser({
      telegramId: from.id,
      invitedByTelegramId,
      telegramUsername: from.username ?? null,
      referralStartPayload,
    });

    const name = from.first_name ?? "friend";
    const menu = await mainMenuKeyboardForTelegramUser(deps.api, from.id);
    await ctx.reply(
      `Hi, ${name}! 👋\n\n💰 Save on TRON fees with TronFees — use the menu below 👇`,
      { reply_markup: menu },
    );
    log.info("start_ok", { telegramId: from.id, userId });
  } catch (e) {
    log.error(e);
    await ctx.reply(formatUserError(e));
  }
}
