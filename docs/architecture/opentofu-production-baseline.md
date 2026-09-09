# OpenTofu production baseline

This repository contains a deliberately small OpenTofu baseline for the existing
Tencent Cloud Object Storage (COS) bucket used by production artifacts:

- bucket: `wotbtools-prod-artifacts-1478073677`
- region: `ap-shanghai`
- ACL: private
- server-side encryption: SSE-COS (`AES256`)
- availability: single AZ (`multi_az = false`)
- versioning: disabled
- lifecycle: delete current objects one day after their last modification

## What OpenTofu manages

The root module is in
`infra/tofu/environments/prod`. It manages only the existing COS bucket through
the official `tencentcloudstack/tencentcloud` provider. It does not create or
manage CVMs, networks, DNS, CDN, Keycloak, PostgreSQL, application workloads, or
runtime identities.

The bucket has `prevent_destroy = true`. This adds an OpenTofu plan-time guard
while the resource remains in configuration; it does not protect against
out-of-band deletion, direct cloud-console/API actions, state manipulation, or
removing the resource from configuration. A plan showing `-/+`, destroy, or
replacement must still be treated as a blocker and must not be applied.

The Tencent provider schema models ACL, encryption, versioning, multi-AZ, and
lifecycle rules on `tencentcloud_cos_bucket`; they are not represented with an
AWS-specific S3 resource. See the [provider resource documentation](https://registry.terraform.io/providers/tencentcloudstack/tencentcloud/latest/docs/resources/cos_bucket).

## Identity and secrets

Manual import and any future authenticated plan use the existing CAM user
`wotbtools-opentofu` through the repository secrets
`TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY`. The provider reads
those values from environment variables. The current GitHub Actions validation
workflow does not inject or access Tencent production secrets. Credentials are
never written to HCL, tfvars, state committed to Git, workflow output, or logs.

This identity is infrastructure management only. A future
`wotbtools-runtime` identity for Control API / Worker object Put/Get/Head access
must remain separate and is not created by this baseline.

Do not replace the custom least-privilege policy with
`AdministratorAccess`, `QCloudResourceFullAccess`, or COS full access. If a
command returns a 403, record the exact missing COS action and add only that
action through the owner-controlled CAM policy process.

## One-time import

The bucket already exists, so import is a manual bootstrap operation. Run it
from the module directory with the same CAM identity that will manage the
resource:

```bash
cd infra/tofu/environments/prod
tofu init
tofu import tencentcloud_cos_bucket.production_artifacts wotbtools-prod-artifacts-1478073677
tofu plan
```

The provider documentation defines the import ID as the bucket name. The given
bucket name already includes its APPID suffix; do not append a guessed region,
APPID, or composite identifier.

After import, inspect the plan before any future apply. The expected result is
no changes or only an explicitly understood provider-normalization difference.
If the plan proposes creation, destruction, or replacement, stop and investigate
the import ID, provider schema, immutable attributes, defaults, or unsupported
configuration.

## State strategy

This phase uses the default local backend for the one-time bootstrap only. The
state file is ignored and must not be committed. GitHub-hosted runners are
ephemeral, so a local import cannot be seen by a later Actions run. The current
workflow therefore runs formatting, initialization, and validation only. An
authoritative plan is deferred until a dedicated remote-state design exists and
the owner performs the authenticated bootstrap.

Recommendation: **DEFER** a remote backend until a separate state-storage
decision is approved. The production artifact bucket has a one-day object
expiration policy and is not an appropriate state store. Tencent COS exposes an
S3-compatible API, but introducing an S3-compatible backend, locking contract,
state retention policy, and a dedicated state bucket is a separate security and
operations change. Do not use the artifact bucket as an improvised backend.

The next phase should select a dedicated, retained, access-controlled state
bucket and a tested locking approach, then add the backend in a separate change
before relying on CI plans as authoritative.

## GitHub Actions policy

`.github/workflows/tofu-plan.yml` runs on pull requests that change the OpenTofu
configuration or this workflow, and can be started manually. It runs only:

1. `tofu fmt -check -recursive`
2. `tofu init`
3. `tofu validate`

It does not inject Tencent production credentials, import state, or run plan.
There is no `tofu apply`/`terraform apply` path. Merging this PR does not change
production. A human owner must perform the one-time import and review the
resulting plan before any future apply is considered.

## State and file safety

The root `.gitignore` excludes `.terraform/`, state snapshots and backups,
binary plans, crash logs, and real `.tfvars` files while allowing only the
non-secret `terraform.tfvars.example` template. Outputs contain only the bucket
name and region.

## Next phase

After the owner confirms an imported no-op plan and approves a dedicated remote
state design, add that backend and its operational controls in a separate PR.
Runtime COS access, object lifecycle changes, CDN/custom domains, and other
production infrastructure remain outside this baseline.
