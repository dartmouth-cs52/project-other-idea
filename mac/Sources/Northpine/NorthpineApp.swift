import AppKit
import HapticKit
import SwiftUI

// Northpine for Mac: a made-up spend management app, the native cousin of the
// Northpine web app in testbed/. It is here to try Haptic on the kind of app
// a real company ships, so it is large on purpose, and it has every piece of
// Mac interface that could trip up a guide that points: a grouped sidebar,
// tables, sheets inside sheets, popovers, a settings window, deep menus.
//
//   swift run Northpine                  the app, with the Ask button
//   HAPTIC_ASK="…" swift run Northpine   ask a question as soon as the app is up
//   LAB=renamed,icons swift run Northpine  start with Lab switches on (Lab.swift)
//   HAPTIC_TASK=freeze-card swift run Northpine  ask one of the tasks and follow the pointer by itself (Tasks.swift)
//   swift run Northpine --site > northpine-site.json  write the site file the server needs, from the app itself (Site.swift)
//   swift run Northpine --dump           print what Haptic reads from each screen, and quit (Dump.swift)
//
// The server it asks is HAPTIC_SERVER (http://localhost:4000 when unset) and
// the site is HAPTIC_SITE (site_northpine_mac).

@main
struct NorthpineApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = Store()
    @StateObject private var preferences = Preferences()
    @StateObject private var lab = Lab()

    var body: some Scene {
        WindowGroup("Northpine") {
            Group {
                if store.onboarding { OnboardingView() } else if store.signedIn { Shell() } else { SignInView() }
            }
                .environmentObject(store)
                .environmentObject(lab)
                .frame(minWidth: 980, minHeight: 620)
                .onAppear {
                    Store.shared = store
                    Preferences.shared = preferences
                    Lab.shared = lab
                    if let names = ProcessInfo.processInfo.environment["LAB"] { lab.apply(names) }
                }
        }
        .commands { NorthpineCommands(store: store, lab: lab) }
        Window("Lab", id: "lab") {
            LabWindow().environmentObject(lab)
        }
        .windowResizability(.contentSize)
        .keyboardShortcut("l", modifiers: [.command, .option])
        Settings {
            SettingsWindow()
                .environmentObject(store)
                .environmentObject(preferences)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    static let appID = "com.northpine.mac"

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Run from `swift run` there is no bundle, so the app says for itself that it is an ordinary one.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        let environment = ProcessInfo.processInfo.environment
        if CommandLine.arguments.contains("--site") {
            Task { @MainActor in await Site.run() }
            return
        }
        if CommandLine.arguments.contains("--dump") {
            Task { @MainActor in await Dump.run() }
            return
        }
        Haptic.start(
            site: environment["HAPTIC_SITE"] ?? "site_northpine_mac",
            server: URL(string: environment["HAPTIC_SERVER"] ?? "http://localhost:4000")!,
            appID: Self.appID
        )
        if CommandLine.arguments.contains("--tasks") {
            Task { @MainActor in
                for task in GuideTasks.all { print("\(task.id)\t\(task.ask)") }
                NSApp.terminate(nil)
            }
            return
        }
        let task = environment["HAPTIC_TASK"].flatMap { id in MainActor.assumeIsolated { GuideTasks.named(id) } }
        if environment["HAPTIC_AUTOPILOT"] != nil || task != nil { MainActor.assumeIsolated { Autopilot.start(task: task) } }
        if let question = task?.ask ?? environment["HAPTIC_ASK"] {
            // The Lab's switches first, with time for the window to redraw, so the question is asked of the app as switched.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                if let names = task?.lab, !names.isEmpty { Lab.shared?.apply(names) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { Haptic.ask(question) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
