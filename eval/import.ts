import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadSite } from "../src/server/sites.ts";
import { cleanText, describeElement, type TurnReply, type TurnRequest } from "../src/shared/types.ts";
import { CASES_DIR, type Case, type CaseFile } from "./cases.ts";

// Turns steps that real visitors took into benchmark cases.
//
// A scripted guide tests what its author thought of. A real session tests what
// people actually ask, on the pages they were actually on, which is the only
// lasting source of cases nobody would have written. This reads steps recorded
// by the server (HAPTIC_RECORD=1, see src/server/record.ts) and writes a draft
// case for each.
//
//   npm run eval:import -- data/recordings/site_ab12cd34ef.jsonl --name acme
//
// A draft is not a case yet. What the model pointed at is filled in as the
// expected answer, and that is exactly the thing in question, so every draft
// is marked "reviewed": false and is left out of runs. Someone who knows the
// site reads each one, corrects "expect", and sets "reviewed" to true.
//
// A recording holds visitors' questions and the names of the controls on their
// pages. Emails and long numbers in the questions are masked here, but read
// every question before committing the file: a name or an account detail can
// be typed into a question too.

interface Recorded {
  at: string;
  request: TurnRequest;
  reply: TurnReply;
  model: string;
  ms: number;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "question";

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string" }, "held-out": { type: "boolean", default: false } } });
  const [source] = positionals;
  if (!source || !values.name) {
    console.log("Usage: npm run eval:import -- <recording.jsonl> --name <case file> [--held-out]");
    process.exit(1);
  }

  const lines = (await readFile(source, "utf8")).split("\n").filter((line) => line.trim());
  const steps = lines.map((line) => JSON.parse(line) as Recorded);
  if (!steps.length) throw new Error(`${source} has no steps in it.`);
  const siteId = steps[0]!.request.site;
  if (steps.some((step) => step.request.site !== siteId)) throw new Error("The recording mixes sites. Import one site at a time.");
  const site = await loadSite(siteId);
  if (!site) throw new Error(`There is no ${siteId} in data/sites, and the cases need the site's context. Build it with npm run tag.`);

  const target = `${CASES_DIR}${values.name}.json`;
  let file: CaseFile;
  try {
    file = JSON.parse(await readFile(target, "utf8")) as CaseFile;
    if (file.site.id !== siteId) throw new Error(`eval/cases/${values.name}.json is for ${file.site.id}, and this recording is from ${siteId}.`);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    file = { site, cases: [] };
  }

  // A question with step 0 starts a guide. The steps after it belong to it until the next one.
  const taken = new Set(file.cases.map((item) => item.guide));
  let guide = "";
  let added = 0;
  for (const { request, reply, at } of steps) {
    if (request.step === 0 || !guide) {
      const base = slug(cleanText(request.goal, 300));
      guide = base;
      for (let n = 2; taken.has(guide); n++) guide = `${base}-${n}`;
      taken.add(guide);
    }
    const { site: _site, ...rest } = request;
    const pointed = reply.target ? request.snapshot.elements.find((element) => element.id === reply.target) : undefined;
    const item: Case = {
      id: `${guide}-${request.step + 1}`,
      guide,
      ...(values["held-out"] ? { heldOut: true } : {}),
      reviewed: false,
      note: `From a real session on ${at.slice(0, 10)}. The model pointed at ${pointed ? describeElement(pointed) : "nothing"} and said: "${reply.say}". Check that this was right, correct "expect" if not, then set "reviewed" to true.`,
      // The question is the one thing here a visitor typed.
      request: { ...rest, goal: cleanText(request.goal, 300), history: request.history.map((turn) => (turn.role === "user" ? { ...turn, text: cleanText(turn.text, 300) } : turn)) },
      // A case expects "continue" or "done". A reply that was stuck had nothing left to point at, which a case writes as "done".
      expect: { targets: pointed ? [{ label: pointed.label, role: pointed.role }] : [], status: reply.status === "continue" ? "continue" : "done" },
    };
    file.cases.push(item);
    added++;
  }

  await writeFile(target, JSON.stringify(file, null, 1) + "\n");
  const guides = new Set(file.cases.filter((item) => item.reviewed === false).map((item) => item.guide)).size;
  console.log(`Drafted ${added} case${added === 1 ? "" : "s"} into eval/cases/${values.name}.json, which now holds ${guides} unchecked question${guides === 1 ? "" : "s"}.`);
  console.log(`They are left out of runs until each has been checked and marked "reviewed": true. Read every question for anything private before committing the file.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
