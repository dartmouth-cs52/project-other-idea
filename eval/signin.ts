import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launch, loadGuideSet, perform } from "./browser.ts";

// Signs in to a benchmark app the way its guides do (the `before` of
// eval/guides/<name>.ts) and saves the browser's cookies and storage, so the
// intake's browser reader can read the pages behind the sign-in:
//
//   npx tsx eval/signin.ts orangehrm
//   npm run tag -- --id site_bench_orangehrm --session data/sessions/site_bench_orangehrm.json
//
// It is for the benchmark's own demo accounts only, which the guides already
// use on every run. The file it writes is a live session: it is kept in data/,
// which is never committed. A customer's app needs a session the customer
// hands over; see "A map of the site" in eval/README.md.

const SESSIONS_DIR = fileURLToPath(new URL("../data/sessions/", import.meta.url));

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("Say which guide set to sign in with: npx tsx eval/signin.ts orangehrm");
  const set = await loadGuideSet(name);
  if (!set.before) throw new Error(`eval/guides/${name}.ts does nothing before its guides, so there is no session to save. Read the site without --session.`);
  const browser = await launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const page = await context.newPage();
    await page.goto(set.origin + set.before.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
    for (const act of set.before.acts) await perform(page, act);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    // A sign-in that ends on a page load may still be on its way. The session is the one the first guide's page sees.
    const first = set.guides[0]?.start ?? "/";
    await page.goto(set.origin + first, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    console.log(`After signing in, ${first} opened as ${page.url()}`);
    await mkdir(SESSIONS_DIR, { recursive: true });
    const file = `${SESSIONS_DIR}${set.siteId}.json`;
    await context.storageState({ path: file });
    console.log(`Signed in as the guides do and saved the session to ${file}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
