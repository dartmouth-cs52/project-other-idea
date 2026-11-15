import type { SnapElement } from "../src/shared/types.ts";

// The simulated visitor of a whole-guide run: what a person who trusts the
// pointer does with the control it is on.
//
// What to do is decided from what the control is, never from its tag alone:
// - Something that opens a list or a calendar (a combobox, anything with
//   aria-haspopup, a read-only input) is clicked with the real mouse. If the
//   widget then says nothing more and choices are showing, the visitor picks
//   the one the sentence names, or else the one the script picks next.
// - A text field is clicked and typed into on the keyboard, key by key. What is
//   typed is, in this order: the script's value for that very field, the text
//   the sentence puts in quotes, a value that suits the field (a date in the
//   form the field shows, a number, an email), and only then a neutral word.
// - A native <select> gets the choice the script names, or else the choice the
//   sentence names, or else another choice than the one showing.
// - Anything else is clicked with the real mouse, at a spot a person could
//   reach. A control that sits under its own label, option or row is pressed
//   at its middle all the same. Only something unrelated on top counts as
//   "control covered", and a control with no reachable part is not clicked at
//   all: a script calling click() on it would be something no person can do.
//
// `useAsBefore` is the visitor as it was before this was written. It is kept
// for one release (--visitor old) so that a rise in the score can be split
// into what the benchmark changed and what the product changed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/** What the visitor is being shown. */
export interface Shown {
  /** The control as the widget listed it. */
  listed: Pick<SnapElement, "label" | "role">;
  /** The sentence beside the pointer. */
  say: string;
  /** What the script itself types into this very field or picks from this very list, when it has a step for it. */
  scripted?: { fill?: string; select?: string };
}

export interface Used {
  /** What the visitor did, in words for the log. */
  did: string;
  /** Something unrelated was on top of the control's middle. */
  covered?: boolean;
  /** The control was clicked open and nothing was typed, so choices may now be showing. */
  opened?: boolean;
  /** Why the control could not be used at all. */
  failed?: string;
}

/** What a field says about itself, read from the page. */
export interface Hints {
  /** The input's type, "textarea", or "" for anything else that takes text. */
  type: string;
  label: string;
  placeholder: string;
  /** The field's name and id, which often say what it is for when nothing else does. */
  name: string;
  inputMode: string;
  /** The words around the field, such as "(MM-DD-YYYY)" beside a date box. */
  near: string;
}

const NEUTRAL = "Test";
/** The date a visitor enters when nobody said which. */
const A_DATE = { year: 2026, month: 12, day: 1 };

/**
 * The text a sentence asks the visitor to type: what it puts in double quotes,
 * unless that is only the name of the field itself. 'Type "KAFKA-1" in the
 * search box' gives KAFKA-1. 'Click the "Search" box' gives nothing.
 */
