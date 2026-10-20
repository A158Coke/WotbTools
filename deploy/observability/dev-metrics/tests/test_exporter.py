import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from classification import actor_type, classify_area
from collector import aggregate, collect
from exporter import Snapshot, handler
from github_client import GitHubClient, GitHubError
from http.server import ThreadingHTTPServer
from prometheus_client import CollectorRegistry
from prometheus_client.parser import text_string_to_metric_families

NOW = datetime(2026, 10, 17, tzinfo=timezone.utc)


def pr(number=1, **values):
    return dict({'number': number, 'state': 'open', 'created_at': '2026-10-16T00:00:00Z',
                 'merged_at': None, 'labels': [], 'user': {'login': 'someone', 'type': 'User'}}, **values)


def sample(samples, name, **labels):
    return next(value for metric, keys, value in samples if metric == 'wotb_dev_' + name and dict(keys) == labels)


class AggregationTests(unittest.TestCase):
    def test_actual_historical_months(self):
        data = json.loads(Path(__file__).with_name('fixtures').joinpath('pr-history.json').read_text(encoding='utf-8-sig'))
        data = data.get('pull_requests', data.get('prs', [])) if isinstance(data, dict) else data
        samples = aggregate(data, now=NOW)
        for month, expected in [('06', 16), ('07', 24), ('08', 158), ('09', 205)]:
            self.assertEqual(sample(samples, 'pr_created_month', month='2026-' + month), expected)

    def test_states_quantile_and_daily(self):
        samples = aggregate([pr(), pr(2, draft=True), pr(3, state='closed'),
                             pr(4, state='closed', merged_at='2026-10-16T01:00:00Z')], now=NOW)
        self.assertEqual(sample(samples, 'pull_requests', state='open'), 2)
        self.assertEqual(sample(samples, 'pull_requests', state='closed_unmerged'), 1)
        self.assertEqual(sample(samples, 'pull_requests', state='merged'), 1)
        self.assertEqual(sample(samples, 'draft_pr_count'), 1)
        self.assertEqual(sample(samples, 'pr_merge_lead_time_seconds', quantile='0.50'), 3600)
        self.assertEqual(sample(samples, 'pr_created_day', day='2026-10-16'), 4)

    def test_required_gate_is_independent_from_workflow(self):
        run = {'_workflow': 'ci-gate.yml', 'status': 'completed', 'conclusion': 'failure',
               'created_at': '2026-10-16T00:00:00Z'}
        gate = {'conclusion': 'success', 'started_at': '2026-10-16T01:00:00Z', 'completed_at': '2026-10-16T01:00:04Z'}
        samples = aggregate([], [run], [gate], now=NOW)
        self.assertEqual(sample(samples, 'required_gate_runs_total', conclusion='success'), 1)
        self.assertEqual(sample(samples, 'required_gate_duration_seconds', quantile='0.50'), 4)
        self.assertEqual(sample(samples, 'required_gate_runs_total', conclusion='failure'), 0)


class CollectionTests(unittest.TestCase):
    def test_completed_gate_contributions_cached_and_rerun_invalidates(self):
        calls = []
        attempt = [1]
        class Client:
            def pages(self, path, key=None):
                calls.append(path)
                if '/pulls?' in path:
                    return iter([pr()])
                if '/files?' in path:
                    return iter([{'filename': 'frontend/a.vue'}])
                if '/actions/runs?' in path:
                    return iter([{'id': 1, 'run_attempt': attempt[0], 'path': '.github/workflows/ci-gate.yml',
                        'status': 'completed', 'conclusion': 'failure', 'created_at': '2026-10-16T00:00:00Z'}])
                if '/jobs?' in path:
                    return iter([{'name': 'CI / Required Gate', 'status': 'completed', 'conclusion': 'success',
                        'started_at': '2026-10-16T00:00:00Z', 'completed_at': '2026-10-16T00:00:04Z'},
                        {'name': 'other', 'status': 'completed', 'conclusion': 'failure'}])
                return iter([])
        cache = {}
        for _ in range(2):
            result = collect(Client(), 'A158Coke/WotbTools', {}, NOW, cache)
        self.assertEqual(sum('/jobs?' in path for path in calls), 1)
        self.assertEqual(sum('/files?' in path for path in calls), 1)
        self.assertEqual(sample(result, 'required_gate_runs_total', conclusion='success'), 1)
        self.assertEqual(sample(result, 'pr_area_total', area='frontend'), 1)
        attempt[0] = 2
        collect(Client(), 'A158Coke/WotbTools', {}, NOW, cache)
        self.assertEqual(sum('/jobs?' in path for path in calls), 2)
        self.assertEqual(len(cache['gates']), 1)

    def test_labels_do_not_bypass_path_classification(self):
        calls = []
        class Client:
            def pages(self, path, key=None):
                calls.append(path)
                if '/pulls?' in path:
                    return iter([pr(labels=[{'name': 'area/auth'}])])
                if '/files?' in path:
                    return iter([{'filename': 'frontend/a.vue'}])
                return iter([])
        result = collect(Client(), 'A158Coke/WotbTools', {}, NOW)
        self.assertEqual(sample(result, 'pr_area_total', area='frontend'), 1)
        self.assertEqual(sample(result, 'pr_area_total', area='auth'), 0)
        self.assertEqual(sum('/files?' in path for path in calls), 1)

    def test_frozen_override_skips_file_history(self):
        calls = []
        class Client:
            def pages(self, path, key=None):
                calls.append(path)
                return iter([pr(number=1)]) if '/pulls?' in path else iter([])
        result = collect(Client(), 'A158Coke/WotbTools', {'1': ['docs']}, NOW)
        self.assertEqual(sample(result, 'pr_area_total', area='docs'), 1)
        self.assertEqual(sum('/files?' in path for path in calls), 0)

    def test_saturated_run_window_splits_without_duplicate_boundary(self):
        calls = []
        class Client:
            def pages(self, path, key=None):
                if '/actions/runs?' in path:
                    calls.append(path)
                    if len(calls) == 1:
                        return iter([{'id': n, 'status': 'completed', 'path': 'unknown', 'created_at': '2026-10-16T00:00:00Z'} for n in range(1000)])
                return iter([])
        collect(Client(), 'A158Coke/WotbTools', {}, NOW)
        self.assertEqual(len(calls), 3)
        self.assertNotEqual(calls[1].split('..')[1], calls[2].split('created=')[1].split('..')[0])


