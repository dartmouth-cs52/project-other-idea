// Decides whether what a visitor just did was the step they were shown.
//
// Nothing here touches a page. The widget turns what it sees (a press, a
// click, a key, what has become of the pointed control) into plain facts, and
// `hear` turns a run of those facts into a verdict. That keeps the decision in
// one place where it can be tested with nothing but sequences of events.

/** A field counts as filled in once typing pauses this long. */
export const TYPING_PAUSE_MS = 1200;
/** Haptic's own typing has ended once it pauses this long: it types at an even pace and stops when the text is in. */
export const OWN_TYPING_PAUSE_MS = 300;
/** How long after a press or a key the page is watched for what it did about it. */
export const OUTCOME_WINDOW_MS = 2000;
/** A click follows the mouse coming up at once. A press with none by this long after has had no click. */
export const CLICK_AFTER_RELEASE_MS = 80;
/** A list or calendar that stays open is done with once nothing has been picked in it for this long. */
export const PICKS_QUIET_MS = 2500;
/** A visitor who clicks into a field, sees its list of choices open, and does nothing for this long has stopped. */
export const LIST_STOPPED_MS = 1200;
/** A change to the address after "?" or "#" this soon after the visitor used the control is the control's doing. */
export const ADDRESS_BELONGS_MS = 1500;

/** What the pointer is on, as far as hearing goes. */
export interface Pointed {
  /** Text is typed into it, so clicking into it is not the action. */
  typed: boolean;
  /** A real dropdown, whose list the browser draws. */
  select: boolean;
  /** A tick box or a radio button. */
  ticked: boolean;
  /** Keys the sentence asks for, as `keysAsked` gives them. */
  keys: string[];
  /** Any click off the control ends the wait, blank space included: the pointer may be the last word. */
  anyClick: boolean;
  /** How long typing must pause to count as done. `TYPING_PAUSE_MS` when not given. */
  typingPauseMs?: number;
}

/**
 * The events Haptic itself dispatches while it acts. A page's script can
 * dispatch the same kinds of event, and those are not heard as anyone's step
 * (see `waitForAction` in guide.ts); Haptic's own are, but only while Haptic
 * is the one acting. Kept by the event object itself, so an event a page
 * dispatches from inside its handler for one of ours is still the page's.
 */
const own = new WeakSet<Event>();

/** Marks an event as Haptic's own, before it is dispatched. Returns it. */
export function markOwn<E extends Event>(event: E): E {
  own.add(event);
  return event;
}

/** Whether Haptic dispatched this event itself. */
export function isOwn(event: Event): boolean {
  return own.has(event);
}

/** Where a press or a click landed. Controls are numbered by the caller so that two events can be compared. */
export interface Where {
  /** On the pointed control, or on the label that stands in for it. */
  onTarget: boolean;
  /** Every control the event passed through, innermost first. Empty for blank space and plain text. */
  controls: number[];
  /** A name for the innermost control that is safe to send, or "". */
  name: string;
  /** That control was on the page when the pointer went up. */
  known: boolean;
  /** Inside what the pointed control opened: its list, its menu, its calendar. */
  inPopup: boolean;
  /** That control is a box around the pointed one. */
  aroundTarget: boolean;
}

/** What has become of the pointed control and the page since the pointer went up. */
export interface Fate {
  /** The pointed control is no longer in the page, or is no longer drawn. */
  gone: boolean;
  /** Its state or its name is not what it was. */
  changed: boolean;
  /** A dialog opened or closed. */
  dialog: boolean;
  /** The page path is not what it was. */
  path: boolean;
  /** The address differs, if only after "?" or "#". */
  address: boolean;
  /** What was last pressed is gone, no longer drawn, or no longer under the point that was pressed. */
  pressGone: boolean;
  /** What the pointed control opened is still open. */
  popupOpen: boolean;
  /** A list of choices is open for the pointed field. */
  listOpen: boolean;
  /** The page has begun to load another one. */
  leaving: boolean;
}

