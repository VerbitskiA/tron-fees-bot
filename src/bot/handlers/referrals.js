import { InlineKeyboard } from "grammy";
import { umami } from "../../analytics/umami.js";
import { formatTrx, sunToTrx } from "../format.js";
import { formatUserError } from "../errors.js";
import { mainMenuKeyboard } from "../menu.js";

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
    const stats = await deps.api.getReferrerStatistics(from.id);

    const lines = [
      "<b>👥 Referral program</b>",
      "Invite friends — earn a reward on every order they pay for.",
      "Spend your rewards as a discount on your own energy orders. 🎁",
      "",
    ];

    /** @type {InlineKeyboard | undefined} */
    let shareKeyboard;
    if (me.referralTelegramUrl) {
      lines.push("🔗 <b>Your invite link</b>");
      lines.push(`<code>${escapeHtml(me.referralTelegramUrl)}</code>`);
      shareKeyboard = new InlineKeyboard().url(
        "📤 Share link",
        shareUrl(me.referralTelegramUrl),
      );
    } else if (me.referralCode) {
      lines.push(`🔑 <b>Your code</b>: <code>${escapeHtml(me.referralCode)}</code>`);
      lines.push("", "<i>💡 The full t.me link will appear once the bot username is configured on the server for referrals.</i>");
    } else {
      lines.push("⏳ Referral code has not been assigned yet.");
    }

    lines.push(
      "",
      "<b>📊 Statistics</b>",
      `📈 Invited users: ${stats.invitedUserCount}`,
      `💰 Total earned: ${escapeHtml(formatTrx(sunToTrx(stats.totalReferralRewardSun)))} TRX`,
    );
    if (stats.availableRewardBalanceSun > 0) {
      lines.push(
        `🎁 Reward balance (spend on orders): ${escapeHtml(formatTrx(sunToTrx(stats.availableRewardBalanceSun)))} TRX`,
      );
    }

    await ctx.reply(lines.join("\n"), {
      parse_mode: "HTML",
      ...(shareKeyboard ? { reply_markup: shareKeyboard } : {}),
    });
    void umami.track("referrals_opened", {
      has_balance: stats.availableRewardBalanceSun > 0,
    });
  } catch (e) {
    await ctx.reply(formatUserError(e), { reply_markup: mainMenuKeyboard() });
  }
}

/**
 * Telegram share-URL that pre-fills the invite link in a chosen chat.
 * @param {string} referralUrl
 */
function shareUrl(referralUrl) {
  const text = encodeURIComponent("Save up to 70% on TRON fees with TronVolt ⚡");
  return `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${text}`;
}
