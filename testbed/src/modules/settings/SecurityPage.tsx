import { Laptop, Plus, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { useCollection } from "@/data/store";
import { useCan } from "@/lib/access";
import { ago } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Badge, Card, Callout } from "@/ui/display";
import { Checkbox, Field, Input, Select, Switch } from "@/ui/form";
import { act, Loader, PlanGate, RoleGate } from "@/ui/flow";
import { ConfirmDialog } from "@/ui/overlay";
import { FieldGrid, ReadOnlyNote, SaveCard, SettingsHeader, useDraft } from "./common";
import { useSettings, type ActiveSession } from "./store";

export function SecurityPage() {
  return (
    <>
      <SettingsHeader title="Security" description="How people sign in to Northpine and how long they stay signed in." />
      <ReadOnlyNote action="settings.security" />
      <Loader loadKey="settings-security" rows={12}>
        {() => (
          <div className="flex flex-col gap-5">
            <RequireTwoFactor />
            <Sso />
            <div className="grid gap-5 lg:grid-cols-2">
              <SessionTimeout />
              <PasswordPolicy />
            </div>
            <IpRanges />
            <Sessions />
          </div>
        )}
      </Loader>
    </>
  );
}

function RequireTwoFactor() {
  const on = useSettings((s) => s.security.require2fa);
  const set = useSettings((s) => s.set);
  const people = useCollection("employees");
  const { allowed, reason } = useCan("settings.security");
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const without = people.filter((p) => p.status === "active" && !p.twoFactor).length;
  return (
    <Card title="Two-factor authentication" description="Everyone signs in with a password and a code from their phone.">
      <div className="flex flex-col gap-4">
        {/* The switch asks for confirmation before it changes. */}
        <RoleGate action="settings.security">
          {(ok) => (
            <div className="w-full">
              <Switch
                label="Require two-factor for everyone"
                description={allowed ? "People without it are asked to set it up the next time they sign in." : reason}
                checked={on}
                disabled={!ok}
                onCheckedChange={(v) => setConfirm(v)}
              />
            </div>
          )}
        </RoleGate>
        {!on && without > 0 ? (
          <Callout tone="warn">
            {without} active {without === 1 ? "person hasn't" : "people haven't"} set up two-factor.
          </Callout>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm ? "Require two-factor for everyone?" : "Stop requiring two-factor?"}
        description={confirm ? `${without} people will have to set it up the next time they sign in. Anyone signed in now stays signed in.` : "People can turn it off for their own account. We recommend keeping it on."}
        confirmLabel={confirm ? "Require two-factor" : "Stop requiring"}
        danger={confirm === false}
        onConfirm={async () => {
          const v = !!confirm;
          await act(() => set("security", { require2fa: v }), { success: v ? "Two-factor is now required" : "Two-factor is optional" });
        }}
      />
    </Card>
  );
}

function Sso() {
  const s = useSettings((x) => x.security);
  const set = useSettings((x) => x.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ ssoEnabled: s.ssoEnabled, ssoEnforced: s.ssoEnforced, ssoMetadataUrl: s.ssoMetadataUrl });
  const [error, setError] = useState<string | null>(null);
  return (
    <PlanGate feature="sso" title="Single sign-on">
      <SaveCard
        title="Single sign-on"
        description="Let people sign in with OneKey SSO instead of a Northpine password."
        dirty={dirty}
        action="settings.security"
        actions={<Badge tone="info">Enterprise</Badge>}
        onSave={() => {
          if (draft.ssoEnabled && !/^https:\/\//.test(draft.ssoMetadataUrl)) {
            setError("Paste the metadata URL from OneKey. It starts with https://");
            throw new Error("Check the metadata URL.");
          }
          setError(null);
          set("security", draft);
        }}
        success="SSO settings saved"
      >
        <div className="flex flex-col gap-4">
          <Switch label="Sign in with OneKey SSO" disabled={!allowed} checked={draft.ssoEnabled} onCheckedChange={(v) => update({ ssoEnabled: v })} />
          {/* These fields appear only once SSO is switched on. */}
          {draft.ssoEnabled ? (
            <div className="flex flex-col gap-4 rounded-md border border-line bg-sunken/50 p-4">
              <Field label="Metadata URL" error={error} hint="In OneKey, open Apps, then Northpine, then Sign-on.">
                {(id) => <Input id={id} disabled={!allowed} placeholder="https://northpine.onekey.example/saml/metadata" value={draft.ssoMetadataUrl} aria-invalid={!!error} onChange={(e) => update({ ssoMetadataUrl: e.target.value })} />}
              </Field>
              <FieldGrid>
                <Field label="Entity ID">{(id) => <Input id={id} readOnly value="https://app.northpine.example/saml/northpine" className="bg-sunken font-mono text-[12px]" />}</Field>
                <Field label="Reply URL">{(id) => <Input id={id} readOnly value="https://app.northpine.example/saml/acs" className="bg-sunken font-mono text-[12px]" />}</Field>
              </FieldGrid>
              <Checkbox label="Require SSO for everyone except admins" disabled={!allowed} checked={draft.ssoEnforced} onCheckedChange={(v) => update({ ssoEnforced: v })} />
            </div>
          ) : null}
        </div>
      </SaveCard>
    </PlanGate>
  );
}

