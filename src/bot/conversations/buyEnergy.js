import { InlineKeyboard } from "grammy";
import { formatTrx, formatUsd } from "../format.js";
import { savingsVersusBaseline } from "../savings.js";
import { formatUserError } from "../errors.js";
import { isValidTronAddress } from "../tronAddress.js";
import {
  BUY_ENERGY_LABEL,
  mainMenuKeyboard,
  mainMenuKeyboardForTelegramUser,
  removeKeyboardMarkup,
} from "../menu.js";
import { log } from "../../logger.js";

const CB = {
  energy: (/** @type {number} */ e) => `pk:e:${e}`,
  next: "pk:next",
  abort: "pk:abort",
};

/** @readonly */
const ENERGY_CHOICES = [65_000, 135_000, 270_000];

const DEFAULT_ENERGY = 135_000;
/** Длительность делегирования по API (только 1 час). */
const DELEGATION_DURATION_HOURS = 1;

const ALL_PACKAGE_CALLBACKS = [CB.next, CB.abort, ...ENERGY_CHOICES.map((e) => CB.energy(e))];

/**
 * @param {string} text
 */
function isCancelText(text) {
  return text.trim().toLowerCase() === "отмена";
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {number | null} energy
 * @param {import("../../api/tronFeesClient.js").PricingEstimate | null} estimate
 * @returns {string[]}
 */
function savingsBlockLinesHtml(energy, estimate) {
  if (energy == null || !estimate) return [];
  const s = savingsVersusBaseline(energy, estimate.clientPriceTrx);
  if (!s) return [];
  return [
    `<i>📊 Без сервиса ориентировочно: ${escapeHtml(formatTrx(s.baseline))} TRX</i>`,
    `<i>💚 Экономия: ${escapeHtml(formatTrx(s.saveTrx))} TRX (~${escapeHtml(formatUsd(s.saveUsd))})</i>`,
  ];
}

/**
 * Одно сообщение: выбранный пакет + запрос адреса делегирования.
 * @param {number | null} energy
 * @param {import("../../api/tronFeesClient.js").PricingEstimate} estimate
 * @returns {{ text: string; parse_mode?: "HTML" }}
 */
function buildAddressStepMessage(energy, estimate) {
  const savings = savingsBlockLinesHtml(energy ?? null, estimate);
  const parts = [
    escapeHtml("📦 Выбранный пакет"),
    "",
    escapeHtml(`• Объём энергии: ${energy?.toLocaleString("ru-RU") ?? "—"}`),
    escapeHtml(`• Срок делегирования: ${DELEGATION_DURATION_HOURS} ч`),
    escapeHtml(`• Стоимость через сервис: ${formatTrx(estimate.clientPriceTrx)} TRX`),
  ];
  if (savings.length > 0) {
    parts.push("");
    parts.push(...savings);
  }
  parts.push(
    "",
    escapeHtml(
      "На какой TRON-адрес делегировать энергию? Отправьте адрес одним следующим сообщением.",
    ),
  );
  return {
    text: parts.join("\n"),
    ...(savings.length > 0 ? { parse_mode: /** @type {const} */ ("HTML") } : {}),
  };
}

/**
 * @param {number | null} energy
 * @param {import("../../api/tronFeesClient.js").PricingEstimate | null} estimate
 * @param {string | null} estimateError
 * @returns {{ text: string; parse_mode?: "HTML" }}
 */
function buildPackageMessage(energy, estimate, estimateError) {
  const lines = [
    escapeHtml("⚡ Выберите объём энергии."),
    "",
    escapeHtml(
      `🔋 Энергия: ${energy != null ? energy.toLocaleString("ru-RU") : "—"}`,
    ),
    escapeHtml(`⏱ Срок: ${DELEGATION_DURATION_HOURS} ч`),
    "",
  ];
  if (estimateError) {
    lines.push(
      escapeHtml("⚠️ Не удалось посчитать цену."),
      escapeHtml(estimateError),
      "",
      escapeHtml("Измените параметры или нажмите «Отмена»."),
      "",
    );
    return { text: lines.join("\n").trimEnd() };
  }
  if (estimate) {
    lines.push(escapeHtml(`💳 Цена через сервис: ${formatTrx(estimate.clientPriceTrx)} TRX`));
    const savings = savingsBlockLinesHtml(energy, estimate);
    if (savings.length > 0) {
      lines.push("");
      lines.push(...savings);
    }
    lines.push("", escapeHtml("👉 Нажмите «Продолжить», чтобы подтвердить пакет и указать адрес."));
    return {
      text: lines.join("\n").trimEnd(),
      ...(savings.length > 0 ? { parse_mode: /** @type {const} */ ("HTML") } : {}),
    };
  }
  if (energy != null) {
    lines.push(escapeHtml("⏳ Считаем цену…"), "");
  }
  return { text: lines.join("\n").trimEnd() };
}

/**
 * @param {number | null} energy
 * @param {import("../../api/tronFeesClient.js").PricingEstimate | null} estimate
 */
function buildPackageKeyboard(energy, estimate) {
  const kb = new InlineKeyboard();
  for (const e of ENERGY_CHOICES) {
    const mark = energy === e ? "✓ " : "";
    kb.text(`${mark}${e.toLocaleString("ru-RU")}`, CB.energy(e));
  }
  kb.row();
  if (estimate) {
    kb.text("▶️ Продолжить", CB.next);
  }
  kb.text("❌ Отмена", CB.abort);
  return kb;
}

/**
 * @param {unknown} err
 */
function isNotModifiedError(err) {
  const s = String(err?.description ?? err ?? "");
  return s.includes("message is not modified") || s.includes("MESSAGE_NOT_MODIFIED");
}

/**
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export function createBuyEnergyConversation(deps) {
  /**
   * @param {import("@grammyjs/conversations").Conversation<import("grammy").Context, import("grammy").Context>} conversation
   * @param {import("grammy").Context} ctx
   */
  return async function buyEnergy(conversation, ctx) {
    const rmMsg = await ctx.reply("\u2060", { reply_markup: removeKeyboardMarkup });
    await ctx.api.deleteMessage(rmMsg.chat.id, rmMsg.message_id).catch(() => {});

    /** @param {number | undefined} fromId */
    async function menuKb(fromId) {
      if (fromId == null) return mainMenuKeyboard({ affiliate: false });
      return await conversation.external(async () =>
        mainMenuKeyboardForTelegramUser(deps.api, fromId),
      );
    }

    /** @type {number | null} */
    let energy = DEFAULT_ENERGY;
    /** @type {import("../../api/tronFeesClient.js").PricingEstimate | null} */
    let estimate = null;
    /** @type {string | null} */
    let estimateError = null;

    try {
      estimate = await conversation.external(async () =>
        deps.api.getPricingEstimate({
          delegationEnergyQuantity: energy,
          delegationDurationHours: DELEGATION_DURATION_HOURS,
        }),
      );
      estimateError = null;
    } catch (e) {
      log.error(e);
      estimate = null;
      estimateError = formatUserError(e);
    }

    const panel0 = buildPackageMessage(energy, estimate, estimateError);
    const sent = await ctx.reply(panel0.text, {
      reply_markup: buildPackageKeyboard(energy, estimate),
      ...(panel0.parse_mode ? { parse_mode: panel0.parse_mode } : {}),
    });

    /** @param {import("grammy").Context} q */
    async function refreshPanel(q) {
      const panel = buildPackageMessage(energy, estimate, estimateError);
      const kb = buildPackageKeyboard(energy, estimate);
      try {
        await q.editMessageText(panel.text, {
          reply_markup: kb,
          ...(panel.parse_mode ? { parse_mode: panel.parse_mode } : {}),
        });
      } catch (err) {
        if (!isNotModifiedError(err)) throw err;
      }
    }

    let buyer = null;

    for (;;) {
      let q;
      try {
        q = await conversation.waitForCallbackQuery(ALL_PACKAGE_CALLBACKS, {
          maxMilliseconds: 15 * 60 * 1000,
          otherwise: async (oc) => {
            const t = oc.message?.text?.trim();
            if (t?.startsWith("/start")) {
              await conversation.halt({ next: true });
              return;
            }
            if (t && isCancelText(t)) {
              await oc.reply("Оформление отменено.", {
                reply_markup: await menuKb(oc.from?.id),
              });
              await conversation.halt();
              return;
            }
            await oc.reply("Нажмите кнопку под сообщением с параметрами.");
          },
        });
      } catch {
        try {
          await ctx.api.editMessageText(sent.chat.id, sent.message_id, "Время ожидания истекло.", {
            reply_markup: undefined,
          });
        } catch {
          /* ignore */
        }
        await ctx.reply("Время вышло. Начните снова.", {
          reply_markup: await menuKb(ctx.from?.id),
        });
        return;
      }

      const data = q.callbackQuery.data;

      if (data === CB.abort) {
        await q.answerCallbackQuery().catch(() => {});
        try {
          await q.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        } catch {
          /* ignore */
        }
        await q.reply("Оформление отменено.", {
          reply_markup: await menuKb(q.from?.id),
        });
        return;
      }

      if (data === CB.next) {
        if (!estimate) {
          await q.answerCallbackQuery({
            text: "Дождитесь расчёта цены.",
            show_alert: true,
          }).catch(() => {});
          continue;
        }
        await q.answerCallbackQuery().catch(() => {});
        buyer = q.from ?? null;
        if (!buyer) {
          await q.reply("Не удалось определить пользователя.", {
            reply_markup: await menuKb(q.from?.id),
          });
          return;
        }
        try {
          const addrStep = buildAddressStepMessage(energy ?? null, estimate);
          await q.editMessageText(addrStep.text, {
            reply_markup: undefined,
            ...(addrStep.parse_mode ? { parse_mode: addrStep.parse_mode } : {}),
          });
        } catch (e) {
          if (!isNotModifiedError(e)) log.error(e);
        }
        break;
      }

      if (data.startsWith("pk:e:")) {
        await q.answerCallbackQuery().catch(() => {});
        energy = Number(data.slice(5));
        estimate = null;
        estimateError = null;
      }

      if (energy != null) {
        try {
          estimate = await conversation.external(async () =>
            deps.api.getPricingEstimate({
              delegationEnergyQuantity: energy,
              delegationDurationHours: DELEGATION_DURATION_HOURS,
            }),
          );
          estimateError = null;
        } catch (e) {
          log.error(e);
          estimate = null;
          estimateError = formatUserError(e);
        }
      }

      await refreshPanel(q);
    }

    if (!buyer) {
      await ctx.reply("Не удалось определить пользователя.", {
        reply_markup: await menuKb(ctx.from?.id),
      });
      return;
    }

    const delegationEnergyQuantity = /** @type {number} */ (energy);

    let delegationRecipientTronAddress = "";
    /** @type {import("grammy").Context | null} */
    let lastCtx = null;

    while (true) {
      const addrCtx = await conversation.waitFor("message:text", {
        maxMilliseconds: 15 * 60 * 1000,
        otherwise: async (oc) => {
          await oc.reply("Отправьте адрес обычным текстовым сообщением, как в инструкции выше.");
        },
      });
      lastCtx = addrCtx;
      const text = addrCtx.message.text.trim();
      if (text.startsWith("/start")) {
        await conversation.halt({ next: true });
        return;
      }
      if (isCancelText(text)) {
        await addrCtx.reply("Оформление отменено.", {
          reply_markup: await menuKb(addrCtx.from?.id),
        });
        return;
      }
      if (text === BUY_ENERGY_LABEL) {
        await addrCtx.reply("Сначала завершите ввод адреса или отмените («Отмена»).");
        continue;
      }
      if (isValidTronAddress(text)) {
        delegationRecipientTronAddress = text;
        break;
      }
      await addrCtx.reply("Адрес не похож на TRON (нужен формат T…, 34 символа). Повторите.");
    }

    const replyCtx = lastCtx ?? ctx;

    try {
      const o = await conversation.external(async () =>
        deps.api.createEnergyOrder({
          telegramUserId: buyer.id,
          delegationEnergyQuantity,
          delegationDurationHours: DELEGATION_DURATION_HOURS,
          delegationRecipientTronAddress,
        }),
      );

      await replyCtx.reply(
        [
          "<b>Счёт готов — осталось оплатить</b>",
          "",
          "Спасибо за заказ. Как только платёж дойдёт до нас, энергия будет доставлена на указанный вами адрес — обычно это занимает не больше минуты.",
          "",
          "🎯 Куда придёт энергия:",
          escapeHtml(delegationRecipientTronAddress),
          "",
          "Переведите сумму <b>одним платежом</b>.",
          "",
          "🏦 Адрес для перевода:",
          `<code>${escapeHtml(o.payAddress)}</code>`,
          "",
          `💰 Сумма: ${escapeHtml(formatTrx(o.payAmount))} ${escapeHtml(String(o.payCurrency))}`,
          "",
          `🧾 Order ID: ${escapeHtml(o.orderId)}`,
        ].join("\n"),
        { parse_mode: "HTML", reply_markup: await menuKb(replyCtx.from?.id) },
      );
      log.info("order_ok", { telegramId: buyer.id, orderId: o.orderId });
    } catch (e) {
      log.error(e);
      await replyCtx.reply(formatUserError(e), {
        reply_markup: await menuKb(replyCtx.from?.id),
      });
    }
  };
}
