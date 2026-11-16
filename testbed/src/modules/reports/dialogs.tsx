import { Copy, Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { patch, useCollection } from "@/data/store";
import type { SavedReport } from "@/data/types";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/display";
import { act, PlanGate } from "@/ui/flow";
import { Field, NativeSelect, RadioList, Select, Switch } from "@/ui/form";
import { MultiSelect, type Option } from "@/ui/inputs";
import { Modal, Sheet } from "@/ui/overlay";

/** Active people as options for a recipient picker. The email is the hint. */
export function usePeopleOptions(): Option[] {
  const employees = useCollection("employees");
  return useMemo(
    () => employees.filter((e) => e.status === "active").map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}`, hint: e.email })),
    [employees],
  );
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The schedule panel. Scheduling needs the advanced reports plan. */
export function ScheduleSheet({ report, open, onOpenChange }: { report: SavedReport; open: boolean; onOpenChange: (v: boolean) => void }) {
  const people = usePeopleOptions();
  const [frequency, setFrequency] = useState<SavedReport["schedule"]>(report.schedule === "none" ? "weekly" : report.schedule);
  const [day, setDay] = useState("Monday");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [time, setTime] = useState("08:00");
  const [recipients, setRecipients] = useState<string[]>(report.recipients);
  const [fileFormat, setFileFormat] = useState<"csv" | "pdf" | "xlsx">("pdf");
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFrequency(report.schedule === "none" ? "weekly" : report.schedule);
    setRecipients(report.recipients);
    setError(null);
  }, [open, report]);

  const save = async () => {
    if (!recipients.length) {
      setError("Add at least one recipient.");
      return;
    }
    setSaving(true);
    const when = frequency === "weekly" ? `every ${day}` : frequency === "monthly" ? `on day ${dayOfMonth} of each month` : "every day";
    const ok = await act(
      () => {
        patch("reports", report.id, { schedule: frequency, recipients });
        return true;
      },
      { success: `Scheduled. It will be emailed ${when} at ${time}.` },
    );
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Schedule report"
      description={`Email "${report.name}" on a regular schedule.`}
      footer={
        <PlanGate feature="advancedReports" title="Scheduled reports" compact>
          {report.schedule !== "none" ? (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              onClick={async () => {
                await act(() => patch("reports", report.id, { schedule: "none" }), { success: "Schedule turned off" });
                onOpenChange(false);
              }}
            >
              Turn off schedule
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Save schedule
          </Button>
        </PlanGate>
      }
    >
      <PlanGate feature="advancedReports" title="Scheduled reports">
        <div className="flex flex-col gap-5">
          <Field label="Frequency">
            {(id) => (
              <Select
                id={id}
                aria-label="Frequency"
                value={frequency === "none" ? "weekly" : frequency}
                onValueChange={(v) => setFrequency(v)}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            )}
          </Field>
          {/* Which of these two shows depends on the frequency, on purpose. */}
          {frequency === "weekly" ? (
            <Field label="Day of the week">
              {(id) => (
                <NativeSelect id={id} value={day} onChange={(e) => setDay(e.target.value)}>
                  {DAYS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ) : null}
          {frequency === "monthly" ? (
            <Field label="Day of the month" hint="Months without this day send on their last day.">
              {(id) => (
                <NativeSelect id={id} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)}>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          ) : null}
          <Field label="Send at" hint="In your time zone, Pacific Time.">
            {(id) => (
              <NativeSelect id={id} value={time} onChange={(e) => setTime(e.target.value)}>
                {["06:00", "07:00", "08:00", "09:00", "12:00", "17:00"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Recipients" error={error}>
            {(id) => (
              <MultiSelect
                id={id}
                aria-label="Add recipients"
                value={recipients}
                onChange={(v) => {
                  setRecipients(v);
                  setError(null);
                }}
                options={people}
                placeholder="Add people…"
              />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Format</span>
            <RadioList
              value={fileFormat}
              onValueChange={setFileFormat}
              options={[
                { value: "pdf", label: "PDF with chart" },
                { value: "csv", label: "CSV" },
                { value: "xlsx", label: "Excel workbook" },
              ]}
            />
          </div>
          <Switch checked={skipEmpty} onCheckedChange={setSkipEmpty} label="Skip empty reports" description="Don't send when there's no spend in the period." />
          <Callout tone="info" title="Post to Slack instead">
            Connect Slack in <Link to="/settings/integrations" className="font-medium text-brand hover:underline">Settings, Integrations</Link> to send scheduled reports to a channel.
          </Callout>
        </div>
      </PlanGate>
    </Sheet>
  );
}

export function ShareModal({ report, open, onOpenChange }: { report: SavedReport; open: boolean; onOpenChange: (v: boolean) => void }) {
  const people = usePeopleOptions();
  const [who, setWho] = useState<string[]>([]);
  const [access, setAccess] = useState<"view" | "edit">("view");
  const link = `${location.origin}/reports/${report.id}`;
  useEffect(() => {
    if (open) setWho([]);
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share "${report.name}"`}
      description="People you share with see the report with their own data access."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!who.length}
            onClick={async () => {
              await act(() => undefined, { success: `Shared with ${who.length} ${who.length === 1 ? "person" : "people"}` });
              onOpenChange(false);
            }}
          >
            Share
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="People">{(id) => <MultiSelect id={id} aria-label="Add people" value={who} onChange={setWho} options={people} placeholder="Add people…" />}</Field>
        <Field label="Access">
          {(id) => (
            <Select
              id={id}
              aria-label="Access"
              value={access}
              onValueChange={setAccess}
              options={[
                { value: "view", label: "Can view" },
                { value: "edit", label: "Can edit" },
              ]}
            />
          )}
        </Field>
        <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-[13px]">
          <Link2 className="size-4 text-ink-3" />
          <span className="flex-1 truncate text-ink-2">{link}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(link).catch(() => undefined);
              act(() => undefined, { success: "Link copied" });
            }}
          >
            <Copy /> Copy link
          </Button>
        </div>
      </div>
    </Modal>
  );
}
