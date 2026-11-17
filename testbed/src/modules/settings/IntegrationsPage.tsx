import { AlertTriangle, Landmark, RefreshCw, Settings2 } from "lucide-react";
import { createElement, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { patch, useCollection } from "@/data/store";
import type { Integration, Plan } from "@/data/types";
import { PLAN_LABELS, useCan } from "@/lib/access";
import { ago, masked } from "@/lib/format";
import { useLab } from "@/lab/lab";
import { Button } from "@/ui/button";
import { Badge, Card, StatusBadge } from "@/ui/display";
import { Checkbox, Field, NativeSelect, RadioCards, Select } from "@/ui/form";
import { act, Loader, RoleGate } from "@/ui/flow";
import { ConfirmDialog, Modal, Sheet } from "@/ui/overlay";
import { ReadOnlyNote, SaveCard, SettingsHeader, useDraft, done } from "./common";
import { useSettings } from "./store";

const ABOUT: Record<string, { blurb: string; color: string }> = {
  int_ledgerbook: { blurb: "Export cleared card spend, bills and reimbursements to your general ledger.", color: "#2456b8" },
  int_summa: { blurb: "Two-way sync with Summa: chart of accounts in, coded transactions out.", color: "#7a3fd1" },
  int_peoplegrid: { blurb: "Add and remove people when they join or leave, with their department and manager.", color: "#c2410c" },
  int_chatter: { blurb: "Send approval requests and card alerts to channels and direct messages.", color: "#0f766e" },
  int_okey: { blurb: "Sign in with OneKey and provision people from groups.", color: "#334155" },
  int_vault: { blurb: "Copy every receipt to a Vaultbox folder, filed by month.", color: "#a16207" },
  int_firstriver: { blurb: "Your operating account. Funds cards and pays bills.", color: "#166534" },
};
const KIND: Record<Integration["kind"], string> = { erp: "Accounting", hris: "HR", chat: "Chat", sso: "Identity", bank: "Bank", storage: "Storage" };
const RANK: Record<Plan, number> = { starter: 0, growth: 1, enterprise: 2 };

export function IntegrationsPage() {
  return (
    <>
      <SettingsHeader title="Integrations" description="Connect the tools Northpine sends data to and reads from." />
      <ReadOnlyNote action="settings.security" />
      <Loader loadKey="settings-integrations" rows={10}>
        {() => (
          <div className="flex flex-col gap-5">
            <Grid />
            <Banks />
            <SyncPrefs />
          </div>
        )}
      </Loader>
    </>
  );
}

function Logo({ id, name }: { id: string; name: string }) {
  return (
    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg text-[15px] font-bold text-white" style={{ background: ABOUT[id]?.color ?? "#555" }}>
      {name[0]}
    </span>
  );
}

function Grid() {
  const all = useCollection("integrations");
  const list = all.filter((i) => i.kind !== "bank");
  const [connecting, setConnecting] = useState<Integration | null>(null);
  const [disconnecting, setDisconnecting] = useState<Integration | null>(null);
  const [configuring, setConfiguring] = useState<Integration | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((i) => (
          <IntegrationCard key={i.id} integration={i} onConnect={() => setConnecting(i)} onDisconnect={() => setDisconnecting(i)} onConfigure={() => setConfiguring(i)} />
        ))}
      </div>
      <ConnectModal integration={connecting} onClose={() => setConnecting(null)} />
      <ConfirmDialog
        open={disconnecting !== null}
        onOpenChange={(v) => !v && setDisconnecting(null)}
        title={`Disconnect ${disconnecting?.name ?? ""}?`}
        description="Syncing stops right away. Nothing already sent is deleted. You can connect it again later."
        confirmLabel="Disconnect"
        danger
        onConfirm={async () => {
          const i = disconnecting;
          if (!i) return;
          await act(() => patch("integrations", i.id, { connected: false, status: "disconnected", lastSync: null }), {
            success: `${i.name} disconnected`,
            undo: () => patch("integrations", i.id, { connected: i.connected, status: i.status, lastSync: i.lastSync }),
          });
        }}
      />
      <ConfigureSheet integration={configuring} onClose={() => setConfiguring(null)} />
    </>
  );
}

