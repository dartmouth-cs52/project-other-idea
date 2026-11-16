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

/** A batch from readMore: the reading to keep, and the site's other name when the first page redirected to it. */
export interface Batch {
  reading: object;
  movedTo?: string;
}

/**
 * Saves the pages read so far, the reading, and the origin the first page
 * redirected to, if it did. Only those change, so an edit to the name or
 * origins made meanwhile is kept. True when it was saved.
 */
export async function saveReadBatch(sql: Sql, site: BatchSite, batch: Batch, pages: PageNode[]): Promise<boolean> {
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
    where id = $1 and company_id = $2
    returning id`,
    [site.id, site.companyId, JSON.stringify(pages), JSON.stringify(batch.reading), moved, site.maxOrigins],
  );
  return rows.length > 0;
}
