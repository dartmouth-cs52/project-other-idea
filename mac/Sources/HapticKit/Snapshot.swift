import CoreGraphics
import Foundation

// Turns a window's accessibility tree into the list of controls the model
// sees: the same `Snapshot` the web widget makes from a page
// (src/shared/types.ts), so the server answers a Mac app as it answers a site.
//
// What a person typed is never read. The reader asks a node for its text only
// when it is a label or a heading, and asks a checkbox or a radio button only
// whether it is on. A text field is asked for its name and nothing else.
//
// The reader works on `TreeNode`, not on AppKit, so it can be tested on a tree
// written out by hand. `LiveTree.swift` is the tree of the running app.

public struct SnapElement: Codable, Equatable {
    /** Short handle like "e12", valid for one snapshot only. */
    public var id: String
    /** button, textbox, checkbox, select, tab, menuitem, treeitem, ... The web's names, so the model reads one vocabulary. */
    public var role: String
    public var label: String
    public var icon: String?
    /** "disabled", "checked", "selected", "expanded", "collapsed", or a few words like "in the closed File menu". */
    public var state: [String]?
    public var context: String?
    public var offscreen: String?
}

public struct Snapshot: Codable, Equatable {
    /** The screen, written as a path so the server keys it as it keys a page: "/settings". */
    public var path: String
    public var title: String
    /** The name of the open sheet or modal window. When set, only its elements are listed. */
    public var dialog: String?
    public var headings: [String]
    public var text: [String]
    public var elements: [SnapElement]
    public var truncated: Bool
}

/** One node of an accessibility tree, as far as the reader looks at it. */
@MainActor
protocol TreeNode: AnyObject {
    /** "AXButton", "AXTextField", ... */
    var role: String { get }
    var subrole: String { get }
    var label: String { get }
    var title: String { get }
    /** What a label or a heading says. Only ever asked of static text and headings. */
    var staticText: String { get }
    var help: String { get }
    var identifier: String { get }
    var placeholder: String { get }
    /** Whether a checkbox, switch, radio button or tab is on. Only ever asked of those. */
    var isOn: Bool { get }
    var isEnabled: Bool { get }
    var isSelected: Bool { get }
    /** Nil when the node is not something that opens. */
    var isExpanded: Bool? { get }
    /** In screen coordinates, with y running up, as AppKit has them. Empty when the node is not on show. */
    var frame: CGRect { get }
    var children: [TreeNode] { get }
    /** The label a form gives this control, when the app says which one it is. */
    var titleElement: TreeNode? { get }
    /** Brings it into view, if it can. */
    func scrollToVisible()
}

/** One entry of a menu: the menu bar's, or a pop-up or context menu that is open. */
struct MenuEntry {
    var title: String
    var enabled = true
    var checked = false
    /** For an entry with a submenu: whether it is open on screen now. */
    var open = false
    var children: [MenuEntry] = []
    var node: TreeNode
}

/** What is in front of the person: the window to read, and the menus around it. */
struct Screen {
    var root: TreeNode
    var path: String
    var title: String
    /** Set when `root` is a sheet or a modal window: its name. */
    var dialog: String?
    /** Popovers and the like that belong to the window, each read after it. */
    var extra: [(context: String, node: TreeNode)] = []
    var menuBar: [MenuEntry] = []
    /** A pop-up or context menu that is open, which is in no menu bar. */
    var openMenu: [MenuEntry] = []
    /** The part of the screen the window covers. What lies outside it is out of view. */
    var visible: CGRect
}

/** A control in a reading: the node to point at, and for an item in a closed menu, the menu bar title that opens it. */
struct Listed {
    var element: SnapElement
    var node: TreeNode
    /** Set for an item in a menu that is closed: what the person has to click first, outermost first. */
    var openers: [TreeNode] = []
    /** The menu titles above it, like ["File", "Export"]. */
    var menuPath: [String] = []
}

struct Reading {
    var snapshot: Snapshot
    var listed: [String: Listed] = [:]
    /** In the order they were found. */
    var order: [String] = []

    /** The control at a point on screen: the smallest one that holds it. */
    @MainActor
    func element(at point: CGPoint) -> Listed? {
        var best: (Listed, CGFloat)?
        for id in order {
            guard let item = listed[id], item.openers.isEmpty else { continue }
            let frame = item.node.frame
            guard frame.contains(point) else { continue }
            let area = frame.width * frame.height
            if best == nil || area < best!.1 { best = (item, area) }
        }
        return best?.0
    }

