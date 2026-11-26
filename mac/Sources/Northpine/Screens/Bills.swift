import SwiftUI

// Bills: what the company owes its vendors. A bill is paid from a sheet that
// asks how and when, and a bill from a vendor on hold cannot be paid at all.

struct BillsView: View {
    @EnvironmentObject var store: Store
    @State private var tab = "To pay"
    @State private var search = ""
    @State private var selected: Bill.ID?
    @State private var paying: Bill?
    @State private var adding = false
    @State private var order = [KeyPathComparator(\Row.due)]

    struct Row: Identifiable {
        let bill: Bill
        let vendor: String
        var id: String { bill.id }
        var number: String { bill.number }
        var due: Date { bill.due }
        var amount: Double { bill.amount }
        var status: String { bill.status.rawValue }
    }

    static let tabs: [(String, [Bill.Status])] = [
        ("Drafts", [.draft]), ("To approve", [.awaiting]), ("To pay", [.approved, .overdue]), ("Scheduled", [.scheduled]), ("Paid", [.paid]),
    ]

    private var rows: [Row] {
        let statuses = Self.tabs.first { $0.0 == tab }?.1 ?? []
        return store.company.bills
            .filter { statuses.contains($0.status) }
            .map { Row(bill: $0, vendor: store.vendor($0.vendorID)?.name ?? "") }
            .filter { search.isEmpty || $0.vendor.localizedCaseInsensitiveContains(search) || $0.number.localizedCaseInsensitiveContains(search) }
            .sorted(using: order)
    }
    private var chosen: Bill? { store.company.bills.first { $0.id == selected } }
    private var onHold: Bool { store.vendor(chosen?.vendorID)?.status == .onHold }

    var body: some View {
        let rows = rows
        return Page {
            PageHeader(title: "Bills", subtitle: "\(Format.round(rows.reduce(0) { $0 + $1.amount })) in \(rows.count) bills") {
                Button("Add bill") { adding = true }
            }

            HStack {
                Picker("Show", selection: $tab) {
                    ForEach(Self.tabs, id: \.0) { Text($0.0).tag($0.0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 440)
                Spacer()
                TextField("Search bills", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 200)
            }

            Table(rows, selection: $selected, sortOrder: $order) {
                TableColumn("Bill", value: \.number).width(90)
                TableColumn("Vendor", value: \.vendor)
                TableColumn("Due", value: \.due) { Text(Format.date($0.due)) }.width(100)
                TableColumn("Amount", value: \.amount) { Text(Format.money($0.amount)).monospacedDigit() }.width(100)
                TableColumn("Status", value: \.status) { StatusBadge(text: $0.status, color: $0.bill.status.color) }.width(130)
            }

            HStack {
                switch chosen?.status {
                case .draft:
                    Button("Send for approval") { set(.awaiting) }
                    Button("Delete draft", role: .destructive) { store.company.bills.removeAll { $0.id == selected }; selected = nil }
                case .awaiting:
                    Button("Approve bill") { set(.approved) }
                    Button("Send back") { set(.draft) }
                case .approved, .overdue:
                    Button("Pay bill…") { paying = chosen }
                        .disabled(onHold)
                        .help(onHold ? "This vendor is on hold" : "")
                    if onHold { Text("This vendor is on hold. Lift the hold in Vendors to pay.").foregroundStyle(.secondary) }
                case .scheduled:
                    Button("Cancel payment") { set(.approved) }
                case .paid:
                    Button("Download remittance") {}
                case nil:
                    Text("Choose a bill to see what can be done with it.").foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .sheet(item: $paying) { bill in PayBillSheet(bill: bill).environmentObject(store) }
        .sheet(isPresented: $adding) { NewBillSheet(showing: $adding).environmentObject(store) }
    }

    private func set(_ status: Bill.Status) {
        guard let index = store.company.bills.firstIndex(where: { $0.id == selected }) else { return }
        store.company.bills[index].status = status
        selected = nil
    }
}

/** Paying one bill: how, from where, and when. */
struct PayBillSheet: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let bill: Bill
    @State private var method = "Bank transfer"
    @State private var from = "Operating Checking"
    @State private var when = "Now"
    @State private var date = Seed.today.addingTimeInterval(3 * 86_400)
    @State private var memo = ""
    @State private var confirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Pay bill").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text("\(store.vendor(bill.vendorID)?.name ?? ""), \(bill.number), \(Format.money(bill.amount))").foregroundStyle(.secondary)
            Form {
                Picker("Payment method", selection: $method) {
                    ForEach(["Bank transfer", "Check", "Northpine card"], id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.radioGroup)
                Picker("Pay from", selection: $from) {
                    ForEach(["Operating Checking", "Savings"], id: \.self) { Text($0).tag($0) }
                }
                .disabled(method == "Northpine card")
                Picker("When", selection: $when) {
                    ForEach(["Now", "On the due date", "On a date I choose"], id: \.self) { Text($0).tag($0) }
                }
                if when == "On a date I choose" {
                    DatePicker("Payment date", selection: $date, in: Seed.today..., displayedComponents: .date)
                }
                TextField("Memo for the vendor", text: $memo)
            }
            if method == "Check" { Text("A check takes five to seven days to arrive.").font(.caption).foregroundStyle(.secondary) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(when == "Now" ? "Pay \(Format.money(bill.amount))" : "Schedule payment") { confirming = true }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(22)
        .frame(width: 460)
        .confirmationDialog("Send \(Format.money(bill.amount)) to \(store.vendor(bill.vendorID)?.name ?? "")?", isPresented: $confirming) {
            Button(when == "Now" ? "Send Payment" : "Schedule Payment") {
                if let index = store.company.bills.firstIndex(where: { $0.id == bill.id }) {
                    store.company.bills[index].status = when == "Now" ? .paid : .scheduled
                }
                dismiss()
            }
            Button("Go Back", role: .cancel) {}
        }
    }
}

struct NewBillSheet: View {
    @EnvironmentObject var store: Store
    @Binding var showing: Bool
    @State private var vendorID = "v1"
    @State private var number = ""
    @State private var amount = ""
    @State private var due = Seed.today.addingTimeInterval(30 * 86_400)
    @State private var account = "6600"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add a bill").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Form {
                Picker("Vendor", selection: $vendorID) {
                    ForEach(store.company.vendors.filter { $0.status != .archived }) { Text($0.name).tag($0.id) }
                }
                TextField("Invoice number", text: $number)
                TextField("Amount", text: $amount)
                DatePicker("Due date", selection: $due, displayedComponents: .date)
                Picker("Account", selection: $account) {
                    ForEach(store.company.accounts.flatMap { $0.children ?? [] }.filter { $0.kind == .expense }) { Text("\($0.code) \($0.name)").tag($0.code) }
                }
            }
            HStack {
                Spacer()
                Button("Cancel") { showing = false }
                    .keyboardShortcut(.cancelAction)
                Button("Save draft") {
                    store.company.bills.insert(Bill(id: "bill\(store.company.bills.count + 1)", number: number, vendorID: vendorID, amount: Double(amount) ?? 0, issued: Seed.today, due: due, status: .draft, accountCode: account, memo: ""), at: 0)
                    showing = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(number.isEmpty || (Double(amount) ?? 0) <= 0)
            }
        }
        .padding(22)
        .frame(width: 440)
    }
}
