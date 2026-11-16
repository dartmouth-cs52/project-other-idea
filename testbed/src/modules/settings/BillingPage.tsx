import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { Check, Download, Lock, Minus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCollection } from "@/data/store";
import type { Plan } from "@/data/types";
import { PLAN_LABELS, useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useLab } from "@/lab/lab";
import { Button } from "@/ui/button";
import { Badge, Card, Progress, StatusBadge } from "@/ui/display";
import { Field, Input } from "@/ui/form";
import { act, Loader, RoleGate, toast } from "@/ui/flow";
import { ConfirmDialog } from "@/ui/overlay";
import { downloadText, FieldGrid, ReadOnlyNote, SaveCard, SettingsHeader, useDraft } from "./common";
import { useSettings } from "./store";

const PLANS: Plan[] = ["starter", "growth", "enterprise"];
const PRICE: Record<Plan, { amount: number; unit: string; blurb: string }> = {
  starter: { amount: 0, unit: "free for up to 25 people", blurb: "Cards, receipts and reimbursements for small teams." },
  growth: { amount: 12, unit: "per person, per month", blurb: "Accounting sync, budgets, API access and custom approvals." },
  enterprise: { amount: 24, unit: "per person, per month", blurb: "Multiple entities, SSO, audit log and procurement." },
};
const SEATS: Record<Plan, number> = { starter: 25, growth: 250, enterprise: 2000 };

const FEATURES: { label: string; plans: Plan[] }[] = [
  { label: "Corporate cards and receipts", plans: ["starter", "growth", "enterprise"] },
  { label: "Bill pay", plans: ["starter", "growth", "enterprise"] },
  { label: "Accounting sync", plans: ["growth", "enterprise"] },
  { label: "Budgets", plans: ["growth", "enterprise"] },
  { label: "Custom approval chains", plans: ["growth", "enterprise"] },
  { label: "API access", plans: ["growth", "enterprise"] },
  { label: "Per diem", plans: ["growth", "enterprise"] },
  { label: "Multiple entities", plans: ["enterprise"] },
  { label: "SSO with OneKey", plans: ["enterprise"] },
  { label: "Audit log", plans: ["enterprise"] },
  { label: "Procurement", plans: ["enterprise"] },
];

export function BillingPage() {
  return (
    <>
      <SettingsHeader title="Billing and plan" description="Your plan, seats, invoices and the card we charge." />
      <ReadOnlyNote action="settings.billing" />
      <Loader loadKey="settings-billing" rows={10}>
        {() => (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <CurrentPlan />
              <PaymentMethod />
            </div>
            <PlanTable />
            <Invoices />
            <div className="grid gap-5 lg:grid-cols-2">
              <BillingContact />
              <TaxDetails />
            </div>
          </div>
        )}
      </Loader>
    </>
  );
}

