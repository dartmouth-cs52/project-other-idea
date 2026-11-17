import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { patch, upsert, useCollection, useIndex } from "@/data/store";
import type { PolicyRule } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { fullName, money } from "@/lib/format";
import { Button, IconButton } from "@/ui/button";
import { Badge, Card, LinkTabs, PageHeader } from "@/ui/display";
import { act, Loader, PlanGate, RoleGate, toast } from "@/ui/flow";
import { Switch } from "@/ui/form";
import { InlineEdit } from "@/ui/inputs";
import { ACTION_LABELS, describeRule, usePolicyExtras, type Lookups } from "./shared";

// The rule list, receipt thresholds by category and per diem rates.

export function usePolicyLookups(): Lookups {
  const cats = useIndex("categories");
  const deps = useIndex("departments");
  const ents = useIndex("entities");
  const people = useIndex("employees");
  return useMemo(
    () => ({
      category: (id) => cats.get(id)?.name,
      department: (id) => deps.get(id)?.name,
      entity: (id) => ents.get(id)?.name,
      person: (id) => (people.get(id) ? fullName(people.get(id)) : undefined),
    }),
    [cats, deps, ents, people],
  );
}

export function PolicyTabs({ active }: { active: string }) {
  return (
    <LinkTabs
      active={active}
      tabs={[
        { to: "/policies", label: "Rules" },
        { to: "/policies/handbook", label: "Handbook" },
      ]}
    />
  );
}

export function PoliciesPage() {
  return (
    <>
      <PageHeader
        title="Policies"
        description="What Northpine allows, what needs a receipt, and who approves what."
        actions={
          <RoleGate action="policies.edit">
            {(allowed) =>
              allowed ? (
                <Button variant="primary" asChild>
                  <Link to="/policies/new">
                    <Plus /> New rule
                  </Link>
                </Button>
              ) : (
                <Button variant="primary" disabled>
                  <Plus /> New rule
                </Button>
              )
            }
          </RoleGate>
        }
        tabs={<PolicyTabs active="/policies" />}
      />
      <Loader loadKey="policies" rows={8}>
        {() => (
          <div className="flex flex-col gap-5">
            <RulesCard />
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ReceiptRules />
              <PerDiem />
            </div>
          </div>
        )}
      </Loader>
    </>
  );
}

