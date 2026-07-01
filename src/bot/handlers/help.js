import { BRAND_NAME } from "../brand.js";
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
  await ctx.reply(
    [
      "<b>Help &amp; support</b>",
      "",
      "For any questions or consultation about the service, contact support:",
      "@tron_volt_support",
      "",
      `API access, ${BRAND_NAME} integration into your service or product — write there as well; we will guide you and agree on the details.`,
    ].join("\n"),
    {
      parse_mode: "HTML",
      ...(menu ? { reply_markup: menu } : {}),
    },
  );
}
