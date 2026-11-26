import SwiftUI

// Reports: spend cut by category, department, person or merchant, over a
// range of dates the person picks. A report can be saved, exported, or sent
// on a schedule from a sheet.

struct ReportsView: View {
    @EnvironmentObject var store: Store
    @State private var groupBy = "Category"
    @State private var from = Seed.daysAgo(30)
    @State private var to = Seed.today
    @State private var includePending = false
    @State private var saved = ["Monthly spend by department", "Software renewals", "Travel, last quarter"]
    @State private var chosenSaved: String?
    @State private var scheduling = false
    @State private var naming = false
    @State private var newName = ""
    @State private var exported: String?
    @State private var asTable = false

    private var totals: [(String, Double, Int)] {
        let purchases = store.company.transactions.filter { $0.date >= from && $0.date <= to.addingTimeInterval(86_400) && ($0.status == .cleared || (includePending && $0.status == .pending)) }
        let groups = Dictionary(grouping: purchases) { purchase -> String in
            switch groupBy {
            case "Department": return store.person(purchase.personID)?.department ?? "Unknown"
            case "Person": return store.person(purchase.personID)?.name ?? "Unknown"
            case "Merchant": return purchase.merchant
            default: return purchase.category
            }
        }
        return groups.map { ($0.key, $0.value.reduce(0) { $0 + $1.amount }, $0.value.count) }.sorted { $0.1 > $1.1 }
    }

    var body: some View {
        let totals = totals
        let top = totals.first?.1 ?? 1
        return Page {
            PageHeader(title: "Reports", subtitle: "\(Format.round(totals.reduce(0) { $0 + $1.1 })) from \(Format.date(from)) to \(Format.date(to))") {
                Button("Save report…") { naming = true }
                    .popover(isPresented: $naming, arrowEdge: .bottom) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Save this report").font(.headline).accessibilityAddTraits(.isHeader)
                            TextField("Report name", text: $newName).frame(width: 240)
                            HStack {
                                Spacer()
                                Button("Save") {
                                    saved.insert(newName, at: 0)
                                    newName = ""
                                    naming = false
                                }
                                .disabled(newName.isEmpty)
                            }
                        }
                        .padding(14)
                    }
                Button("Schedule…") { scheduling = true }
                Menu("Export") {
                    Button("Spreadsheet (CSV)") { exported = "CSV" }
                    Button("Document (PDF)") { exported = "PDF" }
                    Button("Copy as Table") { exported = "copied" }
                }
                .frame(width: 100)
            }

            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Saved reports").font(.headline).accessibilityAddTraits(.isHeader)
                    List(saved, id: \.self, selection: $chosenSaved) { Text($0) }
                        .accessibilityLabel("Saved reports")
                        .frame(width: 220)
                    Button("Delete saved report") { saved.removeAll { $0 == chosenSaved }; chosenSaved = nil }
                        .disabled(chosenSaved == nil)
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Picker("Group by", selection: $groupBy) {
                            ForEach(["Category", "Department", "Person", "Merchant"], id: \.self) { Text($0).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 420)
                        Spacer()
                        Toggle("Show as table", isOn: $asTable)
                            .toggleStyle(.switch)
                    }
                    HStack {
                        DatePicker("From", selection: $from, in: ...to, displayedComponents: .date)
                        DatePicker("To", selection: $to, in: from...Seed.today, displayedComponents: .date)
                        Menu("Quick range") {
                            Button("Last 7 Days") { from = Seed.daysAgo(7); to = Seed.today }
                            Button("Last 30 Days") { from = Seed.daysAgo(30); to = Seed.today }
                            Button("This Quarter") { from = Seed.daysAgo(61); to = Seed.today }
                            Button("Year to Date") { from = Seed.daysAgo(151); to = Seed.today }
                        }
                        .frame(width: 130)
                        Toggle("Include pending", isOn: $includePending)
                        Spacer()
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(totals.prefix(14), id: \.0) { name, amount, count in
                                HStack {
                                    Text(name).frame(width: 190, alignment: .leading).lineLimit(1)
                                    if asTable {
                                        Text("\(count) purchases").foregroundStyle(.secondary).frame(width: 110, alignment: .trailing)
                                    } else {
                                        GeometryReader { space in
                                            RoundedRectangle(cornerRadius: 3).fill(Color.accentColor.opacity(0.75)).frame(width: max(2, space.size.width * amount / top))
                                        }
                                        .frame(height: 14)
                                        .accessibilityHidden(true)
                                    }
                                    Text(Format.round(amount)).monospacedDigit().frame(width: 90, alignment: .trailing)
                                }
                            }
                            if totals.isEmpty { Text("Nothing was spent in this range.").foregroundStyle(.secondary) }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: $scheduling) { ScheduleReportSheet(showing: $scheduling).environmentObject(store) }
        .alert(exported == "copied" ? "Copied" : "Export started", isPresented: Binding(get: { exported != nil }, set: { if !$0 { exported = nil } })) {
            Button("OK") {}
        } message: {
            Text(exported == "copied" ? "The table is on the clipboard." : "Your \(exported ?? "") file will be in Downloads in a moment.")
        }
    }
}

struct ScheduleReportSheet: View {
    @EnvironmentObject var store: Store
    @Binding var showing: Bool
    @State private var every = "Every week"
    @State private var day = "Monday"
    @State private var time = Seed.today
    @State private var recipients: Set<String> = ["p1"]
    @State private var format = "PDF"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Schedule this report").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Form {
                Picker("Send", selection: $every) {
                    ForEach(["Every day", "Every week", "Every month"], id: \.self) { Text($0).tag($0) }
                }
                if every == "Every week" {
                    Picker("On", selection: $day) {
                        ForEach(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], id: \.self) { Text($0).tag($0) }
                    }
                }
                DatePicker("At", selection: $time, displayedComponents: .hourAndMinute)
                Picker("Format", selection: $format) {
                    ForEach(["PDF", "CSV"], id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.radioGroup)
            }
            Text("Send to").font(.headline).accessibilityAddTraits(.isHeader)
            ForEach(store.company.people.filter { $0.role == .admin || $0.role == .finance }.prefix(5)) { person in
                Toggle(person.name, isOn: Binding(get: { recipients.contains(person.id) }, set: { if $0 { recipients.insert(person.id) } else { recipients.remove(person.id) } }))
            }
            HStack {
                Spacer()
                Button("Cancel") { showing = false }
                    .keyboardShortcut(.cancelAction)
                Button("Schedule report") { showing = false }
                    .keyboardShortcut(.defaultAction)
                    .disabled(recipients.isEmpty)
            }
        }
        .padding(22)
        .frame(width: 420)
    }
}
