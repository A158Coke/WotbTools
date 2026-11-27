"""Exercise the strict source LOC gate with disposable, isolated Git repositories.

Every case runs the REAL scanner (check-source-lines.py) against real Git
commits in a temporary repository; no mocked return values are involved.
"""

import os
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECK = Path(__file__).with_name('check-source-lines.py').resolve()
POLICY = json.loads(CHECK.with_name('source-line-policy.json').read_text(encoding='utf-8'))


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

    def check(self, base, head, *options, env=None, cwd=None):
        return subprocess.run([sys.executable, str(CHECK), '--base', base, '--head', head, *options],
                              cwd=cwd or self.root, env=env, text=True, capture_output=True)


    def test_new_production_file_500_passes_and_501_fails(self):
        self.write('frontend/src/Ok.vue', 500, final_newline=False)
        head = self.commit('new production at the inclusive limit')
        self.assertEqual(self.check(self.base, head).returncode, 0, result_msg(self.check(self.base, head)))
        self.assertIn('production: files=1 lines=500 over=0', self.check(self.base, head).stdout)
        self.write('frontend/src/TooBig.vue', 501)
        head = self.commit('new production one line over')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('frontend/src/TooBig.vue: 501 physical lines (limit 500, production)', result.stderr)

    def test_new_test_file_1500_passes_and_1501_fails(self):
        self.write('frontend/src/__tests__/Ok.spec.ts', 1500)
        head = self.commit('new test at the inclusive limit')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('test: files=1 lines=1500 over=0', result.stdout)
        self.write('frontend/src/__tests__/TooBig.spec.ts', 1501)
        head = self.commit('new test one line over')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('TooBig.spec.ts: 1501 physical lines (limit 1500, test)', result.stderr)

    def test_unchanged_and_modified_historical_files_over_limit_fail(self):
        self.write('java/wotb-web/src/main/java/Legacy.java', 501)
        self.write('android/app/src/main/java/LegacyController.kt', 500)
        legacy = self.commit('historical over-budget production file')
        self.write('README.md', 2)
        unchanged = self.commit('PR touches an unrelated file')
        result = self.check(legacy, unchanged)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Legacy.java: 501 physical lines (limit 500, production)', result.stderr)
        self.write('java/wotb-web/src/main/java/Legacy.java', 502)
        changed = self.commit('PR modifies the over-budget file')
        result = self.check(legacy, changed)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Legacy.java: 502 physical lines', result.stderr)

    def test_modified_historical_test_file_over_limit_fails(self):
        self.write('common/python/tests/legacy_test.py', 1500)
        legacy = self.commit('historical test file at the limit')
        self.write('common/python/tests/legacy_test.py', 1501)
        head = self.commit('grow the historical test file')
        result = self.check(legacy, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('legacy_test.py: 1501 physical lines (limit 1500, test)', result.stderr)

    def test_per_file_exception_attempts_cannot_pass(self):
        self.write('frontend/src/oversized.js', 501)
        self.write('scripts/ci/source-line-allowlist.txt', 1)
        (self.root / 'scripts/ci/source-line-allowlist.txt').write_text(
            'frontend/src/oversized.js\n', encoding='utf-8')
        head = self.commit('attempt to grandfather via a recreated allowlist file')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('frontend/src/oversized.js: 501 physical lines', result.stderr)

    def check_sandbox(self, base, head, sandbox):
        scanner = sandbox / 'scripts/ci/check-source-lines.py'
        return subprocess.run([sys.executable, str(scanner), '--base', base, '--head', head],
                              cwd=sandbox, text=True, capture_output=True)

    def make_sandbox(self, name):
        sandbox = self.root / name
        shutil.rmtree(sandbox, ignore_errors=True)
        (sandbox / 'scripts/ci').mkdir(parents=True)
        shutil.copy(CHECK, sandbox / 'scripts/ci/check-source-lines.py')
        return sandbox


    def test_missing_policy_fails_closed(self):
        sandbox = self.make_sandbox('sandbox')
        shutil.copy(CHECK.with_name('source-line-policy.json'),
                    sandbox / 'scripts/ci/source-line-policy.json')
        self.write('frontend/src/App.vue', 10)
        head = self.commit('trivial change')
        (sandbox / 'scripts/ci/source-line-policy.json').unlink()
        result = self.check_sandbox(self.base, head, sandbox)
        self.assertEqual(result.returncode, 2)
        self.assertIn('policy is unreadable', result.stderr)

    def test_invalid_policy_fails_closed(self):
        sandbox = self.make_sandbox('sandbox-invalid')
        (sandbox / 'scripts/ci/source-line-policy.json').write_text('{ not json')
        self.write('frontend/src/App.vue', 10)
        head = self.commit('trivial change')
        result = self.check_sandbox(self.base, head, sandbox)
        self.assertEqual(result.returncode, 2)
        self.assertIn('not valid JSON', result.stderr)

    def test_policy_with_missing_or_bad_limits_fails_closed(self):
        for payload in (
                '{"limits": {"production": 500}}',
                '{"limits": {"production": 500, "test": -3}, "categories": {}}',
                '{"limits": {"production": "500", "test": 1500}, "categories": {}}'):
            sandbox = self.make_sandbox('sandbox-limits')
            (sandbox / 'scripts/ci/source-line-policy.json').write_text(payload)
            self.write('frontend/src/App.vue', 10)
            head = self.commit('trivial change')
            result = self.check_sandbox(self.base, head, sandbox)
            self.assertEqual(result.returncode, 2, payload)
            self.assertIn('Source LOC check failed', result.stderr)

    def test_missing_git_commit_fails_closed(self):
        self.write('frontend/src/App.vue', 10)
        head = self.commit('trivial change')
        result = self.check('0' * 40, head)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Source LOC check failed', result.stderr)
        result = self.check('not-a-commit', head)
        self.assertEqual(result.returncode, 2)
        if os.name != 'nt':
            env = dict(os.environ, PATH=str(self.root))
            self.assertEqual(self.check(self.base, head, env=env).returncode, 2)


    def test_valid_generated_and_vendored_artifacts_pass(self):
        self.write('frontend/src/api/generated/contract.ts', 2000)
        self.write('frontend/src/api/generated/client.d.ts', 2000)
        self.write('frontend/src/data/vehicleSizes.js', 2000)
        self.write('android/app/src/main/cpp/xdelta3/xdelta3.c', 2000)
        self.write('frontend/pnpm-lock.yaml', 2000)
        self.write('infra/tofu/grafana/.terraform.lock.hcl', 2000)
        head = self.commit('generated and vendored artifacts of any size')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_valid_flyway_migration_of_any_size_passes(self):
        self.write('java/wotb-web/src/main/resources/db/migration/V999__huge_migration.sql', 20000)
        head = self.commit('applied Flyway migration is immutable history')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_only_valid_flyway_named_sql_is_excluded(self):
        self.write('java/wotb-web/src/main/resources/db/migration/check_data.py', 501)
        self.write('java/wotb-web/src/main/resources/db/migration/V1__valid_name.sql', 2000)
        head = self.commit('only valid versioned SQL migrations are immutable')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('migration/check_data.py: 501 physical lines', result.stderr)
        self.assertNotIn('V1__valid_name.sql', result.stderr)

    def test_invalid_flyway_sql_name_is_counted(self):
        self.write('java/wotb-web/src/main/resources/db/migration/Vx__invalid.sql', 501)
        self.write('java/wotb-web/src/main/resources/db/migration/V1oops__maintained.sql', 501)
        self.write('java/wotb-web/src/main/resources/db/migration/V1folder/helper__maintained.sql', 501)
        head = self.commit('invalid flyway version name remains maintained source')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Vx__invalid.sql: 501 physical lines', result.stderr)
        self.assertIn('V1oops__maintained.sql: 501 physical lines', result.stderr)
        self.assertIn('V1folder/helper__maintained.sql: 501 physical lines', result.stderr)

    def test_maintained_source_in_an_excluded_looking_path_does_not_bypass(self):
        self.write('java/wotb-web/src/main/resources/db/migrations/seed.sql', 501)
        self.write('deploy/db/migration/V1__huge.sql', 501)
        head = self.commit('maintained source in excluded-looking paths')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('db/migrations/seed.sql: 501 physical lines', result.stderr)
        self.assertIn('deploy/db/migration/V1__huge.sql: 501 physical lines', result.stderr)


    def test_ci_gate_tools_use_the_test_budget(self):
        self.write('scripts/ci/check-repository-hygiene.sh', POLICY['limits']['test'])
        head = self.commit('CI tooling at the test budget')
        self.assertEqual(self.check(self.base, head).returncode, 0)
        self.write('scripts/ci/check-repository-hygiene.sh', POLICY['limits']['test'] + 1)
        head = self.commit('CI tooling over the test budget')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('check-repository-hygiene.sh: 1501 physical lines (limit 1500, test)', result.stderr)

    def test_representative_extensions_are_all_enforced(self):
        names = {
            'frontend/src/app.ts': 501,
            'service/Main.java': 501,
            'android/app/src/main/java/Big.kt': 501,
            'frontend/src/util.js': 501,
            'deploy/tool.py': 501,
            'deploy/run.sh': 501,
            '.github/workflows/gate.yml': 501,
            'frontend/src/Page.vue': 501,
        }
        for name, lines in names.items():
            self.write(name, lines)
        head = self.commit('one oversized file per representative extension')
        result = self.check(self.base, head)
        self.assertEqual(result.returncode, 1)
        for name in names:
            self.assertIn(name, result.stderr)

    def test_renamed_oversized_file_is_new_debt(self):
        self.write('scripts/test-legacy.sh', 1501)
        legacy = self.commit('legacy test')
        self.git('mv', 'scripts/test-legacy.sh', 'scripts/test-renamed.sh')
        head = self.commit('rename')
        result = self.check(legacy, head)
        self.assertEqual(result.returncode, 1)
        self.assertIn('test-renamed.sh: 1501 physical lines (limit 1500, test)', result.stderr)

    def test_policy_matches_enforced_contract(self):
        self.assertEqual(POLICY['limits'], {'production': 500, 'test': 1500})
        categories = POLICY['categories']
        self.assertEqual(
            set(categories), {'generated', 'vendored', 'immutable-history'})
        self.assertEqual(categories['immutable-history']['patterns'], [])
        self.assertIn('frontend/src/api/generated/', categories['generated']['patterns'])
        self.assertIn('frontend/src/data/vehicleSizes.js', categories['generated']['patterns'])


def result_msg(result):
    return result.stdout + result.stderr


if __name__ == '__main__':
    unittest.main()
