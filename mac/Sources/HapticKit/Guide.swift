import AppKit

// One question, from the asking to the end. Each step: read the window, ask
// the server, point at the control it names, and wait for the person to use
// it. Then read the window again and ask for the next one. The same loop as
// the web widget's (src/widget/guide.ts), with a window where it has a page.
//
// Haptic only points. It never presses anything in the app, and it never
// reads what is typed: a field that was typed in is reported as filled in,
// and no more.

@MainActor
final class Guide {
    static let maxSteps = 20
    /** A closing question looks at what the last click did. After this many, the guide ends without asking again. */
    static let maxClosings = 2

    private let client: Client
    private let stage: Stage
    private let blocked: [ControlName]
    private let visitor: String
    private let screenName: () -> String?

    private var goal = ""
    private var own = Set<String>()
    private var guideID = ""
    private var step = 0
    private var history: [HistoryTurn] = []
    private var reading: Reading?
    /** The control on show, and whether the model called it the last step. */
    private var pointed: (item: Listed, last: Bool)?
    private var closings = 0
    private var followed = 0
    private var strayed = false
    private var repeats = 0
    /** Steps in a row that had more to do and nothing to point at. */
    private var waits = 0
    /** Times the window changed with no click or key of the person's that Haptic saw. Kept low, so a screen that never rests can't ask without end. */
    private var unprompted = 0
    private var changeWatch: Timer?
    private var lookPending = false
    private var lastKey = ""
    /** Raised whenever the guide moves on, so an answer or a timer from before is dropped. */
    private var run = 0
    private var asking: Task<Void, Never>?
    private var looking: Task<Void, Never>?
    private var monitors: [Any] = []
    private var observers: [NSObjectProtocol] = []
    /** What the mouse went down on, kept until it comes up. */
    private var pressed: Listed?
    private var typing: Task<Void, Never>?
    /** The pop-up button whose list of choices is open. */
    private var picking: Listed?
    private static let typedInto: Set<String> = ["textbox", "searchbox", "combobox"]
    var isRunning: Bool { !guideID.isEmpty }
    var onStep: ((HapticStep) -> Void)?

    init(client: Client, stage: Stage, blocked: [ControlName], visitor: String, screenName: @escaping () -> String?) {
        self.client = client
        self.stage = stage
        self.blocked = blocked
        self.visitor = visitor
        self.screenName = screenName
    }

    /** With HAPTIC_DEBUG set, what the guide sees and does is written to the log, for whoever is fitting it to an app. */
    private static let debugging = ProcessInfo.processInfo.environment["HAPTIC_DEBUG"] != nil
    private func log(_ message: @autoclosure () -> String) {
        if Self.debugging { FileHandle.standardError.write(Data(("Haptic: " + message() + "\n").utf8)) }
    }

    func ask(_ question: String) {
        stop()
        goal = Masking.clean(question, max: 450, own: Masking.named(in: question))
        own = Masking.named(in: question)
        guideID = UUID().uuidString.lowercased()
        step = 0
        history = []
        closings = 0
        followed = 0
        strayed = false
        repeats = 0
        waits = 0
        unprompted = 0
        lastKey = ""
        watch()
        turn(event: nil)
    }

    /** The person called it off. */
    func stop() {
        guard isRunning else { stage.clear(); return }
        end(outcome: "stopped", say: nil)
    }

    // Asking ---------------------------------------------------------------------

    private func read() -> Reading? {
        guard let screen = LiveTree.screen(named: screenName()) else { return nil }
        var reader = Reader(own: own)
        return reader.read(screen)
    }

    private func turn(event: String?, closing: Bool = false) {
        run += 1
        let run = self.run
        asking?.cancel()
        looking?.cancel()
        lookPending = false
        guard step < Self.maxSteps else { return end(outcome: "step_limit", say: "That's as far as I can take this one. Ask again to keep going.") }
        guard let reading = read() else { return end(outcome: "error", say: "I can't see a window to help with.") }

        var told = event
        if let before = self.reading?.snapshot.path, before != reading.snapshot.path {
            told = [event, "The user went from \(before) to \(reading.snapshot.path)."].compactMap { $0 }.joined(separator: " ")
        }
        self.reading = reading
        let wasPointed = pointed
        pointed = nil
        stage.unpoint()
        stage.say(strayed ? "Finding the way back" : closing ? "Checking" : "Thinking", busy: true)

        log("asking step \(step) on \(reading.snapshot.path)\(reading.snapshot.dialog.map { " dialog \"\($0)\"" } ?? ""), \(reading.snapshot.elements.count) controls. \(told ?? "")")
        var request = TurnRequest(site: client.site, visitor: visitor, guide: guideID, today: Self.today(), goal: goal, step: step, history: Array(history.suffix(12)), snapshot: reading.snapshot)
        if let told { request.event = told }
        if strayed { request.offTrack = true }
        if closing { request.closing = true }

