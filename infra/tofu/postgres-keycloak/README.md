# TX Keycloak PostgreSQL OpenTofu root

This root owns only the Keycloak PostgreSQL application role, its dedicated
database, and the database-level grant. Docker Compose owns the
`keycloak-postgres` runtime container and must publish its administration port
only as `127.0.0.1:15432:5432` on TX.

## Execution boundary

OpenTofu plans and applies execute on TX, never on a GitHub-hosted runner.
The workflow checks formatting and configuration without a backend on GitHub,
copies this root to an immutable TX staging directory, then invokes `tofu` over
SSH. The provider is constrained to `127.0.0.1:15432`; it cannot use a public
address or the WireGuard network. This root contains no `remote-exec`, SSH
tunnel, or provisioner.

The TX owner host stores persistent local state outside the per-SHA source
staging directory:

```text
/opt/wotb-tx/postgres-keycloak-tofu-state/terraform.tfstate
```

## GitHub Actions secret injection

The main-branch and manual workflows inject the following environment variables
over the SSH session that runs OpenTofu on TX. No operator-maintained TX env file
is required:

```text
TF_VAR_postgresql_admin_username=kc_admin
TF_VAR_postgresql_admin_password=...
TF_VAR_keycloak_role_password=...
TF_VAR_keycloak_role_password_version=1
```

The PostgreSQL administrator password is consumed only by provider configuration.
The application role password uses the provider's `password_wo` field, so it is
not persisted in OpenTofu state. Password rotation changes the password and
increments `TF_VAR_keycloak_role_password_version` as a non-secret GitHub
Actions variable.

Do not put either password in `terraform.tfvars`, GitHub workflow input,
GitHub Actions environment, OpenTofu state, or a plan artifact. The remote
workflow deletes its local binary plan on exit.

## Safety behavior

`prevent_destroy` protects the managed role, database, and grant while they
remain declared. `validate-plan.sh` additionally rejects every delete or
replacement of those addresses before an apply. Removing an address from this
root is therefore not a supported retirement process; make a separately
approved, audited migration instead.

The root assumes the Compose runtime is already healthy and has bound the
loopback port. Missing injected variables, unavailable local port, missing
persistent state, or unsafe plan fails closed; the workflow does not fall back
to a runner-side database connection. See
`docs/operations/opentofu-local-state.md` for one-time migration and backup.

After the successful TX-local Keycloak OpenTofu apply in `.github/workflows/keycloak.yml`,
the deployment writes the root-only `/opt/wotb-tx/keycloak.tofu-provisioned` marker.
The Keycloak runtime deployment refuses to start without that exact marker; the
frontend and Caddy owners do not depend on Keycloak realm provisioning. If an
operator intentionally resets the Keycloak PostgreSQL volume, they must remove
the marker as part of that separately approved bootstrap procedure.
