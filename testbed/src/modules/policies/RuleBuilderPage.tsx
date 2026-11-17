import { Ban, Bell, CheckCircle2, Flag, Plus, Receipt, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { all, newId, remove, upsert, useCollection, useRow } from "@/data/store";
import type { PolicyRule, Role } from "@/data/types";
import { useCan, useFeature } from "@/lib/access";
import { Button, IconButton } from "@/ui/button";
import { Callout, Card, EmptyState, PageHeader } from "@/ui/display";
import { act, Loader, PlanGate, RoleGate, SaveBar, UnsavedGuard } from "@/ui/flow";
import { Field, Input, NativeSelect, RadioCards, RadioList, Select, Switch } from "@/ui/form";
import { Combobox } from "@/ui/inputs";
import { ConfirmDialog } from "@/ui/overlay";
import { usePolicyLookups } from "./PoliciesPage";
import { ACTION_LABELS, APPROVER_ROLES, describeRule, FIELD_LABELS, KIND_NAMES, OP_LABELS, OPS, usePolicyExtras, type Condition, type FieldName } from "./shared";

// Build or edit one rule: conditions as rows, an action, and an approver that
// only appears for "Require approval". Changes wait for the save bar.

interface Draft {
  name: string;
  conditions: (Condition & { key: string })[];
  action: PolicyRule["action"];
  approverMode: "role" | "person";
  approverRole: Role | null;
  approverId: string | null;
  second: Role | null;
}

const key = () => Math.random().toString(36).slice(2, 9);

function toDraft(rule: PolicyRule | undefined, second: Role | null): Draft {
  if (!rule) return { name: "", conditions: [{ key: key(), field: "amount", op: "gt", value: "" }], action: "require_approval", approverMode: "role", approverRole: "manager", approverId: null, second: null };
  return {
    name: rule.name,
    conditions: rule.conditions.map((c) => ({ ...c, key: key() })),
    action: rule.action,
    approverMode: rule.approverId ? "person" : "role",
    approverRole: rule.approverRole,
    approverId: rule.approverId,
    second,
  };
}

const same = (a: Draft, b: Draft) => JSON.stringify({ ...a, conditions: a.conditions.map(({ key: _k, ...c }) => c) }) === JSON.stringify({ ...b, conditions: b.conditions.map(({ key: _k, ...c }) => c) });

export function RuleBuilderPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const rule = useRow("policies", isNew ? undefined : id);
  if (!isNew && !rule)
    return (
      <>
        <PageHeader title="Rule not found" crumbs={[{ label: "Policies", to: "/policies" }, { label: "Not found" }]} />
        <Card>
          <EmptyState title="We couldn't find that rule" description="It may have been deleted." action={<Button asChild><Link to="/policies">Back to policies</Link></Button>} />
        </Card>
      </>
    );
  return (
    <Loader loadKey={["policy", id]} rows={8}>
      {() => <Builder key={id ?? "new"} rule={rule} />}
    </Loader>
  );
}

