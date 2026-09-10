import Foundation
import ChirpberryCore

@MainActor protocol RealtimeTransport: AnyObject {
    func resume()
    func send(_ message: URLSessionWebSocketTask.Message) async throws
    func receive() async throws -> URLSessionWebSocketTask.Message
    func close()
}

@MainActor private final class ValseaTransport: RealtimeTransport {
    private let session: URLSession
    private let socket: URLSessionWebSocketTask
    init(key: String) {
        var request = URLRequest(url: URL(string: "wss://api.valsea.ai/v1/realtime/notetaker")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil
        session = URLSession(configuration: config)
        socket = session.webSocketTask(with: request)
    }
    func resume() { socket.resume() }
    func send(_ message: URLSessionWebSocketTask.Message) async throws { try await socket.send(message) }
    func receive() async throws -> URLSessionWebSocketTask.Message { try await socket.receive() }
    func close() { socket.cancel(with: .normalClosure, reason: nil); session.invalidateAndCancel() }
}

@MainActor final class RealtimeConnection {
    let channel: String
    var onEvent: ((RealtimeEvent) -> Void)?
    var onFailure: ((String) -> Void)?
    private let socket: any RealtimeTransport
    private let configuration: RealtimeConfiguration
    private let finalizationTimeout: Duration
    private var receiver: Task<Void, Never>?
    private var sender: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var finalizationTask: Task<Bool, Never>?
    private var pending: [Data] = []
    private var pendingBytes = 0
    private var readyContinuation: CheckedContinuation<Void, Error>?
    private(set) var ready = false
    private var closed = false
    private var finishing = false
    private var stopRequested = false
    private var finalized = false
    private var sentConfiguration = false

    convenience init(channel: String, key: String, configuration: RealtimeConfiguration) {
        self.init(channel: channel, configuration: configuration, transport: ValseaTransport(key: key))
    }
    init(channel: String, configuration: RealtimeConfiguration, transport: any RealtimeTransport, finalizationTimeout: Duration = .seconds(8)) {
        self.channel = channel; self.configuration = configuration; self.socket = transport; self.finalizationTimeout = finalizationTimeout
    }

    func connect() async throws {
        try await withCheckedThrowingContinuation { continuation in
            readyContinuation = continuation
            socket.resume()
            receiver = Task { [weak self] in await self?.receiveLoop() }
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled, let self, !self.ready else { return }
                self.fail("Valsea did not become ready. Check your connection and API key.")
            }
        }
    }
    func enqueue(_ audio: Data) {
        guard ready, !closed, !finishing else { return }
        guard pending.count < 120, pendingBytes + audio.count <= 64_000 else {
            fail("The network could not keep up with live audio. Capture stopped; your saved transcript is safe.")
            return
        }
        pending.append(audio)
        pendingBytes += audio.count
        if sender == nil {
            sender = Task { [weak self] in
                guard let self else { return }
                do {
                    while !self.pending.isEmpty, !Task.isCancelled, !self.closed {
                        let next = self.pending.removeFirst()
                        self.pendingBytes -= next.count
                        try await self.socket.send(.data(next))
                    }
                } catch { if !self.closed { self.fail("The Valsea connection ended. The final saved segment is the recovery point.") } }
                self.sender = nil
            }
        }
    }
    func finish() async -> Bool {
        if let finalizationTask { return await finalizationTask.value }
        guard !closed else { return finalized }
        finishing = true
        let task = Task { await finalize() }
        finalizationTask = task
        return await task.value
    }
    private func finalize() async -> Bool {
        let deadline = Task { [weak self, finalizationTimeout] in
            try? await Task.sleep(for: finalizationTimeout)
            guard !Task.isCancelled else { return }
            self?.fail("Valsea did not finish the transcript before the deadline. Saved final segments are retained; dictation was not copied.")
        }
        defer { deadline.cancel() }
        await sender?.value
        guard !closed else { return finalized }
        do {
            try await send(["type": "audio.commit"])
            guard !closed else { return finalized }
            stopRequested = true
            try await send(["type": "session.stop"])
            while !closed { try await Task.sleep(for: .milliseconds(20)) }
        } catch {
            fail("Valsea could not finalize the transcript. Saved final segments are retained; dictation was not copied.")
            return false
        }
        return finalized
    }
    func close() {
        guard !closed else { return }
        closed = true; ready = false
        timeout?.cancel(); sender?.cancel(); receiver?.cancel()
        readyContinuation?.resume(throwing: CoreError.invalid("Connection closed before Valsea was ready.")); readyContinuation = nil
        pending.removeAll(); pendingBytes = 0
        socket.close()
    }
    private func send(_ body: [String: Any]) async throws {
        let data = try JSONSerialization.data(withJSONObject: body)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }
    private func receiveLoop() async {
        do {
            while !Task.isCancelled, !closed {
                let message = try await socket.receive()
                guard !closed else { return }
                let data: Data
                switch message { case .data(let value): data = value; case .string(let value): data = Data(value.utf8); @unknown default: continue }
                let event = try RealtimeEvent.decode(data)
                switch event.type {
                case "session.created":
                    if !sentConfiguration {
                        sentConfiguration = true
                        try await socket.send(.string(String(decoding: configuration.startMessage(), as: UTF8.self)))
                    }
                case "session.ready":
                    ready = true; timeout?.cancel(); readyContinuation?.resume(); readyContinuation = nil
                case "session.stopped", "session.ended":
                    if finishing && stopRequested { finalized = true; close() }
                    else { fail("Valsea ended the session unexpectedly. Capture stopped; saved final segments are retained.") }
                case "error":
                    let code = event.code ?? "UNKNOWN"
                    fail("Valsea reported \(code). Check your key, credits, language settings, and connection before resuming.")
                default: onEvent?(event)
                }
            }
        } catch {
            if !closed { fail("Unable to maintain the Valsea connection. Check the API key, credits, and network. Saved notes are preserved.") }
        }
    }
    private func fail(_ message: String) {
        guard !closed else { return }
        readyContinuation?.resume(throwing: CoreError.invalid(message)); readyContinuation = nil
        close(); onFailure?(message)
    }
}
