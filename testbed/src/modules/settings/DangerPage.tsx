import { addDays, format, parseISO } from "date-fns";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ME_ID, useCollection, useIndex } from "@/data/store";
import { useCan } from "@/lib/access";
import { fullName } from "@/lib/format";
import { Button, Tooltip } from "@/ui/button";
import { Callout, Card, Progress } from "@/ui/display";
import { Field, Input } from "@/ui/form";
import { act, Loader, toast } from "@/ui/flow";
import { Combobox } from "@/ui/inputs";
import { ConfirmDialog, Modal } from "@/ui/overlay";
import { downloadText, ReadOnlyNote, SaveCard, SettingsHeader, useDraft, done } from "./common";
import { useSettings } from "./store";

export function DangerPage() {
  return (
    <>
      <SettingsHeader title="Danger zone" description="Changes here affect the whole workspace and some can't be undone." />
      <ReadOnlyNote action="settings.danger" />
      <Loader loadKey="settings-danger" rows={8}>
        {() => (
          <div className="flex flex-col gap-5">
            <ScheduledDeletion />
            <WorkspaceName />
            <TransferOwnership />
            <ExportData />
            <DeleteWorkspace />
          </div>
        )}
      </Loader>
    </>
  );
}

/** The button, or the button disabled with the role reason in a tooltip. */
function Gate({ children }: { children: (ok: boolean) => ReactNode }) {
  const { allowed, reason } = useCan("settings.danger");
  if (allowed) return <>{children(true)}</>;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex">
        {children(false)}
      </span>
    </Tooltip>
  );
}

