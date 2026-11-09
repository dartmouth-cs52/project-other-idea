// Masking applied to anything taken from a customer's page before it leaves
// the browser, and again on the server for learned outlines.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{4,}/g;

export function maskSensitive(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[number]").replace(LONG_DIGITS, "[number]");
}

/** Collapse whitespace, mask, and cap length. */
export function cleanText(text: string, max = 80): string {
  const collapsed = maskSensitive(text.replace(/\s+/g, " ").trim());
  return collapsed.length > max ? collapsed.slice(0, max - 1).trimEnd() + "…" : collapsed;
}

/** Whether a label is safe and useful to store in the learned site map. */
export function isLearnableLabel(label: string): boolean {
  if (!label || label.length > 60) return false;
  if (/\[(email|number)\]/.test(label)) return false;
  return /[a-z]/i.test(label);
}
