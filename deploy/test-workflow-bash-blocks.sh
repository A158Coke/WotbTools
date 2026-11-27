#!/usr/bin/env bash
set -euo pipefail
for cmd in python3 bash; do command -v "$cmd" >/dev/null || { echo "missing command: $cmd" >&2; exit 1; }; done

failures=0
python3 - "${@:-.github/workflows}" <<'PY'
import pathlib, re, subprocess, sys

failures = 0
roots = [pathlib.Path(a) for a in sys.argv[1:]]
for root in roots:
    for wf in sorted(root.glob('*.yml')):
        lines = wf.read_text(encoding='utf-8').split('\n')
        blocks, i = [], 0
        while i < len(lines):
            m = re.match(r'^(\s*)run: \|$', lines[i])
            if not m:
                i += 1
                continue
            indent = len(m.group(1))
            body, j = [], i + 1
            while j < len(lines) and (lines[j].strip() == '' or len(lines[j]) - len(lines[j].lstrip()) > indent):
                body.append(lines[j][indent + 2:] if len(lines[j]) > indent + 2 else '')
                j += 1
            blocks.append('\n'.join(body))
            i = j
        for bi, block in enumerate(blocks):
            if not block.strip():
                continue
            placeholder = re.sub(r'\$\{\{.*?\}\}', '__GH_EXPR__', block, flags=re.S)
            proc = subprocess.run(['bash', '-n'], input=placeholder, text=True, capture_output=True)
            if proc.returncode != 0:
                failures += 1
                first = placeholder.split('\n')[0][:80]
                print(f'FAIL {wf} run-block #{bi} (first line: {first})', file=sys.stderr)
                print(proc.stderr, file=sys.stderr)
print(f'workflow bash blocks checked, failures={failures}')
sys.exit(1 if failures else 0)
PY
exit $failures
