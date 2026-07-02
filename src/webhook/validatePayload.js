/**
 * @typedef {{
 *   eventId: string;
 *   orderId: string;
 *   telegramUserId: number;
 *   status: string;
 *   failureCode: string | null;
 *   failureReason: string | null;
 *   catFeeOrderReference: string | null;
 *   delegationRecipientTronAddress: string;
 *   delegationEnergyQuantity: number | null;
 *   delegationDurationHours: number | null;
 *   payAmount: number | string | null;
 *   payCurrency: string | null;
 *   paymentReceivedAt: string | null;
 *   executedAt: string | null;
 * }} DelegationOrderWebhookPayload
 */

/**
 * @param {unknown} body
 * @returns {{ ok: true; payload: DelegationOrderWebhookPayload } | { ok: false; error: string }}
 */
export function validateDelegationOrderPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "JSON body must be an object" };
  }

  const o = /** @type {Record<string, unknown>} */ (body);
  const eventId = readNonEmptyString(o.eventId);
  const orderId = readNonEmptyString(o.orderId);
  const telegramUserId = readTelegramUserId(o.telegramUserId);
  const status = readNonEmptyString(o.status);
  const delegationRecipientTronAddress = readNonEmptyString(o.delegationRecipientTronAddress);

  if (!eventId) return { ok: false, error: "eventId is required" };
  if (!orderId) return { ok: false, error: "orderId is required" };
  if (telegramUserId == null) return { ok: false, error: "telegramUserId is required" };
  if (!status) return { ok: false, error: "status is required" };
  if (!delegationRecipientTronAddress) {
    return { ok: false, error: "delegationRecipientTronAddress is required" };
  }

  return {
    ok: true,
    payload: {
      eventId,
      orderId,
      telegramUserId,
      status,
      failureCode: readOptionalString(o.failureCode),
      failureReason: readOptionalString(o.failureReason),
      catFeeOrderReference: readOptionalString(o.catFeeOrderReference),
      delegationRecipientTronAddress,
      delegationEnergyQuantity: readOptionalPositiveInt(o.delegationEnergyQuantity),
      delegationDurationHours: readOptionalPositiveInt(o.delegationDurationHours),
      payAmount: readOptionalNumber(o.payAmount),
      payCurrency: readOptionalString(o.payCurrency),
      paymentReceivedAt: readOptionalString(o.paymentReceivedAt),
      executedAt: readOptionalString(o.executedAt),
    },
  };
}

/** @param {unknown} v */
function readNonEmptyString(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** @param {unknown} v */
function readOptionalString(v) {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/** @param {unknown} v */
function readTelegramUserId(v) {
  const n = typeof v === "string" ? Number(v) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** @param {unknown} v */
function readOptionalPositiveInt(v) {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** @param {unknown} v */
function readOptionalNumber(v) {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}
