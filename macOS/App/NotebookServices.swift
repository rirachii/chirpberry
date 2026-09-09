import Foundation
import ChirpberryCore

@MainActor protocol RealtimeStreaming: AnyObject {
    var onEvent: ((RealtimeEvent) -> Void)? { get set }
    var onFailure: ((String) -> Void)? { get set }
    func connect() async throws
    func enqueue(_ audio: Data)
    func finish() async
    func close()
}

protocol AudioCapturing: AnyObject {
    var onAudio: ((Data, String, Float) -> Void)? { get set }
    var onFailure: ((String) -> Void)? { get set }
    @MainActor func start(includeSystemAudio: Bool) async throws
    @MainActor func stop() async
}

protocol NotebookProvider {
    func format(_ meeting: Meeting) async throws -> FormattedNotes
    func transcribe(file: URL) async throws -> String
    func translate(_ text: String, target: String) async throws -> String
}

extension ValseaREST: NotebookProvider {}
