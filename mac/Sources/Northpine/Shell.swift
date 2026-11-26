import SwiftUI

// The window: the sidebar on the left and the screen it chose on the right.

struct Shell: View {
    @EnvironmentObject var store: Store

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
        default: ComingSoon(nav: nav)
        }
    }
}
