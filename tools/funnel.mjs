#!/usr/bin/env node
/**
 * Воронка TronVolt по данным Umami (последние N дней, по умолчанию 7).
 *
 *   node tools/funnel.mjs [дней] [--top]
 *
 * Читает подключение к managed-кластеру из ../TronFees.Backend/.env
 * (CONNECTION_STRING) либо из переменной окружения CONNECTION_STRING.
 * Только SELECT-запросы, ничего не пишет.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const days = Number(process.argv[2]) || 7;
const showTop = process.argv.includes("--top");

async function resolveConnectionString() {
  if (process.env.CONNECTION_STRING) return process.env.CONNECTION_STRING;
  const candidates = [
    path.resolve(process.cwd(), "../TronFees.Backend/.env"),
    path.resolve(process.cwd(), "funnel.env"),
  ];
  for (const file of candidates) {
    try {
      const text = await readFile(file, "utf8");
      const m = text.match(/^CONNECTION_STRING=(.+)$/m);
      if (m) return m[1].trim();
    } catch {
      /* keep looking */
    }
  }
  throw new Error("CONNECTION_STRING не найден: ../TronFees.Backend/.env или переменная окружения");
}

function parseNpgsql(cs) {
  const pick = (key) => {
    const m = cs.match(new RegExp(`${key}=([^;]+)`));
    return m ? m[1] : "";
  };
  return {
    host: pick("Host"),
    port: Number(pick("Port")) || 25060,
    database: "umami",
    user: pick("Username"),
    password: pick("Password"),
    ssl: { rejectUnauthorized: false },
  };
}

/** Событие → число за период, по website. */
async function eventCounts(client, sinceIso) {
  const { rows } = await client.query(
    `SELECT w.name AS website, e.event_name AS event, count(*)::int AS cnt
     FROM website_event e
     JOIN website w ON w.website_id = e.website_id
     WHERE e.created_at >= $1 AND e.event_name IS NOT NULL
     GROUP BY 1, 2`,
    [sinceIso],
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.website)) map.set(r.website, {});
    map.get(r.website)[r.event] = r.cnt;
  }
  return map;
}

/** Визиты/просмотры (события без имени = pageview). */
async function visitCounts(client, sinceIso) {
  const { rows } = await client.query(
    `SELECT w.name AS website,
            count(DISTINCT e.session_id)::int AS visitors,
            count(*) FILTER (WHERE e.event_name IS NULL)::int AS pageviews
     FROM website_event e
     JOIN website w ON w.website_id = e.website_id
     WHERE e.created_at >= $1
     GROUP BY 1`,
    [sinceIso],
  );
  return new Map(rows.map((r) => [r.website, r]));
}

/** Уникальные пользователи бота: distinct значение свойства uid по событию. */
async function uniqueUsers(client, sinceIso) {
  const { rows } = await client.query(
    `SELECT e.event_name AS event,
            count(DISTINCT ed.string_value)::int AS uniq
     FROM website_event e
     JOIN event_data ed ON ed.event_id = e.event_id AND ed.data_key = 'uid'
     JOIN website w ON w.website_id = e.website_id AND w.name = 'TronVolt Bot'
     WHERE e.created_at >= $1 AND e.event_name IS NOT NULL
     GROUP BY 1`,
    [sinceIso],
  );
  return new Map(rows.map((r) => [r.event, r.uniq]));
}

/** Разбивка свойства (например, локация кликов). */
async function propBreakdown(client, event, key, sinceIso) {
  const { rows } = await client.query(
    `SELECT ed.string_value AS value, count(*)::int AS cnt
     FROM website_event e
     JOIN event_data ed ON ed.event_id = e.event_id AND ed.data_key = $2
     JOIN website w ON w.website_id = e.website_id
     WHERE e.created_at >= $3 AND e.event_name = $1
     GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    [event, key, sinceIso],
  );
  return rows;
}

/** Топ пользователей бота по числу событий. */
async function topUsers(client, sinceIso) {
  const { rows } = await client.query(
    `SELECT ed.string_value AS uid,
            max(uname.string_value) AS uname,
            count(*)::int AS events,
            count(*) FILTER (WHERE e.event_name = 'order_created')::int AS orders
     FROM website_event e
     JOIN event_data ed ON ed.event_id = e.event_id AND ed.data_key = 'uid'
     LEFT JOIN event_data uname ON uname.event_id = e.event_id AND uname.data_key = 'uname'
     JOIN website w ON w.website_id = e.website_id AND w.name = 'TronVolt Bot'
     WHERE e.created_at >= $1 AND e.event_name IS NOT NULL
     GROUP BY 1
     ORDER BY 3 DESC LIMIT 15`,
    [sinceIso],
  );
  return rows;
}

const pct = (from, to) => (from > 0 ? Math.round((to / from) * 100) + "%" : "—");

function row(label, value) {
  console.log(`  ${label.padEnd(28, ".")} ${value}`);
}

const pool = new pg.Pool({ ...parseNpgsql(await resolveConnectionString()), max: 2 });
const client = pool;

const since = new Date(Date.now() - days * 86_400_000).toISOString();
const [events, visits, uniques] = await Promise.all([
  eventCounts(client, since),
  visitCounts(client, since),
  uniqueUsers(client, since).catch(() => new Map()),
]);

const landing = events.get("TronVolt") ?? {};
const bot = events.get("TronVolt Bot") ?? {};
const landingVisits = visits.get("TronVolt");

console.log(`\nTronVolt воронка за последние ${days} дней\n`);

console.log("ЛЕНДИНГ (TronVolt)");
row("визиты", landingVisits?.visitors ?? 0);
row("просмотры страниц", landingVisits?.pageviews ?? 0);
row("клики в бота", landing.cta_bot_click ?? 0);
row("калькулятор", landing.calculator_interacted ?? 0);
const clickLocations = await propBreakdown(client, "cta_bot_click", "location", since).catch(() => []);
for (const l of clickLocations) {
  console.log(`      · ${l.value}: ${l.cnt}`);
}

console.log("\nБОТ (TronVolt Bot)");
row("/start", `${bot.bot_start ?? 0}${uniques.get("bot_start") ? ` (уников ${uniques.get("bot_start")})` : ""}`);
row("referrals открыты", `${bot.referrals_opened ?? 0}${uniques.get("referrals_opened") ? ` (уников ${uniques.get("referrals_opened")})` : ""}`);
row("заказы созданы", `${bot.order_created ?? 0}${uniques.get("order_created") ? ` (уников ${uniques.get("order_created")})` : ""}`);
row("исполнено", bot.order_executed ?? 0);
row("ошибки", bot.order_failed ?? 0);

console.log("\nКОНВЕРСИИ");
row("клик → /start", pct(landing.cta_bot_click ?? 0, bot.bot_start ?? 0));
row("/start → заказ", pct(bot.bot_start ?? 0, bot.order_created ?? 0));
row("заказ → исполнено", pct(bot.order_created ?? 0, bot.order_executed ?? 0));
console.log("  («клик → /start» бывает >100%: в бот приходят и напрямую из Telegram, мимо лендинга)");

if (showTop) {
  console.log("\nТОП ПОЛЬЗОВАТЕЛЕЙ БОТА");
  const users = await topUsers(client, since).catch(() => []);
  if (users.length === 0) {
    console.log("  (нет данных uid — события до обновления бота их не содержат)");
  }
  for (const u of users) {
    console.log(`  ${String(u.uid).padEnd(12)} @${u.uname ?? "—"}  событий: ${String(u.events).padEnd(4)} заказов: ${u.orders}`);
  }
}

console.log();
await pool.end();
