import { BRAND_NAME } from "../bot/brand.js";
import { formatTrx } from "../bot/format.js";

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SUPPORT_HANDLE = "@tron_volt_support";

/**
 * @param {import("./validatePayload.js").DelegationOrderWebhookPayload} p
 * @returns {{ text: string; parse_mode: "HTML" }}
 */
export function buildDelegationOrderStatusMessage(p) {
  if (p.status === "Executed") {
    const lines = [
      "<b>Energy delegated successfully</b>",
      "",
      `Address: ${escapeHtml(p.delegationRecipientTronAddress)}`,
    ];

    if (p.payAmount != null && p.payCurrency) {
      lines.push(
        `Amount: ${escapeHtml(formatTrx(p.payAmount))} ${escapeHtml(p.payCurrency.toUpperCase())}`,
      );
    }

    if (p.catFeeOrderReference) {
      lines.push(`Provider ref: <code>${escapeHtml(p.catFeeOrderReference)}</code>`);
    }

    lines.push("", `Order ID: <code>${escapeHtml(p.orderId)}</code>`);
    return { text: lines.join("\n"), parse_mode: "HTML" };
  }

  if (p.status === "Failed") {
    const reason = humanFailureReason(p);
    const lines = [
      "<b>Order could not be completed</b>",
      "",
      `Reason: ${escapeHtml(reason)}`,
      "",
      `Order ID: <code>${escapeHtml(p.orderId)}</code>`,
      "",
      `Contact ${SUPPORT_HANDLE} if you need help.`,
    ];
    return { text: lines.join("\n"), parse_mode: "HTML" };
  }

  return {
    text: [
      `<b>${escapeHtml(BRAND_NAME)} order update</b>`,
      "",
      `Status: ${escapeHtml(p.status)}`,
      `Order ID: <code>${escapeHtml(p.orderId)}</code>`,
    ].join("\n"),
    parse_mode: "HTML",
  };
}

/**
 * @param {import("./validatePayload.js").DelegationOrderWebhookPayload} p
 */
function humanFailureReason(p) {
  if (p.failureReason) return p.failureReason;

  switch (p.failureCode) {
    case "201":
      return "The energy provider could not process the order. This is not your fault — please contact support.";
    case "HTTP":
      return "A network error occurred while contacting the energy provider.";
    case "PROVIDER":
      return "The energy provider returned an unexpected response.";
    default:
      return "An unexpected error occurred while processing your order.";
  }
}
