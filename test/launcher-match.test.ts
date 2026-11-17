import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contrast, INK, POINTER_BLUE } from "../src/shared/colour.ts";
import { DEFAULT_APPEARANCE } from "../src/shared/types.ts";
import { launcherState, matchLauncher, type Brand } from "../web/worker/brand.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// A site's launcher takes the site's own colour, read once when the site is
// added, and once more if its address changes before anyone chooses one. A
// person's choice is never replaced. The pointer is never touched.

const DB = testDatabase("launcher_match");
const ORIGIN = "https://app.northpine.test";
const appearance = { ...DEFAULT_APPEARANCE };

describe("when a site's launcher is matched to the site", () => {
  test("a new site is matched, once for its address", () => {
    assert.deepEqual(launcherState({ appearance }, ORIGIN), { start: true, waiting: true, source: null });
    const done = { appearance: { ...appearance, launcher: "#17633A" }, launcherMatch: { origin: ORIGIN, at: new Date().toISOString(), done: true } };
    assert.deepEqual(launcherState(done, ORIGIN), { start: false, waiting: false, source: "matched" });
    assert.equal(launcherState(done, "https://new.northpine.test").start, true, "a new address is read again");
  });

  test("a read under way is not started twice, unless it has been under way so long it was cut off", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    const running = (secondsAgo: number) => ({ appearance, launcherMatch: { origin: ORIGIN, at: new Date(now - secondsAgo * 1000).toISOString(), done: false } });
    assert.deepEqual(launcherState(running(5), ORIGIN, now), { start: false, waiting: true, source: null });
    assert.equal(launcherState(running(120), ORIGIN, now).start, true);
  });

  test("a colour a person chose is never read over, Ink included, nor one saved before matching existed", () => {
    assert.deepEqual(launcherState({ appearance, launcherChosen: true }, ORIGIN), { start: false, waiting: false, source: "chosen" });
    assert.deepEqual(launcherState({ appearance: { ...appearance, launcher: "#7C3AED" } }, ORIGIN), { start: false, waiting: false, source: "chosen" });
  });
});

