import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { DockPosition, SiteAppearance } from "@haptic/protocol";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Overlay } from "./overlay.ts";
import { rememberLauncherHidden, type Phase, type Store } from "./store.ts";
import { isDark } from "./tone.ts";

export interface AppActions {
  ask: (question: string) => void;
  voiceStart: () => void;
  voiceEnd: () => void;
  stop: () => void;
  close: () => void;
  copy: () => void;
  toggleAsk: (open?: boolean) => void;
}

interface AppProps {
  store: Store;
  overlay: Overlay;
  actions: AppActions;
}

export function App({ store, overlay, actions }: AppProps) {
  if (!store.ready.value) return null;
  const { appearance } = store.config.value;
  const custom = /^#[0-9a-f]{6}$/i.test(appearance.accent);
  const classes = ["ui", store.pageDark.value ? "on-dark" : "", custom ? "custom-accent" : ""].filter(Boolean).join(" ");
  const style = {
    "--edge-x": `${appearance.edgeOffsetX}px`,
    "--edge-y": `${appearance.edgeOffsetY}px`,
    "--panel-width": `${appearance.panelWidth}px`,
    ...(custom ? { "--accent": appearance.accent, "--accent-fg": isDark(hexToRgb(appearance.accent)) ? "#ffffff" : "#0b0b0c" } : {}),
  };
  return (
    <div class={classes} style={style}>
      <Caption store={store} overlay={overlay} actions={actions} />
      <Dock store={store} actions={actions} />
    </div>
  );
}

const HOLD_MS = 300;

function resolvePanelPosition(appearance: SiteAppearance): DockPosition {
  return appearance.panelPosition === "launcher" ? appearance.position : appearance.panelPosition;
}

