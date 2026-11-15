import type { Matcher } from "../cases.ts";
import { button, DONE, link, type Guide, type GuideSet, type Step } from "../guide.ts";

// Moodle's public demo school, "Mount Orange" (school.moodledemo.net), signed in as the demo
// student the login page itself offers (Barbara Gardner). The school and its people are made up
// and the whole site is wiped and rebuilt every hour, on the hour. A guide here may finish what it
// starts, but most stop before the button that saves, so that a second run finds the same pages.

const DASHBOARD = "/my/";
const CULTURES = "/course/view.php?id=59"; // Celebrating Cultures
const CINEMA = "/course/view.php?id=62"; // Psychology in Cinema
const FORUM = "/mod/forum/view.php?id=706"; // "Course discussion" in Psychology in Cinema
const CALENDAR = "/calendar/view.php?view=month";

const menuitem = (label: string): Matcher => ({ label, role: "menuitem" });

/** The visitor's name and picture at the top right. It opens the menu with Profile, Grades, Preferences and Log out. */
const USER_MENU: Step = { expect: [button("User menu")], act: { click: "#user-menu-toggle" }, say: "Click your name at the top right." };
const inUserMenu = (label: string) => `#user-action-menu a:has-text("${label}")`;

/** The new event dialog has two rows of date dropdowns with the same labels: the event's date, then "Until". The first of each is the event's date. */
const DAY: Matcher = { label: "Day", role: "select", nth: 1 };
const MONTH: Matcher = { label: "Month", role: "select", nth: 1 };
const YEAR: Matcher = { label: "Year", role: "select", nth: 1 };
/** The small calendar beside the dropdowns sets the same date. */
const DATE_PICKER: Matcher = { label: "Date picker", role: "button", nth: 1 };

/** A course's card in the dashboard's "Course overview". */
const CULTURES_CARD: Matcher = { label: "Celebrating Cultures", role: "link", context: "Course overview" };

/** The rich-text editors are iframes. These reach the editable body inside. */
const ONLINE_TEXT = "#id_onlinetext_editor_ifr >> internal:control=enter-frame >> body";
const FORUM_MESSAGE = "#id_message_ifr >> internal:control=enter-frame >> body";

/** The messaging drawer, and its "Private" section: one of three buttons the widget lists with a chevron and no label ("Starred", "Group", "Private"). */
const DRAWER = '[data-region="message-drawer"]';
const PRIVATE_SECTION: Matcher = { label: "", role: "button", icon: "chevron-right", nth: 3 };

/** The bell beside the visitor's name. It only opens a list of notifications. */
const BELL = '.popover-region-notifications [data-region="popover-region-toggle"]';

