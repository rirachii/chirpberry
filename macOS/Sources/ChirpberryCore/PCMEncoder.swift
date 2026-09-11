import AVFoundation
import Foundation

public final class PCMEncoder: @unchecked Sendable {
    private let lock = NSLock()
    private var converters: [String: AVAudioConverter] = [:]
    private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    public init() {}
    public func reset() { lock.lock(); defer { lock.unlock() }; converters.removeAll() }
    public func encode(_ input: AVAudioPCMBuffer, channel: String) throws -> (audio: Data, level: Float) {
        lock.lock(); defer { lock.unlock() }
        guard input.format.sampleRate > 0, input.frameLength > 0 else { return (Data(), 0) }
        var converter = converters[channel]
        if converter?.inputFormat != input.format {
            converter = AVAudioConverter(from: input.format, to: outputFormat)
            // Live input has no future frames to prime with; retain the converter between buffers.
            converter?.primeMethod = .none
            converters[channel] = converter
        }
        guard let converter, let output = AVAudioPCMBuffer(pcmFormat: outputFormat,
                frameCapacity: AVAudioFrameCount(ceil(Double(input.frameLength) * 16000 / input.format.sampleRate)) + 32) else {
            throw CoreError.invalid("This audio format could not be converted to speech input.")
        }
        var offset: AVAudioFrameCount = 0
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { requested, outStatus in
            guard offset < input.frameLength else { outStatus.pointee = .noDataNow; return nil }
            let count = min(requested, input.frameLength - offset)
            guard let slice = AVAudioPCMBuffer(pcmFormat: input.format, frameCapacity: count) else {
                outStatus.pointee = .noDataNow; return nil
            }
            slice.frameLength = count
            let bytesPerFrame = Int(input.format.streamDescription.pointee.mBytesPerFrame)
            let source = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
            let destination = UnsafeMutableAudioBufferListPointer(slice.mutableAudioBufferList)
            for index in source.indices {
                if let from = source[index].mData, let to = destination[index].mData {
                    memcpy(to, from.advanced(by: Int(offset) * bytesPerFrame), Int(count) * bytesPerFrame)
                }
            }
            offset += count
            outStatus.pointee = .haveData
            return slice
        }
        if let error { throw error }
        guard status != .error else { throw CoreError.invalid("Audio conversion failed.") }
        guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return (Data(), 0) }
        let count = Int(output.frameLength)
        var sum: Float = 0
        for index in 0..<count { let value = Float(samples[index]) / 32768; sum += value * value }
        return (Data(bytes: samples, count: count * 2), min(1, sqrt(sum / Float(count)) * 5))
    }
}
