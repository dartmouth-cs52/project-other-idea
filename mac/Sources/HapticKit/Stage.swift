import AppKit
import QuartzCore

// What the person sees of Haptic in a Mac app: the Ask button in the corner
// of the window, the box a question is typed in, the pointer on the control
// to use, and the sentence beside it. Each is a small window of its own laid
// over the app's, so nothing is added to the app's views, and none of them is
// ever read as part of the app (`HapticWindow`).

@MainActor
final class Stage {
    var accent = NSColor(hex: "#1E6EF4") ?? .systemBlue
    var launcherColor = NSColor(hex: "#111111") ?? .black
    var launcherLabel = "Ask"
    /** Bottom right unless the site says left. */
    var onLeft = false

    var onAsk: ((String) -> Void)?
    /** The person closed the sentence, or pressed the Ask button while a guide ran. */
    var onStop: (() -> Void)?

    private var launcher: HapticWindow?
    private var askPanel: AskPanel?
    private var pointer: HapticWindow?
    private var pointerView: PointerView?
    private var caption: HapticWindow?
    private var captionView: CaptionView?
    private weak var host: NSWindow?
    private var hostFrame = CGRect.zero
    private var tick: Timer?
    /** Where the control being pointed at is now. Asked many times a second, since windows move and lists scroll. */
    private var target: (() -> CGRect?)?
    private var shownTarget = CGRect.zero
    private var said: (text: String, busy: Bool)?

