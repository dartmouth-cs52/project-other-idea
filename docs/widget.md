# How the widget follows a page

The widget runs on pages it doesn't control. This covers how it keeps up with them: dialogs, controls something else covers, single-page apps that change the address, what it learns about a site from visits, and how to test it in real browsers. For the project overview, see the [README](../README.md).

## Modal dialogs

A page's modal `<dialog>` makes everything outside it inert, Haptic's own element included. The widget moves its element into the open dialog the moment it opens, shows it again on top, and moves it back out when the dialog closes, so the pointer and the Stop button keep working through nested dialogs too. Escape in Haptic's ask box closes Haptic's panel and not the page's dialog.

## Covered controls

A control on screen that something else covers, like a button under a stack of cards or the page behind a full-screen overlay, is left out of the snapshot, because a visitor can't click it. The browser's own hit test decides (`src/widget/occlusion.ts`). A control only scrolled out of its scroll box stays in, and so does one under a sticky header, since pointing scrolls it to the middle of the screen.

## Route changes

Single-page apps change the address without loading a page, so the widget watches for it itself: through the browser's Navigation API, or by looking at the address every tenth of a second in a browser without it, and never by changing the page's own `history` (`src/widget/navigation.ts`). If the address changes while the model is answering, the answer is about a page the visitor has left, like the page they were on when they clicked something that took a moment to load. The widget hangs up at once and asks again from the new page, and the server stops the model call and counts the dropped step on the guide (`cancelled_steps`). An app that changes the address first and draws the page a moment later is waited for: a new address over the same controls as before has not been drawn yet.

## Learning the site from visits

The crawl builds the first map of a site, but it can't sign in, and it can't open what only a click reveals. So the widget also sends an outline of each page it loads on, once per page per tab, when the page has settled and the browser is idle (`src/widget/learn.ts`): the title, headings, and the labels of its links and buttons, with an icon-only button named by its icon, like `icon:share-2`. When a click is followed by a new page within eight seconds, it sends the clicked label as a link on the page the click came from, like "View, in a dialog → /set/:id", which is how Haptic learns a page that only a dialog leads to. Labels only: never what is typed into a field, never what is in a table's cells, and a label holding an email address or a long number is dropped whole.

Each label is counted by distinct visitor (`src/server/learned.ts`). The widget keeps a random id in the site's `localStorage`, and the server keeps only a hash of it made with the site's id, up to ten per label, in `outline_labels`. A browser that keeps no storage has no id, and what it sends is not used: a hash of a network address could be turned back into the address. A label reaches the prompt only once enough different visitors have seen it: 3 online, 1 on your own machine, or `HAPTIC_LABEL_THRESHOLD`. That keeps one person's own data, like the name of their project, out of everyone's prompt. What is learned is merged with the crawl's pages when a site is read from the database, so a step never waits on it. The crawl's pages come first, pages only traffic knows follow, navigation that is on most pages is listed once, and each page lists at most 24 buttons. Learned labels are listed in a fixed order, so a count going up does not change the prompt the model provider keeps cached. A site whose context has `"learn": false` sends no outlines.

## Mapping the signed-in app

The reader at signup can't sign in, and learning from visits needs traffic. So someone at the company can show Haptic their app in a few minutes, from the dashboard: **Start mapping** opens their app in a new tab, and the widget there goes through it by itself (`src/widget/map.ts`).

On each page it notes the labels, then presses each button, tab and menu to see what it does, notes that, closes it, and goes on to the next page. What it sends is a page of the site map: its links, buttons and fields, a link for each button that led to another page, and for each menu, tab and dialog what it showed (`opens`, with a dialog's fields). These go straight into the site's pages, marked `mapped`, because they come with a pass only the dashboard hands out. Nothing waits for three visitors.

**The pass.** The dashboard makes a random pass, keeps its hash in the site's context (`mapping`), and puts the pass after the `#` of the link, where the company's server never sees it. The widget takes it out of the address at once and keeps it in `sessionStorage` for that tab. It works for two hours, only from an origin the site allows, and the server checks it on every page sent (`POST /v1/map`). A pass the server refuses shows nothing that can be started, so a made-up link does nothing to a visitor. A good one only shows a panel: nothing is pressed until the person presses Start in that tab.

**What it won't press.** Anything in a form or a table's cells, switches and checkboxes, fields, anything inside the dialog or menu it just opened, a control the company ruled out, and any control whose words say it signs out, deletes or pays. Words like Save, Send, Invite or Export are skipped too, unless the control itself says it only opens something (`aria-haspopup`, `aria-expanded`, a tab). Links are not pressed at all: their addresses are collected and each page is opened with a plain page load, and a link that says it signs out or deletes is never opened.

**The guard.** While it presses a button, the page can send nothing but a read: `fetch`, `XMLHttpRequest`, beacons, web sockets and form submissions are stopped, and `confirm` answers no (`src/widget/guard.ts`). This is a second line, not a guarantee. Code that kept its own copy of `fetch` before the mapper loaded is not stopped, which is why the dashboard suggests a test account. A side effect: an app that reads its data with POST, as GraphQL does, shows less behind its tabs and menus while mapping.

**Limits.** 40 pages a run, 24 presses a page, and a site holds 80 pages in all. Addresses that differ only by an id are one page, so one order stands for `/orders/:id`. A control that did the same thing on two pages is not pressed on the rest. Apps that route with the `#` part of the address are one page to it. The mapper is its own file, `/map.js`, fetched only in a tab that holds a pass, so `widget.js` is no bigger for visitors.

To try it on your own machine without the dashboard, start the server with `HAPTIC_MAP_PASS` set to 48 hex characters and open `http://localhost:4000/demo/#haptic-map=<the same 48 characters>`. The pages go into the site's file in `data/sites`.

## Testing in browsers

`npm run test:browser` runs the widget in Chromium, Firefox and WebKit, on small pages made for each test, against a stand-in server that answers each step from a script (`test/browser/harness.ts`). It needs Playwright's browsers once: `npx playwright install chromium firefox webkit`. `BROWSERS=chromium npm run test:browser` runs one.