class ClassificationTests(unittest.TestCase):
    def test_priority_and_multi_area(self):
        # Only a frozen historical override precedes changed-path evidence.
        self.assertEqual(classify_area(pr(), ['android/a'], {'1': ['infra']}), {'infra'})
        self.assertEqual(classify_area(pr(), ['deploy/observability/a']), {'infra', 'observability'})
        self.assertEqual(classify_area(pr(title='Replay parser and 3D playback')), {'replay', 'playback'})
        self.assertEqual(classify_area(pr()), {'unclassified'})

    def test_path_classification_cases(self):
        # A: frontend path -> frontend.
        self.assertEqual(classify_area(pr(), ['frontend/src/App.vue']), {'frontend'})
        # B: java/wotb-ai keeps the implementation layer and the product area.
        self.assertEqual(classify_area(pr(), ['java/wotb-ai/README.md']), {'backend', 'ai'})
        # C: Keycloak provider -> auth.
        self.assertEqual(classify_area(pr(), ['keycloak-wargaming-provider/pom.xml']), {'auth'})
        # Repository-owned workflow, governance and CI paths keep their area without a label.
        self.assertEqual(classify_area(pr(title='Bump checkout action'), ['.github/workflows/ci-gate.yml']), {'infra'})
        self.assertEqual(classify_area(pr(title='Adjust agent routing'), ['.agents/skills/executor/SKILL.md']), {'docs'})
        self.assertEqual(classify_area(pr(title='Tidy fixtures'), ['scripts/ci/test-workflow-contract.sh']), {'infra'})

    def test_semantic_fallback_only_without_path_evidence(self):
        # D: no path rule matches; the stable semantic fallback classifies.
        self.assertEqual(classify_area(pr(title='Fix replay parser regression'), ['scripts/tool.py']), {'replay'})
        # E: no path and no semantic evidence.
        self.assertEqual(classify_area(pr(title='Adjust wording'), ['scripts/tool.py']), {'unclassified'})

    def test_manual_area_label_never_overrides_changed_paths(self):
        # F: an old area/* label is not an input unless the PR is frozen explicitly.
        labeled = pr(labels=[{'name': 'area/auth'}], title='frontend layout fix')
        self.assertEqual(classify_area(labeled, ['frontend/src/App.vue']), {'frontend'})
        self.assertEqual(classify_area(labeled, ['frontend/src/App.vue'], {'1': ['auth']}), {'auth'})

    def test_historical_frozen_overrides_are_stable(self):
        data = json.loads((Path(__file__).resolve().parents[1] / 'historical-area-overrides.json').read_text(encoding='utf-8-sig'))
        self.assertTrue({'635', '673', '709'} <= set(data))
        # Pre-existing PRs keep their recorded area sets regardless of current labels/paths.
        self.assertEqual(classify_area(pr(number=635, labels=[{'name': 'area/frontend'}]), ['frontend/changed.vue'], data),
                         {'docs', 'infra', 'observability'})
        self.assertEqual(classify_area(pr(number=673), ['.github/workflows/ci-gate.yml'], data),
                         {'android', 'docs', 'frontend', 'playback', 'replay'})
        self.assertEqual(classify_area(pr(number=709), ['frontend/src/App.vue'], data), {'docs'})

    def test_feature_paths_preserve_cross_cutting_areas(self):
        self.assertEqual(classify_area(pr(), ['frontend/src/replay-local/playback/index.ts']),
                         {'frontend', 'replay', 'playback'})
        self.assertEqual(classify_area(pr(), ['java/wotb-ai/README.md']), {'backend', 'ai'})

    def test_actor(self):
        for user, expected in [(None, 'human'), ({'type': 'User', 'login': 'unknown'}, 'human'),
            ({'type': 'Bot', 'login': 'dependabot[bot]'}, 'automation'),
            ({'type': 'Bot', 'login': 'chatgpt-codex-connector[bot]'}, 'agent')]:
            self.assertEqual(actor_type(user), expected)
        self.assertEqual(actor_type({'type': 'User', 'login': 'claude[bot]'}), 'human')


