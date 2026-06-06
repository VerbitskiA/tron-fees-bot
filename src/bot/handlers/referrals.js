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
    await ctx.reply("Could not identify your Telegram profile.");
    return;
  }

  try {
    const me = await deps.api.getMeByTelegram(from.id);
    if (me.role !== "Affiliate") {
      await ctx.reply("🔒 This section is available to partners only.", {
        reply_markup: await mainMenuKeyboardForTelegramUser(deps.api, from.id),
      });
      return;
    }

    const stats = await deps.api.getReferrerStatistics(from.id);
    const lines = [
      "<b>👥 Referrals</b>",
      "✨ Share your link — earn rewards for every invite.",
      "",
    ];

    if (me.referralTelegramUrl) {
      lines.push("🔗 <b>Your link</b>");
      lines.push(`<code>${escapeHtml(me.referralTelegramUrl)}</code>`);
    } else if (me.referralCode) {
      lines.push(`🔑 <b>Code</b>: <code>${escapeHtml(me.referralCode)}</code>`);
      lines.push(
        "",
        "<i>💡 The full t.me link will appear once the bot username is configured on the server for referrals.</i>",
      );
    } else {
      lines.push("⏳ Referral code has not been assigned yet.");
    }

    lines.push(
      "",
      "<b>📊 Statistics</b>",
      `📈 Invited users: ${stats.invitedUserCount}`,
      `🎁 Referral reward credits: ${stats.referralRewardCreditCount}`,
      `💰 Total earned: ${escapeHtml(formatTrx(sunToTrx(stats.totalReferralRewardSun)))} TRX`,
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
