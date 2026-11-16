import { GUIDE_ID, MODES, type Handoff, type HandoffRequest, type Mode, type PublicHandoff, type SiteContext, type TranscriptTurn } from "../shared/types.ts";

// The way to a person. A support chat is also an inbox someone watches, and
// Haptic is not one: when it can't help it hands over to whatever the company
// already uses. The widget's short form is posted here and passed straight on
// to the company's webhook, with the conversation and the page the visitor was
// on. Nothing of it is kept on the way.

export const DEFAULT_HANDOFF_LABEL = "Contact support";
const SEND_TIMEOUT_MS = 6000;

/** The part of a site's handoff the widget may know. */
export function publicHandoff(handoff: Handoff | undefined): PublicHandoff | undefined {
  if (!handoff || (!handoff.webhook && !handoff.url && !handoff.email)) return undefined;
  const shown: PublicHandoff = { label: (handoff.label || DEFAULT_HANDOFF_LABEL).slice(0, 40) };
  if (handoff.webhook) shown.form = true;
  if (handoff.url && isWebAddress(handoff.url)) shown.url = handoff.url;
  if (handoff.email && EMAIL.test(handoff.email)) shown.email = handoff.email;
  return shown;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const isWebAddress = (value: string): boolean => /^https?:\/\//i.test(value) && URL.canParse(value);

/**
 * A webhook has to be an https address on the public internet. The server
 * fetches it, so an address that names the server's own network is refused.
 * `local` lets a developer's machine post to itself.
 */
export function webhookAllowed(address: string, local = false): boolean {
  if (!URL.canParse(address)) return false;
  const url = new URL(address);
  const host = url.hostname.toLowerCase();
  const inside = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":");
  if (local) return url.protocol === "https:" || (url.protocol === "http:" && inside);
  return url.protocol === "https:" && !inside;
}

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

/** The form as the widget posted it, checked and cut to size. Undefined when it isn't one. */
export function parseHandoff(body: unknown): HandoffRequest | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  const email = text(raw.email, 200).trim();
  if (typeof raw.site !== "string" || !EMAIL.test(email)) return undefined;
  const transcript: TranscriptTurn[] = [];
  for (const turn of (Array.isArray(raw.transcript) ? raw.transcript.slice(-16) : []) as Record<string, unknown>[]) {
    const said = text(turn?.text, 700);
    if (!said) continue;
    const line: TranscriptTurn = { role: turn.role === "assistant" ? "assistant" : "user", text: said };
    if (line.role === "assistant" && MODES.includes(turn.kind as Mode)) line.kind = turn.kind as Mode;
    transcript.push(line);
  }
  const request: HandoffRequest = { site: raw.site, email, note: text(raw.note, 1000).trim(), path: text(raw.path, 200), transcript };
  if (typeof raw.guide === "string" && GUIDE_ID.test(raw.guide)) request.guide = raw.guide;
  return request;
}

/** What the company's webhook receives. */
export interface HandoffPost {
  kind: "handoff";
  site: string;
  site_name: string;
  at: string;
  /** Where to reply to the visitor. */
  email: string;
  note: string;
  /** Where the visitor was: the site they were on and the page within it. */
  origin: string | null;
  page: string;
  guide: string | null;
  transcript: TranscriptTurn[];
  /** The kinds of reply Haptic gave in this conversation, like "answer" and "cannot_help". */
  modes: Mode[];
}

/**
 * Posts the form to the company's webhook. Resolves to true when the webhook
 * took it. With a secret set, the post carries "X-Haptic-Signature":
 * "sha256=" and the hex HMAC-SHA256 of the body.
 */
export async function sendHandoff(site: SiteContext, request: HandoffRequest, origin: string | undefined, fetcher: typeof fetch, local = false): Promise<boolean> {
  const webhook = site.handoff?.webhook;
  if (!webhook || !webhookAllowed(webhook, local)) return false;
  const post: HandoffPost = {
    kind: "handoff",
    site: site.id,
    site_name: site.name,
    at: new Date().toISOString(),
    email: request.email,
    note: request.note,
    origin: origin ?? null,
    page: request.path,
    guide: request.guide ?? null,
    transcript: request.transcript,
    modes: [...new Set(request.transcript.flatMap((turn) => (turn.kind ? [turn.kind] : [])))],
  };
  const body = JSON.stringify(post);
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Haptic-Handoff/1" };
  if (site.handoff?.secret) headers["X-Haptic-Signature"] = `sha256=${await sign(site.handoff.secret, body)}`;
  try {
    const response = await fetcher(webhook, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    if (!response.ok) console.error(`handoff ${site.id}: the webhook answered ${response.status}.`);
    return response.ok;
  } catch (error) {
    console.error(`handoff ${site.id}: the webhook couldn't be reached.`, error instanceof Error ? error.message : error);
    return false;
  }
}

export async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
