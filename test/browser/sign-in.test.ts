import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Browser, Page } from "playwright";
import type { MapReport } from "../../src/shared/types.ts";
import { beginMapping, type MapPage } from "../../web/worker/map-run.ts";
import { signIn, type SignInPage } from "../../web/worker/sign-in.ts";
import { BROWSERS, launch, page, startHarness, type Harness } from "./harness.ts";

// Mapping with an account the company gives: Haptic's own browser signs in
// (web/worker/sign-in.ts) and sets the mapper going with no one to press
// Start (web/worker/map-run.ts). On Cloudflare the browser is Puppeteer's.
// These run the same steps in Playwright's, which has what they use.
//
// The code that runs in the page is handed over as source text. The Worker's
// bundle leaves it as written (keep_names is off in web/wrangler.jsonc). tsx,
// which runs these tests, wraps each function in a helper that names it, so
// every page here is given that helper first.

const PASS = "cd".repeat(24);
const NAME = "tester@acme.test";
const PASSWORD = "correct horse battery";

/** A sign-in page that keeps what was sent to it, so a test can see how often and with what. */
const login = (form: string, script = "") => `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>
  <h1>Sign in</h1>${form}<p role="alert" id="said"></p>
  <script>
    const tried = () => Number(sessionStorage.getItem("tries") || 0);
    function check(event) {
      event.preventDefault();
      sessionStorage.setItem("tries", String(tried() + 1));
      const name = document.querySelector("[name=email]").value;
      const word = document.querySelector("[name=password]").value;
      if (name === ${JSON.stringify(NAME)} && word === ${JSON.stringify(PASSWORD)}) { sessionStorage.setItem("in", "yes"); location.href = "/"; }
      else document.getElementById("said").textContent = "Wrong email or password.";
    }
    ${script}
  </script></body></html>`;

const ONE_STEP = login(`<form onsubmit="check(event)">
  <label>Search <input name="q" type="search"></label>
  <label>Email <input name="email" type="email" autocomplete="username"></label>
  <label>Password <input name="password" type="password" autocomplete="current-password"></label>
  <button type="button">Sign in with Google</button> <button type="button">Forgot password</button> <button type="submit">Sign in</button>
</form>`);

const TWO_STEPS = login(
  `<form id="first" onsubmit="next(event)"><label>Email <input name="email" type="email"></label><button>Continue</button></form>
   <form id="second" hidden onsubmit="check(event)"><label>Password <input name="password" type="password"></label><button>Log in</button></form>`,
  `function next(event) { event.preventDefault(); setTimeout(() => { document.getElementById("second").hidden = false; document.querySelector("#first button").hidden = true; }, 600); }`,
);

const CAPTCHA = login(`<form onsubmit="check(event)"><input name="email" type="email"><input name="password" type="password">
  <iframe src="https://www.google.com/recaptcha/api2/anchor" width="300" height="80"></iframe><button>Sign in</button></form>`);

const CODE = login(
  `<form id="first" onsubmit="ask(event)"><input name="email" type="email"><input name="password" type="password"><button>Sign in</button></form>
   <form id="second" hidden><label>Code <input name="code" autocomplete="one-time-code"></label><button>Verify</button></form>`,
  `function ask(event) { event.preventDefault(); document.getElementById("first").remove(); document.getElementById("second").hidden = false; }`,
);

const APP = page(`<nav><a href="/">Home</a> <a href="/projects">Projects</a></nav><main><h1 id="h"></h1><button id="quick">Quick add</button></main>
  <script>document.getElementById("h").textContent = location.pathname === "/projects" ? "Projects" : "Home";</script>`);

const asPage = (tab: Page) => tab as unknown as MapPage & SignInPage;
const reports = (harness: Harness) => harness.posts.filter((post) => post.path === "/v1/map").map((post) => post.body as MapReport);

