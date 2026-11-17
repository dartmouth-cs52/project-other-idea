"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { cn } from "cn";
import { AlertCircleIcon, Route } from "lucide-react";
import { FieldWithButton, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Me, type Reading, type Site } from "@/lib/app-api";
import { CopyLink } from "./agent-pill";
import { DeveloperEmail } from "./developer-email";
import { Gaps } from "./gaps";
import { GuideDrawer } from "./guide-drawer";
import { GuidingRules } from "./guiding-rules";
import { InstallOptions } from "./install-options";
import { useInsights, useLive } from "./live";
import { RANGES, daysFrom, siteHref, useAddress, type View } from "./nav";
import { Overview } from "./overview";
import { Card, CardTitle, DashboardSurface, DoneMark, FailedCard, PageHeader, Segmented, StepMark, StepTitle, when } from "./parts";
import { Questions } from "./questions";
import { RoutesCard } from "./routes-card";
import { SetupGate } from "./setup/setup-gate";
import { SiteShell } from "./shell";
import { DeleteSite, HelpDocs, Notes, SiteName, WidgetLook } from "./site-settings";
import { TeachDrawer } from "./teach";
import { FinishedGuides } from "./usage";

/** How often the page asks whether the script has been seen, while waiting for it. */
const WAITING_MS = 5_000;
/** Once connected, the site's own details change rarely. Its questions are kept current by live.ts. */
const CONNECTED_MS = 60_000;

type SiteRow = NonNullable<Me["sites"]>[number];

/** Northpine, Haptic's own demo app. Its overview does not ask to be mapped. */
const NOT_ASKED_TO_MAP = new Set(["demo.joinhaptic.com"]);

/** Whether the overview asks for the signed-in screens. Every site but Northpine is asked until it has been mapped once. */
function asksToMap(site: Site): boolean {
  try {
    return !NOT_ASKED_TO_MAP.has(new URL(site.origin).hostname);
  } catch {
    return true;
  }
}

