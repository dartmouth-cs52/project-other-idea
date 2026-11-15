import { addDays, formatISO } from "date-fns";
import { CreditCard, Smartphone, User, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { get, ME_ID, newId, upsert, useCollection, useIndex, useRow } from "@/data/store";
import type { Approval, Card } from "@/data/types";
import { useCan } from "@/lib/access";
import { fullName, money } from "@/lib/format";
import { Button } from "@/ui/button";
import { Callout, Card as Panel, DescriptionList, PageHeader } from "@/ui/display";
import { Checkbox, Field, Input, NativeSelect, RadioCards, RadioList, Select, Switch, Textarea } from "@/ui/form";
import { act, Stepper, UnsavedGuard } from "@/ui/flow";
import { Combobox, DatePicker, MultiSelect } from "@/ui/inputs";
import { CardArt, INTERVAL_LABELS, INTERVAL_OPTIONS } from "./shared";

// Issuing a card is a four-step wizard for Admin and Finance. Everyone else
// lands on the request form instead, which creates an approval.

const STEPS = ["Cardholder", "Card type", "Limits and controls", "Review"];
const US_STATES = ["AZ", "CA", "CO", "FL", "GA", "IL", "MA", "NY", "OR", "TX", "WA"];

interface Draft {
  forWhom: "me" | "someone";
  holderId: string | null;
  nickname: string;
  kind: Card["kind"];
  shipName: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  shipping: "standard" | "express";
  amount: string;
  interval: Card["limitInterval"] | "";
  categories: string[];
  lockMerchant: boolean;
  merchant: string;
  autoLock: boolean;
  autoLockDate: string | null;
  receiptsRequired: boolean;
}

const EMPTY: Draft = {
  forWhom: "me",
  holderId: null,
  nickname: "",
  kind: "virtual",
  shipName: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  zip: "",
  shipping: "standard",
  amount: "",
  interval: "",
  categories: [],
  lockMerchant: false,
  merchant: "",
  autoLock: false,
  autoLockDate: null,
  receiptsRequired: true,
};

type Errors = Partial<Record<keyof Draft, string>>;

function validate(step: number, d: Draft): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (d.forWhom === "someone" && !d.holderId) e.holderId = "Pick who the card is for.";
    if (!d.nickname.trim()) e.nickname = "Give the card a name so people know what it's for.";
  }
  if (step === 1 && d.kind === "physical") {
    if (!d.shipName.trim()) e.shipName = "Enter the name to print on the card.";
    if (!d.line1.trim()) e.line1 = "Enter a street address.";
    if (!d.city.trim()) e.city = "Enter a city.";
    if (!d.state) e.state = "Pick a state.";
    if (!/^\d{5}$/.test(d.zip.trim())) e.zip = "Enter a 5-digit ZIP code.";
  }
  if (step === 2) {
    const n = Number(d.amount);
    if (!d.amount || !Number.isFinite(n) || n <= 0) e.amount = "Enter a limit above $0.";
    else if (n > 50000) e.amount = "Limits above $50,000 need a call with your Northpine account manager.";
    if (!d.interval) e.interval = "Pick how often the limit resets.";
    if (d.lockMerchant && !d.merchant.trim()) e.merchant = "Enter the merchant, or turn off the merchant lock.";
    if (d.autoLock && !d.autoLockDate) e.autoLockDate = "Pick the date the card locks.";
  }
  return e;
}

export function NewCardPage() {
  const issue = useCan("cards.issue");
  if (!issue.allowed) return <RequestCardPage blocked={issue.reason} />;
  return <IssueWizard />;
}

