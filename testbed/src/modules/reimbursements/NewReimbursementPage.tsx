import { differenceInCalendarDays, formatISO, parseISO } from "date-fns";
import { CalendarDays, Car, FileText, Plus, Receipt, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { get, ME_ID, newId, upsert, useCollection, useRow } from "@/data/store";
import { useFeature } from "@/lib/access";
import type { Currency, Reimbursement, ReimbursementKind } from "@/data/types";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Callout, Card, EmptyState, PageHeader } from "@/ui/display";
import { Checkbox, Field, Input, NativeSelect, RadioCards, Select, Switch, Textarea } from "@/ui/form";
import { act, PlanGate, UnsavedGuard } from "@/ui/flow";
import { Combobox, DatePicker, DateRangePicker, FileDrop } from "@/ui/inputs";
import { estimateMiles, MILEAGE_RATE, PER_DIEM_RATES, useExtras, type SplitLine } from "./shared";

// One form for all three kinds. The fields below the kind picker change with
// it, and Per diem is behind the Growth plan.

interface Form {
  kind: ReimbursementKind;
  merchant: string;
  amount: string;
  currency: Currency;
  date: string | null;
  categoryId: string | null;
  receiptName: string | null;
  memo: string;
  split: boolean;
  lines: { categoryId: string; amount: string; memo: string }[];
  origin: string;
  destination: string;
  roundTrip: boolean;
  manualMiles: boolean;
  miles: string;
  tolls: boolean;
  tollAmount: string;
  city: string;
  from: string | null;
  to: string | null;
  mealsProvided: string;
}

const today = () => formatISO(new Date(), { representation: "date" });

function blank(kind: ReimbursementKind): Form {
  return {
    kind,
    merchant: "",
    amount: "",
    currency: "USD",
    date: today(),
    categoryId: null,
    receiptName: null,
    memo: "",
    split: false,
    lines: [
      { categoryId: "", amount: "", memo: "" },
      { categoryId: "", amount: "", memo: "" },
    ],
    origin: "",
    destination: "",
    roundTrip: false,
    manualMiles: false,
    miles: "",
    tolls: false,
    tollAmount: "",
    city: "",
    from: null,
    to: null,
    mealsProvided: "0",
  };
}

/** Keep the miles a saved trip had when the route estimate disagrees with them. */
function manualFrom(r: Reimbursement, roundTrip: boolean): Partial<Form> {
  if (r.kind !== "mileage" || !r.miles || !r.origin || !r.destination) return {};
  const oneWay = r.miles / (roundTrip ? 2 : 1);
  return oneWay === estimateMiles(r.origin, r.destination) ? {} : { manualMiles: true, miles: String(oneWay) };
}

type Errors = Partial<Record<keyof Form | "lineTotal", string>>;

export function NewReimbursementPage() {
  const { id } = useParams();
  const existing = useRow("reimbursements", id);
  if (id && !existing)
    return (
      <>
        <PageHeader title="Reimbursement not found" crumbs={[{ label: "Reimbursements", to: "/reimbursements" }, { label: "Not found" }]} />
        <EmptyState title="This reimbursement doesn't exist" description="It may have been deleted, or the link is wrong." />
      </>
    );
  if (existing && existing.employeeId !== ME_ID)
    return (
      <>
        <PageHeader title="You can't edit this" crumbs={[{ label: "Reimbursements", to: "/reimbursements" }, { label: "Edit" }]} />
        <Callout tone="warn" title="Only the person who asked to be paid back can edit a reimbursement">
          Leave a comment on it instead. <Link to={`/reimbursements/${existing.id}`} className="font-medium text-brand hover:underline">Back to the reimbursement</Link>
        </Callout>
      </>
    );
  return <ReimbursementForm existing={existing} key={id ?? "new"} />;
}

