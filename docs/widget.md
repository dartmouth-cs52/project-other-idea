# How the widget follows a page

The widget runs on pages it doesn't control. This covers how it keeps up with them: dialogs, controls something else covers, single-page apps that change the address, and how to test it in real browsers. For the project overview, see the [README](../README.md).

## Modal dialogs

A page's modal `<dialog>` makes everything outside it inert, Haptic's own element included. The widget moves its element into the open dialog the moment it opens, shows it again on top, and moves it back out when the dialog closes, so the pointer and the Stop button keep working through nested dialogs too. Escape in Haptic's ask box closes Haptic's panel and not the page's dialog.

## Testing in browsers

`npm run test:browser` runs the widget in Chromium, Firefox and WebKit, on small pages made for each test, against a stand-in server that answers each step from a script (`test/browser/harness.ts`). It needs Playwright's browsers once: `npx playwright install chromium firefox webkit`. `BROWSERS=chromium npm run test:browser` runs one.
