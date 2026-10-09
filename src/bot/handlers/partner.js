import { InlineKeyboard } from "grammy";
import { log } from "../../logger.js";
import { umami } from "../../analytics/umami.js";
import { escapeHtml } from "../htmlEscape.js";

const APPLICATION_COOLDOWN_MS = 60 * 60 * 1000;

/** @type {Map<number, string>} chat id → partner id awaiting a top-up amount */
const pendingTopUps = new Map();

/** @type {Map<number, number>} last application attempt per telegram user (in-memory, best effort) */
const lastApplicationAt = new Map();

const CB = {
  approve: (/** @type {string} */ id, /** @type {number} */ d) => `ptnr:a:${id}:${d}`,
  reject: (/** @type {string} */ id) => `ptnr:r:${id}`,
  topup: (/** @type {string} */ id) => `ptnr:topup:${id}`,
  newKey: (/** @type {string} */ id) => `ptnr:key:${id}`,
  secret: (/** @type {string} */ id) => `ptnr:sec:${id}`,
};

const ALL_PARTNER_CALLBACKS = [
  "ptnr:",
];

/**
 * @param {string} s
 */
function truncate(s, max = 300) {
  return String(s).length <= max ? String(s) : `${String(s).slice(0, max)}…`;
}

/**
 * @param {import("../../api/tronFeesClient.js").PartnerListItem[]} partners
 * @param {number} telegramId
 */
function findOwnPartner(partners, telegramId) {
  return partners.find((p) => p.contactTelegramId === telegramId) ?? null;
}

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; config: import("../../config.js").config; ownerId: number }} deps
 */
export async function handlePartner(ctx, deps) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  /** @type {import("../../api/tronFeesClient.js").PartnerListItem[]} */
  let partners;
  try {
    partners = await deps.api.listPartners();
  } catch (err) {
    log.error("partner_list_failed", err);
    await ctx.reply("Партнёрский сервис временно недоступен, попробуйте позже.");
    return;
  }

  const own = findOwnPartner(partners, telegramId);
  if (own) {
    await showPartnerCabinet(ctx, deps, own);
    return;
  }

  const last = lastApplicationAt.get(telegramId) ?? 0;
  if (Date.now() - last < APPLICATION_COOLDOWN_MS) {
    const minutes = Math.ceil((APPLICATION_COOLDOWN_MS - (Date.now() - last)) / 60000);
    await ctx.reply(`Заявку можно подавать раз в час — попробуйте через ~${minutes} мин.`);
    return;
  }

  await ctx.conversation.enter("partnerApplication");
}

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 * @param {import("../../api/tronFeesClient.js").PartnerListItem} partner
 */
async function showPartnerCabinet(ctx, deps, partner) {
  if (partner.status !== "Active") {
    await ctx.reply(
      partner.status === "Pending"
        ? "⏳ Ваша заявка на партнёрство ещё на рассмотрении."
        : "🚫 Партнёрский доступ приостановлен. Свяжитесь с поддержкой @tron_volt_support.",
    );
    return;
  }

  let balanceText = "баланс недоступен";
  try {
    const balance = await deps.api.partnerBalance(partner.id);
    balanceText = `💰 Депозит: ${balance.availableTrx} TRX доступно, ${balance.heldTrx} TRX зарезервировано`;
  } catch {
    // keep fallback text
  }

  await ctx.reply(
    `🤝 Кабинет партнёра — ${escapeHtml(partner.name)}\n\n` +
      `${balanceText}\n` +
      `Скидка: ${partner.discountPercent}%\n` +
      `Базовый URL: https://tron-fees-api.tronpay.me/api/b2b/v1\n\n` +
      "Документация по эндпоинтам — в сообщении с ключом.",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("⚡️ Пополнить депозит", CB.topup(partner.id))
        .row()
        .text("🔑 Новый API-ключ", CB.newKey(partner.id))
        .text("🔐 Webhook-секрет", CB.secret(partner.id)),
    },
  );
}

