#!/usr/bin/env node
/**
 * Воронка TronVolt по данным Umami (последние N дней, по умолчанию 7).
 *
 *   node tools/funnel.mjs [дней] [--top]
 *
 * Читает подключение к managed-кластеру из ../TronFees.Backend/.env
 * (CONNECTION_STRING) либо из переменной окружения CONNECTION_STRING /
 * UMAMI_DATABASE_URL. Только SELECT-запросы, ничего не пишет.
 */
import {
  collectFunnel,
  collectTopUsers,
  formatFunnelText,
  openUmamiPool,
  resolveUmamiDatabaseUrl,
} from "../src/analytics/funnelQuery.js";

const days = Number(process.argv[2]) || 7;
const showTop = process.argv.includes("--top");

const pool = openUmamiPool(await resolveUmamiDatabaseUrl());

const report = await collectFunnel(pool, days);
const topUsers = showTop ? await collectTopUsers(pool, days).catch(() => []) : [];
const text = formatFunnelText(report, { topUsers });

console.log(`\n${text}`);
if (report.clickLocations.length > 0) {
  console.log("\nКЛИКИ ПО ЛОКАЦИЯМ");
  for (const l of report.clickLocations) {
    console.log(`  ${l.value}: ${l.cnt}`);
  }
}
console.log("  («клик → /start» бывает >100%: в бот приходят и напрямую из Telegram, мимо лендинга)");
console.log();
await pool.end();
