import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { Store } from "../src/server/db.ts";
import { DEFAULT_APPEARANCE, type PageOutline, type SiteContext } from "../src/shared/types.ts";
import { knownControls } from "../web/worker/corrections.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

/** This file's own database, when TEST_DATABASE_URL is set. */
const DB = testDatabase("learned");

// What the store keeps from visits, on Postgres with every migration applied:
// a label reaches the prompt only once three networks have seen it, however
// many visitor ids one network sends, and a site at its limit keeps learning.

const site: SiteContext = {
  version: 1,
  id: "site_learned01",
  name: "Learned",
  origin: "https://app.test",
  allowedOrigins: ["https://app.test"],
  appearance: DEFAULT_APPEARANCE,
  notes: "",
  docs: [],
  pages: [{ path: "/", title: "Home", headings: [], links: [], buttons: ["New"], fields: [] }],
  source: { url: "https://app.test", maxPages: 1, docs: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const buttons = (path: string, ...labels: string[]): PageOutline => ({ path, title: "", headings: [], links: [], buttons: labels });

describe("learning from visits, against Postgres", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const sql = () => psqlSql(DB) as unknown as ConstructorParameters<typeof Store>[0];
  const rows = async (table: "outline_labels" | "outline_openings") =>
    (await psqlSql(DB).query(`select label, visitor_count, network_count from ${table} where site_id = $1 order by label collate "C"`, [site.id])) as { label: string; visitor_count: number; network_count: number }[];
  const buttonsOn = async (store: Store, path: string) => (await store.loadSite(site.id))?.pages.find((page) => page.path === path)?.buttons ?? [];

  // The store swallows its own errors so that a visitor never loses a step to one. Here, any is a failure.
  let errors: unknown[][] = [];
  const logged = console.error;
  beforeEach(() => {
    freshDatabase(DB);
    exec(DB, `insert into sites (id, name, origin, allowed_origins, context) values ('${site.id}', '${site.name}', '${site.origin}', '{${site.origin}}', '${JSON.stringify(site)}')`);
    errors = [];
    console.error = (...args: unknown[]) => void errors.push(args);
  });
  afterEach(() => {
    console.error = logged;
    assert.deepEqual(errors, []);
  });

  test("a label reaches the prompt once three networks have seen it, not five ids from one", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3 });
    for (const visitor of ["v1", "v2", "v3", "v4", "v5"]) await store.recordOutline(site, visitor, buttons("/reports", "Export"), "aaaa");
    assert.deepEqual(await rows("outline_labels"), [{ label: "Export", visitor_count: 5, network_count: 1 }]);
    assert.deepEqual(await buttonsOn(store, "/reports"), []);

    await store.recordOutline(site, "v6", buttons("/reports", "Export"), "bbbb");
    // A caller whose address isn't known is counted as a visitor only.
    await store.recordOutline(site, "v7", buttons("/reports", "Export"));
    assert.deepEqual(await buttonsOn(store, "/reports"), []);
    await store.recordOutline(site, "v8", buttons("/reports", "Export"), "cccc");
    assert.deepEqual(await rows("outline_labels"), [{ label: "Export", visitor_count: 8, network_count: 3 }]);
    assert.deepEqual(await buttonsOn(store, "/reports"), ["Export"]);
  });

  test("a label kept before networks were counted waits for three networks to see it again", async () => {
    exec(DB, `insert into outline_labels (site_id, route, kind, label, href, visitors) values ('${site.id}', '/reports', 'button', 'Export', '', '{a,b,c}')`);
    const store = new Store(sql(), 3, { labelNetworks: 3 });
    assert.deepEqual(await buttonsOn(store, "/reports"), [], "three visitors with no networks are not enough");
    for (const [visitor, network] of [["a", "aaaa"], ["b", "bbbb"], ["c", "cccc"]] as const) await store.recordOutline(site, visitor, buttons("/reports", "Export"), network);
    assert.deepEqual(await rows("outline_labels"), [{ label: "Export", visitor_count: 3, network_count: 3 }], "the same visitors are not counted twice");
    assert.deepEqual(await buttonsOn(store, "/reports"), ["Export"]);
  });

  test("a site at its limit keeps learning: what the prompt reads stays, and of the rest what was seen longest ago goes", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3, maxLabels: 10 });
    // A label the prompt reads, seen a month ago.
    for (const [visitor, network] of [["a", "aaaa"], ["b", "bbbb"], ["c", "cccc"]] as const) await store.recordOutline(site, visitor, buttons("/reports", "Export"), network);
    // Nine made up on one machine fill the site.
    await store.recordOutline(site, "x", buttons("/junk", "j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8", "j9"), "ffff");
    exec(DB, `update outline_labels set last_seen_at = now() - interval '30 days' where label = 'Export';
      update outline_labels set last_seen_at = now() - substring(label from 2)::int * interval '1 hour' where label like 'j%'`);
    assert.equal((await rows("outline_labels")).length, 10);

    // Before, a full site took no new label, for good. Now these two go in, and the two seen longest ago go out.
    await store.recordOutline(site, "d", buttons("/reports", "Share", "Star"), "dddd");
    assert.deepEqual((await rows("outline_labels")).map((row) => row.label), ["Export", "Share", "Star", "j1", "j2", "j3", "j4", "j5", "j6", "j7"]);
    assert.deepEqual(await buttonsOn(store, "/reports"), ["Export"], "the oldest row of all stayed, because the prompt reads it");

    // A label already kept is counted again without making room for anything.
    await store.recordOutline(site, "e", buttons("/reports", "Share"), "eeee");
    assert.equal((await rows("outline_labels")).length, 10);
  });

  test("a label sent over and over doesn't outrank the ones real visitors keep seeing, and one nobody has seen for a month gives way", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3, labelsRead: 2 });
    // Two labels visitors on three networks keep seeing, known for weeks.
    for (const [visitor, network] of [["a", "aaaa"], ["b", "bbbb"], ["c", "cccc"]] as const) await store.recordOutline(site, visitor, buttons("/reports", "Export", "Share"), network);
    exec(DB, `update outline_labels set first_seen_at = now() - interval '20 days', seen_count = 40`);
    // Two made up today, from as many networks, and sent a million times. Sightings used to decide the order.
    for (const [visitor, network] of [["x", "dddd"], ["y", "eeee"], ["z", "ffff"]] as const) await store.recordOutline(site, visitor, buttons("/reports", "Fake one", "Fake two"), network);
    exec(DB, `update outline_labels set seen_count = 1000000 where label like 'Fake%'`);
    assert.deepEqual(await buttonsOn(store, "/reports"), ["Export", "Share"]);
    // A label nobody has seen for a month is one the product may have dropped, and gives way to one seen lately.
    exec(DB, `update outline_labels set last_seen_at = now() - interval '40 days' where label = 'Share'`);
    assert.deepEqual(await buttonsOn(store, "/reports"), ["Export", "Fake one"]);
  });

  test("visitor ids made up on networks already counted don't lift a label over one seen from as many networks before it", async () => {
    // The review's probe: four real visitors on four networks saw a page weeks ago. Callers on four networks then sent
    // forty pages of their own, with ten made-up visitor ids each, which cost nothing once the network is counted.
    // Ranked by visitors after networks, the forty filled every place for a page only traffic knows, and the real one
    // went from every visitor's site map.
    const store = new Store(sql(), 3, { labelNetworks: 3 });
    for (const [visitor, network] of [["a", "aaaa"], ["b", "bbbb"], ["c", "cccc"], ["d", "dddd"]] as const)
      await store.recordOutline(site, visitor, { path: "/billing/invoices", title: "Invoices", headings: [], links: [], buttons: ["Download invoice"] }, network);
    exec(DB, `update outline_labels set first_seen_at = now() - interval '20 days'`);
    exec(
      DB,
      `insert into outline_labels (site_id, route, kind, label, href, visitors, networks)
        select '${site.id}', '/x' || i, 'title', 'Fake page ' || i, '', array['x0','x1','x2','x3','x4','x5','x6','x7','x8','x9'], array['eeee','ffff','gggg','hhhh']
        from generate_series(0, 39) i`,
    );
    const pages = (await store.loadSite(site.id))?.pages.map((page) => page.path) ?? [];
    assert.ok(pages.includes("/billing/invoices"), "the page real visitors saw stays in the site map");
    assert.deepEqual(await buttonsOn(store, "/billing/invoices"), ["Download invoice"]);
    // The same in the dashboard's picker for Point here instead, which offers learned labels in the same order.
    exec(DB, `insert into outline_labels (site_id, route, kind, label, href, visitors, networks)
      select '${site.id}', '/billing/invoices', 'button', 'Fake ' || i, '', array['x0','x1','x2','x3','x4','x5','x6','x7','x8','x9'], array['eeee','ffff','gggg','hhhh']
      from generate_series(0, 99) i`);
    const picked = await knownControls(psqlSql(DB) as unknown as Parameters<typeof knownControls>[0], { id: site.id, context: site }, "/billing/invoices");
    assert.deepEqual(picked[0], { role: "button", label: "Download invoice" });
  });

  test("a full site keeps the labels the prompt reads, in the same order, whatever was sent most", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3, labelsRead: 2, maxLabels: 4 });
    for (const [visitor, network] of [["a", "aaaa"], ["b", "bbbb"], ["c", "cccc"]] as const) await store.recordOutline(site, visitor, buttons("/reports", "Export", "Share"), network);
    exec(DB, `update outline_labels set first_seen_at = now() - interval '20 days', last_seen_at = now() - interval '10 days'`);
    for (const [visitor, network] of [["x", "dddd"], ["y", "eeee"], ["z", "ffff"]] as const) await store.recordOutline(site, visitor, buttons("/reports", "Fake one", "Fake two"), network);
    exec(DB, `update outline_labels set seen_count = 1000000 where label like 'Fake%'`);
    // One more takes the site past its limit. What the prompt reads stays, and room is made from the rest.
    await store.recordOutline(site, "w", buttons("/reports", "Junk"), "gggg");
    assert.deepEqual((await rows("outline_labels")).map((row) => row.label), ["Export", "Fake one", "Junk", "Share"]);
  });

  test("one network teaches a site only so many new labels a day, and a label it is already counted on costs nothing", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3, networkRowsADay: 5 });
    const said: string[] = [];
    const warned = console.warn;
    console.warn = (...args: unknown[]) => void said.push(args.join(" "));
    try {
      await store.recordOutline(site, "v1", buttons("/reports", "Export", "Share", "Star"), "aaaa");
      await store.recordOutline(site, "v2", buttons("/reports", "Export", "Share", "Star"), "aaaa");
      assert.deepEqual((await rows("outline_labels")).map((row) => [row.label, row.visitor_count]), [["Export", 2], ["Share", 2], ["Star", 2]]);
      // An outline that goes past the share keeps its first new labels, in its own order, up to the share.
      await store.recordOutline(site, "v3", buttons("/reports", "Print", "Copy", "Paste"), "aaaa");
      assert.deepEqual((await rows("outline_labels")).map((row) => [row.label, row.visitor_count]), [["Copy", 1], ["Export", 2], ["Print", 1], ["Share", 2], ["Star", 2]]);
      assert.match(said.join("\n"), /A network has taught site_learned01 5 new labels today, so it teaches it no new ones until tomorrow/);
      // Past it, a new label is left out, and the rest of the outline still counts: one more visitor on what the
      // network is already counted on. Before, the whole outline was dropped, and so was every outline after it that day.
      await store.recordOutline(site, "v4", buttons("/reports", "Archive", "Export"), "aaaa");
      assert.deepEqual((await rows("outline_labels")).map((row) => [row.label, row.visitor_count]), [["Copy", 1], ["Export", 3], ["Print", 1], ["Share", 2], ["Star", 2]]);
      assert.equal(said.length, 1, "the log says so once");
      // Another network has a share of its own.
      await store.recordOutline(site, "v5", buttons("/reports", "Archive"), "bbbb");
      assert.ok((await rows("outline_labels")).some((row) => row.label === "Archive"));
    } finally {
      console.warn = warned;
    }
    // The next day the first network may teach again, and the days before are forgotten.
    exec(DB, `update outline_network_days set day = current_date - 1`);
    await new Store(sql(), 3, { labelNetworks: 3, networkRowsADay: 5 }).recordOutline(site, "v6", buttons("/reports", "Rename"), "aaaa");
    assert.ok((await rows("outline_labels")).some((row) => row.label === "Rename"));
    assert.deepEqual(await psqlSql(DB)`select network, day = current_date as today, labels, openings from outline_network_days`, [{ network: "aaaa", today: true, labels: 1, openings: 0 }]);
  });

  test("what menus show has a day's share of its own, apart from the page's labels", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3, networkRowsADay: 5 });
    const said: string[] = [];
    const warned = console.warn;
    console.warn = (...args: unknown[]) => void said.push(args.join(" "));
    try {
      await store.recordOutline(site, "v1", { ...buttons("/", "Search"), opens: [{ control: "Help", links: [], buttons: ["m1", "m2", "m3", "m4", "m5", "m6"] }] }, "aaaa");
    } finally {
      console.warn = warned;
    }
    assert.deepEqual((await rows("outline_openings")).map((row) => row.label), ["m1", "m2", "m3", "m4", "m5"]);
    assert.deepEqual((await rows("outline_labels")).map((row) => row.label), ["Search"]);
    assert.match(said.join("\n"), /5 new items behind controls today/);
  });

  test("what menus show makes room the same way", async () => {
    const store = new Store(sql(), 3, { labelNetworks: 3, maxLabels: 4 });
    const menu = (...items: string[]): PageOutline => ({ ...buttons("/"), opens: [{ control: "Help", links: [], buttons: items }] });
    for (const [visitor, network] of [["a", "aaaa"], ["b", "bbbb"], ["c", "cccc"]] as const) await store.recordOutline(site, visitor, menu("Docs"), network);
    await store.recordOutline(site, "x", menu("m1", "m2", "m3"), "ffff");
    exec(DB, `update outline_openings set last_seen_at = now() - interval '30 days' where label = 'Docs';
      update outline_openings set last_seen_at = now() - substring(label from 2)::int * interval '1 hour' where label like 'm%'`);
    await store.recordOutline(site, "d", menu("Shortcuts"), "dddd");
    assert.deepEqual((await rows("outline_openings")).map((row) => row.label), ["Docs", "Shortcuts", "m1", "m2"]);
    assert.deepEqual((await store.loadSite(site.id))?.pages[0]?.opens, [{ control: "Help", links: [], buttons: ["Docs"] }]);
  });

  // On the Worker, waitUntil holds the request open only for the promise it is given. What menus show is written
  // in statements of its own, and here it is made the slower of the two, as it can be online.
  test("waiting on a page's outline waits for what its menus show to be written as well", async () => {
    const base = psqlSql(DB);
    const slow = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = base(strings, ...values);
      if (!strings.join("").includes("insert into outline_openings")) return query;
      return { then: (done: (rows: unknown) => unknown, failed: (error: unknown) => unknown) => new Promise((wait) => setTimeout(wait, 400)).then(() => query).then(done, failed) };
    }) as typeof base;
    slow.query = base.query;
    slow.transaction = base.transaction;
    const store = new Store(slow as unknown as ConstructorParameters<typeof Store>[0], 3, { labelNetworks: 3 });
    await store.recordOutline(site, "v1", { ...buttons("/", "Search"), opens: [{ control: "Help", links: [], buttons: ["Docs"] }] }, "aaaa");
    assert.deepEqual((await rows("outline_openings")).map((row) => row.label), ["Docs"]);
    assert.deepEqual((await rows("outline_labels")).map((row) => row.label), ["Search"]);
  });
});
