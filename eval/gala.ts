import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";

// Haptic on real, well-known sites, for showing to a room.
//
//   npx tsx eval/gala.ts serve                   # the Haptic server on :4000, on Sonnet, ready for mapping
//   npx tsx eval/gala.ts                         # one browser window, a tab per site, ready to ask in
//   npx tsx eval/gala.ts github                  # only that site
//   npx tsx eval/gala.ts add https://example.com # reads a new site in and adds it everywhere (--name, --max-pages)
//   npx tsx eval/gala.ts map example             # sign in, press Start, and Haptic maps the signed-in screens
//   npx tsx eval/gala.ts remove example          # takes a site off the list
//   npx tsx eval/gala.ts rehearse                # asks every question by itself and follows the pointer
//   npx tsx eval/gala.ts rehearse wikipedia      # one site's questions
//   npx tsx eval/gala.ts rehearse --show         # the same, in a window you can watch
//
// The sites are listed in eval/gala-sites.json, with the questions to rehearse.
// eval/gala-extension is written from that list, for an ordinary Chrome:
// reload it at chrome://extensions after adding or removing a site.
//
// Like eval/live.ts, the widget is injected into sites we don't control, and
// their Content Security Policy is ignored so a script from localhost may
// run. Each site needs its context in data/sites first (npm run tag).
//
// A rehearsal clicks whatever Haptic points at, so its questions only lead to
// things that show something. Each one leaves a video and a last screenshot
// in data/gala/, which double as a reel if the network in the room is bad.

interface Demo {
  id: string;
  site: string;
  /** Hostnames the widget is injected on, as this site. */
  hosts: string[];
  url: string;
  questions: string[];
}

const SITES_FILE = fileURLToPath(new URL("./gala-sites.json", import.meta.url));
const EXTENSION = fileURLToPath(new URL("./gala-extension/", import.meta.url));
const DEMOS = JSON.parse(await readFile(SITES_FILE, "utf8")) as Demo[];

const HOST = process.env.HAPTIC_PUBLIC_URL || "http://localhost:4000";
const OUT = "data/gala";
const MAX_STEPS = 8;
// Chrome stops a public site from calling localhost unless the visitor allows it. Only this local setup needs the check off.
const ARGS = ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"];

const args = process.argv.slice(2);
const show = args.includes("--show");
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const valued = ["--name", "--max-pages"].flatMap((name) => (args.includes(name) ? [args.indexOf(name) + 1] : []));
const words = args.filter((arg, index) => !arg.startsWith("--") && !valued.includes(index));
const COMMANDS = ["rehearse", "add", "remove", "map", "serve"];
const command = COMMANDS.includes(words[0] ?? "") ? words[0] : undefined;
const rehearsing = command === "rehearse";
const wanted = command ? words[1] : words[0];

/** The pass that lets a site on this machine be mapped. The server takes it from HAPTIC_MAP_PASS, which `serve` sets. */
async function mapPass(): Promise<string> {
  await mkdir(OUT, { recursive: true });
  const file = `${OUT}/map-pass.txt`;
  const kept = await readFile(file, "utf8").then((text) => text.trim(), () => "");
  if (/^[0-9a-f]{48}$/.test(kept)) return kept;
  const made = randomBytes(24).toString("hex");
  await writeFile(file, made + "\n");
  return made;
}

