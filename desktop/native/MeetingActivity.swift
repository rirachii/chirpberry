import CoreAudio
import Foundation

// Inspect public audio-process metadata only. No tap, audio stream, window or tab access.
enum MeetingActivity {
    static func source(bundleID: String) -> String? {
        let apps: [(String, String)] = [
            ("us.zoom.xos", "zoom"), ("us.zoom.CptHost", "zoom"),
            ("com.microsoft.teams", "teams"), ("com.microsoft.teams2", "teams"),
            ("com.google.Chrome", "chrome"), ("com.microsoft.edgemac", "edge"),
            ("com.brave.Browser", "brave"), ("org.mozilla.firefox", "firefox"),
            ("com.apple.Safari", "safari"), ("company.thebrowser.Browser", "arc")
        ]
        // Chromium helpers often own the microphone. Only known helper suffixes qualify.
        let suffixes = ["", ".helper", ".helper.Renderer", ".helper.GPU", ".helper.Plugin"]
        return apps.first { app in suffixes.contains { bundleID == app.0 + $0 } }?.1
    }
    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }
    static func activeSources() throws -> [String] {
        var list = address(kAudioHardwarePropertyProcessObjectList), size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &list, 0, nil, &size) == noErr,
              size % UInt32(MemoryLayout<AudioObjectID>.size) == 0,
              size <= 4096 * MemoryLayout<AudioObjectID>.size else { throw ActivityError.unavailable }
        if size == 0 { return [] }
        var processes = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        let capacity = size
        let status = processes.withUnsafeMutableBytes { buffer in
            AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &list, 0, nil, &size, buffer.baseAddress!)
        }
        guard status == noErr, size <= capacity, size % UInt32(MemoryLayout<AudioObjectID>.size) == 0 else { throw ActivityError.unavailable }
        var sources = Set<String>()
        for process in processes.prefix(Int(size) / MemoryLayout<AudioObjectID>.size) {
            var input = address(kAudioProcessPropertyIsRunningInput), running: UInt32 = 0
            var runningSize = UInt32(MemoryLayout<UInt32>.size)
            guard AudioObjectGetPropertyData(process, &input, 0, nil, &runningSize, &running) == noErr,
                  runningSize == MemoryLayout<UInt32>.size, running == 1 else { continue }
            var property = address(kAudioProcessPropertyBundleID), bundle: Unmanaged<CFString>?
            var bundleSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
            guard AudioObjectGetPropertyData(process, &property, 0, nil, &bundleSize, &bundle) == noErr else { continue }
            guard let bundle else { continue }
            let identifier = bundle.takeRetainedValue() as String
            if let source = source(bundleID: identifier) { sources.insert(source) }
        }
        // Filter here so the bridge never sends PIDs, arbitrary app names, or an app inventory.
        return sources.sorted()
    }
    enum ActivityError: Error { case unavailable }
}
