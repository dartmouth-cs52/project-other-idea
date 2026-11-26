import HapticKit
import SwiftUI

// The Help Center: articles written the way a real one is, by task. Each has
// a "Show me how" button that hands the task to Haptic, which is the reason
// an app would add Haptic at all: the article stops being a list of steps to
// remember and becomes a pointer on the real controls.

struct HelpArticle: Identifiable, Hashable {
    let id: String
    let topic: String
    let title: String
    let body: String
    /** What is asked of Haptic when the person presses Show me how. */
    let ask: String
}

enum HelpCenter {
    static let articles: [HelpArticle] = [
        HelpArticle(id: "issue-card", topic: "Cards", title: "Issue a card to someone", body: "Open Cards and press Issue card. Choose the cardholder and whether the card is virtual or physical, give it a name, then set its limit and how often the limit resets. A physical card also asks where to post it. Review the details, tick that the cardholder has read the card policy, and press Issue card.", ask: "Issue a virtual card to someone on my team"),
        HelpArticle(id: "freeze-card", topic: "Cards", title: "Freeze or unfreeze a card", body: "Open Cards, choose the card and press Freeze under the table, or open the card and turn on Freeze this card. A frozen card declines every purchase until it is unfrozen. Nothing else about it changes.", ask: "Freeze a card"),
        HelpArticle(id: "raise-limit", topic: "Cards", title: "Change a card's limit", body: "Open the card from Cards. Under Spending limit, drag the slider or use the stepper beside it, and choose how often the limit resets. Press Save changes.", ask: "Raise the spending limit on a card"),
        HelpArticle(id: "split", topic: "Expenses", title: "Split an expense across categories", body: "Open the expense from Expenses and press Split. Give each part a category and an amount. The parts must add up to the whole before Save split can be pressed. Split evenly shares the amount between the parts.", ask: "Split an expense between two categories"),
        HelpArticle(id: "receipts", topic: "Expenses", title: "Find purchases with no receipt", body: "Open Expenses and tick Missing receipt only. Select the purchases, open Actions and choose Request Receipts to remind their owners.", ask: "Show me the purchases that are missing a receipt"),
        HelpArticle(id: "reimburse", topic: "Reimbursements", title: "Ask to be paid back", body: "Open Reimbursements and press New request. Give the request a title, add a line for each thing you paid for with its date and amount, choose where to be paid, and press Submit request.", ask: "Submit a reimbursement request"),
        HelpArticle(id: "approve", topic: "Approvals", title: "Approve or reject a request", body: "Open Approvals and choose a request from the list. Press Approve, or Reject and give a reason the requester will see. Requests over $5,000 go on to Finance after you.", ask: "Reject a request and say why"),
        HelpArticle(id: "delegate", topic: "Approvals", title: "Hand your approvals to someone while you are away", body: "Open Approvals and press Delegate. Choose who covers for you and until when, then press Start delegating.", ask: "Delegate my approvals while I am on holiday"),
        HelpArticle(id: "pay-bill", topic: "Bills", title: "Pay a bill", body: "Open Bills and stay on To pay. Choose the bill and press Pay bill. Choose how to pay, which account to pay from and when, then confirm. A bill from a vendor on hold cannot be paid until the hold is lifted in Vendors.", ask: "Pay a bill by bank transfer"),
        HelpArticle(id: "hold", topic: "Vendors", title: "Hold or release payments to a vendor", body: "Open Vendors and choose the vendor. On the Details tab, turn Hold payments to this vendor on or off. While it is on, none of the vendor's bills can be paid.", ask: "Why can't I pay a bill from Juniper Office Leasing?"),
        HelpArticle(id: "budget", topic: "Budgets", title: "Change a budget", body: "Open Budgets and press Edit beside the budget. Use the stepper for each line to raise or lower it, choose when the owner is warned, and press Save budget.", ask: "Increase the Marketing budget"),
        HelpArticle(id: "mapping", topic: "Accounting", title: "Choose which account a category is booked to", body: "Open Accounting and choose Mappings. Each category has a pop-up with the account it is booked to. Change it and press Save mappings. Tick Apply to past purchases too to rebook what was already spent.", ask: "Book travel to a different account"),
        HelpArticle(id: "close", topic: "Accounting", title: "Close the books for a month", body: "Open Accounting and choose Month-end close. Work down the checklist: each check that is not done has a button that takes you to where it is fixed. When all six are ticked, press Close for the month and confirm.", ask: "Close the books for May"),
        HelpArticle(id: "invite", topic: "People", title: "Invite people to Northpine", body: "Open People and press Invite people. Type their email addresses, choose a role and a department, and press Send invites. They show as Invited until they accept.", ask: "Invite a new teammate"),
        HelpArticle(id: "permissions", topic: "People", title: "Change what a role may do", body: "Open People and choose Roles and permissions. Tick or untick an ability under a role, then press Save permissions. Admins may always do everything.", ask: "Let managers pay bills"),
        HelpArticle(id: "policy", topic: "Policies", title: "Change a spending rule", body: "Open Policies. Switch a rule on or off, or press Change amount beside it. Nothing takes effect until you press Publish at the top of the screen.", ask: "Require receipts over fifty dollars"),
        HelpArticle(id: "export", topic: "Reports", title: "Export a report", body: "Open Reports, choose how to group the spend and the dates, then open Export and choose a spreadsheet or a document. The same exports are in the File menu, under Export.", ask: "Export spend by department as a spreadsheet"),
    ]

