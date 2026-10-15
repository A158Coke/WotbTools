# Grafana OpenTofu ownership

`infra/tofu/grafana` owns dashboard API resources in organization 1. Canonical JSON is under `deploy/observability/grafana/dashboards`; Compose owns runtime/volumes and file provisioning alone owns Prometheus/Loki datasources. Do not restore dashboard file provisioning or manually edit generated API state.

## Current inventory

Five resources: `wotbtools_active_users`, `wotbtools_feature_usage`, `wotbtools_android_downloads`, `wotbtools_ai_token_usage`, `wotbtools_backend_error_logs`. Their UIDs are the respective filename stems (hyphenated). Active users is the default home. Six older dashboards are removed through ordinary TF deletes.

## Lifecycle policy

All dashboard creates, updates, deletes and replacements are allowed. There is no dashboard delete allowlist and no per-dashboard approval requirement. `validate-plan.sh` reports dashboard action counts and continues to prohibit datasource deletion/replacement involving delete. This permission does not extend to other infrastructure owners.

The persistent Yecao state is `/opt/wotb/grafana-tofu-state/terraform.tfstate`, outside SHA staging. Missing/unsafe state or bootstrap marker fails closed. Existing volumes and state are reused. New dashboards are created by apply, not imported as nonexistent resources.

## Validation and apply

PR jobs have no production credentials/state and run fmt, init without backend, validate, local policy fixtures, Grafana runtime smoke and data-chain tests. The production observability owner keeps the host lock, plans locally, applies the exact saved plan, requires a clean second plan, checks new UIDs/default home and requires 404 for retired UIDs. Backup live state root-only before the migration; never commit it or log credentials.

Grafana access uses the runtime-only existing `GRAFANA_PAT` provider input. The root does not own alerting, contact points, teams, Keycloak, Alloy or Loki. Datasources remain read-only file provisioned. Public UI is https://monitor.wotbtools.com; the production provider uses the WireGuard bind rather than public DNS.

A failed partial apply is diagnosed using real state and re-planned; no automatic state rollback. To recover a deleted dashboard, restore its declaration/JSON from Git and apply the resulting plan. See [operations](../operations/observability.md) for event semantics, retention and deployment acceptance.
