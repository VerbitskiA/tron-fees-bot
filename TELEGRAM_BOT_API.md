# HTTP API для Telegram-бота (TronFees Backend)

Базовый URL API https://tron-fees-api.tronpay.me. Все пути ниже относительно этого префикса.

## Аутентификация

Почти все запросы (кроме перечисленных в разделе «Без ключа») требуют заголовок:

- **`X-Api-Key`** — значение из конфигурации `Api:ServiceApiKey` (часто задаётся через переменную окружения `TRONFEES_SERVICE_API_KEY`).

При неверном или отсутствующем ключе: **401 Unauthorized**.  
Если ключ в конфиге не задан: **500** с текстом про `ServiceApiKey`.

### Без ключа (middleware пропускает)

- `GET /health` — проверка живости.
- `GET /swagger/...` — только в окружении **Development**.
- `POST /api/webhooks/nowpayments/...` — вебхук NOWPayments (бот сюда не ходит).

Везде, где нужен ключ, бот должен отправлять `X-Api-Key` на каждый запрос.

### Ссылка-приглашение в Telegram (рефералы)

**Реферальная программа открыта для всех**: каждый новый пользователь при регистрации автоматически получает роль `Affiliate` и реферальный код. Награда начисляется за каждый оплаченный заказ приглашённого (по умолчанию 50% маржи заказа) и **тратится как скидка на собственные заказы** (до 80% цены заказа, см. `rewardDiscountSun` / `availableRewardBalanceSun` в разделах ниже). Фактическое списание происходит только после подтверждения оплаты заказа.

Чтобы в ответах появлялось поле **`referralTelegramUrl`** (полная ссылка `https://t.me/<бот>?start=aff_...`), на бэкенде должен быть задан **username бота без `@`**:

- переменная окружения **`TRONFEES_TELEGRAM_BOT_USERNAME`**, или
- конфигурация **`Api:TelegramBotUsername`**.

Если значение пустое, `referralTelegramUrl` в JSON будет **`null`**, при этом **`referralCode`** и **`deepLinkSuffix`** по-прежнему возвращаются там, где применимо.

### Webhook результата делегации (backend → Node.js бот)

После оплаты и попытки делегации в CatFee backend может отправить **исходящий POST** в бот (если включено):

| Переменная (backend) | Переменная (бот) | Описание |
|----------------------|------------------|----------|
| `TRONFEES_BOT_WEBHOOK_ENABLED` | `WEBHOOK_ENABLED` | `true` / `false` |
| `TRONFEES_BOT_WEBHOOK_URL` | — | URL эндпоинта бота, например `https://bot.host/webhooks/delegation-order` |
| `TRONFEES_BOT_WEBHOOK_SECRET` | `WEBHOOK_SECRET` | общий секрет; backend шлёт заголовок **`X-Webhook-Secret`** |

Бот принимает JSON (camelCase) и отправляет пользователю сообщение в Telegram. Поля payload:

| Поле | Тип | Описание |
|------|-----|----------|
| `eventId` | GUID | идемпотентность (дедупликация повторов в in-memory TTL cache) |
| `orderId` | GUID | заказ делегации |
| `telegramUserId` | long | кому писать в Telegram |
| `status` | string | **`Executed`** или **`Failed`** |
| `failureCode` | string \| null | код CatFee (например `201`) или `HTTP` / `PROVIDER` |
| `failureReason` | string \| null | текст ошибки |
| `catFeeOrderReference` | string \| null | id заказа в CatFee (бот в UI не показывает) |
| `delegationRecipientTronAddress` | string | адрес получателя |
| `payAmount` | decimal \| null | сумма оплаты |
| `payCurrency` | string \| null | валюта |
| `rewardDiscountSun` | long \| null | реферальная скидка, применённая к этому заказу, в SUN |
| `paymentReceivedAt` | string (ISO 8601) \| null | когда зафиксирована оплата |
| `executedAt` | string (ISO 8601) \| null | когда делегация завершена успешно |

