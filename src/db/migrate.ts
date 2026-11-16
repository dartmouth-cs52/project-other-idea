import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

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

const DIR = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to the database to migrate. It is in .env for your own machine.");
  process.exit(1);
}
const sql = neon(url);
const check = process.argv.includes("--check");

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

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sql`select name from schema_migrations`).map((row) => row.name as string));
const files = (await readdir(DIR)).filter((name) => name.endsWith(".sql")).sort();

if (!done.size) {
  const [found] = await sql`select to_regclass('public.sites') is not null as exists`;
  if (found?.exists && files[0]?.startsWith("0001")) {
    if (!check) await sql`insert into schema_migrations (name) values (${files[0]})`;
    done.add(files[0]);
    console.log(`${files[0]}: its tables already exist, so it is recorded as applied.`);
  }
}

const pending = files.filter((name) => !done.has(name));
if (!pending.length) console.log("Up to date.");
for (const name of pending) {
  if (check) {
    console.log(`Missing: ${name}`);
    continue;
  }
  const steps = statements(await readFile(DIR + name, "utf8"));
  await sql.transaction([...steps.map((step) => sql.query(step)), sql`insert into schema_migrations (name) values (${name})`]);
  console.log(`Applied ${name} (${steps.length} statements).`);
}
