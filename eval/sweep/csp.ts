import type { Browser, Bundles } from "../toolkits/session.ts";
import type { Page } from "../toolkits/types.ts";
import { countTraffic, openContext, openPage, WIDGET_ORIGIN } from "./context.ts";
import type { Site } from "./sites.ts";
import type { CspResult } from "./types.ts";

// The page loaded with its Content Security Policy left in force, as a browser
// would load it for anyone, and Haptic's tag added to it the way a public demo
// would put it into a site whose owner never allowed it. Does the browser load
// the script from Haptic's address, let it ask for its settings (GET) and for
// a step (POST), and apply its stylesheet?
//
// Every request to Haptic's address that the browser lets out of the page is
// answered here, so nothing reaches Haptic's server; the policy is checked by
// the browser before that, which is what is being asked.

const message = (error: unknown) => (error instanceof Error ? error.message.split("\n")[0]! : String(error));

/** Asks from inside the page, so the page's policy applies, whether a request to Haptic's address may leave. */
const TRY_FETCH = (method: "GET" | "POST") => `(async () => {
  try {
    await fetch(${JSON.stringify(`${WIDGET_ORIGIN}/v1/`)} + (${JSON.stringify(method)} === "GET" ? "sites/site_sweep" : "turn"), ${JSON.stringify(method)} === "GET" ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return "allowed";
  } catch (error) {
    return "blocked";
  }
})()`;

const META_POLICIES = `Array.from(document.querySelectorAll('meta[http-equiv]')).filter((m) => /content-security-policy/i.test(m.getAttribute('http-equiv'))).map((m) => (m.getAttribute('content') || '').slice(0, 600))`;

/** The sources a policy allows for a directive, falling back as the browser does. Undefined when nothing restricts it. */
function sources(policy: string, names: string[]): string[] | undefined {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values);
  }
  for (const name of [...names, "default-src"]) if (directives.has(name)) return directives.get(name);
  return undefined;
}

/**
 * Each policy the page set. Several headers arrive joined by a comma or a line
 * break, and no source list holds either. A meta tag holds one policy, which
 * may run over several lines.
 */
export function policiesOf(header: string | undefined, meta: string[]): string[] {
  return [...(header ? header.split(/[,\n]/) : []), ...meta].map((policy) => policy.trim()).filter(Boolean);
}

/** Whether every policy allows an inline <style>: 'unsafe-inline' with no nonce or hash beside it, which would switch it off. */
export function inlineStyleAllowed(policies: string[]): boolean {
  return policies.every((policy) => {
    const allowed = sources(policy, ["style-src-elem", "style-src"]);
    if (!allowed) return true;
    const lower = allowed.map((value) => value.toLowerCase());
    return lower.includes("'unsafe-inline'") && !lower.some((value) => value.startsWith("'nonce-") || value.startsWith("'sha"));
  });
}

/** Whether every policy lets the page send requests to Haptic's address. */
export function connectAllowed(policies: string[]): boolean {
  const host = new URL(WIDGET_ORIGIN).host;
  return policies.every((policy) => {
    const allowed = sources(policy, ["connect-src"]);
    if (!allowed) return true;
    return allowed.some((value) => {
      const v = value.toLowerCase().replace(/\/$/, "");
      return v === "*" || v === "https:" || v === WIDGET_ORIGIN || v === host || v === "*.joinhaptic.com" || v === "https://*.joinhaptic.com";
    });
  });
}

