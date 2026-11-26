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
//   swift run Northpine --dump           print what Haptic reads from each screen, and quit (Dump.swift)
//
// The server it asks is HAPTIC_SERVER (http://localhost:4000 when unset) and
// the site is HAPTIC_SITE (site_northpine_mac).

@main
struct NorthpineApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup("Northpine") {
            Shell()
                .environmentObject(store)
                .frame(minWidth: 980, minHeight: 620)
                .onAppear { Store.shared = store }
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
        if CommandLine.arguments.contains("--dump") {
            Task { @MainActor in await Dump.run() }
            return
        }
        Haptic.start(
            site: environment["HAPTIC_SITE"] ?? "site_northpine_mac",
            server: URL(string: environment["HAPTIC_SERVER"] ?? "http://localhost:4000")!,
            appID: Self.appID
        )
        if let question = environment["HAPTIC_ASK"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { Haptic.ask(question) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
