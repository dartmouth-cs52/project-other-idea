// Every record in Northpine. The seed in seed.ts builds these from a fixed
// number, so two visitors with the same seed see the same company.

export type Currency = "USD" | "GBP" | "EUR";
export type Role = "admin" | "finance" | "manager" | "employee" | "auditor";
export type Plan = "starter" | "growth" | "enterprise";

export interface Entity {
  id: string;
  name: string;
  country: string;
  currency: Currency;
  taxId: string;
  address: string;
  /** Last four digits of the operating account. */
  bankLast4: string;
}

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
  managerId: string | null;
  budgetMonthly: number;
  glCode: string;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  title: string;
  role: Role;
  departmentId: string;
  entityId: string;
  managerId: string | null;
  location: string;
  startDate: string;
  status: "active" | "invited" | "suspended" | "offboarded";
  /** Shown masked, revealed only in the People detail page. Privacy bait. */
  ssn: string;
  avatarHue: number;
  twoFactor: boolean;
  lastActive: string;
}

export type CardStatus = "active" | "frozen" | "pending" | "cancelled" | "shipping";
export interface Card {
  id: string;
  holderId: string;
  nickname: string;
  kind: "virtual" | "physical";
  network: "visa" | "mastercard";
  /** The full number. The UI shows the last four unless revealed. */
  number: string;
  last4: string;
  expiry: string;
  cvc: string;
  status: CardStatus;
  limitAmount: number;
  limitInterval: "daily" | "weekly" | "monthly" | "yearly" | "total";
  spentThisPeriod: number;
  entityId: string;
  departmentId: string;
  categoriesAllowed: string[];
  merchantLock: string | null;
  createdAt: string;
  autoLockDate: string | null;
}

export type TxStatus = "pending" | "cleared" | "declined" | "refunded";
export interface Transaction {
  id: string;
  cardId: string;
  employeeId: string;
  merchant: string;
  merchantCategory: string;
  amount: number;
  currency: Currency;
  date: string;
  status: TxStatus;
  categoryId: string | null;
  departmentId: string;
  entityId: string;
  memo: string;
  receipt: "missing" | "attached" | "not_required" | "lost_affidavit";
  receiptName: string | null;
  reviewStatus: "needs_review" | "approved" | "flagged" | "exported";
  splitFrom: string | null;
  tags: string[];
  /** Policy violations found on this charge. */
  violations: string[];
}

export interface Category {
  id: string;
  name: string;
  glAccountId: string;
  parentId: string | null;
  requiresReceiptOver: number;
  enabled: boolean;
}

export type ReimbursementKind = "out_of_pocket" | "mileage" | "per_diem";
export interface Reimbursement {
  id: string;
  employeeId: string;
  kind: ReimbursementKind;
  merchant: string;
  amount: number;
  currency: Currency;
  date: string;
  categoryId: string | null;
  memo: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "paid";
  miles: number | null;
  origin: string | null;
  destination: string | null;
  receipt: "missing" | "attached";
  submittedAt: string | null;
}

export type ApprovalKind = "card_request" | "reimbursement" | "bill" | "limit_increase" | "vendor" | "purchase_order";
export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  requesterId: string;
  amount: number;
  currency: Currency;
  createdAt: string;
  dueAt: string;
  status: "pending" | "approved" | "rejected" | "escalated";
  stage: "manager" | "finance" | "controller" | "done";
  approverIds: string[];
  /** The id of the record it's about, in the collection its kind names. */
  subjectId: string;
  comments: { authorId: string; body: string; at: string }[];
}

export interface PolicyRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Every condition must hold for the rule to apply. */
  conditions: { field: "amount" | "category" | "department" | "merchant" | "entity" | "kind"; op: "gt" | "lt" | "eq" | "neq" | "in"; value: string }[];
  action: "require_approval" | "require_receipt" | "block" | "flag" | "notify";
  approverRole: Role | null;
  approverId: string | null;
  order: number;
}

export interface Vendor {
  id: string;
  name: string;
  legalName: string;
  email: string;
  phone: string;
  website: string;
  category: string;
  paymentMethod: "ach" | "wire" | "check" | "card";
  /** Privacy bait: routing and account numbers. */
  routingNumber: string;
  accountNumber: string;
  taxId: string;
  w9OnFile: boolean;
  address: string;
  ownerId: string;
  status: "active" | "pending_review" | "blocked";
  terms: "net15" | "net30" | "net45" | "net60" | "due_on_receipt";
  createdAt: string;
}

export interface BillLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  glAccountId: string;
  departmentId: string;
}
export interface Bill {
  id: string;
  number: string;
  vendorId: string;
  entityId: string;
  issueDate: string;
  dueDate: string;
  currency: Currency;
  status: "draft" | "awaiting_approval" | "scheduled" | "paid" | "overdue" | "void";
  lines: BillLine[];
  scheduledFor: string | null;
  paidAt: string | null;
  memo: string;
  attachmentName: string | null;
  poNumber: string | null;
}

export interface GLAccount {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  parentId: string | null;
  active: boolean;
  balance: number;
}

export interface Budget {
  id: string;
  name: string;
  departmentId: string;
  amount: number;
  period: "monthly" | "quarterly" | "yearly";
  spent: number;
  ownerId: string;
  alertAt: number;
}

export interface Integration {
  id: string;
  name: string;
  kind: "erp" | "hris" | "chat" | "sso" | "bank" | "storage";
  connected: boolean;
  lastSync: string | null;
  status: "ok" | "error" | "syncing" | "disconnected";
  plan: Plan;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  target: string;
  at: string;
  ip: string;
  entityId: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  scopes: string[];
  createdBy: string;
  revoked: boolean;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  secretPrefix: string;
  createdAt: string;
  failures: number;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
  href: string;
}

export interface SavedReport {
  id: string;
  name: string;
  ownerId: string;
  groupBy: string;
  metric: string;
  filters: string[];
  chart: "bar" | "line" | "area" | "table" | "pie";
  schedule: "none" | "daily" | "weekly" | "monthly";
  recipients: string[];
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  href: string;
  due: string;
  done: boolean;
}

export interface Db {
  entities: Entity[];
  departments: Department[];
  employees: Employee[];
  cards: Card[];
  transactions: Transaction[];
  categories: Category[];
  reimbursements: Reimbursement[];
  approvals: Approval[];
  policies: PolicyRule[];
  vendors: Vendor[];
  bills: Bill[];
  glAccounts: GLAccount[];
  budgets: Budget[];
  integrations: Integration[];
  audit: AuditEvent[];
  apiKeys: ApiKey[];
  webhooks: Webhook[];
  notifications: Notification[];
  reports: SavedReport[];
  tasks: Task[];
}

export type CollectionName = keyof Db;
export type Row<C extends CollectionName> = Db[C][number];
