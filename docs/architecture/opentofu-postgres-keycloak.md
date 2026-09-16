# TX Keycloak PostgreSQL OpenTofu boundary

`infra/tofu/postgres-keycloak` is an isolated OpenTofu root for the TX
Keycloak PostgreSQL application role, database, and database grant. It is not
part of the existing COS/Lighthouse root or the Grafana root, and uses the
separate COS state key `wotbtools/prod/postgres-keycloak.tfstate`.

Docker Compose creates and runs `keycloak-postgres`; it exposes the management
port only on TX loopback as `127.0.0.1:15432:5432`. The PostgreSQL provider is
hard-constrained to `127.0.0.1:15432`, so it cannot reach a public database
endpoint or the Yecao service over WireGuard.

The GitHub workflow is deliberately split:

1. Pull requests run `tofu fmt`, `tofu init -backend=false`, and `tofu validate`
   on GitHub-hosted runners. No runner-side database plan or connection exists.
2. A merged main change is copied to an immutable SHA-named staging directory
   on TX through SSH.
3. GitHub Actions injects the required COS and `TF_VAR_*` variables over the
   SSH session; TX initializes the existing COS backend, creates one saved plan
   against its local loopback PostgreSQL port, rejects destructive changes, and
   applies that exact plan.

Both the normal deployment workflow and the manual postgres-keycloak workflow
use the same GitHub Actions `production-maintenance` concurrency group. This
is the required serialization boundary for the shared
`wotbtools/prod/postgres-keycloak.tfstate`; operator coordination is not a
substitute for the workflow-level lock.

GitHub Actions Secrets/Variables are the sole TX configuration entry point for
the COS backend credentials, provider administrator password, Keycloak role
password, and non-secret role-password rotation version. Values are never
written to a TX env file, tfvars file, or repository artifact. The provider uses `password_wo`, which
keeps the Keycloak role password out of remote state; the administrator
password is used only for provider configuration and is likewise not a managed
resource attribute.

Role, database, and grant each use `prevent_destroy`; the TX pre-apply guard
also rejects delete/replacement plan actions. A retirement or reset is an
explicit, separately audited operation, never an automatic consequence of
normal infrastructure deployment.