    /** Everything that matters about the screen as one string. Two readings with the same one show the same thing. */
    var signature: String {
        // The window's own controls only. Which menu items can be used changes with where the keyboard is, which is not the screen changing.
        let elements = order.compactMap { listed[$0] }.filter { $0.menuPath.isEmpty && $0.element.context != "menu bar" }.map { "\($0.element.role)|\($0.element.label)|\(($0.element.state ?? []).joined(separator: ","))" }
        return ([snapshot.path, snapshot.dialog ?? "", snapshot.headings.joined(separator: "|")] + elements).joined(separator: "\n")
    }
}

/** How a control is named in a sentence for the model, as the server names it (`describeElement`). */
func describe(_ element: SnapElement) -> String {
    if !element.label.isEmpty { return "\(element.role) \"\(element.label)\"" }
    if let icon = element.icon, !icon.isEmpty { return "\(element.role) with \(icon) icon" }
    return element.role
}

@MainActor
struct Reader {
    static let maxElements = 300
    static let maxVisited = 15_000
    static let maxTextChars = 2_500
    static let maxHeadings = 12
    /** Rows listed from one table or list. The rest are the same control repeated, and they are someone's data. */
    static let maxRows = 20
    static let maxMenuItems = 140

    /** What the person named in their question, which stays readable. */
    var own: Set<String> = []

    private var elements: [SnapElement] = []
    private var listed: [String: Listed] = [:]
    private var order: [String] = []
    private var headings: [String] = []
    private var text: [String] = []
    private var textChars = 0
    private var visited = 0
    private var truncated = false
    private var lastHeading = "" {
        didSet { if lastHeading != oldValue { lastHeadingFrame = .zero } }
    }
    private var lastHeadingFrame = CGRect.zero
    /** Every heading read so far, with where it is and what it was found under. */
    private var headingsSeen: [(words: String, frame: CGRect, landmark: String)] = []
    /** Every label on screen with where it is, for naming a field the app did not name. */
    private var labels: [(text: String, frame: CGRect)] = []
    /** Fields that came without a name, to be named from the label beside them. */
    private var unnamed: [(id: String, frame: CGRect)] = []

    init(own: Set<String> = []) { self.own = own }

    private struct Around {
        var landmark = ""
        var clip: CGRect
        var parentRole = ""
        var inRow = false
        /** What the row being read says, for naming the small arrow that opens it. */
        var rowName = ""
    }

    mutating func read(_ screen: Screen) -> Reading {
        walk(screen.root, Around(clip: screen.visible))
        for extra in screen.extra { walk(extra.node, Around(landmark: extra.context, clip: extra.node.frame)) }
        nameUnnamedFields()
        if screen.dialog == nil { listMenus(screen.menuBar, bar: true) }
        listMenus(screen.openMenu, bar: false)
        var snapshot = Snapshot(path: screen.path, title: Masking.clean(screen.title, own: own), headings: headings, text: text, elements: elements, truncated: truncated)
        // A sheet has no title bar, so it is named by its heading.
        if let dialog = screen.dialog { snapshot.dialog = Masking.clean(nonEmpty(dialog, headings.first ?? "") ?? "", max: 60, own: own) }
        return Reading(snapshot: snapshot, listed: listed, order: order)
    }

    // The window -----------------------------------------------------------------

    private static let titleBarButtons: Set<String> = ["AXCloseButton", "AXMinimizeButton", "AXZoomButton", "AXFullScreenButton", "AXToolbarButton"]
    private static let landmarks: [String: String] = ["AXToolbar": "toolbar", "AXSheet": "dialog", "AXPopover": "popover", "AXDrawer": "drawer", "AXTabGroup": "tabs"]

