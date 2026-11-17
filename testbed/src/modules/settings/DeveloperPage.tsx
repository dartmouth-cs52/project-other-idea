import { Copy, Eye, EyeOff, MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { ME_ID, newId, patch, remove, upsert, useCollection, useIndex } from "@/data/store";
import type { ApiKey, Webhook } from "@/data/types";
import { useCan, useFeature } from "@/lib/access";
import { ago, date, fullName } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Badge, Card, EmptyState, StatusBadge } from "@/ui/display";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Checkbox, Field, Input, NativeSelect, Switch } from "@/ui/form";
import { act, Loader, PlanGate, RoleGate, toast } from "@/ui/flow";
import { ConfirmDialog, Menu, Modal } from "@/ui/overlay";
import { FieldGrid, randomToken, ReadOnlyNote, SaveCard, SettingsHeader, useDraft, done } from "./common";
import { useSettings } from "./store";

const SCOPES = [
  { value: "transactions:read", label: "Read transactions" },
  { value: "transactions:write", label: "Update transactions" },
  { value: "cards:read", label: "Read cards" },
  { value: "cards:write", label: "Issue and freeze cards" },
  { value: "bills:read", label: "Read bills" },
  { value: "bills:write", label: "Create and pay bills" },
  { value: "people:read", label: "Read people" },
  { value: "reports:read", label: "Read reports" },
];
const EVENTS = ["transaction.created", "transaction.updated", "card.issued", "card.frozen", "bill.created", "bill.paid", "reimbursement.paid", "approval.decided"];

export function DeveloperPage() {
  const plan = useFeature("apiAccess");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SettingsHeader
        title="Developers"
        description="API keys and webhooks for building on Northpine. Read the API reference at docs.northpine.example."
        actions={
          // Hidden while the plan does not include it; the upgrade prompt takes its place.
          !plan.enabled ? null : <RoleGate action="settings.developer">
            {(ok) => (
              <Button variant="primary" disabled={!ok} onClick={() => setCreating(true)}>
                <Plus /> Create API key
              </Button>
            )}
          </RoleGate>
        }
      />
      <ReadOnlyNote action="settings.developer" />
      <PlanGate feature="apiAccess" title="API access">
        <Loader loadKey="settings-developer" rows={10}>
          {() => (
            <div className="flex flex-col gap-5">
              <ApiKeys onCreate={() => setCreating(true)} />
              <Webhooks />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <SigningSecret />
                <UsageAlerts />
              </div>
            </div>
          )}
        </Loader>
        <CreateKeyModal open={creating} onOpenChange={setCreating} />
      </PlanGate>
    </>
  );
}

function ApiKeys({ onCreate }: { onCreate: () => void }) {
  const keys = useCollection("apiKeys");
  const people = useIndex("employees");
  const { allowed } = useCan("settings.developer");
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const columns: ColumnDef<ApiKey, unknown>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="font-mono text-xs text-ink-3">{row.original.prefix}••••••••</span>
        </span>
      ),
    },
    { id: "scopes", header: "Scopes", enableSorting: false, cell: ({ row }) => <span className="text-ink-2">{row.original.scopes.join(", ")}</span> },
    { id: "created", header: "Created", accessorKey: "createdAt", cell: ({ row }) => <span className="text-ink-2">{date(row.original.createdAt)} · {fullName(people.get(row.original.createdBy))}</span> },
    { id: "lastUsed", header: "Last used", accessorKey: "lastUsed", size: 130, cell: ({ row }) => <span className="text-ink-2">{row.original.lastUsed ? ago(row.original.lastUsed) : "Never"}</span> },
    { id: "status", header: "Status", size: 110, cell: ({ row }) => (row.original.revoked ? <Badge tone="neutral">Revoked</Badge> : <StatusBadge status="active" />) },
  ];
  return (
    <>
      <DataTable
        label="API keys"
        data={keys}
        columns={columns}
        getRowId={(k) => k.id}
        rowHeight={52}
        toolbar={<span className="text-[13px] font-semibold">API keys</span>}
        empty={<EmptyState title="No API keys yet" description="Create a key to call the Northpine API from your own code." action={<Button onClick={onCreate}>Create API key</Button>} />}
        // Revoke only shows on hover, at the row's right edge.
        rowActions={(k) =>
          k.revoked ? null : (
            <Button size="sm" variant="ghost" className="text-danger" disabled={!allowed} onClick={() => setRevoking(k)}>
              Revoke
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(v) => !v && setRevoking(null)}
        title={`Revoke "${revoking?.name ?? ""}"?`}
        description="Anything using this key stops working right away. You can't undo this."
        confirmLabel="Revoke key"
        danger
        onConfirm={async () => {
          const k = revoking;
          if (k) await act(() => patch("apiKeys", k.id, { revoked: true }), { success: `${k.name} revoked` });
        }}
      />
    </>
  );
}

function CreateKeyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["transactions:read"]);
  const [expiry, setExpiry] = useState("never");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const close = () => {
    onOpenChange(false);
    setTimeout(() => {
      setName("");
      setScopes(["transactions:read"]);
      setExpiry("never");
      setErrors({});
      setSecret(null);
    }, 200);
  };
  if (secret)
    return (
      // The secret is shown once. The dialog can't be dismissed by accident.
      <Modal
        open={open}
        onOpenChange={() => undefined}
        dismissable={false}
        title="Copy your API key"
        description="This is the only time you'll see the full key. Store it in your secrets manager."
        footer={
          <Button variant="primary" onClick={close}>
            I've copied it
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-md border border-line bg-sunken p-2 pl-3">
            <code className="flex-1 font-mono text-[12.5px] break-all">{secret}</code>
            {/* Icon-only copy button. */}
            <IconButton
              icon={<Copy />}
              label="Copy key"
              onClick={() => {
                navigator.clipboard?.writeText(secret).catch(() => undefined);
                toast.success("Key copied");
              }}
            />
          </div>
          <p className="text-xs text-ink-3">If you lose it, revoke this key and make a new one.</p>
        </div>
      </Modal>
    );
  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && close()}
      title="Create API key"
      description="Give it a name you'll recognize and only the scopes it needs."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              const e: Record<string, string> = {};
              if (!name.trim()) e.name = "Give the key a name.";
              if (scopes.length === 0) e.scopes = "Pick at least one scope.";
              setErrors(e);
              if (Object.keys(e).length) return;
              setBusy(true);
              const prefix = `np_live_${randomToken(4)}`;
              const full = `${prefix}${randomToken(28)}`;
              const ok = await done(
                () => upsert("apiKeys", { id: newId("key"), name: name.trim(), prefix, createdAt: new Date().toISOString(), lastUsed: null, scopes, createdBy: ME_ID, revoked: false }),
                { success: "API key created" },
              );
              setBusy(false);
              if (ok) setSecret(full);
            }}
          >
            Create key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FieldGrid>
          <Field label="Key name" error={errors.name}>
            {(id) => <Input id={id} placeholder="Warehouse export" value={name} aria-invalid={!!errors.name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Expires">
            {(id) => (
              <NativeSelect id={id} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                <option value="never">Never</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In a year</option>
              </NativeSelect>
            )}
          </Field>
        </FieldGrid>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium">Scopes</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SCOPES.map((s) => (
              <Checkbox key={s.value} label={s.label} checked={scopes.includes(s.value)} onCheckedChange={(v) => setScopes((x) => (v ? [...x, s.value] : x.filter((y) => y !== s.value)))} />
            ))}
          </div>
          {errors.scopes ? <p className="text-xs text-danger">{errors.scopes}</p> : null}
        </fieldset>
      </div>
    </Modal>
  );
}