        asking = Task { [weak self] in
            guard let self else { return }
            do {
                let reply = try await self.client.turn(request) { id in
                    // The control is named before the sentence is written, and the pointer goes there at once.
                    guard run == self.run, let item = reading.listed[id], !self.isBlocked(item) else { return }
                    self.stage.point { Self.frame(of: item) }
                }
                guard run == self.run else { return }
                self.heard(reply, reading: reading, did: told, closing: closing, before: wasPointed)
            } catch is CancellationError {
                return
            } catch {
                guard run == self.run else { return }
                let said = (error as? ServerError)?.status == 429 ? "Too many questions at once. Try again in a minute." : "Something went wrong. Try asking again."
                self.end(outcome: "error", say: said)
            }
        }
    }

    private func heard(_ reply: TurnReply, reading: Reading, did: String?, closing: Bool, before: (item: Listed, last: Bool)?) {
        history.append(HistoryTurn(role: "user", text: step == 0 ? goal : (did ?? "The user carried on.")))
        history.append(HistoryTurn(role: "assistant", text: reply.say))
        let answered = step
        step += 1
        strayed = false

        if reply.paused == true { return end(outcome: nil, say: reply.say) }
        let item = reply.target.flatMap { reading.listed[$0] }
        if reply.blocked == true || item.map(isBlocked) == true {
            return end(outcome: "blocked", say: reply.blocked == true ? reply.say : "I can't help with that here.", step: answered)
        }
        if reply.mode == "cannot_help" { return end(outcome: reply.reason ?? "not_covered", say: reply.say, step: answered) }
        if reply.status == "stuck" { return end(outcome: "nothing_to_point_at", say: reply.say, step: answered) }

        guard let item else {
            if reply.status == "continue" {
                // More to do and nothing to point at: the window was caught between two screens. Look once more before giving up.
                guard waits < 2 else { return end(outcome: "nothing_to_point_at", say: reply.say, step: answered) }
                waits += 1
                stage.say(reply.say)
                let run = self.run
                looking = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    guard let self, run == self.run, !Task.isCancelled else { return }
                    self.turn(event: "The window has had a moment to finish changing. Look at it as it is now.")
                }
                return
            }
            // Done, with nothing more to use.
            let outcome = reply.mode == "answer" ? "answered" : (followed > 0 || closing ? "finished" : "shown")
            return end(outcome: outcome, say: reply.say, step: answered)
        }

        // The same control again, on a screen that has not changed, is a guide going round in circles.
        let key = describe(item.element) + "\n" + reading.signature
        repeats = key == lastKey ? repeats + 1 : 0
        lastKey = key
        if repeats >= 2 { return end(outcome: "loop", say: "I keep coming back to the same place, so I'll stop here. Try asking another way.", step: answered) }

        waits = 0
        pointed = (item, reply.status == "done")
        if item.element.offscreen != nil { item.node.scrollToVisible() }
        stage.point { Self.frame(of: item) }
        stage.say(reply.say)
        log("pointing at \(describe(item.element)): \(reply.say)")
        onStep?(HapticStep(say: reply.say, role: item.element.role, label: item.element.label, frame: Self.frame(of: item), last: reply.status == "done"))
    }

    private func isBlocked(_ item: Listed) -> Bool {
        blocked.contains { $0.matches(item.element) }
    }

    /**
     * Where to point for a control. For an item in a menu that is closed, that
     * is the title that opens the menu, and once the menu is open, the item.
     */
    static func frame(of item: Listed) -> CGRect? {
        let own = item.node.frame
        if !own.isEmpty { return own }
        for opener in item.openers.reversed() {
            let frame = opener.frame
            if !frame.isEmpty { return frame }
        }
        return nil
    }

    private static func today() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    // Ending ---------------------------------------------------------------------

    private func end(outcome: String?, say: String?, step answered: Int? = nil) {
        run += 1
        asking?.cancel()
        looking?.cancel()
        typing?.cancel()
        unwatch()
        if let outcome, !guideID.isEmpty { client.report(guide: guideID, outcome: outcome, step: answered ?? (step > 0 ? step - 1 : nil)) }
        guideID = ""
        pointed = nil
        reading = nil
        stage.unpoint()
        onStep?(HapticStep(say: say ?? "", role: nil, label: nil, frame: nil, last: true, outcome: outcome ?? "paused"))
        guard let say else { return stage.clear() }
        stage.say(say)
        // The last sentence stays long enough to read, and then gets out of the way.
        let run = self.run
        looking = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 12_000_000_000)
            guard let self, run == self.run, !Task.isCancelled else { return }
            self.stage.clear()
        }
    }

    // Watching what the person does --------------------------------------------------

    private func watch() {
        unwatch()
        let mouse = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp]) { [weak self] event in
            MainActor.assumeIsolated { self?.onMouse(event) }
            return event
        }
        let keys = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
            MainActor.assumeIsolated { self?.onKey(event) }
            return event
        }
        monitors = [mouse, keys].compactMap { $0 }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkForChange() }
        }
        RunLoop.main.add(timer, forMode: .default)
        changeWatch = timer
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: NSMenu.didBeginTrackingNotification, object: nil, queue: nil) { [weak self] note in
                let menu = note.object as? NSMenu
                MainActor.assumeIsolated {
                    LiveTree.trackedMenu = menu
                    self?.onMenuOpened(menu)
                }
            },
            center.addObserver(forName: NSMenu.didEndTrackingNotification, object: nil, queue: nil) { _ in
                MainActor.assumeIsolated { LiveTree.trackedMenu = nil }
            },
            center.addObserver(forName: NSMenu.didSendActionNotification, object: nil, queue: nil) { [weak self] note in
                let item = note.userInfo?["MenuItem"] as? NSMenuItem
                MainActor.assumeIsolated { self?.onMenu(item) }
            },
        ]
    }

    /**
     * A keyboard shortcut, a toolbar's own menu or the app itself can change
     * the screen with no click that Haptic saw. So while a pointer is on show
     * the window is looked at once a second, and a screen that has changed is
     * asked about like any other.
     */
    private func checkForChange() {
        guard isRunning, pointed != nil, unprompted < 6, LiveTree.trackedMenu == nil, let before = reading?.signature else { return }
        guard let now = read()?.signature, now != before else { return }
        unprompted += 1
        log("the window changed by itself")
        look(event: nil, on: nil)
    }

    private func unwatch() {
        changeWatch?.invalidate()
        changeWatch = nil
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        observers.forEach(NotificationCenter.default.removeObserver)
        observers = []
        LiveTree.trackedMenu = nil
        pressed = nil
        picking = nil
    }

    private func onMouse(_ event: NSEvent) {
        guard isRunning, !(event.window is HapticWindow) else { return }
        if event.type == .leftMouseDown {
            // Found now, while it is still there: the click may close the sheet it is in.
            let point = event.window.map { $0.convertPoint(toScreen: event.locationInWindow) } ?? NSEvent.mouseLocation
            pressed = reading?.element(at: point)
            return
        }
        let item = pressed
        pressed = nil
        log("click on \(item.map { describe($0.element) } ?? "nothing listed")")
        // A click on a menu's title only opens it. The pointer moves to the item by itself, and nothing needs asking.
        if let item, item.element.role == "menu" { return }
        // Clicking into a field is not yet using it. The step moves on once something is typed there.
        if let item, Self.typedInto.contains(item.element.role) { return }
        // A pop-up button opens its list of choices. The step moves on when one is chosen (`onMenu`).
        if let item, item.element.role == "select" { picking = item; return }
        typing?.cancel()
        look(event: item.map { "The user clicked \(describe($0.element))." }, on: item)
    }

    /**
     * A button that opens a menu of its own, like an Export or an account
     * button. The menu holds the mouse until something is chosen, so the click
     * that opened it is never seen to finish, and the pointer would sit on the
     * button while the person hunted through the menu alone. The menu opening
     * is the step being taken: the screen is read again, with the open menu's
     * items in it, and the pointer moves on to the one to choose.
     */
    private func onMenuOpened(_ menu: NSMenu?) {
        guard isRunning, let menu, menu !== NSApp.mainMenu, menu.supermenu == nil else { return }
        // Not a pop-up button's list of choices, which are the person's own and wait for one to be picked.
        guard let item = pressed, item.element.role == "button" else { return }
        pressed = nil
        look(event: "The user opened the menu of \(describe(item.element)).", on: item)
    }

    private func onMenu(_ item: NSMenuItem?) {
        guard isRunning, let item, !item.title.isEmpty else { return }
        // A choice made in a pop-up button is the person's own, like what they type: only that one was made is told.
        let from = picking ?? (pressed?.element.role == "select" ? pressed : nil)
        picking = nil
        if let from, !LiveTree.inMenuBar(item) {
            return look(event: "The user picked a choice in \(describe(from.element)). You can't see which.", on: from)
        }
        let listed = reading?.order.compactMap { reading?.listed[$0] }.first { ($0.node as? LiveNode)?.object === item }
        let title = Masking.clean(item.title, own: own)
        let menu = item.menu?.title ?? ""
        let event = menu.isEmpty ? "The user chose menu item \"\(title)\"." : "The user chose \"\(title)\" from the \(Masking.clean(menu, own: own)) menu."
        look(event: event, on: listed ?? Listed(element: SnapElement(id: "", role: "menuitem", label: title), node: LiveNode(item)))
    }

    private func onKey(_ event: NSEvent) {
        guard isRunning, let window = event.window, !(window is HapticWindow) else { return }
        if event.modifierFlags.contains(.command) { return }
        let editing = window.firstResponder is NSText
        let field = editing ? fieldBeingEdited(in: window) : nil
        switch event.keyCode {
        case 36, 76, 48, 53:
            // Return, Enter, Tab, Escape: something is finished with.
            let name = ["36": "Enter", "76": "Enter", "48": "Tab", "53": "Escape"]["\(event.keyCode)"] ?? "a key"
            let filled = typing != nil && field != nil ? "The user filled in \(describe(field!.element)). You can't see what they entered. " : ""
            typing?.cancel()
            typing = nil
            look(event: filled + "The user pressed \(name).", on: filled.isEmpty ? nil : field)
        default:
            guard editing else { return }
            // Typing. What is typed is never read: only that this field was typed in, once they pause.
            typing?.cancel()
            let run = self.run
            typing = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 1_600_000_000)
                guard let self, run == self.run, !Task.isCancelled else { return }
                self.typing = nil
                let name = field.map { describe($0.element) } ?? "a field"
                self.look(event: "The user filled in \(name). You can't see what they entered.", on: field)
            }
        }
    }

    /** The listed field the person is typing in: the one the text cursor's box sits inside. */
    private func fieldBeingEdited(in window: NSWindow) -> Listed? {
        guard let editor = window.firstResponder as? NSView, let reading else { return nil }
        let inWindow = editor.convert(editor.bounds, to: nil)
        let onScreen = window.convertToScreen(inWindow)
        guard let item = reading.element(at: CGPoint(x: onScreen.midX, y: onScreen.midY)) else { return nil }
        return Self.typedInto.contains(item.element.role) ? item : nil
    }

    /**
     * The person did something. Once the window has stopped changing, the next
     * step is asked for, unless nothing they did touched a control and nothing
     * changed, like a click on empty space.
     */
    private func look(event: String?, on item: Listed?) {
        guard isRunning else { return }
        // A look that is already waiting for the window to settle knows what the person did. One that knows nothing does not replace it.
        if event == nil, item == nil, lookPending { return }
        lookPending = true
        run += 1
        let run = self.run
        asking?.cancel()
        looking?.cancel()
        let before = reading?.signature
        let target = pointed
        looking = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard let self, run == self.run, !Task.isCancelled else { return }
            var last = self.read()?.signature
            // A sheet sliding down or a list filling in: wait until two looks in a row see the same thing.
            for _ in 0..<14 {
                try? await Task.sleep(nanoseconds: 160_000_000)
                guard run == self.run, !Task.isCancelled else { return }
                let now = self.read()?.signature
                if now == last { break }
                last = now
            }
            self.lookPending = false
            if item == nil, event == nil, last == before { return }
            let onTarget = item != nil && target != nil && Self.same(item!, target!.item)
            if onTarget { self.followed += 1 } else if item != nil, target != nil { self.strayed = true }
            let told = event ?? "The user did something in the app."
            // They used what was called the last step: one more look, at what came of it.
            if onTarget, target!.last {
                if self.closings >= Self.maxClosings || (self.closings > 0 && last == before) { return self.end(outcome: "finished", say: nil) }
                self.closings += 1
                return self.turn(event: told, closing: true)
            }
            self.turn(event: told)
        }
    }

    private static func same(_ a: Listed, _ b: Listed) -> Bool {
        if a.node === b.node { return true }
        if let x = a.node as? LiveNode, let y = b.node as? LiveNode, x.object === y.object { return true }
        return false
    }
}