function Builder({ rule }: { rule: PolicyRule | undefined }) {
  const navigate = useNavigate();
  const lookups = usePolicyLookups();
  const can = useCan("policies.edit");
  const chains = useFeature("customApprovalChains");
  const savedSecond = usePolicyExtras((s) => (rule ? (s.chains[rule.id] ?? null) : null));
  const setChain = usePolicyExtras((s) => s.setChain);
  const [saved, setSaved] = useState<Draft>(() => toDraft(rule, savedSecond));
  const [draft, setDraft] = useState<Draft>(saved);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [goTo, setGoTo] = useState<string | null>(null);
  const dirty = !same(draft, saved);
  useEffect(() => {
    if (goTo && !dirty) navigate(goTo);
  }, [goTo, dirty, navigate]);

  const set = (f: Partial<Draft>) => setDraft((d) => ({ ...d, ...f }));
  const setCond = (k: string, f: Partial<Condition>) => setDraft((d) => ({ ...d, conditions: d.conditions.map((c) => (c.key === k ? { ...c, ...f } : c)) }));

  const errors = {
    name: draft.name.trim() ? null : "Give the rule a name.",
    conditions: draft.conditions.map((c) => (c.value.trim() || (c.field === "merchant" && c.op === "neq") ? null : c.field === "amount" ? "Enter an amount." : "Choose a value.")),
    approver: draft.action !== "require_approval" ? null : draft.approverMode === "role" ? (draft.approverRole ? null : "Choose who approves.") : draft.approverId ? null : "Choose a person.",
  };
  const valid = !errors.name && !errors.conditions.some(Boolean) && !errors.approver;
  const asRule = {
    conditions: draft.conditions.map(({ key: _k, ...c }) => c),
    action: draft.action,
    approverRole: draft.action === "require_approval" && draft.approverMode === "role" ? draft.approverRole : null,
    approverId: draft.action === "require_approval" && draft.approverMode === "person" ? draft.approverId : null,
  };
  const second = draft.action === "require_approval" && chains.enabled ? draft.second : null;
  const summary = describeRule(asRule, lookups, second);

  const save = async () => {
    setTried(true);
    if (!valid) return;
    setSaving(true);
    const id = rule?.id ?? newId("pol");
    const order = rule?.order ?? Math.max(0, ...all("policies").map((p) => p.order)) + 1;
    const next: PolicyRule = { id, name: draft.name.trim(), enabled: rule?.enabled ?? true, order, ...asRule };
    const result = await act(
      () => {
        upsert("policies", next);
        setChain(id, second);
        return true;
      },
      { success: rule ? "Rule saved" : "Rule created" },
    );
    setSaving(false);
    if (!result) return;
    setSaved(draft);
    if (!rule) setGoTo(`/policies/${id}`);
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Policies", to: "/policies" }, { label: rule ? rule.name : "New rule" }]}
        title={rule ? rule.name : "New rule"}
        description="Rules check every card charge, reimbursement and request as it comes in."
        actions={
          rule ? (
            <RoleGate action="policies.edit">
              {(allowed) => (
                <Button variant="ghost" disabled={!allowed} onClick={() => setDeleting(true)} className="text-danger">
                  <Trash2 /> Delete rule
                </Button>
              )}
            </RoleGate>
          ) : null
        }
      />
      {!can.allowed ? (
        <div className="mb-4">
          <Callout tone="info" title="You can view this rule but not change it">
            {can.reason}
          </Callout>
        </div>
      ) : null}

      <div className="mb-5">
        <Callout tone="ok" title="In plain words">
          <span aria-live="polite">{summary}</span>
        </Callout>
      </div>

      {/* A disabled fieldset turns every control off for people without the role. */}
      <fieldset disabled={!can.allowed} className="flex min-w-0 flex-col gap-5 pb-24">
        <Card title="Name">
          <Field label="Rule name" error={tried ? errors.name : null}>
            {(id) => <Input id={id} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Meals over $150 need a manager" aria-invalid={tried && !!errors.name} className="max-w-md" />}
          </Field>
        </Card>

        <Card title="Conditions" description="Every condition has to match for the rule to apply.">
          <div className="flex flex-col gap-3">
            {draft.conditions.map((c, i) => (
              <ConditionRow
                key={c.key}
                c={c}
                index={i}
                error={tried ? errors.conditions[i] : null}
                onChange={(f) => setCond(c.key, f)}
                onRemove={draft.conditions.length > 1 ? () => set({ conditions: draft.conditions.filter((x) => x.key !== c.key) }) : undefined}
              />
            ))}
            <div>
              <Button size="sm" variant="ghost" onClick={() => set({ conditions: [...draft.conditions, { key: key(), field: "category", op: "eq", value: "" }] })}>
                <Plus /> Add condition
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Then">
          <RadioCards
            name="action"
            columns={3}
            value={draft.action}
            onValueChange={(v) => set({ action: v })}
            options={[
              { value: "require_approval", label: ACTION_LABELS.require_approval, description: "Someone signs off before it's final.", icon: <CheckCircle2 /> },
              { value: "require_receipt", label: ACTION_LABELS.require_receipt, description: "The charge stays open until one is attached.", icon: <Receipt /> },
              { value: "block", label: ACTION_LABELS.block, description: "The card declines at the till.", icon: <Ban /> },
              { value: "flag", label: ACTION_LABELS.flag, description: "It goes through, marked for finance.", icon: <Flag /> },
              { value: "notify", label: ACTION_LABELS.notify, description: "Finance gets an email. Nothing else changes.", icon: <Bell /> },
            ]}
          />
        </Card>

        {draft.action === "require_approval" ? (
          // Only here when the action is "Require approval".
          <Card title="Approver" description="Who signs off when this rule matches.">
            <div className="flex flex-col gap-4">
              <RadioList
                value={draft.approverMode}
                onValueChange={(v) => set({ approverMode: v })}
                options={[
                  { value: "role", label: "Someone in a role" },
                  { value: "person", label: "A specific person" },
                ]}
              />
              {draft.approverMode === "role" ? (
                <Field label="Approver role" error={tried ? errors.approver : null} className="max-w-xs">
                  {(id) => <Select id={id} value={draft.approverRole ?? ""} onValueChange={(v) => set({ approverRole: v })} options={APPROVER_ROLES} placeholder="Choose a role" />}
                </Field>
              ) : (
                <Field label="Approver" error={tried ? errors.approver : null} className="max-w-xs">
                  {(id) => <PersonPicker id={id} value={draft.approverId} onChange={(v) => set({ approverId: v })} />}
                </Field>
              )}
              <div className="flex flex-col gap-2 border-t border-line pt-4">
                <span className="text-[13px] font-medium">Multi-level approval</span>
                <PlanGate feature="customApprovalChains" title="Multi-level approval" compact>
                  <div className="flex max-w-md flex-col gap-3">
                    <Switch
                      checked={draft.second !== null}
                      onCheckedChange={(on) => set({ second: on ? "finance" : null })}
                      label="Add a second approval step"
                      description="After the first approver, someone else signs off too."
                    />
                    {draft.second !== null ? (
                      <Field label="Second approver" className="max-w-xs">
                        {(id) => <Select id={id} value={draft.second ?? ""} onValueChange={(v) => set({ second: v })} options={APPROVER_ROLES} />}
                      </Field>
                    ) : null}
                  </div>
                </PlanGate>
              </div>
            </div>
          </Card>
        ) : null}
      </fieldset>

      <SaveBar dirty={dirty && can.allowed} saving={saving} onSave={save} onDiscard={() => setDraft(saved)} message={rule ? "This rule has unsaved changes" : "This rule isn't saved yet"} />
      <UnsavedGuard when={dirty && can.allowed} />
      {rule ? (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          danger
          title={`Delete "${rule.name}"?`}
          description="Charges already checked keep their result. New ones won't be checked against this rule."
          confirmLabel="Delete rule"
          onConfirm={async () => {
            await act(() => remove("policies", rule.id), { success: "Rule deleted" });
            navigate("/policies");
          }}
        />
      ) : null}
    </>
  );
}

function PersonPicker({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string) => void }) {
  const people = useCollection("employees");
  const options = useMemo(
    () => people.filter((e) => e.status === "active" && e.role !== "employee").map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.title })),
    [people],
  );
  return <Combobox id={id} value={value} onChange={onChange} options={options} placeholder="Choose a person" searchPlaceholder="Search people…" />;
}

