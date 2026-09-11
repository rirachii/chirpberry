import XCTest
@testable import ChirpberryCore

final class BarDockTests: XCTestCase {
    func testEveryEdgeExpandsInwardAndRetainsTheHandleUnderThePointer() {
        // A secondary display can live to the left of, and above, the main display.
        let screen = CGRect(x: -1920, y: 240, width: 1920, height: 1050)
        for edge in BarDock.allCases {
            let closed = edge.frame(in: screen, expanded: false)
            for recording in [false, true] {
                let open = edge.frame(in: screen, expanded: true, recording: recording)
                XCTAssertTrue(screen.contains(closed), edge.title)
                XCTAssertTrue(screen.contains(open), edge.title)
                XCTAssertTrue(open.contains(closed), "Expanding \(edge) must not move away from the pointer")
            }
        }
    }
}
