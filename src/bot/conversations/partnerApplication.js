import { escapeHtml } from "../htmlEscape.js";

/**
 * Partner self-serve application wizard: service name → optional webhook URL → key shown once.
 *
 * @param {{
 *   api: import("../../api/tronFeesClient.js").TronFeesApi;
 *   config: import("../../config.js").config;
 *   ownerId: number;
 *   notifyOwnerOfApplication: (partner: {partnerId: string; name: string; contactTelegramId: number}) => Promise<void>;
 * }} deps
 */
export function createPartnerApplicationConversation(deps) {
  /** @param {import("@grammyjs/conversations").Conversation} conversation @param {import("grammy").Context} ctx */
  return async function partnerApplication(conversation, ctx) {
    await ctx.reply(
      "TronVolt partner application (Energy rental API).\n\n" +
        "1/2 — What is your service called? (one message, up to 200 characters)",
    );

    const nameMsg = await conversation.wait();
    const name = (nameMsg.message?.text ?? "").trim().slice(0, 200);
    if (!name) {
      await ctx.reply("Name not accepted. Try again: /partner");
      return;
    }

    await ctx.reply(
      `2/2 — Webhook URL for order notifications (optional, can be changed later in the cabinet).\n` +
        `Send https://… or "-" to skip.`,
    );
    const hookMsg = await conversation.wait();
    const hookRaw = (hookMsg.message?.text ?? "").trim();
    const webhookUrl = hookRaw && hookRaw !== "-" ? hookRaw : null;
    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
      await ctx.reply("Webhook must start with http:// or https://. Application not created — start over: /partner");
      return;
    }

    /** @type {import("../../api/tronFeesClient.js").PartnerCreated} */
    let created;
    try {
      created = await conversation.external(() =>
        deps.api.createPartner({
          name,
          contact: ctx.from?.username ? `@${ctx.from.username}` : null,
          contactTelegramId: ctx.from?.id ?? 0,
          webhookUrl,
        }),
      );
    } catch (err) {
      await ctx.reply(
        "Could not create the application (" + escapeHtml(String(err?.detail ?? err?.message ?? err)) + "). Try again later: /partner",
        { parse_mode: "HTML" },
      );
      return;
    }

    await ctx.reply(
      "✅ Application received — waiting for the owner's approval.\n\n" +
        "Your API key (shown once — save it now):\n" +
        `<code>${escapeHtml(created.apiKey)}</code>\n\n` +
        "The key activates once the application is approved.\n" +
        "Base URL: https://tron-fees-api.tronpay.me/api/b2b/v1\n" +
        "Auth: Authorization: Bearer &lt;key&gt;",
      { parse_mode: "HTML" },
    );

    await conversation.external(() =>
      deps.notifyOwnerOfApplication({
        partnerId: created.partnerId,
        name,
        contactTelegramId: ctx.from?.id ?? 0,
      }),
    );
  };
}
