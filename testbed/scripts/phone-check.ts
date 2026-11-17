// Checks Northpine as a phone shows it: every page, at the width of the
// narrowest phones in use and of a common iPhone. It is the live demo, and
// the page under Haptic on a phone. A page wider than the phone is laid out
// wider than the screen, so everything fixed to the window, Haptic's launcher
// among them, lands off it. A field with words under 16px makes the phone
// zoom the page in when it takes the keyboard, and leaves it zoomed.
//
// For each page it fails when:
//   - the page is wider than the screen, so it scrolls sideways;
//   - a link or a button with words is squeezed to almost no width;
//   - a field that takes text has words smaller than 16px on a touch screen.
// A table or a row of tabs that scrolls sideways inside its own box is fine.
//
//   npm run dev                      # or npm run preview, after npm run build
//   npm run phone:check              # every page
//   npm run phone:check -- /cards    # pages whose path starts with /cards

import { chromium, devices, type Page } from "playwright";

const BASE = process.env.TESTBED_URL ?? "http://localhost:4200";
const only = process.argv[2];
const WIDTHS = [320, 390];

const PAGES = [
  "/",
  "/cards",
  "/cards/new",
  "/cards/request",
  "/expenses",
  "/reimbursements",
  "/reimbursements/new",
  "/approvals",
  "/policies",
  "/policies/handbook",
  "/policies/new",
  "/bills",
  "/bills/new",
  "/bills/vendors",
  "/bills/vendors/new",
  "/accounting",
  "/accounting/chart",
  "/accounting/sync",
  "/accounting/mappings",
  "/reports",
  "/reports/new",
  "/budgets",
  "/budgets/new",
  "/people",
  "/people/departments",
  "/people/roles",
  "/settings/profile",
  "/settings/notifications",
  "/settings/company",
  "/settings/entities",
  "/settings/billing",
  "/settings/security",
  "/settings/integrations",
  "/settings/developer",
  "/settings/audit",
  "/settings/danger",
  "/help",
  "/help/whats-new",
  "/help/contact",
  "/signin",
  "/onboarding",
];

/** Pages with an id in the address: opened from their list the way a visitor opens them, so the seed's ids are not written here. */
const DETAILS: { from: string; open: (page: Page) => Promise<void> }[] = [
  { from: "/cards", open: (page) => page.locator('main a[href^="/cards/card_"]').first().click() },
  { from: "/expenses", open: (page) => page.getByRole("button", { name: "Open expense" }).first().click() },
  { from: "/reimbursements", open: (page) => page.locator('main a[href^="/reimbursements/rmb_"]').first().click() },
  { from: "/approvals", open: (page) => page.locator('main [role="row"]:not(:has([role="columnheader"]))').first().click() },
  { from: "/policies", open: (page) => page.locator('main a[href^="/policies/pol_"]').first().click() },
  { from: "/bills", open: (page) => page.locator('main a[href^="/bills/bill_"]').first().click() },
  { from: "/bills/vendors", open: (page) => page.locator('main a[href^="/bills/vendors/ven_"]').first().click() },
  { from: "/reports", open: (page) => page.locator('main a[href^="/reports/rep_"]').first().click() },
  { from: "/budgets", open: (page) => page.locator("main div.cursor-pointer").first().click() },
  { from: "/people", open: (page) => page.locator('main a[href^="/people/emp_"]').first().click() },
  { from: "/help", open: (page) => page.locator('main a[href^="/help/"]:not([href="/help/whats-new"]):not([href="/help/contact"])').first().click() },
];

/**
 * What only shows once something is pressed or chosen: the steps of a form,
 * a part that opens, a dialog, the menu drawer. Each is looked at after
 * `then`, and after each of `steps` in turn.
 */