function SessionTimeout() {
  const s = useSettings((x) => x.security);
  const set = useSettings((x) => x.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ sessionTimeout: s.sessionTimeout });
  return (
    <SaveCard title="Session length" description="Sign people out after this long without activity." dirty={dirty} action="settings.security" onSave={() => set("security", draft)} success="Session length saved">
      <Field label="Sign out after">
        {(id) => (
          <Select
            id={id}
            disabled={!allowed}
            value={draft.sessionTimeout}
            onValueChange={(v) => update({ sessionTimeout: v })}
            options={[
              { value: "30m", label: "30 minutes" },
              { value: "1h", label: "1 hour" },
              { value: "4h", label: "4 hours" },
              { value: "12h", label: "12 hours" },
              { value: "24h", label: "24 hours" },
              { value: "7d", label: "7 days" },
            ]}
          />
        )}
      </Field>
    </SaveCard>
  );
}

function PasswordPolicy() {
  const s = useSettings((x) => x.security);
  const set = useSettings((x) => x.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ minLength: s.minLength, requireSymbols: s.requireSymbols, rotateDays: s.rotateDays });
  return (
    <SaveCard title="Password policy" description="Applies the next time someone changes their password." dirty={dirty} action="settings.security" onSave={() => set("security", draft)} success="Password policy saved">
      <div className="flex flex-col gap-4">
        <FieldGrid>
          <Field label="Minimum length">
            {(id) => (
              <Select id={id} disabled={!allowed} value={draft.minLength} onValueChange={(v) => update({ minLength: v })} options={["8", "10", "12", "14", "16"].map((n) => ({ value: n, label: `${n} characters` }))} />
            )}
          </Field>
          <Field label="Ask for a new password">
            {(id) => (
              <Select
                id={id}
                disabled={!allowed}
                value={draft.rotateDays}
                onValueChange={(v) => update({ rotateDays: v })}
                options={[
                  { value: "never", label: "Never" },
                  { value: "90", label: "Every 90 days" },
                  { value: "180", label: "Every 180 days" },
                  { value: "365", label: "Every year" },
                ]}
              />
            )}
          </Field>
        </FieldGrid>
        <Checkbox label="Require at least one symbol" disabled={!allowed} checked={draft.requireSymbols} onCheckedChange={(v) => update({ requireSymbols: v })} />
      </div>
    </SaveCard>
  );
}

const CIDR = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(3[0-2]|[12]?\d)$/;

