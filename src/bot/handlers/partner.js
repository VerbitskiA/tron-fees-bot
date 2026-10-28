import { InlineKeyboard } from "grammy";
import { log } from "../../logger.js";
import { umami } from "../../analytics/umami.js";
import { escapeHtml } from "../htmlEscape.js";

const APPLICATION_COOLDOWN_MS = 60 * 60 * 1000;

/** Preset top-up amounts in TRX (minimum accepted is 10). */
const TOP_UP_PRESETS_TRX = [10, 30, 50];

/** @type {Map<number, string>} chat id → partner id awaiting a top-up amount */
const pendingTopUps = new Map();

/** @type {Map<number, string>} chat id → partner id awaiting a webhook URL */
const pendingWebhookEdits = new Map();

/** @type {Map<number, number>} last application attempt per telegram user (in-memory, best effort) */
const lastApplicationAt = new Map();

const CB = {
  approve: (/** @type {string} */ id) => `ptnr:a:${id}`,
  reject: (/** @type {string} */ id) => `ptnr:r:${id}`,
  topup: (/** @type {string} */ id) => `ptnr:topup:${id}`,
  newKey: (/** @type {string} */ id) => `ptnr:key:${id}`,
  secret: (/** @type {string} */ id) => `ptnr:sec:${id}`,
  hook: (/** @type {string} */ id) => `ptnr:hook:${id}`,
  topupAmount: (/** @type {string} */ id, /** @type {number} */ amount) => `ptnr:tp:${id}:${amount}`,
  topupCustom: (/** @type {string} */ id) => `ptnr:tpc:${id}`,
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
    await ctx.reply("Partner service is temporarily unavailable — try again later.");
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
    await ctx.reply(`Applications are limited to one per hour — try again in ~${minutes} min.`);
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
        ? "⏳ Your partner application is still under review."
        : "🚫 Partner access is suspended. Contact support: @tron_volt_support",
    );
    return;
  }

  let balanceText = "balance unavailable";
  try {
    const balance = await deps.api.partnerBalance(partner.id);
    balanceText = `💰 Deposit: ${balance.availableTrx} TRX available, ${balance.heldTrx} TRX held`;
  } catch {
    // keep fallback text
  }

  const hookText = partner.webhookUrl
    ? `🔗 Webhook: ${escapeHtml(partner.webhookUrl)}`
    : "🔗 Webhook: not set (no order notifications)";

  await ctx.reply(
    `🤝 Partner cabinet — ${escapeHtml(partner.name)}\n\n` +
      `${balanceText}\n` +
      `${hookText}\n` +
      `Base URL: https://tron-fees-api.tronpay.me/api/b2b/v1\n\n` +
      "Docs: https://www.tronvolt.com/docs",
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("⚡️ Top up deposit", CB.topup(partner.id))
        .row()
        .text("🔑 New API key", CB.newKey(partner.id))
        .text("🔐 Webhook secret", CB.secret(partner.id))
        .row()
        .text("🔗 Change webhook", CB.hook(partner.id)),
    },
  );
}

