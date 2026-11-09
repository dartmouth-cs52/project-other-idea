import css from "./ui/styles.css?inline";

// Haptic's single element on the customer's page. Everything else lives in
// its shadow root. It's shown as a manual popover so it renders in the top
// layer, above any z-index the page uses, including other popovers.

const HOST_STYLE = [
  "all: initial",
  "position: fixed",
  "inset: 0",
  "width: 100vw",
  "height: 100vh",
  "max-width: none",
  "max-height: none",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "background: transparent",
  "overflow: visible",
  "pointer-events: none",
  "z-index: 2147483647",
  "display: block",
].join(";");

/** Events from our UI that must not reach the page's own listeners. */
const CONTAINED_EVENTS = ["keydown", "keyup", "keypress", "focusin", "focusout", "input", "beforeinput"];

export interface Host {
  el: HTMLElement;
  layer: HTMLElement;
  mount: HTMLElement;
  destroy(): void;
}

export function createHost(): Host {
  const el = document.createElement("haptic-root");
  el.setAttribute("data-haptic-ignore", "");
  el.style.cssText = HOST_STYLE;

  const shadow = el.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const layer = document.createElement("div");
  layer.className = "layer";
  const mount = document.createElement("div");
  layer.append(mount);
  shadow.append(style, layer);

  const supportsPopover = typeof el.showPopover === "function";
  if (supportsPopover) el.popover = "manual";

  const show = () => {
    if (!supportsPopover || !el.isConnected) return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    } catch {
      // Not fatal: without the top layer we fall back to the z-index.
    }
  };

  // A native modal <dialog> makes everything outside it inert, which would
  // make our buttons unclickable. Live inside the dialog while it's open.
  const placeHost = () => {
    const modal = topModalDialog();
    const parent = modal ?? document.documentElement;
    if (el.parentNode !== parent) {
      parent.append(el);
    }
    show();
  };

  for (const type of CONTAINED_EVENTS) el.addEventListener(type, (event) => event.stopPropagation());

  const onToggle = (event: Event) => {
    if (event.target === el) return;
    if ((event as ToggleEvent).newState === "open" || (event as ToggleEvent).newState === "closed") {
      requestAnimationFrame(placeHost);
    }
  };
  document.addEventListener("toggle", onToggle, true);
  document.addEventListener("close", onToggle, true);

  // Frameworks sometimes wipe nodes they don't own. Put ourselves back.
  const reattach = new MutationObserver(() => {
    if (!el.isConnected) placeHost();
  });
  reattach.observe(document.documentElement, { childList: true });
  // Dialogs opened without a toggle event (older browsers) still flip "open".
  const dialogs = new MutationObserver((records) => {
    if (records.some((r) => (r.target as Element).tagName === "DIALOG")) placeHost();
  });
  dialogs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });

  placeHost();

  return {
    el,
    layer,
    mount,
    destroy() {
      reattach.disconnect();
      dialogs.disconnect();
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("close", onToggle, true);
      el.remove();
    },
  };
}

function topModalDialog(): HTMLDialogElement | undefined {
  let top: HTMLDialogElement | undefined;
  for (const dialog of document.querySelectorAll("dialog")) {
    try {
      if (dialog.matches(":modal")) top = dialog;
    } catch {
      return undefined;
    }
  }
  return top;
}
