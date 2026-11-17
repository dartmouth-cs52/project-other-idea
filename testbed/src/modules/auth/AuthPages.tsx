import { ArrowLeft, Building2, Check, CreditCard, KeyRound, Landmark, Plus, Rocket, Smartphone, Trash2, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { simulate } from "@/data/store";
import { Button, IconButton } from "@/ui/button";
import { Callout } from "@/ui/display";
import { Field, Input, NativeSelect, RadioCards, Select } from "@/ui/form";
import { Stepper, toast } from "@/ui/flow";
import { Modal } from "@/ui/overlay";

function Logo({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
        <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#2f8f57" />
          <path d="M16 6l7 10h-4l5 8H8l5-8H9z" fill="#fff" />
        </svg>
        Northpine
      </span>
    </span>
  );
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SignInPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"password" | "sso">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const signIn = async () => {
    if (!EMAIL.test(email)) return setError("Enter your work email.");
    if (mode === "password" && !password) return setError("Enter your password.");
    setError(null);
    setBusy(true);
    try {
      await simulate(() => true);
      if (mode === "sso" && !email.endsWith("@northpine.example")) {
        setError(`${email.split("@")[1]} doesn't use single sign-on. Sign in with your password instead.`);
        return;
      }
      navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-bg">
      <div className="flex flex-1 flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-12">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[24px] font-semibold tracking-tight">{mode === "sso" ? "Sign in with SSO" : "Sign in to Northpine"}</h1>
            <p className="text-[13px] text-ink-2">{mode === "sso" ? "We'll send you to your company's sign-in page." : "Welcome back. Use your work email."}</p>
          </div>
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
          >
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <Field label="Work email">{(id) => <Input id={id} type="email" autoComplete="username" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            {mode === "password" ? (
              <Field
                label={
                  <span className="flex w-full items-center justify-between">
                    Password
                    {/* A link that opens a dialog instead of going anywhere, on purpose. */}
                    <a
                      href="#"
                      className="text-[12.5px] font-normal text-brand hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        setForgot(true);
                      }}
                    >
                      Forgot password?
                    </a>
                  </span>
                }
              >
                {(id) => <Input id={id} type="password" autoComplete="current-password" className="h-10" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
            ) : null}
            <Button type="submit" variant="primary" size="lg" loading={busy}>
              {mode === "sso" ? "Continue" : "Sign in"}
            </Button>
          </form>
          <div className="flex items-center gap-3 text-xs text-ink-3">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          {mode === "password" ? (
            <Button size="lg" onClick={() => setMode("sso")}>
              <KeyRound /> Continue with SSO
            </Button>
          ) : (
            <Button size="lg" onClick={() => setMode("password")}>
              <ArrowLeft /> Sign in with a password
            </Button>
          )}
          <p className="text-center text-[13px] text-ink-2">
            New to Northpine?{" "}
            <Link to="/onboarding" className="font-medium text-brand hover:underline">
              Set up a workspace
            </Link>
          </p>
        </div>
        <p className="text-xs text-ink-3">© 2026 Northpine, Inc. · Privacy · Terms</p>
      </div>
      <div className="hidden flex-1 flex-col justify-between bg-sidebar p-12 text-sidebar-ink lg:flex">
        <span />
        <div className="flex max-w-md flex-col gap-4">
          <p className="text-[22px] leading-snug font-medium">“We closed the books four days faster the first month. Nobody chases receipts anymore.”</p>
          <p className="text-[13px] text-sidebar-ink-2">Dana Whitlock, Controller at Fernhill Outdoor</p>
        </div>
        <div className="grid grid-cols-3 gap-6 text-[13px] text-sidebar-ink-2">
          <span>
            <strong className="block text-[20px] text-sidebar-ink">4,200+</strong> finance teams
          </span>
          <span>
            <strong className="block text-[20px] text-sidebar-ink">$9B</strong> spend managed
          </span>
          <span>
            <strong className="block text-[20px] text-sidebar-ink">2 hrs</strong> support reply
          </span>
        </div>
      </div>
      <ForgotPassword open={forgot} onOpenChange={setForgot} initial={email} />
    </div>
  );
}

function ForgotPassword({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (v: boolean) => void; initial: string }) {
  const [email, setEmail] = useState(initial);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(() => setSent(false), 200);
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={sent ? "Check your email" : "Reset your password"}
      description={sent ? undefined : "We'll email you a link to choose a new one."}
      size="sm"
      footer={
        sent ? (
          <Button variant="primary" onClick={() => close(false)}>
            Back to sign in
          </Button>
        ) : (
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (!EMAIL.test(email)) return setError("Enter the email you sign in with.");
                setError(null);
                setBusy(true);
                await new Promise((r) => setTimeout(r, 400));
                setBusy(false);
                setSent(true);
              }}
            >
              Send reset link
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <p className="text-[13px] text-ink-2">If an account uses that address, a link is on its way. It works for 30 minutes.</p>
      ) : (
        <Field label="Email" error={error}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />}
        </Field>
      )}
    </Modal>
  );
}

