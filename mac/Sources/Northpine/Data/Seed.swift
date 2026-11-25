import Foundation

// The made-up company. The same seed always makes the same company, down to
// the cent, so a guide tried twice sees the same screens, and a test can
// name a person or a bill and find them there.

/** SplitMix64: small, quick, and the same on every machine. */
struct Dice {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /** A whole number from `low` up to and including `high`. */
    mutating func roll(_ low: Int, _ high: Int) -> Int {
        low + Int(next() % UInt64(high - low + 1))
    }

    mutating func pick<T>(_ from: [T]) -> T { from[roll(0, from.count - 1)] }

    mutating func chance(_ outOf100: Int) -> Bool { roll(1, 100) <= outOf100 }

    /** An amount of money between the two, to the cent. */
    mutating func money(_ low: Int, _ high: Int) -> Double {
        Double(roll(low * 100, high * 100)) / 100
    }
}

enum Seed {
    static let categories = ["Travel", "Meals", "Software", "Advertising", "Office supplies", "Hardware", "Training", "Shipping", "Events", "Contractors"]
    static let departments = ["Engineering", "Sales", "Marketing", "Finance", "Operations", "Support", "People", "Design"]

    private static let first = ["Maya", "Jonas", "Priya", "Tomas", "Ingrid", "Kwame", "Sofia", "Hiro", "Elena", "Marcus", "Aisha", "Lukas", "Noor", "Diego", "Freya", "Ravi", "Camille", "Oskar", "Thandi", "Wren", "Mateo", "Yuki", "Bianca", "Idris", "Hannah"]
    private static let last = ["Okafor", "Lind", "Raman", "Vega", "Sorensen", "Mensah", "Rossi", "Tanaka", "Petrova", "Bell", "Haddad", "Novak", "Rahimi", "Castillo", "Holm", "Iyer", "Laurent", "Berg", "Dlamini", "Abbott", "Fuentes", "Sato", "Moretti", "Farouk", "Weiss"]
    private static let cities = ["New York", "Austin", "Toronto", "London", "Berlin", "Lisbon", "Singapore", "Remote"]
    private static let merchants: [(String, String)] = [
        ("Delta Air Lines", "Travel"), ("Marriott", "Travel"), ("Lyft", "Travel"), ("Amtrak", "Travel"),
        ("Sweetgreen", "Meals"), ("Blue Bottle Coffee", "Meals"), ("DoorDash", "Meals"),
        ("Figma", "Software"), ("GitHub", "Software"), ("Linear", "Software"), ("Notion", "Software"), ("Datadog", "Software"), ("Amazon Web Services", "Software"),
        ("LinkedIn Ads", "Advertising"), ("Google Ads", "Advertising"),
        ("Staples", "Office supplies"), ("IKEA", "Office supplies"),
        ("Apple Store", "Hardware"), ("B&H Photo", "Hardware"),
        ("Coursera", "Training"), ("O'Reilly Media", "Training"),
        ("FedEx", "Shipping"), ("UPS", "Shipping"),
        ("Eventbrite", "Events"), ("Upwork", "Contractors"),
    ]
    private static let vendorNames: [(String, String)] = [
        ("Harbor Freight Logistics", "Shipping"), ("Brightline Staffing", "Contractors"), ("Cedar & Stone Legal", "Professional services"),
        ("Atlas Cloud Hosting", "Software"), ("Juniper Office Leasing", "Rent"), ("Summit Payroll Partners", "Professional services"),
        ("Lantern Creative Studio", "Advertising"), ("Northwind Catering", "Meals"), ("Quill Print Works", "Office supplies"),
        ("Granite Security Systems", "Hardware"), ("Meridian Insurance Group", "Insurance"), ("Pioneer Travel Desk", "Travel"),
        ("Copperfield Accounting", "Professional services"), ("Tidewater Utilities", "Utilities"), ("Halcyon Event Rentals", "Events"),
        ("Redwood Data Labs", "Software"), ("Kestrel Courier", "Shipping"), ("Sable Recruiting", "Contractors"),
    ]

    /** Noon on 1 June 2026, so nothing on screen depends on the day the app is run. */
    static let today = Date(timeIntervalSince1970: 1_780_315_200)

    static func daysAgo(_ days: Int) -> Date { today.addingTimeInterval(Double(-days) * 86_400) }

