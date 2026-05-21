# binance-alpha-tracker

Слухає Tenderly webhook про виклики `setPoolStartedTimestamp(bytes32, uint256)` на контракті пулів Binance Alpha. Декодує `poolId` + `start timestamp`, конвертує в Київський час, шле повідомлення в один або кілька Telegram-чатів.

При повторних викликах того ж `poolId` (Binance переписує час) — **редагує** попереднє повідомлення замість того, щоб слати нове. Якщо `poolId` новий — пушить новий пост.

Архітектура свідомо ідентична до `TGE-Key-Tracker-OKX`: Express + Tenderly signature verify + HTML Telegram. Тільки парсер інший (декодує сирий `tx.input`, бо контракт `0xb0BAa371…f7c434d0f` не verified на BscScan) і додано multi-chat + edit-on-reschedule.

## Залежності

- Tenderly account (Free план підходить — потрібен 1 alert із 3 доступних)
- Telegram bot token (від @BotFather)
- Fly.io account (або інший Docker host)

## Set-up

### 1. Telegram

1. Створи бота через [@BotFather](https://t.me/BotFather), збережи токен.
2. Додай бота **адміном** у кожен чат/канал, куди хочеш слати. Без admin'а він не зможе писати в канал.
3. Отримай `chat_id` кожного чату. Найпростіше — додай [@getidsbot](https://t.me/getidsbot), або зроби запит:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
   після того як надішлеш будь-яке повідомлення в чат від свого імені. ID канала — від'ємне (зазвичай починається з `-100`).

### 2. Tenderly alert

1. Залогінься в Tenderly → `Alerts` → `+ Create Alert`.
2. **Alert Type:** `Function Call`
3. **Network:** BNB Chain (BSC)
4. **Contract:** `0xb0BAa371b899950B4Ef6A27c21bAf5ef7c434d0f` (контракт пулів — `to` в транзакціях оператора `0xb55eDCBE…`)
5. **Function:** обрати/вставити signature `setPoolStartedTimestamp(bytes32,uint256)`. Tenderly попросить ABI або підкаже по селектору `0x70e2af29`.
6. **Destination:** Webhook → `https://<your-fly-app>.fly.dev/webhooks/tenderly`
7. Запам'ятай Tenderly Signing Key (з'явиться в Webhook config).

### 3. Деплой на Fly.io

```bash
# В корені цього репо:
fly launch --no-deploy             # обере ім'я app — переконайся, що воно унікальне
fly secrets set \
  TENDERLY_SIGNING_KEY=<key> \
  TELEGRAM_BOT_TOKEN=<token> \
  TELEGRAM_CHAT_IDS=-1001111,-1002222 \
  POOL_CONTRACT=0xb0baa371b899950b4ef6a27c21baf5ef7c434d0f \
  FUNCTION_SELECTOR=0x70e2af29 \
  REFBACK_URL=https://t.me/cryptohornettg/1354 \
  REFBACK_LABEL="Refback 45%"
fly deploy
```

### 4. Перевірка

```bash
curl https://<your-fly-app>.fly.dev/health
# → ok

# В Tenderly Webhook UI є кнопка "Send Test" — натисни. У логах Fly.io побачиш "TEST event - ignoring".

# Перша реальна тx → відкриє Telegram-повідомлення.
```

## Локальний dev

```bash
cp .env.example .env  # запиши свої значення
npm install
npm run dev
# Потім ngrok / cloudflared:
#   cloudflared tunnel --url http://localhost:8080
# → отриманий URL став в Tenderly як webhook destination.
```

## Формат повідомлення

Перший пост:

```
⚡ NEW BINANCE ALPHA POOL SCHEDULED

Start: 19 May 16:00 Kyiv (in 27h 12m)
Pool: 0xce7217a1…4a3295
Updates: 1
View on Scan

Refback 45%
```

При перепризначенні (тот самий `poolId`, інший `timestamp`):

```
⚡ BINANCE ALPHA POOL RESCHEDULED

Start: ̶1̶9̶ ̶M̶a̶y̶ ̶1̶6̶:̶0̶0̶ → 20 May 17:00 Kyiv (in 49h)
Pool: 0xce7217a1…4a3295
Updates: 2
View on Scan

Refback 45%
```

## Trade-offs / відомі обмеження

- **State в пам'яті.** При рестарті машини (deploy, краш) стан втрачається — поточні відкриті повідомлення стануть «осиротілими» і наступний event для того ж pool створить нове повідомлення замість edit. Для production — підключити Redis (як у твоєму OKX-боті, через `ioredis`).
- **Fly.io free allowance.** Перевір [актуальний free tier](https://fly.io/docs/about/pricing/) — у 2026 безкоштовний кредит $5/міс має покрити одну `shared-cpu-1x@256mb` машину, але без гарантій.
- **Tenderly Free.** 3 batched alerts. Якщо OKX-bot вже використовує 2 — у тебе залишається 1, бот працює, але запас нульовий.
- **Single chain.** Зараз лише BSC mainnet. Розширення на інші — нова Tenderly alert + список контрактів у env.
- **Без backtest.** Bот реагує тільки на нові transactions. Історичні 48 — НЕ потраплять в TG. Якщо потрібен backfill — окремий script (можу написати).
