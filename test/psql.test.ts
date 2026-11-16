import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { psqlSql, TEST_DATABASE_URL, testDatabase } from "./psql.ts";

// The stand-in for Neon's driver that the Postgres tests use binds values the way Neon's does.

const DB = testDatabase("psql");

describe("binding values through psql", { skip: TEST_DATABASE_URL ? false : "set TEST_DATABASE_URL to a local, empty database to run these" }, () => {
  test("a null is bound as null, not as an empty string, and the values after it keep their places", async () => {
    const sql = psqlSql(DB);
    assert.deepEqual(await sql.query(`select $1::text is null as missing, $2::int as n, $3::text as word, $4::text is null as gone`, [null, 7, "", undefined]), [
      { missing: true, n: 7, word: "", gone: true },
    ]);
    const value: string | null = null;
    assert.deepEqual(await sql`select ${value}::text is null as missing, ${"x"}::text as word`, [{ missing: true, word: "x" }]);
  });
});
