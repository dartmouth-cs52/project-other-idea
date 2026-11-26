import SwiftUI

// Home: what the company spent, what waits for the person, and what happened lately.

struct HomeView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var lab: Lab
    @State private var range = "This month"
    @State private var feed: [String] = []
    private let tick = Timer.publish(every: 3, on: .main, in: .common).autoconnect()
    private static let happenings = ["Priya bought $64.20 at Sweetgreen", "A card was issued to Tomas", "Jonas approved INV-2041", "Datadog charged $1,180.00", "Ingrid submitted a reimbursement", "A purchase at Lyft was declined"]

    private var company: Company { store.company }
    private var days: Int { range == "This week" ? 7 : range == "This month" ? 30 : 90 }
    private var recent: [Transaction] { company.transactions.filter { $0.date > Seed.daysAgo(days) && $0.status != .declined } }
    private var pending: [Approval] { company.approvals.filter { $0.status == .pending } }
    private var due: [Bill] { company.bills.filter { $0.status == .overdue || ($0.status == .approved && $0.due < Seed.daysAgo(-7)) } }

    var body: some View {
        ScrollView {
            Page {
                PageHeader(title: "Home", subtitle: "Good morning, Maya. Here is where Northpine stands.") {
                    Picker("Period", selection: $range) {
                        ForEach(["This week", "This month", "This quarter"], id: \.self) { Text($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 300)
                }

                HStack(spacing: 12) {
                    StatTile(label: "Spent on cards", value: Format.round(recent.reduce(0) { $0 + $1.amount }), note: "\(recent.count) purchases")
                    StatTile(label: "Waiting for approval", value: "\(pending.count)", note: Format.round(pending.reduce(0) { $0 + $1.amount }))
                    StatTile(label: "Bills due", value: "\(due.count)", note: Format.round(due.reduce(0) { $0 + $1.amount }))
                    StatTile(label: "Missing receipts", value: "\(recent.filter { !$0.hasReceipt }.count)", note: "of \(recent.count)")
                }

                HStack(alignment: .top, spacing: 12) {
                    Panel(title: "To do") {
                        todo("Review \(pending.count) approvals", "Open approvals", .approvals)
                        todo("Pay \(due.count) bills that are due", "Open bills", .bills)
                        todo("Chase \(recent.filter { !$0.hasReceipt }.count) missing receipts", "Open expenses", .expenses)
                        todo("Close the books for May", "Open accounting", .accounting)
                    }
                    Panel(title: "Spend by category") {
                        ForEach(byCategory.prefix(6), id: \.0) { category, amount in
                            HStack {
                                Text(category)
                                Spacer()
                                Text(Format.round(amount)).monospacedDigit().foregroundStyle(.secondary)
                            }
                            ProgressView(value: amount, total: byCategory.first?.1 ?? 1)
                                .accessibilityLabel("\(category) spend")
                        }
                    }
                }

                if lab.liveFeed {
                    Panel(title: "Happening now") {
                        if feed.isEmpty { Text("Waiting for the first purchase…").foregroundStyle(.secondary) }
                        ForEach(Array(feed.enumerated()), id: \.offset) { _, line in Text(line) }
                    }
                }

                Panel(title: "Latest activity") {
                    ForEach(company.notices.filter { lab.shows($0.nav) }) { notice in
                        HStack(alignment: .firstTextBaseline) {
                            Circle().fill(notice.unread ? Color.accentColor : .clear).frame(width: 7, height: 7)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(notice.title)
                                Text(notice.detail).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Format.ago(notice.date)).font(.caption).foregroundStyle(.secondary)
                            Button("View") { store.go(notice.nav) }
                                .accessibilityLabel("View \(notice.nav.title.lowercased())")
                        }
                    }
                }
            }
        }
        .onReceive(tick) { _ in
            guard lab.liveFeed else { return }
            feed.insert(Self.happenings[feed.count % Self.happenings.count], at: 0)
            if feed.count > 4 { feed.removeLast() }
        }
    }

    private var byCategory: [(String, Double)] {
        Dictionary(grouping: recent, by: \.category)
            .map { ($0.key, $0.value.reduce(0) { $0 + $1.amount }) }
            .sorted { $0.1 > $1.1 }
    }

    /** One thing to do, unless it is on a screen this person is not shown. */
    @ViewBuilder
    private func todo(_ what: String, _ button: String, _ nav: Nav) -> some View {
        if lab.shows(nav) {
            todoRow(what, button, nav)
        }
    }

    private func todoRow(_ what: String, _ button: String, _ nav: Nav) -> some View {
        HStack {
            Text(what)
            Spacer()
            Button(button) { store.go(nav) }
        }
    }
}