function IssueWizard() {
  const navigate = useNavigate();
  const me = useRow("employees", ME_ID);
  const people = useCollection("employees");
  const peopleById = useIndex("employees");
  const categories = useCollection("categories");
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const dirty = !doneId && JSON.stringify(d) !== JSON.stringify(EMPTY);

  useEffect(() => {
    if (doneId) navigate(`/cards/${doneId}`);
  }, [doneId, navigate]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const holderId = d.forWhom === "me" ? ME_ID : d.holderId;
  const holder = holderId ? peopleById.get(holderId) : undefined;
  const holderOptions = useMemo(
    () => people.filter((p) => p.status === "active" && p.id !== ME_ID).map((p) => ({ value: p.id, label: fullName(p), hint: p.title })),
    [people],
  );
  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  const next = () => {
    const e = validate(step, d);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    if (!holder) return;
    setBusy(true);
    const last4 = String(1000 + Math.floor(Math.random() * 9000));
    const number = `4${String(Math.floor(Math.random() * 1e14)).padStart(11, "0").slice(0, 11)}${last4}`;
    const card: Card = {
      id: newId("card"),
      holderId: holder.id,
      nickname: d.nickname.trim(),
      kind: d.kind,
      network: "visa",
      number,
      last4,
      expiry: `${String(new Date().getMonth() + 1).padStart(2, "0")}/${String((new Date().getFullYear() + 4) % 100)}`,
      cvc: String(100 + Math.floor(Math.random() * 900)),
      status: d.kind === "physical" ? "shipping" : "active",
      limitAmount: Number(d.amount),
      limitInterval: d.interval as Card["limitInterval"],
      spentThisPeriod: 0,
      entityId: holder.entityId,
      departmentId: holder.departmentId,
      categoriesAllowed: d.categories,
      merchantLock: d.lockMerchant ? d.merchant.trim() : null,
      createdAt: formatISO(new Date()),
      autoLockDate: d.autoLock ? d.autoLockDate : null,
    };
    await act(() => upsert("cards", card), {
      success: d.kind === "physical" ? `Card ordered for ${holder.firstName}. It ships in 5 to 7 business days.` : `Virtual card issued to ${holder.firstName}. It's ready to use.`,
    });
    setBusy(false);
    // act() resolves undefined on success too, since upsert returns nothing, so check the store.
    if (get("cards", card.id)) setDoneId(card.id);
  };

  return (
    <>
      <PageHeader
        title="Issue a card"
        crumbs={[{ label: "Cards", to: "/cards" }, { label: "Issue a card" }]}
        description="Set who holds it, what kind it is, and how much it can spend. You can change limits later."
      />
      <UnsavedGuard when={dirty} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <div className="overflow-x-auto">
            <Stepper steps={STEPS} current={step} />
          </div>
          <Panel
            title={STEPS[step]}
            description={
              ["Who will use this card?", "Virtual cards work online right away. Physical ones ship to an address.", "Spending stops at the limit and resets on the interval you pick.", "Check everything before you issue the card."][step]
            }
            footer={
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" asChild>
                  <Link to="/cards">Cancel</Link>
                </Button>
                <div className="flex items-center gap-2">
                  <span className="mr-2 text-xs text-ink-3">
                    Step {step + 1} of {STEPS.length}
                  </span>
                  <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                    Back
                  </Button>
                  {step < STEPS.length - 1 ? (
                    <Button variant="primary" onClick={next}>
                      Next
                    </Button>
                  ) : (
                    <Button variant="primary" loading={busy} onClick={submit}>
                      Issue card
                    </Button>
                  )}
                </div>
              </div>
            }
          >
            {step === 0 ? (
              <div className="flex flex-col gap-5">
                <RadioCards
                  value={d.forWhom}
                  onValueChange={(v) => set("forWhom", v)}
                  options={[
                    { value: "me", label: "For myself", description: `${me ? fullName(me) : "You"}, ${me?.title ?? ""}`, icon: <User /> },
                    { value: "someone", label: "For someone else", description: "A teammate, contractor or new hire", icon: <Users /> },
                  ]}
                />
                {/* Appears only after "For someone else" is picked. */}
                {d.forWhom === "someone" ? (
                  <Field label="Cardholder" error={errors.holderId} hint="They'll get an email when the card is ready.">
                    {(id) => <Combobox id={id} aria-label="Cardholder" value={d.holderId} onChange={(v) => set("holderId", v)} options={holderOptions} placeholder="Search people…" searchPlaceholder="Type a name…" />}
                  </Field>
                ) : null}
                <Field label="Card name" error={errors.nickname} hint='Shown on statements and in the cards list, like "Figma subscription" or "Berlin offsite".'>
                  {(id) => <Input id={id} value={d.nickname} onChange={(e) => set("nickname", e.target.value)} placeholder="What is this card for?" aria-invalid={!!errors.nickname} />}
                </Field>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="flex flex-col gap-5">
                <RadioCards
                  value={d.kind}
                  onValueChange={(v) => set("kind", v)}
                  options={[
                    { value: "virtual", label: "Virtual card", description: "Use online and in Apple Pay in minutes. Best for subscriptions and one-off purchases.", icon: <Smartphone /> },
                    { value: "physical", label: "Physical card", description: "A metal card mailed to the holder. Best for travel and in-person spend.", icon: <CreditCard /> },
                  ]}
                />
                {/* The shipping section only exists for physical cards. On purpose. */}
                {d.kind === "physical" ? (
                  <section aria-label="Shipping address" className="flex flex-col gap-4 rounded-lg border border-line bg-sunken/50 p-4">
                    <div>
                      <h3 className="text-[13px] font-semibold">Shipping address</h3>
                      <p className="text-xs text-ink-3">Cards ship by tracked mail and arrive inactive. The holder activates it in Northpine.</p>
                    </div>
                    <Field label="Name on card" error={errors.shipName}>
                      {(id) => <Input id={id} value={d.shipName} onChange={(e) => set("shipName", e.target.value)} placeholder={holder ? fullName(holder) : ""} aria-invalid={!!errors.shipName} />}
                    </Field>
                    <Field label="Street address" error={errors.line1}>
                      {(id) => <Input id={id} value={d.line1} onChange={(e) => set("line1", e.target.value)} autoComplete="off" aria-invalid={!!errors.line1} />}
                    </Field>
                    <Field label="Apartment, suite or floor" optional>
                      {(id) => <Input id={id} value={d.line2} onChange={(e) => set("line2", e.target.value)} autoComplete="off" />}
                    </Field>
                    <div className="grid grid-cols-[1fr_110px_120px] gap-3">
                      <Field label="City" error={errors.city}>
                        {(id) => <Input id={id} value={d.city} onChange={(e) => set("city", e.target.value)} aria-invalid={!!errors.city} />}
                      </Field>
                      <Field label="State" error={errors.state}>
                        {(id) => (
                          <NativeSelect id={id} value={d.state} onChange={(e) => set("state", e.target.value)} aria-invalid={!!errors.state}>
                            <option value="">State</option>
                            {US_STATES.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </NativeSelect>
                        )}
                      </Field>
                      <Field label="ZIP code" error={errors.zip}>
                        {(id) => <Input id={id} inputMode="numeric" value={d.zip} onChange={(e) => set("zip", e.target.value)} aria-invalid={!!errors.zip} />}
                      </Field>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-[13px] font-medium">Shipping speed</span>
                      <RadioList
                        value={d.shipping}
                        onValueChange={(v) => set("shipping", v)}
                        options={[
                          { value: "standard", label: "Standard, 5 to 7 business days. Free" },
                          { value: "express", label: "Express, 2 business days. $25 charged to the company" },
                        ]}
                      />
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Spending limit" error={errors.amount}>
                    {(id) => <Input id={id} prefix="$" inputMode="decimal" value={d.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" aria-invalid={!!errors.amount} />}
                  </Field>
                  <Field label="Resets" error={errors.interval}>
                    {(id) => <Select id={id} aria-label="Limit interval" value={d.interval} onValueChange={(v) => set("interval", v)} options={INTERVAL_OPTIONS} placeholder="Pick an interval" />}
                  </Field>
                </div>
                <Field label="Allowed categories" hint="Leave empty to allow every category your policy allows." optional>
                  {(id) => <MultiSelect id={id} aria-label="Allowed categories" value={d.categories} onChange={(v) => set("categories", v)} options={categoryOptions} placeholder="+ Add category" />}
                </Field>
                <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
                  <Switch checked={d.lockMerchant} onCheckedChange={(v) => set("lockMerchant", v)} label="Lock to one merchant" description="Charges from any other merchant are declined. Good for subscriptions." />
                  {d.lockMerchant ? (
                    <Field label="Merchant" error={errors.merchant}>
                      {(id) => <Input id={id} value={d.merchant} onChange={(e) => set("merchant", e.target.value)} placeholder="e.g. CloudStack Hosting" aria-invalid={!!errors.merchant} />}
                    </Field>
                  ) : null}
                </div>
                <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
                  <Switch checked={d.autoLock} onCheckedChange={(v) => set("autoLock", v)} label="Lock the card on a date" description="For trips, events and contractors. The card freezes itself at midnight." />
                  {d.autoLock ? (
                    <Field label="Lock date" error={errors.autoLockDate}>
                      {(id) => <DatePicker id={id} value={d.autoLockDate} onChange={(v) => set("autoLockDate", v)} disabledBefore={addDays(new Date(), 1)} />}
                    </Field>
                  ) : null}
                </div>
                <Checkbox checked={d.receiptsRequired} onCheckedChange={(v) => set("receiptsRequired", v)} label="Ask the holder for a receipt after every charge" />
              </div>
            ) : null}

            {step === 3 ? (
              <div className="flex flex-col gap-5">
                <ReviewBlock title="Cardholder" onEdit={() => setStep(0)}>
                  <DescriptionList
                    items={[
                      { label: "Holder", value: holder ? fullName(holder) : "Not picked" },
                      { label: "Card name", value: d.nickname },
                    ]}
                  />
                </ReviewBlock>
                <ReviewBlock title="Card type" onEdit={() => setStep(1)}>
                  <DescriptionList
                    items={[
                      { label: "Type", value: d.kind === "virtual" ? "Virtual" : "Physical" },
                      ...(d.kind === "physical"
                        ? [
                            { label: "Ships to", value: `${d.line1}${d.line2 ? `, ${d.line2}` : ""}, ${d.city}, ${d.state} ${d.zip}` },
                            { label: "Shipping", value: d.shipping === "express" ? "Express, 2 business days" : "Standard, 5 to 7 business days" },
                          ]
                        : []),
                    ]}
                  />
                </ReviewBlock>
                <ReviewBlock title="Limits and controls" onEdit={() => setStep(2)}>
                  <DescriptionList
                    items={[
                      { label: "Limit", value: `${money(Number(d.amount) || 0)} ${d.interval ? INTERVAL_LABELS[d.interval].toLowerCase() : ""}` },
                      { label: "Categories", value: d.categories.length ? d.categories.map((c) => categories.find((x) => x.id === c)?.name).join(", ") : "Any allowed by policy" },
                      { label: "Merchant", value: d.lockMerchant ? d.merchant : "Any merchant" },
                      { label: "Locks on", value: d.autoLock && d.autoLockDate ? d.autoLockDate : "Never" },
                    ]}
                  />
                </ReviewBlock>
              </div>
            ) : null}
          </Panel>
        </div>
        <aside className="flex flex-col gap-3 lg:pt-12">
          <p className="text-xs font-medium text-ink-3">Preview</p>
          <CardArt
            card={{ kind: d.kind, network: "visa", last4: "0000", status: "active", nickname: d.nickname || "New card", number: "", expiry: "", cvc: "" }}
            holderName={holder ? fullName(holder) : "Cardholder"}
          />
          <p className="text-xs text-ink-3">The card number is generated when you issue it. Only the holder can reveal it.</p>
        </aside>
      </div>
    </>
  );
}

function ReviewBlock({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <Button variant="link" size="sm" onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          Edit
        </Button>
      </div>
      {children}
    </section>
  );
}

/** For people who can't issue cards. Creates a card_request approval for their manager and Finance. */
export function RequestCardPage({ blocked }: { blocked?: string }) {
  const navigate = useNavigate();
  const me = useRow("employees", ME_ID);
  const [kind, setKind] = useState<Card["kind"]>("virtual");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<Card["limitInterval"] | "">("monthly");
  const [why, setWhy] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const dirty = !sent && (!!purpose || !!amount || !!why);

  useEffect(() => {
    if (sent) navigate("/cards?view=mine");
  }, [sent, navigate]);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!purpose.trim()) e.purpose = "Say what the card is for.";
    if (!(Number(amount) > 0)) e.amount = "Enter the amount you expect to spend.";
    if (!interval) e.interval = "Pick how often.";
    if (why.trim().length < 10) e.why = "Add a sentence or two so your approver has context.";
    setErrors(e);
    if (Object.keys(e).length || !me) return;
    setBusy(true);
    const approval: Approval = {
      id: newId("apr"),
      kind: "card_request",
      title: `New ${kind} card for ${fullName(me)}: ${purpose.trim()}`,
      requesterId: ME_ID,
      amount: Number(amount),
      currency: "USD",
      createdAt: formatISO(new Date()),
      dueAt: formatISO(addDays(new Date(), 3)),
      status: "pending",
      stage: "manager",
      approverIds: [me.managerId ?? ME_ID],
      subjectId: "",
      comments: [{ authorId: ME_ID, body: why.trim(), at: formatISO(new Date()) }],
    };
    await act(() => upsert("approvals", approval), { success: "Request sent. You'll get an email when it's approved." });
    setBusy(false);
    if (get("approvals", approval.id)) setSent(true);
  };

  return (
    <>
      <PageHeader title="Request a card" crumbs={[{ label: "Cards", to: "/cards" }, { label: "Request a card" }]} description="Tell your approver what the card is for. Finance issues it once it's approved." />
      <UnsavedGuard when={dirty} />
      <div className="flex max-w-2xl flex-col gap-5">
        {blocked ? (
          <Callout tone="info" title="You can't issue cards yourself">
            {blocked} Send a request instead and Finance will issue the card.
          </Callout>
        ) : null}
        <Panel
          footer={
            <div className="flex justify-end gap-2">
              <Button asChild variant="ghost">
                <Link to="/cards">Cancel</Link>
              </Button>
              <Button variant="primary" loading={busy} onClick={submit}>
                Send request
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-5">
            <RadioCards
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "virtual", label: "Virtual card", description: "For software, ads and online purchases", icon: <Smartphone /> },
                { value: "physical", label: "Physical card", description: "For travel, meals and in-person spend", icon: <CreditCard /> },
              ]}
            />
            <Field label="What's it for?" error={errors.purpose}>
              {(id) => <Input id={id} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Figma subscription" aria-invalid={!!errors.purpose} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expected spend" error={errors.amount}>
                {(id) => <Input id={id} prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-invalid={!!errors.amount} />}
              </Field>
              <Field label="How often" error={errors.interval}>
                {(id) => <Select id={id} aria-label="How often" value={interval} onValueChange={setInterval} options={INTERVAL_OPTIONS} />}
              </Field>
            </div>
            <Field label="Why do you need it?" error={errors.why} hint="Your manager sees this first, then Finance.">
              {(id) => <Textarea id={id} value={why} onChange={(e) => setWhy(e.target.value)} aria-invalid={!!errors.why} />}
            </Field>
          </div>
        </Panel>
      </div>
    </>
  );
}
