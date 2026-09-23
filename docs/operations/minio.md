# Yecao MinIO temporary workspace

MinIO is WotbTools' distributed temporary workspace, not an application
database or an artifact archive:

```text
wotbtools-temp/temp/jobs/<job-id>/…
  input/<source-index>/<name>          raw replay input
  artifacts/<source-index>/<name>      parsed artifacts (ai-facts / map-overview / battle-playback-v2)
  result/source-<source-index>.json    canonical per-source dataset (input of batch finalization)
  result/finalized.json                finalized batch dataset (the dataset readers use)
```

The `result/` layout has one owner: `ObjectStorageReplayDatasetRepository`. The
per-source objects are the **input** of the control plane's `FINALIZING_BATCH`
step (dedupe / conflict detection / League Rating / aggregation / enrichment);
`finalized.json` is the **output** and the only dataset the read side consumes
(`GET .../result`, Export, Rating V2). Readers never concatenate per-source
objects — doing so would skip the batch semantics and show different numbers than
Export.

The bucket is durable infrastructure. Every object below `temp/jobs/` expires
one day after creation; that rule is a bounded backstop, **not** the cleanup
mechanism. A job can contain multiple replay inputs. PostgreSQL remains
authoritative for job state and RabbitMQ remains the delivery layer.

Normal reclamation is the application TTL sweeper: when a terminal
(`READY`/`FAILED`/`CANCELLED`) job expires and no dataset lease is active, the
control plane deletes the job's whole `temp/jobs/<job-id>/` workspace **first**
and only then removes the PostgreSQL authority row. Deleting PostgreSQL first
would orphan the objects with nothing left to name them; with this order, a
storage failure just leaves the row for the next sweep, and repeating a
successful workspace deletion is harmless. Workspace deletion is job-scoped
(`ReplayJobWorkspaceCleaner`): the implementation derives the exact key set from
the job identity through `ObjectStorageKeys`, so the application never gets a
`list` or an arbitrary-prefix delete.

`java/wotb-object-storage-minio` is the only application client: it implements the
existing `com.wotb.contracts.ObjectStorage` port (`put` / `get` / `exists` /
`delete`) and keeps every `io.minio` type inside the module. It carries no
retention logic — expiry stays an OpenTofu lifecycle rule — and it deliberately
exposes **no `list` and no prefix operation**: `delete` removes exactly one key
the caller built itself through `ObjectStorageKeys`, so a bug cannot reach a
neighbouring job's workspace or another prefix. Deleting a missing object
succeeds, because the only caller rolls back a partially written set of inputs.

Create rollback is the reason `delete` exists: a create that fails before its
dispatch is confirmed (a half-written input set, a failed authority
registration, a rejected or unconfirmed dispatch) deletes the inputs it already
wrote under `temp/jobs/<jobId>/input/` instead of leaving objects that no job
references. Rollback is best effort by design — if it fails, the failure is
logged and the original create error is what the client sees, so a permission or
network problem can never be reported as "the upload was rejected because
storage is broken".

## Runtime boundary

Yecao runs the dedicated `deploy/docker-compose.minio.yml` project.

- S3 API: the published address is `10.20.0.2:9000` (what TX uses over WireGuard);
  containers attached to `wotb_internal` — the Yecao parser-worker — use the Docker
  service name `minio:9000`. Both reach the same runtime, and the published port is
  reachable from Yecao and from TX through WireGuard only.
- Console: `127.0.0.1:9001`, unavailable from public or WireGuard interfaces.
- Data: the named `wotb_yecao_minio_data` Docker volume.
- Health: MinIO's `/minio/health/live` endpoint, enforced by Compose before
  OpenTofu provisioning starts.

The service is deliberately not included in `deploy/docker-compose.prod.yml`.
An ordinary Yecao deployment neither starts MinIO nor requires any MinIO
credential.

## Image and license boundary

