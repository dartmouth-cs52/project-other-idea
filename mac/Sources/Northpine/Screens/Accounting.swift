import SwiftUI

// Accounting: where spend meets the books. Four sections across the top. Two
// are here: the chart of accounts, a tree, and the mappings that say which
// account each category is booked to. The other two are in AccountingClose.swift.

struct AccountingView: View {
    @EnvironmentObject var store: Store

    static let tabs = ["Chart of accounts", "Mappings", "Sync", "Month-end close"]

    var body: some View {
        let tab = store.accountingTab
        return Page {
            PageHeader(title: "Accounting", subtitle: "Connected to Ledgerline. Last synced 2 hours ago.")
            Picker("Section", selection: $store.accountingTab) {
                ForEach(Self.tabs, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 560)

            switch tab {
            case "Chart of accounts": ChartOfAccounts()
            case "Mappings": Mappings()
            case "Sync": LedgerSync()
            default: MonthEndClose()
            }
        }
    }
}

struct ChartOfAccounts: View {
    @EnvironmentObject var store: Store
    @State private var selected: Account.ID?
    @State private var adding = false
    @State private var showInactive = true
    @State private var name = ""
    @State private var code = ""
    @State private var parent = "6000"

    private var accounts: [Account] {
        showInactive ? store.company.accounts : store.company.accounts.map { group in
            var group = group
            group.children = group.children?.filter(\.active)
            return group
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button("Add account") { adding = true }
                Button(isActive(selected) ? "Deactivate" : "Reactivate") { toggle() }
                    .disabled(selected == nil || selected?.hasSuffix("000") == true)
                Toggle("Show inactive accounts", isOn: $showInactive)
                Spacer()
            }
            List(accounts, children: \.children, selection: $selected) { account in
                HStack {
                    Text(account.code).monospacedDigit().foregroundStyle(.secondary)
                    Text(account.name)
                    Spacer()
                    if !account.active { StatusBadge(text: "Inactive") }
                    Text(account.kind.rawValue).font(.caption).foregroundStyle(.secondary)
                }
                .tag(account.id)
            }
            .accessibilityLabel("Chart of accounts")
        }
        .sheet(isPresented: $adding) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Add an account").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Form {
                    Picker("Under", selection: $parent) {
                        ForEach(store.company.accounts) { Text("\($0.code) \($0.name)").tag($0.code) }
                    }
                    TextField("Account number", text: $code)
                    if taken { Text("That number is already in use.").font(.caption).foregroundStyle(.red) }
                    TextField("Account name", text: $name)
                }
                HStack {
                    Spacer()
                    Button("Cancel") { adding = false }
                        .keyboardShortcut(.cancelAction)
                    Button("Add account") { add() }
                        .keyboardShortcut(.defaultAction)
                        .disabled(name.isEmpty || code.count != 4 || taken)
                }
            }
            .padding(22)
            .frame(width: 420)
        }
    }

    private var taken: Bool { store.company.accounts.contains { $0.code == code || ($0.children ?? []).contains { $0.code == code } } }

    private func isActive(_ id: Account.ID?) -> Bool {
        store.company.accounts.flatMap { $0.children ?? [] }.first { $0.id == id }?.active ?? true
    }

    private func toggle() {
        for group in store.company.accounts.indices {
            guard let child = store.company.accounts[group].children?.firstIndex(where: { $0.id == selected }) else { continue }
            store.company.accounts[group].children?[child].active.toggle()
        }
    }

    private func add() {
        guard let group = store.company.accounts.firstIndex(where: { $0.code == parent }) else { return }
        let kind = store.company.accounts[group].kind
        store.company.accounts[group].children?.append(Account(code: code, name: name, kind: kind))
        name = ""
        code = ""
        adding = false
    }
}

/** Which account each spending category is booked to. One pop-up for each category. */
struct Mappings: View {
    @EnvironmentObject var store: Store
    @State private var map: [String: String] = [:]
    @State private var saved = false
    @State private var applyToPast = false

    private var expenseAccounts: [Account] { store.company.accounts.flatMap { $0.children ?? [] }.filter { $0.kind == .expense && $0.active } }
    private var changed: Bool { !map.isEmpty && !saved }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Each category is booked to one account. Purchases with no category go to 6900 Other Expenses.").foregroundStyle(.secondary)
            ScrollView {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                    ForEach(Seed.categories, id: \.self) { category in
                        GridRow {
                            Text(category)
                            Image(systemName: "arrow.right").foregroundStyle(.secondary).accessibilityHidden(true)
                            Picker("Account for \(category)", selection: Binding(get: { map[category] ?? Seed.account(for: category) }, set: { map[category] = $0; saved = false })) {
                                ForEach(expenseAccounts) { Text("\($0.code) \($0.name)").tag($0.code) }
                            }
                            .labelsHidden()
                            .frame(width: 320)
                        }
                    }
                }
            }
            HStack {
                Toggle("Apply to past purchases too", isOn: $applyToPast)
                Spacer()
                if saved { Text("Mappings saved").foregroundStyle(.secondary) }
                Button("Reset to defaults") { map = [:]; saved = false }
                    .disabled(map.isEmpty)
                Button("Save mappings") {
                    if applyToPast {
                        for index in store.company.transactions.indices {
                            if let code = map[store.company.transactions[index].category] { store.company.transactions[index].accountCode = code }
                        }
                    }
                    saved = true
                }
                .disabled(!changed)
            }
        }
    }
}
