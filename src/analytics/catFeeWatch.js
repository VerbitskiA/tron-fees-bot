import { log } from "../logger.js";

/**
 * Следит за балансом CatFee через бэкенд и алертит владельца в Telegram,
 * когда баланс опускается ниже порога. Не спамит: не чаще раза в сутки.
 *
 * @param {{
 *   enabled: boolean;
 *   getBalanceSun: () => Promise<number>;
 *   send: (text: string) => Promise<unknown>;
 *   lowBalanceSun?: number;
 *   intervalMs?: number;
 *   minAlertIntervalMs?: number;
 *   nowImpl?: () => number;
 * }} opts
 */
export function createCatFeeWatcher(opts) {
  const {
    enabled,
    getBalanceSun,
    send,
    lowBalanceSun = 10_000_000,
    intervalMs = 6 * 3_600_000,
    minAlertIntervalMs = 24 * 3_600_000,
    nowImpl = Date.now,
  } = opts;

  if (!enabled) {
    return { stop: () => {} };
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

  return { stop: () => clearInterval(timer) };
}