    static func company(seed: UInt64 = 52) -> Company {
        var dice = Dice(seed: seed)

        // People. The first four are fixed, so guides and tests have names to count on.
        var people: [Person] = [
            Person(id: "p1", name: "Maya Okafor", email: "maya@northpine.test", role: .admin, department: "Finance", managerID: nil, status: .active, location: "New York"),
            Person(id: "p2", name: "Jonas Lind", email: "jonas@northpine.test", role: .finance, department: "Finance", managerID: "p1", status: .active, location: "Berlin"),
            Person(id: "p3", name: "Priya Raman", email: "priya@northpine.test", role: .manager, department: "Engineering", managerID: "p1", status: .active, location: "Toronto"),
            Person(id: "p4", name: "Tomas Vega", email: "tomas@northpine.test", role: .employee, department: "Sales", managerID: "p3", status: .active, location: "Austin"),
        ]
        var taken = Set(people.map(\.name))
        while people.count < 60 {
            let name = "\(dice.pick(first)) \(dice.pick(last))"
            guard taken.insert(name).inserted else { continue }
            let number = people.count + 1
            let role: Role = dice.chance(12) ? .manager : dice.chance(6) ? .finance : .employee
            let status: Person.Status = dice.chance(6) ? .invited : dice.chance(3) ? .suspended : .active
            let handle = name.lowercased().replacingOccurrences(of: " ", with: ".")
            people.append(Person(id: "p\(number)", name: name, email: "\(handle)@northpine.test", role: role, department: dice.pick(departments), managerID: "p\(dice.roll(1, 3))", status: status, location: dice.pick(cities)))
        }

        // Budgets, one for each department.
        let budgets: [Budget] = departments.enumerated().map { index, department in
            let lines = (0..<4).map { line -> BudgetLine in
                let limit = Double(dice.roll(4, 30) * 1_000)
                return BudgetLine(id: "b\(index + 1)-\(line + 1)", category: categories[(index + line * 2) % categories.count], limit: limit, spent: (limit * Double(dice.roll(15, 115)) / 100).rounded())
            }
            let owner = people.first { $0.department == department && $0.role != .employee } ?? people[0]
            return Budget(id: "b\(index + 1)", name: "\(department) 2026", department: department, ownerID: owner.id, limit: lines.reduce(0) { $0 + $1.limit }, spent: lines.reduce(0) { $0 + $1.spent }, lines: lines)
        }

        // Cards.
        var cards: [Card] = []
        let active = people.filter { $0.status == .active }
        for number in 1...84 {
            let holder = number <= 4 ? people[number - 1] : dice.pick(active)
            let kind: Card.Kind = dice.chance(30) ? .physical : .virtual
            let limit = Double(dice.pick([500, 1_000, 2_500, 5_000, 10_000, 25_000]))
            let status: Card.Status = number <= 4 ? .active : dice.chance(10) ? .frozen : dice.chance(6) ? .cancelled : .active
            let purpose = kind == .physical ? "Travel" : dice.pick(["Software", "Advertising", "Team meals", "Subscriptions", "Events", "Hardware", "Recruiting"])
            cards.append(Card(
                id: "c\(number)",
                name: "\(holder.name.split(separator: " ")[0])'s \(purpose)",
                last4: String(format: "%04d", dice.roll(0, 9_999)),
                holderID: holder.id,
                kind: kind,
                status: status,
                limit: limit,
                period: dice.pick(Card.Period.allCases),
                spent: (limit * Double(dice.roll(0, 96)) / 100).rounded(),
                categories: dice.chance(40) ? [dice.pick(categories)] : [],
                budgetID: budgets.first { $0.department == holder.department }?.id
            ))
        }

        // Transactions, newest first.
        var transactions: [Transaction] = []
        for number in 1...1_200 {
            let card = dice.pick(cards)
            let (merchant, category) = dice.pick(merchants)
            let status: Transaction.Status = dice.chance(80) ? .cleared : dice.chance(50) ? .pending : dice.chance(50) ? .declined : .flagged
            transactions.append(Transaction(
                id: "t\(number)",
                date: daysAgo(number / 14).addingTimeInterval(Double(-dice.roll(0, 80_000))),
                merchant: merchant,
                category: category,
                amount: category == "Travel" ? dice.money(40, 1_800) : category == "Software" ? dice.money(12, 2_400) : dice.money(6, 480),
                cardID: card.id,
                personID: card.holderID,
                status: status,
                hasReceipt: dice.chance(72),
                memo: dice.chance(35) ? dice.pick(["Client visit", "Team offsite", "Annual plan", "Q2 campaign", "New hire setup", "Conference"]) : "",
                accountCode: dice.chance(70) ? Self.account(for: category) : nil
            ))
        }

        // Reimbursements.
        let reimbursements: [Reimbursement] = (1...46).map { number in
            let person = number == 1 ? people[3] : dice.pick(active)
            let lines = (1...dice.roll(1, 4)).map { line in
                Reimbursement.Line(id: "r\(number)-\(line)", what: dice.pick(["Taxi to airport", "Client dinner", "Hotel, two nights", "Parking", "Train ticket", "Conference pass", "Home office chair", "Phone bill"]), category: dice.pick(["Travel", "Meals", "Office supplies", "Events"]), amount: dice.money(9, 620), date: daysAgo(dice.roll(2, 60)))
            }
            let title = dice.pick(["Chicago client trip", "March mileage", "Home office setup", "SaaStr conference", "Team dinner", "Lisbon offsite", "Customer visit, Denver"])
            return Reimbursement(id: "r\(number)", title: title, personID: person.id, submitted: daysAgo(dice.roll(0, 45)), status: dice.pick(Reimbursement.Status.allCases), lines: lines)
        }

        // Vendors and the bills they sent.
        let vendors: [Vendor] = vendorNames.enumerated().map { index, pair in
            let slug = pair.0.lowercased().split(separator: " ")[0]
            return Vendor(id: "v\(index + 1)", name: pair.0, category: pair.1, email: "billing@\(slug).test", terms: dice.pick(["Net 15", "Net 30", "Net 45", "Due on receipt"]), status: index == 4 ? .onHold : dice.chance(8) ? .archived : .active, country: dice.pick(["United States", "Canada", "Germany", "United Kingdom"]), hasTaxForm: dice.chance(75))
        }
        var bills: [Bill] = []
        for number in 1...96 {
            let vendor = dice.pick(vendors)
            let issued = daysAgo(dice.roll(0, 120))
            let due = issued.addingTimeInterval(Double(dice.pick([15, 30, 45])) * 86_400)
            var status = dice.pick([Bill.Status.draft, .awaiting, .approved, .scheduled, .paid, .paid, .paid])
            if status != .paid, status != .draft, due < today { status = .overdue }
            bills.append(Bill(id: "bill\(number)", number: "INV-\(2_000 + number)", vendorID: vendor.id, amount: dice.money(180, 24_000), issued: issued, due: due, status: status, accountCode: Self.account(for: vendor.category), memo: dice.chance(30) ? "Purchase order \(dice.roll(4_000, 4_999))" : ""))
        }

        // What waits for someone to say yes.
        var approvals: [Approval] = []
        for number in 1...38 {
            let kind = dice.pick(Approval.Kind.allCases)
            let requester = dice.pick(active)
            let title: String
            switch kind {
            case .expense: title = "\(dice.pick(merchants).0) over policy"
            case .bill: title = "\(dice.pick(vendors).name) \(dice.pick(bills).number)"
            case .reimbursement: title = dice.pick(reimbursements).title
            case .cardRequest: title = "New \(dice.pick(["virtual", "physical"])) card for \(requester.name.split(separator: " ")[0])"
            case .limitIncrease: title = "Raise limit on \(dice.pick(cards).name)"
            }
            approvals.append(Approval(id: "a\(number)", kind: kind, title: title, requesterID: requester.id, amount: dice.money(60, 9_000), submitted: daysAgo(dice.roll(0, 20)), status: number <= 14 ? .pending : dice.pick(Approval.Status.allCases), note: dice.chance(50) ? dice.pick(["Needed before the offsite.", "Renewal, same price as last year.", "Approved by the client verbally.", "Replaces the cancelled card."]) : ""))
        }

        let policies = [
            Policy(id: "pol1", name: "Receipts required", summary: "A receipt must be attached to any purchase over the amount.", enabled: true, threshold: 75, appliesTo: "Everyone"),
            Policy(id: "pol2", name: "Manager approval", summary: "A manager approves any single purchase over the amount.", enabled: true, threshold: 500, appliesTo: "Everyone"),
            Policy(id: "pol3", name: "Finance approval for bills", summary: "Finance approves any bill over the amount before it can be paid.", enabled: true, threshold: 5_000, appliesTo: "Bills"),
            Policy(id: "pol4", name: "Block alcohol-only purchases", summary: "Purchases at bars and liquor stores are declined.", enabled: false, threshold: nil, appliesTo: "Cards"),
            Policy(id: "pol5", name: "Travel class", summary: "Flights under six hours are booked in economy.", enabled: true, threshold: nil, appliesTo: "Travel"),
            Policy(id: "pol6", name: "Meal limit per person", summary: "Meals are flagged over the amount for each person at the table.", enabled: true, threshold: 60, appliesTo: "Meals"),
            Policy(id: "pol7", name: "Memo required", summary: "A memo saying what a purchase was for is needed over the amount.", enabled: false, threshold: 200, appliesTo: "Everyone"),
        ]

        let notices = [
            Notice(id: "n1", title: "14 requests are waiting for approval", detail: "The oldest has waited six days.", date: daysAgo(0), unread: true, nav: .approvals),
            Notice(id: "n2", title: "Juniper Office Leasing is on hold", detail: "Its bills cannot be paid until the hold is lifted.", date: daysAgo(1), unread: true, nav: .vendors),
            Notice(id: "n3", title: "May is ready to close", detail: "Two checks are still open in Accounting.", date: daysAgo(1), unread: true, nav: .accounting),
            Notice(id: "n4", title: "Marketing is over budget", detail: "Advertising has passed its limit for the year.", date: daysAgo(2), unread: false, nav: .budgets),
            Notice(id: "n5", title: "6 purchases are missing receipts", detail: "Their owners were reminded on Friday.", date: daysAgo(3), unread: false, nav: .expenses),
            Notice(id: "n6", title: "A card was frozen", detail: "Tomas froze his travel card from his phone.", date: daysAgo(4), unread: false, nav: .cards),
        ]

        return Company(name: "Northpine", people: people, cards: cards, transactions: transactions.sorted { $0.date > $1.date }, reimbursements: reimbursements, vendors: vendors, bills: bills, approvals: approvals, budgets: budgets, accounts: chart, policies: policies, notices: notices)
    }

