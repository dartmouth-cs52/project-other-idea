import AppKit
import XCTest
@testable import HapticKit

final class ClientTests: XCTestCase {
    func testTheStreamIsReadALineAtATime() throws {
        XCTAssertEqual(try Client.parse(line: #"{"target":"e12"}"#), .target("e12"))
        XCTAssertEqual(try Client.parse(line: #"{"mode":"answer"}"#), .other)
        XCTAssertEqual(try Client.parse(line: ""), .other)
        let reply = try Client.parse(line: #"{"target":"e12","status":"continue","say":"Click Billing."}"#)
        XCTAssertEqual(reply, .reply(TurnReply(target: "e12", status: "continue", say: "Click Billing.")))
        let done = try Client.parse(line: #"{"target":null,"status":"done","say":"That's it."}"#)
        XCTAssertEqual(done, .reply(TurnReply(target: nil, status: "done", say: "That's it.")))
    }

    func testAFailureInTheStreamIsThrown() {
        XCTAssertThrowsError(try Client.parse(line: #"{"error":"Too many requests.","code":429}"#)) { error in
            XCTAssertEqual(error as? ServerError, ServerError(status: 429, message: "Too many requests."))
        }
    }

    func testARequestIsWrittenAsTheServerReadsIt() throws {
        let snapshot = Snapshot(path: "/team", title: "Team", headings: [], text: [], elements: [SnapElement(id: "e1", role: "button", label: "Invite teammate")], truncated: false)
        let request = TurnRequest(site: "site_acme", visitor: "v", guide: "g", today: "2026-11-23", goal: "invite someone", step: 0, history: [], snapshot: snapshot)
        let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        XCTAssertEqual(sent["version"] as? Int, 2)
        // What has nothing to say is left out, as the web widget leaves it out.
        XCTAssertNil(sent["event"])
        XCTAssertNil(sent["closing"])
        let element = ((sent["snapshot"] as! [String: Any])["elements"] as! [[String: Any]])[0]
        XCTAssertEqual(Set(element.keys), ["id", "role", "label"])
    }

    func testAnAppNamesItselfByItsBundleIdentifier() {
        XCTAssertEqual(Client.origin(for: "com.acme.desk"), "app://com.acme.desk")
    }

    func testControlsTheOwnerRuledOutAreMatchedByNameAndKind() {
        let delete = SnapElement(id: "e1", role: "button", label: "Delete  Workspace")
        XCTAssertTrue(ControlName(role: nil, label: "delete workspace").matches(delete))
        XCTAssertTrue(ControlName(role: "button", label: "Delete workspace").matches(delete))
        XCTAssertFalse(ControlName(role: "link", label: "Delete workspace").matches(delete))
        XCTAssertFalse(ControlName(role: nil, label: "Delete").matches(delete))
    }
}
