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
      `API access, ${BRAND_NAME} integration into your service or product — write there as well; we will guide you and agree on the details.`,
      "",
      "👥 Referral rewards you earn are applied automatically as a discount when you buy energy.",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(),
    },
  );
}