**Когда backend шлёт `Executed`:** CatFee вернул `code: 0` и `data.status` вроде **`PAYMENT_SUCCESS`** (успешный старт делегации; `confirm_status` может быть `UNCONFIRMED`).  
**Когда шлёт `Failed`:** любой другой ответ CatFee (`code != 0`, пустой `data`, статус не успешный) или сбой HTTP/валидации.

## Формат запросов и ответов

- Тело запросов: **`Content-Type: application/json`**.
- Ответы: JSON (кроме **204 No Content**).
- Имена полей в JSON — **camelCase** (стандарт ASP.NET Core для POCO/record).

---

## 1. Регистрация пользователя

**`POST /api/users/register`** (нужен `X-Api-Key`)

### Тело запроса

| Поле | Тип | Обязательно | Описание |
|------|-----|---------------|----------|
| `telegramId` | number (int64) | да | ID пользователя в Telegram |
| `invitedByTelegramId` | number \| null | нет | Telegram ID пригласившего (если известен) |
| `telegramUsername` | string \| null | нет | username без `@` или как пришлёт Telegram API |
| `referralStartPayload` | string \| null | нет | сырое значение из deep link `?start=` (например `aff_8F92K`); при разборе реферала имеет приоритет над `invitedByTelegramId` |

### Поведение

Если пользователь с таким `telegramId` уже зарегистрирован, возвращается тот же внутренний `userId` (идемпотентность).

### Ответ 200

```json
{ "userId": "<guid>" }
```

Внутренний **`userId` (GUID)** рекомендуется **сохранить** (например в БД бота): он нужен для **`POST /api/users/addresses`**, пока этот эндпоинт принимает только GUID, а не Telegram ID.

---

## 2. Профиль пользователя (me)

**`GET /api/users/me/by-telegram/{telegramUserId}`** (нужен `X-Api-Key`)

`telegramUserId` в пути — Telegram ID пользователя (как правило, текущий пользователь бота).

### Ответ 200

| Поле | Тип | Описание |
|------|-----|----------|
| `userId` | GUID | внутренний идентификатор |
| `telegramId` | long | Telegram ID |
| `telegramUsername` | string \| null | сохранённый username |
| `registeredAt` | string (ISO 8601) | время регистрации |
| `role` | string | **`User`** или **`Affiliate`**; с открытием рефералки для всех новые пользователи сразу получают **`Affiliate`** |
| `referralCode` | string \| null | код без префикса `aff_` (выдаётся автоматически при регистрации) |
| `referralTelegramUrl` | string \| null | полная ссылка для шаринга в Telegram; **`null`**, если нет кода или не задан `TelegramBotUsername` |

### Ошибки

**404** — пользователь с таким Telegram ID не найден.

---

## 3. Привязка TRON-адреса

**`POST /api/users/addresses`** (нужен `X-Api-Key`)

### Тело запроса

| Поле | Тип | Описание |
|------|-----|----------|
| `userId` | string (GUID) | из ответа регистрации |
| `tronAddress` | string | адрес получателя в сети TRON |

### Ответ

**204 No Content** — без тела.

---

## 4. Оценка цены делегации энергии

**`GET /api/energy-delegation/pricing-estimate`** (нужен `X-Api-Key`)

### Query-параметры

| Параметр | Тип | Описание |
|----------|-----|----------|
| `delegationEnergyQuantity` | long | объём энергии (CatFee quantity), **> 0** |
| `delegationDurationHours` | int | длительность в часах, **≥ 1** |
| `telegramUserId` | long (опционально) | Telegram ID пользователя; добавляет в ответ поля реферального баланса и цены со скидкой |

### Ответ 200 (структура)

