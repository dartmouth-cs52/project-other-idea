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
        didSet { detail = nil }
    }
    /** What is open within the screen, like one card of Cards. Part of the screen's name to Haptic. */
    @Published var detail: String? {
        didSet { nameScreen() }
    }

    init() {
        nameScreen()
    }

    func go(_ nav: Nav) {
        self.nav = nav
    }

    func person(_ id: String?) -> Person? { company.people.first { $0.id == id } }
    func vendor(_ id: String?) -> Vendor? { company.vendors.first { $0.id == id } }
    func card(_ id: String?) -> Card? { company.cards.first { $0.id == id } }

    /** Tells Haptic which screen this is. Window titles here hold people's and vendors' names, so the title alone would not do. */
    private func nameScreen() {
        let base = (nav ?? .home).path
        Haptic.screen = detail.map { "\(base)/\($0)" } ?? base
    }
}
