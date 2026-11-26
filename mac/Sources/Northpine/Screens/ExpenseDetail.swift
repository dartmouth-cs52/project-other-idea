import SwiftUI

// One expense: what was bought, the receipt, where it is booked, and a sheet
// that splits it across categories.

struct ExpenseDetailView: View {
    @EnvironmentObject var store: Store
    let expenseID: String
    @State private var splitting = false
    @State private var attaching = false
    @State private var note = ""

    private var index: Int? { store.company.transactions.firstIndex { $0.id == expenseID } }
    private var expense: Transaction { index.map { store.company.transactions[$0] } ?? store.company.transactions[0] }

    var body: some View {
        ScrollView {
            Page {
                Button {
                    store.detail = nil
                } label: {
                    Label("All expenses", systemImage: "chevron.left")
                }
                .buttonStyle(.link)

                PageHeader(title: expense.merchant, subtitle: "\(Format.money(expense.amount)) on \(Format.date(expense.date)) by \(store.person(expense.personID)?.name ?? "")") {
                    StatusBadge(text: expense.status.rawValue, color: expense.status.color)
                    Button("Split…") { splitting = true }
                    Button(expense.status == .flagged ? "Remove flag" : "Flag") { set { $0.status = $0.status == .flagged ? .cleared : .flagged } }
                }

                HStack(alignment: .top, spacing: 12) {
                    Panel(title: "Details") {
                        Form {
                            Picker("Category", selection: field(\.category)) {
                                ForEach(Seed.categories, id: \.self) { Text($0).tag($0) }
                            }
                            Picker("Account", selection: field(\.accountCode)) {
                                Text("Not mapped").tag(String?.none)
                                ForEach(store.company.accounts.flatMap { $0.children ?? [] }.filter { $0.kind == .expense }) { account in
                                    Text("\(account.code) \(account.name)").tag(String?.some(account.code))
                                }
                            }
                            TextField("Memo", text: field(\.memo), prompt: Text("What was this for?"))
                        }
                        Text("Paid with \(store.card(expense.cardID)?.name ?? "a card") ending \(store.card(expense.cardID)?.last4 ?? "")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Panel(title: "Receipt") {
                        if expense.hasReceipt {
                            Label("receipt-\(expense.id).pdf", systemImage: "doc.richtext")
                            HStack {
                                Button("View receipt") { attaching = true }
                                Button("Remove receipt", role: .destructive) { set { $0.hasReceipt = false } }
                            }
                        } else {
                            Text("No receipt is attached. Policy asks for one over $75.").foregroundStyle(.secondary)
                            Button("Attach receipt…") { set { $0.hasReceipt = true } }
                            Button("Mark receipt as lost") { set { $0.memo = "Receipt lost"; $0.hasReceipt = true } }
                        }
                    }
                }

                Panel(title: "Comments") {
                    Text("Jonas Lind: Is this the renewal or a new seat?").foregroundStyle(.secondary)
                    HStack {
                        TextField("Add a comment", text: $note)
                        Button("Post comment") { note = "" }
                            .disabled(note.isEmpty)
                    }
                }
            }
        }
        .sheet(isPresented: $splitting) { SplitSheet(expense: expense, showing: $splitting) }
        .popover(isPresented: $attaching) {
            Text("receipt-\(expense.id).pdf would open in Preview.").padding()
        }
    }

    private func set(_ change: (inout Transaction) -> Void) {
        guard let index else { return }
        change(&store.company.transactions[index])
    }

    private func field<Value>(_ path: WritableKeyPath<Transaction, Value>) -> Binding<Value> {
        Binding(get: { expense[keyPath: path] }, set: { new in set { $0[keyPath: path] = new } })
    }
}

/** Splits one expense across categories. The parts must add up to the whole before it can be saved. */
struct SplitSheet: View {
    let expense: Transaction
    @Binding var showing: Bool
    @State private var parts: [Part] = []

    struct Part: Identifiable {
        let id = UUID()
        var category: String
        var amount: String
    }

    private var total: Double { parts.reduce(0) { $0 + (Double($1.amount) ?? 0) } }
    private var left: Double { ((expense.amount - total) * 100).rounded() / 100 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Split expense").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text("\(expense.merchant), \(Format.money(expense.amount))").foregroundStyle(.secondary)

            ForEach($parts) { $part in
                HStack {
                    Picker("Category", selection: $part.category) {
                        ForEach(Seed.categories, id: \.self) { Text($0).tag($0) }
                    }
                    .labelsHidden()
                    .accessibilityLabel("Category of part \(position(part) + 1)")
                    TextField("Amount", text: $part.amount)
                        .frame(width: 90)
                        .accessibilityLabel("Amount of part \(position(part) + 1)")
                    Button {
                        parts.removeAll { $0.id == part.id }
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove part \(position(part) + 1)")
                    .disabled(parts.count <= 2)
                }
            }

            HStack {
                Button("Add part") { parts.append(Part(category: "Meals", amount: left > 0 ? String(format: "%.2f", left) : "")) }
                Button("Split evenly") {
                    let share = String(format: "%.2f", expense.amount / Double(parts.count))
                    for index in parts.indices { parts[index].amount = share }
                }
                Spacer()
                Text(abs(left) < 0.02 ? "Adds up" : left > 0 ? "\(Format.money(left)) left to assign" : "\(Format.money(-left)) too much")
                    .foregroundStyle(abs(left) < 0.02 ? Color.secondary : .red)
            }

            HStack {
                Spacer()
                Button("Cancel") { showing = false }
                    .keyboardShortcut(.cancelAction)
                Button("Save split") { showing = false }
                    .keyboardShortcut(.defaultAction)
                    .disabled(abs(left) >= 0.02)
            }
        }
        .padding(22)
        .frame(width: 460)
        .onAppear {
            parts = [Part(category: expense.category, amount: String(format: "%.2f", expense.amount)), Part(category: "Meals", amount: "")]
        }
    }

    private func position(_ part: Part) -> Int { parts.firstIndex { $0.id == part.id } ?? 0 }
}
