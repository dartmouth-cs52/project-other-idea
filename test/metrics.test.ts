import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { headline } from "../web/worker/insights.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

/** This file's own database, when TEST_DATABASE_URL is set. */
const DB = testDatabase("metrics");

// The four numbers at the top of a site's dashboard, and each day's guides,
// run against a real Postgres with every migration applied. Each guide below
// is placed so it lands in exactly one count, and the comments say which.

const SITE = "site_metrics01";
const OTHER = "site_metrics02";
const EMPTY = "site_metrics03";

describe("the dashboard's top numbers", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  test("finished by when they finished, the rest by when they started, each against the range before", async () => {
    freshDatabase(DB);
    const guide = (site: string, n: number, started: string, ended: string | null, outcome: string | null, helped: boolean | null = null, lastStep: string | null = null) =>
      `('00000000-0000-4000-8000-${String(n).padStart(12, "0")}', '${site}', 'q${n}', 'q${n}', '/', now() - interval '${started}', ${ended ? `now() - interval '${ended}'` : "null"}, ${outcome ? `'${outcome}'` : "null"}, ${helped}, ${lastStep ? `now() - interval '${lastStep}'` : "null"})`;
    exec(DB,
      `insert into sites (id, name, origin, allowed_origins, context) values
        ('${SITE}', 'A', 'https://a.test', '{https://a.test}', '{}'), ('${OTHER}', 'B', 'https://b.test', '{https://b.test}', '{}'), ('${EMPTY}', 'C', 'https://c.test', '{https://c.test}', '{}');
      insert into guides (id, site_id, question, question_key, started_path, started_at, ended_at, outcome, helped, last_step_at) values
        ${[
          // This week.
          guide(SITE, 1, "2 days", "2 days - 30 seconds", "finished"), // finished, 30 s
          guide(SITE, 2, "1 day", "1 day - 50 seconds", "finished"), // finished, 50 s
          guide(SITE, 3, "3 days", "3 days - 40 seconds", "finished", false), // finished, 40 s, and couldn't guide: said it didn't help
          guide(SITE, 4, "1 day", "1 day", "nothing_to_point_at"), // couldn't guide
          guide(SITE, 5, "1 day", "1 day", "sensitive"), // left for a person: not counted toward the rate
          guide(SITE, 6, "3 hours", null, null, null, "2 hours"), // abandoned: couldn't guide
          guide(SITE, 7, "5 minutes", null, null, null, "4 minutes"), // still under way: not counted
          guide(SITE, 8, "2 days", "2 days", "answered", true), // answered in words, counted, not finished
          // Started the week before, finished this week: billed this week, counted toward the week before's rate.
          guide(SITE, 9, "7 days 1 hour", "6 days", "finished"), // 25 hours
          // The week before.
          guide(SITE, 10, "10 days", "10 days - 60 seconds", "finished"), // 60 s
          guide(SITE, 11, "9 days", "9 days", "not_covered"), // couldn't guide
          // Two weeks back and more: in neither range.
          guide(SITE, 12, "20 days", "20 days - 10 seconds", "finished"),
          // Another site's guides never count.
          guide(OTHER, 13, "1 day", "1 day - 5 seconds", "finished"),
        ].join(",\n")};`,
    );
    const sql = psqlSql(DB) as unknown as Parameters<typeof headline>[0];
    const result = await headline(sql, SITE, 7);
    assert.equal(result.days, 7);
    assert.equal(result.asked, true);
    assert.deepEqual(result.now, { finished: 4, started: 8, counted: 6, countedFinished: 3, unguided: 3, medianMsToFinish: 45_000 });
    assert.deepEqual(result.before, { finished: 1, started: 3, counted: 3, countedFinished: 2, unguided: 1, medianMsToFinish: 60_000 });

    assert.equal(result.daily.length, 7, "one bar a day");
    assert.equal(result.daily.at(-1)!.day, new Date().toISOString().slice(0, 10), "ending today, in UTC");
    assert.deepEqual(
      result.daily.map((day) => day.day),
      [...result.daily.map((day) => day.day)].sort(),
      "oldest first",
    );
    assert.equal(result.daily.reduce((sum, day) => sum + day.started, 0), 8);
    assert.equal(result.daily.reduce((sum, day) => sum + day.finished, 0), 4);
  });

  test("a site no one has asked anything yet says so, with zeros and empty days, not made-up numbers", async () => {
    const sql = psqlSql(DB) as unknown as Parameters<typeof headline>[0];
    const result = await headline(sql, EMPTY, 30);
    assert.equal(result.asked, false);
    assert.deepEqual(result.now, { finished: 0, started: 0, counted: 0, countedFinished: 0, unguided: 0, medianMsToFinish: null });
    assert.equal(result.daily.length, 30);
    assert.ok(result.daily.every((day) => day.started === 0 && day.finished === 0));
  });
});
