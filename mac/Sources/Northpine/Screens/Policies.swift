import SwiftUI

// Policies: the rules purchases are held to. Each rule is a switch, some
// with an amount, and changes are held until Publish is pressed.

struct PoliciesView: View {
    @EnvironmentObject var store: Store
    @State private var draft: [Policy] = []
    @State private var editing: Policy.ID?
    @State private var amount = ""
    @State private var publishing = false
    @State private var testing = false

    private var changes: Int { zip(draft, store.company.policies).filter { $0 != $1 }.count }

    var body: some View {
        ScrollView {
            Page {
                PageHeader(title: "Policies", subtitle: changes == 0 ? "Everything here is live." : "\(changes) unpublished \(changes == 1 ? "change" : "changes")") {
                    Button("Test a purchase…") { testing = true }
                    Button("Discard changes") { draft = store.company.policies }
                        .disabled(changes == 0)
                    Button("Publish") { publishing = true }
                        .disabled(changes == 0)
                }

                ForEach($draft) { $policy in
                    HStack(alignment: .top) {
                        Toggle(policy.name, isOn: $policy.enabled)
                            .toggleStyle(.switch)
                            .labelsHidden()
                            .accessibilityLabel(policy.name)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(policy.name).fontWeight(.medium)
                            Text(policy.summary).font(.callout).foregroundStyle(.secondary)
                            Text("Applies to \(policy.appliesTo)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if let threshold = policy.threshold {
                            Text("Over \(Format.round(threshold))").monospacedDigit()
                            Button("Change amount") {
                                amount = String(Int(threshold))
                                editing = policy.id
                            }
                            .accessibilityLabel("Change amount for \(policy.name)")
                            .disabled(!policy.enabled)
                            .popover(isPresented: Binding(get: { editing == policy.id }, set: { if !$0 { editing = nil } }), arrowEdge: .leading) {
                                VStack(alignment: .leading, spacing: 10) {
                                    Text(policy.name).font(.headline).accessibilityAddTraits(.isHeader)
                                    TextField("Amount in dollars", text: $amount).frame(width: 200)
                                    HStack {
                                        Spacer()
                                        Button("Set amount") {
                                            if let new = Double(amount) { policy.threshold = new }
                                            editing = nil
                                        }
                                        .disabled(Double(amount) == nil)
                                    }
                                }
                                .padding(14)
                            }
                        }
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
                }
            }
        }
        .onAppear { if draft.isEmpty { draft = store.company.policies } }
        .confirmationDialog("Publish \(changes) \(changes == 1 ? "change" : "changes")?", isPresented: $publishing) {
            Button("Publish Now") { store.company.policies = draft }
            Button("Keep Editing", role: .cancel) {}
        } message: {
            Text("New rules apply to purchases made from now on.")
        }
        .sheet(isPresented: $testing) { TestPurchaseSheet(policies: draft, showing: $testing) }
    }
}

/** Tries a made-up purchase against the rules, to see what would happen to it. */
struct TestPurchaseSheet: View {
    let policies: [Policy]
    @Binding var showing: Bool
    @State private var amount = "120"
    @State private var category = "Meals"
    @State private var hasReceipt = false
    @State private var result: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Test a purchase").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Form {
                TextField("Amount", text: $amount)
                Picker("Category", selection: $category) {
                    ForEach(Seed.categories, id: \.self) { Text($0).tag($0) }
                }
                Toggle("Has a receipt", isOn: $hasReceipt)
            }
            Button("Run test") { run() }
            ForEach(result, id: \.self) { Label($0, systemImage: $0.hasPrefix("Allowed") ? "checkmark.circle" : "exclamationmark.triangle") }
            HStack {
                Spacer()
                Button("Done") { showing = false }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(22)
        .frame(width: 420)
    }

    private func run() {
        let value = Double(amount) ?? 0
        func over(_ id: String) -> Bool { policies.first { $0.id == id && $0.enabled }.map { value > ($0.threshold ?? 0) } ?? false }
        var found: [String] = []
        if over("pol1"), !hasReceipt { found.append("Flagged: a receipt is required") }
        if over("pol2") { found.append("Held: needs a manager's approval") }
        if category == "Meals", over("pol6") { found.append("Flagged: over the meal limit") }
        if over("pol7") { found.append("Flagged: a memo is required") }
        result = found.isEmpty ? ["Allowed with no flags"] : found
    }
}
