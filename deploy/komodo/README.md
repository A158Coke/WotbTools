# Komodo controller ownership

Komodo is the WotBTools control plane. It does **not** own its own Core lifecycle,
so it stays recoverable through this GitHub Actions plane even when Komodo itself
is broken.

| Concern | Owner |
| --- | --- |
| Docker runtime (`mongo`, `core`) | Docker Compose (`deploy/komodo/compose.yml`) |
| Bootstrap, reconcile, break-glass | `.github/workflows/komodo-controller.yml` |
| Public DNS `komodo.wotbtools.com` | OpenTofu (`infra/tofu/komodo`) |
| Public HTTPS ingress | TX Caddy (`.github/workflows/caddy.yml`) |

## Public ingress (K2)

Caddy on TX is the only public way in, and it reaches Core over WireGuard:

```text
Browser → https://komodo.wotbtools.com → TX Caddy :443 → 10.20.0.2:9120 → Komodo Core
```

- `deploy/tx/Caddyfile` owns the route: `komodo.wotbtools.com { reverse_proxy 10.20.0.2:9120 }`.
  The Host header is untouched because `KOMODO_HOST` is already the public URL.
- Nothing about Komodo is published on Yecao: Core still binds only the WireGuard
  address and MongoDB still publishes no host port.
- `caddy.yml` proves the route in two layers, in this order, so a failure is
  attributable: first the **private upstream** (`http://10.20.0.2:9120/version`
  must report the pinned release — a WireGuard/Yecao/Core problem), then the
  **public route** (`https://komodo.wotbtools.com/version` must report the same
  release over trusted TLS, and `/` must answer — a Caddy/TLS/DNS problem). No
  check disables TLS verification, and no admin credential is used.
- The expected release is read from `pinned_core_version` in
  `deploy/komodo/verify.sh`, which is therefore a declared Caddy production
  input: bumping the Komodo release re-runs the gateway verification.
- `deploy/tx/validate-caddy-config.sh` asserts the public site inventory before
  every staged Caddy validation (PR and production), so a missing site or a wrong
  upstream fails before the gateway is reloaded.

Manual acceptance after a deploy:

```sh
curl -fsS https://komodo.wotbtools.com/version   # 2.3.3
curl -fsSI https://komodo.wotbtools.com/         # successful HTTP response
```

Then open `https://komodo.wotbtools.com` and sign in as `admin` with the existing
`KOMODO_INIT_ADMIN_PASSWORD`. Expected inventory after K1+K2: admin user created,
Servers / Stacks / Deployments / Procedures all 0.

## Deployed state

- Project identity `komodo`; services `mongo` and `core` only. No Periphery agent
  is installed in this phase and no workload has been adopted.
- Core publishes `10.20.0.2:9120` (the Yecao WireGuard address) and nothing else.
  MongoDB publishes no host port. Neither container carries a public listener.
- Both containers carry the upstream `komodo.skip` label so a future Komodo
  instance cannot stop its own control plane through `StopAllContainers`.
- K1 bootstraps an **empty** controller plane. Komodo v2.3.3 defaults
  `disable_init_resources=false`, which seeds the system Procedures
  "Backup Core Database", "Global Auto Update", and "Rotate Server Keys" on a
  fresh database; `KOMODO_DISABLE_INIT_RESOURCES=true` suppresses all of them.
  No replacement Procedure, schedule, or backup automation is created in their
  place, and the CI Compose contract asserts the flag permanently. Admin
  initialization stays enabled, so the bootstrap admin user still exists.
  Expected initial inventory: admin user created, Servers / Stacks /
  Deployments / Procedures all 0.
- Images are pinned: Core by digest, MongoDB by exact patch tag plus digest. The
  TencentCloud provider is pinned in `versions.tf` and locked in
  `.terraform.lock.hcl`. Control-plane releases never float.

## Host layout

```text
/opt/komodo/
├── compose.yml            # live runtime, promoted only after config+pull pass
├── source-sha             # last successfully reconciled controller source SHA
├── .deploy.lock           # host lock shared by reconcile and state backup
├── backups/               # reserved controller backup directory (mounted in Core)
├── incoming/<SOURCE_SHA>/ # staged inputs, removed after reconciliation
└── tofu-state/
    ├── terraform.tfstate
    └── bootstrap-complete # `local-tofu-state-bootstrap-v1`
```

## Staging root

Every host-side path the workflow touches is created or removed only through
`staging-root.sh`, which is fed to the host straight from the checkout
(`script_path`) because the staging root is reached before any other controller
code exists there:

