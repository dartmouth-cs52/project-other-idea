import Foundation

// The same masking the web widget does before anything leaves the device
// (`cleanText` in src/shared/types.ts): email addresses become "[email]", and
// phone numbers and long numbers become "[number]". A real date is left
// readable, and so is whatever the person named in their own question. The
// server masks again, so the two only have to agree on the common cases, but
// they are kept the same rule for rule so a label reads the same from a
// website and from a Mac app.

enum Masking {
    private static let email = regex("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", [.caseInsensitive])
    private static let phone = regex("\\+?\\d[\\d\\s().-]{7,}\\d")
    private static let longDigits = regex("\\d{5,}")
    private static let date = regex("(^|[\\s(])(\\d{4}[-.]\\d{1,2}[-.]\\d{1,2}|\\d{1,2}[-.]\\d{1,2}[-.](?:\\d{4}|\\d{2}))(?=$|[\\s)])")
    private static let firstNumber = regex("\\+?\\d(?:[\\d\\s().-]*\\d)?")
    private static let token = regex("\\S+")
    private static let gluedDigits = regex("^\\+?\\d+")
    private static let joinedByMark = regex("^[().-]+\\d")
    private static let plainGroups = regex("^(?: \\d+(?= |$))*")
    private static let space = regex("\\s+")
    private static let minPhoneDigits = 8
    private static let maxOwn = 8

    private static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // The patterns are constants, so one that does not compile is a mistake in this file.
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    /** What the person named in their own question that would otherwise be masked: an email address, or five or more digits in a row. */
    static func named(in question: String) -> Set<String> {
        var found = Set<String>()
        for match in matches(email, question) where found.count < maxOwn { found.insert(match.text.lowercased()) }
        let rest = replace(email, in: question) { _ in " " }
        for match in matches(longDigits, rest) where found.count < maxOwn { found.insert(match.text) }
        return found
    }

    /** Collapse white space, mask emails and long numbers, cap the length. `own` is what must stay readable. */
    static func clean(_ text: String, max: Int = 80, own: Set<String> = []) -> String {
        let spaced = replace(space, in: text) { _ in " " }.trimmingCharacters(in: .whitespacesAndNewlines)
        var masked = ""
        var from = spaced.startIndex
        for match in matches(email, spaced) {
            masked += maskNumbers(String(spaced[from..<match.range.lowerBound]), own)
            masked += own.contains(match.text.lowercased()) ? match.text : "[email]"
            from = match.range.upperBound
        }
        masked += maskNumbers(String(spaced[from...]), own)
        if masked.count <= max { return masked }
        // Cut at a word, unless that would lose much: "Out of stock", not "Out o…".
        let cut = String(masked.prefix(max - 1))
        if let lastSpace = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: lastSpace) >= Int(Double(max) * 0.6) {
            return String(cut[..<lastSpace]).trimmingTrailingSpace() + "…"
        }
        return cut.trimmingTrailingSpace() + "…"
    }

    private static func digitCount(_ text: String) -> Int {
        text.unicodeScalars.reduce(0) { $0 + (("0"..."9").contains($1) ? 1 : 0) }
    }

    private static func whole(_ piece: String) -> String {
        guard let first = matches(firstNumber, piece).first else { return piece }
        return piece.replacingCharacters(in: first.range, with: "[number]")
    }

    private static func isRealDate(_ written: String) -> Bool {
        let parts = written.split(whereSeparator: { $0 == "-" || $0 == "." }).map(String.init)
        guard parts.count == 3, let first = Int(parts[0]), let second = Int(parts[1]), let third = Int(parts[2]) else { return false }
        let month = { (n: Int) in n >= 1 && n <= 12 }
        let day = { (n: Int) in n >= 1 && n <= 31 }
        let year = { (part: String) in part.count == 2 || ((Int(part) ?? 0) >= 1800 && (Int(part) ?? 0) <= 2199) }
        if parts[0].count == 4 { return year(parts[0]) && month(second) && day(third) }
        return year(parts[2]) && ((day(first) && month(second)) || (month(first) && day(second)))
    }

    private static func maskNumbers(_ text: String, _ own: Set<String>) -> String {
        // Digits set apart by spaces can be several numbers. Each piece that is one the person named stays, and every other piece goes.
        func around(_ piece: String) -> String {
            replace(token, in: piece) { match in
                let bare = match.text.trimmingCharacters(in: CharacterSet(charactersIn: "(+")).trimmingTrailing(CharacterSet(charactersIn: "),.;:"))
                if own.contains(bare) { return match.text }
                return digitCount(match.text) > 0 ? whole(match.text) : match.text
            }
        }
        func maskRun(_ piece: String) -> String {
            if digitCount(piece) < minPhoneDigits { return piece }
            return own.isEmpty ? whole(piece) : around(piece)
        }
        func maskCandidate(_ candidate: String) -> String {
            var out = ""
            var from = candidate.startIndex
            for match in matches(date, candidate) {
                guard let written = match.groups[2], isRealDate(written.text) else { continue }
                out += maskRun(String(candidate[from..<written.range.lowerBound])) + written.text
                from = written.range.upperBound
            }
            return out + maskRun(String(candidate[from...]))
        }
        let phoned = replace(phone, in: text) { match in
            let candidate = match.text
            let before = match.range.lowerBound > text.startIndex ? text[text.index(before: match.range.lowerBound)] : nil
            guard let before, before.isLetter else { return maskCandidate(candidate) }
            // Digits that start right after a letter belong to a word, unless more of a number follows them.
            let glued = matches(gluedDigits, candidate).first?.text ?? ""
            let rest = String(candidate.dropFirst(glued.count))
            if !matches(joinedByMark, rest).isEmpty { return maskCandidate(candidate) }
            let groups = matches(plainGroups, rest).first?.text ?? ""
            if !groups.isEmpty && digitCount(glued + groups) >= minPhoneDigits {
                return maskRun(glued + groups) + maskCandidate(String(rest.dropFirst(groups.count)))
            }
            return glued + maskCandidate(rest)
        }
        return replace(longDigits, in: phoned) { own.contains($0.text) ? $0.text : "[number]" }
    }

    // Regular expressions over Swift strings ------------------------------------

    struct Match {
        let text: String
        let range: Range<String.Index>
        /** The groups by number, 0 being the whole match. Nil where a group took no part. */
        let groups: [(text: String, range: Range<String.Index>)?]
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> [Match] {
        regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { result in
            guard let range = Range(result.range, in: text) else { return nil }
            let groups = (0..<result.numberOfRanges).map { index -> (text: String, range: Range<String.Index>)? in
                guard let part = Range(result.range(at: index), in: text) else { return nil }
                return (String(text[part]), part)
            }
            return Match(text: String(text[range]), range: range, groups: groups)
        }
    }

    private static func replace(_ regex: NSRegularExpression, in text: String, with replacement: (Match) -> String) -> String {
        var out = ""
        var from = text.startIndex
        for match in matches(regex, text) {
            out += text[from..<match.range.lowerBound]
            out += replacement(match)
            from = match.range.upperBound
        }
        return out + text[from...]
    }
}

private extension String {
    func trimmingTrailing(_ set: CharacterSet) -> String {
        var scalars = Substring(self).unicodeScalars
        while let last = scalars.last, set.contains(last) { scalars.removeLast() }
        return String(scalars)
    }

    func trimmingTrailingSpace() -> String { trimmingTrailing(.whitespaces) }
}