const STATES: { name: string; path: string; then: (page: Page) => Promise<void>; steps?: ((page: Page) => Promise<void>)[] }[] = [
  {
    name: "the menu drawer",
    path: "/",
    then: (page) => page.getByRole("button", { name: "Open menu" }).click(),
  },
  {
    name: "the New menu",
    path: "/",
    then: (page) => page.getByRole("button", { name: "Create new" }).click(),
  },
  {
    name: "each step of issuing a physical card",
    path: "/cards/new",
    then: async (page) => {
      await page.getByRole("radio", { name: /For myself/ }).click();
      await page.getByLabel("Card name").fill("Team offsite");
      await page.getByRole("button", { name: "Next" }).click();
      await page.getByRole("radio", { name: /Physical card/ }).click();
    },
    steps: [
      async (page) => {
        await page.getByLabel("Street address").fill("1 Main St");
        await page.getByRole("button", { name: "Next" }).click();
      },
      (page) => page.getByRole("button", { name: "Next" }).click(),
    ],
  },
  {
    name: "an expense report split across categories",
    path: "/reimbursements/new",
    then: (page) => page.getByRole("switch", { name: "Split across categories" }).click(),
  },
  {
    name: "inviting people",
    path: "/people?invite=1",
    then: async (page) => {
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "splitting a charge",
    path: "/expenses",
    then: async (page) => {
      await page.getByRole("button", { name: "Open expense" }).first().click();
      await page.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Split transaction" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
];

const address = (path: string) => `${BASE}${path}${path.includes("?") ? "&" : "?"}lab.latency=none&lab.widget=0`;

/** What is wrong with the page on show, as lines. None when it fits the phone. */
async function faults(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(400);
  return page.evaluate(`(() => {
    const out = [];
    const screen = document.documentElement.clientWidth;
    const wide = document.documentElement.scrollWidth;
    // Whether a box around the element, below \`stop\`, scrolls sideways on its own or clips, which keeps it from widening what is around.
    const scrolls = (el, stop) => { for (let at = el.parentElement; at && at !== stop; at = at.parentElement) if (getComputedStyle(at).overflowX !== "visible") return at !== document.documentElement && at !== document.body; return false; };
    if (wide > screen + 1) {
      // The outermost boxes past the screen's edge that are not inside a box that scrolls sideways on its own.
      const past = Array.from(document.querySelectorAll("body *")).filter((el) => el.getBoundingClientRect().right > screen + 1 && getComputedStyle(el).position !== "fixed" && !scrolls(el));
      const outer = past.filter((el) => !past.includes(el.parentElement));
      out.push("the page is " + wide + "px wide on a " + screen + "px screen: " + outer.slice(0, 3).map((el) => el.tagName.toLowerCase() + "." + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(/\\s+/).slice(0, 6).join(".")).join(", "));
    }
    // A dialog, a drawer, a menu or a list open over the page, wider than the screen or running off its side.
    for (const layer of Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [role="menu"], [role="listbox"]'))) {
      const box = layer.getBoundingClientRect();
      if (!layer.getClientRects().length || box.width === 0) continue;
      const name = layer.getAttribute("aria-label") || (layer.querySelector("h1, h2, h3") || {}).textContent || layer.getAttribute("role") || "dialog";
      if (box.left < -1 || box.right > screen + 1) out.push("an open " + (layer.getAttribute("role") || "dialog") + " runs off the screen (" + Math.round(box.left) + " to " + Math.round(box.right) + "): " + String(name).trim().slice(0, 40));
      const over = Array.from(layer.querySelectorAll("*")).filter((el) => el.getBoundingClientRect().right > box.right + 1 && getComputedStyle(el).position !== "fixed" && !scrolls(el, layer));
      const outerOver = over.filter((el) => !over.includes(el.parentElement));
      if (outerOver.length) out.push("something in an open " + (layer.getAttribute("role") || "dialog") + " runs past its edge: " + outerOver.slice(0, 2).map((el) => el.tagName.toLowerCase() + "." + String(el.className).split(/\s+/).slice(0, 5).join(".")).join(", "));
    }
    // A link or a button with words that has been squeezed to nothing beside things that would not give way.
    for (const el of Array.from(document.querySelectorAll("main a, main button"))) {
      const box = el.getBoundingClientRect();
      const words = (el.textContent || "").trim();
      if (!el.getClientRects().length || !words || box.height === 0 || getComputedStyle(el).visibility === "hidden" || el.closest('[aria-hidden="true"], .sr-only')) continue;
      if (box.width < 12) out.push("squeezed to " + Math.round(box.width) + "px wide, so it can't be read or tapped: " + words.slice(0, 40));
    }
    const fields = Array.from(document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]), select, textarea, [contenteditable="true"]'));
    for (const field of fields) {
      if (!field.getClientRects().length) continue;
      const size = parseFloat(getComputedStyle(field).fontSize);
      if (size < 16) out.push("a field's words are " + size + "px, so the phone zooms in when it takes the keyboard: " + (field.getAttribute("aria-label") || field.getAttribute("placeholder") || field.id || field.tagName.toLowerCase()));
    }
    return out;
  })()`) as Promise<string[]>;
}

const browser = await chromium.launch();
let failed = 0;
let looked = 0;
for (const width of WIDTHS) {
  // Each page and state on a phone of this width, with touch, so a field's words are the size a phone gives them.
  const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height: 740 } });
  const page = await context.newPage();
  const report = async (path: string) => {
    looked++;
    const found = await faults(page);
    const where = new URL(page.url()).pathname;
    if (!found.length) return console.log(`ok   ${width}px ${where}`);
    failed++;
    console.log(`FAIL ${width}px ${where}${where === path ? "" : ` (from ${path})`}\n${found.map((line) => `       ${line}`).join("\n")}`);
  };
  for (const path of PAGES.filter((p) => !only || p.startsWith(only))) {
    await page.goto(address(path), { waitUntil: "domcontentloaded" });
    await report(path);
  }
  for (const detail of DETAILS.filter((d) => !only || d.from.startsWith(only))) {
    await page.goto(address(detail.from), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const before = page.url();
    try {
      await detail.open(page);
      await page.waitForURL((url) => url.href !== before, { timeout: 5000 });
    } catch {
      failed++;
      console.log(`FAIL ${width}px could not open a page from ${detail.from}: the way in has changed, so this check needs it changed too`);
      continue;
    }
    await report(detail.from);
  }
  for (const state of STATES.filter((st) => !only || st.path.startsWith(only))) {
    await page.goto(address(state.path), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const show = async (what: string, act: (page: Page) => Promise<void>) => {
      try {
        await act(page);
      } catch (error) {
        failed++;
        console.log(`FAIL ${width}px could not get to ${what}: ${String(error).split("\n")[0]}`);
        return false;
      }
      looked++;
      const found = await faults(page);
      if (!found.length) {
        console.log(`ok   ${width}px ${what}`);
        return true;
      }
      failed++;
      console.log(`FAIL ${width}px ${what}\n${found.map((line) => `       ${line}`).join("\n")}`);
      return true;
    };
    if (!(await show(state.name, state.then))) continue;
    for (const [n, step] of (state.steps ?? []).entries()) if (!(await show(`${state.name}, step ${n + 2}`, step))) break;
  }
  await context.close();
}
await browser.close();
console.log(`\n${looked} pages looked at, ${failed} with faults.`);
if (failed) process.exit(1);
