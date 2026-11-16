import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadSite } from "../src/server/sites.ts";
import type { Snapshot, TurnRequest } from "../src/shared/types.ts";
import { ANSWERS_DIR, type AnswerFile } from "./answers.ts";

// Refreshes what an Answers case file knows about its site: the site's context
// (with its help docs) and each page its questions are asked on, as the real
// widget sees it. The questions themselves are written by hand and are kept.
// Run it again whenever the site's help docs, its pages or the widget's reading
// of a page change.
//
//   npm run eval:answers:record -- demo        (needs the local server: HAPTIC_MODEL=mock npm run dev)
//
// The site has to be in data/sites first, with Answers on:
//   npm run tag -- --url http://localhost:4000/demo/ --id site_demo --name "Acme Console" \
//     --notes demo/notes.md --docs demo/help --answers on
//
// It drives a browser with Playwright, which this project does not install.
// Add it for the run: npm install --no-save playwright && npx playwright install chromium

/** The site and the pages each file's questions are asked on. */
const SITES: Record<string, { siteId: string; origin: string; pages: string[] }> = {
  demo: {
    siteId: "site_demo",
    origin: process.env.HAPTIC_PUBLIC_URL || "http://localhost:4000",
    pages: ["/demo/", "/demo/projects", "/demo/team", "/demo/settings", "/demo/settings-billing", "/demo/settings-security"],
  },
};

async function main() {
  const name = process.argv[2] ?? "";
  const set = SITES[name];
  if (!set) throw new Error(`Say which file to refresh: ${Object.keys(SITES).join(", ")}.`);
  const site = await loadSite(set.siteId);
  if (!site) throw new Error(`There is no ${set.siteId} in data/sites yet. Build it first with npm run tag.`);
  if (!site.answers?.enabled) throw new Error(`${set.siteId} doesn't have Answers on. Build it again with --answers on.`);

  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright"));
  } catch {
    throw new Error("Playwright isn't installed. Add it for this run: npm install --no-save playwright && npx playwright install chromium");
  }
  const browser = await chromium.launch();
  const pages: Record<string, Snapshot> = {};
  try {
    for (const path of set.pages) {
      const page = await browser.newPage();
      // The widget's own request is what is kept, so the page is exactly what the server would be sent.
      let seen: Snapshot | undefined;
      await page.route("**/v1/turn", async (route: { request(): { postDataJSON(): TurnRequest }; fulfill(reply: unknown): Promise<void> }) => {
        seen = route.request().postDataJSON().snapshot;
        await route.fulfill({ json: { target: null, status: "done", say: "Recorded." } });
      });
      await page.goto(set.origin + path);
      await page.waitForSelector("haptic-root", { state: "attached" });
      await page.locator("haptic-root .launcher").click();
      await page.locator("haptic-root .ask input").fill("What is on this page?");
      await page.locator("haptic-root .ask input").press("Enter");
      const deadline = Date.now() + 10_000;
      while (!seen && Date.now() < deadline) await page.waitForTimeout(50);
      if (!seen) throw new Error(`The widget never asked about ${path}.`);
      pages[seen.path] = seen;
      console.log(`${seen.path}: ${seen.elements.length} controls`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const path = `${ANSWERS_DIR}${name}.json`;
  let file: AnswerFile = { site, pages, cases: [] };
  try {
    const kept = JSON.parse(await readFile(path, "utf8")) as AnswerFile;
    file = { ...kept, site, pages };
  } catch {
    // No file yet. It starts with no questions.
  }
  await mkdir(ANSWERS_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 1) + "\n");
  console.log(`Wrote the site and ${Object.keys(pages).length} pages to eval/answers/${name}.json. It has ${file.cases.length} questions.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