MinIO Community Edition no longer publishes a usable maintained container
image. `docker/Dockerfile.minio` builds the final maintained community source
release, `RELEASE.2025-10-15T17-29-55Z`, at the verified upstream commit
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`, into the immutable
`ghcr.io/a158coke/wotbtools-minio:sha-<12>` image. This is a source build, not
a runtime download. The upstream source is AGPLv3; operators must keep the
deployment's licensing obligations under review before production use.

## OpenTofu ownership

`infra/tofu/minio` owns exactly these logical resources:

- private `wotbtools-temp` bucket, protected from destruction;
- lifecycle expiry for `temp/jobs/` after one day;
- two application identities: `worker` with its own prefix-scoped read/write policy plus its
  bucket-level location-lookup grant, and `control_api` with a prefix-scoped read/write policy
  plus its delete-only rollback grant, its bucket-level location-lookup grant, and the
  matching attachments.

### Application identities

| Identity | Owner | Access key variable | Object scope |
|---|---|---|---|
| `worker` | Yecao parser-worker (parsing execution plane) | `YECAO_MINIO_WORKER_ACCESS_KEY` | `temp/jobs/*`: list + read/write; bucket location lookup |
| `control_api` | TX replay control plane (backend) | `YECAO_MINIO_CONTROL_API_ACCESS_KEY` | `temp/jobs/*`: list + read/write + delete (rollback); bucket location lookup |

Both read/write policies permit exactly `s3:ListBucket` conditioned on the `temp/jobs/*`
prefix plus `s3:GetObject` and `s3:PutObject` for objects under that prefix. `HeadObject`
is authorized by `s3:GetObject`. The control plane's rollback grant
(`wotbtools-temp-control-api-reclaim`) permits exactly `s3:DeleteObject` on the same
prefix, and only `control_api` has it: the parsing host cannot remove anything.

Bucket administration, IAM administration, and unrelated-bucket permission are absent
from every policy. The only bucket-level read is the `s3:GetBucketLocation` grant both
identities hold, which reveals only the bucket's region.

### Bucket location lookup (`s3:GetBucketLocation`)

The MinIO Java SDK resolves the bucket location before every object operation. An
identity that may `s3:GetObject`/`s3:PutObject` but not `s3:GetBucketLocation` fails
*before* the object request is sent: MinIO answers `403 AccessDenied` to
`GET /wotbtools-temp?location=` and the caller sees `PROCESSING_JOB_STORAGE_UNAVAILABLE`
even though the object prefix is correctly granted.

Both identities therefore hold their own location document —
`wotbtools-temp-worker-location` and `wotbtools-temp-control-api-location` — whose only
statement is `s3:GetBucketLocation` on `arn:aws:s3:::wotbtools-temp`: the bucket resource,
with no condition and no object access. They cannot widen what either identity reads or
writes, because the `temp/jobs/*` object scope is still owned solely by the read/write and
reclaim documents, and a location lookup reveals only the bucket's region. The two
documents are kept separate so each identity's permission set can be rotated or dropped
alone.

This closes the bucket-location authorization gap for the whole Replay pipeline: both the
TX control plane and the Yecao parser-worker reach the bucket through the same SDK and
need the same lookup before their object operations.

The two read/write scopes are identical on purpose. The prefix layout separates object
kinds (`input/`, `artifacts/`, `result/`), while the identity separates deployments: a
credential leaked on one host cannot be replayed on the other, and either side can be
rotated alone. Narrowing each identity to part of the prefix would add a second,
weaker copy of the ownership that PostgreSQL and the job layout already hold, since
either side may read inputs and write artifacts for the job it owns.

The policy documents are duplicated in `minio.tf` rather than shared through a
`locals` block, and the rollback grant is a **third** control-plane document instead of one
more action in the read/write policy: re-expressing an already-applied policy would rewrite
that resource, which the plan guard refuses as an in-place update. Both bucket-location
grants follow the same rule — each is its own document, so each arrives as a `create` and
never as an edit of an applied read/write document.
`infra/tofu/minio/test-validate-plan.sh` plus the CI MinIO smoke pin every scope
(including the delete-only one and both bucket-level location grants) and reject any
widened copy.

The MinIO provider records the configured application identity secrets as sensitive
state. State is therefore local to Yecao at
`/opt/wotb/minio-tofu-state/terraform.tfstate`; the deployment helper sets
`umask 077` and creates its parent at mode `0700`. It has no outputs and is
never uploaded to COS.

### Deliberately not in this bucket: HoF replay originals

Hall of Fame replay original `.wotbreplay` files are permanent content-addressed
files rather than Dataset artifacts (`docs/current-plan.md` §14.5 / §15.3). They move
as a volume — operator-run `rsync -aHAX --numeric-ids` from the Yecao `replay_data`
volume to the TX volume — and stay on the filesystem behind the existing single
`HallOfFameReplayStorage`, with `HOF_REPLAY_DIR` pointing at the migrated TX volume.
The earlier MinIO `hof-replays/` design is cancelled: there is no `ReplayContentStorage`
port, no MinIO HoF replay implementation, and no `hof-replays/` prefix in the bucket.

### Yecao prerequisite: provider mirror

Before the first manual MinIO deployment, an operator must install OpenTofu,
`python3`, and the exact locked `aminueza/minio` provider archive into
`/opt/wotb/tofu-provider-mirror`. Use the committed
`infra/tofu/minio/.terraform.lock.hcl` as the checksum authority. The staged
`deploy/minio/tofurc` selects only that filesystem mirror and explicitly
excludes the provider from direct installation. If either `tofu`, `python3`, or the
mirror is absent, the deployment fails before state changes; it never downloads
a provider on Yecao.

## Credentials and explicit deployment

Create these GitHub Actions Secrets; never commit their values:

```text
YECAO_MINIO_ROOT_USER
YECAO_MINIO_ROOT_PASSWORD
YECAO_MINIO_WORKER_ACCESS_KEY
YECAO_MINIO_WORKER_SECRET_KEY
YECAO_MINIO_CONTROL_API_ACCESS_KEY
YECAO_MINIO_CONTROL_API_SECRET_KEY
```

Root credentials are passed only to the MinIO process and the OpenTofu provider
for bootstrap/admin actions. Each application identity is an independently rotatable
least-privilege IAM user: `worker` is reserved for the Yecao parser-worker and
`control_api` for the TX replay control plane. No application service reads the other
identity's credentials.

Deployment is intentionally manual. From the current `main` HEAD, first ensure
the corresponding immutable MinIO image has been built, then dispatch the
existing **Deploy** workflow with `service=minio`. That route copies only MinIO
files, requires only the six MinIO secrets, starts only the MinIO compose
project, applies the exact OpenTofu plan, and rejects a non-empty second plan.
Merging this PR only builds the source-pinned image; it does not deploy MinIO.

Do not change COS, WireGuard, DNS, RabbitMQ, PostgreSQL, Keycloak, or application
traffic as part of this workflow.
