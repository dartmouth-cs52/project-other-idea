"use client";

// The company's Team page, /dashboard/?view=team. Everyone at the company and
// their role, the people invited who haven't signed in yet, and, for owners and
// admins, adding people, changing roles and removing people. The Worker's half
// is worker/team.ts, which enforces every rule this page shows.

import { useEffect, useState, type FormEvent } from "react";
import { Ellipsis, UserPlus } from "lucide-react";
import { FieldWithButton, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Me, type Team } from "@/lib/app-api";
import { Card, CardTitle, DashboardSurface, DoneMark, FailedCard, PageHeader, Panel } from "./parts";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export function TeamPage({ me }: { me: Me }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api<Team>("/team")
      .then((next) => {
        if (!live) return;
        setTeam(next);
        setFailed(null);
      })
      .catch((error: Error) => live && setFailed(error.message));
    return () => {
      live = false;
    };
  }, [attempt]);

  return (
    <DashboardSurface>
      <PageHeader title="Team" note={me.organization ? `Everyone at ${me.organization.name}. Each of them sees every site.` : undefined} />
      {failed && !team && <FailedCard title="The team didn't load" message={failed} retry={() => setAttempt((n) => n + 1)} level={2} />}
      {!team && !failed && (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      )}
      {team && <Loaded team={team} onChange={setTeam} />}
    </DashboardSurface>
  );
}

