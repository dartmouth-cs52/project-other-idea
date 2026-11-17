import { Copy, Download, Eye, EyeOff, KeyRound, Monitor, Moon, ShieldCheck, Sun, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ME_ID, patch } from "@/data/store";
import { ago } from "@/lib/format";
import { useLab, type Theme } from "@/lab/lab";
import { Button, IconButton } from "@/ui/button";
import { Avatar, Badge, Card } from "@/ui/display";
import { Field, Input, NativeSelect, RadioCards } from "@/ui/form";
import { act, Loader, Stepper, toast } from "@/ui/flow";
import { Combobox } from "@/ui/inputs";
import { ConfirmDialog, Modal } from "@/ui/overlay";
import { downloadText, FieldGrid, randomToken, readImage, SaveCard, SettingsHeader, useDraft, done } from "./common";
import { useSettings } from "./store";

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Tokyo"];
  }
})();

function tzOffset(tz: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

export function ProfilePage() {
  return (
    <>
      <SettingsHeader title="Profile" description="Your name, contact details and how Northpine looks for you. Only you can change these." />
      <Loader loadKey="settings-profile">
        {() => (
          <div className="flex flex-col gap-5">
            <PersonalInfo />
            <Preferences />
            <PasswordCard />
            <TwoFactorCard />
          </div>
        )}
      </Loader>
    </>
  );
}

function PersonalInfo() {
  const profile = useSettings((s) => s.profile);
  const set = useSettings((s) => s.set);
  const { draft, update, dirty } = useDraft({ firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone, avatar: profile.avatar });
  const [emailOpen, setEmailOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <SaveCard
      title="Personal info"
      description="Shown to your teammates on approvals and cards."
      dirty={dirty}
      onSave={() => {
        set("profile", draft);
        patch("employees", ME_ID, { firstName: draft.firstName, lastName: draft.lastName, phone: draft.phone });
      }}
      success="Profile saved"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          {draft.avatar ? (
            <img src={draft.avatar} alt="" className="size-14 rounded-full object-cover" />
          ) : (
            <Avatar person={{ firstName: draft.firstName || "?", lastName: draft.lastName || "?", avatarHue: 152 }} size={56} />
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
              <Button size="sm" onClick={() => file.current?.click()}>
                <Upload /> Upload photo
              </Button>
              {draft.avatar ? (
                <Button size="sm" variant="ghost" onClick={() => update({ avatar: null })}>
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-ink-3">PNG or JPG, at least 200 by 200 pixels.</p>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Profile photo"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) update({ avatar: await readImage(f) });
              }}
            />
          </div>
        </div>
        <FieldGrid>
          <Field label="First name">{(id) => <Input id={id} value={draft.firstName} onChange={(e) => update({ firstName: e.target.value })} />}</Field>
          <Field label="Last name">{(id) => <Input id={id} value={draft.lastName} onChange={(e) => update({ lastName: e.target.value })} />}</Field>
          <Field label="Work email" hint="Changing it needs a code sent to the new address.">
            {(id) => (
              <div className="flex gap-2">
                {/* Read-only, privacy bait: the guide should not read it out. */}
                <Input id={id} value={profile.email} readOnly className="flex-1 bg-sunken" />
                <Button size="md" onClick={() => setEmailOpen(true)}>
                  Change email
                </Button>
              </div>
            )}
          </Field>
          <Field label="Mobile phone" hint="Used for SMS alerts and sign-in codes.">
            {(id) => <Input id={id} type="tel" value={draft.phone} onChange={(e) => update({ phone: e.target.value })} />}
          </Field>
        </FieldGrid>
      </div>
      <ChangeEmailModal open={emailOpen} onOpenChange={setEmailOpen} />
    </SaveCard>
  );
}

function ChangeEmailModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const set = useSettings((s) => s.set);
  const [step, setStep] = useState<"enter" | "verify">("enter");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setStep("enter");
      setEmail("");
      setPassword("");
      setCode("");
      setError(null);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={step === "enter" ? "Change your email" : "Check your inbox"}
      description={step === "enter" ? "We'll send a 6-digit code to the new address." : `Enter the code we sent to ${email}.`}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          {step === "enter" ? (
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email address.");
                if (password.length < 6) return setError("Enter your current password.");
                setError(null);
                setBusy(true);
                const ok = await done(() => true, { success: "Code sent" });
                setBusy(false);
                if (ok) setStep("verify");
              }}
            >
              Send code
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!/^\d{6}$/.test(code)) return setError("The code is 6 digits.");
                setBusy(true);
                const ok = await done(() => set("profile", { email }), { success: "Email changed" });
                setBusy(false);
                if (ok) close(false);
              }}
            >
              Verify email
            </Button>
          )}
        </>
      }
    >
      {step === "enter" ? (
        <div className="flex flex-col gap-4">
          <Field label="New email" error={error && error.includes("email") ? error : null}>
            {(id) => <Input id={id} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Current password" error={error && error.includes("password") ? error : null}>
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        </div>
      ) : (
        <Field label="Verification code" error={error} hint="Didn't get it? Check spam, or wait a minute and send it again.">
          {(id) => <Input id={id} inputMode="numeric" maxLength={6} className="font-mono tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />}
        </Field>
      )}
    </Modal>
  );
}

