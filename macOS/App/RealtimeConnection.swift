import Foundation
import ChirpberryCore

@MainActor final class RealtimeConnection {
    let channel: String
    var onEvent: ((RealtimeEvent) -> Void)?
    var onFailure: ((String) -> Void)?
    private let socket: URLSessionWebSocketTask
    private let session: URLSession
    private let configuration: RealtimeConfiguration
    private var receiver: Task<Void, Never>?
    private var sender: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var pending: [Data] = []
    private var pendingBytes = 0
    private var readyContinuation: CheckedContinuation<Void, Error>?
    private(set) var ready = false
    private var closed = false
    private var finishing = false
    private var sentConfiguration = false

    init(channel: String, key: String, configuration: RealtimeConfiguration) {
        self.channel = channel; self.configuration = configuration
        var request = URLRequest(url: URL(string: "wss://api.valsea.ai/v1/realtime/notetaker")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 25
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil
        session = URLSession(configuration: config)
        socket = session.webSocketTask(with: request)
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
    func finish() async {
        guard !closed else { return }
        finishing = true
        let deadline = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            self?.close()
        }
        defer { deadline.cancel() }
        await sender?.value
        do {
            try await send(["type": "audio.commit"])
            // Continue receiving final corrections while the provider drains the session.
            try await send(["type": "session.stop"])
            for _ in 0..<80 {
                if closed || Task.isCancelled { break }
                try await Task.sleep(for: .milliseconds(100))
            }
        } catch { /* The receive path handles terminal errors; finals already saved remain intact. */ }
        close()
    }
    func close() {
        guard !closed else { return }
        closed = true; ready = false
        timeout?.cancel(); sender?.cancel(); receiver?.cancel()
        readyContinuation?.resume(throwing: CoreError.invalid("Connection closed before Valsea was ready.")); readyContinuation = nil
        pending.removeAll()
        pendingBytes = 0
        socket.cancel(with: .normalClosure, reason: nil); session.invalidateAndCancel()
    }
    private func send(_ body: [String: Any]) async throws {
        let data = try JSONSerialization.data(withJSONObject: body)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }
    private func receiveLoop() async {
        do {
            while !Task.isCancelled, !closed {
                let message = try await socket.receive()
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
                case "session.stopped", "session.ended": close()
                case "error":
                    let code = event.code ?? "UNKNOWN"
                    fail("Valsea reported \(code). Check your key, credits, language settings, and connection before resuming.")
                default: onEvent?(event)
                }
            }
        } catch {
            if finishing { close() }
            else if !closed { fail("Unable to maintain the Valsea connection. Check the API key, credits, and network. Saved notes are preserved.") }
        }
    }
    private func fail(_ message: String) {
        guard !closed else { return }
        readyContinuation?.resume(throwing: CoreError.invalid(message)); readyContinuation = nil
        close(); onFailure?(message)
    }
}