function CurrentPlan() {
  const plan = useLab((s) => s.plan);
  const people = useCollection("employees");
  const used = people.filter((p) => p.status === "active" || p.status === "invited").length;
  const limit = SEATS[plan];
  const renews = format(addMonths(startOfMonth(new Date()), 1), "MMMM d, yyyy");
  return (
    <Card title="Current plan" className="lg:col-span-2" actions={<Badge tone="brand">{PLAN_LABELS[plan]}</Badge>}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[26px] font-semibold tracking-tight">
              {PRICE[plan].amount ? money(PRICE[plan].amount * used) : "$0"}
              <span className="text-[13px] font-normal text-ink-3"> / month</span>
            </p>
            <p className="text-[13px] text-ink-3">
              {PRICE[plan].amount ? `${money(PRICE[plan].amount)} ${PRICE[plan].unit}` : PRICE[plan].unit}. Renews {renews}.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[13px]">
            <span>Seats</span>
            <span className="tabular text-ink-2">
              {used} of {limit.toLocaleString()} used
            </span>
          </div>
          <Progress value={(used / limit) * 100} tone={used > limit ? "danger" : used / limit > 0.85 ? "warn" : "brand"} />
          {used > limit ? <p className="text-xs text-danger">You're over your plan's seat limit. New invites are paused until you upgrade.</p> : <p className="text-xs text-ink-3">Invited people count as seats until they're removed.</p>}
        </div>
      </div>
    </Card>
  );
}

/**
 * The card on file lives in a sandboxed iframe from a made-up processor. With
 * no allow-same-origin it behaves like a cross-origin frame: nothing inside it
 * can be read or pointed at from the page.
 */
function PaymentMethod() {
  const card = useSettings((s) => s.billing.card);
  const set = useSettings((s) => s.set);
  const theme = useLab((s) => s.theme);
  const { allowed, reason } = useCan("settings.billing");
  const frame = useRef<HTMLIFrameElement>(null);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; last4?: string; exp?: string; brand?: string };
      if (d?.type !== "paystream:card-updated" || !d.last4) return;
      set("billing", { card: { brand: d.brand ?? "Card", last4: d.last4, exp: d.exp ?? "" } });
      toast.success(`Card ending ${d.last4} saved`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [set]);

  const srcDoc = useMemo(() => paystreamDoc(card, dark), [card, dark]);
  return (
    <Card title="Payment method" description="Processed securely by Paystream." bodyClassName="p-0">
      {allowed ? (
        // Sandboxed and effectively cross-origin, on purpose.
        <iframe title="Paystream payment method" sandbox="allow-scripts allow-forms" srcDoc={srcDoc} ref={frame} className="block h-[236px] w-full rounded-b-lg border-0" />
      ) : (
        <div className="flex flex-col gap-2 p-4 text-[13px]">
          <span className="font-mono">
            {card.brand} •••• {card.last4}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <Lock className="size-3.5" /> {reason}
          </span>
        </div>
      )}
    </Card>
  );
}

function paystreamDoc(card: { brand: string; last4: string; exp: string }, dark: boolean) {
  const c = dark ? { bg: "#151b18", ink: "#e9efeb", ink3: "#8b968f", line: "#2c3631", field: "#111714", accent: "#6d5dfc" } : { bg: "#ffffff", ink: "#1a1f36", ink3: "#6b7385", line: "#e0e3eb", field: "#ffffff", accent: "#5b4bdb" };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;padding:16px;background:${c.bg};color:${c.ink};font-size:13px}
