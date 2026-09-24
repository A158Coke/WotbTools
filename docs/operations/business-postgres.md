# TX Business PostgreSQL infrastructure boundary

PostgreSQL is the authoritative business and job state. RabbitMQ is delivery,
retry, and backpressure only. MinIO is a temporary workspace. Business
PostgreSQL is deliberately independent from Keycloak PostgreSQL:

```text
Compose        business-postgres                        keycloak-postgres
OpenTofu root  infra/tofu/postgres-business             infra/tofu/postgres-keycloak
state          /opt/wotb-tx/postgres-business-tofu-state  tofu_state / isolated backend schemas
port           127.0.0.1:25432 + 10.20.0.1:25432       127.0.0.1:15432
volume         business_postgres_data                   keycloak_postgres_data
marker         business-postgres.tofu-provisioned       keycloak.tofu-provisioned
```

Business tables never live in `keycloak-postgres`, and no business table is
created outside Flyway.

## Resource ownership

`deploy/tx/docker-compose.yml` owns the `business-postgres` runtime only:

- image `postgres:18-alpine` (never a floating tag);
- administration port `127.0.0.1:25432:5432` for TX-local administration and
  `10.20.0.1:25432:5432` for the authenticated Yecao WireGuard peer only;
  wildcard/public binds are forbidden;
- volume `business_postgres_data`;
- `POSTGRES_DB=postgres` so the image entrypoint never auto-creates the
  OpenTofu-owned business database when the bootstrap administrator is named
  `wotb`;
- bootstrap administrator `TX_BUSINESS_POSTGRES_ADMIN_USER` /
  `TX_BUSINESS_POSTGRES_ADMIN_PASSWORD`, distinct from the application role;
- `pg_isready` healthcheck, `restart: unless-stopped`, and a 512m memory limit.

The application credential is intentionally absent from the `business-postgres`
service in the Compose document: that runtime never receives it. Its only
consumer is the TX business runtime `business-api`
(`deploy/tx/docker-compose.yml`), which is also the process that runs Flyway.

`infra/tofu/postgres-business` owns the business database and application role,
plus the dedicated OpenTofu state database, state login, and three isolated
backend schemas:

```text
postgresql_database.wotb                        owner = control_api, UTF8, template0
postgresql_role.control_api                     login, no superuser/createdb/createrole/replication/bypassrls
postgresql_grant.control_api_database_access    CONNECT, CREATE, TEMPORARY on wotb
postgresql_database.tofu_state                  isolated state database with PUBLIC access revoked
postgresql_role.tofu_state                      dedicated login; no business database access
postgresql_schema.tofu_backend                  tofu_keycloak, tofu_keycloak_postgres, tofu_grafana
```

All managed resources use `prevent_destroy`. Flyway
(`java/wotb-web/src/main/resources/db/migration`) remains the single owner of
the application schema, tables, indexes, and sequences; the OpenTofu root
declares no schema object.

## Credentials and state

```text
TX_BUSINESS_POSTGRES_ADMIN_USER       GitHub Actions Variable
TX_BUSINESS_POSTGRES_ADMIN_PASSWORD   GitHub Actions Secret
TX_BUSINESS_DB_NAME                   GitHub Actions Variable (wotb)
TX_BUSINESS_DB_USERNAME               GitHub Actions Variable (control_api)
TX_BUSINESS_DB_PASSWORD               GitHub Actions Secret
TX_BUSINESS_DB_PASSWORD_VERSION       GitHub Actions Variable (rotation version)
TX_TOFU_STATE_PASSWORD                GitHub Actions repository-level Secret
TX_TOFU_STATE_PASSWORD_VERSION        GitHub Actions Variable (rotation version)
```

Values are forwarded only to the TX process environment and then to OpenTofu
`TF_VAR_*` inputs. They must never be committed, written to a server env file,
printed in logs, or stored in tfvars. The application role password uses the
provider write-only field (`password_wo` plus `password_wo_version`), so it is
not persisted as a state attribute. Sensitive `postgres-business` state stays
TX-local at `/opt/wotb-tx/postgres-business-tofu-state/terraform.tfstate` under
a 0700 parent directory. The same Business PostgreSQL runtime hosts a separate
`tofu_state` database for the `keycloak`, `postgres-keycloak`, and `grafana`
remote states. Only the dedicated `tofu_state` role can connect to that
database. TX roots use `127.0.0.1:25432`; Grafana uses `10.20.0.1:25432` over
WireGuard. Keycloak's application database remains on the independent
`keycloak-postgres` runtime.

