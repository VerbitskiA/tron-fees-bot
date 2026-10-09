import { BRAND_NAME } from "../brand.js";
import { mainMenuKeyboard } from "../menu.js";

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export async function handleHelp(ctx, _deps) {
  await ctx.reply(
    [
      "<b>Help &amp; support</b>",
      "",
      "For any questions or consultation about the service, contact support:",
      "@tron_volt_support",
      "",
      `API access for your service: send /partner to apply — ${BRAND_NAME} keys, docs and the deposit are managed in the partner cabinet.`,
      "",
      "👥 Referral rewards you earn are applied automatically as a discount when you buy energy.",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(),
    },
  );
}
