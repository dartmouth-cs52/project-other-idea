import XCTest
@testable import Northpine

final class SeedTests: XCTestCase {
    func testTheSameSeedMakesTheSameCompany() {
        let one = Seed.company(seed: 52)
        let two = Seed.company(seed: 52)
        XCTAssertEqual(one.people, two.people)
        XCTAssertEqual(one.cards, two.cards)
        XCTAssertEqual(one.transactions, two.transactions)
        XCTAssertEqual(one.bills, two.bills)
        XCTAssertNotEqual(one.cards, Seed.company(seed: 7).cards)
    }

    func testTheCompanyIsTheSizeOfARealOne() {
        let company = Seed.company()
        XCTAssertEqual(company.people.count, 60)
        XCTAssertEqual(company.cards.count, 84)
        XCTAssertEqual(company.transactions.count, 1_200)
        XCTAssertEqual(company.bills.count, 96)
        XCTAssertEqual(company.vendors.count, 18)
        XCTAssertEqual(company.budgets.count, Seed.departments.count)
    }

    func testThePeopleGuidesCountOnAreAlwaysThere() {
        let company = Seed.company()
        XCTAssertEqual(company.people.prefix(4).map(\.name), ["Maya Okafor", "Jonas Lind", "Priya Raman", "Tomas Vega"])
        XCTAssertEqual(Set(company.people.map(\.name)).count, company.people.count, "no two people share a name")
        XCTAssertEqual(company.vendors.first { $0.name == "Juniper Office Leasing" }?.status, .onHold)
        XCTAssertEqual(company.approvals.filter { $0.status == .pending }.count >= 14, true)
    }

    func testEverythingPointsAtSomethingThatExists() {
        let company = Seed.company()
        let people = Set(company.people.map(\.id)), cards = Set(company.cards.map(\.id)), vendors = Set(company.vendors.map(\.id))
        XCTAssertTrue(company.cards.allSatisfy { people.contains($0.holderID) })
        XCTAssertTrue(company.transactions.allSatisfy { cards.contains($0.cardID) && people.contains($0.personID) })
        XCTAssertTrue(company.bills.allSatisfy { vendors.contains($0.vendorID) })
        XCTAssertTrue(company.cards.allSatisfy { $0.spent <= $0.limit })
        XCTAssertEqual(company.transactions.map(\.date), company.transactions.map(\.date).sorted(by: >), "newest first")
    }

    func testMoneyAndDatesAreWrittenOneWay() {
        XCTAssertEqual(Format.money(1_234.5), "$1,234.50")
        XCTAssertEqual(Format.round(1_234.5), "$1,235")
        XCTAssertEqual(Format.date(Seed.today), "Jun 1, 2026")
        XCTAssertEqual(Format.ago(Seed.daysAgo(3)), "3 days ago")
        XCTAssertEqual(Format.percent(25, of: 200), "13%")
    }
}
