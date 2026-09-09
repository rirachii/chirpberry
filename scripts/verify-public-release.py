#!/usr/bin/env python3
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import plistlib
import re
import sys
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent.parent
CASK_URL = 'https://raw.githubusercontent.com/rirachii/homebrew-tap/HEAD/Casks/chirpberry.rb'


class ReleaseGateError(ValueError):
    pass


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.links.append(dict(attrs))

    def handle_data(self, data):
        self.text.append(data)


def advertised_release(html, version):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise ReleaseGateError('Use an explicit numeric website release version.')
    filename = f'Chirpberry-{version}-macOS-arm64.dmg'
    release_url = f'https://github.com/rirachii/chirpberry/releases/download/v{version}'
    dmg_url = f'{release_url}/{filename}'
    page = PageLinks(); page.feed(html)
    downloads = [link for link in page.links if '.dmg' in link.get('href', '') or '.dmg' in (link.get('download') or '')]
    if len(downloads) != 2 or any(link.get('href') != dmg_url or link.get('download') != filename for link in downloads):
        raise ReleaseGateError('Both advertised downloads must match the website version and canonical DMG URL.')
    tags = [link['href'] for link in page.links if '/releases/tag/' in link.get('href', '')]
    if tags != [f'https://github.com/rirachii/chirpberry/releases/tag/v{version}']:
        raise ReleaseGateError('Release notes must match the advertised version.')
    visible = ' '.join(page.text)
    if re.findall(r'\bVersion\s+([0-9]+\.[0-9]+\.[0-9]+)\b', visible) != [version]:
        raise ReleaseGateError('The displayed release version must match the website package.')
    if visible.count('brew install --cask rirachii/tap/chirpberry') != 2:
        raise ReleaseGateError('Both installation commands must use the canonical Homebrew tap.')
    return dmg_url


class HTTPSRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != 'https':
            raise ReleaseGateError('Refusing a release download redirect without HTTPS.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_public(url):
    if urlparse(url).scheme != 'https':
        raise ReleaseGateError('Public release verification requires HTTPS.')
    request = Request(url, headers={'User-Agent': 'Chirpberry-release-verification'})
    return build_opener(HTTPSRedirects()).open(request, timeout=30)


def read_public_text(url):
    with open_public(url) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ReleaseGateError('Release metadata exceeds the supported size.')
    return data.decode('utf-8')


def hash_public_dmg(url):
    digest = hashlib.sha256()
    total = 0
    with open_public(url) as response:
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > 1024 * 1024 * 1024:
                raise ReleaseGateError('Release DMG exceeds 1 GiB.')
            digest.update(chunk)
    if total == 0:
        raise ReleaseGateError('The public DMG is empty.')
    return digest.hexdigest()


def cask_fields(source):
    if not re.search(r'^\s*cask\s+"chirpberry"\s+do\s*$', source, re.MULTILINE):
        raise ReleaseGateError('The canonical cask must declare chirpberry.')
    fields = {}
    for field in ['version', 'sha256', 'url']:
        lines = re.findall(rf'^\s*{field}\b[^\n]*', source, re.MULTILINE)
        match = re.fullmatch(rf'\s*{field}\s+"([^"\n]+)"(?:,\s*verified:\s*"[^"\n]+")?\s*(?:#.*)?', lines[0]) if len(lines) == 1 else None
        if not match:
            raise ReleaseGateError(f'The cask must have one explicit {field} string.')
        fields[field] = match[1]
    return fields


def verify_release(version, dmg_url, read_text=read_public_text, hash_dmg=hash_public_dmg):
    manifest = json.loads(read_text(dmg_url.rsplit('/', 1)[0] + '/release.json'))
    if not isinstance(manifest, dict) or any(manifest.get(key) != value for key, value in
                                            [('version', version), ('architecture', 'arm64'), ('minimumMacOS', '26.0')]):
        raise ReleaseGateError('The public release manifest does not match the advertised Mac release.')
    artifacts = manifest.get('artifacts')
    checksum = artifacts.get(dmg_url.rsplit('/', 1)[1]) if isinstance(artifacts, dict) else None
    if not isinstance(checksum, str) or not re.fullmatch(r'[0-9a-f]{64}', checksum):
        raise ReleaseGateError('The release manifest needs the advertised DMG SHA-256.')
    cask = cask_fields(read_text(CASK_URL))
    if cask['version'] != version or cask['url'].replace('#{version}', version) != dmg_url or cask['sha256'] != checksum:
        raise ReleaseGateError('The canonical cask version, URL, and SHA-256 must match the advertised release.')
    if hash_dmg(dmg_url) != checksum:
        raise ReleaseGateError('The downloaded public DMG does not match the manifest and cask SHA-256.')
    return checksum


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--html', type=Path, default=ROOT / 'site/index.html')
    args = parser.parse_args()
    try:
        version = json.loads((ROOT / 'site/package.json').read_text())['version']
        info = plistlib.loads((ROOT / 'macOS/Info.plist').read_bytes())
        if info['CFBundleShortVersionString'] != version:
            raise ReleaseGateError('The app and website release versions do not match.')
        url = advertised_release(args.html.read_text(), version)
        checksum = verify_release(version, url)
    except (OSError, ValueError, KeyError) as error:
        print(f'Public release gate refused deployment: {error}', file=sys.stderr)
        return 1
    print(f'Public release verified: v{version}, DMG SHA-256 {checksum}, canonical cask matched.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
