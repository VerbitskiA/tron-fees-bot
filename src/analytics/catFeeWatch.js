import { log } from "../logger.js";

/**
 * Следит за балансом CatFee через бэкенд:
 *  - алерт владельцу, когда баланс ниже порога (проверка после каждого
 *    заказа и фоном; напоминания не чаще minAlertIntervalMs);
 *  - раз в сутки в фиксированный час — текущий баланс с дельтой за сутки.
 *
 * @param {{
 *   enabled: boolean;
 *   getBalanceSun: () => Promise<number>;
 *   send: (text: string) => Promise<unknown>;
 *   lowBalanceSun?: number;
 *   intervalMs?: number;
 *   minAlertIntervalMs?: number;
 *   dailyReportHourUtc?: number;
 *   nowImpl?: () => number;
 * }} opts
 */
export function createCatFeeWatcher(opts) {
  const {
    enabled,
    getBalanceSun,
    send,
    lowBalanceSun = 30_000_000,
    intervalMs = 6 * 3_600_000,
    minAlertIntervalMs = 6 * 3_600_000,
    dailyReportHourUtc = 10,
    nowImpl = Date.now,
  } = opts;

  if (!enabled) {
    return { stop: () => {}, check: async () => {}, sendDaily: async () => {} };
  }

  let lastAlertAt = 0;

  async function check() {
    let balanceSun;
    try {
      balanceSun = await getBalanceSun();
    } catch (e) {
      log.warn("catfee_check_failed", { err: String(e) });
      return;
    }

    if (!Number.isFinite(balanceSun) || balanceSun >= lowBalanceSun) {
      return;
    }

    if (nowImpl() - lastAlertAt < minAlertIntervalMs) {
      return;
    }

    lastAlertAt = nowImpl();
    const trx = (balanceSun / 1_000_000).toFixed(2);
    const thresholdTrx = (lowBalanceSun / 1_000_000).toFixed(0);
    try {
      await send(
        [
          "⚠️ CatFee баланс низкий!",
          "",
          `Осталось: ${trx} TRX (порог ${thresholdTrx} TRX).`,
          "Пополни аккаунт на catfee.io — иначе новые заказы начнут падать с ошибкой 'balance is too lower'.",
        ].join("\n"),
      );
      log.info("catfee_low_balance_alert_sent", { balanceSun });
    } catch (e) {
      log.warn("catfee_alert_failed", { err: String(e) });
    }
  }

  const timer = setInterval(() => void check(), intervalMs);
  timer.unref?.();
  void check();

  /** @type {number | null} */
  let lastDailyBalanceSun = null;
  let dailyTimer;

  async function sendDaily() {
    try {
      const balanceSun = await getBalanceSun();
      await send(buildDailyBalanceText(balanceSun, lastDailyBalanceSun));
      lastDailyBalanceSun = balanceSun;
      log.info("catfee_daily_sent", { balanceSun });
    } catch (e) {
      log.warn("catfee_daily_failed", { err: String(e) });
    }
  }

  function scheduleDaily() {
    const delay = msUntilNextHourUtc(dailyReportHourUtc, new Date(nowImpl()));
    log.info("catfee_daily_scheduled", { inHours: Math.round(delay / 3_600_000) });
    dailyTimer = setTimeout(async () => {
      await sendDaily();
      scheduleDaily();
    }, delay);
    dailyTimer.unref?.();
  }

  scheduleDaily();

  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(dailyTimer);
    },
    check,
    sendDaily,
  };
}

/** Ежедневное сообщение: баланс и его изменение за сутки. */
export function buildDailyBalanceText(balanceSun, prevBalanceSun) {
  const trx = (balanceSun / 1_000_000).toFixed(2);
  if (prevBalanceSun == null || !Number.isFinite(prevBalanceSun)) {
    return `⚡ CatFee баланс: ${trx} TRX`;
  }
  const delta = balanceSun - prevBalanceSun;
  const deltaTrx = (delta / 1_000_000).toFixed(2);
  return `⚡ CatFee баланс: ${trx} TRX (${delta >= 0 ? "+" : ""}${deltaTrx} за сутки)`;
}

function msUntilNextHourUtc(hourUtc, now) {
  const target = new Date(now);
  target.setUTCHours(hourUtc, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}
