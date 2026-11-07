#!/usr/bin/env python3
"""Exercise fail-closed local source/feed guards without a build or network."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

HELPER = Path(__file__).with_name('build-local-apks.sh')

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        for name in ['luci-theme-nova/Makefile', 'luci-app-nova-dashboard/Makefile', 'tests/unit.js']:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('original\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Local guard test', '-c', 'user.email=local@example.invalid', 'commit', '-qm', 'fixture')
        (self.repo / 'scripts').mkdir()
        shutil.copyfile(HELPER, self.repo / 'scripts/build-local-apks.sh')
        self.cache = self.root / 'cache'
        (self.cache / 'sdk').mkdir(parents=True)
        (self.cache / 'sdk/Makefile').write_text('')
        (self.cache / 'sdk-provenance.json').write_text('{}')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.source = self.cache / 'sources' / self.commit

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def snapshot(self):
        self.source.mkdir(parents=True)
        archive = self.root / 'source.tar'
        with archive.open('wb') as stream:
            subprocess.run(['git', '-C', str(self.repo), 'archive', 'HEAD'], stdout=stream, check=True)
        with tarfile.open(archive) as source:
            source.extractall(self.source, filter='data')

    def reject(self, message=None):
        result = subprocess.run(['bash', str(self.repo / 'scripts/build-local-apks.sh'), str(self.cache), str(self.root/'output')],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                env={**os.environ, 'NOVA_LOCAL_BROWSER_TESTS':'0'}, timeout=15)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        if message:
            self.assertIn(message, result.stdout)

    def test_uncommitted_package_change_is_rejected(self):
        (self.repo/'luci-theme-nova/Makefile').write_text('changed\n')
        self.reject()
        self.assertFalse(self.source.exists())

    def test_staged_package_change_is_rejected(self):
        (self.repo/'luci-theme-nova/Makefile').write_text('changed\n')
        self.git('add','luci-theme-nova/Makefile')
        self.reject()
        self.assertFalse(self.source.exists())

    def test_untracked_package_input_is_rejected(self):
        (self.repo/'luci-theme-nova/extra').write_text('untracked\n')
        self.reject()
        self.assertFalse(self.source.exists())

    def test_cached_content_change_is_rejected(self):
        self.snapshot()
        (self.source/'luci-theme-nova/Makefile').write_text('changed\n')
        self.reject('Cached source changed:')

    def test_cached_mode_change_is_rejected(self):
        self.snapshot()
        (self.source/'luci-theme-nova/Makefile').chmod(0o755)
        self.reject('AssertionError: luci-theme-nova/Makefile')

    def test_extra_cached_file_is_rejected(self):
        self.snapshot()
        (self.source/'extra').write_text('untracked\n')
        self.reject('Cached source contains missing or extra files.')

    def test_untracked_feed_input_is_rejected(self):
        self.snapshot()
        feed = self.cache/'feeds/base'
        feed.mkdir(parents=True)
        subprocess.run(['git','init','-q',str(feed)],check=True)
        (feed/'Makefile').write_text('original\n')
        subprocess.run(['git','-C',str(feed),'add','.'],check=True)
        subprocess.run(['git','-C',str(feed),'-c','user.name=Local guard test','-c','user.email=local@example.invalid','commit','-qm','fixture'],check=True)
        revision=subprocess.check_output(['git','-C',str(feed),'rev-parse','HEAD'],text=True).strip()
        (self.cache/'sdk-provenance.json').write_text(json.dumps({'feeds':{'base':revision}}))
        (feed/'unexpected-Makefile').write_text('untracked\n')
        self.reject('Unexpected untracked files in base feed')

if __name__ == '__main__':
    unittest.main()
