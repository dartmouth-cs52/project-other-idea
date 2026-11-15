import { parseArgs } from "node:util";
import type { Snapshot } from "../src/shared/types.ts";
import { ask, launch, loadGuideSet, open, perform } from "./browser.ts";
import type { Act, GuideSet } from "./guide.ts";
import { describeSent } from "./net.ts";

// Shows a page the way the widget reads it: every control it would list for
// the model, with the role, label, icon, state, link and surroundings it
// gives each. Use it before writing a guide, so the script names controls the
// way the widget does, and to see what Haptic misses on a page.
//
//   npm run eval:look -- https://example.com/pricing
//   npm run eval:look -- ui5cart "/index.html#/cart" --do "click:button[title='Edit']"
//
// The first form looks at any address. The second uses a guide set from
// eval/guides, so its sign-in and banner handling apply, and takes a path.

const HELP = `Usage: npm run eval:look -- <address | guide set> [path] [options]

  --do <act>     Something to do on the page before looking. Repeat for more, in order.
                 click:<selector>   fill:<selector>=<text>   select:<selector>=<option>
                 check:<selector>   press:<selector>=<key>   hover:<selector>
  --text         Also print the page text the widget sends.
  --json         Print the whole snapshot as JSON instead.`;

function parseAct(text: string): Act {
  const [verb, ...rest] = text.split(":");
  const body = rest.join(":");
  const cut = body.lastIndexOf("=");
  const pair = (): [string, string] => {
    if (cut < 1) throw new Error(`"${text}" needs a value after "=".`);
    return [body.slice(0, cut), body.slice(cut + 1)];
  };
  if (verb === "click") return { click: body };
  if (verb === "check") return { check: body };
  if (verb === "hover") return { hover: body };
  if (verb === "fill") return { fill: pair() };
  if (verb === "select") return { select: pair() };
  if (verb === "press") return { press: pair() };
  throw new Error(`"${text}" isn't something to do. ${HELP}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { do: { type: "string", multiple: true }, text: { type: "boolean", default: false }, json: { type: "boolean", default: false }, help: { type: "boolean", default: false } },
  });
  const [where, pathGiven] = positionals;
  if (values.help || !where) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }

  let set: GuideSet;
  let path: string;
  if (URL.canParse(where)) {
    const url = new URL(where);
    set = { siteId: "site_look", origin: url.origin, hasTag: false, guides: [] };
    path = url.pathname + url.search + url.hash;
  } else {
    set = await loadGuideSet(where);
    path = pathGiven ?? "/";
  }
  const acts = (values.do ?? []).map(parseAct);

  const browser = await launch();
  try {
    let seen: Snapshot | undefined;
    const { page, close, net } = await open(browser, set, path, (request) => {
      seen = request.snapshot;
      return { target: null, status: "done", say: "Looked." };
    });
    for (const [index, act] of acts.entries()) {
      net?.acting(`did --do number ${index + 1}`);
      await perform(page, act);
      await page.waitForTimeout(600);
    }
    await ask(page, "look");
    const deadline = Date.now() + 15_000;
    while (!seen && Date.now() < deadline) await page.waitForTimeout(50);
    await close();
    if (!seen) throw new Error("The widget never sent the page. It may not have loaded here.");
    print(seen, values.text, values.json);
    // On a site that is not a sandbox, what the page sent other than plain reads. With --json it goes to the error stream, so the JSON stays whole.
    if (net) {
      const lines = describeSent(net.log);
      const say = values.json ? console.error : console.log;
      say(lines.length ? `\n${lines.join("\n")}` : "\nThe page sent nothing but plain reads.");
      const spoiled = net.spoiled();
      if (spoiled) say(`\nA guide run here would not be scored: ${spoiled.why}.`);
    }
  } finally {
    await browser.close();
  }
}

function print(snapshot: Snapshot, withText: boolean, asJson: boolean) {
  if (asJson) return console.log(JSON.stringify(snapshot, null, 1));
  console.log(`path ${snapshot.path}   title "${snapshot.title}"${snapshot.dialog !== undefined ? `   dialog "${snapshot.dialog}"` : ""}`);
  if (snapshot.headings.length) console.log(`headings: ${snapshot.headings.map((heading) => `"${heading}"`).join(", ")}`);
  const unnamed = snapshot.elements.filter((element) => !element.label && !element.icon).length;
  console.log(
    `${snapshot.elements.length} controls${snapshot.truncated ? " (the page has more: the list was cut at the limit)" : ""}, ` +
      `${unnamed} with no label or icon, ${snapshot.text.length} pieces of text\n`,
  );
  for (const element of snapshot.elements) {
    const extras = [
      element.icon && `icon ${element.icon}`,
      element.state?.join(" "),
      element.href && `to ${element.href}`,
      element.context && `in ${element.context}`,
      element.offscreen && `off screen, ${element.offscreen}`,
    ].filter(Boolean);
    console.log(`${element.id.padEnd(5)} ${element.role.padEnd(10)} "${element.label}"${extras.length ? `   [${extras.join("; ")}]` : ""}`);
  }
  if (withText) console.log(`\ntext:\n${snapshot.text.map((text) => `  ${text}`).join("\n")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