/**
 * Owner-side: карточка заявки с кнопками одобрения.
 * @param {import("grammy").Bot} bot
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 */
export function registerPartnerCallbacks(bot, deps) {
  bot.callbackQuery(/^ptnr:a:/, async (ctx) => {
    const [, , partnerId, discRaw] = ctx.callbackQuery.data.split(":");
    const discount = Number(discRaw);
    if (!partnerId || !Number.isFinite(discount)) {
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      await deps.api.approvePartner(partnerId, discount);
    } catch (err) {
      log.error("partner_approve_failed", err);
      await ctx.answerCallbackQuery({ text: "Ошибка одобрения — смотри логи" });
      return;
    }

    await ctx.editMessageText(
      `✅ Одобрен (${discount}%): ${partnerId}`,
    );
    await ctx.answerCallbackQuery({ text: "Одобрено" });
    await notifyApplicant(bot, deps, partnerId, true, discount);
  });

  bot.callbackQuery(/^ptnr:r:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    try {
      await deps.api.rejectPartner(partnerId);
    } catch (err) {
      log.error("partner_reject_failed", err);
      await ctx.answerCallbackQuery({ text: "Ошибка отклонения — смотри логи" });
      return;
    }

    await ctx.editMessageText(`🚫 Отклонён: ${partnerId}`);
    await ctx.answerCallbackQuery({ text: "Отклонено" });
    await notifyApplicant(bot, deps, partnerId, false, 0);
  });

  bot.callbackQuery(/^ptnr:topup:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    pendingTopUps.set(chatId, partnerId);
    await ctx.editMessageText(
      "Сумма пополнения в TRX (минимум 50)? Отправьте число следующим сообщением.",
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^ptnr:sec:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    try {
      const { webhookSecret } = await deps.api.partnerWebhookSecret(partnerId);
      await ctx.editMessageText(
        "Webhook-секрет для проверки подписи X-TronVolt-Signature (sha256=HMAC_SHA256(секрет, тело)):\n" +
          `<code>${escapeHtml(webhookSecret)}</code>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      log.error("partner_secret_failed", err);
      await ctx.editMessageText("Не удалось получить секрет, попробуйте позже: /partner");
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^ptnr:key:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    try {
      const issued = await deps.api.issuePartnerKey(partnerId);
      await ctx.editMessageText(
        "Новый API-ключ (показывается один раз):\n" + `<code>${escapeHtml(issued.key)}</code>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      log.error("partner_key_issue_failed", err);
      await ctx.editMessageText("Не удалось выпустить ключ, попробуйте позже: /partner");
    }
    await ctx.answerCallbackQuery();
  });
}

/**
 * @param {import("grammy").Bot} bot
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 */
async function notifyApplicant(bot, deps, partnerId, approved, discount) {
  try {
    const partners = await deps.api.listPartners();
    const partner = partners.find((p) => p.id === partnerId);
    if (!partner?.contactTelegramId) return;

    await bot.api.sendMessage(
      partner.contactTelegramId,
      approved
        ? `✅ Ваша партнёрская заявка одобрена (скидка ${discount}%). Ключ активен — кабинет: /partner`
        : "🚫 Ваша партнёрская заявка отклонена. Вопросы — @tron_volt_support",
    );
  } catch (err) {
    log.error("partner_applicant_notify_failed", err);
  }
}

/**
 * Handles a plain text message while a top-up amount is pending for this chat.
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export async function handlePendingTopUpAmount(ctx, deps) {
  const chatId = ctx.chat?.id;
  const partnerId = chatId ? pendingTopUps.get(chatId) : undefined;
  if (!chatId || !partnerId) return false;

  const amount = Number((ctx.message?.text ?? "").replace(",", ".").trim());
  if (!Number.isFinite(amount) || amount < 50) {
    await ctx.reply("Нужно число ≥ 50. Попробуйте ещё раз или откройте кабинет: /partner");
    return true;
  }

  pendingTopUps.delete(chatId);
  try {
    const invoice = await deps.api.createPartnerTopUpInvoice(partnerId, amount);
    await ctx.reply(
      "Инвойс на пополнение депозита:\n\n" +
        `Адрес: <code>${escapeHtml(invoice.payAddress)}</code>\n` +
        `Сумма: <b>${escapeHtml(String(invoice.payAmount))} ${escapeHtml(invoice.payCurrency)}</b>\n\n` +
        "После оплаты депозит зачислится автоматически — пришлём подтверждение сюда.",
      { parse_mode: "HTML" },
    );
  } catch (err) {
    log.error("partner_topup_invoice_failed", err);
    await ctx.reply("Не получилось создать инвойс, попробуйте позже: /partner");
  }
  return true;
}

/**
 * Called by the application conversation after a successful submit.
 * @param {import("grammy").Bot} bot
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 */
export function createOwnerNotifier(bot, deps) {
  return async function notifyOwnerOfApplication({ partnerId, name, contactTelegramId }) {
    lastApplicationAt.set(contactTelegramId, Date.now());
    void umami.track("partner_application_submitted", { uid: contactTelegramId, name: truncate(name, 100) });
    try {
      await bot.api.sendMessage(
        deps.ownerId,
        `🤝 Новая партнёрская заявка:\n${truncate(name)} (tg:${contactTelegramId})`,
        {
          reply_markup: new InlineKeyboard()
            .text("✅ 10%", CB.approve(partnerId, 10))
            .text("✅ 15%", CB.approve(partnerId, 15))
            .row()
            .text("🚫 Отклонить", CB.reject(partnerId)),
        },
      );
    } catch (err) {
      log.error("partner_owner_notify_failed", err);
    }
  };
}
