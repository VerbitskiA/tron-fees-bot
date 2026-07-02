import http from "node:http";
import { log } from "../logger.js";
import { createDelegationOrderHandler } from "./delegationOrderHandler.js";

const DELEGATION_ORDER_PATH = "/webhooks/delegation-order";
const MAX_BODY_BYTES = 65_536;

/**
 * @param {import("node:http").IncomingMessage} req
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
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
export function createWebhookServer(deps) {
  const handleDelegationOrder = createDelegationOrderHandler(deps);

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const path = req.url?.split("?")[0] ?? "";

    if (method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (method === "POST" && path === DELEGATION_ORDER_PATH) {
      try {
        const bodyText = await readBody(req);
        await handleDelegationOrder(req, res, bodyText);
      } catch (err) {
        log.error("webhook_read_error", err);
        if (!res.headersSent) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body too large" }));
        }
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(deps.config.webhookPort, () => {
    log.info("webhook listening", { port: deps.config.webhookPort, path: DELEGATION_ORDER_PATH });
  });

  return server;
}
