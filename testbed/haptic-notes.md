Northpine is spend management for companies: corporate cards, expenses, reimbursements, approvals, bill pay, accounting sync, reports, budgets and people. The app is a single-page app, so most pages only exist after sign-in and the crawl sees little. These notes are the company's own map of it.

- Home (/) shows spend this month, a spend chart, the setup checklist, latest card spend and bills due.
- Cards (/cards) lists cards. Issue a card at /cards/new (Admin or Finance). Employees request one instead. A card's page (/cards/:id) has Reveal for the number and CVC, Freeze, Edit limits, and More actions > Replace card for lost, stolen or damaged cards.
- Expenses (/expenses) is every card charge. Open one to add a receipt, change the category, split it or mark it personal. Missing receipts are a saved view.
- Reimbursements (/reimbursements) are expenses paid out of pocket, mileage and per diem. New ones start at /reimbursements/new.
- Approvals (/approvals) has a list and a board. Delegate approvals is at the top right.
- Bills (/bills) and Vendors (/bills/vendors) are bill pay. Pay now is on a bill's page.
- Accounting (/accounting) has the month-end close, the chart of accounts (/accounting/chart), ERP sync (/accounting/sync) and category mappings (/accounting/mappings).
- Reports (/reports), Budgets (/budgets) and Policies (/policies) are under Finance. Approval rules are policies.
- People (/people) is the directory. Invite people from there. Departments and roles have their own pages.
- Settings (/settings) covers profile, notifications, company, entities, billing and plan, security and two-factor, integrations (Slack is called Chatter here), developers (API keys and webhooks), the audit log and the danger zone.
- Settings pages: Profile (/settings/profile), Notifications (/settings/notifications), Company (/settings/company), Entities (/settings/entities), Billing and plan (/settings/billing), Security and two-factor (/settings/security), Integrations (/settings/integrations), Developers with API keys and webhooks (/settings/developer), Audit log (/settings/audit) and Danger zone (/settings/danger).
- Other pages: approval details (/approvals/:id), bills and new bills (/bills/:id, /bills/new), vendors (/bills/vendors/:id, /bills/vendors/new), budgets (/budgets/new, /budgets/:id), the handbook and policy pages (/policies/handbook, /policies/new, /policies/:id), people pages (/people/:id, /people/departments, /people/roles), report pages (/reports/new, /reports/:id), reimbursement pages (/reimbursements/:id, /reimbursements/:id/edit), card requests (/cards/request).

The top bar, on every page:
- Search (or Cmd+K) opens a command palette with Issue a card, Submit an expense report, Log mileage, Add a bill, Add a vendor, Build a report, Invite people and Create an API key.
- New is a menu: Expense report, Mileage claim, Card, Bill, Vendor, Report, Budget, Invite people.
- The bell is Notifications. Each one opens the page it is about.
- The question mark icon is a Help menu: Help center (/help, a full page load), Keyboard shortcuts, What's new (/help/whats-new) and Contact support (/help/contact).
- The round button with initials is the account menu: Profile, Keyboard shortcuts, Theme (Light, Dark, System), Language (English, Español) and Sign out. It has no label, only the initials.
- With more than one entity, the company name at the top left is a menu that switches entity.

The sidebar groups pages under Spending (Cards, Expenses, Reimbursements, Approvals), Bill pay (Bills, Vendors), Finance (Accounting, Reports, Budgets, Policies) and Company (People, Settings). At its foot are Help center and API docs (/settings/developer).
