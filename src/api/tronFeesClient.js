import { log } from "../logger.js";

export class TronFeesApiError extends Error {
  /** @param {number} status */
  constructor(status, message, detail) {
    super(message);
    this.name = "TronFeesApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * @param {unknown} body
 * @returns {string | undefined}
 */
function readDetail(body) {
  if (body && typeof body === "object") {
    const d = /** @type {Record<string, unknown>} */ (body).detail;
    if (typeof d === "string") return d;
    const m = /** @type {Record<string, unknown>} */ (body).message;
    if (typeof m === "string") return m;
    const title = /** @type {Record<string, unknown>} */ (body).title;
    if (typeof title === "string") return title;
  }
  return undefined;
}

/**
 * @param {{ baseUrl: string; apiKey: string }} opts
 */
export function createTronFeesClient({ baseUrl, apiKey }) {
  const root = baseUrl.replace(/\/$/, "");

  /**
   * @param {string} pathWithQuery
   * @param {{ method?: string; body?: unknown }} [options]
   */
  async function request(pathWithQuery, options = {}) {
    const { method = "GET", body } = options;
    const url = `${root}${pathWithQuery}`;
    /** @type {RequestInit} */
    const init = {
      method,
      headers: {
        "X-Api-Key": apiKey,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(url, init);
    const text = await res.text();
    /** @type {unknown} */
    let json;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }

    if (!res.ok) {
      const detail = readDetail(json) ?? text?.slice(0, 500) ?? res.statusText;
      const msg = `API ${res.status}: ${detail}`;
      log.warn("api_error", { url, status: res.status, detail });
      throw new TronFeesApiError(res.status, msg, detail);
    }

    if (res.status === 204) return undefined;
    return json;
  }

  return {
    /**
     * @param {{
     *   telegramId: number;
     *   invitedByTelegramId?: number | null;
     *   telegramUsername?: string | null;
     *   referralStartPayload?: string | null;
     * }} payload
     */
    async registerUser(payload) {
      return /** @type {Promise<{ userId: string }>} */ (
        request("/api/users/register", {
          method: "POST",
          body: {
            telegramId: payload.telegramId,
            invitedByTelegramId: payload.invitedByTelegramId ?? null,
            telegramUsername: payload.telegramUsername ?? null,
            referralStartPayload: payload.referralStartPayload ?? null,
          },
        })
      );
    },

    /**
     * @param {{ userId: string; tronAddress: string }} payload
     */
    async bindTronAddress(payload) {
      await request("/api/users/addresses", {
        method: "POST",
        body: payload,
      });
    },

    /**
     * @param {{ delegationEnergyQuantity: number; delegationDurationHours: number }} q
     */
    async getPricingEstimate(q) {
      const params = new URLSearchParams({
        delegationEnergyQuantity: String(q.delegationEnergyQuantity),
        delegationDurationHours: String(q.delegationDurationHours),
      });
      return /** @type {Promise<PricingEstimate>} */ (
        request(`/api/energy-delegation/pricing-estimate?${params}`)
      );
    },

    /**
     * @param {{
     *   telegramUserId: number;
     *   delegationEnergyQuantity: number;
     *   delegationDurationHours: number;
     *   delegationRecipientTronAddress: string;
     * }} payload
     */
    async createEnergyOrder(payload) {
      return /** @type {Promise<EnergyOrderResponse>} */ (
        request("/api/energy-delegation/orders", {
          method: "POST",
          body: payload,
        })
      );
    },

    /**
     * @param {number} telegramUserId
     */
    async getReferrerStatistics(telegramUserId) {
      return /** @type {Promise<ReferrerStatistics>} */ (
        request(
          `/api/admin/users/by-telegram/${telegramUserId}/referrer-statistics`,
        )
      );
    },
  };
}

/**
 * @typedef {{
 *   delegationEnergyQuantity: number;
 *   delegationDurationHours: number;
 *   providerCostSun: number;
 *   marginSun: number;
 *   clientPriceSun: number;
 *   providerCostTrx: number | string;
 *   clientPriceTrx: number | string;
 *   invoicePriceCurrency: string;
 * }} PricingEstimate
 */

/**
 * @typedef {{
 *   orderId: string;
 *   nowPaymentsPaymentId: string;
 *   payAddress: string;
 *   payAmount: number | string;
 *   payCurrency: string;
 * }} EnergyOrderResponse
 */

/**
 * @typedef {{
 *   invitedUserCount: number;
 *   referralRewardCreditCount: number;
 *   totalReferralRewardSun: number;
 * }} ReferrerStatistics
 */

/** @typedef {ReturnType<typeof createTronFeesClient>} TronFeesApi */
