import { TronFeesApiError } from "../api/tronFeesClient.js";

/**
 * @param {unknown} err
 */
export function formatUserError(err) {
  if (err instanceof TronFeesApiError) {
    if (err.status === 401 || err.status === 500) {
      return "Сервис временно недоступен. Обратитесь к администратору.";
    }
    if (err.status === 404) {
      return "Запись не найдена. Выполните /start для регистрации.";
    }
    if (err.status === 400) {
      return err.detail ?? "Неверные параметры запроса.";
    }
    return err.detail ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "Произошла ошибка. Попробуйте позже.";
}