.brand{display:flex;align-items:center;gap:6px;font-weight:700;color:${c.accent};font-size:12px;letter-spacing:.02em;margin-bottom:12px}
.brand i{width:14px;height:14px;border-radius:4px;background:${c.accent};display:inline-block}
.card{display:flex;align-items:center;gap:10px;border:1px solid ${c.line};border-radius:8px;padding:12px}
.chip{width:36px;height:24px;border-radius:4px;background:linear-gradient(135deg,#1a1f71,#3b4bd8);color:#fff;font-size:9px;font-weight:700;display:grid;place-items:center}
.muted{color:${c.ink3};font-size:12px}
button{white-space:nowrap;cursor:pointer;border-radius:6px;font-size:13px;font-weight:600;height:32px;padding:0 12px;border:1px solid ${c.line};background:${c.bg};color:${c.ink}}
button.primary{background:${c.accent};border-color:${c.accent};color:#fff}
.row{display:flex;gap:8px;margin-top:8px}
label{display:block;font-size:11px;color:${c.ink3};margin:0 0 3px}
input{width:100%;height:32px;border:1px solid ${c.line};border-radius:6px;padding:0 8px;background:${c.field};color:${c.ink};font-size:13px}
.err{color:#df1b41;font-size:12px;min-height:16px;margin-top:4px}
form{display:none}
.editing form{display:block}.editing #view{display:none}
.foot{margin-top:12px;display:flex;justify-content:space-between;align-items:center}
</style></head><body>
<div class="brand"><i></i>PAYSTREAM</div>
<div id="view">
  <div class="card"><span class="chip">${({ Visa: "VISA", Mastercard: "MC", Amex: "AMEX" } as Record<string, string>)[card.brand] ?? "CARD"}</span><div><div>${card.brand} ending ${card.last4}</div><div class="muted">Expires ${card.exp}</div></div></div>
  <div class="foot"><span class="muted">Charged on the 1st of each month</span><button type="button" class="primary" id="edit">Update card</button></div>
</div>
<form id="f" novalidate>
  <label for="num">Card number</label><input id="num" inputmode="numeric" autocomplete="off" placeholder="1234 1234 1234 1234">
  <div class="row"><div style="flex:1"><label for="exp">Expiry</label><input id="exp" placeholder="MM / YY"></div><div style="flex:1"><label for="cvc">CVC</label><input id="cvc" inputmode="numeric" placeholder="123"></div><div style="flex:1"><label for="zip">ZIP</label><input id="zip" placeholder="97204"></div></div>
  <div class="err" id="err"></div>
  <div class="row" style="justify-content:flex-end;margin-top:0"><button type="button" id="cancel">Cancel</button><button type="submit" class="primary">Save card</button></div>
</form>
<script>
document.getElementById('edit').onclick=function(){document.body.classList.add('editing');document.getElementById('num').focus()};
document.getElementById('cancel').onclick=function(){document.body.classList.remove('editing')};
document.getElementById('f').onsubmit=function(e){e.preventDefault();
  var n=document.getElementById('num').value.replace(/\\D/g,''),x=document.getElementById('exp').value.replace(/\\s/g,''),v=document.getElementById('cvc').value;
  var err=document.getElementById('err');
  if(n.length<15){err.textContent='Your card number is incomplete.';return}
  if(!/^\\d{2}\\/?\\d{2}$/.test(x)){err.textContent='Your card\\'s expiry date is incomplete.';return}
  if(!/^\\d{3,4}$/.test(v)){err.textContent='Your card\\'s security code is incomplete.';return}
  err.textContent='';var brand=n[0]==='4'?'Visa':n[0]==='5'?'Mastercard':n[0]==='3'?'Amex':'Card';
  if(x.indexOf('/')<0)x=x.slice(0,2)+'/'+x.slice(2);
  parent.postMessage({type:'paystream:card-updated',last4:n.slice(-4),exp:x,brand:brand},'*');
};
</script></body></html>`;
}

function PlanTable() {
  const plan = useLab((s) => s.plan);
  const setLab = useLab((s) => s.set);
  const [target, setTarget] = useState<Plan | null>(null);
  const rank = (p: Plan) => PLANS.indexOf(p);
  return (
    <Card title="Compare plans" description="Changes apply right away. We prorate the difference on your next invoice." bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <th className="w-1/4 px-4 py-4 text-left align-bottom text-[12px] font-medium text-ink-3">Features</th>
              {PLANS.map((p) => (
                <th key={p} className={cn("px-4 py-4 text-left align-top", p === plan && "bg-brand-soft/50")}>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 text-[14px] font-semibold">
                      {PLAN_LABELS[p]} {p === plan ? <Badge tone="brand">Current</Badge> : null}
                    </span>
                    <span className="text-[12px] font-normal text-ink-3">{PRICE[p].amount ? `${money(PRICE[p].amount)} ${PRICE[p].unit}` : "Free"}</span>
                    <span className="text-[12px] font-normal text-ink-2">{PRICE[p].blurb}</span>
                    <div className="mt-2">
                      {p === plan ? (
                        <Button size="sm" disabled>
                          Current plan
                        </Button>
                      ) : (
                        // Two "Upgrade" buttons on a Starter workspace, one per column.
                        <RoleGate action="settings.billing">
                          {(ok) => (
                            <Button size="sm" variant={rank(p) > rank(plan) ? "primary" : "secondary"} disabled={!ok} onClick={() => setTarget(p)}>
                              {rank(p) > rank(plan) ? "Upgrade" : "Downgrade"}
                            </Button>
                          )}
                        </RoleGate>
                      )}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.label} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2 text-ink-2">{f.label}</td>
                {PLANS.map((p) => (
                  <td key={p} className={cn("px-4 py-2", p === plan && "bg-brand-soft/50")}>
                    {f.plans.includes(p) ? <Check className="size-4 text-ok" aria-label="Included" /> : <Minus className="size-4 text-ink-3" aria-label="Not included" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(v) => !v && setTarget(null)}
        title={target ? `${rank(target) > rank(plan) ? "Upgrade" : "Downgrade"} to ${PLAN_LABELS[target]}?` : ""}
        description={
          target && rank(target) < rank(plan)
            ? `Features that aren't on ${PLAN_LABELS[target]} turn off for everyone at once. Your data is kept.`
            : target
              ? `You'll pay ${money(PRICE[target].amount)} ${PRICE[target].unit}, prorated from today.`
              : ""
        }
        confirmLabel={target ? `Switch to ${PLAN_LABELS[target]}` : "Confirm"}
        danger={target !== null && rank(target) < rank(plan)}
        onConfirm={async () => {
          const t = target;
          if (!t) return;
          await act(() => setLab({ plan: t }), { success: `You're on ${PLAN_LABELS[t]}` });
        }}
      />
    </Card>
  );
}

function Invoices() {
  const plan = useLab((s) => s.plan);
  const invoices = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = startOfMonth(subMonths(new Date(), i));
        const amount = plan === "starter" ? 0 : (plan === "growth" ? 12 : 24) * (180 - i * 3);
        return { id: `INV-${format(d, "yyyyMM")}`, date: d, amount, status: i === 0 ? "pending" : "paid" };
      }),
    [plan],
  );
  return (
    <Card title="Invoices" description="Sent to your billing contact on the 1st." bodyClassName="p-0">
      <ul>
        {invoices.map((inv) => (
          <li key={inv.id} className="flex items-center gap-4 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
            <span className="w-32 font-mono text-[12.5px]">{inv.id}</span>
            <span className="flex-1 text-ink-2">{format(inv.date, "MMMM yyyy")}</span>
            <span className="tabular w-24 text-right">{money(inv.amount)}</span>
            <span className="w-24">
              <StatusBadge status={inv.status} />
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => downloadText(`${inv.id}.txt`, `Northpine invoice ${inv.id}\n${format(inv.date, "MMMM yyyy")}\nTotal: ${money(inv.amount)}\n`)}
            >
              <Download /> Download
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BillingContact() {
  const b = useSettings((s) => s.billing);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.billing");
  const { draft, update, dirty } = useDraft({ contactName: b.contactName, contactEmail: b.contactEmail });
  return (
    <SaveCard title="Billing contact" description="Who gets invoices and payment failure emails." dirty={dirty} action="settings.billing" onSave={() => set("billing", draft)} success="Billing contact saved">
      <FieldGrid>
        <Field label="Name">{(id) => <Input id={id} disabled={!allowed} value={draft.contactName} onChange={(e) => update({ contactName: e.target.value })} />}</Field>
        <Field label="Billing email">{(id) => <Input id={id} type="email" disabled={!allowed} value={draft.contactEmail} onChange={(e) => update({ contactEmail: e.target.value })} />}</Field>
      </FieldGrid>
    </SaveCard>
  );
}

function TaxDetails() {
  const b = useSettings((s) => s.billing);
  const set = useSettings((s) => s.set);
  const { allowed } = useCan("settings.billing");
  const { draft, update, dirty } = useDraft({ vatId: b.vatId, poNumber: b.poNumber });
  return (
    <SaveCard title="Tax and invoice details" description="Printed on every invoice." dirty={dirty} action="settings.billing" onSave={() => set("billing", draft)} success="Invoice details saved">
      <FieldGrid>
        <Field label="Tax ID" hint="Shown masked on invoices.">
          {(id) => <Input id={id} type="password" autoComplete="off" disabled={!allowed} value={draft.vatId} onChange={(e) => update({ vatId: e.target.value })} />}
        </Field>
        <Field label="PO number" optional>
          {(id) => <Input id={id} disabled={!allowed} value={draft.poNumber} onChange={(e) => update({ poNumber: e.target.value })} />}
        </Field>
      </FieldGrid>
    </SaveCard>
  );
}
