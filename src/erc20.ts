/**
 * Мінімальний RPC-клієнт до BSC для читання метаданих BEP-20 токена.
 * Робить eth_call на symbol() / name() / decimals().
 *
 * Cache: in-memory, 24 години. Cold-start запиту до публічного RPC ~150ms.
 *
 * Конфіг:
 *   BSC_RPC_URL — необов'язково. Дефолт: https://bsc-dataseed.binance.org/
 *                 Якщо публічний rpc лагає — встав свій (Ankr / QuickNode / Alchemy).
 */

const DEFAULT_RPC = 'https://bsc-dataseed.binance.org/';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type TokenInfo = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
};

type CacheEntry = { info: TokenInfo; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

const SEL_SYMBOL = '0x95d89b41';
const SEL_NAME = '0x06fdde03';
const SEL_DECIMALS = '0x313ce567';

function rpcUrl(): string {
  return process.env.BSC_RPC_URL || DEFAULT_RPC;
}

async function rpcCall(method: string, params: any[], timeoutMs = 5000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    const json = (await res.json()) as any;
    if (json?.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
    return json?.result;
  } finally {
    clearTimeout(t);
  }
}

async function ethCallSafe(to: string, dataSelector: string): Promise<string | null> {
  try {
    const r = await rpcCall('eth_call', [{ to, data: dataSelector }, 'latest']);
    return typeof r === 'string' ? r : null;
  } catch (e: any) {
    console.warn(`[erc20] eth_call ${dataSelector} on ${to} failed: ${e?.message || e}`);
    return null;
  }
}

/**
 * Декодує hex-результат від string-returning функції. Підтримує два формати:
 *  - канонічний ABI: [offset(32)] [length(32)] [data...]
 *  - старий bytes32: 32 байти, null-padded ASCII (старі токени типу MKR)
 */
export function decodeStringReturn(hex: string | null): string | null {
  if (!hex) return null;
  let h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length === 0 || h === '0') return null;

  // Канонічний ABI string
  if (h.length >= 128) {
    try {
      const lenHex = h.slice(64, 128);
      const len = parseInt(lenHex, 16);
      if (len > 0 && len <= 1024 && 128 + len * 2 <= h.length) {
        const dataHex = h.slice(128, 128 + len * 2);
        const str = Buffer.from(dataHex, 'hex').toString('utf8').replace(/\0+$/, '');
        if (str && isPrintable(str)) return str;
      }
    } catch {
      /* fallthrough to bytes32 */
    }
  }

  // bytes32 ASCII
  if (h.length >= 64) {
    try {
      const raw = h.slice(0, 64);
      const buf = Buffer.from(raw, 'hex');
      const str = buf.toString('utf8').replace(/\0+$/, '');
      if (str && isPrintable(str)) return str;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function isPrintable(s: string): boolean {
  return /^[\x20-\x7E]+$/.test(s);
}

export function decodeUintReturn(hex: string | null): number | null {
  if (!hex || hex === '0x') return null;
  try {
    const n = Number(BigInt(hex));
    if (Number.isFinite(n) && n >= 0 && n < 256) return n;
    return null;
  } catch {
    return null;
  }
}

export async function fetchTokenInfo(addr: string): Promise<TokenInfo> {
  const key = addr.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.info;
  }

  const info: TokenInfo = { address: key, symbol: null, name: null, decimals: null };

  const [symHex, nameHex, decHex] = await Promise.all([
    ethCallSafe(addr, SEL_SYMBOL),
    ethCallSafe(addr, SEL_NAME),
    ethCallSafe(addr, SEL_DECIMALS),
  ]);

  info.symbol = decodeStringReturn(symHex);
  info.name = decodeStringReturn(nameHex);
  info.decimals = decodeUintReturn(decHex);

  cache.set(key, { info, fetchedAt: Date.now() });
  return info;
}
