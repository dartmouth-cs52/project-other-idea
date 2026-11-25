import AppKit

/**
 * Haptic in a Mac app. One call when the app has launched:
 *
 *     Haptic.start(site: "site_acme", server: URL(string: "https://…")!)
 *
 * An Ask button appears in the corner of the app's window. The person says
 * what they want to do, and Haptic points at the control to use, step by step.
 * It reads the app's own accessibility tree, so it needs no permission from
 * the person, and the better the app's accessibility labels are, the better
 * it points. See docs/mac.md.
 */
@MainActor
public enum Haptic {
    /**
     * The app's own name for the screen that is showing, like "settings/billing".
     * Haptic keys what it knows by screen, as it keys a site by page. Left
     * unset, the screen is named after the window's title, which is right for
     * most apps and wrong for one whose titles are the person's own, like a
     * document's name. A document window is called "/document" without it.
     */
    public static var screen: String?

    /**
     * Called with every step Haptic shows, and once more when a guide ends.
     * For the app's own analytics, and for trying Haptic out from a script.
     */
    public static var onStep: ((HapticStep) -> Void)?

    private static var guide: Guide?
    private static var stage: Stage?
    private static var starting: Task<Void, Never>?
    private static var pendingQuestion: String?

    /**
     * - site: the site's id from the Haptic dashboard.
     * - server: where Haptic's server is.
     * - appID: how the app names itself to the server. The bundle identifier
     *   unless given. The site must list "app://" and this among its allowed origins.
     */
    public static func start(site: String, server: URL, appID: String? = nil) {
        guard starting == nil, guide == nil else { return }
        let identifier = appID ?? Bundle.main.bundleIdentifier ?? ProcessInfo.processInfo.processName
        let client = Client(server: server, site: site, origin: Client.origin(for: identifier))
        LiveTree.wake()
        starting = Task {
            let config: SiteConfig
            do {
                config = try await client.config()
            } catch {
                // No button is better than one that can't answer. The reason is for whoever is setting it up.
                NSLog("Haptic: not started. %@", (error as? ServerError)?.message ?? error.localizedDescription)
                starting = nil
                return
            }
            guard config.off != true else { return }
            let stage = Stage()
            if let accent = config.appearance?.accent.flatMap(NSColor.init(hex:)) { stage.accent = accent }
            if let launcher = config.appearance?.launcher.flatMap(NSColor.init(hex:)) { stage.launcherColor = launcher }
            if let label = config.appearance?.launcherLabel, !label.isEmpty { stage.launcherLabel = String(label.prefix(24)) }
            stage.onLeft = config.appearance?.position == "bottom-left"
            let guide = Guide(client: client, stage: stage, blocked: config.blocked ?? [], visitor: visitorID(), screenName: { screen })
            guide.onStep = { onStep?($0) }
            stage.onAsk = { guide.ask($0) }
            stage.onStop = { guide.stop() }
            stage.start()
            self.stage = stage
            self.guide = guide
            if let waiting = pendingQuestion {
                pendingQuestion = nil
                guide.ask(waiting)
            }
        }
    }

    /** Asks a question as if the person had typed it: for the app's own "Show me how" buttons and Help menu. */
    public static func ask(_ question: String) {
        if let guide { guide.ask(question) } else { pendingQuestion = question }
    }

    /** Opens the box to type a question in, as the Ask button does. */
    public static func openAsk() { stage?.openAsk() }

    /** Ends the guide that is running, if one is. */
    public static func stop() { guide?.stop() }

    /**
     * What Haptic reads from the window in front, as the JSON it would send.
     * For seeing an app as Haptic sees it: a control with no label here is one
     * to give an accessibility label.
     */
    public static func snapshotJSON() -> String? {
        LiveTree.wake()
        guard let screen = LiveTree.screen(named: screen) else { return nil }
        var reader = Reader()
        let reading = reader.read(screen)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(reading.snapshot)).flatMap { String(data: $0, encoding: .utf8) }
    }

    /**
     * A random id kept in the app's own defaults, so the dashboard can count
     * people rather than questions. The server keeps only a hash of it.
     */
    private static func visitorID() -> String {
        let key = "haptic.visitor"
        if let saved = UserDefaults.standard.string(forKey: key), saved.count == 36 { return saved }
        let made = UUID().uuidString.lowercased()
        UserDefaults.standard.set(made, forKey: key)
        return made
    }
}

/** One step of a guide, as the person was shown it. */
public struct HapticStep {
    /** The sentence beside the pointer. */
    public var say: String
    /** The control pointed at: what kind it is and what it says. Nil when the step points at nothing. */
    public var role: String?
    public var label: String?
    /** Where the pointer is, in screen coordinates. For an item in a closed menu, the menu's title. */
    public var frame: CGRect?
    /** The model called this the last step. */
    public var last: Bool
    /** Set on the step that ends a guide: "finished", "stopped", "nothing_to_point_at" and so on. */
    public var outcome: String?
}
