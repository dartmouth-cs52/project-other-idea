import { FileText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { get, patch, simulate, useIndex } from "@/data/store";
import type { Transaction } from "@/data/types";
import { date, money } from "@/lib/format";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/display";
import { act, toast } from "@/ui/flow";
import { Checkbox, Field, Input, Textarea } from "@/ui/form";
import { FileDrop } from "@/ui/inputs";
import { ConfirmDialog, Modal } from "@/ui/overlay";
import { receiptFiles, useActivity } from "./shared";

// Receipts: the preview, uploading one, and the lost receipt affidavit.

/** Attach a file to a charge. Clears the missing receipt violation. */
export async function uploadReceipt(txId: string, file: File) {
  const log = useActivity.getState().log;
  try {
    await simulate(() => {
      const tx = get("transactions", txId);
      if (!tx) return;
      receiptFiles.set(txId, { url: URL.createObjectURL(file), type: file.type });
      patch("transactions", txId, { receipt: "attached", receiptName: file.name, violations: tx.violations.filter((v) => v !== "Missing receipt") });
    });
    log(txId, `attached ${file.name}`);
    toast.success("Receipt attached");
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "The upload failed.");
    return false;
  }
}

/** What the attached receipt looks like. Files picked this visit show for real; seeded ones get a drawn stand-in. */
export function ReceiptPreview({ tx, compact }: { tx: Transaction; compact?: boolean }) {
  const file = receiptFiles.get(tx.id);
  if (file && file.type.startsWith("image/"))
    return <img src={file.url} alt={`Receipt for ${tx.merchant}`} className="max-h-80 w-full rounded-md border border-line object-contain" />;
  return (
    <div className={compact ? "flex items-center gap-3 rounded-md border border-line bg-sunken/50 p-3" : "flex justify-center rounded-md border border-line bg-sunken/50 p-5"}>
      {compact ? (
        <>
          <FileText className="size-5 text-ink-3" />
          <span className="truncate text-[13px]">{tx.receiptName}</span>
        </>
      ) : (
        // A fake paper receipt, so the page looks like it has a real scan.
        <figure aria-label={`Receipt for ${tx.merchant}`} className="w-56 rotate-[-1deg] bg-white px-4 py-5 font-mono text-[11px] leading-relaxed text-neutral-700 shadow-md">
          <p className="text-center text-[12px] font-bold tracking-wide uppercase">{tx.merchant}</p>
          <p className="text-center text-neutral-500">{date(tx.date)}</p>
          <div className="my-2 border-t border-dashed border-neutral-300" />
          <p className="flex justify-between">
            <span>{tx.merchantCategory}</span>
            <span>{money(tx.amount * 0.92, tx.currency)}</span>
          </p>
          <p className="flex justify-between">
            <span>Tax</span>
            <span>{money(tx.amount * 0.08, tx.currency)}</span>
          </p>
          <div className="my-2 border-t border-dashed border-neutral-300" />
          <p className="flex justify-between font-bold">
            <span>TOTAL</span>
            <span>{money(tx.amount, tx.currency)}</span>
          </p>
          <p className="mt-3 text-center text-neutral-400">{tx.receiptName}</p>
        </figure>
      )}
    </div>
  );
}

/** The receipt section, used on the detail page and in the quick-edit panel. */
export function ReceiptSection({ tx, onLost, compact }: { tx: Transaction; onLost: () => void; compact?: boolean }) {
  const cats = useIndex("categories");
  const [busy, setBusy] = useState(false);
  const threshold = (tx.categoryId ? cats.get(tx.categoryId)?.requiresReceiptOver : undefined) ?? 75;
  const drop = (
    <FileDrop
      accept="image/*,application/pdf"
      label={busy ? "Uploading…" : "Drop the receipt here, or click to browse"}
      hint="PDF, JPG or PNG, up to 10 MB"
      onFiles={async (files) => {
        if (!files[0]) return;
        setBusy(true);
        await uploadReceipt(tx.id, files[0]);
        setBusy(false);
      }}
    />
  );
  if (tx.receipt === "attached")
    return (
      <div className="flex flex-col gap-3">
        <ReceiptPreview tx={tx} compact={compact} />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act(() => patch("transactions", tx.id, { receipt: "missing", receiptName: null, violations: tx.amount >= threshold ? [...new Set([...tx.violations, "Missing receipt"])] : tx.violations }), {
                success: "Receipt removed",
              })
            }
          >
            Remove receipt
          </Button>
        </div>
      </div>
    );
  if (tx.receipt === "lost_affidavit")
    return (
      <Callout tone="ok" title="Lost receipt affidavit on file">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-4" /> Signed by the card holder. It counts as the receipt for audit.
        </span>
      </Callout>
    );
  return (
    <div className="flex flex-col gap-2">
      {tx.receipt === "not_required" ? <p className="text-[13px] text-ink-3">No receipt needed for this category under {money(threshold)}. You can still attach one.</p> : null}
      {drop}
      {tx.receipt === "missing" ? (
        <p className="text-[12.5px] text-ink-3">
          Can't find it?{" "}
          <Button variant="link" size="sm" onClick={onLost}>
            I lost this receipt
          </Button>
        </p>
      ) : null}
    </div>
  );
}

