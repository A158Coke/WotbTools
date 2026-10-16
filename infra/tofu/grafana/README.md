# Grafana OpenTofu root

This root owns six dashboard API resources: five product dashboards and WotbTools Engineering Overview. Canonical JSON is under `deploy/observability/grafana/dashboards`; Prometheus/Loki datasources remain file-provisioned. The default home is Active users.

Dashboard deletion and replacement are unrestricted desired-state changes, with no allowlist. Datasource deletes remain prohibited. PR validation has no production credentials or state; the owner workflow applies an exact saved plan against `/opt/wotb/grafana-tofu-state/terraform.tfstate` and requires a clean second plan.

See [ownership and recovery](../../../docs/architecture/grafana-opentofu.md) and [telemetry semantics](../../../docs/operations/observability.md). Never delete the state or Grafana volume to rebuild dashboards.
