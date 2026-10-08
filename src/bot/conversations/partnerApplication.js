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
      "Заявка на партнёрство TronVolt (API аренды энергии).\n\n" +
        "1/2 — Как называется ваш сервис? (одно сообщение, до 200 символов)",
    );

    const nameMsg = await conversation.wait();
    const name = (nameMsg.message?.text ?? "").trim().slice(0, 200);
    if (!name) {
      await ctx.reply("Название не принято. Попробуйте ещё раз: /partner");
      return;
    }

    await ctx.reply(
      `2/2 — URL вебхука для уведомлений о заказах (необязательно).\n` +
        `Отправьте https://… или «-» чтобы пропустить.`,
    );
    const hookMsg = await conversation.wait();
    const hookRaw = (hookMsg.message?.text ?? "").trim();
    const webhookUrl = hookRaw && hookRaw !== "-" ? hookRaw : null;
    if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
      await ctx.reply("Вебхук должен начинаться с http:// или https://. Заявка не создана, начните заново: /partner");
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
        "Не получилось создать заявку (" + escapeHtml(String(err?.detail ?? err?.message ?? err)) + "). Попробуйте позже: /partner",
        { parse_mode: "HTML" },
      );
      return;
    }

    await ctx.reply(
      "✅ Заявка принята и ждёт одобрения владельца.\n\n" +
        "Ваш API-ключ (показывается один раз, сохраните сразу):\n" +
        `<code>${escapeHtml(created.apiKey)}</code>\n\n` +
        "Ключ заработает после одобрения. Базовый URL: https://tron-fees-api.tronpay.me/api/b2b/v1\n" +
        "Авторизация: Authorization: Bearer &lt;ключ&gt;",
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
