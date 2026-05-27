/**
 * In-memory стан: poolId → історія + token metadata + message_id у кожному чаті.
 *
 * При перезапуску app — стан губиться. Для Fly.io з auto_start цього достатньо (machine
 * тримається теплою). Якщо хочеш персистентність — переключи на ioredis,
 * пов'язавши через REDIS_URL (як у твоєму OKX-боті).
 */

import type { TokenInfo } from './erc20.js';

export type EventKind = 'init' | 'reschedule' | 'admin';

export type EventCall = {
  kind: EventKind;
  txHash: string;
  sentAtMs: number;
  startTimestampSec?: number; // тільки для init/reschedule
};

export type PoolState = {
  poolId: string;
  tokenInfo: TokenInfo | null;            // null, поки initializePool ще не приходив
  currency0: string | null;               // token address
  currency1: string | null;               // зазвичай USDT
  fee: number | null;
  history: EventCall[];                   // у порядку отримання
  /** msg_id первинного "New Pool" повідомлення (для edit при rescheduling) */
  initMessages: Record<string, number>;   // chatId → message_id
};

const store = new Map<string, PoolState>();

function emptyState(poolId: string): PoolState {
  return {
    poolId: poolId.toLowerCase(),
    tokenInfo: null,
    currency0: null,
    currency1: null,
    fee: null,
    history: [],
    initMessages: {},
  };
}

export function getPool(poolId: string): PoolState | undefined {
  return store.get(poolId.toLowerCase());
}

export function ensurePool(poolId: string): PoolState {
  const key = poolId.toLowerCase();
  let st = store.get(key);
  if (!st) {
    st = emptyState(key);
    store.set(key, st);
  }
  return st;
}

export function recordEvent(poolId: string, call: EventCall): PoolState {
  const st = ensurePool(poolId);
  if (!st.history.some((c) => c.txHash === call.txHash && c.kind === call.kind)) {
    st.history.push(call);
  }
  return st;
}

export function setPoolMetadata(
  poolId: string,
  meta: { currency0: string; currency1: string; fee: number; tokenInfo: TokenInfo | null },
): PoolState {
  const st = ensurePool(poolId);
  st.currency0 = meta.currency0.toLowerCase();
  st.currency1 = meta.currency1.toLowerCase();
  st.fee = meta.fee;
  if (meta.tokenInfo) st.tokenInfo = meta.tokenInfo;
  return st;
}

export function rememberInitMessage(poolId: string, chatId: string, messageId: number): void {
  const st = store.get(poolId.toLowerCase());
  if (!st) return;
  st.initMessages[chatId] = messageId;
}

export function alreadyProcessed(poolId: string, kind: EventKind, txHash: string): boolean {
  const st = store.get(poolId.toLowerCase());
  if (!st) return false;
  return st.history.some((c) => c.kind === kind && c.txHash === txHash);
}

export function size(): number {
  return store.size;
}