A `business-postgres`-only deployment requires none of the Keycloak, RabbitMQ,
frontend image, or Caddy inputs. RabbitMQ remains reachable only through
`10.20.0.1:5672`; Business PostgreSQL binds TX loopback plus its existing
WireGuard interface and is never published on a wildcard/public address.

## TX provisioning sequence

The single-service Deploy (`service=business-postgres`) and the single-root Tofu
Apply (`root=business-postgres`) split this sequence; there is no `all` selector:

```text
Deploy lane (deploy/tx/deploy.sh)
1. validate inputs and render the Compose document
2. start the business-postgres runtime and wait for pg_isready
3. require the root-only /opt/wotb-tx/business-postgres.tofu-provisioned marker

OpenTofu phase in `.github/workflows/business-postgres.yml` (same TX host-lock session)
4. TX-local OpenTofu init -lockfile=readonly / validate / saved plan
5. plan safety validation
6. apply the exact saved plan
7. second plan
8. require a completely clean (no-op) second plan
9. write the root-only /opt/wotb-tx/business-postgres.tofu-provisioned marker
```

The standalone workflow orders the runtime and OpenTofu phases in the same
locked host session. A non-clean second plan fails the workflow. Unknown
resource addresses, destructive actions, and unexpected updates are rejected
before apply. GitHub
Actions never connects to the database: it only transfers the root over SSH and
the TX host calls the provider on `127.0.0.1:25432`.

The Tofu Apply lane chains each provisioning step explicitly and never invokes the
provisioning helpers from an `||` list, because bash disables `errexit` inside a
function called that way and a dirty plan would otherwise be ignored.

## Runtime check

`deploy/tx/runtime-check.sh` reads `TX_BUSINESS_POSTGRES_ADMIN_USER` and
refuses `TX_RUNTIME_READY` until Business PostgreSQL is fully ready:

- the `business-postgres` container exists and reports `healthy`;
- `pg_isready -U "$TX_BUSINESS_POSTGRES_ADMIN_USER" -d postgres` succeeds;
- the published administration ports are exactly `127.0.0.1:25432:5432` and
  `10.20.0.1:25432:5432`; a `0.0.0.0`, `::`, or bare `25432:5432` bind fails;
- `/opt/wotb-tx/business-postgres.tofu-provisioned` exists and contains exactly
  `tx-local-opentofu-business-postgres`.

Any failure emits `TX_RUNTIME_NOT_READY`. These checks are read-only: they
never create, modify, or delete a database, table, or row.

## Provider mirror

Production provider installation is mirror-based and fail-closed. An operator
installs the exact locked `cyrilgdn/postgresql 1.27.0` archive beneath
`/opt/wotb-tx/tofu-provider-mirror`. `deploy/tx/business-postgres.tofurc`
includes only that filesystem mirror for this provider and excludes direct
installation, so a missing mirror fails the deployment instead of downloading
from the public registry. The mirror may also hold the RabbitMQ provider; each
`.tofurc` allowlists only its own provider.

## Application password rotation

1. Generate a new password and set the `TX_BUSINESS_DB_PASSWORD` secret.
2. Increment `TX_BUSINESS_DB_PASSWORD_VERSION`.
3. Run the `business-postgres` target.

The plan must contain a single in-place `update` of
`postgresql_role.control_api`, which is the only accepted non-create change. The
second plan must then be entirely no-op. A `delete`+`create` replacement is
rejected because it would detach the role from the authoritative database owner.

## Backup

Business PostgreSQL is authoritative state, so backups are a required operation:

```text
deploy/tx/business-postgres-backup.sh [--backup-root DIR] [--retention-minutes N] [--skip-retention]
```