function Dock({ store, actions }: { store: Store; actions: AppActions }) {
  const { appearance, voiceEnabled } = store.config.value;
  const phase = store.phase.value;
  const busy = phase === "thinking" || phase === "responding" || phase === "waiting" || phase === "settling";
  const listening = phase === "listening";
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);

  // Click to type. Press and hold to talk, when voice is on.
  const onPointerDown = (event: PointerEvent) => {
    if (!voiceEnabled || busy || event.button !== 0) return;
    held.current = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    holdTimer.current = setTimeout(() => {
      held.current = true;
      actions.voiceStart();
    }, HOLD_MS);
  };
  const onPointerUp = () => {
    clearTimeout(holdTimer.current);
    if (held.current) actions.voiceEnd();
  };

  // A visitor who finds the launcher in the way can shrink it to a dot.
  // It only stays a dot while nothing is happening: opening Haptic another
  // way, or a running guide, brings the full launcher back for the moment.
  const setHidden = (hidden: boolean) => {
    store.launcherHidden.value = hidden;
    rememberLauncherHidden(hidden);
    if (hidden) actions.toggleAsk(false);
  };
  const idle = phase === "idle" && !store.askOpen.value;
  const collapsed = store.launcherHidden.value && idle;
  const panelPosition = resolvePanelPosition(appearance);
  const clearsLauncher = appearance.showLauncher && panelPosition === appearance.position;

  if (appearance.showLauncher && collapsed) {
    return (
      <div class={`launcher-dock ${appearance.position}`}>
        <button class="launcher-dot" type="button" aria-label="Show Haptic" title="Show Haptic" onClick={() => setHidden(false)}>
          <span class="dot-core">
            <PointerMark />
          </span>
        </button>
      </div>
    );
  }

  const launcherText = listening ? "Listening…" : busy ? "Stop" : appearance.launcherLabel;
  const iconOnly = appearance.launcherStyle === "icon";

  return (
    <>
      {store.askOpen.value && (
        <div class={`panel-dock ${panelPosition}${clearsLauncher ? " clears-launcher" : ""}`}>
          <AskBar store={store} actions={actions} />
        </div>
      )}
      {appearance.showLauncher && (
        <div class={`launcher-dock ${appearance.position}`}>
          <div class="launcher-wrap">
            <button
              class={`launcher${iconOnly ? " icon-only" : ""}${listening ? " listening" : ""}`}
              type="button"
              aria-label={iconOnly ? launcherText : undefined}
              aria-expanded={store.askOpen.value}
              title={voiceEnabled ? "Click to type. Hold to talk." : iconOnly ? launcherText : undefined}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(event) => voiceEnabled && event.preventDefault()}
              onClick={() => {
                if (held.current) {
                  held.current = false;
                  return;
                }
                if (busy) actions.stop();
                else actions.toggleAsk();
              }}
            >
              <PointerMark />
              {!iconOnly && <span>{launcherText}</span>}
            </button>
            {idle && (
              <button class="launcher-hide" type="button" aria-label="Hide Haptic button" title="Hide. A small dot stays in the corner to bring it back." onClick={() => setHidden(true)}>
                <CloseIcon size={10} />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AskBar({ store, actions }: { store: Store; actions: AppActions }) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus without scrolling the customer's page.
    input.current?.focus({ preventScroll: true });
  }, []);

  const submit = (event: Event) => {
    event.preventDefault();
    if (!value.trim()) return;
    actions.ask(value);
    setValue("");
  };

  return (
    <form class="askbar" onSubmit={submit} role="search">
      <input
        ref={input}
        value={value}
        onInput={(event) => setValue((event.target as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") actions.toggleAsk(false);
        }}
        placeholder={store.config.value.appearance.greeting ?? (store.config.value.voiceEnabled ? "Ask, or hold the button to talk…" : "Ask how to do something…")}
        aria-label="Ask Haptic"
        autocomplete="off"
        spellcheck={false}
        maxLength={300}
      />
      <button class="primary-button" type="submit" disabled={!value.trim()}>
        Ask
      </button>
    </form>
  );
}

const STATUS: Record<Phase, string> = {
  idle: "",
  listening: "Listening…",
  thinking: "Thinking…",
  responding: "Haptic",
  waiting: "Your turn",
  settling: "Looking…",
  answered: "Haptic",
  done: "Done",
  error: "Something went wrong",
};

function Caption({ store, overlay, actions }: AppProps) {
  const ref = useRef<HTMLDivElement>(null);
  const phase = store.phase.value;
  const target = overlay.target.value;
  const visible = phase !== "idle";
  const appearance = store.config.value.appearance;
  const panelPosition = resolvePanelPosition(appearance);
  const clearsLauncher = appearance.showLauncher && panelPosition === appearance.position;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!target || !visible) {
      el.style.left = "";
      el.style.top = "";
      return;
    }
    const update = () =>
      computePosition(target, el, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(30), flip({ fallbackPlacements: ["top-start", "right-start", "left-start"] }), shift({ padding: 12 })],
      }).then(({ x, y }) => {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });
    return autoUpdate(target, el, update);
  }, [target, visible]);

  if (!visible) return null;
  const busy = phase === "thinking" || phase === "settling" || phase === "listening";
  const step = store.step.value;
  const status = phase === "waiting" || phase === "responding" ? `${STATUS[phase]}${step > 0 ? ` · Step ${step + 1}` : ""}` : STATUS[phase];
  const text = phase === "error" ? store.error.value : store.text.value;

  return (
    <div
      ref={ref}
      class={`caption visible${target ? "" : ` docked ${panelPosition}${clearsLauncher ? " clears-launcher" : ""}`}`}
      role="dialog"
      aria-label="Haptic guide"
    >
      <div class="caption-header">
        <span class="status">
          <span class={`dot${busy ? " busy" : ""}`} />
          {status}
        </span>
        {text && phase !== "error" && (
          <button class="icon-button" type="button" title="Copy" aria-label="Copy answer" onClick={actions.copy}>
            <CopyIcon />
          </button>
        )}
        <button class="icon-button" type="button" title="Close" aria-label="Close guide" onClick={actions.close}>
          <CloseIcon />
        </button>
      </div>
      {store.question.value && phase !== "listening" && phase !== "error" && <div class="caption-question">{store.question.value}</div>}
      {(text || busy) && (
        <div class={`caption-body${phase === "error" ? " error" : ""}${phase === "listening" ? " live" : ""}`} aria-live="polite">
          {text || (phase === "settling" ? "Checking the page…" : phase === "listening" ? "Speak now. Let go when you're done." : "")}
        </div>
      )}
      {(phase === "waiting" || phase === "answered" || phase === "done" || phase === "error") && (
        <div class="caption-footer">
          {phase === "waiting" && <span class="caption-hint">Click the highlighted item to continue.</span>}
          {phase === "waiting" ? (
            <button class="text-button" type="button" onClick={actions.stop}>
              Stop guide
            </button>
          ) : (
            <button class="text-button" type="button" onClick={() => actions.toggleAsk(true)}>
              Ask something else
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function PointerMark() {
  return (
    <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3 L19 11 L12.4 12.6 L9 19 Z" fill="currentColor" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={size < 12 ? 2.6 : 2} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
