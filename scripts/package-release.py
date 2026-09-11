#!/usr/bin/env python3
"""Build a clean source revision and produce a verifiable local release candidate."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def run(*args, cwd=ROOT, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def main():
    if run('git', 'status', '--porcelain', capture=True).strip():
        raise SystemExit('Commit or isolate changes before packaging a release candidate.')
    commit = run('git', 'rev-parse', 'HEAD', capture=True).strip()
    info = plistlib.loads((ROOT / 'macOS/Info.plist').read_bytes())
    version = info['CFBundleShortVersionString']
    # Version values in Info.plist may be expanded by Xcode; read the explicit project setting.
    if '$' in version:
        import re
        version = re.search(r'MARKETING_VERSION:\s*[\'"]?([0-9.]+)', (ROOT / 'macOS/project.yml').read_text())[1]
    if not version or any(char not in '0123456789.' for char in version):
        raise SystemExit('Use a numeric release version.')
    output = ROOT / 'dist-native/releases' / f'v{version}'
    output.mkdir(parents=True, exist_ok=True)
    dmg = output / f'Chirpberry-{version}-macOS-arm64.dmg'
    source = output / f'Chirpberry-{version}-source.zip'
    if dmg.exists() or source.exists():
        raise SystemExit(f'Release artifacts already exist in {output}; preserve them or choose a new version.')
    with tempfile.TemporaryDirectory(prefix='chirpberry-release-') as temporary:
        temporary = Path(temporary)
        checkout = temporary / 'source'; checkout.mkdir()
        archive = temporary / 'source.zip'
        run('git', 'archive', '--format=zip', '--output', str(archive), commit)
        run('ditto', '-x', '-k', str(archive), str(checkout))
        run('bash', 'scripts/build.sh', cwd=checkout)
        app = checkout / 'dist-native/Chirpberry.app'
        built = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        if built['CFBundleShortVersionString'] != version:
            raise SystemExit('Built app version does not match the source version.')
        for executable in [app / 'Contents/MacOS/Chirpberry', app / 'Contents/Resources/bin/chirpberry-mcp']:
            if run('lipo', '-archs', str(executable), capture=True).strip() != 'arm64':
                raise SystemExit(f'Unexpected architecture: {executable.name}')
        stage = temporary / 'dmg'; stage.mkdir()
        run('ditto', str(app), str(stage / 'Chirpberry.app'))
        os.symlink('/Applications', stage / 'Applications')
        shutil.copyfile(checkout / 'LICENSE', stage / 'LICENSE.txt')
        (stage / 'Start here.txt').write_text(
            'Chirpberry\n\nDrag Chirpberry into Applications. Requires Apple Silicon and macOS 26+.\n'
            'This early build is ad-hoc signed and is not notarized by Apple.\n'
            'If macOS blocks it, review the source and Apple installation guidance:\n'
            'https://support.apple.com/en-us/102445\n\n'
            'Manual notes, search, and export need no account. Add your Valsea key in Settings for speech and summaries.\n'
            'Valsea processes audio and requested summaries in its cloud and bills your own account.\n'
            'Inform participants before recording. Chirpberry does not save audio recordings.\n\n'
            f'Source revision: {commit}\nhttps://github.com/rirachii/chirpberry\n')
        run('hdiutil', 'create', '-volname', 'Chirpberry', '-srcfolder', str(stage), '-format', 'UDZO', '-ov', str(dmg))
        mounted = plistlib.loads(subprocess.check_output(['hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(dmg)]))
        mount = next(Path(item['mount-point']) for item in mounted['system-entities'] if 'mount-point' in item)
        try:
            run('codesign', '--verify', '--deep', '--strict', str(mount / 'Chirpberry.app'))
            if os.readlink(mount / 'Applications') != '/Applications':
                raise SystemExit('Applications link is invalid.')
            # Exercise the actual bundled helper without reading the user's notes.
            empty = temporary / 'empty-notebook'; empty.mkdir()
            request = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}) + '\n'
            result = subprocess.run([str(mount / 'Chirpberry.app/Contents/Resources/bin/chirpberry-mcp'), '--directory', str(empty)],
                                    input=request, text=True, capture_output=True, check=True, timeout=10)
            tools = json.loads(result.stdout)['result']['tools']
            if {tool['name'] for tool in tools} != {'search_meetings', 'get_meeting'}:
                raise SystemExit('Packaged MCP tools do not match the app contract.')
        finally:
            run('hdiutil', 'detach', str(mount))
        run('git', 'archive', '--format=zip', '--prefix', f'Chirpberry-{version}/', '--output', str(source), commit)
        manifest = {'version': version, 'sourceCommit': commit, 'architecture': 'arm64', 'minimumMacOS': '26.0',
                    'signing': 'ad-hoc', 'notarized': False, 'artifacts': {p.name: digest(p) for p in [dmg, source]}}
        (output / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (output / 'SHA256SUMS.txt').write_text(''.join(f'{digest(path)}  {path.name}\n' for path in [dmg, source, output / 'release.json']))
    print(f'Packaged local release candidate: {output}')
    print('Native UI and live provider acceptance are required before public release.')


if __name__ == '__main__':
    main()
