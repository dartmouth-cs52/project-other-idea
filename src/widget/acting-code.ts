import * as types from "../shared/types.ts";
import type { perform as performStep } from "./act.ts";
import { ACTING_BUILD, ACTING_FILE, ACTING_HAND, ACTING_SHARED, type ActingCode } from "./acting-handshake.ts";
import type { confirmationAction as findConfirmationAction, planFor as planStep, Plan } from "./gate.ts";
import * as observe from "./observe.ts";
import * as popups from "./popups.ts";
import * as says from "./says.ts";
import * as snapshot from "./snapshot.ts";

export type { DidLine, Heard, Listening } from "./act.ts";
export type { ActPlan, GateConfig, GateSession, Plan, StopPlan, VisitorPlan } from "./gate.ts";
export { SAYS } from "./says.ts";

// The code that acts ("Do it with me") is a second file, widget-act.js,
// served beside widget.js by the same server. Most sites never turn acting
// on, so the first file, which every visitor loads, carries none of it: the
// engine, the gate and the word tables are most of the widget's size. A site
// with acting on loads the second file as the widget starts (`loadActing`),
// from the address the first came from, so the site's script policy already
// allows it. The guide calls the three functions below; they reach the
// second file's own once it is in. If it never comes, the site's acting
// setting is set aside and the widget guides by pointer (index.ts).

/** How long the second file may take to arrive before the widget guides by pointer instead. */
const LOAD_MS = 15_000;

/**
 * What the second file uses of the first, by module (build.ts maps its
 * imports of these modules here). One copy of each: the note of which events
 * are Haptic's own (observe.ts) has to be the one the guide reads.
 */
export function sharedModules() {
  return { types, observe, popups, says, snapshot };
}

let code: ActingCode | undefined;
let loading: Promise<boolean> | undefined;

/**
 * Loads the second file, once, from beside `script` (the widget's own script
 * tag), with its nonce when it has one. True once its code is in; false when
 * it could not be loaded, ran without handing anything back, came from
 * another build, or took longer than `LOAD_MS`.
 */
export function loadActing(script: HTMLScriptElement): Promise<boolean> {
  loading ??= new Promise<boolean>((resolve) => {
    const slots = globalThis as unknown as Record<symbol, unknown>;
    let tag: HTMLScriptElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      delete slots[ACTING_SHARED];
      delete slots[ACTING_HAND];
      tag?.remove();
      tag = undefined;
      resolve(ok && !!code);
    };
    try {
      slots[ACTING_SHARED] = sharedModules();
      slots[ACTING_HAND] = (build: unknown, given: Partial<ActingCode> | undefined) => {
        if (build !== ACTING_BUILD || typeof given?.perform !== "function" || typeof given.planFor !== "function" || typeof given.confirmationAction !== "function") return;
        code = given as ActingCode;
        done(true);
      };
      tag = document.createElement("script");
      tag.async = true;
      if (script.nonce) tag.nonce = script.nonce;
      tag.addEventListener("load", () => done(!!code));
      tag.addEventListener("error", () => done(false));
      setSource(tag, new URL(`${ACTING_FILE}?v=${encodeURIComponent(ACTING_BUILD)}`, script.src).href);
      timer = setTimeout(() => done(false), LOAD_MS);
      (document.head ?? document.documentElement).appendChild(tag);
    } catch (error) {
      console.warn("[Haptic] Couldn't load the code that acts. Guiding by pointer instead.", error);
      done(false);
    }
  });
  return loading;
}

/** Sets a script's address, through a Trusted Types policy of Haptic's own where the page asks for one and allows it. */
function setSource(tag: HTMLScriptElement, url: string) {
  const trusted = (window as unknown as { trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(url: string): string }): { createScriptURL(url: string): unknown } } }).trustedTypes;
  if (trusted) {
    try {
      tag.src = trusted.createPolicy("haptic-acting", { createScriptURL: (given) => given }).createScriptURL(url) as string;
      return;
    } catch {
      // The page allows no policy of that name. The plain address is tried, and refused if the page requires one.
    }
  }
  tag.src = url;
}

// What the guide calls. Only a guide that acts calls them, and it acts only once the second file is in (index.ts).

export const perform: typeof performStep = (step, ctx) =>
  code ? code.perform(step, ctx) : Promise.resolve({ kind: "visitor", reason: "failed", el: step.plan.el, say: "I couldn't do this one. Do it yourself and I'll carry on.", event: "You could not do this step, so the visitor has it." });

export const planFor: typeof planStep = (reply, el, listed, session, config): Plan =>
  code ? code.planFor(reply, el, listed, session, config) : el?.isConnected ? { kind: "visitor", reason: "acting-off", el, say: reply.say, event: "" } : { kind: "again", reason: "changed" };

export const confirmationAction: typeof findConfirmationAction = (dialog, host) => code?.confirmationAction(dialog, host);
