import AppKit
import HapticKit
import SwiftUI

// A small Mac app to try Haptic on: Acme Desk, the Mac cousin of the Acme
// Console demo site. It has what a real app has that a web page doesn't: a
// sidebar, a menu bar, tabs, sheets and a toolbar.
//
//   swift run HapticDemo                 the app, with the Ask button
//   swift run HapticDemo --dump          print what Haptic reads from each screen, and quit
//   HAPTIC_ASK="…" swift run HapticDemo  ask a question as soon as the app is up
//   HAPTIC_AUTOPILOT=1 with HAPTIC_ASK   follow the pointer by itself and print each step (see Autopilot)
//
// The server it asks is HAPTIC_SERVER (http://localhost:4000 when unset) and
// the site is HAPTIC_SITE (site_macdemo). See docs/mac.md.

enum Section: String, CaseIterable, Identifiable {
    case overview = "Overview", projects = "Projects", team = "Team", settings = "Settings"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .overview: return "square.grid.2x2"
        case .projects: return "folder"
        case .team: return "person.2"
        case .settings: return "gearshape"
        }
    }
}

final class Desk: ObservableObject {
    @Published var section: Section? = .overview
    @Published var projects = ["Website relaunch", "Mobile app", "Billing migration"]
    @Published var people = ["Maya Okafor · Owner", "Jonas Lind · Admin", "Priya Raman · Member"]
    @Published var showingInvite = false
    @Published var showingNewProject = false
    @Published var exported = false
}

@main
struct DemoApp: App {
    @NSApplicationDelegateAdaptor(DemoDelegate.self) private var delegate
    @StateObject private var desk = Desk()

    var body: some Scene {
        WindowGroup("Acme Desk") {
            DeskView()
                .environmentObject(desk)
                .frame(minWidth: 760, minHeight: 480)
                .onAppear { DemoDelegate.desk = desk }
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Project…") { desk.section = .projects; desk.showingNewProject = true }
                    .keyboardShortcut("n")
            }
            CommandGroup(after: .importExport) {
                Menu("Export") {
                    Button("Usage Report…") { desk.exported = true }
                    Button("Team List…") { desk.exported = true }
                }
            }
            CommandMenu("Workspace") {
                Button("Invite Teammate…") { desk.section = .team; desk.showingInvite = true }
                Button("Plan and Billing…") { desk.section = .settings }
            }
        }
    }
}

final class DemoDelegate: NSObject, NSApplicationDelegate {
    static var desk: Desk?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Run from `swift run` there is no bundle, so the app says for itself that it is an ordinary one.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        let environment = ProcessInfo.processInfo.environment
        if CommandLine.arguments.contains("--dump") {
            Task { @MainActor in await dump() }
            return
        }
        Haptic.start(
            site: environment["HAPTIC_SITE"] ?? "site_macdemo",
            server: URL(string: environment["HAPTIC_SERVER"] ?? "http://localhost:4000")!,
            appID: "com.haptic.demo"
        )
        if environment["HAPTIC_AUTOPILOT"] != nil { Autopilot.start() }
        if let question = environment["HAPTIC_ASK"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Haptic.ask(question) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /** Prints what Haptic reads from each screen of the app, as the JSON it would send. */
    @MainActor
    private func dump() async {
        // The first reading is what makes SwiftUI build its accessibility tree, so it is thrown away.
        _ = Haptic.snapshotJSON()
        for section in Section.allCases {
            DemoDelegate.desk?.section = section
            try? await Task.sleep(nanoseconds: 700_000_000)
            print("--- \(section.rawValue)")
            print(Haptic.snapshotJSON() ?? "(no window)")
        }
        DemoDelegate.desk?.section = .team
        DemoDelegate.desk?.showingInvite = true
        try? await Task.sleep(nanoseconds: 1_200_000_000)
        print("--- Invite sheet")
        print(Haptic.snapshotJSON() ?? "(no window)")
        fflush(stdout)
        // An open sheet stops NSApp.terminate from quitting, so exit straight out.
        exit(0)
    }
}

struct DeskView: View {
    @EnvironmentObject var desk: Desk

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $desk.section) { section in
                Label(section.rawValue, systemImage: section.symbol).tag(section)
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190)
        } detail: {
            switch desk.section ?? .overview {
            case .overview: OverviewView()
            case .projects: ProjectsView()
            case .team: TeamView()
            case .settings: SettingsView()
            }
        }
        .navigationTitle(desk.section?.rawValue ?? "Acme Desk")
        .alert("Export started", isPresented: $desk.exported) {
            Button("OK") {}
        } message: {
            Text("Your file will be in Downloads in a moment.")
        }
    }
}