    private mutating func walk(_ node: TreeNode, _ given: Around) {
        visited += 1
        if visited > Self.maxVisited { truncated = true; return }
        var around = given
        let role = node.role
        let subrole = node.subrole

        switch role {
        case "AXStaticText":
            if !around.inRow { addText(node) }
            return
        case "AXHeading":
            // Inside a row it is the row's own words, which the row is already named by.
            if !around.inRow { addHeading(node, around) }
            return
        case "AXButton", "AXMenuButton", "AXDisclosureTriangle", "AXColorWell":
            if Self.titleBarButtons.contains(subrole) { return }
            var state: [String] = []
            if let expanded = node.isExpanded { state.append(expanded ? "expanded" : "collapsed") }
            else if role == "AXMenuButton" { state.append("collapsed") }
            else if role == "AXDisclosureTriangle" { state.append(node.isOn ? "expanded" : "collapsed") }
            // The arrow that opens a row of a tree has no name of its own. It is named by its row.
            let arrow = role == "AXDisclosureTriangle" && around.inRow && nonEmpty(node.label, node.title) == nil
            add(node, "button", around, state, name: arrow && !around.rowName.isEmpty ? around.rowName : nil)
            return
        case "AXLink":
            add(node, "link", around)
            return
        case "AXCheckBox":
            let isSwitch = subrole == "AXSwitch" || subrole == "AXToggle"
            add(node, isSwitch ? "switch" : "checkbox", around, node.isOn ? ["checked"] : [])
            return
        case "AXRadioButton":
            let tab = around.parentRole == "AXTabGroup" || subrole == "AXTabButton"
            add(node, tab ? "tab" : "radio", around, node.isOn || node.isSelected ? [tab ? "selected" : "checked"] : [])
            return
        case "AXPopUpButton":
            add(node, "select", around, [], field: true)
            return
        case "AXComboBox":
            add(node, "combobox", around, [], field: true)
            return
        case "AXTextField", "AXTextArea":
            add(node, subrole == "AXSearchField" ? "searchbox" : "textbox", around, [], field: true)
            return
        case "AXSlider":
            add(node, "slider", around, [], field: true)
            return
        case "AXIncrementor":
            add(node, "spinbutton", around, [], field: true)
            return
        case "AXMenuItem", "AXMenuBarItem":
            add(node, "menuitem", around)
            return
        case "AXRow":
            // A row of a sidebar or a table is something to click. Its words are its name, and are not listed again as text.
            // A sidebar's group title is a row too, but nothing happens when it is clicked. It names the rows under it.
            if let title = groupTitle(of: node) {
                lastHeading = title
                return
            }
            let name = wordsIn(node)
            if !name.isEmpty {
                let role = around.parentRole == "AXOutline" ? "treeitem" : "row"
                add(node, role, around, node.isSelected ? ["selected"] : [], name: name)
            }
            around.inRow = true
            around.rowName = name
        case "AXOutline", "AXTable", "AXList":
            around.parentRole = role
            if let label = nonEmpty(node.label, node.title) { around.landmark = Masking.clean(label, max: 40, own: own) }
            let visible = clipped(around.clip, node.frame)
            around.clip = visible
            var rows = 0
            let headingBefore = lastHeading
            for child in node.children {
                if child.role == "AXRow" {
                    rows += 1
                    if rows > Self.maxRows { truncated = true; continue }
                }
                walk(child, around)
            }
            // A group title inside the list names its rows, and nothing after the list.
            lastHeading = headingBefore
            return
        case "AXScrollArea":
            around.clip = clipped(around.clip, node.frame)
        case "AXScrollBar":
            // Its arrows and page areas are buttons with no name, and nobody is ever sent to one.
            return
        case "AXMenuBar", "AXMenu":
            // The app's menus are read from the menus themselves, with what is behind each one.
            return
        default:
            if let landmark = Self.landmarks[role] { around.landmark = landmark }
            // A box with a name, like "Notifications" around three switches.
            // And a row of segments or radio buttons, which says what is being chosen: "Period" over week, month, quarter.
            else if role == "AXGroup" || role == "AXRadioGroup", let label = nonEmpty(node.label, node.title) { around.landmark = Masking.clean(label, max: 40, own: own) }
        }

        // A tab view keeps its role for its tabs. Any other container hands none down.
        if role != "AXRow" { around.parentRole = role == "AXTabGroup" || role == "AXRadioGroup" ? role : (role == "AXGroup" ? around.parentRole : "") }
        for child in node.children { walk(child, around) }
    }