    func start() {
        guard tick == nil else { return }
        // In the common modes, so it keeps running while a menu is open: that is when the pointer has to move into the menu.
        let timer = Timer(timeInterval: 0.08, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.keepUp() }
        }
        RunLoop.main.add(timer, forMode: .common)
        tick = timer
        keepUp()
    }

    // The pointer and the sentence -------------------------------------------------

    func point(at target: @escaping () -> CGRect?) {
        self.target = target
        shownTarget = .zero
        keepUp()
    }

    func unpoint() {
        target = nil
        shownTarget = .zero
        pointer?.orderOut(nil)
        if said != nil { layoutCaption() }
    }

    /** The step's sentence. `busy` is the short word shown while the next step is on its way. */
    func say(_ text: String, busy: Bool = false) {
        said = (text, busy)
        let view = captionView ?? makeCaption()
        view.set(text: text, busy: busy)
        layoutCaption()
        caption?.orderFront(nil)
    }

    func clear() {
        said = nil
        caption?.orderOut(nil)
        unpoint()
    }

    private func makeCaption() -> CaptionView {
        let window = overlay(ignoresMouse: false)
        let view = CaptionView(frame: .zero)
        view.onClose = { [weak self] in self?.onStop?() }
        window.contentView = view
        caption = window
        captionView = view
        return view
    }

    private func makePointer() -> PointerView {
        let window = overlay(ignoresMouse: true)
        let view = PointerView(frame: .zero)
        view.accent = accent
        window.contentView = view
        pointer = window
        pointerView = view
        return view
    }

    private func overlay(ignoresMouse: Bool) -> HapticWindow {
        let window = HapticWindow(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = !ignoresMouse
        window.ignoresMouseEvents = ignoresMouse
        // Above an open menu, so an item in it can be pointed at.
        window.level = NSWindow.Level(rawValue: NSWindow.Level.popUpMenu.rawValue + 1)
        window.hidesOnDeactivate = true
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.transient, .ignoresCycle, .fullScreenAuxiliary]
        return window
    }

    private func keepUp() {
        attachLauncher()
        guard let target else { return }
        guard let frame = target(), !frame.isEmpty else {
            // Scrolled away, or its window closed. The sentence stays, and the pointer comes back if the control does.
            if shownTarget != .zero {
                shownTarget = .zero
                pointer?.orderOut(nil)
                layoutCaption()
            }
            return
        }
        guard frame != shownTarget else { return }
        let first = shownTarget == .zero
        shownTarget = frame
        let view = pointerView ?? makePointer()
        let box = PointerView.box(around: frame)
        pointer?.setFrame(box, display: true)
        view.show(target: frame, in: box)
        if first { pointer?.orderFront(nil) }
        layoutCaption()
    }

    private func layoutCaption() {
        guard let caption, let captionView, said != nil else { return }
        let size = captionView.fittingSize()
        var origin: CGPoint
        if shownTarget != .zero {
            // Under the control, clear of the pointer. Over it when there is no room underneath.
            let screen = NSScreen.screens.first { $0.frame.intersects(shownTarget) } ?? NSScreen.main
            let visible = screen?.visibleFrame ?? .zero
            origin = CGPoint(x: shownTarget.minX, y: shownTarget.minY - PointerView.arrow - 10 - size.height)
            if origin.y < visible.minY + 4 { origin.y = shownTarget.maxY + 12 }
            origin.x = min(max(origin.x, visible.minX + 8), visible.maxX - size.width - 8)
        } else if let host {
            let x = onLeft ? host.frame.minX + 18 : host.frame.maxX - 18 - size.width
            origin = CGPoint(x: x, y: host.frame.minY + 18 + Launcher.height + 10)
        } else {
            return
        }
        caption.setFrame(CGRect(origin: origin, size: size), display: true)
    }

    // The Ask button -------------------------------------------------------------

    private func attachLauncher() {
        guard let window = LiveTree.hostWindow() else { return }
        if launcher == nil { launcher = makeLauncher() }
        guard let launcher else { return }
        if window !== host {
            host.map { $0.removeChildWindow(launcher) }
            askPanel?.orderOut(nil)
            host = window
            hostFrame = .zero
            // A child of the app's window, so it moves with it and is never over another app's.
            window.addChildWindow(launcher, ordered: .above)
        }
        if window.frame != hostFrame {
            hostFrame = window.frame
            let size = launcher.frame.size
            let x = onLeft ? window.frame.minX + 18 : window.frame.maxX - 18 - size.width
            launcher.setFrameOrigin(CGPoint(x: x, y: window.frame.minY + 18))
            if said != nil, shownTarget == .zero { layoutCaption() }
        }
    }

    private func makeLauncher() -> HapticWindow {
        let button = Launcher(title: launcherLabel, color: launcherColor)
        button.onPress = { [weak self] in self?.openAsk() }
        let window = HapticWindow(contentRect: CGRect(origin: .zero, size: button.frame.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.isReleasedWhenClosed = false
        window.contentView = button
        return window
    }

    func openAsk() {
        guard let host else { return }
        onStop?()
        let panel = askPanel ?? AskPanel()
        askPanel = panel
        panel.onSubmit = { [weak self] question in
            panel.orderOut(nil)
            self?.onAsk?(question)
        }
        let size = panel.frame.size
        let x = onLeft ? host.frame.minX + 18 : host.frame.maxX - 18 - size.width
        panel.setFrameOrigin(CGPoint(x: x, y: host.frame.minY + 18 + Launcher.height + 10))
        panel.open()
    }
}

/** A window of HapticKit's own. Never read, and never the window the person is working in. */
class HapticWindow: NSPanel {}

/** The pill in the corner of the app's window. */
final class Launcher: NSView {
    static let height: CGFloat = 32
    var onPress: (() -> Void)?
    private let title: String
    private let color: NSColor

    init(title: String, color: NSColor) {
        self.title = title
        self.color = color
        let width = (title as NSString).size(withAttributes: [.font: Launcher.font]).width + 46
        super.init(frame: CGRect(x: 0, y: 0, width: ceil(width), height: Launcher.height))
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { nil }

    private static let font = NSFont.systemFont(ofSize: 13, weight: .semibold)

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        // The Haptic pointer, small, before the word.
        let arrow = PointerView.arrowPath(tip: CGPoint(x: 13, y: bounds.height - 9), size: 14)
        NSColor.white.setFill()
        arrow.fill()
        let attributes: [NSAttributedString.Key: Any] = [.font: Launcher.font, .foregroundColor: NSColor.white]
        let size = (title as NSString).size(withAttributes: attributes)
        (title as NSString).draw(at: CGPoint(x: 31, y: (bounds.height - size.height) / 2), withAttributes: attributes)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { onPress?() }
}

/** The box a question is typed in. The one window of Haptic's that takes the keyboard. */
final class AskPanel: HapticWindow, NSTextFieldDelegate {
    var onSubmit: ((String) -> Void)?
    private let field = NSTextField()

    init() {
        super.init(contentRect: CGRect(x: 0, y: 0, width: 340, height: 44), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isReleasedWhenClosed = false
        level = .floating
        hidesOnDeactivate = true

        let box = NSVisualEffectView(frame: CGRect(x: 0, y: 0, width: 340, height: 44))
        box.material = .popover
        box.state = .active
        box.wantsLayer = true
        box.layer?.cornerRadius = 12
        box.layer?.masksToBounds = true
        field.frame = CGRect(x: 14, y: 11, width: 312, height: 22)
        field.placeholderString = "What do you want to do?"
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 14)
        field.delegate = self
        field.cell?.usesSingleLineMode = true
        box.addSubview(field)
        contentView = box
    }

    override var canBecomeKey: Bool { true }

    func open() {
        field.stringValue = ""
        makeKeyAndOrderFront(nil)
        makeFirstResponder(field)
    }

    override func resignKey() {
        super.resignKey()
        orderOut(nil)
    }

    override func cancelOperation(_ sender: Any?) { orderOut(nil) }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.insertNewline(_:)) {
            // The box holds 300 characters, as the web's does.
            let question = String(field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))
            if !question.isEmpty { onSubmit?(question) }
            return true
        }
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            orderOut(nil)
            return true
        }
        return false
    }
}

