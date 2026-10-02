# OpenTofu owner-host local state

OpenTofu state lives on the host that owns each active root. Per-SHA staging
directories contain disposable source only; they never contain authoritative
state. COS is retired specifically as an OpenTofu state backend. Historical COS
state is abandoned and is not read, copied, migrated, or used as a recovery
source by this repository.

| Owner | Root | Persistent state |
|---|---|---|
| TX | `infra/tofu/postgres-business` | `/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate` |
| TX | `infra/tofu/postgres-keycloak` | `/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate` |
| TX | `infra/tofu/keycloak` | `/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate` |
| Yecao | `infra/tofu/grafana` | `/opt/wotb/grafana-tofu-state/terraform.tfstate` |
| Yecao | `infra/tofu/komodo` | `/opt/komodo/tofu-state/terraform.tfstate` |

## Owner-host prerequisites

The owner workflows and the nightly state backup run with these host tools: `tofu`,
`flock`, `curl`, and `jq`. `jq` is a hard requirement of the Grafana plan guard
(`.github/workflows/observability.yml`, `infra/tofu/grafana/validate-plan.sh`) and of
the TX Keycloak runner (`deploy/tx/keycloak-tofu.sh`); a host without it fails the
workflow before any plan is produced. Both hosts were verified on 2026-09-28
(Asia/Hong_Kong): TX has all four, Yecao was missing `jq` and needs
`apt-get install -y jq` once.

`deploy/tofu-local-state-backup.sh` (invoked by `.github/workflows/database-backup.yml`)
requires **every** state file listed above plus the `bootstrap-complete` marker for each
adopted root. A missing `keycloak-tofu-state` (TX), `grafana-tofu-state` (Yecao), or
`tofu-state` (Komodo) therefore fails the state-backup jobs as well, not only the owner
deploy workflows. The Komodo target is the third backup root
(`deploy/tofu-local-state-backup.sh komodo`); it takes `/opt/komodo/.deploy.lock`, so a
controller mutation and its state backup can never overlap.

## Bootstrap boundary

Every owner workflow checks for a regular, non-empty, non-symlink state file
before `tofu init`, planning, or production mutation. A missing file means local
state has not been bootstrapped. The workflow stops with an explicit error; it
never initializes an empty production state or applies an empty-state plan.
The three newly adopted roots also require a non-symlink
`bootstrap-complete` file containing `local-tofu-state-bootstrap-v1` in the
same persistent directory. Create that marker manually only after every
existing resource is imported and the authenticated plan reports zero add,
change, and destroy. A partial import therefore remains blocked even when it
has already written a non-empty state file. The existing `postgres-business`
state does not use or require this marker. The Komodo root uses the same marker
contract but is not an adoption: `infra/tofu/komodo` is new and its first
bootstrap creates the controller DNS record. `deploy/komodo/reconcile.sh` writes
the marker itself after the first clean second plan, and fails closed on a state
file without a marker (or a marker without its state) instead of re-initializing.

After the final zero-change plan, the owner may write the marker on that host:

```sh
printf '%s\n' local-tofu-state-bootstrap-v1 > "$state_dir/bootstrap-complete"
chmod 600 "$state_dir/bootstrap-complete"
```

Do not create the marker before all imports and the zero-change verification
complete.

`postgres-business` already has authoritative local state and must keep using
it. The other three roots need an explicit, owner-host bootstrap before normal
deployments resume:

- `postgres-keycloak`: adopt `postgresql_role.keycloak` (`keycloak`),
  `postgresql_database.keycloak` (`keycloak`), and
  `postgresql_grant.keycloak_database_access` (database `keycloak`, role
  `keycloak`). Confirm the installed provider's import syntax against the live
  objects before importing.
- `keycloak`: adopt the existing `wotbtools` realm, its declared clients, IdPs,
  realm roles, default role assignment, protocol mappers, and service-account
  role assignments. Provider IDs for the realm, clients, mappers, IdPs, and
  service accounts must be read from the live Keycloak API; repository names
  alone do not establish all import IDs.
- `grafana`: adopt the six existing managed dashboards using the import
  addresses and UIDs in `docs/architecture/grafana-opentofu.md`.

Bootstrap is a manual, root-by-root operation under the owner's `.deploy.lock`.
Verify the destination state and marker are absent before initialization. Use
the fixed local backend, import/adopt existing objects, then require a plan
with zero add, change, or destroy before creating the marker and enabling normal
workflows. Never apply an empty-state plan to production. This repository has no bootstrap helper or
COS compatibility path. If any identity or import ID cannot be verified from
the actual owner-host API, stop and resolve that inventory before importing.

## Backup

`database-backup.yml` invokes `deploy/tofu-local-state-backup.sh` on each owner
host. TX archives all three TX state files; Yecao archives Grafana state and, as a
separate root, the Komodo controller state (`deploy/tofu-local-state-backup.sh
komodo` → `/opt/komodo/backups/opentofu-state/`). The
script shares the host deployment lock, rejects missing, empty, non-regular, or
symlink state files/directories, requires the three adopted-root completion
markers plus the Komodo marker, and archives those markers with the states. It writes under
`backups/opentofu-state` with restrictive permissions, validates the tar
archive and SHA-256 checksum, and does not print state contents or upload raw
state to GitHub artifacts.

State directories and files must remain owner-only and persistent through
staging cleanup. Do not delete or replace the existing `postgres-business`
state. Local-state loss recovery requires a separately reviewed restore from
the owner-host archive; an empty backend must never be used as a substitute.

Removing the legacy COS, Lighthouse, and firewall IaC ownership does not
destroy those cloud resources. COS may have a separate future product/static
asset use; that is outside this state-backend change.
