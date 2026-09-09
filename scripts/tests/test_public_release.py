import hashlib
import importlib.util
import json
from pathlib import Path
import ssl
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('release_gate', ROOT / 'scripts/verify-public-release.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.version = '0.1.0'
        self.url = f'https://github.com/rirachii/chirpberry/releases/download/v{self.version}/Chirpberry-{self.version}-macOS-arm64.dmg'
        self.checksum = hashlib.sha256(b'Synthetic release bytes').hexdigest()
        self.manifest = {'version': self.version, 'architecture': 'arm64', 'minimumMacOS': '26.0',
                         'artifacts': {self.url.rsplit('/', 1)[1]: self.checksum}}
        self.cask = ('cask "chirpberry" do\n  version "0.1.0"\n'
                     f'  sha256 "{self.checksum}"\n'
                     '  url "https://github.com/rirachii/chirpberry/releases/download/v#{version}/Chirpberry-#{version}-macOS-arm64.dmg"\nend\n')
        self.hash_calls = []

    def read(self, url):
        if url == gate.CASK_URL:
            return self.cask
        self.assertEqual(url, self.url.rsplit('/', 1)[0] + '/release.json')
        return json.dumps(self.manifest)

    def hash_dmg(self, url):
        self.hash_calls.append(url)
        return self.checksum

    def verify(self):
        return gate.verify_release(self.version, self.url, read_text=self.read, hash_dmg=self.hash_dmg)

    def test_matching_manifest_cask_and_download_pass(self):
        self.assertEqual(self.verify(), self.checksum)
        self.assertEqual(self.hash_calls, [self.url])

    def test_missing_public_manifest_or_cask_refuses_deployment(self):
        for missing in [gate.CASK_URL, self.url.rsplit('/', 1)[0] + '/release.json']:
            with self.subTest(missing=missing):
                def read(url):
                    if url == missing:
                        raise HTTPError(url, 404, 'Not found', None, None)
                    return self.read(url)
                with self.assertRaises(HTTPError):
                    gate.verify_release(self.version, self.url, read_text=read, hash_dmg=self.hash_dmg)
        self.assertEqual(self.hash_calls, [])

    def test_missing_dmg_refuses_deployment(self):
        def missing(url):
            raise HTTPError(url, 404, 'Not found', None, None)
        with self.assertRaises(HTTPError):
            gate.verify_release(self.version, self.url, read_text=self.read, hash_dmg=missing)

    def test_mismatched_cask_version_url_and_checksum_refuse_deployment(self):
        original = self.cask
        for source in [original.replace('version "0.1.0"', 'version "0.0.9"'),
                       original.replace('/rirachii/chirpberry/', '/another/repository/'),
                       original.replace(self.checksum, '0' * 64),
                       original.replace(f'"{self.checksum}"', ':no_check'),
                       original.replace('  version', '  version "0.0.9"\n  version')]:
            with self.subTest(source=source):
                self.cask = source
                with self.assertRaises(gate.ReleaseGateError):
                    self.verify()
        self.assertEqual(self.hash_calls, [])

    def test_mismatched_manifest_and_download_refuse_deployment(self):
        for key, value in [('version', '0.0.9'), ('architecture', 'x86_64'), ('minimumMacOS', '14.0'), ('artifacts', {})]:
            with self.subTest(key=key):
                original = self.manifest[key]; self.manifest[key] = value
                with self.assertRaises(gate.ReleaseGateError):
                    self.verify()
                self.manifest[key] = original
        with self.assertRaises(gate.ReleaseGateError):
            gate.verify_release(self.version, self.url, read_text=self.read, hash_dmg=lambda _: '0' * 64)

    def test_tls_failure_is_not_bypassed_or_retried(self):
        failure = URLError(ssl.SSLCertVerificationError('Untrusted test certificate'))
        with patch.object(gate, 'build_opener') as opener:
            opener.return_value.open.side_effect = failure
            with self.assertRaises(URLError):
                gate.verify_release(self.version, self.url)
            self.assertEqual(opener.return_value.open.call_count, 1)
        with self.assertRaises(gate.ReleaseGateError):
            gate.HTTPSRedirects().redirect_request(None, None, 302, '', {}, 'http://example.invalid/asset')

    def test_actual_site_advertisement_and_mismatch_detection(self):
        html = (ROOT / 'site/index.html').read_text()
        version = json.loads((ROOT / 'site/package.json').read_text())['version']
        expected = f'https://github.com/rirachii/chirpberry/releases/download/v{version}/Chirpberry-{version}-macOS-arm64.dmg'
        self.assertEqual(gate.advertised_release(html, version), expected)
        for modified in [html.replace(expected, expected + '?different', 1),
                         html.replace(f'Version {version}', 'Version 9.9.9'),
                         html.replace('rirachii/tap/chirpberry', 'another/tap/chirpberry')]:
            with self.assertRaises(gate.ReleaseGateError):
                gate.advertised_release(modified, version)


if __name__ == '__main__':
    unittest.main()