export async function cspSite(browser: Browser, bundles: Bundles, sweepJs: string, site: Site, log: (line: string) => void): Promise<CspResult> {
  const result: CspResult = {
    id: site.id,
    url: site.url,
    kinds: site.kinds,
    status: "tested",
    policy: { meta: [] },
    violations: [],
    script: "not added",
    connectGet: "allowed",
    connectPost: "allowed",
    style: "not mounted",
    inlineStyleAllowed: true,
    connectAllowedByPolicy: true,
    trustedTypes: false,
    mounted: false,
    askWorked: false,
    hapticWarnings: [],
    notes: [],
    at: new Date().toISOString(),
  };
  const ctx = await openContext(browser, bundles, { bypassCSP: false });
  try {
    const opened = await openPage(ctx, site.url, "CSP", "inject");
    countTraffic(ctx, opened);
    if (opened.unreachable) {
      result.status = "could not reach";
      result.whyNot = `the page did not load from this machine: ${opened.record.error}`;
      return result;
    }
    const page: Page = opened.page;
    if (!page || opened.record.error) {
      result.status = "could not test";
      result.whyNot = `the page did not load: ${opened.record.error}`;
      return result;
    }
    if (!(await page.evaluate("!!window.__hapticSweep"))) await page.evaluate(sweepJs);
    const signs: string = await page.evaluate(`window.__hapticSweep.blockSigns(${opened.record.status})`);
    if (signs.startsWith("gone: ")) {
      result.status = "could not reach";
      result.whyNot = `the page is not there: ${signs.slice(6)}`;
      return result;
    }
    if (signs) {
      result.status = "could not test";
      result.whyNot = `the site showed a bot check, a block or an error page: ${signs}`;
      return result;
    }
    const header = opened.headers["content-security-policy"];
    const reportOnly = opened.headers["content-security-policy-report-only"];
    if (header) result.policy.header = header.slice(0, 8000);
    if (reportOnly) result.policy.reportOnly = reportOnly.slice(0, 600);
    result.policy.meta = await page.evaluate(META_POLICIES).catch(() => []);
    const policies = policiesOf(header, result.policy.meta);
    result.trustedTypes = /require-trusted-types-for/i.test(policies.join(" "));
    result.inlineStyleAllowed = inlineStyleAllowed(policies);
    result.connectAllowedByPolicy = connectAllowed(policies);

    // The widget mounts once its script has run and its settings came back.
    await page.waitForSelector("haptic-root", { state: "attached", timeout: 8000 }).catch(() => undefined);
    result.mounted = await page.evaluate("!!document.querySelector('haptic-root')");
    const tag: string = await page.evaluate("window.__sweepTag || ''");
    result.connectGet = await page.evaluate(TRY_FETCH("GET"));
    result.connectPost = await page.evaluate(TRY_FETCH("POST"));
    const violations: { directive: string; blocked: string }[] = await page.evaluate("window.__sweepCsp || []");
    result.violations = violations;
    const blockedScript = violations.some((v) => /^script-src/.test(v.directive) && v.blocked.startsWith(WIDGET_ORIGIN));
    result.script = blockedScript ? "blocked" : tag === "loaded" ? "loaded" : tag === "failed" ? "failed" : tag ? "not added" : "not added";
    if (result.mounted) {
      const styled = await page.evaluate("window.__hapticSweep.styled()");
      result.style = (styled as { styled: boolean }).styled ? "applied" : "blocked";
    }
    result.hapticWarnings = opened.record.hapticWarnings;

    // A question typed into Haptic's box, to see a step go out.
    if (result.mounted && result.style === "applied") {
      try {
        const launcher = page.locator("haptic-root .launcher");
        await launcher.click({ timeout: 3000 });
        await page.locator("haptic-root .panel input").pressSequentially("Where is the help page?", { delay: 30, timeout: 5000 });
        await page.keyboard.press("Enter");
        const sentBefore = ctx.traffic.get(page)?.turns ?? 0;
        for (const until = Date.now() + 20_000; Date.now() < until; ) {
          if ((ctx.traffic.get(page)?.turns ?? 0) > sentBefore) break;
          await page.waitForTimeout(250);
        }
        result.askWorked = (ctx.traffic.get(page)?.turns ?? 0) > sentBefore;
      } catch (error) {
        result.notes.push(`Asking a question failed: ${message(error)}`);
      }
    }
    result.hapticWarnings = opened.record.hapticWarnings;
    const more: { directive: string; blocked: string }[] = await page.evaluate("window.__sweepCsp || []").catch(() => []);
    result.violations = more;
    log(`    policy ${header ? "header" : result.policy.meta.length ? "meta" : "none"}${reportOnly ? " (+report-only)" : ""}; script ${result.script}; GET ${result.connectGet}; POST ${result.connectPost}; style ${result.style}; mounted ${result.mounted}; asked ${result.askWorked}`);
  } catch (error) {
    result.notes.push(`The check stopped with an error in the test: ${message(error)}`);
  } finally {
    await ctx.context.close().catch(() => undefined);
  }
  return result;
}
