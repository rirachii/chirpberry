import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('noninteractive Mac key presence check restores the prior UI policy', { skip: process.platform !== 'darwin' }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-key-presence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'main.swift'), executable = path.join(root, 'presence-test');
  await writeFile(source, `import Foundation
import Security
var original = DarwinBoolean(false)
precondition(SecKeychainGetUserInteractionAllowed(&original) == errSecSuccess)
for allowed in [true, false] {
    precondition(SecKeychainSetUserInteractionAllowed(allowed) == errSecSuccess)
    // Unique nonexistent service: no key data, writes, or real user credentials.
    let present = try KeychainPresence.contains(service: "com.chirpberry.test." + UUID().uuidString)
    precondition(!present)
    var restored = DarwinBoolean(false)
    precondition(SecKeychainGetUserInteractionAllowed(&restored) == errSecSuccess)
    precondition(restored.boolValue == allowed)
}
precondition(SecKeychainSetUserInteractionAllowed(original.boolValue) == errSecSuccess)
print("Noninteractive metadata query passed")
`);
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', path.resolve('native/KeychainPresence.swift'), source, '-o', executable], { timeout: 60000, stdio: 'pipe' });
  assert.equal(execFileSync(executable, [], { encoding: 'utf8', timeout: 10000 }).trim(), 'Noninteractive metadata query passed');
});
