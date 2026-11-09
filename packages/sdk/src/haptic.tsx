import { serializeSnapshot } from "@haptic/protocol";
import { effect } from "@preact/signals";
import { render } from "preact";
import { matchesShortcut, type HapticOptions } from "./config.ts";
import { onNavigate } from "./guide/navigation.ts";
import { GuideController, type GuideEventName, type GuideListener } from "./guide/session.ts";
import { createHost, type Host } from "./host.ts";
import { ApiClient, ApiError } from "./net/api.ts";
import { startLearning } from "./outline/collect.ts";
import { takeSnapshot } from "./snapshot/index.ts";
import { App, type AppActions } from "./ui/App.tsx";
import { Overlay } from "./ui/overlay.ts";
import { createStore } from "./ui/store.ts";
import { pageIsDark } from "./ui/tone.ts";
import { MicPermissionGranted, VoiceController } from "./voice/controller.ts";

type HapticEvent = GuideEventName | "open" | "close";
type Context = Record<string, string | number | boolean>;

/** The object exposed as window.Haptic. */
export interface HapticApi {
  version: string;
  open(): void;
  close(): void;
  ask(question: string, options?: { speak?: boolean }): void;
  stop(): void;
  setContext(context: Context): void;
  on(event: HapticEvent, listener: GuideListener): () => void;
  debug: {
    snapshot(): string;
    /** The structured snapshot, for building eval cases. */
    capture(): unknown;
    point(id: string): void;
    /** The element Haptic is pointing at right now, if any. */
    target(): Element | null;
    /** Current guide phase, e.g. "waiting". */
    phase(): string;
  };
}

export class Haptic {
  private readonly store = createStore();
  private readonly api: ApiClient;
  private readonly listeners = new Map<HapticEvent, Set<GuideListener>>();
  private context: Context = {};
  private host?: Host;
  private overlay?: Overlay;
  private guide?: GuideController;
  private voice?: VoiceController;

  constructor(private readonly options: HapticOptions) {
    this.api = new ApiClient(options.apiBase, options.key);
  }

  async start() {
    const host = createHost();
    this.host = host;
    const overlay = new Overlay(host.layer, host.el);
    this.overlay = overlay;
    this.voice = new VoiceController(this.api);
    this.guide = new GuideController({
      api: this.api,
      voice: this.voice,
      overlay,
      store: this.store,
      host: host.el,
      context: () => this.context,
      emit: (name, detail) => this.emit(name, detail),
    });

    render(<App store={this.store} overlay={overlay} actions={this.actions} />, host.mount);

    if (this.options.shortcut) {
      const shortcut = this.options.shortcut;
      window.addEventListener(
        "keydown",
        (event) => {
          if (!matchesShortcut(event, shortcut)) return;
          event.preventDefault();
          this.actions.toggleAsk();
        },
        true,
      );
    }

    try {
      const session = await this.api.ensureSession();
      this.store.config.value = session.config;
      overlay.setAccent(session.config.appearance.accent);
      this.store.ready.value = true;
      this.watchTone(host);
      if (session.config.learningEnabled) startLearning(this.api, host.el);
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : "could not reach the Haptic API";
      console.warn(`[Haptic] Not starting: ${reason}`);
      return;
    }

    await this.guide.resume();
  }

  /** Re-judge the page's tone whenever our UI changes or the route does. */
  private watchTone(host: Host) {
    const update = () => {
      try {
        this.store.pageDark.value = pageIsDark(host.el);
      } catch {
        // Keep the previous tone.
      }
    };
    update();
    effect(() => {
      void this.store.phase.value;
      if (this.store.askOpen.value || this.store.phase.value !== "idle") update();
    });
    onNavigate(() => setTimeout(update, 400));
  }

