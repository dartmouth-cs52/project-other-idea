import SwiftUI

// The few pieces every screen is built from.

/** A screen's heading, the line under it, and the buttons that belong to the whole screen. */
struct PageHeader<Actions: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                if let subtitle { Text(subtitle).foregroundStyle(.secondary) }
            }
            Spacer()
            actions()
        }
    }
}

extension PageHeader where Actions == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

/** A screen's contents, padded and pinned to the top left as every screen is. */
struct Page<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16, content: content)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/** One number with what it counts, for the rows of figures at the top of a screen. */
struct StatTile: View {
    let label: String
    let value: String
    var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title2.weight(.semibold))
            if let note { Text(note).font(.caption).foregroundStyle(.secondary) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
        .accessibilityElement(children: .combine)
    }
}

/** A box with a heading, for the parts of a screen. */
struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
    }
}

/** A word in a coloured pill: a card's or a bill's status. */
struct StatusBadge: View {
    let text: String
    var color: Color = .secondary

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.16)))
            .foregroundStyle(color)
    }
}

extension Card.Status {
    var color: Color { self == .active ? .green : self == .frozen ? .blue : .secondary }
}

extension Transaction.Status {
    var color: Color {
        switch self {
        case .cleared: return .green
        case .pending: return .orange
        case .declined: return .secondary
        case .flagged: return .red
        }
    }
}

extension Bill.Status {
    var color: Color {
        switch self {
        case .draft: return .secondary
        case .awaiting: return .orange
        case .approved: return .blue
        case .scheduled: return .purple
        case .paid: return .green
        case .overdue: return .red
        }
    }
}
