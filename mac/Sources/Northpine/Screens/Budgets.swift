import SwiftUI

// Budgets: one for each department, each with lines for its categories. A
// budget opens in place to show its lines, and is edited in a sheet.

struct BudgetsView: View {
    @EnvironmentObject var store: Store
    @State private var open: Set<Budget.ID> = ["b1"]
    @State private var editing: Budget?
    @State private var view = "Year to date"
    @State private var onlyOver = false

    private var budgets: [Budget] { store.company.budgets.filter { !onlyOver || $0.spent > $0.limit || $0.lines.contains { $0.spent > $0.limit } } }

    var body: some View {
        ScrollView {
            Page {
                PageHeader(title: "Budgets", subtitle: "\(Format.round(store.company.budgets.reduce(0) { $0 + $1.spent })) spent of \(Format.round(store.company.budgets.reduce(0) { $0 + $1.limit }))") {
                    Picker("View", selection: $view) {
                        ForEach(["This month", "This quarter", "Year to date"], id: \.self) { Text($0).tag($0) }
                    }
                    .frame(width: 200)
                    Toggle("Over budget only", isOn: $onlyOver)
                    Button("Expand all") { open = Set(store.company.budgets.map(\.id)) }
                    Button("Collapse all") { open = [] }
                }

                ForEach(budgets) { budget in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Button {
                                if open.contains(budget.id) { open.remove(budget.id) } else { open.insert(budget.id) }
                            } label: {
                                Image(systemName: open.contains(budget.id) ? "chevron.down" : "chevron.right")
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(open.contains(budget.id) ? "Hide \(budget.name) lines" : "Show \(budget.name) lines")
                            Text(budget.name).font(.headline).accessibilityAddTraits(.isHeader)
                            if budget.spent > budget.limit { StatusBadge(text: "Over budget", color: .red) }
                            Spacer()
                            Text("\(Format.round(budget.spent)) of \(Format.round(budget.limit))").monospacedDigit().foregroundStyle(.secondary)
                            Button("Edit") { editing = budget }
                                .accessibilityLabel("Edit \(budget.name)")
                        }
                        ProgressView(value: min(budget.spent, budget.limit), total: max(budget.limit, 1))
                            .tint(budget.spent > budget.limit ? .red : .accentColor)
                            .accessibilityLabel("\(budget.name) used")
                        if open.contains(budget.id) {
                            ForEach(budget.lines) { line in
                                HStack {
                                    Text(line.category).frame(width: 140, alignment: .leading)
                                    ProgressView(value: min(line.spent, line.limit), total: max(line.limit, 1))
                                        .tint(line.spent > line.limit ? .red : .accentColor)
                                        .accessibilityLabel("\(line.category) in \(budget.name)")
                                    Text("\(Format.percent(line.spent, of: line.limit))").monospacedDigit().frame(width: 50, alignment: .trailing)
                                    Text(Format.round(line.limit)).monospacedDigit().foregroundStyle(.secondary).frame(width: 80, alignment: .trailing)
                                }
                                .padding(.leading, 24)
                            }
                            Text("Owned by \(store.person(budget.ownerID)?.name ?? "nobody")").font(.caption).foregroundStyle(.secondary).padding(.leading, 24)
                        }
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
                }
            }
        }
        .sheet(item: $editing) { budget in EditBudgetSheet(budgetID: budget.id).environmentObject(store) }
    }
}

struct EditBudgetSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let budgetID: String
    @State private var limits: [String: Double] = [:]
    @State private var ownerID = ""
    @State private var alertAt = 80.0
    @State private var block = false

    private var budget: Budget? { store.company.budgets.first { $0.id == budgetID } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Edit \(budget?.name ?? "budget")").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Form {
                Picker("Owner", selection: $ownerID) {
                    ForEach(store.company.people.filter { $0.role != .employee }) { Text($0.name).tag($0.id) }
                }
                ForEach(budget?.lines ?? []) { line in
                    Stepper(value: Binding(get: { limits[line.id] ?? line.limit }, set: { limits[line.id] = $0 }), in: 0...200_000, step: 1_000) {
                        Text("\(line.category): \(Format.round(limits[line.id] ?? line.limit))")
                    }
                    .accessibilityLabel("\(line.category) limit")
                }
                Slider(value: $alertAt, in: 50...100, step: 5) { Text("Warn the owner at \(Int(alertAt))%") }
                Toggle("Decline purchases once the budget is spent", isOn: $block)
            }
            HStack {
                Text("New total \(Format.round((budget?.lines ?? []).reduce(0) { $0 + (limits[$1.id] ?? $1.limit) }))").foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save budget") { save() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(22)
        .frame(width: 460)
        .onAppear { ownerID = budget?.ownerID ?? "p1" }
    }

    private func save() {
        guard let index = store.company.budgets.firstIndex(where: { $0.id == budgetID }) else { return dismiss() }
        for line in store.company.budgets[index].lines.indices {
            let id = store.company.budgets[index].lines[line].id
            if let limit = limits[id] { store.company.budgets[index].lines[line].limit = limit }
        }
        store.company.budgets[index].limit = store.company.budgets[index].lines.reduce(0) { $0 + $1.limit }
        store.company.budgets[index].ownerID = ownerID
        dismiss()
    }
}
