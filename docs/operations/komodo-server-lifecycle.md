# Komodo Server Lifecycle Runbook

This runbook defines the WotbTools operating procedure for adding a Komodo-managed
server, moving workloads between servers, and retiring an old server.

It complements [`komodo-periphery.md`](komodo-periphery.md) and
[`komodo-resource-sync.md`](komodo-resource-sync.md). Those documents define how a
host joins the Komodo control plane and how declarative Komodo resources are owned;
this document defines **how to use that control plane safely during migration**.

## Core rule

Komodo is the deployment/control plane. It is **not** a persistent-data migration
engine.

Changing a Stack or Deployment from one Server to another means only that the
workload's **execution target** changed. It does not prove that a database, Docker
volume, bind mount, upload directory, replay archive, Redis persistence, or other
host-local state moved with it.

Therefore every migration must explicitly separate:

1. workload deployment;
2. persistent-data migration;
3. traffic cutover;
4. source-host retirement.

## Current WotbTools control-plane assumptions

- Komodo resources are declared under `infra/komodo/resources/` and reviewed through
  Git before manual application in the Komodo UI.
- The existing Servers are `yecao`, `tx1`, `tx2`, and `ali-sh-asset-01`; server
  declarations are adopted by name rather than recreated. The Alibaba asset host is
  outside the WireGuard mesh and reaches Core only outbound over
  `https://komodo.wotbtools.com:443`, while the other three keep the private
  `10.20.0.2:9120` route.
- Periphery lifecycle is owned outside Komodo by `deploy/periphery/**` plus GitHub
  Actions/systemd. Komodo must not manage its own Core or Periphery lifecycle.
- Resource Sync remains non-destructive: changes are reviewed as diffs and manually
  applied. A server migration must not turn Resource Sync into an automatic delete or
  automatic deployment mechanism.

If those assumptions change, update this document together with the relevant
canonical operations document.

## 1. Inventory before any migration

Before moving or deleting a host, record everything that depends on it:

- Komodo Stacks / Deployments;
- Docker containers not represented in Komodo;
- exposed ports and reverse-proxy routes;
- Docker named volumes;
- bind mounts and host filesystem paths;
- databases and persistent Redis;
- application uploads / replay files / local caches that are authoritative;
- environment/secrets dependencies;
- registry access;
- WireGuard / inter-host dependencies;
- DNS, Caddy, load-balancer, or ingress ownership.

Unknown items are **not** considered stateless. Mark them `uncertain` and resolve the
ownership before cutover.

## 2. Classify every workload

Each workload must be classified as `stateless`, `stateful`, or `uncertain`.

### Stateless examples

Typical examples are:

- frontend containers;
- backend APIs whose database/storage is external;
- workers with no host-local authoritative state;
- gateways or reverse proxies whose configuration is reproducible from Git.

A stateless workload can usually be recreated from its image/configuration on the
new Server, health-checked, then placed into service.

### Stateful examples

Treat these as stateful unless proven otherwise:

- PostgreSQL / MySQL / MongoDB;
- Redis with RDB/AOF persistence;
- Keycloak database state;
- Docker volumes;
- bind-mounted application data;
- uploads and replay files;
- any host-local path that is the only copy of business data.

For these, choose a service-appropriate mechanism such as backup/restore, snapshot,
`rsync`, replication, or another explicit migration procedure. Komodo only manages
the resulting container lifecycle.

## 3. Add a new server

1. Provision the host and establish the expected network/WireGuard connectivity.
2. Install Docker using the repository-supported host bootstrap path.
3. Install/configure Periphery using the canonical procedure in
   [`komodo-periphery.md`](komodo-periphery.md).
4. Add/adopt the Server in `infra/komodo/resources/servers.toml` following
   [`komodo-resource-sync.md`](komodo-resource-sync.md).
5. Run the repository validation for Komodo resources.
6. Review the Resource Sync diff in Komodo. Any unexpected metadata, address, tag,
   credential, or destructive diff is a STOP condition.
7. Manually apply the reviewed diff.
8. Verify the Server is online and can reach required registries and internal
   dependencies.
9. Do **not** migrate production traffic yet.

## 4. Migrate a stateless workload

Preferred order:

1. keep the source instance running;
2. point or recreate the Stack/Deployment on the target Server through the reviewed
   Komodo configuration path;
3. deploy the target instance;
4. verify container health and startup logs;
5. verify environment/secrets and dependency reachability;
6. run an application smoke test against the target directly;
7. add/switch ingress traffic;
8. observe errors, latency, and logs;
9. only then stop the source instance.

Whenever feasible, use a shadow or overlapping period rather than stop-first
migration. K7B/K7C are the precedent for validating a new frontend instance before
final cutover.

## 5. Migrate a stateful workload

Before touching traffic, document:

- authoritative data location;
- backup/restore or replication method;
- expected downtime, if any;
- consistency/integrity checks;
- application connection changes;
- rollback point and rollback window.

Generic sequence:

1. create and verify a current backup or replication path;
2. prepare storage on the target host;
3. migrate the data using the selected service-specific mechanism;
4. start the target service under Komodo where applicable;
5. validate integrity (for example row counts, application reads/writes, or service
   health checks appropriate to the datastore);
6. switch dependent applications/connections;
7. smoke-test user-visible behavior;
8. retain source data unchanged through the rollback window.

A successful container start is **not** sufficient validation for a stateful
migration.

## 6. Cutover gate

Do not switch production traffic until all applicable checks pass:

- target containers healthy;
- no unexplained startup/runtime errors in logs;
- required environment variables/secrets present;
- network dependencies reachable;
- persistent data verified;
- direct smoke test passes;
- DNS/Caddy/load-balancer change is understood and reversible;
- rollback path still exists.

After cutover, observe the target before retiring the source.

## 7. Retire a server

Deleting the Komodo Server resource is the **last** infrastructure-management step,
not the first.

Required order:

1. re-run the source-host inventory;
2. confirm every workload is migrated, intentionally removed, or documented;
3. confirm no required volume/bind mount/file/database exists only on the source;
4. stop residual services without destroying their data immediately;
5. observe the replacement path for regressions;
6. remove the Server from the Git-owned Komodo resource declarations;
7. review the Resource Sync diff and ensure only the intended Server retirement is
   represented;
8. manually apply the reviewed change;
9. decommission/cancel the VPS or physical host last.

Never make Resource Sync `delete = true` merely to make host retirement easier.

## Rollback principle

Every migration plan must state the rollback trigger and action before cutover.
Typical rollback is:

- restore ingress to the source instance;
- restore the previous application connection target;
- stop the target workload if it can corrupt shared state;
- preserve both source and target logs/data for diagnosis.

For stateful migrations, rollback semantics are service-specific and must account for
writes that occurred after cutover. Do not claim a simple DNS reversal is sufficient
unless data ownership makes that safe.

## When this runbook is not enough

Escalate to a separate architecture decision if the requirement becomes:

- automatic workload rescheduling after node failure;
- long-lived multi-node replicas managed by a scheduler;
- service discovery or cluster consensus across hosts;
- automatic failover with no operator cutover.

Those are orchestration/HA requirements (for example Swarm or another scheduler), not
ordinary Komodo Server migration.
