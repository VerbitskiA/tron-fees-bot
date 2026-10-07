#!/usr/bin/env node
/**
 * Отправить сводку воронки в Telegram прямо сейчас (не дожидаясь понедельника).
 *
 *   node tools/sendReport.mjs [дней]     # локально: читает .env / ../TronFees.Backend/.env
 *   docker exec tronfees-bot node tools/sendReport.mjs   # на VPS: env уже в контейнере
 *
 * Нужны BOT_TOKEN и подключение к базе umami (UMAMI_DATABASE_URL или CONNECTION_STRING).
 */
import { config } from "../src/config.js";
import {
  collectFunnel,
  collectTopUsers,
  formatFunnelText,
  openUmamiPool,
  resolveUmamiDatabaseUrl,
} from "../src/analytics/funnelQuery.js";

const days = Number(process.argv[2]) || 7;
const ownerId = Number(process.env.OWNER_TELEGRAM_ID) || 1124839901;

const pool = openUmamiPool(await resolveUmamiDatabaseUrl());
const report = await collectFunnel(pool, days);
const topUsers = await collectTopUsers(pool, days).catch(() => []);
await pool.end();

const text = formatFunnelText(report, { topUsers });

const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: ownerId, text }),
});
const body = await res.json();

if (!res.ok || !body.ok) {
  console.error("Telegram error:", JSON.stringify(body).slice(0, 300));
  process.exit(1);
}
console.log(`Сводка за ${days} дн. отправлена chat_id=${ownerId}`);