export type Seen =
  | { type: "press"; at: number; where: Where }
  | { type: "release"; at: number }
  /** The press was called off: a touch that turned into a scroll. */
  | { type: "cancel"; at: number }
  | { type: "click"; at: number; where: Where }
  /** A key went down outside the widget. `inTyped` is true when the keyboard was in something text is typed into. */
  | { type: "key"; at: number; key: string; inTarget: boolean; inTyped: boolean }
  /** Something was typed, picked or ticked. `byPage` when the page's script fired it, as a calendar does when it writes the picked day into its field. */
  | { type: "input"; at: number; inTarget: boolean; byPage?: boolean }
  /** The pointed control lost the keyboard. */
  | { type: "left"; at: number }
  /** The window lost the keyboard to a frame inside the pointed control: a click in the frame, which the page never hears. */
  | { type: "frame"; at: number }
  | { type: "tick"; at: number; fate: Fate };

export type Verdict =
  /** They used the pointed control. */
  | { how: "clicked" | "filled" | "opened"; onTarget: true; strayed: false }
  | { how: "key"; key: string; onTarget: true; strayed: false }
  /** They picked from what the pointed control opened. */
  | { how: "chose"; names: string[]; onTarget: true; strayed: false }
  /** They used another control. */
  | { how: "other"; name: string; onTarget: false; strayed: true }
  /** They clicked off a pointer that was the last word. */
  | { how: "elsewhere"; onTarget: false; strayed: true }
  /** The address changed with nothing done that was seen: Back, Forward, a link in another frame. */
  | { how: "left"; onTarget: false; strayed: true }
  /** The page changed after something they did that could not be told apart. Not a wrong click. */
  | { how: "unknown"; onTarget: false; strayed: false }
  /** The page drew the pointed control again and nothing was done: it only needs finding. */
  | { how: "redrawn"; onTarget: false; strayed: false };

export interface Heard {
  /** The press whose click has not come yet. */
  press?: { at: number; where: Where; released?: number };
  /** The last press or key that could have been a step. */
  gesture?: { at: number; onTarget: boolean; key?: string };
  /** The visitor has clicked into the field, so what opens next belongs to it. */
  opened?: number;
  /** When typing in the pointed control was last heard. */
  typed?: number;
  /** When the visitor last typed or clicked in the pointed control. */
  usedAt?: number;
  /** What was picked in the pointed control's popup so far. */
  picks: string[];
  pickedAt?: number;
  verdict?: Verdict;
}

export const nothingHeard = (): Heard => ({ picks: [] });

