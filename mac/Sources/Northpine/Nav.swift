import Foundation

// Where a person can be in Northpine. The sidebar lists these in groups, the
// Go menu lists them again, and each has the path Haptic knows the screen by.

enum Nav: String, CaseIterable, Identifiable, Hashable {
    case home, inbox
    case cards, expenses, reimbursements
    case approvals, bills, vendors
    case budgets, accounting, reports
    case people, policies, help

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .inbox: return "Inbox"
        case .cards: return "Cards"
        case .expenses: return "Expenses"
        case .reimbursements: return "Reimbursements"
        case .approvals: return "Approvals"
        case .bills: return "Bills"
        case .vendors: return "Vendors"
        case .budgets: return "Budgets"
        case .accounting: return "Accounting"
        case .reports: return "Reports"
        case .people: return "People"
        case .policies: return "Policies"
        case .help: return "Help Center"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .inbox: return "tray"
        case .cards: return "creditcard"
        case .expenses: return "list.bullet.rectangle"
        case .reimbursements: return "arrow.uturn.left.circle"
        case .approvals: return "checkmark.seal"
        case .bills: return "doc.text"
        case .vendors: return "building.2"
        case .budgets: return "chart.pie"
        case .accounting: return "books.vertical"
        case .reports: return "chart.bar"
        case .people: return "person.2"
        case .policies: return "shield.lefthalf.filled"
        case .help: return "questionmark.circle"
        }
    }

    /** The screen's name to Haptic, as a page's path is on the web. */
    var path: String { "/" + rawValue }
}

struct NavGroup: Identifiable {
    let title: String
    let items: [Nav]
    var id: String { title }

    static let all: [NavGroup] = [
        NavGroup(title: "Overview", items: [.home, .inbox]),
        NavGroup(title: "Spend", items: [.cards, .expenses, .reimbursements]),
        NavGroup(title: "Payables", items: [.approvals, .bills, .vendors]),
        NavGroup(title: "Finance", items: [.budgets, .accounting, .reports]),
        NavGroup(title: "Company", items: [.people, .policies, .help]),
    ]
}
