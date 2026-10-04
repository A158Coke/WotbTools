# Komodo K7C — Frontend public cutover preflight

K7C moves the public `wotbtools.com` frontend ingress from the TX1 frontend to the Komodo-owned TX2 frontend that passed K7B shadow acceptance.

This document covers the **preflight gate only**. It does not authorize or perform the Caddy cutover.

## Accepted K7B state

K7B is complete when all of the following are evidenced:

- `wotbtools-frontend-shadow` is Running on Komodo Server `tx2`.
- TX2 binds only `10.20.0.3:8081 -> 80`.
- nginx is stable with `restart_count=0`.
- TX1 reaches `http://10.20.0.3:8081/` over WireGuard.
- TX2 `/api/health` reaches the authoritative TX1 Business API.
- the Gitee transport commit used by Komodo matches the reviewed GitHub source commit.
- Caddy remains on TX1 and public ingress has not moved.

Record the accepted marker:

`TX2_FRONTEND_SHADOW_READY=PASS`

## Why K7C needs a separate gate

The frontend image is not the whole production surface. TX1 currently injects host-owned runtime content into the frontend container:

- `/opt/wotb-tx/config/sponsor-config.json`
- `/opt/wotb-tx/config/sponsor/**`
- `/opt/wotb-tx/android-release/**`

K7B deliberately omitted those mounts. Therefore a healthy shadow frontend is necessary but not sufficient for public cutover.

K7C must first prove that TX1 and TX2 serve the exact same immutable frontend build, then prove that every authoritative TX1 runtime file required by the public site is served byte-for-byte by TX2.

## Read-only preflight

Run on TX1:

```bash
sudo bash /opt/wotb-tx/deploy/k7c-preflight.sh
```

Defaults:

```text
TX_RUNTIME_ROOT=/opt/wotb-tx
TX1_FRONTEND=http://10.20.0.1:8081
TX2_FRONTEND=http://10.20.0.3:8081
```

The preflight is intentionally read-only. It may use `curl`, `docker ps`, and `docker inspect`; it must never copy content, restart/reconcile containers, or change Caddy.

It requires:

1. TX1 and TX2 frontend roots return HTTP 200.
2. TX2 SPA fallback returns HTTP 200.
3. TX2 `/api/health` returns HTTP 200 through the TX1 Business API.
4. TX1 and TX2 `/` and `/version.json` are byte-identical.
5. authoritative TX1 `sponsor-config.json` is byte-identical on TX2, or absent on both.
6. every authoritative file under `config/sponsor` is byte-identical under `/sponsor-assets/` on TX2.
7. authoritative Android `version.json` is byte-identical on TX2, or absent on both.
8. every authoritative file under `android-release` is byte-identical under `/download/android/` on TX2.
9. the running TX1 Caddy still targets `wotb-frontend:80` or `10.20.0.1:8081`; targeting TX2 before the gate passes is an error.

The success marker is:

```text
K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS
```

## Expected first result

Immediately after K7B, the preflight is expected to fail on sponsor and/or Android parity because the shadow intentionally has no runtime-content mounts.

That failure is useful evidence: it identifies the exact production surface that still needs an explicit replication/ownership design. Do not weaken the gate or treat HTTP 404 as acceptable when TX1 has a corresponding authoritative file.

Runtime-content replication is a separate reviewed change. Do not introduce ad-hoc SSH/SCP/rsync commands into the preflight itself.

## Cutover contract after preflight passes

The existing TX Caddy contract already exposes the frontend as a logical endpoint:

```text
CADDY_FRONTEND_UPSTREAM
```

The reviewed WireGuard endpoints are:

```text
TX1 rollback: 10.20.0.1:8081
TX2 cutover:  10.20.0.3:8081
```

The Caddyfile must continue to use `{$CADDY_FRONTEND_UPSTREAM}`; no literal TX1/TX2 frontend address belongs in the Caddyfile.

The actual K7C cutover PR/procedure must be reviewed separately and must include:

- exact active-endpoint evidence before mutation;
- a single Caddy-only reconciliation to `10.20.0.3:8081`;
- public HTTP/HTTPS and application smoke tests;
- explicit rollback to `10.20.0.1:8081`;
- no movement of Business API, Keycloak, PostgreSQL, or AI ownership.

K7C public cutover is not authorized until the preflight emits `K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS`.
