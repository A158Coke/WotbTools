# TX Business PostgreSQL OpenTofu root

This root owns logical resources in the existing Business PostgreSQL runtime:
the authoritative `wotb` database and `control_api` application role, plus the
isolated `tofu_state` database, its dedicated login role, and its three backend
schemas. Docker Compose owns the `business-postgres` runtime container and must
publish its administration port on TX loopback and the existing TX WireGuard
address only (`127.0.0.1:25432:5432` and `10.20.0.1:25432:5432`). The second
binding serves only the authenticated Yecao peer for the Grafana state backend;
no wildcard/public interface or additional PostgreSQL runtime is created.

Business PostgreSQL is deliberately independent from Keycloak PostgreSQL:

```text
Compose        business-postgres        keycloak-postgres
OpenTofu root  infra/tofu/postgres-business   infra/tofu/postgres-keycloak
state          postgres-business-tofu-state/  tofu_state / tofu_keycloak_postgres
marker         business-postgres.tofu-provisioned   keycloak.tofu-provisioned
```

No business table, index, sequence, or row is ever created here. Flyway
(`java/wotb-web/src/main/resources/db/migration`) remains the single owner of
the application schema. OpenTofu creates only the `tofu_state` backend schemas;
the pg backend owns its state tables and lock sequence.

The `tofu_state` database denies database and `public` schema privileges to
`PUBLIC`, then grants the dedicated role only its database access and the
`public` schema permissions needed for OpenTofu's backend lock-ID sequence.
The state role has no privileges on Business tables; `control_api` cannot
connect to `tofu_state`.
The backend schemas are `tofu_keycloak`, `tofu_keycloak_postgres`, and
`tofu_grafana`.

The three service roots use the PostgreSQL `pg` backend. TX roots connect to
`127.0.0.1:25432`; the Yecao Grafana root connects to `10.20.0.1:25432` over
WireGuard. Credentials use libpq environment variables, never backend config,
repository files, plan files, or artifacts. The TX-owned
`.github/workflows/migrate-tofu-state.yml` is a one-time serial migration lane;
each root gets a separate protected temporary work directory, and the next
root runs only after the previous migration's immediate plan is clean.
`TOFU_STATE_BACKEND_READY=true` is a **repository-level Actions variable** that
gates regular service owner reconciliations until all three state migrations
and recovery checks are complete. Do not create it as an environment-only
variable: workflow job conditions read it before environment-scoped values are
available. `TX_TOFU_STATE_PASSWORD` is a repository-level Actions secret so
both TX and Yecao owner workflows can receive the same dedicated login
credential.

## Execution boundary

OpenTofu plans and applies execute on TX, never on a GitHub-hosted runner. The
workflow checks formatting and configuration without a backend on GitHub, copies
this root to an immutable TX staging directory, then invokes `tofu` over SSH.
The provider is hard-constrained to `127.0.0.1:25432`; it cannot use a public
address or the WireGuard network. This root contains no `remote-exec`, SSH
tunnel, or provisioner.

Sensitive state is local and root-only:

```text
/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate
```

`deploy/tx/deploy.sh` creates the parent directory with mode 0700. The
application role password uses the provider `password_wo` field together with
`business_role_password_version`, so it is not persisted as a state attribute;
the administrator password is consumed only by provider configuration.

## Credential injection

Values arrive only through the TX deploy process environment, which GitHub
Actions injects over the SSH session through `secrets.*` / `vars.*`. No
operator-maintained TX env file is required and none may be introduced.

```text
TX_BUSINESS_POSTGRES_ADMIN_USER       GitHub Actions Secret/Variable
TX_BUSINESS_POSTGRES_ADMIN_PASSWORD   GitHub Actions Secret
TX_BUSINESS_DB_NAME                   GitHub Actions Variable
TX_BUSINESS_DB_USERNAME               GitHub Actions Variable
TX_BUSINESS_DB_PASSWORD               GitHub Actions Secret
TX_BUSINESS_DB_PASSWORD_VERSION       GitHub Actions Variable
TX_TOFU_STATE_PASSWORD                GitHub Actions Secret
TX_TOFU_STATE_PASSWORD_VERSION        GitHub Actions Variable
```

The deploy script maps them onto `TF_VAR_postgresql_admin_username`,
`TF_VAR_postgresql_admin_password`, `TF_VAR_business_role_password`,
`TF_VAR_business_role_password_version`, and `TF_VAR_tofu_state_role_password`
with its rotation version. Do not put any password in
`terraform.tfvars`, workflow inputs, logs, state, or a plan artifact.

## Safety behavior

`prevent_destroy` protects the managed roles, databases, grants, and backend
schemas while they
remain declared. `validate-plan.sh` additionally rejects:

- any delete action, including role deletion and `delete`+`create` replacement;
- any update to the database or the grant;
- any resource address outside the declared logical resources;
- a non-empty change set for the post-apply second plan (`--require-no-changes`).

A known safe credential rotation is an in-place `update` of either managed
login role only; the second plan must still be entirely no-op
afterwards. Removing an address from this root is not a supported retirement
process - database retirement is a separately approved, audited migration, and
the source database is never deleted as part of a backup or restore.

## Provider mirror

Production provider installation is mirror-based and fail-closed. An operator
installs the exact locked `cyrilgdn/postgresql 1.27.0` archive beneath
`/opt/wotb-tx/tofu-provider-mirror`; `deploy/tx/business-postgres.tofurc`
includes only that filesystem mirror for this provider and explicitly excludes
direct installation. A missing mirror or CLI configuration fails the deployment
before any plan is created.

## Verification

```text
bash infra/tofu/postgres-business/test-validate-plan.sh     # policy fixtures, no database
bash scripts/ci/test-postgres-business-tofu-contract.sh     # workflow/root contract
bash deploy/test-business-postgres-runtime.sh               # disposable PG 18 + real provider
```

The runtime smoke mirrors the provider into a temporary directory, applies the
root against a disposable `postgres:18-alpine` container, proves application
and state role isolation, creates all three backend schemas, tests backups of
both databases and a protected state-database restore, and requires a clean
second plan.
