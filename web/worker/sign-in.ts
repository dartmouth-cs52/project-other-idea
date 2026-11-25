// Signing in to a company's app with an account they gave Haptic, so their
// signed-in screens can be mapped without anyone at the company sitting
// through it (worker/map-run.ts).
//
// This is the only place Haptic ever types, and what it types is a password,
// so it is narrow on purpose:
//
//   - It types only on an address the company has allowed Haptic to run on.
//     A sign-in page that sends the browser elsewhere, to a sign-in service or
//     to Google, is refused before anything is typed.
//   - It tries once. A wrong password is reported, never tried again, so an
//     account is not locked out by Haptic.
//   - It does not get past a captcha, a code sent by email or phone, or a
//     "Sign in with" button. It says so and stops.
//   - The name and password are held for this one call. They are not saved,
//     logged, or put in an error.
//
// The steps are written against the little that Puppeteer's page and
// Playwright's have in common, so the tests can run them in a real browser.

/** What signing in needs of a page. Puppeteer's and Playwright's pages both have it. */
export interface SignInPage {
  goto(url: string, options?: { timeout?: number }): Promise<unknown>;
  url(): string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate(code: any, ...args: any[]): Promise<any>;
  type(selector: string, text: string): Promise<void>;
  click(selector: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
}

export interface SignInWith {
  /** The address of the sign-in page. */
  url: string;
  username: string;
  password: string;
}

/** Haptic could not sign in or could not start mapping, with a sentence for the person who asked that says why. Never holds what was typed. */
export class CannotMap extends Error {
  override name = "CannotMap";
}

/** What the page shows of a sign-in form. The fields found are marked with data-haptic-sign-in, so they can be typed in by that. */
export interface SignInForm {
  user: boolean;
  password: boolean;
  submit: boolean;
  /** Something only a person can get past: "captcha" or "code". */
  challenge: "" | "captcha" | "code";
  /** What the page says went wrong, from its alert, when it says anything. */
  says: string;
}

const MARK = "data-haptic-sign-in";
const LOAD_MS = 20_000;
/** How long the next step of a sign-in may take to show: the password field, or the app itself. */
const STEP_MS = 15_000;
const POLL_MS = 400;

/**
 * Runs inside the page. It must stay self-contained, with no imports and
 * nothing from the enclosing scope, because the browser is handed its source
 * text.
 *
 * Finds the name field, the password field and the button that sends them,
 * among what is drawn, and marks each. Fields inside a shadow root or a frame
 * are not found.
 */
export function findSignIn(): SignInForm {
  const MARK = "data-haptic-sign-in";
  const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const drawn = (el: Element) => el.getClientRects().length > 0 && (typeof el.checkVisibility !== "function" || el.checkVisibility()) && !(el as HTMLInputElement).disabled;
  for (const el of Array.from(document.querySelectorAll(`[${MARK}]`))) el.removeAttribute(MARK);

  const inputs = Array.from(document.querySelectorAll("input")).filter(drawn);
  const kind = (el: HTMLInputElement) => (el.getAttribute("type") ?? "text").toLowerCase();
  // Read as written. Asked through the element, Firefox gives nothing for a value it does not fill in itself, such as one-time-code.
  const fills = (el: HTMLInputElement) => (el.getAttribute("autocomplete") ?? "").toLowerCase();
  const hint = (el: HTMLInputElement) => `${fills(el)} ${el.name} ${el.id} ${el.getAttribute("aria-label") ?? ""} ${el.placeholder}`.toLowerCase();

  const code = inputs.some((el) => fills(el).includes("one-time-code") || /\b(otp|one[-_ ]?time|verification code|2fa|mfa|totp)\b/.test(hint(el)));
  const captcha = Array.from(document.querySelectorAll("iframe")).some((frame) => /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha/i.test(frame.src) && drawn(frame));

  const password = inputs.find((el) => kind(el) === "password" && !fills(el).includes("new-password"));
  const names = inputs.filter((el) => ["text", "email", "tel"].includes(kind(el)) && !fills(el).includes("one-time-code"));
  // With a password on the page, the name is the last such field before it. Alone, it is one that says it holds a name or an email.
  const user = password
    ? names.filter((el) => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).pop()
    : names.find((el) => kind(el) === "email" || /user|email|e-mail|login|account|identifier/.test(hint(el)));

  const within: ParentNode = (password ?? user)?.closest("form") ?? document;
  const buttons = Array.from(within.querySelectorAll("button, input[type='submit'], [role='button']")).filter(drawn);
  const name = (el: Element) => text(el.getAttribute("aria-label")) || text((el as HTMLElement).innerText) || text((el as HTMLInputElement).value);
  // Not "Sign in with Google", "Forgot password" or "Show password", which share a form with the real one.
  const ours = buttons.filter((el) => !/\b(with|using|via|forgot|reset|show|hide|sign up|register|create|sso|passkey|magic)\b/i.test(name(el)));
  const submit =
    ours.find((el) => /^(sign in|log in|login|signin|continue|next|submit)$/i.test(name(el))) ??
    ours.find((el) => (el.getAttribute("type") ?? "").toLowerCase() === "submit") ??
    ours.find((el) => /\b(sign in|log in|login|continue|next)\b/i.test(name(el)));

  user?.setAttribute(MARK, "user");
  password?.setAttribute(MARK, "password");
  if (password || user) submit?.setAttribute(MARK, "submit");

  const alert = Array.from(document.querySelectorAll("[role='alert'], [aria-live='assertive'], [aria-invalid='true'] ~ [id]")).filter(drawn).map((el) => text((el as HTMLElement).innerText)).find(Boolean);
  return { user: !!user, password: !!password, submit: !!submit && !!(password || user), challenge: captcha ? "captcha" : code ? "code" : "", says: (alert ?? "").slice(0, 140).replace(/[.\s]+$/, "") };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const field = (name: "user" | "password" | "submit") => `[${MARK}="${name}"]`;

/** The form on the page now, or undefined while the page is between two loads and cannot be asked. */
async function look(page: SignInPage): Promise<SignInForm | undefined> {
  try {
    return (await page.evaluate(findSignIn)) as SignInForm;
  } catch {
    return undefined;
  }
}

/** Looks again and again until `until` is true of the form, for as long as one step may take. The last look, either way. */
async function wait(page: SignInPage, until: (form: SignInForm) => boolean, ms = STEP_MS): Promise<SignInForm | undefined> {
  let form: SignInForm | undefined;
  for (const end = Date.now() + ms; Date.now() < end; ) {
    await sleep(POLL_MS);
    form = await look(page);
    if (form && until(form)) break;
  }
  return form;
}

/**
 * Signs in, or throws CannotMap with why not. `allowed` says whether an
 * origin is one the company lets Haptic run on. It is asked before each time
 * anything is typed, and again once signed in.
 */
export async function signIn(page: SignInPage, using: SignInWith, allowed: (origin: string) => boolean): Promise<void> {
  /** Refuses to go on anywhere but the company's own site. */
  const stay = (doing: string) => {
    const at = new URL(page.url());
    if (!allowed(at.origin)) throw new CannotMap(`${doing} led to ${at.host}, which is not an address Haptic may run on. Haptic only types a password on your own site, so a sign-in kept by another service has to be mapped from your own browser.`);
  };
  const refuse = (form: SignInForm) => {
    if (form.challenge === "captcha") throw new CannotMap("Your sign-in page asks for a captcha, which Haptic does not get past. Map from your own browser instead.");
    if (form.challenge === "code") throw new CannotMap("Your app asks this account for a code after the password. Use an account without two-step sign-in, or map from your own browser.");
  };
  const send = async (form: SignInForm) => {
    if (form.submit) await page.click(field("submit"));
    else await page.keyboard.press("Enter");
  };

  try {
    await page.goto(using.url, { timeout: LOAD_MS });
  } catch {
    throw new CannotMap("Haptic could not open your sign-in page. Check its address.");
  }
  stay("Your sign-in page");
  // A page drawn by JavaScript shows its form a moment after it loads.
  let form = (await look(page)) ?? (await wait(page, () => true));
  if (!form?.user && !form?.password) form = await wait(page, (found) => found.user || found.password, 6_000);
  if (!form || (!form.user && !form.password)) throw new CannotMap("Haptic found no name or password field on that page. Give the address of the page with the sign-in form itself.");
  refuse(form);

  if (form.user) await page.type(field("user"), using.username);
  if (!form.password) {
    // The name is asked for first and the password on the next step.
    await send(form);
    form = await wait(page, (found) => found.password || !!found.challenge);
    stay("Signing in");
    if (form) refuse(form);
    if (!form?.password) throw new CannotMap(`Your sign-in page did not ask for a password after the name${form?.says ? `. It said: "${form.says}"` : ""}. If it signs people in by email link or another service, map from your own browser.`);
  }
  await page.type(field("password"), using.password);
  await send(form);

  // Signed in is when the password field has gone. A page that still shows one has said no, and one that says why has said so already.
  const after = await wait(page, (found) => !found.password || !!found.says || !!found.challenge);
  stay("Signing in");
  if (!after) throw new CannotMap("Your app did not finish loading after signing in.");
  refuse(after);
  if (after.password) throw new CannotMap(`Your app did not accept that sign-in${after.says ? `. It said: "${after.says}"` : ""}. Haptic tried once and will not try again by itself.`);
}
