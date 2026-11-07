#!/usr/bin/env python3
"""Offline mocked regression tests. No API calls and no signing keys."""
import copy
import hashlib
import importlib.util
import io
import json
import stat
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('guard', Path(__file__).resolve().parents[1] /
                                             'scripts/prepare-development-signing.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.patches = [patch.object(g, 'ARTIFACT_ID', 123),
                        patch.object(g, 'ARTIFACT_DIGEST', 'sha256:' + 'a' * 64)]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        repo = {'full_name': g.REPO, 'id': g.REPO_ID, 'fork': False}
        self.run = {'id': g.SOURCE_RUN, 'head_sha': g.SOURCE_SHA,
                    'head_branch': g.SOURCE_BRANCH, 'event': 'pull_request',
                    'path': '.github/workflows/build.yml', 'workflow_id': g.SOURCE_WORKFLOW,
                    'run_attempt': 1, 'status': 'completed', 'conclusion': 'success',
                    'repository': copy.deepcopy(repo), 'head_repository': copy.deepcopy(repo)}
        self.commit = {'sha': g.SOURCE_SHA, 'commit': {'tree': {'sha': g.SOURCE_TREE}}}
        self.artifact = {'id': 123, 'name': g.ARTIFACT_NAME, 'digest': g.ARTIFACT_DIGEST,
                         'expired': False, 'size_in_bytes': 200,
                         'workflow_run': {'id': g.SOURCE_RUN, 'head_sha': g.SOURCE_SHA,
                                          'head_branch': g.SOURCE_BRANCH,
                                          'repository_id': g.REPO_ID,
                                          'head_repository_id': g.REPO_ID}}
        self.listing = {'total_count': 1, 'artifacts': [self.artifact]}
        self.env = {'GITHUB_REPOSITORY': g.REPO, 'GITHUB_REF': 'refs/heads/' + g.BRANCH,
                    'GITHUB_EVENT_NAME': 'push', 'GITHUB_RUN_ATTEMPT': '1',
                    'GITHUB_WORKFLOW_REF': g.REPO + '/.github/workflows/signed-apk.yml@refs/heads/' + g.BRANCH,
                    'GITHUB_RUN_ID': '456', 'GITHUB_SHA': 'b' * 40}
        self.history = {'total_count': 1, 'workflow_runs': [
            {'id': 456, 'head_sha': 'b' * 40, 'head_branch': g.BRANCH,
             'event': 'push', 'path': '.github/workflows/signed-apk.yml'}]}

    def test_exact_case_allowed(self):
        g.validate_context(self.env, self.history)
        self.assertEqual(g.validate_source(self.run, self.listing, self.commit), self.artifact)

    def test_unpinned_artifact_denied(self):
        with patch.object(g, 'ARTIFACT_ID', 0), self.assertRaises(ValueError):
            g.validate_source(self.run, self.listing, self.commit)

    def test_source_run_mismatches_denied(self):
        changes = {'id': 7, 'head_sha': 'c'*40, 'head_branch': 'main', 'event': 'push',
                   'path': 'other.yml', 'workflow_id': 1, 'run_attempt': 2,
                   'status': 'in_progress', 'conclusion': 'failure'}
        for key, value in changes.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                g.validate_source(dict(self.run, **{key: value}), self.listing, self.commit)

    def test_fork_and_wrong_repository_denied(self):
        for field in ('repository', 'head_repository'):
            for key, value in [('full_name', 'attacker/luci-nova'), ('id', 1), ('fork', True)]:
                bad = copy.deepcopy(self.run)
                bad[field][key] = value
                with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                    g.validate_source(bad, self.listing, self.commit)

    def test_tree_mismatch_denied(self):
        with self.assertRaises(ValueError):
            g.validate_source(self.run, self.listing, {'sha': g.SOURCE_SHA})

    def test_artifact_mismatches_denied(self):
        for key, value in [('id', 124), ('digest', 'sha256:'+'b'*64), ('expired', True),
                           ('size_in_bytes', 0), ('size_in_bytes', 20_000_001), ('name', 'other')]:
            bad = copy.deepcopy(self.listing)
            bad['artifacts'][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                g.validate_source(self.run, bad, self.commit)
        for key in self.artifact['workflow_run']:
            bad = copy.deepcopy(self.listing)
            bad['artifacts'][0]['workflow_run'][key] = 'wrong'
            with self.subTest(key=key), self.assertRaises(ValueError):
                g.validate_source(self.run, bad, self.commit)

    def test_missing_duplicate_or_incomplete_artifacts_denied(self):
        for listing in ({'total_count': 0, 'artifacts': []},
                        {'total_count': 2, 'artifacts': [self.artifact, self.artifact]},
                        {'total_count': 101, 'artifacts': [self.artifact]}):
            with self.subTest(listing=listing), self.assertRaises(ValueError):
                g.validate_source(self.run, listing, self.commit)

    def test_wrong_signing_context_denied(self):
        for key in self.env:
            bad = dict(self.env, **{key: 'wrong'})
            with self.subTest(key=key), self.assertRaises(ValueError):
                g.validate_context(bad, self.history)

    def test_prior_success_and_pending_denied(self):
        for status, conclusion in [('completed', 'success'), ('in_progress', None), ('queued', None)]:
            history = copy.deepcopy(self.history)
            history['total_count'] = 2
            history['workflow_runs'].append({'id': 123, 'status': status, 'conclusion': conclusion})
            with self.subTest(status=status), self.assertRaises(ValueError):
                g.validate_context(self.env, history)

    def test_failed_previous_run_allows_reviewed_retry_push(self):
        self.history['total_count'] = 2
        self.history['workflow_runs'].append({'id': 123, 'status': 'completed', 'conclusion': 'failure'})
        g.validate_context(self.env, self.history)

    def archive(self, names):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            for name in names:
                archive.writestr(name, b'fake APK bytes, not executed')
        return buf.getvalue()

    def test_exact_zip_pair_allowed(self):
        data = self.archive(['packages/' + name for name in g.PACKAGES])
        with tempfile.TemporaryDirectory() as tmp, patch.object(
                g, 'ARTIFACT_DIGEST', 'sha256:' + hashlib.sha256(data).hexdigest()):
            out = Path(tmp) / 'unsigned'
            g.unpack(data, out)
            self.assertEqual(set(p.name for p in out.iterdir()), set(g.PACKAGES))

    def test_bad_zip_members_denied(self):
        cases = [list(g.PACKAGES) + ['evil.sh'], [g.PACKAGES[0]],
                 ['../' + name for name in g.PACKAGES],
                 ['/' + name for name in g.PACKAGES],
                 ['packages\\' + name for name in g.PACKAGES],
                 [name.replace('0.2.3', '0.2.4') for name in g.PACKAGES],
                 [g.PACKAGES[0], 'duplicate/' + g.PACKAGES[0], g.PACKAGES[1]]]
        for names in cases:
            data = self.archive(names)
            with self.subTest(names=names), tempfile.TemporaryDirectory() as tmp, patch.object(
                    g, 'ARTIFACT_DIGEST', 'sha256:' + hashlib.sha256(data).hexdigest()), self.assertRaises(ValueError):
                g.unpack(data, Path(tmp) / 'unsigned')

    def test_zip_symlink_denied(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            link = zipfile.ZipInfo(g.PACKAGES[0])
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, '/tmp/target.apk')
            archive.writestr(g.PACKAGES[1], b'fake APK')
        data = buf.getvalue()
        with tempfile.TemporaryDirectory() as tmp, patch.object(
                g, 'ARTIFACT_DIGEST', 'sha256:' + hashlib.sha256(data).hexdigest()), self.assertRaisesRegex(ValueError, 'symlink'):
            g.unpack(data, Path(tmp) / 'unsigned')

    def test_zip_digest_mismatch_denied(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
            g.unpack(self.archive(g.PACKAGES), Path(tmp) / 'unsigned')

    def test_production_jobs_unchanged_and_development_isolated(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/signed-apk.yml').read_text()
        jobs = workflow.split('jobs:\n', 1)[1]
        production, development = jobs.split('\n  development-test-once:', 1)
        self.assertEqual(hashlib.sha256(production.rstrip().encode()).hexdigest(),
                         'de43b884bdc9e66cf750fc6cbf245ae099ed6e147d9824c760c966862fec5522')
        self.assertNotIn('gh-action-sdk', development)
        self.assertEqual(development.count('secrets.NOVA_APK_SIGNING_KEY'), 1)
        self.assertIn('ref: ' + g.TRUSTED_SHA, development)
        self.assertIn('NOVA_APK_SIGNING_PUBLIC_KEY_SHA256: ' + g.EXPECTED_PUBLIC_KEY_SHA256, development)
        self.assertNotIn('vars.NOVA_APK_SIGNING_PUBLIC_KEY_SHA256', development)
        self.assertIn('vars.NOVA_APK_SIGNING_PUBLIC_KEY_SHA256', production)
        self.assertIn("github.event_name == 'push'", development)
        self.assertIn("github.ref == 'refs/heads/" + g.BRANCH + "'", development)
        self.assertLess(development.index('Build trusted pinned'), development.index('secrets.NOVA_APK_SIGNING_KEY'))
        self.assertIn('DEVELOPMENT-TEST-luci-nova-0.2.3-r1', development)

    def test_full_acquisition_mock(self):
        data = self.archive(g.PACKAGES)
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        self.artifact['digest'] = digest
        with tempfile.TemporaryDirectory() as tmp, patch.object(g, 'ARTIFACT_DIGEST', digest), \
             patch.object(g, 'api', side_effect=[self.history, self.run, self.listing, self.commit, data]) as api, \
             patch.dict(g.os.environ, self.env, clear=True), \
             patch.object(g.sys, 'argv', ['prepare', str(Path(tmp)/'input')]):
            g.main()
            self.assertEqual(api.call_count, 5)
            provenance = json.loads((Path(tmp)/'input/BUILD-SOURCE.json').read_text())
            self.assertEqual(provenance['expected_public_key_sha256'], g.EXPECTED_PUBLIC_KEY_SHA256)


if __name__ == '__main__':
    unittest.main(verbosity=2)