const guides: Guide[] = [
  // Two page loads, then the form. The text box is a rich-text editor inside an iframe.
  {
    id: "hand-in-assignment",
    start: CULTURES,
    goal: "I have to hand something in for the View from your window task. I only want to write a few lines, no photo. Where do I do that?",
    steps: [
      { expect: [link("(Mobile assignment) View from your window")], act: { click: '#region-main a:has-text("(Mobile assignment) View from your window")' } },
      { expect: [button("Add submission")], act: { click: '#region-main button:has-text("Add submission")' } },
      {
        expect: [{ label: "Online text", role: "textbox" }],
        act: { fill: [ONLINE_TEXT, "From my window I can see a made-up street with two trees and a bus stop."] },
        say: "Type your text here.",
      },
    ],
    reached: { url: "action=editsubmission", selector: `${ONLINE_TEXT}:has-text("made-up street")` },
  },
  // A form that opens in the page, with a rich-text editor in an iframe, and a button that posts.
  // It starts in the forum: reached by a click from the course page, the forum's own scripts are
  // not yet running when the recorder clicks "Add discussion topic", and the form does not open.
  {
    id: "forum-new-topic",
    start: FORUM,
    goal: "I want to ask the rest of the class a question about one of the films. How do I start a new thread here?",
    steps: [
      { expect: [link("Add discussion topic")], act: { click: '#region-main a:has-text("Add discussion topic")' } },
      { expect: [{ label: "Subject", role: "textbox" }], act: { fill: ["#id_subject", "Test question about the films"] }, say: "Type a subject for your question." },
      // The message is required. Its editor is an iframe, and the widget lists only the editor's toolbar.
      {
        expect: [{ label: "Message", role: "textbox" }],
        unlisted: true,
        act: { fill: [FORUM_MESSAGE, "This is a made-up question for a test: which of the three films did you find hardest to watch?"] },
      },
      { expect: [button("Post to forum")], act: { click: "#id_submitbutton" } },
      DONE,
    ],
    // The notice is shown once, on the page that loads after posting.
    reached: { url: "/mod/forum/view\\.php", selector: '.alert-success:has-text("Post added.")' },
  },
  // Two page loads to a button that starts an attempt. Starting one would leave "Continue your attempt" for the next run.
  {
    id: "start-quiz",
    start: DASHBOARD,
    goal: "I'm ready to take the geography quiz in Celebrating Cultures. Where do I begin?",
    steps: [
      {
        // The course is on the dashboard, and "My courses" lists it too.
        expect: [CULTURES_CARD, menuitem("My courses")],
        point: CULTURES_CARD,
        act: { click: '.block_myoverview a:has-text("Celebrating Cultures")' },
      },
      { expect: [link("Quiz: Know your Geography!")], act: { click: '#region-main a:has-text("Quiz: Know your Geography!")' } },
      { expect: [button("Attempt quiz")] },
    ],
  },
  // Asked in Spanish: "What mark did I get in the Factual recall test of Psychology in Cinema?"
  {
    id: "quiz-grade",
    kind: "awkward",
    start: DASHBOARD,
    goal: "¿Qué nota saqué en el Factual recall test de Psicología en el cine?",
    steps: [
      { ...USER_MENU, expect: [button("User menu"), { label: "Psychology in Cinema", role: "link", context: "Course overview" }], point: button("User menu") },
      { expect: [menuitem("Grades")], act: { click: inUserMenu("Grades") } },
      { expect: [link("Psychology in Cinema")], act: { click: '#region-main a:has-text("Psychology in Cinema")' } },
      DONE,
    ],
    reached: { url: "course/user\\.php\\?mode=grade&id=62|grade/report/user/index\\.php\\?id=62", text: "Factual recall test" },
  },
  // A dialog with a form: a text field and two rows of date dropdowns that share their labels.
  {
    id: "calendar-event",
    start: CALENDAR,
    goal: "My study group meets on 3 March 2027. How do I put that in my calendar here?",
    steps: [
      { expect: [button("New event")], act: { click: '#region-main button:has-text("New event")' } },
      {
        expect: [{ label: "Event title", role: "textbox" }, DAY, MONTH, YEAR, DATE_PICKER],
        point: { label: "Event title", role: "textbox" },
        act: { fill: ["#id_name", "Study group"] },
        say: "Type a name for the event.",
      },
      { expect: [DAY, MONTH, YEAR, DATE_PICKER], point: DAY, act: { select: ["#id_timestart_day", "3"] }, say: "Pick the day." },
      { expect: [MONTH, YEAR, DATE_PICKER], point: MONTH, act: { select: ["#id_timestart_month", "March"] }, say: "Pick the month." },
      { expect: [YEAR, DATE_PICKER], point: YEAR, act: { select: ["#id_timestart_year", "2027"] }, say: "Pick the year." },
      // Saving would leave the event on the calendar for the next run.
      { expect: [button("Save")] },
    ],
  },
  // A drawer behind a button with no words, then three sections whose buttons the widget lists
  // with no label. The guide ends where the conversation opens: with the drawer open the page
  // takes the keyboard back from the widget's own box, so a visitor cannot ask again from there.
  {
    id: "message-tutor",
    start: CINEMA,
    goal: "I want to send my tutor Jeffrey Sanders another message, we've written to each other before. Where do I do that?",
    steps: [
      // "Messages" in the user menu opens the same conversations as a page.
      {
        expect: [button("Toggle messaging drawer"), button("User menu")],
        point: button("Toggle messaging drawer"),
        act: { click: '[id^="message-drawer-toggle"]' },
        say: "Click the speech bubble at the top right.",
      },
      // Their earlier conversation is under "Private". Searching for his name finds him too.
      {
        expect: [PRIVATE_SECTION, { label: "Search", role: "textbox", context: "Messaging" }],
        point: PRIVATE_SECTION,
        act: { click: `${DRAWER} button:has-text("Private")` },
        say: "Open the third section, Private.",
      },
      // The section's conversations are fetched when it opens, and the widget nearly always reads the
      // drawer before they arrive. The visitor sees his name a moment later and clicks it unprompted.
      { expect: [button("Jeffrey Sanders")], unlisted: true, act: { click: `${DRAWER} a:has-text("Jeffrey Sanders")` } },
    ],
    // The box to write in.
    reached: { selector: `${DRAWER} textarea[data-region="send-message-txt"]` },
  },
  // Settings two levels down, then a table of switches with one row for each kind of notification. Asked with typos.
  {
    id: "forum-emails-off",
    kind: "awkward",
    start: DASHBOARD,
    goal: "how do i stop geting an emial evry time somone posts in a forum im subscribed to?? i still want to see them on the site",
    steps: [
      USER_MENU,
      { expect: [menuitem("Preferences")], act: { click: inUserMenu("Preferences") } },
      { expect: [link("Notification preferences")], act: { click: '#region-main a:has-text("Notification preferences")' } },
      // A switch that saves as soon as it is used. Using it would turn the emails back on in the next run.
      { expect: [{ label: 'Sending "Subscribed forum posts" via "Email" enabled status', role: "checkbox" }] },
    ],
  },
  // The visitor is pointed at their name and clicks the bell beside it, which only opens a list of
  // notifications. Their name is still in view and can be clicked straight away, but with the list
  // open the widget lists nothing outside it, so the list's own "Close" is the way back it can show.
  {
    id: "log-out-wrong-click",
    kind: "wrong-click",
    start: CINEMA,
    goal: "I'm on a shared computer in the library. How do I sign out of this?",
    steps: [
      { expect: [button("User menu")], act: { click: BELL } },
      {
        expect: [button("User menu"), button("Close")],
        act: { click: '[data-action="close-notification-popover"]' },
        say: "Not that one. Close this list, then click your name at the top right.",
        sayStartsWith: "Not that one.",
      },
      USER_MENU,
      // The guide ends on this click. Logging out answers with a redirect, the widget asks for a step
      // from the page being left, and two times in three it then has no guide left on the page that
      // loads, so a closing "done" from there cannot be recorded steadily.
      { expect: [menuitem("Log out")], act: { click: inUserMenu("Log out") } },
    ],
    reached: { selector: '.usermenu a:has-text("Log in"), .login a:has-text("Log in")' },
  },
  // A school's learning platform has no fee payments.
  { id: "no-such-feature", kind: "no-answer", start: DASHBOARD, goal: "How do I pay my tuition fees with a credit card?", steps: [DONE] },
  // Stops at the button that confirms the removal. It is never pressed.
  {
    id: "remove-submission",
    kind: "risky",
    start: CULTURES,
    goal: "I handed in the wrong recording for Languages of Love. How do I take it back completely, so that nothing is handed in?",
    steps: [
      { expect: [link("Assignment: Languages of Love")], act: { click: '#region-main a:has-text("Assignment: Languages of Love")' } },
      { expect: [button("Remove submission")], act: { click: '#region-main button:has-text("Remove submission")' } },
      { expect: [button("Continue")] },
    ],
  },
];

export default {
  siteId: "site_bench_moodle",
  origin: "https://school.moodledemo.net",
  hasTag: false,
  about: "Moodle's public demo school, Mount Orange: a learning-management system (courses, assignments, quizzes, forums, grades, calendar, messages), standing for the learning and training systems large organisations run for their staff.",
  before: {
    path: "/login/index.php",
    acts: [{ fill: ["#username", "student"] }, { fill: ["#password", "moodle26"] }, { click: "#loginbtn" }],
  },
  sandbox: true,
  heldOut: true,
  guides,
} satisfies GuideSet;
