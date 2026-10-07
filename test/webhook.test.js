import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDelegationOrderPayload } from "../src/webhook/validatePayload.js";
import { buildDelegationOrderStatusMessage } from "../src/webhook/messages.js";

const validBody = {
  eventId: "e1",
  orderId: "o1",
  telegramUserId: 42,
  status: "Executed",
  delegationRecipientTronAddress: "TABC",
};

test("valid payload passes and fills defaults", () => {
  const r = validateDelegationOrderPayload(validBody);
  assert.equal(r.ok, true);
  assert.equal(r.payload.eventId, "e1");
  assert.equal(r.payload.telegramUserId, 42);
  assert.equal(r.payload.rewardDiscountSun, null);
  assert.equal(r.payload.payAmount, null);
});

test("telegramUserId is coerced from strings and truncated", () => {
  const r = validateDelegationOrderPayload({ ...validBody, telegramUserId: "42.9" });
  assert.equal(r.ok, true);
  assert.equal(r.payload.telegramUserId, 42);
});

test("rewardDiscountSun is parsed as optional number", () => {
  const r = validateDelegationOrderPayload({ ...validBody, rewardDiscountSun: 2500000 });
  assert.equal(r.ok, true);
  assert.equal(r.payload.rewardDiscountSun, 2500000);

  const s = validateDelegationOrderPayload({ ...validBody, rewardDiscountSun: "nope" });
  assert.equal(s.ok, true);
  assert.equal(s.payload.rewardDiscountSun, null);
});

test("missing required fields are rejected", () => {
  for (const key of ["eventId", "orderId", "telegramUserId", "status", "delegationRecipientTronAddress"]) {
    const body = { ...validBody };
    delete body[key];
    const r = validateDelegationOrderPayload(body);
    assert.equal(r.ok, false, key);
  }
});

test("non-object and null bodies are rejected", () => {
  assert.equal(validateDelegationOrderPayload(null).ok, false);
  assert.equal(validateDelegationOrderPayload("text").ok, false);
  assert.equal(validateDelegationOrderPayload(5).ok, false);
});

const executedPayload = (extra = {}) => ({
  eventId: "e1",
  orderId: "11111111-1111-1111-1111-111111111111",
  telegramUserId: 42,
  status: "Executed",
  failureCode: null,
  failureReason: null,
  catFeeOrderReference: "cat-9",
  delegationRecipientTronAddress: "TREC",
  delegationEnergyQuantity: 65000,
  delegationDurationHours: 1,
  payAmount: 3,
  payCurrency: "trx",
  rewardDiscountSun: null,
  paymentReceivedAt: "2026-10-07T10:00:00Z",
  executedAt: "2026-10-07T10:01:00Z",
  ...extra,
});

test("executed message lists energy, address, paid amount and order id", () => {
  const m = buildDelegationOrderStatusMessage(executedPayload());
  assert.match(m.text, /✅ Energy delivered!/);
  assert.match(m.text, /⚡ Energy: 65,000/);
  assert.match(m.text, /⏱ Duration: 1 h/);
  assert.match(m.text, /🎯 Address: TREC/);
  assert.match(m.text, /💰 Paid: 3 TRX/);
  assert.match(m.text, /Order ID: <code>11111111-1111-1111-1111-111111111111<\/code>/);
  assert.equal(m.parse_mode, "HTML");
  assert.doesNotMatch(m.text, /Reward credits used/);
});

test("executed message shows reward credits line when discount was applied", () => {
  const m = buildDelegationOrderStatusMessage(executedPayload({ rewardDiscountSun: 2500000 }));
  assert.match(m.text, /🎁 Reward credits used: −2\.5 TRX/);
});

test("failed message shows human reason and support contact", () => {
  const m = buildDelegationOrderStatusMessage({
    ...executedPayload(),
    status: "Failed",
    failureCode: "201",
    failureReason: null,
  });
  assert.match(m.text, /❌ Order could not be completed/);
  assert.match(m.text, /The energy provider could not process the order/);
  assert.match(m.text, /@tron_volt_support/);
});

test("failed message prefers explicit failure reason over code mapping", () => {
  const m = buildDelegationOrderStatusMessage({
    ...executedPayload(),
    status: "Failed",
    failureReason: "balance is too lower",
  });
  assert.match(m.text, /Reason: balance is too lower/);
});

test("unknown status falls back to generic update", () => {
  const m = buildDelegationOrderStatusMessage({ ...executedPayload(), status: "Weird" });
  assert.match(m.text, /Status: Weird/);
});
