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
}
