import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function npmCommand(env = process.env, executable = process.execPath) {
  if (!env.npm_execpath) throw new Error('Run release preparation through npm run release:prepare.');
  return [executable, env.npm_execpath];
}

export async function prepareRelease({ desktop = fileURLToPath(new URL('..', import.meta.url)), platform = process.platform, arch = process.arch,
  run = (command, args, options) => execFileSync(command, args, options), env = process.env } = {}) {
  const root = path.dirname(desktop);
  const git = async args => (await run('git', args, { cwd: root, encoding: 'utf8' })).trim();
  const clean = async () => !(await git(['status', '--porcelain', '--untracked-files=all']));
  if (!await clean()) throw new Error('Prepare a clean, reviewed source commit before creating release artifacts. Local candidate packaging remains available.');
  const commit = await git(['rev-parse', 'HEAD']);
  const { version } = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
  const [node, npmCLI] = npmCommand(env);
  const release = path.join(desktop, 'release');
  const destination = path.join(release, `v${version}-${platform}-${arch}`);
  await mkdir(release, { recursive: true });
  await mkdir(destination);
  const staging = await mkdtemp(path.join(release, '.staging-'));
  const execute = (command, args) => run(command, args, { cwd: desktop, stdio: 'inherit' });
  const digest = async filename => createHash('sha256').update(await readFile(filename)).digest('hex');
  try {
    await execute(node, [npmCLI, 'run', 'verify']);
    await execute(node, [npmCLI, 'run', 'package:installers', '--', `--config.directories.output=${staging}`]);
    if (!await clean() || await git(['rev-parse', 'HEAD']) !== commit) throw new Error('Source changed during release preparation. Rebuild from a clean, reviewed commit.');
    const artifacts = (await readdir(staging, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.includes(version) && /\.(dmg|zip|exe|AppImage|blockmap)$/.test(entry.name)).map(entry => entry.name).sort();
    if (!artifacts.length) throw new Error('No installer artifacts were produced.');
    if (platform === 'darwin') {
      const image = artifacts.find(name => name.endsWith('.dmg')); if (!image) throw new Error('The Mac release requires a DMG.');
      const mount = await mkdtemp(path.join(staging, 'mount-'));
      let attached = false;
      try {
        await execute('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, path.join(staging, image)]); attached = true;
        const bundle = path.join(mount, 'Chirpberry.app');
        await execute('codesign', ['--verify', '--deep', '--strict', bundle]);
        await execute(node, [path.join(desktop, 'scripts/verify-mac-permissions.mjs'), bundle]);
        const relative = 'Contents/Resources/app.asar';
        if (await digest(path.join(bundle, relative)) !== await digest(path.join(staging, 'mac-arm64/Chirpberry.app', relative))) throw new Error('The DMG contains a different app payload.');
        if (await digest(path.join(mount, 'INSTALL.txt')) !== await digest(path.join(desktop, 'INSTALL.txt'))) throw new Error('The DMG installation instructions do not match this source.');
        await execute(path.join(bundle, 'Contents/Resources/chirpberry-mcp'), ['--version']);
      } finally { if (attached) await execute('hdiutil', ['detach', mount]); }
    }
    for (const name of artifacts) await copyFile(path.join(staging, name), path.join(destination, name));
    const source = `Chirpberry-${version}-source.zip`;
    await run('git', ['archive', '--format=zip', `--prefix=Chirpberry-${version}/`, '-o', path.join(destination, source), commit], { cwd: root, stdio: 'inherit' });
    const names = [...artifacts, source]; const checksums = {};
    for (const name of names) checksums[name] = await digest(path.join(destination, name));
    await writeFile(path.join(destination, 'release.json'), JSON.stringify({ version, commit, platform, arch, createdAt: new Date().toISOString(),
      macSigning: 'ad-hoc; unnotarized', windowsSigning: 'unsigned', published: false, acceptance: 'See docs/verification.md. Packaging is not live OS/provider acceptance.', checksums }, null, 2));
    names.push('release.json'); checksums['release.json'] = await digest(path.join(destination, 'release.json'));
    await writeFile(path.join(destination, 'SHA256SUMS.txt'), names.map(name => `${checksums[name]}  ${name}`).join('\n') + '\n');
    return { commit, destination };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { commit, destination } = await prepareRelease();
  process.stdout.write(`Prepared unpublished artifacts from ${commit} in ${destination}\n`);
}
