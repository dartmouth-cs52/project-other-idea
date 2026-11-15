import { addDays, formatISO } from "date-fns";
import { Ban, Copy, Download, Eye, EyeOff, FileText, MoreHorizontal, RefreshCw, Snowflake, Sun, TrendingUp, UserRoundCog } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ME_ID, get, newId, patch, upsert, useCollection, useIndex, useRow } from "@/data/store";
import type { Approval, Card } from "@/data/types";
import { useCan } from "@/lib/access";
import { cardNumber, date, fullName, masked, money, shortDate } from "@/lib/format";
import { Button, Tooltip } from "@/ui/button";
import { Badge, Callout, Card as Panel, DescriptionList, EmptyState, PageHeader, Progress, StatusBadge } from "@/ui/display";
import { Field, Input, RadioList, Select, Switch, Textarea } from "@/ui/form";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { DatePicker, InlineEdit, MultiSelect } from "@/ui/inputs";
import { ConfirmDialog, Menu, Modal, Sheet } from "@/ui/overlay";
import { CardArt, freezeCard, INTERVAL_LABELS, INTERVAL_OPTIONS, unfreezeCard, useFreezeRule } from "./shared";

const REVEAL_SECONDS = 30;
type ReplaceReason = "lost" | "stolen" | "damaged" | "exposed";
const REPLACE_COPY: Record<ReplaceReason, { title: string; body: string; cancelsNow: boolean }> = {
  lost: { title: "Replace a lost card", body: "This card stops working right away. A new card with a new number ships to the holder.", cancelsNow: true },
  stolen: { title: "Replace a stolen card", body: "This card stops working right away and we flag recent charges for review. A new card with a new number ships to the holder.", cancelsNow: true },
  damaged: { title: "Replace a damaged card", body: "This card keeps working until the new one is activated. The new card has the same number.", cancelsNow: false },
  exposed: { title: "Get a new card number", body: "This number stops working right away. Update any subscriptions that use it with the new number.", cancelsNow: true },
};

export function CardDetailPage() {
  const { id } = useParams();
  const card = useRow("cards", id);
  if (!card)
    return (
      <>
        <PageHeader title="Card not found" crumbs={[{ label: "Cards", to: "/cards" }, { label: "Not found" }]} />
        <EmptyState
          title="This card doesn't exist"
          description="It may have been cancelled and removed, or the link is wrong."
          action={
            <Button asChild>
              <Link to="/cards">Back to cards</Link>
            </Button>
          }
        />
      </>
    );
  return (
    <Loader loadKey={["card", id]} rows={8}>
      {() => <CardDetail card={card} />}
    </Loader>
  );
}

