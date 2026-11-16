import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runs the Worker's queries against a real Postgres, for tests that need one.
// The Worker talks to Neon over HTTP, which a local Postgres doesn't speak, so
// this sends each query through psql instead, with its parameters bound the
// same way ($1, $2…), and reads the rows back as JSON.
//
// Set TEST_DATABASE_URL to an empty local database, never a real one:
//
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/haptic_test npm test
//
// Tests that need it are skipped without it. `freshDatabase` drops and
// recreates the public schema and applies db/migrations in order.

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

const MIGRATIONS = fileURLToPath(new URL("../db/migrations/", import.meta.url));

function psql(url: string, input: string): string {
  try {
    return execFileSync("psql", [url, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "");
    const failure = new Error(stderr.trim() || (error as Error).message) as Error & { code?: string };
    failure.code = /ERROR:\s+([0-9A-Z]{5}):/.exec(stderr)?.[1];
    throw failure;
  }
}

/** A value as one psql \bind argument: quoted, with quotes and backslashes doubled. */
function bound(value: unknown): string {
  if (value === null || value === undefined) return "''";
  const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? `{${value.map((item) => `"${String(item).replace(/["\\]/g, "\\$&")}"`).join(",")}}` : String(value);
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export interface TestSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  transaction(queries: Promise<Record<string, unknown>[]>[]): Promise<Record<string, unknown>[][]>;
}

export function psqlSql(url: string): TestSql {
  const run = (text: string, params: unknown[] = []): Record<string, unknown>[] => {
    const statement = text.trim().replace(/;$/, "");
    const writes = /^(update|insert|delete)\b/i.test(statement);
    // A write without RETURNING has no rows to read back.
    const wrapped = writes && !/\breturning\b/i.test(statement) ? statement : `with t as (${statement}) select coalesce(json_agg(t), '[]'::json) from t`;
    const out = psql(url, `\\set VERBOSITY verbose\n${wrapped} \\bind ${params.map(bound).join(" ")} \\g\n`).trim();
    return out ? (JSON.parse(out) as Record<string, unknown>[]) : [];
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((all, part, i) => all + part + (i < values.length ? `$${i + 1}` : ""), "");
    return Promise.resolve().then(() => run(text, values));
  }) as TestSql;
  sql.query = (text, params) => Promise.resolve().then(() => run(text, params));
  sql.transaction = (queries) => Promise.all(queries);
  return sql;
}

/**
 * A database of its own for one test file, next to TEST_DATABASE_URL's, made
 * if it isn't there. Test files run at the same time, so they never share one.
 */
export function testDatabase(name: string): string {
  if (!TEST_DATABASE_URL) return "";
  const url = new URL(TEST_DATABASE_URL);
  const database = `${url.pathname.slice(1) || "postgres"}_${name}`.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  psql(TEST_DATABASE_URL, `select 'create database ${database}' where not exists (select 1 from pg_database where datname = '${database}') \\gexec\n`);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Drops everything in the database and applies every migration, so each test file starts the same. */
export function freshDatabase(url: string): void {
  psql(url, "drop schema if exists public cascade; create schema public;");
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()) {
    psql(url, readFileSync(MIGRATIONS + name, "utf8"));
  }
}

/** Runs SQL as it is, for setting up rows. */
export function exec(url: string, text: string): void {
  psql(url, text);
}
