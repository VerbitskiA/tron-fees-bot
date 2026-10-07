import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTrx, formatUsd, sunToTrx } from "../src/bot/format.js";

test("formatTrx formats numbers with en-US locale", () => {
  assert.equal(formatTrx(4), "4");
  assert.equal(formatTrx(4.5), "4.5");
  assert.equal(formatTrx(1350000.5), "1,350,000.5");
});

test("formatTrx accepts numeric strings", () => {
  assert.equal(formatTrx("3.25"), "3.25");
});

test("formatTrx passes through non-finite input", () => {
  assert.equal(formatTrx("abc"), "abc");
  assert.equal(formatTrx(undefined), "—");
});

test("sunToTrx divides by 1e6", () => {
  assert.equal(sunToTrx(1_500_000), 1.5);
  assert.equal(sunToTrx(0), 0);
});

test("formatUsd formats with two decimals and dollar suffix", () => {
  assert.equal(formatUsd(1.5), "1.50\u00a0$");
  assert.equal(formatUsd("2.345"), "2.35\u00a0$");
  assert.equal(formatUsd("nope"), "nope");
});
