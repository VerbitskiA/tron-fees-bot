import { log } from "../logger.js";

// Zero-config defaults: everything works out of the box on the stage host.
// Env vars only override; nothing has to be set for events to flow.
const DEFAULTS = {
  url: "http://umami:3000",
  hostname: "tronvolt-bot",
  websiteName: "TronVolt Bot",
  // Umami validates website domains (needs a dot or "localhost"); hostname won't do.
  websiteDomain: "tronvolt-bot.local",
  adminUser: "admin",
  adminPassword: "umami",
  discoveryIntervalMs: 60_000,
};

/**
 * Server-side funnel events for a self-hosted Umami 3.x instance
 * (POST /api/send with {type: "event", payload: {...}}).
 *
 * The website id does not need to be configured: on the first event the tracker
 * logs into Umami with the default admin credentials, finds (or creates) the
 * website and caches its id. If you change the Umami admin password, set
 * UMAMI_WEBSITE_ID explicitly instead.
 *
 * @param {{
 *   enabled: boolean;
 *   url?: string;
 *   websiteId?: string;
 *   hostname?: string;
 *   adminUser?: string;
 *   adminPassword?: string;
 *   fetchImpl?: typeof fetch;
 *   nowImpl?: () => number;
 *   discoveryIntervalMs?: number;
 * }} opts
 */
export function createUmamiTracker(opts) {
  const {
    enabled,
    url = DEFAULTS.url,
    hostname = DEFAULTS.hostname,
    websiteName = DEFAULTS.websiteName,
    websiteDomain = DEFAULTS.websiteDomain,
    adminUser = DEFAULTS.adminUser,
    adminPassword = DEFAULTS.adminPassword,
    fetchImpl = fetch,
    nowImpl = Date.now,
    discoveryIntervalMs = DEFAULTS.discoveryIntervalMs,
  } = opts;

  /** @type {string | null} */
  let resolvedWebsiteId = opts.websiteId || null;
  let lastDiscoveryAttempt = 0;

  function api(path, init = {}) {
    return fetchImpl(`${url.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
  }

  /** Logs in and returns a bearer-token header value, or null. */
  async function authHeaders() {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: adminUser, password: adminPassword }),
    });
    if (!login.ok) return null;
    const { token } = await login.json();
    return token ? { Authorization: `Bearer ${token}` } : null;
  }

  /** Finds or creates the website and returns its id, or null on any failure. */
  async function discoverWebsiteId() {
    try {
      const auth = await authHeaders();
      if (!auth) {
        log.warn("umami_discovery_failed", { reason: "login failed (admin password changed?)" });
        return null;
      }

      const list = await api("/api/websites?pageSize=100", { headers: auth });
      if (!list.ok) {
        log.warn("umami_discovery_failed", { reason: `list websites: HTTP ${list.status}` });
        return null;
      }
      const { data = [] } = await list.json();
      const existing = data.find((w) => w.name === websiteName);
      if (existing?.id) {
        log.info("umami_website_resolved", { websiteId: existing.id, created: false });
        return existing.id;
      }

      const created = await api("/api/websites", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: websiteName, domain: websiteDomain }),
      });
      if (!created.ok) {
        log.warn("umami_discovery_failed", { reason: `create website: HTTP ${created.status}` });
        return null;
      }
      const website = await created.json();
      log.info("umami_website_resolved", { websiteId: website.id, created: true });
      return website.id ?? null;
    } catch (e) {
      log.warn("umami_discovery_failed", { err: String(e) });
      return null;
    }
  }

  /**
   * @param {string} name
   * @param {Record<string, string | number | boolean>} [data]
   * @returns {Promise<boolean>} whether the event was accepted
   */
  async function track(name, data) {
    if (!enabled || !url) {
      return false;
    }

    if (!resolvedWebsiteId) {
      const now = nowImpl();
      if (now - lastDiscoveryAttempt < discoveryIntervalMs) {
        return false;
      }
      lastDiscoveryAttempt = now;
      resolvedWebsiteId = await discoverWebsiteId();
      if (!resolvedWebsiteId) {
        return false;
      }
    }

    try {
      // The UA must look like a browser: Umami silently drops ("beep boop")
      // any User-Agent its isbot check dislikes, including custom ones.
      const res = await fetchImpl(`${url.replace(/\/$/, "")}/api/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) TronVoltService/1.0",
          "x-umami-website-id": resolvedWebsiteId,
          "x-umami-hostname": hostname,
        },
        body: JSON.stringify({
          type: "event",
          payload: {
            website: resolvedWebsiteId,
            hostname,
            name,
            ...(data ? { data } : {}),
          },
        }),
      });
      return res.ok;
    } catch (e) {
      log.warn("umami_send_failed", { name, err: String(e) });
      return false;
    }
  }

  return { track };
}

/** Default tracker: env overrides on top of the zero-config defaults. */
export const umami = createUmamiTracker({
  enabled: (process.env.UMAMI_ENABLED ?? "").toLowerCase() === "true",
  url: process.env.UMAMI_URL || DEFAULTS.url,
  websiteId: process.env.UMAMI_WEBSITE_ID || undefined,
  hostname: process.env.UMAMI_HOSTNAME || DEFAULTS.hostname,
  adminUser: process.env.UMAMI_ADMIN_USER || DEFAULTS.adminUser,
  adminPassword: process.env.UMAMI_ADMIN_PASSWORD || DEFAULTS.adminPassword,
});
