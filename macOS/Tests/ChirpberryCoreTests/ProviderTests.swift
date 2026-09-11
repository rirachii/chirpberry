import XCTest
import AVFoundation
@testable import ChirpberryCore

private final class ProviderProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "api.valsea.ai" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class ProviderTests: XCTestCase {
    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ProviderProtocol.self]
        return URLSession(configuration: config)
    }
    private func body(_ request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(); let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 8192); defer { buffer.deallocate() }
        while stream.hasBytesAvailable { let count = stream.read(buffer, maxLength: 8192); if count <= 0 { break }; data.append(buffer, count: count) }
        return data
    }
    func testSummaryUsesAuthenticatedDocumentedEndpointAndPreservesSource() async throws {
        let network = session(); defer { network.invalidateAndCancel() }
        ProviderProtocol.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://api.valsea.ai/v1/formatting")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-only-key")
            XCTAssertNil(request.url?.query)
            let object = try JSONSerialization.jsonObject(with: self.body(request)) as! [String: Any]
            XCTAssertEqual(object["model"] as? String, "valsea-format")
            XCTAssertTrue((object["transcript"] as! String).contains("Original thinking"))
            XCTAssertTrue((object["transcript"] as! String).contains("The launch is Friday"))
            return (200, Data(#"{"summary":"Launch on Friday","action_items":[]}"#.utf8))
        }
        var meeting = Meeting(); meeting.notes = "Original thinking"; meeting.segments = [.init(timestamp: 2, channel: "Mic", original: "The launch is Friday")]
        let result = try await ValseaREST(key: "test-only-key", session: network).format(meeting)
        XCTAssertTrue(result.markdown.contains("Launch on Friday")); XCTAssertEqual(meeting.notes, "Original thinking")
    }
    func testProviderAuthCreditsAndRateLimitErrorsAreActionable() async {
        let network = session(); defer { network.invalidateAndCancel() }
        for (status, expected) in [(401, "API key"), (402, "credits"), (429, "rate limit")] {
            ProviderProtocol.handler = { _ in (status, Data("{}".utf8)) }
            do { _ = try await ValseaREST(key: "test-only-key", session: network).translate("Hello", target: "chinese"); XCTFail("Expected failure") }
            catch { XCTAssertTrue(error.localizedDescription.contains(expected)) }
        }
    }
    func testMissingKeyDoesNotSendRequest() async {
        let network = session(); defer { network.invalidateAndCancel() }
        ProviderProtocol.handler = { _ in XCTFail("No network call expected"); return (500, Data()) }
        do { _ = try await ValseaREST(key: "", session: network).translate("Hello", target: "chinese"); XCTFail("Expected missing key") }
        catch { XCTAssertTrue(error.localizedDescription.contains("API key")) }
    }
    func testAudioUploadCannotInjectFilenameHeaders() async throws {
        let network = session(); defer { network.invalidateAndCancel() }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("odd\"\r\nheader.wav"); try Data([1, 2, 3, 4]).write(to: url)
        ProviderProtocol.handler = { request in
            let body = String(decoding: self.body(request), as: UTF8.self)
            XCTAssertTrue(body.contains("filename=\"recording.wav\"")); XCTAssertFalse(body.contains("odd"))
            XCTAssertEqual(request.url?.path, "/v1/audio/transcriptions")
            return (200, Data(#"{"text":"The launch is Friday."}"#.utf8))
        }
        let transcript = try await ValseaREST(key: "test-only-key", session: network).transcribe(file: url)
        XCTAssertEqual(transcript, "The launch is Friday.")
    }
    func testOversizedAudioRejectedBeforeNetwork() async throws {
        let network = session(); defer { network.invalidateAndCancel() }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        try Data(count: 10_000_001).write(to: url); defer { try? FileManager.default.removeItem(at: url) }
        ProviderProtocol.handler = { _ in XCTFail("Oversized audio must not upload"); return (500, Data()) }
        do { _ = try await ValseaREST(key: "test-only-key", session: network).transcribe(file: url); XCTFail("Expected size limit") }
        catch { XCTAssertTrue(error.localizedDescription.contains("10 MB")) }
    }
    func testPCMResamplesStereoAndProducesBoundedNonSilentMono() throws {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 48000)!; buffer.frameLength = 48000
        for index in 0..<48000 {
            let value = Float(sin(Double(index) * 2 * .pi * 440 / 48000)) * 0.1
            buffer.floatChannelData![0][index] = value; buffer.floatChannelData![1][index] = value
        }
        let result = try PCMEncoder().encode(buffer, channel: "Mic")
        XCTAssertGreaterThan(result.audio.count, 31000); XCTAssertLessThanOrEqual(result.audio.count, 32000)
        XCTAssertEqual(result.audio.count % 2, 0); XCTAssertGreaterThan(result.level, 0.1); XCTAssertLessThanOrEqual(result.level, 1)
    }
    func testSpeakerNamesAreScopedAcrossRecordingResumes() {
        var meeting = Meeting()
        meeting.speakerNames[Meeting.speakerKey(channel: "Mac audio", speaker: 0, scope: "first")] = "Mei"
        XCTAssertEqual(meeting.speakerName(channel: "Mac audio", speaker: 0, scope: "first"), "Mei")
        XCTAssertNotEqual(meeting.speakerName(channel: "Mac audio", speaker: 0, scope: "next"), "Mei")
    }
    func testPCMContinuousShortBuffersDoNotLoseFrames() throws {
        let encoder = PCMEncoder()
        for rate in [44100.0, 48000.0] {
            encoder.reset()
            let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false)!
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
            buffer.frameLength = 4096
            for index in 0..<4096 { buffer.floatChannelData![0][index] = 0.1 }
            var frames = 0
            for _ in 0..<100 {
                let result = try encoder.encode(buffer, channel: "Mic")
                frames += result.audio.count / 2
                XCTAssertGreaterThan(result.level, 0.1)
            }
            let expected = 409600 * 16000 / rate
            XCTAssertEqual(Double(frames), expected, accuracy: 40, "Continuous audio at \(rate) Hz")
        }
    }
    func testPathologicalUnicodeStillRespectsProviderTextLimit() {
        let text = "a" + String(repeating: "\u{0301}", count: 20000) + "🌱"
        let chunks = ValseaREST.translationChunks(text)
        XCTAssertTrue(chunks.allSatisfy { $0.utf16.count <= 4000 }); XCTAssertEqual(chunks.joined(), text)
    }
}
