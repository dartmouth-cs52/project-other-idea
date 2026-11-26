import AppKit
import HapticKit

// `swift run Northpine --dump` prints what Haptic reads from each screen and
// quits: one line for each control, as the model is shown it. A control with
// nothing between its quotes is one to give an accessibility label.
//
//   swift run Northpine --dump            every screen in the sidebar
//   swift run Northpine --dump cards      one screen, by its path
//   swift run Northpine --dump issue-card one of the states behind a click (see `opened`)
//   swift run Northpine --dump --json     the JSON that is sent, in full

@MainActor
enum Dump {
    static func run() async {
        let arguments = CommandLine.arguments
        let only = arguments.drop { $0 != "--dump" }.dropFirst().first { !$0.hasPrefix("--") }
        // The first reading is what makes SwiftUI build its accessibility tree, so it is thrown away.
        _ = Haptic.snapshotJSON()
        try? await Task.sleep(nanoseconds: 800_000_000)
        for nav in Nav.allCases where only == nil || only == nav.rawValue {
            Store.shared?.go(nav)
            try? await Task.sleep(nanoseconds: 900_000_000)
            show(nav.path, json: arguments.contains("--json"))
        }
        // What only shows once something is opened: a sheet, or one row of a table.
        for state in opened where only == nil || only == state.name {
            guard let store = Store.shared else { break }
            await enter(state, store)
            show(state.name, json: arguments.contains("--json"))
            await leave(store)
        }
        NSApp.terminate(nil)
    }

    /** A state behind a click: a name to ask for it by, the control that opens it, and how to get there. */
    struct Opened {
        let name: String
        /** What the person presses to get here, as the site's pages say it. */
        let control: String
        let open: @MainActor (Store) -> Void
    }

    static let opened: [Opened] = [
        Opened(name: "card", control: "Open card") { $0.go(.cards); $0.detail = "card/c1" },
        Opened(name: "issue-card", control: "Issue card") { $0.go(.cards); $0.issuingCard = true },
        Opened(name: "expense", control: "Open expense") { $0.go(.expenses); $0.detail = "expense/t1" },
        Opened(name: "mappings", control: "Mappings") { $0.go(.accounting); $0.accountingTab = "Mappings" },
        Opened(name: "sync", control: "Sync") { $0.go(.accounting); $0.accountingTab = "Sync" },
        Opened(name: "close", control: "Month-end close") { $0.go(.accounting); $0.accountingTab = "Month-end close" },
        Opened(name: "contact", control: "Contact support") { $0.go(.help); $0.contacting = true },
        Opened(name: "palette", control: "Command palette") { $0.go(.home); $0.paletteOpen = true },
        Opened(name: "sign-in", control: "Sign Out") { $0.signedIn = false },
        Opened(name: "onboarding", control: "Set up a new company") { $0.onboarding = true },
        Opened(name: "settings", control: "Settings…") { _ in Preferences.open("General") },
        Opened(name: "settings-notifications", control: "Notifications") { _ in Preferences.open("Notifications") },
        Opened(name: "settings-security", control: "Security") { _ in Preferences.open("Security") },
        Opened(name: "settings-plan", control: "Plan and billing") { _ in Preferences.open("Plan and billing") },
        Opened(name: "settings-integrations", control: "Integrations") { _ in Preferences.open("Integrations") },
    ]

    static func enter(_ state: Opened, _ store: Store) async {
        state.open(store)
        try? await Task.sleep(nanoseconds: 1_300_000_000)
    }

    static func leave(_ store: Store) async {
        // The Settings window, if the state opened it.
        if store.settingsPane != nil {
            for window in NSApp.windows where window.isVisible && (window.identifier?.rawValue ?? "").contains("Settings") { window.close() }
            store.settingsPane = nil
        }
        store.closeEverything()
        try? await Task.sleep(nanoseconds: 700_000_000)
    }

    static func show(_ name: String, json: Bool) {
        guard let text = Haptic.snapshotJSON() else { return print("--- \(name)\n(no window)") }
        if json { return print("--- \(name)\n\(text)") }
        guard let data = text.data(using: .utf8), let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        let elements = snapshot["elements"] as? [[String: Any]] ?? []
        // The menu bar is the same on every screen, so it is counted and not listed.
        let inWindow = elements.filter { !(($0["context"] as? String) ?? "").hasPrefix("menu") }
        print("--- \(snapshot["path"] ?? name)  \"\(snapshot["title"] ?? "")\"  \(inWindow.count) controls, \(elements.count - inWindow.count) in menus")
        for heading in snapshot["headings"] as? [String] ?? [] { print("    # \(heading)") }
        for element in inWindow {
            let state = (element["state"] as? [String]).map { " (\($0.joined(separator: ", ")))" } ?? ""
            let context = (element["context"] as? String).map { " [\($0)]" } ?? ""
            print("    \(element["id"] ?? "") \(element["role"] ?? "") \"\(element["label"] ?? "")\"\(state)\(context)")
        }
    }
}