export function quoted(say: string, label = "", placeholder = ""): string | undefined {
  const names = [label, placeholder].map((name) => name.trim().toLowerCase()).filter(Boolean);
  const found: { text: string; typed: boolean }[] = [];
  for (const match of say.matchAll(/["“]([^"“”]{1,80})["”]/g)) {
    const text = match[1]!.trim();
    const lower = text.toLowerCase();
    // The field's own name, or most of it, is how a sentence says which field. 'Type "Kafka search"' still names something to type in a field called "Search".
    if (!text || names.some((name) => name.includes(lower) || (lower.includes(name) && name.length * 2 > lower.length))) continue;
    const before = say.slice(0, match.index).toLowerCase();
    found.push({ text, typed: /\b(type|enter|write|input|search for|fill in|put)\s*(in\s*)?$/.test(before) });
  }
  return (found.find((one) => one.typed) ?? found[0])?.text;
}

/** A date written the way a field shows it should be: "MM-DD-YYYY" gives "12-01-2026". Undefined when no form is shown. */
export function dateLike(form: string): string | undefined {
  const match = /\b(d{1,2}|m{1,2}|y{2,4})([-/. ])(d{1,2}|m{1,2}|y{2,4})\2(d{1,2}|m{1,2}|y{2,4})\b/i.exec(form);
  if (!match) return undefined;
  const parts = [match[1]!, match[3]!, match[4]!].map((part) => part.toLowerCase());
  if (new Set(parts.map((part) => part[0])).size !== 3) return undefined;
  const write = (part: string) => {
    if (part[0] === "y") return part.length === 2 ? String(A_DATE.year).slice(2) : String(A_DATE.year);
    return String(part[0] === "m" ? A_DATE.month : A_DATE.day).padStart(2, "0");
  };
  return parts.map(write).join(match[2]);
}

const ISO_DATE = `${A_DATE.year}-${String(A_DATE.month).padStart(2, "0")}-${String(A_DATE.day).padStart(2, "0")}`;

/** Whether a field asks for a date, going by what it says about itself. */
function wantsDate(hints: Hints): boolean {
  return /\bdate\b|\bdatum\b|\bfecha\b|日期|\bbirthday\b|date of birth/i.test(`${hints.label} ${hints.placeholder} ${hints.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ")}`);
}

/** A value that suits a field nobody gave a value for, or undefined when nothing about the field says what it wants. */
export function suited(hints: Hints): string | undefined {
  const label = `${hints.label} ${hints.placeholder}`.toLowerCase();
  const name = hints.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]/g, " ").toLowerCase();
  const shown = dateLike(hints.placeholder) ?? dateLike(hints.near) ?? dateLike(hints.label);
  if (shown) return shown;
  if (wantsDate(hints)) return ISO_DATE;
  const says = (pattern: RegExp) => pattern.test(label) || pattern.test(name);
  if (hints.type === "email" || says(/e-?mail/)) return "sam@example.com";
  if (hints.type === "password" || says(/password/)) return "Example-pass-1";
  if (hints.type === "tel" || says(/phone|mobile/)) return "5550100";
  if (hints.type === "url" || says(/website|\burl\b/)) return "https://example.com";
  if (says(/zip|postal|postcode/)) return "03755";
  if (hints.type === "number" || hints.inputMode === "numeric" || hints.inputMode === "decimal" || says(/quantity|amount|number of|\bcount\b|\bprice\b/)) return "2";
  if (says(/first name/)) return "Sam";
  if (says(/last name|surname/)) return "Okafor";
  if (says(/\bname\b/)) return "Sam Okafor";
  if (says(/city|town/)) return "Hanover";
  if (says(/address|street/)) return "1 Main Street";
  return undefined;
}

/**
 * Which of the choices on show a sentence names, if any. A choice that is
 * already the chosen one is not what a sentence asks for: "the list says
 * Component, choose System" means System. Of several, a quoted one wins, and
 * then the one named last, which is where a sentence puts what to pick.
 */
export function namedChoice(say: string, choices: { text: string; chosen?: boolean }[]): number {
  const sentence = say.toLowerCase();
  let best = -1;
  let bestRank = -1;
  choices.forEach((choice, index) => {
    const text = choice.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!text || choice.chosen) return;
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Whole words only: "B" is not named by "combobox".
    const whole = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    let last = -1;
    for (const match of sentence.matchAll(whole)) last = match.index;
    if (last < 0) return;
    const inQuotes = /["“]$/.test(sentence.slice(0, last)) && /^["”]/.test(sentence.slice(last + text.length));
    // A quoted name beats any other. After that the later mention, and of two that end together the longer.
    const rank = (inQuotes ? 1_000_000 : 0) + (last + text.length) * 100 + Math.min(text.length, 99);
    if (rank > bestRank) [best, bestRank] = [index, rank];
  });
  return best;
}

