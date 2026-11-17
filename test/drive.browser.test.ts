import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { launch, type Browser } from "../eval/browser.ts";
import { drive } from "../eval/drive.ts";
import { button, DONE, type Guide, type GuideSet } from "../eval/guide.ts";
import type { SiteContext, TurnReply, TurnRequest } from "../src/shared/types.ts";

// Whole-guide runs (eval/drive.ts) on a small local site, with the model's
// answers scripted, so that how the runner follows the widget across page
// loads is tested with no model. These tests need Playwright and its browser,
// which this project does not install, and are skipped without them.

const browser: Browser | undefined = await launch().catch(() => undefined);
const skip = browser ? false : "Playwright or its browser is not installed here.";

/** The pages of the site, by path, and how long each takes to arrive. */
const PAGES: Record<string, { html: string; delay?: number }> = {
  "/article": { html: `<h1>Article</h1><p>Some words about the subject.</p><footer><a href="/disclaimers">Disclaimers</a></footer>` },
  // A page that takes a moment to arrive, like a large article.
  "/disclaimers": { html: `<h1>Disclaimers</h1><p>The disclaimers of this site.</p><ul><li><a href="/medical">Medical disclaimer</a></li></ul>`, delay: 900 },
  "/medical": { html: `<h1>Medical disclaimer</h1><p>Nothing here is medical advice.</p>` },
  // A page that loads itself again, once, the moment Haptic's pointer shows on it: the runner reads the pointer from the page that came back.
  "/dashboard": {
    html: `<h1>Dashboard</h1><nav><a href="/people">People</a></nav><script>
      const watch = setInterval(() => {
        const cursor = document.querySelector("haptic-root")?.shadowRoot?.querySelector(".cursor");
        if (!cursor || !cursor.checkVisibility() || sessionStorage.getItem("reloaded")) return;
        clearInterval(watch);
        sessionStorage.setItem("reloaded", "yes");
        location.reload();
      }, 10);
    </script>`,
  },
  "/people": { html: `<h1>People</h1><p>Everyone who works here.</p>` },
  // Two panels, each with a menu whose last entry deletes it, as on a dashboard.
  "/panels": {
    html: `<h1>Dashboard</h1><button id="edit">Edit</button>
      <section><h2>The Basics</h2><button aria-label="Menu for panel The Basics" aria-expanded="false" data-panel="The Basics">...</button></section>
      <section><h2>Other</h2><button aria-label="Menu for panel Other" aria-expanded="false" data-panel="Other">...</button></section>
      <div id="menu"></div>
      <script>
        for (const opener of document.querySelectorAll("[data-panel]")) opener.addEventListener("click", () => {
          for (const other of document.querySelectorAll("[data-panel]")) other.setAttribute("aria-expanded", "false");
          opener.setAttribute("aria-expanded", "true");
          document.getElementById("menu").innerHTML = '<div role="menu"><div role="menuitem" tabindex="-1">View</div><div role="menuitem" tabindex="-1">Remove</div></div>';
        });
      </script>`,
  },
  // One page of settings with several rows, each a place of its own.
  "/subscriptions": { html: `<h1>Email subscriptions</h1><table><tr><td>Leave Approvals</td><td></td></tr><tr><td>Leave Rejections</td><td></td></tr></table>` },
  // A list behind a filter that looks the same whatever was asked: empty.
  "/candidates": {
    html: `<h1>Candidates</h1><label>Status <select id="status"><option value="">-- Select --</option><option value="2">Shortlisted</option><option value="3">Rejected</option></select></label>
      <button id="search">Search</button><p>No Records Found</p>
      <script>
        const load = (query) => fetch("/api/candidates?" + query).catch(() => undefined);
        load("limit=50");
        const chosen = document.getElementById("status");
        document.getElementById("search").addEventListener("click", () => load("limit=50" + (chosen.value ? "&status=" + chosen.value : "")));
      </script>`,
  },
  // A form that fills itself in from a script, as many do, so no field's value is the one the page was sent with.
  "/profile": {
    html: `<h1>Update profile</h1><label>Phone <input id="phone"></label><button id="update">Update Profile</button>
      <script>document.getElementById("phone").value = "555-2596-70";</script>`,
  },
};

const server: Server = createServer((request, response) => {
  const page = PAGES[new URL(request.url ?? "/", "http://x").pathname];
  setTimeout(() => {
    response.writeHead(page ? 200 : 404, { "Content-Type": "text/html" });
    response.end(page ? `<!doctype html><title>Drive test</title><main>${page.html}</main>` : "");
  }, page?.delay ?? 0);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await browser?.close();
  server.close();
});

