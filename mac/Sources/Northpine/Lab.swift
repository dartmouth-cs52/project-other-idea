import SwiftUI

// The Lab: a small window of switches, each of which changes the app in a way
// that has tripped up a pointing guide somewhere. It is how Northpine is made
// hard on purpose, and how a guide is tried against the same task twice with
// the screen different each time. The web Northpine has the same panel.
//
// Open it from the Window menu, or with ⌥⌘L.

final class Lab: ObservableObject {
    static var shared: Lab?

    /** Who the person is. An employee is not shown what only finance may do. */
    @Published var role = Role.admin
    /** What the company pays for. Starter has no approvals, budgets or accounting. */
    @Published var plan = Plan.growth
    /** The sidebar under other names, as after a redesign: Cards becomes Wallet. */
    @Published var renamed = false
    /** The sidebar as a narrow strip of icons with no words. */
    @Published var iconsOnly = false
    /** A strip across the top of every screen with its own button. */
    @Published var banner = false
    /** A feed on Home that adds a row every few seconds, so the screen never sits still. */
    @Published var liveFeed = false
    /** Screens take a moment to load, showing a spinner first. */
    @Published var slow = false

    static let renames: [Nav: String] = [.cards: "Wallet", .expenses: "Transactions", .bills: "Payables", .vendors: "Suppliers", .people: "Team", .reports: "Insights", .approvals: "Requests"]

    /** What a screen is called in the sidebar, the Go menu and the window's title. Its own heading keeps the old name, as after a real redesign. */
    func title(_ nav: Nav) -> String {
        renamed ? Self.renames[nav] ?? nav.title : nav.title
    }

    /** The screens this person, on this plan, is shown at all. */
    func shows(_ nav: Nav) -> Bool {
        if plan == .starter, [.approvals, .budgets, .accounting].contains(nav) { return false }
        switch role {
        case .admin: return true
        case .finance: return nav != .policies
        case .manager: return ![.accounting, .policies, .bills, .vendors].contains(nav)
        case .employee: return [.home, .inbox, .cards, .expenses, .reimbursements, .help].contains(nav)
        }
    }

    /** Sets switches by name, for starting the app in a state from a script: LAB=renamed,icons,employee. */
    func apply(_ names: String) {
        for name in names.lowercased().split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }) {
            switch name {
            case "renamed": renamed = true
            case "icons": iconsOnly = true
            case "banner": banner = true
            case "feed": liveFeed = true
            case "slow": slow = true
            case "starter": plan = .starter
            case "enterprise": plan = .enterprise
            default: if let role = Role.allCases.first(where: { $0.rawValue.lowercased() == name }) { self.role = role }
            }
        }
    }

    func reset() {
        role = .admin
        plan = .growth
        renamed = false
        iconsOnly = false
        banner = false
        liveFeed = false
        slow = false
    }
}

struct LabWindow: View {
    @EnvironmentObject var lab: Lab

    var body: some View {
        Form {
            Section("Who is using it") {
                Picker("Role", selection: $lab.role) {
                    ForEach(Role.allCases) { Text($0.rawValue).tag($0) }
                }
                Picker("Plan", selection: $lab.plan) {
                    ForEach(Plan.allCases) { Text($0.rawValue).tag($0) }
                }
            }
            Section("The sidebar") {
                Toggle("Rename the screens", isOn: $lab.renamed)
                Toggle("Icons only", isOn: $lab.iconsOnly)
            }
            Section("The screen") {
                Toggle("A banner across the top", isOn: $lab.banner)
                Toggle("A live feed on Home", isOn: $lab.liveFeed)
                Toggle("Slow loading", isOn: $lab.slow)
            }
            Button("Reset the Lab") { lab.reset() }
        }
        .padding(18)
        .frame(width: 320)
    }
}
