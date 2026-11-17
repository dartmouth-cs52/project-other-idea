import { History, Send } from "lucide-react";
import { useState } from "react";
import { useIndex } from "@/data/store";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { ago, date, fullName } from "@/lib/format";
import { Button } from "@/ui/button";
import { Badge, Callout, Card, PageHeader } from "@/ui/display";
import { act, Loader, RoleGate, UnsavedGuard } from "@/ui/flow";
import { Field, Input, Switch } from "@/ui/form";
import { Modal } from "@/ui/overlay";
import { RichText } from "@/ui/rich-text";
import { PolicyTabs } from "./PoliciesPage";
import { useHandbook, type HandbookVersion } from "./shared";

// The written expense policy. Finance edits it in a rich text editor and
// publishes versions. Everyone else reads the latest one.

const prose =
  "text-[13.5px] leading-relaxed text-ink-2 [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-ink [&_h2:first-child]:mt-0 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-ink";

export function HandbookPage() {
  const can = useCan("policies.edit");
  return (
    <>
      <PageHeader title="Policies" description="What Northpine allows, what needs a receipt, and who approves what." tabs={<PolicyTabs active="/policies/handbook" />} />
      <Loader loadKey="handbook" rows={10}>
        {() => (can.allowed ? <Editor /> : <ReadOnly />)}
      </Loader>
    </>
  );
}

function ReadOnly() {
  const current = useHandbook((s) => s.versions[0]);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Expense policy" description={`Version ${current.n}, updated ${date(current.at)}`}>
        {/* Our own stored handbook HTML, written by the editor below. */}
        <article className={prose} dangerouslySetInnerHTML={{ __html: current.html }} />
      </Card>
      <div className="self-start">
        <Callout tone="info" title="Questions about the policy?">
          Ask in #finance. Only Admin or Finance can edit this page.
        </Callout>
      </div>
    </div>
  );
}

function Editor() {
  const versions = useHandbook((s) => s.versions);
  const publish = useHandbook((s) => s.publish);
  const people = useIndex("employees");
  const current = versions[0];
  const [html, setHtml] = useState(current.html);
  const [editorKey, setEditorKey] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [viewing, setViewing] = useState<HandbookVersion | null>(null);
  const dirty = html !== current.html;

  const load = (v: string) => {
    setHtml(v);
    setEditorKey((k) => k + 1);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-3 lg:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[13px] text-ink-3">
            {dirty ? <Badge tone="warn" dot>Unpublished changes</Badge> : <Badge tone="ok" dot>Published</Badge>}
            Version {current.n}
          </span>
          <div className="flex gap-2">
            {dirty ? (
              <Button size="sm" variant="ghost" onClick={() => load(current.html)}>
                Discard changes
              </Button>
            ) : null}
            <RoleGate action="policies.edit">
              {(allowed) => (
                <Button size="sm" variant="primary" disabled={!allowed || !dirty} onClick={() => setPublishing(true)}>
                  <Send /> Publish
                </Button>
              )}
            </RoleGate>
          </div>
        </div>
        <RichText key={editorKey} label="Expense policy" value={html} onChange={setHtml} />
        <p className="text-xs text-ink-3">Employees see the published version. Edits stay private until you publish.</p>
      </div>

      <Card title="Version history" bodyClassName="p-0" className="self-start">
        <ol>
          {versions.map((v, i) => (
            <li key={v.n}>
              <button type="button" onClick={() => setViewing(v)} className="flex w-full cursor-pointer items-start gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-sunken/60">
                <History className={cn("mt-0.5 size-4 shrink-0", i === 0 ? "text-brand" : "text-ink-3")} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    Version {v.n} {i === 0 ? <Badge tone="ok">Current</Badge> : null}
                  </span>
                  <span className="truncate text-[12.5px] text-ink-2">{v.note || "No note"}</span>
                  <span className="text-xs text-ink-3">
                    {fullName(people.get(v.authorId))}, {ago(v.at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <PublishModal
        open={publishing}
        onOpenChange={setPublishing}
        next={current.n + 1}
        onPublish={async (note, notify) => {
          await act(() => publish(html, note), { success: notify ? `Version ${current.n + 1} published. Everyone gets an email.` : `Version ${current.n + 1} published` });
          setPublishing(false);
        }}
      />
      <Modal
        open={!!viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        size="lg"
        title={viewing ? `Version ${viewing.n}` : ""}
        description={viewing ? `${viewing.note || "No note"}. Published ${date(viewing.at)}.` : undefined}
        footer={
          viewing && viewing.n !== current.n ? (
            <>
              <Button onClick={() => setViewing(null)}>Close</Button>
              <Button
                variant="primary"
                onClick={() => {
                  load(viewing.html);
                  setViewing(null);
                }}
              >
                Restore into editor
              </Button>
            </>
          ) : undefined
        }
      >
        {viewing ? <article className={prose} dangerouslySetInnerHTML={{ __html: viewing.html }} /> : null}
      </Modal>
      <UnsavedGuard when={dirty} />
    </div>
  );
}

function PublishModal({ open, onOpenChange, next, onPublish }: { open: boolean; onOpenChange: (v: boolean) => void; next: number; onPublish: (note: string, notify: boolean) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Publish version ${next}?`}
      description="Everyone at Northpine will see this version of the policy."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onPublish(note.trim(), notify);
              setBusy(false);
              setNote("");
            }}
          >
            Publish version {next}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="What changed?" optional hint="Shown in the version history and the email.">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Raised the meal limit to $175" />}
        </Field>
        <Switch checked={notify} onCheckedChange={setNotify} label="Email everyone" description="Sends a short summary with a link to the policy." />
      </div>
    </Modal>
  );
}
