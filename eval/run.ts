// Replays saved snapshots through the real /api/v1/turn endpoint and checks
// whether the first point lands on an expected element.
//
//   npm run dev                                   (web on :4000)
//   npm run eval -- gemini-3.5-flash-lite gemini-3.8-flash claude-haiku-5-5
//
// Uses the built-in dev site, so it needs HAPTIC_DEV_KEY (pk_dev_local by
// default) and a development server, which accepts the x-haptic-model header.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { EventStreamDecoder, type TurnRequest } from "../packages/protocol/src/index.ts";

interface Case extends Omit<TurnRequest, "history"> {
  name: string;
  expect: string[];
}

const API = process.env.HAPTIC_API ?? "http://localhost:4000";
const ORIGIN = "http://localhost:4100";
const KEY = process.env.HAPTIC_DEV_KEY ?? "pk_dev_local";
const RUNS = Number(process.env.EVAL_RUNS ?? 1);
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gemini-3.5-flash-lite"];
const cases = JSON.parse(readFileSync(new URL("./cases/demo.json", import.meta.url), "utf8")) as Case[];

async function session(): Promise<string> {
  const res = await fetch(`${API}/api/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ key: KEY }),
  });
  if (!res.ok) throw new Error(`session failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
}

interface Result {
  model: string;
  name: string;
  hit: boolean;
  pointed?: string;
  text: string;
  firstPointMs?: number;
  totalMs: number;
  error?: string;
}

async function runCase(token: string, model: string, testCase: Case): Promise<Result> {
  const { name, expect, ...request } = testCase;
  const started = performance.now();
  const res = await fetch(`${API}/api/v1/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: ORIGIN, "x-haptic-model": model },
    body: JSON.stringify({ ...request, history: [] }),
  });
  if (!res.ok || !res.body) return { model, name, hit: false, text: "", totalMs: 0, error: `${res.status}` };

  const decoder = new EventStreamDecoder();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let pointed: string | undefined;
  let firstPointMs: number | undefined;
  let text = "";
  let error: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const event of decoder.push(value)) {
      if (event.type === "point" && !pointed) {
        pointed = event.id;
        firstPointMs = Math.round(performance.now() - started);
      } else if (event.type === "text") text += event.text;
      else if (event.type === "error") error = event.message;
    }
  }
  return {
    model,
    name,
    hit: pointed !== undefined && expect.includes(pointed),
    ...(pointed ? { pointed } : {}),
    text: text.trim(),
    ...(firstPointMs ? { firstPointMs } : {}),
    totalMs: Math.round(performance.now() - started),
    ...(error ? { error } : {}),
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const token = await session();
const results: Result[] = [];
for (const model of models) {
  for (let run = 0; run < RUNS; run++) {
    // A few at a time keeps rate limits happy and timings honest.
    for (let i = 0; i < cases.length; i += 4) {
      const batch = cases.slice(i, i + 4);
      results.push(...(await Promise.all(batch.map((testCase) => runCase(token, model, testCase)))));
    }
  }
}

for (const result of results.filter((r) => !r.hit)) {
  console.log(`miss  ${result.model.padEnd(24)} ${result.name.padEnd(22)} pointed=${result.pointed ?? "none"} ${result.error ?? ""} "${result.text.slice(0, 90)}"`);
}
console.log("");
console.log(`${"model".padEnd(26)}${"hits".padEnd(10)}${"p50 point".padEnd(12)}${"p90 point".padEnd(12)}p50 total`);
for (const model of models) {
  const rows = results.filter((r) => r.model === model);
  const hits = rows.filter((r) => r.hit).length;
  const points = rows.map((r) => r.firstPointMs).filter((ms): ms is number => ms !== undefined);
  console.log(
    `${model.padEnd(26)}${`${hits}/${rows.length}`.padEnd(10)}${`${percentile(points, 50)} ms`.padEnd(12)}${`${percentile(points, 90)} ms`.padEnd(12)}${percentile(rows.map((r) => r.totalMs), 50)} ms`,
  );
}

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
const file = new URL(`./results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(results, null, 1));
console.log(`\nSaved ${file.pathname}`);
