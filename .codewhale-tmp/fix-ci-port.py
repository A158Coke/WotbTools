# Fix ci.yml port check: per-service no-host-ports assertion (lines 105-114)
path = '.github/workflows/ci.yml'
with open(path, 'r', encoding='utf-8', newline='') as f:
    text = f.read()
lines = text.split('\r\n')

# find the run block: locate 'docker compose config --format json' line
anchor = None
for i, l in enumerate(lines):
    if 'docker compose config --format json' in l:
        anchor = i
        break
assert anchor is not None, 'anchor not found'

# python block starts at anchor+1, content until the 'PY' terminator
new_block = [
    '          python - <<\'PY\'',
    '          import json',
    '          with open(\'/tmp/compose.json\', encoding=\'utf-8\') as f:',
    '              svc = json.load(f)["services"]',
    '          # Observability services and backend management port: NO host ports mapping allowed.',
    '          # Assert ports list is empty entirely (catches "18088:8088" target bypass too).',
    '          # frontend 8088:80 is a legitimate external entry, not in this list.',
    '          no_host_ports = {"prometheus", "loki", "alloy", "grafana", "wotb-backend"}',
    '          for name, s in svc.items():',
    '              if name in no_host_ports:',
    '                  assert not s.get("ports"), (',
    '                      "service " + name + " must not expose any host port: " + str(s.get("ports")))',
    '          print("no host exposure of observability/backend-management ports")',
    '          PY',
]

# find the end of the current python block: the 'PY' line
end = None
for i in range(anchor + 1, len(lines)):
    if lines[i].strip() == 'PY':
        end = i
        break
assert end is not None, 'PY terminator not found'

# replace anchor+1 .. end with new block
lines[anchor + 1:end + 1] = new_block

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write('\r\n'.join(lines))

with open(path, 'r', encoding='utf-8') as f:
    check = f.read()
print('no_host_ports:', check.count('no_host_ports'))
print('old forbidden refs:', check.count('forbidden = {9090'))
print('PY blocks:', check.count("<<'PY'"))
