# Komodo K5 TX2 Runtime Acceptance

K5 is the first real workload-lifecycle acceptance for Komodo on TX2. It deliberately
uses a disposable Stack instead of adopting a production service: the goal is to prove
that the existing Core → Periphery → Docker path can create, observe, stop, destroy,
and clean up a workload before any Business API / Frontend / Keycloak / AI service
migration begins.

K5 was completed on **2026-10-03** against Komodo / Periphery **v2.3.3**.

## Scope and result

The accepted control path is:

```text
Komodo Core
    │
    ▼
TX2 Periphery v2.3.3
    │
    ▼
Docker Engine
    │
    ▼
Docker Compose v2
    │
    ▼
disposable Stack: k5-tx2-smoke
```

Acceptance result:

| Step | Result |
| --- | --- |
| Create Stack in Komodo | PASS |
| Save a UI-defined Compose file | PASS |
| Pull the image | PASS after the TX2 Docker Hub mirror prerequisite below was added |
| Deploy | PASS |
| Observe service state as `RUNNING` | PASS |
| Read container logs through Komodo | PASS |
| Stop Stack | PASS |
| Destroy Stack (`docker compose down`) | PASS |
| Delete the Komodo Stack definition | PASS |
| Verify no Compose project / container / network remains | PASS |

K5 does **not** migrate or adopt a production workload. It proves the runtime
orchestration lane only.

## TX2 prerequisites proven during K5

TX2 was intentionally close to a clean worker. Before K5, it had Docker Engine,
WireGuard and the repository-managed Periphery agent, but no Docker Compose plugin.

The runtime accepted during K5 was:

```text
Ubuntu 24.04 LTS
Docker Engine 29.1.3
Docker Compose 2.40.3
Komodo Periphery 2.3.3
```

### Docker Compose

Komodo v2.3.3 calls Docker Compose directly for Stack operations, including
`docker compose ls --all --format json`. TX2 initially had no `docker compose`
subcommand at all.

The host prerequisite installed during K5 was:

```sh
sudo apt-get install -y docker-compose-v2
```

The compatibility check then passed:

```sh
docker compose version
sudo docker compose ls --all --format json
```

with Compose `2.40.3` and an empty project list on the clean host.

### Periphery → Docker permission

The production `periphery.service` runs in the root systemd context:

```text
root:root /usr/local/bin/periphery --config-path /etc/komodo/periphery.config.toml
```

and Docker exposes:

```text
srw-rw---- root docker /var/run/docker.sock
```

so Periphery can operate Docker directly without adding the interactive `ubuntu`
account to the `docker` group or changing the systemd unit.

## TX2 Docker Hub reachability

The first K5 deploy failed during the Compose pull stage, not during Komodo,
Periphery, Compose config parsing, or container creation.

The failing boundary was:

```text
docker compose -p k5-tx2-smoke -f compose.yaml pull

failed to resolve reference "docker.io/library/alpine:3.20"
...
registry-1.docker.io:443: i/o timeout
```

Direct HTTPS checks to both `registry-1.docker.io` and `auth.docker.io` also
timed out from TX2. The DNS answers observed on the host were not suitable for a
working Docker Hub path.

Tencent Cloud's in-network Docker Hub mirror was reachable from TX2:

```text
mirror.ccs.tencentyun.com → 169.254.0.51
GET /v2/ → HTTP 200
```

TX2 therefore received the minimal Docker daemon configuration:

```json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ]
}
```

at:

```text
/etc/docker/daemon.json
```

After validating the file and restarting Docker, the daemon reported the mirror and:

```sh
sudo docker pull alpine:3.20
```

completed successfully.

The K5 Compose file continues to use the canonical image name `alpine:3.20`; the
mirror is a Docker daemon transport concern, not a Stack-level image rewrite.

## Registry credential boundary

K5 intentionally did **not** provision production registry credentials to Komodo or
to root on TX2.

Existing TX1 production registry credentials are scoped to the interactive deployment
account:

```text
/home/ubuntu/.docker/config.json
  auths:
    ccr.ccs.tencentyun.com
    ghcr.io
```

while `/root/.docker/config.json` is absent. TX2 had neither a root nor an
`ubuntu` Docker credential store during K5.

That distinction matters because Periphery runs as root. Copying TX1's user-scoped
credential file to root, or putting `TCR_USERNAME` / `TCR_PASSWORD` into the Stack,
would expand the secret boundary merely to make a smoke test pass. K5 therefore uses
the public `alpine:3.20` image through the Tencent mirror and leaves registry-secret
provisioning for a later, explicit workload-migration design.

