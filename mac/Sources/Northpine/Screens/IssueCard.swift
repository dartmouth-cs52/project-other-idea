import SwiftUI

// Issuing a card: a sheet of three steps, or four when the card is a physical
// one and has to be posted somewhere. Next stays off until the step is filled in.

struct IssueCardSheet: View {
    @EnvironmentObject var store: Store
    @State private var step = 0
    @State private var holderID = "p4"
    @State private var kind = Card.Kind.virtual
    @State private var name = ""
    @State private var limit = "1000"
    @State private var period = Card.Period.monthly
    @State private var locked = false
    @State private var category = "Software"
    @State private var street = ""
    @State private var city = ""
    @State private var postcode = ""
    @State private var express = false
    @State private var agreed = false

    private var steps: [String] { kind == .physical ? ["Cardholder", "Limits", "Delivery", "Review"] : ["Cardholder", "Limits", "Review"] }
    private var current: String { steps[min(step, steps.count - 1)] }
    private var amount: Double? { Double(limit.replacingOccurrences(of: ",", with: "")) }

    private var ready: Bool {
        switch current {
        case "Cardholder": return !name.trimmingCharacters(in: .whitespaces).isEmpty
        case "Limits": return (amount ?? 0) >= 50
        case "Delivery": return !street.isEmpty && !city.isEmpty && postcode.count >= 4
        default: return agreed
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Issue a card").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text("Step \(step + 1) of \(steps.count): \(current)").foregroundStyle(.secondary)
            ProgressView(value: Double(step + 1), total: Double(steps.count))
                .accessibilityLabel("Progress")

            Group {
                switch current {
                case "Cardholder": cardholder
                case "Limits": limits
                case "Delivery": delivery
                default: review
                }
            }
            .frame(minHeight: 190, alignment: .top)

            HStack {
                Button("Cancel") { store.issuingCard = false }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Back") { step -= 1 }
                    .disabled(step == 0)
                if current == "Review" {
                    Button("Issue card") { issue() }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!ready)
                } else {
                    Button("Next") { step += 1 }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!ready)
                }
            }
        }
        .padding(22)
        .frame(width: 480)
    }

    private var cardholder: some View {
        Form {
            Picker("Cardholder", selection: $holderID) {
                ForEach(store.company.people.filter { $0.status == .active }.prefix(25)) { Text($0.name).tag($0.id) }
            }
            Picker("Card type", selection: $kind) {
                ForEach(Card.Kind.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.radioGroup)
            TextField("Card name", text: $name, prompt: Text("What it is for, like Team lunches"))
            if kind == .physical {
                Text("A physical card takes five working days to arrive.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var limits: some View {
        Form {
            TextField("Limit in dollars", text: $limit)
            if (amount ?? 0) < 50 { Text("The limit has to be at least $50.").font(.caption).foregroundStyle(.red) }
            Picker("Resets", selection: $period) {
                ForEach(Card.Period.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            Toggle("Lock to one category", isOn: $locked)
            if locked {
                Picker("Category", selection: $category) {
                    ForEach(Seed.categories, id: \.self) { Text($0).tag($0) }
                }
            }
        }
    }

    private var delivery: some View {
        Form {
            TextField("Street address", text: $street)
            TextField("City", text: $city)
            TextField("Postcode", text: $postcode)
            Toggle("Express delivery, $25", isOn: $express)
        }
    }

    private var review: some View {
        VStack(alignment: .leading, spacing: 8) {
            line("Cardholder", store.person(holderID)?.name ?? "")
            line("Card", "\(kind.rawValue), \(name)")
            line("Limit", "\(Format.round(amount ?? 0)), resets \(period.rawValue.lowercased())")
            line("Category", locked ? category : "Any")
            if kind == .physical { line("Deliver to", "\(street), \(city) \(postcode)") }
            Toggle("The cardholder has read the card policy", isOn: $agreed)
                .padding(.top, 6)
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
            Text(value)
        }
    }

    private func issue() {
        let number = store.company.cards.count + 1
        let card = Card(id: "c\(number)", name: name, last4: String(format: "%04d", 1_000 + number * 37 % 9_000), holderID: holderID, kind: kind, status: .active, limit: amount ?? 1_000, period: period, spent: 0, categories: locked ? [category] : [], budgetID: nil)
        store.company.cards.insert(card, at: 0)
        store.issuingCard = false
        store.nav = .cards
        store.detail = "card/\(card.id)"
    }
}
