import { addDays, format, parseISO } from "date-fns";
import { CalendarClock, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { patch, useCollection, useIndex } from "@/data/store";
import type { Bill, Vendor } from "@/data/types";
import { date, masked, money } from "@/lib/format";
import { Button } from "@/ui/button";
import { Callout, DescriptionList } from "@/ui/display";
import { act, Stepper } from "@/ui/flow";
import { Field, Input, NativeSelect, RadioCards } from "@/ui/form";
import { DatePicker } from "@/ui/inputs";
import { Modal } from "@/ui/overlay";
import { bankName, billTotal, last4, METHOD_HINTS, METHOD_ICONS, METHOD_LABELS } from "./shared";

const STEPS = ["Method", "Timing", "Review"];

/**
 * The three-step payment flow: how, when, then confirm. Opened from a bill's
 * "Pay now" and from the hover action on the bills list.
 */
export function PayBillModal({ bill, open, onOpenChange }: { bill: Bill; open: boolean; onOpenChange: (v: boolean) => void }) {
  const vendors = useIndex("vendors");
  const entities = useCollection("entities");
  const vendor = vendors.get(bill.vendorId) as Vendor | undefined;
  const [step, setStep] = useState(0);
  const [method, setMethod] = useState<Vendor["paymentMethod"]>(vendor?.paymentMethod ?? "ach");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [payDate, setPayDate] = useState<string | null>(null);
  const [fromEntity, setFromEntity] = useState(bill.entityId);
  const [bankOpen, setBankOpen] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setMethod(vendor?.paymentMethod ?? "ach");
    setWhen(bill.scheduledFor ? "later" : "now");
    setPayDate(bill.scheduledFor);
    setFromEntity(bill.entityId);
    setDateError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const total = billTotal(bill);
  const fee = method === "wire" ? 15 : method === "card" ? Math.round(total * 2.9) / 100 : 0;
  const from = entities.find((e) => e.id === fromEntity);
  const toLine =
    !vendor
      ? "No vendor"
      : method === "check"
        ? vendor.address
        : method === "card"
          ? `Card details emailed to ${vendor.email}`
          : `${bankName(vendor.routingNumber)} ${masked(last4(vendor.accountNumber))}`;

  const next = () => {
    if (step === 1 && when === "later" && !payDate) {
      setDateError("Pick the date the payment should go out.");
      return;
    }
    setDateError(null);
    setStep((s) => s + 1);
  };

  const confirm = async () => {
    setBusy(true);
    const scheduled = when === "later" && payDate;
    const ok = await act(
      () =>
        patch("bills", bill.id, scheduled ? { status: "scheduled", scheduledFor: payDate, paidAt: null } : { status: "paid", paidAt: new Date().toISOString(), scheduledFor: null }),
      { success: scheduled ? `Payment to ${vendor?.name} scheduled for ${date(payDate!)}` : `${money(total, bill.currency)} sent to ${vendor?.name}` },
    );
    setBusy(false);
    if (ok !== undefined) onOpenChange(false);
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={`Pay ${vendor?.name ?? "vendor"}`}
        description={`${bill.number}, ${money(total, bill.currency)} due ${date(bill.dueDate)}`}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[12.5px] text-ink-3">Step {step + 1} of 3</span>
            <div className="flex gap-2">
              {step > 0 ? <Button onClick={() => setStep((s) => s - 1)}>Back</Button> : <Button onClick={() => onOpenChange(false)}>Cancel</Button>}
              {step < 2 ? (
                <Button variant="primary" onClick={next}>
                  Continue
                </Button>
              ) : (
                <Button variant="primary" loading={busy} onClick={confirm}>
                  {when === "later" ? "Schedule payment" : "Confirm payment"}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <Stepper steps={STEPS} current={step} />

          {step === 0 ? (
            <div className="flex flex-col gap-4">
              <Field label="Payment method">
                {/* Radio cards: the label and the fee note are one accessible name. */}
                <RadioCards
                  value={method}
                  onValueChange={setMethod}
                  options={(Object.keys(METHOD_LABELS) as Vendor["paymentMethod"][]).map((m) => ({ value: m, label: METHOD_LABELS[m], description: METHOD_HINTS[m], icon: METHOD_ICONS[m] }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Pay from">
                  {(id) => (
                    <NativeSelect id={id} value={fromEntity} onChange={(e) => setFromEntity(e.target.value)}>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} operating {masked(e.bankLast4)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium">Pay to</span>
                  <div className="flex h-8 items-center justify-between gap-2 rounded-md border border-line bg-sunken px-2.5 text-[13px]">
                    <span className="truncate text-ink-2">{toLine}</span>
                    {method === "ach" || method === "wire" ? (
                      <Button variant="link" size="sm" onClick={() => setBankOpen(true)}>
                        Edit bank details
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <RadioCards
                value={when}
                onValueChange={setWhen}
                options={[
                  { value: "now", label: "Send today", description: `Leaves your account today. ${METHOD_HINTS[method]}`, icon: <Send /> },
                  { value: "later", label: "Schedule for later", description: "Pick the day the payment leaves your account.", icon: <CalendarClock /> },
                ]}
              />
              {when === "later" ? (
                <Field label="Payment date" error={dateError} hint={payDate ? `Should arrive by ${format(addDays(parseISO(payDate), method === "check" ? 7 : method === "ach" ? 3 : 1), "EEE, MMM d")}` : "Weekends and bank holidays move to the next business day."}>
                  {(id) => <DatePicker id={id} value={payDate} onChange={setPayDate} disabledBefore={addDays(new Date(), 1)} placeholder="Pick a date" />}
                </Field>
              ) : null}
              {bill.status === "overdue" ? (
                <Callout tone="warn" title="This bill is past due">
                  It was due {date(bill.dueDate)}. Some vendors charge late fees after 30 days.
                </Callout>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-line p-4">
                <DescriptionList
                  items={[
                    { label: "Vendor", value: vendor?.name },
                    { label: "Bill", value: bill.number },
                    { label: "Amount", value: <span className="tabular font-medium">{money(total, bill.currency)}</span> },
                    { label: "Fee", value: fee ? money(fee) : "None" },
                    { label: "Method", value: METHOD_LABELS[method] },
                    { label: "When", value: when === "later" && payDate ? date(payDate) : "Today" },
                    { label: "From", value: from ? `${from.name} ${masked(from.bankLast4)}` : "" },
                    { label: "To", value: toLine },
                  ]}
                />
              </div>
              {bill.status === "awaiting_approval" || bill.status === "draft" ? (
                <Callout tone="info" title="This bill hasn't been approved yet">
                  Paying it now records you as the approver.
                </Callout>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
      {/* Opens on top of the payment modal, on purpose: a modal inside a modal. */}
      {vendor ? <BankDetailsModal vendor={vendor} open={bankOpen} onOpenChange={setBankOpen} /> : null}
    </>
  );
}

export function BankDetailsModal({ vendor, open, onOpenChange }: { vendor: Vendor; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [routing, setRouting] = useState("");
  const [account, setAccount] = useState("");
  const [errors, setErrors] = useState<{ routing?: string; account?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setRouting("");
      setAccount("");
      setErrors({});
    }
  }, [open]);
  const save = async () => {
    const e: typeof errors = {};
    if (!/^\d{9}$/.test(routing)) e.routing = "Routing numbers are 9 digits.";
    if (!/^\d{4,17}$/.test(account)) e.account = "Enter 4 to 17 digits.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const ok = await act(() => patch("vendors", vendor.id, { routingNumber: routing, accountNumber: account }), { success: `Bank details for ${vendor.name} updated` });
    setBusy(false);
    if (ok !== undefined) onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Edit bank details"
      description={`Current account: ${masked(last4(vendor.accountNumber))}. We'll email ${vendor.name} to confirm the change.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save bank details
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Routing number" error={errors.routing}>
          {(id) => <Input id={id} inputMode="numeric" autoComplete="off" value={routing} onChange={(e) => setRouting(e.target.value.trim())} aria-invalid={!!errors.routing} />}
        </Field>
        <Field label="Account number" error={errors.account}>
          {(id) => <Input id={id} inputMode="numeric" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value.trim())} aria-invalid={!!errors.account} />}
        </Field>
      </div>
    </Modal>
  );
}
