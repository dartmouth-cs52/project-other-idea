import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { useCan } from "@/lib/access";
import { Button } from "@/ui/button";
import { Card } from "@/ui/display";
import { Field, Input, NativeSelect, Select } from "@/ui/form";
import { act, Loader, SaveBar, UnsavedGuard } from "@/ui/flow";
import { FileDrop } from "@/ui/inputs";
import { FieldGrid, readImage, ReadOnlyNote, SaveCard, SettingsHeader, useDraft } from "./common";
import { useSettings } from "./store";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COUNTRIES = ["United States", "Canada", "United Kingdom", "Ireland", "Germany", "France", "Netherlands", "Australia"];

export function CompanyPage() {
  return (
    <>
      <SettingsHeader title="Company details" description="How Northpine appears on cards, invoices and statements." />
      <ReadOnlyNote action="settings.company" />
      <Loader loadKey="settings-company" rows={10}>
        {() => <CompanyBody />}
      </Loader>
    </>
  );
}

function CompanyBody() {
  const company = useSettings((s) => s.company);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.company");
  const { draft, update, dirty, reset } = useDraft({
    legalName: company.legalName,
    dba: company.dba,
    website: company.website,
    street: company.street,
    city: company.city,
    region: company.region,
    postal: company.postal,
    country: company.country,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!draft.legalName.trim()) return setError("Legal name is required.");
    setError(null);
    setSaving(true);
    await act(() => set("company", draft), { success: "Company details saved" });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* The details form saves through the bar fixed to the bottom of the screen. */}
      <Card title="Legal entity" description="Must match your tax filings.">
        <FieldGrid>
          <Field label="Legal name" error={error}>
            {(id) => <Input id={id} disabled={!allowed} value={draft.legalName} aria-invalid={!!error} onChange={(e) => update({ legalName: e.target.value })} />}
          </Field>
          <Field label="Doing business as" optional>
            {(id) => <Input id={id} disabled={!allowed} value={draft.dba} onChange={(e) => update({ dba: e.target.value })} />}
          </Field>
          <Field label="Website" className="sm:col-span-2">
            {(id) => <Input id={id} disabled={!allowed} type="url" value={draft.website} onChange={(e) => update({ website: e.target.value })} />}
          </Field>
        </FieldGrid>
      </Card>
      <Card title="Registered address" description="Printed on statements and sent to card networks.">
        <FieldGrid>
          <Field label="Street address" className="sm:col-span-2">
            {(id) => <Input id={id} disabled={!allowed} value={draft.street} onChange={(e) => update({ street: e.target.value })} />}
          </Field>
          <Field label="City">{(id) => <Input id={id} disabled={!allowed} value={draft.city} onChange={(e) => update({ city: e.target.value })} />}</Field>
          <Field label="State or region">{(id) => <Input id={id} disabled={!allowed} value={draft.region} onChange={(e) => update({ region: e.target.value })} />}</Field>
          <Field label="Postal code">{(id) => <Input id={id} disabled={!allowed} value={draft.postal} onChange={(e) => update({ postal: e.target.value })} />}</Field>
          <Field label="Country">
            {(id) => (
              <NativeSelect id={id} disabled={!allowed} value={draft.country} onChange={(e) => update({ country: e.target.value })}>
                {COUNTRIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </FieldGrid>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <AccountingDefaults />
        <Logo />
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={reset} />
      <UnsavedGuard when={dirty} />
    </div>
  );
}

function AccountingDefaults() {
  const company = useSettings((s) => s.company);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.company");
  const { draft, update, dirty } = useDraft({ fiscalStart: company.fiscalStart, currency: company.currency });
  return (
    <SaveCard title="Fiscal year and currency" description="Reports and budgets follow your fiscal year." dirty={dirty} action="settings.company" onSave={() => set("company", draft)} success="Fiscal settings saved">
      <div className="flex flex-col gap-4">
        <Field label="Fiscal year starts in">
          {(id) => (
            <Select
              id={id}
              disabled={!allowed}
              value={draft.fiscalStart}
              onValueChange={(v) => update({ fiscalStart: v })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
          )}
        </Field>
        <Field label="Default currency" hint="New cards and budgets use this. Each entity can have its own.">
          {(id) => (
            <Select
              id={id}
              disabled={!allowed}
              value={draft.currency}
              onValueChange={(v) => update({ currency: v })}
              options={[
                { value: "USD", label: "US dollar (USD)" },
                { value: "GBP", label: "British pound (GBP)" },
                { value: "EUR", label: "Euro (EUR)" },
                { value: "CAD", label: "Canadian dollar (CAD)" },
              ]}
            />
          )}
        </Field>
      </div>
    </SaveCard>
  );
}

function Logo() {
  const logo = useSettings((s) => s.company.logo);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.company");
  const [pending, setPending] = useState<string | null>(null);
  const shown = pending ?? logo;
  return (
    <SaveCard
      title="Logo"
      description="Shown on the sign-in page and on reimbursement emails."
      dirty={pending !== null}
      action="settings.company"
      onSave={() => {
        set("company", { logo: pending });
        setPending(null);
      }}
      success="Logo saved"
    >
      <div className="flex items-start gap-4">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-sunken text-ink-3">
          {shown ? <img src={shown} alt="Company logo" className="size-full object-contain" /> : <ImageIcon className="size-6" />}
        </span>
        <div className="flex flex-1 flex-col gap-2">
          {allowed ? (
            <FileDrop
              accept="image/png,image/svg+xml,image/jpeg"
              label="Drop your logo, or click to browse"
              hint="SVG or PNG, square, under 1 MB"
              onFiles={async (files) => {
                if (files[0]) setPending(await readImage(files[0]));
              }}
            />
          ) : (
            <p className="text-[13px] text-ink-3">Only admins can change the logo.</p>
          )}
          {logo && !pending && allowed ? (
            <Button size="sm" variant="ghost" className="self-start text-danger" onClick={() => setPending("")}>
              Remove logo
            </Button>
          ) : null}
        </div>
      </div>
    </SaveCard>
  );
}