    /** For a row that holds a heading and nothing else, like "Spend" over three rows of a sidebar: what it says. */
    private func groupTitle(of row: TreeNode) -> String? {
        var heading: String?
        var other = false
        func look(_ node: TreeNode, _ depth: Int) {
            guard depth < 5, !other else { return }
            for child in node.children {
                if child.role == "AXHeading" { heading = nonEmpty(child.label, child.title, child.staticText) }
                else if child.role == "AXCell" || child.role == "AXGroup" { look(child, depth + 1) }
                else { other = true }
            }
        }
        look(row, 0)
        guard !other, let heading else { return nil }
        let words = Masking.clean(heading, max: 40, own: own)
        return words.isEmpty ? nil : words
    }

    private func clipped(_ clip: CGRect, _ frame: CGRect) -> CGRect {
        frame.isEmpty ? clip : clip.intersection(frame)
    }

    private mutating func addText(_ node: TreeNode) {
        let raw = node.staticText.isEmpty ? nonEmpty(node.label, node.title) ?? "" : node.staticText
        let words = Masking.clean(raw, max: 160, own: own)
        guard !words.isEmpty else { return }
        if !node.frame.isEmpty { labels.append((words, node.frame)) }
        guard textChars < Self.maxTextChars, !text.contains(words) else { return }
        text.append(words)
        textChars += words.count
    }

    private mutating func addHeading(_ node: TreeNode, _ around: Around) {
        let words = Masking.clean(nonEmpty(node.label, node.title, node.staticText) ?? wordsIn(node), own: own)
        guard !words.isEmpty else { return }
        lastHeading = words
        lastHeadingFrame = node.frame
        if !node.frame.isEmpty { headingsSeen.append((words, node.frame, around.landmark)) }
        if headings.count < Self.maxHeadings, !headings.contains(words) { headings.append(words) }
    }

    /** The words inside a node: its labels, joined. For a row, and for a button the app gave no name of its own. */
    private func wordsIn(_ node: TreeNode, depth: Int = 0) -> String {
        var parts: [String] = []
        func gather(_ node: TreeNode, _ depth: Int) {
            guard depth < 6, parts.count < 6 else { return }
            for child in node.children {
                if child.role == "AXStaticText" || child.role == "AXHeading" {
                    let words = child.staticText.isEmpty ? nonEmpty(child.label, child.title) ?? "" : child.staticText
                    if !words.isEmpty { parts.append(words) }
                } else if !Self.fieldRoles.contains(child.role) {
                    // Never the inside of a field: what is there is what someone typed.
                    gather(child, depth + 1)
                }
            }
        }
        gather(node, depth)
        return Masking.clean(parts.joined(separator: " "), own: own)
    }