struct OverviewView: View {
    @EnvironmentObject var desk: Desk

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Overview").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            Text("3 projects, 3 teammates, and 62% of this month's build minutes used.")
            HStack {
                Button("View projects") { desk.section = .projects }
                Button("Invite teammate") { desk.section = .team; desk.showingInvite = true }
            }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ProjectsView: View {
    @EnvironmentObject var desk: Desk
    @State private var name = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Projects").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            List(desk.projects, id: \.self) { Text($0) }
        }
        .padding(24)
        .toolbar {
            ToolbarItem {
                Button { desk.showingNewProject = true } label: { Label("New project", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $desk.showingNewProject) {
            VStack(alignment: .leading, spacing: 14) {
                Text("New project").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                TextField("Project name", text: $name).frame(width: 280)
                HStack {
                    Spacer()
                    Button("Cancel") { desk.showingNewProject = false }.keyboardShortcut(.cancelAction)
                    Button("Create project") {
                        if !name.isEmpty { desk.projects.append(name) }
                        name = ""
                        desk.showingNewProject = false
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(20)
        }
    }
}

struct TeamView: View {
    @EnvironmentObject var desk: Desk
    @State private var email = ""
    @State private var role = "Member"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Team").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            List(desk.people, id: \.self) { Text($0) }
            Button("Invite teammate") { desk.showingInvite = true }
        }
        .padding(24)
        .sheet(isPresented: $desk.showingInvite) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Invite a teammate").font(.title2.bold()).accessibilityAddTraits(.isHeader)
                TextField("Email address", text: $email).frame(width: 280)
                Picker("Role", selection: $role) {
                    ForEach(["Admin", "Member", "Viewer"], id: \.self) { Text($0) }
                }
                .frame(width: 280)
                HStack {
                    Spacer()
                    Button("Cancel") { desk.showingInvite = false }.keyboardShortcut(.cancelAction)
                    Button("Send invite") {
                        if !email.isEmpty { desk.people.append("\(email) · \(role)") }
                        email = ""
                        desk.showingInvite = false
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(20)
        }
    }
}

struct SettingsView: View {
    @State private var workspace = "Acme"
    @State private var deploys = true
    @State private var weekly = false
    @State private var twoFactor = false
    @State private var keys: [String] = []
    @State private var appearance = "System"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Settings").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
            TabView {
                Form {
                    TextField("Workspace name", text: $workspace)
                    Picker("Appearance", selection: $appearance) {
                        ForEach(["System", "Light", "Dark"], id: \.self) { Text($0) }
                    }
                }
                .padding()
                .tabItem { Text("General") }

                Form {
                    Toggle("Email me about deploys", isOn: $deploys)
                    Toggle("Weekly summary", isOn: $weekly)
                }
                .padding()
                .tabItem { Text("Notifications") }

                Form {
                    Toggle("Two-factor authentication", isOn: $twoFactor)
                    Button("Create API key") { keys.append("Key \(keys.count + 1) created") }
                    ForEach(keys, id: \.self) { Text($0) }
                }
                .padding()
                .tabItem { Text("Security") }
            }
        }
        .padding(24)
    }
}

/**
 * Follows the pointer by itself, for trying a whole guide from a script:
 * HAPTIC_AUTOPILOT=1 with HAPTIC_ASK set. It stands in for the person, not for
 * Haptic, which never presses anything. The clicks are made inside this app
 * only, and the real mouse is left alone.
 */
@MainActor
enum Autopilot {
    static func start() {
        Haptic.onStep = { step in
            let at = step.frame.map { "(\(Int($0.minX)), \(Int($0.minY)), \(Int($0.width))x\(Int($0.height)))" } ?? "nowhere"
            print("STEP [\(step.outcome ?? (step.last ? "last" : "continue"))] \(step.role ?? "-") \"\(step.label ?? "")\" at \(at): \(step.say)")
            fflush(stdout)
            if step.outcome != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    fflush(stdout)
                    exit(0)
                }
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { follow(step) }
        }
    }

    private static func follow(_ step: HapticStep) {
        guard let label = step.label, let role = step.role else { return }
        if role == "menuitem" || role == "menu" {
            // The menu bar belongs to the system, so the item is chosen as a keyboard shortcut would choose it.
            if let (menu, index) = find(label, in: NSApp.mainMenu) { menu.performActionForItem(at: index) }
            return
        }
        // A pop-up button's list is the system's to run, and a script can't choose from it.
        if role == "select" { print("AUTOPILOT: stopping at a pop-up button"); fflush(stdout); exit(0) }
        // A click made up by a script does not select a row of a list, so the sidebar is switched as a shortcut would switch it.
        if role == "treeitem", let section = Section(rawValue: label) { DemoDelegate.desk?.section = section; return }
        guard let frame = step.frame else { return }
        click(CGPoint(x: frame.midX, y: frame.midY))
        if role == "textbox" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { typeText("sam@acme.co") }
        }
    }

    private static func find(_ title: String, in menu: NSMenu?) -> (NSMenu, Int)? {
        guard let menu else { return nil }
        for (index, item) in menu.items.enumerated() {
            if item.title == title, item.submenu == nil { return (menu, index) }
            if let found = find(title, in: item.submenu) { return found }
        }
        return nil
    }

    private static func click(_ point: CGPoint) {
        let window = NSApp.orderedWindows.first { $0.isVisible && $0.frame.contains(point) && !$0.ignoresMouseEvents && !String(describing: type(of: $0)).contains("Haptic") }
        guard let window else { return print("AUTOPILOT: no window at \(point)") }
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: window.convertPoint(fromScreen: point), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
            if let event { NSApp.postEvent(event, atStart: false) }
        }
    }

    private static func typeText(_ text: String) {
        // A made-up click does not move the keyboard, so the field is given it here, as the person's click would.
        guard let window = NSApp.windows.first(where: { $0.isSheet && $0.isVisible }) ?? NSApp.keyWindow ?? NSApp.mainWindow else { return }
        window.makeKey()
        if let field = firstField(in: window.contentView) { window.makeFirstResponder(field) }
        else if !(window.firstResponder is NSText) { window.selectNextKeyView(nil) }
        for character in text {
            let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, characters: String(character), charactersIgnoringModifiers: String(character), isARepeat: false, keyCode: 0)
            if let event { NSApp.postEvent(event, atStart: false) }
        }
    }

    private static func firstField(in view: NSView?) -> NSTextField? {
        guard let view else { return nil }
        if let field = view as? NSTextField, field.isEditable { return field }
        for child in view.subviews { if let found = firstField(in: child) { return found } }
        return nil
    }
}
