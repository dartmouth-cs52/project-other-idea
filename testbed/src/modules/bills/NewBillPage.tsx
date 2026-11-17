import { format } from "date-fns";
import { FileText, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { newId, upsert, useCollection, useIndex } from "@/data/store";
import type { Bill, BillLine } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { Button, IconButton, Spinner } from "@/ui/button";
import { Callout, Card, PageHeader } from "@/ui/display";
import { act, Loader, UnsavedGuard } from "@/ui/flow";
import { Field, Input, NativeSelect, Select, Textarea } from "@/ui/form";
import { Combobox, DatePicker, FileDrop } from "@/ui/inputs";
import { dueFromTerms, requestApproval } from "./shared";
import { VendorPicker } from "./VendorPicker";

type Line = Omit<BillLine, "quantity" | "unitPrice"> & { quantity: string; unitPrice: string };
const blankLine = (): Line => ({ id: newId("line"), description: "", quantity: "1", unitPrice: "", glAccountId: "", departmentId: "" });

export function NewBillPage() {
  return (
    <>
      <PageHeader title="New bill" description="Upload the invoice, check what we read from it, and send it for approval." crumbs={[{ label: "Bills", to: "/bills" }, { label: "New bill" }]} />
      <Loader loadKey="bills-new" rows={8}>
        {() => <NewBillForm />}
      </Loader>
    </>
  );
}

function NewBillForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const can = useCan("bills.create");
  const entities = useCollection("entities");
  const vendors = useIndex("vendors");
  const glAccounts = useCollection("glAccounts");
  const departments = useCollection("departments");

  const today = format(new Date(), "yyyy-MM-dd");
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(params.get("vendor"));
  const [number, setNumber] = useState("");
  const [issueDate, setIssueDate] = useState<string | null>(today);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [entityId, setEntityId] = useState("ent_us");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [tax, setTax] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<null | "draft" | "submit">(null);
  const [saved, setSaved] = useState(false);

  // Fill the due date from the vendor's terms when it isn't set yet.
  useEffect(() => {
    const v = vendorId ? vendors.get(vendorId) : undefined;
    if (v && issueDate && !dueDate) setDueDate(dueFromTerms(issueDate, v.terms));
  }, [vendorId, issueDate, dueDate, vendors]);

  const glOptions = useMemo(
    () =>
      glAccounts
        .filter((g) => g.active && (g.type === "expense" || g.type === "asset") && g.parentId)
        .map((g) => ({ value: g.id, label: `${g.code} ${g.name}`, group: g.type === "expense" ? "Expenses" : "Assets" })),
    [glAccounts],
  );
  const depOptions = departments.map((d) => ({ value: d.id, label: d.name }));
  const currency = entities.find((e) => e.id === entityId)?.currency ?? "USD";

  const lineAmount = (l: Line) => (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
  const subtotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const total = subtotal + (Number(tax) || 0);
  const dirty = !saved && !!(file || vendorId || number || memo || lines.some((l) => l.description || l.unitPrice));

  const setLine = (id: string, fields: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...fields } : l)));

  const onFile = (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setScanning(true);
    // Pretend to read the invoice, then fill what a real OCR would find.
    setTimeout(() => {
      setScanning(false);
      setNumber((n) => n || `INV-${Math.floor(10000 + Math.random() * 89999)}`);
      setLines((ls) => (ls.length === 1 && !ls[0].description ? [{ ...ls[0], description: f.name.replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ") }] : ls));
    }, 1200);
  };

  const validate = (submit: boolean) => {
    const e: Record<string, string> = {};
    if (!vendorId) e.vendor = "Choose who sent this bill.";
    if (!number.trim()) e.number = "Enter the bill number from the invoice.";
    if (!issueDate) e.issueDate = "Enter the invoice date.";
    if (!dueDate) e.dueDate = "Enter the due date.";
    if (issueDate && dueDate && dueDate < issueDate) e.dueDate = "The due date can't be before the invoice date.";
    lines.forEach((l, i) => {
      if (!l.description.trim()) e[`line-${l.id}-description`] = `Line ${i + 1} needs a description.`;
      if (!(lineAmount(l) > 0)) e[`line-${l.id}-amount`] = `Line ${i + 1} needs a quantity and price.`;
      if (submit && !l.glAccountId) e[`line-${l.id}-gl`] = `Line ${i + 1} needs a GL account.`;
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (mode: "draft" | "submit") => {
    if (!validate(mode === "submit")) return;
    setSaving(mode);
    const bill: Bill = {
      id: newId("bill"),
      number: number.trim(),
      vendorId: vendorId!,
      entityId,
      issueDate: issueDate!,
      dueDate: dueDate!,
      currency,
      status: mode === "submit" ? "awaiting_approval" : "draft",
      lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
      scheduledFor: null,
      paidAt: null,
      memo,
      attachmentName: file?.name ?? null,
      poNumber: poNumber.trim() || null,
    };
    const vendor = vendors.get(bill.vendorId);
    const ok = await act(
      () => {
        upsert("bills", bill);
        if (mode === "submit") requestApproval("bill", bill.id, `Bill from ${vendor?.name}`, total);
        return true;
      },
      { success: mode === "submit" ? `${bill.number} sent for approval` : `${bill.number} saved to your inbox` },
    );
    setSaving(null);
    if (ok) {
      setSaved(true);
      setTimeout(() => navigate(`/bills/${bill.id}`), 0);
    }
  };

  const errorList = Object.values(errors);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <UnsavedGuard when={dirty} />
      <div className="flex flex-col gap-4">
        <Card title="Invoice" description="PDF, PNG or JPG up to 20 MB">
          {file ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 rounded-md border border-line p-3">
                <FileText className="size-5 text-ink-3" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium">{file.name}</span>
                  <span className="text-xs text-ink-3">{(file.size / 1024).toFixed(0)} KB</span>
                </span>
                <IconButton size="icon-sm" icon={<X />} label="Remove file" onClick={() => setFile(null)} />
              </div>
              {scanning ? (
                <p aria-busy="true" className="flex items-center gap-2 text-[12.5px] text-ink-3">
                  <Spinner /> Reading the invoice…
                </p>
              ) : (
                <Callout tone="ok">We read the bill number and description. Check them before you save.</Callout>
              )}
            </div>
          ) : (
            <FileDrop onFiles={onFile} accept=".pdf,.png,.jpg,.jpeg" label="Upload invoice" hint="Drop the PDF here, or click to browse" id="bill-file" />
          )}
        </Card>
        <Card>
          <p className="text-[13px] text-ink-2">
            Vendors can also email invoices to <span className="font-mono text-[12.5px] text-ink">bills+northpine@inbox.example</span>. They land in the{" "}
            <Link to="/bills" className="font-medium text-brand hover:underline">
              Inbox
            </Link>
            .
          </p>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {!can.allowed ? <Callout tone="warn" title="You can't add bills">{can.reason}</Callout> : null}
        {errorList.length ? (
          <div role="alert">
            <Callout tone="danger" title={`Fix ${errorList.length} ${errorList.length === 1 ? "thing" : "things"} before saving`}>
              <ul className="list-disc pl-4">
                {errorList.slice(0, 5).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Callout>
          </div>
        ) : null}

        <Card title="Bill details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vendor" error={errors.vendor}>
              {(id) => <VendorPicker id={id} value={vendorId} onChange={setVendorId} invalid={!!errors.vendor} />}
            </Field>
            <Field label="Bill number" error={errors.number}>
              {(id) => <Input id={id} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INV-00123" aria-invalid={!!errors.number} />}
            </Field>
            <Field label="Invoice date" error={errors.issueDate}>
              {(id) => <DatePicker id={id} value={issueDate} onChange={setIssueDate} />}
            </Field>
            <Field label="Due date" error={errors.dueDate} hint={vendorId ? "Filled in from the vendor's payment terms." : undefined}>
              {(id) => <DatePicker id={id} value={dueDate} onChange={setDueDate} />}
            </Field>
            <Field label="Entity" hint={`Bills in ${currency}`}>
              {(id) => (
                <NativeSelect id={id} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="PO number" optional>
              {(id) => <Input id={id} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-1234" />}
            </Field>
          </div>
        </Card>

        <Card
          title="Line items"
          description="Each line posts to its own GL account and department."
          bodyClassName="p-0"
          footer={
            <div className="flex flex-wrap items-start justify-between gap-4">
              <Button size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                <Plus /> Add line
              </Button>
              <dl className="grid min-w-56 grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1.5 text-[13px]">
                <dt className="text-ink-3">Subtotal</dt>
                <dd className="tabular text-right">{money(subtotal, currency)}</dd>
                <dt className="text-ink-3">
                  <label htmlFor="bill-tax">Tax</label>
                </dt>
                <dd>
                  <Input id="bill-tax" inputMode="decimal" className="h-7 w-28 text-right" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" />
                </dd>
                <dt className="font-semibold">Total</dt>
                <dd className="tabular text-right text-[15px] font-semibold">{money(total, currency)}</dd>
              </dl>
            </div>
          }
        >
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="bg-sunken text-left text-[12px] text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="w-16 px-2 py-2 font-medium">Qty</th>
                  <th className="w-28 px-2 py-2 font-medium">Unit price</th>
                  <th className="w-56 px-2 py-2 font-medium">GL account</th>
                  <th className="w-40 px-2 py-2 font-medium">Department</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2">
                      <Input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} aria-invalid={!!errors[`line-${l.id}-description`]} placeholder="What was billed" />
                    </td>
                    <td className="px-2 py-2">
                      <Input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(l.id, { quantity: e.target.value })} aria-invalid={!!errors[`line-${l.id}-amount`]} />
                    </td>
                    <td className="px-2 py-2">
                      <Input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" prefix="$" value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: e.target.value })} aria-invalid={!!errors[`line-${l.id}-amount`]} placeholder="0.00" />
                    </td>
                    <td className="px-2 py-2">
                      <Combobox
                        aria-label={`Line ${i + 1} GL account`}
                        value={l.glAccountId || null}
                        onChange={(v) => setLine(l.id, { glAccountId: v })}
                        options={glOptions}
                        placeholder="Choose account"
                        searchPlaceholder="Search by code or name…"
                        className={cn(errors[`line-${l.id}-gl`] && "border-danger")}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Select aria-label={`Line ${i + 1} department`} value={l.departmentId} onValueChange={(v) => setLine(l.id, { departmentId: v })} options={depOptions} placeholder="None" />
                    </td>
                    <td className="tabular px-2 py-3 text-right">{money(lineAmount(l), currency)}</td>
                    <td className="py-2 pr-2">
                      <IconButton size="icon-sm" icon={<Trash2 />} label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Notes">
          <Field label="Memo" optional hint="Visible to approvers and synced to Ledgerbook.">
            {(id) => <Textarea id={id} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What this bill is for" />}
          </Field>
        </Card>

        <div className="flex items-center justify-end gap-2 pb-4">
          <Button asChild variant="ghost">
            <Link to="/bills">Cancel</Link>
          </Button>
          <Button disabled={!can.allowed} loading={saving === "draft"} onClick={() => save("draft")}>
            Save as draft
          </Button>
          <Button variant="primary" disabled={!can.allowed} loading={saving === "submit"} onClick={() => save("submit")}>
            Submit for approval
          </Button>
        </div>
      </div>
    </div>
  );
}
