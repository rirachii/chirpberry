import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { npmCommand, prepareRelease } from '../scripts/release.mjs';

async function fixture(t, { produce = true, changed = false } = {}) {
  const root = await mkdtemp(path.resolve('test-results/release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'desktop');
  await mkdir(path.join(desktop, 'release'), { recursive: true });
  await writeFile(path.join(desktop, 'package.json'), JSON.stringify({ version: '0.2.0' }));
  const stale = path.join(desktop, 'release', 'Chirpberry-0.2.0-arm64.dmg');
  await writeFile(stale, 'Old Mac build');
  const calls = [];
  let built = false;
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git' && args[0] === 'status') return changed && built ? ' M src/file.ts' : '';
    if (command === 'git' && args[0] === 'rev-parse') return '1234567890abcdef';
    if (command === 'git' && args[0] === 'archive') { await writeFile(args[args.indexOf('-o') + 1], 'Exact source fixture'); return ''; }
    assert.equal(command, process.execPath);
    assert.equal(args[0], 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js');
    if (args.includes('package:installers')) {
      const staging = args.find(arg => arg.startsWith('--config.directories.output=')).split('=').slice(1).join('=');
      assert.deepEqual(await readdir(staging), []);
      if (produce) await writeFile(path.join(staging, 'Chirpberry-0.2.0-x64.exe'), 'Fresh Windows fixture');
      built = true;
    }
    return '';
  };
  return { desktop, stale, calls, options: { desktop, platform: 'win32', arch: 'x64', run, env: { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' } } };
}

await mkdir('test-results', { recursive: true });

test('Windows release uses Node plus the npm JavaScript entrypoint and fresh artifacts only', async t => {
  const { desktop, stale, calls, options } = await fixture(t);
  const { destination } = await prepareRelease(options);
  const manifest = JSON.parse(await readFile(path.join(destination, 'release.json'), 'utf8'));
  assert.equal(manifest.commit, '1234567890abcdef');
  assert.equal(manifest.published, false);
  assert.deepEqual(Object.keys(manifest.checksums), ['Chirpberry-0.2.0-x64.exe', 'Chirpberry-0.2.0-source.zip']);
  assert.equal(manifest.checksums['Chirpberry-0.2.0-x64.exe'], createHash('sha256').update('Fresh Windows fixture').digest('hex'));
  assert.equal(await readFile(stale, 'utf8'), 'Old Mac build');
  assert.equal(calls.some(call => call.command === 'npm.cmd'), false);
  assert.equal((await readdir(path.join(desktop, 'release'))).some(name => name.startsWith('.staging-')), false);
  await assert.rejects(prepareRelease(options), /EEXIST/);
});

test('an empty packaging invocation cannot claim stale matching-version installers', async t => {
  const { options } = await fixture(t, { produce: false });
  await assert.rejects(prepareRelease(options), /No installer artifacts/);
});

test('source changes during packaging prevent release provenance', async t => {
  const { options, desktop } = await fixture(t, { changed: true });
  await assert.rejects(prepareRelease(options), /Source changed/);
  assert.deepEqual(await readdir(path.join(desktop, 'release', 'v0.2.0-win32-x64')), []);
});

test('npm entrypoint is required without falling back to Windows command scripts', () => {
  assert.throws(() => npmCommand({}), /npm run release:prepare/);
  assert.deepEqual(npmCommand({ npm_execpath: 'C:\\npm-cli.js' }, 'C:\\node.exe'), ['C:\\node.exe', 'C:\\npm-cli.js']);
});

test('Mac candidate installation preserves the named native bundle and store', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const instructions = await readFile(new URL('../INSTALL.txt', import.meta.url), 'utf8');
  assert.equal(pkg.productName, 'Chirpberry');
  assert.notEqual(pkg.build.appId, 'com.rirachii.chirpberry');
  assert.equal(pkg.build.dmg.contents.some(item => item.type === 'link' && item.path === '/Applications'), false);
  assert.ok(pkg.build.dmg.contents.some(item => item.path === 'INSTALL.txt'));
  assert.match(instructions, /\/Applications\/Chirpberry Electron Candidate\/Chirpberry\.app/);
  assert.match(instructions, /Do not drop it directly into Applications or replace \/Applications\/Chirpberry\.app/);
  assert.match(instructions, /cancel and choose a new candidate folder/);
  assert.match(instructions, /separate Chirpberry Desktop notebook folder/);
});
