import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Mac activity classifier rejects unrelated apps; public metadata query returns bounded enums only', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chirpberry-activity-test-'));
  try {
    const source = path.join(root, 'main.swift'), executable = path.join(root, 'activity-test');
    await writeFile(source, `import Foundation
precondition(MeetingActivity.source(bundleID: "us.zoom.xos") == "zoom")
precondition(MeetingActivity.source(bundleID: "com.microsoft.teams2") == "teams")
precondition(MeetingActivity.source(bundleID: "com.google.Chrome.helper") == "chrome")
precondition(MeetingActivity.source(bundleID: "com.google.Chrome.evil") == nil)
precondition(MeetingActivity.source(bundleID: "com.rirachii.chirpberry.desktop") == nil)
precondition(MeetingActivity.source(bundleID: "com.apple.Music") == nil)
let sources = try MeetingActivity.activeSources()
precondition(sources.count <= 8)
precondition(Set(sources).isSubset(of: ["zoom", "teams", "chrome", "edge", "brave", "firefox", "safari", "arc"]))
print("Metadata query and classifier passed")
`);
    execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos26.0`, path.resolve('native/MeetingActivity.swift'), source, '-o', executable], { timeout: 60000 });
    assert.equal(execFileSync(executable, [], { encoding: 'utf8', timeout: 10000 }).trim(), 'Metadata query and classifier passed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