    private static let fieldRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]

    private mutating func add(_ node: TreeNode, _ role: String, _ around: Around, _ state: [String] = [], field: Bool = false, name given: String? = nil) {
        let frame = node.frame
        // Nothing to point at: it is hidden, or not laid out.
        guard !frame.isEmpty else { return }
        guard elements.count < Self.maxElements else { truncated = true; return }

        var label = given ?? ""
        if label.isEmpty { label = Masking.clean(nonEmpty(node.label, node.title) ?? "", own: own) }
        if label.isEmpty, let title = node.titleElement { label = Masking.clean(nonEmpty(title.staticText, title.label, title.title) ?? "", own: own) }
        // A field's own words are what was typed into it, so only a control that is not one is named from them.
        if label.isEmpty, !field { label = wordsIn(node) }
        if label.isEmpty, field { label = Masking.clean(node.placeholder, own: own) }
        if label.isEmpty { label = Masking.clean(node.help, own: own) }

        let id = "e\(elements.count + 1)"
        var element = SnapElement(id: id, role: role, label: label)
        if label.isEmpty {
            if field { unnamed.append((id, frame)) }
            // An identifier is the developer's name for it, like "sidebar.add".
            else if !node.identifier.isEmpty, !node.identifier.hasPrefix("_") { element.icon = Masking.clean(node.identifier, max: 40, own: own) }
        }
        var states = state
        if !node.isEnabled { states.append("disabled") }
        if !states.isEmpty { element.state = states }
        let context = [around.landmark, heading(over: frame, in: around.landmark)].filter { !$0.isEmpty }.joined(separator: " › ")
        if !context.isEmpty { element.context = String(context.prefix(120)) }
        if !around.clip.intersects(frame) {
            if frame.minY >= around.clip.maxY { element.offscreen = "above" }
            else if frame.maxY <= around.clip.minY { element.offscreen = "below" }
        }
        elements.append(element)
        listed[id] = Listed(element: element, node: node)
        order.append(id)
    }

    /**
     * The heading a control sits under. Nearly always the last one read. But
     * two boxes side by side can be read heading, heading, then the controls of
     * both mixed together, so a last heading that starts to the right of the
     * control is not its own, and the nearest one above it is taken instead.
     */
    private func heading(over frame: CGRect, in landmark: String) -> String {
        guard !lastHeadingFrame.isEmpty, lastHeadingFrame.minX >= frame.maxX else { return lastHeading }
        var best: (words: String, frame: CGRect)?
        // y runs up, so a heading above the control has the larger y.
        for seen in headingsSeen where seen.landmark == landmark && seen.frame.minX < frame.maxX && seen.frame.minY >= frame.minY {
            if let found = best {
                let nearer = seen.frame.minY < found.frame.minY - 2
                let level = abs(seen.frame.minY - found.frame.minY) <= 2
                if nearer || (level && seen.frame.minX > found.frame.minX) { best = (seen.words, seen.frame) }
            } else {
                best = (seen.words, seen.frame)
            }
        }
        return best?.words ?? ""
    }

    /**
     * A field the app gave no name is named from the label beside it: the
     * nearest one that ends to its left on the same line, or failing that the
     * one just above it. Forms built in AppKit are full of these.
     */
    private mutating func nameUnnamedFields() {
        for (id, frame) in unnamed {
            var best: (String, CGFloat)?
            for (words, labelFrame) in labels {
                let sameLine = labelFrame.minY < frame.maxY && labelFrame.maxY > frame.minY
                let above = labelFrame.minX < frame.maxX && labelFrame.maxX > frame.minX
                var distance: CGFloat?
                if sameLine, labelFrame.maxX <= frame.minX + 4 { distance = frame.minX - labelFrame.maxX }
                else if above, labelFrame.minY >= frame.maxY - 2 { distance = (labelFrame.minY - frame.maxY) * 3 }
                guard let distance, distance < 260, best == nil || distance < best!.1 else { continue }
                best = (words, distance)
            }
            guard let name = best?.0, let index = elements.firstIndex(where: { $0.id == id }) else { continue }
            elements[index].label = String(name.prefix(80)).trimmingCharacters(in: CharacterSet(charactersIn: ": "))
            listed[id]?.element = elements[index]
        }
    }

    // Menus ----------------------------------------------------------------------

    /**
     * The menu bar is where much of a Mac app lives, so every item is listed,
     * with the menu it is in. One in a closed menu says so: the person opens
     * the menu first, and the pointer starts on the menu's title.
     */
    private mutating func listMenus(_ entries: [MenuEntry], bar: Bool) {
        var count = 0
        func list(_ entry: MenuEntry, path: [String], openers: [TreeNode], shown: Bool, top: Bool) {
            guard count < Self.maxMenuItems, elements.count < Self.maxElements else { truncated = true; return }
            let title = Masking.clean(entry.title, own: own)
            guard !title.isEmpty else { return }
            count += 1
            let id = "e\(elements.count + 1)"
            var element = SnapElement(id: id, role: entry.children.isEmpty ? "menuitem" : "menu", label: title)
            var states: [String] = []
            if entry.checked { states.append("checked") }
            if !entry.children.isEmpty { states.append(entry.open ? "expanded" : "collapsed") }
            if !shown, let menu = path.last { states.append("in the closed \(menu) menu") }
            if !entry.enabled { states.append("disabled") }
            if !states.isEmpty { element.state = states }
            element.context = (bar && top) ? "menu bar" : (path.isEmpty ? "menu" : "menu " + path.joined(separator: " › "))
            elements.append(element)
            listed[id] = Listed(element: element, node: entry.node, openers: shown ? [] : openers, menuPath: path)
            order.append(id)
            for child in entry.children {
                list(child, path: path + [title], openers: openers + [entry.node], shown: shown && entry.open, top: false)
            }
        }
        for entry in entries { list(entry, path: [], openers: [], shown: true, top: true) }
    }
}

func nonEmpty(_ candidates: String...) -> String? {
    candidates.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}