const SETTINGS_TABS = [
  { value: "general", name: "General" },
  { value: "install", name: "Install" },
  { value: "usage", name: "Usage" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

/**
 * One site, inside its frame. Until the script connects, the first page is the
 * three setup steps. After that it is the overview, and every page that shows
 * questions is kept current while it is open.
 */
export function SiteView({ me, row, view, onDeleted, onRenamed }: { me: Me; row: SiteRow; view: View; onDeleted: () => void; onRenamed: () => void }) {
  const { params, set } = useAddress();
  const days = daysFrom(params.get("days"));
  const openGuide = params.get("guide");
  const tab: SettingsTab = SETTINGS_TABS.find((item) => item.value === params.get("tab"))?.value ?? "general";
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  const siteId = row.id;

  const load = useCallback(async () => {
    try {
      setSite(await api<Site>(`/sites/${siteId}`));
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [siteId]);

  // Ask again and again while waiting for the script, then now and then, and only while the tab is in view.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, site?.connected ? CONNECTED_MS : WAITING_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, site?.connected]);

  const pages = useReading(site);
  const connected = site?.connected === true;
  // The pages that show questions, and so are kept current. Knowledge and Settings show none, and ask for nothing
  // while they are open, unless a guide is open beside them.
  const counted = view === "overview" || view === "questions" || view === "gaps";
  const { live, failing } = useLive(connected && (counted || openGuide) ? siteId : null);
  // The numbers wait for the first live answer, so they are asked for once and not twice. If live can't be reached they go ahead without it.
  const stamp = live?.stamp ?? (failing ? "unreachable" : undefined);
  const numbers = useInsights(connected && counted && stamp ? siteId : null, days, stamp);
  const openIt = useCallback((guide: string) => set({ guide }, "push"), [set]);

  const range = <Segmented label="Time range" value={days} onChange={(next) => set({ days: next === 30 ? undefined : String(next) })} options={RANGES.map((value) => ({ value, name: `${value} days` }))} />;

  let page;
  if (error && !site) page = <FailedCard title="Couldn't load your site" message={error} retry={() => void load()} />;
  else if (!site) page = <p className="text-sm text-muted-foreground">Loading your site</p>;
  else if (view === "knowledge") {
    page = (
      <>
        <PageHeader title="Knowledge" />
        <Notes site={site} onChange={setSite} />
        <HelpDocs site={site} onChange={setSite} />
        <GuidingRules site={site} onChange={setSite} />
        {site.connected && site.mapped > 0 && <MapApp site={site} reload={load} />}
        <PagesRead reading={pages.reading} />
      </>
    );
  } else if (view === "settings") {
    page = (
      <>
        <PageHeader title="Settings" />
        <Segmented tabs label="Settings" value={tab} onChange={(next) => set({ tab: next === "general" ? undefined : next })} options={SETTINGS_TABS} />
        {tab === "general" && (
          <>
            <SiteName site={site} onChange={setSite} onRenamed={onRenamed} />
            <WidgetLook site={site} onChange={setSite} />
            <DeleteSite site={site} onDeleted={onDeleted} />
          </>
        )}
        {tab === "install" && (site.connected ? <InstallHealth site={site} reading={pages.reading} onChange={setSite} /> : <Setup site={site} pages={pages} onChange={setSite} />)}
        {tab === "usage" && <FinishedGuides siteId={site.id} onOpen={openIt} />}
      </>
    );
  } else if (!site.connected) {
    page =
      view === "overview" ? (
        <>
          <PageHeader title={`Set up ${site.name}`} note="This page changes by itself when the script connects." />
          <SetupGate site={site} />
          <Setup site={site} pages={pages} onChange={setSite} />
        </>
      ) : (
        <>
          <PageHeader title={view === "questions" ? "Questions" : "Gaps"} />
          <Card>
            <CardTitle>Nothing here yet</CardTitle>
            <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">Questions show up once the script is on your site and someone asks Haptic something.</p>
            <Link href={siteHref(site.id)} className={cn(buttonVariants({ variant: "secondary" }), "self-start")}>
              Finish setup
            </Link>
          </Card>
        </>
      );
  } else if (numbers.error) {
    page = <FailedCard level={2} title="Couldn't load the questions" message={numbers.error} retry={numbers.retry} />;
  } else if (view === "questions") {
    page = (
      <>
        <PageHeader title="Questions">
          <Reconnecting failing={failing} />
          {range}
        </PageHeader>
        <Questions data={numbers.data} live={live} onOpen={openIt} />
      </>
    );
  } else if (view === "gaps") {
    page = (
      <>
        <PageHeader title="Gaps">
          {range}
        </PageHeader>
        <Gaps siteId={site.id} data={numbers.data} onOpen={openIt} />
      </>
    );
  } else {
    page = (
      <>
        <PageHeader title="Overview">
          <Reconnecting failing={failing} />
          {range}
        </PageHeader>
        {/* Asked for first until it has been done once: without it Haptic knows only the public pages. */}
        {site.mapped === 0 && asksToMap(site) && <MapApp site={site} reload={load} />}
        <Overview siteId={site.id} origin={site.origin} days={days} stamp={stamp} data={numbers.data} live={live} onOpen={openIt} />
        {numbers.data?.routes && <RoutesCard site={site} metrics={numbers.data.routes} onChange={setSite} />}
      </>
    );
  }

  return (
    <DashboardSurface>
      <SiteShell me={me} current={row} view={view}>
        {page}
        {openGuide && site && (
          <GuideDrawer siteId={site.id} guideId={openGuide} stamp={live?.stamp} onClose={() => set({ guide: undefined })} onCorrected={(corrections) => setSite({ ...site, corrections })} />
        )}
        {site && <TeachDrawer site={site} onChange={setSite} />}
      </SiteShell>
    </DashboardSurface>
  );
}

/**
 * A page that keeps itself current says nothing about it: new questions simply
 * arrive. It speaks up only when it has stopped hearing from the server, so
 * nobody takes what is on screen for the latest.
 */
function Reconnecting({ failing }: { failing: boolean }) {
  if (!failing) return null;
  return (
    <span className="text-sm text-muted-foreground" role="status">
      Reconnecting
    </span>
  );
}

/** The public pages Haptic read when the site was added. */
function PagesRead({ reading }: { reading: Reading | null }) {
  if (!reading || reading.read === 0) return null;
  return (
    <Card>
      <CardTitle>
        {reading.read} public {reading.read === 1 ? "page" : "pages"} read
      </CardTitle>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        {reading.done
          ? "Haptic has read your public pages, so it knows what your product calls things. Screens behind your login are read live, on the page each person is looking at."
          : "Haptic is still reading your public pages, following links, tabs and menus. It never submits a form or changes anything."}
      </p>
      {reading.pages.length > 0 && (
        <ul className="grid max-h-56 gap-x-6 gap-y-1 overflow-y-auto rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
          {reading.pages.map((page) => (
            <li key={page.path} className="truncate">
              <span>{page.title || page.path}</span> <span className="text-muted-foreground">{page.path}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Keeps the reading of a site's public pages going while its page is open, a
 * few pages per request, whether or not the site has connected yet. A fast
 * install must not leave the site with only the first few pages.
 */
function useReading(site: Site | null) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [stalled, setStalled] = useState(false);
  const busy = useRef(false);
  const siteId = site?.id;
  const unfinished = Boolean(site?.reading && !site.reading.done);

  const run = useCallback(
    async (restart: boolean) => {
      if (!siteId || busy.current) return;
      busy.current = true;
      setStalled(false);
      try {
        for (let round = 0; round < 20; round++) {
          const next = await api<Reading | null>(`/sites/${siteId}/read`, { method: "POST", body: restart && round === 0 ? { restart: true } : {} });
          setReading(next);
          if (!next || next.done) break;
        }
      } catch {
        setStalled(true);
      } finally {
        busy.current = false;
      }
    },
    [siteId],
  );

  useEffect(() => {
    if (!unfinished) return;
    const start = setTimeout(() => void run(false), 0);
    return () => clearTimeout(start);
  }, [unfinished, run]);

  return { reading: reading ?? site?.reading ?? null, stalled, retry: () => void run(true) };
}

type Pages = ReturnType<typeof useReading>;

function Setup({ site, pages, onChange }: { site: Site; pages: Pages; onChange: (site: Site) => void }) {
  const developerLink = typeof window === "undefined" ? "" : `${window.location.origin}/install/?site=${site.id}`;

  return (
    <div className="flex flex-col gap-6">
      <ReadPages pages={pages} />

      <Card>
        <StepTitle mark={<StepMark n={2} />}>Add the script to your site</StepTitle>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          One tag on every page, including the pages behind your login. If someone else looks after your code, send them the install page.
        </p>
        <InstallOptions scriptUrl={site.scriptUrl} siteId={site.id} live={site} />
        <CopyLink link={developerLink} />
        <DeveloperEmail siteId={site.id} installLink={developerLink} />
      </Card>

      <Connection site={site} onChange={onChange} />

      <Card>
        <StepTitle mark={<StepMark n={4} />}>Show Haptic the screens behind your login</StepTitle>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          Once the script connects, one button here has Haptic go through your signed-in app by itself, in your own browser, so it knows where
          everything is before your first user asks.
        </p>
      </Card>
    </div>
  );
}

/**
 * Starts a mapping run: the company's own app opens in a new tab with a pass
 * in its address, and the widget there goes through the app by itself
 * (src/widget/map.ts in the widget). The count here goes up as pages arrive,
 * because the page asks for the site again every so often.
 */
function MapApp({ site, reload }: { site: Site; reload: () => void }) {
  const [start, setStart] = useState(site.origin);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = site.mapped > 0;

  // While a run is under way in the other tab, the count is asked for often enough to watch it climb.
  useEffect(() => {
    if (!opened) return;
    const timer = setInterval(() => document.visibilityState === "visible" && reload(), WAITING_MS);
    const stop = setTimeout(() => setOpened(false), 30 * 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [opened, reload]);

  async function begin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    // The tab is opened now, while the click still counts as theirs, and sent on once the link is ready.
    // Opened after the wait, a browser would block it as a popup.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>(`/sites/${site.id}/map`, { method: "POST", body: { url: start.trim() } });
      if (tab) {
        // Their app gets no handle on this page.
        tab.opener = null;
        tab.location.replace(url);
        setOpened(true);
      } else {
        setError("Your browser stopped the new tab. Allow popups for this page, then start again.");
      }
    } catch (failure) {
      tab?.close();
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <StepTitle mark={done ? <DoneMark /> : <Route className="size-5 text-muted-foreground" aria-hidden />}>
        {done ? `${site.mapped} signed-in ${site.mapped === 1 ? "screen" : "screens"} mapped` : "Show Haptic the screens behind your login"}
      </StepTitle>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        {done
          ? "Haptic knows these screens: where their links and buttons lead, and what is behind each menu, tab and dialog. Map again after a big change to your product."
          : "So far Haptic has only read your public pages. Sign in to your app in this browser, then start. Your app opens in a new tab and Haptic goes through it by itself: it visits each page and opens menus, tabs and dialogs to see what is there. It takes a few minutes, and you can pause or stop it at any time."}
      </p>
      <ul className="flex max-w-[65ch] list-disc flex-col gap-1 pl-5 text-sm leading-5 text-muted-foreground">
        <li>It skips anything that looks like it saves, sends, deletes, pays or signs out, and it never types or submits a form.</li>
        <li>While it presses a button, it stops the page from sending changes. No guard is perfect, so use a test or demo account if you have one.</li>
        <li>It keeps the names of buttons, links and fields. Never what is in a field or a table.</li>
        <li>Haptic will describe your app as this account sees it, so use an account that sees what your users see.</li>
      </ul>
      <form onSubmit={begin} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`map-${site.id}`}>Where your app starts once you are signed in</Label>
          <Input id={`map-${site.id}`} value={start} onChange={(event) => setStart(event.target.value)} placeholder={site.origin} className="h-11 bg-card px-3.5 md:text-base" />
        </div>
        <Button type="submit" size="xl" variant={done ? "secondary" : "default"} disabled={busy}>
          {done ? "Map again" : "Start mapping"}
        </Button>
      </form>
      {opened && !error && (
        <p className="text-sm text-muted-foreground">
          Your app is open in a new tab. Press Start in the panel at the top of it. If no panel shows, the script is not on that page yet.
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </Card>
  );
}

/** Step 1. Shows the public pages as they are read, a few at a time, and says so plainly when none could be. */
function ReadPages({ pages }: { pages: Pages }) {
  const { reading, stalled, retry } = pages;
  if (!reading) return null;
  const done = reading.done;

  if (done && reading.read === 0) {
    return (
      <Card>
        <StepTitle mark={<StepMark n={1} />}>Haptic could not read your site</StepTitle>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          The address did not answer, or it sends visitors somewhere else, such as a sign in page. You can carry on. Haptic reads each page live once the
          script is on it, so guides still work.
        </p>
        <Button variant="secondary" className="self-start" onClick={retry}>
          Try again
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <StepTitle mark={done ? <DoneMark /> : <StepMark n={1} />}>
          {reading.read} {reading.read === 1 ? "page" : "pages"} read
        </StepTitle>
      <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
        {done
          ? "Haptic has read your public pages, so it knows what your product calls things. Screens behind your login are read live, on the page each person is looking at."
          : "Haptic is reading your public pages, following links, tabs and menus. It never submits a form or changes anything."}
      </p>
      {stalled && !done && <p className="text-sm text-muted-foreground">Reading stopped for now. It picks up again when you reload this page.</p>}
      {reading.pages.length > 0 && (
        <ul className="grid max-h-56 gap-x-6 gap-y-1 overflow-y-auto rounded-lg border bg-card p-4 text-sm sm:grid-cols-2">
          {reading.pages.map((page) => (
            <li key={page.path} className="truncate">
              <span>{page.title || page.path}</span> <span className="text-muted-foreground">{page.path}</span>
            </li>
          ))}
        </ul>
      )}
      {done && reading.thin > 0 && (
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          {reading.thin} of these had almost nothing to click. They are probably behind a login, which is fine.
        </p>
      )}
    </Card>
  );
}

/** Step 3. Waits for the first call from an allowed origin, and says plainly when the script is running somewhere not on the list. */
function Connection({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const refused = site.origins.filter((row) => !row.allowed);
  const [failure, setFailure] = useState<Failure | null>(null);
  return (
    <Card>
      <StepTitle mark={<StepMark n={3} />}>See it connect</StepTitle>
      {refused.length ? (
        <div className="flex flex-col gap-3">
          <p className="max-w-[65ch] text-sm leading-5">
            The script is running, but on an address this site does not allow yet. Haptic stays hidden there until you allow it, and then shows up
            within a minute. Only allow an address you know is yours.
          </p>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {refused.map((row) => (
              <RefusedOrigin key={row.origin} site={site} origin={row.origin} lastSeen={row.last_seen_at} onChange={onChange} onFailure={setFailure} />
            ))}
          </ul>
          <FormAlert failure={failure} />
        </div>
      ) : (
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          Waiting for the script. Once the tag is on your site, open any page with it, and this changes within a few seconds.
        </p>
      )}
      <AllowedOrigins site={site} onChange={onChange} />
    </Card>
  );
}

function RefusedOrigin({
  site,
  origin,
  lastSeen,
  onChange,
  onFailure,
}: {
  site: Site;
  origin: string;
  lastSeen: string;
  onChange: (site: Site) => void;
  onFailure: (failure: Failure | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function allow() {
    setBusy(true);
    onFailure(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { allowedOrigins: [...site.allowedOrigins, origin] } }));
    } catch (failure) {
      onFailure(failureFrom(`Couldn't allow ${origin}`, failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="min-w-0 text-sm">
        <span className="font-medium">{origin}</span>
        <span className="text-muted-foreground">, seen {when(lastSeen)}</span>
      </span>
      <Button onClick={allow} disabled={busy}>
        Allow
      </Button>
    </li>
  );
}

/** The list of addresses the widget may run on, such as production, staging and localhost. */
function AllowedOrigins({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const [adding, setAdding] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  // Named as the server names it, so a refusal of the new address shows under the field.
  const fields = useFieldErrors({ allowedOrigins: `origin-${site.id}` });
  async function remove(origin: string) {
    setFailure(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { allowedOrigins: site.allowedOrigins.filter((item) => item !== origin) } }));
    } catch (failure) {
      setFailure(failureFrom(`Couldn't remove ${origin}`, failure));
    }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    let text = adding.trim().replace(/\/+$/, "");
    if (fields.show({ allowedOrigins: text ? undefined : "Enter an address, like https://staging.example.com." })) return;
    if (!/^https?:\/\//.test(text)) text = `https://${text}`;
    const origin = URL.canParse(text) ? new URL(text).origin : text;
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { allowedOrigins: [...site.allowedOrigins, origin] } }));
      setAdding("");
    } catch (failure) {
      if (!fields.showRefusal(failure)) setFailure(failureFrom("Couldn't add the address", failure));
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Where Haptic may run</h3>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {site.allowedOrigins.map((origin) => (
          <li key={origin} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
            <span>{origin}</span>
            {site.allowedOrigins.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => remove(origin)}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate>
        <FieldWithButton
          id={`origin-${site.id}`}
          label="Add an address, such as staging or localhost"
          required
          error={fields.errors.allowedOrigins}
          button={
            <Button type="submit" variant="secondary" size="xl">
              Add
            </Button>
          }
        >
          <Input
            {...fields.control("allowedOrigins")}
            required
            value={adding}
            onChange={(event) => {
              setAdding(event.target.value);
              fields.clear("allowedOrigins");
            }}
            placeholder="https://staging.example.com"
            className="h-11 bg-card px-3.5 md:text-base"
          />
        </FieldWithButton>
      </form>
      <FormAlert failure={failure} />
    </div>
  );
}

/** Once connected: where the script has been seen, and the list of allowed addresses. */
function InstallHealth({ site, reading, onChange }: { site: Site; reading: Reading | null; onChange: (site: Site) => void }) {
  return (
    <Card>
      <CardTitle>Install</CardTitle>
      {reading && reading.read > 0 && (
        <p className="text-sm text-muted-foreground">
          {reading.read} public {reading.read === 1 ? "page" : "pages"} read{reading.done ? "." : ", and still reading."}
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {site.origins.map((row) => (
          <li key={row.origin} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2">
              {row.allowed && <DoneMark className="size-4" />}
              <span className="font-medium">{row.origin}</span>
            </span>
            <span className="text-muted-foreground">
              {row.allowed ? "Running" : "Not allowed, so Haptic stays hidden"}, last seen {when(row.last_seen_at)}
            </span>
          </li>
        ))}
      </ul>
      <AllowedOrigins site={site} onChange={onChange} />
      <details className="rounded-lg border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Script tag and install options</summary>
        <div className="mt-4">
          <InstallOptions scriptUrl={site.scriptUrl} siteId={site.id} live={site} />
        </div>
      </details>
    </Card>
  );
}