const site: SiteContext = { id: "site_drive_test", name: "Drive test", pages: [] } as unknown as SiteContext;
const set = (guides: Guide[]): GuideSet => ({ siteId: site.id, origin, hasTag: false, sandbox: true, guides });

/** Answers each step from `script`, by the page the widget asked from, after `wait` milliseconds for that step: a model takes a while. */
const scripted =
  (script: (request: Omit<TurnRequest, "site">) => TurnReply, wait: (request: Omit<TurnRequest, "site">) => number = () => 0) =>
  async (_site: SiteContext, request: Omit<TurnRequest, "site">) => {
    await new Promise((resolve) => setTimeout(resolve, wait(request)));
    return { reply: script(request), ms: 1, msToTarget: 1, servedBy: "the test" };
  };
const idOf = (request: Omit<TurnRequest, "site">, label: string) => request.snapshot.elements.find((element) => element.label === label)?.id ?? null;

test("a guide whose 'done' pointer loads a new page is followed onto it, not scored before the widget there has looked", { skip }, async () => {
  const guide: Guide = {
    id: "medical-disclaimer",
    start: "/article",
    goal: "Is there a disclaimer about medical advice?",
    steps: [
      { expect: [{ label: "Disclaimers", role: "link" }], act: { click: "a[href='/disclaimers']" } },
      { expect: [{ label: "Medical disclaimer", role: "link" }], act: { click: "a[href='/medical']" } },
      DONE,
    ],
    reached: { url: "/medical$" },
  };
  const asker = scripted((request) => {
    const path = request.snapshot.path;
    // The model calls the first link the last step: the disclaimers are there.
    if (path === "/article") return { target: idOf(request, "Disclaimers"), status: "done", say: "The disclaimers are under Disclaimers at the foot of the page." };
    if (path === "/disclaimers") return { target: idOf(request, "Medical disclaimer"), status: "continue", say: "Click Medical disclaimer." };
    return { target: null, status: "done", say: "This is the medical disclaimer." };
  });
  const { run } = await drive(browser, set([guide]), guide, site, asker, { visitor: "new", trace: false });
  assert.equal(run.end, "reached", `${run.end}: ${run.why}`);
  // The widget on the page the first link loaded was waited for, and asked once more from there.
  assert.deepEqual(
    run.trail.slice(0, 2).map((step) => `${step.path} ${step.pointed} ${step.status}`),
    ['/article link "Disclaimers" done', '/disclaimers link "Medical disclaimer" continue'],
  );
});

test("a page that loads again under the runner as it reads the pointer is waited for, and the guide goes on from there", { skip }, async () => {
  const guide: Guide = {
    id: "people",
    start: "/dashboard",
    goal: "Where is the list of people?",
    steps: [{ expect: [{ label: "People", role: "link" }], act: { click: "a[href='/people']" } }, DONE],
    reached: { url: "/people$" },
  };
  const asker = scripted(
    (request) =>
      request.snapshot.path === "/dashboard"
        ? { target: idOf(request, "People"), status: "continue", say: "Click People." }
        : { target: null, status: "done", say: "This is the list of people." },
    // The page that came back asks again, and that answer takes longer than the runner waits for the old
    // pointer's sentence and for a pointer to show, eight seconds each, so the runner reads no pointer at all.
    (request) => (/reloaded/.test(request.event ?? "") ? 20_000 : 0),
  );
  const { run } = await drive(browser, set([guide]), guide, site, asker, { visitor: "new", trace: false });
  assert.equal(run.end, "reached", `${run.end}: ${run.why}`);
  assert.deepEqual(
    run.trail.slice(0, 2).map((step) => `${step.path} ${step.pointed}: ${step.did}`),
    ['/dashboard link "People": nothing: a new page loaded before the pointer could be used', '/dashboard link "People": clicked it'],
  );
});

/** Points at the control called `label` on whatever page asked, with `say`. */
const point = (request: Omit<TurnRequest, "site">, label: string, say: string, status: TurnReply["status"] = "continue"): TurnReply => ({ target: idOf(request, label), status, say });

