import { parseISO } from "date-fns";
import { ArrowUpRight, Check, ChevronsUp, Circle, Clock, ScrollText, X } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ME_ID, get, useCollection, useIndex, useRow } from "@/data/store";
import type { Approval } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { ago, dateTime, fullName, money } from "@/lib/format";
import { Button } from "@/ui/button";
import { Avatar, Callout, Card, DescriptionList, EmptyState, PageHeader, Person, StatusBadge } from "@/ui/display";
import { Loader, RoleGate } from "@/ui/flow";
import { Textarea } from "@/ui/form";
import { addComment, approveMany, escalate, isOpen, KIND_LABELS, KindBadge, RejectModal, STAGES, stageOf, subjectHref } from "./shared";

// One request: what it's for, who has approved so far, the discussion, and
// the decision buttons.

export function ApprovalDetailPage() {
  const { id } = useParams();
  const a = useRow("approvals", id);
  const [rejecting, setRejecting] = useState<Approval[]>([]);
  const can = useCan("approvals.decide");
  if (!a)
    return (
      <>
        <PageHeader title="Request not found" crumbs={[{ label: "Approvals", to: "/approvals" }, { label: "Not found" }]} />
        <Card>
          <EmptyState title="We couldn't find that request" description="It may have been withdrawn." action={<Button asChild><Link to="/approvals">Back to approvals</Link></Button>} />
        </Card>
      </>
    );
  const open = isOpen(a);
  const overdue = open && parseISO(a.dueAt) < new Date();
  return (
    <>
      <PageHeader
        crumbs={[{ label: "Approvals", to: "/approvals" }, { label: a.title }]}
        title={a.title}
        meta={
          <>
            <KindBadge kind={a.kind} />
            <StatusBadge status={a.status} />
            {open ? (
              <span className={cn("inline-flex items-center gap-1 text-[12.5px]", overdue ? "text-danger" : "text-ink-3")}>
                <Clock className="size-3.5" /> {overdue ? `Overdue, was due ${ago(a.dueAt)}` : `Due ${ago(a.dueAt)}`}
              </span>
            ) : null}
          </>
        }
        actions={
          open ? (
            <>
              <RoleGate action="approvals.decide">
                {(allowed) => (
                  <Button disabled={!allowed || stageOf(a) === "controller"} onClick={() => escalate(a)}>
                    <ChevronsUp /> Escalate
                  </Button>
                )}
              </RoleGate>
              <RoleGate action="approvals.decide">
                {(allowed) => (
                  <Button disabled={!allowed} onClick={() => setRejecting([a])}>
                    <X /> Reject
                  </Button>
                )}
              </RoleGate>
              <RoleGate action="approvals.decide">
                {(allowed) => (
                  <Button variant="primary" disabled={!allowed} onClick={() => approveMany([a])}>
                    <Check /> Approve
                  </Button>
                )}
              </RoleGate>
            </>
          ) : null
        }
      />
      {!can.allowed && open ? (
        <div className="mb-4">
          <Callout tone="info" title="You can follow this request but not decide it">
            {can.reason}
          </Callout>
        </div>
      ) : null}
      <Loader loadKey={["approval", a.id]} rows={8}>
        {() => <Body a={a} />}
      </Loader>
      <RejectModal items={rejecting} onOpenChange={(v) => !v && setRejecting([])} />
    </>
  );
}

function Body({ a }: { a: Approval }) {
  const people = useIndex("employees");
  const requester = people.get(a.requesterId);
  const subject = subjectHref(a);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        <Card title="Request">
          <DescriptionList
            items={[
              {
                label: "Requested by",
                value: requester ? (
                  <Link to={`/people/${requester.id}`} className="hover:underline">
                    <Person person={requester} sub={requester.title} />
                  </Link>
                ) : (
                  "Unknown"
                ),
              },
              { label: "Amount", value: a.kind === "vendor" ? "No amount" : <span className="tabular">{money(a.amount, a.currency)}</span> },
              { label: "Type", value: KIND_LABELS[a.kind] },
              { label: "Submitted", value: dateTime(a.createdAt) },
              { label: "Due", value: dateTime(a.dueAt) },
              {
                label: "Linked record",
                value: subject ? (
                  <Link to={subject.href} className="inline-flex items-center gap-1 text-brand hover:underline">
                    {subject.label} <ArrowUpRight className="size-3.5" />
                  </Link>
                ) : (
                  "None"
                ),
              },
            ]}
          />
          <SubjectExtra a={a} />
        </Card>
        <Chain a={a} />
        <Comments a={a} />
      </div>
      <div className="flex flex-col gap-5">
        <WhyCard a={a} />
        <OtherRequests a={a} />
      </div>
    </div>
  );
}

/** A bill also links to its vendor. */
function SubjectExtra({ a }: { a: Approval }) {
  if (a.kind !== "bill") return null;
  const bill = get("bills", a.subjectId);
  const vendor = bill ? get("vendors", bill.vendorId) : undefined;
  if (!bill || !vendor) return null;
  return (
    <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-2">
      From{" "}
      <Link to={`/bills/vendors/${vendor.id}`} className="text-brand hover:underline">
        {vendor.name}
      </Link>
      , {bill.lines.length} {bill.lines.length === 1 ? "line" : "lines"}
      {bill.poNumber ? `, ${bill.poNumber}` : ""}.
    </p>
  );
}