## Disposable smoke Stack

The Stack was created manually in Komodo:

```text
name:   k5-tx2-smoke
server: tx2
mode:   UI Defined
```

Compose:

```yaml
services:
  smoke:
    image: alpine:3.20
    command: ["sh", "-c", "echo 'K5 TX2 smoke started'; sleep 3600"]
```

Deliberate properties:

- no published port;
- no persistent volume;
- no production network dependency;
- no secret;
- no registry credential;
- no restart policy;
- no application dependency;
- bounded lifetime if left unattended.

Komodo showed the service as:

```text
smoke   RUNNING   alpine:3.20   k5-tx2-smoke_default
```

and the Stack log proved that the actual container command executed:

```text
smoke-1 | K5 TX2 smoke started
```

## Lifecycle acceptance procedure

The production acceptance sequence was:

1. Create `k5-tx2-smoke` on Server `tx2`.
2. Select `UI Defined`.
3. Save the Compose file above.
4. Keep auto-update disabled and `Pre Pull Images` enabled.
5. Deploy.
6. Confirm Stack state `RUNNING`.
7. Confirm service `smoke` is `RUNNING`.
8. Confirm the expected log line.
9. Stop the Stack and confirm state `STOPPED`.
10. Destroy the Stack and confirm the operation completes.
11. Delete the Komodo Stack definition.

The first deploy attempt failed only at the image-pull network boundary. After the
host mirror prerequisite was added, the same Stack definition deployed successfully;
no Compose or Komodo resource change was needed.

## Cleanup proof

After `Stop` → `Destroy` → deleting the Stack definition, TX2 was checked directly:

```sh
sudo docker compose ls --all --format json

sudo docker ps -a   --filter 'name=k5-tx2-smoke'   --format '{{.Names}}\t{{.Status}}'

sudo docker network ls   --filter 'name=k5-tx2-smoke'   --format '{{.Name}}'
```

Accepted final state:

```text
compose projects: []
k5 containers:    none
k5 network:       none
```

No K5 runtime object remained on TX2.

## Current ownership gap（K5 当时的状态，保留为历史记录）

During K5, two TX2 host prerequisites were **host-local manual state**:

1. installation of the Ubuntu `docker-compose-v2` package;
2. `/etc/docker/daemon.json` containing the Tencent Docker Hub mirror.

They were **not yet reconciled by this repository**. Rebuilding TX2 would therefore
lose them unless they are restored separately.

> **K7A follow-up**：K7A 后来引入了独立的 production-worker owner
> （`deploy/production-worker/**` + `.github/workflows/production-worker.yml`），把 Compose
> 安装、`daemon.json` 的 Tencent Docker Hub mirror，以及 **root / Periphery 执行上下文的
> 私有 TCR pull 凭据** 纳入仓库拥有的 reconcile 与验证，因此重建 TX2 不再依赖未记录的手工
> 状态。本节其余内容描述的仍是 K5 当时的真实状态，不要据此认为 K5 自动化过这些前置条件；
> K5 也**有意**没有任何生产 registry 凭据。详见
> `docs/operations/tx2-production-worker.md`。

Do not silently fold either prerequisite into the Periphery lifecycle: Periphery owns
its binary/config/systemd identity and connection to Core, not general Docker host
provisioning. A later change should introduce an explicit host/runtime owner for these
Docker prerequisites, with its own review, rollback, and idempotency contract.

## What K5 proves — and what it does not

K5 proves:

- Core can drive a real Stack operation through the outbound TX2 Periphery session;
- Periphery can operate the TX2 Docker daemon;
- the installed Compose version is compatible with the Komodo v2.3.3 commands used
  during Stack discovery and deploy;
- image pull, Compose up, state observation, logs, stop, down, and cleanup all work;
- a disposable workload can be fully removed without residue.

K5 does not prove or authorize:

- migration of Business API, Frontend, Keycloak, AI service, PostgreSQL, Caddy, or
  observability workloads;
- production registry-secret provisioning for root / Periphery（K5 有意不做；该边界后来由
  K7A 的 production-worker owner 用受保护 environment 的 secret 建立）;
- declarative Stack ownership under `infra/komodo/resources/**`;
- automatic ResourceSync apply;
- `managed = true` or `delete = true`;
- production volumes, databases, ingress, health checks, rollback, or zero-downtime
  cutover through Komodo.

Those require a separate workload-migration phase and service-by-service ownership
plan.