```text
prepare  →  /opt/komodo, /opt/komodo/incoming, /opt/komodo/incoming/<SHA>
        ↓      must all be real directories (mode 700); symlinks fail closed
SCP exact files into the validated SHA directory
        ↓
verify   →  reconcile refuses to run if the handed-over root is not that path
        ↓
cleanup  →  removes only the SHA directory, after re-proving both parents
```

`prepare` runs *before* SCP, so SCP can never write through a symlinked
`/opt/komodo` or `/opt/komodo/incoming`; `cleanup` can never follow one either.

## Transaction order

`reconcile.sh` runs under one `flock` on `/opt/komodo/.deploy.lock`, covering the
Compose mutation, the OpenTofu plan/apply, the second plan, and both runtime
verifications:

1. Preflight the source SHA, the four Komodo secrets, the two TencentCloud
   credentials, the staged inputs, and the staging root.
2. Take the host lock, then establish the **whole state-root invariant** —
   `/opt/komodo` and `/opt/komodo/tofu-state` must both already be real
   directories — and only then judge the state/marker bootstrap pair. Nothing is
   mutated until all of that holds.
3. `docker compose config` then `pull`, and only then promote the staged Compose
   to `/opt/komodo/compose.yml` and `up -d`.
4. Verify the private controller.
5. `tofu fmt` / `init -lockfile=readonly` / `validate` / saved `plan` /
   plan-guard / `apply` / saved second plan / `--require-no-changes`.
6. Write `bootstrap-complete`, then verify the controller a final time.
7. Write `source-sha` last, atomically. It means *last successfully reconciled
   source*, so a failed run never advances it.

The state-root check must precede the bootstrap-pair check, and both must precede
step 3: a symlinked `tofu-state` can hold a valid-looking state/marker pair
somewhere else, so judging the pair first would mutate the Compose runtime before
the unsafe root was noticed. `require_bootstrap_state` re-proves the state
directory itself, so a caller cannot lose the invariant by ordering alone.

## Verification

Both safety rules in `lib.sh` — refuse a symlinked/unsafe owner path, and fail
closed on a corrupt state bootstrap — are executable fixtures, not just contract
strings, and so are the staging root and the DNS plan guard:

```sh
bash deploy/komodo/test-guards.sh                  # path + state-bootstrap guards
bash deploy/komodo/test-staging-root.sh            # prepare/verify/cleanup staging root
bash deploy/komodo/test-reconcile-preflight.sh     # real reconcile.sh call ordering
bash infra/tofu/komodo/test-validate-plan.sh       # DNS plan guard
```

`test-guards.sh` covers a fresh directory, a complete bootstrap, state without a
marker, marker without state, an empty state or marker, wrong marker content,
symlinked and dangling state/marker/directory, and a non-directory path.
`test-staging-root.sh` covers a fresh root, an existing safe root, a symlinked or
dangling root/incoming/SHA directory, a regular file where a directory belongs,
malformed SHAs, unsafe roots, and proves a refused cleanup leaves the symlink
target untouched. `test-reconcile-preflight.sh` drives the real `reconcile.sh`
against a disposable controller root with a stubbed `deploy.sh`, so it proves an
unsafe or corrupt state root is rejected **before** the runtime mutation phase
starts — including a symlinked `tofu-state` that holds a valid-looking pair.
`test-validate-plan.sh` locks all eight record fields — domain, sub_domain,
record_type, record_line, value, ttl, status, and remark — so a changed DNS line,
TTL, or remark is rejected alongside deletes, replacements, and unexpected
resources. `.github/workflows/ci-komodo-controller.yml` runs all four suites on
every pull request that touches this owner.

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

MongoDB backup policy is intentionally not part of K1, and the system "Backup Core
Database" Procedure that Komodo would otherwise seed is disabled, so nothing in
K1 backs up the controller database. The mounted `/opt/komodo/backups` directory
only reserves that ownership for a later phase.

Because the controller state is a *required* backup target — the same rule the
other owner roots already follow — the nightly `yecao_tofu_state` job fails until
`/opt/komodo/tofu-state` exists. Configure `TENCENTCLOUD_SECRET_ID` and
`TENCENTCLOUD_SECRET_KEY` before or with this change so the first production
reconcile can bootstrap the state and write `bootstrap-complete`; otherwise the
nightly state-backup job stays red (TX database backups are unaffected, they run
in their own job).

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
