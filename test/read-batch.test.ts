import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { saveReadBatch } from "../web/worker/read-batch.ts";
import { exec, freshDatabase, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// A batch of pages the reader has read, saved onto the site, on Postgres.

const DB = testDatabase("read_batch");
const ORG = "00000000-0000-4000-8000-000000000001";
const SITE = { id: "site_read00001", companyId: ORG, maxOrigins: 20 };
const page = (path: string) => ({ path, title: path, headings: [], links: [], buttons: [], fields: [] });
const reading = (origin: string, startedAt: string, queue: string[]) => ({ queue, seen: ["/"], failed: [], thin: [], max: 30, origin, startedAt });

describe("saving what the reader read", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const sql = () => psqlSql(DB) as unknown as Parameters<typeof saveReadBatch>[0];
  const row = async () =>
    (await psqlSql(DB).query(`select origin, allowed_origins, reading, context->'pages' as pages, context->>'notes' as notes from sites where id = $1`, [SITE.id]))[0] as {
      origin: string;
      allowed_origins: string[];
      reading: { queue: string[]; startedAt: string };
      pages: { path: string }[];
      notes: string;
    };
  const reset = (origin = "https://app.example.com", startedAt = "2026-11-16T10:00:00.000Z") => {
    freshDatabase(DB);
    exec(
      DB,
      `insert into sites (id, company_id, name, origin, allowed_origins, context, reading) values ('${SITE.id}', '${ORG}', 'A', '${origin}', '{${origin}}',
        '{"notes":"Keep me","pages":[]}', '${JSON.stringify(reading(origin, startedAt, [`${origin}/`]))}')`,
    );
  };

  test("the pages, the reading and a redirect to the site's other name are saved, and nothing else changes", async () => {
    reset();
    const saved = await saveReadBatch(sql(), SITE, { reading: reading("https://www.example.com", "2026-11-16T10:00:00.000Z", ["https://www.example.com/a"]), movedTo: "https://www.example.com" }, [page("/"), page("/a")]);
    assert.equal(saved, true);
    const after = await row();
    assert.equal(after.origin, "https://www.example.com");
    assert.deepEqual(after.allowed_origins, ["https://app.example.com", "https://www.example.com"]);
    assert.deepEqual(after.pages.map((item) => item.path), ["/", "/a"]);
    assert.deepEqual(after.reading.queue, ["https://www.example.com/a"]);
    assert.equal(after.notes, "Keep me");
  });
});
