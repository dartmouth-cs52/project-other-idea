import { AlertTriangle, CheckCircle2, MoreHorizontal, PauseCircle, Plug, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useCollection, useIndex } from "@/data/store";
import { useCan } from "@/lib/access";
import { dateTime, fullName, money } from "@/lib/format";
import { Button } from "@/ui/button";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Badge, Card, DescriptionList, EmptyState, Progress } from "@/ui/display";
import { act, Loader, PlanGate, RoleGate, toast } from "@/ui/flow";
import { Field, NativeSelect } from "@/ui/form";
import { ConfirmDialog, Menu, Modal } from "@/ui/overlay";
import { AccountingHeader } from "./Header";
import { startSync, useAccounting, type FailedItem, type SyncRun } from "./store";

export function SyncPage() {
  return (
    <>
      <AccountingHeader description="Northpine exports card spend, bills and reimbursements to your ERP." />
      <Loader loadKey="sync" rows={10}>
        {() => <SyncBody />}
      </Loader>
    </>
  );
}

function SyncBody() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <LedgerbookCard />
          <FailedItems />
        </div>
        <SummaCard />
      </div>
      <History />
      <LedgerbookSettings />
    </div>
  );
}

function LedgerbookCard() {
  const job = useAccounting((s) => s.job);
  const last = useAccounting((s) => s.history[0]);
  const can = useCan("accounting.manage");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded bg-[#1d4ed8] text-[10px] font-bold text-white">LB</span> Ledgerbook ERP
        </span>
      }
      description="Connected to Northpine Inc. (LB-20931)"
      actions={
        <>
          <Badge tone="ok" dot>Connected</Badge>
          <Menu
            label="Connection options"
            trigger={
              <Button size="icon-sm" variant="ghost">
                <MoreHorizontal />
              </Button>
            }
            items={[
              { label: "Pause automatic sync", icon: <PauseCircle />, disabled: !can.allowed, onSelect: () => toast.success("Automatic sync paused") },
              { separator: true, label: "" },
              { label: "Disconnect Ledgerbook", icon: <Unplug />, danger: true, disabled: !can.allowed, onSelect: () => setDisconnectOpen(true) },
            ]}
          />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <DescriptionList
          columns={3}
          items={[
            { label: "Last sync", value: last ? dateTime(last.startedAt) : "Never" },
            { label: "Next automatic sync", value: "Tonight at 11:00 PM" },
            { label: "Exports", value: "Card spend, bills, reimbursements" },
          ]}
        />
        {/* A job that takes about 8 seconds. The page keeps changing until it ends. */}
        <div aria-live="polite" className="flex flex-col gap-2 rounded-md border border-line bg-sunken/50 p-3">
          {job.running ? (
            <>
              <span className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2">
                  <RefreshCw className="size-3.5 animate-spin text-brand" /> {job.stage}…
                </span>
                <span className="tabular text-ink-3">{Math.round(job.progress)}%</span>
              </span>
              <Progress value={job.progress} />
            </>
          ) : (
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] text-ink-2">Send everything since the last sync to Ledgerbook now.</span>
              <RoleGate action="accounting.manage">
                {(allowed) => (
                  <Button variant="primary" disabled={!allowed} onClick={startSync}>
                    <RefreshCw /> Sync now
                  </Button>
                )}
              </RoleGate>
            </span>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect Ledgerbook?"
        description="Exports stop until you reconnect. Your mappings are kept."
        confirmLabel="Disconnect"
        danger
        onConfirm={() => {
          toast.error("Ledgerbook can only be disconnected by the workspace owner.");
        }}
      />
    </Card>
  );
}

function FailedItems() {
  const failed = useAccounting((s) => s.failed);
  const remove = useAccounting((s) => s.removeFailed);
  const classMap = useAccounting((s) => s.classMap);
  const can = useCan("accounting.manage");
  const [busy, setBusy] = useState<string | null>(null);

  const retry = async (item: FailedItem) => {
    setBusy(item.id);
    if (item.needsClassFor && !classMap[item.needsClassFor]) {
      await new Promise((r) => setTimeout(r, 600));
      toast.error("Still failing. Map the Data department to a class in Mappings first.");
    } else {
      await act(() => remove(item.id), { success: `${item.label} exported` });
    }
    setBusy(null);
  };

  return (
    <Card
      title="Failed items"
      description={failed.length ? "These didn't reach Ledgerbook in the last sync." : "Nothing failed in the last sync."}
      actions={
        failed.length ? (
          <Button size="sm" disabled={!can.allowed || !!busy} onClick={async () => { for (const f of failed) await retry(f); }}>
            Retry all
          </Button>
        ) : null
      }
      bodyClassName="p-0"
    >
      {failed.length === 0 ? (
        <EmptyState icon={<CheckCircle2 />} title="All caught up" description="Every record from the last sync is in Ledgerbook." />
      ) : (
        <ul>
          {failed.map((f) => (
            <li key={f.id} data-item={f.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <AlertTriangle className="size-4 shrink-0 text-warn" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium">
                  {f.label} <span className="font-normal text-ink-3">· {f.kind} · {money(f.amount)}</span>
                </span>
                <span className="text-xs text-ink-2">{f.error}</span>
              </span>
              {f.needsClassFor ? (
                <Button size="sm" variant="link" asChild>
                  <Link to="/accounting/mappings">Fix mapping</Link>
                </Button>
              ) : null}
              {/* Every row's button is just "Retry", on purpose. */}
              <Button size="sm" disabled={!can.allowed} loading={busy === f.id} onClick={() => retry(f)}>
                Retry
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SummaCard() {
  const summa = useAccounting((s) => s.summaEntity);
  const connect = useAccounting((s) => s.connectSumma);
  const entities = useCollection("entities");
  const can = useCan("accounting.manage");
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState("ent_uk");
  return (
    <Card title="Other accounting systems" description="Sync a second entity to a different ERP.">
      <PlanGate feature="erpSync" title="Summa Accounting">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <span className="grid size-6 place-items-center rounded bg-[#7c3aed] text-[10px] font-bold text-white">S</span> Summa Accounting
            {summa ? <Badge tone="ok" dot>Connected</Badge> : null}
          </span>
          <p className="text-[12.5px] text-ink-3">{summa ? `Syncing ${entities.find((e) => e.id === summa)?.name}.` : "Popular with UK and EU teams. Exports in GBP and EUR."}</p>
          {summa ? (
            <Button size="sm" onClick={() => act(() => connect(null), { success: "Summa Accounting disconnected" })}>
              <Unplug /> Disconnect Summa
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={!can.allowed} onClick={() => setOpen(true)}>
              <Plug /> Connect Summa Accounting
            </Button>
          )}
        </div>
      </PlanGate>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Connect Summa Accounting"
        description="Each entity syncs to one ERP. Northpine Inc. stays on Ledgerbook."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                await act(() => connect(entity), { success: "Summa Accounting connected" });
                setOpen(false);
              }}
            >
              Connect
            </Button>
          </>
        }
      >
        <Field label="Entity to sync">
          {(id) => (
            <NativeSelect id={id} value={entity} onChange={(e) => setEntity(e.target.value)}>
              {entities.filter((e) => e.id !== "ent_us").map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </Modal>
    </Card>
  );
}

function History() {
  const history = useAccounting((s) => s.history);
  const people = useIndex("employees");
  const columns: ColumnDef<SyncRun, unknown>[] = [
    { id: "started", header: "Started", accessorKey: "startedAt", cell: ({ row }) => dateTime(row.original.startedAt) },
    { id: "trigger", header: "Trigger", accessorKey: "trigger", size: 110 },
    { id: "by", header: "By", accessorFn: (r) => (r.by ? fullName(people.get(r.by)) : "Ledgerbook schedule") },
    { id: "records", header: "Records", accessorKey: "records", size: 100, cell: ({ row }) => <span className="tabular">{row.original.records}</span> },
    { id: "failed", header: "Failed", accessorKey: "failed", size: 90, cell: ({ row }) => <span className={row.original.failed ? "tabular text-danger" : "tabular text-ink-3"}>{row.original.failed}</span> },
    { id: "duration", header: "Duration", accessorKey: "durationSec", size: 100, cell: ({ row }) => `${row.original.durationSec}s` },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      size: 130,
      cell: ({ row }) => <Badge tone={row.original.status === "success" ? "ok" : row.original.status === "partial" ? "warn" : "danger"} dot>{row.original.status === "success" ? "Succeeded" : row.original.status === "partial" ? "Partial" : "Failed"}</Badge>,
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[14px] font-semibold">Sync history</h2>
      <DataTable label="Sync history" data={history} columns={columns} getRowId={(r) => r.id} height={360} initialSort={[{ id: "started", desc: true }]} />
    </div>
  );
}

/**
 * Ledgerbook's own settings form, loaded the way an ERP's embed would be: a
 * sandboxed iframe without allow-same-origin, so it's cross-origin to this page
 * and a guide can't see inside it. On purpose.
 */
function LedgerbookSettings() {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: string })?.type === "ledgerbook:saved") toast.success("Ledgerbook saved your connection settings");
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);
  return (
    <Card title="Ledgerbook connection settings" description="These settings live in Ledgerbook and load from their site." bodyClassName="p-0">
      <iframe ref={frame} title="Ledgerbook connection settings" sandbox="allow-scripts allow-forms" srcDoc={LEDGERBOOK_HTML} className="block h-[400px] w-full rounded-b-lg border-0 bg-white" />
    </Card>
  );
}

const LEDGERBOOK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#fff}
.top{display:flex;align-items:center;gap:8px;padding:12px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
.logo{width:22px;height:22px;border-radius:4px;background:#1d4ed8;color:#fff;font-weight:700;font-size:10px;display:grid;place-items:center}
form{padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:14px 20px;max-width:760px}
label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:12px;color:#334155}
input[type=text],select{font:inherit;font-weight:400;height:32px;border:1px solid #cbd5e1;border-radius:4px;padding:0 8px;color:#0f172a;background:#fff}
.full{grid-column:1/-1}.check{flex-direction:row;align-items:center;font-weight:400;font-size:13px;gap:8px}
fieldset{border:0;padding:0;margin:0;display:flex;gap:16px}legend{font-weight:600;font-size:12px;color:#334155;margin-bottom:4px}
fieldset label{flex-direction:row;font-weight:400;font-size:13px;align-items:center;gap:6px}
.actions{grid-column:1/-1;display:flex;align-items:center;gap:12px}
button{font:inherit;font-weight:600;height:32px;padding:0 14px;border-radius:4px;border:0;background:#1d4ed8;color:#fff;cursor:pointer}
.msg{color:#15803d;font-size:12px}
</style></head><body>
<div class="top"><span class="logo">LB</span><strong>Ledgerbook</strong><span style="color:#64748b">· Northpine integration</span></div>
<form id="f">
<label>Company ID<input type="text" name="company" value="LB-20931"></label>
<label>Sync frequency<select name="freq"><option>Every hour</option><option selected>Every 6 hours</option><option>Daily at 11 PM</option><option>Manual only</option></select></label>
<label>Clearing account<select name="clearing"><option selected>2100 Card clearing</option><option>2010 Accounts payable</option><option>2200 Accrued expenses</option></select></label>
<label>Default class<select name="cls"><option>None</option><option selected>General and administrative</option><option>Research and development</option></select></label>
<fieldset class="full"><legend>Post bills as</legend><label><input type="radio" name="post" checked> Bills</label><label><input type="radio" name="post"> Journal entries</label></fieldset>
<label class="check full"><input type="checkbox" name="receipts" checked> Attach receipts to exported transactions</label>
<label class="check full"><input type="checkbox" name="memo"> Use the Northpine memo as the line description</label>
<div class="actions"><button type="submit">Save settings</button><span class="msg" id="m"></span></div>
</form>
<script>
document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();document.getElementById('m').textContent='Saved';parent.postMessage({type:'ledgerbook:saved'},'*');setTimeout(function(){document.getElementById('m').textContent=''},2500)});
</script>
</body></html>`;
