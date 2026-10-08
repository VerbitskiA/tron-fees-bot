import { createTronFeesClient } from "./api/tronFeesClient.js";
import { config } from "./config.js";
import { createBot } from "./bot/createBot.js";
import { log } from "./logger.js";
import { startWeeklyReport } from "./analytics/weeklyReport.js";
import { createCatFeeWatcher } from "./analytics/catFeeWatch.js";
import { createEventIdCache } from "./webhook/eventIdCache.js";
import { createWebhookServer } from "./webhook/server.js";

async function main() {
  const api = createTronFeesClient({
    baseUrl: config.tronFeesApiBaseUrl,
    apiKey: config.tronFeesServiceApiKey,
  });

  const deps = { api };
  const bot = createBot(config.botToken, deps);

  await bot.api.setMyCommands([
    { command: "start", description: "Get started with the bot" },
    { command: "help", description: "Help and support" },
  ]);

  if (config.weeklyReport.databaseUrl) {
    startWeeklyReport(bot, {
      databaseUrl: config.weeklyReport.databaseUrl,
      ownerId: config.weeklyReport.ownerId,
      sendNow: config.weeklyReport.sendNow,
      getCatFeeBalanceTrx: async () => (await api.getCatFeeBalance()).balanceTrx,
    });
  }

  const catFeeWatch = createCatFeeWatcher({
    enabled: config.catFeeWatch.enabled,
    getBalanceSun: async () => (await api.getCatFeeBalance()).balanceSun,
    send: (text) => bot.api.sendMessage(config.catFeeWatch.ownerId, text),
    lowBalanceSun: config.catFeeWatch.lowBalanceTrx,
  });

  if (config.webhookEnabled) {
    const eventIdCache = createEventIdCache({ ttlMs: config.webhookDedupTtlMs });
    createWebhookServer({ bot, api, config, eventIdCache, catFeeWatch });
  }

  log.info("starting bot…");
  await bot.start();
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
