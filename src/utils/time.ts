/**
 * Time helpers — конвертація unix timestamp у Київ + людиночитна різниця.
 *
 * Зона Europe/Kyiv обробляє літній/зимовий час автоматично.
 */

const KYIV = 'Europe/Kyiv';

const dtfKyiv = new Intl.DateTimeFormat('en-GB', {
  timeZone: KYIV,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Format unix-seconds як "19 May 16:00" у Київ.
 */
export function formatKyiv(unixSec: number): string {
  const ms = unixSec * 1000;
  return dtfKyiv.format(new Date(ms));
}

/**
 * Format unix-seconds як "19 May 2026 16:00" у Київ — для архіву.
 */
const dtfKyivFull = new Intl.DateTimeFormat('en-GB', {
  timeZone: KYIV,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export function formatKyivFull(unixSec: number): string {
  return dtfKyivFull.format(new Date(unixSec * 1000));
}

/**
 * Human-readable lead time: "in 27h 12m" / "in 2d 03h" / "in 45m" / "just now" / "5h ago".
 */
export function formatLead(targetUnixSec: number, nowMs: number = Date.now()): string {
  const diffMs = targetUnixSec * 1000 - nowMs;
  const ago = diffMs < 0;
  let secs = Math.abs(Math.floor(diffMs / 1000));
  const days = Math.floor(secs / 86400);
  secs %= 86400;
  const hours = Math.floor(secs / 3600);
  secs %= 3600;
  const mins = Math.floor(secs / 60);

  let body: string;
  if (days > 0) body = `${days}d ${String(hours).padStart(2, '0')}h`;
  else if (hours > 0) body = `${hours}h ${String(mins).padStart(2, '0')}m`;
  else body = `${mins}m`;

  return ago ? `${body} ago` : `in ${body}`;
}