/** The ring around the control and the pointer on it. */
final class PointerView: NSView {
    static let arrow: CGFloat = 30
    private static let margin: CGFloat = 6
    var accent = NSColor.systemBlue
    private let ring = CAShapeLayer()
    private let glyph = CAShapeLayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.addSublayer(ring)
        layer?.addSublayer(glyph)
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { nil }

    /** The tip rests inside the control, low and to the right of its middle, and the pointer hangs down from there. */
    private static func tip(for target: CGRect) -> CGPoint {
        CGPoint(x: target.midX + min(target.width * 0.25, 36), y: target.minY + min(target.height * 0.4, 12))
    }

    /** The part of the screen the ring and the pointer take up, for a control at `target`. */
    static func box(around target: CGRect) -> CGRect {
        let tip = tip(for: target)
        let hanging = CGRect(x: tip.x - 6, y: tip.y - arrow - 4, width: arrow + 12, height: arrow + 10)
        return target.insetBy(dx: -margin - 4, dy: -margin - 4).union(hanging).integral
    }

    func show(target: CGRect, in box: CGRect) {
        frame = CGRect(origin: .zero, size: box.size)
        let local = target.offsetBy(dx: -box.minX, dy: -box.minY).insetBy(dx: -Self.margin + 2, dy: -Self.margin + 2)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        ring.frame = bounds
        ring.path = CGPath(roundedRect: local, cornerWidth: min(8, local.height / 2), cornerHeight: min(8, local.height / 2), transform: nil)
        ring.fillColor = accent.withAlphaComponent(0.10).cgColor
        ring.strokeColor = accent.cgColor
        ring.lineWidth = 2.5
        let tip = Self.tip(for: target)
        glyph.frame = bounds
        glyph.path = Self.arrowPath(tip: CGPoint(x: tip.x - box.minX, y: tip.y - box.minY), size: Self.arrow).asCGPath
        glyph.fillColor = accent.cgColor
        glyph.strokeColor = NSColor.white.cgColor
        glyph.lineWidth = 2
        glyph.lineJoin = .round
        glyph.shadowOpacity = 0.3
        glyph.shadowRadius = 3
        glyph.shadowOffset = CGSize(width: 0, height: -1)
        CATransaction.commit()
        if ring.animation(forKey: "pulse") == nil {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.45
            pulse.duration = 0.9
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            ring.add(pulse, forKey: "pulse")
        }
    }

