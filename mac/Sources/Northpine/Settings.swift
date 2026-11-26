import AppKit
import SwiftUI

// Settings: a window of its own, opened from the app menu or with ⌘, as on
// any Mac app. Five panes along the top. To Haptic it is a second window,
// with its own screens (/settings/general, /settings/security and so on).

final class Preferences: ObservableObject {
    /** The one set of preferences, for the menu bar and scripts. */
    static var shared: Preferences?

    /** Opens the Settings window on a pane, as the app menu's Settings… does. */
    @MainActor
    static func open(_ pane: String? = nil) {
        if let pane { shared?.pane = pane }
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }

    @Published var pane = "General"
    @Published var companyName = "Northpine"
    @Published var fiscalStart = "January"
    @Published var currency = "USD"
    @Published var appearance = "Match system"
    @Published var density = "Comfortable"
    @Published var emailDigest = true
    @Published var digestDay = "Monday"
    @Published var notifyApprovals = true
    @Published var notifyDeclines = true
    @Published var notifyBudgets = false
    @Published var sounds = false
    @Published var twoFactor = true
    @Published var sso = false
    @Published var sessionHours = 12.0
    @Published var keys: [String] = ["Ledgerline sync · created Mar 3"]
    @Published var plan = Plan.growth
    @Published var seats = 60
    @Published var connected: Set<String> = ["Ledgerline", "Slack"]

    static let panes = ["General", "Notifications", "Security", "Plan and billing", "Integrations"]
}

struct SettingsWindow: View {
    @EnvironmentObject var preferences: Preferences
    @EnvironmentObject var store: Store

    var body: some View {
        TabView(selection: $preferences.pane) {
            GeneralPane().tabItem { Label("General", systemImage: "gearshape") }.tag("General")
            NotificationsPane().tabItem { Label("Notifications", systemImage: "bell") }.tag("Notifications")
            SecurityPane().tabItem { Label("Security", systemImage: "lock") }.tag("Security")
            PlanPane().tabItem { Label("Plan and billing", systemImage: "creditcard") }.tag("Plan and billing")
            IntegrationsPane().tabItem { Label("Integrations", systemImage: "puzzlepiece") }.tag("Integrations")
        }
        .frame(width: 560, height: 400)
        .onAppear { store.settingsPane = preferences.pane }
        .onDisappear { store.settingsPane = nil }
        .onChange(of: preferences.pane) { store.settingsPane = $0 }
    }
}

private struct GeneralPane: View {
    @EnvironmentObject var preferences: Preferences

