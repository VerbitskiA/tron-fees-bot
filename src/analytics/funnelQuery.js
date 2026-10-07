import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/**
 * Воронка TronVolt по данным Umami (лендинг + бот) за последние N дней.
 * Используется CLI-скриптом tools/funnel.mjs и еженедельной сводкой в Telegram.
 */

/** @param {string} cs Npgsql-строка (Host=...;Port=...;Username=...;Password=...) */
export function parseNpgsql(cs) {
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

/**
 * Строка подключения к базе umami: env UMAMI_DATABASE_URL, затем CONNECTION_STRING,
 * затем ../TronFees.Backend/.env (локальный запуск рядом с репой бэкенда).
 */
export async function resolveUmamiDatabaseUrl() {
  if (process.env.UMAMI_DATABASE_URL) return process.env.UMAMI_DATABASE_URL;
  if (process.env.CONNECTION_STRING) return process.env.CONNECTION_STRING;
  for (const file of [
    path.resolve(process.cwd(), "../TronFees.Backend/.env"),
    path.resolve(process.cwd(), "funnel.env"),
  ]) {
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

/** Подключение к базе umami (пул на 2 соединения). */
export function openUmamiPool(databaseUrl) {
  const config = databaseUrl.startsWith("postgres")
    ? { connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }
    : parseNpgsql(databaseUrl);
  return new pg.Pool({ ...config, max: 2 });
}

/**
 * @param {import("pg").Pool} pool
 * @param {number} days
 */
export async function collectFunnel(pool, days) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const eventCounts = async () => {
    const { rows } = await pool.query(
      `SELECT w.name AS website, e.event_name AS event, count(*)::int AS cnt
       FROM website_event e
       JOIN website w ON w.website_id = e.website_id
       WHERE e.created_at >= $1 AND e.event_name IS NOT NULL
       GROUP BY 1, 2`,
      [since],
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.website)) map.set(r.website, {});
      map.get(r.website)[r.event] = r.cnt;
    }
    return map;
  };

  const visitCounts = async () => {
    const { rows } = await pool.query(
      `SELECT w.name AS website,
              count(DISTINCT e.session_id)::int AS visitors,
              count(*) FILTER (WHERE e.event_name IS NULL)::int AS pageviews
       FROM website_event e
       JOIN website w ON w.website_id = e.website_id
       WHERE e.created_at >= $1
       GROUP BY 1`,
      [since],
    );
    return new Map(rows.map((r) => [r.website, r]));
  };

  const uniqueUsers = async () => {
    const { rows } = await pool.query(
      `SELECT e.event_name AS event, count(DISTINCT ed.string_value)::int AS uniq
       FROM website_event e
       JOIN event_data ed ON ed.event_id = e.event_id AND ed.data_key = 'uid'
       JOIN website w ON w.website_id = e.website_id AND w.name = 'TronVolt Bot'
       WHERE e.created_at >= $1 AND e.event_name IS NOT NULL
       GROUP BY 1`,
      [since],
    );
    return new Map(rows.map((r) => [r.event, r.uniq]));
  };

  const propBreakdown = async (event, key) => {
    const { rows } = await pool.query(
      `SELECT ed.string_value AS value, count(*)::int AS cnt
       FROM website_event e
       JOIN event_data ed ON ed.event_id = e.event_id AND ed.data_key = $2
       JOIN website w ON w.website_id = e.website_id
       WHERE e.created_at >= $3 AND e.event_name = $1
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [event, key, since],
    );
    return rows;
  };

  const [events, visits, uniques, clickLocations] = await Promise.all([
    eventCounts().catch(() => new Map()),
    visitCounts().catch(() => new Map()),
    uniqueUsers().catch(() => new Map()),
    propBreakdown("cta_bot_click", "location").catch(() => []),
  ]);

  return {
    days,
    landing: events.get("TronVolt") ?? {},
    bot: events.get("TronVolt Bot") ?? {},
    landingVisits: visits.get("TronVolt"),
    uniques,
    clickLocations,
  };
}

/**
 * @param {Awaited<ReturnType<typeof collectFunnel>>} r
 * @param {{ topUsers?: { uid: string; uname: string | null; events: number; orders: number }[] }} [extra]
 */
export function formatFunnelText(r, extra = {}) {
  const pct = (from, to) => (from > 0 ? Math.round((to / from) * 100) + "%" : "—");
  const withUniques = (event) => {
    const base = String(r.bot[event] ?? 0);
    const uniq = r.uniques.get(event);
    return uniq ? `${base} (уников ${uniq})` : base;
  };

  const lines = [
    `TronVolt воронка за последние ${r.days} дн.`,
    "",
    "ЛЕНДИНГ",
    `визиты: ${r.landingVisits?.visitors ?? 0}`,
    `просмотры: ${r.landingVisits?.pageviews ?? 0}`,
    `клики в бота: ${r.landing.cta_bot_click ?? 0}`,
    `калькулятор: ${r.landing.calculator_interacted ?? 0}`,
    "",
    "БОТ",
    `/start: ${withUniques("bot_start")}`,
    `referrals: ${withUniques("referrals_opened")}`,
    `заказы: ${withUniques("order_created")}`,
    `исполнено: ${r.bot.order_executed ?? 0}`,
    `ошибки: ${r.bot.order_failed ?? 0}`,
    "",
    "КОНВЕРСИИ",
    `/start → заказ: ${pct(r.bot.bot_start ?? 0, r.bot.order_created ?? 0)}`,
    `заказ → исполнено: ${pct(r.bot.order_created ?? 0, r.bot.order_executed ?? 0)}`,
  ];

  if (extra.topUsers?.length) {
    lines.push("", "ТОП ПОЛЬЗОВАТЕЛЕЙ");
    for (const u of extra.topUsers.slice(0, 10)) {
      lines.push(`@${u.uname ?? "—"} (${u.uid}): событий ${u.events}, заказов ${u.orders}`);
    }
  }

  return lines.join("\n");
}

/** Топ пользователей бота по событиям за период. */
export async function collectTopUsers(pool, days) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { rows } = await pool.query(
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
    [since],
  );
  return rows;
}
