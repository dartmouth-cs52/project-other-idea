import SwiftUI

// Cards: every card the company has issued, in a table that can be searched,
// narrowed and sorted.

struct CardsView: View {
    @EnvironmentObject var store: Store
    @State private var search = ""
    @State private var status = "All statuses"
    @State private var kind = "All types"
    @State private var selected: Card.ID?
    @State private var order = [KeyPathComparator(\CardRow.name)]

    /** A card with the holder's name beside it, so the table can sort by either. */
    struct CardRow: Identifiable {
        let card: Card
        let holder: String
        var id: String { card.id }
        var name: String { card.name }
        var limit: Double { card.limit }
        var spent: Double { card.spent }
        var status: String { card.status.rawValue }
    }

    private var rows: [CardRow] {
        store.company.cards
            .filter { status == "All statuses" || $0.status.rawValue == status }
            .filter { kind == "All types" || $0.kind.rawValue == kind }
            .map { CardRow(card: $0, holder: store.person($0.holderID)?.name ?? "") }
            .filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.holder.localizedCaseInsensitiveContains(search) || $0.card.last4.contains(search) }
            .sorted(using: order)
    }

    var body: some View {
        list
    }

    private var list: some View {
        Page {
            PageHeader(title: "Cards", subtitle: "\(store.company.cards.filter { $0.status == .active }.count) active cards across \(Set(store.company.cards.map(\.holderID)).count) people") {
                Button("Issue card") { store.issuingCard = true }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
            }

            HStack {
                TextField("Search cards", text: $search)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 240)
                Picker("Status", selection: $status) {
                    Text("All statuses").tag("All statuses")
                    ForEach(Card.Status.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
                }
                .frame(width: 190)
                Picker("Type", selection: $kind) {
                    Text("All types").tag("All types")
                    ForEach(Card.Kind.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
                }
                .frame(width: 170)
                Spacer()
                Text("\(rows.count) cards").foregroundStyle(.secondary)
            }

            Table(rows, selection: $selected, sortOrder: $order) {
                TableColumn("Card", value: \.name) { row in
                    Text(row.name)
                }
                TableColumn("Holder", value: \.holder)
                TableColumn("Number") { row in
                    Text("•••• \(row.card.last4)").monospacedDigit()
                }
                .width(90)
                TableColumn("Type") { row in Text(row.card.kind.rawValue) }
                    .width(70)
                TableColumn("Spent", value: \.spent) { row in
                    Text("\(Format.round(row.spent)) of \(Format.round(row.limit))").monospacedDigit()
                }
                TableColumn("Status", value: \.status) { row in
                    StatusBadge(text: row.status, color: row.card.status.color)
                }
                .width(90)
            }
            .contextMenu(forSelectionType: Card.ID.self) { ids in
                if let id = ids.first, let card = store.card(id) {
                    Button("Open Card") { open(id) }
                    Button(card.status == .frozen ? "Unfreeze Card" : "Freeze Card") { store.toggleFreeze(id) }
                        .disabled(card.status == .cancelled)
                }
            } primaryAction: { ids in
                if let id = ids.first { open(id) }
            }

            HStack {
                Button("Open card") { if let selected { open(selected) } }
                    .disabled(selected == nil)
                Button(store.card(selected)?.status == .frozen ? "Unfreeze" : "Freeze") { if let selected { store.toggleFreeze(selected) } }
                    .disabled(selected == nil || store.card(selected)?.status == .cancelled)
                Spacer()
            }
        }
    }

    private func open(_ id: Card.ID) {
        store.detail = "card/\(id)"
    }
}
