import XCTest
@testable import Northpine

final class LabTests: XCTestCase {
    func testAnEmployeeIsShownOnlyTheirOwnScreens() {
        let lab = Lab()
        lab.role = .employee
        XCTAssertEqual(Nav.allCases.filter(lab.shows), [.home, .inbox, .cards, .expenses, .reimbursements, .help])
        lab.role = .manager
        XCTAssertFalse(lab.shows(.accounting))
        XCTAssertTrue(lab.shows(.approvals))
        lab.role = .admin
        XCTAssertEqual(Nav.allCases.filter(lab.shows), Nav.allCases)
    }

    func testStarterHasNoApprovalsBudgetsOrAccounting() {
        let lab = Lab()
        lab.plan = .starter
        XCTAssertEqual(Nav.allCases.filter { !lab.shows($0) }, [.approvals, .budgets, .accounting])
    }

    func testRenamingChangesWhatScreensAreCalledAndNothingElse() {
        let lab = Lab()
        XCTAssertEqual(lab.title(.cards), "Cards")
        lab.renamed = true
        XCTAssertEqual(lab.title(.cards), "Wallet")
        XCTAssertEqual(lab.title(.home), "Home")
        XCTAssertEqual(Nav.cards.path, "/cards", "the screen's path to Haptic stays the same")
    }

    func testSwitchesCanBeSetByNameAndReset() {
        let lab = Lab()
        lab.apply("renamed, icons,Employee,starter")
        XCTAssertTrue(lab.renamed && lab.iconsOnly)
        XCTAssertEqual(lab.role, .employee)
        XCTAssertEqual(lab.plan, .starter)
        lab.reset()
        XCTAssertFalse(lab.renamed || lab.iconsOnly)
        XCTAssertEqual(lab.role, .admin)
    }
}
