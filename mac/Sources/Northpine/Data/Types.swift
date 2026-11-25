import Foundation

// What Northpine keeps: the people of a company, the cards they hold, what
// they spent, what they are owed, the bills the company owes, and the books
// all of it lands in.

enum Role: String, CaseIterable, Identifiable {
    case admin = "Admin", finance = "Finance", manager = "Manager", employee = "Employee"
    var id: String { rawValue }
}

enum Plan: String, CaseIterable, Identifiable {
    case starter = "Starter", growth = "Growth", enterprise = "Enterprise"
    var id: String { rawValue }
}

struct Person: Identifiable, Hashable {
    enum Status: String, CaseIterable { case active = "Active", invited = "Invited", suspended = "Suspended" }
    let id: String
    var name: String
    var email: String
    var role: Role
    var department: String
    var managerID: String?
    var status: Status
    var location: String
}

struct Card: Identifiable, Hashable {
    enum Kind: String, CaseIterable { case virtual = "Virtual", physical = "Physical" }
    enum Status: String, CaseIterable { case active = "Active", frozen = "Frozen", cancelled = "Cancelled" }
    enum Period: String, CaseIterable { case daily = "Daily", monthly = "Monthly", quarterly = "Quarterly", total = "Total" }
    let id: String
    var name: String
    var last4: String
    var holderID: String
    var kind: Kind
    var status: Status
    var limit: Double
    var period: Period
    var spent: Double
    /** Categories the card may be used for. Empty is any. */
    var categories: [String]
    var budgetID: String?
}

struct Transaction: Identifiable, Hashable {
    enum Status: String, CaseIterable { case cleared = "Cleared", pending = "Pending", declined = "Declined", flagged = "Flagged" }
    let id: String
    var date: Date
    var merchant: String
    var category: String
    var amount: Double
    var cardID: String
    var personID: String
    var status: Status
    var hasReceipt: Bool
    var memo: String
    var accountCode: String?
}

struct Reimbursement: Identifiable, Hashable {
    enum Status: String, CaseIterable { case draft = "Draft", submitted = "Submitted", approved = "Approved", paid = "Paid", rejected = "Rejected" }
    struct Line: Identifiable, Hashable {
        let id: String
        var what: String
        var category: String
        var amount: Double
        var date: Date
    }
    let id: String
    var title: String
    var personID: String
    var submitted: Date
    var status: Status
    var lines: [Line]
    var total: Double { lines.reduce(0) { $0 + $1.amount } }
}

struct Vendor: Identifiable, Hashable {
    enum Status: String, CaseIterable { case active = "Active", onHold = "On hold", archived = "Archived" }
    let id: String
    var name: String
    var category: String
    var email: String
    var terms: String
    var status: Status
    var country: String
    var hasTaxForm: Bool
}

struct Bill: Identifiable, Hashable {
    enum Status: String, CaseIterable { case draft = "Draft", awaiting = "Awaiting approval", approved = "Approved", scheduled = "Scheduled", paid = "Paid", overdue = "Overdue" }
    let id: String
    var number: String
    var vendorID: String
    var amount: Double
    var issued: Date
    var due: Date
    var status: Status
    var accountCode: String
    var memo: String
}

struct Approval: Identifiable, Hashable {
    enum Kind: String, CaseIterable { case expense = "Expense", bill = "Bill", reimbursement = "Reimbursement", cardRequest = "Card request", limitIncrease = "Limit increase" }
    enum Status: String, CaseIterable { case pending = "Pending", approved = "Approved", rejected = "Rejected" }
    let id: String
    var kind: Kind
    var title: String
    var requesterID: String
    var amount: Double
    var submitted: Date
    var status: Status
    var note: String
    /** A reason given when it was rejected. */
    var reason: String = ""
}

struct Budget: Identifiable, Hashable {
    let id: String
    var name: String
    var department: String
    var ownerID: String
    var limit: Double
    var spent: Double
    var lines: [BudgetLine]
}

struct BudgetLine: Identifiable, Hashable {
    let id: String
    var category: String
    var limit: Double
    var spent: Double
}

/** One account of the chart of accounts. Accounts nest: 6000 Operating Expenses holds 6100 Travel. */
struct Account: Identifiable, Hashable {
    enum Kind: String, CaseIterable { case asset = "Asset", liability = "Liability", equity = "Equity", income = "Income", expense = "Expense" }
    var id: String { code }
    let code: String
    var name: String
    var kind: Kind
    var active: Bool = true
    var children: [Account]?
}

struct Policy: Identifiable, Hashable {
    let id: String
    var name: String
    var summary: String
    var enabled: Bool
    /** The amount in dollars the rule turns on, where it has one. */
    var threshold: Double?
    var appliesTo: String
}

/** Something that happened, for Home's feed and the Inbox. */
struct Notice: Identifiable, Hashable {
    let id: String
    var title: String
    var detail: String
    var date: Date
    var unread: Bool
    var nav: Nav
}

/** The whole company. */
struct Company {
    var name: String
    var people: [Person]
    var cards: [Card]
    var transactions: [Transaction]
    var reimbursements: [Reimbursement]
    var vendors: [Vendor]
    var bills: [Bill]
    var approvals: [Approval]
    var budgets: [Budget]
    var accounts: [Account]
    var policies: [Policy]
    var notices: [Notice]
}
