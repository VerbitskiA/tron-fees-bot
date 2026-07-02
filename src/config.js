import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name]?.trim();
  return v || fallback;
}

function optionalInt(name, fallback) {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseBool(name, fallback) {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

const webhookEnabled = parseBool("WEBHOOK_ENABLED", false);

export const config = {
  botToken: required("BOT_TOKEN"),
  tronFeesApiBaseUrl: optional(
    "TRONFEES_API_BASE_URL",
    "https://tron-fees-api.tronpay.me",
  ),
  tronFeesServiceApiKey: required("TRONFEES_SERVICE_API_KEY"),
  webhookEnabled,
  webhookPort: optionalInt("WEBHOOK_PORT", 3000),
  webhookSecret: webhookEnabled ? required("WEBHOOK_SECRET") : optional("WEBHOOK_SECRET", ""),
  webhookDedupTtlMs: optionalInt("WEBHOOK_DEDUP_TTL_MS", 86_400_000),
};
