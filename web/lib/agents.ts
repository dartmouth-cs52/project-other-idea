// Links that open a coding agent with a prompt filled in, for the "Onboard your
// agent" pill (components/app/agent-pill.tsx).
//
// Based on PostHog's AgentPromptButton (frontend/src/lib/components/AgentPromptButton/AgentPromptButton.tsx),
// which builds the same three links. truncatePrompt below is adapted from it.
//
//   MIT License. Copyright (c) 2020-2026 PostHog Inc.
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute,
//   sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
//   NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
//   OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
//   CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// Each link was checked against the agent's own documentation:
//
//   Claude Code  claude-cli://open?q=<prompt>, URL-encoded, at most 5,000 characters. Filled in and
//                never sent until Enter. With no cwd or repo it opens in the home folder. Works once
//                Claude Code has been used on that computer, which registers the link.
//                https://code.claude.com/docs/en/deep-links
//   Cursor       cursor://anysphere.cursor-deeplink/prompt?text=<prompt>, URL-encoded, at most 10,000
//                characters. "Deeplinks never trigger automatic execution." The same path under
//                https://cursor.com/link/ opens it from the web.
//                https://cursor.com/docs/reference/deeplinks
//   Codex        codex://new?prompt=<prompt>, URL-encoded. Sets the composer text and "doesn't send the
//                prompt automatically". https://learn.chatgpt.com/docs/reference/commands, Deep links
//
// PostHog encodes Cursor's text twice, because Cursor decodes the whole link before reading its
// parameters. Haptic's prompt holds no & = # + or %, so once, as Cursor's documentation shows, reads
// the same, and a test holds the prompt to that.
//
// A link to an app that isn't installed does nothing at all, so the pill copies the prompt first
// and says whether the app opened (lib/hand-off.ts).

export type AgentId = "claude" | "cursor" | "codex";

export interface Agent {
  id: AgentId;
  /** The product's own name, as its maker writes it. */
  name: string;
  link: (prompt: string) => string;
  /** Where to get it, for when the link opened nothing. */
  get: string;
}

const CLAUDE_CODE_MAX_PROMPT_CHARS = 5_000;
/** Cap for an app that documents none, well inside what a computer passes to an app. */
const UNDOCUMENTED_MAX_PROMPT_CHARS = 4_000;
const CURSOR_MAX_PROMPT_CHARS = 4_000;

/** Cuts a prompt to length without splitting an emoji, which encodeURIComponent would throw on. From PostHog. */
export function truncatePrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;
  const lastCode = prompt.charCodeAt(maxChars - 1);
  const end = lastCode >= 0xd800 && lastCode <= 0xdbff ? maxChars - 1 : maxChars;
  return prompt.slice(0, end);
}

export const AGENTS: Agent[] = [
  {
    id: "claude",
    name: "Claude Code",
    link: (prompt) => `claude-cli://open?q=${encodeURIComponent(truncatePrompt(prompt, CLAUDE_CODE_MAX_PROMPT_CHARS))}`,
    get: "https://claude.com/product/claude-code",
  },
  {
    id: "cursor",
    name: "Cursor",
    link: (prompt) => `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(truncatePrompt(prompt, CURSOR_MAX_PROMPT_CHARS))}`,
    get: "https://cursor.com/download",
  },
  {
    id: "codex",
    name: "Codex",
    link: (prompt) => `codex://new?prompt=${encodeURIComponent(truncatePrompt(prompt, UNDOCUMENTED_MAX_PROMPT_CHARS))}`,
    get: "https://chatgpt.com/codex",
  },
];
