# OpenTofu production baseline

This root module deliberately manages one existing production artifact bucket
and stores its authoritative OpenTofu state in a separate Tencent COS bucket.
It does not create or manage CVMs, networks, DNS, CDN, Keycloak, PostgreSQL,
application workloads, runtime identities, or the bucket that carries its own
state.

## Managed production resource

The root module is `infra/tofu/environments/prod`. It manages only:

- bucket: `wotbtools-prod-artifacts-1478073677`
- region: `ap-shanghai`
- ACL: private
- server-side encryption: SSE-COS (`AES256`)
- availability: single AZ (`multi_az = false`)
- versioning: disabled
- lifecycle: delete current objects one day after their last modification

The resource has `prevent_destroy = true`. This is an OpenTofu plan-time guard;
it does not protect against out-of-band deletion, direct cloud-console/API
actions, state manipulation, or removing the resource from configuration. Any
plan containing delete or replacement actions for this bucket is a blocker and
must not be applied. The workflow also rejects such a plan from its JSON form.

The Tencent provider schema models the bucket settings through
`tencentcloud_cos_bucket`, not an AWS-specific resource. See the [provider
resource documentation](https://registry.terraform.io/providers/tencentcloudstack/tencentcloud/latest/docs/resources/cos_bucket).

## Remote state design

The production root uses the OpenTofu S3 backend with this stable state key:

```text
bucket: wotbtools-prod-tofu-state-1478073677
region: ap-shanghai
endpoint: https://cos.ap-shanghai.myqcloud.com
key: wotbtools/prod/terraform.tfstate
addressing: virtual-hosted style
```

The endpoint is configured with the current OpenTofu `endpoints.s3` schema.
`use_path_style = false` is explicit because Tencent recommends virtual-hosted
style and newer COS buckets can reject path-style requests. No workspace path
is used in this phase.

The state bucket is bootstrap infrastructure created and owned manually outside
this production root. Its current properties are private access, versioning
enabled, SSE-COS, single AZ, no expiration lifecycle, no CDN, and no public
access. It is intentionally not declared as a resource here: managing the
bucket that hosts this root's state would create a backend chicken-and-egg
boundary. If it is IaC-managed later, use an independent
`infra/tofu/bootstrap/state` root.

Remote state is required because GitHub-hosted runners are ephemeral. A local
`terraform.tfstate` on one workstation cannot provide the resource identity and
known-state mapping to the next runner or owner. The artifact bucket is not a
valid state store because its lifecycle deletes current objects after one day,
and changing its lifecycle would alter production artifact behavior. The
dedicated state bucket has versioning so accidental state overwrites or deletes
can be recovered; it has no expiration policy so recovery history is retained.

## Backend authentication and AWS compatibility flags

The backend never contains `SecretId` or `SecretKey`. OpenTofu's S3 backend reads
the AWS-compatible environment names:

```text
AWS_ACCESS_KEY_ID     <- TENCENTCLOUD_SECRET_ID
AWS_SECRET_ACCESS_KEY <- TENCENTCLOUD_SECRET_KEY
```

The Tencent provider remains separately authenticated through
`TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY`. The same CAM identity
may serve both purposes, but backend authentication and provider authentication
are separate configuration responsibilities.

The backend enables only the AWS compatibility skips required for COS:

- `skip_credentials_validation`: COS does not provide the AWS STS credential
  validation API used by the backend.
- `skip_region_validation`: `ap-shanghai` is a Tencent region, not an AWS
  region name.
- `skip_requesting_account_id`: COS does not provide the AWS account-ID lookup
  path used by the backend.
- `skip_metadata_api_check`: GitHub-hosted runners are not EC2 instances and
  must not probe the EC2 metadata service.
- `skip_s3_checksum`: COS is a non-AWS S3-compatible implementation and the
  backend's AWS checksum requirement is not needed for this endpoint.

No credentials are written to HCL, tfvars, state committed to Git, workflow
output, or logs. The existing CAM policy remains least privilege; do not replace
it with `AdministratorAccess`, `QCloudResourceFullAccess`, or COS full access.
If an authenticated command returns 403, record the exact missing COS action and
add only that action through the owner-controlled CAM policy process.

## Locking and concurrency

This phase does not enable OpenTofu's `use_lockfile` native S3 locking. There is
not enough Tencent COS evidence in this repository to claim that the required
conditional object-write semantics are reliable for production state locking.
The GitHub workflow therefore uses:

```yaml
concurrency:
  group: opentofu-prod
  cancel-in-progress: false
```

This serializes repository workflow runs that read the production state. GitHub
Actions concurrency is not a backend distributed lock: it does not coordinate
owner laptops, other repositories, or manually started OpenTofu processes.
Avoid concurrent owner operations until a separately verified COS locking
design exists.

## One-time owner bootstrap and import

The existing artifact bucket is cloud-owned but is not authoritative in remote
state until the owner imports it. The import is deliberately manual and is
never run by GitHub Actions. Use the following PowerShell flow from the
repository root; obtain the two values from the owner's secret manager without
putting them in chat or a commit:

```powershell
$env:TENCENTCLOUD_SECRET_ID = "<owner secret id>"
$env:TENCENTCLOUD_SECRET_KEY = "<owner secret key>"
$env:AWS_ACCESS_KEY_ID = $env:TENCENTCLOUD_SECRET_ID
$env:AWS_SECRET_ACCESS_KEY = $env:TENCENTCLOUD_SECRET_KEY

Set-Location infra/tofu/environments/prod
tofu init -reconfigure
tofu import tencentcloud_cos_bucket.production_artifacts wotbtools-prod-artifacts-1478073677
tofu plan -input=false
```

For a POSIX-compatible shell, the equivalent mapping is:

```bash
export TENCENTCLOUD_SECRET_ID='<owner secret id>'
export TENCENTCLOUD_SECRET_KEY='<owner secret key>'
export AWS_ACCESS_KEY_ID="$TENCENTCLOUD_SECRET_ID"
export AWS_SECRET_ACCESS_KEY="$TENCENTCLOUD_SECRET_KEY"

cd infra/tofu/environments/prod
tofu init -reconfigure
tofu import tencentcloud_cos_bucket.production_artifacts wotbtools-prod-artifacts-1478073677
tofu plan -input=false
```

`-reconfigure` deliberately selects the new remote backend without migrating
an old workstation-local state snapshot. The import then writes the existing
artifact bucket directly to the remote backend. Do not use the local state as
the final state and do not append a guessed region, APPID, or composite value to
the bucket-name import ID.

Before import, a plan may correctly show `+ create` because the remote state has
no resource identity yet. After import, inspect the plan. The expected result
is no changes or only an explicitly understood provider-normalization
difference. Creation, destruction, or replacement after import is a stop
condition requiring investigation of the import ID, provider schema, defaults,
or unsupported settings.

## GitHub Actions policy

`.github/workflows/tofu-plan.yml` runs on OpenTofu changes and can be started
manually. Every run performs:

1. `tofu fmt -check -recursive`
2. `tofu init`
3. `tofu validate`

For a fork pull request, init uses `-backend=false`, no production secrets are
available to any step, and no authenticated plan runs. A same-repository pull
request (or an owner-triggered manual run) receives credentials only on the
credential wiring check, Tencent provider probe, backend-init and
authenticated-plan steps and runs:

The credential wiring check prints only the SecretId length/prefix and SecretKey
length; it never prints secret values. The provider probe creates a temporary
backend-free OpenTofu root under the runner temp directory, calls the locked
Tencent provider's `tencentcloud_user_info` data source with the Tencent
environment variables, and removes the directory on exit. Its result is
diagnostic and does not grant extra permissions or replace the backend check. A
provider probe failure points to credential validity or Tencent API
authorization; a provider probe success followed by S3 `InvalidAccessKeyId`
points to the S3-compatible credential, endpoint, or signing path. The probe is
non-blocking so a missing permission for that diagnostic API does not hide the
backend result.

```text
tofu plan -input=false -no-color -out=plan.tfplan
```

The plan may contain normal add/change/destroy differences; it does not need to
be a no-op. Success means the plan completed and its diff is reviewable. The
workflow never runs `tofu apply`, `terraform apply`, or `tofu import`. The
binary plan is job-local, is ignored by Git, and is not uploaded as an artifact,
cache entry, PR comment, or repository file. Authoritative state is never
uploaded to GitHub.

## State and file safety

The root `.gitignore` keeps `.terraform/`, state snapshots and backups, binary
plans, crash logs, and real `.tfvars` files out of Git while allowing only the
non-secret `terraform.tfvars.example` template. `.terraform.lock.hcl` remains
tracked.

Runtime COS access, object lifecycle changes, CDN/custom domains, and all other
production infrastructure remain outside this baseline.
