import { test } from "node:test";
import assert from "node:assert/strict";
import { BUY_ENERGY_LABEL, PARTNER_LABEL, REFERRALS_LABEL, mainMenuKeyboard } from "../src/bot/menu.js";
import { commandArgs } from "../src/bot/commandArgs.js";
import { isValidTronAddress } from "../src/bot/tronAddress.js";
import { formatUserError } from "../src/bot/errors.js";
import { TronFeesApiError } from "../src/api/tronFeesClient.js";

test("main menu always shows buy energy and referrals for everyone", () => {
  const kb = mainMenuKeyboard();
  const markup = kb.reply_markup ?? kb;
  const buttons = markup.keyboard.map((row) => row.map((b) => b.text));
  assert.deepEqual(buttons, [[BUY_ENERGY_LABEL], [REFERRALS_LABEL], [PARTNER_LABEL]]);
  assert.equal(markup.resize_keyboard, true);
});

test("commandArgs parses /cmd@Bot payloads", () => {
  const ctx = (text) => ({ message: { text } });
  assert.deepEqual(commandArgs(ctx("/start aff_CODE1234")), { cmd: "/start", args: ["aff_CODE1234"] });
  assert.deepEqual(commandArgs(ctx("/START@tronvolt_bot  42  extra")), {
    cmd: "/start",
    args: ["42", "extra"],
  });
  assert.deepEqual(commandArgs(ctx("/help")), { cmd: "/help", args: [] });
  assert.deepEqual(commandArgs(ctx(undefined)), { cmd: "", args: [] });
});

test("TRON address validation", () => {
  assert.equal(isValidTronAddress("TABCDEFabcdef1234abcdef1234abcdef1"), true);
  assert.equal(isValidTronAddress(" tabcdefabcdef1234abcdef1234abcdef12 ".trim()), false); // starts lowercase
  assert.equal(isValidTronAddress("0ABCDEFabcdef1234abcdef1234abcdef1"), false); // wrong prefix
  assert.equal(isValidTronAddress("TABCDEFabcdef1234abcdef1234abcdef"), false); // 33 chars total
  assert.equal(isValidTronAddress(""), false);
  assert.equal(isValidTronAddress(undefined), false);
});

test("formatUserError maps API statuses to user-friendly text", () => {
  assert.equal(
    formatUserError(new TronFeesApiError(500, "API 500: boom")),
    "Service is temporarily unavailable. Please contact the administrator.",
  );
  assert.equal(
    formatUserError(new TronFeesApiError(401, "API 401: nope")),
    "Service is temporarily unavailable. Please contact the administrator.",
  );
  assert.equal(
    formatUserError(new TronFeesApiError(404, "API 404: missing")),
    "Record not found. Run /start to register.",
  );
  assert.equal(
    formatUserError(new TronFeesApiError(400, "API 400: bad", "Duration must be at least 1.")),
    "Duration must be at least 1.",
  );
  assert.equal(
    formatUserError(new TronFeesApiError(429, "API 429: slow", "Try later")),
    "Try later",
  );
  assert.equal(formatUserError(new Error("plain")), "plain");
  assert.equal(formatUserError("weird"), "Something went wrong. Please try again later.");
});
