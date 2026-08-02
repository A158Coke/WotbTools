# Remove misleading panels from wotbtools-replay-parser.json:
# - 解析失败率 (uses wotb_replay_results_total{result="failure"})
# - 成功 / 失败 (按操作) (uses wotb_replay_results_total)
import json

path = 'deploy/observability/grafana/dashboards/wotbtools-replay-parser.json'
with open(path, 'r', encoding='utf-8') as f:
    d = json.load(f)

before = len(d['panels'])
removed = []
kept = []
for p in d['panels']:
    exprs = ' '.join(t.get('expr', '') for t in p.get('targets', []))
    title = p.get('title', '')
    if 'wotb_replay_results_total' in exprs:
        removed.append(title)
        continue
    kept.append(p)
d['panels'] = kept

# renumber ids sequentially to keep dashboard valid
for i, p in enumerate(d['panels']):
    p['id'] = i + 1

with open(path, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print('panels before:', before, 'after:', len(kept))
print('removed:', removed)
print('remaining titles:')
for p in kept:
    print(' -', p['title'])
