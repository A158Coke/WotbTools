# Komodo K7C — Frontend public cutover preflight

K7C moves the public `wotbtools.com` frontend ingress from the TX1 frontend to the Komodo-owned TX2 frontend that passed K7B shadow acceptance.

This document covers runtime-content parity and the **preflight gate**. It still does not authorize or perform the Caddy cutover.

## Accepted K7B state

- `wotbtools-frontend-shadow` is Running on Komodo Server `tx2`.
- TX2 binds only `10.20.0.3:8081 -> 80`.
- TX1 reaches TX2 over WireGuard and TX2 `/api/health` reaches the authoritative TX1 Business API.
- Gitee transport commit matches the reviewed GitHub commit.
- TX1 and TX2 serve the exact same immutable frontend image before runtime-content parity is evaluated.
- Caddy remains on TX1.

Record `TX2_FRONTEND_SHADOW_READY=PASS`.

## Runtime-content ownership

The frontend image is not the whole production surface. TX1 injects host-owned sponsor and Android release content.

K7C replicates only the **current public production surface** to TX2 local storage at `/opt/wotb-tx2/runtime-content`:

- `sponsor-config.json`;
- sponsor assets actually referenced by that config;
- Android `version.json`;
- the APK actually referenced by that manifest.

Historical APKs and `*.staging.json` evidence are not public cutover dependencies and are deliberately not copied. The observed TX1 Android directory is about 112 MiB largely because it contains historical releases; K7C must not turn that archive into a placement dependency.

TX2 never bind-mounts `/opt/wotb-tx` and never reads the TX1 filesystem directly. It owns a local replicated runtime-content root.

## TX2 runtime-content sync

After the reviewed source commit is mirrored to Gitee, run on TX2 before redeploying the shadow stack:

```bash
cd /tmp
curl -fsSL \
  https://raw.githubusercontent.com/A158Coke/WotbTools/main/deploy/tx/k7c-sync-runtime-content.sh \
  -o k7c-sync-runtime-content.sh
chmod +x k7c-sync-runtime-content.sh
sudo bash ./k7c-sync-runtime-content.sh
```

The script reads the currently authoritative TX1 frontend over WireGuard (`http://10.20.0.1:8081`), discovers referenced sponsor assets and the current APK from the published manifests, stages them under a temporary directory, validates safe paths (and APK SHA when present), then atomically replaces `/opt/wotb-tx2/runtime-content`.

Success marker:

```text
K7C_RUNTIME_CONTENT_READY=PASS
```

After this marker, redeploy `wotbtools-frontend-shadow` so nginx receives the three read-only runtime mounts.

## Read-only preflight

Run on TX1:

```bash
sudo TX_RUNTIME_ROOT=/opt/wotb-tx bash /tmp/k7c-preflight.sh
```

The preflight remains intentionally read-only. It requires:

1. TX1/TX2 frontend roots return HTTP 200.
2. TX2 SPA fallback and `/api/health` return HTTP 200.
3. TX1/TX2 `/` and `/version.json` are byte-identical.
4. `sponsor-config.json` is byte-identical.
5. every sponsor asset referenced by the authoritative sponsor config is byte-identical.
6. Android `version.json` is byte-identical.
7. the APK referenced by authoritative Android `version.json` is byte-identical.
8. Caddy still targets TX1 (`wotb-frontend:80` or `10.20.0.1:8081`).

Success marker:

```text
K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS
```

Do not weaken the gate to accept 404 when TX1 publishes a corresponding current file.

## Cutover contract after preflight passes

The Caddyfile continues to use `{$CADDY_FRONTEND_UPSTREAM}`.

```text
TX1 rollback: 10.20.0.1:8081
TX2 cutover:  10.20.0.3:8081
```

The actual cutover remains a separate reviewed operation: one Caddy-only reconciliation to TX2, public smoke tests, and an explicit rollback path to TX1. Business API, Keycloak, PostgreSQL and AI placement do not move in K7C.

K7C public cutover is not authorized until the preflight emits `K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS`.
