import { isLearnableLabel, normalizePath, type PageOutline } from "@haptic/protocol";

// The learned site map: for each route, which headings, links and buttons
// users see. A label only reaches the prompt after enough different visitors
// have reported it, so one user's own content (a set called "Biology 101")
// never does, while shared UI ("Manage subscription") does.

export interface OutlineLabel {
  route: string;
  kind: "heading" | "link" | "button" | "title";
  label: string;
  href?: string;
  /** Every report, used for ranking. */
  seenCount: number;
  /** Distinct visitors who reported it, capped at 10. Gates the prompt. */
  visitorCount: number;
  hidden?: boolean;
}

export type LabelRow = Omit<OutlineLabel, "seenCount" | "visitorCount">;

export const LABEL_THRESHOLD = Number(process.env.HAPTIC_LABEL_THRESHOLD ?? (process.env.NODE_ENV === "production" ? 3 : 1));
const MAX_ROUTES = 40;
const MAX_PER_KIND: Record<OutlineLabel["kind"], number> = { title: 1, heading: 8, link: 20, button: 24 };
const KIND_ORDER = ["heading", "link", "button"] as const;

/** Flatten an outline into the label rows we store and count. */
export function outlineToLabels(outline: PageOutline): LabelRow[] {
  const route = normalizePath(outline.path);
  const rows: LabelRow[] = [];
  const push = (kind: OutlineLabel["kind"], label: string, href?: string) => {
    const clean = label.replace(/\s+/g, " ").trim();
    if (!isLearnableLabel(clean)) return;
    rows.push({ route, kind, label: clean, ...(href ? { href: normalizePath(href) } : {}) });
  };
  if (outline.title) push("title", outline.title);
  for (const heading of outline.headings.slice(0, 10)) push("heading", heading);
  for (const link of outline.links.slice(0, 60)) {
    if (link.href.startsWith("external:")) continue;
    push("link", link.label, link.href);
  }
  for (const button of outline.buttons.slice(0, 40)) push("button", button);
  return rows;
}

function display(row: OutlineLabel): string {
  return row.kind === "link" && row.href && row.href !== row.route ? `${row.label} (${row.href})` : row.label;
}

/**
 * Render stored labels as compact prompt lines, one per route. Navigation
 * that repeats on most pages is listed once at the top, which leaves room on
 * each route's line for what's specific to it.
 */
export function renderLabels(labels: OutlineLabel[], threshold = LABEL_THRESHOLD): string {
  const usable = labels
    .filter((row) => !row.hidden && row.visitorCount >= threshold)
    .sort((a, b) => b.visitorCount - a.visitorCount || b.seenCount - a.seenCount);

  const byRoute = new Map<string, OutlineLabel[]>();
  for (const row of usable) byRoute.set(row.route, [...(byRoute.get(row.route) ?? []), row]);
  const routes = Array.from(byRoute.entries())
    .map(([route, rows]) => ({ route, rows, visits: Math.max(...rows.map((row) => row.seenCount)) }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, MAX_ROUTES);

  // A label counts as shared when it's on at least 3 routes and half of them.
  const routesWith = new Map<string, number>();
  for (const { rows } of routes) {
    for (const key of new Set(rows.map((row) => `${row.kind}|${display(row)}`))) routesWith.set(key, (routesWith.get(key) ?? 0) + 1);
  }
  const sharedMin = Math.max(3, Math.ceil(routes.length / 2));
  const shared = new Set(Array.from(routesWith).filter(([, count]) => count >= sharedMin).map(([key]) => key));

  const lines: string[] = [];
  const sharedParts = KIND_ORDER.flatMap((kind) => {
    const list = Array.from(shared).filter((key) => key.startsWith(`${kind}|`)).map((key) => key.slice(kind.length + 1));
    return list.length ? [`${kind}s: ${list.join(", ")}`] : [];
  });
  if (sharedParts.length) lines.push(`On most pages: ${sharedParts.join("; ")}`);

  for (const { route, rows } of routes) {
    const kinds = new Map<string, string[]>();
    for (const row of rows) {
      const text = display(row);
      if (shared.has(`${row.kind}|${text}`)) continue;
      const list = kinds.get(row.kind) ?? [];
      if (list.length < MAX_PER_KIND[row.kind] && !list.includes(text)) list.push(text);
      kinds.set(row.kind, list);
    }
    const parts: string[] = [];
    const title = kinds.get("title")?.[0];
    if (title) parts.push(`"${title}"`);
    for (const kind of KIND_ORDER) {
      const list = kinds.get(kind);
      if (list?.length) parts.push(`${kind}s: ${list.join(", ")}`);
    }
    if (parts.length) lines.push(`${route}: ${parts.join("; ")}`);
  }
  return lines.join("\n");
}

// Development store, used when Supabase isn't configured.
const devLabels = new Map<string, LabelRow & { seenCount: number; visitors: Set<string> }>();

export async function recordOutline(siteId: string, visitor: string, outline: PageOutline): Promise<void> {
  const rows = outlineToLabels(outline);
  if (siteId !== "dev-site") {
    const { upsertOutlineLabels } = await import("./db/outlines");
    await upsertOutlineLabels(siteId, visitor, rows);
    return;
  }
  for (const row of rows) {
    const key = `${row.route}|${row.kind}|${row.label}`;
    const existing = devLabels.get(key) ?? { ...row, seenCount: 0, visitors: new Set<string>() };
    existing.seenCount += 1;
    existing.visitors.add(visitor);
    devLabels.set(key, existing);
  }
}

export async function renderSiteMap(siteId: string): Promise<string> {
  if (siteId === "dev-site") {
    return renderLabels(Array.from(devLabels.values(), ({ visitors, ...row }) => ({ ...row, visitorCount: visitors.size })));
  }
  const { loadOutlineLabels } = await import("./db/outlines");
  return renderLabels(await loadOutlineLabels(siteId));
}
