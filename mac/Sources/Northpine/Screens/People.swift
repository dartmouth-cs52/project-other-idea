import SwiftUI

// People: everyone in the company, their role and who they answer to.
// Inviting is a sheet, and what each role may do is a grid of checkboxes.

struct PeopleView: View {
    @EnvironmentObject var store: Store
    @State private var tab = "Directory"
    @State private var search = ""
    @State private var department = "All departments"
    @State private var selected: Person.ID?
    @State private var inviting = false
    @State private var order = [KeyPathComparator(\Person.name)]
    @State private var suspending = false

    private var people: [Person] {
        store.company.people
            .filter { department == "All departments" || $0.department == department }
            .filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.email.localizedCaseInsensitiveContains(search) }
            .sorted(using: order)
    }
    private var index: Int? { store.company.people.firstIndex { $0.id == selected } }

    var body: some View {
        Page {
            PageHeader(title: "People", subtitle: "\(store.company.people.filter { $0.status == .active }.count) active, \(store.company.people.filter { $0.status == .invited }.count) invited") {
                Button("Invite people") { inviting = true }
            }
            Picker("Section", selection: $tab) {
                ForEach(["Directory", "Roles and permissions"], id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 320)

            if tab == "Directory" { directory } else { PermissionsGrid() }
        }
        .sheet(isPresented: $inviting) { InviteSheet(showing: $inviting).environmentObject(store) }
        .confirmationDialog("Suspend \(index.map { store.company.people[$0].name } ?? "")?", isPresented: $suspending) {
            Button("Suspend", role: .destructive) { if let index { store.company.people[index].status = .suspended } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Their cards are frozen and they can't sign in until they are restored.")
        }
    }

    private var directory: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Search people", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
                Picker("Department", selection: $department) {
                    Text("All departments").tag("All departments")
                    ForEach(Seed.departments, id: \.self) { Text($0).tag($0) }
                }
                .frame(width: 260)
                Spacer()
            }
            Table(people, selection: $selected, sortOrder: $order) {
                TableColumn("Name", value: \.name)
                TableColumn("Email", value: \.email)
                TableColumn("Department", value: \.department)
                TableColumn("Role") { Text($0.role.rawValue) }.width(90)
                TableColumn("Status") { StatusBadge(text: $0.status.rawValue, color: $0.status == .active ? .green : $0.status == .invited ? .orange : .secondary) }.width(90)
            }
            if let index {
                let person = store.company.people[index]
                HStack {
                    Text(person.name).fontWeight(.semibold)
                    Picker("Role", selection: $store.company.people[index].role) {
                        ForEach(Role.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .frame(width: 190)
                    .disabled(person.id == "p1")
                    Picker("Manager", selection: $store.company.people[index].managerID) {
                        Text("No manager").tag(String?.none)
                        ForEach(store.company.people.filter { $0.role != .employee && $0.id != person.id }) { Text($0.name).tag(String?.some($0.id)) }
                    }
                    .frame(width: 240)
                    Spacer()
                    switch person.status {
                    case .invited: Button("Resend invite") {}
                    case .suspended: Button("Restore") { store.company.people[index].status = .active }
                    case .active: Button("Suspend…", role: .destructive) { suspending = true }.disabled(person.id == "p1")
                    }
                }
            } else {
                Text("Choose a person to change their role or manager.").foregroundStyle(.secondary)
            }
        }
    }
}

/** What each role may do. Admin's column is locked on. */
struct PermissionsGrid: View {
    @State private var allowed: Set<String> = PermissionsGrid.defaults
    @State private var saved = true

    static let abilities = ["Issue cards", "Approve expenses", "Pay bills", "Edit budgets", "Close the books", "Invite people", "Change policies"]
    static let defaults: Set<String> = ["Finance|Issue cards", "Finance|Approve expenses", "Finance|Pay bills", "Finance|Edit budgets", "Finance|Close the books", "Manager|Approve expenses", "Manager|Edit budgets", "Manager|Invite people"]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Tick what each role may do. Admins may do everything.").foregroundStyle(.secondary)
            Grid(alignment: .leading, horizontalSpacing: 28, verticalSpacing: 8) {
                GridRow {
                    Text("")
                    ForEach(Role.allCases) { Text($0.rawValue).font(.headline) }
                }
                ForEach(Self.abilities, id: \.self) { ability in
                    GridRow {
                        Text(ability)
                        ForEach(Role.allCases) { role in
                            Toggle("\(role.rawValue) may \(ability.lowercased())", isOn: Binding(
                                get: { role == .admin || allowed.contains("\(role.rawValue)|\(ability)") },
                                set: { on in
                                    saved = false
                                    if on { allowed.insert("\(role.rawValue)|\(ability)") } else { allowed.remove("\(role.rawValue)|\(ability)") }
                                }
                            ))
                            .labelsHidden()
                            .disabled(role == .admin)
                        }
                    }
                }
            }
            HStack {
                Button("Save permissions") { saved = true }
                    .disabled(saved)
                Button("Restore defaults") { allowed = Self.defaults; saved = false }
                if saved { Text("Up to date").foregroundStyle(.secondary) }
                Spacer()
            }
            Spacer()
        }
    }
}

struct InviteSheet: View {
    @EnvironmentObject var store: Store
    @Binding var showing: Bool
    @State private var emails = ""
    @State private var role = Role.employee
    @State private var department = "Engineering"
    @State private var giveCard = false
    @State private var cardLimit = 500.0
    @State private var message = ""

    private var addresses: [String] { emails.split(whereSeparator: { ", \n".contains($0) }).map(String.init).filter { $0.contains("@") } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Invite people").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Form {
                TextField("Email addresses", text: $emails, prompt: Text("Separate with commas"), axis: .vertical)
                    .lineLimit(2...4)
                Picker("Role", selection: $role) {
                    ForEach(Role.allCases) { Text($0.rawValue).tag($0) }
                }
                Picker("Department", selection: $department) {
                    ForEach(Seed.departments, id: \.self) { Text($0).tag($0) }
                }
                Toggle("Give each a virtual card", isOn: $giveCard)
                if giveCard {
                    Stepper("Card limit \(Format.round(cardLimit))", value: $cardLimit, in: 100...5_000, step: 100)
                }
                TextField("Message", text: $message, prompt: Text("Optional"))
            }
            HStack {
                Text(addresses.isEmpty ? "No addresses yet" : "\(addresses.count) to invite").foregroundStyle(.secondary)
                Spacer()
                Button("Cancel") { showing = false }
                    .keyboardShortcut(.cancelAction)
                Button("Send invites") { send() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(addresses.isEmpty)
            }
        }
        .padding(22)
        .frame(width: 460)
    }

    private func send() {
        for address in addresses {
            let number = store.company.people.count + 1
            let name = address.split(separator: "@")[0].replacingOccurrences(of: ".", with: " ").capitalized
            store.company.people.insert(Person(id: "p\(number)", name: name, email: address, role: role, department: department, managerID: "p1", status: .invited, location: "Remote"), at: 0)
        }
        showing = false
    }
}