| Поле | Тип | Описание |
|------|-----|----------|
| `delegationEnergyQuantity` | long | эхо запроса |
| `delegationDurationHours` | int | эхо запроса |
| `providerCostSun` | long | себестоимость в SUN |
| `marginSun` | long | маржа в SUN |
| `clientPriceSun` | long | цена клиенту в SUN (без учёта реферальной скидки) |
| `providerCostTrx` | decimal | в TRX |
| `clientPriceTrx` | decimal | в TRX |
| `invoicePriceCurrency` | string | валюта счёта NOWPayments |
| `availableRewardBalanceSun` | long | доступный реферальный баланс в SUN (**0**, если `telegramUserId` не передан) |
| `rewardDiscountSun` | long | скидка реферальными наградами, которая будет применена к заказу, в SUN |
| `discountedClientPriceSun` | long \| null | цена к оплате с учётом скидки; **null**, если скидка нулевая |

### Ошибки

**400** — неверные параметры (неположительная энергия или длительность меньше 1 часа).

---

## 5. Создание заказа делегации (инвойс NOWPayments)

**`POST /api/energy-delegation/orders`** (нужен `X-Api-Key`)

### Тело запроса

| Поле | Тип | Описание |
|------|-----|----------|
| `telegramUserId` | long | Telegram ID пользователя (**должен** быть зарегистрирован через `POST /api/users/register`) |
| `delegationEnergyQuantity` | long | **> 0** |
| `delegationDurationHours` | int | **≥ 1** |
| `delegationRecipientTronAddress` | string | TRON-адрес, на который делегируется энергия |

### Ответ 200

| Поле | Тип | Описание |
|------|-----|----------|
| `orderId` | GUID | внутренний идентификатор заказа |
| `nowPaymentsPaymentId` | string | идентификатор платежа NOWPayments |
| `payAddress` | string | адрес для оплаты |
| `payAmount` | decimal | сумма к оплате (**уже с учётом** реферальной скидки) |
| `payCurrency` | string | валюта (например `trx`) |
| `rewardDiscountSun` | long | применённая реферальная скидка в SUN (**0**, если наград не было) |

### Ошибки

| Код | Когда |
|-----|--------|
| **404** | пользователь с таким `telegramUserId` не найден (не зарегистрирован) |
| **400** | невалидные поля (длительность, количество, пустой адрес) |
| **500** | не настроен IPN для NOWPayments — в теле Problem JSON с полем `detail` (нужны `NowPayments:CallbackUrl` или `Api:PublicBaseUrl`) |

Оплата и дальнейший сценарий выполняются через NOWPayments; бот обычно показывает пользователю `payAddress`, `payAmount`, `payCurrency`.

Оплата и дальнейший сценарий выполняются через NOWPayments; бот обычно показывает пользователю `payAddress`, `payAmount`, `payCurrency`. После оплаты итог приходит через **webhook backend → бот** (см. выше) или через опрос статуса заказа.

---

## 6. Статус заказа делегации (fallback)

**`GET /api/energy-delegation/orders/{orderId}`** (нужен `X-Api-Key`)

Используйте, если webhook не дошёл или нужно обновить UI по `orderId` из ответа создания заказа.

### Ответ 200

| Поле | Тип | Описание |
|------|-----|----------|
| `orderId` | GUID | идентификатор заказа |
| `userId` | GUID | внутренний пользователь |
| `status` | string | `Created`, `Paid`, `Executed`, `Failed`, `Expired` (неоплачен дольше 24 ч) |
| `failureCode` | string \| null | при `Failed` |
| `failureReason` | string \| null | при `Failed` |
| `catFeeOrderReference` | string \| null | id в CatFee при успехе |
| `delegationRecipientTronAddress` | string | TRON-адрес |
| `payAmount` | decimal \| null | из платежа |
| `payCurrency` | string \| null | из платежа |
| `rewardDiscountSun` | long \| null | применённая реферальная скидка в SUN |
| `paymentReceivedAt` | string (ISO 8601) \| null | время оплаты |
| `executedAt` | string (ISO 8601) \| null | время успешной делегации |
| `lastStatusChangedAt` | string (ISO 8601) \| null | последнее изменение статуса |

