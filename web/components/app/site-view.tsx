"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircleIcon, Mail } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type Reading, type Site } from "@/lib/app-api";
import { InstallOptions } from "./install-options";
import { InsightsView } from "./insights-view";
import { Card, CardTitle, CopyButton, DoneMark, StepMark, when } from "./parts";

/** How often the page asks whether the script has been seen, while waiting for it. */
const WAITING_MS = 5_000;
const CONNECTED_MS = 60_000;

/** One site: the three setup steps until it connects, then what its users asked. */
export function SiteView({ siteId }: { siteId: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
      if (document.visibilityState === "visible") {
        void load();
        setRefreshKey((key) => key + 1);
      }
    }, site?.connected ? CONNECTED_MS : WAITING_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, site?.connected]);

  if (error && !site) return <Card><p className="text-base text-muted-foreground">{error}</p></Card>;
  if (!site) return <Card><p className="text-base text-muted-foreground">Loading your site</p></Card>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-4xl font-medium tracking-[-0.03em]">{site.name}</h1>
        <p className="text-base text-muted-foreground">{site.origin}</p>
      </div>

      {site.connected ? (
        <>
          <InsightsView siteId={site.id} refreshKey={refreshKey} />
          <InstallHealth site={site} onChange={setSite} />
        </>
      ) : (
        <Setup site={site} onChange={setSite} />
      )}
    </div>
  );
}

function Setup({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  const developerLink = typeof window === "undefined" ? "" : `${window.location.origin}/install/?site=${site.id}`;
  const mail = `mailto:?subject=${encodeURIComponent("Please add Haptic to our site")}&body=${encodeURIComponent(
    `Hi,\n\nCould you add Haptic to ${site.origin}? It is one script tag on every page, including pages behind the login. Everything you need, for each kind of stack, is here.\n\n${developerLink}\n\nThanks`,
  )}`;

  return (
    <div className="flex flex-col gap-6">
      <ReadPages site={site} />

      <Card>
        <div className="flex items-center gap-3">
          <StepMark n={2} />
          <h2 className="text-2xl font-medium tracking-[-0.02em]">Add the script to your site</h2>
        </div>
        <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
          One tag on every page, including the pages behind your login. If someone else looks after your code, send them the install page.
        </p>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={developerLink} label="Copy link for my developer" />
          <a href={mail} className={buttonVariants({ variant: "secondary" })}>
            <Mail />
            Email it to them
          </a>
        </div>
        <InstallOptions scriptUrl={site.scriptUrl} siteId={site.id} />
      </Card>

      <Connection site={site} onChange={onChange} />
    </div>
  );
}

/** Step 1. Reads the public pages a few at a time, showing each as it comes, until all are read. */
function ReadPages({ site }: { site: Site }) {
  const [reading, setReading] = useState<Reading | null>(site.reading);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    async function more() {
      if (busy.current) return;
      busy.current = true;
      try {
        for (let round = 0; round < 20 && live; round++) {
          const next = await api<Reading | null>(`/sites/${site.id}/read`, { method: "POST" });
          if (!live) break;
          setReading(next);
          if (!next || next.done) break;
        }
      } catch {
        if (live) setFailed(true);
      } finally {
        busy.current = false;
      }
    }
    if (reading && !reading.done) void more();
    return () => {
      live = false;
    };
    // Starts once per site. Each round updates `reading` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  if (!reading) return null;
  const done = reading.done;
  return (
    <Card>
      <div className="flex items-center gap-3">
        {done ? <DoneMark /> : <StepMark n={1} />}
        <h2 className="text-2xl font-medium tracking-[-0.02em]">
          {reading.read} {reading.read === 1 ? "page" : "pages"} read
        </h2>
      </div>
      <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
        {done
          ? "Haptic has read your public pages, so it knows what your product calls things. Screens behind your login are read live, on the page each person is looking at."
          : "Haptic is reading your public pages, following links, tabs and menus. It never submits a form or changes anything."}
      </p>
      {failed && !done && <p className="text-sm text-muted-foreground">Reading stopped for now. It picks up again when you reload this page.</p>}
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
  return (
    <Card>
      <div className="flex items-center gap-3">
        <StepMark n={3} />
        <h2 className="text-2xl font-medium tracking-[-0.02em]">See it connect</h2>
      </div>
      {refused.length ? (
        <div className="flex flex-col gap-3">
          <p className="max-w-[65ch] text-base leading-6">
            The script is running, but on an address this site does not allow yet. Haptic stays hidden there until you allow it.
          </p>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {refused.map((row) => (
              <RefusedOrigin key={row.origin} site={site} origin={row.origin} lastSeen={row.last_seen_at} onChange={onChange} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="max-w-[65ch] text-base leading-6 text-muted-foreground">
          Waiting for the script. Once the tag is on your site, open any page with it, and this changes within a few seconds.
        </p>
      )}
      <AllowedOrigins site={site} onChange={onChange} />
    </Card>
  );
}

function RefusedOrigin({ site, origin, lastSeen, onChange }: { site: Site; origin: string; lastSeen: string; onChange: (site: Site) => void }) {
  const [busy, setBusy] = useState(false);
  async function allow() {
    setBusy(true);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { allowedOrigins: [...site.allowedOrigins, origin] } }));
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
  const [error, setError] = useState<string | null>(null);
  async function save(origins: string[]) {
    setError(null);
    try {
      onChange(await api<Site>(`/sites/${site.id}`, { method: "PATCH", body: { allowedOrigins: origins } }));
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    }
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    let text = adding.trim().replace(/\/+$/, "");
    if (!text) return;
    if (!/^https?:\/\//.test(text)) text = `https://${text}`;
    const origin = URL.canParse(text) ? new URL(text).origin : text;
    if (await save([...site.allowedOrigins, origin])) setAdding("");
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-medium">Where Haptic may run</h3>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {site.allowedOrigins.map((origin) => (
          <li key={origin} className="flex items-center justify-between gap-4 px-4 py-2 text-sm">
            <span>{origin}</span>
            {site.allowedOrigins.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => save(site.allowedOrigins.filter((item) => item !== origin))}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor={`origin-${site.id}`}>Add an address, such as staging or localhost</Label>
          <Input
            id={`origin-${site.id}`}
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            placeholder="https://staging.example.com"
            className="h-11 bg-card px-3.5 md:text-base"
          />
        </div>
        <Button type="submit" variant="secondary" size="xl">
          Add
        </Button>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Once connected: where the script has been seen, and the list of allowed addresses. */
function InstallHealth({ site, onChange }: { site: Site; onChange: (site: Site) => void }) {
  return (
    <Card>
      <CardTitle>Install</CardTitle>
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
          <InstallOptions scriptUrl={site.scriptUrl} siteId={site.id} />
        </div>
      </details>
    </Card>
  );
}