export function AttachReceiptModal({ tx, onOpenChange }: { tx: Transaction | null; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!tx} onOpenChange={onOpenChange} title="Attach receipt" description={tx ? `${tx.merchant}, ${money(tx.amount, tx.currency)} on ${date(tx.date)}` : undefined}>
      {tx ? (
        <FileDrop
          accept="image/*,application/pdf"
          label={busy ? "Uploading…" : "Drop the receipt here, or click to browse"}
          hint="PDF, JPG or PNG, up to 10 MB"
          onFiles={async (files) => {
            if (!files[0]) return;
            setBusy(true);
            const ok = await uploadReceipt(tx.id, files[0]);
            setBusy(false);
            if (ok) onOpenChange(false);
          }}
        />
      ) : null}
    </Modal>
  );
}

/**
 * The affidavit for a lost receipt. Submitting opens a second confirm dialog on
 * top of this one. Nested modals on purpose.
 */
export function LostReceiptModal({ tx, open, onOpenChange }: { tx: Transaction; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [what, setWhat] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attendees, setAttendees] = useState("");
  const [certify, setCertify] = useState(false);
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (open) {
      setWhat("");
      setPurpose(tx.memo);
      setAttendees("");
      setCertify(false);
      setTried(false);
    }
  }, [open, tx.memo]);
  const errors = { what: what.trim() ? null : "Describe what you bought.", purpose: purpose.trim() ? null : "Add the business purpose.", certify: certify ? null : "Confirm the statement to continue." };
  const valid = !errors.what && !errors.purpose && !errors.certify;
  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        dismissable={false}
        title="Lost receipt affidavit"
        description={`${tx.merchant}, ${money(tx.amount, tx.currency)} on ${date(tx.date)}. The affidavit stands in for the receipt at audit.`}
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setTried(true);
                if (valid) setConfirming(true);
              }}
            >
              Continue
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="What did you buy?" error={tried ? errors.what : null}>
            {(id) => <Textarea id={id} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Dinner for four with the Brightline team" aria-invalid={tried && !!errors.what} />}
          </Field>
          <Field label="Business purpose" error={tried ? errors.purpose : null}>
            {(id) => <Input id={id} value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-invalid={tried && !!errors.purpose} />}
          </Field>
          <Field label="Attendees" optional hint="For meals and entertainment.">
            {(id) => <Input id={id} value={attendees} onChange={(e) => setAttendees(e.target.value)} />}
          </Field>
          <div className="flex flex-col gap-1">
            <Checkbox checked={certify} onCheckedChange={setCertify} label="I confirm this was a business expense and I can't get a copy of the receipt." />
            {tried && errors.certify ? <p className="pl-6 text-xs text-danger">{errors.certify}</p> : null}
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign the affidavit?"
        description={`You're stating that ${money(tx.amount, tx.currency)} at ${tx.merchant} was a business expense. Finance may follow up.`}
        confirmLabel="Sign and submit"
        onConfirm={async () => {
          await act(
            () => patch("transactions", tx.id, { receipt: "lost_affidavit", receiptName: null, violations: tx.violations.filter((v) => v !== "Missing receipt"), memo: tx.memo || purpose }),
            { success: "Affidavit submitted" },
          );
          if (get("transactions", tx.id)?.receipt === "lost_affidavit") {
            useActivity.getState().log(tx.id, "signed a lost receipt affidavit");
            onOpenChange(false);
          }
        }}
      />
    </>
  );
}