const STEPS = ["Company", "Bank", "Team", "First card", "Done"];
const BANKS = ["First River Bank", "Cascade Federal", "Harborline Bank", "Summit Credit Union"];

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState({ name: "", size: "11-50", industry: "" });
  const [bank, setBank] = useState<string | null>(null);
  const [invites, setInvites] = useState([{ email: "", role: "employee" }]);
  const [card, setCard] = useState({ nickname: "Team software", limit: "2000", kind: "virtual" });
  const [skipped, setSkipped] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const next = async () => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!company.name.trim()) e.name = "Enter your company's name.";
      if (!company.industry) e.industry = "Pick an industry.";
    }
    if (step === 1 && !bank) e.bank = "Pick a bank, or skip this for now.";
    if (step === 2) invites.forEach((r, i) => r.email && !EMAIL.test(r.email) && (e[`invite${i}`] = "That email doesn't look right."));
    if (step === 3 && !(Number(card.limit) > 0)) e.limit = "Set a limit above zero.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 350));
    setBusy(false);
    setSkipped((s) => s.filter((x) => x !== STEPS[step]));
    setStep((s) => s + 1);
  };
  const skip = () => {
    setErrors({});
    setSkipped((s) => [...new Set([...s, STEPS[step]])]);
    setStep((s) => s + 1);
  };
  const skippable = step === 1 || step === 2 || step === 3;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex h-16 items-center justify-between border-b border-line bg-panel px-6">
        <Logo />
        <Link to="/signin" className="text-[13px] text-ink-2 hover:text-ink">
          Sign out
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
        <div className="relative overflow-x-auto pb-1">
          <Stepper steps={STEPS} current={step} />
        </div>
        <section className="rounded-xl border border-line bg-panel shadow-sm">
          <div className="flex flex-col gap-5 p-6">
            {step === 0 ? (
              <StepIntro icon={<Building2 />} title="Tell us about your company" body="This sets up your workspace. You can change it later in Settings.">
                <Field label="Company name" error={errors.name}>
                  {(id) => <Input id={id} placeholder="Acme Outdoor Co." value={company.name} aria-invalid={!!errors.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />}
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium">How many people work there?</span>
                  <RadioCards
                    columns={4}
                    value={company.size}
                    onValueChange={(v) => setCompany({ ...company, size: v })}
                    options={["1-10", "11-50", "51-200", "200+"].map((v) => ({ value: v, label: v }))}
                  />
                </div>
                <Field label="Industry" error={errors.industry}>
                  {(id) => (
                    <Select
                      id={id}
                      value={company.industry}
                      onValueChange={(v) => setCompany({ ...company, industry: v })}
                      placeholder="Pick an industry"
                      options={["Software", "Retail", "Manufacturing", "Healthcare", "Professional services", "Nonprofit", "Other"].map((v) => ({ value: v, label: v }))}
                    />
                  )}
                </Field>
              </StepIntro>
            ) : step === 1 ? (
              <StepIntro icon={<Landmark />} title="Connect your bank" body="Cards draw on this account, and bills are paid from it. You'll sign in on your bank's own page.">
                <RadioCards columns={2} value={bank ?? ""} onValueChange={setBank} options={BANKS.map((b) => ({ value: b, label: b, icon: <Landmark /> }))} />
                {errors.bank ? <p className="text-xs text-danger">{errors.bank}</p> : null}
              </StepIntro>
            ) : step === 2 ? (
              <StepIntro icon={<Users />} title="Invite your team" body="They'll get an email to join. Admins can change roles later.">
                <div className="flex flex-col gap-2">
                  {invites.map((r, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Field label={<span className="sr-only">Email {i + 1}</span>} error={errors[`invite${i}`]} className="flex-1">
                        {(id) => <Input id={id} type="email" placeholder="name@company.com" value={r.email} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />}
                      </Field>
                      <NativeSelect aria-label={`Role for invite ${i + 1}`} className="mt-[22px] w-36" value={r.role} onChange={(e) => setInvites(invites.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                        <option value="employee">Employee</option>
                        <option value="manager">Manager</option>
                        <option value="finance">Finance</option>
                        <option value="admin">Admin</option>
                      </NativeSelect>
                      <IconButton className="mt-[22px]" icon={<Trash2 />} label={`Remove invite ${i + 1}`} disabled={invites.length === 1} onClick={() => setInvites(invites.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" className="self-start" onClick={() => setInvites([...invites, { email: "", role: "employee" }])}>
                    <Plus /> Add another
                  </Button>
                </div>
              </StepIntro>
            ) : step === 3 ? (
              <StepIntro icon={<CreditCard />} title="Issue your first card" body="A card for you, so you can try it today. Virtual cards work right away.">
                <RadioCards
                  value={card.kind}
                  onValueChange={(v) => setCard({ ...card, kind: v })}
                  options={[
                    { value: "virtual", label: "Virtual", description: "Use it online in a minute.", icon: <Smartphone /> },
                    { value: "physical", label: "Physical", description: "Arrives in 5 to 7 days.", icon: <CreditCard /> },
                  ]}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Card nickname">{(id) => <Input id={id} value={card.nickname} onChange={(e) => setCard({ ...card, nickname: e.target.value })} />}</Field>
                  <Field label="Monthly limit" error={errors.limit}>
                    {(id) => <Input id={id} inputMode="numeric" prefix="$" value={card.limit} onChange={(e) => setCard({ ...card, limit: e.target.value.replace(/[^\d]/g, "") })} />}
                  </Field>
                </div>
              </StepIntro>
            ) : (
              <StepIntro icon={<Rocket />} title={`${company.name || "Your workspace"} is ready`} body="Here's what's set up. Anything you skipped is waiting on your home page.">
                <ul className="flex flex-col gap-2 text-[13px]">
                  {STEPS.slice(0, 4).map((s) => (
                    <li key={s} className="flex items-center gap-2">
                      {skipped.includes(s) ? <span className="size-4 rounded-full border border-line-strong" /> : <Check className="size-4 text-ok" />}
                      <span className={skipped.includes(s) ? "text-ink-3" : undefined}>
                        {s === "Company" ? "Company details" : s === "Bank" ? (bank ? `${bank} connected` : "Bank account") : s === "Team" ? `${invites.filter((r) => r.email).length} invites sent` : `${card.nickname} card`}
                        {skipped.includes(s) ? " (skipped)" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </StepIntro>
            )}
          </div>
          <footer className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
            {step > 0 && step < 4 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              {skippable ? (
                <Button variant="ghost" onClick={skip}>
                  Skip for now
                </Button>
              ) : null}
              {step < 4 ? (
                <Button variant="primary" loading={busy} onClick={next}>
                  {step === 1 ? "Connect bank" : step === 2 ? "Send invites" : step === 3 ? "Issue card" : "Continue"}
                </Button>
              ) : (
                <Button variant="primary" asChild>
                  <Link to="/" onClick={() => toast.success("Welcome to Northpine")}>
                    Go to dashboard
                  </Link>
                </Button>
              )}
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}

function StepIntro({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children: ReactNode }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand [&_svg]:size-5">{icon}</span>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[18px] font-semibold">{title}</h1>
          <p className="text-[13px] text-ink-2">{body}</p>
        </div>
      </div>
      {children}
    </>
  );
}
