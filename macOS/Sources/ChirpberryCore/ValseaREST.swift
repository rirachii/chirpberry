import Foundation

public struct ValseaREST: Sendable {
    public let key: String
    public let session: URLSession
    public init(key: String, session: URLSession = .shared) { self.key = key; self.session = session }

    public func format(_ meeting: Meeting) async throws -> FormattedNotes {
        let transcript = "Meeting: \(meeting.title)\n\nPersonal notes:\n\(meeting.notes)\n\nConversation:\n\(meeting.transcriptText)"
        guard !meeting.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !meeting.segments.isEmpty else {
            throw CoreError.invalid("Add notes or a transcript before enhancing this meeting.")
        }
        let data = try await post("formatting", body: ["model": "valsea-format", "transcript": transcript, "output_type": meeting.template.rawValue])
        return try FormattedNotes.parse(data)
    }
    public func translate(_ text: String, target: String) async throws -> String {
        guard TranslationLanguage.targets.contains(target) else { throw CoreError.invalid("Unsupported translation target.") }
        if text.utf16.count > 4000 {
            var translated: [String] = []
            for chunk in Self.translationChunks(text) { translated.append(try await translate(chunk, target: target)) }
            return translated.joined(separator: "\n\n")
        }
        let data = try await post("translations", body: ["model": "valsea-translate", "text": text, "target": target, "source": "auto"])
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let result = (object?["translation"] ?? object?["translated_text"] ?? object?["text"]) as? String, !result.isEmpty else {
            throw CoreError.invalid("Valsea returned no translated text.")
        }
        return result
    }
    public func transcribe(file: URL) async throws -> String {
        let attrs = try FileManager.default.attributesOfItem(atPath: file.path)
        let size = (attrs[.size] as? NSNumber)?.intValue ?? .max
        guard size <= 10_000_000 else { throw CoreError.invalid("Valsea accepts audio files up to 10 MB. Choose a smaller file.") }
        guard ["wav", "mp3", "m4a", "flac", "ogg", "webm"].contains(file.pathExtension.lowercased()) else {
            throw CoreError.invalid("Choose a WAV, MP3, M4A, FLAC, OGG, or WebM audio file.")
        }
        let boundary = "Chirpberry-\(UUID().uuidString)"
        var body = Data()
        func add(_ value: String) { body.append(Data(value.utf8)) }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nvalsea-transcribe\r\n")
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nauto\r\n")
        // A fixed filename avoids reflecting untrusted names into multipart headers.
        let ext = file.pathExtension.lowercased().filter { $0.isASCII && $0.isLetter }
        add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.\(ext)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        body.append(try Data(contentsOf: file)); add("\r\n--\(boundary)--\r\n")
        var request = try authorized("audio/transcriptions")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let data = try await perform(request)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let text = object?["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CoreError.invalid("Valsea returned an empty transcript.") }
        return text
    }
    private func authorized(_ path: String) throws -> URLRequest {
        guard !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CoreError.invalid("Add your Valsea API key in Settings.") }
        var request = URLRequest(url: URL(string: "https://api.valsea.ai/v1/\(path)")!)
        request.httpMethod = "POST"; request.timeoutInterval = 180
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        return request
    }
    public static func translationChunks(_ text: String) -> [String] {
        var result: [String] = []; var current = ""; var units = 0
        for scalar in text.unicodeScalars {
            let size = scalar.value > 0xFFFF ? 2 : 1
            if units + size > 4000 { result.append(current); current = ""; units = 0 }
            current.unicodeScalars.append(scalar); units += size
        }
        if !current.isEmpty { result.append(current) }
        return result
    }
    private func post(_ path: String, body: [String: Any]) async throws -> Data {
        var request = try authorized(path)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(request)
    }
    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw CoreError.invalid("The service returned an invalid response.") }
        guard (200..<300).contains(http.statusCode) else {
            let message: String
            switch http.statusCode {
            case 401, 403: message = "Valsea rejected this API key. Check the key in Settings."
            case 402: message = "Your Valsea account needs credits."
            case 429: message = "Valsea's rate limit was reached. Wait before retrying."
            case 413: message = "This file is too large for Valsea."
            default: message = "Valsea could not complete the request (HTTP \(http.statusCode)). Your saved notes are unchanged."
            }
            throw CoreError.invalid(message)
        }
        return data
    }
}
