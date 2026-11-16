import { any, button, DONE, link, type Task } from "./types";

// apr_00110 is "Bill from CloudStack Hosting" in the default seed, pending at
// the manager stage.

export const tasks: Task[] = [
  {
    id: "approvals-approve-all-reimbursements",
    start: "/approvals",
    goal: "approve all pending reimbursements",
    steps: [
      { expect: [button("Reimbursements")], act: { click: "role=button[name=/^Reimbursements/]" } },
      { expect: [any("Select all")], act: { click: 'role=checkbox[name="Select all"]' } },
      { expect: [button("Approve 11")], act: { click: "role=button[name=/^Approve \\d+/]" } },
      DONE,
    ],
    covers: ["data-filter", "data-bulk", "ambiguity-duplicate-label", "overlay-toast-undo"],
  },
  {
    id: "approvals-reject-with-reason",
    start: "/approvals",
    goal: "reject the CloudStack Hosting bill, it's a duplicate",
    steps: [
      { expect: [any("Bill from CloudStack Hosting")], act: { click: "text=Bill from CloudStack Hosting >> nth=0" } },
      { expect: [button("Reject")], act: { click: 'main >> role=button[name="Reject"]' } },
      { expect: [any("Reason")], act: { fill: ['role=textbox[name="Reason"]', "Duplicate of last month's invoice"] } },
      { expect: [button("Reject")], act: { click: 'role=dialog >> role=button[name="Reject"]' } },
      DONE,
    ],
    covers: ["overlay-modal", "form-validation", "ambiguity-duplicate-label"],
  },
  {
    id: "approvals-delegate-vacation",
    start: "/approvals",
    goal: "I'm on vacation next week, how do I let someone else approve things",
    steps: [
      { expect: [button("Delegate approvals")], act: { click: 'role=button[name="Delegate approvals"]' } },
      { expect: [any("Delegate to")], act: { click: 'role=combobox[name="Delegate to"]' } },
      { expect: [], act: { click: "role=option >> nth=0" } },
      { expect: [button("Any date")], act: { click: 'role=button[name="Any date"]' } },
      { expect: [], act: { click: 'role=button[name*="November 20th"]' } },
      { expect: [], act: { click: 'role=button[name*="November 27th"]' } },
      { expect: [button("Save delegation")], act: { click: 'role=button[name="Save delegation"]' } },
      DONE,
    ],
    covers: ["overlay-drawer", "form-combobox", "form-date-range", "form-switch"],
  },
  {
    id: "approvals-board-escalate",
    start: "/approvals?view=board",
    goal: "send the Ironclad Storage vendor request up to finance",
    steps: [
      { expect: [button("Add vendor Ironclad Storage")], act: { click: 'role=button[name="Add vendor Ironclad Storage"] >> nth=0' } },
      { expect: [button("Escalate")], act: { click: 'role=button[name="Escalate"]' } },
      DONE,
    ],
    covers: ["data-kanban", "ambiguity-div-button", "nav-deep-route", "layout-nested-scroll"],
  },
  {
    id: "approvals-open-linked-bill",
    start: "/approvals/apr_00110",
    goal: "where's the actual bill this approval is about",
    steps: [{ expect: [link("Bill INV-22015")], act: { click: 'main >> role=link[name^="Bill INV"]' } }, DONE],
    covers: ["nav-deep-route"],
  },
  {
    id: "approvals-comment",
    start: "/approvals/apr_00110",
    goal: "ask the requester which PO this bill belongs to",
    steps: [
      { expect: [any("Add a comment")], act: { fill: ['role=textbox[name="Add a comment"]', "Which PO is this for?"] } },
      { expect: [button("Post comment")], act: { click: 'role=button[name="Post comment"]' } },
      DONE,
    ],
    covers: ["async-latency"],
  },
  {
    id: "approvals-board-view",
    start: "/",
    goal: "show approvals as a board by stage",
    steps: [
      { expect: [link("Approvals")], act: { click: 'role=link[name^="Approvals"]' } },
      { expect: [any("Board")], act: { click: 'role=radio[name="Board"]' } },
      DONE,
    ],
    covers: ["nav-sidebar", "data-kanban", "layout-horizontal-scroll"],
  },
  {
    id: "approvals-employee-cannot-decide",
    start: "/approvals",
    lab: { role: "employee" },
    goal: "approve Ayla Friesen's reimbursement",
    steps: [{ expect: [] }],
    covers: ["access-role", "ambiguity-disabled-reason", "cant-do"],
    note: "Employees can't decide approvals. Approve and Reject are disabled with a tooltip naming the roles that can.",
  },
];
