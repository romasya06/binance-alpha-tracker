/**
 * Telegram wrapper: sendMessage + editMessageText.
 * HTML parse mode, як у твоєму OKX-боті.
 *
 * Підтримує MULTI-CHAT: масив chat_id, шле/едітить у всі по черзі.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function getChatIds(): string[] {
  const raw = requireEnv('TELEGRAM_CHAT_IDS');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

type TgResponse = { ok: boolean; result?: any; description?: string; error_code?: number };

async function tgCall(method: string, body: any): Promise<TgResponse> {
  const token = requireEnv('TELEGRAM_BOT_TOKEN');
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, description: 'non-json response' }))) as TgResponse;
  return json;
}

export async function sendMessage(chatId: string, html: string): Promise<number | null> {
  const r = await tgCall('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  if (!r.ok) {
    console.warn(`[tg] sendMessage failed chat=${chatId} desc=${r.description}`);
    return null;
  }
  return r.result?.message_id ?? null;
}

/**
 * editMessageText. Повертає true якщо вдалось.
 * "message is not modified" — повертаємо true (нічого не змінилось — ок).
 * Якщо повідомлення видалили вручну, telegram віддасть 400 — повертаємо false і колер шле новий.
 */
export async function editMessage(chatId: string, messageId: number, html: string): Promise<boolean> {
  const r = await tgCall('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
  if (r.ok) return true;
  const desc = (r.description || '').toLowerCase();
  if (desc.includes('not modified')) return true;
  console.warn(`[tg] editMessage failed chat=${chatId} msg=${messageId} desc=${r.description}`);
  return false;
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
