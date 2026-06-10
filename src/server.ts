// src/server.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as pinoHttpNS from 'pino-http';

import { verifyTenderlySignature } from './tenderly/verify.js';
import { decodeSetPoolStart } from './decoder.js';
import {
  decodeInitializePool,
  INITIALIZE_POOL_SELECTOR,
} from './decoders/initializePool.js';
import {
  decodeAddPoolOwners,
  ADD_POOL_OWNERS_SELECTOR,
} from './decoders/addPoolOwners.js';
import { fetchTokenInfo, type TokenInfo } from './erc20.js';
import { sendMessage, editMessage, escHtml, getChatIds } from './telegram.js';
import {
  getPool,
  recordEvent,
  setPoolMetadata,
  rememberInitMessage,
  alreadyProcessed,
} from './state.js';
import { formatKyiv, formatLead, formatKyivUa, formatUtcTime, formatLeadUa } from './utils/time.js';

const app = express();

// ====== BOOT LOG ======
console.log('[boot] binance-alpha-tracker version=2026-06-11-ua-template');
console.log('[boot] NODE_ENV=%s PORT=%s', process.env.NODE_ENV, process.env.PORT);
console.log('[boot] POOL_CONTRACTS=%s', process.env.POOL_CONTRACTS || process.env.POOL_CONTRACT || '(any)');
console.log('[boot] BSC_RPC_URL=%s', process.env.BSC_RPC_URL || '(default public)');
console.log('[boot] TELEGRAM_BOT_TOKEN=%s', process.env.TELEGRAM_BOT_TOKEN ? '(set)' : '(not set)');
console.log('[boot] TELEGRAM_CHAT_IDS=%s', process.env.TELEGRAM_CHAT_IDS || '(not set)');
console.log('[boot] TENDERLY_SIGNING_KEY=%s', process.env.TENDERLY_SIGNING_KEY ? '(set)' : '(not set)');

const pinoHttp = (pinoHttpNS as any).default ?? (pinoHttpNS as any);
app.use(pinoHttp());

// ====== ROUTES ======
app.get('/health', (_req: Request, res: Response) => res.status(200).send('ok'));
app.get('/webhooks/tenderly', (_req, res) => res.status(200).send('ok - use POST here'));

