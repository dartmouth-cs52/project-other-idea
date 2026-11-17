import { any, button, DONE, link, type Guide, type GuideSet, type Step } from "../guide.ts";

// Horilla HR's public demo (hr.demo.horilla.com), signed in with the demo
// account its own pages publish. A Django app drawn on the server, with HTMX
// swapping parts of a page. It is a shared, live site: strangers use the same
// account at the same moment and edit its records. So no guide here saves,
// approves, checks in or deletes anything (each stops before that control),
// and none is anchored on a record a stranger could rename: only on menus,
// filters, the seeded public holidays and the signed-in account's own leave.
//
// Held out: Haptic's prompt and widget are never adjusted against it.

const DASHBOARD = "/dashboard/";

/** A section of the side menu. Each opens a list of its pages. */
const section = (name: string): Step => ({ expect: [button(name)], act: { click: `nav button:has-text("${name}")` } });
/** A page in the list a section of the side menu opens. */
const page = (label: string, path: string): Step => ({ expect: [link(label)], act: { click: `a[href="${path}"]:visible` } });

/** The leave list's filter tags: the status one holding Requested and nothing else, and no other filter. */
const ONLY_REQUESTED = '.filter-field[data-field="status"] .filter-value[data-value="Requested"]';
const ANY_OTHER_FILTER = '.filter-field:not([data-field="status"]), .filter-field[data-field="status"] .filter-value:not([data-value="Requested"])';

/** The public holidays table's row for the Christmas break, and its start and end dates. */
const CHRISTMAS = 'tr[data-instance-id]:has(div[title="Christmas Break"])';
const CHRISTMAS_DATES = `${CHRISTMAS} td:nth-child(3) div, ${CHRISTMAS} td:nth-child(4) div`;

/** The signed-in account's own annual leave card: the number beside "Available Leave Days". */
const ANNUAL_LEFT = '#userLeaveCards .oh-leave-card:has(h5:text-is("Annual Leave")) p.font-bold >> nth=0';