    var body: some View {
        Form {
            TextField("Company name", text: $preferences.companyName)
            Picker("Fiscal year starts", selection: $preferences.fiscalStart) {
                ForEach(["January", "April", "July", "October"], id: \.self) { Text($0).tag($0) }
            }
            Picker("Currency", selection: $preferences.currency) {
                ForEach(["USD", "CAD", "EUR", "GBP"], id: \.self) { Text($0).tag($0) }
            }
            Picker("Appearance", selection: $preferences.appearance) {
                ForEach(["Match system", "Light", "Dark"], id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.radioGroup)
            Picker("Table density", selection: $preferences.density) {
                ForEach(["Compact", "Comfortable"], id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.segmented)
        }
        .padding(20)
    }
}

private struct NotificationsPane: View {
    @EnvironmentObject var preferences: Preferences

    var body: some View {
        Form {
            Section("Email") {
                Toggle("Send me a weekly digest", isOn: $preferences.emailDigest)
                Picker("Digest day", selection: $preferences.digestDay) {
                    ForEach(["Monday", "Friday"], id: \.self) { Text($0).tag($0) }
                }
                .disabled(!preferences.emailDigest)
            }
            Section("On this Mac") {
                Toggle("Requests waiting for my approval", isOn: $preferences.notifyApprovals)
                Toggle("Declined purchases", isOn: $preferences.notifyDeclines)
                Toggle("Budgets passing their limit", isOn: $preferences.notifyBudgets)
                Toggle("Play a sound", isOn: $preferences.sounds)
            }
        }
        .padding(20)
    }
}

private struct SecurityPane: View {
    @EnvironmentObject var preferences: Preferences
    @State private var naming = false
    @State private var keyName = ""
    @State private var revoking: String?

    var body: some View {
        Form {
            Toggle("Require two-factor authentication for everyone", isOn: $preferences.twoFactor)
            Toggle("Single sign-on", isOn: $preferences.sso)
                .disabled(preferences.plan != .enterprise)
            if preferences.plan != .enterprise { Text("Single sign-on is part of the Enterprise plan.").font(.caption).foregroundStyle(.secondary) }
            Slider(value: $preferences.sessionHours, in: 1...24, step: 1) { Text("Sign out after \(Int(preferences.sessionHours)) hours") }
            Section("API keys") {
                ForEach(preferences.keys, id: \.self) { key in
                    HStack {
                        Text(key)
                        Spacer()
                        Button("Revoke") { revoking = key }
                            .accessibilityLabel("Revoke \(key.components(separatedBy: " · ")[0])")
                    }
                }
                if naming {
                    HStack {
                        TextField("Key name", text: $keyName)
                        Button("Create") {
                            preferences.keys.append("\(keyName) · created today")
                            keyName = ""
                            naming = false
                        }
                        .disabled(keyName.isEmpty)
                    }
                } else {
                    Button("Create API key") { naming = true }
                }
            }
        }
        .padding(20)
        .confirmationDialog("Revoke this key?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } })) {
            Button("Revoke Key", role: .destructive) { preferences.keys.removeAll { $0 == revoking } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Anything using it stops working at once.")
        }
    }
}

private struct PlanPane: View {
    @EnvironmentObject var preferences: Preferences
    @State private var changing = false
    @State private var chosen = Plan.growth

    private func price(_ plan: Plan) -> Int { plan == .starter ? 0 : plan == .growth ? 12 : 29 }

    var body: some View {
        Form {
            LabeledContent("Current plan", value: "\(preferences.plan.rawValue), $\(price(preferences.plan)) a seat each month")
            Stepper("Seats: \(preferences.seats)", value: $preferences.seats, in: 1...500)
            LabeledContent("Next invoice", value: "$\(price(preferences.plan) * preferences.seats) on July 1")
            Button("Change plan…") { chosen = preferences.plan; changing = true }
            Button("Update payment method…") {}
            Button("Download invoices") {}
        }
        .padding(20)
        .sheet(isPresented: $changing) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Change plan").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Picker("Plan", selection: $chosen) {
                    ForEach(Plan.allCases) { Text("\($0.rawValue), $\(price($0)) a seat").tag($0) }
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
                if chosen == .starter { Text("Starter has no approvals, budgets or accounting sync.").font(.caption).foregroundStyle(.secondary) }
                HStack {
                    Spacer()
                    Button("Cancel") { changing = false }
                        .keyboardShortcut(.cancelAction)
                    Button(chosen == preferences.plan ? "Keep \(chosen.rawValue)" : "Switch to \(chosen.rawValue)") {
                        preferences.plan = chosen
                        changing = false
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(22)
            .frame(width: 380)
        }
    }
}

private struct IntegrationsPane: View {
    @EnvironmentObject var preferences: Preferences

    static let all: [(String, String)] = [("Ledgerline", "Accounting"), ("Slack", "Approvals in chat"), ("Gusto", "Payroll and people"), ("Okta", "Sign-in"), ("Google Workspace", "People and receipts from Gmail")]

    var body: some View {
        Form {
            ForEach(Self.all, id: \.0) { name, what in
                HStack {
                    VStack(alignment: .leading) {
                        Text(name)
                        Text(what).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if preferences.connected.contains(name) {
                        Button("Disconnect") { preferences.connected.remove(name) }
                            .accessibilityLabel("Disconnect \(name)")
                    } else {
                        Button("Connect") { preferences.connected.insert(name) }
                            .accessibilityLabel("Connect \(name)")
                    }
                }
            }
        }
        .padding(20)
    }
}
