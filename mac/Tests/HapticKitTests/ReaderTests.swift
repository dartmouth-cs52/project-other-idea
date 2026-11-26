import XCTest
@testable import HapticKit

/** A tree written out by hand, standing in for a window. */
final class Fake: TreeNode {
    var role: String
    var subrole = ""
    var label: String
    var title = ""
    var staticText = ""
    var help = ""
    var identifier = ""
    var placeholder = ""
    var isOn = false
    var isEnabled = true
    var isSelected = false
    var isExpanded: Bool?
    var frame: CGRect
    var children: [TreeNode]
    var titleElement: TreeNode?
    var scrolled = false
    /** What someone typed into it. The reader must never ask, so nothing in `TreeNode` reaches it. */
    var typed = ""

    init(_ role: String, _ label: String = "", frame: CGRect = CGRect(x: 10, y: 10, width: 80, height: 20), _ children: [TreeNode] = []) {
        self.role = role
        self.label = label
        self.frame = frame
        self.children = children
    }

    static func text(_ words: String, frame: CGRect = CGRect(x: 10, y: 10, width: 80, height: 20)) -> Fake {
        let node = Fake("AXStaticText", frame: frame)
        node.staticText = words
        return node
    }

    func scrollToVisible() { scrolled = true }
}

@MainActor
final class ReaderTests: XCTestCase {
    private let window = CGRect(x: 0, y: 0, width: 800, height: 600)

    private func read(_ children: [TreeNode], dialog: String? = nil, menuBar: [MenuEntry] = [], own: Set<String> = []) -> Reading {
        var reader = Reader(own: own)
        let screen = Screen(root: Fake("AXWindow", "Acme", frame: window, children), path: "/settings", title: "Settings", dialog: dialog, menuBar: menuBar, visible: window)
        return reader.read(screen)
    }

