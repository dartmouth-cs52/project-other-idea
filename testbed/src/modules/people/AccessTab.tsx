import { format } from "date-fns";
import { KeyRound, ShieldCheck, ShieldOff, UserMinus, UserX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ME_ID, patch, upsert, useCollection } from "@/data/store";
import type { Employee, Role } from "@/data/types";
import { ROLE_LABELS, useCan } from "@/lib/access";
import { date, fullName, masked } from "@/lib/format";
import { Button, Tooltip } from "@/ui/button";
import { Badge, Callout, Card } from "@/ui/display";
import { act, RoleGate, SaveBar, Stepper, UnsavedGuard } from "@/ui/flow";
import { Checkbox, Field, Input, RadioCards, Switch } from "@/ui/form";
import { Combobox, DatePicker } from "@/ui/inputs";
import { ConfirmDialog, Modal } from "@/ui/overlay";
import { ROLE_SUMMARY, ROLES, usePeopleOptions } from "./shared";

/**
 * Role, manager, two-factor and account status. Role and manager are saved
 * together from a bar fixed to the bottom of the screen.
 */
export function AccessTab({ person }: { person: Employee }) {
  const manage = useCan("people.manage");
  const managers = usePeopleOptions(person.id);
  const [role, setRole] = useState<Role>(person.role);
  const [managerId, setManagerId] = useState<string | null>(person.managerId);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [offboarding, setOffboarding] = useState(false);
  useEffect(() => {
    setRole(person.role);
    setManagerId(person.managerId);
  }, [person.role, person.managerId]);
  const dirty = role !== person.role || managerId !== person.managerId;
  const self = person.id === ME_ID;
  const gone = person.status === "offboarded";

  const save = async () => {
    setSaving(true);
    await act(() => patch("employees", person.id, { role, managerId }), { success: `Saved ${person.firstName}'s access`, undo: () => upsert("employees", person) });
    setSaving(false);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5 pb-24">
      <UnsavedGuard when={dirty} />
      {gone ? (
        <Callout tone="info" title={`${person.firstName} has been offboarded`}>
          They can't sign in and their cards are closed. Their expenses and approvals history stay in Northpine.
        </Callout>
      ) : null}

      <Card
        title="Role"
        description="What they can see and do in Northpine."
        actions={
          <Button variant="link" size="sm" asChild>
            <Link to="/people/roles">Compare roles</Link>
          </Button>
        }
      >
        <RadioCards
          name="role"
          columns={1}
          value={role}
          onValueChange={setRole}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r], description: ROLE_SUMMARY[r], disabled: !manage.allowed || gone }))}
        />
        {self && role !== "admin" ? (
          <div className="mt-3">
            <Callout tone="warn" title="You'll lose Admin access">
              Another Admin will have to give it back.
            </Callout>
          </div>
        ) : null}
        {!manage.allowed ? <p className="mt-3 text-xs text-ink-3">{manage.reason}</p> : null}
      </Card>

      <Card title="Manager" description="Their manager approves their spend first and sees their cards.">
        <Field label="Reports to" className="max-w-sm">
          {(id) => (
            <Combobox
              id={id}
              aria-label="Reports to"
              value={managerId}
              onChange={setManagerId}
              options={managers}
              placeholder="No manager"
              searchPlaceholder="Search people…"
              disabled={!manage.allowed || gone}
            />
          )}
        </Field>
      </Card>

      <Card title="Two-factor authentication">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-sunken text-ink-2">{person.twoFactor ? <ShieldCheck className="size-4" /> : <ShieldOff className="size-4" />}</span>
            <div className="flex flex-col gap-0.5 text-[13px]">
              <span className="flex items-center gap-2 font-medium">
                {person.twoFactor ? "Set up with an authenticator app" : "Not set up"}
                {person.twoFactor ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}
              </span>
              <span className="text-ink-3">{person.twoFactor ? "Reset it if they lost their phone. They'll set it up again on next sign-in." : "They'll be asked to set it up if your security settings require it."}</span>
            </div>
          </div>
          <RoleGate action="people.manage">
            {(ok) =>
              person.twoFactor ? (
                <Button disabled={!ok || gone} onClick={() => setResetting(true)}>
                  <KeyRound /> Reset two-factor
                </Button>
              ) : (
                // Disabled with the reason only in a tooltip, on purpose.
                <Tooltip content="Two-factor isn't set up, so there's nothing to reset.">
                  <span tabIndex={0} className="inline-flex">
                    <Button disabled>
                      <KeyRound /> Reset two-factor
                    </Button>
                  </span>
                </Tooltip>
              )
            }
          </RoleGate>
        </div>
      </Card>

      <Card title="Account" className="border-danger/30">
        <div className="flex flex-col divide-y divide-line">
          <div className="flex items-start justify-between gap-4 pb-4">
            <div className="flex flex-col gap-0.5 text-[13px]">
              <span className="font-medium">{person.status === "suspended" ? "Access is suspended" : "Suspend access"}</span>
              <span className="text-ink-3">
                {person.status === "suspended" ? "They can't sign in and their cards are declined. Reactivate to restore both." : "Signs them out everywhere and declines their cards until you reactivate them."}
              </span>
            </div>
            <RoleGate action="people.manage">
              {(ok) =>
                person.status === "suspended" ? (
                  <Button disabled={!ok} onClick={() => act(() => patch("employees", person.id, { status: "active" }), { success: `${person.firstName} can sign in again`, undo: () => upsert("employees", person) })}>
                    Reactivate
                  </Button>
                ) : (
                  <Button disabled={!ok || self || gone || person.status === "invited"} onClick={() => setSuspending(true)}>
                    <UserMinus /> Suspend
                  </Button>
                )
              }
            </RoleGate>
          </div>
          <div className="flex items-start justify-between gap-4 pt-4">
            <div className="flex flex-col gap-0.5 text-[13px]">
              <span className="font-medium">Offboard</span>
              <span className="text-ink-3">For people who've left. Cancels or hands over their cards, moves their approvals to someone else and ends access on their last day.</span>
            </div>
            <RoleGate action="people.manage">
              {(ok) => (
                <Button variant="danger" disabled={!ok || self || gone} onClick={() => setOffboarding(true)}>
                  <UserX /> Offboard {person.firstName}
                </Button>
              )}
            </RoleGate>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => (setRole(person.role), setManagerId(person.managerId))} message={`Unsaved changes to ${person.firstName}'s access`} />

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title={`Reset two-factor for ${person.firstName}?`}
        description="Their authenticator stops working right away. They'll set up a new one the next time they sign in."
        confirmLabel="Reset two-factor"
        onConfirm={() => act(() => patch("employees", person.id, { twoFactor: false }), { success: `Two-factor reset for ${fullName(person)}` })}
      />
      <ConfirmDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend ${fullName(person)}?`}
        description="They're signed out everywhere, can't sign in, and their cards are declined until you reactivate them."
        confirmLabel="Suspend"
        danger
        onConfirm={() => act(() => patch("employees", person.id, { status: "suspended" }), { success: `Suspended ${fullName(person)}`, undo: () => upsert("employees", person) })}
      />
      {offboarding ? <OffboardWizard person={person} onClose={() => setOffboarding(false)} /> : null}
    </div>
  );
}

const STEPS = ["Cards", "Approvals", "Last day", "Confirm"];

/** Four steps in one dialog, ending with typing OFFBOARD. Irreversible, on purpose. */
function OffboardWizard({ person, onClose }: { person: Employee; onClose: () => void }) {
  const cards = useCollection("cards");
  const approvals = useCollection("approvals");
  const people = usePeopleOptions(person.id);
  const theirCards = useMemo(() => cards.filter((c) => c.holderId === person.id && c.status !== "cancelled"), [cards, person.id]);
  const waiting = useMemo(() => approvals.filter((a) => a.status === "pending" && a.approverIds.includes(person.id)), [approvals, person.id]);
  const [step, setStep] = useState(0);
  const [cardPlan, setCardPlan] = useState<"cancel" | "reassign">("cancel");
  const [cardTo, setCardTo] = useState<string | null>(person.managerId);
  const [approvalsTo, setApprovalsTo] = useState<string | null>(person.managerId);
  const [lastDay, setLastDay] = useState<string | null>(format(new Date(), "yyyy-MM-dd"));
  const [keepUntilEnd, setKeepUntilEnd] = useState(true);
  const [sendExpenses, setSendExpenses] = useState(true);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string | null) => people.find((p) => p.value === id)?.label ?? "No one";

  const next = () => {
    setError(null);
    if (step === 0 && cardPlan === "reassign" && !cardTo) return setError("Pick who gets the cards.");
    if (step === 1 && waiting.length && !approvalsTo) return setError("Pick who takes over these approvals.");
    if (step === 2 && !lastDay) return setError("Pick their last day.");
    setStep((s) => s + 1);
  };

  const finish = async () => {
    setBusy(true);
    const ok = await act(
      () => {
        for (const c of theirCards) patch("cards", c.id, cardPlan === "cancel" ? { status: "cancelled" } : { holderId: cardTo! });
        for (const a of waiting) patch("approvals", a.id, { approverIds: a.approverIds.map((x) => (x === person.id ? approvalsTo! : x)) });
        patch("employees", person.id, { status: "offboarded" });
        return true;
      },
      { success: `${fullName(person)} is offboarded. Access ends ${lastDay ? date(lastDay) : "today"}.` },
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      size="lg"
      dismissable={false}
      title={`Offboard ${fullName(person)}`}
      description={`Step ${step + 1} of ${STEPS.length}`}
      footer={
        <>
          <Button className="mr-auto" onClick={onClose}>
            Cancel
          </Button>
          {step > 0 ? <Button onClick={() => (setError(null), setStep((s) => s - 1))}>Back</Button> : null}
          {step < STEPS.length - 1 ? (
            <Button key="continue" variant="primary" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button key="finish" variant="danger" loading={busy} disabled={typed !== "OFFBOARD"} onClick={finish}>
              Offboard {person.firstName}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Stepper steps={STEPS} current={step} />
        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-ink-2">
              {theirCards.length ? `${person.firstName} holds ${theirCards.length} ${theirCards.length === 1 ? "card" : "cards"}.` : `${person.firstName} has no open cards.`}
            </p>
            {theirCards.length ? (
              <ul className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 text-[13px]">
                {theirCards.map((c) => (
                  <li key={c.id} className="flex justify-between">
                    <span>{c.nickname}</span>
                    <span className="font-mono text-ink-3">{masked(c.last4)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {theirCards.length ? (
              <RadioCards
                name="cards"
                value={cardPlan}
                onValueChange={setCardPlan}
                options={[
                  { value: "cancel", label: "Cancel their cards", description: "Recurring charges on them will fail." },
                  { value: "reassign", label: "Hand them to someone", description: "Good for cards that pay for software." },
                ]}
              />
            ) : null}
            {/* Shows only when handing cards over, on purpose. */}
            {cardPlan === "reassign" && theirCards.length ? (
              <Field label="New cardholder" error={error} className="max-w-sm">
                {(id) => <Combobox id={id} aria-label="New cardholder" value={cardTo} onChange={(v) => (setCardTo(v), setError(null))} options={people} placeholder="Choose a person" searchPlaceholder="Search people…" />}
              </Field>
            ) : null}
          </div>
        ) : step === 1 ? (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-ink-2">
              {waiting.length ? `${waiting.length} ${waiting.length === 1 ? "request is" : "requests are"} waiting on ${person.firstName}.` : `Nothing is waiting on ${person.firstName}. You can still pick who takes over future requests.`}
            </p>
            <Field label="Transfer approvals to" error={error} hint="Their manager is picked by default." className="max-w-sm">
              {(id) => <Combobox id={id} aria-label="Transfer approvals to" value={approvalsTo} onChange={(v) => (setApprovalsTo(v), setError(null))} options={people} placeholder="Choose a person" searchPlaceholder="Search people…" />}
            </Field>
          </div>
        ) : step === 2 ? (
          <div className="flex flex-col gap-4">
            <Field label="Last day" error={error} className="max-w-xs">
              {(id) => <DatePicker id={id} value={lastDay} onChange={(v) => (setLastDay(v), setError(null))} />}
            </Field>
            <Switch checked={keepUntilEnd} onCheckedChange={setKeepUntilEnd} label="Keep access until the end of that day" description="Otherwise access ends as soon as you finish." />
            <Checkbox checked={sendExpenses} onCheckedChange={setSendExpenses} label={`Email ${person.firstName}'s manager a copy of their open expenses`} />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Callout tone="danger" title="This can't be undone">
              {person.firstName} won't be able to sign in again. To bring them back you'd send a new invite.
            </Callout>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              <li>
                <span className="text-ink-3">Cards: </span>
                {theirCards.length ? (cardPlan === "cancel" ? `Cancel ${theirCards.length}` : `Hand ${theirCards.length} to ${nameOf(cardTo)}`) : "None to change"}
              </li>
              <li>
                <span className="text-ink-3">Approvals: </span>
                {waiting.length ? `Move ${waiting.length} to ${nameOf(approvalsTo)}` : `Future requests go to ${nameOf(approvalsTo)}`}
              </li>
              <li>
                <span className="text-ink-3">Last day: </span>
                {lastDay ? date(lastDay) : "Today"}
                {keepUntilEnd ? ", access ends at midnight" : ", access ends now"}
              </li>
            </ul>
            <Field label={<>Type <span className="font-mono font-semibold">OFFBOARD</span> to confirm</>}>
              {(id) => <Input id={id} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-xs" />}
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
