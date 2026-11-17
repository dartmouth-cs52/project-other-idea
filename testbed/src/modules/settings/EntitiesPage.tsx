import { Eye, EyeOff, Plus } from "lucide-react";
import { useState } from "react";
import { newId, upsert, useCollection } from "@/data/store";
import type { Currency, Entity } from "@/data/types";
import { useCan, useFeature } from "@/lib/access";
import { masked } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Badge, Card, DescriptionList } from "@/ui/display";
import { DataTable, type ColumnDef } from "@/ui/data-table";
import { Field, Input, NativeSelect, Select, Switch } from "@/ui/form";
import { Loader, PlanGate, RoleGate, Stepper } from "@/ui/flow";
import { Modal } from "@/ui/overlay";
import { FieldGrid, ReadOnlyNote, SaveCard, SettingsHeader, useDraft, done } from "./common";
import { useSettings } from "./store";

const maskTaxId = (t: string) => `${t.slice(0, 2)}${t.slice(2, -3).replace(/[0-9A-Z]/g, "•")}${t.slice(-3)}`;

export function EntitiesPage() {
  const plan = useFeature("multiEntity");
  const [adding, setAdding] = useState(false);
  return (
    <>
      <SettingsHeader
        title="Entities"
        description="Each legal entity has its own currency, tax ID and bank account. Cards and bills belong to one."
        actions={
          // Hidden while the plan does not include it; the upgrade prompt takes its place.
          !plan.enabled ? null : <RoleGate action="settings.company">
            {(ok) => (
              <Button variant="primary" disabled={!ok} onClick={() => setAdding(true)}>
                <Plus /> Add entity
              </Button>
            )}
          </RoleGate>
        }
      />
      <ReadOnlyNote action="settings.company" />
      <PlanGate feature="multiEntity" title="Multiple entities">
        <Loader loadKey="settings-entities">
          {() => (
            <div className="flex flex-col gap-5">
              <EntityTable />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Defaults />
                <Intercompany />
              </div>
            </div>
          )}
        </Loader>
        <AddEntityWizard open={adding} onOpenChange={setAdding} />
      </PlanGate>
    </>
  );
}

function TaxId({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  const { allowed } = useCan("settings.company");
  return (
    <span className="flex items-center gap-1">
      {/* Masked by default. Privacy bait. */}
      <span className="font-mono text-[12.5px]">{shown ? value : maskTaxId(value)}</span>
      {allowed ? <IconButton size="icon-sm" icon={shown ? <EyeOff /> : <Eye />} label={shown ? "Hide tax ID" : "Reveal tax ID"} onClick={() => setShown((s) => !s)} /> : null}
    </span>
  );
}

function EntityTable() {
  const entities = useCollection("entities");
  const defaultEntity = useSettings((s) => s.entities.defaultEntity);
  const columns: ColumnDef<Entity, unknown>[] = [
    {
      id: "name",
      header: "Entity",
      accessorKey: "name",
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium">
          {row.original.name}
          {row.original.id === defaultEntity ? <Badge tone="brand">Default</Badge> : null}
        </span>
      ),
    },
    { id: "country", header: "Country", accessorKey: "country" },
    { id: "currency", header: "Currency", accessorKey: "currency", size: 100 },
    { id: "taxId", header: "Tax ID", enableSorting: false, cell: ({ row }) => <TaxId value={row.original.taxId} /> },
    { id: "bank", header: "Operating account", enableSorting: false, cell: ({ row }) => <span className="font-mono text-[12.5px]">{masked(row.original.bankLast4)}</span> },
  ];
  return (
    <DataTable
      label="Entities"
      data={entities}
      columns={columns}
      getRowId={(e) => e.id}
      renderExpanded={(e) => <DescriptionList columns={2} items={[{ label: "Registered address", value: e.address }, { label: "Statement name", value: e.name.toUpperCase() }]} />}
    />
  );
}

function Defaults() {
  const s = useSettings((x) => x.entities);
  const set = useSettings((x) => x.set);
  const entities = useCollection("entities");
  const { allowed } = useCan("settings.company");
  const { draft, update, dirty } = useDraft({ defaultEntity: s.defaultEntity });
  return (
    <SaveCard title="Default entity" description="New people, cards and bills start in this entity." dirty={dirty} action="settings.company" onSave={() => set("entities", draft)}>
      <Field label="Default entity">
        {(id) => <Select id={id} disabled={!allowed} value={draft.defaultEntity} onValueChange={(v) => update({ defaultEntity: v })} options={entities.map((e) => ({ value: e.id, label: `${e.name} (${e.currency})` }))} />}
      </Field>
    </SaveCard>
  );
}

function Intercompany() {
  const s = useSettings((x) => x.entities);
  const set = useSettings((x) => x.set);
  const { allowed } = useCan("settings.company");
  const { draft, update, dirty } = useDraft({ intercompany: s.intercompany });
  return (
    <SaveCard title="Intercompany" description="When one entity pays for another, book a due-to and due-from entry." dirty={dirty} action="settings.company" onSave={() => set("entities", draft)}>
      <Switch label="Book intercompany entries automatically" description="Uses account 1350 in each ledger." disabled={!allowed} checked={draft.intercompany} onCheckedChange={(v) => update({ intercompany: v })} />
    </SaveCard>
  );
}

