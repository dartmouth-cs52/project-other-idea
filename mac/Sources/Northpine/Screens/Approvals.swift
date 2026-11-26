import SwiftUI

// Approvals: a list on the left and the chosen request on the right, as Mail
// is laid out. Saying no asks for a reason in a sheet first.

struct ApprovalsView: View {
    @EnvironmentObject var store: Store
    @State private var tab = Approval.Status.pending
    @State private var kind = "All kinds"
    @State private var selected: Approval.ID?
    @State private var rejecting = false
    @State private var reason = ""
    @State private var comment = ""
    @State private var delegating = false

    private var requests: [Approval] {
        store.company.approvals.filter { $0.status == tab && (kind == "All kinds" || $0.kind.rawValue == kind) }
    }
    private var chosen: Approval? { store.company.approvals.first { $0.id == selected } }

    var body: some View {
        Page {
            PageHeader(title: "Approvals", subtitle: "\(store.company.approvals.filter { $0.status == .pending }.count) requests are waiting for you") {
                Button("Delegate…") { delegating = true }
                    .popover(isPresented: $delegating, arrowEdge: .bottom) { DelegatePopover(showing: $delegating).environmentObject(store) }
                Button("Approve all under $100") {
                    for index in store.company.approvals.indices where store.company.approvals[index].status == .pending && store.company.approvals[index].amount < 100 {
                        store.company.approvals[index].status = .approved
                    }
                }
            }

            HStack {
                Picker("Show", selection: $tab) {
                    ForEach(Approval.Status.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 280)
                Picker("Kind", selection: $kind) {
                    Text("All kinds").tag("All kinds")
                    ForEach(Approval.Kind.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
                }
                .frame(width: 210)
                Spacer()
            }

            HSplitView {
                List(requests, selection: $selected) { request in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(request.title)
                        Text("\(request.kind.rawValue), \(Format.money(request.amount))").font(.caption).foregroundStyle(.secondary)
                    }
                    .tag(request.id)
                }
                .accessibilityLabel("Requests")
                .frame(minWidth: 260, idealWidth: 300)

                Group {
                    if let chosen { detail(chosen) } else {
                        Text("Choose a request to see it here.").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(minWidth: 360)
            }
        }
        .sheet(isPresented: $rejecting) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Reject request").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Text("The requester is told why.").foregroundStyle(.secondary)
                Picker("Reason", selection: $reason) {
                    Text("Choose a reason").tag("")
                    ForEach(["Out of policy", "Missing receipt", "Over budget", "Duplicate", "Other"], id: \.self) { Text($0).tag($0) }
                }
                TextField("Note to the requester", text: $comment, axis: .vertical)
                    .lineLimit(3...5)
                HStack {
                    Spacer()
                    Button("Cancel") { rejecting = false }
                        .keyboardShortcut(.cancelAction)
                    Button("Reject request", role: .destructive) {
                        decide(.rejected)
                        rejecting = false
                    }
                    .disabled(reason.isEmpty)
                }
            }
            .padding(22)
            .frame(width: 420)
        }
    }

    private func detail(_ request: Approval) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(request.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
            HStack {
                StatusBadge(text: request.status.rawValue, color: request.status == .pending ? .orange : request.status == .approved ? .green : .red)
                Text(request.kind.rawValue).foregroundStyle(.secondary)
            }
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                GridRow { Text("Requested by").foregroundStyle(.secondary); Text(store.person(request.requesterID)?.name ?? "") }
                GridRow { Text("Amount").foregroundStyle(.secondary); Text(Format.money(request.amount)) }
                GridRow { Text("Submitted").foregroundStyle(.secondary); Text(Format.ago(request.submitted)) }
                if !request.note.isEmpty { GridRow { Text("Note").foregroundStyle(.secondary); Text(request.note) } }
                if !request.reason.isEmpty { GridRow { Text("Rejected for").foregroundStyle(.secondary); Text(request.reason) } }
            }
            if request.amount > 5_000 {
                Label("Over $5,000, so Finance approves after you.", systemImage: "info.circle").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if request.status == .pending {
                HStack {
                    Button("Approve") { decide(.approved) }
                        .keyboardShortcut(.defaultAction)
                    Button("Reject…") { reason = ""; comment = ""; rejecting = true }
                    Button("Ask a question") { store.go(.inbox) }
                    Spacer()
                }
            } else {
                Button("Move back to pending") { decide(.pending) }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func decide(_ status: Approval.Status) {
        guard let index = store.company.approvals.firstIndex(where: { $0.id == selected }) else { return }
        store.company.approvals[index].status = status
        store.company.approvals[index].reason = status == .rejected ? reason : ""
        selected = nil
    }
}

/** Hands approvals to someone else for a while. */
struct DelegatePopover: View {
    @EnvironmentObject var store: Store
    @Binding var showing: Bool
    @State private var to = "p2"
    @State private var until = Seed.today.addingTimeInterval(7 * 86_400)
    @State private var notify = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Delegate approvals").font(.headline).accessibilityAddTraits(.isHeader)
            Picker("Delegate to", selection: $to) {
                ForEach(store.company.people.filter { $0.role != .employee && $0.status == .active }) { Text($0.name).tag($0.id) }
            }
            DatePicker("Until", selection: $until, in: Seed.today..., displayedComponents: .date)
            Toggle("Tell requesters", isOn: $notify)
            HStack {
                Spacer()
                Button("Start delegating") { showing = false }
            }
        }
        .padding(16)
        .frame(width: 300)
    }
}
