import { FileSpreadsheet, Plus, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { newId, upsert, useCollection } from "@/data/store";
import type { Employee, Role } from "@/data/types";
import { ROLE_LABELS } from "@/lib/access";
import { Button, IconButton, Tooltip } from "@/ui/button";
import { Callout } from "@/ui/display";
import { act, toast } from "@/ui/flow";
import { Field, Input, NativeSelect, Textarea } from "@/ui/form";
import { Combobox, FileDrop } from "@/ui/inputs";
import { Modal } from "@/ui/overlay";
import { departmentOptions, EMAIL_RE, namesFromEmail, ROLES } from "./shared";

interface InviteRow {
  key: number;
  email: string;
  role: Role;
}

let rowKey = 0;
const blankRow = (role: Role = "employee"): InviteRow => ({ key: rowKey++, email: "", role });

/**
 * The invite form: a list of email rows, each with its own role, and one
 * department for all of them. "Import from CSV" opens a second modal on top.
 */
export function InviteModal({ open, onOpenChange, allowed, reason }: { open: boolean; onOpenChange: (v: boolean) => void; allowed: boolean; reason: string }) {
  const employees = useCollection("employees");
  const departments = useCollection("departments");
  const entities = useCollection("entities");
  const [rows, setRows] = useState<InviteRow[]>(() => [blankRow()]);
  const [department, setDepartment] = useState<string | null>(null);
  const [entity, setEntity] = useState("ent_us");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [depError, setDepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([blankRow()]);
    setDepartment(null);
    setEntity("ent_us");
    setNote("");
    setErrors({});
    setDepError(null);
  }, [open]);

  const existing = useMemo(() => new Map(employees.map((e) => [e.email.toLowerCase(), e])), [employees]);
  const filled = rows.filter((r) => r.email.trim());

  const update = (key: number, p: Partial<InviteRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const validate = () => {
    const e: Record<number, string> = {};
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const email = r.email.trim().toLowerCase();
      if (!email) {
        if (i === 0 && filled.length === 0) e[r.key] = "Enter an email address.";
        return;
      }
      if (!EMAIL_RE.test(email)) e[r.key] = "That doesn't look like an email address.";
      else if (seen.has(email)) e[r.key] = "This address is already in the list.";
      else if (existing.has(email)) {
        const who = existing.get(email)!;
        e[r.key] = `${who.firstName} ${who.lastName} already has an account (${who.status}).`;
      }
      seen.add(email);
    });
    setErrors(e);
    const dErr = department ? null : "Pick the department they'll join.";
    setDepError(dErr);
    return Object.keys(e).length === 0 && !dErr;
  };

  const send = async () => {
    if (!validate()) return;
    const dep = departments.find((d) => d.id === department)!;
    const now = new Date().toISOString();
    const locations: Record<string, string> = { ent_us: "Portland, OR", ent_uk: "London", ent_de: "Berlin" };
    const people: Employee[] = filled.map((r) => ({
      id: newId("emp"),
      ...namesFromEmail(r.email.trim()),
      email: r.email.trim().toLowerCase(),
      phone: "",
      title: "Invited",
      role: r.role,
      departmentId: dep.id,
      entityId: entity,
      managerId: dep.managerId,
      location: locations[entity] ?? "Remote",
      startDate: now.slice(0, 10),
      status: "invited",
      ssn: "",
      avatarHue: Math.floor(Math.random() * 360),
      twoFactor: false,
      lastActive: now,
    }));
    setBusy(true);
    const ok = await act(
      () => {
        upsert("employees", ...people);
        return true;
      },
      { success: people.length === 1 ? `Invite sent to ${people[0].email}` : `${people.length} invites sent` },
    );
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  const addImported = (list: { email: string; role: Role }[]) => {
    setRows((rs) => {
      const kept = rs.filter((r) => r.email.trim());
      const have = new Set(kept.map((r) => r.email.trim().toLowerCase()));
      const fresh = list.filter((x) => !have.has(x.email.toLowerCase())).map((x) => ({ ...blankRow(x.role), email: x.email }));
      return [...kept, ...fresh].length ? [...kept, ...fresh] : [blankRow()];
    });
    setErrors({});
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        dismissable={!filled.length}
        title="Invite people"
        description="They get an email with a link to set a password and, if you allow it, order a card."
        footer={
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setImporting(true)}>
              <FileSpreadsheet /> Import from CSV
            </Button>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Tooltip content={allowed ? undefined : reason}>
              <span tabIndex={allowed ? undefined : 0} className="inline-flex">
                <Button variant="primary" loading={busy} disabled={!allowed} onClick={send}>
                  {filled.length > 1 ? `Send ${filled.length} invites` : "Send invite"}
                </Button>
              </span>
            </Tooltip>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {!allowed ? (
            <Callout tone="warn" title="You can't invite people">
              {reason}
            </Callout>
          ) : null}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_160px_32px] gap-2 text-[13px] font-medium">
              <span>Email address</span>
              <span>Role</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div key={r.key} className="flex flex-col gap-1">
                <div className="grid grid-cols-[minmax(0,1fr)_160px_32px] items-center gap-2">
                  <Input
                    type="email"
                    autoFocus={i === 0}
                    aria-label={`Email address ${i + 1}`}
                    aria-invalid={!!errors[r.key]}
                    placeholder={i === 0 ? "new.hire@northpine.example" : "another@northpine.example"}
                    value={r.email}
                    onChange={(e) => update(r.key, { email: e.target.value })}
                  />
                  <NativeSelect aria-label={`Role for email ${i + 1}`} value={r.role} onChange={(e) => update(r.key, { role: e.target.value as Role })}>
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </NativeSelect>
                  {rows.length > 1 ? (
                    <IconButton icon={<X />} label={`Remove email ${i + 1}`} size="icon-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                  ) : (
                    <span />
                  )}
                </div>
                {errors[r.key] ? <p className="text-xs text-danger">{errors[r.key]}</p> : null}
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start" disabled={rows.length >= 20} onClick={() => setRows((rs) => [...rs, blankRow(rs[rs.length - 1]?.role)])}>
              <Plus /> Add another
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" error={depError} hint="Everyone in this invite joins it. Their manager is the department's manager.">
              {(id) => (
                <Combobox
                  id={id}
                  aria-label="Department"
                  value={department}
                  onChange={(v) => (setDepartment(v), setDepError(null))}
                  options={departmentOptions(departments)}
                  placeholder="Choose a department"
                  searchPlaceholder="Search departments…"
                />
              )}
            </Field>
            <Field label="Entity" hint="Sets their card currency and which company pays them back.">
              {(id) => (
                <NativeSelect id={id} value={entity} onChange={(e) => setEntity(e.target.value)}>
                  {entities.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <Field label="Personal note" optional hint="Added to the invite email.">
            {(id) => <Textarea id={id} value={note} placeholder="Welcome aboard. Your card is ready to order once you sign in." onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Modal>
      <ImportCsvModal open={importing} onOpenChange={setImporting} onImport={addImported} />
    </>
  );
}

/** Parses "email" or "email,role" lines. Unknown roles become Employee. */
function parseList(text: string): { email: string; role: Role }[] {
  const out: { email: string; role: Role }[] = [];
  for (const line of text.split(/\r?\n|;/)) {
    const cells = line.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const email = cells.find((c) => EMAIL_RE.test(c));
    if (!email) continue;
    const roleCell = cells.find((c) => ROLES.includes(c.toLowerCase() as Role))?.toLowerCase() as Role | undefined;
    out.push({ email, role: roleCell ?? "employee" });
  }
  return out;
}

/** Opens on top of the invite modal. Two dialogs stacked, on purpose. */
function ImportCsvModal({ open, onOpenChange, onImport }: { open: boolean; onOpenChange: (v: boolean) => void; onImport: (list: { email: string; role: Role }[]) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setFileName(null);
      setError(null);
    }
  }, [open]);
  const found = useMemo(() => parseList(text), [text]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Import from CSV"
      description="One person per line: an email address, and optionally a role (admin, finance, manager, employee or auditor)."
      footer={
        <>
          <Button
            variant="link"
            className="mr-auto"
            onClick={() => toast.success("Template downloaded: northpine-invite-template.csv")}
          >
            Download template
          </Button>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!found.length) return setError("We didn't find any email addresses. Check the file has one per line.");
              onImport(found);
              onOpenChange(false);
              toast.success(`Added ${found.length} ${found.length === 1 ? "person" : "people"} to the invite`);
            }}
          >
            <Upload /> Add to invite
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FileDrop
          accept=".csv,text/csv,text/plain"
          label={fileName ? `${fileName} loaded` : "Drop a CSV here, or click to browse"}
          hint="Up to 500 rows. The first row can be a header."
          onFiles={async (files) => {
            const f = files[0];
            if (!f) return;
            setFileName(f.name);
            setText(await f.text());
            setError(null);
          }}
        />
        <Field label="Or paste addresses" error={error} hint={found.length ? `Found ${found.length} ${found.length === 1 ? "address" : "addresses"}.` : undefined}>
          {(id) => <Textarea id={id} className="min-h-28 font-mono text-[12.5px]" placeholder={"jamie.ortiz@northpine.example, manager\npriya.nair@northpine.example"} value={text} onChange={(e) => (setText(e.target.value), setError(null))} />}
        </Field>
      </div>
    </Modal>
  );
}