const STEPS = ["Details", "Tax and address", "Bank account", "Review"];
const COUNTRY_CURRENCY: Record<string, Currency> = { "United States": "USD", "United Kingdom": "GBP", Germany: "EUR", France: "EUR", Ireland: "EUR", Netherlands: "EUR" };

function AddEntityWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const blank = { name: "", country: "", currency: "USD" as Currency, taxId: "", address: "", routing: "", account: "", bankLater: false };
  const [step, setStep] = useState(0);
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setStep(0);
      setF(blank);
      setErrors({});
    }
  };
  const validate = () => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!f.name.trim()) e.name = "Enter the entity's legal name.";
      if (!f.country) e.country = "Pick a country.";
    }
    if (step === 1) {
      if (f.taxId.replace(/\W/g, "").length < 6) e.taxId = "Enter a valid tax ID.";
      if (!f.address.trim()) e.address = "Enter the registered address.";
    }
    if (step === 2 && !f.bankLater) {
      if (!/^\d{9}$/.test(f.routing)) e.routing = "Routing numbers are 9 digits.";
      if (!/^\d{6,17}$/.test(f.account)) e.account = "Enter the account number.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="lg"
      dismissable={false}
      title="Add entity"
      description="Set up a new legal entity. You can issue cards from it right away."
      footer={
        <>
          {step > 0 ? <Button onClick={() => setStep((s) => s - 1)}>Back</Button> : <Button onClick={() => close(false)}>Cancel</Button>}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => validate() && setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await done(
                  () =>
                    upsert("entities", { id: newId("ent"), name: f.name.trim(), country: f.country, currency: f.currency, taxId: f.taxId, address: f.address, bankLast4: f.bankLater ? "0000" : f.account.slice(-4) }),
                  { success: `${f.name} added` },
                );
                setBusy(false);
                if (ok) close(false);
              }}
            >
              Create entity
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="relative overflow-x-auto pb-1">
          <Stepper steps={STEPS} current={step} />
        </div>
        {step === 0 ? (
          <FieldGrid>
            <Field label="Legal name" error={errors.name} className="sm:col-span-2">
              {(id) => <Input id={id} value={f.name} placeholder="Northpine Pty Ltd" onChange={(e) => up({ name: e.target.value })} aria-invalid={!!errors.name} />}
            </Field>
            <Field label="Country" error={errors.country}>
              {(id) => (
                <NativeSelect id={id} value={f.country} aria-invalid={!!errors.country} onChange={(e) => up({ country: e.target.value, currency: COUNTRY_CURRENCY[e.target.value] ?? f.currency })}>
                  <option value="">Select a country</option>
                  {Object.keys(COUNTRY_CURRENCY).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label="Currency" hint="Set from the country. Change it if the entity books in another currency.">
              {(id) => (
                <NativeSelect id={id} value={f.currency} onChange={(e) => up({ currency: e.target.value as Currency })}>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="EUR">EUR</option>
                </NativeSelect>
              )}
            </Field>
          </FieldGrid>
        ) : step === 1 ? (
          <FieldGrid>
            <Field label={f.country === "United States" ? "EIN" : "VAT or company number"} error={errors.taxId}>
              {(id) => <Input id={id} autoComplete="off" value={f.taxId} onChange={(e) => up({ taxId: e.target.value })} aria-invalid={!!errors.taxId} />}
            </Field>
            <Field label="Registered address" error={errors.address} className="sm:col-span-2">
              {(id) => <Input id={id} value={f.address} onChange={(e) => up({ address: e.target.value })} aria-invalid={!!errors.address} />}
            </Field>
          </FieldGrid>
        ) : step === 2 ? (
          <div className="flex flex-col gap-4">
            <Switch label="Add a bank account later" description="Cards from this entity draw on the parent account until you add one." checked={f.bankLater} onCheckedChange={(v) => up({ bankLater: v })} />
            {f.bankLater ? null : (
              <FieldGrid>
                <Field label="Routing number" error={errors.routing}>
                  {(id) => <Input id={id} inputMode="numeric" autoComplete="off" value={f.routing} onChange={(e) => up({ routing: e.target.value.replace(/\D/g, "") })} aria-invalid={!!errors.routing} />}
                </Field>
                <Field label="Account number" error={errors.account}>
                  {(id) => <Input id={id} type="password" inputMode="numeric" autoComplete="off" value={f.account} onChange={(e) => up({ account: e.target.value.replace(/\D/g, "") })} aria-invalid={!!errors.account} />}
                </Field>
              </FieldGrid>
            )}
          </div>
        ) : (
          <Card>
            <DescriptionList
              items={[
                { label: "Legal name", value: f.name },
                { label: "Country", value: f.country },
                { label: "Currency", value: f.currency },
                { label: "Tax ID", value: maskTaxId(f.taxId) },
                { label: "Address", value: f.address },
                { label: "Bank account", value: f.bankLater ? "Add later" : masked(f.account.slice(-4)) },
              ]}
            />
          </Card>
        )}
      </div>
    </Modal>
  );
}
