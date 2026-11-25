# Haptic in a Mac app

Haptic on the web reads the page a visitor is on and points at the control to use. `mac/` does the same inside a native Mac app: it reads the app's accessibility tree, sends it to the same server in the same shape, and points at the control in the app's own window. The server, the prompt, the rules, the budget and the dashboard are the ones the web widget uses.

This is a first version. What it does and does not do is listed at the end.

## Try it

You need Xcode's command line tools and a server running from this repo.

```sh
# 1. A site for the demo app, and the server
mkdir -p data/sites && cp mac/demo-site.json data/sites/site_macdemo.json
npm run build && npm run dev

# 2. The demo app, in another terminal
cd mac && swift run HapticDemo
```

Acme Desk opens with an **Ask** button in the corner of its window. Ask "How do I invite a teammate?", "Where do I create an API key?" or "How do I export a usage report?", and follow the pointer. The last one is in the menu bar.

The app asks `http://localhost:4000` unless `HAPTIC_SERVER` says otherwise. `swift run HapticDemo --dump` prints what Haptic reads from each screen and quits. `HAPTIC_DEBUG=1` writes what the guide sees and does to the log.

## Add it to an app

`mac/` is a Swift package, `HapticKit`. Add it to the app and make one call once the app has launched:

```swift
import HapticKit

Haptic.start(site: "site_acme", server: URL(string: "https://your-haptic-server")!)
```

Then list the app among the site's allowed origins, as `app://` and its bundle identifier: `app://com.acme.desk`. A Mac app has no origin of its own, so this is how it names itself, and the server refuses an app the site does not list. In the dashboard it goes where a web origin goes.

| Call | What it does |
|---|---|
| `Haptic.start(site:server:appID:)` | Shows the Ask button. `appID` is the bundle identifier unless given. |
| `Haptic.ask("…")` | Asks a question as if the person had typed it, for a "Show me how" button or a Help menu item. |
| `Haptic.openAsk()` | Opens the box to type a question in. |
| `Haptic.stop()` | Ends the guide that is running. |
| `Haptic.screen = "settings/billing"` | The app's own name for the screen on show. See below. |
| `Haptic.onStep = { step in … }` | Called with every step shown and when a guide ends. |
| `Haptic.snapshotJSON()` | What Haptic reads from the window in front, as the JSON it would send. |

No permission is asked of the person. The Accessibility permission in System Settings is for reading *other* apps, and an app reading its own tree needs none.

## How a window becomes a page

| On the web | In a Mac app |
|---|---|
| The page's path | The screen: the window's title as a path (`/settings`), or `Haptic.screen` |
| Links, buttons, fields | Buttons, checkboxes, pop-up buttons, text fields, tabs, with the web's role names |
| A navigation menu | Rows of a sidebar or a table (`treeitem`, `row`) |
| An open dialog | A sheet or a modal window. Only its controls are listed |
| Nothing like it | The menu bar. Every item is listed with the menu it is in |

An item in a closed menu is listed as `menuitem "Usage Report…" (in the closed Export menu) [menu File › Export]`. When the model points at one, the pointer goes to the menu's title in the menu bar, and moves to the item once the menu is open.

A window's title is a good name for a screen in most apps and a bad one where the title is the person's own, like a document's file name. A window with a document in it is called `/document`. Anywhere else the titles are personal, set `Haptic.screen`.

The site's pages (`pages` in the site's JSON) are the app's screens, written by hand for now: see `mac/demo-site.json`. Nothing crawls a Mac app, and it does not yet send outlines of the screens people visit as the web widget does.

## Privacy

The same promises as the web widget, kept the same way:

- What a person types is never read. A text field is asked for its name and nothing else, and after typing the model is told only that the field was filled in.
- Which choice is picked in a pop-up button is not sent, only that one was.
- Email addresses and long numbers in labels are masked on the device (`Masking.swift`, rule for rule the web's `cleanText`), and again on the server.
- At most 20 rows of any one table are listed.

Haptic only points. It never presses a control in the app.

## How well it reads an app

It reads what the app tells accessibility, so it is as good as the app's accessibility labels. `swift run HapticDemo --dump` and `Haptic.snapshotJSON()` show an app as Haptic sees it, and a control with an empty label there is one to give a label.

- **SwiftUI and AppKit** read well. SwiftUI builds its accessibility tree only once something asks for one, so `Haptic.start` asks, by setting `AXEnhancedUserInterface` on the app, as an assistive app would. Some apps behave a little differently with that set (window animations, mostly). If yours does, that is the line to look at (`LiveTree.wake`).
- A text field with no accessibility label is named from the label beside it, or its placeholder.
- **Electron and other web views** are not read: their tree is the browser's, and the web widget is the way in.
- **Views that draw themselves** (a canvas, a game) show nothing unless they implement accessibility.

## What is not built

- Acting ("do it with me"), Answers' source links, the handoff form and the "did this help?" question.
- Learning screens from visits, and mapping an app by pressing its controls. A native app has nothing like the guard that stops a web page sending a write while the mapper presses buttons, so mapping would need a different safety story.
- Guiding across apps. That needs the Accessibility permission and a separate app, and is a different product.
- A guide does not survive the app being quit, as a web guide survives a page load.

## Tests

```sh
cd mac && swift test
```

The reader is tested on trees written out by hand (`Tests/HapticKitTests`), and `test/app.test.ts` checks that the server lets in an app the site lists and renders what it read.
