/**
 * Декодер для функції setPoolStartedTimestamp(bytes32 poolId, uint256 timestamp).
 *
 * input layout:
 *   0x70e2af29                                                            // 4 bytes selector
 *   xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  // 32 bytes poolId
 *   xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  // 32 bytes uint256 timestamp
 *
 * Сирий формат, бо контракт не verified на BscScan — ABI недоступний.
 */

export type DecodedSetPoolStart = {
  selector: string;        // '0x70e2af29'
  poolId: string;          // '0x' + 64 hex chars
  startTimestampSec: number; // unix seconds
};

/**
 * Decodes raw tx input data. Returns null if input doesn't match expected layout.
 */
export function decodeSetPoolStart(input: string, expectedSelector = '0x70e2af29'): DecodedSetPoolStart | null {
  if (!input || typeof input !== 'string') return null;
  const data = input.toLowerCase();
  if (!data.startsWith('0x')) return null;
  // Selector (4 bytes) + poolId (32 bytes) + timestamp (32 bytes) = 4 + 32 + 32 = 68 bytes = 136 hex chars + 0x prefix = 138 chars
  if (data.length < 138) return null;

  const selector = data.slice(0, 10);
  if (selector !== expectedSelector.toLowerCase()) return null;

  const poolId = '0x' + data.slice(10, 74);
  const tsHex = data.slice(74, 138);
  // BigInt safely parses 64 hex chars
  const ts = BigInt('0x' + tsHex);

  // Sanity: should be a plausible unix timestamp (after 2020-01-01, before 2050-01-01)
  if (ts < 1577836800n || ts > 2524608000n) return null;

  return {
    selector,
    poolId,
    startTimestampSec: Number(ts),
  };
}
