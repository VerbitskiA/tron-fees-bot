import { mainMenuKeyboardForTelegramUser } from "../menu.js";

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export async function handleHelp(ctx, deps) {
  const from = ctx.from;
  const menu =
    from != null
      ? await mainMenuKeyboardForTelegramUser(deps.api, from.id)
      : undefined;
  await ctx.reply("При возникновении проблем обращайтесь к @tron_fees_support.", {
    ...(menu ? { reply_markup: menu } : {}),
  });
}
