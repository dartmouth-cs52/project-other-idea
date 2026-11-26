import AppKit
import HapticKit

// `swift run Northpine --site` writes the site file the Haptic server needs
// for this app (mac/northpine-site.json), from the app itself: it walks every
// screen and every state behind a click, reads each as Haptic would, and
// writes down what is there. A website's pages are crawled. Nothing crawls a
// Mac app, so the app does it to itself.
//
// Run it again after changing a screen, and commit what it writes.

@MainActor
enum Site {
    static let notes = """
    Northpine is a Mac app, not a website. Companies use it to manage what they spend: company cards, expenses, reimbursements, approvals, bills and vendors, budgets, and the accounting behind them.

    - A "path" here is a screen of the app. The sidebar on the left switches screens. It has five groups: Overview (Home, Inbox), Spend (Cards, Expenses, Reimbursements), Payables (Approvals, Bills, Vendors), Finance (Budgets, Accounting, Reports) and Company (People, Policies, Help Center).
    - Every screen is also in the Go menu in the menu bar, and in the command palette (the Command palette button in the toolbar).
    - Menu bar items are listed as elements too. One marked "in the closed File menu" is reached by opening that menu first. Point at the item itself: the app moves the pointer to the menu's title until the menu is open.
    - Exports are in the File menu under Export. Report exports are one menu deeper, under File, Export, Reports.
    - Settings is a separate window, opened with Settings… in the Northpine menu or in the account menu in the toolbar. It has five panes along its top: General, Notifications, Security, Plan and billing, Integrations. API keys and two-factor authentication are on Security.
    - Accounting has four sections chosen by a row of segments: Chart of accounts, Mappings, Sync and Month-end close.
    - Tables (Cards, Expenses, Bills, People) work the same way: click a row to choose it, then use the buttons under the table, like Open card or Pay bill. Those buttons are off until a row is chosen.
    - Approvals, Vendors, Inbox and Help Center show a list on the left and what was chosen on the right.
    - A bill cannot be paid while its vendor is on hold. The hold is the "Hold payments to this vendor" checkbox on the vendor's Details tab in Vendors.
    - Changes to Policies do nothing until Publish at the top of that screen is pressed.
    - What someone can see depends on their role and the company's plan. If a screen is missing from the sidebar, say that their role or plan does not include it. Do not send them looking for it.
    """

    /** What a screen behind a click is called. Its own heading is often someone's data: a card's name, a merchant. */
    static let titles = [
        "card": "A card", "expense": "An expense", "mappings": "Accounting, Mappings", "sync": "Accounting, Sync", "close": "Accounting, Month-end close",
        "sign-in": "Sign in", "onboarding": "Set up a new company", "settings": "Settings, General", "settings-notifications": "Settings, Notifications",
        "settings-security": "Settings, Security", "settings-plan": "Settings, Plan and billing", "settings-integrations": "Settings, Integrations",
    ]

    static func run() async {
        guard let store = Store.shared else { return }
        _ = Haptic.snapshotJSON()
        try? await Task.sleep(nanoseconds: 800_000_000)

        var pages: [String: [String: Any]] = [:]
        var order: [String] = []
        func keep(_ page: [String: Any]?) {
            guard let page, let path = page["path"] as? String else { return }
            if pages[path] == nil { order.append(path) }
            pages[path] = page
        }

        for nav in Nav.allCases {
            store.go(nav)
            try? await Task.sleep(nanoseconds: 900_000_000)
            keep(page(nav.title))
        }
        for state in Dump.opened {
            let from = Haptic.screen ?? "/home"
            await Dump.enter(state, store)
            guard let read = read() else { await Dump.leave(store); continue }
            if read.dialog != nil, let base = pages[state.name == "palette" ? "/home" : read.path] ?? pages[from] {
                // A sheet belongs to the screen under it: what its opener shows.
                var page = base
                var opens = page["opens"] as? [[String: Any]] ?? []
                opens.append(["control": state.control, "links": [], "buttons": read.buttons, "fields": read.fields])
                page["opens"] = opens
                pages[page["path"] as? String ?? read.path] = page
            } else {
                keep(page(titles[state.name] ?? state.control))
            }
            await Dump.leave(store)
        }

        let docs = HelpCenter.articles.map { ["title": $0.title, "source": "Northpine Help Center, \($0.topic)", "text": "# \($0.title)\n\n\($0.body)"] }
        let site: [String: Any] = [
            "version": 1,
            "id": "site_northpine_mac",
            "name": "Northpine",
            "origin": "app://\(AppDelegate.appID)",
            "allowedOrigins": ["app://\(AppDelegate.appID)"],
            "appearance": ["accent": "#1F7A4D", "position": "bottom-right", "launcherLabel": "Ask"],
            "notes": notes,
            "docs": docs,
            "pages": order.compactMap { pages[$0] },
            "source": ["url": "app://\(AppDelegate.appID)", "maxPages": 0, "docs": []],
            "answers": ["enabled": false],
            "learn": false,
            "createdAt": "2026-11-25T00:00:00.000Z",
            "updatedAt": "2026-11-25T00:00:00.000Z",
        ]
        do {
            let data = try JSONSerialization.data(withJSONObject: site, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
            print(String(decoding: data, as: UTF8.self))
        } catch {
            FileHandle.standardError.write(Data("Could not write the site file: \(error.localizedDescription)\n".utf8))
        }
        fflush(stdout)
        NSApp.terminate(nil)
    }

    private struct Read {
        var path: String
        var dialog: String?
        var headings: [String]
        var links: [[String: String]]
        var buttons: [String]
        var fields: [String]
    }

    /** The screen in front as the site file describes a page: what it is called, and the names of what is on it. Never a row, which is someone's data. */
    private static func read() -> Read? {
        guard let text = Haptic.snapshotJSON(), let data = text.data(using: .utf8), let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let elements = (snapshot["elements"] as? [[String: Any]] ?? []).filter { !(($0["context"] as? String) ?? "").hasPrefix("menu") }
        func labels(_ roles: Set<String>, sidebar: Bool = false) -> [String] {
            var seen: [String] = []
            for element in elements {
                guard let role = element["role"] as? String, roles.contains(role), let label = element["label"] as? String, !label.isEmpty else { continue }
                let inSidebar = ((element["context"] as? String) ?? "").hasPrefix("Sidebar")
                guard inSidebar == sidebar, !seen.contains(label) else { continue }
                seen.append(label)
            }
            return seen
        }
        let links = labels(["treeitem"], sidebar: true).compactMap { label -> [String: String]? in
            guard let nav = Nav.allCases.first(where: { $0.title == label }) else { return nil }
            return ["label": label, "to": nav.path]
        }
        return Read(
            path: snapshot["path"] as? String ?? "/window",
            dialog: snapshot["dialog"] as? String,
            headings: Array((snapshot["headings"] as? [String] ?? []).prefix(8)),
            links: links,
            buttons: Array(labels(["button", "tab", "radio", "link", "checkbox", "switch"]).prefix(40)),
            fields: Array(labels(["textbox", "searchbox", "select", "combobox", "slider", "spinbutton"]).prefix(30))
        )
    }

    private static func page(_ title: String) -> [String: Any]? {
        guard let read = read() else { return nil }
        return ["path": read.path, "title": title, "headings": read.headings, "links": read.links, "buttons": read.buttons, "fields": read.fields]
    }
}
