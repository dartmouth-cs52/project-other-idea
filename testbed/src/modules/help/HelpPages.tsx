import { format, parseISO } from "date-fns";
import { ArrowRight, BookOpen, Code2, CreditCard, FileText, Landmark, LifeBuoy, Mail, MessageCircle, Paperclip, Receipt, Search, Send, Shield, Sparkles, ThumbsDown, ThumbsUp, Wallet, X, CheckSquare, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ME_ID, useRow } from "@/data/store";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/ui/button";
import { Badge, Callout, Card, EmptyState, PageHeader } from "@/ui/display";
import { Field, Input, RadioCards, Select, Textarea } from "@/ui/form";
import { act, Loader } from "@/ui/flow";
import { FileDrop } from "@/ui/inputs";
import { Sheet } from "@/ui/overlay";
import { ARTICLES, CATEGORIES, categoryOf, findArticle, RELEASES } from "./articles";

const ICONS: Record<string, LucideIcon> = {
  cards: CreditCard,
  expenses: Receipt,
  reimbursements: Wallet,
  approvals: CheckSquare,
  bills: FileText,
  accounting: Landmark,
  security: Shield,
  developers: Code2,
};

const crumbs = (...rest: { label: string; to?: string }[]) => [{ label: "Help center", to: "/help" }, ...rest];

