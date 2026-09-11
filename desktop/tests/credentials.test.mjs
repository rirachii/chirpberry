import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function credentials() {
  const result = await build({ entryPoints: ['src/main/settings.ts'], platform: 'node', format: 'cjs', bundle: true, write: false,
    plugins: [{ name: 'protected-storage-fixture', setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const safeStorage = {
        isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
        decryptString: () => { throw new Error('Secret decryption attempted'); }, encryptString: () => { throw new Error('Secret encryption attempted'); }
      };` }));
    } }] });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), process, Buffer, structuredClone });
  return module.exports.Credentials;
}
test('both native key status checks use metadata commands without reading secrets', async () => {
  const Credentials = await credentials(), calls = [];
  const native = { request: async command => { calls.push(command); if (!command.endsWith('.status')) throw new Error('Unexpected secret access'); return true; } };
  assert.equal(await new Credentials('', native).status(), true);
  assert.equal(await new Credentials('', native, false, 'assistant').status(), true);
  assert.deepEqual(calls, ['credential.status', 'assistant-key.status']);
});
test('encrypted-file presence and removal do not access the OS keyring secret', async t => {
  const Credentials = await credentials(), directory = await mkdtemp(path.join(tmpdir(), 'chirpberry-credential-status-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = new Credentials(directory);
  assert.equal(await key.status(), false);
  await writeFile(path.join(directory, 'credential.enc'), 'synthetic encrypted bytes');
  assert.equal(await key.status(), true);
  await assert.rejects(key.read(), /could not be unlocked/);
  assert.equal(await key.save(''), false);
  assert.equal(await key.status(), false);
});