function Row({ title, body, action, tone, children }: { title: string; body: ReactNode; action: ReactNode; tone?: "danger"; children?: ReactNode }) {
  return (
    <Card className={tone === "danger" ? "border-danger/40" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex max-w-xl flex-col gap-1">
          <h2 className={tone === "danger" ? "text-[14px] font-semibold text-danger" : "text-[14px] font-semibold"}>{title}</h2>
          <div className="text-[13px] text-ink-2">{body}</div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function ScheduledDeletion() {
  const at = useSettings((s) => s.workspace.deletionScheduledAt);
  const set = useSettings((s) => s.set);
  if (!at) return null;
  return (
    <Callout
      tone="danger"
      title={`This workspace will be deleted on ${format(addDays(parseISO(at), 14), "MMMM d")}`}
      action={
        <Button size="sm" onClick={() => act(() => set("workspace", { deletionScheduledAt: null }), { success: "Deletion cancelled" })}>
          Cancel deletion
        </Button>
      }
    >
      Cards are frozen and nobody can sign in except owners. You can cancel any time before then.
    </Callout>
  );
}

function WorkspaceName() {
  const w = useSettings((s) => s.workspace);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.danger");
  const { draft, update, dirty } = useDraft({ name: w.name, slug: w.slug });
  return (
    <SaveCard
      title="Workspace name and address"
      description="Changing the address breaks old bookmarks and links in emails."
      dirty={dirty}
      action="settings.danger"
      onSave={() => set("workspace", draft)}
      success="Workspace renamed"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Workspace name">{(id) => <Input id={id} disabled={!allowed} value={draft.name} onChange={(e) => update({ name: e.target.value })} />}</Field>
        <Field label="Workspace address">
          {(id) => (
            <div className="flex items-stretch">
              <span className="flex items-center rounded-l-md border border-r-0 border-line-strong bg-sunken px-2.5 text-[13px] text-ink-3">app.northpine.example/</span>
              <Input id={id} disabled={!allowed} className="rounded-l-none" value={draft.slug} onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} />
            </div>
          )}
        </Field>
      </div>
    </SaveCard>
  );
}

function TransferOwnership() {
  const ownerId = useSettings((s) => s.workspace.ownerId);
  const set = useSettings((s) => s.set);
  const people = useCollection("employees");
  const index = useIndex("employees");
  const [to, setTo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const options = people.filter((p) => p.status === "active" && p.id !== ownerId).slice(0, 200).map((p) => ({ value: p.id, label: fullName(p), hint: p.title }));
  return (
    <Row
      title="Transfer ownership"
      body={
        <div className="flex flex-col gap-3">
          <p>
            The owner is {ownerId === ME_ID ? "you" : fullName(index.get(ownerId))}. The new owner gets billing and can delete the workspace. You stay an admin.
          </p>
          <Gate>{(ok) => <Combobox aria-label="New owner" className="w-72" disabled={!ok} value={to} onChange={setTo} options={options} placeholder="Pick a person" searchPlaceholder="Search people…" />}</Gate>
        </div>
      }
      action={
        <Gate>
          {(ok) => (
            <Button disabled={!ok || !to} onClick={() => setConfirm(true)}>
              Transfer ownership
            </Button>
          )}
        </Gate>
      }
    >
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Make ${fullName(index.get(to ?? ""))} the owner?`}
        description="Only the new owner can give it back."
        confirmText="TRANSFER"
        confirmLabel="Transfer ownership"
        danger
        onConfirm={async () => {
          const id = to;
          if (!id) return;
          await act(() => set("workspace", { ownerId: id }), { success: `${fullName(index.get(id))} is now the owner` });
          setTo(null);
        }}
      />
    </Row>
  );
}

function ExportData() {
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(timer.current), []);
  const start = async () => {
    const ok = await done(() => true, { success: "Export started. We'll email you when it's ready." });
    if (!ok) return;
    setReady(false);
    setProgress(0);
    // A long job that reports progress as it goes.
    timer.current = setInterval(() => {
      setProgress((p) => {
        const next = Math.min(100, (p ?? 0) + 4 + Math.random() * 9);
        if (next >= 100) {
          clearInterval(timer.current);
          setReady(true);
          toast.success("Your export is ready");
        }
        return next;
      });
    }, 450);
  };
  return (
    <Row
      title="Export all data"
      body={
        <div className="flex flex-col gap-2">
          <p>A zip of every transaction, receipt, bill, report and person, as CSV and PDF. Large workspaces can take a few minutes.</p>
          {progress !== null && !ready ? (
            <div className="flex max-w-sm flex-col gap-1">
              <Progress value={progress} />
              <span className="text-xs text-ink-3" aria-live="polite">
                Preparing export… {Math.round(progress)}%
              </span>
            </div>
          ) : null}
        </div>
      }
      action={
        <Gate>
          {(ok) =>
            ready ? (
              <Button variant="primary" onClick={() => downloadText("northpine-export.txt", "Northpine workspace export\n(placeholder archive)\n")}>
                <Download /> Download export
              </Button>
            ) : (
              <Button disabled={!ok || (progress !== null && progress < 100)} onClick={start}>
                {progress !== null && progress < 100 ? "Exporting…" : "Start export"}
              </Button>
            )
          }
        </Gate>
      }
    />
  );
}

function DeleteWorkspace() {
  const name = useSettings((s) => s.workspace.name);
  const scheduled = useSettings((s) => s.workspace.deletionScheduledAt);
  const set = useSettings((s) => s.set);
  const [first, setFirst] = useState(false);
  const [second, setSecond] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Row
      tone="danger"
      title="Delete workspace"
      body="Freezes every card, cancels scheduled bill payments and deletes all data after 14 days. Nobody can undo it after that."
      action={
        <Gate>
          {(ok) => (
            <Button variant="danger" disabled={!ok || !!scheduled} onClick={() => setFirst(true)}>
              <Trash2 /> Delete workspace
            </Button>
          )}
        </Gate>
      }
    >
      <>
        {/* Type the workspace name, then a second dialog opens on top of the first. */}
        <Modal
          open={first}
          onOpenChange={(v) => {
            setFirst(v);
            if (!v) setTyped("");
          }}
          title="Delete this workspace?"
          description="Every card stops working right away."
          size="sm"
          footer={
            <>
              <Button onClick={() => setFirst(false)}>Cancel</Button>
              <Button variant="danger" disabled={typed !== name} onClick={() => setSecond(true)}>
                Continue
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="delete-workspace-name" className="text-[13px] text-ink-2">
              Type <span className="font-mono font-semibold text-ink">{name}</span> to confirm.
            </label>
            <Input id="delete-workspace-name" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <Modal
            open={second}
            onOpenChange={setSecond}
            size="sm"
            title="Last check"
            footer={
              <>
                <Button onClick={() => setSecond(false)}>Go back</Button>
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await done(() => set("workspace", { deletionScheduledAt: new Date().toISOString() }), { success: "Workspace scheduled for deletion" });
                    setBusy(false);
                    if (ok) {
                      setSecond(false);
                      setFirst(false);
                      setTyped("");
                    }
                  }}
                >
                  Delete workspace forever
                </Button>
              </>
            }
          >
            <div className="flex items-start gap-3 text-[13px]">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
              <p>184 cards will be frozen and 23 scheduled bill payments cancelled. Your team will be signed out.</p>
            </div>
          </Modal>
        </Modal>
      </>
    </Row>
  );
}
