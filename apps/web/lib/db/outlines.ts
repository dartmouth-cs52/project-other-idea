import "server-only";
import type { LabelRow, OutlineLabel } from "../siteMap";
import { createAdminClient } from "../supabase/admin";

export async function upsertOutlineLabels(siteId: string, visitor: string, rows: LabelRow[]): Promise<void> {
  if (rows.length === 0) return;
  // The same label can appear twice on a page (two "Edit" buttons). Count it once.
  const unique = new Map(rows.map((row) => [`${row.route}|${row.kind}|${row.label}`, row]));
  const { error } = await createAdminClient().rpc("bump_outline_labels", {
    p_site: siteId,
    p_visitor: visitor,
    p_rows: Array.from(unique.values()).map((row) => ({ route: row.route, kind: row.kind, label: row.label, href: row.href ?? null })),
  });
  if (error) throw error;
}

export async function loadOutlineLabels(siteId: string): Promise<OutlineLabel[]> {
  const { data, error } = await createAdminClient()
    .from("outline_labels")
    .select("route, kind, label, href, seen_count, visitor_count, hidden")
    .eq("site_id", siteId)
    .order("seen_count", { ascending: false })
    .limit(1500);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    route: row.route,
    kind: row.kind as OutlineLabel["kind"],
    label: row.label,
    ...(row.href ? { href: row.href } : {}),
    seenCount: row.seen_count,
    visitorCount: row.visitor_count ?? 0,
    hidden: row.hidden,
  }));
}