/** Writes the Chrome extension's three files from the list of sites. */
async function writeExtension(list: Demo[]) {
  const hosts = [...new Set(list.flatMap((demo) => demo.hosts))];
  const matches = hosts.map((host) => `https://${host}/*`);
  const manifest = {
    manifest_version: 3,
    name: "Haptic demo",
    version: "1.0",
    description: "Puts the Haptic widget from a server on this machine onto a few sites, for showing it in an ordinary Chrome. Not for customers: they add the script tag themselves.",
    permissions: ["declarativeNetRequestWithHostAccess"],
    host_permissions: matches,
    declarative_net_request: { rule_resources: [{ id: "csp", enabled: true, path: "rules.json" }] },
    content_scripts: [{ matches, js: ["inject.js"], run_at: "document_end" }],
  };
  const rules = [
    {
      id: 1,
      priority: 1,
      action: { type: "modifyHeaders", responseHeaders: ["content-security-policy", "content-security-policy-report-only"].map((header) => ({ header, operation: "remove" })) },
      condition: { requestDomains: hosts, resourceTypes: ["main_frame"] },
    },
  ];
  const sites = Object.fromEntries(list.flatMap((demo) => demo.hosts.map((host) => [host, demo.site])));
  const inject = `// Written by eval/gala.ts from eval/gala-sites.json. Change the list there, not here.
// Adds the Haptic tag to the page, as a customer's own tag would. These sites have not installed
// Haptic, so rules.json also takes their Content Security Policy off, or the script would be refused.
const HOST = ${JSON.stringify(HOST)};
const SITES = ${JSON.stringify(sites, null, 2)};

const site = SITES[location.hostname];
if (site && window.top === window && !document.querySelector("script[data-haptic-live]")) {
  const script = document.createElement("script");
  script.src = HOST + "/widget.js";
  script.dataset.site = site;
  script.dataset.hapticLive = "";
  document.body.appendChild(script);
}
`;
  await writeFile(`${EXTENSION}manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(`${EXTENSION}rules.json`, JSON.stringify(rules, null, 2) + "\n");
  await writeFile(`${EXTENSION}inject.js`, inject);
}

async function saveList(list: Demo[]) {
  await writeFile(SITES_FILE, JSON.stringify(list, null, 2) + "\n");
  await writeExtension(list);
}

if (command === "serve") {
  // Sonnet unless told otherwise: on these sites Haiku pointed at the wrong control often enough to notice.
  const env = { ...process.env, HAPTIC_MODEL: process.env.HAPTIC_MODEL ?? "claude-sonnet-5-5", HAPTIC_MAP_PASS: await mapPass() };
  const server = spawn("npm", ["run", "start"], { stdio: "inherit", env });
  await new Promise((resolve) => server.on("exit", resolve));
  process.exit(0);
}

if (command === "add") {
  if (!wanted || !URL.canParse(wanted) || new URL(wanted).protocol !== "https:") {
    console.error("Give the address to start from, with https://.\n\n  npx tsx eval/gala.ts add https://app.example.com --name Example");
    process.exit(1);
  }
  const url = new URL(wanted);
  const id = url.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  const site = `site_${id}`;
  if (DEMOS.some((demo) => demo.id === id || demo.hosts.includes(url.hostname))) {
    console.error(`${url.hostname} is already on the list. To read it again: npm run tag -- refresh ${site}`);
    process.exit(1);
  }
  // The same reading of public pages a company gets at signup.
  const tag = ["run", "tag", "--", "--url", url.href, "--id", site, "--max-pages", option("--max-pages") ?? "15", ...(option("--name") ? ["--name", option("--name")!] : [])];
  if (spawnSync("npm", tag, { stdio: "inherit" }).status !== 0) process.exit(1);
  await saveList([...DEMOS, { id, site, hosts: [url.hostname], url: url.href, questions: [] }]);
  console.log(
    `Added ${id}. Haptic has read its public pages.\n\n` +
      `  In the demo window:   npx tsx eval/gala.ts ${id}\n` +
      `  In your own Chrome:   reload "Haptic demo" at chrome://extensions, then open ${url.href}\n` +
      `  Behind its login:     npx tsx eval/gala.ts map ${id}\n\n` +
      `Questions to rehearse go in eval/gala-sites.json.`,
  );
  process.exit(0);
}

if (command === "remove") {
  if (!DEMOS.some((demo) => demo.id === wanted)) {
    console.error(`No site called "${wanted}". There are: ${DEMOS.map((demo) => demo.id).join(", ")}.`);
    process.exit(1);
  }
  await saveList(DEMOS.filter((demo) => demo.id !== wanted));
  console.log(`Took ${wanted} off the list. What Haptic read of it is still in data/sites. Reload the extension at chrome://extensions.`);
  process.exit(0);
}

