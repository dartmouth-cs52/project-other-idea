// A small client for Stripe's API, shared by the widget server, the site's
// Worker and the setup script. It is plain fetch and Web Crypto, so it runs in
// a Worker and in Node alike, and it adds nothing to either bundle but itself.
//
// Every call names the API version, so a change to the account's default
// version in Stripe's dashboard never changes what this code reads.

export const STRIPE_API_VERSION = "2026-10-28.endive";
const API = "https://api.stripe.com";

/** An answer from Stripe that was not a success, with Stripe's own code when it gave one. */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly type?: string,
  ) {
    super(message);
  }
}

export type Params = { [name: string]: Param };
type Param = string | number | boolean | null | undefined | Params | Param[];

/** Stripe's form encoding: `items[0][price]=…`, `metadata[plan]=team`. Undefined is left out; null is sent empty, which clears a field. */
export function formEncode(params: Params): URLSearchParams {
  const form = new URLSearchParams();
  const add = (name: string, value: Param) => {
    if (value === undefined) return;
    if (value === null) form.append(name, "");
    else if (Array.isArray(value)) value.forEach((item, index) => add(`${name}[${index}]`, item));
    else if (typeof value === "object") for (const [key, inner] of Object.entries(value)) add(`${name}[${key}]`, inner);
    else form.append(name, String(value));
  };
  for (const [name, value] of Object.entries(params)) add(name, value);
  return form;
}

export interface StripeCall {
  /** Sent as Idempotency-Key, so a retry of a write that already happened returns the first result instead of doing it twice. */
  idempotencyKey?: string;
  /** For tests. */
  fetch?: typeof fetch;
}

/** One call to Stripe's API. GET sends `params` in the address, the rest as a form. */
export async function stripe<T = Record<string, unknown>>(key: string, method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, call: StripeCall = {}): Promise<T> {
  const form = formEncode(params);
  const url = method === "GET" && form.size ? `${API}${path}?${form}` : `${API}${path}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (call.idempotencyKey) headers["Idempotency-Key"] = call.idempotencyKey;
  const response = await (call.fetch ?? fetch)(url, { method, headers, body: method === "POST" ? form.toString() : undefined });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Not JSON: an outage page. The status says enough.
  }
  if (!response.ok) {
    const error = (body.error ?? {}) as { message?: string; code?: string; type?: string };
    throw new StripeError(error.message ?? `Stripe answered ${response.status}.`, response.status, error.code, error.type);
  }
  return body as T;
}

/** Whether a key is for test mode. Live keys start sk_live_ or rk_live_. */
export function isTestKey(key: string): boolean {
  return /^(sk|rk)_test_/.test(key);
}

// Webhooks -------------------------------------------------------------------

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> & { id?: string; object?: string } };
}

/** How old a signed webhook may be, as Stripe's own libraries allow. Older ones may be a replay. */
export const WEBHOOK_TOLERANCE_S = 300;

async function hmacHex(secret: string, text: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings in time that depends only on their length, so a guess can't be refined one character at a time. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/**
 * The event in a webhook, when its Stripe-Signature header is Stripe's
 * signature of this exact body with this endpoint's secret, made within the
 * last five minutes. Anything else gives undefined. The body must be the raw
 * text as it arrived: parsed and written out again, it no longer matches.
 */
export async function verifiedEvent(body: string, header: string | null, secret: string, nowMs = Date.now()): Promise<StripeEvent | undefined> {
  if (!header || !secret) return undefined;
  let time = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t") time = Number(value);
    // v1 is the only scheme Stripe signs live webhooks with. v0 is for tests in its own libraries, and is never trusted here.
    if (name === "v1") signatures.push(value);
  }
  if (!Number.isInteger(time) || !signatures.length) return undefined;
  if (Math.abs(nowMs / 1000 - time) > WEBHOOK_TOLERANCE_S) return undefined;
  const expected = await hmacHex(secret, `${time}.${body}`);
  if (!signatures.some((signature) => sameText(signature, expected))) return undefined;
  try {
    const event = JSON.parse(body) as StripeEvent;
    return typeof event?.id === "string" && typeof event.type === "string" && event.data?.object ? event : undefined;
  } catch {
    return undefined;
  }
}

/** A Stripe-Signature header for a body, as Stripe makes one. For tests, and for trying the endpoint by hand. */
export async function signForTest(body: string, secret: string, timeS = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timeS},v1=${await hmacHex(secret, `${timeS}.${body}`)}`;
}
