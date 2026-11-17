// Where the dashboard's addresses lead: the list of sites, where sign-in
// lands, and which site an address opens. The pages and the Worker both use
// this file, and it has no React in it, so the tests at the top of the
// repository can run it. The rest of the dashboard's addresses are in
// components/app/nav.ts.

/** The list of every site. */
export const SITES_HREF = "/dashboard/?view=sites";

/**
 * Where people land once signed in: the list of sites, whether their company
 * has one site or many. Absolute, because the emailed link is opened from
 * Neon's domain.
 */
export function signedInUrl(origin: string): string {
  return `${origin}${SITES_HREF}`;
}

/**
 * The site an address opens: the one `?site=` names, when it is one of the
 * company's. Every other address is the list of sites, however many there
 * are, so a company with one site is not taken into it without asking.
 */
export function siteAt<Row extends { id: string }>(sites: readonly Row[], params: { get(name: string): string | null }): Row | undefined {
  if (params.get("view") === "sites") return undefined;
  const named = params.get("site");
  return sites.find((site) => site.id === named);
}
