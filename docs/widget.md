# How the widget follows a page

The widget runs on pages it doesn't control. This covers how it keeps up with them: dialogs, controls something else covers, single-page apps that change the address, and how to test it in real browsers. For the project overview, see the [README](../README.md).

## Modal dialogs

A page's modal `<dialog>` makes everything outside it inert, Haptic's own element included. The widget moves its element into the open dialog the moment it opens, shows it again on top, and moves it back out when the dialog closes, so the pointer and the Stop button keep working through nested dialogs too. Escape in Haptic's ask box closes Haptic's panel and not the page's dialog.

## Covered controls

A control on screen that something else covers, like a button under a stack of cards or the page behind a full-screen overlay, is left out of the snapshot, because a visitor can't click it. The browser's own hit test decides (`src/widget/occlusion.ts`). A control only scrolled out of its scroll box stays in, and so does one under a sticky header, since pointing scrolls it to the middle of the screen.

## Route changes

Single-page apps change the address without loading a page, so the widget watches for it itself: through the browser's Navigation API, or by looking at the address every tenth of a second in a browser without it, and never by changing the page's own `history` (`src/widget/navigation.ts`). If the address changes while the model is answering, the answer is about a page the visitor has left, like the page they were on when they clicked something that took a moment to load. The widget hangs up at once and asks again from the new page, and the server stops the model call and counts the dropped step on the guide (`cancelled_steps`). An app that changes the address first and draws the page a moment later is waited for: a new address over the same controls as before has not been drawn yet.

## Testing in browsers

`npm run test:browser` runs the widget in Chromium, Firefox and WebKit, on small pages made for each test, against a stand-in server that answers each step from a script (`test/browser/harness.ts`). It needs Playwright's browsers once: `npx playwright install chromium firefox webkit`. `BROWSERS=chromium npm run test:browser` runs one.