function Preferences() {
  const profile = useSettings((s) => s.profile);
  const set = useSettings((s) => s.set);
  const theme = useLab((s) => s.theme);
  const setLab = useLab((s) => s.set);
  const { draft, update, dirty } = useDraft({ timezone: profile.timezone, language: profile.language, theme });
  const tzOptions = useMemo(() => TIMEZONES.map((tz) => ({ value: tz, label: tz.replace(/_/g, " "), hint: tzOffset(tz), group: tz.split("/")[0] })), []);
  return (
    <SaveCard
      title="Preferences"
      description="Dates, times and language across Northpine."
      dirty={dirty}
      onSave={() => {
        set("profile", { timezone: draft.timezone, language: draft.language });
        setLab({ theme: draft.theme as Theme, locale: draft.language === "es" ? "es" : "en" });
      }}
      success="Preferences saved"
    >
      <div className="flex flex-col gap-5">
        <FieldGrid>
          <Field label="Time zone" hint="Approvals and bill due dates use this.">
            {(id) => <Combobox id={id} value={draft.timezone} onChange={(v) => update({ timezone: v })} options={tzOptions} searchPlaceholder="Search time zones…" />}
          </Field>
          <Field label="Language">
            {(id) => (
              <NativeSelect id={id} value={draft.language} onChange={(e) => update({ language: e.target.value })}>
                <option value="en">English (US)</option>
                <option value="es">Español</option>
                <option value="fr" disabled>
                  Français (coming soon)
                </option>
                <option value="de" disabled>
                  Deutsch (coming soon)
                </option>
              </NativeSelect>
            )}
          </Field>
        </FieldGrid>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Theme</span>
          <RadioCards
            name="theme"
            columns={3}
            value={draft.theme}
            onValueChange={(v) => update({ theme: v })}
            options={[
              { value: "light", label: "Light", icon: <Sun /> },
              { value: "dark", label: "Dark", icon: <Moon /> },
              { value: "system", label: "Match system", icon: <Monitor /> },
            ]}
          />
        </div>
      </div>
    </SaveCard>
  );
}