    /** The expense account a category is booked to, until someone maps it elsewhere. */
    static func account(for category: String) -> String {
        switch category {
        case "Travel": return "6100"
        case "Meals": return "6200"
        case "Software": return "6300"
        case "Advertising": return "6400"
        case "Office supplies", "Hardware": return "6500"
        case "Contractors", "Professional services": return "6600"
        case "Rent", "Utilities", "Insurance": return "6700"
        default: return "6900"
        }
    }

    static let chart: [Account] = [
        Account(code: "1000", name: "Assets", kind: .asset, children: [
            Account(code: "1010", name: "Operating Checking", kind: .asset),
            Account(code: "1020", name: "Savings", kind: .asset),
            Account(code: "1200", name: "Accounts Receivable", kind: .asset),
            Account(code: "1500", name: "Prepaid Expenses", kind: .asset),
        ]),
        Account(code: "2000", name: "Liabilities", kind: .liability, children: [
            Account(code: "2010", name: "Accounts Payable", kind: .liability),
            Account(code: "2100", name: "Northpine Card Payable", kind: .liability),
            Account(code: "2200", name: "Accrued Expenses", kind: .liability),
        ]),
        Account(code: "3000", name: "Equity", kind: .equity, children: [
            Account(code: "3010", name: "Retained Earnings", kind: .equity),
        ]),
        Account(code: "4000", name: "Income", kind: .income, children: [
            Account(code: "4010", name: "Subscription Revenue", kind: .income),
            Account(code: "4020", name: "Services Revenue", kind: .income),
        ]),
        Account(code: "6000", name: "Operating Expenses", kind: .expense, children: [
            Account(code: "6100", name: "Travel", kind: .expense),
            Account(code: "6200", name: "Meals and Entertainment", kind: .expense),
            Account(code: "6300", name: "Software and Subscriptions", kind: .expense),
            Account(code: "6400", name: "Advertising", kind: .expense),
            Account(code: "6500", name: "Office and Equipment", kind: .expense),
            Account(code: "6600", name: "Contractors and Professional Fees", kind: .expense),
            Account(code: "6700", name: "Rent, Utilities and Insurance", kind: .expense),
            Account(code: "6900", name: "Other Expenses", kind: .expense, active: false),
        ]),
    ]
}