class Response(io.BytesIO):
    def __init__(self, data, headers=None):
        super().__init__(json.dumps(data).encode())
        self.headers = headers or {}


class GitHubTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.token = Path(self.directory.name, 'token')
        self.token.write_text('PRIVATE_SENTINEL')
        self.addCleanup(self.directory.cleanup)

    def test_pagination_and_rate(self):
        replies = iter([Response([{'a': 1}], {'Link': '<https://api.github.com/next>; rel="next"', 'X-RateLimit-Remaining': '4000', 'X-RateLimit-Reset': '123'}), Response([{'a': 2}])])
        client = GitHubClient(self.token, opener=lambda *a, **k: next(replies))
        self.assertEqual(list(client.pages('/first')), [{'a': 1}, {'a': 2}])
        self.assertEqual(client.remaining, 4000)
        self.assertEqual(client.reset, 123)

    def test_transient_retry_and_permanent_failure(self):
        for status, attempts in [(429, 3), (500, 3), (401, 1), (403, 1)]:
            calls = []
            def fail(*args, **kwargs):
                calls.append(1)
                raise urllib.error.HTTPError('https://api.github.com', status, 'PRIVATE_SENTINEL', {}, None)
            client = GitHubClient(self.token, opener=fail, sleep=lambda _: None)
            with self.assertRaises(GitHubError) as error:
                client.get('/first')
            self.assertNotIn('PRIVATE_SENTINEL', str(error.exception))
            self.assertEqual(len(calls), attempts)
        client = GitHubClient(self.token, opener=lambda *a, **k: (_ for _ in ()).throw(TimeoutError()), sleep=lambda _: None)
        with self.assertRaises(GitHubError):
            client.get('/first')
        self.assertEqual(client.errors, 3)

    def test_origin_and_rate_reserve(self):
        client = GitHubClient(self.token, opener=lambda *a, **k: self.fail('must not request'))
        with self.assertRaises(GitHubError):
            client.get('https://evil.example/steal')
        client.remaining, client.reset = 0, 9999999999
        with self.assertRaises(GitHubError):
            client.get('/first')


class SnapshotTests(unittest.TestCase):
    def test_later_success_replaces_the_entire_snapshot(self):
        client = type('Client', (), {'errors': 0, 'remaining': 100, 'reset': 0})()
        state = Snapshot(lambda: aggregate([pr()], now=NOW), client)
        with patch('exporter.time.time', return_value=1000):
            state.update()
        previous = state.samples
        state.refresh = lambda: aggregate([pr(), pr(2)], now=NOW)
        with patch('exporter.time.time', return_value=2000):
            state.update()
        self.assertIsNot(state.samples, previous)
        self.assertEqual(sample(state.samples, 'pull_requests_total'), 2)
        self.assertEqual(state.last_success, 2000)
        self.assertEqual(state.errors, 0)

    def test_success_failure_and_http_privacy(self):
        client = type('Client', (), {'errors': 0, 'remaining': 100, 'reset': 0})()
        state = Snapshot(lambda: aggregate([pr(body='PRIVATE_SENTINEL user@example.com')], now=NOW), client)
        state.update()
        previous, success = state.samples, state.last_success
        state.refresh = lambda: (_ for _ in ()).throw(RuntimeError('PRIVATE_SENTINEL'))
        state.update()
        self.assertIs(state.samples, previous)
        self.assertEqual(state.last_success, success)
        self.assertEqual(state.errors, 1)
        registry = CollectorRegistry()
        registry.register(state)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(registry))
        worker = threading.Thread(target=server.serve_forever)
        worker.start()
        try:
            base = 'http://127.0.0.1:' + str(server.server_port)
            self.assertEqual(urllib.request.urlopen(base + '/health').read(), b'ok\n')
            body = urllib.request.urlopen(base + '/metrics').read().decode()
            self.assertTrue(list(text_string_to_metric_families(body)))
            self.assertIn('# TYPE wotb_dev_collector_refresh_errors_total counter', body)
            self.assertIn('# TYPE wotb_dev_pull_requests_total gauge', body)
            for forbidden in ('PRIVATE_SENTINEL', 'user@example.com', 'GITHUB_TOKEN', 'pr_number=', 'author='):
                self.assertNotIn(forbidden, body)
            self.assertEqual(state.errors, 1)  # HTTP did not call failing refresh.
        finally:
            server.shutdown()
            worker.join()
            server.server_close()

    def test_initial_failure_retains_empty_state(self):
        client = type('Client', (), {'errors': 0, 'remaining': -1, 'reset': 0})()
        state = Snapshot(lambda: (_ for _ in ()).throw(TimeoutError()), client)
        state.update()
        self.assertEqual((state.ready, state.last_success, state.samples), (0, 0, ()))


if __name__ == '__main__':
    unittest.main()
