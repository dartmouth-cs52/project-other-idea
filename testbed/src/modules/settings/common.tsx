import { Lock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useCan, type Action } from "@/lib/access";
import { Button, Tooltip } from "@/ui/button";
import { Callout, Card, PageHeader } from "@/ui/display";
import { act } from "@/ui/flow";

/** Header for a settings sub-page, with the breadcrumb back to Settings. */
export function SettingsHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return <PageHeader crumbs={[{ label: "Settings", to: "/settings" }, { label: title }]} title={title} description={description} actions={actions} />;
}

/** A banner at the top of a page the person can see but not change. */
export function ReadOnlyNote({ action }: { action: Action }) {
  const { allowed, reason } = useCan(action);
  if (allowed) return null;
  return (
    <div className="mb-5">
      <Callout tone="warn" title="View only">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3.5" /> {reason}
        </span>
      </Callout>
    </div>
  );
}

/**
 * A copy of some settings to edit, with a dirty flag. Saving writes it back.
 * Resets when the saved value changes underneath.
 */
export function useDraft<T extends object>(saved: T) {
  const [draft, setDraft] = useState<T>(saved);
  const key = JSON.stringify(saved);
  useEffect(() => setDraft(saved), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== key;
  const update = (patch: Partial<T>) => setDraft((d) => ({ ...d, ...patch }));
  return { draft, update, dirty, reset: () => setDraft(saved) };
}

/**
 * A settings card with its own Save button in the footer. Every settings page
 * has more than one, so "Save" is a duplicated label on purpose.
 */
export function SaveCard({
  title,
  description,
  children,
  dirty,
  onSave,
  action,
  saveLabel = "Save",
  success = "Settings saved",
  footerNote,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  dirty: boolean;
  onSave: () => void;
  action?: Action;
  saveLabel?: string;
  success?: string;
  footerNote?: ReactNode;
  actions?: ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const can = useCan(action ?? "cards.reveal");
  const allowed = !action || can.allowed;
  const button = (
    <Button
      variant="primary"
      size="sm"
      loading={saving}
      disabled={!dirty || !allowed}
      onClick={async () => {
        setSaving(true);
        await act(onSave, { success });
        setSaving(false);
      }}
    >
      {saveLabel}
    </Button>
  );
  return (
    <Card
      title={title}
      description={description}
      actions={actions}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-3">{footerNote ?? (dirty ? "Unsaved changes" : "")}</span>
          {allowed ? (
            button
          ) : (
            <Tooltip content={can.reason}>
              <span tabIndex={0} className="inline-flex">
                {button}
              </span>
            </Tooltip>
          )}
        </div>
      }
    >
      {children}
    </Card>
  );
}

/** Two-column grid for fields in a card. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

/** Saves a data URL from a picked image file. */
export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** A random-looking string from a fixed alphabet. */
export function randomToken(n: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789") {
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Download some text as a file. */
export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Like act(), but resolves to whether the change went through, even when the work returns nothing. */
export async function done(work: () => unknown, opts: { success: string; undo?: () => void; error?: string }): Promise<boolean> {
  const r = await act(() => {
    work();
    return true as const;
  }, opts);
  return r === true;
}
