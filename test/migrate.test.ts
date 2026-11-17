import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "../src/db/migrate.ts";
import { exec, psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// The migration runner. Both deploys run it before they publish, the website's
// and the widget server's, and one push can start both at the same moment.

const MIGRATIONS = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const FILES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const DB = testDatabase("migrate");

type Sql = Parameters<typeof migrate>[0];

describe("applying migrations, against Postgres", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  const sql = psqlSql(DB);
  const db = sql as unknown as Sql;
  const empty = () => exec(DB, "drop schema if exists public cascade; create schema public;");
  const recorded = async () => (await sql.query("select name from schema_migrations order by name")).map((row) => row.name as string);
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);

  test("two runs at the same moment both succeed, and each migration is applied once", async () => {
    empty();
    const [one, two] = await Promise.all([migrate(db, { log }), migrate(db, { log })]);
    assert.deepEqual([...one, ...two].sort(), FILES, "each applied by one run or the other, never by both");
    assert.deepEqual(await recorded(), FILES);
    assert.deepEqual(await migrate(db, { log }), [], "a later run finds nothing to do");
  });

  test("a migration another run applied meanwhile is skipped, not failed", async () => {
    empty();
    await migrate(db, { log });
    // A run that read schema_migrations before the other run recorded anything: every migration it tries is there already.
    const stale = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => (strings.join("").startsWith("select name from schema_migrations") ? Promise.resolve([]) : sql(strings, ...values)),
      { query: sql.query, transaction: sql.transaction },
    ) as unknown as Sql;
    lines.length = 0;
    assert.deepEqual(await migrate(stale, { log }), []);
    assert.ok(lines[0]?.startsWith(`${FILES[0]}: its tables already exist`), lines[0] ?? "nothing was logged");
    assert.deepEqual(lines.slice(1), FILES.slice(1).map((name) => `${name}: applied meanwhile by another run.`));
    assert.deepEqual(await recorded(), FILES);
  });

  test("a migration that fails on its own still fails the run, and leaves nothing of itself", async () => {
    empty();
    const dir = mkdtempSync(join(tmpdir(), "haptic-migrations-"));
    try {
      writeFileSync(join(dir, "0001_one.sql"), "create table one (id int);\n");
      writeFileSync(join(dir, "0002_broken.sql"), "create table two (id int);\nselect * from nowhere;\n");
      await assert.rejects(migrate(db, { dir: `${dir}/`, log }), /nowhere/);
      assert.deepEqual(await recorded(), ["0001_one.sql"]);
      assert.deepEqual(await sql.query("select to_regclass('public.two') is null as gone"), [{ gone: true }], "its first statement was undone with it");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--check lists what is missing and applies nothing", async () => {
    empty();
    lines.length = 0;
    assert.deepEqual(await migrate(db, { check: true, log }), []);
    assert.deepEqual(lines, FILES.map((name) => `Missing: ${name}`));
    assert.deepEqual(await recorded(), []);
  });
});
