import AVFoundation
import ScreenCaptureKit
import ChirpberryCore

final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate, AudioCapturing {
    var onAudio: ((Data, String, Float) -> Void)?
    var onFailure: ((String) -> Void)?
    private var stream: SCStream?
    private var engine: AVAudioEngine?
    private let queue = DispatchQueue(label: "chirpberry.audio", qos: .userInitiated)
    private let encoder = PCMEncoder()

    @MainActor func start(includeSystemAudio: Bool) async throws {
        guard await AVCaptureDevice.requestAccess(for: .audio) else {
            throw CoreError.invalid("Microphone access is off. Enable Chirpberry in System Settings → Privacy & Security → Microphone.")
        }
        if includeSystemAudio {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else { throw CoreError.invalid("No display is available for Mac audio capture.") }
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let config = SCStreamConfiguration()
            config.capturesAudio = true; config.captureMicrophone = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 16000; config.channelCount = 1
            config.width = 2; config.height = 2
            config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            config.showsCursor = false
            let candidate = SCStream(filter: filter, configuration: config, delegate: self)
            try candidate.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            try candidate.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
            stream = candidate
            do { try await candidate.startCapture() } catch { stream = nil; throw error }
        } else {
            let candidate = AVAudioEngine()
            let input = candidate.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw CoreError.invalid("No microphone is available.") }
            input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in self?.convert(buffer, channel: "Microphone") }
            engine = candidate
            do { try candidate.start() } catch { input.removeTap(onBus: 0); engine = nil; throw error }
        }
    }
    @MainActor func stop() async {
        if let engine { engine.inputNode.removeTap(onBus: 0); engine.stop(); self.engine = nil }
        if let stream { self.stream = nil; try? await stream.stopCapture() }
        encoder.reset()
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onFailure?("Audio capture stopped. Check microphone and Screen & System Audio Recording permissions.")
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sampleBuffer.isValid, let description = sampleBuffer.formatDescription else { return }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let count = AVAudioFrameCount(sampleBuffer.numSamples)
        guard count > 0, let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count) else { return }
        pcm.frameLength = count
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(count), into: pcm.mutableAudioBufferList) == noErr else { return }
        convert(pcm, channel: type == .microphone ? "Microphone" : "Mac audio")
    }
    private func convert(_ input: AVAudioPCMBuffer, channel: String) {
        do {
            let encoded = try encoder.encode(input, channel: channel)
            if !encoded.audio.isEmpty { onAudio?(encoded.audio, channel, encoded.level) }
        } catch { onFailure?("Audio conversion failed. Capture stopped to avoid an incomplete transcript.") }
    }
}
