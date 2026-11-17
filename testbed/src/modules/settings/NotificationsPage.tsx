import { Check, Info, MessageSquare } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useCollection } from "@/data/store";
import { cn } from "@/lib/cn";
import { Button, Spinner, Tooltip } from "@/ui/button";
import { Callout, Card } from "@/ui/display";
import { Checkbox, Field, Input, NativeSelect, Switch } from "@/ui/form";
import { act, Loader } from "@/ui/flow";
import { FieldGrid, SaveCard, SettingsHeader, useDraft } from "./common";
import { CHANNELS, NOTIFICATION_EVENTS, useSettings, type Channel } from "./store";

const CHANNEL_LABELS: Record<Channel, string> = { email: "Email", push: "Push", chat: "Chatter", sms: "SMS" };

export function NotificationsPage() {
  return (
    <>
      <SettingsHeader title="Notifications" description="Pick what Northpine tells you about, and where. Changes to the table save on their own." />
      <Loader loadKey="settings-notifications" rows={12}>
        {() => (
          <div className="flex flex-col gap-5">
            <ChatLink />
            <Matrix />
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Digest />
              <QuietHours />
            </div>
          </div>
        )}
      </Loader>
    </>
  );
}

function useChatAvailable() {
  const integrations = useCollection("integrations");
  const connected = integrations.find((i) => i.id === "int_chatter")?.connected ?? false;
  const linked = useSettings((s) => s.notifications.chatLinked);
  return { connected, linked, available: connected && linked };
}

function ChatLink() {
  const { connected, linked } = useChatAvailable();
  const set = useSettings((s) => s.set);
  const [busy, setBusy] = useState(false);
  if (linked && connected) return null;
  return (
    <Callout
      tone="info"
      title={connected ? "Get alerts in Chatter" : "Chatter isn't connected"}
      action={
        connected ? (
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await act(() => set("notifications", { chatLinked: true }), { success: "Chatter account linked" });
              setBusy(false);
            }}
          >
            <MessageSquare /> Link Chatter account
          </Button>
        ) : (
          <Button size="sm" asChild>
            <Link to="/settings/integrations">Go to Integrations</Link>
          </Button>
        )
      }
    >
      {connected ? "Your workspace uses Chatter. Link your own account to get direct messages from Northpine." : "An admin has to connect Chatter in Integrations before anyone can get alerts there."}
    </Callout>
  );
}

function Matrix() {
  const prefs = useSettings((s) => s.notifications.prefs);
  const set = useSettings((s) => s.set);
  const { available, connected } = useChatAvailable();
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Autosaves each change, then shows "Saved" for a few seconds.
  const toggle = (event: string, channel: Channel, value: boolean) => {
    set("notifications", { prefs: { ...prefs, [event]: { ...prefs[event], [channel]: value } } });
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStatus("saved");
      timer.current = setTimeout(() => setStatus("idle"), 2500);
    }, 600);
  };
  const groups = [...new Set(NOTIFICATION_EVENTS.map((e) => e.group))];
  const chatReason = connected ? "Link your Chatter account above to turn these on." : "Connect Chatter in Integrations to get alerts in chat.";

  return (
    <Card
      title="What to tell you about"
      description="Each row is an event. Tick the places you want to hear about it."
      bodyClassName="p-0"
      actions={
        <span aria-live="polite" className="flex h-6 items-center gap-1.5 text-xs text-ink-3">
          {status === "saving" ? (
            <>
              <Spinner className="size-3" /> Saving…
            </>
          ) : status === "saved" ? (
            <>
              <Check className="size-3.5 text-ok" /> Saved
            </>
          ) : null}
        </span>
      }
    >
      {/* Wide table that scrolls sideways on small screens. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="sticky top-0 bg-sunken text-left text-[12px] text-ink-3">
            <tr>
              <th className="px-4 py-2 font-medium">Event</th>
              {CHANNELS.map((c) => (
                <th key={c} className="w-24 px-2 py-2 text-center font-medium">
                  {c === "chat" && !available ? (
                    // The only explanation is in a tooltip, on purpose.
                    <Tooltip content={chatReason}>
                      <span tabIndex={0} className="inline-flex cursor-help items-center gap-1 text-ink-3/70">
                        {CHANNEL_LABELS[c]} <Info className="size-3" />
                      </span>
                    </Tooltip>
                  ) : (
                    CHANNEL_LABELS[c]
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr>
                  <th colSpan={5} className="border-t border-line bg-panel px-4 pt-4 pb-1 text-left text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
                    {g}
                  </th>
                </tr>
                {NOTIFICATION_EVENTS.filter((e) => e.group === g).map((e) => (
                  <tr key={e.id} className="border-t border-line/60 hover:bg-sunken/50">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-medium">{e.label}</span>
                        <span className="text-xs text-ink-3">{e.hint}</span>
                      </div>
                    </td>
                    {CHANNELS.map((c) => (
                      <td key={c} className="px-2 py-2.5 text-center">
                        <span className="inline-flex justify-center">
                          <Checkbox
                            checked={c === "chat" && !available ? false : prefs[e.id]?.[c] ?? false}
                            disabled={c === "chat" && !available}
                            onCheckedChange={(v) => toggle(e.id, c, v)}
                            label={<span className="sr-only">{`${CHANNEL_LABELS[c]} for ${e.label}`}</span>}
                          />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Digest() {
  const n = useSettings((s) => s.notifications);
  const set = useSettings((s) => s.set);
  const { draft, update, dirty } = useDraft({ digest: n.digest, digestDay: n.digestDay });
  return (
    <SaveCard title="Email digest" description="A summary of open items, instead of one email each." dirty={dirty} onSave={() => set("notifications", draft)} success="Digest saved">
      <FieldGrid>
        <Field label="Digest frequency">
          {(id) => (
            <NativeSelect id={id} value={draft.digest} onChange={(e) => update({ digest: e.target.value as typeof draft.digest })}>
              <option value="off">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </NativeSelect>
          )}
        </Field>
        {draft.digest === "weekly" ? (
          <Field label="Send on">
            {(id) => (
              <NativeSelect id={id} value={draft.digestDay} onChange={(e) => update({ digestDay: e.target.value })}>
                {["monday", "tuesday", "wednesday", "thursday", "friday"].map((d) => (
                  <option key={d} value={d}>
                    {d[0].toUpperCase() + d.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        ) : null}
      </FieldGrid>
    </SaveCard>
  );
}

function QuietHours() {
  const n = useSettings((s) => s.notifications);
  const set = useSettings((s) => s.set);
  const { draft, update, dirty } = useDraft({ quietOn: n.quietOn, quietStart: n.quietStart, quietEnd: n.quietEnd });
  return (
    <SaveCard title="Quiet hours" description="Hold push and SMS alerts overnight. Declined cards still come through." dirty={dirty} onSave={() => set("notifications", draft)} success="Quiet hours saved">
      <div className="flex flex-col gap-4">
        <Switch label="Pause push and SMS overnight" checked={draft.quietOn} onCheckedChange={(v) => update({ quietOn: v })} />
        <div className={cn("grid grid-cols-2 gap-4", !draft.quietOn && "opacity-50")}>
          <Field label="From">{(id) => <Input id={id} type="time" disabled={!draft.quietOn} value={draft.quietStart} onChange={(e) => update({ quietStart: e.target.value })} />}</Field>
          <Field label="Until">{(id) => <Input id={id} type="time" disabled={!draft.quietOn} value={draft.quietEnd} onChange={(e) => update({ quietEnd: e.target.value })} />}</Field>
        </div>
      </div>
    </SaveCard>
  );
}
