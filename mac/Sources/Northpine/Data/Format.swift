import Foundation

// How money and dates are written everywhere in the app.

enum Format {
    private static let dollars: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        formatter.locale = Locale(identifier: "en_US")
        return formatter
    }()

    private static let day: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter
    }()

    static func money(_ amount: Double) -> String {
        dollars.string(from: NSNumber(value: amount)) ?? "$\(amount)"
    }

    /** Money with no cents, for totals and limits. */
    static func round(_ amount: Double) -> String {
        dollars.maximumFractionDigits = 0
        defer { dollars.maximumFractionDigits = 2 }
        return dollars.string(from: NSNumber(value: amount.rounded())) ?? "$\(Int(amount))"
    }

    static func date(_ date: Date) -> String { day.string(from: date) }

    /** "3 days ago", counted from the app's own today. */
    static func ago(_ date: Date) -> String {
        let days = Int(Seed.today.timeIntervalSince(date) / 86_400)
        return days <= 0 ? "Today" : days == 1 ? "Yesterday" : "\(days) days ago"
    }

    static func percent(_ part: Double, of whole: Double) -> String {
        whole > 0 ? "\(Int((part / whole * 100).rounded()))%" : "0%"
    }
}
