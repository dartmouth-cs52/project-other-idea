import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from "date-fns";
import type { Currency } from "@/data/types";

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** $1,234.56, £1,234.56 or €1.234,56 */
export function money(amount: number, currency: Currency = "USD", opts: { compact?: boolean } = {}) {
  const key = `${currency}${opts.compact ? "c" : ""}`;
  let f = moneyFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currency === "EUR" ? "de-DE" : currency === "GBP" ? "en-GB" : "en-US", {
      style: "currency",
      currency,
      notation: opts.compact ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : 2,
    });
    moneyFormats.set(key, f);
  }
  return f.format(amount);
}

export const date = (value: string) => format(parseISO(value), "MMM d, yyyy");
export const shortDate = (value: string) => format(parseISO(value), "MMM d");
export const dateTime = (value: string) => format(parseISO(value), "MMM d, yyyy h:mm a");
export const ago = (value: string) => formatDistanceToNowStrict(parseISO(value), { addSuffix: true });

/** "Today", "Yesterday" or "Mar 4", for grouping a feed. */
export function dayLabel(value: string) {
  const d = parseISO(value);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

export const initials = (first: string, last: string) => `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
export const fullName = (p: { firstName: string; lastName: string } | undefined) => (p ? `${p.firstName} ${p.lastName}` : "Unknown");
export const pct = (n: number) => `${Math.round(n)}%`;

/** •••• 4417 */
export const masked = (last4: string) => `•••• ${last4}`;
/** 4111 1111 1111 1111 */
export const cardNumber = (n: string) => n.replace(/(\d{4})(?=\d)/g, "$1 ");

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
