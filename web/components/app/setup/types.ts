import type { Reading, Site } from "@/lib/app-api";
import type { SetupState, SuggestedControl } from "@/lib/setup";

/** The reading as the Worker sends it, with what readingExtras in worker/setup-api.ts adds. */
export interface SetupReading extends Omit<Reading, "pages"> {
  pages: { path: string; title: string; controls?: number }[];
  /** Buttons, links and fields on the pages read. */
  controls?: number;
  /** Pages that look like they need signing in. */
  signIn?: number;
  /** Controls that look like they delete, pay or hand something over. */
  risky?: SuggestedControl[];
}

/** A site as the setup screens read it: the dashboard's Site, plus where its setup is. */
export interface SetupSite extends Omit<Site, "reading"> {
  reading: SetupReading | null;
  setup?: SetupState | null;
}
