import { Faker, base, en } from "@faker-js/faker";
import { addDays, formatISO, startOfDay, subDays, subMinutes } from "date-fns";
import type {
  Approval,
  ApiKey,
  AuditEvent,
  Bill,
  Budget,
  Card,
  Category,
  Currency,
  Db,
  Department,
  Employee,
  Entity,
  GLAccount,
  Integration,
  Notification,
  PolicyRule,
  Reimbursement,
  Role,
  SavedReport,
  Task,
  Transaction,
  Vendor,
  Webhook,
} from "./types";

// Builds the whole company from one number. Names and amounts come out the same
// for the same seed; dates are relative to today so nothing looks stale.

export const TRANSACTION_COUNT = 10_000;

const iso = (d: Date) => formatISO(d);
const day = (d: Date) => formatISO(d, { representation: "date" });

const MERCHANTS: [string, string][] = [
  ["Skyline Air", "Airfare"],
  ["Harborview Hotels", "Lodging"],
  ["Metro Rideshare", "Ground transport"],
  ["CloudStack Hosting", "Software"],
  ["Pixelboard Design", "Software"],
  ["Ledger & Quill Stationery", "Office supplies"],
  ["Copperpot Catering", "Meals"],
  ["Basil Street Bistro", "Meals"],
  ["Northline Rail", "Ground transport"],
  ["Brightdesk Coworking", "Rent"],
  ["Signalwave Ads", "Advertising"],
  ["Tidepool Analytics", "Software"],
  ["Granite Office Furniture", "Equipment"],
  ["Volt Electronics", "Equipment"],
  ["Parcelpoint Shipping", "Shipping"],
  ["Evergreen Coffee", "Meals"],
  ["Summit Conferences", "Events"],
  ["Lanternfly Recruiting", "Recruiting"],
  ["Orbit Telecom", "Telecom"],
  ["Keystone Legal", "Professional services"],
  ["Fieldnote Research", "Professional services"],
  ["Tandem Bikes Rental", "Ground transport"],
  ["Mosaic Print Shop", "Marketing"],
  ["Quartz Security", "Software"],
  ["Driftwood Inn", "Lodging"],
  ["Cinder Grill", "Meals"],
  ["Larkspur Gifts", "Gifts"],
  ["Uplink Wifi", "Telecom"],
  ["Ironclad Storage", "Software"],
  ["Ferry & Co Taxi", "Ground transport"],
];

const DEPARTMENTS: [string, string | null, number][] = [
  ["Executive", null, 40000],
  ["Engineering", null, 180000],
  ["Platform", "Engineering", 60000],
  ["Mobile", "Engineering", 45000],
  ["Data", "Engineering", 38000],
  ["Sales", null, 120000],
  ["Enterprise Sales", "Sales", 70000],
  ["Sales Development", "Sales", 25000],
  ["Marketing", null, 95000],
  ["Brand", "Marketing", 30000],
  ["Finance", null, 30000],
  ["People", null, 28000],
  ["Customer Success", null, 42000],
  ["Legal", null, 22000],
];

const TITLES: Record<string, string[]> = {
  Executive: ["Chief Executive Officer", "Chief Operating Officer", "Chief of Staff"],
  Engineering: ["Software Engineer", "Senior Software Engineer", "Engineering Manager", "Staff Engineer"],
  Platform: ["Platform Engineer", "Site Reliability Engineer"],
  Mobile: ["iOS Engineer", "Android Engineer"],
  Data: ["Data Scientist", "Analytics Engineer"],
  Sales: ["Account Executive", "Sales Manager"],
  "Enterprise Sales": ["Enterprise Account Executive", "Solutions Consultant"],
  "Sales Development": ["Sales Development Rep"],
  Marketing: ["Product Marketing Manager", "Growth Marketer"],
  Brand: ["Brand Designer", "Content Lead"],
  Finance: ["Controller", "Staff Accountant", "AP Specialist", "FP&A Analyst"],
  People: ["People Partner", "Recruiter"],
  "Customer Success": ["Customer Success Manager", "Support Lead"],
  Legal: ["General Counsel", "Paralegal"],
};

