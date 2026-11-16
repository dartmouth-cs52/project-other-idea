import { CreditCard, Smartphone } from "lucide-react";
import { ME_ID, patch } from "@/data/store";
import type { Card } from "@/data/types";
import { useCan } from "@/lib/access";
import { cn } from "@/lib/cn";
import { cardNumber, masked } from "@/lib/format";
import { act } from "@/ui/flow";

// Bits the three card pages share: labels, the card art, and freeze.

export const INTERVAL_LABELS: Record<Card["limitInterval"], string> = {
  daily: "Per day",
  weekly: "Per week",
  monthly: "Per month",
  yearly: "Per year",
  total: "One-time total",
};

export const INTERVAL_OPTIONS = (Object.keys(INTERVAL_LABELS) as Card["limitInterval"][]).map((v) => ({ value: v, label: INTERVAL_LABELS[v] }));

export const intervalShort = (i: Card["limitInterval"]) => ({ daily: "/day", weekly: "/wk", monthly: "/mo", yearly: "/yr", total: " total" })[i];

/** Whether the signed-in person may freeze this card: anyone for their own, managers of cards for the rest. */
export function useFreezeRule() {
  const manage = useCan("cards.manage");
  return (card: Card) => ({
    allowed: card.status !== "cancelled" && card.status !== "pending" && (manage.allowed || card.holderId === ME_ID),
    reason:
      card.status === "cancelled"
        ? "This card is cancelled."
        : card.status === "pending"
          ? "This card is waiting for approval."
          : manage.allowed || card.holderId === ME_ID
            ? ""
            : "You can only freeze your own cards. " + manage.reason,
  });
}

export function freezeCard(card: Card) {
  const prev = card.status;
  return act(() => patch("cards", card.id, { status: "frozen" }), {
    success: `Card ${masked(card.last4)} frozen`,
    undo: () => patch("cards", card.id, { status: prev }),
  });
}

export function unfreezeCard(card: Card) {
  return act(() => patch("cards", card.id, { status: "active" }), {
    success: `Card ${masked(card.last4)} unfrozen`,
    undo: () => patch("cards", card.id, { status: "frozen" }),
  });
}

/** The card itself, drawn in CSS. Shows the last four unless `revealed` is passed. */
export function CardArt({
  card,
  holderName,
  revealed,
  size = "lg",
  className,
}: {
  card: Pick<Card, "kind" | "network" | "last4" | "status" | "nickname" | "number" | "expiry" | "cvc">;
  holderName: string;
  revealed?: boolean;
  size?: "sm" | "lg";
  className?: string;
}) {
  const dim = card.status === "frozen" || card.status === "cancelled";
  const physical = card.kind === "physical";
  return (
    <div
      className={cn(
        "relative flex aspect-[1.586] w-full flex-col justify-between overflow-hidden rounded-xl text-white shadow-md select-none",
        size === "lg" ? "max-w-[360px] p-5" : "p-3.5",
        physical ? "bg-[linear-gradient(135deg,#0f2a1c_0%,#17633a_60%,#2a8a55_100%)]" : "bg-[linear-gradient(135deg,#1f2937_0%,#334155_55%,#475569_100%)]",
        dim && "grayscale",
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/8" />
      <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-8 size-44 rounded-full bg-white/5" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className={cn("font-semibold tracking-tight", size === "lg" ? "text-[15px]" : "text-[12.5px]")}>northpine</span>
          <span className={cn("truncate text-white/70", size === "lg" ? "text-xs" : "text-[11px]")}>{card.nickname}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-medium tracking-wide uppercase">
          {physical ? <CreditCard className="size-3" /> : <Smartphone className="size-3" />}
          {physical ? "Physical" : "Virtual"}
        </span>
      </div>
      {physical && size === "lg" ? <span aria-hidden className="relative h-7 w-10 rounded-md bg-[linear-gradient(135deg,#e9d8a6,#c8a95b)] opacity-90" /> : null}
      <div className="relative flex flex-col gap-1">
        <span className={cn("font-mono tracking-[0.12em] tabular", size === "lg" ? "text-[17px]" : "text-[13px]")} aria-label={revealed ? "Card number" : `Card ending in ${card.last4}`}>
          {revealed ? cardNumber(card.number) : `•••• •••• •••• ${card.last4}`}
        </span>
        <div className="flex items-end justify-between gap-3">
          <span className={cn("min-w-0 flex-1 truncate text-white/85 uppercase", size === "lg" ? "text-[12px]" : "text-[10.5px]")}>{holderName}</span>
          <div className="flex shrink-0 items-end gap-3 whitespace-nowrap">
            {size === "lg" ? (
              <>
                <span className="flex flex-col text-[9.5px] text-white/60 uppercase">
                  Exp
                  <span className="font-mono text-[12px] text-white">{revealed ? card.expiry : "••/••"}</span>
                </span>
                <span className="flex flex-col text-[9.5px] text-white/60 uppercase">
                  CVC
                  <span className="font-mono text-[12px] text-white">{revealed ? card.cvc : "•••"}</span>
                </span>
              </>
            ) : null}
            <span className={cn("font-bold italic", size === "lg" ? "text-[18px]" : "text-[13px]")}>{card.network === "visa" ? "VISA" : "mastercard"}</span>
          </div>
        </div>
      </div>
      {dim ? (
        <span className="absolute inset-0 grid place-items-center bg-black/25 text-[12px] font-semibold tracking-wide uppercase">{card.status === "frozen" ? "Frozen" : "Cancelled"}</span>
      ) : null}
    </div>
  );
}

export { masked };
