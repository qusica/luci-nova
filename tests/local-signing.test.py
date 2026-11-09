#!/usr/bin/env python3
"""Offline tests for the data-only local intake guard; no network or keys."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('guard', ROOT / 'scripts/prepare-local-signing.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
header_spec = importlib.util.spec_from_file_location('header', ROOT / 'scripts/check-packaged-header.py')
header = importlib.util.module_from_spec(header_spec)
header_spec.loader.exec_module(header)


class HeaderTests(unittest.TestCase):
    def setUp(self):
        self.source = (b'<link href="/luci-static/bootstrap/cascade.css">\n'
                       b'<link href="/luci-static/bootstrap/mobile.css">\n'
                       b'<link href="{{ media }}/cascade.css">\n'
                       b'<link href="{{ media }}/nova-lists.css">\n'
                       b'<script src="{{ resource }}/cbi.js"></script>\n'
                       b'<script src="{{ media }}/nova-shell.js"></script>\n'
                       b'<script src="{{ media }}/nova-lists.js"></script>\n')

    def test_only_fixed_version_insertions_accepted(self):
        actual = self.source.replace(b'.css"', b'.css?v=0.2.12"').replace(b'.js"', b'.js?v=0.2.12"')
        actual = actual.replace(b'bootstrap/cascade.css?v=0.2.12', b'bootstrap/cascade.css').replace(b'bootstrap/mobile.css?v=0.2.12', b'bootstrap/mobile.css')
        header.verify_header(self.source, actual)

    def test_missing_or_duplicate_urls_rejected(self):
        for source in (self.source.replace(header.URLS[0], b'"other.css"'), self.source + header.URLS[0]):
            with self.assertRaises(ValueError):
                header.expected_header(source)

    def test_other_header_changes_or_wrong_version_rejected(self):
        expected = header.expected_header(self.source)
        for actual in (self.source, expected + b' ', expected.replace(b'0.2.12', b'0.2.8'), expected.replace(b'<link', b'<changed', 1)):
            with self.assertRaises(ValueError):
                header.verify_header(self.source, actual)

    def test_mobile_stylesheet_order_rejected(self):
        lines = self.source.splitlines(keepends=True)
        lines[1], lines[2] = lines[2], lines[1]
        with self.assertRaises(ValueError):
            header.expected_header(b''.join(lines))


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.env = {'GITHUB_REPOSITORY': g.REPO, 'GITHUB_REF': 'refs/heads/' + g.BRANCH,
                    'GITHUB_EVENT_NAME': 'push', 'GITHUB_RUN_ATTEMPT': '1',
                    'GITHUB_WORKFLOW_REF': f'{g.REPO}/{g.WORKFLOW}@refs/heads/{g.BRANCH}',
                    'GITHUB_SHA': 'b' * 40, 'GITHUB_RUN_ID': '12345'}
        repo = {'id': g.REPO_ID, 'full_name': g.REPO, 'fork': False}
        self.history = {'total_count': 1, 'workflow_runs': [{
            'id': 12345, 'head_sha': 'b' * 40, 'head_branch': g.BRANCH,
            'event': 'push', 'path': g.WORKFLOW, 'run_attempt': 1,
            'repository': dict(repo), 'head_repository': dict(repo)}]}
        self.source = {'sha': g.SOURCE_SHA, 'commit': {'tree': {'sha': g.SOURCE_TREE}}}
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.inputs = self.root / 'inputs'
        self.inputs.mkdir()
        self.output = self.root / 'output'
        self.manifest = {'source_commit': g.SOURCE_SHA, 'source_tree': g.SOURCE_TREE,
                         'sdk': 'verified official target, mocked data only'}
        data = (json.dumps(self.manifest) + '\n').encode()
        (self.inputs / 'manifest.json').write_bytes(data)
        hashes = {}
        for name in g.PACKAGE_SHA256:
            blob = ('fake data for ' + name).encode()
            (self.inputs / (name + '.base64')).write_bytes(base64.b64encode(blob) + b'\n')
            hashes[name] = g.digest(blob)
        for p in [patch.object(g, 'MANIFEST_SHA256', g.digest(data)),
                  patch.object(g, 'PACKAGE_SHA256', hashes)]:
            p.start()
            self.addCleanup(p.stop)

    def test_exact_stage_and_fresh_job_verification(self):
        g.validate_pins()
        g.validate_context(self.env, self.history, self.source)
        g.stage(self.inputs, self.output, self.env)
        g.verify(self.inputs, self.output, self.env)

    def test_unpinned_entry_fails_before_api(self):
        with patch.object(g, 'MANIFEST_SHA256', ''), patch.object(g, 'api') as api, \
             patch.object(g.sys, 'argv', ['guard', 'stage', '/unused', '/unused2']), \
             self.assertRaises(ValueError):
            g.main()
        api.assert_not_called()

    def test_unpinned_or_malformed_package_hash(self):
        for value in ('', 'A' * 64, 'f' * 63):
            with patch.object(g, 'PACKAGE_SHA256', {'file.apk': value}), self.assertRaises(ValueError):
                g.validate_pins()

    def test_context_fields_are_pinned(self):
        for key in self.env:
            with self.subTest(key=key), self.assertRaises(ValueError):
                g.validate_context(dict(self.env, **{key: 'wrong'}), self.history, self.source)

    def test_any_other_run_consumes_entry(self):
        for conclusion in ('success', 'failure', 'cancelled', None):
            history = copy.deepcopy(self.history)
            history['total_count'] = 2
            history['workflow_runs'].append({'id': 999, 'conclusion': conclusion})
            with self.subTest(conclusion=conclusion), self.assertRaises(ValueError):
                g.validate_context(self.env, history, self.source)

    def test_missing_or_incomplete_history(self):
        for history in ({'total_count': 0, 'workflow_runs': []},
                        dict(self.history, total_count=100),
                        dict(self.history, workflow_runs=[])):
            with self.assertRaises(ValueError):
                g.validate_context(self.env, history, self.source)

    def test_run_identity_fields_are_pinned(self):
        for key in ('id', 'head_sha', 'head_branch', 'event', 'path', 'run_attempt'):
            history = copy.deepcopy(self.history)
            history['workflow_runs'][0][key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(ValueError):
                g.validate_context(self.env, history, self.source)

    def test_fork_or_wrong_repository_denied(self):
        for side in ('repository', 'head_repository'):
            for key, value in [('id', 1), ('full_name', 'other/repo'), ('fork', True)]:
                history = copy.deepcopy(self.history)
                history['workflow_runs'][0][side][key] = value
                with self.subTest(side=side, key=key), self.assertRaises(ValueError):
                    g.validate_context(self.env, history, self.source)

    def test_source_identity_denied(self):
        for source in ({'sha': 'c' * 40, 'commit': {'tree': {'sha': g.SOURCE_TREE}}},
                       {'sha': g.SOURCE_SHA, 'commit': {'tree': {'sha': 'c' * 40}}}):
            with self.assertRaises(ValueError):
                g.validate_context(self.env, self.history, source)

    def test_modified_manifest_denied(self):
        (self.inputs / 'manifest.json').write_text('{}')
        with self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)

    def test_even_pinned_manifest_needs_exact_source(self):
        data = json.dumps(dict(self.manifest, source_commit='c' * 40)).encode()
        (self.inputs / 'manifest.json').write_bytes(data)
        with patch.object(g, 'MANIFEST_SHA256', g.digest(data)), self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)

    def test_extra_or_missing_input_denied(self):
        extra = self.inputs / 'evil.sh'
        extra.write_text('unused data')
        with self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)
        extra.unlink()
        (self.inputs / (next(iter(g.PACKAGE_SHA256)) + '.base64')).unlink()
        with self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)

    def test_wrong_bytes_and_noncanonical_transport_denied(self):
        path = self.inputs / (next(iter(g.PACKAGE_SHA256)) + '.base64')
        original = path.read_bytes()
        for value in (b'!bad!\n', b'YQ==\n', original[:-1], b'\n' + original,
                      original + b'\n', original + b'ignored'):
            path.write_bytes(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                g.stage(self.inputs, self.output, self.env)

    def test_symlink_and_size_bounds_denied(self):
        path = self.inputs / (next(iter(g.PACKAGE_SHA256)) + '.base64')
        original = path.read_bytes()
        target = self.root / 'target'
        target.write_bytes(original)
        path.unlink()
        path.symlink_to(target)
        with self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)
        path.unlink()
        path.write_bytes(original)
        with patch.object(g, 'LIMIT', 1), self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)

    def test_output_overwrite_denied(self):
        self.output.mkdir()
        with self.assertRaises(ValueError):
            g.stage(self.inputs, self.output, self.env)

    def test_fresh_signing_job_detects_package_or_provenance_changes(self):
        g.stage(self.inputs, self.output, self.env)
        for name in [*g.PACKAGE_SHA256, 'BUILD-SOURCE.json']:
            path = self.output / name
            original = path.read_bytes()
            path.write_bytes(b'{}')
            with self.subTest(name=name), self.assertRaises(ValueError):
                g.verify(self.inputs, self.output, self.env)
            path.write_bytes(original)

    def test_fresh_signing_job_detects_other_run_and_extra_files(self):
        g.stage(self.inputs, self.output, self.env)
        with self.assertRaises(ValueError):
            g.verify(self.inputs, self.output, dict(self.env, GITHUB_RUN_ID='999'))
        (self.output / 'executable.sh').write_text('data')
        with self.assertRaises(ValueError):
            g.verify(self.inputs, self.output, self.env)

    def test_workflow_separates_tests_from_signing(self):
        workflow = (ROOT / g.WORKFLOW).read_text()
        validation, signing = workflow.split('\n  sign:', 1)
        self.assertNotIn('secrets.', validation)
        self.assertNotIn('gh-action-sdk', workflow)
        self.assertIn('test-built-apks.sh', validation)
        self.assertIn('test -s source/tests/visual-browser.test.js', validation)
        self.assertIn('test -s source/tests/native-spacing-browser.test.js', validation)
        self.assertIn('test -s source/tests/sidebar-overflow-browser.test.js', validation)
        self.assertIn('test -s source/scripts/test-package-independence.sh', validation)
        self.assertIn('grep -F', validation)
        self.assertIn('"$stage/tests/visual-browser.test.js"', validation)
        self.assertIn('"$stage/tests/native-spacing-browser.test.js"', validation)
        self.assertIn('"$stage/tests/sidebar-overflow-browser.test.js"', validation)
        self.assertIn('bash "$base/scripts/test-package-independence.sh"', validation)
        self.assertIn('python3 guard/scripts/check-packaged-header.py', validation)
        self.assertIn('packaged-tests/extracted/usr/share/ucode/luci/template/themes/nova/header.ut', validation)
        self.assertNotIn('check-packaged-header.py', signing)
        self.assertIn('fonts-noto-cjk', validation)
        self.assertIn('NOVA_SCREENSHOT_DIR:', validation)
        self.assertNotIn('PACKAGED-VISUAL-REVIEW', signing)
        self.assertIn('needs: validate', signing)
        self.assertIn('ref: ' + g.TRUSTED_SHA, signing)
        self.assertNotIn('ref: ' + g.SOURCE_SHA, signing)
        self.assertEqual(signing.count('secrets.NOVA_APK_SIGNING_KEY'), 1)
        self.assertIn('NOVA_APK_SIGNING_PUBLIC_KEY_SHA256: ' + g.KEY_SHA256, signing)
        self.assertLess(signing.index('prepare-local-signing.py verify'), signing.index('secrets.NOVA_APK_SIGNING_KEY'))
        self.assertLess(signing.index('Build trusted pinned APK tool'), signing.index('secrets.NOVA_APK_SIGNING_KEY'))
        self.assertIn('validated-local-input-${{ github.run_id }}', signing)
        self.assertNotIn('workflow_dispatch:', workflow)


if __name__ == '__main__':
    unittest.main(verbosity=2)

