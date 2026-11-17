import { FileCheck2, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ME_ID, newId, upsert, useCollection } from "@/data/store";
import type { Vendor } from "@/data/types";
import { useCan } from "@/lib/access";
import { fullName, masked } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Callout, Card, DescriptionList, PageHeader } from "@/ui/display";
import { act, Loader, Stepper, UnsavedGuard } from "@/ui/flow";
import { Checkbox, Field, Input, NativeSelect, RadioCards, Select, Textarea } from "@/ui/form";
import { Combobox, FileDrop } from "@/ui/inputs";
import { last4, METHOD_HINTS, METHOD_ICONS, METHOD_LABELS, requestApproval, TERMS_LABELS, VENDOR_CATEGORIES } from "./shared";

const STEPS = ["Details", "Payment method", "Tax info", "Review"];

interface Form {
  name: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  category: string;
  terms: Vendor["terms"];
  ownerId: string;
  method: Vendor["paymentMethod"];
  routing: string;
  account: string;
  accountType: "checking" | "savings";
  swift: string;
  iban: string;
  bankCountry: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  taxId: string;
  w9: File | null;
  w9Later: boolean;
  notes: string;
}

const EMPTY: Form = {
  name: "",
  legalName: "",
  email: "",
  phone: "",
  website: "",
  category: "",
  terms: "net30",
  ownerId: ME_ID,
  method: "ach",
  routing: "",
  account: "",
  accountType: "checking",
  swift: "",
  iban: "",
  bankCountry: "United Kingdom",
  street: "",
  city: "",
  state: "",
  zip: "",
  taxId: "",
  w9: null,
  w9Later: false,
  notes: "",
};

export function NewVendorPage() {
  return (
    <>
      <PageHeader title="Add vendor" description="New vendors go to Finance for approval before anyone can pay them." crumbs={[{ label: "Vendors", to: "/bills/vendors" }, { label: "Add vendor" }]} />
      <Loader loadKey="vendor-new" rows={6}>
        {() => <Wizard />}
      </Loader>
    </>
  );
}