    static var topics: [String] {
        var seen: [String] = []
        for article in articles where !seen.contains(article.topic) { seen.append(article.topic) }
        return seen
    }
}

struct HelpView: View {
    @EnvironmentObject var store: Store
    @State private var search = ""
    @State private var selected: HelpArticle.ID? = "issue-card"
    @State private var helpful: [String: Bool] = [:]

    private var found: [HelpArticle] {
        HelpCenter.articles.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) || $0.body.localizedCaseInsensitiveContains(search) }
    }
    private var article: HelpArticle? { HelpCenter.articles.first { $0.id == selected } }

    var body: some View {
        Page {
            PageHeader(title: "Help Center", subtitle: "\(HelpCenter.articles.count) articles. Press Show me how in any of them and Northpine points the way.") {
                Button("Contact support") { store.contacting = true }
            }
            HSplitView {
                VStack(spacing: 8) {
                    TextField("Search help", text: $search)
                        .textFieldStyle(.roundedBorder)
                    List(selection: $selected) {
                        ForEach(HelpCenter.topics, id: \.self) { topic in
                            let articles = found.filter { $0.topic == topic }
                            if !articles.isEmpty {
                                Section(topic) {
                                    ForEach(articles) { Text($0.title).tag($0.id) }
                                }
                            }
                        }
                    }
                    .accessibilityLabel("Articles")
                }
                .frame(minWidth: 280, idealWidth: 320)

                Group {
                    if let article {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(article.topic.uppercased()).font(.caption).foregroundStyle(.secondary)
                            Text(article.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                            Text(article.body).fixedSize(horizontal: false, vertical: true)
                            Button("Show me how") { Haptic.ask(article.ask) }
                                .controlSize(.large)
                            Divider()
                            HStack {
                                Text("Was this helpful?")
                                Button("Yes") { helpful[article.id] = true }.accessibilityLabel("Yes, this was helpful")
                                Button("No") { helpful[article.id] = false }.accessibilityLabel("No, this was not helpful")
                                if let answer = helpful[article.id] { Text(answer ? "Thanks." : "Sorry. Contact support and we will help.").foregroundStyle(.secondary) }
                            }
                            Spacer()
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    } else {
                        Text("Choose an article.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(minWidth: 380)
            }
        }
        .sheet(isPresented: $store.contacting) { ContactSheet().environmentObject(store) }
    }
}

struct ContactSheet: View {
    @EnvironmentObject var store: Store
    @State private var topic = "Cards"
    @State private var message = ""
    @State private var urgent = false
    @State private var sent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Contact support").font(.title2.bold()).accessibilityAddTraits(.isHeader)
            if sent {
                Text("Thanks. We reply within one working day.")
            } else {
                Form {
                    Picker("Topic", selection: $topic) {
                        ForEach(HelpCenter.topics, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("How can we help?", text: $message, axis: .vertical)
                        .lineLimit(4...6)
                    Toggle("This is blocking payments", isOn: $urgent)
                }
            }
            HStack {
                Spacer()
                Button(sent ? "Close" : "Cancel") { store.contacting = false }
                    .keyboardShortcut(.cancelAction)
                if !sent {
                    Button("Send message") { sent = true }
                        .keyboardShortcut(.defaultAction)
                        .disabled(message.count < 10)
                }
            }
        }
        .padding(22)
        .frame(width: 440)
    }
}
