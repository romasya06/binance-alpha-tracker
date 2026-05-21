// src/server.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import * as pinoHttpNS from 'pino-http';

import { verifyTenderlySignature } from './tenderly/verify.js';
import { decodeSetPoolStart } from './decoder.js';
import { sendMessage, editMessage, escHtml, getChatIds } from './telegram.js';
import { getPool, upsertPoolCall, rememberMessage } from './state.js';
import { formatKyiv, formatLead } from './utils/time.js';

const app = express();

// ====== BOOT LOG ======
console.log('[boot] binance-alpha-tracker version=2026-05-21');
console.log('[boot] NODE_ENV=%s PORT=%s', process.env.NODE_ENV, process.env.PORT);
console.log('[boot] POOL_CONTRACT=%s', process.env.POOL_CONTRACT || '(not set)');
console.log('[boot] FUNCTION_SELECTOR=%s', process.env.FUNCTION_SELECTOR || '0x70e2af29 (default)');
console.log('[boot] TELEGRAM_BOT_TOKEN=%s', process.env.TELEGRAM_BOT_TOKEN ? '(set)' : '(not set)');
console.log('[boot] TELEGRAM_CHAT_IDS=%s', process.env.TELEGRAM_CHAT_IDS || '(not set)');
console.log('[boot] TENDERLY_SIGNING_KEY=%s', process.env.TENDERLY_SIGNING_KEY ? '(set)' : '(not set)');

const pinoHttp = (pinoHttpNS as any).default ?? (pinoHttpNS as any);
app.use(pinoHttp());

// ====== ROUTES ======
app.get('/health', (_req: Request, res: Response) => res.status(200).send('ok'));
app.get('/webhooks/tenderly', (_req, res) => res.status(200).send('ok - use POST here'));

const EXPECTED_SELECTOR = (process.env.FUNCTION_SELECTOR || '0x70e2af29').toLowerCase();
const POOL_CONTRACT = (process.env.POOL_CONTRACT || '').toLowerCase();

// ====== MESSAGE BUILDER ======
function buildMessage(args: {
  poolId: string;
  txHash: string;
  startTsSec: number;
  prevStartTsSec: number | null;
  updates: number;
}): string {
  const { poolId, txHash, startTsSec, prevStartTsSec, updates } = args;

  const kyiv = formatKyiv(startTsSec);
  const lead = formatLead(startTsSec);

  const isUpdate = prevStartTsSec !== null && prevStartTsSec !== startTsSec;
  const title = isUpdate
    ? `⚡ <b>BINANCE ALPHA POOL RESCHEDULED</b>`
    : `⚡ <b>NEW BINANCE ALPHA POOL SCHEDULED</b>`;

  const startLine = isUpdate
    ? `<b>Start:</b> <s>${escHtml(formatKyiv(prevStartTsSec!))}</s> → <b>${escHtml(kyiv)} Kyiv</b> (${escHtml(lead)})`
    : `<b>Start:</b> ${escHtml(kyiv)} Kyiv (${escHtml(lead)})`;

  const shortPool = `${poolId.slice(0, 10)}…${poolId.slice(-6)}`;
  const scanUrl = `https://bscscan.com/tx/${txHash}`;

  const refbackUrl = process.env.REFBACK_URL;
  const refbackLabel = process.env.REFBACK_LABEL || 'Refback';
  const refbackLine =
    refbackUrl ? `\n\n<a href="${escHtml(refbackUrl)}">${escHtml(refbackLabel)}</a>` : '';

  return (
    `${title}\n\n` +
    `${startLine}\n` +
    `<b>Pool:</b> <code>${escHtml(shortPool)}</code>\n` +
    `<b>Updates:</b> ${updates}\n` +
    `<a href="${escHtml(scanUrl)}">View on Scan</a>` +
    refbackLine
  );
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
      const contentType = (req.header('content-type') || '').trim();
      const rawLen = Buffer.isBuffer(req.body) ? (req.body as Buffer).length : 0;

      req.log.info(
        { contentType, sigPresent: Boolean(signature), datePresent: Boolean(date), rawLen },
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
      if (eventType !== 'ALERT') {
        req.log.info({ eventType }, 'Non-ALERT event - ignored');
        return res.status(200).send('ignored');
      }

      // Витягнути tx_hash + tx_input з тіла Tenderly alert.
      // Tenderly Function Call Alert payload містить transaction object з input field.
      const tx =
        body?.transaction ?? body?.alert?.transaction ?? body?.data?.transaction ?? {};
      const txHash: string | undefined = tx?.hash || body?.alert?.tx_hash || body?.tx_hash;
      const txInput: string | undefined = tx?.input || tx?.data;
      const txTo: string | undefined = (tx?.to || tx?.to_address || '').toLowerCase?.();

      req.log.info(
        { txHash, txTo, hasInput: Boolean(txInput) },
        'parsed transaction fields',
      );

      if (!txHash || !txInput) {
        req.log.warn({ txHash, hasInput: Boolean(txInput) }, 'Missing tx hash / input — ignoring');
        return res.status(200).send('ok');
      }

      // Опціонально перевіряємо, що це наш pool contract (на випадок мисconfig alert у Tenderly).
      if (POOL_CONTRACT && txTo && txTo !== POOL_CONTRACT) {
        req.log.info(
          { txTo, expected: POOL_CONTRACT },
          'tx.to != POOL_CONTRACT — ignoring',
        );
        return res.status(200).send('ok');
      }

      const decoded = decodeSetPoolStart(txInput, EXPECTED_SELECTOR);
      if (!decoded) {
        req.log.info(
          { selectorPreview: txInput.slice(0, 10) },
          'Input does not match setPoolStartedTimestamp — ignoring',
        );
        return res.status(200).send('ok');
      }

      const { poolId, startTimestampSec } = decoded;
      req.log.info({ poolId, startTimestampSec }, 'decoded setPoolStartedTimestamp');

      // ----- стан і дедуп по txHash -----
      const existing = getPool(poolId);
      const alreadySeenTx = existing?.history.some((c) => c.txHash === txHash) ?? false;
      if (alreadySeenTx) {
        req.log.info({ poolId, txHash }, 'tx already processed for this pool — ignoring');
        return res.status(200).send('ok');
      }

      const prevStart =
        existing && existing.history.length > 0
          ? existing.history[existing.history.length - 1].startTimestampSec
          : null;

      const state = upsertPoolCall(poolId, {
        txHash,
        sentAtMs: Date.now(),
        startTimestampSec,
      });

      const updates = state.history.length;

      // ----- TG -----
      const html = buildMessage({
        poolId,
        txHash,
        startTsSec: startTimestampSec,
        prevStartTsSec: prevStart,
        updates,
      });

      const chats = getChatIds();
      for (const chatId of chats) {
        const existingMsgId = state.messages[chatId];
        let posted = false;
        if (existingMsgId) {
          posted = await editMessage(chatId, existingMsgId, html);
        }
        if (!posted) {
          const newMsgId = await sendMessage(chatId, html);
          if (newMsgId) rememberMessage(poolId, chatId, newMsgId);
        }
      }

      req.log.info(
        { poolId, updates, ms: Date.now() - startedAt },
        'processed setPoolStartedTimestamp',
      );
      return res.status(200).send('ok');
    } catch (err: any) {
      (req as any).log?.error?.(
        {
          err: err?.message || err,
          stack: err?.stack,
          ms: Date.now() - startedAt,
        },
        'Error handling webhook',
      );
      return res.status(500).send('error');
    }
  },
);

// ====== START ======
const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Listening on :${port}`));