export function HelpHome() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") ?? "";
  const category = params.get("category");
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ARTICLES.filter((a) => (!category || a.category === category) && (!needle || `${a.title} ${a.summary} ${a.intro} ${a.steps.join(" ")}`.toLowerCase().includes(needle)));
  }, [q, category]);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const filtering = !!q.trim() || !!category;

  return (
    <>
      <div className="mb-6 flex flex-col items-center gap-3 rounded-xl border border-line bg-gradient-to-b from-brand-soft to-panel px-6 py-10 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-brand text-brand-ink">
          <LifeBuoy className="size-5" />
        </span>
        <h1 className="text-[24px] font-semibold tracking-tight">How can we help?</h1>
        <p className="text-[13px] text-ink-2">Answers about cards, receipts, approvals, bill pay and settings.</p>
        <div className="relative mt-2 w-full max-w-lg">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            aria-label="Search help articles"
            placeholder="Search for an answer, like “receipt” or “API key”"
            value={q}
            onChange={(e) => set("q", e.target.value)}
            className="h-11 w-full rounded-lg border border-line-strong bg-panel pr-3 pl-9 text-[14px] shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
      </div>

      <Loader loadKey="help-home" rows={8}>
        {() =>
          filtering ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-ink-2">
                  {results.length} {results.length === 1 ? "article" : "articles"}
                  {category ? ` in ${categoryOf(category)?.label}` : ""}
                  {q.trim() ? ` matching “${q.trim()}”` : ""}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
                  <X /> Clear
                </Button>
              </div>
              {results.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<Search />}
                    title="No articles match"
                    description="Try a shorter search, or ask our team."
                    action={
                      <Button asChild>
                        <Link to="/help/contact">Contact support</Link>
                      </Button>
                    }
                  />
                </Card>
              ) : (
                <ArticleList slugs={results.map((a) => a.slug)} />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-3 text-[15px] font-semibold">Browse by topic</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {CATEGORIES.map((c) => {
                    const Icon = ICONS[c.id] ?? BookOpen;
                    const count = ARTICLES.filter((a) => a.category === c.id).length;
                    return (
                      // A clickable div with no role or tabindex, on purpose.
                      <div key={c.id} onClick={() => set("category", c.id)} className="flex cursor-pointer flex-col gap-2 rounded-lg border border-line bg-panel p-4 shadow-xs transition-colors hover:border-brand/40 hover:bg-sunken/50">
                        <Icon className="size-5 text-brand" strokeWidth={1.75} />
                        <span className="text-[14px] font-medium">{c.label}</span>
                        <span className="text-[12.5px] text-ink-3">{c.blurb}</span>
                        <span className="mt-auto text-xs text-ink-3">{count} {count === 1 ? "article" : "articles"}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <Card title="Popular articles" className="min-w-0 lg:col-span-2" bodyClassName="p-0">
                  <ArticleList slugs={["issue-a-card", "upload-receipts", "two-factor", "api-keys", "approval-chains", "mileage"]} flat />
                </Card>
                <div className="flex flex-col gap-5">
                  <Card title="What's new" actions={<Button variant="link" size="sm" onClick={() => navigate("/help/whats-new")}>See all</Button>}>
                    <ul className="flex flex-col gap-3">
                      {RELEASES.slice(0, 3).map((r) => (
                        <li key={r.title} className="flex flex-col gap-0.5 text-[13px]">
                          <span className="text-xs text-ink-3">{format(parseISO(r.date), "MMM d")}</span>
                          <span>{r.title}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                  <Card title="Still stuck?">
                    <p className="mb-3 text-[13px] text-ink-2">Our team answers in about 2 hours on weekdays.</p>
                    <Button asChild variant="primary">
                      <Link to="/help/contact">
                        <Mail /> Contact support
                      </Link>
                    </Button>
                  </Card>
                </div>
              </div>
            </div>
          )
        }
      </Loader>
    </>
  );
}

function ArticleList({ slugs, flat }: { slugs: string[]; flat?: boolean }) {
  return (
    <ul className={cn("flex flex-col", !flat && "overflow-hidden rounded-lg border border-line bg-panel shadow-xs")}>
      {slugs.map((s) => {
        const a = findArticle(s)!;
        return (
          <li key={s}>
            <Link to={`/help/${s}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-sunken/60">
              <FileText className="size-4 shrink-0 text-ink-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] font-medium">{a.title}</span>
                <span className="truncate text-[12.5px] text-ink-3">{a.summary}</span>
              </span>
              <Badge>{categoryOf(a.category)?.label}</Badge>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function ArticlePage() {
  const { slug } = useParams();
  const article = findArticle(slug);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  if (!article)
    return (
      <Card>
        <EmptyState
          title="We couldn't find that article"
          description="It may have moved. Search the help center instead."
          action={
            <Button asChild>
              <Link to="/help">Back to the help center</Link>
            </Button>
          }
        />
      </Card>
    );
  const cat = categoryOf(article.category);
  const siblings = ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug);
  return (
    <>
      <PageHeader crumbs={crumbs({ label: cat?.label ?? "", to: `/help?category=${article.category}` }, { label: article.title })} title={article.title} description={article.summary} meta={<span className="text-xs text-ink-3">Updated {format(parseISO(article.updated), "MMMM d, yyyy")}</span>} />
      <Loader loadKey={`help-${article.slug}`} rows={6}>
        {() => (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            <article className="flex flex-col gap-5 rounded-lg border border-line bg-panel p-6 shadow-xs">
              <p className="text-[14px] leading-relaxed text-ink-2">{article.intro}</p>
              <ol className="flex flex-col gap-3">
                {article.steps.map((s, i) => (
                  <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
              {article.tip ? <Callout tone="info" title="Tip">{article.tip}</Callout> : null}
              {article.action ? (
                <div>
                  <Button asChild variant="primary">
                    <Link to={article.action.to}>
                      {article.action.label} <ArrowRight />
                    </Link>
                  </Button>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-line pt-4 text-[13px]">
                {vote ? (
                  <span className="text-ink-2" aria-live="polite">
                    Thanks for telling us.{" "}
                    {vote === "down" ? (
                      <Link to="/help/contact" className="text-brand hover:underline">
                        Ask our team instead
                      </Link>
                    ) : null}
                  </span>
                ) : (
                  <>
                    <span className="text-ink-2">Was this helpful?</span>
                    <Button size="sm" onClick={() => setVote("up")}>
                      <ThumbsUp /> Yes
                    </Button>
                    <Button size="sm" onClick={() => setVote("down")}>
                      <ThumbsDown /> No
                    </Button>
                  </>
                )}
              </div>
            </article>
            <aside className="flex flex-col gap-5">
              <Card title="Related articles">
                <ul className="flex flex-col gap-2 text-[13px]">
                  {article.related.map((r) => (
                    <li key={r}>
                      {/* A plain link, so it's a full page load, on purpose. */}
                      <a href={`/help/${r}`} className="text-brand hover:underline">
                        {findArticle(r)?.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </Card>
              {siblings.length ? (
                <Card title={`More in ${cat?.label}`}>
                  <ul className="flex flex-col gap-2 text-[13px]">
                    {siblings.map((s) => (
                      <li key={s.slug}>
                        <Link to={`/help/${s.slug}`} className="text-ink-2 hover:text-ink hover:underline">
                          {s.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </aside>
          </div>
        )}
      </Loader>
    </>
  );
}

export function WhatsNewPage() {
  const tone = { New: "brand", Improved: "info", Fixed: "neutral" } as const;
  return (
    <>
      <PageHeader crumbs={crumbs({ label: "What's new" })} title="What's new" description="Changes to Northpine, newest first." />
      <Loader loadKey="help-whats-new">
        {() => (
          <ol className="relative flex flex-col gap-6 border-l border-line pl-6">
            {RELEASES.map((r) => (
              <li key={r.title} className="relative">
                <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full bg-brand ring-4 ring-bg" />
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    {format(parseISO(r.date), "MMMM d, yyyy")} <Badge tone={tone[r.tag]}>{r.tag}</Badge>
                  </span>
                  <h2 className="text-[15px] font-semibold">{r.title}</h2>
                  <p className="max-w-2xl text-[13.5px] text-ink-2">{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Loader>
    </>
  );
}

const TOPICS = [
  { value: "card", label: "A card problem" },
  { value: "expense", label: "Expenses or receipts" },
  { value: "reimbursement", label: "A reimbursement" },
  { value: "bill", label: "A bill or vendor payment" },
  { value: "accounting", label: "Accounting sync" },
  { value: "billing", label: "Our Northpine bill" },
  { value: "account", label: "Signing in or my account" },
  { value: "other", label: "Something else" },
];

export function ContactPage() {
  const me = useRow("employees", ME_ID);
  const [topic, setTopic] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [invoice, setInvoice] = useState("");
  const [urgency, setUrgency] = useState<"normal" | "blocking">("normal");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [chat, setChat] = useState(false);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!topic) e.topic = "Pick what it's about.";
    if (!subject.trim()) e.subject = "Add a short subject.";
    if (message.trim().length < 20) e.message = "Tell us a bit more, at least 20 characters.";
    if (topic === "card" && !/^\d{4}$/.test(cardLast4)) e.card = "Enter the last 4 digits of the card.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const t = await act(() => `NP-${Math.floor(40000 + Math.random() * 9999)}`, { success: "Message sent" });
    setBusy(false);
    if (t) setTicket(t);
  };

  return (
    <>
      <PageHeader
        crumbs={crumbs({ label: "Contact support" })}
        title="Contact support"
        description="Weekdays 6 AM to 6 PM Pacific. We usually answer within 2 hours."
        actions={
          <Button onClick={() => setChat(true)}>
            <MessageCircle /> Chat with us
          </Button>
        }
      />
      {ticket ? (
        <Card>
          <EmptyState
            icon={<Send />}
            title={`We got it. Your ticket is ${ticket}.`}
            description={`We'll reply to ${me?.email ?? "your email"}. You can add more by replying to that email.`}
            action={
              <Button
                onClick={() => {
                  setTicket(null);
                  setTopic("");
                  setSubject("");
                  setMessage("");
                  setFiles([]);
                }}
              >
                Send another message
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <Card
            title="Send us a message"
            footer={
              <div className="flex justify-end">
                <Button variant="primary" loading={busy} onClick={submit}>
                  Send message
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-4">
              <Field label="What's it about?" error={errors.topic}>
                {(id) => <Select id={id} value={topic} onValueChange={setTopic} options={TOPICS} placeholder="Pick a topic" />}
              </Field>
              {/* Fields that appear for some topics only. */}
              {topic === "card" ? (
                <Field label="Last 4 digits of the card" error={errors.card} hint="Never send the full card number.">
                  {(id) => <Input id={id} inputMode="numeric" maxLength={4} className="w-32" value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ""))} />}
                </Field>
              ) : null}
              {topic === "billing" ? (
                <Field label="Invoice number" optional>
                  {(id) => <Input id={id} placeholder="INV-202611" className="w-48" value={invoice} onChange={(e) => setInvoice(e.target.value)} />}
                </Field>
              ) : null}
              <Field label="Subject" error={errors.subject}>
                {(id) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject} />}
              </Field>
              <Field label="Message" error={errors.message}>
                {(id) => <Textarea id={id} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={!!errors.message} placeholder="What were you trying to do, and what happened instead?" />}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">How urgent is it?</span>
                <RadioCards
                  value={urgency}
                  onValueChange={setUrgency}
                  options={[
                    { value: "normal", label: "Normal", description: "A question, or something we can fix this week." },
                    { value: "blocking", label: "Blocking", description: "Cards aren't working or payroll is stuck." },
                  ]}
                />
              </div>
              <Field label="Attachments" optional>
                {(id) => (
                  <div className="flex flex-col gap-2">
                    <FileDrop id={id} multiple label="Drop screenshots or files, or click to browse" hint="Up to 5 files, 10 MB each" onFiles={(f) => setFiles((x) => [...x, ...f].slice(0, 5))} />
                    {files.length ? (
                      <ul className="flex flex-col gap-1">
                        {files.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-sunken px-2 py-1 text-[12.5px]">
                            <Paperclip className="size-3.5 text-ink-3" />
                            <span className="flex-1 truncate">{f.name}</span>
                            <IconButton size="icon-sm" icon={<X />} label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </Field>
            </div>
          </Card>
          <aside className="flex flex-col gap-5">
            <Card title="Before you write">
              <ul className="flex flex-col gap-2 text-[13px]">
                {["freeze-a-card", "upload-receipts", "two-factor"].map((s) => (
                  <li key={s}>
                    {/* Plain link, full page load. */}
                    <a href={`/help/${s}`} className="text-brand hover:underline">
                      {findArticle(s)?.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Card lost or stolen?">
              <p className="text-[13px] text-ink-2">Freeze it now from Cards. It takes a second, and you can unfreeze it if it turns up.</p>
            </Card>
          </aside>
        </div>
      )}
      <ChatSheet open={chat} onOpenChange={setChat} />
    </>
  );
}

function ChatSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [messages, setMessages] = useState<{ from: "me" | "them"; text: string }[]>([{ from: "them", text: "Hi, this is Northpine support. What can we help with?" }]);
  const [draft, setDraft] = useState("");
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { from: "me", text }]);
    setDraft("");
    setTimeout(() => setMessages((m) => [...m, { from: "them", text: "Thanks. A specialist will join this chat in about 4 minutes." }]), 900);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Chat with support"
      description="Usually replies in a few minutes"
      footer={
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Input aria-label="Message" placeholder="Type a message" value={draft} onChange={(e) => setDraft(e.target.value)} className="flex-1" />
          <Button type="submit" variant="primary">
            Send
          </Button>
        </form>
      }
    >
      <ul className="flex flex-col gap-2" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[13px]", m.from === "me" ? "self-end bg-brand text-brand-ink" : "self-start bg-sunken")}>
            {m.from === "them" ? <Sparkles className="mr-1 inline size-3 text-brand" /> : null}
            {m.text}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
