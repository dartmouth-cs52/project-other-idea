import SwiftUI

// One card: who holds it, what it may spend, and the switches that freeze it,
// lock it to a category or cancel it for good.

struct CardDetailView: View {
    @EnvironmentObject var store: Store
    let cardID: String
    @State private var showingNumber = false
    @State private var confirmingCancel = false
    @State private var saved = false

    private var card: Card { store.card(cardID) ?? store.company.cards[0] }
    private var holder: Person? { store.person(card.holderID) }
    private var purchases: [Transaction] { store.company.transactions.filter { $0.cardID == cardID }.prefix(8).map { $0 } }

    var body: some View {
        ScrollView {
            Page {
                Button {
                    store.detail = nil
                } label: {
                    Label("All cards", systemImage: "chevron.left")
                }
                .buttonStyle(.link)

                PageHeader(title: card.name, subtitle: "\(card.kind.rawValue) card ending \(card.last4), held by \(holder?.name ?? "nobody")") {
                    StatusBadge(text: card.status.rawValue, color: card.status.color)
                    Button("Show card number") { showingNumber = true }
                        .disabled(card.status == .cancelled)
                        .popover(isPresented: $showingNumber, arrowEdge: .bottom) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Card number").font(.headline).accessibilityAddTraits(.isHeader)
                                Text("4821 •••• •••• \(card.last4)").font(.title3.monospaced())
                                Text("Expires 09/28").foregroundStyle(.secondary)
                                Button("Copy number") { showingNumber = false }
                            }
                            .padding(16)
                        }
                }

                HStack(alignment: .top, spacing: 12) {
                    Panel(title: "Spending limit") {
                        HStack {
                            Text("Limit")
                            Slider(value: limit, in: 100...50_000, step: 100)
                                .accessibilityLabel("Limit")
                            Stepper(Format.round(card.limit), value: limit, in: 100...50_000, step: 500)
                                .frame(width: 130)
                        }
                        Picker("Resets", selection: binding(\.period)) {
                            ForEach(Card.Period.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .frame(width: 260)
                        ProgressView(value: min(card.spent, card.limit), total: card.limit)
                            .accessibilityLabel("Spent so far")
                        Text("\(Format.money(card.spent)) spent, \(Format.money(max(0, card.limit - card.spent))) left")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Panel(title: "Controls") {
                        Toggle("Freeze this card", isOn: Binding(get: { card.status == .frozen }, set: { _ in store.toggleFreeze(cardID) }))
                            .disabled(card.status == .cancelled)
                        Toggle("Lock to one category", isOn: Binding(get: { !card.categories.isEmpty }, set: { on in store.change(card: cardID) { $0.categories = on ? ["Travel"] : [] } }))
                        if !card.categories.isEmpty {
                            Picker("Category", selection: Binding(get: { card.categories[0] }, set: { new in store.change(card: cardID) { $0.categories = [new] } })) {
                                ForEach(Seed.categories, id: \.self) { Text($0).tag($0) }
                            }
                            .frame(width: 260)
                        }
                        Picker("Budget", selection: binding(\.budgetID)) {
                            Text("No budget").tag(String?.none)
                            ForEach(store.company.budgets) { Text($0.name).tag(String?.some($0.id)) }
                        }
                        .frame(width: 260)
                        Divider()
                        Button("Cancel card…", role: .destructive) { confirmingCancel = true }
                            .disabled(card.status == .cancelled)
                    }
                }

                Panel(title: "Recent purchases") {
                    if purchases.isEmpty { Text("Nothing has been bought on this card yet.").foregroundStyle(.secondary) }
                    ForEach(purchases) { purchase in
                        HStack {
                            Text(purchase.merchant)
                            Text(purchase.category).foregroundStyle(.secondary)
                            Spacer()
                            Text(Format.date(purchase.date)).foregroundStyle(.secondary)
                            Text(Format.money(purchase.amount)).monospacedDigit().frame(width: 90, alignment: .trailing)
                        }
                    }
                }

                HStack {
                    Button("Save changes") { saved = true }
                        .keyboardShortcut("s")
                    if saved { Text("Saved").foregroundStyle(.secondary) }
                }
            }
        }
        .confirmationDialog("Cancel \(card.name)?", isPresented: $confirmingCancel) {
            Button("Cancel Card", role: .destructive) { store.change(card: cardID) { $0.status = .cancelled } }
            Button("Keep Card", role: .cancel) {}
        } message: {
            Text("A cancelled card can't be turned back on. Subscriptions charged to it will fail.")
        }
    }

    private var limit: Binding<Double> { binding(\.limit) }

    private func binding<Value>(_ path: WritableKeyPath<Card, Value>) -> Binding<Value> {
        Binding(get: { card[keyPath: path] }, set: { new in saved = false; store.change(card: cardID) { $0[keyPath: path] = new } })
    }
}
