import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = path.dirname(desktop);
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Prepare a clean, reviewed source commit before creating release artifacts. Local candidate packaging remains available.');
const commit = git(['rev-parse', 'HEAD']);
const { version } = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
const destination = path.join(desktop, 'release', `v${version}-${process.platform}-${process.arch}`);
await mkdir(path.dirname(destination), { recursive: true });
await mkdir(destination); // Refuse to overwrite an existing release.
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: desktop, stdio: 'inherit', ...options });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run(npm, ['run', 'verify']);
run(npm, ['run', 'package:installers']);
const artifacts = (await readdir(path.join(desktop, 'release'))).filter(name => name.includes(version) && /\.(dmg|zip|exe|AppImage|blockmap)$/.test(name));
if (!artifacts.length) throw new Error('No installer artifacts were produced.');
const digest = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
if (process.platform === 'darwin') {
  const image = artifacts.find(name => name.endsWith('.dmg')); if (!image) throw new Error('The Mac release requires a DMG.');
  const mount = await mkdtemp(path.join(os.tmpdir(), 'chirpberry-dmg-'));
  let attached = false;
  try {
    run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, path.join(desktop, 'release', image)]); attached = true;
    const bundle = path.join(mount, 'Chirpberry.app');
    run('codesign', ['--verify', '--deep', '--strict', bundle]);
    const relative = 'Contents/Resources/app.asar';
    if (await digest(path.join(bundle, relative)) !== await digest(path.join(desktop, 'release/mac-arm64/Chirpberry.app', relative))) throw new Error('The DMG contains a different app payload.');
    run(path.join(bundle, 'Contents/Resources/chirpberry-mcp'), ['--version']);
  } finally { if (attached) run('hdiutil', ['detach', mount]); await rm(mount, { recursive: true, force: true }); }
}
for (const name of artifacts) await copyFile(path.join(desktop, 'release', name), path.join(destination, name));
const source = `Chirpberry-${version}-source.zip`;
run('git', ['archive', '--format=zip', `--prefix=Chirpberry-${version}/`, '-o', path.join(destination, source), commit]);
const names = [...artifacts, source]; const checksums = {};
for (const name of names) checksums[name] = await digest(path.join(destination, name));
await writeFile(path.join(destination, 'release.json'), JSON.stringify({ version, commit, platform: process.platform, arch: process.arch, createdAt: new Date().toISOString(),
  macSigning: 'ad-hoc; unnotarized', windowsSigning: 'unsigned', published: false, acceptance: 'See docs/verification.md. Packaging is not live OS/provider acceptance.', checksums }, null, 2));
names.push('release.json'); checksums['release.json'] = await digest(path.join(destination, 'release.json'));
await writeFile(path.join(destination, 'SHA256SUMS.txt'), names.map(name => `${checksums[name]}  ${name}`).join('\n') + '\n');
process.stdout.write(`Prepared unpublished artifacts from ${commit} in ${destination}\n`);
