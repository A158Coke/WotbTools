#!/usr/bin/env python3
"""Exercise the source LOC gate with disposable, isolated Git repositories."""

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECK = Path(__file__).with_name('check-source-lines.py').resolve()


class SourceLineGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.write('README.md', 1)
        self.base = self.commit('base')

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True, capture_output=True).stdout.decode().strip()

    def write(self, name, lines, final_newline=True):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        content = b'line\n' * lines
        path.write_bytes(content if final_newline else content[:-1])

    def commit(self, label):
        self.git('add', '-A')
        self.git('commit', '-q', '-m', label)
        return self.git('rev-parse', 'HEAD')

    def check(self, base, head, *options, env=None):
        return subprocess.run([sys.executable, str(CHECK), '--base', base, '--head', head, *options],
                              cwd=self.root, env=env, text=True, capture_output=True)

    def test_inclusive_limits_and_explicit_exclusions(self):
        self.write('frontend/src/Ok.vue', 500, final_newline=False)
        self.write('android/app/src/androidTest/java/Ok.kt', 1500)
        self.write('frontend/src/api/generated/contract.ts', 2000)
        self.write('android/app/src/main/cpp/xdelta3/xdelta3.c', 2000)
        self.write('infra/tofu/grafana/.terraform.lock.hcl', 2000)
        self.write('frontend/pnpm-lock.yaml', 2000)
        head = self.commit('within limits')
        result = self.check(self.base, head, '--strict')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('production: files=1 lines=500 over=0', result.stdout)
        self.assertIn('test: files=1 lines=1500 over=0', result.stdout)

    def test_new_production_and_test_over_limit_fail(self):
        self.write('common/python/loader.py', 501)
        self.write('frontend/scripts/browser-scenario.mjs', 1501)
        head = self.commit('new oversized')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('loader.py: 501 physical lines', result.stderr)
        self.assertIn('browser-scenario.mjs: 1501 physical lines', result.stderr)

    def test_legacy_unchanged_only_and_strict_mode(self):
        self.write('java/module/src/main/java/Old.java', 501)
        legacy = self.commit('legacy')
        self.write('README.md', 2)
        unchanged = self.commit('unrelated')
        self.assertEqual(self.check(legacy, unchanged).returncode, 0)
        self.assertEqual(self.check(legacy, unchanged, '--strict').returncode, 1)
        self.write('java/module/src/main/java/Old.java', 502)
        changed = self.commit('grow old')
        self.assertEqual(self.check(legacy, changed).returncode, 1)
        self.write('java/module/src/main/java/Old.java', 500)
        fixed = self.commit('split old')
        self.assertEqual(self.check(legacy, fixed, '--strict').returncode, 0)

    def test_unknown_paths_and_invalid_revisions_cannot_pass(self):
        self.write('some/generated/handwritten.py', 501)
        head = self.commit('not explicitly excluded')
        self.assertEqual(self.check(self.base, head).returncode, 1)
        self.assertEqual(self.check('not-a-commit', head).returncode, 2)
        env = dict(os.environ, PATH=str(self.root))
        self.assertEqual(self.check(self.base, head, env=env).returncode, 2)

    def test_renamed_oversized_file_is_new_debt(self):
        self.write('scripts/test-legacy.sh', 1501)
        legacy = self.commit('legacy test')
        self.git('mv', 'scripts/test-legacy.sh', 'scripts/test-renamed.sh')
        head = self.commit('rename')
        result = self.check(legacy, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('test-renamed.sh: 1501 physical lines (limit 1500, test)', result.stderr)

    def test_handwritten_markup_and_less_common_languages_are_checked(self):
        names = ('android/app/src/main/res/layout/example.xml', 'schema.graphql',
                 'service/codec.cxx', 'frontend/scripts/protos/schema.proto', '.github/workflows/test.yml')
        for name in names:
            self.write(name, 501)
        head = self.commit('additional source types')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        for name in names:
            self.assertIn(name, result.stderr)


if __name__ == '__main__':
    unittest.main()
