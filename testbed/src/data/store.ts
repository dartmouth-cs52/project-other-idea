import { useMemo } from "react";
import { create } from "zustand";
import { lab, latencyMs } from "@/lab/lab";
import { buildDb } from "./seed";
import type { CollectionName, Db, Row } from "./types";

// The app's data. The seed is rebuilt in memory on every load, and only the
// changes a visitor makes are saved to localStorage. 10,000 transactions would
// not fit there, and this way "Reset data" just forgets the changes.

type Changes = { [C in CollectionName]?: { upserts: Record<string, Row<C>>; deleted: string[] } };

const STORAGE_KEY = "northpine-changes";

function loadChanges(): Changes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Changes) : {};
  } catch {
    return {};
  }
}

function saveChanges(changes: Changes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
  } catch {
    // Storage full or blocked. The change still applies for this visit.
  }
}

function applyChanges(db: Db, changes: Changes): Db {
  const out = { ...db } as Record<CollectionName, { id: string }[]>;
  for (const name of Object.keys(changes) as CollectionName[]) {
    const change = changes[name]!;
    const deleted = new Set(change.deleted);
    const upserts = change.upserts as Record<string, { id: string }>;
    const seen = new Set<string>();
    const rows = (out[name] as { id: string }[]).filter((r) => !deleted.has(r.id)).map((r) => {
      seen.add(r.id);
      return upserts[r.id] ?? r;
    });
    // New rows go first, so a record you just made is at the top of its list.
    const added = Object.values(upserts).filter((r) => !seen.has(r.id) && !deleted.has(r.id));
    out[name] = [...added.reverse(), ...rows];
  }
  return out as unknown as Db;
}

interface DataStore {
  db: Db;
  changes: Changes;
  /** Bumped on every change so selectors over big lists can memoize. */
  version: number;
}

function initial(): DataStore {
  const changes = loadChanges();
  return { db: applyChanges(buildDb(lab().seed), changes), changes, version: 0 };
}

export const useData = create<DataStore>()(() => initial());

/** Forget every change and rebuild from the seed. */
export function resetData() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  useData.setState({ db: buildDb(lab().seed), changes: {}, version: useData.getState().version + 1 });
}

function commit<C extends CollectionName>(name: C, rows: Row<C>[], deletedIds: string[] = []) {
  const { db, changes, version } = useData.getState();
  const current = (changes[name] ?? { upserts: {}, deleted: [] }) as { upserts: Record<string, Row<C>>; deleted: string[] };
  const next = { upserts: { ...current.upserts }, deleted: [...current.deleted] };
  for (const row of rows) next.upserts[(row as { id: string }).id] = row;
  for (const id of deletedIds) {
    delete next.upserts[id];
    if (!next.deleted.includes(id)) next.deleted.push(id);
  }
  const nextChanges = { ...changes, [name]: next } as Changes;
  saveChanges(nextChanges);

  // Patch the in-memory list directly rather than re-applying everything.
  const list = db[name] as unknown as { id: string }[];
  const byId = new Map(rows.map((r) => [(r as { id: string }).id, r as unknown as { id: string }]));
  const dead = new Set(deletedIds);
  const existing = new Set(list.map((r) => r.id));
  const fresh = rows.filter((r) => !existing.has((r as { id: string }).id)) as unknown as { id: string }[];
  const updated = [...fresh, ...list.filter((r) => !dead.has(r.id)).map((r) => byId.get(r.id) ?? r)];
  useData.setState({ db: { ...db, [name]: updated }, changes: nextChanges, version: version + 1 });
}

/** Insert or replace rows. */
export function upsert<C extends CollectionName>(name: C, ...rows: Row<C>[]) {
  commit(name, rows);
}

/** Change some fields on one row. */
export function patch<C extends CollectionName>(name: C, id: string, fields: Partial<Row<C>>) {
  const row = (useData.getState().db[name] as unknown as Row<C>[]).find((r) => (r as { id: string }).id === id);
  if (!row) return;
  commit(name, [{ ...row, ...fields } as Row<C>]);
}

export function remove<C extends CollectionName>(name: C, ...ids: string[]) {
  commit(name, [], ids);
}

/** A whole collection. */
export function useCollection<C extends CollectionName>(name: C): Db[C] {
  return useData((s) => s.db[name]);
}

/** One row by id, or undefined. */
export function useRow<C extends CollectionName>(name: C, id: string | undefined): Row<C> | undefined {
  const rows = useCollection(name) as unknown as Row<C>[];
  return useMemo(() => rows.find((r) => (r as { id: string }).id === id), [rows, id]);
}

/** A lookup map by id, rebuilt only when the collection changes. */
export function useIndex<C extends CollectionName>(name: C): Map<string, Row<C>> {
  const rows = useCollection(name) as unknown as Row<C>[];
  return useMemo(() => new Map(rows.map((r) => [(r as { id: string }).id, r])), [rows]);
}

export function get<C extends CollectionName>(name: C, id: string): Row<C> | undefined {
  return (useData.getState().db[name] as unknown as Row<C>[]).find((r) => (r as { id: string }).id === id);
}

export function all<C extends CollectionName>(name: C): Db[C] {
  return useData.getState().db[name];
}

/** The signed-in person. Their role comes from the test panel, not the seed. */
export const ME_ID = "emp_me";

let counter = Date.now() % 100000;
export function newId(prefix: string) {
  return `${prefix}_n${(counter++).toString(36)}`;
}

/** Wait as long as the test panel says a request takes, and maybe fail. */
export async function simulate<T>(work: () => T): Promise<T> {
  await new Promise((r) => setTimeout(r, latencyMs()));
  if (Math.random() < lab().failureRate) throw new Error("The server didn't respond. Try again.");
  return work();
}
