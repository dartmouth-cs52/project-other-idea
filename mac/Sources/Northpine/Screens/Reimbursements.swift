import SwiftUI

// Reimbursements: what people paid out of their own pocket and want back.
// Requests are grouped by where they stand, each group folding shut, and a
// new one is written in a sheet with a date picker and lines that grow.

struct ReimbursementsView: View {
    @EnvironmentObject var store: Store
    @State private var open: Set<Reimbursement.Status> = [.submitted, .approved]
    @State private var writing = false
    @State private var mineOnly = false

    private func requests(_ status: Reimbursement.Status) -> [Reimbursement] {
        store.company.reimbursements.filter { $0.status == status && (!mineOnly || $0.personID == "p1") }
    }

    var body: some View {
        ScrollView {
            Page {
                PageHeader(title: "Reimbursements", subtitle: "\(Format.round(requests(.approved).reduce(0) { $0 + $1.total })) approved and waiting to be paid") {
                    Toggle("Only mine", isOn: $mineOnly)
                        .toggleStyle(.switch)
                    Button("Pay approved") { payAll() }
                        .disabled(requests(.approved).isEmpty)
                    Button("New request") { writing = true }
                }

                ForEach(Reimbursement.Status.allCases, id: \.self) { status in
                    DisclosureGroup(isExpanded: Binding(get: { open.contains(status) }, set: { if $0 { open.insert(status) } else { open.remove(status) } })) {
                        if requests(status).isEmpty { Text("Nothing here.").foregroundStyle(.secondary).padding(.vertical, 4) }
                        ForEach(requests(status)) { request in
                            row(request)
                        }
                    } label: {
                        Text("\(status.rawValue) (\(requests(status).count))").font(.headline)
                    }
                }
            }
        }
        .sheet(isPresented: $writing) { NewReimbursementSheet(showing: $writing).environmentObject(store) }
    }

    private func row(_ request: Reimbursement) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(request.title)
                Text("\(store.person(request.personID)?.name ?? ""), \(request.lines.count) items, \(Format.ago(request.submitted))").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(Format.money(request.total)).monospacedDigit()
            switch request.status {
            case .draft:
                Button("Submit") { set(request.id, .submitted) }.accessibilityLabel("Submit \(request.title)")
            case .submitted:
                Button("Approve") { set(request.id, .approved) }.accessibilityLabel("Approve \(request.title)")
                Button("Reject") { set(request.id, .rejected) }.accessibilityLabel("Reject \(request.title)")
            case .approved:
                Button("Pay now") { set(request.id, .paid) }.accessibilityLabel("Pay \(request.title) now")
            case .paid, .rejected:
                EmptyView()
            }
        }
        .padding(.vertical, 3)
    }

    private func set(_ id: String, _ status: Reimbursement.Status) {
        guard let index = store.company.reimbursements.firstIndex(where: { $0.id == id }) else { return }
        store.company.reimbursements[index].status = status
    }

    private func payAll() {
        for index in store.company.reimbursements.indices where store.company.reimbursements[index].status == .approved {
            store.company.reimbursements[index].status = .paid
        }
    }
}

struct NewReimbursementSheet: View {
    @EnvironmentObject var store: Store
    @Binding var showing: Bool
    @State private var title = ""
    @State private var lines: [Draft] = [Draft()]
    @State private var payTo = "Bank account ending 4471"

    struct Draft: Identifiable {
        let id = UUID()
        var what = ""
        var category = "Travel"
        var amount = ""
        var date = Seed.today
    }

    private var total: Double { lines.reduce(0) { $0 + (Double($1.amount) ?? 0) } }
    private var ready: Bool { !title.isEmpty && lines.allSatisfy { !$0.what.isEmpty && (Double($0.amount) ?? 0) > 0 } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New reimbursement request").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            TextField("Title", text: $title, prompt: Text("Like Chicago client trip"))

            ForEach($lines) { $line in
                let number = (lines.firstIndex { $0.id == line.id } ?? 0) + 1
                HStack {
                    TextField("What", text: $line.what, prompt: Text("What you paid for"))
                        .accessibilityLabel("Item \(number)")
                    Picker("Category", selection: $line.category) {
                        ForEach(["Travel", "Meals", "Office supplies", "Events"], id: \.self) { Text($0).tag($0) }
                    }
                    .labelsHidden()
                    .frame(width: 130)
                    .accessibilityLabel("Category of item \(number)")
                    DatePicker("Date", selection: $line.date, in: ...Seed.today, displayedComponents: .date)
                        .labelsHidden()
                        .accessibilityLabel("Date of item \(number)")
                    TextField("Amount", text: $line.amount)
                        .frame(width: 80)
                        .accessibilityLabel("Amount of item \(number)")
                }
            }

            HStack {
                Button("Add item") { lines.append(Draft()) }
                Button("Remove last item") { lines.removeLast() }
                    .disabled(lines.count < 2)
                Spacer()
                Text("Total \(Format.money(total))").monospacedDigit()
            }

            Picker("Pay to", selection: $payTo) {
                ForEach(["Bank account ending 4471", "Bank account ending 9020", "Payroll"], id: \.self) { Text($0).tag($0) }
            }

            HStack {
                Button("Save as draft") { save(.draft) }
                    .disabled(title.isEmpty)
                Spacer()
                Button("Cancel") { showing = false }
                    .keyboardShortcut(.cancelAction)
                Button("Submit request") { save(.submitted) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!ready)
            }
        }
        .padding(22)
        .frame(width: 640)
    }

    private func save(_ status: Reimbursement.Status) {
        let number = store.company.reimbursements.count + 1
        let made = lines.enumerated().map { index, line in
            Reimbursement.Line(id: "r\(number)-\(index + 1)", what: line.what, category: line.category, amount: Double(line.amount) ?? 0, date: line.date)
        }
        store.company.reimbursements.insert(Reimbursement(id: "r\(number)", title: title, personID: "p1", submitted: Seed.today, status: status, lines: made), at: 0)
        showing = false
    }
}
