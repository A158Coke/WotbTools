"""Aggregate GitHub objects into an immutable tuple of bounded metric samples."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from classification import AREAS, actor_type, classify_area

START = datetime(2026, 6, 22, tzinfo=timezone.utc)
CONCLUSIONS = ('success', 'failure', 'cancelled', 'skipped', 'other')


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def quantile(values, q):
    values = sorted(values)
    position = (len(values) - 1) * q
    lower = int(position)
    return values[lower] + (values[min(lower + 1, len(values) - 1)] - values[lower]) * (position - lower)


def aggregate(prs, runs=(), gates=(), releases=(), now=None, overrides=None):
    now = now or datetime.now(timezone.utc)
    samples = []
    def add(name, value, **labels):
        samples.append(('wotb_dev_' + name, tuple(sorted(labels.items())), float(value)))
    prs = [pr for pr in prs if START <= timestamp(pr['created_at']) <= now]
    add('pull_requests_total', len(prs))
    states, actors, areas = Counter(), Counter(), Counter()
    created, merged, lead, ages = [], [], [], []
    for pr in prs:
        born, merge = timestamp(pr['created_at']), timestamp(pr.get('merged_at'))
        state = 'merged' if merge else ('open' if pr['state'] == 'open' else 'closed_unmerged')
        states[state] += 1
        actors[actor_type(pr.get('user'))] += 1
        areas.update(pr.get('_areas') or classify_area(pr, pr.get('_paths', ()), overrides))
        created.append(born)
        if merge:
            merged.append(merge)
            lead.append(max(0, (merge - born).total_seconds()))
        elif state == 'open':
            ages.append(max(0, (now - born).total_seconds()))
    for state in ('open', 'merged', 'closed_unmerged'):
        add('pull_requests', states[state], state=state)
    for actor in ('human', 'agent', 'automation'):
        add('pr_actor_total', actors[actor], actor_type=actor)
    for area in (*AREAS, 'unclassified'):
        add('pr_area_total', areas[area], area=area)
    add('open_pr_count', states['open'])
    add('draft_pr_count', sum(bool(pr.get('draft')) for pr in prs if pr['state'] == 'open' and not pr.get('merged_at')))
    add('open_pr_oldest_age_seconds', max(ages, default=0))
    for q in (.50, .90, .95):
        if lead:
            add('pr_merge_lead_time_seconds', quantile(lead, q), quantile=f'{q:.2f}')
    months = []
    cursor = START.replace(day=1)
    while cursor <= now:
        months.append(cursor.strftime('%Y-%m'))
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    for event, dates in (('created', created), ('merged', merged)):
        counts = Counter(date.strftime('%Y-%m') for date in dates)
        days = Counter(date.date().isoformat() for date in dates)
        for month in months:
            add(f'pr_{event}_month', counts[month], month=month)
        for age in range(90):
            day = (now.date() - timedelta(days=age)).isoformat()
            add(f'pr_{event}_day', days[day], day=day)
        for window in (7, 30):
            add(f'pr_{event}_window', sum(now - timedelta(days=window) <= date <= now for date in dates), window=f'{window}d')
    workflow_counts, durations = Counter(), defaultdict(list)
    workflow_windows = Counter()
    for run in runs:
        if run.get('status') != 'completed':
            continue
        workflow = run['_workflow']
        conclusion = run.get('conclusion') if run.get('conclusion') in CONCLUSIONS else 'other'
        workflow_counts[workflow, conclusion] += 1
        begin, end = timestamp(run.get('run_started_at')), timestamp(run.get('updated_at'))
        if begin and end:
            durations[workflow].append(max(0, (end - begin).total_seconds()))
        date = timestamp(run['created_at'])
        for window in (7, 30):
            if now - timedelta(days=window) <= date <= now:
                workflow_windows[workflow, conclusion, window] += 1
    for workflow in sorted({run['_workflow'] for run in runs}):
        for conclusion in CONCLUSIONS:
            add('workflow_runs_total', workflow_counts[workflow, conclusion], workflow=workflow, conclusion=conclusion)
            for window in (7, 30):
                add('workflow_runs_window', workflow_windows[workflow, conclusion, window], workflow=workflow, conclusion=conclusion, window=f'{window}d')
        for q in (.50, .90):
            if durations[workflow]:
                add('workflow_duration_seconds', quantile(durations[workflow], q), workflow=workflow, quantile=f'{q:.2f}')
    gate_counts = Counter(gate.get('conclusion') if gate.get('conclusion') in CONCLUSIONS else 'other' for gate in gates)
    for conclusion in CONCLUSIONS:
        add('required_gate_runs_total', gate_counts[conclusion], conclusion=conclusion)
    gate_duration = [(timestamp(gate['completed_at']) - timestamp(gate['started_at'])).total_seconds()
                     for gate in gates if gate.get('started_at') and gate.get('completed_at')]
    for q in (.50, .90):
        if gate_duration:
            add('required_gate_duration_seconds', quantile(gate_duration, q), quantile=f'{q:.2f}')
    for window in (7, 30):
        add('required_gate_failures_window', sum(gate.get('conclusion') == 'failure' and
            now - timedelta(days=window) <= timestamp(gate['completed_at']) <= now
            for gate in gates if gate.get('completed_at')), window=f'{window}d')
    published = [timestamp(release['published_at']) for release in releases
                 if not release.get('draft') and not release.get('prerelease') and release.get('published_at')]
    add('releases_total', len(published))
    for window in (7, 30):
        add('release_window', sum(now - timedelta(days=window) <= date <= now for date in published), window=f'{window}d')
    return tuple(samples)


def collect(client, repository, overrides, now=None, cache=None):
    now = now or datetime.now(timezone.utc)
    cache = cache if cache is not None else {}
    area_cache = cache.setdefault('areas', {})
    gate_cache = cache.setdefault('gates', {})
    base = '/repos/' + repository
    prs = list(client.pages(base + '/pulls?state=all&per_page=100'))
    for pr in prs:
        number = str(pr['number'])
        if number in overrides:
            continue
        # Cache only the classification contribution, never paths/body/user data.
        key = (number, pr.get('updated_at'))
        if key not in area_cache:
            paths = [item['filename'] for item in client.pages(base + f"/pulls/{pr['number']}/files?per_page=100")]
            if len(paths) >= 3000:
                from github_client import GitHubError
                raise GitHubError('PR file history exceeds API limit; add area override')
            area_cache[key] = classify_area(pr, paths)
        pr['_areas'] = area_cache[key]
    active_prs = {(str(pr['number']), pr.get('updated_at')) for pr in prs}
    cache['areas'] = {key: areas for key, areas in area_cache.items() if key in active_prs}
    # GitHub caps filtered Actions searches at 1000. Split saturated windows
    # until each page range is complete; never silently truncate history.
    from github_client import GitHubError
    def run_window(begin, end):
        query = f"{base}/actions/runs?per_page=100&created={begin.strftime('%Y-%m-%dT%H:%M:%SZ')}..{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        fields = ('id', 'run_attempt', 'path', 'status', 'conclusion', 'created_at', 'run_started_at', 'updated_at')
        items = [{key: run.get(key) for key in fields}
                 for run in client.pages(query, 'workflow_runs')]
        if len(items) < 1000:
            return items
        seconds = int((end - begin).total_seconds())
        if seconds < 1:
            raise GitHubError('Actions timestamp exceeds API history limit')
        middle = begin + timedelta(seconds=seconds // 2)
        return run_window(begin, middle) + run_window(middle + timedelta(seconds=1), end)
    runs = run_window(START, now.replace(microsecond=0))
    gates = []
    for run in runs:
        path = (run.get('path') or '').split('@')[0]
        run['_workflow'] = path.rsplit('/', 1)[-1] if path in WORKFLOW_PATHS else 'other'
        if path == '.github/workflows/ci-gate.yml' and run.get('status') == 'completed':
            key = (run['id'], run.get('run_attempt', 1))
            if key not in gate_cache:
                gate_cache[key] = tuple((job.get('conclusion'), job.get('started_at'), job.get('completed_at'))
                    for job in client.pages(base + f"/actions/runs/{run['id']}/jobs?per_page=100", 'jobs')
                    if job.get('name') == 'CI / Required Gate' and job.get('status') == 'completed')
            gates.extend({'conclusion': conclusion, 'started_at': begin, 'completed_at': end}
                         for conclusion, begin, end in gate_cache[key])
    active_runs = {(run['id'], run.get('run_attempt', 1)) for run in runs}
    cache['gates'] = {key: value for key, value in gate_cache.items() if key in active_runs}
    releases = list(client.pages(base + '/releases?per_page=100'))
    return aggregate(prs, runs, gates, releases, now, overrides)


# Committed workflow path allowlist bounds labels; unknown/deleted workflows share 'other'.
WORKFLOW_PATHS = frozenset({
    '.github/workflows/ai-service.yml',
    '.github/workflows/alloy-tx.yml',
    '.github/workflows/android-release.yml',
    '.github/workflows/business-api.yml',
    '.github/workflows/business-postgres.yml',
    '.github/workflows/caddy.yml',
    '.github/workflows/ci-ai-service.yml',
    '.github/workflows/ci-alloy-tx.yml',
    '.github/workflows/ci-android.yml',
    '.github/workflows/ci-business-api.yml',
    '.github/workflows/ci-business-postgres.yml',
    '.github/workflows/ci-caddy.yml',
    '.github/workflows/ci-deployment.yml',
    '.github/workflows/ci-frontend.yml',
    '.github/workflows/ci-gate.yml',
    '.github/workflows/ci-keycloak-postgres.yml',
    '.github/workflows/ci-keycloak.yml',
    '.github/workflows/ci-komodo-controller.yml',
    '.github/workflows/ci-komodo-periphery.yml',
    '.github/workflows/ci-observability.yml',
    '.github/workflows/ci-production-worker.yml',
    '.github/workflows/ci-python.yml',
    '.github/workflows/cleanup-images.yml',
    '.github/workflows/database-backup.yml',
    '.github/workflows/frontend-replica.yml',
    '.github/workflows/frontend.yml',
    '.github/workflows/keycloak-postgres.yml',
    '.github/workflows/keycloak.yml',
    '.github/workflows/komodo-controller.yml',
    '.github/workflows/komodo-periphery.yml',
    '.github/workflows/observability.yml',
    '.github/workflows/prod-diagnostics.yml',
    '.github/workflows/production-worker.yml',
    '.github/workflows/tx-runtime-check.yml',
    '.github/workflows/update-crew-skills.yml',
    '.github/workflows/update-equipment.yml',
    '.github/workflows/update-tankopedia.yml',
})
