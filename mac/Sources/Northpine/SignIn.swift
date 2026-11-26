import SwiftUI

// What comes before the app: signing in, and for a new company, four steps
// of setting up. Haptic never reads what is typed into either field, and the
// password field is a secure one, which says nothing of itself at all.

struct SignInView: View {
    @EnvironmentObject var store: Store
    @State private var email = ""
    @State private var password = ""
    @State private var remember = true
    @State private var problem = ""
    @State private var resetting = false
    @State private var sent = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "tree").font(.system(size: 40)).foregroundStyle(Color.accentColor).accessibilityHidden(true)
            Text("Sign in to Northpine").font(.title.bold()).accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 10) {
                TextField("Work email", text: $email)
                    .textFieldStyle(.roundedBorder)
                SecureField("Password", text: $password)
                    .textFieldStyle(.roundedBorder)
                if !problem.isEmpty { Text(problem).font(.callout).foregroundStyle(.red) }
                Toggle("Keep me signed in on this Mac", isOn: $remember)
                Button("Sign in") { signIn() }
                    .keyboardShortcut(.defaultAction)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)
                HStack {
                    Button("Forgot password?") { resetting = true }
                        .buttonStyle(.link)
                    Spacer()
                    Button("Sign in with SSO") { problem = "Single sign-on is not set up for this company." }
                        .buttonStyle(.link)
                }
                Divider()
                Button("Set up a new company") { store.onboarding = true }
                    .frame(maxWidth: .infinity)
            }
            .frame(width: 320)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $resetting) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Reset your password").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                if sent {
                    Text("If that address has an account, a link is on its way.")
                } else {
                    TextField("Work email", text: $email).frame(width: 300)
                }
                HStack {
                    Spacer()
                    Button(sent ? "Done" : "Cancel") { resetting = false; sent = false }
                        .keyboardShortcut(.cancelAction)
                    if !sent {
                        Button("Send reset link") { sent = true }
                            .keyboardShortcut(.defaultAction)
                            .disabled(!email.contains("@"))
                    }
                }
            }
            .padding(22)
        }
    }

    private func signIn() {
        guard email.contains("@") else { problem = "Type the email address you use at work."; return }
        guard password.count >= 6 else { problem = "That password is not right. Try again or reset it."; return }
        problem = ""
        password = ""
        store.signedIn = true
    }
}

/** Setting up a new company: four steps with a row of dots for where you are. */
struct OnboardingView: View {
    @EnvironmentObject var store: Store
    @State private var step = 0
    @State private var company = ""
    @State private var size = "11 to 50"
    @State private var uses: Set<String> = ["Cards"]
    @State private var ledger = "None yet"
    @State private var invites = ""

    static let steps = ["Your company", "What you'll use", "Your books", "Your team"]

    private var ready: Bool { step != 0 || company.count >= 2 }

    var body: some View {
        VStack(spacing: 18) {
            Text("Set up Northpine").font(.title.bold()).accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                ForEach(Self.steps.indices, id: \.self) { index in
                    Circle().fill(index <= step ? Color.accentColor : Color.secondary.opacity(0.3)).frame(width: 9, height: 9)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Step \(step + 1) of \(Self.steps.count)")
            Text(Self.steps[step]).font(.title3).accessibilityAddTraits(.isHeader)

            Group {
                switch step {
                case 0:
                    Form {
                        TextField("Company name", text: $company)
                        Picker("People", selection: $size) {
                            ForEach(["1 to 10", "11 to 50", "51 to 200", "Over 200"], id: \.self) { Text($0).tag($0) }
                        }
                    }
                case 1:
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(["Cards", "Expense reports", "Bill pay", "Reimbursements", "Budgets"], id: \.self) { use in
                            Toggle(use, isOn: Binding(get: { uses.contains(use) }, set: { if $0 { uses.insert(use) } else { uses.remove(use) } }))
                        }
                    }
                case 2:
                    Picker("Accounting system", selection: $ledger) {
                        ForEach(["None yet", "Ledgerline", "QuickBooks", "Xero", "NetSuite"], id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.radioGroup)
                default:
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Invite by email", text: $invites, prompt: Text("Separate with commas"))
                        Text("You can skip this and invite people later from People.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 360, height: 170, alignment: .top)

            HStack {
                Button("Back to sign in") { store.onboarding = false }
                    .buttonStyle(.link)
                Spacer()
                Button("Back") { step -= 1 }
                    .disabled(step == 0)
                if step == Self.steps.count - 1 {
                    Button("Finish setup") {
                        store.onboarding = false
                        store.signedIn = true
                    }
                    .keyboardShortcut(.defaultAction)
                } else {
                    Button(step == 1 && uses.isEmpty ? "Skip" : "Continue") { step += 1 }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!ready)
                }
            }
            .frame(width: 360)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