const guides: Guide[] = [
  // The side menu, then the list's own status filter. Several ways set the same filter: the status
  // button above the table, the filter panel, and the dashboard's count of pending leave.
  // Still fails: the list unfiltered, filtered to another status, or to Requested and something else as well.
  {
    id: "pending-leave",
    start: DASHBOARD,
    goal: "Which leave requests are still waiting for someone to approve them? I only want to see those.",
    steps: [section("Leave"), page("Leave Requests", "/leave/request-view/"), { expect: [button("Requested")], act: { click: 'button:text-is("Requested")' } }, DONE],
    reached: { url: "/leave/request-view", selector: ONLY_REQUESTED, absent: ANY_OTHER_FILTER },
  },

  // A fact on another page: the dates of a seeded holiday, read from that page as the guide starts.
  // Still fails: Thanksgiving's dates, one of the two days alone, or a hedge.
  {
    id: "christmas-days",
    start: DASHBOARD,
    goal: "Which days do we get off for Christmas this year?",
    steps: [section("Leave"), page("Public Holidays", "/configuration/holiday-view/"), DONE],
    reached: { url: "/configuration/holiday-view", selector: CHRISTMAS },
    says: { shown: { selector: CHRISTMAS_DATES, part: "[A-Z][a-z]+ \\d{1,2}", anyOrder: true, when: "start", from: "/configuration/holiday-view/" } },
  },

  // The side menu, a list, and the button above it that opens a blank form.
  // Still fails: the employee list; the onboarding pages.
  {
    id: "new-starter",
    start: DASHBOARD,
    goal: "We have a new starter joining on Monday. Where do I set up their employee profile?",
    steps: [section("Employee"), page("Employees", "/employee/employee-view/"), { expect: [link("Create")], act: { click: 'a[href="/employee/employee-view-new/"]' } }, DONE],
    reached: { url: "/employee/employee-view-new" },
  },

  // The visitor opens the page above the one they were shown, then goes back for the right one.
  // Still fails: the employee list.
  {
    id: "org-chart-wrong-click",
    kind: "wrong-click",
    start: DASHBOARD,
    goal: "Where can I see who reports to whom in the company?",
    steps: [
      section("Employee"),
      { expect: [link("Organization Chart")], act: { click: 'a[href="/employee/employee-view/"]:visible' } },
      { ...section("Employee"), say: "Not that one. Open Employee again and click Organization Chart.", sayStartsWith: "Not that one." },
      page("Organization Chart", "/employee/organisation-chart/"),
      DONE,
    ],
    reached: { url: "/employee/organisation-chart" },
  },

  // A form in a dialog. Stops before Save, which would file a ticket on a site other people use.
  // Still fails: Save with the title left empty; the dialog closed.
  {
    id: "it-ticket",
    start: "/helpdesk/ticket-view/",
    goal: "My laptop screen is cracked. How do I raise a ticket so IT can fix it?",
    steps: [
      { expect: [link("Create")], act: { click: 'a:has-text("Create"):visible' } },
      { expect: [any("Title")], act: { fill: ['#objectCreateModal input[name="title"]', "Cracked laptop screen"] }, say: "Type a short title, like Cracked laptop screen." },
      { expect: [button("Save")], given: { typedInto: '#objectCreateModal input[name="title"]' } },
    ],
  },

  // The side menu, two levels.
  // Still fails: the attendance list, or the check-in log.
  {
    id: "late-arrivals",
    start: DASHBOARD,
    goal: "Where can I see who has been coming in late?",
    steps: [section("Attendance"), page("Late Arrival & Early Departure", "/attendance/late-come-early-out-view/"), DONE],
    reached: { url: "/attendance/late-come-early-out-view" },
  },

  // A fact on another page: the signed-in account's own balance, read from that page as the guide starts.
  // Still fails: the sick or casual leave balance, the days taken, or a hedge.
  {
    id: "annual-leave-left",
    start: DASHBOARD,
    goal: "How many days of annual leave do I have left?",
    steps: [section("Leave"), page("My Leave Requests", "/leave/user-request-view/"), DONE],
    reached: { url: "/leave/user-request-view", selector: '#userLeaveCards .oh-leave-card:has(h5:text-is("Annual Leave"))' },
    says: { shown: { selector: ANNUAL_LEFT, part: "\\d+(?:\\.[1-9])?", when: "start", from: "/leave/user-request-view/" } },
  },

  // Asked in Spanish: "Where do I see which equipment (laptops, phones) has been handed out, and to whom?"
  // Still fails: the asset categories, or the asset history.
  {
    id: "assets-es",
    kind: "awkward",
    start: DASHBOARD,
    goal: "¿Dónde veo qué equipos (portátiles, teléfonos) se han entregado y a quién?",
    steps: [section("Assets"), page("Requests & Allocation", "/asset/asset-request-allocation-view/"), DONE],
    reached: { url: "/asset/asset-request-allocation-view" },
  },

  // A seeded holiday's own Delete, in its row. It is never pressed.
  // Still fails: Delete in another holiday's row.
  {
    id: "remove-holiday",
    kind: "risky",
    start: DASHBOARD,
    goal: "Someone added Volunteer Day to our public holidays by mistake. How do I take it off?",
    steps: [section("Leave"), page("Public Holidays", "/configuration/holiday-view/"), { expect: [{ label: "Delete", role: "button", context: "Volunteer Day" }] }],
  },

  // The side menu, two levels: the payslips that payroll has generated.
  // Still fails: the payroll dashboard, or contracts.
  {
    id: "payslips",
    start: DASHBOARD,
    goal: "Where can I find the payslips that have been generated?",
    steps: [section("Payroll"), page("Payslips", "/payroll/view-payslip/"), DONE],
    reached: { url: "/payroll/view-payslip" },
  },

  // Horilla has no rooms or desks to book.
  { id: "no-room-booking", kind: "no-answer", start: DASHBOARD, goal: "How do I book a meeting room for Thursday afternoon?", steps: [DONE] },
];

export default {
  siteId: "site_bench_horilla",
  origin: "https://hr.demo.horilla.com",
  hasTag: false,
  about: "Horilla HR's public demo: an HR system (employees, attendance, leave, payroll, recruitment, assets, helpdesk) drawn on the server by Django, with HTMX swapping parts of a page. It stands for the HR software every large company runs.",
  heldOut: true,
  // The organisation chart draws the tree under the manager chosen in its list, and asks for it with a POST.
  reads: "^POST hr\\.demo\\.horilla\\.com/employee/organisation-chart/$",
  before: {
    path: "/login/",
    acts: [
      { fill: ['input[name="username"]', "admin"] },
      { fill: ['input[name="password"]', "admin"] },
      { click: 'form button[type="submit"]' },
      // Signed in once the dashboard has drawn its side menu.
      { hover: 'nav button:has-text("Leave")' },
    ],
  },
  guides,
} satisfies GuideSet;
