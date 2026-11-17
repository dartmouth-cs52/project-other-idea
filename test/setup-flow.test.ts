import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENTS, truncatePrompt } from "../web/lib/agents.ts";
import { agentPrompt, installPlaybook, playbookUrl } from "../web/lib/install.ts";
import {
  belongsInSetup,
  checkAddress,
  checkEmail,
  countChange,
  duration,
  durationChange,
  installStatus,
  mailboxOf,
  neverTouchList,
  neverTouchSuggestions,
  neverTouchTicked,
  nextStep,
  pageControls,
  pillLabel,
  previousStep,
  rateChange,
  riskyControls,
  SETUP_STEPS,
  stepFor,
  stepLabel,
  utcDayLabel,
  WAITING_AFTER_MS,
  type ReadPage,
} from "../web/lib/setup.ts";
import { isPlaybookPath, playbook } from "../web/worker/playbook.ts";
import { readingExtras } from "../web/worker/setup-api.ts";

// Adding a site one question per screen: where a reload lands, what the
// install status says, the agent prompt and its links, the install steps an
// agent fetches, and the checks on what people type.

test("the steps run address, reading, learned, install, connect, and say which of five each is", () => {
  assert.deepEqual(
    SETUP_STEPS.map((step) => step.id),
    ["address", "reading", "learned", "install", "connect"],
  );
  assert.equal(stepLabel("address"), "Step 1 of 5");
  assert.equal(stepLabel("connect"), "Step 5 of 5");
  assert.equal(nextStep("learned"), "install");
  assert.equal(nextStep("connect"), undefined, "the last step leads to the dashboard");
  assert.equal(previousStep("reading"), "address");
  assert.equal(previousStep("address"), undefined);
});

test("a reload lands on the screen the site says, and the script being seen moves the install screens on", () => {
  const site = (over: Partial<Parameters<typeof stepFor>[0] & object> = {}) => ({ connected: false, reading: { done: false }, setup: null, ...over });
  assert.equal(stepFor(null), "address", "no site yet");
  assert.equal(stepFor(site()), "reading", "still reading");
  assert.equal(stepFor(site({ reading: { done: true } })), "learned", "read, and nothing saved yet");
  assert.equal(stepFor(site({ reading: { done: true }, setup: { step: "install" } })), "install");
  assert.equal(stepFor(site({ reading: { done: false }, setup: { step: "learned" } })), "learned", "moved on while it was still reading");
  assert.equal(stepFor(site({ connected: true, setup: { step: "install" } })), "connect", "the script was seen while they were away");
  assert.equal(stepFor(site({ connected: true, setup: { step: "learned" } })), "learned", "earlier screens stay where they were");
  assert.equal(stepFor(site({ connected: true })), "connect");
  assert.equal(stepFor(site({ setup: { step: "address" } })), "reading", "a site exists, so it is past the address");
});

test("the dashboard sends a site part way through setup back to it, but not one put off for later or finished", () => {
  assert.equal(belongsInSetup({ connected: false, reading: null, setup: { step: "install" } }), true);
  assert.equal(belongsInSetup({ connected: false, reading: null, setup: { step: "install", later: true } }), false);
  assert.equal(belongsInSetup({ connected: false, reading: null, setup: { step: "connect", finishedAt: "2026-11-16T00:00:00Z" } }), false);
  assert.equal(belongsInSetup({ connected: false, reading: null, setup: null }), false, "a site from before the setup screens keeps the dashboard");
  assert.equal(belongsInSetup({ connected: true, reading: null, setup: { step: "install" } }), false, "a connected site shows its dashboard");
  assert.equal(belongsInSetup({ connected: false, reading: null, setup: { step: "install" } }, { later: true }), false, "Finish later whose save failed still stays on the dashboard");
});

