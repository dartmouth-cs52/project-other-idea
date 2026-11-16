import { any, button, DONE, type Guide, type GuideSet, type Step } from "../guide.ts";

// Forms on Northpine, the test app in testbed/, served at http://localhost:4200
// with `npm run dev --prefix testbed`. Its site is built with the command in
// testbed/README.md, without --docs, so these are asked as plain guides.
//
// Northpine marks a field that may be left empty with "(optional)" and marks
// nothing on the ones it needs, as most products do. So nothing on the page
// says Department is needed to invite someone, apart from Personal note being
// optional. These guides check that Haptic works that out before it points at
// Send invite, that it reads a form being turned back, and that it does not
// then walk someone through a form that already holds saved values.

/** Every department in the list, and the box that searches it. The question names none, so any of them is a right answer. */
const A_DEPARTMENT = [
  "Search departments…",
  "Executive",
  "Engineering",
  "Platform in Engineering",
  "Mobile in Engineering",
  "Data in Engineering",
  "Sales",
  "Enterprise Sales in Sales",
  "Sales Development in Sales",
  "Marketing",
  "Brand in Marketing",
  "Finance",
  "People",
  "Customer Success",
  "Legal",
].map(any);

const OPEN_INVITE: Step = { expect: [button("Invite people")], act: { click: 'role=button[name="Invite people"]' } };
const DEPARTMENT: Step = { expect: [any("Department")], act: { click: 'role=dialog >> role=combobox[name="Department"]' }, say: "Choose the department they'll join." };
const PICK_ONE: Step = { expect: A_DEPARTMENT, act: { click: "role=option[name=/^Platform/]" }, say: "Pick their department from the list." };
const SEND: Step = { expect: [button("Send invite")], act: { click: 'role=button[name="Send invite"]' } };

const guides: Guide[] = [
  {
    // The question says nothing about a department. After the email, the next step is Department, not Send invite.
    id: "invite",
    start: "/people",
    goal: "how do I invite a new hire",
    steps: [
      OPEN_INVITE,
      { expect: [any("Email address 1")], act: { fill: ['role=textbox[name="Email address 1"]', "jamie.ortiz@northpine.example"] }, say: "Type their email address." },
      DEPARTMENT,
      PICK_ONE,
      SEND,
      DONE,
    ],
  },
  {
    // The visitor types half an address and presses Send invite early. The form turns them back with two messages,
    // and marks the email as invalid. The guide is not over: both fields have to be put right first.
    id: "invite-turned-back",
    start: "/people",
    goal: "invite someone to Northpine",
    steps: [
      OPEN_INVITE,
      { expect: [any("Email address 1")], act: { fill: ['role=textbox[name="Email address 1"]', "cas"] }, say: "Type their email address." },
      { expect: [any("Department")], act: { click: 'role=button[name="Send invite"]' }, say: "Choose the department they'll join." },
      { expect: [any("Email address 1"), any("Department")], act: { fill: ['role=textbox[name="Email address 1"]', "cas.lindgren@northpine.example"] }, say: "Type their full email address." },
      DEPARTMENT,
      PICK_ONE,
      SEND,
      DONE,
    ],
  },
  {
    // A form that already holds saved values, with one field marked optional. Asked to change one thing in it,
    // the guide points at that field and then at Save changes, and leaves Legal name and the address alone.
    id: "company-website",
    // Northpine draws a page's body a moment after its frame. A visitor asks once the form is there, so the wait is switched off.
    start: "/settings/company?lab.latency=none",
    goal: "change our company website",
    steps: [
      { expect: [any("Website")], act: { fill: ['role=textbox[name="Website"]', "https://www.northpine.example/company"] }, say: "Type the new address." },
      { expect: [button("Save changes")], act: { click: 'role=region[name="Unsaved changes"] >> role=button[name="Save changes"]' } },
      DONE,
    ],
  },
];

export default { siteId: "site_testbed", origin: "http://localhost:4200", hasTag: true, guides } satisfies GuideSet;
