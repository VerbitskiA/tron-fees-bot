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

export const config = {
  botToken: required("BOT_TOKEN"),
  tronFeesApiBaseUrl: optional(
    "TRONFEES_API_BASE_URL",
    "https://tron-fees-api.tronpay.me",
  ),
  tronFeesServiceApiKey: required("TRONFEES_SERVICE_API_KEY"),
};
