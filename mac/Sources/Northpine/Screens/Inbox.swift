import SwiftUI

// Inbox: what Northpine has told the person. Read and unread, with the
// buttons Mail has: mark read, archive, and go to what the notice is about.

struct InboxView: View {
    @EnvironmentObject var store: Store
    @State private var filter = "All"
    @State private var selected: Notice.ID?
    @State private var archived: Set<Notice.ID> = []
    @State private var muted: Set<Nav> = []
    @State private var settingUp = false

    private var notices: [Notice] {
        store.company.notices.filter { !archived.contains($0.id) && (filter == "All" || $0.unread) && !muted.contains($0.nav) }
    }
    private var chosen: Notice? { notices.first { $0.id == selected } }

    var body: some View {
        Page {
            PageHeader(title: "Inbox", subtitle: "\(store.company.notices.filter(\.unread).count) unread") {
                Button("Mark all as read") { for index in store.company.notices.indices { store.company.notices[index].unread = false } }
                    .disabled(!store.company.notices.contains(where: \.unread))
                Button("Notification settings") { settingUp = true }
                    .popover(isPresented: $settingUp, arrowEdge: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Tell me about").font(.headline).accessibilityAddTraits(.isHeader)
                            ForEach([Nav.approvals, .vendors, .accounting, .budgets, .expenses, .cards]) { nav in
                                Toggle(nav.title, isOn: Binding(get: { !muted.contains(nav) }, set: { if $0 { muted.remove(nav) } else { muted.insert(nav) } }))
                            }
                        }
                        .padding(14)
                        .frame(width: 220, alignment: .leading)
                    }
            }
            Picker("Show", selection: $filter) {
                ForEach(["All", "Unread"], id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 180)

            HSplitView {
                List(notices, selection: $selected) { notice in
                    HStack {
                        Circle().fill(notice.unread ? Color.accentColor : .clear).frame(width: 7, height: 7)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(notice.title).fontWeight(notice.unread ? .semibold : .regular)
                            Text(Format.ago(notice.date)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .tag(notice.id)
                }
                .accessibilityLabel("Notices")
                .frame(minWidth: 280, idealWidth: 320)

                Group {
                    if let chosen {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(chosen.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                            Text(chosen.detail)
                            HStack {
                                Button("Open \(chosen.nav.title)") { store.go(chosen.nav) }
                                Button(chosen.unread ? "Mark as read" : "Mark as unread") { toggleRead(chosen.id) }
                                Button("Archive") { archived.insert(chosen.id); selected = nil }
                            }
                            Spacer()
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    } else {
                        Text(notices.isEmpty ? "Nothing to read." : "Choose a notice.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(minWidth: 340)
            }
        }
    }

    private func toggleRead(_ id: Notice.ID) {
        guard let index = store.company.notices.firstIndex(where: { $0.id == id }) else { return }
        store.company.notices[index].unread.toggle()
    }
}