/** The keys that put a date into the browser's own date field, which is typed part by part. */
function keysForNativeDate(type: string, value: string | undefined): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? ISO_DATE);
  if (type === "date") return iso ? `${iso[2]}${iso[3]}${iso[1]}` : undefined;
  if (type === "time") return "0930AM";
  if (type === "datetime-local") return iso ? `${iso[2]}${iso[3]}${iso[1]}0930AM` : undefined;
  return undefined;
}

// ---------------------------------------------------------------------------
// What runs in the page. Each is handed to the browser whole, so none may use
// anything from outside itself.
// ---------------------------------------------------------------------------

/**
 * A function in a form the browser can run. This project's build wraps every
 * function inside another in a helper of its own, which a page does not have,
 * so the function is handed over with a stand-in for that helper.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const inPage = (fn: Function) => new Function("...args", `const __name = (value) => value; return (${fn}).apply(null, args);`);

/** What kind of control this is, for deciding how a person would use it. */
function lookAt(el: Element) {
  const input = el instanceof HTMLInputElement ? el : undefined;
  const type = input ? (input.type || "text").toLowerCase() : el instanceof HTMLTextAreaElement ? "textarea" : "";
  const editable = (el as HTMLElement).isContentEditable;
  const takesText = el instanceof HTMLTextAreaElement || editable || (!!input && !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color", "hidden"].includes(type));
  const readOnly = (el as HTMLInputElement).readOnly === true || el.getAttribute("aria-readonly") === "true";
  const popup = el.getAttribute("aria-haspopup");
  const autocomplete = el.getAttribute("aria-autocomplete");
  const opens = el.getAttribute("role") === "combobox" || (!!popup && popup !== "false") || autocomplete === "list" || autocomplete === "both" || !!input?.getAttribute("list");
  const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  // The words around a field: its cell, row or wrapper, when that is short enough to be about this field alone.
  let near = "";
  for (let node = el.parentElement, depth = 0; node && depth < 3 && !near; node = node.parentElement, depth++) {
    const text = clean(node.textContent);
    if (text && text.length <= 80) near = text;
  }
  return {
    select: el instanceof HTMLSelectElement,
    takesText,
    readOnly,
    opens,
    /** One of the browser's own pickers, typed part by part. */
    nativePicker: !!input && ["date", "time", "datetime-local"].includes(type),
    password: type === "password",
    empty: takesText ? (editable ? !clean(el.textContent) : !(el as HTMLInputElement).value) : true,
    hints: {
      type,
      label: clean(el.getAttribute("aria-label")) || clean(input?.labels?.[0]?.textContent),
      placeholder: clean(el.getAttribute("placeholder")),
      name: `${el.getAttribute("name") ?? ""} ${el.id ?? ""}`.trim(),
      inputMode: el.getAttribute("inputmode") ?? "",
      near,
    },
  };
}

/**
 * Where a person would press to use this control, and whether they can.
 * The middle of its box when that reaches the control or its own drawing (the
 * label, option or row it is part of), else another part of the box that
 * does. `left` asks for a spot near the left edge, where a field's text begins.
 */
function findSpot(el: Element, left: boolean) {
  const OWN = 'label, [role="option"], [role="row"], tr, li, [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listitem"], [role="treeitem"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"]';
  let box = el.getBoundingClientRect();
  // A tick box is often an invisible input under its label. The label is all a person can see or press.
  const tick = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  const label = tick ? ((el as HTMLInputElement).labels?.[0] ?? el.closest("label")) : null;
  const style = getComputedStyle(el);
  if (label && (box.width < 8 || box.height < 8 || style.opacity === "0" || style.visibility === "hidden")) box = label.getBoundingClientRect();
  if (box.width <= 0 && box.height <= 0) return { x: 0, y: 0, reachable: false, covered: false, by: "nothing: the control has no size on the page" };

  const frame = el.closest(OWN) ?? label;
  const hitAt = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y);
    // Into a shadow root, where the real element under the mouse is.
    for (let inner = hit?.shadowRoot?.elementFromPoint(x, y); inner && inner !== hit; inner = inner.shadowRoot?.elementFromPoint(x, y)) hit = inner;
    return hit;
  };
  const own = (hit: Element | null) => !!hit && (el.contains(hit) || hit.contains(el) || !!frame?.contains(hit) || !!label?.contains(hit));
  const name = (hit: Element | null) => {
    if (!hit) return "nothing";
    const root = hit.getRootNode();
    if (hit.tagName === "HAPTIC-ROOT" || (root instanceof ShadowRoot && root.host.tagName === "HAPTIC-ROOT")) return "Haptic's own caption or launcher";
    const words = (hit.getAttribute("aria-label") || hit.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `<${hit.tagName.toLowerCase()}${hit.id ? ` id="${hit.id}"` : ""}>${words ? ` "${words}"` : ""}`;
  };
  const inWindow = (x: number, y: number) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
  const at = (fx: number, fy: number) => ({ x: box.left + box.width * fx, y: box.top + box.height * fy });
  const middle = left ? { x: box.left + Math.min(10, box.width / 4), y: box.top + box.height / 2 } : at(0.5, 0.5);
  const middleHit = inWindow(middle.x, middle.y) ? hitAt(middle.x, middle.y) : null;
  if (own(middleHit)) return { ...middle, reachable: true, covered: false, by: "" };
  // The middle is under something else. A person presses whatever part of the control they can still see.
  for (const [fx, fy] of [[0.15, 0.5], [0.85, 0.5], [0.5, 0.2], [0.5, 0.8], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]] as const) {
    const spot = at(fx, fy);
    if (inWindow(spot.x, spot.y) && own(hitAt(spot.x, spot.y))) return { ...spot, reachable: true, covered: true, by: name(middleHit) };
  }
  return { ...middle, reachable: false, covered: true, by: inWindow(middle.x, middle.y) ? name(middleHit) : "nothing: the control is outside the window" };
}

