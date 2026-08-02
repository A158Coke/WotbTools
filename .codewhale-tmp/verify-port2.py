# Verify per-service no-host-ports check logic against real compose output + bypass case
import json

# real compose output
with open('C:/Users/yu.chen/Desktop/MyPersonalProject/WotbTools/.codewhale-tmp/compose.json', encoding='utf-8-sig') as f:
    svc = json.load(f)["services"]

no_host_ports = {"prometheus", "loki", "alloy", "grafana", "wotb-backend"}
for name, s in svc.items():
    if name in no_host_ports:
        assert not s.get("ports"), (
            "service " + name + " must not expose any host port: " + str(s.get("ports")))
print("PASS: real compose - no host ports on observability/backend services")

# bypass case: 18088:8088 on wotb-backend should FAIL (target hits 8088)
fake = dict(svc)
fake["wotb-backend"] = dict(svc["wotb-backend"], ports=[{"published": "18088", "target": "8088"}])
try:
    for name, s in fake.items():
        if name in no_host_ports:
            assert not s.get("ports"), (
                "service " + name + " must not expose any host port: " + str(s.get("ports")))
    print("FAIL: bypass 18088:8088 was not caught")
except AssertionError as e:
    print("PASS: bypass 18088:8088 correctly rejected ->", e)

# frontend 8088:80 must remain legal
print("frontend ports:", svc["wotb-frontend"].get("ports"))
print("all services:", sorted(svc.keys()))