function ReimbursementForm({ existing }: { existing?: Reimbursement }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const categories = useCollection("categories");
  const perDiem = useFeature("perDiem");
  const extras = useExtras();
  const initial = useMemo<Form>(() => {
    const kindParam = params.get("kind");
    if (!existing) return blank(kindParam === "mileage" || kindParam === "per_diem" ? kindParam : "out_of_pocket");
    const pd = extras.perDiem[existing.id];
    const split = extras.splits[existing.id];
    return {
      ...blank(existing.kind),
      merchant: existing.kind === "out_of_pocket" ? existing.merchant : "",
      amount: String(existing.amount),
      currency: existing.currency,
      date: existing.date,
      categoryId: existing.categoryId,
      receiptName: existing.receipt === "attached" ? (extras.receiptNames[existing.id] ?? "receipt.pdf") : null,
      memo: existing.memo,
      split: !!split?.length,
      lines: split?.length ? split.map((l) => ({ categoryId: l.categoryId, amount: String(l.amount), memo: l.memo })) : blank("out_of_pocket").lines,
      origin: existing.origin ?? "",
      destination: existing.destination ?? "",
      roundTrip: !!extras.roundTrip[existing.id],
      ...manualFrom(existing, !!extras.roundTrip[existing.id]),
      city: pd?.city ?? "",
      from: pd?.from ?? null,
      to: pd?.to ?? null,
      mealsProvided: String(pd?.mealsProvided ?? 0),
    };
    // Only on first render: later store changes shouldn't reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [f, setF] = useState<Form>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const dirty = !savedId && JSON.stringify(f) !== JSON.stringify(initial);

  useEffect(() => {
    if (savedId) navigate(`/reimbursements/${savedId}`);
  }, [savedId, navigate]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const categoryOptions = categories.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }));

  // Mileage
  const autoMiles = estimateMiles(f.origin, f.destination);
  const oneWay = f.manualMiles ? Number(f.miles) || 0 : autoMiles;
  const totalMiles = oneWay * (f.roundTrip ? 2 : 1);
  const mileageAmount = Math.round(totalMiles * MILEAGE_RATE * 100) / 100 + (f.tolls ? Number(f.tollAmount) || 0 : 0);

  // Per diem
  const rate = PER_DIEM_RATES.find((r) => r.city === f.city)?.rate ?? 0;
  const days = f.from && f.to ? differenceInCalendarDays(parseISO(f.to), parseISO(f.from)) + 1 : 0;
  const mealDeduction = days <= 0 ? 0 : Math.round(rate * 0.25 * (Number(f.mealsProvided) || 0) * 100) / 100;
  const perDiemAmount = Math.max(0, rate * days - mealDeduction);

  const total = f.kind === "mileage" ? mileageAmount : f.kind === "per_diem" ? perDiemAmount : Number(f.amount) || 0;
  const lineTotal = f.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const validate = (submitting: boolean): Errors => {
    const e: Errors = {};
    if (f.kind === "out_of_pocket") {
      if (submitting && !f.merchant.trim()) e.merchant = "Enter where you paid.";
      if (f.amount && !(Number(f.amount) > 0)) e.amount = "Enter an amount above zero.";
      if (submitting && !f.amount) e.amount = "Enter the amount you paid.";
      if (submitting && !f.date) e.date = "Pick the date you paid.";
      if (submitting && !f.split && !f.categoryId) e.categoryId = "Pick a category.";
      if (submitting && Number(f.amount) > 75 && !f.receiptName) e.receiptName = "Purchases over $75 need a receipt.";
      if (submitting && f.split) {
        if (f.lines.some((l) => !l.categoryId || !(Number(l.amount) > 0))) e.lineTotal = "Every line needs a category and an amount.";
        else if (Math.abs(lineTotal - (Number(f.amount) || 0)) > 0.005) e.lineTotal = `The lines add up to ${money(lineTotal)}, not ${money(Number(f.amount) || 0)}.`;
      }
    }
    if (f.kind === "mileage" && submitting) {
      if (!f.origin.trim()) e.origin = "Enter where you started.";
      if (!f.destination.trim()) e.destination = "Enter where you drove to.";
      if (f.manualMiles && !(Number(f.miles) > 0)) e.miles = "Enter the miles you drove.";
      if (!f.date) e.date = "Pick the date of the trip.";
      if (!f.memo.trim()) e.memo = "Say what the trip was for, like the client you visited.";
      if (f.tolls && !(Number(f.tollAmount) > 0)) e.tollAmount = "Enter the tolls and parking total.";
    }
    if (f.kind === "per_diem" && submitting) {
      if (!f.city) e.city = "Pick where you traveled.";
      if (!f.from || !f.to) e.from = "Pick the first and last day of the trip.";
    }
    return e;
  };

  const save = async (submitting: boolean) => {
    const e = validate(submitting);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(submitting ? "submit" : "draft");
    const id = existing?.id ?? newId("rmb");
    const at = formatISO(new Date());
    const record: Reimbursement = {
      id,
      employeeId: ME_ID,
      kind: f.kind,
      merchant: f.kind === "mileage" ? "Mileage" : f.kind === "per_diem" ? "Per diem" : f.merchant.trim() || "Untitled expense",
      amount: total,
      currency: f.kind === "out_of_pocket" ? f.currency : "USD",
      date: (f.kind === "per_diem" ? f.from : f.date) ?? today(),
      categoryId:
        f.kind === "mileage"
          ? (categories.find((c) => c.name === "Ground transport")?.id ?? null)
          : f.kind === "per_diem"
            ? (categories.find((c) => c.name === "Meals")?.id ?? null)
            : f.split
              ? (f.lines[0]?.categoryId ?? null)
              : f.categoryId,
      memo: f.kind === "per_diem" && !f.memo ? `${f.city}, ${days} ${days === 1 ? "day" : "days"}` : f.memo.trim(),
      status: submitting ? "submitted" : "draft",
      miles: f.kind === "mileage" ? totalMiles : null,
      origin: f.kind === "mileage" ? f.origin.trim() : null,
      destination: f.kind === "mileage" ? f.destination.trim() : null,
      receipt: f.receiptName ? "attached" : "missing",
      submittedAt: submitting ? at : null,
    };
    await act(
      () => {
        upsert("reimbursements", record);
        extras.setExtra({
          splits: { [id]: f.kind === "out_of_pocket" && f.split ? f.lines.map<SplitLine>((l) => ({ categoryId: l.categoryId, amount: Number(l.amount) || 0, memo: l.memo })) : [] },
          roundTrip: { [id]: f.kind === "mileage" && f.roundTrip },
          ...(f.receiptName ? { receiptNames: { [id]: f.receiptName } } : {}),
          ...(f.kind === "per_diem" && f.from && f.to ? { perDiem: { [id]: { from: f.from, to: f.to, city: f.city, mealsProvided: Number(f.mealsProvided) || 0 } } } : {}),
        });
        if (!existing) extras.log(id, { label: "Created", by: ME_ID, at });
        if (submitting) extras.log(id, { label: existing?.status === "rejected" ? "Resubmitted for approval" : "Submitted for approval", by: ME_ID, at });
      },
      { success: submitting ? "Submitted. Your manager will review it." : "Saved as a draft" },
    );
    setBusy(null);
    if (get("reimbursements", id)?.status === record.status) setSavedId(id);
  };

  const locked = f.kind === "per_diem" && !perDiem.enabled;
  const editing = !!existing;
  const title = editing ? "Edit reimbursement" : f.kind === "mileage" ? "Log mileage" : "New reimbursement";

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: "Reimbursements", to: "/reimbursements" }, ...(existing ? [{ label: existing.merchant, to: `/reimbursements/${existing.id}` }] : []), { label: editing ? "Edit" : "New" }]}
        description="Paid with your own money? Add it here. Approved reimbursements are paid with the next payroll."
      />
      <UnsavedGuard when={dirty} />
      <div className="flex max-w-3xl flex-col gap-5 pb-24">
        {existing?.status === "rejected" ? (
          <Callout tone="danger" title="This was sent back">
            Fix what your approver asked for, then submit it again.
          </Callout>
        ) : null}
        <Card title="What are you claiming?">
          <RadioCards
            value={f.kind}
            onValueChange={(v) => set("kind", v)}
            columns={3}
            options={[
              { value: "out_of_pocket", label: "Out of pocket", description: "Something you bought yourself", icon: <Receipt /> },
              { value: "mileage", label: "Mileage", description: `Driving your own car, ${money(MILEAGE_RATE)} a mile`, icon: <Car /> },
              { value: "per_diem", label: "Per diem", description: "A daily allowance for a work trip", icon: <CalendarDays /> },
            ]}
          />
        </Card>

        {f.kind === "out_of_pocket" ? (
          <>
            <Card title="Purchase">
              <div className="flex flex-col gap-4">
                <Field label="Merchant" error={errors.merchant}>
                  {(id) => <Input id={id} value={f.merchant} onChange={(e) => set("merchant", e.target.value)} placeholder="e.g. Metro Rideshare" aria-invalid={!!errors.merchant} />}
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_110px_1fr]">
                  <Field label="Amount" error={errors.amount}>
                    {(id) => <Input id={id} inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" aria-invalid={!!errors.amount} />}
                  </Field>
                  <Field label="Currency">
                    {(id) => (
                      <NativeSelect id={id} value={f.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
                        <option value="USD">USD</option>
                        <option value="GBP">GBP</option>
                        <option value="EUR">EUR</option>
                      </NativeSelect>
                    )}
                  </Field>
                  <Field label="Date" error={errors.date}>
                    {(id) => <DatePicker id={id} value={f.date} onChange={(v) => set("date", v)} />}
                  </Field>
                </div>
                {f.split ? null : (
                  <Field label="Category" error={errors.categoryId}>
                    {(id) => <Combobox id={id} aria-label="Category" value={f.categoryId} onChange={(v) => set("categoryId", v)} options={categoryOptions} placeholder="Pick a category" searchPlaceholder="Search categories…" />}
                  </Field>
                )}
                <Field label="Memo" optional>
                  {(id) => <Textarea id={id} value={f.memo} onChange={(e) => set("memo", e.target.value)} placeholder="Who was there, or what it was for" />}
                </Field>
              </div>
            </Card>

            <Card title="Receipt" description="Required for anything over $75. Photos and PDFs both work.">
              {f.receiptName ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
                  <span className="flex items-center gap-2 text-[13px]">
                    <FileText className="size-4 text-ink-3" /> {f.receiptName}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => set("receiptName", null)}>
                    <X /> Remove receipt
                  </Button>
                </div>
              ) : (
                <>
                  {/* The real file input is hidden inside the drop zone, like most apps. */}
                  <FileDrop label="Upload receipt" hint="Drop a file here, or click to browse. JPG, PNG or PDF up to 10 MB." accept="image/*,.pdf" onFiles={(files) => files[0] && set("receiptName", files[0].name)} />
                  {errors.receiptName ? <p className="mt-2 text-xs text-danger">{errors.receiptName}</p> : null}
                </>
              )}
            </Card>

            <Card title="Split" description="Divide one receipt across categories, like a hotel bill with a room and a dinner.">
              <div className="flex flex-col gap-4">
                <Switch checked={f.split} onCheckedChange={(v) => set("split", v)} label="Split across categories" />
                {f.split ? (
                  <div className="flex flex-col gap-2">
                    {f.lines.map((line, i) => (
                      // On a phone: the category and the way to remove the line, then the amount and the note under them.
                      <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] items-end gap-2 sm:grid-cols-[1fr_130px_1fr_32px]">
                        <Field label={`Line ${i + 1} category`} className="max-sm:col-span-2">
                          {(id) => (
                            <Select
                              id={id}
                              aria-label={`Line ${i + 1} category`}
                              value={line.categoryId}
                              onValueChange={(v) => set("lines", f.lines.map((l, j) => (j === i ? { ...l, categoryId: v } : l)))}
                              options={categoryOptions}
                              placeholder="Category"
                            />
                          )}
                        </Field>
                        <Field label="Amount" className="max-sm:col-start-1 max-sm:row-start-2">
                          {(id) => <Input id={id} inputMode="decimal" value={line.amount} onChange={(e) => set("lines", f.lines.map((l, j) => (j === i ? { ...l, amount: e.target.value.replace(/[^\d.]/g, "") } : l)))} />}
                        </Field>
                        <Field label="Note" optional className="max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2">
                          {(id) => <Input id={id} value={line.memo} onChange={(e) => set("lines", f.lines.map((l, j) => (j === i ? { ...l, memo: e.target.value } : l)))} />}
                        </Field>
                        {/* Icon-only, the tooltip says "Remove line". */}
                        <IconButton
                          icon={<Trash2 />}
                          label="Remove line"
                          size="icon"
                          className="max-sm:col-start-3 max-sm:row-start-1"
                          disabled={f.lines.length <= 2}
                          onClick={() => set("lines", f.lines.filter((_, j) => j !== i))}
                        />
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1">
                      <Button size="sm" variant="ghost" onClick={() => set("lines", [...f.lines, { categoryId: "", amount: "", memo: "" }])}>
                        <Plus /> Add line
                      </Button>
                      <span className={cn("tabular text-[12.5px]", Math.abs(lineTotal - (Number(f.amount) || 0)) > 0.005 ? "text-warn" : "text-ok")}>
                        {money(lineTotal, f.currency)} of {money(Number(f.amount) || 0, f.currency)} assigned
                      </span>
                    </div>
                    {errors.lineTotal ? <p className="text-xs text-danger">{errors.lineTotal}</p> : null}
                  </div>
                ) : null}
              </div>
            </Card>
          </>
        ) : null}

        {f.kind === "mileage" ? (
          <Card title="Trip" description={`Northpine pays ${money(MILEAGE_RATE)} a mile, the 2026 IRS rate. Miles are worked out from the route.`}>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="From" error={errors.origin}>
                  {(id) => <Input id={id} value={f.origin} onChange={(e) => set("origin", e.target.value)} placeholder="e.g. Portland, OR" aria-invalid={!!errors.origin} />}
                </Field>
                <Field label="To" error={errors.destination}>
                  {(id) => <Input id={id} value={f.destination} onChange={(e) => set("destination", e.target.value)} placeholder="e.g. Salem, OR" aria-invalid={!!errors.destination} />}
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Date" error={errors.date}>
                  {(id) => <DatePicker id={id} value={f.date} onChange={(v) => set("date", v)} />}
                </Field>
                <div className="flex items-end pb-1.5">
                  <Switch checked={f.roundTrip} onCheckedChange={(v) => set("roundTrip", v)} label="Round trip" description="Counts the miles twice" />
                </div>
              </div>
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-sunken/50 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-ink-2">
                    {f.manualMiles ? "Miles you entered" : "Calculated distance"}
                    {f.roundTrip ? ", both ways" : ""}
                  </span>
                  <span className="tabular text-[15px] font-semibold">{totalMiles} mi</span>
                </div>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-ink-2">
                    {totalMiles} mi × {money(MILEAGE_RATE)}
                    {f.tolls && Number(f.tollAmount) ? ` + ${money(Number(f.tollAmount))} tolls and parking` : ""}
                  </span>
                  <span className="tabular font-semibold text-ink">{money(mileageAmount)}</span>
                </div>
                <Checkbox checked={f.manualMiles} onCheckedChange={(v) => set("manualMiles", v)} label="The route was different. Enter miles myself" />
                {/* Appears only when the box above is checked. */}
                {f.manualMiles ? (
                  <Field label="Miles one way" error={errors.miles}>
                    {(id) => <Input id={id} inputMode="numeric" value={f.miles} onChange={(e) => set("miles", e.target.value.replace(/[^\d.]/g, ""))} className="w-40" />}
                  </Field>
                ) : null}
              </div>
              <Switch checked={f.tolls} onCheckedChange={(v) => set("tolls", v)} label="Add tolls and parking" description="Keep the receipts. Finance may ask for them." />
              {f.tolls ? (
                <Field label="Tolls and parking" error={errors.tollAmount}>
                  {(id) => <Input id={id} prefix="$" inputMode="decimal" value={f.tollAmount} onChange={(e) => set("tollAmount", e.target.value.replace(/[^\d.]/g, ""))} className="w-40" />}
                </Field>
              ) : null}
              <Field label="Business purpose" error={errors.memo} hint="Who you visited and why. Commutes to your usual office aren't covered.">
                {(id) => <Input id={id} value={f.memo} onChange={(e) => set("memo", e.target.value)} placeholder="e.g. Client visit, Harborview Hotels" aria-invalid={!!errors.memo} />}
              </Field>
            </div>
          </Card>
        ) : null}

        {f.kind === "per_diem" ? (
          <PlanGate feature="perDiem" title="Per diem">
            <Card title="Trip" description="A fixed daily amount for meals and incidentals. No receipts needed.">
              <div className="flex flex-col gap-4">
                <Field label="Destination" error={errors.city}>
                  {(id) => (
                    <Select
                      id={id}
                      aria-label="Destination"
                      value={f.city}
                      onValueChange={(v) => set("city", v)}
                      placeholder="Where did you go?"
                      options={PER_DIEM_RATES.map((r) => ({ value: r.city, label: `${r.city}, ${money(r.rate)} a day` }))}
                    />
                  )}
                </Field>
                <Field label="Trip dates" error={errors.from}>
                  {() => (
                    <div>
                      <DateRangePicker value={{ from: f.from, to: f.to }} onChange={(r) => setF((x) => ({ ...x, from: r.from, to: r.to }))} />
                    </div>
                  )}
                </Field>
                <Field label="Meals provided" hint="Breakfasts, lunches or dinners someone else paid for. Each takes a quarter of a day off.">
                  {(id) => <Input id={id} inputMode="numeric" value={f.mealsProvided} onChange={(e) => set("mealsProvided", e.target.value.replace(/\D/g, ""))} className="w-24" />}
                </Field>
                <div className="flex items-baseline justify-between rounded-lg border border-line bg-sunken/50 p-4 text-[13px]">
                  <span className="text-ink-2">
                    {days} {days === 1 ? "day" : "days"} × {money(rate)}
                    {mealDeduction ? ` minus ${money(mealDeduction)} for meals` : ""}
                  </span>
                  <span className="tabular text-[15px] font-semibold">{money(perDiemAmount)}</span>
                </div>
              </div>
            </Card>
          </PlanGate>
        ) : null}
      </div>

      {/* Fixed to the bottom of the screen, covering whatever form field scrolls under it. On purpose. */}
      <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-line bg-panel/95 py-3 pr-4 pl-16 backdrop-blur md:left-[var(--sidebar-w,0px)] md:pr-8 md:pl-8">
        <div className="mx-auto flex max-w-[1336px] items-center justify-end gap-4">
          <span className="text-[13px] text-ink-2">
            Total <span className="tabular ml-1 text-[15px] font-semibold text-ink">{money(total, f.kind === "out_of_pocket" ? f.currency : "USD")}</span>
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" asChild>
              <Link to={existing ? `/reimbursements/${existing.id}` : "/reimbursements"}>Cancel</Link>
            </Button>
            <Button loading={busy === "draft"} disabled={!!busy || locked} onClick={() => save(false)}>
              Save as draft
            </Button>
            <Button variant="primary" loading={busy === "submit"} disabled={!!busy || locked} onClick={() => save(true)}>
              Submit for approval
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