const CHOICES = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="treeitem"], [role="listbox"] li, [role="menu"] li';
/** Where a calendar could be. */
const GRIDS = '[role="grid"], table';

// What the visitor keeps in the page between one action and the next: what was
// on show before the last press, which control was pressed, and the choices it
// found since. It is kept in a WeakSet on the window and never written into the
// page, so neither the page nor the widget, which watches the page for changes,
// sees anything happen.

/** Remembers everything on show before the visitor presses `el`. */
function markShowing(el: Element) {
  const key = Symbol.for("haptic benchmark visitor");
  const state = ((window as unknown as Record<symbol, { was?: WeakSet<Element>; pressed?: Element; choices?: Element[] }>)[key] ??= {});
  const was = new WeakSet<Element>();
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (let index = 0; index < all.length && index < 30000; index++) {
    const box = all[index]!.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) was.add(all[index]!);
  }
  state.was = was;
  state.pressed = el;
}

/** Whether `el` is the control the visitor pressed last. */
function pressedLast(el: Element) {
  const state = (window as unknown as Record<symbol, { pressed?: Element } | undefined>)[Symbol.for("haptic benchmark visitor")];
  return !!state && state.pressed === el;
}

/**
 * Every choice on show that was not before the last press, and whether a
 * calendar is. A choice is what a page marks as one (an option, a menu entry),
 * or, as a person sees it, a short piece of text that appeared in a layer
 * floating over the page (a list drawn in a layer of its own), apart from the
 * one that holds the control itself.
 */
