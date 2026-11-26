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
        for (name, open) in opened where only == nil || only == name {
            guard let store = Store.shared else { break }
            open(store)
            try? await Task.sleep(nanoseconds: 1_300_000_000)
            show(name, json: arguments.contains("--json"))
            store.closeEverything()
            // The Settings window, if this state opened it.
            for window in NSApp.windows where window.isVisible && window.title != "Northpine" && window.styleMask.contains(.closable) && store.settingsPane != nil { window.close() }
            try? await Task.sleep(nanoseconds: 700_000_000)
        }
        NSApp.terminate(nil)
    }

    /** The states behind a click, each by a name to ask for it by. */
    static let opened: [(String, @MainActor (Store) -> Void)] = [
        ("card", { $0.go(.cards); $0.detail = "card/c1" }),
        ("issue-card", { $0.go(.cards); $0.issuingCard = true }),
        ("expense", { $0.go(.expenses); $0.detail = "expense/t1" }),
        ("mappings", { $0.go(.accounting); $0.accountingTab = "Mappings" }),
        ("sync", { $0.go(.accounting); $0.accountingTab = "Sync" }),
        ("close", { $0.go(.accounting); $0.accountingTab = "Month-end close" }),
        ("settings", { _ in Preferences.open("General") }),
        ("settings-security", { _ in Preferences.open("Security") }),
    ]

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
