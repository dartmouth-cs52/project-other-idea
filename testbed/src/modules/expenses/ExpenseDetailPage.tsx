import { addDays, parseISO } from "date-fns";
import { AlertTriangle, Check, Copy, CreditCard, FileX, Flag, MoreHorizontal, Plus, Scissors, Trash2, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ME_ID, newId, patch, upsert, useCollection, useIndex, useRow } from "@/data/store";
import type { Transaction } from "@/data/types";
import { useLab } from "@/lab/lab";
import { cn } from "@/lib/cn";
import { ago, date, dateTime, fullName, masked, money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Avatar, Badge, Callout, Card, DescriptionList, EmptyState, PageHeader, Person, StatusBadge } from "@/ui/display";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { Field, Input, Textarea } from "@/ui/form";
import { Combobox, MultiSelect } from "@/ui/inputs";
import { Menu, Modal } from "@/ui/overlay";
import { SavedIndicator, useAutosave } from "./autosave";
import { LostReceiptModal, ReceiptSection } from "./receipts";
import { fmtAmount, REVIEW_LABELS, ReviewBadge, TAG_OPTIONS, useActivity, useCategoryOptions } from "./shared";

// One charge. Every field saves as it changes, with a "Saved" note by the
// title and no Save button.

const VIOLATION_POLICY: Record<string, string> = {
  "Missing receipt": "/policies/pol_2",
  "Over the meal limit of $150": "/policies/pol_1",
  "Weekend spend": "/policies/pol_5",
};

export function ExpenseDetailPage() {
  const { id } = useParams();
  const tx = useRow("transactions", id);
  if (!tx)
    return (
      <>
        <PageHeader title="Expense not found" crumbs={[{ label: "Expenses", to: "/expenses" }, { label: "Not found" }]} />
        <Card>
          <EmptyState title="We couldn't find that expense" description="It may have been split or removed." action={<Button asChild><Link to="/expenses">Back to expenses</Link></Button>} />
        </Card>
      </>
    );
  return <Detail key={tx.id} tx={tx} />;
}