    /**
     * The Haptic pointer (assets/pointer.svg), with its tip at `tip` and its
     * body down and to the right. The drawing is 24 units square with y
     * running down, so it is turned over for AppKit, where y runs up.
     */
    static func arrowPath(tip: CGPoint, size: CGFloat) -> NSBezierPath {
        let scale = size / 24
        let at = { (x: CGFloat, y: CGFloat) in CGPoint(x: tip.x + (x - 3.81) * scale, y: tip.y - (y - 3.14) * scale) }
        let path = NSBezierPath()
        path.move(to: at(3.27, 4.87))
        path.curve(to: at(5.60, 2.91), controlPoint1: at(2.95, 3.55), controlPoint2: at(4.35, 2.35))
        path.line(to: at(19.82, 9.60))
        path.curve(to: at(19.71, 12.68), controlPoint1: at(21.15, 10.25), controlPoint2: at(21.05, 12.15))
        path.line(to: at(13.96, 14.88))
        path.curve(to: at(13.64, 15.14), controlPoint1: at(13.83, 14.93), controlPoint2: at(13.72, 15.02))
        path.line(to: at(10.51, 20.43))
        path.curve(to: at(7.44, 20.02), controlPoint1: at(9.75, 21.70), controlPoint2: at(7.85, 21.45))
        path.close()
        return path
    }
}

/** The step's sentence, with a cross to call the guide off. */
final class CaptionView: NSView {
    var onClose: (() -> Void)?
    private let label = NSTextField(wrappingLabelWithString: "")
    private let close = NSButton(title: "✕", target: nil, action: nil)
    private static let width: CGFloat = 300

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = (NSColor(hex: "#111111") ?? .black).withAlphaComponent(0.96).cgColor
        layer?.cornerRadius = 10
        label.textColor = .white
        label.font = .systemFont(ofSize: 13)
        label.isSelectable = false
        label.setAccessibilityElement(false)
        addSubview(label)
        close.isBordered = false
        close.attributedTitle = NSAttributedString(string: "✕", attributes: [.foregroundColor: NSColor.white.withAlphaComponent(0.7), .font: NSFont.systemFont(ofSize: 11, weight: .medium)])
        close.target = self
        close.action = #selector(pressedClose)
        close.setAccessibilityElement(false)
        addSubview(close)
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { nil }

    @objc private func pressedClose() { onClose?() }

    func set(text: String, busy: Bool) {
        label.stringValue = busy ? text + "…" : text
        label.textColor = busy ? NSColor.white.withAlphaComponent(0.7) : .white
    }

    func fittingSize() -> CGSize {
        let textWidth = Self.width - 12 - 30
        let wanted = label.sizeThatFits(CGSize(width: textWidth, height: 600))
        let size = CGSize(width: min(Self.width, ceil(wanted.width) + 12 + 30), height: ceil(wanted.height) + 20)
        frame = CGRect(origin: .zero, size: size)
        label.frame = CGRect(x: 12, y: 10, width: size.width - 42, height: ceil(wanted.height))
        close.frame = CGRect(x: size.width - 26, y: size.height - 26, width: 20, height: 20)
        return size
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

extension NSColor {
    /** "#1E6EF4". Nil for anything else. */
    convenience init?(hex: String) {
        var text = hex.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}

extension NSBezierPath {
    var asCGPath: CGPath {
        let path = CGMutablePath()
        var points = [CGPoint](repeating: .zero, count: 3)
        for index in 0..<elementCount {
            switch element(at: index, associatedPoints: &points) {
            case .moveTo: path.move(to: points[0])
            case .lineTo: path.addLine(to: points[0])
            case .curveTo, .cubicCurveTo: path.addCurve(to: points[2], control1: points[0], control2: points[1])
            case .quadraticCurveTo: path.addQuadCurve(to: points[1], control: points[0])
            case .closePath: path.closeSubpath()
            @unknown default: break
            }
        }
        return path
    }
}
