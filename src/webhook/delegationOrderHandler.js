import crypto from "node:crypto";
import { log } from "../logger.js";
import { mainMenuKeyboardForTelegramUser } from "../bot/menu.js";
import { buildDelegationOrderStatusMessage } from "./messages.js";
import { validateDelegationOrderPayload } from "./validatePayload.js";

/**
 * @param {string} provided
 * @param {string} expected
 */
function secureCompare(provided, expected) {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {import("grammy").Bot} bot
 * @param {import("../api/tronFeesClient.js").TronFeesApi} api
 * @param {import("./validatePayload.js").DelegationOrderWebhookPayload} payload
 */
async function sendDelegationOrderNotification(bot, api, payload) {
  const msg = buildDelegationOrderStatusMessage(payload);
  const keyboard = await mainMenuKeyboardForTelegramUser(api, payload.telegramUserId);

  await bot.api.sendMessage(payload.telegramUserId, msg.text, {
    parse_mode: msg.parse_mode,
    reply_markup: keyboard,
  });
}

/**
 * @param {{
 *   bot: import("grammy").Bot;
 *   api: import("../api/tronFeesClient.js").TronFeesApi;
 *   config: import("../config.js").config;
 *   eventIdCache: ReturnType<import("./eventIdCache.js").createEventIdCache>;
 * }} deps
 */
export function createDelegationOrderHandler(deps) {
  const { bot, api, config, eventIdCache } = deps;

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} bodyText
   */
  return async function handleDelegationOrderWebhook(req, res, bodyText) {
    const secret = req.headers["x-webhook-secret"];
    if (typeof secret !== "string" || !secureCompare(secret, config.webhookSecret)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    /** @type {unknown} */
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const validated = validateDelegationOrderPayload(body);
    if (!validated.ok) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: validated.error }));
      return;
    }

    const payload = validated.payload;

    if (!eventIdCache.claim(payload.eventId)) {
      log.info("webhook_dedup", { eventId: payload.eventId, orderId: payload.orderId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, duplicate: true }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    void sendDelegationOrderNotification(bot, api, payload)
      .then(() => {
        log.info("webhook_notify_ok", {
          eventId: payload.eventId,
          orderId: payload.orderId,
          status: payload.status,
          telegramUserId: payload.telegramUserId,
        });
      })
      .catch((err) => {
        log.error("webhook_notify_failed", {
          eventId: payload.eventId,
          orderId: payload.orderId,
          err,
        });
      });
  };
}
