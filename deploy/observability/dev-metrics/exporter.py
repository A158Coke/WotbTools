"""HTTP snapshot exporter. Scrapes never call GitHub."""
import json
import logging
import os
from pathlib import Path
import re
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from prometheus_client import CollectorRegistry, generate_latest
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily
from classification import AREAS
from collector import collect
from github_client import GitHubClient


def valid_override(value):
    """History entries are area lists; active fallbacks bind the exact head SHA."""
    areas = value.get('areas') if isinstance(value, dict) else value
    if not isinstance(areas, list) or not areas or not set(areas) <= set((*AREAS, 'unclassified')):
        return False
    return isinstance(value, list) or (
        isinstance(value.get('headRefOid'), str)
        and re.fullmatch(r'[0-9a-f]{40}', value['headRefOid']) is not None
    )


class Snapshot:
    def __init__(self, refresh, client):
        self.refresh, self.client = refresh, client
        self.samples = ()
        self.ready = 0
        self.last_success = 0
        self.duration = 0
        self.errors = 0
        self.lock = threading.Lock()

    def update(self):
        started = time.monotonic()
        try:
            samples = self.refresh()
            with self.lock:
                self.samples = samples
                self.ready = 1
                self.last_success = time.time()
        except Exception:
            # No exception text: upstream content, credentials and URLs cannot enter logs.
            with self.lock:
                self.errors += 1
            logging.warning('GitHub snapshot refresh failed; retaining previous data')
        finally:
            with self.lock:
                self.duration = time.monotonic() - started

    def collect(self):
        with self.lock:
            samples = self.samples + tuple(('wotb_dev_' + name, (), float(value)) for name, value in (
                ('collector_data_ready', self.ready), ('collector_last_success_timestamp', self.last_success),
                ('collector_refresh_duration_seconds', self.duration), ('collector_refresh_errors_total', self.errors),
                ('collector_github_api_errors_total', self.client.errors),
                ('github_rate_limit_remaining', self.client.remaining), ('github_rate_limit_reset_timestamp', self.client.reset)))
        families = {}
        for name, labels, value in samples:
            if name not in families:
                family_type = CounterMetricFamily if name in {
                    'wotb_dev_collector_refresh_errors_total',
                    'wotb_dev_collector_github_api_errors_total',
                } else GaugeMetricFamily
                families[name] = family_type(name, 'Snapshot ' + name, labels=[key for key, _ in labels])
            families[name].add_metric([value for _, value in labels], value)
        yield from families.values()


def handler(registry):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/health':
                body, status, content_type = b'ok\n', 200, 'text/plain'
            elif self.path == '/metrics':
                body, status, content_type = generate_latest(registry), 200, 'text/plain; version=0.0.4; charset=utf-8'
            else:
                body, status, content_type = b'not found\n', 404, 'text/plain'
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass
    return Handler


def main():
    repository = os.environ.get('GITHUB_REPOSITORY', 'A158Coke/WotbTools')
    if repository != 'A158Coke/WotbTools':
        raise ValueError('unsupported repository')
    overrides = json.loads(Path(__file__).with_name('historical-area-overrides.json').read_text(encoding='utf-8-sig'))
    if any(not valid_override(value) for value in overrides.values()):
        raise ValueError('invalid historical area overrides')
    client = GitHubClient(os.environ.get('DEV_METRICS_GITHUB_TOKEN_FILE', '/run/secrets/github-dev-metrics-token'))
    cache = {}  # Aggregate contributions only; rebuilt from GitHub after restart.
    state = Snapshot(lambda: collect(client, repository, overrides, cache=cache), client)
    registry = CollectorRegistry()
    registry.register(state)
    stop = threading.Event()
    def scheduler():
        while not stop.is_set():
            state.update()
            # Quota exhaustion cannot spin; retry only after reset and normal cadence.
            delay = max(900, client.reset - time.time() if 0 <= client.remaining < 20 else 0)
            stop.wait(delay)
    threading.Thread(target=scheduler, daemon=True).start()
    server = ThreadingHTTPServer(('0.0.0.0', 9108), handler(registry))
    def shutdown(*_args):
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    server.serve_forever()
    server.server_close()


if __name__ == '__main__':
    main()