test("another good way's last control ends the run as reached, only on the page its 'given' describes", { skip }, async () => {
  const guide: Guide = {
    id: "remove-panel",
    start: "/panels",
    goal: "How do I get rid of The Basics?",
    steps: [{ expect: [{ label: "Edit", role: "button" }], act: { click: "#edit" } }, { expect: [button("Delete")] }],
    otherEnds: [{ expect: [{ label: "Remove", role: "menuitem" }], given: { selector: '[data-panel="The Basics"][aria-expanded="true"]' } }],
  };
  // A site other people use, where a control that deletes is never pressed.
  const live: GuideSet = { ...set([guide]), sandbox: false };
  const run = async (panel: string) =>
    (
      await drive(
        browser,
        live,
        guide,
        site,
        scripted((request) => (request.step === 0 ? point(request, `Menu for panel ${panel}`, `Open the menu of ${panel}.`) : point(request, "Remove", "Click Remove."))),
        { visitor: "new", trace: false },
      )
    ).run;
  const right = await run("The Basics");
  assert.equal(right.end, "reached", `${right.end}: ${right.why}`);
  assert.equal(right.trail.at(-1)?.did, "stopped here: another good way ends on this control, which is not pressed here");
  // Remove in another panel's menu is not the goal, and is not pressed either.
  const wrong = await run("Other");
  assert.equal(wrong.end, "cut short", `${wrong.end}: ${wrong.why}`);
});

test("an end on a page of several places counts only when the sentence says which one", { skip }, async () => {
  const guide: Guide = {
    id: "rejection-emails",
    start: "/subscriptions",
    goal: "Who gets an email when leave is rejected?",
    steps: [{ expect: [{ label: "Subscribers", role: "button" }], act: { click: "#subscribers" } }, DONE],
    reached: [{ url: "/subscriptions/5$" }, { url: "/subscriptions$", said: "\\bleave rejections\\b" }],
  };
  const run = async (say: string) => (await drive(browser, set([guide]), guide, site, scripted(() => ({ target: null, status: "done", say })), { visitor: "new", trace: false })).run;
  const right = await run("The Leave Rejections row lists who gets emailed. Nobody is subscribed now.");
  assert.equal(right.end, "reached", `${right.end}: ${right.why}`);
  const wrong = await run("This page lists who gets emailed about leave.");
  assert.equal(wrong.end, "stopped short");
  assert.match(wrong.why, /the sentence does not say \\bleave rejections\\b/);
});

test("an empty list counts only when the page's last request for it asked for what the visitor wanted", { skip }, async () => {
  const guide: Guide = {
    id: "shortlisted",
    start: "/candidates",
    goal: "Show only the shortlisted candidates",
    steps: [{ expect: [{ label: "Status", role: "select" }], act: { select: ["#status", "Shortlisted"] } }, { expect: [button("Search")], act: { click: "#search" } }, DONE],
    reached: { request: { to: "/api/candidates\\?", has: "[?&]status=2(&|$)" } },
  };
  const searched = scripted((request) =>
    request.step === 0 ? point(request, "Status", "Choose Shortlisted.") : request.step === 1 ? point(request, "Search", "Click Search.") : { target: null, status: "done", say: "No one is shortlisted." },
  );
  const right = (await drive(browser, set([guide]), guide, site, searched, { visitor: "new", trace: false })).run;
  assert.equal(right.end, "reached", `${right.end}: ${right.why}`);
  // The same empty list, with the filter chosen and never run.
  const notRun = scripted((request) => (request.step === 0 ? point(request, "Status", "Choose Shortlisted.") : { target: null, status: "done", say: "No one is shortlisted." }));
  const wrong = (await drive(browser, set([guide]), guide, site, notRun, { visitor: "new", trace: false })).run;
  assert.equal(wrong.end, "stopped short");
  assert.match(wrong.why, /last request to .* was .*limit=50, which does not match/);
});

test("a form's last button counts only once the visitor has typed into the field it is for", { skip }, async () => {
  const guide: Guide = {
    id: "update-phone",
    start: "/profile",
    goal: "Where can I change my phone number?",
    steps: [{ expect: [{ label: "Phone", role: "textbox" }], act: { fill: ["#phone", "310-555-0142"] } }, { expect: [button("Update Profile")], given: { typedInto: "#phone" } }],
  };
  const typed = scripted((request) => (request.step === 0 ? point(request, "Phone", "Type your new number.") : point(request, "Update Profile", "Click Update Profile.")));
  const right = (await drive(browser, set([guide]), guide, site, typed, { visitor: "new", trace: false })).run;
  assert.equal(right.end, "reached", `${right.end}: ${right.why}`);
  assert.equal(right.trail[0]?.did, 'clicked it and typed "310-555-0142"');
  // Shown the button straight away, the visitor has entered nothing: the button is used like any other, and the guide is not over.
  const early = scripted((request) => (request.step === 0 ? point(request, "Update Profile", "Click Update Profile.") : { target: null, status: "done", say: "Saved." }));
  const wrong = (await drive(browser, set([guide]), guide, site, early, { visitor: "new", trace: false })).run;
  assert.equal(wrong.end, "stopped short", `${wrong.end}: ${wrong.why}`);
});
