import Foundation

// Things a person might ask of Northpine, each with a way to tell from the
// app itself whether it got done. `HAPTIC_TASK=freeze-card` asks one, the
// autopilot follows the pointer, and the last line printed is PASS or FAIL.
// mac/scripts/replay-tasks.sh runs them all.
//
// "Done" is read from the store, not from what Haptic says, so a guide that
// announces it has finished without the thing having happened fails.

struct GuideTask {
    let id: String
    let ask: String
    /** Lab switches to start with, like "renamed,icons". */
    var lab = ""
    /** True once the app is in the state the person asked for. */
    let done: @MainActor (Store) -> Bool
}

enum GuideTasks {
    @MainActor
    static let all: [GuideTask] = {
        let before = Seed.company()
        return [
            GuideTask(id: "go-budgets", ask: "Where do I see how much of each budget is used?") { $0.nav == .budgets },
            GuideTask(id: "open-policies", ask: "Show me our spending rules") { $0.nav == .policies },
            GuideTask(id: "issue-card", ask: "Start issuing a new card") { $0.issuingCard },
            GuideTask(id: "freeze-card", ask: "Freeze the first card in the list") { store in
                zip(store.company.cards, before.cards).contains { $0.status == .frozen && $1.status == .active }
            },
            GuideTask(id: "missing-receipts", ask: "Show me only the expenses that are missing a receipt") { $0.nav == .expenses && $0.onlyMissingReceipts },
            GuideTask(id: "close-books", ask: "Take me to where I close the books for May") { $0.nav == .accounting && $0.accountingTab == "Month-end close" },
            GuideTask(id: "mappings", ask: "Where do I change which account travel is booked to?") { $0.nav == .accounting && $0.accountingTab == "Mappings" },
            GuideTask(id: "export-trial-balance", ask: "Export a trial balance") { $0.exported == "Trial balance" || ($0.nav == .accounting && $0.accountingTab == "Month-end close") },
            GuideTask(id: "export-expenses", ask: "Export all expenses as a CSV from the menu bar") { $0.exported == "Expenses" },
            GuideTask(id: "hold-vendor", ask: "Why can't I pay Juniper Office Leasing?") { $0.nav == .vendors },
            GuideTask(id: "contact-support", ask: "I want to message support") { $0.contacting },
            GuideTask(id: "api-keys", ask: "Where do I create an API key?") { $0.settingsPane == "Security" },
            GuideTask(id: "change-plan", ask: "How do I see what plan we're on?") { $0.settingsPane == "Plan and billing" },
            GuideTask(id: "renamed-cards", ask: "Take me to our company cards", lab: "renamed") { $0.nav == .cards },
            GuideTask(id: "icons-people", ask: "Where is the list of everyone in the company?", lab: "icons") { $0.nav == .people },
            GuideTask(id: "employee-approvals", ask: "Where do I approve requests?", lab: "employee") { $0.nav != .approvals },
        ]
    }()

    @MainActor
    static func named(_ id: String) -> GuideTask? { all.first { $0.id == id } }
}
