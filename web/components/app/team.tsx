"use client";

// The company's Team page, /dashboard/?view=team. Everyone at the company and
// their role, the people invited who haven't signed in yet, and, for owners and
// admins, adding people, changing roles and removing people. The Worker's half
// is worker/team.ts, which enforces every rule this page shows.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Ellipsis, UserPlus } from "lucide-react";
import { FieldWithButton, FormAlert, failureFrom, useFieldErrors, type Failure } from "@/components/form";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Team } from "@/lib/app-api";
import { Card, CardTitle, DashboardSurface, FailedCard, PageHeader, Panel } from "./parts";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export function TeamPage() {
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
      <PageHeader title="Team" />
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
  // A change that didn't go through is said under the row it was made on, the way a form says it under its buttons, with
  // Try again where trying again could help: Haptic couldn't be reached, or failed on its side. A refusal, or a server
  // where the team isn't set up (503), would only say the same again.
  const [failed, setFailed] = useState<{ key: string; failure: Failure; retry?: () => void } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  /** Opens or closes the line that confirms a removal. What was said about an earlier attempt goes with it. */
  function confirmRemoval(id: string | null) {
    setRemoving(id);
    setFailed(null);
  }

  async function act(key: string, title: string, path: string, method: "PATCH" | "DELETE", body?: unknown) {
    setBusy(key);
    setFailed(null);
    try {
      onChange(await api<Team>(path, { method, body }));
      setRemoving(null);
    } catch (failure) {
      const passing = !(failure instanceof ApiError) || failure.status === 0 || (failure.status >= 500 && failure.status !== 503);
      setFailed({ key, failure: failureFrom(title, failure), retry: passing ? () => void act(key, title, path, method, body) : undefined });
    }
    setBusy(null);
  }

  return (
    <>
      <Panel
        title="People"
        aside={<span className="text-sm text-muted-foreground">{team.members.length === 1 ? "1 person" : `${team.members.length} people`}</span>}
        foot="Everyone here sees every site. Owners and admins can add people, change roles and manage billing. Members can do everything else. The owner is whoever signed in first, and can't be changed here."
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
                        <DropdownMenuItem onClick={() => confirmRemoval(member.id)}>Remove from the team</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {removing === member.id && (
                  // The way back sits to the left of the step it backs out of, as on every form.
                  <div className="flex flex-wrap items-center gap-2 pl-11">
                    <span className="text-sm">Remove {label}? They lose access to the dashboard.</span>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => confirmRemoval(null)}>
                      Keep them
                    </Button>
                    <Button variant="secondary" disabled={busy !== null} onClick={() => act(member.id, `${label} wasn't removed`, `/team/members/${member.id}`, "DELETE")}>
                      {busy === member.id ? "Removing" : "Remove"}
                    </Button>
                  </div>
                )}
                {failed?.key === member.id && (
                  <div className="pl-11">
                    <FormAlert failure={failed.failure} retry={failed.retry} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>

      {team.invites.length > 0 && (
        <Panel title="Invited" aside={<span className="text-sm text-muted-foreground">Not signed in yet</span>}>
          <ul className="flex flex-col divide-y border-t">
            {team.invites.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{item.email}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      Added {day(item.invitedAt)}
                      {item.invitedBy ? ` by ${item.invitedBy}` : ""}
                    </span>
                  </span>
                  {team.canManage && (
                    <Button variant="secondary" disabled={busy !== null} onClick={() => act(item.id, "The invitation wasn't taken back", `/team/invites/${item.id}`, "DELETE")}>
                      {busy === item.id ? "Taking back" : "Take back"}
                    </Button>
                  )}
                </div>
                {failed?.key === item.id && <FormAlert failure={failed.failure} retry={failed.retry} />}
              </li>
            ))}
          </ul>
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

/**
 * Adds someone by email. They get a sign-in link, and join as a member the first time they use it. Once they are added,
 * a thank you takes the form's place, as on every form, with the way back to it for the next person.
 */
function AddPerson({ onAdded }: { onAdded: (next: Team) => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<AddState>({ kind: "idle" });
  const fields = useFieldErrors({ email: "team-add-email" });
  const thanks = useRef<HTMLDivElement>(null);
  const again = useRef(false);

  // The thank you takes the keyboard when it replaces the form, so a screen reader reads it, and the field takes it back
  // when the form returns for the next person.
  useEffect(() => {
    if (state.kind === "added") thanks.current?.focus();
    else if (state.kind === "idle" && again.current) {
      again.current = false;
      document.getElementById("team-add-email")?.focus();
    }
  }, [state.kind]);

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

  if (state.kind === "added") {
    return (
      <Card>
        <div ref={thanks} tabIndex={-1} role="status" className="flex flex-col gap-4 outline-none">
          <CardTitle>
            Added <span className="[overflow-wrap:anywhere]">{state.email}</span>.
          </CardTitle>
          <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
            {state.sent
              ? "They have an email to sign in, and join as a member when they do. You can make them an admin once they have."
              : "The email didn't go out. They can sign in at joinhaptic.com with that address, and join as a member when they do."}
          </p>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              again.current = true;
              setState({ kind: "idle" });
            }}
          >
            Add someone else
          </Button>
        </div>
      </Card>
    );
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
            <Button type="submit" size="xl" disabled={state.kind === "adding"}>
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
              if (state.kind === "failed") setState({ kind: "idle" });
            }}
            className="h-11 bg-card px-3.5 md:text-base"
          />
        </FieldWithButton>
      </form>
      {state.kind === "failed" && <FormAlert failure={state.failure} />}
    </Card>
  );
}