const GL: [string, string, GLAccount["type"], string | null][] = [
  ["1000", "Assets", "asset", null],
  ["1010", "Operating account", "asset", "1000"],
  ["1020", "Payroll account", "asset", "1000"],
  ["1200", "Accounts receivable", "asset", "1000"],
  ["1400", "Prepaid expenses", "asset", "1000"],
  ["2000", "Liabilities", "liability", null],
  ["2010", "Accounts payable", "liability", "2000"],
  ["2100", "Card clearing", "liability", "2000"],
  ["2200", "Accrued expenses", "liability", "2000"],
  ["3000", "Equity", "equity", null],
  ["4000", "Revenue", "income", null],
  ["6000", "Operating expenses", "expense", null],
  ["6100", "Travel", "expense", "6000"],
  ["6110", "Airfare", "expense", "6100"],
  ["6120", "Lodging", "expense", "6100"],
  ["6130", "Ground transport", "expense", "6100"],
  ["6200", "Meals and entertainment", "expense", "6000"],
  ["6300", "Software and subscriptions", "expense", "6000"],
  ["6400", "Office and equipment", "expense", "6000"],
  ["6410", "Office supplies", "expense", "6400"],
  ["6420", "Equipment", "expense", "6400"],
  ["6500", "Marketing and advertising", "expense", "6000"],
  ["6600", "Professional services", "expense", "6000"],
  ["6700", "Telecom", "expense", "6000"],
  ["6800", "Rent and facilities", "expense", "6000"],
  ["6900", "Other expenses", "expense", "6000"],
];

const CATEGORY_GL: Record<string, string> = {
  Airfare: "6110",
  Lodging: "6120",
  "Ground transport": "6130",
  Meals: "6200",
  Software: "6300",
  "Office supplies": "6410",
  Equipment: "6420",
  Advertising: "6500",
  Marketing: "6500",
  Events: "6500",
  "Professional services": "6600",
  Recruiting: "6600",
  Telecom: "6700",
  Rent: "6800",
  Shipping: "6900",
  Gifts: "6900",
};

const VENDOR_NAMES = [
  "Brightdesk Coworking",
  "CloudStack Hosting",
  "Keystone Legal",
  "Fieldnote Research",
  "Granite Office Furniture",
  "Signalwave Ads",
  "Lanternfly Recruiting",
  "Orbit Telecom",
  "Quartz Security",
  "Ironclad Storage",
  "Mosaic Print Shop",
  "Summit Conferences",
  "Copperpot Catering",
  "Tidepool Analytics",
  "Parcelpoint Shipping",
  "Alder Accounting Partners",
  "Bluefin Insurance",
  "Cobalt Payroll Services",
  "Dunmore Facilities",
  "Elmwood Cleaning Co",
  "Foxglove Translation",
  "Gable Architecture",
  "Hollis Hardware",
  "Juniper Benefits",
  "Kettle Consulting",
  "Linden Logistics",
  "Maple Street Media",
  "Nimbus Data Centers",
  "Oakridge Training",
  "Palisade Pest Control",
];