function RulesCard() {
  const policies = useCollection("policies");
  const rules = useMemo(() => [...policies].sort((a, b) => a.order - b.order), [policies]);
  const can = useCan("policies.edit");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const reorder = (next: PolicyRule[]) => {
    const before = rules;
    upsert("policies", ...next.map((r, i) => ({ ...r, order: i + 1 })));
    act(() => undefined, { success: "Rule order saved", undo: () => upsert("policies", ...before) });
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = rules.findIndex((r) => r.id === e.active.id);
    const to = rules.findIndex((r) => r.id === e.over!.id);
    reorder(arrayMove(rules, from, to));
  };

  return (
    <Card title="Spending rules" description="Rules run from top to bottom. Drag to change the order." bodyClassName="p-0">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol>
            {rules.map((r, i) => (
              <RuleRow key={r.id} rule={r} index={i} last={i === rules.length - 1} canEdit={can.allowed} onMove={(dir) => reorder(arrayMove(rules, i, i + dir))} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </Card>
  );
}

function RuleRow({ rule, index, last, canEdit, onMove }: { rule: PolicyRule; index: number; last: boolean; canEdit: boolean; onMove: (dir: -1 | 1) => void }) {
  const lookups = usePolicyLookups();
  const chain = usePolicyExtras((s) => s.chains[rule.id] ?? null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id, disabled: !canEdit });

  // Changes at once and saves in the background. Undo is in the toast.
  const toggle = async (enabled: boolean) => {
    patch("policies", rule.id, { enabled });
    const ok = await act(() => true, {
      success: enabled ? `"${rule.name}" turned on` : `"${rule.name}" turned off`,
      undo: () => patch("policies", rule.id, { enabled: !enabled }),
    });
    if (!ok) {
      patch("policies", rule.id, { enabled: !enabled });
      toast.error("We couldn't save that, so the rule is back how it was.");
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-3 border-b border-line bg-panel px-3 py-3 last:border-0", isDragging && "relative z-10 shadow-lg")}
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${rule.name}`}
        disabled={!canEdit}
        className="grid size-7 cursor-grab place-items-center rounded text-ink-3 hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="tabular w-5 text-center text-[12.5px] text-ink-3">{index + 1}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The badges go under the name when there is no room beside it, as on a phone, rather than squeezing it to nothing. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/policies/${rule.id}`} className={cn("max-w-full truncate text-[13.5px] font-medium hover:underline", !rule.enabled && "text-ink-3")}>
            {rule.name}
          </Link>
          <Badge tone={rule.action === "block" ? "danger" : rule.action === "require_approval" ? "brand" : "neutral"}>{ACTION_LABELS[rule.action]}</Badge>
          {!rule.enabled ? <Badge>Off</Badge> : null}
        </span>
        <span className="truncate text-[12.5px] text-ink-3">{describeRule(rule, lookups, chain)}</span>
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton label="Move up" size="icon-sm" icon={<ArrowUp />} disabled={!canEdit || index === 0} onClick={() => onMove(-1)} />
        <IconButton label="Move down" size="icon-sm" icon={<ArrowDown />} disabled={!canEdit || last} onClick={() => onMove(1)} />
      </div>
      <RoleGate action="policies.edit">{(allowed) => <Switch checked={rule.enabled} disabled={!allowed} onCheckedChange={toggle} id={`switch-${rule.id}`} />}</RoleGate>
      <label htmlFor={`switch-${rule.id}`} className="sr-only">
        {rule.name} enabled
      </label>
    </li>
  );
}

function ReceiptRules() {
  const cats = useCollection("categories");
  const can = useCan("policies.edit");
  return (
    <Card title="Receipt requirements" description="A receipt is required when a charge in the category is over this amount." bodyClassName="p-0">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-3">
            <th className="px-4 py-2 font-medium">Category</th>
            <th className="px-4 py-2 text-right font-medium">Receipt required over</th>
          </tr>
        </thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-0">
              <td className="px-4 py-1.5">{c.name}</td>
              <td className="px-4 py-1.5 text-right">
                {can.allowed ? (
                  // Click the number to edit it. Saves on Enter or when you click away.
                  <InlineEdit
                    label={`Receipt threshold for ${c.name}`}
                    value={"$" + c.requiresReceiptOver}
                    className="tabular ml-auto justify-end"
                    onSave={(v) => {
                      const n = Number(v.replace(/[$,]/g, ""));
                      if (!Number.isFinite(n) || n < 0) {
                        toast.error("Enter an amount in dollars, like 75.");
                        return;
                      }
                      const before = c.requiresReceiptOver;
                      act(() => patch("categories", c.id, { requiresReceiptOver: n }), {
                        success: `${c.name} receipts now required over ${money(n)}`,
                        undo: () => patch("categories", c.id, { requiresReceiptOver: before }),
                      });
                    }}
                  />
                ) : (
                  <span className="tabular">{money(c.requiresReceiptOver)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PerDiem() {
  const rates = usePolicyExtras((s) => s.perDiem);
  const set = usePolicyExtras((s) => s.setPerDiem);
  const can = useCan("policies.edit");
  const edit = (id: string, key: "lodging" | "meals", v: string, label: string) => {
    const n = Number(v.replace(/[$,]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return toast.error("Enter a daily amount, like 79.");
    act(() => set(id, { [key]: n }), { success: `${label} updated` });
  };
  return (
    <PlanGate feature="perDiem" title="Per diem rates">
      <Card title="Per diem rates" description="Daily allowances for travelers, in USD. Used for per diem reimbursements." bodyClassName="p-0">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-3">
              <th className="px-4 py-2 font-medium">Location</th>
              <th className="px-4 py-2 text-right font-medium">Lodging</th>
              <th className="px-4 py-2 text-right font-medium">Meals and incidentals</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-1.5">{r.city}</td>
                <td className="px-4 py-1.5 text-right tabular">
                  {can.allowed ? <InlineEdit label={`Lodging rate for ${r.city}`} value={"$" + r.lodging} className="ml-auto" onSave={(v) => edit(r.id, "lodging", v, `Lodging for ${r.city}`)} /> : money(r.lodging)}
                </td>
                <td className="px-4 py-1.5 text-right tabular">
                  {can.allowed ? <InlineEdit label={`Meals rate for ${r.city}`} value={"$" + r.meals} className="ml-auto" onSave={(v) => edit(r.id, "meals", v, `Meals for ${r.city}`)} /> : money(r.meals)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PlanGate>
  );
}
