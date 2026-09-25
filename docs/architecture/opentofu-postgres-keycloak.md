# TX Keycloak PostgreSQL OpenTofu boundary

`infra/tofu/postgres-keycloak` is an isolated OpenTofu root for the TX
Keycloak PostgreSQL application role, database, and database grant. It is not
part of the legacy COS/Lighthouse root or the Grafana root. Its persistent
state is TX-local at
`/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate`.

Docker Compose creates and runs `keycloak-postgres`; it exposes the management
port only on TX loopback as `127.0.0.1:15432:5432`. The PostgreSQL provider is
hard-constrained to `127.0.0.1:15432`, so it cannot reach a public database
endpoint or the Yecao service over WireGuard.

The GitHub workflow is deliberately split:

1. Pull requests run `tofu fmt`, `tofu init -backend=false`, and `tofu validate`
   on GitHub-hosted runners. A pull request never reaches TX: no SSH step, no
   production-local state and no database plan or connection exists there.
2. A merged main change is staged into an immutable SHA-named directory
   on TX through SSH.
3. GitHub Actions injects the required `TF_VAR_*` variables over the SSH
   session; TX uses its persistent local state, creates one saved plan
   against its local loopback PostgreSQL port, rejects destructive changes, and
   applies that exact plan. This runs in one locked SSH session owned by
   `.github/workflows/keycloak-postgres.yml` (root `keycloak-postgres`).

The standalone workflow uses the shared GitHub Actions
`production-maintenance` concurrency group and TX host `flock`. This
serializes updates to the owner-host state; operator-run commands must use the
same host lock.

GitHub Actions Secrets/Variables are the sole TX configuration entry point for
the provider administrator password, Keycloak role
password, and non-secret role-password rotation version. Values are never
written to a TX env file, tfvars file, or repository artifact. The provider uses `password_wo`, which
keeps the Keycloak role password out of local state; the administrator
password is used only for provider configuration and is likewise not a managed
resource attribute.

Role, database, and grant each use `prevent_destroy`; the TX pre-apply guard
also rejects delete/replacement plan actions. A retirement or reset is an
explicit, separately audited operation, never an automatic consequence of
normal infrastructure deployment.
