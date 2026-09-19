# TX Business PostgreSQL OpenTofu root

This root owns only the Business PostgreSQL logical resources: the authoritative
`wotb` database, the `control_api` application role, and its database-level
grant. Docker Compose owns the `business-postgres` runtime container and must
publish its administration port only as `127.0.0.1:25432:5432` on TX.

Business PostgreSQL is deliberately independent from Keycloak PostgreSQL:

```text
Compose        business-postgres        keycloak-postgres
OpenTofu root  infra/tofu/postgres-business   infra/tofu/postgres-keycloak
local state    postgres-business-tofu-state/  (COS key) postgres-keycloak.tfstate
marker         business-postgres.tofu-provisioned   keycloak.tofu-provisioned
```

No business table, index, sequence, or row is ever created here. Flyway
(`java/wotb-web/src/main/resources/db/migration`) remains the single owner of the
application schema; OpenTofu declares only database, role, and grant.

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
```

The deploy script maps them onto `TF_VAR_postgresql_admin_username`,
`TF_VAR_postgresql_admin_password`, `TF_VAR_business_role_password`, and
`TF_VAR_business_role_password_version`. Do not put either password in
`terraform.tfvars`, workflow inputs, logs, state, or a plan artifact.

## Safety behavior

`prevent_destroy` protects the managed role, database, and grant while they
remain declared. `validate-plan.sh` additionally rejects:

- any delete action, including role deletion and `delete`+`create` replacement;
- any update to the database or the grant;
- any resource address outside the three declared addresses;
- a non-empty change set for the post-apply second plan (`--require-no-changes`).

A known safe application password rotation is an in-place `update` of
`postgresql_role.control_api` only; the second plan must still be entirely no-op
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
root against a disposable `postgres:18-alpine` container, proves the application
role is a non-superuser that can create tables in its own database, and requires
a completely clean second plan.