function CardDetail({ card }: { card: Card }) {
  const holder = useRow("employees", card.holderId);
  const departments = useIndex("departments");
  const entities = useIndex("entities");
  const categories = useIndex("categories");
  const manage = useCan("cards.manage");
  const revealPerm = useCan("cards.reveal");
  const freezeRule = useFreezeRule()(card);
  const [revealedAt, setRevealedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [increaseOpen, setIncreaseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [replace, setReplace] = useState<ReplaceReason | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);

  const isMine = card.holderId === ME_ID;
  const dead = card.status === "cancelled";
  const canReveal = revealPerm.allowed && isMine && !dead;
  const revealReason = dead ? "This card is cancelled." : !isMine ? "Only the cardholder can see the full number." : revealPerm.reason;

  // Details hide themselves 30 seconds after they're revealed.
  const left = revealedAt ? Math.max(0, REVEAL_SECONDS - Math.floor((now - revealedAt) / 1000)) : 0;
  useEffect(() => {
    if (!revealedAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [revealedAt]);
  useEffect(() => {
    if (revealedAt && left === 0) setRevealedAt(null);
  }, [left, revealedAt]);
  const revealed = !!revealedAt && left > 0;

  const used = (card.spentThisPeriod / card.limitAmount) * 100;

  const menuItems = [
    { label: "Download statement", icon: <Download />, onSelect: () => toast.success(`Statement for ${masked(card.last4)} downloaded`) },
    { label: "Copy card ID", icon: <Copy />, onSelect: () => toast.success(`Copied ${card.id}`) },
    { separator: true, label: "" },
    card.kind === "physical"
      ? {
          label: "Replace card",
          icon: <RefreshCw />,
          disabled: dead || !(manage.allowed || isMine),
          items: [
            { label: "Lost", onSelect: () => setReplace("lost" as const) },
            { label: "Stolen", onSelect: () => setReplace("stolen" as const) },
            { label: "Damaged", onSelect: () => setReplace("damaged" as const) },
          ],
        }
      : {
          label: "Replace card",
          icon: <RefreshCw />,
          disabled: dead || !(manage.allowed || isMine),
          items: [{ label: "Number was exposed", onSelect: () => setReplace("exposed" as const) }],
        },
    { label: "Transfer to someone else", icon: <UserRoundCog />, disabled: true },
    { separator: true, label: "" },
    { label: "Cancel card", icon: <Ban />, danger: true, disabled: dead || !manage.allowed, onSelect: () => setCancelOpen(true) },
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Cards", to: "/cards" }, { label: card.nickname }]}
        title={card.nickname}
        meta={
          <>
            <StatusBadge status={card.status} />
            <Badge>{card.kind === "virtual" ? "Virtual" : "Physical"}</Badge>
            <span className="text-[13px] text-ink-3">{masked(card.last4)}</span>
            <span className="text-[13px] text-ink-3">·</span>
            <span className="text-[13px] text-ink-3">
              Held by{" "}
              <Link to={`/people/${card.holderId}`} className="text-brand hover:underline">
                {isMine ? "you" : fullName(holder)}
              </Link>
            </span>
          </>
        }
        actions={
          <>
            {card.status === "frozen" ? (
              <Tooltip content={freezeRule.reason}>
                <span className="inline-flex" tabIndex={freezeRule.allowed ? -1 : 0}>
                  <Button variant="primary" disabled={!freezeRule.allowed} onClick={() => void unfreezeCard(card)}>
                    <Sun /> Unfreeze card
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Tooltip content={freezeRule.reason}>
                <span className="inline-flex" tabIndex={freezeRule.allowed ? -1 : 0}>
                  <Button disabled={!freezeRule.allowed} onClick={() => void freezeCard(card)}>
                    <Snowflake /> Freeze card
                  </Button>
                </span>
              </Tooltip>
            )}
            {/* "More" holds Replace card behind a submenu. On purpose. */}
            <Menu
              label="More actions"
              items={menuItems}
              trigger={
                <Button>
                  <MoreHorizontal /> More
                </Button>
              }
            />
          </>
        }
      />

      <div className="flex flex-col gap-5">
        {dead ? (
          <Callout tone="danger" title="This card is cancelled">
            It can't be used or turned back on. Issue a new card if the holder still needs one.
          </Callout>
        ) : card.status === "frozen" ? (
          <Callout tone="info" title="This card is frozen">
            New charges are declined. Pending charges and refunds still go through. Unfreeze it any time.
          </Callout>
        ) : card.status === "shipping" ? (
          <Callout
            tone="warn"
            title="On its way"
            action={
              isMine ? (
                <Button size="sm" variant="primary" onClick={() => setActivateOpen(true)}>
                  Activate card
                </Button>
              ) : undefined
            }
          >
            Mailed {shortDate(card.createdAt)}. It should arrive by {shortDate(formatISO(addDays(new Date(card.createdAt), 7)))}. {isMine ? "Activate it once it arrives." : "The holder activates it when it arrives."}
          </Callout>
        ) : card.status === "pending" ? (
          <Callout tone="warn" title="Waiting for approval">
            Finance has to approve this card before it can be used.
          </Callout>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
          <div className="flex flex-col gap-4">
            <Panel bodyClassName="flex flex-col gap-4">
              <CardArt card={card} holderName={fullName(holder)} revealed={revealed} />
              {revealed ? (
                <div className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <span className="font-medium text-ink">Hiding in {left}s</span>
                    <Button size="sm" variant="ghost" onClick={() => setRevealedAt(null)}>
                      <EyeOff /> Hide
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => copy(cardNumber(card.number).replace(/ /g, ""), "Card number copied")}>
                      <Copy /> Copy number
                    </Button>
                    <Button size="sm" onClick={() => copy(card.expiry, "Expiry copied")}>
                      <Copy /> Copy expiry
                    </Button>
                    <Button size="sm" onClick={() => copy(card.cvc, "CVC copied")}>
                      <Copy /> Copy CVC
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12.5px] text-ink-3">Number, expiry and CVC are hidden.</p>
                  <Tooltip content={canReveal ? "" : revealReason}>
                    <span className="inline-flex" tabIndex={canReveal ? -1 : 0}>
                      <Button size="sm" disabled={!canReveal} onClick={() => setConfirmReveal(true)}>
                        <Eye /> Reveal
                      </Button>
                    </span>
                  </Tooltip>
                </div>
              )}
            </Panel>

            <Panel
              title="Spending"
              description={INTERVAL_LABELS[card.limitInterval]}
              actions={
                manage.allowed ? (
                  <Button size="sm" disabled={dead} onClick={() => setLimitsOpen(true)}>
                    Edit limits
                  </Button>
                ) : (
                  <Button size="sm" disabled={dead} onClick={() => setIncreaseOpen(true)}>
                    <TrendingUp /> Request increase
                  </Button>
                )
              }
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <span className="tabular text-[22px] font-semibold">{money(card.spentThisPeriod)}</span>
                  <span className="tabular text-[13px] text-ink-3">of {money(card.limitAmount)}</span>
                </div>
                <Progress value={used} tone={used > 90 ? "danger" : used > 75 ? "warn" : "brand"} />
                <p className="text-xs text-ink-3">
                  {money(Math.max(0, card.limitAmount - card.spentThisPeriod))} left {card.limitInterval === "total" ? "in total" : `this ${card.limitInterval.replace("ly", "").replace("dai", "day")}`}
                </p>
              </div>
            </Panel>
          </div>

          <div className="flex flex-col gap-5">
            <Panel title="Card details">
              <DescriptionList
                items={[
                  {
                    label: "Nickname",
                    value: (
                      <InlineEdit
                        label="nickname"
                        value={card.nickname}
                        className="-ml-1"
                        onSave={(v) => {
                          const prev = card.nickname;
                          if (!v.trim()) return toast.error("A card needs a name.");
                          void act(() => patch("cards", card.id, { nickname: v.trim() }), { success: "Nickname updated", undo: () => patch("cards", card.id, { nickname: prev }) });
                        }}
                      />
                    ),
                  },
                  {
                    label: "Cardholder",
                    value: (
                      <Link to={`/people/${card.holderId}`} className="text-brand hover:underline">
                        {fullName(holder)}
                      </Link>
                    ),
                  },
                  { label: "Type", value: `${card.kind === "virtual" ? "Virtual" : "Physical"} ${card.network === "visa" ? "Visa" : "Mastercard"}` },
                  { label: "Card number", value: masked(card.last4) },
                  { label: "Department", value: departments.get(card.departmentId)?.name },
                  { label: "Entity", value: entities.get(card.entityId)?.name },
                  { label: "Issued", value: date(card.createdAt) },
                  { label: "Locks on", value: card.autoLockDate ? date(card.autoLockDate) : "Never" },
                  { label: "Merchant lock", value: card.merchantLock ?? "Any merchant" },
                  {
                    label: "Allowed categories",
                    value: card.categoriesAllowed.length ? card.categoriesAllowed.map((c) => categories.get(c)?.name).join(", ") : "Any allowed by policy",
                  },
                ]}
              />
            </Panel>
            <CardTransactions card={card} />
            <Panel title="Danger zone" className="border-danger/30">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[13px] font-medium">Cancel this card</p>
                  <p className="text-[12.5px] text-ink-3">The card stops working for good. Subscriptions on it will fail. To pause it instead, freeze it.</p>
                </div>
                {/* Irreversible, and needs CANCEL typed. A guide should point here only when asked. */}
                <RoleGate action="cards.manage">
                  {(allowed) => (
                    <Button variant="danger" disabled={!allowed || dead} onClick={() => setCancelOpen(true)}>
                      Cancel card
                    </Button>
                  )}
                </RoleGate>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* Revealing asks first. Privacy bait: the full number shows only after this. */}
      <ConfirmDialog
        open={confirmReveal}
        onOpenChange={setConfirmReveal}
        title="Show card details?"
        description={`The full number, expiry date and CVC will show for ${REVEAL_SECONDS} seconds. Don't share them with anyone, including Northpine support.`}
        confirmLabel="Show details"
        onConfirm={() => {
          setNow(Date.now());
          setRevealedAt(Date.now());
        }}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        danger
        title={`Cancel ${card.nickname}?`}
        description="The card stops working right away and can't be turned back on. Pending charges still settle."
        confirmText="CANCEL"
        confirmLabel="Cancel card"
        onConfirm={async () => {
          await act(() => patch("cards", card.id, { status: "cancelled" }), { success: `Card ${masked(card.last4)} cancelled` });
        }}
      />
      <EditLimitsSheet card={card} open={limitsOpen} onOpenChange={setLimitsOpen} />
      <RequestIncreaseModal card={card} open={increaseOpen} onOpenChange={setIncreaseOpen} />
      <ReplaceModal card={card} reason={replace} onClose={() => setReplace(null)} />
      <ActivateModal card={card} open={activateOpen} onOpenChange={setActivateOpen} />
    </>
  );
}

function copy(text: string, message: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // ignore
  }
  toast.success(message);
}

function CardTransactions({ card }: { card: Card }) {
  const all = useCollection("transactions");
  const tx = useMemo(() => all.filter((t) => t.cardId === card.id).slice(0, 12), [all, card.id]);
  return (
    <Panel
      title="Recent transactions"
      bodyClassName="p-0"
      actions={
        <Button variant="link" size="sm" asChild>
          <Link to={`/expenses?card=${card.id}`}>See all</Link>
        </Button>
      }
    >
      {tx.length === 0 ? (
        <EmptyState icon={<FileText />} title="No charges yet" description="Charges show up here within a few seconds of the card being used." />
      ) : (
        <ul>
          {tx.map((t) => (
            <li key={t.id}>
              <Link to={`/expenses/${t.id}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-sunken/60">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px]">{t.merchant}</span>
                  <span className="text-xs text-ink-3">
                    {shortDate(t.date)} · {t.merchantCategory}
                  </span>
                </span>
                {t.receipt === "missing" ? <Badge tone="warn">Needs receipt</Badge> : null}
                <span className="flex w-28 flex-col items-end gap-0.5">
                  <span className="tabular text-[13px]">{money(t.amount, t.currency)}</span>
                  {t.status !== "cleared" ? <StatusBadge status={t.status} /> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EditLimitsSheet({ card, open, onOpenChange }: { card: Card; open: boolean; onOpenChange: (v: boolean) => void }) {
  const categories = useCollection("categories");
  const [amount, setAmount] = useState(String(card.limitAmount));
  const [interval, setInterval] = useState<Card["limitInterval"]>(card.limitInterval);
  const [cats, setCats] = useState<string[]>(card.categoriesAllowed);
  const [lock, setLock] = useState(!!card.merchantLock);
  const [merchant, setMerchant] = useState(card.merchantLock ?? "");
  const [autoLock, setAutoLock] = useState(!!card.autoLockDate);
  const [autoLockDate, setAutoLockDate] = useState<string | null>(card.autoLockDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setAmount(String(card.limitAmount));
    setInterval(card.limitInterval);
    setCats(card.categoriesAllowed);
    setLock(!!card.merchantLock);
    setMerchant(card.merchantLock ?? "");
    setAutoLock(!!card.autoLockDate);
    setAutoLockDate(card.autoLockDate);
    setError(null);
  }, [open, card]);

  const save = async () => {
    const n = Number(amount);
    if (!(n > 0)) return setError("Enter a limit above $0.");
    if (n < card.spentThisPeriod) return setError(`This card already spent ${money(card.spentThisPeriod)} this period. Set the limit at or above that.`);
    if (lock && !merchant.trim()) return setError("Enter the merchant, or turn off the merchant lock.");
    setBusy(true);
    const prev = { limitAmount: card.limitAmount, limitInterval: card.limitInterval, categoriesAllowed: card.categoriesAllowed, merchantLock: card.merchantLock, autoLockDate: card.autoLockDate };
    await act(
      () => patch("cards", card.id, { limitAmount: n, limitInterval: interval, categoriesAllowed: cats, merchantLock: lock ? merchant.trim() : null, autoLockDate: autoLock ? autoLockDate : null }),
      { success: "Limits saved", undo: () => patch("cards", card.id, prev) },
    );
    setBusy(false);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit limits"
      description={`${card.nickname} ${masked(card.last4)}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save limits
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Field label="Spending limit">{(id) => <Input id={id} prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />}</Field>
        <Field label="Resets">{(id) => <Select id={id} aria-label="Limit interval" value={interval} onValueChange={setInterval} options={INTERVAL_OPTIONS} />}</Field>
        <Field label="Allowed categories" optional hint="Empty means any category your policy allows.">
          {(id) => <MultiSelect id={id} aria-label="Allowed categories" value={cats} onChange={setCats} options={categories.map((c) => ({ value: c.id, label: c.name }))} placeholder="+ Add category" />}
        </Field>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Switch checked={lock} onCheckedChange={setLock} label="Lock to one merchant" description="Declines charges from anywhere else." />
          {lock ? <Field label="Merchant">{(id) => <Input id={id} value={merchant} onChange={(e) => setMerchant(e.target.value)} />}</Field> : null}
        </div>
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <Switch checked={autoLock} onCheckedChange={setAutoLock} label="Lock the card on a date" />
          {autoLock ? <Field label="Lock date">{(id) => <DatePicker id={id} value={autoLockDate} onChange={setAutoLockDate} disabledBefore={addDays(new Date(), 1)} />}</Field> : null}
        </div>
      </div>
    </Sheet>
  );
}

function RequestIncreaseModal({ card, open, onOpenChange }: { card: Card; open: boolean; onOpenChange: (v: boolean) => void }) {
  const me = useRow("employees", ME_ID);
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setAmount("");
      setWhy("");
      setError(null);
    }
  }, [open]);
  const send = async () => {
    const n = Number(amount);
    if (!(n > card.limitAmount)) return setError(`Enter a new limit above the current ${money(card.limitAmount)}.`);
    if (why.trim().length < 10) return setError("Add a sentence on why you need more.");
    setBusy(true);
    const approval: Approval = {
      id: newId("apr"),
      kind: "limit_increase",
      title: `Raise limit on ${me?.firstName ?? "my"}'s ${card.nickname} card to ${money(n)}`,
      requesterId: ME_ID,
      amount: n,
      currency: "USD",
      createdAt: formatISO(new Date()),
      dueAt: formatISO(addDays(new Date(), 2)),
      status: "pending",
      stage: "manager",
      approverIds: [me?.managerId ?? ME_ID],
      subjectId: card.id,
      comments: [{ authorId: ME_ID, body: why.trim(), at: formatISO(new Date()) }],
    };
    await act(() => upsert("approvals", approval), { success: "Limit increase requested" });
    setBusy(false);
    if (get("approvals", approval.id)) onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Request a higher limit"
      description={`Currently ${money(card.limitAmount)} ${INTERVAL_LABELS[card.limitInterval].toLowerCase()}. Your manager approves first, then Finance.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={send}>
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        <Field label="New limit">{(id) => <Input id={id} prefix="$" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />}</Field>
        <Field label="Reason">{(id) => <Textarea id={id} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Conference travel in March" />}</Field>
      </div>
    </Modal>
  );
}

function ReplaceModal({ card, reason, onClose }: { card: Card; reason: ReplaceReason | null; onClose: () => void }) {
  const [address, setAddress] = useState<"office" | "home">("office");
  const [busy, setBusy] = useState(false);
  const copyText = reason ? REPLACE_COPY[reason] : null;
  const confirm = async () => {
    if (!reason || !copyText) return;
    setBusy(true);
    await act(
      () => {
        if (copyText.cancelsNow) patch("cards", card.id, { status: "cancelled" });
        const last4 = String(1000 + Math.floor(Math.random() * 9000));
        upsert("cards", {
          ...card,
          id: newId("card"),
          number: reason === "damaged" ? card.number : `${card.number.slice(0, 12)}${last4}`,
          last4: reason === "damaged" ? card.last4 : last4,
          status: card.kind === "physical" ? "shipping" : "active",
          spentThisPeriod: 0,
          createdAt: formatISO(new Date()),
        });
      },
      { success: card.kind === "physical" ? "Replacement ordered. It ships in 5 to 7 business days." : "New card number ready" },
    );
    setBusy(false);
    onClose();
  };
  return (
    <Modal
      open={!!reason}
      onOpenChange={(v) => !v && onClose()}
      title={copyText?.title ?? ""}
      description={copyText?.body}
      footer={
        <>
          <Button onClick={onClose}>Keep current card</Button>
          <Button variant={copyText?.cancelsNow ? "danger" : "primary"} loading={busy} onClick={confirm}>
            Replace card
          </Button>
        </>
      }
    >
      {card.kind === "physical" ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">Ship the new card to</span>
          <RadioList
            value={address}
            onValueChange={setAddress}
            options={[
              { value: "office", label: "Office: 410 Cedar Ave, Portland, OR 97204" },
              { value: "home", label: "The holder's home address on file" },
            ]}
          />
        </div>
      ) : (
        <p className="text-[13px] text-ink-2">The new number works right away. Limits and controls carry over.</p>
      )}
    </Modal>
  );
}

function ActivateModal({ card, open, onOpenChange }: { card: Card; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDigits("");
      setError(null);
    }
  }, [open]);
  const activate = async () => {
    if (digits !== card.last4) return setError("Those digits don't match this card. Check the number on the back.");
    setBusy(true);
    await act(() => patch("cards", card.id, { status: "active" }), { success: "Card activated. You can use it now." });
    setBusy(false);
    onOpenChange(false);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Activate your card"
      description="Enter the last 4 digits printed on the card."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={activate}>
            Activate
          </Button>
        </>
      }
    >
      <Field label="Last 4 digits" error={error}>
        {(id) => <Input id={id} inputMode="numeric" maxLength={4} autoComplete="off" value={digits} onChange={(e) => setDigits(e.target.value.replace(/\D/g, ""))} />}
      </Field>
    </Modal>
  );
}

