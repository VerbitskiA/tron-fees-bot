import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatFeeWatcher } from "../src/analytics/catFeeWatch.js";

function harness({ balanceSun, lowBalanceSun = 10_000_000, nowSequence }) {
  const sent = [];
  let i = 0;
  let now = nowSequence?.[i++] ?? 1_000_000_000_000;
  const watcher = createCatFeeWatcher({
    enabled: true,
    getBalanceSun: async () => balanceSun,
    send: async (text) => sent.push(text),
    lowBalanceSun,
    intervalMs: 1_000,
    minAlertIntervalMs: 60_000,
    nowImpl: () => {
      const v = now;
      now = nowSequence?.[i++] ?? v;
      return v;
    },
  });
  return { watcher, sent };
}

test("balance above threshold: silent", async () => {
  const h = harness({ balanceSun: 31_250_016 });
  await new Promise((r) => setTimeout(r, 30));
  h.watcher.stop();
  assert.equal(h.sent.length, 0);
});

test("low balance: alerts once, not more often than daily", async () => {
  const h = harness({
    balanceSun: 5_000_000,
    nowSequence: [1_000_000, 1_010_000, 1_020_000],
  });
  // initial check fires immediately
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /CatFee баланс низкий/);
  assert.match(h.sent[0], /5\.00 TRX/);

  // two more checks within the alert interval — no spam
  await new Promise((r) => setTimeout(r, 30));
  h.watcher.stop();
  assert.equal(h.sent.length, 1);
});

test("fetch failure is swallowed", async () => {
  const sent = [];
  const watcher = createCatFeeWatcher({
    enabled: true,
    getBalanceSun: async () => {
      throw new Error("backend down");
    },
    send: async (t) => sent.push(t),
  });
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();
  assert.equal(sent.length, 0);
});

test("disabled watcher does nothing", async () => {
  const watcher = createCatFeeWatcher({
    enabled: false,
    getBalanceSun: async () => {
      throw new Error("should not be called");
    },
    send: async () => {},
  });
  assert.equal(typeof watcher.stop, "function");
  await assert.doesNotReject(() => watcher.check());
});

test("check() is exposed for per-order triggers", async () => {
  const sent = [];
  let balanceSun = 25_000_000; // ниже дефолтного порога 30 TRX
  const watcher = createCatFeeWatcher({
    enabled: true,
    getBalanceSun: async () => balanceSun,
    send: async (t) => sent.push(t),
    minAlertIntervalMs: 6 * 3_600_000,
  });
  await watcher.check();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /25\.00 TRX/);
  assert.match(sent[0], /порог 30 TRX/);

  // сразу после «следующего заказа» — тихо (антиспам)
  balanceSun = 20_000_000;
  await watcher.check();
  assert.equal(sent.length, 1);
  watcher.stop();
});