for (const name of BROWSERS) {
  describe(`mapping with an account in ${name}`, () => {
    let browser: Browser;
    let harness: Harness;
    let here: (origin: string) => boolean;
    before(async () => {
      browser = await launch(name);
      harness = await startHarness();
      harness.fallback = APP;
      here = (origin) => origin === harness.url;
    });
    after(async () => {
      await browser.close();
      await harness.close();
    });
    const open = async (html: string) => {
      harness.pages.set("/login", html);
      harness.posts.length = 0;
      return newTab();
    };
    const newTab = async () => {
      const tab = await browser.newPage();
      await tab.addInitScript("globalThis.__name = (fn) => fn");
      return tab;
    };
    const fails = async (tab: Page, using = { username: NAME, password: PASSWORD }, allowed = here) => {
      try {
        await signIn(asPage(tab), { url: `${harness.url}/login`, ...using }, allowed);
      } catch (error) {
        // By name: the test and the Worker's files can each load their own copy of the class.
        assert.ok(error instanceof Error && error.name === "CannotMap", String(error));
        return error.message;
      }
      assert.fail("it signed in");
    };

    test("it signs in, and the mapper starts with no one pressing Start", async () => {
      const tab = await open(ONE_STEP);
      await signIn(asPage(tab), { url: `${harness.url}/login`, username: NAME, password: PASSWORD }, here);
      assert.equal(await tab.evaluate(() => sessionStorage.getItem("in")), "yes");
      // The search box above the form was left alone, and the form was sent once.
      assert.equal(await tab.evaluate(() => sessionStorage.getItem("tries")), "1");

      await beginMapping(asPage(tab), `${harness.url}/`, PASS, here);
      await tab.waitForFunction(() => document.querySelector("haptic-root")?.shadowRoot?.querySelector(".map strong")?.textContent === "Mapping is done", null, { timeout: 60_000 });
      const sent = reports(harness);
      assert.ok(sent.every((report) => report.pass === PASS));
      const paths = new Set(sent.flatMap((report) => (report.page ? [report.page.path] : [])));
      assert.ok(paths.has("/") && paths.has("/projects"), [...paths].join(" "));
      await tab.close();
    });

    test("a name first and the password on the next step", async () => {
      const tab = await open(TWO_STEPS);
      await signIn(asPage(tab), { url: `${harness.url}/login`, username: NAME, password: PASSWORD }, here);
      assert.equal(await tab.evaluate(() => sessionStorage.getItem("in")), "yes");
      await tab.close();
    });

    test("a wrong password is tried once and said, without the password in what is said", async () => {
      const tab = await open(ONE_STEP);
      const said = await fails(tab, { username: NAME, password: "not the password" });
      assert.match(said, /did not accept that sign-in/);
      assert.match(said, /Wrong email or password/);
      assert.ok(!said.includes("not the password"));
      assert.equal(await tab.evaluate(() => sessionStorage.getItem("tries")), "1");
      await tab.close();
    });

    test("nothing is typed on an address the company has not allowed", async () => {
      // The same server under its other name stands in for a sign-in service on another site.
      const elsewhere = harness.url.replace("localhost", "127.0.0.1");
      harness.pages.set("/idp", ONE_STEP);
      const tab = await open(`<!doctype html><script>location.replace(${JSON.stringify(`${elsewhere}/idp`)})</script>`);
      await tab.goto(`${harness.url}/login`);
      await tab.waitForURL(`${elsewhere}/idp`);
      const said = await fails(tab);
      assert.match(said, /not an address Haptic may run on/);
      assert.equal(await tab.evaluate(() => (document.querySelector("[name=password]") as HTMLInputElement).value), "");
      assert.equal(await tab.evaluate(() => (document.querySelector("[name=email]") as HTMLInputElement).value), "");
      await tab.close();
    });

    test("a captcha, and a code after the password, are said and not got past", async () => {
      let tab = await open(CAPTCHA);
      assert.match(await fails(tab), /captcha/);
      assert.equal(await tab.evaluate(() => (document.querySelector("[name=password]") as HTMLInputElement).value), "");
      await tab.close();
      tab = await open(CODE);
      assert.match(await fails(tab), /code after the password/);
      await tab.close();
    });

    test("a page with no sign-in form, and an app without the script, say so", async () => {
      let tab = await open("<!doctype html><h1>Welcome</h1><a href='/login/form'>Sign in</a>");
      assert.match(await fails(tab), /no name or password field/);
      await tab.close();
      harness.pages.set("/bare", "<!doctype html><title>App</title><h1>No script here</h1>");
      tab = await newTab();
      await assert.rejects(beginMapping(asPage(tab), `${harness.url}/bare`, PASS, here), (error: unknown) => error instanceof Error && error.name === "CannotMap" && /script is not on/.test(error.message));
      await tab.close();
    });
  });
}
