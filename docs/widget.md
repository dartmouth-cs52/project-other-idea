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

**What menus show.** When a visitor opens a menu, a tab or an accordion, the widget notes the links and buttons on screen as the control is pressed, waits for the page to settle, and sends what appeared with the control's label, like `Help` opening `Help center → /help; Keyboard shortcuts; What's new; Contact support`. It is watched from the press and not the click, because menus like Radix's open on the press. Nothing a field suggests is sent, since suggestions follow what was typed, and nothing that opens from a table's cells. Each control is sent once per page per tab. The server counts each item by distinct visitor in `outline_openings` (`db/migrations/0012`), the same way as page labels, and adds the items enough visitors saw to the page's `opens`, the field the dashboard's reader and the mapper fill in too. Then two things use it: the site map lists `behind "Help": …` for each page, and on the page the visitor is on, a closed control is listed with what it opens, like `e7 button "Help" (collapsed) [header] opens: Help center → /help; Contact support`. A control in the header, navigation or a sidebar gets what it showed on other pages, as long as that was the same everywhere it was seen. One in the main part of the page gets only its own page's, since "More actions" on two pages can open different things.

**On your own machine.** Without a database, what is learned is kept in `data/learned.json`, which `.gitignore` leaves out, so restarting the server doesn't forget the site. Delete the file to start again.

## Putting the launcher away

A visitor who doesn't want the launcher in the corner can minimize it. A small button with a minus shows on the launcher's corner while the mouse is over it or it has focus, and turns it into a dot. The dot opens up a little to show the pointer when the mouse is over it, and a click brings the launcher back. The choice is kept in the site's `localStorage` as `haptic.minimized`, so it holds on the next page. Where storage is blocked, the launcher is minimized on that page only. `test/browser/minimize.test.ts` covers it in all three browsers.

## Testing in browsers

`npm run test:browser` runs the widget in Chromium, Firefox and WebKit, on small pages made for each test, against a stand-in server that answers each step from a script (`test/browser/harness.ts`). It needs Playwright's browsers once: `npx playwright install chromium firefox webkit`. `BROWSERS=chromium npm run test:browser` runs one.
