import { test } from "node:test";
import assert from "node:assert/strict";
import { handleReferrals } from "../src/bot/handlers/referrals.js";

/** @returns {{ sent: {text: string, options: object}[] }} fake grammy context */
function fakeCtx() {
  const sent = [];
  return {
    from: { id: 42 },
    sent,
    reply: async (text, options = {}) => {
      sent.push({ text, options });
    },
  };
}

function fakeApi({ me, stats }) {
  return {
    async getMeByTelegram() {
      return me;
    },
    async getReferrerStatistics() {
      return stats;
    },
  };
}

const defaultMe = {
  userId: "u1",
  telegramId: 42,
  telegramUsername: null,
  registeredAt: "2026-10-07T00:00:00Z",
  role: "Affiliate",
  referralCode: "AB12CD34",
  referralTelegramUrl: "https://t.me/tronvolt_bot?start=aff_AB12CD34",
};

const defaultStats = {
  invitedUserCount: 3,
  referralRewardCreditCount: 5,
  totalReferralRewardSun: 7_500_000,
  availableRewardBalanceSun: 2_300_000,
};

test("referrals screen shows link, share button, stats and balance", async () => {
  const ctx = fakeCtx();
  await handleReferrals(ctx, { api: fakeApi({ me: defaultMe, stats: defaultStats }) });

  const msg = ctx.sent.at(-1);
  assert.match(msg.text, /👥 Referral program/);
  assert.match(msg.text, /https:\/\/t\.me\/tronvolt_bot\?start=aff_AB12CD34/);
  assert.match(msg.text, /📈 Invited users: 3/);
  assert.match(msg.text, /💰 Total earned: 7\.5 TRX/);
  assert.match(msg.text, /🎁 Reward balance \(spend on orders\): 2\.3 TRX/);
  assert.equal(msg.options.parse_mode, "HTML");
  const kb = msg.options.reply_markup;
  assert.ok(kb?.inline_keyboard?.length, "share inline keyboard attached");
  const shareButton = kb.inline_keyboard.flat().find((b) => b.url);
  assert.match(shareButton.url, /^https:\/\/t\.me\/share\/url\?url=/);
});

test("no balance line when rewards are already spent", async () => {
  const ctx = fakeCtx();
  await handleReferrals(ctx, {
    api: fakeApi({ me: defaultMe, stats: { ...defaultStats, availableRewardBalanceSun: 0 } }),
  });

  const msg = ctx.sent.at(-1);
  assert.doesNotMatch(msg.text, /Reward balance/);
});

test("falls back to bare code when the t.me link is not configured", async () => {
  const ctx = fakeCtx();
  await handleReferrals(ctx, {
    api: fakeApi({
      me: { ...defaultMe, referralTelegramUrl: null },
      stats: defaultStats,
    }),
  });

  const msg = ctx.sent.at(-1);
  assert.match(msg.text, /🔑 <b>Your code<\/b>: <code>AB12CD34<\/code>/);
  assert.doesNotMatch(msg.text, /Your invite link/);
  assert.equal(msg.options.reply_markup, undefined);
});

test("api error is shown to the user with the main menu", async () => {
  const ctx = fakeCtx();
  const api = {
    async getMeByTelegram() {
      throw new Error("backend down");
    },
  };
  await handleReferrals(ctx, { api });

  const msg = ctx.sent.at(-1);
  assert.match(msg.text, /backend down/);
  assert.ok(msg.options.reply_markup?.keyboard, "main menu keyboard attached");
});

test("no telegram profile -> early reply", async () => {
  const ctx = { from: undefined, sent: [], reply: async (text, options = {}) => ctx.sent.push({ text, options }) };
  await handleReferrals(ctx, { api: fakeApi({ me: defaultMe, stats: defaultStats }) });
  assert.match(ctx.sent[0].text, /Could not identify your Telegram profile/);
});
