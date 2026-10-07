import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAddressStepMessage,
  buildPackageMessage,
} from "../src/bot/conversations/buyEnergy.js";

const estimateNoRewards = {
  delegationEnergyQuantity: 65000,
  delegationDurationHours: 1,
  providerCostSun: 2500000,
  marginSun: 500000,
  clientPriceSun: 3000000,
  providerCostTrx: 2.5,
  clientPriceTrx: 3,
  invoicePriceCurrency: "trx",
  availableRewardBalanceSun: 0,
  rewardDiscountSun: 0,
  discountedClientPriceSun: null,
};

const estimateWithRewards = {
  ...estimateNoRewards,
  availableRewardBalanceSun: 1_500_000,
  rewardDiscountSun: 1_500_000,
  discountedClientPriceSun: 1_500_000,
};

test("package panel without rewards shows plain price and savings", () => {
  const m = buildPackageMessage(65_000, estimateNoRewards, null);
  assert.match(m.text, /🔋 Energy: 65,000/);
  assert.match(m.text, /💳 TronVolt price: 3 TRX/);
  assert.match(m.text, /Savings: 10\.49985 TRX/);
  assert.doesNotMatch(m.text, /Reward discount/);
  assert.equal(m.parse_mode, "HTML");
});

test("package panel with rewards shows discount and payable amount", () => {
  const m = buildPackageMessage(65_000, estimateWithRewards, null);
  assert.match(m.text, /🎁 Reward discount: −1\.5 TRX/);
  assert.match(m.text, /💳 To pay with rewards: 1\.5 TRX/);
  assert.match(m.text, /💳 TronVolt price: 3 TRX/);
});

test("package panel with estimate error warns and keeps controls", () => {
  const m = buildPackageMessage(65_000, null, "API 500: boom");
  assert.match(m.text, /⚠️ Could not calculate the price/);
  assert.match(m.text, /API 500: boom/);
  assert.equal(m.parse_mode, undefined);
});

test("address step repeats package, discount and asks for the address", () => {
  const m = buildAddressStepMessage(65_000, estimateWithRewards);
  assert.match(m.text, /📦 Selected package/);
  assert.match(m.text, /• Energy amount: 65,000/);
  assert.match(m.text, /🎁 Reward discount: −1\.5 TRX/);
  assert.match(m.text, /Which TRON address should receive the energy\?/);
  assert.equal(m.parse_mode, "HTML");
});
