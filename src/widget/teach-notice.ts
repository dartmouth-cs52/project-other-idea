import { adoptStyles, make } from "./ui.ts";

// The notice a teaching link shows when it cannot be used, and the top layer
// Haptic's teaching elements go in. In the widget's first file, since a link
// that cannot be used, or teach mode that could not be loaded, is said so on
// the page whatever happens: nothing about a teaching link fails silently.

const NOTICE_CSS = `
:host { all: initial; position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483647; margin: 0; padding: 0; border: 0;
  background: transparent; overflow: visible; font: 14px/20px system-ui, -apple-system, "Segoe UI", sans-serif; color: #fafaf9; }
* { box-sizing: border-box; }
.notice { display: flex; align-items: center; gap: 12px; width: min(560px, calc(100vw - 32px)); padding: 12px 12px 12px 16px; border-radius: 14px;
  background: #1c1917; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.notice p { flex: 1; margin: 0; }
button { font: inherit; cursor: pointer; flex: none; height: 32px; border: 1px solid #44403c; border-radius: 999px; padding: 0 14px; background: transparent; color: #fafaf9; }
`;

/** A short notice on the page that a teaching link could not be used, with a way to close it. Never silent. */
export function showNotice(message: string, accent: string) {
  const host = document.createElement("haptic-teach-notice");
  host.style.setProperty("--accent", accent);
  const root = host.attachShadow({ mode: "open" });
  adoptStyles(root, NOTICE_CSS);
  const close = make("button", { type: "button" }, "Close");
  root.append(make("div", { class: "notice", role: "alert" }, make("p", {}, message), close));
  close.addEventListener("click", () => host.remove());
  document.documentElement.appendChild(host);
  raise(host);
}

/** Puts our element in the top layer, above anything the page stacks, when the browser can. */
export function raise(host: HTMLElement) {
  try {
    if (!host.hasAttribute("popover")) host.setAttribute("popover", "manual");
    host.showPopover();
  } catch {
    // No popover support, or shown already. The fixed position and z-index still apply.
  }
}

