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

## 2. Привязка TRON-адреса

**`POST /api/users/addresses`** (нужен `X-Api-Key`)

### Тело запроса

| Поле | Тип | Описание |
|------|-----|----------|
| `userId` | string (GUID) | из ответа регистрации |
| `tronAddress` | string | адрес получателя в сети TRON |

### Ответ

**204 No Content** — без тела.

---

## 3. Оценка цены делегации энергии

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

## 4. Создание заказа делегации (инвойс NOWPayments)

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

## 5. Реферальная статистика (пригласивший)

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

## 6. Админ: роль аффилиата (опционально)

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
| **200** | `{ "referralCode": "...", "deepLinkSuffix": "aff_..." }` |
| **404** | пользователь не найден |
| **409** | `{ "message": "Referral code is already in use." }` |
| **400** | невалидный запрошенный код (Problem JSON) |

---

## 7. Админ: политика вознаграждения реферера (опционально)

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
2. При сохранении кошелька пользователя — **`POST /api/users/addresses`** с сохранённым `userId`.
3. Перед покупкой энергии — **`GET /api/energy-delegation/pricing-estimate`**.
4. Создание оплаты — **`POST /api/energy-delegation/orders`** с **`telegramUserId`** = текущий Telegram ID пользователя.
5. Экран «мои рефералы» для блогера — **`GET /api/admin/users/by-telegram/{telegramUserId}/referrer-statistics`**.

---

## Swagger (Development)

В окружении **Development** доступны **Swagger UI** и OpenAPI (обычно `/swagger`) с описанием схем и авторизацией по **`X-Api-Key`** — удобно для отладки с тем же ключом, что использует бот.
