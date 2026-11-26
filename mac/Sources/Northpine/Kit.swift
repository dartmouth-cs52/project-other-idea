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

/** A screen that is not built yet. */
struct ComingSoon: View {
    let nav: Nav

    var body: some View {
        Page {
            PageHeader(title: nav.title, subtitle: "This part of Northpine is on its way.")
        }
    }
}
