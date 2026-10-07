import { log } from "../logger.js";
import { collectFunnel, collectTopUsers, formatFunnelText, openUmamiPool } from "./funnelQuery.js";

/** Миллисекунды до ближайшего понедельника 10:00 UTC (не сегодня, если время уже прошло). */
export function msUntilNextMonday(hourUtc, now = new Date()) {
  const target = new Date(now);
  target.setUTCHours(hourUtc, 0, 0, 0);
  const day = target.getUTCDay(); // 0=вс ... 1=пн
  let addDays = (1 - day + 7) % 7; // дней до понедельника
  if (addDays === 0 && target.getTime() <= now.getTime()) {
    addDays = 7;
  }
  target.setUTCDate(target.getUTCDate() + addDays);
  return target.getTime() - now.getTime();
}

/**
 * Еженедельная сводка воронки владельцу в Telegram (по понедельникам, 10:00 UTC).
 *
 * @param {import("grammy").Bot} bot
 * @param {{
 *   databaseUrl: string;
 *   ownerId: number;
 *   hourUtc?: number;
 *   nowImpl?: () => Date;
 *   sendNow?: boolean;
 * }} opts
 */
export function startWeeklyReport(bot, opts) {
  const { databaseUrl, ownerId, hourUtc = 10, nowImpl = () => new Date(), sendNow = false } = opts;
  if (!databaseUrl || !ownerId) {
    log.info("weekly_report_disabled");
    return;
  }

  const pool = openUmamiPool(databaseUrl);
  let timer;

  async function send() {
    try {
      const report = await collectFunnel(pool, 7);
      const topUsers = await collectTopUsers(pool, 7).catch(() => []);
      const text = formatFunnelText(report, { topUsers });
      await bot.api.sendMessage(ownerId, text);
      log.info("weekly_report_sent", { ownerId });
    } catch (e) {
      log.error("weekly_report_failed", e);
    }
  }

  function schedule() {
    const delay = msUntilNextMonday(hourUtc, nowImpl());
    log.info("weekly_report_scheduled", { inHours: Math.round(delay / 3_600_000) });
    timer = setTimeout(async () => {
      await send();
      schedule();
    }, delay);
    timer.unref?.();
  }

  if (sendNow) {
    void send();
  }
  schedule();

  return () => clearTimeout(timer);
}
