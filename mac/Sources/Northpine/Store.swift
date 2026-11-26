import HapticKit
import SwiftUI

// Everything the app knows and everywhere the person is. There is no server
// behind Northpine: the data is made up when the app opens and changes only
// in memory, so every run starts from the same company.

@MainActor
final class Store: ObservableObject {
    /** The one store, for the menu bar and the scripts that drive the app from outside its views. */
    static var shared: Store?

    /** The company, as it was made up and as the person has changed it since. */
    @Published var company = Seed.company()

    @Published var nav: Nav? = .home {
        didSet { detail = nav == .accounting ? accountingSection : nil }
    }
    /** What is open within the screen, like one card of Cards. Part of the screen's name to Haptic. */
    @Published var detail: String? {
        didSet { nameScreen() }
    }

    /** The sheet for issuing a card is open. Kept here because Cards, Home and the menu bar all open it. */
    @Published var issuingCard = false

    /** Which of Accounting's four sections is showing. Each is its own screen to Haptic. */
    @Published var accountingTab = "Chart of accounts" {
        didSet { detail = accountingSection }
    }
    private var accountingSection: String? {
        accountingTab == "Chart of accounts" ? nil : accountingTab.lowercased().replacingOccurrences(of: " ", with: "-")
    }

    init() {
        nameScreen()
    }

    func go(_ nav: Nav) {
        self.nav = nav
    }

    /** Shuts every sheet and goes back to the screen's own list. */
    func closeEverything() {
        issuingCard = false
        accountingTab = "Chart of accounts"
        detail = nil
    }

    func person(_ id: String?) -> Person? { company.people.first { $0.id == id } }
    func vendor(_ id: String?) -> Vendor? { company.vendors.first { $0.id == id } }
    func card(_ id: String?) -> Card? { company.cards.first { $0.id == id } }

    /** Changes one card in place. */
    func change(card id: String, _ change: (inout Card) -> Void) {
        guard let index = company.cards.firstIndex(where: { $0.id == id }) else { return }
        change(&company.cards[index])
    }

    func toggleFreeze(_ id: String) {
        change(card: id) { card in
            if card.status == .active { card.status = .frozen } else if card.status == .frozen { card.status = .active }
        }
    }

    /** Tells Haptic which screen this is. Window titles here hold people's and vendors' names, so the title alone would not do. */
    private func nameScreen() {
        let base = (nav ?? .home).path
        // Every card is the same screen to Haptic: /cards/card, not /cards/card/c12.
        Haptic.screen = detail.map { "\(base)/\($0.split(separator: "/")[0])" } ?? base
    }
}
