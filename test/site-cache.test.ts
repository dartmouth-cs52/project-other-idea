import assert from "node:assert/strict";
import { test } from "node:test";
import { createSiteCache } from "../src/server/site-cache.ts";
import { DEFAULT_APPEARANCE, type SiteContext } from "../src/shared/types.ts";

const site = (name: string): SiteContext => ({
  version: 1,
  id: "site_test",
  name,
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "",
  updatedAt: "",
});

/** A cache with a clock the test moves by hand, a loader that counts its calls, and work handed to "later" kept to be awaited. */
function setup() {
  let time = 0;
  let loads = 0;
  let next: SiteContext | undefined | Error = site("first");
  const after: Promise<unknown>[] = [];
  const get = createSiteCache({ keepMs: 60_000, maxStaleMs: 600_000, retryMs: 10_000, now: () => time });
  const load = async () => {
    loads++;
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    get: (hurry = false) => get("site_test", load, hurry ? (work) => void after.push(work) : undefined),
    pass: (ms: number) => void (time += ms),
    serve: (value: SiteContext | undefined | Error) => void (next = value),
    loads: () => loads,
    settle: () => Promise.all(after.splice(0)),
  };
}

test("a site is fetched once and then answered from memory while it is fresh", async () => {
  const cache = setup();
  assert.equal((await cache.get())?.name, "first");
  cache.pass(59_000);
  assert.equal((await cache.get(true))?.name, "first");
  assert.equal(cache.loads(), 1);
});

test("a caller with time waits for the fresh copy once the held one is stale", async () => {
  const cache = setup();
  await cache.get();
  cache.serve(site("second"));
  cache.pass(61_000);
  assert.equal((await cache.get())?.name, "second");
});

test("a caller in a hurry gets the stale copy at once, and the fresh one is there for the next", async () => {
  const cache = setup();
  await cache.get();
  cache.serve(site("second"));
  cache.pass(61_000);
  assert.equal((await cache.get(true))?.name, "first");
  await cache.settle();
  assert.equal((await cache.get(true))?.name, "second");
  assert.equal(cache.loads(), 2);
});

test("a copy too old to trust is not handed out, even in a hurry", async () => {
  const cache = setup();
  await cache.get();
  cache.serve(site("second"));
  cache.pass(601_000);
  assert.equal((await cache.get(true))?.name, "second");
});

test("no such site is never answered from a stale copy, so a new site shows up", async () => {
  const cache = setup();
  cache.serve(undefined);
  assert.equal(await cache.get(true), undefined);
  cache.serve(site("made since"));
  cache.pass(61_000);
  assert.equal((await cache.get(true))?.name, "made since");
});

test("when the fetch fails, the held copy is used and the next try waits a little", async () => {
  const cache = setup();
  await cache.get();
  cache.serve(new Error("database down"));
  cache.pass(61_000);
  assert.equal((await cache.get())?.name, "first");
  assert.equal(cache.loads(), 2);
  cache.pass(5_000);
  assert.equal((await cache.get())?.name, "first");
  assert.equal(cache.loads(), 2, "no new fetch inside the retry wait");
  cache.serve(site("back"));
  cache.pass(6_000);
  assert.equal((await cache.get())?.name, "back");
});

test("when the fetch fails and nothing is held, the failure is passed on and not remembered as no such site", async () => {
  const cache = setup();
  cache.serve(new Error("database down"));
  await assert.rejects(cache.get());
  cache.serve(site("first"));
  assert.equal((await cache.get())?.name, "first");
});

test("requests arriving together share one fetch", async () => {
  const cache = setup();
  await Promise.all([cache.get(), cache.get(), cache.get(true)]);
  assert.equal(cache.loads(), 1);
});
