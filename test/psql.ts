import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Runs the Worker's queries against a real Postgres, for tests that need one.
// The Worker talks to Neon over HTTP, which a local Postgres doesn't speak, so
// this sends each query through psql instead, with its parameters bound the
// same way ($1, $2…), and reads the rows back as JSON. As with Neon's driver,
// a query runs when it is awaited, `transaction` runs several in one
// transaction, and queries awaited together run at the same time, each in its
// own session, so a test can race them.
//
// Set TEST_DATABASE_URL to an empty local database, never a real one:
//
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/haptic_test npm test
//
// Tests that need it are skipped without it. CI sets it, with a Postgres of
// its own. `testDatabase` gives each test file a database of its own next to
// that one, and `freshDatabase` empties it and applies db/migrations in order.

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

const MIGRATIONS = fileURLToPath(new URL("../db/migrations/", import.meta.url));
const PSQL = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];
const SEPARATOR = "@@haptic-test-separator@@";

function failure(error: unknown): Error {
  const stderr = String((error as { stderr?: string }).stderr ?? "");
  const out = new Error(stderr.trim() || (error as Error).message) as Error & { code?: string };
  out.code = /ERROR:\s+([0-9A-Z]{5}):/.exec(stderr)?.[1];
  return out;
}

function psqlNow(url: string, input: string): string {
  try {
    return execFileSync("psql", [url, ...PSQL], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    throw failure(error);
  }
}

function psqlLater(url: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("psql", [url, ...PSQL], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) =>
      error ? reject(failure(Object.assign(error, { stderr }))) : resolve(stdout),
    );
    child.stdin?.end(input);
  });
}

/** A value as one psql \bind argument: quoted, with quotes and backslashes doubled. Never null: see `script`. */
function bound(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? `{${value.map((item) => `"${String(item).replace(/["\\]/g, "\\$&")}"`).join(",")}}` : String(value);
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

type Rows = Record<string, unknown>[];

/**
 * One query, written out for psql so its rows come back as one line of JSON. psql's \bind can't pass a
 * null, so a null value is written into the statement as NULL and the parameters after it are renumbered.
 */
function script(text: string, values: unknown[]): string {
  const params: unknown[] = [];
  const places = values.map((value) => (value === null || value === undefined ? 0 : params.push(value)));
  const statement = text
    .trim()
    .replace(/;$/, "")
    .replace(/\$(\d+)(?!\d)/g, (whole, n: string) => {
      const place = places[Number(n) - 1];
      return place === undefined ? whole : place === 0 ? "NULL" : `$${place}`;
    });
  const writes = /^(update|insert|delete)\b/i.test(statement);
  // A write without RETURNING has no rows to read back.
  const wrapped = writes && !/\breturning\b/i.test(statement) ? statement : `with t as (${statement}) select coalesce(json_agg(t), '[]'::json) from t`;
  return `${wrapped} \\bind ${params.map(bound).join(" ")} \\g\n\\echo ${SEPARATOR}\n`;
}

function parse(out: string, count: number): Rows[] {
  const parts = out.split(`${SEPARATOR}\n`);
  return Array.from({ length: count }, (_, i) => {
    const text = (parts[i] ?? "").trim();
    return text ? (JSON.parse(text) as Rows) : [];
  });
}

/** A query that runs when it is awaited, like Neon's, so it can also be handed to `transaction`. */
class Query implements PromiseLike<Rows> {
  constructor(
    private readonly url: string,
    readonly text: string,
    readonly params: unknown[],
  ) {}
  then<A = Rows, B = never>(done?: ((rows: Rows) => A | PromiseLike<A>) | null, failed?: ((error: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    const run = psqlLater(this.url, `\\set VERBOSITY verbose\n${script(this.text, this.params)}`).then((out) => parse(out, 1)[0]!);
    return run.then(done, failed);
  }
  catch<B = never>(failed: (error: unknown) => B | PromiseLike<B>): Promise<Rows | B> {
    return this.then(undefined, failed);
  }
}

export interface TestSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Query;
  query(text: string, params?: unknown[]): Query;
  transaction(queries: Query[]): Promise<Rows[]>;
}

export function psqlSql(url: string): TestSql {
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    new Query(url, strings.reduce((all, part, i) => all + part + (i < values.length ? `$${i + 1}` : ""), ""), values)) as TestSql;
  sql.query = (text, params = []) => new Query(url, text, params);
  // One session, one transaction, the way Neon runs them: all or nothing.
  sql.transaction = async (queries) => {
    const out = await psqlLater(url, `\\set VERBOSITY verbose\nbegin;\n${queries.map((query) => script(query.text, query.params)).join("")}commit;\n`);
    return parse(out, queries.length);
  };
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
  psqlNow(TEST_DATABASE_URL, `select 'create database ${database}' where not exists (select 1 from pg_database where datname = '${database}') \\gexec\n`);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Drops everything in the database and applies every migration, so each test file starts the same. */
export function freshDatabase(url: string): void {
  psqlNow(url, "drop schema if exists public cascade; create schema public;");
  for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort()) {
    psqlNow(url, readFileSync(MIGRATIONS + name, "utf8"));
  }
}

/** Runs SQL as it is, for setting up rows. */
export function exec(url: string, text: string): void {
  psqlNow(url, text);
}
