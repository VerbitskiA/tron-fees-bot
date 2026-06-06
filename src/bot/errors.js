import { TronFeesApiError } from "../api/tronFeesClient.js";

/**
 * @param {unknown} err
 */
export function formatUserError(err) {
  if (err instanceof TronFeesApiError) {
    if (err.status === 401 || err.status === 500) {
      return "Service is temporarily unavailable. Please contact the administrator.";
    }
    if (err.status === 404) {
      return "Record not found. Run /start to register.";
    }
    if (err.status === 400) {
      return err.detail ?? "Invalid request parameters.";
    }
    return err.detail ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again later.";
}