### Ошибки

**404** — заказ не найден.

---

## 7. Реферальная статистика (пригласивший)

**`GET /api/admin/users/by-telegram/{telegramUserId}/referrer-statistics`** (нужен `X-Api-Key`)

`telegramUserId` в пути — числовой Telegram ID того пользователя, **чья** статистика как у **инвайтера** (пригласившего).

### Ответ 200

| Поле | Тип | Описание |
|------|-----|----------|
| `invitedUserCount` | int | сколько пользователей зарегистрировалось с привязкой к этому инвайтеру |
| `referralRewardCreditCount` | int | сколько раз начислялась реферальная награда |
| `totalReferralRewardSun` | long | сумма начисленных наград в SUN (**1 TRX = 1_000_000 SUN**) |
| `availableRewardBalanceSun` | long | доступный баланс наград (начислено минус потрачено на скидки) в SUN |

### Ошибки

**404** — пользователя с таким Telegram ID нет в системе.

---

## 8. Админ: роль аффилиата (опционально)

**`POST /api/admin/users/{userId}/affiliate`** (нужен `X-Api-Key`)

`userId` в пути — **GUID** из ответа регистрации (не Telegram ID).

### Тело (опционально)

```json
{ "requestedReferralCode": "ABC12" }
```

Если код не передан — генерируется автоматически.

### Ответы

| Код | Тело / смысл |
|-----|----------------|
| **200** | `{ "referralCode": "...", "deepLinkSuffix": "aff_...", "referralTelegramUrl": "https://t.me/..." \| null }` — `referralTelegramUrl` заполняется при настроенном `TelegramBotUsername` |
| **404** | пользователь не найден |
| **409** | `{ "message": "Referral code is already in use." }` |
| **400** | невалидный запрошенный код (Problem JSON) |

---

## 9. Админ: политика вознаграждения реферера (опционально)

**`PUT /api/admin/referrer-reward-policies/{referrerUserId}`** (нужен `X-Api-Key`)

`referrerUserId` в пути — **GUID** пользователя-реферера.

### Тело

| Поле | Тип | Описание |
|------|-----|----------|
| `rewardMode` | string | **`PercentOfMargin`** или **`FixedSun`** |
| `marginPercent` | int? | для режима процента от маржи |
| `fixedRewardSun` | long? | для фиксированной награды в SUN |

### Ответы

| Код | Смысл |
|-----|--------|
| **204** | политика сохранена |
| **400** | неверный `rewardMode` или параметры политики (текст в `detail`) |

---

## Рекомендуемый поток для бота

1. При `/start` (и при необходимости повторно) — **`POST /api/users/register`** с `telegramId`; при наличии реферала — `referralStartPayload` или `invitedByTelegramId`. Сохранить **`userId`**.
2. Для экрана «профиль / реферальная ссылка» — **`GET /api/users/me/by-telegram/{telegramUserId}`**.
3. При сохранении кошелька пользователя — **`POST /api/users/addresses`** с сохранённым `userId`.
4. Перед покупкой энергии — **`GET /api/energy-delegation/pricing-estimate`**.
5. Создание оплаты — **`POST /api/energy-delegation/orders`** с **`telegramUserId`** = текущий Telegram ID пользователя. Сохранить **`orderId`**.
6. После оплаты — дождаться **webhook** на бот (`Executed` / `Failed`) или периодически опрашивать **`GET /api/energy-delegation/orders/{orderId}`**.
7. Экран «мои рефералы» для блогера — **`GET /api/admin/users/by-telegram/{telegramUserId}/referrer-statistics`**.

---

## Swagger (Development)

В окружении **Development** доступны **Swagger UI** и OpenAPI (обычно `/swagger`) с описанием схем и авторизацией по **`X-Api-Key`** — удобно для отладки с тем же ключом, что использует бот.
