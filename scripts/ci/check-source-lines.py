"""Strict full-tree source LOC gate for first-party code in a Git tree.

Every invocation judges the ENTIRE HEAD tree against the policy in
source-line-policy.json. There is no grandfathering: a blob that existed at
the base commit, a fork point, or any earlier commit is not exempt, and no
per-path allowlist mechanism exists anymore. Any over-limit maintained source
in the head tree fails. The gate fails closed: missing or invalid policy,
missing git history, or any scanner error aborts with exit 2 instead of
passing.
"""

import argparse
import collections
import fnmatch
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


EXTENSIONS = frozenset({
    '.alloy', '.bash', '.bat', '.c', '.cc', '.cmd', '.cpp', '.cs', '.css', '.cxx', '.ftl',
    '.go', '.gradle', '.graphql', '.groovy', '.h', '.hcl', '.hpp', '.hxx', '.html', '.java',
    '.js', '.jsx', '.kt', '.kts', '.mjs', '.cjs', '.proto', '.ps1', '.py', '.rs', '.scss',
    '.sh', '.sql', '.tf', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml',
})
POLICY_PATH = Path(__file__).with_name('source-line-policy.json')
EXCLUDED_CATEGORY_ROLES = ('generated', 'vendored', 'immutable-history')
TEST_DIRS = frozenset({'ci', 'test', 'tests', '__tests__', 'androidtest', 'testfixtures', 'testing'})
TEST_NAME = re.compile(r'(?:^test[-_]|(?:[._-](?:test|tests|spec|specs))\.|(?:Test|Tests|IT)\.(?:java|kt)$|_test\.go$)')
FLYWAY_DIR = re.compile(r'^java/[^/]+/src/main/resources/db/migration/[^/]+$')
FLYWAY_NAME = re.compile(r'^V[0-9]+(?:[._][0-9]+)*__[A-Za-z0-9_]+\.sql$')


def load_policy():
    """Load and validate the policy. Any problem fails closed (RuntimeError)."""
    try:
        raw = POLICY_PATH.read_text(encoding='utf-8')
    except OSError as error:
        raise RuntimeError(f'source-line policy is unreadable at {POLICY_PATH}: {error}')
    try:
        policy = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f'source-line policy at {POLICY_PATH} is not valid JSON: {error}')
    if not isinstance(policy, dict):
        raise RuntimeError('source-line policy must be a JSON object')
    limits_raw = policy.get('limits')
    if not isinstance(limits_raw, dict) or set(limits_raw) != {'production', 'test'}:
        raise RuntimeError('source-line policy limits must define exactly "production" and "test"')
    limits = {}
    for role, value in limits_raw.items():
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise RuntimeError(f'source-line policy limit {role!r} must be a positive integer, got {value!r}')
        limits[role] = value
    categories = policy.get('categories')
    if not isinstance(categories, dict):
        raise RuntimeError('source-line policy must define a "categories" object')
    for role in EXCLUDED_CATEGORY_ROLES:
        entry = categories.get(role)
        if entry is None:
            raise RuntimeError(f'source-line policy categories must define {role!r}')
        if not isinstance(entry, dict) or not isinstance(entry.get('patterns'), list) \
                or not all(isinstance(pattern, str) for pattern in entry['patterns']):
            raise RuntimeError(f'source-line policy category {role!r} must hold a list of string patterns')
    excluded = tuple(pattern for role in ('generated', 'vendored') for pattern in categories[role]['patterns'])
    return limits, excluded


def git(*args):
    result = subprocess.run(['git', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def is_excluded(path):
    return any(fnmatch.fnmatchcase(path, pattern) or (pattern.endswith('/') and path.startswith(pattern))
               for pattern in EXCLUDED)


def category(path):
    if is_excluded(path) or (FLYWAY_DIR.fullmatch(path) and FLYWAY_NAME.fullmatch(PurePosixPath(path).name)):
        return None
    parts = PurePosixPath(path).parts
    name = parts[-1]
    if PurePosixPath(name).suffix.lower() not in EXTENSIONS and name not in ('Dockerfile', 'Caddyfile'):
        return None
    if any(part.lower() in TEST_DIRS for part in parts[:-1]) or TEST_NAME.search(name):
        return 'test'
    if path.startswith('frontend/scripts/browser-'):
        return 'test'
    return 'production'


def tree(revision):
    commit = git('rev-parse', '--verify', f'{revision}^{{commit}}').decode().strip()
    records = git('ls-tree', '-r', '-z', '--full-tree', commit).split(b'\0')
    entries = {}
    for record in records:
        if not record:
            continue
        meta, raw_path = record.split(b'\t', 1)
        mode, kind, oid = meta.split()
        path = os.fsdecode(raw_path)
        role = category(path)
        if role and kind == b'blob':
            if mode not in (b'100644', b'100755'):
                raise RuntimeError(f'unsupported source file mode for {path!r}: {os.fsdecode(mode)}')
            entries[path] = (role, oid.decode())
    return commit, entries


def blob_lines(oids):
    unique = sorted(set(oids))
    if not unique:
        return {}
    proc = subprocess.Popen(['git', 'cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, errors = proc.communicate((''.join(f'{oid}\n' for oid in unique)).encode())
    if proc.returncode:
        raise RuntimeError(f'git cat-file failed: {errors.decode(errors="replace").strip()}')
    lines = {}
    cursor = 0
    for oid in unique:
        end = output.find(b'\n', cursor)
        if end < 0:
            raise RuntimeError(f'missing Git blob header for {oid}')
        header = output[cursor:end].split()
        if len(header) != 3 or header[0].decode() != oid or header[1] != b'blob':
            raise RuntimeError(f'invalid Git blob header for {oid}: {header!r}')
        size = int(header[2])
        start, stop = end + 1, end + 1 + size
        content = output[start:stop]
        if len(content) != size or output[stop:stop + 1] != b'\n':
            raise RuntimeError(f'truncated Git blob for {oid}')
        lines[oid] = content.count(b'\n') + bool(content and not content.endswith(b'\n'))
        cursor = stop + 1
    if cursor != len(output):
        raise RuntimeError('unexpected trailing Git batch output')
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='verified base commit SHA (identity evidence; the HEAD tree alone decides)')
    parser.add_argument('--head', required=True, help='verified head commit SHA (the tree that is strictly judged)')
    args = parser.parse_args()
    limits, excluded = load_policy()
    global LIMITS, EXCLUDED
    LIMITS, EXCLUDED = limits, excluded
    base_sha, _ = tree(args.base)
    head_sha, head = tree(args.head)
    counts = blob_lines([oid for _, oid in head.values()])
    metrics = {role: [0, 0, 0, 0, ''] for role in LIMITS}
    violations = []
    for path, (role, oid) in sorted(head.items()):
        size = counts[oid]
        metric = metrics[role]
        metric[0] += 1
        metric[1] += size
        if size > metric[3]:
            metric[3], metric[4] = size, path
        if size > LIMITS[role]:
            metric[2] += 1
            violations.append(f'{path}: {size} physical lines (limit {LIMITS[role]}, {role})')
    print(f'Source LOC: strict full-tree scan, base={base_sha} head={head_sha}')
    for role in LIMITS:
        files, total, over, largest, largest_path = metrics[role]
        print(f'{role}: files={files} lines={total} over={over} max={largest} '
              f'limit={LIMITS[role]} largest={largest_path!r}')
    if violations:
        print('\n'.join(violations), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f'Source LOC check failed: {error}', file=sys.stderr)
        sys.exit(2)