function IpRanges() {
  const s = useSettings((x) => x.security);
  const set = useSettings((x) => x.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ ipRanges: s.ipRanges });
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const v = adding.trim();
    if (!CIDR.test(v)) return setError("Use CIDR notation, like 203.0.113.0/24.");
    if (draft.ipRanges.includes(v)) return setError("That range is already on the list.");
    setError(null);
    update({ ipRanges: [...draft.ipRanges, v] });
    setAdding("");
  };
  return (
    <SaveCard
      title="Allowed IP ranges"
      description="Only allow sign-ins from these networks. Leave the list empty to allow any network."
      dirty={dirty}
      action="settings.security"
      onSave={() => set("security", draft)}
      success="IP ranges saved"
      footerNote={dirty ? "Unsaved changes. Make sure your own network is on the list." : `${draft.ipRanges.length} ranges`}
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {draft.ipRanges.length === 0 ? <li className="px-3 py-3 text-[13px] text-ink-3">Any network can sign in.</li> : null}
          {draft.ipRanges.map((r) => (
            <li key={r} className="flex items-center justify-between px-3 py-2 text-[13px]">
              <span className="font-mono">{r}</span>
              {r === "73.214.18.0/24" ? <span className="ml-3 flex-1 text-xs text-ink-3">Your current network</span> : <span className="flex-1" />}
              <IconButton size="icon-sm" icon={<Trash2 />} label={`Remove ${r}`} disabled={!allowed} onClick={() => update({ ipRanges: draft.ipRanges.filter((x) => x !== r) })} />
            </li>
          ))}
        </ul>
        <div className="flex items-start gap-2">
          <Field label="Add a range" error={error} className="flex-1">
            {(id) => (
              <Input
                id={id}
                disabled={!allowed}
                placeholder="203.0.113.0/24"
                value={adding}
                aria-invalid={!!error}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
              />
            )}
          </Field>
          <Button className="mt-[22px]" disabled={!allowed} onClick={add}>
            <Plus /> Add range
          </Button>
        </div>
      </div>
    </SaveCard>
  );
}

function Sessions() {
  const sessions = useSettings((x) => x.security.sessions);
  const set = useSettings((x) => x.set);
  const [signOutAll, setSignOutAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const others = sessions.filter((s) => !s.current);
  const signOut = async (s: ActiveSession) => {
    setBusy(s.id);
    await act(() => set("security", { sessions: useSettings.getState().security.sessions.filter((x) => x.id !== s.id) }), { success: `Signed out of ${s.device}` });
    setBusy(null);
  };
  return (
    <Card
      title="Where you're signed in"
      description="Your own sessions. Sign out of any device you don't recognize."
      bodyClassName="p-0"
      actions={
        <Button size="sm" disabled={others.length === 0} onClick={() => setSignOutAll(true)}>
          Sign out all other sessions
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-[13px]">
          <thead className="bg-sunken text-left text-[12px] text-ink-3">
            <tr>
              <th className="px-4 py-2 font-medium">Device</th>
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 font-medium">IP address</th>
              <th className="px-4 py-2 font-medium">Last active</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    {s.kind === "phone" ? <Smartphone className="size-4 text-ink-3" /> : <Laptop className="size-4 text-ink-3" />}
                    <span className="flex flex-col">
                      <span className="font-medium">{s.device}</span>
                      <span className="text-xs text-ink-3">{s.browser}</span>
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-2">{s.location}</td>
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-2">{s.ip}</td>
                <td className="px-4 py-2.5 text-ink-2">{s.current ? <Badge tone="ok" dot>This device</Badge> : ago(s.lastActive)}</td>
                <td className="px-4 py-2.5 text-right">
                  {/* "Sign out" again, the same words as the account menu's item. */}
                  {s.current ? null : (
                    <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => signOut(s)}>
                      Sign out
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={signOutAll}
        onOpenChange={setSignOutAll}
        title="Sign out everywhere else?"
        description={`This signs you out of ${others.length} other ${others.length === 1 ? "device" : "devices"}. You stay signed in here.`}
        confirmLabel="Sign out other sessions"
        onConfirm={async () => {
          await act(() => set("security", { sessions: sessions.filter((s) => s.current) }), { success: "Signed out of other sessions" });
        }}
      />
    </Card>
  );
}