- Runs `pg_dump --format=custom --no-owner --no-privileges` as the bootstrap
  administrator for `wotb` and `tofu_state`, producing one archive and SHA-256
  sidecar per database. A missing selected database fails the run.
- Writes `<database>-<UTC timestamp>.dump` plus a `.dump.sha256` sidecar into
  `/opt/wotb-tx/backups/business-postgres` (0700 directory, 0600 files).
- Validates each archive catalog (`pg_restore --list`) and every compressed data
  block (`pg_restore --file=/dev/null`) before the file is published, and only
  then renames the temporary file into place.
- Applies retention to older `*.dump` files (default 10080 minutes).
- **Never** drops, truncates, or deletes the source database or its rows. There
  is no `DROP`/`DELETE`/`TRUNCATE` path in the backup script.

Backup files may be stored on TX root-only storage as above. This PR does not
introduce any external backup platform, object-storage upload, or scheduled
backup workflow; such a platform is a separate, explicitly approved change.

## Restore

Restores are verified into a disposable database, never over the authoritative
one:

```text
deploy/tx/business-postgres-restore.sh --file <dump> --database <scratch> --confirm RESTORE-<scratch>
deploy/tx/business-postgres-restore.sh --file <dump> --verify-only
```

- `--verify-only` checks the SHA-256 sidecar and the full archive integrity
  without creating, modifying, or deleting any database.
- The script refuses to target either authoritative Business database (`wotb`
  or `tofu_state`), and
  requires the exact `--confirm RESTORE-<scratch>` opt-in token.
- It creates the scratch database, restores with `--exit-on-error`, and prints
  the verification SQL an operator must run before declaring the archive
  restorable.

Verification after a restore (also documented by the script output):

```sql
select count(*) from hall_of_fame_record;
select min(id), max(id) from hall_of_fame_record;
select pg_get_serial_sequence('hall_of_fame_record', 'id') as identity_sequence;
select last_value, is_called from pg_sequences
 where schemaname = 'public' and sequencename like 'hall_of_fame_record%';
select arena_id, account_id, count(*) from hall_of_fame_record
 group by 1, 2 having count(*) > 1;
select count(*) from hall_of_fame_record where replay_uploaded_by is not null;
```

## Hall of Fame migration compatibility

Production Yecao currently holds `hall_of_fame_record` with explicit ids and a
sequence that had reached 355. A data-only dump already exists externally and is
**not** part of this repository; this PR does not import it and does not migrate
production data. It only makes the TX database a valid future migration target:

- explicit ids are preserved by `overriding system value` inserts and by
  `pg_dump`'s `setval` statements, so a restored sequence continues past the
  imported maximum;
- `pg_dump` carries `setval`, so after a data-only import the operator must
  confirm `last_value` is at or above `max(id)` (355 at the snapshot);
- the unique key remains `(arena_id, account_id)`;
- `hall_of_fame_record` has no outbound foreign key, so it never couples to
  fresh Keycloak users or to `user_profile`;
- `replay_uploaded_by` stays a nullable literal `varchar` holding historical
  Keycloak UUIDs as opaque data. No FK to any Keycloak-owned identity may be
  introduced.

The source Yecao database must never be deleted as part of a backup, restore, or
import; retiring or dropping it is a separate, operator-approved migration.

## Verification

```text
bash infra/tofu/postgres-business/test-validate-plan.sh          # plan-policy fixtures
bash scripts/ci/test-postgres-business-tofu-contract.sh          # root/workflow/deploy contract
bash deploy/test-business-postgres-runtime.sh                    # disposable PostgreSQL 18 + real provider + backup/restore
bash deploy/test-tx-runtime-config.sh                            # Compose + isolation + provisioning order
mvn -pl wotb-web -Dtest=HofOwnershipMigrationTest test           # empty-database Flyway build and HoF properties
```

`deploy/test-business-postgres-runtime.sh` mirrors the provider into a temporary
directory, applies the root against a disposable `postgres:18-alpine` container,
proves the application role is a non-superuser that can create tables in its own
database, requires a clean second plan, and then exercises the real
backup/restore scripts on a Hall-of-Fame-shaped table (explicit ids, unique key,
literal Keycloak UUID, identity sequence).
