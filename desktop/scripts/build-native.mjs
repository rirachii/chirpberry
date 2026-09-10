import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);
const root = fileURLToPath(new URL('../..', import.meta.url));
const native = path.join(root, 'macOS');
const run = (command, args) => execFileSync(command, args, { cwd: native, stdio: 'inherit' });
run('swift', ['build', '-c', 'release']);
const products = execFileSync('swift', ['build', '-c', 'release', '--show-bin-path'], { cwd: native, encoding: 'utf8' }).trim();
const bundle = path.join(root, 'desktop/native-build/Chirpberry Capture.app/Contents');
await mkdir(path.join(bundle, 'MacOS'), { recursive: true });
const objects = (await readdir(path.join(products, 'ChirpberryCore.build'))).filter(name => name.endsWith('.o')).map(name => path.join(products, 'ChirpberryCore.build', name));
run('xcrun', ['swiftc', '-O', '-parse-as-library', '-swift-version', '5', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos26.0`, '-I', path.join(products, 'Modules'),
  path.join(root, 'desktop/native/Bridge.swift'), path.join(root, 'desktop/native/AssistantKeychain.swift'), ...['AudioCapture.swift', 'Keychain.swift', 'CompanionShortcuts.swift'].map(name => path.join(native, 'App', name)), ...objects,
  '-o', path.join(bundle, 'MacOS/chirpberry-capture')]);
await writeFile(path.join(bundle, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>chirpberry-capture</string><key>CFBundleIdentifier</key><string>com.rirachii.chirpberry.electron.capture</string>
<key>CFBundleName</key><string>Chirpberry Capture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>26.0</string>
<key>NSMicrophoneUsageDescription</key><string>Chirpberry records your microphone only when you start dictation or a meeting.</string>
<key>NSScreenCaptureUsageDescription</key><string>Chirpberry captures system audio when you choose to include it in a meeting.</string>
<key>NSCalendarsFullAccessUsageDescription</key><string>Chirpberry reads upcoming events to prepare notes. You choose when to send notes for AI processing.</string>
</dict></plist>`);
run('codesign', ['--force', '--sign', '-', path.dirname(bundle)]);
await copyFile(path.join(products, 'chirpberry-mcp'), path.join(root, 'desktop/native-build/chirpberry-mcp'));
