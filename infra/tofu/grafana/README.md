# Grafana OpenTofu root

This root manages the existing Grafana dashboard API objects in organization 1
while Docker Compose continues to manage the Grafana runtime container and
database. Prometheus and Loki datasources remain file-provisioned because
Grafana marks them read-only and the provider rejects importing them as
resources.

The canonical dashboard JSON remains under
`deploy/observability/grafana/dashboards`; this root reads those files instead
of copying them. The dashboard file-provisioning controller must be removed
from the runtime in the same change so that OpenTofu and provisioning never
manage the same dashboard. Datasource provisioning remains the sole datasource
controller.

The Yecao owner host stores persistent local state at
`/opt/wotb/grafana-tofu-state/terraform.tfstate`, outside the per-SHA source
staging directory. The workflow refuses to initialize if that state is missing
or unsafe. Existing production dashboards must be adopted into a new local
state before the owner workflow can run; local backup behavior is documented in
`docs/operations/opentofu-local-state.md`. Pull requests run only local
format/init/validate checks. A change merged to `main` runs the Grafana root
inside `.github/workflows/observability.yml`, which applies the exact saved
plan after the dashboard-delete safety gate and verifies all managed dashboard
UIDs.

Automatic apply intentionally blocks every `grafana_dashboard` delete (and any
future provider-managed datasource delete). Dashboard deletion therefore
requires a separately reviewed manual process. GitHub Actions concurrency
serializes Grafana plan/apply workflows, but does not lock against owner-run
OpenTofu commands outside GitHub Actions.
