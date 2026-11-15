import { MessageCircle, Send, X } from "lucide-react";
import { useState } from "react";
import { useLab } from "@/lab/lab";
import { Button } from "@/ui/button";

/**
 * A fixed banner over the top of the page. The shell does not make room for
 * it, so it covers the top bar's upper edge, like a cookie or status banner
 * added by another script.
 */
export function MaintenanceBanner() {
  const on = useLab((s) => s.banner);
  const set = useLab((s) => s.set);
  if (!on) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[45] flex h-9 items-center justify-center gap-3 bg-warn px-10 text-[13px] font-medium text-white">
      Scheduled maintenance on Saturday from 2 to 4 AM Pacific. Card payments are not affected.
      <button type="button" aria-label="Dismiss banner" onClick={() => set({ banner: false })} className="absolute right-3 cursor-pointer opacity-80 hover:opacity-100">
        <X className="size-4" />
      </button>
    </div>
  );
}

/**
 * Another company's support chat, in the bottom right corner where Haptic's
 * launcher would also like to be. Its input competes with Haptic's ask box.
 */
export function ChatBubble() {
  const on = useLab((s) => s.chatBubble);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  if (!on) return null;
  return (
    <div className="fixed right-5 bottom-5 z-40 flex flex-col items-end gap-3">
      {open ? (
        <div className="flex h-[420px] w-80 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex items-center justify-between bg-[#3b2bb3] px-4 py-3 text-white">
            <span className="text-[14px] font-semibold">Chat with Support</span>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="cursor-pointer">
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 text-[13px]">
            <p className="max-w-[85%] rounded-lg bg-sunken px-3 py-2">Hi! Ask us anything about Northpine. We usually reply within a day.</p>
            {messages.map((m, i) => (
              <p key={i} className="ml-auto max-w-[85%] rounded-lg bg-[#3b2bb3] px-3 py-2 text-white">
                {m}
              </p>
            ))}
          </div>
          <form
            className="flex gap-2 border-t border-line p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) setMessages((m) => [...m, draft.trim()]);
              setDraft("");
            }}
          >
            <input aria-label="Message" placeholder="Type your question…" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 flex-1 rounded-md border border-line-strong bg-panel px-2 text-[13px] outline-none" />
            <Button type="submit" size="icon-sm" variant="ghost" aria-label="Send message">
              <Send />
            </Button>
          </form>
        </div>
      ) : null}
      <button type="button" aria-label="Open support chat" onClick={() => setOpen((o) => !o)} className="grid size-14 cursor-pointer place-items-center rounded-full bg-[#3b2bb3] text-white shadow-xl hover:brightness-110">
        <MessageCircle className="size-6" />
      </button>
    </div>
  );
}
