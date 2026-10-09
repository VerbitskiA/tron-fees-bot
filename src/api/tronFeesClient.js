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
     * @param {{
     *   delegationEnergyQuantity: number;
     *   delegationDurationHours: number;
     *   telegramUserId?: number;
     * }} q
     */
    async getPricingEstimate(q) {
      const params = new URLSearchParams({
        delegationEnergyQuantity: String(q.delegationEnergyQuantity),
        delegationDurationHours: String(q.delegationDurationHours),
      });
      if (q.telegramUserId != null) {
        params.set("telegramUserId", String(q.telegramUserId));
      }
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
    async getMeByTelegram(telegramUserId) {
      return /** @type {Promise<UserMeProfile>} */ (
        request(`/api/users/me/by-telegram/${telegramUserId}`)
      );
    },

    /**
     * CatFee provider balance (for low-balance monitoring).
     * @returns {Promise<{ balanceSun: number; balanceTrx: number }>}
     */
    async getCatFeeBalance() {
      return /** @type {Promise<{ balanceSun: number; balanceTrx: number }>} */ (
        request("/api/admin/catfee/balance")
      );
    },

    /**
     * @param {{ name: string; contact?: string | null; contactTelegramId: number; webhookUrl?: string | null }} payload
     */
    async createPartner(payload) {
      return /** @type {Promise<PartnerCreated>} */ (
        request("/api/admin/partners", {
          method: "POST",
          body: {
            name: payload.name,
            contact: payload.contact ?? null,
            contactTelegramId: payload.contactTelegramId,
            status: "Pending",
            webhookUrl: payload.webhookUrl ?? null,
          },
        })
      );
    },

    async listPartners() {
      return /** @type {Promise<PartnerListItem[]>} */ (
        request("/api/admin/partners")
      );
    },

    /**
     * @param {string} partnerId
     */
    async approvePartner(partnerId) {
      return request(`/api/admin/partners/${partnerId}/approve`, { method: "POST" });
    },

    /** @param {string} partnerId */
    async rejectPartner(partnerId) {
      return request(`/api/admin/partners/${partnerId}/reject`, { method: "POST" });
    },

    /** @param {string} partnerId */
    async issuePartnerKey(partnerId) {
      return /** @type {Promise<{ apiKeyId: string; key: string }>} */ (
        request(`/api/admin/partners/${partnerId}/keys`, { method: "POST" })
      );
    },

    /** @param {string} partnerId */
    async partnerWebhookSecret(partnerId) {
      return /** @type {Promise<{ webhookSecret: string }>} */ (
        request(`/api/admin/partners/${partnerId}/webhook-secret`)
      );
    },

    /** @param {string} partnerId */
    async partnerBalance(partnerId) {
      return /** @type {Promise<PartnerBalance>} */ (
        request(`/api/admin/partners/${partnerId}/balance`)
      );
    },

    /**
     * @param {string} partnerId
     * @param {number} amountTrx
     */
    async createPartnerTopUpInvoice(partnerId, amountTrx) {
      return /** @type {Promise<TopUpInvoice>} */ (
        request(`/api/admin/partners/${partnerId}/top-up-invoices`, {
          method: "POST",
          body: { amountTrx },
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
 *   availableRewardBalanceSun?: number;
 *   rewardDiscountSun?: number;
 *   discountedClientPriceSun?: number | null;
 * }} PricingEstimate
 */

/**
 * @typedef {{
 *   orderId: string;
 *   nowPaymentsPaymentId: string;
 *   payAddress: string;
 *   payAmount: number | string;
 *   payCurrency: string;
 *   rewardDiscountSun?: number;
 * }} EnergyOrderResponse
 */

/**
 * @typedef {{
 *   invitedUserCount: number;
 *   referralRewardCreditCount: number;
 *   totalReferralRewardSun: number;
 *   availableRewardBalanceSun?: number;
 * }} ReferrerStatistics
 */

/**
 * @typedef {{
 *   userId: string;
 *   telegramId: number;
 *   telegramUsername: string | null;
 *   registeredAt: string;
 *   role: string;
 *   referralCode: string | null;
 *   referralTelegramUrl: string | null;
 * }} UserMeProfile
 */

/** @typedef {ReturnType<typeof createTronFeesClient>} TronFeesApi */

/**
 * @typedef {{
 *   partnerId: string;
 *   apiKeyId: string;
 *   apiKey: string;
 * }} PartnerCreated
 */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   contact: string | null;
 *   contactTelegramId: number | null;
 *   status: string;
 *   webhookUrl: string | null;
 *   createdAt: string;
 *   apiKeys: {{ id: string; prefix: string; status: string; createdAt: string; lastUsedAt: string | null }[];
 * }} PartnerListItem
 */

/**
 * @typedef {{
 *   availableSun: number;
 *   heldSun: number;
 *   totalSun: number;
 *   availableTrx: number;
 *   heldTrx: number;
 *   totalTrx: number;
 * }} PartnerBalance
 */

/**
 * @typedef {{
 *   invoiceId: string;
 *   paymentId: string;
 *   payAddress: string;
 *   payAmount: number | string;
 *   payCurrency: string;
 *   creditSun: number;
 * }} TopUpInvoice
 */
