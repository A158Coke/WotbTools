#!/usr/bin/env python3
"""Check physical LOC of first-party source in two immutable Git trees."""

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
POLICY = json.loads(Path(__file__).with_name('source-line-policy.json').read_text(encoding='utf-8'))
LIMITS = POLICY['limits']
EXCLUDED = tuple(POLICY['explicit_exclusions'])
ALLOWLIST_FILE = 'scripts/ci/source-line-allowlist.txt'
LEGACY_GATE_MARKERS = (b'is_source_line_candidate()', b'Source-line policy compatibility marker')
TEST_DIRS = frozenset({'ci', 'test', 'tests', '__tests__', 'androidtest', 'testfixtures', 'testing'})
TEST_NAME = re.compile(r'(?:^test[-_]|(?:[._-](?:test|tests|spec|specs))\.|(?:Test|Tests|IT)\.(?:java|kt)$|_test\.go$)')


def git(*args, input_bytes=None):
    result = subprocess.run(['git', *args], input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def category(path):
    if any(fnmatch.fnmatchcase(path, item) or (item.endswith('/') and path.startswith(item))
           for item in EXCLUDED):
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


def parse_allowlist(content, source):
    entries = set()
    for line in content.decode('utf-8').splitlines():
        entry = line.strip()
        if not entry or entry.startswith('#'):
            continue
        if entry in entries:
            raise RuntimeError(f'duplicate source-line allowlist entry for {entry} in {source}')
        entries.add(entry)
    return entries


def allowlist_tree(revision):
    result = subprocess.run(['git', 'show', f'{revision}:{ALLOWLIST_FILE}'], capture_output=True)
    return parse_allowlist(result.stdout, f'{revision}:{ALLOWLIST_FILE}') if result.returncode == 0 else set()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, help='verified base commit SHA')
    parser.add_argument('--head', required=True, help='verified head commit SHA')
    parser.add_argument('--strict', action='store_true', help='reject all remaining over-limit files')
    args = parser.parse_args()
    # Validate both endpoints before reading any tree. Disconnected histories
    # are invalid evidence, but a base that merely is not an ancestor is valid.
    base_sha, base = tree(args.base)
    head_sha, head = tree(args.head)
    common = subprocess.run(['git', 'merge-base', base_sha, head_sha], capture_output=True, text=True)
    if common.returncode != 0 or not common.stdout.strip():
        raise RuntimeError(f'base {base_sha} and head {head_sha} have no merge-base')
    history_range = git('rev-list', '--reverse', f'{base_sha}..{head_sha}').decode().splitlines()
    fork_entries = {}
    if not args.strict:
        _, fork_entries = tree(common.stdout.strip())
    allowlist = set()
    try:
        allowlist = parse_allowlist(Path(ALLOWLIST_FILE).read_bytes(), ALLOWLIST_FILE)
    except FileNotFoundError:
        pass
    counts = blob_lines([oid for _, oid in (*base.values(), *head.values())])
    metrics = {name: collections.defaultdict(lambda: [0, 0, 0, 0, '']) for name in ('base', 'head')}
    violations = []
    for label, entries in (('base', base), ('head', head)):
        for path, (role, oid) in sorted(entries.items()):
            size = counts[oid]
            metric = metrics[label][role]
            metric[0] += 1
            metric[1] += size
            if size > metric[3]:
                metric[3], metric[4] = size, path
            if size > LIMITS[role]:
                metric[2] += 1
                grandfathered = (path in allowlist or base.get(path) == (role, oid) or
                                 fork_entries.get(path) == (role, oid))
                if label == 'head' and (args.strict or not grandfathered):
                    violations.append(f'{path}: {size} physical lines (limit {LIMITS[role]}, {role})')
    if not args.strict:
        base_allowlist_blob = subprocess.run(
            ['git', 'show', f'{base_sha}:{ALLOWLIST_FILE}'], capture_output=True
        )
        gate_blob = subprocess.run(
            ['git', 'show', f'{base_sha}:scripts/ci/check-repository-hygiene.sh'], capture_output=True
        )
        # Preserve the rollout ratchet: missing allowlist is zero only after the
        # source LOC gate itself was already present in the base tree.
        base_allowlist_present = base_allowlist_blob.returncode == 0
        base_allowlist = parse_allowlist(base_allowlist_blob.stdout, f'{base_sha}:{ALLOWLIST_FILE}') if base_allowlist_present else set()
        base_gate_present = gate_blob.returncode == 0 and any(marker in gate_blob.stdout for marker in LEGACY_GATE_MARKERS)
        if (base_allowlist_present or base_gate_present) and len(allowlist) > len(base_allowlist):
            violations.append(f'source-line allowlist must not grow (base={len(base_allowlist)}, head={len(allowlist)} entries)')

        # Every intermediate commit tree is checked so an over-limit blob cannot
        # be committed and then hidden by a later split/delete in the same PR.
        history_allowlist = set(allowlist) | base_allowlist
        seen = set()
        fork_cache = {}
        for commit in history_range:
            _, entries = tree(commit)
            counts.update(blob_lines(oid for _, oid in entries.values()))
            fork_result = subprocess.run(['git', 'merge-base', commit, base_sha], capture_output=True, text=True)
            fork = fork_result.stdout.strip() if fork_result.returncode == 0 else ''
            if fork not in fork_cache:
                fork_cache[fork] = (tree(fork)[1], allowlist_tree(fork)) if fork else ({}, set())
            fork_entries, fork_allowlist = fork_cache[fork]
            for path, (role, oid) in entries.items():
                key = (path, oid)
                if key in seen:
                    continue
                seen.add(key)
                size = counts[oid]
                base_entry = base.get(path)
                head_entry = head.get(path)
                repaired_preexisting = False
                if base_entry and head_entry and base_entry[0] == role and head_entry[0] == role:
                    repaired_preexisting = (
                        counts[base_entry[1]] > LIMITS[role]
                        and counts[head_entry[1]] <= LIMITS[role]
                    )
                grandfathered = (path in history_allowlist or base.get(path) == (role, oid)
                                 or fork_entries.get(path) == (role, oid) or path in fork_allowlist
                                 or repaired_preexisting)
                if size > LIMITS[role] and not grandfathered:
                    violations.append(f'{path}: {size} physical lines (limit {LIMITS[role]}, {role})')
    print(f'Source LOC: base={base_sha} head={head_sha} strict={args.strict}')
    for label in ('base', 'head'):
        for role in LIMITS:
            files, total, over, largest, largest_path = metrics[label][role]
            print(f'{label} {role}: files={files} lines={total} over={over} max={largest} '
                  f'limit={LIMITS[role]} largest={largest_path!r}')
    if violations:
        print('\n'.join(violations), file=sys.stderr)
        return 1
    stale = sorted(path for path in allowlist if path not in head or counts[head[path][1]] <= LIMITS[head[path][0]])
    if stale:
        print('stale source-line allowlist entries: ' + ', '.join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f'Source LOC check failed: {error}', file=sys.stderr)
        sys.exit(2)
