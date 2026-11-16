// Saving a batch of pages the reader has read (worker/reader.ts) onto the site,
// for readSite in worker/app-api.ts. Kept apart, and free of the reader's own
// packages, so the tests at the top of the repository can run it on Postgres.

import type { PageNode } from "../../src/shared/types";
import type { Sql } from "./db";

/** The site the batch is for, and how many origins its allowed list may hold. */
export interface BatchSite {
  id: string;
  companyId: string;
  maxOrigins: number;
}

/** What the site was when its pages began to be read: the address, and when that reading started. */
export interface ReadFrom {
  origin: string;
  startedAt: string | null;
}

/** A batch from readMore: the reading to keep, and the site's other name when the first page redirected to it. */
export interface Batch {
  reading: object;
  movedTo?: string;
}

/**
 * Saves the pages read so far, the reading, and the origin the first page
 * redirected to, if it did. Only those change, so an edit to the name or
 * origins made meanwhile is kept. True when it was saved.
 *
 * Only while the site is still at the address and on the reading the batch
 * began from (`from`). A batch can take a minute, and in that time the address
 * may have been changed in setup, which starts a new reading. A batch for the
 * old address is then dropped, with its pages and any redirect it saw, so
 * nothing from the old site is written over the new one. False when dropped.
 */
export async function saveReadBatch(sql: Sql, site: BatchSite, from: ReadFrom, batch: Batch, pages: PageNode[]): Promise<boolean> {
  // The address pasted may be the site's other name, acme.com for www.acme.com. The widget will run on the
  // one it redirects to, so that becomes the site's origin and is allowed too.
  const moved = batch.movedTo ?? null;
  const rows = await sql.query(
    `update sites set
      context = jsonb_set(jsonb_set(context, '{pages}', $3::jsonb), '{updatedAt}', to_jsonb(now()::text)),
      reading = $4::jsonb,
      origin = coalesce($5::text, origin),
      allowed_origins = case
        when $5::text is null or $5::text = any(allowed_origins) or cardinality(allowed_origins) >= $6 then allowed_origins
        else array_append(allowed_origins, $5::text) end,
      updated_at = now()
    where id = $1 and company_id = $2 and origin = $7 and (reading->>'startedAt') is not distinct from $8::text
    returning id`,
    [site.id, site.companyId, JSON.stringify(pages), JSON.stringify(batch.reading), moved, site.maxOrigins, from.origin, from.startedAt],
  );
  return rows.length > 0;
}
