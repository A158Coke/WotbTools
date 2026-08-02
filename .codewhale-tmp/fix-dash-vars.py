# #4 Dashboard variables:
# - ${requestId:.*} -> ${requestId:raw} (textbox default remains ".*")
# - remove unused "operation" variable from wotbtools-replay-parser.json
import json, re

for path in [
    'deploy/observability/grafana/dashboards/wotbtools-backend-overview.json',
    'deploy/observability/grafana/dashboards/wotbtools-replay-parser.json',
]:
    with open(path, 'r', encoding='utf-8') as f:
        d = json.load(f)

    # 1) requestId:.* -> requestId:raw in all target exprs
    for p in d.get('panels', []):
        for t in p.get('targets', []):
            if 'requestId:.*' in t.get('expr', ''):
                t['expr'] = t['expr'].replace('${requestId:.*}', '${requestId:raw}')

    # 2) requestId textbox: keep default ".*" (current value/options)
    for var in d.get('templating', {}).get('list', []):
        if var.get('name') == 'requestId':
            var['current'] = {'selected': True, 'text': '.*', 'value': '.*'}
            var['options'] = [{'selected': True, 'text': '.*', 'value': '.*'}]

    # 3) remove unused "operation" variable (only in replay-parser; overview has none)
    d['templating']['list'] = [v for v in d['templating']['list'] if v.get('name') != 'operation']

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

    # validate
    with open(path, 'r', encoding='utf-8') as f:
        check = json.load(f)
    exprs = [t.get('expr', '') for p in check['panels'] for t in p.get('targets', [])]
    raw_used = any('${requestId:raw}' in e for e in exprs)
    dotstar_left = any('requestId:.*' in e for e in exprs)
    vars_ = [v.get('name') for v in check['templating']['list']]
    print(path)
    print('  requestId:raw used:', raw_used, '| requestId:.* remaining:', dotstar_left)
    print('  variables:', vars_)
