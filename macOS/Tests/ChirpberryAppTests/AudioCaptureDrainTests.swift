import XCTest
import Foundation

@MainActor final class AudioCaptureDrainTests: XCTestCase {
    func testStopWaitsForQueuedSampleDelivery() async throws {
        let queue = DispatchQueue(label: "chirpberry.test.pending-sample")
        let capture = AudioCapture(queue: queue)
        let entered = expectation(description: "Sample callback entered")
        let emitted = expectation(description: "Final PCM delivered")
        let release = DispatchSemaphore(value: 0)
        defer { release.signal() }
        capture.onAudio = { data, _, _ in
            XCTAssertEqual(data, Data([0, 0]))
            emitted.fulfill()
        }
        queue.async {
            entered.fulfill()
            guard release.wait(timeout: .now() + 3) == .success else { return }
            // Synthetic queued callback: no device, permission, or live audio.
            capture.onAudio?(Data([0, 0]), "Microphone", 0)
        }
        await fulfillment(of: [entered], timeout: 1)
        var finished = false
        let stopping = Task { await capture.stop(); finished = true }
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertFalse(finished, "Stop must not acknowledge while captured PCM is queued")
        release.signal()
        await stopping.value
        await fulfillment(of: [emitted], timeout: 1)
        XCTAssertTrue(finished)
    }
}