    func testControlsGetTheWebsNamesForWhatTheyAre() {
        let toggle = Fake("AXCheckBox", "Weekly summary")
        toggle.isOn = true
        let tab = Fake("AXRadioButton", "Security")
        tab.subrole = "AXTabButton"
        let search = Fake("AXTextField", "Search")
        search.subrole = "AXSearchField"
        let reading = read([Fake("AXButton", "Create API key"), toggle, Fake("AXTabGroup", "", [tab]), Fake("AXPopUpButton", "Role"), search, Fake("AXLink", "Docs")])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.role) \($0.label)" }, ["button Create API key", "checkbox Weekly summary", "tab Security", "select Role", "searchbox Search", "link Docs"])
        XCTAssertEqual(reading.snapshot.elements[1].state, ["checked"])
        XCTAssertEqual(reading.snapshot.elements.map(\.id), ["e1", "e2", "e3", "e4", "e5", "e6"])
        XCTAssertEqual(reading.snapshot.path, "/settings")
    }

    func testTheWindowsOwnButtonsAreLeftOut() {
        let close = Fake("AXButton", "")
        close.subrole = "AXCloseButton"
        XCTAssertEqual(read([close, Fake("AXButton", "Save")]).snapshot.elements.map(\.label), ["Save"])
    }

    func testAFieldIsNamedAndNeverRead() {
        let field = Fake("AXTextField", "", frame: CGRect(x: 200, y: 100, width: 200, height: 22))
        field.typed = "hunter2"
        // A field editor shows what was typed as text inside the field. It is not listed, and does not name the field.
        field.children = [Fake.text("hunter2")]
        let reading = read([Fake.text("Workspace name:", frame: CGRect(x: 80, y: 100, width: 110, height: 17)), field])
        XCTAssertEqual(reading.snapshot.elements, [SnapElement(id: "e1", role: "textbox", label: "Workspace name")])
        let sent = String(data: try! JSONEncoder().encode(reading.snapshot), encoding: .utf8)!
        XCTAssertFalse(sent.contains("hunter2"))
    }

    func testAFieldWithNoLabelBesideItUsesItsPlaceholder() {
        let field = Fake("AXTextField", "")
        field.placeholder = "Email address"
        XCTAssertEqual(read([field]).snapshot.elements.first?.label, "Email address")
    }

    func testHeadingsAndTextAreMaskedAndGiveControlsTheirContext() {
        let heading = Fake("AXHeading", "Team")
        let reading = read([heading, Fake.text("Owner: maya@acme.co"), Fake("AXButton", "Invite teammate")])
        XCTAssertEqual(reading.snapshot.headings, ["Team"])
        XCTAssertEqual(reading.snapshot.text, ["Owner: [email]"])
        XCTAssertEqual(reading.snapshot.elements.first?.context, "Team")
    }

    func testRowsOfASidebarAreControlsNamedByTheirWords() {
        let selected = Fake("AXRow", "", [Fake("AXCell", "", [Fake.text("Settings")])])
        selected.isSelected = true
        let sidebar = Fake("AXOutline", "Sidebar", frame: window, [Fake("AXRow", "", [Fake("AXCell", "", [Fake.text("Overview")])]), selected])
        let reading = read([sidebar])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.role) \($0.label) \($0.state ?? [])" }, ["treeitem Overview []", "treeitem Settings [\"selected\"]"])
        XCTAssertEqual(reading.snapshot.elements.first?.context, "Sidebar")
        // A row's words are its name, and are not said twice.
        XCTAssertEqual(reading.snapshot.text, [])
    }

    func testALongTableIsCutShort() {
        let rows = (1...60).map { Fake("AXRow", "", [Fake.text("Invoice \($0)")]) }
        let reading = read([Fake("AXTable", "", frame: window, rows)])
        XCTAssertEqual(reading.snapshot.elements.count, Reader.maxRows)
        XCTAssertTrue(reading.snapshot.truncated)
    }

    func testWhatIsScrolledOutOfViewSaysWhichWay() {
        let above = Fake("AXButton", "First", frame: CGRect(x: 10, y: 700, width: 80, height: 20))
        let below = Fake("AXButton", "Last", frame: CGRect(x: 10, y: -90, width: 80, height: 20))
        let reading = read([Fake("AXScrollArea", "", frame: window, [above, Fake("AXButton", "Middle"), below])])
        XCTAssertEqual(reading.snapshot.elements.map(\.offscreen), ["above", nil, "below"])
    }

    func testWhatIsNotOnShowIsNotListed() {
        XCTAssertEqual(read([Fake("AXButton", "Hidden", frame: .zero), Fake("AXButton", "Shown")]).snapshot.elements.map(\.label), ["Shown"])
    }

    func testASheetIsNamedByItsHeadingAndHidesTheMenus() {
        let file = MenuEntry(title: "File", children: [MenuEntry(title: "Close", node: Fake("AXMenuItem"))], node: Fake("AXMenuBarItem"))
        let reading = read([Fake("AXHeading", "Invite a teammate"), Fake("AXButton", "Send invite")], dialog: "", menuBar: [file])
        XCTAssertEqual(reading.snapshot.dialog, "Invite a teammate")
        XCTAssertEqual(reading.snapshot.elements.map(\.label), ["Send invite"])
    }

    func testMenuItemsSayWhichClosedMenuTheyAreInAndPointAtItsTitle() {
        let title = Fake("AXMenuBarItem", frame: CGRect(x: 100, y: 580, width: 40, height: 20))
        let exportTitle = Fake("AXMenuItem", frame: .zero)
        let report = Fake("AXMenuItem", frame: .zero)
        let export = MenuEntry(title: "Export", children: [MenuEntry(title: "Usage Report…", node: report)], node: exportTitle)
        let file = MenuEntry(title: "File", children: [MenuEntry(title: "Close", enabled: false, node: Fake("AXMenuItem", frame: .zero)), export], node: title)
        let reading = read([Fake("AXButton", "Save")], menuBar: [file])
        let listed = reading.snapshot.elements.map { "\($0.role) \($0.label) \($0.state ?? []) [\($0.context ?? "")]" }
        XCTAssertEqual(listed, [
            "button Save [] []",
            "menu File [\"collapsed\"] [menu bar]",
            "menuitem Close [\"in the closed File menu\", \"disabled\"] [menu File]",
            "menu Export [\"collapsed\", \"in the closed File menu\"] [menu File]",
            "menuitem Usage Report… [\"in the closed Export menu\"] [menu File › Export]",
        ])
        // Closed, the pointer goes to the title in the menu bar. With File open it goes to Export, and with both open to the item.
        let item = reading.listed["e5"]!
        XCTAssertEqual(Guide.frame(of: item), title.frame)
        exportTitle.frame = CGRect(x: 100, y: 500, width: 120, height: 22)
        XCTAssertEqual(Guide.frame(of: item), exportTitle.frame)
        report.frame = CGRect(x: 220, y: 500, width: 140, height: 22)
        XCTAssertEqual(Guide.frame(of: item), report.frame)
    }

    func testMenusAreNotPartOfWhetherTheScreenChanged() {
        let enabled = MenuEntry(title: "Edit", children: [MenuEntry(title: "Paste", enabled: true, node: Fake("AXMenuItem"))], node: Fake("AXMenuBarItem"))
        let disabled = MenuEntry(title: "Edit", children: [MenuEntry(title: "Paste", enabled: false, node: Fake("AXMenuItem"))], node: Fake("AXMenuBarItem"))
        XCTAssertEqual(read([Fake("AXButton", "Save")], menuBar: [enabled]).signature, read([Fake("AXButton", "Save")], menuBar: [disabled]).signature)
        XCTAssertNotEqual(read([Fake("AXButton", "Save")]).signature, read([Fake("AXButton", "Save"), Fake("AXButton", "Undo")]).signature)
    }

    func testAClickLandsOnTheSmallestControlThatHoldsIt() {
        let row = Fake("AXRow", "", frame: CGRect(x: 0, y: 100, width: 400, height: 30), [Fake.text("Website relaunch"), Fake("AXButton", "Open", frame: CGRect(x: 300, y: 104, width: 60, height: 22))])
        let reading = read([Fake("AXTable", "", frame: window, [row])])
        XCTAssertEqual(reading.element(at: CGPoint(x: 320, y: 110))?.element.label, "Open")
        XCTAssertEqual(reading.element(at: CGPoint(x: 50, y: 110))?.element.label, "Website relaunch")
        XCTAssertNil(reading.element(at: CGPoint(x: 700, y: 500)))
    }

    func testScreensAreNamedAsPaths() {
        XCTAssertEqual(LiveTree.path(for: "Plan & Billing", document: false), "/plan-billing")
        XCTAssertEqual(LiveTree.path(for: "", document: false), "/window")
        XCTAssertEqual(LiveTree.path(for: "/cards/card", document: false), "/cards/card")
        XCTAssertEqual(LiveTree.path(for: "Settings/Plan & Billing/", document: false), "/settings/plan-billing")
        XCTAssertEqual(LiveTree.path(for: "//", document: false), "/window")
        XCTAssertEqual(LiveTree.path(for: "Q3 budget (Maya).numbers", document: true), "/document")
    }

    func testASidebarsGroupTitleNamesItsRowsAndIsNotOneOfThem() {
        func row(_ words: String, y: CGFloat) -> Fake { Fake("AXRow", frame: CGRect(x: 0, y: y, width: 200, height: 24), [Fake("AXCell", "", [Fake.text(words)])]) }
        func title(_ words: String, y: CGFloat) -> Fake { Fake("AXRow", frame: CGRect(x: 0, y: y, width: 200, height: 18), [Fake("AXCell", "", [Fake("AXGroup", "", [Fake("AXHeading", words)])])]) }
        let sidebar = Fake("AXOutline", "Sidebar", frame: CGRect(x: 0, y: 0, width: 200, height: 600), [title("Spend", y: 500), row("Cards", y: 470), row("Expenses", y: 440), title("Company", y: 400), row("People", y: 370)])
        let reading = read([sidebar, Fake("AXButton", "Issue card", frame: CGRect(x: 300, y: 500, width: 90, height: 22))])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.role) \($0.label) [\($0.context ?? "")]" }, [
            "treeitem Cards [Sidebar › Spend]", "treeitem Expenses [Sidebar › Spend]", "treeitem People [Sidebar › Company]", "button Issue card []",
        ])
        XCTAssertEqual(reading.snapshot.headings, [], "a sidebar's group titles are not the screen's headings")
    }

    func testAScrollBarsOwnButtonsAreLeftOut() {
        let page = Fake("AXButton", "")
        page.subrole = "AXIncrementPage"
        page.isEnabled = false
        let area = Fake("AXScrollArea", "", frame: window, [Fake("AXButton", "Save"), Fake("AXScrollBar", "", [Fake("AXValueIndicator"), page])])
        XCTAssertEqual(read([area]).snapshot.elements.map(\.label), ["Save"])
    }

    func testControlsInTwoBoxesSideBySideEachGetTheirOwnHeading() {
        // As SwiftUI reads two panels in a row: both headings, then the controls of both, mixed.
        func heading(_ words: String, x: CGFloat, y: CGFloat) -> Fake { Fake("AXHeading", words, frame: CGRect(x: x, y: y, width: 120, height: 16)) }
        func button(_ words: String, x: CGFloat, y: CGFloat) -> Fake { Fake("AXButton", words, frame: CGRect(x: x, y: y, width: 100, height: 20)) }
        let reading = read([
            heading("Billing", x: 20, y: 560),
            heading("To do", x: 20, y: 500), heading("Spend by category", x: 420, y: 500),
            button("Open approvals", x: 260, y: 470), button("Export spend", x: 600, y: 470), button("Open bills", x: 260, y: 440),
            heading("Latest activity", x: 20, y: 300), button("View cards", x: 680, y: 270),
        ])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.label) [\($0.context ?? "")]" }, [
            "Open approvals [To do]", "Export spend [Spend by category]", "Open bills [To do]", "View cards [Latest activity]",
        ])
    }

    func testSegmentsSayWhatTheyChooseBetween() {
        let month = Fake("AXRadioButton", "This month")
        month.isOn = true
        let reading = read([Fake("AXRadioGroup", "Period", [Fake("AXRadioButton", "This week"), month])])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.role) \($0.label) [\($0.context ?? "")]" }, ["radio This week [Period]", "radio This month [Period]"])
        XCTAssertEqual(reading.snapshot.elements[1].state, ["checked"])
    }

    func testARowOfATreeThatOpensNamesItsArrowAndIsNotAHeading() {
        let arrow = Fake("AXDisclosureTriangle", frame: CGRect(x: 4, y: 500, width: 14, height: 14))
        let assets = Fake("AXRow", frame: CGRect(x: 0, y: 496, width: 400, height: 24), [Fake("AXCell", "", [arrow, Fake("AXHeading", "1000, Assets")])])
        let checking = Fake("AXRow", frame: CGRect(x: 0, y: 470, width: 400, height: 24), [Fake("AXCell", "", [Fake.text("1010 Operating Checking")])])
        let reading = read([Fake("AXHeading", "Accounting"), Fake("AXOutline", "Chart of accounts", frame: CGRect(x: 0, y: 0, width: 400, height: 520), [assets, checking])])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.role) \($0.label) [\($0.context ?? "")]" }, [
            "treeitem 1000, Assets [Chart of accounts › Accounting]",
            "button 1000, Assets [Chart of accounts › Accounting]",
            "treeitem 1010 Operating Checking [Chart of accounts › Accounting]",
        ])
        XCTAssertEqual(reading.snapshot.elements[1].state, ["collapsed"])
        XCTAssertEqual(reading.snapshot.headings, ["Accounting"])
    }

    func testWhereAControlIsIsSaidOnceAndAToolbarIsOnlyAToolbar() {
        let row = Fake("AXRow", frame: CGRect(x: 0, y: 400, width: 200, height: 24), [Fake("AXCell", "", [Fake.text("Software renewals")])])
        let reading = read([
            Fake("AXHeading", "Saved reports"),
            Fake("AXOutline", "Saved reports", frame: CGRect(x: 0, y: 0, width: 200, height: 500), [row]),
            Fake("AXToolbar", "", [Fake("AXButton", "Hide Sidebar")]),
        ])
        XCTAssertEqual(reading.snapshot.elements.map { "\($0.label) [\($0.context ?? "")]" }, ["Software renewals [Saved reports]", "Hide Sidebar [toolbar]"])
    }

    func testARowThatIsOnlyAnIconIsNamedByWhatTheIconIsCalled() {
        func row(_ icon: String, y: CGFloat) -> Fake { Fake("AXRow", frame: CGRect(x: 0, y: y, width: 64, height: 28), [Fake("AXCell", "", [Fake("AXImage", icon)])]) }
        let sidebar = Fake("AXOutline", "Sidebar", frame: CGRect(x: 0, y: 0, width: 64, height: 600), [row("Wallet", y: 500), row("", y: 470), row("Team", y: 440)])
        XCTAssertEqual(read([sidebar]).snapshot.elements.map { "\($0.role) \($0.label)" }, ["treeitem Wallet", "treeitem Team"], "a row with an icon nobody described is still left out")
    }
}