/**
 * Owner-side: application card with approve/reject buttons.
 * @param {import("grammy").Bot} bot
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 */
export function registerPartnerCallbacks(bot, deps) {
  bot.callbackQuery(/^ptnr:a:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    if (!partnerId) {
      await ctx.answerCallbackQuery();
      return;
    }

    try {
      await deps.api.approvePartner(partnerId);
    } catch (err) {
      log.error("partner_approve_failed", err);
      await ctx.answerCallbackQuery({ text: "Approval failed — check the logs" });
      return;
    }

    await ctx.editMessageText(`✅ Approved: ${partnerId}`);
    await ctx.answerCallbackQuery({ text: "Approved" });
    await notifyApplicant(bot, deps, partnerId, true);
  });

  bot.callbackQuery(/^ptnr:r:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    try {
      await deps.api.rejectPartner(partnerId);
    } catch (err) {
      log.error("partner_reject_failed", err);
      await ctx.answerCallbackQuery({ text: "Rejection failed — check the logs" });
      return;
    }

    await ctx.editMessageText(`🚫 Rejected: ${partnerId}`);
    await ctx.answerCallbackQuery({ text: "Rejected" });
    await notifyApplicant(bot, deps, partnerId, false);
  });

  bot.callbackQuery(/^ptnr:topup:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    await ctx.editMessageText(
      "Deposit top-up (credited automatically after payment). Choose an amount:",
      {
        reply_markup: new InlineKeyboard()
          .text("10 TRX", CB.topupAmount(partnerId, 10))
          .text("30 TRX", CB.topupAmount(partnerId, 30))
          .text("50 TRX", CB.topupAmount(partnerId, 50))
          .row()
          .text("✏️ Custom amount", CB.topupCustom(partnerId)),
      },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^ptnr:tp:/, async (ctx) => {
    const [, , partnerId, amountRaw] = ctx.callbackQuery.data.split(":");
    const amount = Number(amountRaw);
    if (!partnerId || !Number.isFinite(amount) || amount < 10) {
      await ctx.answerCallbackQuery({ text: "Invalid amount" });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Creating invoice…" });
    await sendTopUpInvoice(ctx, deps, partnerId, amount);
  });

  bot.callbackQuery(/^ptnr:tpc:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    pendingTopUps.set(chatId, partnerId);
    await ctx.editMessageText("Top-up amount in TRX (minimum 10)? Send the number as your next message.");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^ptnr:hook:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return;
    }

    pendingWebhookEdits.set(chatId, partnerId);
    await ctx.editMessageText(
      "Send the webhook URL (https://…) as your next message — or \"-\" to remove the webhook.",
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^ptnr:sec:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    try {
      const { webhookSecret } = await deps.api.partnerWebhookSecret(partnerId);
      await ctx.editMessageText(
        "Webhook secret for X-TronVolt-Signature verification (sha256=HMAC_SHA256(secret, body)):\n" +
          `<code>${escapeHtml(webhookSecret)}</code>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      log.error("partner_secret_failed", err);
      await ctx.editMessageText("Could not fetch the secret — try again later: /partner");
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^ptnr:key:/, async (ctx) => {
    const [, , partnerId] = ctx.callbackQuery.data.split(":");
    try {
      const issued = await deps.api.issuePartnerKey(partnerId);
      await ctx.editMessageText(
        "New API key (shown once):\n" + `<code>${escapeHtml(issued.key)}</code>`,
        { parse_mode: "HTML" },
      );
    } catch (err) {
      log.error("partner_key_issue_failed", err);
      await ctx.editMessageText("Could not issue a key — try again later: /partner");
    }
    await ctx.answerCallbackQuery();
  });
}

/**
 * @param {import("grammy").Bot} bot
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 */
async function notifyApplicant(bot, deps, partnerId, approved) {
  try {
    const partners = await deps.api.listPartners();
    const partner = partners.find((p) => p.id === partnerId);
    if (!partner?.contactTelegramId) return;

    await bot.api.sendMessage(
      partner.contactTelegramId,
      approved
        ? "✅ Your partner application is approved. The key is active — cabinet: /partner"
        : "🚫 Your partner application was declined. Questions — @tron_volt_support",
    );
  } catch (err) {
    log.error("partner_applicant_notify_failed", err);
  }
}

/**
 * Handles a plain text message while a webhook URL is pending for this chat.
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export async function handlePendingWebhookEdit(ctx, deps) {
  const chatId = ctx.chat?.id;
  const partnerId = chatId ? pendingWebhookEdits.get(chatId) : undefined;
  if (!chatId || !partnerId) return false;

  const raw = (ctx.message?.text ?? "").trim();
  const url = raw === "-" ? "" : raw;
  if (url && !/^https?:\/\//i.test(url)) {
    await ctx.reply("Webhook must start with http:// or https://. Try again, or send \"-\" to remove it.");
    return true;
  }

  pendingWebhookEdits.delete(chatId);
  try {
    await deps.api.setPartnerWebhookUrl(partnerId, url);
    await ctx.reply(url ? `✅ Webhook updated: ${escapeHtml(url)}` : "✅ Webhook removed — order notifications will not arrive.");
  } catch (err) {
    log.error("partner_webhook_update_failed", err);
    await ctx.reply("Could not save the webhook — try again later: /partner");
  }
  return true;
}

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 * @param {string} partnerId
 * @param {number} amountTrx
 */
async function sendTopUpInvoice(ctx, deps, partnerId, amountTrx) {
  try {
    const invoice = await deps.api.createPartnerTopUpInvoice(partnerId, amountTrx);
    await ctx.reply(
      "Top-up invoice:\n\n" +
        `Address: <code>${escapeHtml(invoice.payAddress)}</code>\n` +
        `Amount: <b>${escapeHtml(String(invoice.payAmount))} ${escapeHtml(invoice.payCurrency)}</b>\n\n` +
        "The deposit is credited automatically after payment — we will confirm here.",
      { parse_mode: "HTML" },
    );
  } catch (err) {
    log.error("partner_topup_invoice_failed", err);
    await ctx.reply("Could not create the invoice — try again later: /partner");
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
  if (!Number.isFinite(amount) || amount < 10) {
    await ctx.reply("Must be a number ≥ 10. Try again or open the cabinet: /partner");
    return true;
  }

  pendingTopUps.delete(chatId);
  await sendTopUpInvoice(ctx, deps, partnerId, amount);
  return true;
}

/**
 * Called by the application conversation after a successful submit.
 * @param {import("grammy").Bot} bot
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi; ownerId: number }} deps
 */
export function createOwnerNotifier(bot, deps) {
  return async function notifyOwnerOfApplication({ partnerId, name, contactTelegramId, source }) {
    lastApplicationAt.set(contactTelegramId, Date.now());
    void umami.track("partner_application_submitted", { uid: contactTelegramId, name: truncate(name, 100) });
    const sourceLine = source ? `\n📍 Source: ${truncate(source)}` : "";
    try {
      await bot.api.sendMessage(
        deps.ownerId,
        `🤝 New partner application:\n${truncate(name)} (tg:${contactTelegramId})${sourceLine}`,
        {
          reply_markup: new InlineKeyboard()
            .text("✅ Approve", CB.approve(partnerId))
            .text("🚫 Reject", CB.reject(partnerId)),
        },
      );
    } catch (err) {
      log.error("partner_owner_notify_failed", err);
    }
  };
}
