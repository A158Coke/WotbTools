# TX Business PostgreSQL OpenTofu boundary

`infra/tofu/postgres-business` is an isolated OpenTofu root for the TX Business
PostgreSQL application role, database, and database grant. It is independent
of the Grafana and Keycloak PostgreSQL roots and uses local TX-only state:

```text
/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate
```

`deploy/tx/deploy.sh` creates the parent directory with mode 0700, and the
application role password uses the provider write-only field, so the state holds
no application credential attribute.

Docker Compose creates and runs `business-postgres`; it exposes the
administration port only on TX loopback as `127.0.0.1:25432:5432`. The
PostgreSQL provider is hard-constrained to `127.0.0.1:25432`, so it cannot reach
a public endpoint, the WireGuard network, or the Keycloak PostgreSQL runtime.

## Ownership split

```text
Compose   runtime, image, volume, loopback admin port, healthcheck, restart, memory limit
OpenTofu  wotb database, control_api role, database-level grant
Flyway    application schema, tables, indexes, sequences, rows
```

The OpenTofu root declares no schema, table, index, sequence, or extension. It
also declares no application business table, and no table may be created outside
Flyway.

The application role is a least-privilege login role: no `superuser`,
`createdb`, `createrole`, `replication`, or `bypassrls`. The database-level grant
covers `CONNECT`, `CREATE`, and `TEMPORARY`; schema objects stay owned by Flyway.

## Workflow split

1. Pull requests run `tofu fmt -check`, `tofu init -backend=false`,
   `tofu validate`, the plan-policy fixtures, and the contract script on
   GitHub-hosted runners. A pull request never reaches TX: no SSH step, no
   production-local state and no database plan or connection exists there.
2. A merged main change is staged into an immutable SHA-named directory on
   TX through SSH, and the `business-postgres` Deploy lane starts the runtime and
   waits for `pg_isready`.
3. The TX host creates one saved plan against `127.0.0.1:25432`, rejects
   destructive changes, applies that exact plan, requires a completely clean
   second plan, and only then writes the root-only
   `/opt/wotb-tx/business-postgres.tofu-provisioned` marker. The runtime and
   root run in one locked SSH session owned by
   `.github/workflows/business-postgres.yml`.

The standalone workflow uses the shared `production-maintenance` GitHub Actions
concurrency group and a TX host `flock` covering runtime, apply, second plan,
verification, and marker update. GitHub Actions does not connect directly to
the database; OpenTofu runs on TX.

Provider installation is mirror-based and fail-closed:
`deploy/tx/business-postgres.tofurc` allowlists only
`/opt/wotb-tx/tofu-provider-mirror` for `cyrilgdn/postgresql` and explicitly
excludes direct installation.

## Safety behavior

`prevent_destroy` protects the managed role, database, and grant, and
`infra/tofu/postgres-business/validate-plan.sh` rejects every delete and
replacement before apply:

- any `delete` action, including role deletion and `delete`+`create`;
- any update to the database or the grant;
- any resource address outside the three declared addresses;
- a non-empty change set for the post-apply second plan (`--require-no-changes`).

A known safe application password rotation is an in-place `update` of
`postgresql_role.control_api` only; the second plan must then be entirely no-op.

Because the helper runs the provisioning steps from inside an `if`/`||`
context, the steps are chained explicitly rather than relying on `errexit`,
which bash disables for functions invoked in that position.

## Runtime check

Business PostgreSQL is authoritative state, so the read-only
`deploy/tx/runtime-check.sh` check requires its container health,
`pg_isready`, an exactly loopback `127.0.0.1:25432:5432` publication, and the
`tx-local-opentofu-business-postgres` provisioning marker before it may emit
`TX_RUNTIME_READY`. Any failure emits `TX_RUNTIME_NOT_READY`; the check never
creates, modifies, or deletes a database or row.

Removing an address from this root is not a supported retirement process.
Database retirement, Keycloak user migration, and production data movement are
separate, operator-approved operations; the source database is never deleted as
part of a backup or restore. Operational details, credential names, and the
backup/restore procedure are in `docs/operations/business-postgres.md`.