function ConditionRow({ c, index, error, onChange, onRemove }: { c: Condition; index: number; error: string | null; onChange: (f: Partial<Condition>) => void; onRemove?: () => void }) {
  const cats = useCollection("categories");
  const deps = useCollection("departments");
  const ents = useCollection("entities");
  const n = index + 1;
  let input;
  switch (c.field) {
    case "amount":
      input = <Input aria-label={`Condition ${n} amount`} type="number" min="0" prefix="$" value={c.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="150" aria-invalid={!!error} />;
      break;
    case "category":
      input = <Combobox aria-label={`Condition ${n} category`} value={c.value || null} onChange={(v) => onChange({ value: v })} options={cats.map((x) => ({ value: x.id, label: x.name }))} placeholder="Choose a category" searchPlaceholder="Search categories…" />;
      break;
    case "department":
      input = <Combobox aria-label={`Condition ${n} department`} value={c.value || null} onChange={(v) => onChange({ value: v })} options={deps.map((x) => ({ value: x.id, label: x.name }))} placeholder="Choose a department" searchPlaceholder="Search departments…" />;
      break;
    case "kind":
      // A plain <select> here, unlike the custom selects next to it.
      input = (
        <NativeSelect aria-label={`Condition ${n} request type`} value={c.value} onChange={(e) => onChange({ value: e.target.value })}>
          <option value="">Choose a type</option>
          {Object.entries(KIND_NAMES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </NativeSelect>
      );
      break;
    case "entity":
      input = <Select aria-label={`Condition ${n} entity`} value={c.value} onValueChange={(v) => onChange({ value: v })} options={ents.map((x) => ({ value: x.id, label: x.name }))} placeholder="Choose an entity" />;
      break;
    default:
      input = <Input aria-label={`Condition ${n} merchant`} value={c.value} onChange={(e) => onChange({ value: e.target.value })} placeholder="Skyline Air" />;
  }
  return (
    <div className="flex flex-col gap-1">
      {/* One row on a computer. On a phone the value goes on a second line, under the field and the operator. */}
      <div className="grid grid-cols-[48px_minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-2 sm:grid-cols-[48px_170px_130px_minmax(0,1fr)_32px]">
        <span className="text-[12.5px] font-medium text-ink-3">{index === 0 ? "When" : "and"}</span>
        <Select
          aria-label={`Condition ${n} field`}
          value={c.field}
          onValueChange={(f: FieldName) => onChange({ field: f, op: OPS[f][0], value: "" })}
          options={(Object.keys(FIELD_LABELS) as FieldName[]).map((f) => ({ value: f, label: FIELD_LABELS[f] }))}
        />
        <Select aria-label={`Condition ${n} operator`} value={c.op} onValueChange={(op: Condition["op"]) => onChange({ op })} options={OPS[c.field].map((o) => ({ value: o, label: OP_LABELS[o] }))} />
        <div className="col-span-2 col-start-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-auto sm:row-start-auto">{input}</div>
        <span className="col-start-4 row-start-1 sm:col-start-auto sm:row-start-auto">
          {onRemove ? <IconButton label={`Remove condition ${n}`} size="icon-sm" icon={<Trash2 />} onClick={onRemove} /> : null}
        </span>
      </div>
      {error ? <p className="pl-[56px] text-xs text-danger">{error}</p> : null}
    </div>
  );
}
