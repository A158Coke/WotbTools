# Komodo K7B — TX2 Frontend shadow

K7B is the first real WotBTools production workload whose lifecycle is represented by Komodo.
It creates a **shadow** Frontend on TX2 and deliberately does not move public traffic.

## Frozen preconditions

- K7A is production accepted (`TX2_PRODUCTION_WORKER_READY`).
- TX2 is Komodo Server `tx2`, reached through outbound Periphery.
- TX2 WireGuard address is `10.20.0.3`.
- TX1 remains authoritative for public ingress and Business API.
- Yecao remains authoritative for AI service.
- K6B final placement matrix is unchanged.

## Declarative ownership

ResourceSync `wotbtools-main` may declare exactly one K7B Stack: `wotbtools-frontend-shadow` on `tx2`, sourced from the public Gitee transport mirror `A158Coke/Wotbtools` main with run directory `deploy/tx` and compose file `frontend-shadow.compose.yml`.
GitHub `A158Coke/WotbTools` remains the source/release authority; Gitee is only the domestic source transport for TX workers. Before a production deployment uses the mirror, the intended Gitee commit must match the reviewed GitHub commit.
`deploy = false`; Stack webhook, image polling, and auto-update are disabled. ResourceSync remains `managed=false`, `delete=false`, `webhook_enabled=false`. Applying ResourceSync changes desired state only; workload deployment is a separate explicit Komodo action.

## Shadow runtime contract

The shadow binds only `10.20.0.3:8081 -> 80`. Frontend routes Business API to `http://10.20.0.1:8087` and AI to `http://10.20.0.2:8089`. TX1 Caddy remains `10.20.0.1:8081` throughout K7B.
The initial shadow pins immutable build identity `ccr.ccs.tencentyun.com/wotbtools/wotbtools-frontend:sha-473495ec07e7`, produced by the last successful TX1 Frontend deployment before K7B.

## Runtime content boundary

TX1 currently mounts sponsor configuration/assets and Android release files from `/opt/wotb-tx`. They are optional content surfaces, not part of the Frontend application container. K7B intentionally does **not** copy or mount those TX1 host paths on TX2.
Sponsor runtime content and Android release artifact parity are mandatory preconditions for K7C public cutover.

## Manual apply and deployment

1. Refresh `wotbtools-main`.
2. The pending diff must contain exactly the reviewed `wotbtools-frontend-shadow` Stack change and no Server drift or deletion.
3. Manually Apply the ResourceSync.
4. Refresh and require zero unexpected pending diff.
5. Verify the Gitee mirror commit matches the intended reviewed GitHub commit.
6. Open the Stack and explicitly Deploy it. ResourceSync Apply itself must not deploy.
7. Perform the acceptance probes below.

Stop if the diff proposes another Stack, a different server, any deletion, an automatic deploy setting, or a Caddy / TX1 workload change.

## K7B acceptance

- Stack state is Running on `tx2`.
- exactly the reviewed frontend image is running.
- TX2 listens on `10.20.0.3:8081`, not wildcard/public interfaces.
- `http://10.20.0.3:8081/` returns the SPA.
- `/version.json` and a hashed static asset are served.
- an unknown SPA route falls back to `index.html`.
- `/api/health` succeeds through Frontend -> TX1 Business API.
- TX1 Caddy remains configured to `10.20.0.1:8081`.
- no second production service is created on TX2.
- sponsor/APK absence is recorded as expected shadow-only behavior, not hidden as production parity.

When these checks are evidenced, record `TX2_FRONTEND_SHADOW_READY`.
K7B does not authorize K7C. Public traffic stays on TX1 until runtime-content parity and the separate Caddy placement cutover are reviewed.
