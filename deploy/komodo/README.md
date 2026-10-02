# Komodo controller ownership

Komodo is the WotBTools production orchestration control plane. It does not own its own lifecycle.

- GitHub Actions owns controller reconciliation and break-glass recovery.
- Docker Compose owns the Yecao Komodo Core + MongoDB runtime.
- OpenTofu owns the public DNSPod record for `komodo.wotbtools.com`.
- TX Caddy remains the independent public gateway owner and will be wired in a separate change.
- No Periphery agent is installed by this bootstrap. Workload ownership migration starts only after the controller is independently healthy.

The Core image is pinned by digest and MongoDB by exact patch tag. Core publishes only on Yecao WireGuard `10.20.0.2:9120`; there is no direct public listener.