export function buildDb(seed = 52): Db {
  const f = new Faker({ locale: [en, base] });
  f.seed(seed);
  const today = startOfDay(new Date());
  const pick = <T,>(xs: readonly T[]) => xs[f.number.int({ min: 0, max: xs.length - 1 })];
  const money = (min: number, max: number) => Math.round(f.number.float({ min, max }) * 100) / 100;
  let n = 0;
  const id = (prefix: string) => `${prefix}_${(++n).toString(36).padStart(5, "0")}`;

  const entities: Entity[] = [
    { id: "ent_us", name: "Northpine Inc.", country: "United States", currency: "USD", taxId: "84-2917365", address: "410 Cedar Ave, Portland, OR 97204", bankLast4: "4417" },
    { id: "ent_uk", name: "Northpine Ltd", country: "United Kingdom", currency: "GBP", taxId: "GB 284 9917 21", address: "22 Wharf Road, London N1 7GR", bankLast4: "0932" },
    { id: "ent_de", name: "Northpine GmbH", country: "Germany", currency: "EUR", taxId: "DE 318 204 557", address: "Torstrasse 140, 10119 Berlin", bankLast4: "7720" },
  ];
  const currencyOf = (entityId: string): Currency => entities.find((e) => e.id === entityId)!.currency;

  const departments: Department[] = [];
  for (const [name, parent, budget] of DEPARTMENTS) {
    departments.push({
      id: `dep_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`,
      name,
      parentId: parent ? departments.find((d) => d.name === parent)!.id : null,
      managerId: null,
      budgetMonthly: budget,
      glCode: `D${String(departments.length + 1).padStart(2, "0")}`,
    });
  }

  const employees: Employee[] = [];
  const locations: Record<string, string[]> = {
    ent_us: ["Portland, OR", "New York, NY", "Austin, TX", "Remote (US)"],
    ent_uk: ["London", "Manchester", "Remote (UK)"],
    ent_de: ["Berlin", "Munich"],
  };
  // The person signed in. Fixed, so guides can name her.
  employees.push({
    id: "emp_me",
    firstName: "Avery",
    lastName: "Stone",
    email: "avery.stone@northpine.example",
    phone: "(503) 555-0142",
    title: "Controller",
    role: "admin",
    departmentId: "dep_finance",
    entityId: "ent_us",
    managerId: null,
    location: "Portland, OR",
    startDate: day(subDays(today, 1100)),
    status: "active",
    ssn: "521-44-9083",
    avatarHue: 152,
    twoFactor: true,
    lastActive: iso(today),
  });
  for (let i = 0; i < 239; i++) {
    const dep = pick(departments);
    const entityId = f.helpers.weightedArrayElement([
      { weight: 7, value: "ent_us" },
      { weight: 2, value: "ent_uk" },
      { weight: 1, value: "ent_de" },
    ]);
    const firstName = f.person.firstName();
    const lastName = f.person.lastName();
    const role: Role = f.helpers.weightedArrayElement([
      { weight: 70, value: "employee" },
      { weight: 16, value: "manager" },
      { weight: 6, value: "finance" },
      { weight: 3, value: "admin" },
      { weight: 5, value: "auditor" },
    ]);
    employees.push({
      id: id("emp"),
      firstName,
      lastName,
      email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "") + "@northpine.example",
      phone: f.phone.number({ style: "national" }),
      title: pick(TITLES[dep.name] ?? ["Specialist"]),
      role,
      departmentId: dep.id,
      entityId,
      managerId: null,
      location: pick(locations[entityId]),
      startDate: day(subDays(today, f.number.int({ min: 20, max: 2400 }))),
      status: f.helpers.weightedArrayElement([
        { weight: 88, value: "active" as const },
        { weight: 6, value: "invited" as const },
        { weight: 3, value: "suspended" as const },
        { weight: 3, value: "offboarded" as const },
      ]),
      ssn: `${f.string.numeric(3)}-${f.string.numeric(2)}-${f.string.numeric(4)}`,
      avatarHue: f.number.int({ min: 0, max: 359 }),
      twoFactor: f.datatype.boolean({ probability: 0.7 }),
      lastActive: iso(subMinutes(today, f.number.int({ min: 5, max: 60 * 24 * 30 }))),
    });
  }
  for (const dep of departments) {
    const people = employees.filter((e) => e.departmentId === dep.id && e.id !== "emp_me");
    const manager = people.find((e) => e.role === "manager") ?? people[0];
    dep.managerId = dep.id === "dep_finance" ? "emp_me" : (manager?.id ?? null);
    for (const e of people) if (e.id !== dep.managerId) e.managerId = dep.managerId;
  }

  const glAccounts: GLAccount[] = GL.map(([code, name, type, parent]) => ({
    id: `gl_${code}`,
    code,
    name,
    type,
    parentId: parent ? `gl_${parent}` : null,
    active: true,
    balance: money(1000, 900000),
  }));

  const categories: Category[] = Object.entries(CATEGORY_GL).map(([name, gl]) => ({
    id: `cat_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`,
    name,
    glAccountId: `gl_${gl}`,
    parentId: null,
    requiresReceiptOver: name === "Meals" ? 25 : 75,
    enabled: true,
  }));
  const categoryByName = (name: string) => categories.find((c) => c.name === name)!;

  const cards: Card[] = [];
  const active = employees.filter((e) => e.status === "active");
  for (let i = 0; i < 320; i++) {
    const holder = i < 3 ? employees[0] : pick(active);
    const number = f.finance.creditCardNumber({ issuer: "4###############" }).replace(/\D/g, "").slice(0, 16);
    const kind = f.helpers.weightedArrayElement([
      { weight: 3, value: "virtual" as const },
      { weight: 2, value: "physical" as const },
    ]);
    const limitInterval = pick(["monthly", "monthly", "monthly", "weekly", "yearly", "total"] as const);
    const limitAmount = pick([500, 1000, 2500, 5000, 10000, 25000]);
    cards.push({
      id: id("card"),
      holderId: holder.id,
      nickname:
        i === 0
          ? "Travel"
          : i === 1
            ? "Software subscriptions"
            : i === 2
              ? "Team offsite"
              : kind === "virtual"
                ? `${pick(MERCHANTS)[0]} subscription`
                : `${holder.firstName}'s card`,
      kind,
      network: kind === "virtual" ? "visa" : pick(["visa", "mastercard"] as const),
      number,
      last4: number.slice(-4),
      expiry: `${String(f.number.int({ min: 1, max: 12 })).padStart(2, "0")}/${f.number.int({ min: 27, max: 31 })}`,
      cvc: f.string.numeric(3),
      status: f.helpers.weightedArrayElement([
        { weight: 80, value: "active" as const },
        { weight: 8, value: "frozen" as const },
        { weight: 4, value: "pending" as const },
        { weight: 4, value: "cancelled" as const },
        { weight: 4, value: "shipping" as const },
      ]),
      limitAmount,
      limitInterval,
      spentThisPeriod: money(0, limitAmount * 0.95),
      entityId: holder.entityId,
      departmentId: holder.departmentId,
      categoriesAllowed: f.datatype.boolean({ probability: 0.3 }) ? f.helpers.arrayElements(categories.map((c) => c.id), 3) : [],
      merchantLock: kind === "virtual" && f.datatype.boolean({ probability: 0.4 }) ? pick(MERCHANTS)[0] : null,
      createdAt: iso(subDays(today, f.number.int({ min: 1, max: 700 }))),
      autoLockDate: f.datatype.boolean({ probability: 0.1 }) ? day(addDays(today, f.number.int({ min: 3, max: 90 }))) : null,
    });
  }
  const liveCards = cards.filter((c) => c.status === "active" || c.status === "frozen");

  const transactions: Transaction[] = [];
  for (let i = 0; i < TRANSACTION_COUNT; i++) {
    const card = pick(liveCards);
    const [merchant, mcc] = pick(MERCHANTS);
    const category = categoryByName(mcc);
    const amount = mcc === "Airfare" || mcc === "Rent" ? money(180, 4200) : mcc === "Meals" ? money(6, 380) : money(12, 1800);
    const ageDays = Math.floor((i / TRANSACTION_COUNT) * 365);
    const date = subMinutes(subDays(today, ageDays), f.number.int({ min: 0, max: 1440 }));
    const status: Transaction["status"] =
      ageDays < 2 ? "pending" : f.helpers.weightedArrayElement([
        { weight: 94, value: "cleared" as const },
        { weight: 3, value: "declined" as const },
        { weight: 3, value: "refunded" as const },
      ]);
    const receipt: Transaction["receipt"] =
      amount < category.requiresReceiptOver
        ? "not_required"
        : f.helpers.weightedArrayElement([
            { weight: ageDays < 30 ? 4 : 1, value: "missing" as const },
            { weight: 9, value: "attached" as const },
            { weight: 0.2, value: "lost_affidavit" as const },
          ]);
    const violations: string[] = [];
    if (receipt === "missing") violations.push("Missing receipt");
    if (mcc === "Meals" && amount > 150) violations.push("Over the meal limit of $150");
    if (f.datatype.boolean({ probability: 0.01 })) violations.push("Weekend spend");
    transactions.push({
      id: `tx_${(i + 1).toString().padStart(5, "0")}`,
      cardId: card.id,
      employeeId: card.holderId,
      merchant,
      merchantCategory: mcc,
      amount,
      currency: currencyOf(card.entityId),
      date: iso(date),
      status,
      categoryId: f.datatype.boolean({ probability: ageDays < 14 ? 0.85 : 0.98 }) ? category.id : null,
      departmentId: card.departmentId,
      entityId: card.entityId,
      memo: f.datatype.boolean({ probability: 0.3 }) ? pick(["Client dinner", "Team lunch", "Conference travel", "Annual renewal", "Offsite supplies", "Customer visit", "Hiring event"]) : "",
      receipt,
      receiptName: receipt === "attached" ? `receipt-${i + 1}.pdf` : null,
      reviewStatus:
        ageDays > 45 ? "exported" : violations.length ? (f.datatype.boolean() ? "flagged" : "needs_review") : f.datatype.boolean({ probability: 0.6 }) ? "approved" : "needs_review",
      splitFrom: null,
      tags: f.datatype.boolean({ probability: 0.15 }) ? [pick(["Q4 offsite", "Project Atlas", "Billable", "Conference"])] : [],
      violations,
    });
  }
  // i = 0 is today, so the list is already newest first, which is how every list shows them.

  const reimbursements: Reimbursement[] = [];
  for (let i = 0; i < 180; i++) {
    const emp = i < 6 ? employees[0] : pick(active);
    const kind = f.helpers.weightedArrayElement([
      { weight: 7, value: "out_of_pocket" as const },
      { weight: 2, value: "mileage" as const },
      { weight: 1, value: "per_diem" as const },
    ]);
    const miles = kind === "mileage" ? f.number.int({ min: 4, max: 320 }) : null;
    const status = pick(["draft", "submitted", "submitted", "approved", "rejected", "paid", "paid", "paid"] as const);
    const [merchant, mcc] = pick(MERCHANTS);
    reimbursements.push({
      id: id("rmb"),
      employeeId: emp.id,
      kind,
      merchant: kind === "mileage" ? "Mileage" : kind === "per_diem" ? "Per diem" : merchant,
      amount: kind === "mileage" ? Math.round(miles! * 0.7 * 100) / 100 : kind === "per_diem" ? 79 * f.number.int({ min: 1, max: 5 }) : money(8, 600),
      currency: currencyOf(emp.entityId),
      date: day(subDays(today, f.number.int({ min: 1, max: 120 }))),
      categoryId: kind === "out_of_pocket" ? categoryByName(mcc).id : kind === "mileage" ? categoryByName("Ground transport").id : categoryByName("Meals").id,
      memo: pick(["", "Client visit", "Airport parking", "Team dinner", "Conference"]),
      status,
      miles,
      origin: miles ? pick(["Portland, OR", "Salem, OR", "Seattle, WA", "Eugene, OR"]) : null,
      destination: miles ? pick(["Bend, OR", "Hood River, OR", "Vancouver, WA", "Corvallis, OR"]) : null,
      receipt: kind === "out_of_pocket" && f.datatype.boolean({ probability: 0.8 }) ? "attached" : "missing",
      submittedAt: status === "draft" ? null : iso(subDays(today, f.number.int({ min: 0, max: 100 }))),
    });
  }

  const vendors: Vendor[] = VENDOR_NAMES.map((name, i) => ({
    id: `ven_${(i + 1).toString().padStart(3, "0")}`,
    name,
    legalName: `${name} ${pick(["LLC", "Inc.", "Ltd", "Co."])}`,
    email: `billing@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
    phone: f.phone.number({ style: "national" }),
    website: `https://${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
    category: pick(["Software", "Facilities", "Professional services", "Marketing", "Insurance", "Logistics"]),
    paymentMethod: pick(["ach", "ach", "wire", "check", "card"] as const),
    routingNumber: f.finance.routingNumber(),
    accountNumber: f.finance.accountNumber(10),
    taxId: `${f.string.numeric(2)}-${f.string.numeric(7)}`,
    w9OnFile: f.datatype.boolean({ probability: 0.8 }),
    address: `${f.location.streetAddress()}, ${f.location.city()}, ${f.location.state({ abbreviated: true })} ${f.location.zipCode("#####")}`,
    ownerId: pick(employees.filter((e) => e.departmentId === "dep_finance")).id,
    status: i > 26 ? "pending_review" : i === 26 ? "blocked" : "active",
    terms: pick(["net15", "net30", "net30", "net45", "net60", "due_on_receipt"] as const),
    createdAt: iso(subDays(today, f.number.int({ min: 10, max: 900 }))),
  }));

  const bills: Bill[] = [];
  for (let i = 0; i < 140; i++) {
    const vendor = pick(vendors);
    const issue = subDays(today, f.number.int({ min: 0, max: 120 }));
    const due = addDays(issue, 30);
    const lineCount = f.number.int({ min: 1, max: 5 });
    const lines = Array.from({ length: lineCount }, () => ({
      id: id("line"),
      description: pick(["Monthly service", "Annual license", "Consulting hours", "Hardware", "Support plan", "Setup fee", "Usage overage"]),
      quantity: f.number.int({ min: 1, max: 20 }),
      unitPrice: money(20, 2400),
      glAccountId: pick(glAccounts.filter((g) => g.type === "expense" && g.parentId)).id,
      departmentId: pick(departments).id,
    }));
    const overdue = due < today;
    const status: Bill["status"] = pick(
      overdue ? (["paid", "paid", "paid", "overdue", "void"] as const) : (["draft", "awaiting_approval", "awaiting_approval", "scheduled", "paid"] as const),
    );
    bills.push({
      id: id("bill"),
      number: `INV-${f.string.numeric(5)}`,
      vendorId: vendor.id,
      entityId: pick(entities).id,
      issueDate: day(issue),
      dueDate: day(due),
      currency: "USD",
      status,
      lines,
      scheduledFor: status === "scheduled" ? day(addDays(today, f.number.int({ min: 1, max: 20 }))) : null,
      paidAt: status === "paid" ? iso(subDays(due, f.number.int({ min: 0, max: 10 }))) : null,
      memo: "",
      attachmentName: f.datatype.boolean({ probability: 0.85 }) ? `${vendor.name.replace(/\s+/g, "-")}-invoice.pdf` : null,
      poNumber: f.datatype.boolean({ probability: 0.3 }) ? `PO-${f.string.numeric(4)}` : null,
    });
  }

  const approvals: Approval[] = [];
  const kinds: Approval["kind"][] = ["card_request", "reimbursement", "bill", "limit_increase", "vendor", "purchase_order"];
  for (let i = 0; i < 90; i++) {
    const kind = pick(kinds);
    const requester = pick(active);
    const amount = kind === "vendor" ? 0 : money(40, 25000);
    const subject =
      kind === "reimbursement" ? pick(reimbursements).id : kind === "bill" ? pick(bills).id : kind === "vendor" ? pick(vendors).id : pick(cards).id;
    const created = subDays(today, f.number.int({ min: 0, max: 20 }));
    const status = i < 40 ? "pending" : pick(["approved", "approved", "rejected", "escalated"] as const);
    approvals.push({
      id: id("apr"),
      kind,
      title:
        kind === "card_request"
          ? `New ${pick(["virtual", "physical"])} card for ${requester.firstName} ${requester.lastName}`
          : kind === "limit_increase"
            ? `Raise limit on ${requester.firstName}'s card`
            : kind === "reimbursement"
              ? `Reimbursement from ${requester.firstName} ${requester.lastName}`
              : kind === "bill"
                ? `Bill from ${pick(vendors).name}`
                : kind === "vendor"
                  ? `Add vendor ${pick(vendors).name}`
                  : `Purchase order for ${pick(["laptops", "event booth", "software seats", "office chairs"])}`,
      requesterId: requester.id,
      amount,
      currency: currencyOf(requester.entityId),
      createdAt: iso(created),
      dueAt: iso(addDays(created, 3)),
      status,
      stage: status === "pending" ? pick(["manager", "finance", "controller"] as const) : "done",
      approverIds: [requester.managerId ?? "emp_me", "emp_me"],
      subjectId: subject,
      comments: f.datatype.boolean({ probability: 0.3 })
        ? [{ authorId: requester.id, body: pick(["Needed for the client visit next week.", "Renewal is due Friday.", "Approved by my manager in Slack."]), at: iso(created) }]
        : [],
    });
  }

  const policies: PolicyRule[] = [
    { id: "pol_1", name: "Meals over $150 need a manager", enabled: true, order: 1, conditions: [{ field: "category", op: "eq", value: "cat_meals" }, { field: "amount", op: "gt", value: "150" }], action: "require_approval", approverRole: "manager", approverId: null },
    { id: "pol_2", name: "Receipts over $75", enabled: true, order: 2, conditions: [{ field: "amount", op: "gt", value: "75" }], action: "require_receipt", approverRole: null, approverId: null },
    { id: "pol_3", name: "Block gift cards", enabled: true, order: 3, conditions: [{ field: "category", op: "eq", value: "cat_gifts" }, { field: "amount", op: "gt", value: "100" }], action: "block", approverRole: null, approverId: null },
    { id: "pol_4", name: "Bills over $10,000 go to the controller", enabled: true, order: 4, conditions: [{ field: "kind", op: "eq", value: "bill" }, { field: "amount", op: "gt", value: "10000" }], action: "require_approval", approverRole: null, approverId: "emp_me" },
    { id: "pol_5", name: "Flag weekend spend", enabled: false, order: 5, conditions: [{ field: "merchant", op: "neq", value: "" }], action: "flag", approverRole: null, approverId: null },
  ];

  const budgets: Budget[] = departments.map((d, i) => ({
    id: `bud_${i + 1}`,
    name: `${d.name} ${pick(["operating", "travel", "software", "events"])}`,
    departmentId: d.id,
    amount: d.budgetMonthly,
    period: "monthly",
    spent: money(d.budgetMonthly * 0.2, d.budgetMonthly * 1.15),
    ownerId: d.managerId ?? "emp_me",
    alertAt: 80,
  }));

  const integrations: Integration[] = [
    { id: "int_ledgerbook", name: "Ledgerbook ERP", kind: "erp", connected: true, lastSync: iso(subMinutes(today, 480)), status: "ok", plan: "starter" },
    { id: "int_summa", name: "Summa Accounting", kind: "erp", connected: false, lastSync: null, status: "disconnected", plan: "growth" },
    { id: "int_peoplegrid", name: "PeopleGrid HRIS", kind: "hris", connected: true, lastSync: iso(subMinutes(today, 90)), status: "error", plan: "growth" },
    { id: "int_chatter", name: "Chatter", kind: "chat", connected: true, lastSync: iso(today), status: "ok", plan: "starter" },
    { id: "int_okey", name: "OneKey SSO", kind: "sso", connected: false, lastSync: null, status: "disconnected", plan: "enterprise" },
    { id: "int_vault", name: "Vaultbox Storage", kind: "storage", connected: false, lastSync: null, status: "disconnected", plan: "starter" },
    { id: "int_firstriver", name: "First River Bank", kind: "bank", connected: true, lastSync: iso(subMinutes(today, 30)), status: "syncing", plan: "starter" },
  ];

  const auditActions = ["signed in", "changed a card limit on", "froze", "approved", "rejected", "exported", "invited", "changed role for", "created API key", "updated policy", "downloaded statement for"];
  const audit: AuditEvent[] = Array.from({ length: 2400 }, (_, i) => ({
    id: `aud_${i + 1}`,
    actorId: pick(employees).id,
    action: pick(auditActions),
    target: pick([...cards.slice(0, 40).map((c) => `card ending ${c.last4}`), ...employees.slice(0, 40).map((e) => `${e.firstName} ${e.lastName}`), "the expense policy", "September statement"]),
    at: iso(subMinutes(today, i * 37 + f.number.int({ min: 0, max: 30 }))),
    ip: f.internet.ipv4(),
    entityId: pick(entities).id,
  }));

  const apiKeys: ApiKey[] = [
    { id: "key_1", name: "Ledgerbook sync", prefix: "np_live_8Hq2", createdAt: iso(subDays(today, 210)), lastUsed: iso(subMinutes(today, 12)), scopes: ["transactions:read", "bills:read"], createdBy: "emp_me", revoked: false },
    { id: "key_2", name: "Data warehouse", prefix: "np_live_Zt71", createdAt: iso(subDays(today, 90)), lastUsed: iso(subDays(today, 2)), scopes: ["transactions:read", "cards:read", "people:read"], createdBy: "emp_me", revoked: false },
    { id: "key_3", name: "Old script", prefix: "np_live_Qp04", createdAt: iso(subDays(today, 500)), lastUsed: null, scopes: ["transactions:read"], createdBy: employees[3].id, revoked: true },
  ];
  const webhooks: Webhook[] = [
    { id: "wh_1", url: "https://hooks.northpine.example/spend", events: ["transaction.created", "transaction.updated"], enabled: true, secretPrefix: "whsec_4kd9", createdAt: iso(subDays(today, 120)), failures: 0 },
    { id: "wh_2", url: "https://warehouse.northpine.example/ingest", events: ["bill.paid"], enabled: false, secretPrefix: "whsec_P0ae", createdAt: iso(subDays(today, 40)), failures: 14 },
  ];

  // The fixes below run after every random draw, so they change no other record's id or values.
  // Escalated approvals sit with the controller rather than "done".
  for (const a of approvals) if (a.status === "escalated") a.stage = "controller";
  // Avery needs a physical card (to report it lost) and claims in progress (to submit or withdraw).
  const team = cards.find((c) => c.holderId === "emp_me" && c.nickname === "Team offsite");
  if (team) team.kind = "physical";
  const mine = reimbursements.filter((r) => r.employeeId === "emp_me");
  const draft = mine.find((r) => r.kind === "per_diem");
  if (draft) Object.assign(draft, { status: "draft", submittedAt: null });
  const pendingClaim = mine.find((r) => r.merchant === "Larkspur Gifts");
  if (pendingClaim) Object.assign(pendingClaim, { status: "submitted", submittedAt: iso(subDays(today, 2)) });
  // The "bill due" notification names a real bill.
  const dueSoon = bills
    .filter((b) => b.status === "scheduled" || b.status === "awaiting_approval")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const dueSoonBody = () => {
    if (!dueSoon) return "A bill is due soon.";
    const total = dueSoon.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    return `${vendors.find((v) => v.id === dueSoon.vendorId)?.name}, $${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const notifications: Notification[] = [
    { id: "ntf_1", title: "12 receipts missing", body: "Charges from last week still need receipts.", at: iso(subMinutes(today, -300)), read: false, href: "/expenses?receipt=missing" },
    { id: "ntf_2", title: "Ledgerbook sync failed", body: "3 transactions could not be exported.", at: iso(subMinutes(today, 120)), read: false, href: "/accounting/sync" },
    { id: "ntf_3", title: "Bill due soon", body: dueSoonBody(), at: iso(subDays(today, 1)), read: true, href: dueSoon ? `/bills/${dueSoon.id}` : "/bills" },
    { id: "ntf_4", title: "New card request", body: "A teammate asked for a virtual card.", at: iso(subDays(today, 2)), read: true, href: "/approvals" },
  ];

  const reports: SavedReport[] = [
    { id: "rep_1", name: "Spend by department", ownerId: "emp_me", groupBy: "department", metric: "sum", filters: [], chart: "bar", schedule: "monthly", recipients: ["emp_me"], createdAt: iso(subDays(today, 60)) },
    { id: "rep_2", name: "Top merchants this quarter", ownerId: "emp_me", groupBy: "merchant", metric: "sum", filters: ["date:quarter"], chart: "table", schedule: "none", recipients: [], createdAt: iso(subDays(today, 20)) },
    { id: "rep_3", name: "Missing receipts by person", ownerId: employees[5].id, groupBy: "employee", metric: "count", filters: ["receipt:missing"], chart: "bar", schedule: "weekly", recipients: ["emp_me"], createdAt: iso(subDays(today, 9)) },
  ];

  const tasks: Task[] = [
    { id: "task_1", title: "Connect your accounting system", href: "/accounting/sync", due: day(addDays(today, 3)), done: true },
    { id: "task_2", title: "Set an expense policy", href: "/policies", due: day(addDays(today, 5)), done: false },
    { id: "task_3", title: "Issue cards to your team", href: "/cards", due: day(addDays(today, 7)), done: false },
    { id: "task_4", title: "Turn on two-factor sign-in for everyone", href: "/settings/security", due: day(addDays(today, 10)), done: false },
    { id: "task_5", title: "Add your first vendor", href: "/bills/vendors", due: day(addDays(today, 14)), done: true },
  ];

  return {
    entities,
    departments,
    employees,
    cards,
    transactions,
    categories,
    reimbursements,
    approvals,
    policies,
    vendors,
    bills,
    glAccounts,
    budgets,
    integrations,
    audit,
    apiKeys,
    webhooks,
    notifications,
    reports,
    tasks,
  };
}