function Wizard() {
  const navigate = useNavigate();
  const can = useCan("vendors.manage");
  const employees = useCollection("employees");
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = !done && JSON.stringify({ ...f, w9: !!f.w9 }) !== JSON.stringify({ ...EMPTY, w9: false });

  const finance = employees.filter((e) => e.departmentId === "dep_finance" || e.id === ME_ID).map((e) => ({ value: e.id, label: fullName(e), hint: e.title }));

  const validate = (s: number) => {
    const e: typeof errors = {};
    if (s === 0) {
      if (!f.name.trim()) e.name = "Enter the vendor's name.";
      if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Enter the email invoices come from.";
      if (!f.category) e.category = "Pick a category.";
    }
    if (s === 1) {
      if (f.method === "ach") {
        if (!/^\d{9}$/.test(f.routing)) e.routing = "Routing numbers are 9 digits.";
        if (!/^\d{4,17}$/.test(f.account)) e.account = "Enter 4 to 17 digits.";
      }
      if (f.method === "wire") {
        if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(f.swift.toUpperCase())) e.swift = "SWIFT codes are 8 or 11 letters and numbers.";
        if (f.iban.replace(/\s/g, "").length < 15) e.iban = "Enter the full IBAN.";
      }
      if (f.method === "check") {
        if (!f.street.trim()) e.street = "Enter the street address.";
        if (!f.city.trim()) e.city = "Enter the city.";
        if (!/^\d{5}$/.test(f.zip)) e.zip = "Enter a 5-digit ZIP code.";
      }
    }
    if (s === 2) {
      if (!/^\d{2}-?\d{7}$/.test(f.taxId)) e.taxId = "Enter the 9-digit EIN, like 12-3456789.";
      if (!f.w9 && !f.w9Later) e.w9 = "Upload the W-9, or tick the box to collect it later.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validate(step)) setStep((s) => s + 1);
  };

  const submit = async () => {
    setBusy(true);
    const vendor: Vendor = {
      id: newId("ven"),
      name: f.name.trim(),
      legalName: f.legalName.trim() || f.name.trim(),
      email: f.email,
      phone: f.phone,
      website: f.website,
      category: f.category,
      paymentMethod: f.method,
      routingNumber: f.method === "ach" ? f.routing : f.method === "wire" ? f.swift.toUpperCase() : "",
      accountNumber: f.method === "ach" ? f.account : f.method === "wire" ? f.iban.replace(/\s/g, "") : "",
      taxId: f.taxId.includes("-") ? f.taxId : `${f.taxId.slice(0, 2)}-${f.taxId.slice(2)}`,
      w9OnFile: !!f.w9,
      address: f.method === "check" ? `${f.street}, ${f.city}, ${f.state} ${f.zip}` : "",
      ownerId: f.ownerId,
      status: "pending_review",
      terms: f.terms,
      createdAt: new Date().toISOString(),
    };
    const ok = await act(
      () => {
        upsert("vendors", vendor);
        requestApproval("vendor", vendor.id, `Add vendor ${vendor.name}`);
        return true;
      },
      { success: `${vendor.name} sent to Finance for approval` },
    );
    setBusy(false);
    if (ok) {
      setDone(true);
      setTimeout(() => navigate(`/bills/vendors/${vendor.id}`), 0);
    }
  };

  const payTo =
    f.method === "ach"
      ? `${f.accountType === "checking" ? "Checking" : "Savings"} ${masked(last4(f.account))}, routing ${masked(last4(f.routing))}`
      : f.method === "wire"
        ? `IBAN ${masked(last4(f.iban.replace(/\s/g, "")))}, SWIFT ${f.swift.toUpperCase()}`
        : f.method === "check"
          ? `${f.street}, ${f.city}, ${f.state} ${f.zip}`
          : `Single-use card emailed to ${f.email}`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <UnsavedGuard when={dirty} />
      <div className="overflow-x-auto pb-1">
        <Stepper steps={STEPS} current={step} />
      </div>
      {!can.allowed ? <Callout tone="warn" title="You can't add vendors">{can.reason}</Callout> : null}

      <Card title={STEPS[step]} description={`Step ${step + 1} of ${STEPS.length}`}>
        {step === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor name" error={errors.name} hint="The name people know them by.">
              {(id) => <Input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors.name} autoFocus />}
            </Field>
            <Field label="Legal name" optional hint="As it appears on their W-9.">
              {(id) => <Input id={id} value={f.legalName} onChange={(e) => set("legalName", e.target.value)} />}
            </Field>
            <Field label="Billing email" error={errors.email}>
              {(id) => <Input id={id} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} placeholder="billing@vendor.com" />}
            </Field>
            <Field label="Phone" optional>
              {(id) => <Input id={id} type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}
            </Field>
            <Field label="Website" optional>
              {(id) => <Input id={id} value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />}
            </Field>
            <Field label="Category" error={errors.category}>
              {(id) => <Select id={id} value={f.category} onValueChange={(v) => set("category", v)} options={VENDOR_CATEGORIES.map((c) => ({ value: c, label: c }))} placeholder="Choose a category" />}
            </Field>
            <Field label="Payment terms">
              {(id) => (
                <NativeSelect id={id} value={f.terms} onChange={(e) => set("terms", e.target.value as Vendor["terms"])}>
                  {(Object.keys(TERMS_LABELS) as Vendor["terms"][]).map((t) => (
                    <option key={t} value={t}>
                      {TERMS_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Vendor owner" hint="Gets questions about this vendor's bills.">
              {(id) => <Combobox id={id} value={f.ownerId} onChange={(v) => set("ownerId", v)} options={finance} />}
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-5">
            <RadioCards
              value={f.method}
              onValueChange={(v) => set("method", v)}
              options={(Object.keys(METHOD_LABELS) as Vendor["paymentMethod"][]).map((m) => ({ value: m, label: METHOD_LABELS[m], description: METHOD_HINTS[m], icon: METHOD_ICONS[m] }))}
            />
            {/* The fields below change with the method picked above. */}
            {f.method === "ach" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Routing number" error={errors.routing}>
                  {(id) => <Input id={id} inputMode="numeric" autoComplete="off" value={f.routing} onChange={(e) => set("routing", e.target.value.trim())} aria-invalid={!!errors.routing} placeholder="9 digits" />}
                </Field>
                <Field label="Account number" error={errors.account}>
                  {(id) => <Input id={id} inputMode="numeric" autoComplete="off" value={f.account} onChange={(e) => set("account", e.target.value.trim())} aria-invalid={!!errors.account} />}
                </Field>
                <Field label="Account type">
                  {(id) => (
                    <NativeSelect id={id} value={f.accountType} onChange={(e) => set("accountType", e.target.value as Form["accountType"])}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </NativeSelect>
                  )}
                </Field>
              </div>
            ) : null}
            {f.method === "wire" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="SWIFT / BIC code" error={errors.swift}>
                  {(id) => <Input id={id} autoComplete="off" value={f.swift} onChange={(e) => set("swift", e.target.value)} aria-invalid={!!errors.swift} placeholder="ABCDGB2L" />}
                </Field>
                <Field label="IBAN" error={errors.iban}>
                  {(id) => <Input id={id} autoComplete="off" value={f.iban} onChange={(e) => set("iban", e.target.value)} aria-invalid={!!errors.iban} placeholder="GB29 NWBK 6016 1331 9268 19" />}
                </Field>
                <Field label="Bank country">
                  {(id) => (
                    <NativeSelect id={id} value={f.bankCountry} onChange={(e) => set("bankCountry", e.target.value)}>
                      {["United Kingdom", "Germany", "France", "Netherlands", "Ireland", "Canada", "Other"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
            ) : null}
            {f.method === "check" ? (
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Mailing address" error={errors.street} className="sm:col-span-6">
                  {(id) => <Input id={id} value={f.street} onChange={(e) => set("street", e.target.value)} aria-invalid={!!errors.street} placeholder="Street and suite" />}
                </Field>
                <Field label="City" error={errors.city} className="sm:col-span-3">
                  {(id) => <Input id={id} value={f.city} onChange={(e) => set("city", e.target.value)} aria-invalid={!!errors.city} />}
                </Field>
                <Field label="State" className="sm:col-span-1">
                  {(id) => <Input id={id} maxLength={2} value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase())} />}
                </Field>
                <Field label="ZIP code" error={errors.zip} className="sm:col-span-2">
                  {(id) => <Input id={id} inputMode="numeric" value={f.zip} onChange={(e) => set("zip", e.target.value.trim())} aria-invalid={!!errors.zip} />}
                </Field>
              </div>
            ) : null}
            {f.method === "card" ? <Callout tone="info">We'll email a single-use card number to {f.email || "the billing email"} each time you pay. Nothing else to set up.</Callout> : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <Field label="Tax ID (EIN)" error={errors.taxId} hint="Shown masked once saved.">
              {(id) => <Input id={id} autoComplete="off" className="max-w-56" value={f.taxId} onChange={(e) => set("taxId", e.target.value.trim())} aria-invalid={!!errors.taxId} placeholder="12-3456789" />}
            </Field>
            <Field label="W-9 form" error={errors.w9}>
              {(id) =>
                f.w9 ? (
                  <div className="flex items-center gap-3 rounded-md border border-line p-3">
                    <FileCheck2 className="size-5 text-ok" />
                    <span className="flex-1 truncate text-[13px]">{f.w9.name}</span>
                    <IconButton size="icon-sm" icon={<X />} label="Remove W-9" onClick={() => set("w9", null)} />
                  </div>
                ) : (
                  <FileDrop id={id} accept=".pdf,.png,.jpg" label="Upload W-9" hint="PDF signed within the last 3 years" onFiles={(files) => files[0] && set("w9", files[0])} />
                )
              }
            </Field>
            {f.w9 ? null : <Checkbox checked={f.w9Later} onCheckedChange={(v) => set("w9Later", v)} label="I'll collect the W-9 later. Payments over $600 will be held until it's on file." />}
            <Field label="Notes for the approver" optional>
              {(id) => <Textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Why we're adding this vendor" />}
            </Field>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-5">
            <DescriptionList
              items={[
                { label: "Vendor", value: f.name },
                { label: "Legal name", value: f.legalName || f.name },
                { label: "Billing email", value: f.email },
                { label: "Category", value: f.category },
                { label: "Terms", value: TERMS_LABELS[f.terms] },
                { label: "Owner", value: finance.find((o) => o.value === f.ownerId)?.label },
                { label: "Pays by", value: METHOD_LABELS[f.method] },
                { label: "Pay to", value: payTo },
                { label: "Tax ID", value: masked(last4(f.taxId)) },
                { label: "W-9", value: f.w9 ? f.w9.name : "Collect later" },
              ]}
            />
            <Callout tone="info" title="This vendor needs approval">
              Submitting sends a vendor approval to Finance. You can enter bills for {f.name || "them"} right away, but payments wait until it's approved.
            </Callout>
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/bills/vendors")}>
          Cancel
        </Button>
        <div className="flex gap-2">
          {step > 0 ? <Button onClick={() => setStep((s) => s - 1)}>Back</Button> : null}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" loading={busy} disabled={!can.allowed} onClick={submit}>
              Submit for approval
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
