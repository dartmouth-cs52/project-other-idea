import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { patch, useCollection } from "@/data/store";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { Badge, Card } from "@/ui/display";
import { act, Loader, SaveBar, UnsavedGuard } from "@/ui/flow";
import { Select, Switch } from "@/ui/form";
import { Combobox } from "@/ui/inputs";
import { AccountingHeader } from "./Header";
import { CLASSES, useAccounting } from "./store";

const TAX_CODES = [
  { value: "nontaxable", label: "Non-taxable" },
  { value: "taxable", label: "Taxable" },
  { value: "exempt", label: "Exempt" },
];

export function MappingsPage() {
  return (
    <>
      <AccountingHeader description="Decide which GL account each category posts to, and which class each department reports under." />
      <Loader loadKey="mappings" rows={12}>
        {() => <MappingsBody />}
      </Loader>
    </>
  );
}

function MappingsBody() {
  const categories = useCollection("categories");
  const departments = useCollection("departments");
  const glAccounts = useCollection("glAccounts");
  const savedClasses = useAccounting((s) => s.classMap);
  const setClassMap = useAccounting((s) => s.setClassMap);
  const can = useCan("accounting.manage");

  const baseGl = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.glAccountId])), [categories]);
  const [gl, setGl] = useState<Record<string, string>>(baseGl);
  const [classes, setClasses] = useState<Record<string, string | null>>(savedClasses);
  const [tax, setTax] = useState<Record<string, string>>({});
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [saving, setSaving] = useState(false);

  const glById = useMemo(() => new Map(glAccounts.map((g) => [g.id, g])), [glAccounts]);
  const glOptions = useMemo(() => glAccounts.filter((g) => g.active && g.type === "expense" && g.parentId).map((g) => ({ value: g.id, label: `${g.code} ${g.name}` })), [glAccounts]);
  const classOptions = CLASSES.map((c) => ({ value: c, label: c }));

  // A category is unmapped when its account is gone or turned off in the chart.
  const catUnmapped = (id: string) => !gl[id] || !glById.get(gl[id])?.active;
  const depUnmapped = (id: string) => !classes[id];
  const unmapped = categories.filter((c) => catUnmapped(c.id)).length + departments.filter((d) => depUnmapped(d.id)).length;

  const dirty = JSON.stringify(gl) !== JSON.stringify(baseGl) || JSON.stringify(classes) !== JSON.stringify(savedClasses) || Object.keys(tax).length > 0;

  const save = async () => {
    setSaving(true);
    await act(
      () => {
        for (const c of categories) if (gl[c.id] !== c.glAccountId) patch("categories", c.id, { glAccountId: gl[c.id] });
        setClassMap(classes);
        setTax({});
      },
      { success: "Mappings saved. New exports use them right away." },
    );
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-5 pb-16">
      <UnsavedGuard when={dirty} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {unmapped ? (
          <Badge tone="warn" className="whitespace-normal">
            <AlertTriangle className="size-3 shrink-0" /> {unmapped} unmapped. Exports for these fail until you pick one.
          </Badge>
        ) : (
          <Badge tone="ok" dot>Everything is mapped</Badge>
        )}
        <span className="flex items-center gap-2 text-[13px]">
          <Switch id="only-unmapped" checked={onlyUnmapped} onCheckedChange={setOnlyUnmapped} />
          <label htmlFor="only-unmapped" className="cursor-pointer">Show unmapped only</label>
        </span>
      </div>

      <Card title="Expense categories" description="Each category posts to one GL account in Ledgerbook." bodyClassName="p-0">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead className="bg-sunken text-left text-[12px] text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="w-[340px] px-3 py-2 font-medium">GL account</th>
                <th className="w-48 px-3 py-2 font-medium">Tax code</th>
                <th className="w-32 px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {categories
                .filter((c) => !onlyUnmapped || catUnmapped(c.id))
                .map((c) => {
                  const bad = catUnmapped(c.id);
                  return (
                    <tr key={c.id} data-category={c.id} className={cn("border-b border-line last:border-0", bad && "bg-warn-soft")}>
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2">
                        <Combobox aria-label={`GL account for ${c.name}`} disabled={!can.allowed} value={gl[c.id] ?? null} onChange={(v) => setGl((m) => ({ ...m, [c.id]: v }))} options={glOptions} placeholder="Choose an account" searchPlaceholder="Search by code or name…" />
                      </td>
                      <td className="px-3 py-2">
                        <Select aria-label={`Tax code for ${c.name}`} disabled={!can.allowed} value={tax[c.id] ?? "nontaxable"} onValueChange={(v) => setTax((m) => ({ ...m, [c.id]: v }))} options={TAX_CODES} />
                      </td>
                      <td className="px-3 py-2">{bad ? <Badge tone="warn">Unmapped</Badge> : <Badge tone="ok">Mapped</Badge>}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Departments" description="Departments report under a Ledgerbook class." bodyClassName="p-0">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead className="bg-sunken text-left text-[12px] text-ink-3">
              <tr>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="w-24 px-3 py-2 font-medium">Code</th>
                <th className="w-[340px] px-3 py-2 font-medium">Class</th>
                <th className="w-32 px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {departments
                .filter((d) => !onlyUnmapped || depUnmapped(d.id))
                .map((d) => {
                  const bad = depUnmapped(d.id);
                  return (
                    <tr key={d.id} className={cn("border-b border-line last:border-0", bad && "bg-warn-soft")}>
                      <td className="px-4 py-2 font-medium" style={{ paddingLeft: d.parentId ? 32 : 16 }}>{d.name}</td>
                      <td className="px-3 py-2 font-mono text-[12px] text-ink-3">{d.glCode}</td>
                      <td className="px-3 py-2">
                        <Combobox aria-label={`Class for ${d.name}`} disabled={!can.allowed} value={classes[d.id] ?? null} onChange={(v) => setClasses((m) => ({ ...m, [d.id]: v }))} options={classOptions} placeholder="Choose a class" />
                      </td>
                      <td className="px-3 py-2">{bad ? <Badge tone="warn">Unmapped</Badge> : <Badge tone="ok">Mapped</Badge>}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => {
          setGl(baseGl);
          setClasses(savedClasses);
          setTax({});
        }}
        message="Unsaved mapping changes"
      />
    </div>
  );
}