// Дві версії — стара (CLAlphaHook v1, 0xb0ba…4d0f) і нова (CLAlphaHook v2, 0xb0bb…46af)
// мають різні імена функцій з ідентичним layout-ом параметрів:
//   v1:  setPoolStartedTimestamp(bytes32,uint256) → 0x70e2af29
//   v2:  setPoolStartTime(bytes32,uint256)        → 0xf4d50b3b
const RESCHEDULE_SELECTORS = new Set<string>([
  (process.env.FUNCTION_SELECTOR || '0x70e2af29').toLowerCase(),
  '0xf4d50b3b',
]);
const ALLOWED_CONTRACTS = (process.env.POOL_CONTRACTS || process.env.POOL_CONTRACT || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Quote-токени Binance Alpha. У Uniswap-v4 currency0 < currency1 за адресою,
// тому "новий" токен може опинитися як currency0, так і currency1 — залежно
// від того, як його адреса співставляється з USDT.
const USDT_BSC = '0x55d398326f99059ff775485246999027b3197955';
const USDC_BSC = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const QUOTE_TOKENS: Record<string, string> = {
  [USDT_BSC]: 'USDT',
  [USDC_BSC]: 'USDC',
};

function isQuote(addr: string): boolean {
  return addr.toLowerCase() in QUOTE_TOKENS;
}
function quoteLabel(addr: string): string {
  return QUOTE_TOKENS[addr.toLowerCase()] ?? (addr.slice(0, 6) + '…' + addr.slice(-4));
}

/**
 * З двох currency визначає реальний токен і котирувальну сторону.
 * Якщо одна з currency — USDT/USDC → беремо ту, що не є quote.
 * Якщо обидві невідомі → currency0 default (як було).
 */
function pickSides(currency0: string, currency1: string): { token: string; quote: string } {
  if (isQuote(currency0) && !isQuote(currency1)) return { token: currency1, quote: currency0 };
  if (isQuote(currency1) && !isQuote(currency0)) return { token: currency0, quote: currency1 };
  return { token: currency0, quote: currency1 };
}

// ====== MESSAGE BUILDERS ======
function tickerOrShort(t: TokenInfo | null, addr: string): string {
  if (t?.symbol && t.symbol.length <= 12) return t.symbol;
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// Рефбек-лінк публічний (не секрет), тому дефолт зашитий у код;
// env vars лишаються для перевизначення.
const REFBACK_URL = process.env.REFBACK_URL || 'https://t.me/cryptohornettg/1354';
const REFBACK_LABEL = process.env.REFBACK_LABEL || 'Refback 45%';

function refbackLine(): string {
  return `\n<a href="${escHtml(REFBACK_URL)}">${escHtml(REFBACK_LABEL)}</a>`;
}

function buildInitMessage(args: {
  poolId: string;
  txHash: string;
  startTsSec: number;
  currency0: string;
  currency1: string;
  fee: number;
  tokenInfo: TokenInfo | null;
}): string {
  const { txHash, startTsSec, currency0, currency1, tokenInfo } = args;

  const { token: tokenAddr, quote: quoteAddr } = pickSides(currency0, currency1);

  const sym = tickerOrShort(tokenInfo, tokenAddr);
  const quote = quoteLabel(quoteAddr);
  const name = tokenInfo?.name && tokenInfo.name !== sym ? ` (${tokenInfo.name})` : '';

  const kyiv = formatKyivUa(startTsSec);
  const utc = formatUtcTime(startTsSec);
  const lead = formatLeadUa(startTsSec);

  const scanUrl = `https://bscscan.com/tx/${txHash}`;
  const tokenUrl = `https://bscscan.com/token/${tokenAddr}`;

  return (
    `🚀 <b>НОВИЙ ПУЛ BINANCE ALPHA</b>\n\n` +
    `💎 <a href="${escHtml(tokenUrl)}"><b>${escHtml(sym)}</b></a>${escHtml(name)} / ${escHtml(quote)}\n` +
    `🕒 <b>Старт:</b> ${escHtml(kyiv)} за Києвом (${escHtml(utc)} UTC)\n` +
    `⏳ ${escHtml(lead)}\n` +
    `📄 <code>${escHtml(tokenAddr)}</code>\n\n` +
    `<a href="${escHtml(scanUrl)}">View on BscScan</a>` +
    refbackLine()
  );
}

function buildRescheduleMessage(args: {
  poolId: string;
  txHash: string;
  startTsSec: number;
  prevStartTsSec: number | null;
  updates: number;
  tokenInfo: TokenInfo | null;
  currency0: string | null;
  currency1: string | null;
}): string {
  const { txHash, startTsSec, prevStartTsSec, tokenInfo, currency0, currency1 } = args;
  const tokenAddr = currency0 && currency1 ? pickSides(currency0, currency1).token : currency0;

  const kyiv = formatKyivUa(startTsSec);
  const utc = formatUtcTime(startTsSec);
  const lead = formatLeadUa(startTsSec);

  const isUpdate = prevStartTsSec !== null && prevStartTsSec !== startTsSec;
  const title = isUpdate
    ? `⚡ <b>ПЕРЕНЕСЕНО СТАРТ ПУЛУ BINANCE ALPHA</b>`
    : `⚡ <b>ВСТАНОВЛЕНО ЧАС СТАРТУ ПУЛУ BINANCE ALPHA</b>`;

  const startLine = isUpdate
    ? `🕒 <b>Старт:</b> <s>${escHtml(formatKyivUa(prevStartTsSec!))}</s> → <b>${escHtml(kyiv)} за Києвом</b> (${escHtml(utc)} UTC)`
    : `🕒 <b>Старт:</b> ${escHtml(kyiv)} за Києвом (${escHtml(utc)} UTC)`;

  const scanUrl = `https://bscscan.com/tx/${txHash}`;

  const pairLine =
    tokenAddr && tokenInfo
      ? `💎 <a href="https://bscscan.com/token/${tokenAddr}"><b>${escHtml(tickerOrShort(tokenInfo, tokenAddr))}</b></a>\n`
      : '';

  return (
    `${title}\n\n` +
    pairLine +
    `${startLine}\n` +
    `⏳ ${escHtml(lead)}\n\n` +
    `<a href="${escHtml(scanUrl)}">View on BscScan</a>` +
    refbackLine()
  );
}

// ====== LOG HELPERS ======
type RawLog = { address?: string; topics?: string[]; data?: string };

/**
 * З `tx.logs[]` витягуємо poolId — це topic[1] першого Initialize event
 * на контракті пулу. Топік event-у Initialize містить poolId як перший
 * indexed параметр (bytes32).
 *
 * Fallback: перший лог з ≥2 топіками на тому ж контракті, що й tx.to.
 */
function extractPoolIdFromLogs(logs: RawLog[] | undefined, txTo: string): string | null {
  if (!Array.isArray(logs) || logs.length === 0) return null;
  const target = (txTo || '').toLowerCase();
  for (const log of logs) {
    if (!log || !Array.isArray(log.topics) || log.topics.length < 2) continue;
    const addr = (log.address || '').toLowerCase();
    if (target && addr !== target) continue;
    const t1 = log.topics[1];
    if (typeof t1 === 'string' && /^0x[0-9a-fA-F]{64}$/.test(t1)) {
      return t1.toLowerCase();
    }
  }
  return null;
}

// ====== WEBHOOK HANDLER ======
app.post(
  '/webhooks/tenderly',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const startedAt = Date.now();

    try {
      const signature = (req.header('x-tenderly-signature') || '').trim();
      const date = (req.header('date') || '').trim();
      const rawLen = Buffer.isBuffer(req.body) ? (req.body as Buffer).length : 0;

      req.log.info(
        { sigPresent: Boolean(signature), datePresent: Boolean(date), rawLen },
        'tenderly webhook received',
      );

      const signingKey = process.env.TENDERLY_SIGNING_KEY || '';
      if (!signingKey) {
        req.log.error('Missing TENDERLY_SIGNING_KEY');
        return res.status(500).send('Missing TENDERLY_SIGNING_KEY');
      }

      const okSig = verifyTenderlySignature({
        signingKey,
        signature,
        date,
        rawBody: req.body as Buffer,
      });
      if (!okSig) {
        req.log.warn({ sigPreview: signature.slice(0, 12) }, 'Invalid Tenderly signature');
        return res.status(400).send('Invalid signature');
      }

      let body: any;
      try {
        body = JSON.parse((req.body as Buffer).toString('utf8'));
      } catch (e: any) {
        req.log.error({ err: e?.message || e }, 'Failed to JSON.parse body');
        return res.status(400).send('Bad JSON');
      }

      const eventType: string = body?.event_type;
      if (eventType === 'TEST') {
        req.log.info('TEST event - ignoring');
        return res.status(200).send('ok');
      }
      if (eventType && eventType !== 'ALERT') {
        req.log.info({ eventType }, 'Non-ALERT event - ignored');
        return res.status(200).send('ignored');
      }

      const tx =
        body?.transaction ?? body?.alert?.transaction ?? body?.data?.transaction ?? {};
      const txHash: string | undefined = tx?.hash || body?.alert?.tx_hash || body?.tx_hash;
      const txInput: string | undefined = tx?.input || tx?.data;
      const txTo: string = ((tx?.to || tx?.to_address || '') as string).toLowerCase();
      const txLogs: RawLog[] | undefined = tx?.logs || tx?.receipt?.logs;

      req.log.info(
        { txHash, txTo, hasInput: Boolean(txInput), logsCount: txLogs?.length ?? 0 },
        'parsed transaction fields',
      );

      if (!txHash || !txInput) {
        req.log.warn({ txHash, hasInput: Boolean(txInput) }, 'Missing tx hash / input — ignoring');
        return res.status(200).send('ok');
      }

      if (ALLOWED_CONTRACTS.length > 0 && txTo && !ALLOWED_CONTRACTS.includes(txTo)) {
        req.log.info({ txTo, allowed: ALLOWED_CONTRACTS }, 'tx.to not in allow-list — ignoring');
        return res.status(200).send('ok');
      }

      const selector = txInput.slice(0, 10).toLowerCase();

      // -----------------------------------------------------------------
      // DISPATCH BY SELECTOR
      // -----------------------------------------------------------------
      if (selector === INITIALIZE_POOL_SELECTOR) {
        await handleInitializePool({ req, txHash, txInput, txTo, txLogs });
      } else if (selector === ADD_POOL_OWNERS_SELECTOR) {
        await handleAddPoolOwners({ req, txHash, txInput });
      } else if (RESCHEDULE_SELECTORS.has(selector)) {
        await handleReschedule({ req, txHash, txInput, selector });
      } else {
        req.log.info({ selector }, 'Unknown selector — ignored');
      }

      req.log.info({ selector, txHash, ms: Date.now() - startedAt }, 'processed');
      return res.status(200).send('ok');
    } catch (err: any) {
      (req as any).log?.error?.(
        { err: err?.message || err, stack: err?.stack, ms: Date.now() - startedAt },
        'Error handling webhook',
      );
      return res.status(500).send('error');
    }
  },
);

// ====== HANDLERS ======
async function handleInitializePool(args: {
  req: Request;
  txHash: string;
  txInput: string;
  txTo: string;
  txLogs: RawLog[] | undefined;
}) {
  const { req, txHash, txInput, txTo, txLogs } = args;
  const decoded = decodeInitializePool(txInput);
  if (!decoded) {
    req.log.warn({ selector: txInput.slice(0, 10) }, 'initializePool decode failed');
    return;
  }

  const poolId = extractPoolIdFromLogs(txLogs, txTo) || `0x${txHash.slice(2).padEnd(64, '0').slice(0, 64)}`;

  if (alreadyProcessed(poolId, 'init', txHash)) {
    req.log.info({ poolId, txHash }, 'init already processed — ignoring');
    return;
  }

  // Визначаємо реальний токен: якщо currency0=USDT/USDC, "новий" токен — це currency1.
  const { token: realTokenAddr } = pickSides(decoded.currency0, decoded.currency1);

  // Витягуємо token info — best-effort. Не блокуємо повідомлення, якщо RPC не відповів вчасно.
  let tokenInfo: TokenInfo | null = null;
  try {
    tokenInfo = await fetchTokenInfo(realTokenAddr);
    req.log.info(
      {
        currency0: decoded.currency0,
        currency1: decoded.currency1,
        realToken: realTokenAddr,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
      },
      'fetched token info',
    );
  } catch (e: any) {
    req.log.warn({ err: e?.message }, 'fetchTokenInfo failed (continuing without)');
  }

  setPoolMetadata(poolId, {
    currency0: decoded.currency0,
    currency1: decoded.currency1,
    fee: decoded.fee,
    tokenInfo,
  });
  recordEvent(poolId, {
    kind: 'init',
    txHash,
    sentAtMs: Date.now(),
    startTimestampSec: decoded.startTimestampSec,
  });

  const html = buildInitMessage({
    poolId,
    txHash,
    startTsSec: decoded.startTimestampSec,
    currency0: decoded.currency0,
    currency1: decoded.currency1,
    fee: decoded.fee,
    tokenInfo,
  });

  for (const chatId of getChatIds()) {
    const msgId = await sendMessage(chatId, html);
    if (msgId) rememberInitMessage(poolId, chatId, msgId);
  }
}

async function handleAddPoolOwners(args: {
  req: Request;
  txHash: string;
  txInput: string;
}) {
  const { req, txHash, txInput } = args;
  const decoded = decodeAddPoolOwners(txInput);
  if (!decoded) {
    req.log.warn({ selector: txInput.slice(0, 10) }, 'addPoolOwners decode failed');
    return;
  }
  // MVP: лише лог, без TG-повідомлення (це службова tx, не сигнал community).
  recordEvent(decoded.poolId, { kind: 'admin', txHash, sentAtMs: Date.now() });
  req.log.info(
    { poolId: decoded.poolId, owners: decoded.owners, txHash },
    'addPoolOwners (admin configured) — logged only',
  );
}

async function handleReschedule(args: {
  req: Request;
  txHash: string;
  txInput: string;
  selector: string;
}) {
  const { req, txHash, txInput, selector } = args;
  const decoded = decodeSetPoolStart(txInput, selector);
  if (!decoded) {
    req.log.warn({ selector: txInput.slice(0, 10) }, 'setPoolStartedTimestamp decode failed');
    return;
  }
  const { poolId, startTimestampSec } = decoded;

  if (alreadyProcessed(poolId, 'reschedule', txHash)) {
    req.log.info({ poolId, txHash }, 'reschedule already processed — ignoring');
    return;
  }

  const existing = getPool(poolId);
  const prevStart =
    existing?.history
      .filter((c) => c.kind === 'reschedule' || c.kind === 'init')
      .map((c) => c.startTimestampSec)
      .filter((t): t is number => typeof t === 'number')
      .slice(-1)[0] ?? null;

  const state = recordEvent(poolId, {
    kind: 'reschedule',
    txHash,
    sentAtMs: Date.now(),
    startTimestampSec,
  });

  const updates = state.history.filter((c) => c.kind === 'reschedule').length;

  const html = buildRescheduleMessage({
    poolId,
    txHash,
    startTsSec: startTimestampSec,
    prevStartTsSec: prevStart,
    updates,
    tokenInfo: state.tokenInfo,
    currency0: state.currency0,
    currency1: state.currency1,
  });

  for (const chatId of getChatIds()) {
    const existingMsgId = state.initMessages[chatId];
    let edited = false;
    if (existingMsgId) {
      // Edit оригінальний init-message, якщо ми його шепнули у тому ж рестарті
      edited = await editMessage(chatId, existingMsgId, html);
    }
    if (!edited) {
      await sendMessage(chatId, html);
    }
  }
}

// ====== START ======
const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Listening on :${port}`));
