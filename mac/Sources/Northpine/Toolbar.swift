import SwiftUI

// The window's toolbar: buttons that are only icons, a search field, the
// bell with what is new, and the menu under the person's own name.

struct ShellToolbar: ToolbarContent {
    @ObservedObject var store: Store
    @Binding var search: String
    @Binding var showingBell: Bool

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button {
                store.detail = nil
            } label: {
                Image(systemName: "chevron.left")
            }
            .help("Back to the list")
            .accessibilityLabel("Back")
            .disabled(store.detail == nil || store.nav == .accounting)
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                store.paletteOpen = true
            } label: {
                Image(systemName: "command")
            }
            .help("Command palette")
            .accessibilityLabel("Command palette")

            Button {
                store.issuingCard = true
            } label: {
                Image(systemName: "plus.rectangle.on.rectangle")
            }
            .help("Issue a card")
            .accessibilityLabel("Issue a card")

            Button {
                showingBell.toggle()
            } label: {
                Image(systemName: store.company.notices.contains(where: \.unread) ? "bell.badge" : "bell")
            }
            .help("Notifications")
            .accessibilityLabel("Notifications")
            .popover(isPresented: $showingBell, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Notifications").font(.headline).accessibilityAddTraits(.isHeader)
                    ForEach(store.company.notices.filter(\.unread)) { notice in
                        Button(notice.title) {
                            showingBell = false
                            store.go(notice.nav)
                        }
                        .buttonStyle(.link)
                    }
                    if !store.company.notices.contains(where: \.unread) { Text("You're all caught up.").foregroundStyle(.secondary) }
                    Divider()
                    Button("Open Inbox") {
                        showingBell = false
                        store.go(.inbox)
                    }
                }
                .padding(14)
                .frame(width: 300, alignment: .leading)
            }

            Menu {
                Button("My Cards") { store.go(.cards) }
                Button("My Reimbursements") { store.go(.reimbursements) }
                Divider()
                Button("Settings…") { Preferences.open() }
                Button("Switch Company…") {}
                Divider()
                Button("Sign Out") { store.signedIn = false }
            } label: {
                Label("Maya Okafor", systemImage: "person.crop.circle")
            }
            .help("Your account")
        }
    }
}
