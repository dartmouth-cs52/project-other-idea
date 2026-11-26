import SwiftUI

// Expenses: every purchase on every card. The table takes many rows at once,
// so what is done to them is in a menu that acts on the selection.

struct ExpensesView: View {
    @EnvironmentObject var store: Store
    @State private var search = ""
    @State private var show = "All"
    @State private var category = "Any category"
    @State private var selection = Set<Transaction.ID>()
    @State private var order = [KeyPathComparator(\Row.date, order: .reverse)]
    @State private var exported: String?

    struct Row: Identifiable {
        let purchase: Transaction
        let person: String
        var id: String { purchase.id }
        var date: Date { purchase.date }
        var merchant: String { purchase.merchant }
        var amount: Double { purchase.amount }
        var category: String { purchase.category }
        var status: String { purchase.status.rawValue }
    }

    private var rows: [Row] {
        store.company.transactions
            .filter { show == "All" || $0.status.rawValue == show }
            .filter { category == "Any category" || $0.category == category }
            .filter { !store.onlyMissingReceipts || !$0.hasReceipt }
            .map { Row(purchase: $0, person: store.person($0.personID)?.name ?? "") }
            .filter { search.isEmpty || $0.merchant.localizedCaseInsensitiveContains(search) || $0.person.localizedCaseInsensitiveContains(search) }
            .sorted(using: order)
    }

    var body: some View {
        if let id = store.detail?.split(separator: "/").last.map(String.init), store.company.transactions.contains(where: { $0.id == id }) {
            ExpenseDetailView(expenseID: id)
        } else {
            list
        }
    }

    private var list: some View {
        let rows = rows
        return Page {
            PageHeader(title: "Expenses", subtitle: "\(rows.count) purchases, \(Format.round(rows.reduce(0) { $0 + $1.amount })) in all") {
                Menu("Export") {
                    Button("As CSV") { exported = "CSV" }
                    Button("As PDF") { exported = "PDF" }
                    Divider()
                    Button("To accounting…") { exported = "accounting" }
                }
                .frame(width: 100)
                Menu("Actions") {
                    Button("Mark as Reviewed") { change { $0.status = .cleared } }
                    Button("Flag for Review") { change { $0.status = .flagged } }
                    Button("Request Receipts") { change { $0.memo = "Receipt requested" } }
                    Menu("Move to Category") {
                        ForEach(Seed.categories, id: \.self) { name in
                            Button(name) { change { $0.category = name } }
                        }
                    }
                }
                .frame(width: 110)
                .disabled(selection.isEmpty)
            }

            HStack {
                Picker("Show", selection: $show) {
                    Text("All").tag("All")
                    ForEach(Transaction.Status.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 300)
                Picker("Category", selection: $category) {
                    Text("Any category").tag("Any category")
                    ForEach(Seed.categories, id: \.self) { Text($0).tag($0) }
                }
                .frame(width: 190)
                // Never squeezed: a label with no room wraps a letter to a line, and the checkbox says it is a tall thin strip.
                Toggle("Missing receipt only", isOn: $store.onlyMissingReceipts)
                    .fixedSize()
                Spacer()
                TextField("Search expenses", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 150)
            }

            Table(rows, selection: $selection, sortOrder: $order) {
                TableColumn("Date", value: \.date) { Text(Format.date($0.date)) }
                    .width(100)
                TableColumn("Merchant", value: \.merchant)
                TableColumn("Person", value: \.person)
                TableColumn("Category", value: \.category)
                TableColumn("Receipt") { row in
                    Image(systemName: row.purchase.hasReceipt ? "paperclip" : "exclamationmark.triangle")
                        .foregroundStyle(row.purchase.hasReceipt ? Color.secondary : .orange)
                        .accessibilityLabel(row.purchase.hasReceipt ? "Receipt attached" : "Receipt missing")
                }
                .width(54)
                TableColumn("Amount", value: \.amount) { Text(Format.money($0.amount)).monospacedDigit() }
                    .width(90)
                TableColumn("Status", value: \.status) { StatusBadge(text: $0.status, color: $0.purchase.status.color) }
                    .width(84)
            }
            .contextMenu(forSelectionType: Transaction.ID.self) { ids in
                Button("Open Expense") { if let id = ids.first { store.detail = "expense/\(id)" } }
                Button("Flag for Review") { selection = ids; change { $0.status = .flagged } }
            } primaryAction: { ids in
                if let id = ids.first { store.detail = "expense/\(id)" }
            }

            HStack {
                Text(selection.isEmpty ? "Nothing selected" : "\(selection.count) selected").foregroundStyle(.secondary)
                Button("Open expense") { if let id = selection.first { store.detail = "expense/\(id)" } }
                    .disabled(selection.count != 1)
                Button("Clear selection") { selection = [] }
                    .disabled(selection.isEmpty)
                Spacer()
            }
        }
        .alert("Export started", isPresented: Binding(get: { exported != nil }, set: { if !$0 { exported = nil } })) {
            Button("OK") {}
        } message: {
            Text(exported == "accounting" ? "These expenses are on their way to your accounting system." : "Your \(exported ?? "") file will be in Downloads in a moment.")
        }
    }

    /** Changes every selected purchase. */
    private func change(_ change: (inout Transaction) -> Void) {
        for index in store.company.transactions.indices where selection.contains(store.company.transactions[index].id) {
            change(&store.company.transactions[index])
        }
    }
}
