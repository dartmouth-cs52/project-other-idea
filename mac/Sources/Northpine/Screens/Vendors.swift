import SwiftUI

// Vendors: who the company pays. A list to pick from and, for the one picked,
// three tabs: its details, its bills and its documents.

struct VendorsView: View {
    @EnvironmentObject var store: Store
    @State private var search = ""
    @State private var showArchived = false
    @State private var selected: Vendor.ID? = "v1"
    @State private var adding = false
    @State private var archiving = false

    private var vendors: [Vendor] {
        store.company.vendors
            .filter { showArchived || $0.status != .archived }
            .filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
    }
    private var index: Int? { store.company.vendors.firstIndex { $0.id == selected } }

    var body: some View {
        Page {
            PageHeader(title: "Vendors", subtitle: "\(store.company.vendors.filter { $0.status == .active }.count) active, \(store.company.vendors.filter { $0.status == .onHold }.count) on hold") {
                Toggle("Show archived", isOn: $showArchived)
                Button("New vendor") { adding = true }
            }

            HSplitView {
                VStack(spacing: 8) {
                    TextField("Search vendors", text: $search)
                        .textFieldStyle(.roundedBorder)
                    List(vendors, selection: $selected) { vendor in
                        HStack {
                            Text(vendor.name)
                            Spacer()
                            if vendor.status != .active { StatusBadge(text: vendor.status.rawValue, color: vendor.status == .onHold ? .orange : .secondary) }
                        }
                        .tag(vendor.id)
                    }
                    .accessibilityLabel("Vendors")
                }
                .frame(minWidth: 240, idealWidth: 280)

                Group {
                    if let index { detail(index) } else {
                        Text("Choose a vendor.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(minWidth: 400)
            }
        }
        .sheet(isPresented: $adding) { NewVendorSheet(showing: $adding, selected: $selected).environmentObject(store) }
        .confirmationDialog("Archive this vendor?", isPresented: $archiving) {
            Button("Archive Vendor", role: .destructive) { if let index { store.company.vendors[index].status = .archived } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Its bills stay, but no new bill can be added for it.")
        }
    }

    private func detail(_ index: Int) -> some View {
        let vendor = store.company.vendors[index]
        let bills = store.company.bills.filter { $0.vendorID == vendor.id }
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(vendor.name).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Spacer()
                StatusBadge(text: vendor.status.rawValue, color: vendor.status == .active ? .green : vendor.status == .onHold ? .orange : .secondary)
            }
            TabView {
                Form {
                    TextField("Name", text: $store.company.vendors[index].name)
                    TextField("Billing email", text: $store.company.vendors[index].email)
                    Picker("Payment terms", selection: $store.company.vendors[index].terms) {
                        ForEach(["Due on receipt", "Net 15", "Net 30", "Net 45"], id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Country", selection: $store.company.vendors[index].country) {
                        ForEach(["United States", "Canada", "Germany", "United Kingdom"], id: \.self) { Text($0).tag($0) }
                    }
                    Toggle("Hold payments to this vendor", isOn: Binding(get: { vendor.status == .onHold }, set: { store.company.vendors[index].status = $0 ? .onHold : .active }))
                        .disabled(vendor.status == .archived)
                    Button("Archive vendor…", role: .destructive) { archiving = true }
                        .disabled(vendor.status == .archived)
                }
                .padding()
                .tabItem { Text("Details") }

                VStack(alignment: .leading, spacing: 6) {
                    if bills.isEmpty { Text("No bills from this vendor.").foregroundStyle(.secondary) }
                    ForEach(bills.prefix(9)) { bill in
                        HStack {
                            Text(bill.number)
                            StatusBadge(text: bill.status.rawValue, color: bill.status.color)
                            Spacer()
                            Text(Format.money(bill.amount)).monospacedDigit()
                        }
                    }
                    Spacer()
                    Button("See all in Bills") { store.go(.bills) }
                }
                .padding()
                .tabItem { Text("Bills") }

                VStack(alignment: .leading, spacing: 10) {
                    Label(vendor.hasTaxForm ? "W-9 on file" : "No W-9 on file", systemImage: vendor.hasTaxForm ? "checkmark.circle" : "exclamationmark.triangle")
                    Button(vendor.hasTaxForm ? "Replace W-9…" : "Request W-9") { store.company.vendors[index].hasTaxForm = true }
                    Button("Upload contract…") {}
                    Spacer()
                }
                .padding()
                .tabItem { Text("Documents") }
            }
        }
        .padding(.leading, 12)
    }
}

struct NewVendorSheet: View {
    @EnvironmentObject var store: Store
    @Binding var showing: Bool
    @Binding var selected: Vendor.ID?
    @State private var name = ""
    @State private var email = ""
    @State private var category = "Software"
    @State private var terms = "Net 30"
    @State private var askForTaxForm = true

    private var emailLooksRight: Bool { email.contains("@") && email.contains(".") }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("New vendor").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Form {
                TextField("Vendor name", text: $name)
                TextField("Billing email", text: $email)
                if !email.isEmpty, !emailLooksRight { Text("That doesn't look like an email address.").font(.caption).foregroundStyle(.red) }
                Picker("Category", selection: $category) {
                    ForEach(["Software", "Contractors", "Professional services", "Shipping", "Rent", "Utilities", "Insurance", "Travel"], id: \.self) { Text($0).tag($0) }
                }
                Picker("Payment terms", selection: $terms) {
                    ForEach(["Due on receipt", "Net 15", "Net 30", "Net 45"], id: \.self) { Text($0).tag($0) }
                }
                Toggle("Email them a request for a W-9", isOn: $askForTaxForm)
            }
            HStack {
                Spacer()
                Button("Cancel") { showing = false }
                    .keyboardShortcut(.cancelAction)
                Button("Add vendor") {
                    let vendor = Vendor(id: "v\(store.company.vendors.count + 1)", name: name, category: category, email: email, terms: terms, status: .active, country: "United States", hasTaxForm: false)
                    store.company.vendors.insert(vendor, at: 0)
                    selected = vendor.id
                    showing = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.isEmpty || !emailLooksRight)
            }
        }
        .padding(22)
        .frame(width: 440)
    }
}
