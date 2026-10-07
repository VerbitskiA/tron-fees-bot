import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineTrxWithoutService, savingsVersusBaseline } from "../src/bot/savings.js";

test("baseline is known for supported packages", () => {
  assert.equal(baselineTrxWithoutService(65_000), 13.49985);
  assert.equal(baselineTrxWithoutService(135_000), 27.34578);
  assert.equal(baselineTrxWithoutService(270_000), 54.69156);
});

test("baseline is null for unknown package size", () => {
  assert.equal(baselineTrxWithoutService(1000), null);
});

test("savings compares client price against the burn baseline", () => {
  const s = savingsVersusBaseline(65_000, 4.05);
  assert.ok(s);
  assert.equal(s.baseline, 13.49985);
  assert.ok(Math.abs(s.saveTrx - (13.49985 - 4.05)) < 1e-9);
  assert.ok(Math.abs(s.saveUsd - (13.49985 - 4.05) * 0.35) < 1e-9);
});

test("savings accepts numeric string prices", () => {
  const s = savingsVersusBaseline(65_000, "4.05");
  assert.ok(s);
  assert.ok(Math.abs(s.saveTrx - 9.44985) < 1e-9);
});

test("no savings claim for the largest package", () => {
  assert.equal(savingsVersusBaseline(270_000, 8.1), null);
});

test("no savings for unknown energy amount", () => {
  assert.equal(savingsVersusBaseline(12345, 1), null);
});