/** Who has signed off so far, drawn as a row of steps. */
function Chain({ a }: { a: Approval }) {
  const people = useIndex("employees");
  const finance = useCollection("employees").find((e) => e.role === "finance" && e.id !== ME_ID);
  const order = STAGES.map((s) => s.id);
  const at = order.indexOf(stageOf(a));
  const steps = [
    { label: "Submitted", person: people.get(a.requesterId), state: "done" as const },
    ...STAGES.filter((s) => s.id !== "done").map((s, i) => {
      const person = s.id === "manager" ? people.get(a.approverIds[0]) : s.id === "finance" ? finance : people.get(ME_ID);
      const state: "done" | "current" | "rejected" | "todo" =
        a.status === "approved" ? "done" : a.status === "rejected" ? (i === 0 ? "rejected" : "todo") : i < at ? "done" : i === at ? "current" : "todo";
      return { label: s.label, person, state };
    }),
  ];
  return (
    <Card title="Approval chain" description={a.status === "approved" ? "Everyone has approved." : a.status === "rejected" ? "Stopped when it was rejected." : "Each step has to approve before it moves on."}>
      <ol className="flex flex-col gap-0 sm:flex-row sm:items-start">
        {steps.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
            <div className="flex items-center sm:w-full">
              <span className={cn("hidden h-px flex-1 sm:block", i === 0 ? "bg-transparent" : s.state === "done" ? "bg-brand" : "bg-line-strong")} />
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border-2",
                  s.state === "done" && "border-brand bg-brand text-brand-ink",
                  s.state === "current" && "border-warn bg-warn-soft text-warn",
                  s.state === "rejected" && "border-danger bg-danger text-white",
                  s.state === "todo" && "border-line-strong bg-panel text-ink-3",
                )}
              >
                {s.state === "done" ? <Check className="size-4" strokeWidth={3} /> : s.state === "rejected" ? <X className="size-4" strokeWidth={3} /> : s.state === "current" ? <Clock className="size-3.5" /> : <Circle className="size-2.5" />}
              </span>
              <span className={cn("hidden h-px flex-1 sm:block", i === steps.length - 1 ? "bg-transparent" : steps[i + 1].state === "done" ? "bg-brand" : "bg-line-strong")} />
            </div>
            <div className="flex flex-col pb-4 sm:pb-0">
              <span className="text-[13px] font-medium">{s.label}</span>
              <span className="text-xs text-ink-3">{s.person ? fullName(s.person) : "Unassigned"}</span>
              <span className={cn("text-xs", s.state === "current" ? "text-warn" : "text-ink-3")}>
                {s.state === "done" ? (i === 0 ? "Sent" : "Approved") : s.state === "current" ? "Waiting" : s.state === "rejected" ? "Rejected" : "Not yet"}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Comments({ a }: { a: Approval }) {
  const people = useIndex("employees");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Comments" description={a.comments.length ? undefined : "Ask a question or leave context for the next approver."}>
      {a.comments.length ? (
        <ul className="mb-4 flex flex-col gap-4">
          {a.comments.map((c, i) => {
            const p = people.get(c.authorId);
            return (
              <li key={i} className="flex gap-3">
                <Avatar person={p} size={28} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px]">
                    <span className="font-medium">{c.authorId === ME_ID ? "You" : fullName(p)}</span> <span className="text-xs text-ink-3">{ago(c.at)}</span>
                  </span>
                  <p className="text-[13px] whitespace-pre-wrap text-ink-2">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          setBusy(true);
          await addComment(a, body.trim());
          setBusy(false);
          setBody("");
        }}
      >
        <Textarea aria-label="Add a comment" placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-16" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={busy} disabled={!body.trim()}>
            Post comment
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Which policy rule sent this here. */
function WhyCard({ a }: { a: Approval }) {
  const policies = useCollection("policies");
  const rule =
    a.kind === "bill" && a.amount > 10000
      ? policies.find((p) => p.id === "pol_4")
      : a.kind === "reimbursement" && get("reimbursements", a.subjectId)?.categoryId === "cat_meals"
        ? policies.find((p) => p.id === "pol_1")
        : undefined;
  return (
    <Card title="Why this needs approval">
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        {rule ? (
          <>
            <p>
              The rule <span className="font-medium text-ink">{rule.name}</span> sends it here.
            </p>
            <Button size="sm" asChild className="self-start">
              <Link to={`/policies/${rule.id}`}>
                <ScrollText /> View rule
              </Link>
            </Button>
          </>
        ) : (
          <>
            <p>Every {KIND_LABELS[a.kind].toLowerCase()} goes to the requester's manager first, then finance.</p>
            <Button size="sm" variant="link" asChild className="self-start">
              <Link to="/policies">See approval rules</Link>
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function OtherRequests({ a }: { a: Approval }) {
  const all = useCollection("approvals");
  const others = all.filter((x) => x.requesterId === a.requesterId && x.id !== a.id).slice(0, 5);
  return (
    <Card title="Other requests from this person" bodyClassName="p-0">
      {others.length ? (
        <ul>
          {others.map((o) => (
            <li key={o.id}>
              <Link to={`/approvals/${o.id}`} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-0 hover:bg-sunken/60">
                <span className="truncate">{o.title}</span>
                <StatusBadge status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-[13px] text-ink-3">None.</p>
      )}
    </Card>
  );
}
