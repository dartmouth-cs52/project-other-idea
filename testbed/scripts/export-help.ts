// Writes Northpine's help center articles out as Markdown, one file each, so
// Haptic can be given them as help docs the way a real customer's would be.
// The articles live in the app's code, inside the single-page app, where the
// crawl can't read them.
//
//   npm run help:export            # writes testbed/help-docs/*.md
//
// Then, from the repo root, build the site with them (Answers is on for a site with help docs):
//   npm run tag -- --url http://localhost:4200 --id site_testbed --name Northpine \
//     --notes testbed/haptic-notes.md --docs testbed/help-docs --allow http://localhost:4200

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ARTICLES, CATEGORIES } from "../src/modules/help/articles.ts";

const OUT = fileURLToPath(new URL("../help-docs/", import.meta.url));
const BASE = process.env.TESTBED_URL ?? "http://localhost:4200";

await mkdir(OUT, { recursive: true });
for (const name of await readdir(OUT)) if (name.endsWith(".md")) await rm(new URL(name, `file://${OUT}`));

for (const article of ARTICLES) {
  const category = CATEGORIES.find((item) => item.id === article.category)?.label ?? article.category;
  const lines = [
    "---",
    `title: ${article.title}`,
    `url: ${BASE}/help/${article.slug}`,
    `updated: ${article.updated}`,
    "---",
    `# ${article.title}`,
    "",
    `${category}. ${article.summary}`,
    "",
    article.intro,
    "",
    ...article.steps.map((step, index) => `${index + 1}. ${step}`),
  ];
  if (article.tip) lines.push("", `Tip: ${article.tip}`);
  if (article.action) lines.push("", `${article.action.label}: ${article.action.to}`);
  await writeFile(`${OUT}${article.slug}.md`, lines.join("\n") + "\n");
}
console.log(`Wrote ${ARTICLES.length} articles to testbed/help-docs.`);
