import SwiftUI

// The window: the sidebar on the left and the screen it chose on the right.

struct Shell: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var lab: Lab
    @State private var loading = false
    @State private var search = ""
    @State private var showingBell = false

    var body: some View {
        NavigationSplitView {
            List(selection: $store.nav) {
                ForEach(NavGroup.all) { group in
                    let items = group.items.filter(lab.shows)
                    if !items.isEmpty {
                        Section(lab.iconsOnly ? "" : group.title) {
                            ForEach(items) { item in
                                if lab.iconsOnly {
                                    // The words are gone from the screen but not from accessibility, which is how a well made app does it.
                                    Image(systemName: item.symbol).accessibilityLabel(lab.title(item)).help(lab.title(item)).tag(item)
                                } else {
                                    Label(lab.title(item), systemImage: item.symbol).tag(item)
                                }
                            }
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: lab.iconsOnly ? 64 : 190, ideal: lab.iconsOnly ? 64 : 210, max: lab.iconsOnly ? 64 : 320)
        } detail: {
            VStack(spacing: 0) {
                if lab.banner {
                    HStack {
                        Label("Northpine will be down for maintenance on Saturday from 2 to 4 AM.", systemImage: "wrench.and.screwdriver")
                        Spacer()
                        Button("Learn more") { store.go(.help) }
                        Button("Dismiss") { lab.banner = false }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.yellow.opacity(0.25))
                }
                if loading {
                    ProgressView("Loading \(lab.title(store.nav ?? .home))…").frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if lab.shows(store.nav ?? .home) {
                    screen(store.nav ?? .home)
                } else {
                    Page {
                        PageHeader(title: lab.title(store.nav ?? .home), subtitle: lab.plan == .starter ? "This is not part of the Starter plan." : "Your role can't open this. Ask an admin.")
                        if lab.plan == .starter { Button("See plans") { Preferences.open("Plan and billing") } }
                    }
                }
            }
        }
        .onChange(of: store.nav) { _ in
            guard lab.slow else { return }
            loading = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_400_000_000)
                loading = false
            }
        }
        .navigationTitle(lab.title(store.nav ?? .home))
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