function choicesShowing({ selector, grids }: { selector: string; grids: string }) {
  const state = ((window as unknown as Record<symbol, { was?: WeakSet<Element>; pressed?: Element; choices?: Element[] }>)[Symbol.for("haptic benchmark visitor")] ??= {});
  const was = state.was ?? new WeakSet<Element>();
  const pressed = state.pressed;
  const seen = (el: Element) => {
    if (was.has(el)) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight && (typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true }));
  };
  const textOf = (el: Element) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  /** A layer floating over the page that appeared since the press and does not hold the control pressed. */
  const inNewLayer = (el: Element) => {
    for (let node = el.parentElement, depth = 0; node && node !== document.body && depth < 12; node = node.parentElement, depth++) {
      const position = getComputedStyle(node).position;
      if (position === "absolute" || position === "fixed") return !was.has(node) && !(pressed && node.contains(pressed));
    }
    return false;
  };
  const marked = Array.from(document.querySelectorAll(selector)).filter(seen).slice(0, 200);
  const drawn: Element[] = [];
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (let index = 0; index < all.length && index < 30000 && drawn.length < 200; index++) {
    const el = all[index]!;
    if (!seen(el)) continue;
    const text = textOf(el);
    if (!text || text.length > 80 || Array.from(el.children).some((child) => textOf(child) === text)) continue;
    if (inNewLayer(el)) drawn.push(el);
  }
  const both = [...marked, ...drawn.filter((el) => !marked.some((one) => one === el || one.contains(el)))];
  // A list entry that only wraps a real choice is not a second choice.
  const choices = both.filter((el) => !both.some((other) => other !== el && el.contains(other)));
  state.choices = choices;
  // A calendar: a grid or table on show, most of whose cells are a day of the month.
  const calendar = Array.from(document.querySelectorAll(grids)).some((grid) => {
    if (!seen(grid)) return false;
    const cells = Array.from(grid.querySelectorAll('td, [role="gridcell"]'));
    return cells.length >= 28 && cells.length <= 60 && cells.filter((cell) => /^\d{1,2}$/.test((cell.textContent ?? "").trim())).length >= 28;
  });
  return {
    calendar,
    choices: choices.map((el) => ({
      text: textOf(el).slice(0, 120),
      chosen: el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true",
    })),
  };
}

/** The choice `choicesShowing` found at this place in its list. */
function choiceAt(index: number) {
  const state = (window as unknown as Record<symbol, { choices?: Element[] } | undefined>)[Symbol.for("haptic benchmark visitor")];
  return state?.choices?.[index] ?? null;
}

// ---------------------------------------------------------------------------

/**
 * Presses the real mouse on a control, the way a person would: scroll to it,
 * wait for it to hold still, move there, press. Nothing is pressed when no
 * part of the control can be reached.
 */
export async function press(page: Loose, element: Loose, left = false): Promise<{ pressed: boolean; covered: boolean; by: string }> {
  await element.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  // A list that is still sliding open, or a page still settling after a scroll.
  let before = "";
  for (let tries = 0; tries < 8; tries++) {
    const box = JSON.stringify(await element.boundingBox());
    if (box === before) break;
    before = box;
    await page.waitForTimeout(80);
  }
  const spot = (await element.evaluate(inPage(findSpot), left)) as ReturnType<typeof findSpot>;
  if (!spot.reachable) return { pressed: false, covered: spot.covered, by: spot.by };
  // What is on show now, and which control is pressed, so that what the press opens can be told from the rest.
  await element.evaluate(inPage(markShowing)).catch(() => undefined);
  await page.mouse.move(spot.x, spot.y, { steps: 4 });
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.waitForTimeout(40);
  await page.mouse.up();
  return { pressed: true, covered: spot.covered, by: spot.by };
}

