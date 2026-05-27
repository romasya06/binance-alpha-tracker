/**
 * Декодер для addPoolOwners на новому контракті
 * 0xb0bb171D333569CfD28a37F5c5DdDAAa90aD46af.
 *
 * Це "Administrator configuration completed" — окрема tx ~хвилину
 * після initializePool, додає адмін(ів) пулу.
 *
 * Input layout:
 *   0xfe7815ed
 *   [0] poolId (bytes32)
 *   [1] offset to owners[] (uint256, зазвичай 0x40)
 *   [2] owners.length (uint256)
 *   [3..n] owners (address[])
 */

export type DecodedAddPoolOwners = {
  selector: '0xfe7815ed';
  poolId: string;
  owners: string[];
};

export const ADD_POOL_OWNERS_SELECTOR = '0xfe7815ed';

export function decodeAddPoolOwners(input: string): DecodedAddPoolOwners | null {
  if (!input || typeof input !== 'string') return null;
  const data = input.toLowerCase();
  if (!data.startsWith('0x')) return null;

  // Min: selector + poolId + offset + length = 4 + 96 = 100 bytes = 200 hex + "0x" = 202
  if (data.length < 202) return null;
  if (data.slice(0, 10) !== ADD_POOL_OWNERS_SELECTOR) return null;

  const poolId = '0x' + data.slice(10, 74);

  let len: number;
  try {
    len = Number(BigInt('0x' + data.slice(138, 202)));
  } catch {
    return null;
  }
  if (len < 0 || len > 100) return null; // sanity

  const owners: string[] = [];
  const ownersStart = 202;
  if (data.length < ownersStart + len * 64) return null;

  for (let i = 0; i < len; i++) {
    const word = data.slice(ownersStart + i * 64, ownersStart + (i + 1) * 64);
    owners.push('0x' + word.slice(24));
  }

  return { selector: ADD_POOL_OWNERS_SELECTOR, poolId, owners };
}
