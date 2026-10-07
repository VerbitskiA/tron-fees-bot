import { log } from "../../logger.js";
import { umami } from "../../analytics/umami.js";
import { commandArgs } from "../commandArgs.js";
import { formatUserError } from "../errors.js";
import { BRAND_NAME } from "../brand.js";
import { mainMenuKeyboard } from "../menu.js";

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
    await ctx.reply(
      [
        `Hi, ${name}! 👋`,
        "",
        `💰 Save on TRON fees with ${BRAND_NAME} — use the menu below 👇`,
        "",
        "👥 Invite friends via the Referrals section and earn rewards on their orders.",
      ].join("\n"),
      { reply_markup: mainMenuKeyboard() },
    );
    log.info("start_ok", { telegramId: from.id, userId });
    void umami.track("bot_start", {
      invited: Boolean(referralStartPayload || invitedByTelegramId),
      uid: from.id,
      ...(from.username ? { uname: from.username } : {}),
    });
  } catch (e) {
    log.error(e);
    await ctx.reply(formatUserError(e));
  }
}
