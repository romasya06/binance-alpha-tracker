/**
 * In-memory стан: poolId → історія SetPoolStartedTimestamp викликів + message_id у кожному чаті.
 *
 * При перезапуску app — стан губиться. Для Fly.io з auto_start цього достатньо (machine
 * тримається теплою). Якщо хочеш персистентність — переключи на ioredis,
 * пов'язавши через REDIS_URL (як у твоєму OKX-боті).
 */

export type StartCall = {
  txHash: string;
  sentAtMs: number;        // коли tx підтверджено on-chain
  startTimestampSec: number;
};

export type PoolState = {
  poolId: string;
  history: StartCall[];                  // у порядку отримання (старі → нові)
  messages: Record<string, number>;      // chat_id (як string) → telegram message_id
};

const store = new Map<string, PoolState>();

export function getPool(poolId: string): PoolState | undefined {
  return store.get(poolId.toLowerCase());
}

export function upsertPoolCall(poolId: string, call: StartCall): PoolState {
  const key = poolId.toLowerCase();
  let st = store.get(key);
  if (!st) {
    st = { poolId: key, history: [], messages: {} };
    store.set(key, st);
  }
  // Дедуп — якщо такий самий txHash вже є, не додаємо
  if (!st.history.some((c) => c.txHash === call.txHash)) {
    st.history.push(call);
  }
  return st;
}

export function rememberMessage(poolId: string, chatId: string, messageId: number): void {
  const st = store.get(poolId.toLowerCase());
  if (!st) return;
  st.messages[chatId] = messageId;
}

export function size(): number {
  return store.size;
}
