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
| `catFeeOrderReference` | string \| null | id заказа в CatFee при успехе |
| `delegationRecipientTronAddress` | string | адрес получателя |
| `payAmount` | decimal \| null | сумма оплаты |
| `payCurrency` | string \| null | валюта |
| `paymentReceivedAt` | string (ISO 8601) \| null | когда зафиксирована оплата |
| `executedAt` | string (ISO 8601) \| null | когда делегация завершена успешно |

**Когда backend шлёт `Executed`:** CatFee вернул `code: 0` и `data.status` вроде **`PAYMENT_SUCCESS`**.  
**Когда шлёт `Failed`:** любой другой ответ CatFee или сбой HTTP/валидации.

Эндпоинты бота: `POST /webhooks/delegation-order`, `GET /health`.

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
| `role` | string | **`User`** или **`Affiliate`** |
| `referralCode` | string \| null | код без префикса `aff_` (только для аффилиата) |
| `referralTelegramUrl` | string \| null | полная ссылка для шаринга в Telegram; **`null`**, если не аффилиат, нет кода или не задан `TelegramBotUsername` |

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

### Ответ 200 (структура)

| Поле | Тип | Описание |
|------|-----|----------|
| `delegationEnergyQuantity` | long | эхо запроса |
| `delegationDurationHours` | int | эхо запроса |
| `providerCostSun` | long | себестоимость в SUN |
| `marginSun` | long | маржа в SUN |
| `clientPriceSun` | long | цена клиенту в SUN |
| `providerCostTrx` | decimal | в TRX |
| `clientPriceTrx` | decimal | в TRX |
| `invoicePriceCurrency` | string | валюта счёта NOWPayments |

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
| `payAmount` | decimal | сумма к оплате |
| `payCurrency` | string | валюта (например `trx`) |

### Ошибки

| Код | Когда |
|-----|--------|
| **404** | пользователь с таким `telegramUserId` не найден (не зарегистрирован) |
| **400** | невалидные поля (длительность, количество, пустой адрес) |
| **500** | не настроен IPN для NOWPayments — в теле Problem JSON с полем `detail` (нужны `NowPayments:CallbackUrl` или `Api:PublicBaseUrl`) |

Оплата и дальнейший сценарий выполняются через NOWPayments; бот обычно показывает пользователю `payAddress`, `payAmount`, `payCurrency`.

---

## 6. Реферальная статистика (пригласивший)

**`GET /api/admin/users/by-telegram/{telegramUserId}/referrer-statistics`** (нужен `X-Api-Key`)

`telegramUserId` в пути — числовой Telegram ID того пользователя, **чья** статистика как у **инвайтера** (пригласившего).

### Ответ 200

| Поле | Тип | Описание |
|------|-----|----------|
| `invitedUserCount` | int | сколько пользователей зарегистрировалось с привязкой к этому инвайтеру |
| `referralRewardCreditCount` | int | сколько раз начислялась реферальная награда |
| `totalReferralRewardSun` | long | сумма начисленных наград в SUN (**1 TRX = 1_000_000 SUN**) |

### Ошибки

**404** — пользователя с таким Telegram ID нет в системе.

---

## 7. Админ: роль аффилиата (опционально)

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

## 8. Админ: политика вознаграждения реферера (опционально)

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
5. Создание оплаты — **`POST /api/energy-delegation/orders`** с **`telegramUserId`** = текущий Telegram ID пользователя.
6. Экран «мои рефералы» для блогера — **`GET /api/admin/users/by-telegram/{telegramUserId}/referrer-statistics`**.

---

## Swagger (Development)

В окружении **Development** доступны **Swagger UI** и OpenAPI (обычно `/swagger`) с описанием схем и авторизацией по **`X-Api-Key`** — удобно для отладки с тем же ключом, что использует бот.