function Detail({ tx }: { tx: Transaction }) {
  const { state, save, retry } = useAutosave(tx.id);
  const [splitOpen, setSplitOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const reviewed = tx.reviewStatus === "approved" || tx.reviewStatus === "exported";
  const personal = tx.tags.includes("Personal");

  const markPersonal = () => {
    const before = tx;
    act(() => patch("transactions", tx.id, { tags: [...new Set([...tx.tags, "Personal"])], reviewStatus: "flagged", categoryId: null }), {
      success: `Marked as personal. ${money(tx.amount, tx.currency)} will be deducted from the next reimbursement.`,
      undo: () => upsert("transactions", before),
    }).then(() => useActivity.getState().log(tx.id, "marked this as a personal charge"));
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Expenses", to: "/expenses" }, { label: tx.merchant }]}
        title={
          <span className="flex items-baseline gap-3">
            {tx.merchant}
            <span className="tabular text-ink-2">{fmtAmount(tx)}</span>
          </span>
        }
        meta={
          <>
            <StatusBadge status={tx.status} />
            <ReviewBadge status={tx.reviewStatus} />
            {personal ? <Badge tone="danger">Personal</Badge> : null}
            {tx.splitFrom ? <Badge>Split</Badge> : null}
            <span className="ml-2">
              <SavedIndicator state={state} onRetry={retry} />
            </span>
          </>
        }
        actions={
          <>
            <Button onClick={markPersonal} disabled={personal || tx.reviewStatus === "exported"}>
              <User /> Mark as personal
            </Button>
            <RoleGate action="expenses.review">
              {(allowed) => (
                <Button disabled={!allowed || tx.reviewStatus === "exported"} onClick={() => save({ reviewStatus: tx.reviewStatus === "flagged" ? "needs_review" : "flagged" }, tx.reviewStatus === "flagged" ? "removed the flag" : "flagged this expense")}>
                  <Flag /> {tx.reviewStatus === "flagged" ? "Unflag" : "Flag"}
                </Button>
              )}
            </RoleGate>
            <RoleGate action="expenses.review">
              {(allowed) => (
                <Button variant="primary" disabled={!allowed || reviewed} onClick={() => save({ reviewStatus: "approved" }, "approved this expense")}>
                  <Check /> {reviewed ? REVIEW_LABELS[tx.reviewStatus] : "Approve"}
                </Button>
              )}
            </RoleGate>
            <Menu
              label="More actions"
              trigger={
                // Icon-only, named only by the menu's aria-label.
                <Button variant="ghost" size="icon">
                  <MoreHorizontal />
                </Button>
              }
              items={[
                { label: "Split transaction", icon: <Scissors />, onSelect: () => setSplitOpen(true), disabled: tx.status === "declined" },
                { label: "I lost this receipt", icon: <FileX />, onSelect: () => setLostOpen(true), disabled: tx.receipt !== "missing" },
                { label: "", separator: true },
                {
                  label: "Copy link",
                  icon: <Copy />,
                  onSelect: () => {
                    navigator.clipboard?.writeText(location.href).catch(() => undefined);
                    toast.success("Link copied");
                  },
                },
              ]}
            />
          </>
        }
      />
      <Loader loadKey={["expense", tx.id]} rows={8}>
        {() => <DetailBody tx={tx} save={save} onSplit={() => setSplitOpen(true)} onLost={() => setLostOpen(true)} />}
      </Loader>
      <SplitModal tx={tx} open={splitOpen} onOpenChange={setSplitOpen} />
      <LostReceiptModal tx={tx} open={lostOpen} onOpenChange={setLostOpen} />
    </>
  );
}

function DetailBody({ tx, save, onSplit, onLost }: { tx: Transaction; save: (f: Partial<Transaction>, note?: string) => void; onSplit: () => void; onLost: () => void }) {
  const people = useIndex("employees");
  const cards = useIndex("cards");
  const deps = useIndex("departments");
  const entities = useIndex("entities");
  const cats = useIndex("categories");
  const gl = useIndex("glAccounts");
  const categories = useCategoryOptions();
  const role = useLab((s) => s.role);
  const [memo, setMemo] = useState(tx.memo);
  useEffect(() => {
    if (memo === tx.memo) return;
    const t = setTimeout(() => save({ memo }, "edited the memo"), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo]);
  const allTx = useCollection("transactions");
  const children = useMemo(() => allTx.filter((t) => t.splitFrom === tx.id), [allTx, tx.id]);
  const card = cards.get(tx.cardId);
  const holder = people.get(tx.employeeId);
  const cat = tx.categoryId ? cats.get(tx.categoryId) : undefined;
  const account = cat ? gl.get(cat.glAccountId) : undefined;
  const tagOptions = [...new Set([...TAG_OPTIONS, ...tx.tags])].map((t) => ({ value: t, label: t }));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        {tx.violations.length ? (
          <Callout tone="warn" title={tx.violations.length === 1 ? "This charge breaks 1 policy" : `This charge breaks ${tx.violations.length} policies`}>
            <ul className="mt-1 flex flex-col gap-1">
              {tx.violations.map((v) => (
                <li key={v} className="flex items-center gap-2">
                  <AlertTriangle className="size-3.5 text-warn" />
                  {v}
                  {VIOLATION_POLICY[v] ? (
                    <Link to={VIOLATION_POLICY[v]} className="text-brand hover:underline">
                      View rule
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </Callout>
        ) : null}

        <Card title="Details" description="Coding and notes for accounting. Changes save as you go.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Category" hint={account ? `Posts to ${account.code} ${account.name}` : "Pick one so this posts to the right account."}>
              {(id) => (
                <Combobox
                  id={id}
                  value={tx.categoryId}
                  options={categories}
                  placeholder="Choose a category"
                  searchPlaceholder="Search categories…"
                  onChange={(v) => save({ categoryId: v }, `set the category to ${categories.find((c) => c.value === v)?.label}`)}
                />
              )}
            </Field>
            <Field label="Tags" optional>
              {(id) => <MultiSelect id={id} value={tx.tags} options={tagOptions} placeholder="Add tag" onChange={(v) => save({ tags: v }, "changed the tags")} />}
            </Field>
            <Field label="Memo" className="sm:col-span-2" hint="What was it for, and who was there?">
              {(id) => <Textarea id={id} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Client dinner with Brightline" />}
            </Field>
          </div>
        </Card>

        <Card title="Receipt" description={tx.receipt === "missing" ? "Required for this charge. Attach it to clear the policy issue." : undefined}>
          <ReceiptSection tx={tx} onLost={onLost} />
        </Card>

        {children.length || tx.splitFrom ? (
          <Card title="Split" bodyClassName="p-0">
            <ul>
              {tx.splitFrom ? (
                <li className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                  <span className="text-ink-2">Split from another charge</span>
                  <Link to={`/expenses/${tx.splitFrom}`} className="text-brand hover:underline">
                    View original
                  </Link>
                </li>
              ) : null}
              {children.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] first:border-0">
                  <Link to={`/expenses/${c.id}`} className="hover:underline">
                    {(c.categoryId && cats.get(c.categoryId)?.name) || "Uncategorized"}
                    {c.memo ? <span className="text-ink-3"> · {c.memo}</span> : null}
                  </Link>
                  <span className="tabular">{money(c.amount, c.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Activity tx={tx} />
      </div>

      <div className="flex flex-col gap-5">
        <Card title="Charge">
          <DescriptionList
            columns={1}
            items={[
              { label: "Amount", value: <span className="tabular">{fmtAmount(tx)}</span> },
              { label: "Date", value: dateTime(tx.date) },
              {
                label: "Card",
                value: card ? (
                  <Link to={`/cards/${card.id}`} className="inline-flex items-center gap-1.5 text-brand hover:underline">
                    <CreditCard className="size-3.5" /> {card.nickname} <span className="tabular">{masked(card.last4)}</span>
                  </Link>
                ) : (
                  "Unknown"
                ),
              },
              {
                label: "Card holder",
                value: holder ? (
                  <Link to={`/people/${holder.id}`} className="hover:underline">
                    <Person person={holder} sub={holder.title} />
                  </Link>
                ) : (
                  "Unknown"
                ),
              },
              { label: "Merchant category", value: tx.merchantCategory },
              { label: "Department", value: deps.get(tx.departmentId)?.name ?? "None" },
              { label: "Entity", value: entities.get(tx.entityId)?.name ?? "None" },
              { label: "Transaction ID", value: <span className="font-mono text-xs">{tx.id}</span> },
            ]}
          />
        </Card>
        <Card title="Need to change something else?">
          <div className="flex flex-col items-start gap-2 text-[13px]">
            <Button size="sm" onClick={onSplit} disabled={tx.status === "declined"}>
              <Scissors /> Split transaction
            </Button>
            <p className="text-ink-3">Split a charge that covers more than one category, like a hotel bill with a dinner on it.</p>
            {role === "employee" ? <p className="text-ink-3">Only finance can approve or flag charges.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Activity({ tx }: { tx: Transaction }) {
  const people = useIndex("employees");
  const logged = useActivity((s) => s.events[tx.id]);
  const events = useMemo(() => {
    const out: { at: string; who: string | null; text: string }[] = (logged ?? []).map((e) => ({ at: e.at, who: e.who, text: e.text }));
    const base = parseISO(tx.date);
    if (tx.reviewStatus === "exported") out.push({ at: addDays(base, 30).toISOString(), who: null, text: "Exported to Ledgerbook ERP" });
    if (tx.reviewStatus === "approved" && !logged?.length) out.push({ at: addDays(base, 3).toISOString(), who: ME_ID, text: "approved this expense" });
    if (tx.receipt === "attached" && !logged?.some((e) => e.text.startsWith("attached"))) out.push({ at: addDays(base, 1).toISOString(), who: tx.employeeId, text: `attached ${tx.receiptName}` });
    if (tx.status === "cleared") out.push({ at: addDays(base, 1).toISOString(), who: null, text: "Charge cleared" });
    out.push({ at: tx.date, who: tx.employeeId, text: `${tx.status === "declined" ? "tried to pay" : "paid"} ${money(tx.amount, tx.currency)} at ${tx.merchant}` });
    return out.filter((e) => e.at <= new Date().toISOString() || e.who === ME_ID).sort((a, b) => b.at.localeCompare(a.at));
  }, [logged, tx]);
  return (
    <Card title="Activity">
      <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-line">
        {events.map((e, i) => {
          const who = e.who ? people.get(e.who) : undefined;
          return (
            <li key={i} className="relative flex items-start gap-3 text-[13px]">
              {who ? <Avatar person={who} size={23} className="ring-2 ring-panel" /> : <span className={cn("mt-1.5 ml-[7px] size-2.5 rounded-full ring-4 ring-panel", i === 0 ? "bg-brand" : "bg-line-strong")} />}
              <span className="flex flex-col">
                <span>
                  {who ? <span className="font-medium">{e.who === ME_ID ? "You" : fullName(who)} </span> : null}
                  {e.text}
                </span>
                <span className="text-xs text-ink-3">
                  {date(e.at)} · {ago(e.at)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

interface Line {
  key: string;
  categoryId: string | null;
  amount: string;
  memo: string;
}

/** Split one charge into lines that must add up to the original amount. */
function SplitModal({ tx, open, onOpenChange }: { tx: Transaction; open: boolean; onOpenChange: (v: boolean) => void }) {
  const categories = useCategoryOptions();
  const fresh = (): Line[] => [
    { key: "a", categoryId: tx.categoryId, amount: tx.amount.toFixed(2), memo: tx.memo },
    { key: "b", categoryId: null, amount: "", memo: "" },
  ];
  const [lines, setLines] = useState<Line[]>(fresh);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setLines(fresh());
      setTried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const cents = (s: string) => Math.round((Number(s) || 0) * 100);
  const total = lines.reduce((s, l) => s + cents(l.amount), 0);
  const remaining = Math.round(tx.amount * 100) - total;
  const lineErrors = lines.map((l) => (!l.categoryId ? "Pick a category." : cents(l.amount) <= 0 ? "Enter an amount." : null));
  const error = remaining !== 0 ? `The lines must add up to ${money(tx.amount, tx.currency)}. ${remaining > 0 ? `${money(remaining / 100, tx.currency)} left to assign.` : `${money(-remaining / 100, tx.currency)} too much.`}` : null;
  const setLine = (key: string, f: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...f } : l)));

  const submit = async () => {
    setTried(true);
    if (error || lineErrors.some(Boolean)) return;
    setBusy(true);
    const [first, ...rest] = lines;
    await act(
      () => {
        patch("transactions", tx.id, { amount: cents(first.amount) / 100, categoryId: first.categoryId, memo: first.memo });
        upsert(
          "transactions",
          ...rest.map((l) => ({
            ...tx,
            id: newId("tx"),
            amount: cents(l.amount) / 100,
            categoryId: l.categoryId,
            memo: l.memo,
            splitFrom: tx.id,
            violations: tx.violations.filter((v) => v === "Missing receipt"),
          })),
        );
      },
      { success: `Split into ${lines.length} lines` },
    );
    useActivity.getState().log(tx.id, `split this charge into ${lines.length} lines`);
    setBusy(false);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      dismissable={false}
      title="Split transaction"
      description={`${tx.merchant}, ${money(tx.amount, tx.currency)}. Each line gets its own category and memo.`}
      footer={
        <>
          <span className={cn("mr-auto text-[13px] tabular", remaining === 0 ? "text-ok" : "text-ink-2")}>
            {remaining === 0 ? "Lines add up" : `${money(Math.abs(remaining) / 100, tx.currency)} ${remaining > 0 ? "left to assign" : "over"}`}
          </span>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Split transaction
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* On a phone each line is two rows, the category over the amount and the memo, and these headings would not line up. */}
        <div className="grid grid-cols-[1fr_120px_1fr_28px] gap-2 text-xs font-medium text-ink-3 max-sm:hidden">
          <span>Category</span>
          <span>Amount</span>
          <span>Memo</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={l.key} className="flex flex-col gap-1">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-center gap-2 sm:grid-cols-[1fr_120px_1fr_28px]">
              <Combobox className="max-sm:col-span-2" aria-label={`Line ${i + 1} category`} value={l.categoryId} options={categories} placeholder="Category" onChange={(v) => setLine(l.key, { categoryId: v })} />
              <Input
                aria-label={`Line ${i + 1} amount`}
                className="max-sm:col-start-1 max-sm:row-start-2"
                type="number"
                step="0.01"
                min="0"
                prefix="$"
                value={l.amount}
                onChange={(e) => setLine(l.key, { amount: e.target.value })}
                aria-invalid={tried && !!lineErrors[i]}
              />
              <Input
                aria-label={`Line ${i + 1} memo`}
                className="max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2"
                value={l.memo}
                onChange={(e) => setLine(l.key, { memo: e.target.value })}
                placeholder="Optional"
              />
              <IconButton
                className="max-sm:col-start-3 max-sm:row-start-1"
                label={`Remove line ${i + 1}`}
                size="icon-sm" icon={<Trash2 />} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
            </div>
            {tried && lineErrors[i] ? <p className="text-xs text-danger">{lineErrors[i]}</p> : null}
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { key: Math.random().toString(36).slice(2), categoryId: null, amount: remaining > 0 ? (remaining / 100).toFixed(2) : "", memo: "" }])}>
            <Plus /> Add line
          </Button>
        </div>
        {tried && error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
