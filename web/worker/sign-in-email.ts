// Haptic's sign-in email, the page every Haptic email sits on, and sending
// them through Resend.
//
// It follows DESIGN.md: Paper page, one Muted card, Ink text, one Ink button,
// sentence case, commas and periods only. The link sits behind the button and
// nowhere else in the HTML. Email apps strip web fonts, so Geist is asked for
// first and the system font stands in. worker/developer-email.ts is the other
// email drawn on the same page.

export type LinkType = "sign-in" | "email-verification" | "forget-password";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** The sender. FROM when left out. Any address at joinhaptic.com works once the domain is verified in Resend. */
  from?: string;
  /** Where a reply goes. REPLY_TO when left out. */
  replyTo?: string;
}

export interface SendEnv {
  /** Resend's API key, a Worker secret. Without it no email can be sent and sign-in by email fails. */
  RESEND_API_KEY?: string;
}

export const FROM = "Haptic <sign-in@joinhaptic.com>";
export const REPLY_TO = "hello@joinhaptic.com";

const COPY: Record<LinkType, { subject: string; heading: string; body: string; button: string; text: string }> = {
  "sign-in": {
    subject: "Sign in to Haptic",
    heading: "Sign in to Haptic",
    body: "Press the button to open your dashboard.",
    button: "Sign in",
    text: "Open this link to sign in to your dashboard.",
  },
  "email-verification": {
    subject: "Confirm your email for Haptic",
    heading: "Confirm your email",
    body: "Press the button to confirm this address is yours.",
    button: "Confirm email",
    text: "Open this link to confirm this address is yours.",
  },
  "forget-password": {
    subject: "Reset your Haptic password",
    heading: "Reset your password",
    body: "Press the button to choose a new password.",
    button: "Reset password",
    text: "Open this link to choose a new password.",
  },
};

// The inbox preview shows the hidden sentence first, then carries on into the email's
// visible text, which repeats it. Invisible spacers fill the preview so it stops at the sentence.
const PREVIEW_PADDING = "&#8199;&#847;&#65279;&#8203;".repeat(90);

const FONT = "Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
/** Inline type styles, on the DESIGN.md scale. */
export const type = (size: number, line: number, weight: 400 | 500) => `font-family:${FONT};font-size:${size}px;line-height:${line}px;font-weight:${weight};`;

/**
 * `id` is Neon's event id. Gmail threads emails that share a subject, and folds an ending it has
 * already shown behind "...", which could hide a returning person's newest button. A hidden id
 * at the end keeps each email's ending its own, and is the same on every retry of one event.
 */
export function signInEmail({ to, link, type: linkType, id }: { to: string; link: string; type: LinkType; id?: string }): Email {
  const copy = COPY[linkType] ?? COPY["sign-in"];
  const html = emailPage({
    title: copy.subject,
    preview: copy.body,
    id,
    card: `<h1 class="ink" style="margin:0 0 8px;${type(24, 32, 500)}letter-spacing:-0.02em;color:#1C1917;">${escape(copy.heading)}</h1>
<p class="muted" style="margin:0 0 24px;${type(16, 24, 400)}color:#78716C;">${escape(copy.body)}</p>
${emailButton(copy.button, link)}`,
  });
  // Read only by email apps that cannot show HTML, where a link to open is the only way in.
  const text = `${copy.heading}\n\n${copy.text}\n\n${link}\n\njoinhaptic.com\n`;
  return { to, subject: copy.subject, html, text };
}

/** One Ink pill button. The only place the link goes in the HTML. */
export function emailButton(label: string, link: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="button" style="background:#1C1917;border-radius:9999px;">
<a href="${escape(link)}" style="display:inline-block;padding:10px 24px;${type(16, 24, 500)}color:#FAFAF9;text-decoration:none;border-radius:9999px;">${escape(label)}</a>
</td>
</tr></table>`;
}

/**
 * The page every Haptic email sits on: Paper, the name, one Muted card holding
 * `card` (HTML, already escaped), and joinhaptic.com under it. `preview` is the
 * hidden line an inbox shows first.
 */
export function emailPage({ title, preview, card, id }: { title: string; preview: string; card: string; id?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<title>${escape(title)}</title>
<style>
a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
@media (prefers-color-scheme: dark) {
  .page { background: #1C1917 !important; }
  .card { background: #292524 !important; }
  .inner { background: #1C1917 !important; border-color: #44403C !important; }
  .ink { color: #F5F5F4 !important; }
  .muted { color: #A8A29E !important; }
  .button { background: #F5F5F4 !important; }
  .button a { color: #1C1917 !important; }
}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#FAFAF9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(preview)}${PREVIEW_PADDING}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAF9;">
<tr><td align="center" style="padding:48px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td class="ink" style="padding:0 0 24px;${type(16, 24, 500)}color:#1C1917;">Haptic</td></tr>
<tr><td class="card" style="background:#F5F5F4;border-radius:14px;padding:32px;">
${card}
</td></tr>
<tr><td style="padding:24px 0 0;${type(14, 20, 400)}"><a class="muted" href="https://joinhaptic.com" style="color:#78716C;text-decoration:none;">joinhaptic.com</a>${id ? `<span style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;opacity:0;">${escape(id)}</span>` : ""}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Hands an email to Resend. The idempotency key makes a repeat of the same request
 * within 24 hours answer as the first did, without sending again.
 * Status 0 means it was never tried, because the API key is missing or Resend could not be reached.
 */
export async function sendEmail(env: SendEnv, email: Email, idempotencyKey: string, fetcher: Fetch): Promise<{ ok: true; id: string } | { ok: false; status: number; detail: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, status: 0, detail: "RESEND_API_KEY is not set." };
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "user-agent": "haptic-web",
      },
      body: JSON.stringify({ from: email.from ?? FROM, to: [email.to], reply_to: email.replyTo ?? REPLY_TO, subject: email.subject, html: email.html, text: email.text }),
      // Neon waits 5 seconds for each try, so this gives up first and leaves time to say so. The dashboard waits as long.
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    return { ok: false, status: 0, detail: (error as Error).message };
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!response.ok || !data.id) return { ok: false, status: response.status, detail: data.message ?? data.name ?? "" };
  return { ok: true, id: data.id };
}
