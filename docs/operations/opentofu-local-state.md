# OpenTofu owner-host local state

OpenTofu state is stored on the host that owns each root. Workflows may stage
source under a per-SHA directory, but the backend path is fixed outside that
directory and state-file checks run before OpenTofu initialization or service
mutation. A missing or unsafe file stops the workflow; the workflow never
creates an empty replacement state.

| Owner | Root | Persistent state |
|---|---|---|
| TX | `infra/tofu/postgres-business` | `/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate` |
| TX | `infra/tofu/postgres-keycloak` | `/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate` |
| TX | `infra/tofu/keycloak` | `/opt/wotb-tx/keycloak-tofu-state/terraform.tfstate` |
| Yecao | `infra/tofu/grafana` | `/opt/wotb/grafana-tofu-state/terraform.tfstate` |

The Business PostgreSQL root already uses its listed path. The other three
roots are migrated once on their owner host with
`deploy/tofu-cos-to-local.sh <root> <staged-root>`. The command is not called
by a normal workflow. It requires the expected root-specific COS credentials,
checks the fixed COS bucket/key and default workspace, requires a non-empty
source and an absent destination, and requires zero-change plans both before
and after `tofu init -migrate-state`. It compares source and destination
resource address lists, suppresses plan/state output, never runs apply, and
never deletes the COS source. A non-zero plan or any failed check stops that
root immediately. Run each root separately; do not continue after a failure.

Inject the plan inputs into the owner-host process environment (never command
arguments, a tfvars file, or a logged shell command). In addition to
`TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` for the COS backend:

- `keycloak` requires `TF_VAR_keycloak_admin_password`,
  `TF_VAR_keycloak_admin_client_secret`,
  `TF_VAR_keycloak_admin_client_secret_version`, `TF_VAR_e2e_client_secret`,
  `TF_VAR_e2e_client_secret_version`, `TF_VAR_wargaming_application_id`,
  `TF_VAR_qq_client_id`, and `TF_VAR_qq_client_secret`.
- `postgres-keycloak` requires `TF_VAR_postgresql_admin_password` and
  `TF_VAR_keycloak_role_password`.
- `grafana` requires `GRAFANA_PAT`; the migration command maps it to
  `TF_VAR_grafana_auth`.

The command checks the root-specific values before connecting to COS. It also
clears inherited OpenTofu trace-logging variables so backend/provider traces
cannot bypass the protected temporary log.

The source directory may be removed after deploy. State remains at the table's
fixed owner-host path. State directories are root-only; state files and backups
use mode 0600. The existing `database-backup.yml` also archives all three TX
states and the Yecao Grafana state to each owner's local
`backups/opentofu-state` directory, verifies the tar archive, and writes a
SHA-256 sidecar. The backup contains no PostgreSQL state database and requires
no inter-host state connection.

The historical COS backend and its bucket must remain available until the
owner-host migration and both zero-change validations have succeeded. COS
artifacts, the legacy `infra/tofu/environments/prod` root, and Lighthouse or
firewall ownership are retired only in a follow-up after that cutover is
verified. Retiring their IaC ownership must not destroy those resources.
