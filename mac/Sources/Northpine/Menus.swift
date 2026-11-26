import HapticKit
import SwiftUI

// The menu bar. Much of a Mac app is only here: every screen is in Go, the
// exports are two levels down in File, and what the selected card can have
// done to it is in a Card menu that is off unless a card is open.

struct NorthpineCommands: Commands {
    @ObservedObject var store: Store

    private var openCard: Card? {
        guard store.nav == .cards, let id = store.detail?.split(separator: "/").last else { return nil }
        return store.card(String(id))
    }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Menu("New") {
                Button("Card…") { store.issuingCard = true }
                    .keyboardShortcut("n")
                Button("Reimbursement Request…") { store.go(.reimbursements) }
                Button("Bill…") { store.go(.bills) }
                Button("Vendor…") { store.go(.vendors) }
                Divider()
                Button("Invitation…") { store.go(.people) }
            }
        }
        CommandGroup(after: .importExport) {
            Menu("Export") {
                Button("Expenses as CSV…") { store.exported = "Expenses" }
                Button("Bills as CSV…") { store.exported = "Bills" }
                Menu("Reports") {
                    Button("Spend by Category…") { store.exported = "Spend by category" }
                    Button("Spend by Department…") { store.exported = "Spend by department" }
                    Button("Trial Balance…") { store.exported = "Trial balance" }
                }
                Divider()
                Button("Everything for the Auditor…") { store.exported = "Audit pack" }
            }
            Button("Import Vendors…") { store.go(.vendors) }
        }
        CommandGroup(after: .sidebar) {
            Button("Reload Data") { store.company = Seed.company() }
                .keyboardShortcut("r")
        }
        CommandMenu("Go") {
            Button("Command Palette…") { store.paletteOpen = true }
                .keyboardShortcut("k")
            Divider()
            ForEach(NavGroup.all) { group in
                ForEach(Array(group.items.enumerated()), id: \.element) { _, item in
                    Button(item.title) { store.go(item) }
                        .keyboardShortcut(shortcut(item), modifiers: .command)
                }
                Divider()
            }
            Button("Back to List") { store.detail = nil }
                .keyboardShortcut("[")
                .disabled(store.detail == nil || store.nav == .accounting)
        }
        CommandMenu("Card") {
            Button(openCard?.status == .frozen ? "Unfreeze Card" : "Freeze Card") { if let openCard { store.toggleFreeze(openCard.id) } }
                .disabled(openCard == nil || openCard?.status == .cancelled)
            Menu("Set Limit") {
                ForEach([500, 1_000, 2_500, 5_000, 10_000], id: \.self) { amount in
                    Button(Format.round(Double(amount))) { if let openCard { store.change(card: openCard.id) { $0.limit = Double(amount) } } }
                }
            }
            .disabled(openCard == nil)
            Divider()
            Button("Issue Another Like This…") { store.issuingCard = true }
                .disabled(openCard == nil)
        }
        CommandGroup(replacing: .help) {
            Button("Northpine Help Center") { store.go(.help) }
                .keyboardShortcut("?")
            Button("Ask Northpine…") { Haptic.openAsk() }
            Button("Contact Support…") { store.go(.help); store.contacting = true }
            Divider()
            Button("Keyboard Shortcuts") { store.go(.help) }
        }
    }

    /** ⌘1 to ⌘9 for the first nine screens. The rest have none. */
    private func shortcut(_ nav: Nav) -> KeyEquivalent {
        let index = Nav.allCases.firstIndex(of: nav) ?? 0
        return index < 9 ? KeyEquivalent(Character("\(index + 1)")) : KeyEquivalent(Character(UnicodeScalar(0)))
    }
}
