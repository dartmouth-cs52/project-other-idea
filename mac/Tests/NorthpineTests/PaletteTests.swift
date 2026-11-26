import XCTest
@testable import Northpine

@MainActor
final class PaletteTests: XCTestCase {
    func testASearchPutsWhatStartsWithItFirst() {
        let store = Store()
        XCTAssertEqual(Palette.search("bud", in: store).first?.title, "Go to Budgets")
        XCTAssertEqual(Palette.search("issue", in: store).first?.title, "Issue a card")
        XCTAssertEqual(Palette.search("books", in: store).map(\.title), ["Close the books"])
        XCTAssertTrue(Palette.search("zzz", in: store).isEmpty)
        XCTAssertEqual(Palette.search("", in: store).count, 8)
        XCTAssertLessThanOrEqual(Palette.search("a", in: store).count, 8)
    }

    func testRunningACommandGoesThere() {
        let store = Store()
        Palette.search("close the books", in: store).first?.run(store)
        XCTAssertEqual(store.nav, .accounting)
        XCTAssertEqual(store.accountingTab, "Month-end close")
        XCTAssertEqual(store.detail, "month-end-close")
        Palette.search("issue", in: store).first?.run(store)
        XCTAssertEqual(store.nav, .cards)
        XCTAssertTrue(store.issuingCard)
    }
}
