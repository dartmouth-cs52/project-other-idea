import SwiftUI

// The window: the sidebar on the left and the screen it chose on the right.

struct Shell: View {
    @EnvironmentObject var store: Store
    @State private var search = ""
    @State private var showingBell = false

    var body: some View {
        NavigationSplitView {
            List(selection: $store.nav) {
                ForEach(NavGroup.all) { group in
                    Section(group.title) {
                        ForEach(group.items) { item in
                            Label(item.title, systemImage: item.symbol).tag(item)
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 210)
        } detail: {
            screen(store.nav ?? .home)
        }
        .navigationTitle((store.nav ?? .home).title)
        .searchable(text: $search, placement: .toolbar, prompt: "Search Northpine")
        .onSubmit(of: .search) {
            // The toolbar's search is the palette's, started from what was typed.
            if let found = Palette.search(search, in: store).first { found.run(store) }
            search = ""
        }
        .toolbar { ShellToolbar(store: store, search: $search, showingBell: $showingBell) }
        .alert("Export started", isPresented: Binding(get: { store.exported != nil }, set: { if !$0 { store.exported = nil } })) {
            Button("OK") {}
        } message: {
            Text("\(store.exported ?? "Your file") will be in Downloads in a moment.")
        }
        .sheet(isPresented: $store.paletteOpen) { PaletteSheet().environmentObject(store) }
        .sheet(isPresented: $store.issuingCard) { IssueCardSheet().environmentObject(store) }
    }

    @ViewBuilder
    private func screen(_ nav: Nav) -> some View {
        switch nav {
        case .home: HomeView()
        case .cards: CardsView()
        case .expenses: ExpensesView()
        case .reimbursements: ReimbursementsView()
        case .approvals: ApprovalsView()
        case .bills: BillsView()
        case .vendors: VendorsView()
        case .budgets: BudgetsView()
        case .accounting: AccountingView()
        case .reports: ReportsView()
        case .people: PeopleView()
        case .policies: PoliciesView()
        case .inbox: InboxView()
        case .help: HelpView()
        }
    }
}
