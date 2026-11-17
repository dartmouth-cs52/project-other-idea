import { subDays, subHours, subMinutes } from "date-fns";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Settings that aren't records in the shared data store: the signed-in
// person's preferences, company profile, security policy and billing details.
// Kept in this module and saved to localStorage like everything else.

export const CHANNELS = ["email", "push", "chat", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface NotificationEvent {
  id: string;
  group: string;
  label: string;
  hint: string;
}

export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  { id: "card_declined", group: "Cards", label: "Card declined", hint: "A charge on one of your cards was declined." },
  { id: "card_limit", group: "Cards", label: "Card near its limit", hint: "A card you hold reaches 80% of its limit." },
  { id: "card_shipped", group: "Cards", label: "Physical card shipped", hint: "A new card is on its way." },
  { id: "receipt_missing", group: "Expenses", label: "Receipt missing", hint: "A charge still needs a receipt after 3 days." },
  { id: "memo_missing", group: "Expenses", label: "Memo missing", hint: "A charge needs a short business reason." },
  { id: "expense_flagged", group: "Expenses", label: "Expense flagged", hint: "A reviewer flagged one of your charges." },
  { id: "reimbursement_paid", group: "Expenses", label: "Reimbursement paid", hint: "Money is on its way to your bank." },
  { id: "approval_needed", group: "Approvals", label: "Approval needed", hint: "Something is waiting for your decision." },
  { id: "approval_decided", group: "Approvals", label: "Request approved or rejected", hint: "A request you made was decided." },
  { id: "approval_escalated", group: "Approvals", label: "Approval escalated", hint: "A request skipped to the next approver." },
  { id: "bill_due", group: "Bill pay", label: "Bill due", hint: "A bill is due in 3 days." },
  { id: "bill_paid", group: "Bill pay", label: "Bill paid", hint: "A scheduled payment went out." },
  { id: "sync_failed", group: "Accounting", label: "Accounting sync failed", hint: "Transactions could not be exported." },
  { id: "budget_alert", group: "Budgets", label: "Budget threshold reached", hint: "A budget you own passes its alert level." },
  { id: "new_signin", group: "Account", label: "New sign-in", hint: "Someone signed in to your account from a new device." },
];

const defaultPrefs = (): Record<string, Record<Channel, boolean>> =>
  Object.fromEntries(
    NOTIFICATION_EVENTS.map((e, i) => [
      e.id,
      { email: true, push: i % 3 !== 2, chat: false, sms: e.id === "card_declined" || e.id === "new_signin" },
    ]),
  );

export interface ActiveSession {
  id: string;
  device: string;
  kind: "laptop" | "phone";
  browser: string;
  location: string;
  ip: string;
  lastActive: string;
  current?: boolean;
}

const now = new Date();
const iso = (d: Date) => d.toISOString();

const defaultSessions: ActiveSession[] = [
  { id: "ses_1", device: "MacBook Pro", kind: "laptop", browser: "Chrome 131", location: "Portland, OR", ip: "73.214.18.40", lastActive: iso(now), current: true },
  { id: "ses_2", device: "iPhone 16", kind: "phone", browser: "Northpine app 4.12", location: "Portland, OR", ip: "172.56.3.201", lastActive: iso(subMinutes(now, 42)) },
  { id: "ses_3", device: "Windows PC", kind: "laptop", browser: "Edge 130", location: "Seattle, WA", ip: "98.97.12.7", lastActive: iso(subHours(now, 26)) },
  { id: "ses_4", device: "iPad Air", kind: "phone", browser: "Safari 18", location: "Bend, OR", ip: "50.35.144.92", lastActive: iso(subDays(now, 6)) },
];

export interface SettingsState {
  profile: { firstName: string; lastName: string; email: string; phone: string; timezone: string; language: string; avatar: string | null; twoFactor: boolean; passwordChangedAt: string };
  notifications: { prefs: Record<string, Record<Channel, boolean>>; digest: "off" | "daily" | "weekly"; digestDay: string; quietStart: string; quietEnd: string; quietOn: boolean; chatLinked: boolean };
  company: { legalName: string; dba: string; website: string; street: string; city: string; region: string; postal: string; country: string; fiscalStart: string; currency: string; logo: string | null };
  security: { require2fa: boolean; ssoEnabled: boolean; ssoEnforced: boolean; ssoMetadataUrl: string; sessionTimeout: string; ipRanges: string[]; sessions: ActiveSession[]; minLength: string; requireSymbols: boolean; rotateDays: string };
  billing: { contactName: string; contactEmail: string; vatId: string; poNumber: string; card: { brand: string; last4: string; exp: string } };
  developer: { alertEmail: string; alertAt: string; apiAllowlist: string };
  audit: { retention: string; streamUrl: string; streamOn: boolean };
  integrations: { syncEvery: string; syncCleared: boolean; mappings: Record<string, string>; banks: { id: string; name: string; last4: string }[] };
  entities: { defaultEntity: string; intercompany: boolean };
  workspace: { name: string; slug: string; deletionScheduledAt: string | null; ownerId: string };
  set: <K extends keyof Omit<SettingsState, "set">>(key: K, patch: Partial<SettingsState[K]>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      profile: { firstName: "Avery", lastName: "Stone", email: "avery.stone@northpine.example", phone: "(503) 555-0142", timezone: "America/Los_Angeles", language: "en", avatar: null, twoFactor: false, passwordChangedAt: iso(subDays(now, 184)) },
      notifications: { prefs: defaultPrefs(), digest: "weekly", digestDay: "monday", quietStart: "20:00", quietEnd: "07:00", quietOn: false, chatLinked: false },
      company: { legalName: "Northpine Inc.", dba: "Northpine", website: "https://northpine.example", street: "410 Cedar Ave", city: "Portland", region: "OR", postal: "97204", country: "United States", fiscalStart: "1", currency: "USD", logo: null },
      security: { require2fa: false, ssoEnabled: false, ssoEnforced: false, ssoMetadataUrl: "", sessionTimeout: "12h", ipRanges: ["73.214.18.0/24", "10.20.0.0/16"], sessions: defaultSessions, minLength: "12", requireSymbols: true, rotateDays: "never" },
      billing: { contactName: "Avery Stone", contactEmail: "billing@northpine.example", vatId: "84-2917365", poNumber: "", card: { brand: "Visa", last4: "4242", exp: "08/28" } },
      developer: { alertEmail: "eng-alerts@northpine.example", alertAt: "80", apiAllowlist: "" },
      audit: { retention: "365", streamUrl: "", streamOn: false },
      integrations: { syncEvery: "hourly", syncCleared: true, mappings: {}, banks: [] },
      entities: { defaultEntity: "ent_us", intercompany: true },
      workspace: { name: "Northpine", slug: "northpine", deletionScheduledAt: null, ownerId: "emp_me" },
      set: (key, patch) => set((s) => ({ [key]: { ...s[key], ...patch } }) as Partial<SettingsState>),
    }),
    { name: "northpine-settings", version: 1 },
  ),
);
