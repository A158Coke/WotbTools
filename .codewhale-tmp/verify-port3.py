# Reproduce CI port-check logic locally with real compose output
import json, subprocess, os

os.chdir('docker/online')
env = dict(os.environ, GRAFANA_ADMIN_USER='admin', GRAFANA_ADMIN_PASSWORD='test-pass-123')
out = subprocess.run(['docker', 'compose', 'config', '--format', 'json'],
                     capture_output=True, text=True, env=env, check=True)
svc = json.loads(out.stdout)["services"]

no_host_ports = {"prometheus", "loki", "alloy", "grafana", "wotb-backend"}
ok = True
for name, s in svc.items():
    if name in no_host_ports:
        if s.get("ports"):
            print(f"FAIL: {name} exposes host ports: {s['ports']}")
            ok = False
print("real compose check:", "PASS" if ok else "FAIL")

# bypass case: 18088:8088 on wotb-backend must be rejected
fake = dict(svc)
fake["wotb-backend"] = dict(svc["wotb-backend"], ports=[{"published": "18088", "target": "8088"}])
try:
    for name, s in fake.items():
        if name in no_host_ports:
            assert not s.get("ports"), f"{name} must not expose ports: {s.get('ports')}"
    print("bypass 18088:8088: FAIL (not caught)")
except AssertionError as e:
    print("bypass 18088:8088: PASS (caught ->", e, ")")

print("frontend ports:", svc["wotb-frontend"].get("ports"))