  private readonly actions: AppActions = {
    ask: (question) => {
      this.store.askOpen.value = false;
      void this.guide?.ask(question);
    },
    stop: () => this.guide?.stop(),
    close: () => {
      this.guide?.stop();
      this.emit("close", {});
    },
    voiceStart: async () => {
      const { store, voice, guide, overlay } = this;
      if (!voice || !guide || !overlay || !store.config.value.voiceEnabled) return;
      guide.stop();
      store.askOpen.value = false;
      store.phase.value = "listening";
      store.text.value = "";
      overlay.follow();
      try {
        await voice.startListening((text) => {
          if (store.phase.value === "listening") store.text.value = text;
        });
      } catch (error) {
        overlay.hide();
        if (error instanceof MicPermissionGranted) {
          store.phase.value = "answered";
          store.text.value = "Microphone is on. Hold the button and speak.";
        } else {
          console.warn("[Haptic] Voice failed:", error);
          store.phase.value = "error";
          store.error.value = error instanceof DOMException ? "Haptic needs microphone access for voice questions." : "Voice isn't available right now. Try typing instead.";
        }
      }
    },
    voiceEnd: async () => {
      const { store, voice, guide, overlay } = this;
      if (!voice || !guide || store.phase.value !== "listening") return;
      store.phase.value = "thinking";
      let question = "";
      try {
        question = await voice.stopListening();
      } catch (error) {
        console.warn("[Haptic] Voice failed:", error);
        overlay?.hide();
        store.phase.value = "error";
        store.error.value = "Voice isn't available right now. Try typing instead.";
        return;
      }
      if (store.phase.value !== "thinking") return;
      if (!question) {
        overlay?.hide();
        store.phase.value = "answered";
        store.text.value = "I didn't catch that. Hold the button and try again.";
        return;
      }
      void guide.ask(question, { speak: true });
    },
    copy: () => {
      const text = this.guide?.answerText;
      if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
    },
    toggleAsk: (open) => {
      const next = open ?? !this.store.askOpen.value;
      // A finished answer gives way to the new question.
      if (next && !this.guide?.active) this.guide?.stop();
      this.store.askOpen.value = next;
      if (next) {
        // Opening the bar warms the session so the first question is quick.
        void this.api.ensureSession().catch(() => undefined);
        this.emit("open", {});
      }
    },
  };

  publicApi(): HapticApi {
    return {
      version: __HAPTIC_VERSION__,
      open: () => this.actions.toggleAsk(true),
      close: () => this.actions.close(),
      ask: (question, options) => {
        this.store.askOpen.value = false;
        void this.guide?.ask(question, { speak: Boolean(options?.speak && this.store.config.value.voiceEnabled) });
      },
      stop: () => this.actions.stop(),
      setContext: (context) => {
        this.context = { ...context };
      },
      on: (event, listener) => {
        const set = this.listeners.get(event) ?? new Set();
        set.add(listener);
        this.listeners.set(event, set);
        return () => set.delete(listener);
      },
      debug: {
        snapshot: () => {
          if (!this.host) return "";
          const { snapshot, ms } = takeSnapshot(this.host.el);
          const text = serializeSnapshot(snapshot);
          console.log(`[Haptic] snapshot took ${ms.toFixed(1)}ms\n${text}`);
          return text;
        },
        capture: () => (this.host ? takeSnapshot(this.host.el).snapshot : null),
        point: (id) => {
          if (!this.host || !this.overlay) return;
          const registry = this.guide?.lastRegistry ?? takeSnapshot(this.host.el).registry;
          const el = registry.resolve(id);
          if (!el) {
            console.warn(`[Haptic] No element ${id} in the last snapshot.`);
            return;
          }
          void this.overlay.pointAt(el);
        },
        target: () => this.overlay?.target.value ?? null,
        phase: () => this.store.phase.value,
      },
    };
  }

  private emit(name: HapticEvent, detail: Record<string, unknown>) {
    for (const listener of this.listeners.get(name) ?? []) {
      try {
        listener(detail);
      } catch (error) {
        console.error(`[Haptic] "${name}" listener failed`, error);
      }
    }
  }
}