/** Uses the control the pointer is on, as a person who trusts it would. */
export async function use(page: Loose, element: Loose, shown: Shown): Promise<Used> {
  const control = (await element.evaluate(inPage(lookAt))) as ReturnType<typeof lookAt>;
  const hints: Hints = { ...control.hints, label: shown.listed.label || control.hints.label };

  if (control.select) {
    const options = (await element.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((option) => ({ text: option.label || option.text, chosen: option.selected, usable: !option.disabled && option.value !== "" })),
    )) as { text: string; chosen: boolean; usable: boolean }[];
    const asScripted = shown.scripted?.select !== undefined ? options.findIndex((option) => option.text === shown.scripted!.select) : -1;
    const asNamed = asScripted >= 0 ? -1 : namedChoice(shown.say, options);
    const another = options.findIndex((option) => !option.chosen && option.usable);
    const index = asScripted >= 0 ? asScripted : asNamed >= 0 ? asNamed : another;
    if (index < 0) return { did: "nothing: the list has no other choice to pick" };
    // A page's own dropdown list is drawn by the browser, outside the page, so it is set and not clicked through.
    await element.selectOption({ index }, { timeout: 8000 });
    return { did: `picked "${options[index]!.text}"${asScripted >= 0 ? "" : asNamed >= 0 ? ", which the sentence names" : ", for want of a named choice"}` };
  }

  // Shown the control whose list they opened a moment ago, still open, and told to choose something in it,
  // a person picks that choice. Pressing the control again would only close the list.
  const again = (await element.evaluate(inPage(pressedLast)).catch(() => false)) as boolean;
  if ((control.opens || control.readOnly) && again) {
    const open = (await page.evaluate(inPage(choicesShowing), { selector: CHOICES, grids: GRIDS })) as ReturnType<typeof choicesShowing>;
    const named = namedChoice(shown.say, open.choices);
    if (named >= 0) {
      const choice = (await page.evaluateHandle(inPage(choiceAt), named)).asElement();
      if (choice && (await press(page, choice)).pressed) return { did: `picked "${open.choices[named]!.text}" from the list already open, which the sentence names` };
    }
  }

  const typable = control.takesText && !control.readOnly;
  // What to type, when somebody has said: the script for this very field, or the sentence in quotes.
  let value = typable ? (shown.scripted?.fill ?? quoted(shown.say, hints.label, hints.placeholder)) : undefined;
  let source = value === undefined ? "" : shown.scripted?.fill !== undefined ? "" : ", which the sentence asks for";

  const pressed = await press(page, element, control.nativePicker);
  const covered = pressed.covered ? { covered: true } : {};
  if (!pressed.pressed) return { did: "nothing: it could not be reached", failed: `no part of it can be pressed: ${pressed.by} is on top of it`, ...covered };
  const clicked = pressed.covered ? `clicked a part of it that could be reached (${pressed.by} was on its middle)` : "clicked it";
  if (!control.takesText && !control.opens) return { did: clicked, ...covered };
  if (!typable) return { did: clicked, opened: true, ...covered };

  // A moment for whatever the click opens.
  await page.waitForTimeout(350);
  if (control.nativePicker) {
    const keys = keysForNativeDate(control.hints.type, value);
    if (!keys) return { did: clicked, opened: true, ...covered };
    await page.keyboard.type(keys, { delay: 30 });
    return { did: `${clicked} and typed a ${control.hints.type === "time" ? "time" : "date"} on the keyboard`, ...covered };
  }
  if (value === undefined) {
    const showing = (await page.evaluate(inPage(choicesShowing), { selector: CHOICES, grids: GRIDS })) as ReturnType<typeof choicesShowing>;
    // It opened a list: a person picks from it and does not type a made-up word over it.
    if (control.opens || showing.choices.length) return { did: clicked, opened: true, ...covered };
    const fits = showing.calendar && !suited(hints) ? ISO_DATE : suited(hints);
    value = fits ?? NEUTRAL;
    source = fits ? ", which suits the field" : ", for want of anything better";
  }
  const focused = await element.evaluate((el: Element) => {
    const active = document.activeElement;
    return !!active && (active === el || el.contains(active));
  });
  // The press landed on the field's own drawing and the cursor is not in it. A person presses again where the text begins.
  if (!focused) await press(page, element, true);
  if (!control.empty) await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(value, { delay: 30 });
  let did = `${clicked} and typed "${value}"${source}`;
  if (/\b(press|hit)\s+(the\s+)?(enter|return)\b/i.test(shown.say)) {
    await page.keyboard.press("Enter");
    did += ", then pressed Enter";
    return { did, ...covered };
  }
  // A box that searches as it is typed in now shows what matches. A person picks from that.
  return { did, ...(control.opens ? { opened: true } : {}), ...covered };
}

