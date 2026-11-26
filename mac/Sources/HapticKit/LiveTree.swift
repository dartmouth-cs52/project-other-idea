import AppKit

// The accessibility tree of the app HapticKit is built into. An app can read
// its own tree without asking the person for anything: the Accessibility
// permission in System Settings is for reading other apps.

/**
 * A node of the running app's tree: a window, a view, a cell, or one of
 * SwiftUI's elements. SwiftUI's are plain objects that answer the
 * accessibility methods without saying they conform to the protocol, so each
 * method is looked up on the object as it is asked, and one that is missing
 * answers nothing.
 */
final class LiveNode: TreeNode {
    let object: NSObject
    init(_ object: NSObject) { self.object = object }

    /** What the object answers to one of the accessibility methods, or failing that to the attribute AppKit had before them. */
    private func ask(_ method: String, _ attribute: String) -> Any? {
        if object.responds(to: NSSelectorFromString(method)) { return object.value(forKey: method) }
        return object.accessibilityAttributeValue(NSAccessibility.Attribute(rawValue: attribute))
    }
    private func words(_ method: String, _ attribute: String) -> String { (ask(method, attribute) as? String) ?? "" }

    var role: String { words("accessibilityRole", "AXRole") }
    var subrole: String { words("accessibilitySubrole", "AXSubrole") }
    var label: String { words("accessibilityLabel", "AXDescription") }
    var title: String { words("accessibilityTitle", "AXTitle") }
    var help: String { words("accessibilityHelp", "AXHelp") }
    var identifier: String { words("accessibilityIdentifier", "AXIdentifier") }
    var placeholder: String { words("accessibilityPlaceholderValue", "AXPlaceholderValue") }
    private var value: Any? { ask("accessibilityValue", "AXValue") }
    var staticText: String {
        switch value {
        case let text as String: return text
        case let text as NSAttributedString: return text.string
        default: return ""
        }
    }
    var isOn: Bool {
        switch value {
        case let number as NSNumber: return number.intValue != 0
        case let text as String: return text == "1" || text == "on"
        default: return false
        }
    }
    var isEnabled: Bool { (ask("isAccessibilityEnabled", "AXEnabled") as? Bool) ?? true }
    var isSelected: Bool { (ask("isAccessibilitySelected", "AXSelected") as? Bool) ?? false }
    var isExpanded: Bool? {
        // Only a node that says it can be opened has an answer worth having.
        guard role == "AXDisclosureTriangle" else { return nil }
        return ask("isAccessibilityExpanded", "AXExpanded") as? Bool
    }
    var frame: CGRect { frame(depth: 0) }

    /**
     * Where it is on screen. A row of a list and the tab of a tab view are not
     * views, and some answer with no frame at all: then it is asked the older
     * way, and failing that it is where its contents are.
     */
    private func frame(depth: Int) -> CGRect {
        if let item = object as? NSMenuItem { return LiveTree.frame(of: item) }
        if object.responds(to: NSSelectorFromString("accessibilityFrame")), let frame = (object.value(forKey: "accessibilityFrame") as? NSValue)?.rectValue, !frame.isEmpty { return frame }
        let attributes = object.accessibilityAttributeNames().map(\.rawValue)
        if attributes.contains("AXPosition"), attributes.contains("AXSize"),
           let position = (object.accessibilityAttributeValue(.position) as? NSValue)?.pointValue,
           let size = (object.accessibilityAttributeValue(.size) as? NSValue)?.sizeValue, size.width > 0, size.height > 0 {
            return CGRect(origin: position, size: size)
        }
        guard depth < 3 else { return .zero }
        var union = CGRect.null
        for case let child as LiveNode in children {
            let frame = child.frame(depth: depth + 1)
            if !frame.isEmpty { union = union.union(frame) }
        }
        return union.isNull ? .zero : union
    }
    var children: [TreeNode] {
        ((ask("accessibilityChildren", "AXChildren") as? [Any]) ?? []).compactMap { child in
            guard let object = child as? NSObject, !(object is HapticWindow) else { return nil }
            return LiveNode(object)
        }
    }
    var titleElement: TreeNode? {
        guard let title = ask("accessibilityTitleUIElement", "AXTitleUIElement") as? NSObject else { return nil }
        return LiveNode(title)
    }

    func scrollToVisible() {
        if let view = object as? NSView {
            view.scrollToVisible(view.bounds)
        } else if (object.accessibilityActionNames() as [NSAccessibility.Action]).contains(NSAccessibility.Action(rawValue: "AXScrollToVisible")) {
            object.accessibilityPerformAction(NSAccessibility.Action(rawValue: "AXScrollToVisible"))
        }
    }
}

@MainActor
enum LiveTree {
    /** The menu being shown from a pop-up button or a right click, while it is open. */
    static var trackedMenu: NSMenu?

