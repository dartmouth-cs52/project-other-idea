import AppKit
import HapticKit

// Follows the pointer by itself, so a whole guide can be tried from a script
// with nobody at the keyboard: HAPTIC_AUTOPILOT=1 with HAPTIC_ASK or
// HAPTIC_TASK set. It stands in for the person, not for Haptic, which never
// presses anything. Every click is made inside this app, and the real mouse
// and keyboard are left alone.
//
// What it does at each step is what the step says and nothing more: it goes
// where the pointer is. So a guide that points at the wrong thing fails here
// as it would with a person who trusts it.

@MainActor
enum Autopilot {
    static let maxSteps = 16
    private static var steps = 0
    private static var task: GuideTask?

    /** The menu a button opened, which holds the mouse until something in it is chosen. */
    private static var openMenu: NSMenu?

    static func start(task: GuideTask? = nil) {
        self.task = task
        NotificationCenter.default.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil) { note in
            let menu = note.object as? NSMenu
            MainActor.assumeIsolated { if menu !== NSApp.mainMenu, menu?.supermenu == nil { openMenu = menu } }
        }
        NotificationCenter.default.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: nil) { _ in
            MainActor.assumeIsolated { openMenu = nil }
        }
        Haptic.onStep = { step in
            let at = step.frame.map { "(\(Int($0.minX)), \(Int($0.minY)), \(Int($0.width))x\(Int($0.height)))" } ?? "nowhere"
            print("STEP [\(step.outcome ?? (step.last ? "last" : "continue"))] \(step.role ?? "-") \"\(step.label ?? "")\" at \(at): \(step.say)")
            fflush(stdout)
            if step.outcome != nil { return finish(step.outcome ?? "") }
            steps += 1
            if steps > maxSteps { return finish("too_many_steps") }
            // In the common modes, so the pointer is followed while a menu is open too.
            let timer = Timer(timeInterval: 1.3, repeats: false) { _ in MainActor.assumeIsolated { follow(step) } }
            RunLoop.main.add(timer, forMode: .common)
        }
    }

    private static func finish(_ outcome: String) {
        // A moment for the last click to land before the app is asked what it did.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            if let task, let store = Store.shared {
                // Done, and Haptic knew it was: a guide that gave up or went round in circles has not helped, wherever the app ended up.
                let done = task.done(store) && (outcome == "finished" || outcome == "shown")
                print("TASK \(task.id) \(done ? "PASS" : "FAIL") outcome=\(outcome) steps=\(steps)")
            }
            fflush(stdout)
            NSApp.terminate(nil)
        }
    }

    private static func follow(_ step: HapticStep) {
        guard let label = step.label, let role = step.role else { return }
        if role == "menuitem" || role == "menu" {
            // An item of a menu a button opened: the menu is shut and the item chosen as a click on it would choose it.
            if let open = openMenu, let (menu, index) = find(label, in: open) {
                open.cancelTrackingWithoutAnimation()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { menu.performActionForItem(at: index) }
                return
            }
            // The menu bar belongs to the system, so the item is chosen as a keyboard shortcut would choose it.
            if let (menu, index) = find(label, in: NSApp.mainMenu) { menu.performActionForItem(at: index) }
            return
        }
        guard let frame = step.frame else { return }
        let point = CGPoint(x: frame.midX, y: frame.midY)
        guard let window = window(at: point) else { return print("AUTOPILOT: no window at \(point)") }
        let view = window.contentView?.hitTest(window.contentView?.convert(window.convertPoint(fromScreen: point), from: nil) ?? .zero)

        switch role {
        case "treeitem", "row":
            // A click made up by a script does not select a row, so the row is selected as the arrow keys would select it.
            if let table = enclosing(NSTableView.self, of: view) {
                let row = table.row(at: table.convert(window.convertPoint(fromScreen: point), from: nil))
                if row >= 0 { table.selectRowIndexes([row], byExtendingSelection: false) }
            }
            click(point, in: window)
        case "select":
            // A pop-up's list is the system's to run. The next choice is made as the list would make it, and said as the system says it.
            // The click opens the list, as a person's would, so Haptic sees the pop-up being used. The list is the system's
            // to run and would wait there for a person, so it is shut again and the next choice made as the list makes it.
            guard let popup = enclosing(NSPopUpButton.self, of: view) ?? find(NSPopUpButton.self, at: frame, in: window.contentView), popup.numberOfItems > 1 else {
                return print("AUTOPILOT: no pop-up button found at \(label)")
            }
            let choose = Timer(timeInterval: 0.5, repeats: false) { _ in
                MainActor.assumeIsolated {
                    popup.menu?.cancelTrackingWithoutAnimation()
                    let next = (popup.indexOfSelectedItem + 1) % popup.numberOfItems
                    popup.selectItem(at: next)
                    if let action = popup.action { NSApp.sendAction(action, to: popup.target, from: popup) }
                    if let item = popup.selectedItem, let menu = popup.menu {
                        NotificationCenter.default.post(name: NSMenu.didSendActionNotification, object: menu, userInfo: ["MenuItem": item])
                    }
                }
            }
            // In the common modes, so it fires while the list is open.
            RunLoop.main.add(choose, forMode: .common)
            click(point, in: window)
        case "textbox", "searchbox", "combobox":
            click(point, in: window)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { typeText(words(for: label), into: enclosing(NSTextField.self, of: view), in: window) }
        default:
            click(point, in: window)
        }
    }

    /** Something sensible to type into a field, going by what the field is called. */
    static func words(for label: String) -> String {
        let name = label.lowercased()
        if name.contains("email") { return "sam@acme.test" }
        if name.contains("amount") || name.contains("limit") || name.contains("dollars") { return "250" }
        if name.contains("postcode") { return "10001" }
        if name.contains("number") { return "7150" }
        if name.contains("search") || name.contains("command") { return "budgets" }
        if name.contains("password") { return "correct-horse" }
        if name.contains("name") || name.contains("title") { return "Team lunches" }
        return "Client offsite"
    }

    private static func find(_ title: String, in menu: NSMenu?) -> (NSMenu, Int)? {
        guard let menu else { return nil }
        for (index, item) in menu.items.enumerated() {
            if item.title == title, item.submenu == nil { return (menu, index) }
            if let found = find(title, in: item.submenu) { return found }
        }
        return nil
    }

    private static func window(at point: CGPoint) -> NSWindow? {
        NSApp.orderedWindows.first { $0.isVisible && $0.frame.contains(point) && !$0.ignoresMouseEvents && !String(describing: type(of: $0)).contains("Haptic") }
    }

    private static func enclosing<V: NSView>(_ kind: V.Type, of view: NSView?) -> V? {
        var at = view
        while let current = at {
            if let found = current as? V { return found }
            at = current.superview
        }
        return nil
    }

    /** The view of a kind whose place on screen is closest to a frame. */
    private static func find<V: NSView>(_ kind: V.Type, at frame: CGRect, in view: NSView?) -> V? {
        var best: (V, CGFloat)?
        func look(_ view: NSView) {
            if let found = view as? V, let window = view.window {
                let on = window.convertToScreen(view.convert(view.bounds, to: nil))
                let apart = abs(on.midX - frame.midX) + abs(on.midY - frame.midY)
                if on.intersects(frame), best == nil || apart < best!.1 { best = (found, apart) }
            }
            view.subviews.forEach(look)
        }
        if let view { look(view) }
        return best?.0
    }

    private static func click(_ point: CGPoint, in window: NSWindow) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: window.convertPoint(fromScreen: point), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
            if let event { NSApp.postEvent(event, atStart: false) }
        }
    }

    private static func typeText(_ text: String, into field: NSTextField?, in window: NSWindow) {
        // A made-up click does not move the keyboard, so the field is given it here, as the person's click would.
        window.makeKey()
        if let field { window.makeFirstResponder(field) }
        for character in text {
            let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, characters: String(character), charactersIgnoringModifiers: String(character), isARepeat: false, keyCode: 0)
            if let event { NSApp.postEvent(event, atStart: false) }
        }
    }
}
