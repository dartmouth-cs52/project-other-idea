import XCTest
@testable import HapticKit

// The same cases the web's `cleanText` is held to (test/snapshot.test.ts and src/shared/types.ts), so a label reads
// the same whether it came from a page or from a window.
final class MaskingTests: XCTestCase {
    func testEmailsAndLongNumbersAreMasked() {
        XCTAssertEqual(Masking.clean("Signed in as maya@acme.co"), "Signed in as [email]")
        XCTAssertEqual(Masking.clean("Order 8812345 shipped"), "Order [number] shipped")
        XCTAssertEqual(Masking.clean("Call +1 (415) 555-0132 today"), "Call [number] today")
        XCTAssertEqual(Masking.clean("Card 4111 1111 1111 1111"), "Card [number]")
    }

    func testWhatIsNotPersonalIsLeftAlone() {
        XCTAssertEqual(Masking.clean("  Create   API key "), "Create API key")
        XCTAssertEqual(Masking.clean("3 projects, 62% used"), "3 projects, 62% used")
        XCTAssertEqual(Masking.clean("Due 2026-11-15"), "Due 2026-11-15")
        XCTAssertEqual(Masking.clean("Plan: 1.249,00 EUR"), "Plan: 1.249,00 EUR")
    }

    func testWhatLooksLikeADateButIsNotOneIsMasked() {
        XCTAssertEqual(Masking.clean("Ref 12-34-5678"), "Ref [number]")
    }

    func testWhatThePersonNamedStaysReadable() {
        let own = Masking.named(in: "where is order 8812345 for maya@acme.co?")
        XCTAssertEqual(own, ["8812345", "maya@acme.co"])
        XCTAssertEqual(Masking.clean("Order 8812345", own: own), "Order 8812345")
        XCTAssertEqual(Masking.clean("Order 7700001", own: own), "Order [number]")
        XCTAssertEqual(Masking.clean("maya@acme.co and jo@acme.co", own: own), "maya@acme.co and [email]")
    }

    func testLongTextIsCutAtAWord() {
        let cut = Masking.clean("Your file will be in Downloads in a moment, and a copy goes to the workspace owner", max: 40)
        XCTAssertLessThanOrEqual(cut.count, 40)
        XCTAssertTrue(cut.hasSuffix("…"))
        XCTAssertFalse(cut.dropLast().hasSuffix(" "))
    }
}
