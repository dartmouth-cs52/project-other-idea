import { AlertCircle, Check } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { patch, simulate } from "@/data/store";
import type { Transaction } from "@/data/types";
import { Spinner } from "@/ui/button";
import { useActivity } from "./shared";

// Expense fields save as soon as they change. There is no Save button, on
// purpose: a guide has to know the change already went through.

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useAutosave(txId: string) {
  const [state, setState] = useState<SaveState>("idle");
  const last = useRef<{ fields: Partial<Transaction>; note?: string } | null>(null);
  const seq = useRef(0);
  const save = useCallback(
    async (fields: Partial<Transaction>, note?: string) => {
      last.current = { fields, note };
      const mine = ++seq.current;
      setState("saving");
      try {
        await simulate(() => patch("transactions", txId, fields));
        if (note) useActivity.getState().log(txId, note);
        if (mine === seq.current) setState("saved");
      } catch {
        if (mine === seq.current) setState("error");
      }
    },
    [txId],
  );
  const retry = () => last.current && save(last.current.fields, last.current.note);
  return { state, save, retry };
}

export function SavedIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "idle") return <span className="text-[12.5px] text-ink-3">Changes save automatically</span>;
  if (state === "saving")
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
        <Spinner className="size-3" /> Saving…
      </span>
    );
  if (state === "error")
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-danger">
        <AlertCircle className="size-3.5" /> Couldn't save.
        <button type="button" onClick={onRetry} className="cursor-pointer font-medium underline">
          Retry
        </button>
      </span>
    );
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[12.5px] text-ok">
      <Check className="size-3.5" /> Saved
    </span>
  );
}
