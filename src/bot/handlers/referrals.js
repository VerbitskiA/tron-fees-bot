import { formatTrx, sunToTrx } from "../format.js";
import { formatUserError } from "../errors.js";
import { mainMenuKeyboardForTelegramUser } from "../menu.js";

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {import("grammy").Context} ctx
 * @param {{ api: import("../../api/tronFeesClient.js").TronFeesApi }} deps
 */
export async function handleReferrals(ctx, deps) {
  const from = ctx.from;
  if (!from) {
    await ctx.reply("Не удалось определить профиль Telegram.");
    return;
  }

  try {
    const me = await deps.api.getMeByTelegram(from.id);
    if (me.role !== "Affiliate") {
      await ctx.reply("Этот раздел доступен только партнёрам.", {
        reply_markup: await mainMenuKeyboardForTelegramUser(deps.api, from.id),
      });
      return;
    }

    const stats = await deps.api.getReferrerStatistics(from.id);
    const lines = ["<b>👥 Рефералы</b>", ""];

    if (me.referralTelegramUrl) {
      lines.push("🔗 Ваша ссылка:");
      lines.push(`<code>${escapeHtml(me.referralTelegramUrl)}</code>`);
    } else if (me.referralCode) {
      lines.push(`Код: <code>${escapeHtml(me.referralCode)}</code>`);
      lines.push(
        "",
        "<i>Полная t.me-ссылка появится, когда на сервере задан username бота для рефералов.</i>",
      );
    } else {
      lines.push("Реферальный код пока не назначен.");
    }

    lines.push(
      "",
      "<b>Статистика</b>",
      `• Приглашено пользователей: ${stats.invitedUserCount}`,
      `• Начислений реф. награды: ${stats.referralRewardCreditCount}`,
      `• Всего начислено: ${escapeHtml(formatTrx(sunToTrx(stats.totalReferralRewardSun)))} TRX`,
    );

    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: await mainMenuKeyboardForTelegramUser(deps.api, from.id),
    });
  } catch (e) {
    await ctx.reply(formatUserError(e), {
      reply_markup: await mainMenuKeyboardForTelegramUser(deps.api, from.id),
    });
  }
}
