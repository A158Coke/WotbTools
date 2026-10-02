# Komodo controller ownership

Komodo is the WotBTools control plane. It does **not** own its own Core lifecycle,
so it stays recoverable through this GitHub Actions plane even when Komodo itself
is broken.

| Concern | Owner |
| --- | --- |
| Docker runtime (`mongo`, `core`) | Docker Compose (`deploy/komodo/compose.yml`) |
| Bootstrap, reconcile, break-glass | `.github/workflows/komodo-controller.yml` |
| Public DNS `komodo.wotbtools.com` | OpenTofu (`infra/tofu/komodo`) |
| Public ingress | TX Caddy (separate owner, K2) |

## Deployed state

- Project identity `komodo`; services `mongo` and `core` only. No Periphery agent
  is installed in this phase and no workload has been adopted.
- Core publishes `10.20.0.2:9120` (the Yecao WireGuard address) and nothing else.
  MongoDB publishes no host port. Neither container carries a public listener.
- Both containers carry the upstream `komodo.skip` label so a future Komodo
  instance cannot stop its own control plane through `StopAllContainers`.
- Images are pinned: Core by digest, MongoDB by exact patch tag plus digest. The
  TencentCloud provider is pinned in `versions.tf` and locked in
  `.terraform.lock.hcl`. Control-plane releases never float.

## Host layout

```text
/opt/komodo/
├── compose.yml            # live runtime, promoted only after config+pull pass
├── source-sha             # last successfully promoted source SHA
├── .deploy.lock           # host lock shared by reconcile and state backup
├── backups/               # reserved controller backup directory (mounted in Core)
├── incoming/<SOURCE_SHA>/ # staged inputs, removed after reconciliation
└── tofu-state/
    ├── terraform.tfstate
    └── bootstrap-complete # `local-tofu-state-bootstrap-v1`
```

## Transaction order

`reconcile.sh` runs under one `flock` on `/opt/komodo/.deploy.lock`, covering the
Compose mutation, the OpenTofu plan/apply, the second plan, and both runtime
verifications:

1. Preflight the source SHA, the four Komodo secrets, the two TencentCloud
   credentials, the staged inputs, and the local state bootstrap contract.
2. `docker compose config` then `pull`, and only then promote the staged Compose
   to `/opt/komodo/compose.yml` and `up -d`.
3. Verify the private controller.
4. `tofu fmt` / `init -lockfile=readonly` / `validate` / saved `plan` /
   plan-guard / `apply` / saved second plan / `--require-no-changes`.
5. Write `bootstrap-complete`, then verify the controller a final time.

## Verification

Both safety rules in `lib.sh` — refuse a symlinked/unsafe owner path, and fail
closed on a corrupt state bootstrap — are executable fixtures, not just contract
strings:

```sh
bash deploy/komodo/test-guards.sh                  # path + state-bootstrap guards
bash infra/tofu/komodo/test-validate-plan.sh       # DNS plan guard
```

`test-guards.sh` covers a fresh directory, a complete bootstrap, state without a
marker, marker without state, an empty state or marker, wrong marker content,
symlinked and dangling state/marker/directory, and a non-directory path.
`.github/workflows/ci-komodo-controller.yml` runs both suites on every pull
request that touches this owner.

## Failure semantics

- Missing TencentCloud credentials: the run fails closed before any mutation. No
  placeholder credentials are ever created.
- DNS provider unavailable: the private controller stays healthy, the workflow
  fails, and the state is not corrupted. DNS is never destroyed automatically.
- Core or Mongo unhealthy: the workflow fails, prints container logs, touches no
  unrelated WotBTools workload, performs no DNS failover, and stays out of TX.
- GitHub unavailable: the running controller keeps working. Actionable recovery is
  `workflow_dispatch` on `main` once GitHub returns, or a documented manual SSH
  run of `reconcile.sh` with the staged inputs.
- State exists without a bootstrap marker: fail closed. This is the expected state
  after a failed first bootstrap. Recover by inspecting
  `/opt/komodo/tofu-state/terraform.tfstate`, reconciling it by hand, and only then
  writing `bootstrap-complete` with the exact content
  `local-tofu-state-bootstrap-v1`. Never delete the state to force a fresh start.
- Marker exists without its state: fail closed and restore from the scheduled
  OpenTofu state backup.

## Backups

`deploy/tofu-local-state-backup.sh komodo` is invoked from the scheduled
`database-backup.yml` Yecao job. It backs up `tofu-state/terraform.tfstate` and
`tofu-state/bootstrap-complete` into
`/opt/komodo/backups/opentofu-state/komodo-opentofu-state-<utc>.tar.gz`, verified
by `sha256sum` and `tar -tzf`. It takes the same `/opt/komodo/.deploy.lock`, so it
can never run during a controller mutation.

MongoDB backup policy is intentionally not part of K1; the mounted
`/opt/komodo/backups` directory reserves that ownership for a later phase.

## Upgrades

Komodo image upgrades are ordinary pull requests: edit the pinned digest or tag,
run the required gate, review, merge, and let the production workflow reconcile.
There is no automatic moving tag.

- The Core digest resolves from the official `ghcr.io/moghtech/komodo-core:<x.y.z>`
  tag. When the digest changes, update `pinned_core_version` in `verify.sh` in the
  same pull request: the runtime check compares `/version` against it.
- MongoDB moves to the next exact patch tag and its digest together.
- The TencentCloud provider version lives in `versions.tf` and
  `.terraform.lock.hcl`; regenerate the lockfile from the new version instead of
  editing hashes by hand.
