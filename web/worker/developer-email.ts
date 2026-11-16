// The email a company sends its developer from the dashboard: who asked, the
// install page, the prompt for a coding agent and the tag itself. It sits on the
// same page as the sign-in email (worker/sign-in-email.ts) and goes through
// Resend from install@joinhaptic.com, with replies going to the person who sent it.
//
// It goes to any address the sender types, so it carries no words the sender
// chooses. Who asked is their sign-in address, which they proved by signing in,
// never their profile name. The site is named by its host, from the address
// stored when it was added. Everything else is fixed text, the site's id and
// Haptic's own links.

import { agentPrompt, scriptTag } from "../lib/install";
import { emailButton, emailPage, escape, type Email, type } from "./sign-in-email";

export const INSTALL_FROM = "Haptic <install@joinhaptic.com>";

/** The most of a site's host the subject shows, ellipsis included. */
const SUBJECT_HOST = 80;

export interface DeveloperEmailInput {
  /** The developer. */
  to: string;
  /** Who asked: their sign-in address. */
  sender: { email: string };
  /** The site's address, like https://app.example.com. */
  siteOrigin: string;
  siteId: string;
  /** joinhaptic.com, or the preview it was sent from. */
  installOrigin: string;
  scriptUrl: string;
}

/** A value that can't go in an email: it holds a web address, or an @ where none belongs. */
export class UnsafeText extends Error {}

/** Control characters, and the invisible ones that change direction or hide text: right-to-left overrides, zero-width spaces and the like. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;

/**
 * A value as it may go in an email: invisible characters taken out, and
 * refused if it holds a web address, or an @ anywhere but the one an email
 * address has (`at`).
 */
export function emailText(value: string, { at = false }: { at?: boolean } = {}): string {
  const clean = value.replace(INVISIBLE, "").trim();
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(clean)) throw new UnsafeText("That holds a web address.");
  const ats = clean.split("@").length - 1;
  if (at ? ats !== 1 : ats !== 0) throw new UnsafeText("That holds an @ where none belongs.");
  return clean;
}

export function developerEmail(input: DeveloperEmailInput): Email {
  const host = emailText(URL.canParse(input.siteOrigin) ? new URL(input.siteOrigin).host : input.siteOrigin);
  const who = emailText(input.sender.email, { at: true });
  const link = `${input.installOrigin}/install/?site=${input.siteId}`;
  const prompt = agentPrompt(input.installOrigin, input.siteId);
  const tag = scriptTag(input.scriptUrl, input.siteId);
  // A host can be 253 characters. The subject shows at most 80 of it, and the body all of it.
  const subject = `${who} asked you to add Haptic to ${host.length > SUBJECT_HOST ? `${host.slice(0, SUBJECT_HOST - 1)}…` : host}`;
  const lead = `${who} asked you to add Haptic to ${host}. It is one script tag on every page, including the pages behind the login. Reply to this email to reach them.`;
  const stranger = `If you don't know ${who}, ignore this email.`;

  const label = (text: string) => `<p class="ink" style="margin:24px 0 8px;${type(14, 20, 500)}color:#1C1917;">${escape(text)}</p>`;
  const code = (text: string) =>
    `<div class="inner ink" style="background:#FFFFFF;border:1px solid #E7E5E4;border-radius:10px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:20px;color:#1C1917;word-break:break-all;">${escape(text)}</div>`;

  const html = emailPage({
    title: subject,
    preview: `${who} asked you to add Haptic to ${host}.`,
    card: `<h1 class="ink" style="margin:0 0 8px;${type(24, 32, 500)}letter-spacing:-0.02em;color:#1C1917;">Add Haptic to ${escape(host)}</h1>
<p class="muted" style="margin:0 0 24px;${type(16, 24, 400)}color:#78716C;">${escape(lead)}</p>
${emailButton("Open the install steps", link)}
${label("Using a coding agent, such as Claude Code, Cursor or Codex. Paste this into it, in the app's folder.")}
${code(prompt)}
${label("Or add the tag yourself, in the layout every page shares.")}
${code(tag)}
<p class="muted" style="margin:24px 0 0;${type(14, 20, 400)}color:#78716C;">${escape(stranger)}</p>`,
  });

  // Read by email apps that cannot show HTML.
  const text = `${lead}\n\nThe install steps, for each kind of stack:\n${link}\n\nUsing a coding agent, such as Claude Code, Cursor or Codex? Paste this into it, in the app's folder:\n${prompt}\n\nOr add the tag yourself, in the layout every page shares:\n${tag}\n\n${stranger}\n\njoinhaptic.com\n`;
  return { to: input.to, subject, html, text, from: INSTALL_FROM, replyTo: who };
}
