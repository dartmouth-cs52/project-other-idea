import SwiftUI

// The command palette: ⌘K opens a box to type in, and what is typed narrows
// a list of everything the app can do or go to. Return runs the first one.

struct PaletteCommand: Identifiable {
    let id: String
    let title: String
    let hint: String
    let run: @MainActor (Store) -> Void
}

enum Palette {
    @MainActor
    static func commands(_ store: Store) -> [PaletteCommand] {
        var all = Nav.allCases.map { nav in
            PaletteCommand(id: "go-\(nav.rawValue)", title: "Go to \(nav.title)", hint: "Screen") { $0.go(nav) }
        }
        all += [
            PaletteCommand(id: "issue", title: "Issue a card", hint: "Cards") { $0.go(.cards); $0.issuingCard = true },
            PaletteCommand(id: "close", title: "Close the books", hint: "Accounting") { $0.go(.accounting); $0.accountingTab = "Month-end close" },
            PaletteCommand(id: "mappings", title: "Edit account mappings", hint: "Accounting") { $0.go(.accounting); $0.accountingTab = "Mappings" },
            PaletteCommand(id: "sync", title: "Sync with the ledger", hint: "Accounting") { $0.go(.accounting); $0.accountingTab = "Sync" },
            PaletteCommand(id: "support", title: "Contact support", hint: "Help") { $0.go(.help); $0.contacting = true },
            PaletteCommand(id: "settings", title: "Open Settings", hint: "App") { _ in Preferences.open() },
            PaletteCommand(id: "keys", title: "Manage API keys", hint: "Settings") { _ in Preferences.open("Security") },
            PaletteCommand(id: "plan", title: "Change plan", hint: "Settings") { _ in Preferences.open("Plan and billing") },
        ]
        // The people and vendors someone is most likely to be looking for.
        all += store.company.vendors.prefix(6).map { vendor in
            PaletteCommand(id: "vendor-\(vendor.id)", title: vendor.name, hint: "Vendor") { $0.go(.vendors) }
        }
        return all
    }

    /** The commands a search leaves, best first: titles that start with it, then titles that hold it. */
    @MainActor
    static func search(_ text: String, in store: Store) -> [PaletteCommand] {
        let all = commands(store)
        let wanted = text.trimmingCharacters(in: .whitespaces).lowercased()
        guard !wanted.isEmpty else { return Array(all.prefix(8)) }
        let starts = all.filter { $0.title.lowercased().hasPrefix(wanted) || $0.title.lowercased().hasPrefix("go to " + wanted) }
        let holds = all.filter { command in command.title.lowercased().contains(wanted) && !starts.contains { $0.id == command.id } }
        return Array((starts + holds).prefix(8))
    }
}

struct PaletteSheet: View {
    @EnvironmentObject var store: Store
    @State private var text = ""
    @FocusState private var typing: Bool

    var body: some View {
        let found = Palette.search(text, in: store)
        return VStack(alignment: .leading, spacing: 10) {
            Text("Command palette").font(.headline).accessibilityAddTraits(.isHeader)
            TextField("Type a command or a screen", text: $text)
                .textFieldStyle(.roundedBorder)
                .focused($typing)
                .onSubmit { if let first = found.first { run(first) } }
            if found.isEmpty { Text("Nothing matches.").foregroundStyle(.secondary) }
            ForEach(found) { command in
                Button {
                    run(command)
                } label: {
                    HStack {
                        Text(command.title)
                        Spacer()
                        Text(command.hint).foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(command.title)
            }
            HStack {
                Text("Return runs the first one").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Close") { store.paletteOpen = false }
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(18)
        .frame(width: 440)
        .onAppear { typing = true }
    }

    private func run(_ command: PaletteCommand) {
        store.paletteOpen = false
        command.run(store)
    }
}