const demos = DEMOS.filter((demo) => !wanted || demo.id === wanted);
if (!demos.length || (command === "map" && !wanted)) {
  console.error(`${wanted ? `No site called "${wanted}".` : "Say which site."} There are: ${DEMOS.map((demo) => demo.id).join(", ")}.`);
  process.exit(1);
}

/** Adds the widget's tag on every page load of a known site. A string, because tsx's helpers don't exist in the page. */
async function inject(context: BrowserContext) {
  const sites = Object.fromEntries(DEMOS.flatMap((demo) => demo.hosts.map((host) => [host, demo.site])));
  await context.addInitScript(`(() => {
    if (window.top !== window) return;
    const site = ${JSON.stringify(sites)}[location.hostname];
    if (!site) return;
    function add() {
      if (document.querySelector("script[data-haptic-live]")) return;
      const script = document.createElement("script");
      script.src = ${JSON.stringify(`${HOST}/widget.js`)};
      script.dataset.site = site;
      script.dataset.hapticLive = "";
      document.body.appendChild(script);
    }
    if (document.body) add();
    else document.addEventListener("DOMContentLoaded", add, { once: true });
  })();`);
}

interface Reply {
  target: string | null;
  status: string;
  say: string;
}

/** Asks one question and clicks what Haptic points at until it says it is done. */
async function rehearse(context: BrowserContext, demo: Demo, question: string): Promise<{ ok: boolean; lines: string[]; page: Page }> {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const replies: Reply[] = [];
  const lines: string[] = [];
  // The browser keeps the body of a streamed reply from another origin to itself, so each step is
  // fetched here and handed on whole. The pointer shows a moment later than it does live.
  await page.route("**/v1/turn", async (route) => {
    try {
      const response = await route.fetch();
      const body = await response.text();
      // One JSON value per line. Later lines fill in what earlier ones left out.
      const reply = Object.assign({ target: null, status: "", say: "" }, ...body.split("\n").filter(Boolean).map((line) => JSON.parse(line) as object)) as Reply & { error?: string };
      if (reply.error) (reply.status = "error"), (reply.say = reply.error);
      replies.push(reply);
      await route.fulfill({ response, body });
    } catch (error) {
      // The page moved on while the step was being asked for. The widget asks again on the new page.
      if (process.env.GALA_DEBUG) console.log("step unread:", (error as Error).message.split("\n")[0]);
      await route.abort().catch(() => {});
    }
  });

  await page.goto(demo.url, { waitUntil: "domcontentloaded" });
  await page.locator("haptic-root .launcher").click({ timeout: 30_000 });
  await page.locator("haptic-root .ask input").fill(question);
  await page.waitForTimeout(600);
  await page.locator("haptic-root .ask input").press("Enter");

  let seen = 0;
  for (let step = 1; step <= MAX_STEPS; step++) {
    const deadline = Date.now() + 45_000;
    while (replies.length <= seen && Date.now() < deadline) await page.waitForTimeout(100);
    const reply = replies[seen++];
    if (!reply) return lines.push("  no reply within 45 seconds"), { ok: false, lines, page };
    const where = new URL(page.url()).pathname;
    lines.push(`  ${step}. [${reply.status}] ${reply.say}  (${where})`);
    if (reply.status !== "continue") return { ok: reply.status === "done", lines, page };
    if (!reply.target) return lines.push("  told to carry on with nothing pointed at"), { ok: false, lines, page };

    const ring = page.locator("haptic-root .ring");
    // A busy page can take a while to settle before the pointer shows.
    await ring.waitFor({ state: "visible", timeout: 30_000 });
    // Long enough for a room to read the caption and for the pointer to arrive.
    await page.waitForTimeout(1800);
    const box = await ring.boundingBox();
    if (!box) return lines.push("  the highlight had no place on the page"), { ok: false, lines, page };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    await page.waitForTimeout(300);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  lines.push(`  still going after ${MAX_STEPS} steps`);
  return { ok: false, lines, page };
}

if (rehearsing) {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !show, args: ARGS });
  const summary: string[] = [];
  for (const demo of demos) {
    for (const [index, question] of demo.questions.entries()) {
      const name = `${demo.id}-${index + 1}`;
      const context = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
      await inject(context);
      let result: Awaited<ReturnType<typeof rehearse>> | undefined;
      let failure = "";
      try {
        result = await rehearse(context, demo, question);
        await result.page.waitForTimeout(2500);
        await result.page.screenshot({ path: `${OUT}/${name}.png` });
      } catch (error) {
        failure = (error as Error).message.split("\n")[0] ?? "";
      }
      const video = result?.page.video();
      await context.close();
      if (video) await rename(await video.path(), `${OUT}/${name}.webm`).catch(() => {});
      const verdict = result?.ok ? "WORKED" : "FAILED";
      const text = [`${verdict}  ${name}: "${question}"`, ...(result?.lines ?? []), ...(failure ? [`  ${failure}`] : [])].join("\n");
      console.log(text + "\n");
      summary.push(text);
    }
  }
  await browser.close();
  await writeFile(`${OUT}/rehearsal-${wanted ?? "all"}.txt`, summary.join("\n\n") + "\n");
  console.log(`Videos and last screenshots are in ${OUT}/.`);
} else if (command === "map") {
  // The signed-in mapping a company starts from its dashboard (src/widget/map.ts), started from here instead.
  // The pass rides after the # and the widget keeps it for this tab, so signing in first does not lose it.
  const demo = demos[0]!;
  const link = `${demo.url}#haptic-map=${await mapPass()}`;
  const context = await chromium.launchPersistentContext(`${OUT}/profile`, { headless: false, bypassCSP: true, viewport: null, args: ["--start-maximized", ...ARGS] });
  await inject(context);
  context.on("console", (message) => {
    if (message.text().includes("[Haptic]")) console.log(message.text());
  });
  let pages = 0;
  context.on("request", (request) => {
    if (request.url().endsWith("/v1/map") && request.method() === "POST" && (request.postData() ?? "").includes('"page"')) console.log(`  mapped screen ${++pages}`);
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(link, { waitUntil: "domcontentloaded" });
  console.log(
    `\n${demo.id} is open with a panel at the top that says "Map this app for Haptic".\n` +
      `  1. Sign in, in that tab, if you aren't. Use a test account if you have one: it presses buttons to see what they open.\n` +
      `  2. Press Start in the panel and keep the tab in front. It takes a few minutes.\n` +
      `  3. Close the window when the panel says it is done.\n\n` +
      `If the panel says the link has run out, the server was not started with: npx tsx eval/gala.ts serve\n\n` +
      `To do this in your own Chrome instead, with the extension, open:\n  ${link}\n`,
  );
  await new Promise((resolve) => context.on("close", resolve));
  console.log(`${pages} screens mapped into data/sites/${demo.site}.json.`);
} else {
  // Its own profile, so cookie banners dismissed in rehearsal stay dismissed, and nothing here is signed in.
  const context = await chromium.launchPersistentContext(`${OUT}/profile`, { headless: false, bypassCSP: true, viewport: null, args: ["--start-maximized", ...ARGS] });
  await inject(context);
  context.on("console", (message) => {
    if (message.text().includes("[Haptic]")) console.log(message.text());
  });
  for (const [index, demo] of demos.entries()) {
    const page = index === 0 ? (context.pages()[0] ?? (await context.newPage())) : await context.newPage();
    await page.goto(demo.url, { waitUntil: "domcontentloaded" }).catch((error: Error) => console.warn(`${demo.id}: ${error.message.split("\n")[0]}`));
    console.log(`\n${demo.id}  ${demo.url}`);
    for (const question of demo.questions) console.log(`  ${question}`);
  }
  await context.pages()[0]?.bringToFront();
  console.log(`\nClick the Haptic button in the corner of any tab and ask. Close the browser window to stop.`);
  await new Promise((resolve) => context.on("close", resolve));
}
