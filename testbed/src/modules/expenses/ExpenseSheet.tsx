import { ArrowUpRight, Check, Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useIndex, useRow } from "@/data/store";
import { dateTime, masked } from "@/lib/format";
import { Button } from "@/ui/button";
import { Callout, DescriptionList, Person, StatusBadge } from "@/ui/display";
import { RoleGate } from "@/ui/flow";
import { Field, Textarea } from "@/ui/form";
import { Combobox } from "@/ui/inputs";
import { Sheet } from "@/ui/overlay";
import { SavedIndicator, useAutosave } from "./autosave";
import { LostReceiptModal, ReceiptSection } from "./receipts";
import { fmtAmount, ReviewBadge, useCategoryOptions } from "./shared";

/** Quick edit for one charge, opened from a row in the list. */
export function ExpenseSheet({ txId, onClose }: { txId: string | null; onClose: () => void }) {
  const tx = useRow("transactions", txId ?? undefined);
  return (
    <Sheet
      open={!!txId}
      onOpenChange={(v) => !v && onClose()}
      width="max-w-lg"
      title={tx ? tx.merchant : "Expense"}
      description={tx ? `${fmtAmount(tx)} · ${dateTime(tx.date)}` : undefined}
      footer={
        tx ? (
          <Button asChild variant="primary">
            <Link to={`/expenses/${tx.id}`}>
              Open full page <ArrowUpRight />
            </Link>
          </Button>
        ) : null
      }
    >
      {tx ? <SheetBody key={tx.id} txId={tx.id} /> : null}
    </Sheet>
  );
}

function SheetBody({ txId }: { txId: string }) {
  const tx = useRow("transactions", txId)!;
  const people = useIndex("employees");
  const cards = useIndex("cards");
  const categories = useCategoryOptions();
  const { state, save, retry } = useAutosave(txId);
  const [memo, setMemo] = useState(tx.memo);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (memo === tx.memo) return;
    const t = setTimeout(() => save({ memo }, "edited the memo"), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo]);
  const card = cards.get(tx.cardId);
  const reviewed = tx.reviewStatus === "approved" || tx.reviewStatus === "exported";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="flex gap-1.5">
          <StatusBadge status={tx.status} />
          <ReviewBadge status={tx.reviewStatus} />
        </span>
        <SavedIndicator state={state} onRetry={retry} />
      </div>

      {tx.violations.length ? (
        <Callout tone="warn" title={tx.violations.length === 1 ? "1 policy issue" : `${tx.violations.length} policy issues`}>
          {tx.violations.join(". ")}.
        </Callout>
      ) : null}

      <DescriptionList
        items={[
          { label: "Card holder", value: <Person person={people.get(tx.employeeId)} /> },
          { label: "Card", value: card ? <Link className="text-brand hover:underline" to={`/cards/${card.id}`}>{`${card.nickname} ${masked(card.last4)}`}</Link> : "Unknown" },
        ]}
      />

      <Field label="Category">
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
      <Field label="Memo" hint="What was it for? Finance reads this at month end.">
        {(id) => <Textarea id={id} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Client dinner with Brightline" className="min-h-16" />}
      </Field>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium">Receipt</h3>
        <ReceiptSection tx={tx} compact onLost={() => setLost(true)} />
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-[13px] font-medium">Review</h3>
        <div className="flex gap-2">
          <RoleGate action="expenses.review">
            {(allowed) => (
              <Button size="sm" disabled={!allowed || reviewed} onClick={() => save({ reviewStatus: "approved" }, "approved this expense")}>
                <Check /> {reviewed ? "Approved" : "Approve"}
              </Button>
            )}
          </RoleGate>
          <RoleGate action="expenses.review">
            {(allowed) => (
              <Button size="sm" disabled={!allowed || tx.reviewStatus === "exported"} onClick={() => save({ reviewStatus: tx.reviewStatus === "flagged" ? "needs_review" : "flagged" }, tx.reviewStatus === "flagged" ? "removed the flag" : "flagged this expense")}>
                <Flag /> {tx.reviewStatus === "flagged" ? "Unflag" : "Flag"}
              </Button>
            )}
          </RoleGate>
        </div>
      </section>
      <LostReceiptModal tx={tx} open={lost} onOpenChange={setLost} />
    </div>
  );
}
