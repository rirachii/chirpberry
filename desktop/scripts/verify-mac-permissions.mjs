import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inspect the signed payload: source plist/config checks miss signing overrides.
export function verifyMacPermissions(bundle) {
  const plist = input => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input, encoding: 'utf8' }));
  for (const app of [bundle, path.join(bundle, 'Contents/Resources/Chirpberry Capture.app')]) {
    const metadata = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }));
    const entitlements = plist(execFileSync('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', app], { stdio: ['ignore', 'pipe', 'pipe'] }));
    for (const key of ['NSCalendarsFullAccessUsageDescription', 'NSMicrophoneUsageDescription']) {
      if (typeof metadata[key] !== 'string' || !metadata[key].trim()) throw new Error(`${path.basename(app)} is missing ${key}.`);
    }
    for (const key of ['com.apple.security.personal-information.calendars', 'com.apple.security.device.audio-input']) {
      if (entitlements[key] !== true) throw new Error(`${path.basename(app)} is missing the signed ${key} entitlement.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Supply the path to the packaged Chirpberry.app.');
  verifyMacPermissions(path.resolve(process.argv[2]));
  process.stdout.write('Packaged Calendar and microphone permission declarations passed.\n');
}
