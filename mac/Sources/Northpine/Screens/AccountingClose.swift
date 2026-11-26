import SwiftUI

// The other two sections of Accounting: the sync with the ledger, which
// takes a while and can fail, and the checklist that closes a month.

struct LedgerSync: View {
    @EnvironmentObject var store: Store
    @State private var running = false
    @State private var progress = 0.0
    @State private var auto = true
    @State private var every = "Every hour"
    @State private var log: [String] = ["Jun 1, 9:02 AM: 214 expenses and 12 bills sent", "May 31, 6:00 PM: 38 expenses sent", "May 31, 9:00 AM: 2 bills failed, missing account"]
    @State private var disconnecting = false

    private var unmapped: Int { store.company.transactions.filter { $0.accountCode == nil && $0.status == .cleared }.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                StatTile(label: "Ready to sync", value: "\(store.company.transactions.filter { $0.accountCode != nil }.prefix(214).count)")
                StatTile(label: "Missing an account", value: "\(unmapped)", note: "These are skipped")
                StatTile(label: "Failed last time", value: "2")
            }
            HStack {
                Button(running ? "Syncing…" : "Sync now") { start() }
                    .disabled(running)
                if running {
                    ProgressView(value: progress).frame(width: 220).accessibilityLabel("Sync progress")
                    Button("Stop") { running = false }
                }
                Spacer()
                Button("Retry failed") { log.insert("Jun 1: 2 bills sent on retry", at: 0) }
            }
            Toggle("Sync automatically", isOn: $auto)
            Picker("How often", selection: $every) {
                ForEach(["Every hour", "Every day at 6 PM", "Every Monday"], id: \.self) { Text($0).tag($0) }
            }
            .frame(width: 300)
            .disabled(!auto)
            Panel(title: "History") {
                ForEach(log, id: \.self) { Text($0).font(.callout) }
            }
            Spacer()
            Button("Disconnect Ledgerline…", role: .destructive) { disconnecting = true }
        }
        .confirmationDialog("Disconnect Ledgerline?", isPresented: $disconnecting) {
            Button("Disconnect", role: .destructive) {}
            Button("Stay Connected", role: .cancel) {}
        } message: {
            Text("Nothing already synced is removed, but nothing new is sent until you connect again.")
        }
    }

    private func start() {
        running = true
        progress = 0
        Task { @MainActor in
            while running, progress < 1 {
                try? await Task.sleep(nanoseconds: 250_000_000)
                progress = min(1, progress + 0.12)
            }
            if running { log.insert("Jun 1: 214 expenses and 12 bills sent", at: 0) }
            running = false
        }
    }
}

/** Closing a month: a list of checks, each ticked by hand or fixed elsewhere, and a button that stays off until all are done. */
struct MonthEndClose: View {
    @EnvironmentObject var store: Store
    @State private var month = "May 2026"
    @State private var done: Set<String> = ["Reconcile the card statement", "Approve all reimbursements"]
    @State private var closed: Set<String> = ["April 2026", "March 2026"]
    @State private var confirming = false

    static let checks: [(String, String, Nav?)] = [
        ("Reconcile the card statement", "The statement and Northpine agree to the cent.", nil),
        ("Approve all reimbursements", "Nothing submitted is still waiting.", .reimbursements),
        ("Collect missing receipts", "Every purchase over $75 has one, or is marked lost.", .expenses),
        ("Map every purchase to an account", "Nothing is left as Not mapped.", .expenses),
        ("Pay or accrue open bills", "Each bill due in the month is paid or accrued.", .bills),
        ("Review budgets that ran over", "Their owners have been told.", .budgets),
    ]

    private var isClosed: Bool { closed.contains(month) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Picker("Month", selection: $month) {
                    ForEach(["May 2026", "April 2026", "March 2026"], id: \.self) { Text($0).tag($0) }
                }
                .frame(width: 220)
                StatusBadge(text: isClosed ? "Closed" : "Open", color: isClosed ? .green : .orange)
                Spacer()
                Text("\(isClosed ? Self.checks.count : done.count) of \(Self.checks.count) done").foregroundStyle(.secondary)
            }
            ForEach(Self.checks, id: \.0) { check in
                HStack(alignment: .firstTextBaseline) {
                    Toggle(isOn: Binding(get: { isClosed || done.contains(check.0) }, set: { if $0 { done.insert(check.0) } else { done.remove(check.0) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(check.0)
                            Text(check.1).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .disabled(isClosed)
                    Spacer()
                    if let nav = check.2, !isClosed, !done.contains(check.0) {
                        Button("Go to \(nav.title)") { store.go(nav) }
                    }
                }
            }
            Spacer()
            HStack {
                if isClosed {
                    Button("Reopen \(month)") { closed.remove(month) }
                } else {
                    Button("Close \(month)") { confirming = true }
                        .disabled(done.count < Self.checks.count)
                    if done.count < Self.checks.count { Text("Finish every check to close the month.").foregroundStyle(.secondary) }
                }
                Spacer()
                Button("Export trial balance") {}
            }
        }
        .confirmationDialog("Close \(month)?", isPresented: $confirming) {
            Button("Close the Month") { closed.insert(month) }
            Button("Not Yet", role: .cancel) {}
        } message: {
            Text("Purchases dated in a closed month can't be changed until it is reopened.")
        }
    }
}
