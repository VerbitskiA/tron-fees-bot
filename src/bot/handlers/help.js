import { mainMenuKeyboard } from "../menu.js";

/**
 * @param {import("grammy").Context} ctx
 */
export async function handleHelp(ctx) {
  await ctx.reply("При возникновении проблем обращайтесь к @tron_fees_support.", {
    reply_markup: mainMenuKeyboard(),
  });
}