function PasswordCard() {
  const changedAt = useSettings((s) => s.profile.passwordChangedAt);
  const set = useSettings((s) => s.set);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const strength = next.length === 0 ? 0 : Math.min(4, Math.floor(next.length / 4) + (/[^A-Za-z0-9]/.test(next) ? 1 : 0));
  return (
    <Card
      title="Password"
      description={`Last changed ${ago(changedAt)}.`}
      footer={
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={async () => {
              const e: Record<string, string> = {};
              if (!current) e.current = "Enter your current password.";
              if (next.length < 12) e.next = "Use at least 12 characters.";
              else if (!/[^A-Za-z0-9]/.test(next)) e.next = "Include at least one symbol.";
              if (confirm !== next) e.confirm = "The passwords don't match.";
              setErrors(e);
              if (Object.keys(e).length) return;
              setBusy(true);
              const ok = await done(() => set("profile", { passwordChangedAt: new Date().toISOString() }), { success: "Password updated. Other devices were signed out." });
              setBusy(false);
              if (ok) {
                setCurrent("");
                setNext("");
                setConfirm("");
              }
            }}
          >
            Update password
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current password" error={errors.current}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.current} />}
        </Field>
        <Field label="New password" error={errors.next} hint="12 or more characters, with a symbol.">
          {(id) => (
            <div className="flex flex-col gap-1.5">
              <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.next} />
              <div className="flex gap-1" aria-hidden>
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${i <= strength ? (strength < 3 ? "bg-warn" : "bg-ok") : "bg-sunken"}`} />
                ))}
              </div>
            </div>
          )}
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!errors.confirm} />}
        </Field>
      </div>
    </Card>
  );
}

function TwoFactorCard() {
  const on = useSettings((s) => s.profile.twoFactor);
  const set = useSettings((s) => s.set);
  const [setup, setSetup] = useState(false);
  const [off, setOff] = useState(false);
  return (
    <Card
      title="Two-factor authentication"
      description="Ask for a code from your phone when you sign in."
      actions={on ? <Badge tone="ok" dot>On</Badge> : <Badge tone="warn" dot>Off</Badge>}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-brand">
            <ShieldCheck className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="text-[13px] font-medium">Authenticator app</span>
            <span className="text-xs text-ink-3">{on ? "Codes come from your authenticator app." : "Use any app that makes 6-digit codes, like OneKey Authenticator."}</span>
          </div>
        </div>
        {on ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setSetup(true)}>
              <KeyRound /> Regenerate backup codes
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setOff(true)}>
              Turn off
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setSetup(true)}>
            Set up two-factor
          </Button>
        )}
      </div>
      <TwoFactorSetup open={setup} onOpenChange={setSetup} />
      <ConfirmDialog
        open={off}
        onOpenChange={setOff}
        title="Turn off two-factor?"
        description="Anyone with your password could sign in as you."
        confirmLabel="Turn off"
        danger
        onConfirm={async () => {
          await act(() => {
            set("profile", { twoFactor: false });
            patch("employees", ME_ID, { twoFactor: false });
          }, { success: "Two-factor is off" });
        }}
      />
    </Card>
  );
}

/** A grid of squares standing in for a QR code. */
function FakeQr() {
  const cells = useMemo(() => Array.from({ length: 21 * 21 }, (_, i) => (i * 7919) % 11 < 5), []);
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7);
  return (
    <svg viewBox="0 0 21 21" className="size-40 rounded-md border border-line bg-white p-2" role="img" aria-label="QR code for your authenticator app">
      {cells.map((on, i) => {
        const r = Math.floor(i / 21);
        const c = i % 21;
        if (finder(r, c)) {
          const lr = r > 13 ? r - 14 : r;
          const lc = c > 13 ? c - 14 : c;
          const ring = lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
          return ring ? <rect key={i} x={c} y={r} width={1} height={1} fill="#111" /> : null;
        }
        return on ? <rect key={i} x={c} y={r} width={1} height={1} fill="#111" /> : null;
      })}
    </svg>
  );
}

function TwoFactorSetup({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const set = useSettings((s) => s.set);
  const [step, setStep] = useState(0);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const secret = useMemo(() => randomToken(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const codes = useMemo(() => Array.from({ length: 10 }, () => `${randomToken(5, "abcdefghjkmnpqrstuvwxyz23456789")}-${randomToken(5, "abcdefghjkmnpqrstuvwxyz23456789")}`), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => {
    setStep(0);
    setDigits(["", "", "", "", "", ""]);
    setError(null);
    setShowKey(false);
  };
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) reset();
  };
  const setDigit = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      // Pasted the whole code.
      const next = clean.slice(0, 6).split("");
      setDigits([...next, ...Array(6 - next.length).fill("")]);
      boxes.current[Math.min(5, next.length)]?.focus();
      return;
    }
    setDigits((d) => d.map((x, j) => (j === i ? clean : x)));
    if (clean && i < 5) boxes.current[i + 1]?.focus();
  };

  const footer =
    step === 0 ? (
      <>
        <Button onClick={() => close(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => setStep(1)}>
          Next
        </Button>
      </>
    ) : step === 1 ? (
      <>
        <Button onClick={() => setStep(0)}>Back</Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            const code = digits.join("");
            if (code.length < 6) return setError("Enter all 6 digits.");
            if (code === "000000") return setError("That code didn't match. Codes change every 30 seconds, so try the newest one.");
            setError(null);
            setBusy(true);
            const ok = await done(() => true, { success: "Code accepted" });
            setBusy(false);
            if (ok) setStep(2);
          }}
        >
          Verify
        </Button>
      </>
    ) : (
      <Button
        variant="primary"
        onClick={() => {
          set("profile", { twoFactor: true });
          patch("employees", ME_ID, { twoFactor: true });
          toast.success("Two-factor is on");
          close(false);
        }}
      >
        I've saved these
      </Button>
    );

  return (
    <Modal open={open} onOpenChange={close} title="Set up two-factor" size="md" dismissable={step < 2} footer={footer}>
      <div className="flex flex-col gap-5">
        <Stepper steps={["Scan", "Verify", "Backup codes"]} current={step} />
        {step === 0 ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <FakeQr />
            <div className="flex flex-col gap-2 text-[13px]">
              <p>Open your authenticator app and scan this code.</p>
              <p className="text-ink-3">Can't scan it? Enter this setup key instead.</p>
              <div className="flex items-center gap-2">
                <code className="rounded bg-sunken px-2 py-1 font-mono text-[12.5px]">{showKey ? secret.replace(/(.{4})/g, "$1 ").trim() : "•••• •••• •••• ••••"}</code>
                <IconButton size="icon-sm" icon={showKey ? <EyeOff /> : <Eye />} label={showKey ? "Hide setup key" : "Reveal setup key"} onClick={() => setShowKey((s) => !s)} />
              </div>
            </div>
          </div>
        ) : step === 1 ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px]">Enter the 6-digit code your app shows for Northpine.</p>
            {/* Six separate boxes, one digit each. */}
            <div className="flex gap-2" role="group" aria-label="Verification code">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    boxes.current[i] = el;
                  }}
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  aria-label={`Digit ${i + 1}`}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                  }}
                  className="h-12 w-10 rounded-md border border-line-strong bg-panel text-center font-mono text-lg shadow-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger"
                  aria-invalid={!!error}
                />
              ))}
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px]">
              Keep these somewhere safe. Each code works once if you lose your phone. <strong>You won't see them again.</strong>
            </p>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md bg-sunken p-4 font-mono text-[13px]">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(codes.join("\n")).catch(() => undefined);
                  toast.success("Copied");
                }}
              >
                <Copy /> Copy codes
              </Button>
              <Button size="sm" onClick={() => downloadText("northpine-backup-codes.txt", codes.join("\n"))}>
                <Download /> Download
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
