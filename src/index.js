import { createTronFeesClient } from "./api/tronFeesClient.js";
import { config } from "./config.js";
import { createBot } from "./bot/createBot.js";
import { log } from "./logger.js";

async function main() {
  const api = createTronFeesClient({
    baseUrl: config.tronFeesApiBaseUrl,
    apiKey: config.tronFeesServiceApiKey,
  });

  const deps = { api };
  const bot = createBot(config.botToken, deps);

  await bot.api.setMyCommands([
    { command: "start", description: "Начать работу с ботом" },
    { command: "help", description: "Помощь и поддержка" },
  ]);

  log.info("starting bot…");
  await bot.start();
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