function Loaded({ team, onChange }: { team: Team; onChange: (next: Team) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  // A change that didn't go through is said in the panel it was made in, the way a form says it, with Try again when
  // trying again could help: Haptic couldn't be reached or failed on its side. A refusal would only be refused again.
  const [failed, setFailed] = useState<{ at: "people" | "invites"; failure: Failure; retry?: () => void } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function act(key: string, title: string, path: string, method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(key);
    setFailed(null);
    try {
      onChange(await api<Team>(path, { method, body }));
      setRemoving(null);
    } catch (failure) {
      const passing = !(failure instanceof ApiError) || failure.status === 0 || failure.status >= 500;
      setFailed({
        at: path.startsWith("/team/invites/") ? "invites" : "people",
        failure: failureFrom(title, failure),
        retry: passing ? () => void act(key, title, path, method, body) : undefined,
      });
    }
    setBusy(null);
  }

  return (
    <>
      <Panel
        title="People"
        aside={<span className="text-sm text-muted-foreground">{team.members.length === 1 ? "1 person" : `${team.members.length} people`}</span>}
        foot="Owners and admins can add people, change roles and manage billing. Members can do everything else. The owner is whoever signed in first, and can't be changed here."
      >
        <ul className="flex flex-col divide-y border-t">
          {team.members.map((member) => {
            const changeable = team.canManage && member.role !== "owner" && !member.you;
            const label = member.name || member.email;
            return (
              <li key={member.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium uppercase" aria-hidden>
                    {label.slice(0, 1)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {label}
                      {member.you && <span className="font-normal text-muted-foreground"> (you)</span>}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{member.name ? member.email : `Joined ${day(member.joined)}`}</span>
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">{ROLE[member.role] ?? member.role}</span>
                  {/* The same space on rows that can't be changed, so every role lines up. */}
                  {team.canManage && !changeable && <span className="size-8 shrink-0" aria-hidden />}
                  {changeable && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Change ${label}`}
                        disabled={busy !== null}
                        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted"
                      >
                        <Ellipsis className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {member.role === "admin" ? (
                          <DropdownMenuItem onClick={() => act(member.id, "The role didn't change", `/team/members/${member.id}`, "PATCH", { role: "member" })}>Make a member</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => act(member.id, "The role didn't change", `/team/members/${member.id}`, "PATCH", { role: "admin" })}>Make an admin</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setRemoving(member.id)}>
                          Remove from the team
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {removing === member.id && (
                  <div className="flex flex-wrap items-center gap-2 pl-11">
                    <span className="text-sm">Remove {label}? They lose access to the dashboard.</span>
                    <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => act(member.id, `${label} wasn't removed`, `/team/members/${member.id}`, "DELETE")}>
                      {busy === member.id ? "Removing" : "Remove"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setRemoving(null)}>
                      Keep them
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {failed?.at === "people" && (
          <div className="border-t px-5 py-3">
            <FormAlert failure={failed.failure} retry={failed.retry} />
          </div>
        )}
      </Panel>

      {team.invites.length > 0 && (
        <Panel title="Invited" aside={<span className="text-sm text-muted-foreground">Not signed in yet</span>}>
          <ul className="flex flex-col divide-y border-t">
            {team.invites.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{item.email}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    Added {day(item.invitedAt)}
                    {item.invitedBy ? ` by ${item.invitedBy}` : ""}
                  </span>
                </span>
                {team.canManage && (
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act(item.id, "The invitation wasn't taken back", `/team/invites/${item.id}`, "DELETE")}>
                    {busy === item.id ? "Taking back" : "Take back"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {failed?.at === "invites" && (
            <div className="border-t px-5 py-3">
              <FormAlert failure={failed.failure} retry={failed.retry} />
            </div>
          )}
        </Panel>
      )}

      {team.canManage ? (
        <AddPerson onAdded={onChange} />
      ) : (
        <Card>
          <CardTitle>Add someone</CardTitle>
          <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">Only an owner or admin can add people or change roles. Ask one of them.</p>
        </Card>
      )}

      {team.domains.length > 0 && (
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          Anyone with an {team.domains.map((domain) => `@${domain}`).join(" or ")} address also joins your company when they sign in.
        </p>
      )}
    </>
  );
}

type AddState = { kind: "idle" } | { kind: "adding" } | { kind: "added"; email: string; sent: boolean } | { kind: "failed"; failure: Failure };

/** Adds someone by email. They get a sign-in link, and join as a member the first time they use it. */
function AddPerson({ onAdded }: { onAdded: (next: Team) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<AddState>({ kind: "idle" });
  const fields = useFieldErrors({ email: "team-add-email" });

  async function add(event: FormEvent) {
    event.preventDefault();
    const typed = email.trim();
    if (fields.show({ email: typed ? undefined : "Enter their email." }) || !typed) return;
    setState({ kind: "adding" });
    try {
      const result = await api<Team & { sent: boolean; email: string }>("/team/invites", { method: "POST", body: { email: typed } });
      onAdded(result);
      setEmail("");
      setState({ kind: "added", email: result.email, sent: result.sent });
    } catch (failure) {
      if (fields.showRefusal(failure)) setState({ kind: "idle" });
      else setState({ kind: "failed", failure: failureFrom("They weren't added", failure) });
    }
  }

  return (
    <Card>
      <CardTitle>Add someone</CardTitle>
      <form onSubmit={add} noValidate>
        <FieldWithButton
          id="team-add-email"
          label="Their work email"
          required
          error={fields.errors.email}
          hint="They get an email to sign in, and join as a member. You can make them an admin once they have."
          button={
            <Button type="submit" size="xl" variant="secondary" disabled={state.kind === "adding"}>
              <UserPlus />
              {state.kind === "adding" ? "Adding" : "Add"}
            </Button>
          }
        >
          <Input
            {...fields.control("email", { hint: true })}
            required
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              fields.clear("email");
              if (state.kind === "added" || state.kind === "failed") setState({ kind: "idle" });
            }}
            className="h-11 bg-card px-3.5 md:text-base"
          />
        </FieldWithButton>
      </form>
      {state.kind === "added" && (
        <p className="flex items-start gap-2 text-sm leading-5" role="status">
          <DoneMark className="mt-0.5" />
          <span>
            {state.sent ? (
              <>
                Added <span className="font-medium">{state.email}</span>. They have an email to sign in.
              </>
            ) : (
              <>
                Added <span className="font-medium">{state.email}</span>, but the email didn&apos;t go out. They can sign in at joinhaptic.com with that address.
              </>
            )}
          </span>
        </p>
      )}
      {state.kind === "failed" && <FormAlert failure={state.failure} />}
    </Card>
  );
}