    /**
     * SwiftUI builds its accessibility tree only once something has asked for
     * one, as VoiceOver does when it starts. This is that request, made by the
     * app of itself. AppKit's own views need nothing.
     */
    static func wake() {
        (NSApp as NSObject).accessibilitySetValue(true, forAttribute: NSAccessibility.Attribute(rawValue: "AXEnhancedUserInterface"))
    }

    /** The window the person is working in: the main window, or the key one, that is not HapticKit's. */
    static func hostWindow() -> NSWindow? {
        // An alert or an inspector is a panel, and is where the person works only when there is no ordinary window.
        let ordered = NSApp.orderedWindows
        let candidates = [NSApp.mainWindow, NSApp.keyWindow] + ordered.filter { !($0 is NSPanel) }.map(Optional.some) + ordered.map(Optional.some)
        return candidates.compactMap { $0 }.first { isHost($0) }
    }

    static func isHost(_ window: NSWindow) -> Bool {
        guard !(window is HapticWindow), window.isVisible, !window.isSheet else { return false }
        // Menus, tooltips and popovers are windows too, and are not where the person works.
        return window.level == .normal || window.level == .floating || window.level == .modalPanel
    }

    /** `name` is the app's own word for the screen, when it has given one. */
    static func screen(named name: String?) -> Screen? {
        guard let host = hostWindow() else { return nil }
        var root: NSWindow = host
        var dialog: String?
        // A sheet on a sheet: the innermost is the one that can be used.
        while let sheet = root.attachedSheet {
            root = sheet
            dialog = sheet.title
        }
        if let modal = NSApp.modalWindow, !(modal is HapticWindow), modal !== host, dialog == nil {
            root = modal
            dialog = modal.title
        }
        let title = host.title
        var screen = Screen(root: LiveNode(root), path: path(for: name ?? title, document: host.representedURL != nil && name == nil), title: title, dialog: dialog, visible: root.frame)
        if dialog == nil {
            for child in host.childWindows ?? [] where !(child is HapticWindow) && child.isVisible {
                screen.extra.append(("popover", LiveNode(child)))
            }
        }
        if let menu = NSApp.mainMenu { screen.menuBar = entries(of: menu, depth: 0) }
        if let tracked = trackedMenu, tracked !== NSApp.mainMenu, tracked.supermenu == nil {
            screen.openMenu = entries(of: tracked, depth: 1, open: true)
        }
        return screen
    }

    /**
     * The screen as a path, so the server can key what it knows by it as it
     * does a page's address. A document's window is named after the file, which
     * is the person's own, so it is "/document" unless the app names the screen.
     */
    static func path(for name: String, document: Bool) -> String {
        if document { return "/document" }
        // A name the app gave can have parts, like "cards/card", and keeps them, as a page's path keeps its own.
        let parts = name.split(separator: "/").prefix(4).compactMap { part -> String? in
            let slug = part.lowercased().unicodeScalars.map { CharacterSet.alphanumerics.contains($0) && $0.isASCII ? Character($0) : "-" }
            let joined = String(slug).split(separator: "-").joined(separator: "-")
            return joined.isEmpty ? nil : String(joined.prefix(60))
        }
        return "/" + (parts.isEmpty ? "window" : parts.joined(separator: "/"))
    }

    private static func entries(of menu: NSMenu, depth: Int, open: Bool = false) -> [MenuEntry] {
        // Which items can be used is worked out when a menu opens. Asking now gives the answer the person would see.
        if depth > 0 { menu.update() }
        return menu.items.compactMap { item in
            guard !item.isSeparatorItem, !item.isHidden, !item.title.isEmpty else { return nil }
            var entry = MenuEntry(title: item.title, enabled: item.isEnabled, checked: item.state == .on, node: LiveNode(item))
            if let submenu = item.submenu, depth < 2 {
                // The Services menu is other apps' commands, and the Apple menu is the system's.
                if submenu === NSApp.servicesMenu || item.title == "Services" { return nil }
                entry.open = open ? false : isOpen(submenu)
                entry.children = entries(of: submenu, depth: depth + 1)
            }
            return entry
        }
    }

    /** A menu is open when it is the one the tracked menu has highlighted its way down to. */
    static func isOpen(_ menu: NSMenu) -> Bool {
        var at: NSMenu? = NSApp.mainMenu
        while let current = at, let highlighted = current.highlightedItem, let submenu = highlighted.submenu {
            if submenu === menu { return true }
            at = submenu
        }
        return false
    }

    /** True for an item somewhere under the app's menu bar, and not in a pop-up button's or a right click's menu. */
    static func inMenuBar(_ item: NSMenuItem) -> Bool {
        var menu = item.menu
        while let current = menu {
            if current === NSApp.mainMenu { return true }
            menu = current.supermenu
        }
        return false
    }

    /** Where a menu item is on screen: its title in the menu bar, or its line in an open menu. Empty while its menu is closed. */
    static func frame(of item: NSMenuItem) -> CGRect {
        let frame = item.accessibilityFrame()
        return frame.width > 1 && frame.height > 1 ? frame : .zero
    }
}
