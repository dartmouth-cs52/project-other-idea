// The email a company sends its developer from the dashboard: who asked, the
// install page, the prompt for a coding agent and the tag itself. It sits on the
// same page as the sign-in email (worker/sign-in-email.ts) and goes through
// Resend from install@joinhaptic.com, with replies going to the person who sent it.

import { agentPrompt, scriptTag } from "../lib/install";
import { emailButton, emailPage, escape, type Email, type } from "./sign-in-email";

export const INSTALL_FROM = "Haptic <install@joinhaptic.com>";

export interface DeveloperEmailInput {
  /** The developer. */
  to: string;
  /** Who asked: their email, and their name when they gave one. */
  sender: { email: string; name: string };
  /** The site's address, like https://app.example.com. */
  siteOrigin: string;
  siteId: string;
  /** joinhaptic.com, or the preview it was sent from. */
  installOrigin: string;
  scriptUrl: string;
}

/** A name or address as it may go in a subject: one line, no control characters, not too long. */
function oneLine(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function developerEmail(input: DeveloperEmailInput): Email {
  const host = URL.canParse(input.siteOrigin) ? new URL(input.siteOrigin).host : input.siteOrigin;
  const name = oneLine(input.sender.name, 80);
  const who = name || input.sender.email;
  const whoInFull = name ? `${name} (${input.sender.email})` : input.sender.email;
  const link = `${input.installOrigin}/install/?site=${input.siteId}`;
  const prompt = agentPrompt(input.installOrigin, input.siteId);
  const tag = scriptTag(input.scriptUrl, input.siteId);
  const subject = `${oneLine(who, 80)} asked you to add Haptic to ${host}`;
  const lead = `${whoInFull} asked you to add Haptic to ${host}. It is one script tag on every page, including the pages behind the login. Reply to this email to reach ${who}.`;

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
${code(tag)}`,
  });

  // Read by email apps that cannot show HTML.
  const text = `${lead}\n\nThe install steps, for each kind of stack:\n${link}\n\nUsing a coding agent, such as Claude Code, Cursor or Codex? Paste this into it, in the app's folder:\n${prompt}\n\nOr add the tag yourself, in the layout every page shares:\n${tag}\n\njoinhaptic.com\n`;
  return { to: input.to, subject, html, text, from: INSTALL_FROM, replyTo: input.sender.email };
}