/**
 * When a control has been clicked open and the widget says nothing more, the
 * visitor picks from what is showing: the choice the sentence names, or else
 * what the script clicks next. Returns what was done, or "" when there was
 * nothing to pick.
 */
export async function pickWhenQuiet(page: Loose, say: string, scriptedNext?: string): Promise<string> {
  const showing = (await page.evaluate(inPage(choicesShowing), { selector: CHOICES, grids: GRIDS })) as ReturnType<typeof choicesShowing>;
  const named = namedChoice(say, showing.choices);
  if (named >= 0) {
    const choice = (await page.evaluateHandle(inPage(choiceAt), named)).asElement();
    if (choice && (await press(page, choice)).pressed) return `picked "${showing.choices[named]!.text}" from the list it opened, which the sentence names`;
  }
  if (scriptedNext && (showing.choices.length || showing.calendar)) {
    const next = await page.locator(scriptedNext).first().elementHandle({ timeout: 2000 }).catch(() => null);
    if (next && (await press(page, next)).pressed) return "picked from the list it opened what the script picks next";
  }
  return "";
}

/** What the old visitor typed into a field nobody scripted a value for. */
function valueAsBefore(listedLabel: string, inputType: string): string {
  const label = listedLabel.toLowerCase();
  if (inputType === "email" || /e-?mail/.test(label)) return "sam@example.com";
  if (inputType === "password" || /password/.test(label)) return "Example-pass-1";
  if (inputType === "number" || /quantity|amount|number of/.test(label)) return "2";
  if (inputType === "tel" || /phone|mobile/.test(label)) return "5550100";
  if (inputType === "date") return "2026-12-01";
  if (inputType === "url" || /website|url/.test(label)) return "https://example.com";
  if (/zip|postal|postcode/.test(label)) return "03755";
  if (/first name/.test(label)) return "Sam";
  if (/last name|surname/.test(label)) return "Okafor";
  if (/name/.test(label)) return "Sam Okafor";
  if (/city|town/.test(label)) return "Hanover";
  if (/address|street/.test(label)) return "1 Main Street";
  return "Test";
}

/**
 * The visitor as it was: fill() on anything that is an input, "Test" where
 * the script has no value, the second entry of every dropdown, and a click
 * made by script when the control is covered. Kept for --visitor old.
 */
export async function useAsBefore(_page: Loose, element: Loose, shown: Shown): Promise<Used> {
  const field = (await element.evaluate((el: Element) => {
    if (el instanceof HTMLSelectElement) return "select";
    if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return "text";
    if (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color"].includes(el.type)) return el.type || "text";
    return "";
  })) as string;
  if (field === "select") {
    const labels = (await element.evaluate((el: HTMLSelectElement) => Array.from(el.options).map((option) => option.label))) as string[];
    const asScripted = shown.scripted?.select !== undefined ? labels.indexOf(shown.scripted.select) : -1;
    const index = asScripted >= 0 ? asScripted : labels.length > 1 ? 1 : 0;
    await element.selectOption({ index }, { timeout: 8000 });
    return { did: `picked "${labels[index] ?? ""}"` };
  }
  if (field) {
    const value = shown.scripted?.fill ?? valueAsBefore(shown.listed.label, field);
    await element.fill(value, { timeout: 8000 });
    let did = `typed "${value}"`;
    if (/\b(press|hit)\s+(enter|return)\b/i.test(shown.say)) {
      await element.press("Enter");
      did += " and pressed Enter";
    }
    return { did };
  }
  try {
    await element.click({ timeout: 6000 });
    return { did: "clicked it" };
  } catch {
    await element.evaluate((el: Element) => (el as HTMLElement).click());
    return { did: "clicked it, though something was on top of it", covered: true };
  }
}
