import { test } from "node:test";
import assert from "node:assert/strict";
import { createUmamiTracker } from "../src/analytics/umami.js";

const WEBSITE_ID = "11111111-2222-3333-4444-555555555555";

/**
 * Router-style fetch fake: maps "METHOD /path" to a handler.
 * Records called routes into calls[] and /api/send bodies into sendBodies[].
 */
function fakeApi(routes) {
  const calls = [];
  const sendBodies = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? "GET"} ${u.pathname}`;
    calls.push(key);
    if (key === "POST /api/send") {
      sendBodies.push(JSON.parse(init.body ?? "{}"));
    }
    const handler = routes[key];
    if (!handler) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    const body = init.body ? JSON.parse(init.body) : {};
    return handler(body, u);
  };
  impl.calls = calls;
  impl.sendBodies = sendBodies;
  return impl;
}

function umamiRoutes({ existing = [], created = { id: WEBSITE_ID } } = {}) {
  let token = 0;
  return {
    "POST /api/auth/login": async () => ({ ok: true, status: 200, json: async () => ({ token: `t${++token}` }) }),
    "GET /api/websites": async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: existing, count: existing.length }),
    }),
    "POST /api/websites": async () => ({ ok: true, status: 200, json: async () => created }),
    "POST /api/send": async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
}

function tracker(fetchImpl, extra = {}) {
  return createUmamiTracker({
    enabled: true,
    websiteId: undefined,
    fetchImpl,
    discoveryIntervalMs: 0,
    ...extra,
  });
}

test("disabled tracker never sends anything", async () => {
  const fetchImpl = fakeApi({});
  const t = createUmamiTracker({ enabled: false, url: "https://a.example", websiteId: "w1", fetchImpl });

  assert.equal(await t.track("bot_start"), false);
  assert.equal(fetchImpl.calls.length, 0);
});

test("explicit website id is used without discovery", async () => {
  const fetchImpl = fakeApi(umamiRoutes());
  const t = createUmamiTracker({
    enabled: true,
    websiteId: "w1",
    hostname: "bot.test",
    fetchImpl,
  });

  assert.equal(await t.track("order_created", { energy: 65000 }), true);

  assert.deepEqual(fetchImpl.calls, ["POST /api/send"]);
  assert.deepEqual(fetchImpl.sendBodies[0], {
    type: "event",
    payload: { website: "w1", hostname: "bot.test", name: "order_created", data: { energy: 65000 } },
  });
});

test("discovers existing website by name on first event", async () => {
  const fetchImpl = fakeApi(umamiRoutes({ existing: [{ id: WEBSITE_ID, name: "TronVolt Bot" }] }));
  const t = tracker(fetchImpl);

  assert.equal(await t.track("bot_start"), true);

  // discovery happened once: login, list, then send
  assert.deepEqual(fetchImpl.calls, ["POST /api/auth/login", "GET /api/websites", "POST /api/send"]);
  assert.equal(fetchImpl.sendBodies[0].payload.website, WEBSITE_ID);

  // second event: no re-discovery
  assert.equal(await t.track("order_created"), true);
  assert.deepEqual(fetchImpl.calls.slice(3), ["POST /api/send"]);
});

test("creates the website when it does not exist yet", async () => {
  const fetchImpl = fakeApi(umamiRoutes({ existing: [], created: { id: WEBSITE_ID } }));
  const t = tracker(fetchImpl);

  assert.equal(await t.track("bot_start"), true);

  assert.deepEqual(fetchImpl.calls, [
    "POST /api/auth/login",
    "GET /api/websites",
    "POST /api/websites",
    "POST /api/send",
  ]);
  assert.equal(fetchImpl.sendBodies[0].payload.website, WEBSITE_ID);
});

test("failed discovery blocks the event and rate-limits retries", async () => {
  const fetchImpl = fakeApi({
    "POST /api/auth/login": async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  let now = 1_000_000;
  const t = tracker(fetchImpl, { discoveryIntervalMs: 60_000, nowImpl: () => now });

  assert.equal(await t.track("bot_start"), false);
  assert.deepEqual(fetchImpl.calls, ["POST /api/auth/login"]);

  // immediate retry is blocked by the rate limit — no extra calls
  assert.equal(await t.track("bot_start"), false);
  assert.equal(fetchImpl.calls.length, 1);

  // after the interval a new attempt is made
  now += 60_001;
  assert.equal(await t.track("bot_start"), false);
  assert.equal(fetchImpl.calls.length, 2);
});

test("discovery succeeds again after a earlier failure", async () => {
  let loginOk = false;
  const fetchImpl = fakeApi({
    "POST /api/auth/login": async () => {
      if (!loginOk) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ token: "t1" }) };
    },
    "GET /api/websites": async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: WEBSITE_ID, name: "TronVolt Bot" }], count: 1 }),
    }),
    "POST /api/send": async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  let now = 1_000;
  const t = tracker(fetchImpl, { discoveryIntervalMs: 1_000, nowImpl: () => now });

  assert.equal(await t.track("bot_start"), false); // umami not up yet

  loginOk = true;
  now += 1_001;
  assert.equal(await t.track("bot_start"), true); // recovered and cached
  assert.equal(await t.track("order_created"), true);
  assert.deepEqual(fetchImpl.calls, [
    "POST /api/auth/login",
    "POST /api/auth/login",
    "GET /api/websites",
    "POST /api/send",
    "POST /api/send",
  ]);
});

test("fetch errors resolve to false instead of throwing", async () => {
  const t = tracker(async () => {
    throw new Error("network down");
  });

  assert.equal(await t.track("bot_start"), false);
});

test("non-ok send response resolves to false", async () => {
  const fetchImpl = fakeApi({
    ...umamiRoutes({ existing: [{ id: WEBSITE_ID, name: "TronVolt Bot" }] }),
    "POST /api/send": async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  const t = tracker(fetchImpl);

  assert.equal(await t.track("bot_start"), false);
});