describe("matching a launcher, against Postgres", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const sql = () => psqlSql(DB) as unknown as Parameters<typeof matchLauncher>[0];
  const site = async (id: string) => {
    const [row] = await psqlSql(DB)`select origin, context from sites where id = ${id}`;
    return row as { origin: string; context: Record<string, any> };
  };
  const add = (id: string, context: Record<string, unknown> = {}, origin = ORIGIN) =>
    exec(DB, `insert into sites (id, name, origin, allowed_origins, context) values ('${id}', 'Northpine', '${origin}', '{${origin}}', '${JSON.stringify({ appearance: { ...appearance, accent: "#16A34A" }, ...context }).replace(/'/g, "''")}')`);
  /** A stand-in for reading a site, which counts how often it was asked. */
  const reader = (brand: Partial<Brand>) => {
    const read = async (_origin: string) => {
      read.calls++;
      return { icon: null, colour: null, from: null, ...brand } as Brand;
    };
    read.calls = 0;
    return read;
  };

  test("a new site gets its colour, the read happens once, and the pointer is left alone", async () => {
    freshDatabase(DB);
    add("site_match_new01");
    const read = reader({ colour: "#17633A", from: "stylesheet" });
    assert.equal(await matchLauncher(sql(), "site_match_new01", ORIGIN, read), "#17633A");
    assert.equal(await matchLauncher(sql(), "site_match_new01", ORIGIN, read), undefined, "a second ask does nothing");
    assert.equal(read.calls, 1);
    const { context } = await site("site_match_new01");
    assert.equal(context.appearance.launcher, "#17633A");
    assert.equal(context.appearance.accent, "#16A34A", "what is saved for the pointer is not touched here. It is not used either");
    assert.deepEqual({ origin: context.launcherMatch.origin, done: context.launcherMatch.done }, { origin: ORIGIN, done: true });
  });

  test("a light colour is darkened until it stands out, and a site with no colour is Ink", async () => {
    freshDatabase(DB);
    add("site_match_light1");
    add("site_match_none01");
    const yellow = await matchLauncher(sql(), "site_match_light1", ORIGIN, reader({ colour: "#FACC15" }));
    assert.ok(yellow && contrast(yellow, "#FFFFFF") >= 3, `drawn as ${yellow}`);
    assert.equal((await site("site_match_light1")).context.appearance.launcher, yellow);
    assert.equal(await matchLauncher(sql(), "site_match_none01", ORIGIN, reader({ colour: null })), INK);
    const none = (await site("site_match_none01")).context;
    assert.equal(none.appearance.launcher, undefined, "Ink is kept as no colour");
    assert.equal(none.launcherMatch.done, true, "and it is not read again");
  });

  test("a site that can't be reached is Ink, and is not read again for that address", async () => {
    freshDatabase(DB);
    add("site_match_down01");
    assert.equal(await matchLauncher(sql(), "site_match_down01", ORIGIN, async () => { throw new Error("no answer"); }), INK);
    assert.equal(await matchLauncher(sql(), "site_match_down01", ORIGIN, reader({ colour: "#17633A" })), undefined);
  });

  test("two asks at the same moment read the site once", async () => {
    freshDatabase(DB);
    add("site_match_race01");
    const read = reader({ colour: "#17633A" });
    const answers = await Promise.all([matchLauncher(sql(), "site_match_race01", ORIGIN, read), matchLauncher(sql(), "site_match_race01", ORIGIN, read)]);
    assert.equal(read.calls, 1);
    assert.deepEqual(answers.filter(Boolean), ["#17633A"]);
  });

  test("a person who chooses a colour while the site is being read keeps theirs", async () => {
    freshDatabase(DB);
    add("site_match_pick01");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const reading = matchLauncher(sql(), "site_match_pick01", ORIGIN, async () => (await held, { icon: null, colour: "#17633A", from: "stylesheet" }));
    // Wait for the read to be claimed, then the person picks purple in Settings.
    for (let at = 0; at < 50 && !(await site("site_match_pick01")).context.launcherMatch; at++) await new Promise((resolve) => setTimeout(resolve, 20));
    exec(DB, `update sites set context = jsonb_set(context, '{appearance,launcher}', '"#7C3AED"') || '{"launcherChosen": true}' where id = 'site_match_pick01'`);
    release();
    await reading;
    assert.equal((await site("site_match_pick01")).context.appearance.launcher, "#7C3AED");
  });

  test("a chosen colour, or one saved before matching existed, is never read over", async () => {
    freshDatabase(DB);
    add("site_match_chos01", { launcherChosen: true });
    add("site_match_old001", { appearance: { ...appearance, launcher: "#7C3AED" } });
    const read = reader({ colour: "#17633A" });
    assert.equal(await matchLauncher(sql(), "site_match_chos01", ORIGIN, read), undefined);
    assert.equal(await matchLauncher(sql(), "site_match_old001", ORIGIN, read), undefined);
    assert.equal(read.calls, 0);
    assert.equal((await site("site_match_old001")).context.appearance.launcher, "#7C3AED");
  });

  test("a site whose address changed before anyone chose a colour is read again for the new one", async () => {
    freshDatabase(DB);
    add("site_match_move01");
    await matchLauncher(sql(), "site_match_move01", ORIGIN, reader({ colour: "#17633A" }));
    exec(DB, `update sites set origin = 'https://www.other.test' where id = 'site_match_move01'`);
    assert.equal(await matchLauncher(sql(), "site_match_move01", "https://www.other.test", reader({ colour: "#2563EB" })), "#2563EB");
    assert.equal((await site("site_match_move01")).context.appearance.launcher, "#2563EB");
    // A read for an address the site no longer has is not saved.
    assert.equal(await matchLauncher(sql(), "site_match_move01", ORIGIN, reader({ colour: "#DC2626" })), undefined);
  });
});

test("the pointer is Haptic's blue", () => assert.equal(POINTER_BLUE, DEFAULT_APPEARANCE.accent));