function IntegrationCard({ integration: i, onConnect, onDisconnect, onConfigure }: { integration: Integration; onConnect: () => void; onDisconnect: () => void; onConfigure: () => void }) {
  const plan = useLab((s) => s.plan);
  const locked = RANK[plan] < RANK[i.plan];
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label={i.name} className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <Logo id={i.id} name={i.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
            {i.name}
            {i.plan !== "starter" ? <Badge tone={locked ? "warn" : "neutral"}>{PLAN_LABELS[i.plan]}</Badge> : null}
          </h3>
          <span className="text-xs text-ink-3">{KIND[i.kind]}</span>
        </div>
        {i.connected ? <StatusBadge status={i.status === "ok" ? "connected" : i.status} /> : null}
      </div>
      <p className="flex-1 text-[13px] text-ink-2">{ABOUT[i.id]?.blurb}</p>
      {i.status === "error" ? (
        // An error state inside the card, with its own Reconnect button.
        <div role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Sync failed {i.lastSync ? ago(i.lastSync) : ""}. The access token expired, so new hires aren't being added.</span>
        </div>
      ) : i.connected && i.lastSync ? (
        <p className="text-xs text-ink-3">Last synced {ago(i.lastSync)}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {locked ? (
          <Button size="sm" asChild>
            <Link to="/settings/billing">Upgrade to {PLAN_LABELS[i.plan]}</Link>
          </Button>
        ) : (
          <RoleGate action="settings.security">
            {(ok) =>
              i.connected ? (
                <span className="flex flex-wrap gap-2">
                  {i.status === "error" ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!ok}
                      loading={busy}
                      onClick={async () => {
                        setBusy(true);
                        await act(() => patch("integrations", i.id, { status: "ok", lastSync: new Date().toISOString() }), { success: `${i.name} reconnected` });
                        setBusy(false);
                      }}
                    >
                      <RefreshCw /> Reconnect
                    </Button>
                  ) : null}
                  {i.kind === "erp" || i.kind === "hris" ? (
                    <Button size="sm" disabled={!ok} onClick={onConfigure}>
                      <Settings2 /> Configure
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" disabled={!ok} onClick={onDisconnect}>
                    Disconnect
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="primary" disabled={!ok} onClick={onConnect}>
                  Connect
                </Button>
              )
            }
          </RoleGate>
        )}
      </div>
    </section>
  );
}

function ConnectModal({ integration: i, onClose }: { integration: Integration | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState(true);
  if (!i) return null;
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Connect ${i.name}`}
      description={`You'll sign in to ${i.name} and allow Northpine to access it.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await done(() => patch("integrations", i.id, { connected: true, status: "ok", lastSync: new Date().toISOString() }), { success: `${i.name} connected` });
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Authorize {i.name}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]">
        <div className="flex items-center gap-3">
          <Logo id={i.id} name={i.name} />
          <span className="text-ink-3">⟷</span>
          <span className="grid size-10 place-items-center rounded-lg bg-brand text-white">N</span>
        </div>
        <p className="text-ink-2">Northpine will be able to:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-2">
          {i.kind === "chat" ? <li>Post messages to channels you pick</li> : null}
          {i.kind === "erp" ? <li>Read your chart of accounts and create journal entries</li> : null}
          {i.kind === "storage" ? <li>Create files in one folder</li> : null}
          {i.kind === "sso" ? <li>Read users and groups</li> : null}
          <li>See your {i.name} workspace name</li>
        </ul>
        <Checkbox label="Send a test message after connecting" checked={scope} onCheckedChange={setScope} />
      </div>
    </Modal>
  );
}

const NP_FIELDS = ["Card spend", "Reimbursements", "Bill payments", "Card fees", "Refunds"];
const LEDGER_ACCOUNTS = ["6100 Travel", "6200 Meals and entertainment", "6300 Software", "6400 Office supplies", "2100 Accounts payable", "2200 Corporate card liability", "4900 Other income"];

function ConfigureSheet({ integration: i, onClose }: { integration: Integration | null; onClose: () => void }) {
  const mappings = useSettings((s) => s.integrations.mappings);
  const set = useSettings((s) => s.set);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"cleared" | "approved">("cleared");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (i) setDraft(Object.fromEntries(NP_FIELDS.map((f, n) => [f, mappings[f] ?? LEDGER_ACCOUNTS[[2, 0, 4, 1, 6][n]]])));
  }, [i, mappings]);
  return (
    <Sheet
      open={i !== null}
      onOpenChange={(v) => !v && onClose()}
      width="max-w-lg"
      title={`Configure ${i?.name ?? ""}`}
      description={i?.kind === "hris" ? "Pick which PeopleGrid fields fill in each person." : "Map each kind of spend to an account in your ledger."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await done(() => set("integrations", { mappings: draft }), { success: "Field mappings saved" });
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Save mappings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">Field mappings</p>
          <div className="flex flex-col divide-y divide-line rounded-md border border-line">
            {NP_FIELDS.map((f) => (
              <div key={f} className="grid grid-cols-[1fr_auto_1.4fr] items-center gap-3 px-3 py-2">
                <span className="text-[13px]">{f}</span>
                <span className="text-ink-3">→</span>
                <NativeSelect aria-label={`Ledger account for ${f}`} value={draft[f] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}>
                  {LEDGER_ACCOUNTS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </NativeSelect>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium">Export transactions when they're</p>
          <RadioCards
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "cleared", label: "Cleared", description: "As soon as the charge settles." },
              { value: "approved", label: "Approved", description: "After a reviewer approves it." },
            ]}
          />
        </div>
      </div>
    </Sheet>
  );
}

/**
 * A "Connect bank" button inside a custom element's shadow root, the way a
 * bank-linking vendor's drop-in widget would render. On purpose.
 */
class BankConnectElement extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{display:inline-block}
      button{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:6px;border:0;cursor:pointer;
        font:500 13px Inter,system-ui,sans-serif;background:var(--np-brand,#17633a);color:var(--np-brand-ink,#fff);box-shadow:0 1px 2px rgba(0,0,0,.08)}
      button:hover{filter:brightness(1.1)}
      button[disabled]{opacity:.5;cursor:not-allowed}
      svg{width:16px;height:16px}
    </style><button type="button" part="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/></svg><span>Connect bank</span></button>`;
    root.querySelector("button")!.addEventListener("click", () => this.dispatchEvent(new CustomEvent("np-connect", { bubbles: true, composed: true })));
    this.sync();
  }
  static get observedAttributes() {
    return ["disabled"];
  }
  attributeChangedCallback() {
    this.sync();
  }
  sync() {
    const b = this.shadowRoot?.querySelector("button");
    if (b) b.disabled = this.hasAttribute("disabled");
  }
}
if (!customElements.get("np-bank-connect")) customElements.define("np-bank-connect", BankConnectElement);

const BANKS = ["Cascade Federal", "Harborline Bank", "Summit Credit Union", "Meridian Trust", "Pioneer National"];

function Banks() {
  const integrations = useCollection("integrations");
  const firstRiver = integrations.find((i) => i.id === "int_firstriver");
  const extra = useSettings((s) => s.integrations.banks);
  const set = useSettings((s) => s.set);
  const entities = useCollection("entities");
  const { allowed, reason } = useCan("settings.security");
  const host = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [bank, setBank] = useState(BANKS[0]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onConnect = () => setOpen(true);
    el.addEventListener("np-connect", onConnect);
    return () => el.removeEventListener("np-connect", onConnect);
  }, []);
  const rows = [
    ...(firstRiver ? [{ id: firstRiver.id, name: firstRiver.name, last4: entities[0]?.bankLast4 ?? "4417", status: firstRiver.status, lastSync: firstRiver.lastSync }] : []),
    ...extra.map((b) => ({ ...b, status: "ok" as const, lastSync: null })),
  ];
  return (
    <Card
      title="Bank accounts"
      description="Accounts that fund cards and pay bills."
      actions={
        <span title={allowed ? undefined : reason}>
          {createElement("np-bank-connect", { ref: host, ...(allowed ? {} : { disabled: "" }) })}
        </span>
      }
      bodyClassName="p-0"
    >
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3 text-[13px] last:border-0">
            <span className="grid size-8 place-items-center rounded-md bg-sunken text-ink-3">
              <Landmark className="size-4" />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="font-medium">{r.name}</span>
              {/* Masked account number. Privacy bait. */}
              <span className="font-mono text-xs text-ink-3">Checking {masked(r.last4)}</span>
            </span>
            <StatusBadge status={r.status === "ok" ? "connected" : r.status} />
          </li>
        ))}
      </ul>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Connect a bank account"
        description="Pick your bank. You'll sign in on the bank's own page."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const last4 = String(1000 + Math.floor(Math.random() * 9000));
                const ok = await done(() => set("integrations", { banks: [...extra, { id: `bank_${Date.now()}`, name: bank, last4 }] }), { success: `${bank} connected` });
                setBusy(false);
                if (ok) setOpen(false);
              }}
            >
              Continue to {bank}
            </Button>
          </>
        }
      >
        <RadioCards value={bank} onValueChange={setBank} columns={1} options={BANKS.map((b) => ({ value: b, label: b, icon: <Landmark /> }))} />
      </Modal>
    </Card>
  );
}

function SyncPrefs() {
  const s = useSettings((x) => x.integrations);
  const set = useSettings((x) => x.set);
  const { allowed } = useCan("settings.security");
  const { draft, update, dirty } = useDraft({ syncEvery: s.syncEvery, syncCleared: s.syncCleared });
  return (
    <SaveCard title="Sync schedule" description="How often connected apps send and receive data." dirty={dirty} action="settings.security" onSave={() => set("integrations", draft)} success="Sync schedule saved">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Field label="Sync every" className="sm:w-60">
          {(id) => (
            <Select
              id={id}
              disabled={!allowed}
              value={draft.syncEvery}
              onValueChange={(v) => update({ syncEvery: v })}
              options={[
                { value: "15m", label: "15 minutes" },
                { value: "hourly", label: "Hour" },
                { value: "daily", label: "Day, at midnight" },
              ]}
            />
          )}
        </Field>
        <Checkbox label="Skip pending charges until they clear" disabled={!allowed} checked={draft.syncCleared} onCheckedChange={(v) => update({ syncCleared: v })} className="pb-2" />
      </div>
    </SaveCard>
  );
}
