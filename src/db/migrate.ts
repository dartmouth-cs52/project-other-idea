import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Brings a database up to date with db/migrations, in file name order.
// Each file runs in one transaction, and is recorded in schema_migrations so
// it never runs twice.
//
//   npm run db:migrate              Apply what is missing to $DATABASE_URL
//   npm run db:migrate -- --check   Only list what is missing
//
// It talks to Neon over HTTPS, so it works where the Postgres port is blocked.
// The first migration was applied by hand before this existed: on a database
// that already has its tables, it is recorded and not run.
//
// Both deploys run it before they publish, the website's and the widget
// server's, and one push can start both at once. A migration the other run is
// applying at the same moment fails here, on what that run made or on its
// record, once that run has committed. It is then found recorded and skipped,
// so neither deploy fails for it, and none is ever applied twice.

const DIR = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

/** Splits a file into statements at each semicolon that ends a line, outside quotes and comments. */
export function statements(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const line of text.split("\n")) {
    const code = quoted ? line : line.replace(/--.*$/, "");
    for (const char of code) if (char === "'") quoted = !quoted;
    current += code + "\n";
    if (!quoted && /;\s*$/.test(code)) {
      out.push(current.trim().replace(/;$/, ""));
      current = "";
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

type Sql = NeonQueryFunction<false, false>;

async function isRecorded(sql: Sql, name: string): Promise<boolean> {
  return (await sql`select 1 from schema_migrations where name = ${name}`).length > 0;
}

/**
 * Applies the migrations a database is missing, and returns the names of those
 * this run applied. With `check`, it only says which are missing.
 */
export async function migrate(sql: Sql, options: { check?: boolean; dir?: string; log?: (line: string) => void } = {}): Promise<string[]> {
  const { check = false, dir = DIR, log = console.log } = options;
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  } catch (error) {
    // Two first runs at the same moment can both try to make it, and one of them then fails. The table is there.
    const [found] = await sql`select to_regclass('public.schema_migrations') is not null as exists`;
    if (!found?.exists) throw error;
  }
  const done = new Set((await sql`select name from schema_migrations`).map((row) => row.name as string));
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();

  if (!done.size) {
    const [found] = await sql`select to_regclass('public.sites') is not null as exists`;
    if (found?.exists && files[0]?.startsWith("0001")) {
      if (!check) await sql`insert into schema_migrations (name) values (${files[0]}) on conflict (name) do nothing`;
      done.add(files[0]);
      log(`${files[0]}: its tables already exist, so it is recorded as applied.`);
    }
  }

  const pending = files.filter((name) => !done.has(name));
  if (!pending.length) log("Up to date.");
  const applied: string[] = [];
  for (const name of pending) {
    if (check) {
      log(`Missing: ${name}`);
      continue;
    }
    const steps = statements(await readFile(dir + name, "utf8"));
    try {
      await sql.transaction([...steps.map((step) => sql.query(step)), sql`insert into schema_migrations (name) values (${name})`]);
    } catch (error) {
      if (!(await isRecorded(sql, name))) throw error;
      log(`${name}: applied meanwhile by another run.`);
      continue;
    }
    applied.push(name);
    log(`Applied ${name} (${steps.length} statements).`);
  }
  return applied;
}

// Run as a command, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL to the database to migrate. It is in .env for your own machine.");
    process.exit(1);
  }
  await migrate(neon(url), { check: process.argv.includes("--check") });
}