function Webhooks() {
  const hooks = useCollection("webhooks");
  const { allowed } = useCan("settings.developer");
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  return (
    <Card
      title="Webhooks"
      description="We POST a JSON event to each endpoint and retry for 24 hours if it fails."
      bodyClassName="p-0"
      actions={
        <Button size="sm" disabled={!allowed} onClick={() => setEditing("new")}>
          <Plus /> Add endpoint
        </Button>
      }
    >
      {hooks.length === 0 ? (
        <EmptyState title="No endpoints" description="Add one to hear about new charges and paid bills as they happen." />
      ) : (
        <ul>
          {hooks.map((h) => (
            <li key={h.id} className="flex items-center gap-4 border-b border-line px-4 py-3 text-[13px] last:border-0">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-[12.5px]">{h.url}</span>
                <span className="truncate text-xs text-ink-3">{h.events.join(", ")}</span>
              </span>
              {h.failures > 0 ? <Badge tone="danger">{h.failures} failed deliveries</Badge> : null}
              {h.enabled ? <StatusBadge status="enabled" /> : <Badge>Disabled</Badge>}
              {/* Icon-only menu with no accessible name, on purpose. */}
              <Menu
                trigger={
                  <IconButton icon={<MoreHorizontal />} label="Endpoint actions" named={false} disabled={!allowed} />
                }
                items={[
                  { label: "Edit", onSelect: () => setEditing(h) },
                  { label: "Send test event", onSelect: () => act(() => true, { success: `Test event sent to ${new URL(h.url).host}` }) },
                  { label: h.enabled ? "Disable" : "Enable", onSelect: () => act(() => patch("webhooks", h.id, { enabled: !h.enabled }), { success: h.enabled ? "Endpoint disabled" : "Endpoint enabled" }) },
                  { separator: true, label: "" },
                  { label: "Delete", danger: true, onSelect: () => setDeleting(h) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      <WebhookModal value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this endpoint?"
        description={deleting?.url}
        confirmLabel="Delete endpoint"
        danger
        onConfirm={async () => {
          const h = deleting;
          if (h) await act(() => remove("webhooks", h.id), { success: "Endpoint deleted", undo: () => upsert("webhooks", h) });
        }}
      />
    </Card>
  );
}

function WebhookModal({ value, onClose }: { value: Webhook | "new" | null; onClose: () => void }) {
  const editing = value && value !== "new" ? value : null;
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<unknown>(null);
  if (value !== seeded) {
    setSeeded(value);
    setUrl(editing?.url ?? "");
    setEvents(editing?.events ?? ["transaction.created"]);
    setEnabled(editing?.enabled ?? true);
    setError(null);
  }
  return (
    <Modal
      open={value !== null}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? "Edit endpoint" : "Add endpoint"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!/^https:\/\/[^\s]+\.[^\s]+/.test(url)) return setError("Use an https:// URL.");
              if (events.length === 0) return setError("Pick at least one event.");
              setError(null);
              setBusy(true);
              const row: Webhook = editing
                ? { ...editing, url, events, enabled }
                : { id: newId("wh"), url, events, enabled, secretPrefix: `whsec_${randomToken(4)}`, createdAt: new Date().toISOString(), failures: 0 };
              const ok = await done(() => upsert("webhooks", row), { success: editing ? "Endpoint saved" : "Endpoint added" });
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Endpoint URL" error={error}>
          {(id) => <Input id={id} placeholder="https://example.com/northpine" value={url} aria-invalid={!!error} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Events</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EVENTS.map((ev) => (
              <Checkbox key={ev} label={<span className="font-mono text-[12.5px]">{ev}</span>} checked={events.includes(ev)} onCheckedChange={(v) => setEvents((x) => (v ? [...x, ev] : x.filter((y) => y !== ev)))} />
            ))}
          </div>
        </fieldset>
        <Switch label="Send events to this endpoint" checked={enabled} onCheckedChange={setEnabled} />
      </div>
    </Modal>
  );
}

function SigningSecret() {
  const [shown, setShown] = useState(false);
  const [secret, setSecret] = useState(() => `whsec_4kd9${randomToken(24)}`);
  const [rolling, setRolling] = useState(false);
  const { allowed, reason } = useCan("settings.developer");
  return (
    <Card title="Signing secret" description="Check the Northpine-Signature header with this to know an event came from us.">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-line bg-sunken p-2 pl-3">
          {/* Masked until Reveal is pressed. */}
          <code className="flex-1 font-mono text-[12.5px] break-all">{shown ? secret : `${secret.slice(0, 10)}${"•".repeat(20)}`}</code>
          <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => setShown((s) => !s)}>
            {shown ? <EyeOff /> : <Eye />} {shown ? "Hide" : "Reveal"}
          </Button>
        </div>
        <div>
          <Button size="sm" disabled={!allowed} title={allowed ? undefined : reason} onClick={() => setRolling(true)}>
            <RefreshCw /> Roll secret
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={rolling}
        onOpenChange={setRolling}
        title="Roll the signing secret?"
        description="The old secret keeps working for 24 hours so you can update your code."
        confirmLabel="Roll secret"
        onConfirm={async () => {
          await act(() => setSecret(`whsec_${randomToken(28)}`), { success: "New signing secret created" });
          setShown(false);
        }}
      />
    </Card>
  );
}

function UsageAlerts() {
  const d = useSettings((s) => s.developer);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.developer");
  const { draft, update, dirty } = useDraft({ alertEmail: d.alertEmail, alertAt: d.alertAt });
  return (
    <SaveCard title="Rate limit alerts" description="Email someone before a key hits its limit of 100 requests a second." dirty={dirty} action="settings.developer" onSave={() => set("developer", draft)} success="Alert settings saved">
      <FieldGrid>
        <Field label="Alert email">{(id) => <Input id={id} type="email" disabled={!allowed} value={draft.alertEmail} onChange={(e) => update({ alertEmail: e.target.value })} />}</Field>
        <Field label="When usage reaches">
          {(id) => (
            <NativeSelect id={id} disabled={!allowed} value={draft.alertAt} onChange={(e) => update({ alertAt: e.target.value })}>
              <option value="50">50% of the limit</option>
              <option value="80">80% of the limit</option>
              <option value="95">95% of the limit</option>
            </NativeSelect>
          )}
        </Field>
      </FieldGrid>
    </SaveCard>
  );
}
