/**
 * Декодер для функції initializePool на новому контракті
 * 0xb0bb171D333569CfD28a37F5c5DdDAAa90aD46af.
 *
 * Це той виклик, який ловлять "інші боти" — спрацьовує в момент створення
 * пулу, до офіційного запуску торгівлі.
 *
 * Input layout (selector + 8 * 32 bytes):
 *   0x57c036db
 *   [0] currency0   (address — token, наприклад QAIT)
 *   [1] currency1   (address — USDT BSC: 0x55d398326f99059fF775485246999027B3197955)
 *   [2] poolManager (address, hooks/manager)
 *   [3] operator    (address)
 *   [4] fee         (uint256, наприклад 100 = 1%)
 *   [5] flags       (uint256, конфіг — призначення поки невідоме)
 *   [6] startedTimestampSec (uint256 — UNIX seconds)
 *   [7] salt/initHash (bytes32, не poolId)
 *
 * poolId не передається в input — він обчислюється контрактом і емітиться
 * як topic[1] event-а Initialize(). Server.ts витягне його з tx.logs[].
 */

export type DecodedInitializePool = {
  selector: '0x57c036db';
  currency0: string;
  currency1: string;
  fee: number;
  flags: string;       // hex preserved as-is
  startTimestampSec: number;
};

export const INITIALIZE_POOL_SELECTOR = '0x57c036db';

const MIN_TS = 1577836800n;     // 2020-01-01
const MAX_TS = 2524608000n;     // 2050-01-01

export function decodeInitializePool(input: string): DecodedInitializePool | null {
  if (!input || typeof input !== 'string') return null;
  const data = input.toLowerCase();
  if (!data.startsWith('0x')) return null;

  // 4 bytes selector + 8 words * 32 bytes = 4 + 256 = 260 bytes = 520 hex + "0x" = 522
  if (data.length < 522) return null;
  if (data.slice(0, 10) !== INITIALIZE_POOL_SELECTOR) return null;

  const word = (i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
  const addrFromWord = (i: number) => '0x' + word(i).slice(24); // last 20 bytes (40 hex)

  const currency0 = addrFromWord(0);
  const currency1 = addrFromWord(1);

  let fee: number;
  let ts: bigint;
  try {
    fee = Number(BigInt('0x' + word(4)));
    ts = BigInt('0x' + word(6));
  } catch {
    return null;
  }

  if (ts < MIN_TS || ts > MAX_TS) return null;
  if (!isValidAddress(currency0) || !isValidAddress(currency1)) return null;

  return {
    selector: INITIALIZE_POOL_SELECTOR,
    currency0,
    currency1,
    fee,
    flags: '0x' + word(5),
    startTimestampSec: Number(ts),
  };
}

function isValidAddress(a: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(a) && a !== '0x' + '0'.repeat(40);
}
