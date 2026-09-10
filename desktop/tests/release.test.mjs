import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { npmCommand, prepareRelease } from '../scripts/release.mjs';

function zipFiles(data) {
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  const files = new Map();
  let position = data.readUInt32LE(end + 16);
  for (let index = 0; index < data.readUInt16LE(end + 10); index++) {
    assert.equal(data.readUInt32LE(position), 0x02014b50);
    const method = data.readUInt16LE(position + 10), size = data.readUInt32LE(position + 20);
    const nameLength = data.readUInt16LE(position + 28), extraLength = data.readUInt16LE(position + 30), commentLength = data.readUInt16LE(position + 32);
    const name = data.subarray(position + 46, position + 46 + nameLength).toString('utf8');
    const local = data.readUInt32LE(position + 42);
    assert.equal(data.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const compressed = data.subarray(start, start + size);
    assert.ok(method === 0 || method === 8);
    if (!name.endsWith('/')) files.set(name, (method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8'));
    position += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

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

test('release preparation from desktop archives the complete committed repository tree', async t => {
  const root = await mkdtemp(path.resolve('test-results/source-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'desktop');
  const files = {
    '.gitignore': 'desktop/release/\n',
    'LICENSE': 'Source license fixture',
    'AGENTS.md': 'Contributor fixture',
    'docs/architecture.md': 'Architecture fixture',
    'scripts/prepare-icon.py': 'Icon preparation fixture',
    'macOS/App/ChirpberryApp.swift': 'Native app fixture',
    'macOS/Sources/ChirpberryCore/Meeting.swift': 'Shared Swift fixture',
    'macOS/Artwork/Chirpberry.png': 'Artwork fixture',
    'desktop/native/Bridge.swift': 'Desktop native bridge fixture',
    'desktop/src/main/index.ts': 'Desktop main fixture',
    'desktop/package.json': JSON.stringify({ version: '0.2.0' })
  };
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--template=']); git(['add', '.']);
  git(['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Archive fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  const script = `
    import { execFileSync } from 'node:child_process';
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { prepareRelease } from ${JSON.stringify(new URL('../scripts/release.mjs', import.meta.url).href)};
    await prepareRelease({ desktop: process.cwd(), platform: 'win32', arch: 'x64', env: { npm_execpath: 'fixture-npm-cli.js' },
      run: async (command, args, options) => {
        if (command === 'git') return execFileSync(command, args, options);
        if (args.includes('package:installers')) {
          const staging = args.find(arg => arg.startsWith('--config.directories.output=')).slice('--config.directories.output='.length);
          await writeFile(path.join(staging, 'Chirpberry-0.2.0-x64.exe'), 'Installer fixture');
        }
        return '';
      }
    });
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: desktop, stdio: 'pipe' });
  const destination = path.join(desktop, 'release/v0.2.0-win32-x64');
  const archive = path.join(destination, 'Chirpberry-0.2.0-source.zip');
  const entries = zipFiles(await readFile(archive));
  assert.deepEqual([...entries.keys()].sort(), Object.keys(files).map(name => `Chirpberry-0.2.0/${name}`).sort());
  for (const [name, contents] of Object.entries(files)) {
    assert.equal(entries.get(`Chirpberry-0.2.0/${name}`), contents);
  }
  const manifest = JSON.parse(await readFile(path.join(destination, 'release.json'), 'utf8'));
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.published, false);
  for (const [name, digest] of Object.entries(manifest.checksums)) {
    assert.equal(createHash('sha256').update(await readFile(path.join(destination, name))).digest('hex'), digest);
  }
  for (const line of (await readFile(path.join(destination, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')) {
    const [digest, name] = line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(path.join(destination, name))).digest('hex'), digest);
  }
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '');
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
