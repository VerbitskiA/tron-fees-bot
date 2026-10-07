import { test } from "node:test";
import assert from "node:assert/strict";
import { formatFunnelText, parseNpgsql } from "../src/analytics/funnelQuery.js";
import { msUntilNextMonday } from "../src/analytics/weeklyReport.js";

test("msUntilNextMonday: суббота → ближайший понедельник", () => {
  const now = new Date("2026-10-10T12:00:00Z"); // суббота
  const ms = msUntilNextMonday(10, now);
  const target = new Date(now.getTime() + ms);
  assert.equal(target.toISOString(), "2026-10-12T10:00:00.000Z"); // понедельник 10:00
});

test("msUntilNextMonday: понедельник до времени → сегодня", () => {
  const now = new Date("2026-10-12T07:00:00Z"); // понедельник, 07:00
  const target = new Date(now.getTime() + msUntilNextMonday(10, now));
  assert.equal(target.toISOString(), "2026-10-12T10:00:00.000Z");
});

test("msUntilNextMonday: понедельник после времени → через неделю", () => {
  const now = new Date("2026-10-12T11:00:00Z"); // понедельник, 11:00
  const target = new Date(now.getTime() + msUntilNextMonday(10, now));
  assert.equal(target.toISOString(), "2026-10-19T10:00:00.000Z");
});

test("msUntilNextMonday: ровно в момент времени → следующая неделя (без двойной отправки)", () => {
  const now = new Date("2026-10-12T10:00:00.000Z");
  const target = new Date(now.getTime() + msUntilNextMonday(10, now));
  assert.equal(target.toISOString(), "2026-10-19T10:00:00.000Z");
});

test("formatFunnelText renders the funnel with uniques and conversions", () => {
  const text = formatFunnelText(
    {
      days: 7,
      landing: { cta_bot_click: 5, calculator_interacted: 3 },
      bot: { bot_start: 20, referrals_opened: 4, order_created: 2, order_executed: 1, order_failed: 0 },
      landingVisits: { visitors: 9, pageviews: 21 },
      uniques: new Map([["bot_start", 12], ["order_created", 2]]),
      clickLocations: [],
    },
    { topUsers: [{ uid: "42", uname: "alice", events: 7, orders: 2 }] },
  );

  assert.match(text, /визиты: 9/);
  assert.match(text, /клики в бота: 5/);
  assert.match(text, /\/start: 20 \(уников 12\)/);
  assert.match(text, /заказы: 2 \(уников 2\)/);
  assert.match(text, /\/start → заказ: 10%/);
  assert.match(text, /заказ → исполнено: 50%/);
  assert.match(text, /@alice \(42\): событий 7, заказов 2/);
});

test("parseNpgsql extracts host, port and credentials", () => {
  const c = parseNpgsql("Host=h.example;Port=25060;Database=defaultdb;Username=u;Password=p");
  assert.equal(c.host, "h.example");
  assert.equal(c.port, 25060);
  assert.equal(c.user, "u");
  assert.equal(c.password, "p");
  assert.equal(c.database, "umami");
});
