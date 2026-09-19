# Yecao MinIO temporary workspace

MinIO is WotbTools' distributed temporary workspace, not an application
database or an artifact archive:

```text
wotbtools-temp/temp/jobs/<job-id>/{inputs,metadata,outputs}/...
```

The bucket is durable infrastructure. Every object below `temp/jobs/` expires
one day after creation. A job can contain multiple replay inputs. PostgreSQL
remains authoritative for job state and RabbitMQ remains the delivery layer;
this infrastructure does not add an application client or alter either system.

## Runtime boundary

Yecao runs the dedicated `deploy/docker-compose.minio.yml` project.

- S3 API: `10.20.0.2:9000`, available to local Yecao services and TX through
  WireGuard only.
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
- one worker IAM user, one prefix-scoped policy, and their attachment.

The worker policy only permits `s3:ListBucket` under `temp/jobs/*` plus
`s3:GetObject` and `s3:PutObject` for objects under that prefix. `HeadObject`
is authorized by `s3:GetObject`. It has no delete, bucket administration, IAM
administration, or unrelated-bucket permission.

The MinIO provider records the configured worker secret as sensitive state.
State is therefore local to Yecao at
`/opt/wotb/minio-tofu-state/terraform.tfstate`; the deployment helper sets
`umask 077` and creates its parent at mode `0700`. It has no outputs and is
never uploaded to COS.

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
```

Root credentials are passed only to the MinIO process and the OpenTofu provider
for bootstrap/admin actions. The worker credentials create the least-privilege
IAM identity and are reserved for a future application integration. No current
application service receives them.

Deployment is intentionally manual. From the current `main` HEAD, first ensure
the corresponding immutable MinIO image has been built, then dispatch the
existing **Deploy** workflow with `target=minio`. That route copies only MinIO
files, requires only the four MinIO secrets, starts only the MinIO compose
project, applies the exact OpenTofu plan, and rejects a non-empty second plan.
Merging this PR only builds the source-pinned image; it does not deploy MinIO.

Do not change COS, WireGuard, DNS, RabbitMQ, PostgreSQL, Keycloak, or application
traffic as part of this workflow.