const GESTURE_KEYS = new Set(["enter", " ", "escape", "tab", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
/** Keys that do something even in a field, where the others are typing. */
const ACT_IN_FIELD = new Set(["enter", "escape", "tab"]);

/**
 * Whether the next tick should come soon. With nothing pending, a slow look
 * now and then is enough to notice an address that changed by itself.
 */
export function waiting(heard: Heard, now: number): boolean {
  const lately = (since: number | undefined, ms: number) => since !== undefined && now - since <= ms;
  return !!heard.press || heard.typed !== undefined || heard.picks.length > 0 || lately(heard.opened, 5000) || lately(heard.gesture?.at, OUTCOME_WINDOW_MS);
}

/** Takes one more fact. The verdict, once there is one, is on what comes back, and nothing after it is heard. */
export function hear(heard: Heard, seen: Seen, pointed: Pointed): Heard {
  if (heard.verdict) return heard;
  const next: Heard = { ...heard, picks: [...heard.picks] };
  const say = (verdict: Verdict): Heard => ({ ...next, verdict });
  const used: Verdict = { how: "clicked", onTarget: true, strayed: false };
  const filled: Verdict = { how: "filled", onTarget: true, strayed: false };

  /** A press or a click that was the action, on whatever it landed. */
  const acted = (where: Where, at: number): Heard => {
    if (where.onTarget) {
      next.usedAt = at;
      // For a field, clicking into it is not the action. Typing or picking is.
      if (!pointed.typed && !pointed.select) return say(used);
      // A dropdown that already shows the right choice gives nothing to hear: the
      // visitor opens it, picks what was there, and nothing reports a change.
      // The second click, which is the list closing, is the pick.
      if (pointed.select && next.opened !== undefined) return say(filled);
      next.opened = at;
      return next;
    }
    // A click in the pointed control's own list or calendar is never a wrong click. It is kept until the popup is done with.
    if (where.inPopup || (next.opened !== undefined && where.controls.length > 0 && !where.known && !where.aroundTarget)) {
      next.picks.push(where.name);
      next.pickedAt = at;
      next.usedAt = at;
      return next;
    }
    // Blank space, plain text, or a box around the control: not worth a step by itself. What the page does next may be.
    if (!where.controls.length || where.aroundTarget) return pointed.anyClick ? say({ how: "elsewhere", onTarget: false, strayed: true }) : next;
    return say({ how: "other", name: where.name, onTarget: false, strayed: true });
  };

  switch (seen.type) {
    case "press":
      next.press = { at: seen.at, where: seen.where };
      next.gesture = { at: seen.at, onTarget: seen.where.onTarget };
      return next;
    case "release":
      if (next.press) next.press = { ...next.press, released: seen.at };
      // A press lasts until the mouse comes up, however long it is held, and the page is watched from then.
      if (next.gesture && next.press) next.gesture = { ...next.gesture, at: seen.at };
      return next;
    case "cancel":
      next.press = undefined;
      next.gesture = undefined;
      return next;
    case "click": {
      const down = next.press;
      next.press = undefined;
      // A press that began on the control and came up on a box around it, as a drag does: the click goes to what holds both.
      if (down?.where.onTarget && seen.where.aroundTarget) return acted(down.where, seen.at);
      // A list that opens as the mouse goes down slides under it, so the click
      // that follows lands on the list's backdrop or on nothing. What was pressed is what was used.
      const pressed = down?.where.controls[0];
      if (down && pressed !== undefined && pressed !== seen.where.controls[0] && !seen.where.controls.includes(pressed)) return acted(down.where, seen.at);
      return acted(seen.where, seen.at);
    }
    case "key": {
      const key = seen.key.toLowerCase();
      if (seen.inTarget) {
        if (pointed.keys.includes(key) && next.typed === undefined) return say({ how: "key", key, onTarget: true, strayed: false });
        if (key === "enter" && (pointed.typed || pointed.select)) return say(filled);
      }
      // A key in a field is typing, and typing is heard by its pause. Enter, Escape and Tab act wherever they are pressed.
      if (GESTURE_KEYS.has(key) && (!seen.inTyped || ACT_IN_FIELD.has(key))) next.gesture = { at: seen.at, onTarget: seen.inTarget, key };
      return next;
    }
    case "input":
      if (!seen.inTarget) return next;
      // The page writing into a field is not the visitor typing in it. A box ticked or a choice picked by the page's script is still news of a pick.
      if (seen.byPage && pointed.typed) return next;
      if (pointed.ticked) return say(used);
      if (pointed.select) return say(filled);
      next.typed = seen.at;
      next.usedAt = seen.at;
      return next;
    case "left":
      // Leaving a dropdown after opening it is a pick too, whichever choice it was.
      return pointed.select && next.opened !== undefined ? say(filled) : next;
    case "frame":
      return say(used);
    case "tick": {
      const { at, fate } = seen;
      if (fate.leaving) return next;
      // A press that no click followed: a list that acted as the mouse went down and was gone, hidden or moved before it came up.
      const press = next.press;
      if (press?.released !== undefined && at - press.released >= CLICK_AFTER_RELEASE_MS) {
        next.press = undefined;
        if (fate.pressGone && (press.where.controls.length || press.where.onTarget)) {
          const after = acted(press.where, at);
          if (after.verdict) return after;
        }
      }
      if (next.picks.length && (!fate.popupOpen || at - (next.pickedAt ?? at) >= PICKS_QUIET_MS)) return say({ how: "chose", names: next.picks, onTarget: true, strayed: false });
      if (next.typed !== undefined && at - next.typed >= (pointed.typingPauseMs ?? TYPING_PAUSE_MS)) return say(filled);
      // They clicked into the field, its choices opened, and they stopped: the next thing to show is the choice.
      if (pointed.typed && next.opened !== undefined && next.typed === undefined && !next.picks.length && fate.listOpen && at - next.opened >= LIST_STOPPED_MS) {
        return say({ how: "opened", onTarget: true, strayed: false });
      }
      // What the page did after a press or a key, when nothing above made sense of it.
      const gesture = next.gesture;
      const fresh = !!gesture && at - gesture.at <= OUTCOME_WINDOW_MS;
      if (gesture && fresh && !next.press && !next.picks.length) {
        // Clicking into a field opens its list and so changes its state. That alone is not the step.
        const changed = fate.changed && !(pointed.typed && gesture.onTarget);
        if (fate.gone || changed || fate.dialog || fate.path) {
          if (!gesture.onTarget) return say({ how: "unknown", onTarget: false, strayed: false });
          if (gesture.key && gesture.key !== "enter" && gesture.key !== " ") return say({ how: "key", key: gesture.key, onTarget: true, strayed: false });
          return say(pointed.typed || pointed.select ? filled : used);
        }
      }
      if (gesture && !fresh) next.gesture = undefined;
      // No press, no question: a page that changes by itself is not the visitor's doing. Two things are still worth hearing.
      if (!fresh && !next.press) {
        // The address moved with nothing done that was seen. After "?" or "#" only, it is the control's doing or nobody's.
        if (fate.path) {
          // An address that moves just after the control was used moved because of it.
          if (next.usedAt !== undefined && at - next.usedAt <= ADDRESS_BELONGS_MS) return say(pointed.typed || pointed.select ? filled : used);
          return say({ how: "left", onTarget: false, strayed: true });
        }
        // The page drew the control again. It is still the step, on a new node.
        if (fate.gone && next.typed === undefined && !next.picks.length) return say({ how: "redrawn", onTarget: false, strayed: false });
      }
      return next;
    }
  }
}

const KEY_NAMES: [RegExp, string][] = [
  [/^(?:enter|return)$/, "enter"],
  [/^tab$/, "tab"],
  [/^esc(?:ape)?$/, "escape"],
  [/^space(?:bar)?$/, " "],
  [/^(?:up|arrow up|up arrow)$/, "arrowup"],
  [/^(?:down|arrow down|down arrow)$/, "arrowdown"],
  [/^(?:left|arrow left|left arrow)$/, "arrowleft"],
  [/^(?:right|arrow right|right arrow)$/, "arrowright"],
];

/** The keys a sentence asks the visitor to press, as lower-case `KeyboardEvent.key` values: "Press Enter to search." gives ["enter"]. */
export function keysAsked(sentence: string): string[] {
  const keys: string[] = [];
  const asked = /\b(?:press|hit|tap|use)(?: the)? ((?:arrow )?[a-z]+(?: arrow)?)(?: key)?\b/gi;
  for (const match of sentence.matchAll(asked)) {
    const word = (match[1] ?? "").toLowerCase();
    const key = KEY_NAMES.find(([pattern]) => pattern.test(word))?.[1];
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** How a key is written in a sentence. */
export function keyName(key: string): string {
  if (key === " ") return "Space";
  if (key.startsWith("arrow")) return `the ${key.slice(5)} arrow`;
  return key.charAt(0).toUpperCase() + key.slice(1);
}
