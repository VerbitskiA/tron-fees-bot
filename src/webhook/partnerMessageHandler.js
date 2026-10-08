import crypto from "node:crypto";
import { log } from "../logger.js";

const MAX_TEXT_LENGTH = 3500;

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
 * Backend → bot channel for free-form partner alerts (low deposit etc.).
 * Payload: { eventId: guid, telegramUserId: number, text: string }
 *
 * @param {{
 *   bot: import("grammy").Bot;
 *   config: import("../config.js").config;
 *   eventIdCache: ReturnType<typeof import("./eventIdCache.js").createEventIdCache>;
 * }} deps
 */
export function createPartnerMessageHandler(deps) {
  const { bot, config, eventIdCache } = deps;

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} bodyText
   */
  return async function handlePartnerMessageWebhook(req, res, bodyText) {
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

    if (typeof body !== "object" || body === null) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid payload" }));
      return;
    }

    const { eventId, telegramUserId, text } = /** @type {Record<string, unknown>} */ (body);
    if (typeof eventId !== "string" || eventId.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "eventId is required" }));
      return;
    }
    if (typeof telegramUserId !== "number" || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "telegramUserId must be a positive integer" }));
      return;
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "text is required" }));
      return;
    }

    if (!eventIdCache.claim(eventId)) {
      log.info("webhook_dedup", { eventId });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, duplicate: true }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    void bot.api.sendMessage(telegramUserId, text.slice(0, MAX_TEXT_LENGTH))
      .then(() => {
        log.info("partner_message_ok", { eventId, telegramUserId });
      })
      .catch((err) => {
        log.error("partner_message_failed", { eventId, telegramUserId, err });
      });
  };
}
