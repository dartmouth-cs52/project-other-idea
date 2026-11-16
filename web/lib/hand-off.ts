// Handing a prompt to a coding agent without ever failing silently. Copying can
// be refused by the browser, and a link to an app that is not installed does
// nothing at all, so each step reports what happened and the page says so.
//
// No React here, so test/browser/agent-pill.test.ts can run it in a real browser.

export type CopyResult = { ok: true } | { ok: false; reason: string };

/**
 * Copies text. The clipboard API needs a secure page and permission, so when it
 * is refused the older copy command is tried on a hidden text box. If both
 * fail the caller shows the text to copy by hand.
 */
export async function copyText(text: string, doc: Document = document): Promise<CopyResult> {
  const nav = doc.defaultView?.navigator;
  if (nav?.clipboard?.writeText && doc.defaultView?.isSecureContext) {
    try {
      await nav.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // Refused, or the page lost focus. Falls through to the older way.
    }
  }
  try {
    const box = doc.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    box.style.pointerEvents = "none";
    doc.body.appendChild(box);
    box.select();
    const copied = doc.execCommand("copy");
    box.remove();
    if (copied) return { ok: true };
  } catch {
    // Falls through.
  }
  return { ok: false, reason: "Your browser didn't let the page copy." };
}

/** How long to wait for the agent's app to take focus before saying it didn't open. */
export const OPEN_WAIT_MS = 1500;
/** An app that asks first ("Open Cursor?") can take longer. A later switch still counts, and the note changes then. */
export const LATE_OPEN_MS = 15_000;

export type OpenResult = "opened" | "nothing" | "blocked";

/**
 * Opens a link to an app, such as claude-cli://open?q=…, and watches whether
 * the page lost focus, which is what happens when the computer hands the link
 * to an app. A link no app takes does nothing, with no error, so "nothing" is
 * the answer when focus stays. `onLate` hears of a switch that comes after the
 * answer, once someone has said yes to the browser's "Open this app?" question.
 */
export function openAppLink(link: string, options: { win?: Window; waitMs?: number; lateMs?: number; onLate?: () => void } = {}): Promise<OpenResult> {
  const win = options.win ?? window;
  const doc = win.document;
  const waitMs = options.waitMs ?? OPEN_WAIT_MS;
  return new Promise((resolve) => {
    let answered = false;
    let left = false;
    let frame: HTMLIFrameElement | undefined;
    const leave = () => {
      if (left) return;
      left = true;
      if (!answered) {
        answered = true;
        resolve("opened");
      } else options.onLate?.();
      stop();
    };
    const onVisibility = () => doc.visibilityState === "hidden" && leave();
    win.addEventListener("blur", leave);
    doc.addEventListener("visibilitychange", onVisibility);
    const late = win.setTimeout(() => stop(), options.lateMs ?? LATE_OPEN_MS);
    function stop() {
      win.removeEventListener("blur", leave);
      doc.removeEventListener("visibilitychange", onVisibility);
      win.clearTimeout(late);
      frame?.remove();
    }

    try {
      if (isChromium(win)) {
        // Chrome and Edge hand a link like this to the app, or do nothing, and stay on the page either way.
        win.location.assign(link);
      } else {
        // Firefox and Safari would show an error page for a link no app takes, so it goes in a hidden frame.
        frame = doc.createElement("iframe");
        frame.style.display = "none";
        frame.src = link;
        doc.body.appendChild(frame);
      }
    } catch {
      answered = true;
      stop();
      resolve("blocked");
      return;
    }
    win.setTimeout(() => {
      if (answered) return;
      answered = true;
      resolve(left ? "opened" : "nothing");
    }, waitMs);
  });
}

function isChromium(win: Window): boolean {
  const nav = win.navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } };
  if (nav.userAgentData?.brands?.some((item) => /Chromium|Google Chrome|Microsoft Edge/.test(item.brand))) return true;
  return /\b(Chrome|Chromium|Edg)\//.test(nav.userAgent) && !/\bFirefox\//.test(nav.userAgent);
}