test("an address is checked the way the Worker checks it", () => {
  assert.deepEqual(checkAddress("app.example.com"), { ok: true, origin: "https://app.example.com", url: "https://app.example.com/" });
  assert.deepEqual(checkAddress(" https://app.example.com/projects#x "), { ok: true, origin: "https://app.example.com", url: "https://app.example.com/projects" });
  assert.equal((checkAddress("localhost:3000") as { origin: string }).origin, "http://localhost:3000", "a developer's own machine serves plain http");
  assert.equal((checkAddress("192.168.1.4:8080") as { origin: string }).origin, "http://192.168.1.4:8080");
  assert.match((checkAddress("") as { message: string }).message, /Enter your app's address/);
  assert.match((checkAddress("acme") as { message: string }).message, /missing its domain/);
  assert.match((checkAddress("app example.com") as { message: string }).message, /no spaces/);
  assert.match((checkAddress("ftp://example.com") as { message: string }).message, /https/);
});

test("one mailbox is written one way however its address is: case, a +tag anywhere, dots on Gmail", () => {
  for (const spelling of ["victim@gmail.com", "VICTIM@Gmail.com", "victim+1@gmail.com", "v.i.c.t.i.m@gmail.com", "vic.tim+x@googlemail.com"]) assert.equal(mailboxOf(spelling), "victim@gmail.com", spelling);
  assert.equal(mailboxOf("Jane+news@Example.org"), "jane@example.org");
  assert.equal(mailboxOf("ja.ne@example.org"), "ja.ne@example.org", "dots count everywhere but Gmail");
});

test("one address only, of letters, digits and the usual marks, is taken as a developer's email", () => {
  for (const bad of [
    "a@b.com,c.com",
    "dev@example.com,evil@example.com",
    "<svg/onload=1>@example.com",
    "a\u0000b@example.com",
    "dev@example.com\nBcc: evil@example.com",
    "<dev@example.com>",
    "Dev <dev@example.com>",
    '"a b"@example.com',
    "dev@exa_mple.com",
    "dev@-example.com",
    "dev@example..com",
    ".dev@example.com",
    "dev.@example.com",
    "de..v@example.com",
    "dev@[127.0.0.1]",
    "dev;evil@example.com",
  ]) {
    assert.equal(checkEmail(bad).ok, false, JSON.stringify(bad));
  }
  for (const good of ["dev@example.com", "first.last+tag@mail.example.co.uk", "o'brien@example.ie", "dev-1@sub-domain.example.io"]) assert.equal(checkEmail(good).ok, true, good);
});

test("a developer's email is cleaned up, or the person is told what to type", () => {
  assert.deepEqual(checkEmail("  Dev@Example.COM "), { ok: true, email: "dev@example.com" });
  assert.deepEqual(checkEmail(""), { ok: false, message: "Enter your developer's email." });
  for (const bad of ["dev", "dev@", "dev@example", "dev @example.com", 42, `${"a".repeat(250)}@example.com`]) assert.equal(checkEmail(bad).ok, false, String(bad));
});

const origin = (name: string, allowed: boolean, minutesAgo: number) => ({ origin: name, allowed, last_seen_at: new Date(Date.UTC(2026, 10, 16, 12, 60 - minutesAgo)).toISOString() });

test("the install status: idle, copied, then waiting after a minute, seen on an address not allowed, then live", () => {
  const nothing = { connected: false, origins: [] };
  assert.deepEqual(installStatus(nothing, null, 0), { kind: "idle" });
  assert.deepEqual(installStatus(nothing, 1_000, 1_000 + WAITING_AFTER_MS - 1), { kind: "copied" });
  assert.deepEqual(installStatus(nothing, 1_000, 1_000 + WAITING_AFTER_MS), { kind: "waiting" });
  const local = { connected: false, origins: [origin("https://staging.example.com", false, 30), origin("http://localhost:3000", false, 1)] };
  assert.deepEqual(installStatus(local, null, 0), { kind: "refused", origin: "http://localhost:3000" }, "the newest refused address, copied or not");
  const live = { connected: true, origins: [origin("http://localhost:3000", false, 1), origin("https://app.example.com", true, 5)] };
  assert.deepEqual(installStatus(live, 1_000, 10 * WAITING_AFTER_MS), { kind: "live", origin: "https://app.example.com" }, "live beats everything");
  assert.equal(installStatus({ connected: false, origins: [origin("https://app.example.com", true, 1)] }, null, 0).kind, "idle", "only the Worker says connected");
});

test("the pill's words follow the status", () => {
  assert.equal(pillLabel({ kind: "idle" }), "Onboard your agent");
  assert.equal(pillLabel({ kind: "copied" }), "Paste to your agent");
  assert.equal(pillLabel({ kind: "waiting" }), "Waiting for your agent");
  assert.equal(pillLabel({ kind: "refused", origin: "http://localhost:3000" }), "Script added, on localhost:3000");
  assert.equal(pillLabel({ kind: "live", origin: "https://app.example.com" }), "Haptic is live on app.example.com");
});

test("the agent prompt is one short line pointing at the site's install steps", () => {
  const prompt = agentPrompt("https://joinhaptic.com/", "site_a1b2c3d4e5f6");
  assert.equal(prompt, "Add Haptic to this app. Fetch https://joinhaptic.com/install/site_a1b2c3d4e5f6.md and follow it.");
  assert.equal(playbookUrl("https://joinhaptic.com", "site_x_1"), "https://joinhaptic.com/install/site_x_1.md");
  // Cursor decodes the whole link before reading its parameters, so these would need encoding twice. The prompt has none.
  assert.doesNotMatch(prompt, /[&=#+%?]/);
});

test("each agent's link carries the prompt the way its documentation says, and reads back exactly", () => {
  const prompt = agentPrompt("https://joinhaptic.com", "site_a1b2c3d4e5f6");
  const links = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.link(prompt)]));
  assert.ok(links.claude!.startsWith("claude-cli://open?q="));
  assert.ok(links.cursor!.startsWith("cursor://anysphere.cursor-deeplink/prompt?text="));
  assert.ok(links.codex!.startsWith("codex://new?prompt="));
  assert.equal(new URL(links.claude!).searchParams.get("q"), prompt);
  assert.equal(new URL(links.cursor!).searchParams.get("text"), prompt);
  assert.equal(new URL(links.codex!).searchParams.get("prompt"), prompt);
  for (const agent of AGENTS) assert.match(agent.get, /^https:\/\//, `${agent.name} has a page to get it from`);
  // Claude Code takes at most 5,000 characters, and a cut never splits an emoji.
  assert.equal(new URL(AGENTS[0]!.link("x".repeat(6000))).searchParams.get("q")!.length, 5000);
  assert.equal(truncatePrompt(`${"x".repeat(4)}😀`, 5), "xxxx");
});

test("the install steps hold the tag exactly, say where it goes and how to check it, and nothing else about the site", () => {
  const steps = installPlaybook("https://widget.joinhaptic.com/widget.js", "site_a1b2c3d4e5f6");
  assert.ok(steps.includes('<script src="https://widget.joinhaptic.com/widget.js" data-site="site_a1b2c3d4e5f6" async></script>'));
  assert.match(steps, /Keep data-site="site_a1b2c3d4e5f6" exactly as it is/);
  assert.match(steps, /next\/script/);
  assert.match(steps, /strategy="afterInteractive"/);
  assert.match(steps, /script-src https:\/\/widget\.joinhaptic\.com\nconnect-src https:\/\/widget\.joinhaptic\.com/);
  assert.match(steps, /## 4\. Change nothing else/);
  assert.match(steps, /haptic-root/, "it says what to look for once it runs");
  assert.match(steps, /isn't an allowed origin for this site/, "and that another address stays hidden until it is allowed");
  assert.match(steps, /allowed in the Haptic dashboard/);
});

const env = { WIDGET_URL: "https://widget.joinhaptic.com" };
const get = (path: string, method = "GET") => playbook(new Request(`https://joinhaptic.com${path}`, { method }), env, new URL(`https://joinhaptic.com${path}`));

// That the Worker hands these addresses over before the static pages is tested with the site, in web/test/worker.test.ts.
test("the install steps are served as Markdown at /install/<site>.md, with no sign-in", async () => {
  assert.equal(isPlaybookPath("/install/site_a1b2c3d4e5f6.md"), true);
  assert.equal(isPlaybookPath("/install/"), false);
  const response = get("/install/site_a1b2c3d4e5f6.md");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const text = await response.text();
  assert.ok(text.startsWith("# Add Haptic to this app"));
  assert.ok(text.includes('data-site="site_a1b2c3d4e5f6"'));
  assert.ok(!/joinhaptic\.com\/install|example|company/i.test(text.replace(/widget\.joinhaptic\.com/g, "")), "nothing about the site beyond its id");

  const head = get("/install/site_a1b2c3d4e5f6.md", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(get("/install/site_a1b2c3d4e5f6.md", "POST").status, 405);
  for (const bad of ["/install/site_A.md", "/install/nope.md", "/install/site_a1b2c3d4e5f6/x.md", "/install/.md"]) assert.equal(get(bad).status, 404, bad);
});

const page = (path: string, buttons: string[], links: string[] = [], opens: ReadPage["opens"] = undefined): ReadPage => ({
  path,
  title: path,
  buttons,
  links: links.map((label) => ({ label, to: "/x" })),
  fields: ["Name"],
  ...(opens ? { opens } : {}),
});

test("what the reading found: controls counted as the reader counts them, and the ones that delete, pay or hand over", () => {
  const pages = [
    page("/settings", ["Save", "Delete workspace", "Transfer ownership"], ["Billing"], [{ control: "More", links: [{ label: "Remove member", to: "/team" }], buttons: ["Delete workspace"] }]),
    page("/billing", ["Pay invoice", "Download"], ["Help"]),
    page("/", ["Sign up", "Buy now"], ["Pricing"]),
  ];
  assert.equal(pageControls(pages[0]!), 3 + 1 + 1 + 2);
  const risky = riskyControls(pages);
  assert.deepEqual(
    risky.map((item) => `${item.role} ${item.label}`),
    ["button Delete workspace", "link Billing", "button Pay invoice", "link Remove member", "button Transfer ownership"],
  );
  assert.equal(risky[0]!.path, "/settings");
  assert.ok(!risky.some((item) => /Buy now|Sign up|Download/.test(item.label)), "everyday buttons are not suggested");
  const suggested = neverTouchSuggestions([...risky, { label: "pay" }]);
  assert.deepEqual(
    suggested.map((item) => item.label),
    ["Delete workspace", "Billing", "Pay invoice", "Remove member", "Transfer ownership", "pay", "Delete", "Change billing"],
    "what was found first, then the usual ones, with no name twice",
  );
});

test("Never touch starts all ticked, then shows what is saved, and saves exactly the ticked suggestions", () => {
  const suggestions = [{ role: "button", label: "Delete project" }, { label: "Pay" }, { label: "Delete" }];
  assert.equal(neverTouchTicked({ label: "Pay" }, [], false), true, "nothing saved yet: ticked");
  assert.equal(neverTouchTicked({ label: "Pay" }, [], true), false, "saved as nothing: unticked");
  assert.equal(neverTouchTicked({ label: "Pay" }, [{ label: "Delete" }], false), false, "something is ruled out: the ticks are what is");
  assert.equal(neverTouchTicked({ label: "delete" }, [{ label: "Delete" }], false), true);
  const blocked = [{ label: "Archive workspace" }, { label: "Pay" }, { role: "link", label: "Delete" }];
  assert.deepEqual(neverTouchList(suggestions, [suggestions[0]!, suggestions[2]!], blocked), [{ label: "Archive workspace" }, { role: "button", label: "Delete project" }, { role: "link", label: "Delete" }], "Pay unticked comes off, Archive workspace stays, Delete keeps its kind");
  assert.deepEqual(neverTouchList(suggestions, [], blocked), [{ label: "Archive workspace" }]);
});

test("pages that need sign-in: almost nothing to click, or sent to another site, or refused", () => {
  const reading = {
    queue: [],
    seen: [],
    thin: ["/app"],
    failed: [
      { url: "https://a.test/login", reason: "leads to another site" },
      { url: "https://a.test/admin", reason: "HTTP 403" },
      { url: "https://a.test/old", reason: "HTTP 404" },
    ],
    max: 30,
    startedAt: "2026-11-16T00:00:00Z",
  };
  const extras = readingExtras(reading, [{ path: "/", title: "Home", headings: [], links: [{ label: "Delete", to: "/x" }], buttons: ["Go"], fields: [] }]);
  assert.equal(extras.signIn, 3);
  assert.equal(extras.controls, 2);
  assert.deepEqual(extras.risky, [{ role: "link", label: "Delete", path: "/" }]);
});

test("changes against the days before read as plain sentences", () => {
  const period = "the previous 30 days";
  assert.deepEqual(countChange(120, 100, period), { direction: "up", text: "Up 20% on the previous 30 days" });
  assert.deepEqual(countChange(75, 100, period), { direction: "down", text: "Down 25% on the previous 30 days" });
  assert.deepEqual(countChange(5, 5, period), { direction: "same", text: "Same as the previous 30 days" });
  assert.deepEqual(countChange(3, 0, period), { direction: "up", text: "Up from 0 in the previous 30 days" });
  assert.equal(countChange(0, 0, period), null, "nothing to say");
  assert.deepEqual(rateChange(0.62, 0.55, period), { direction: "up", text: "Up 7 points on the previous 30 days" });
  assert.deepEqual(rateChange(0.5, 0.51, period), { direction: "down", text: "Down 1 point on the previous 30 days" });
  assert.equal(rateChange(null, 0.5, period), null);
  assert.deepEqual(durationChange(38_000, 42_000, period), { direction: "down", text: "4 s faster than the previous 30 days" });
  assert.deepEqual(durationChange(125_000, 60_000, period), { direction: "up", text: "1 min 5 s slower than the previous 30 days" });
  assert.equal(durationChange(null, 1, period), null);
  assert.equal(duration(42_400), "42 s");
  assert.equal(duration(180_000), "3 min");
  assert.equal(duration(3_840_000), "1 h 4 min");
});

test("the chart's days are named by their date in UTC, the last one too, never \"Today\"", () => {
  assert.equal(utcDayLabel("2026-11-16", "en-US"), "Nov 16");
  assert.equal(utcDayLabel("2026-01-01", "en-US"), "Jan 1", "the same day wherever the browser is");
  assert.equal(utcDayLabel("2026-11-16", "en-US", true), "Mon, Nov 16");
});
