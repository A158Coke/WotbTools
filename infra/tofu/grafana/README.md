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

The COS backend uses the independent state key
`wotbtools/prod/grafana.tfstate`. Import is owner-controlled and CI never runs
import or apply.
