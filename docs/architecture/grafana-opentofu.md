# Grafana OpenTofu baseline

The Grafana root is `infra/tofu/grafana`. It manages the existing Grafana
dashboard API objects in organization 1 with `grafana/grafana` provider
`4.45.2`, tested against the production Grafana `11.6.16` API.

Docker Compose remains responsible for the Grafana container, image, database
volume, network, reverse proxy, and runtime environment. The COS backend uses
the existing state bucket with an independent key:

```text
bucket: wotbtools-prod-tofu-state-1478073677
key:    wotbtools/prod/grafana.tfstate
```

## Ownership

The nine existing dashboards are provider-managed. Their canonical JSON stays
in `deploy/observability/grafana/dashboards` and is read by
`grafana_dashboard.managed`; the dashboard file-provisioning YAML controller
is removed so there is only one dashboard owner. Compose still mounts these
canonical files read-only for Grafana's default-home dashboard path; that mount
does not provision or reconcile dashboard API objects.

Prometheus and Loki remain file-provisioned. Grafana reports those datasources
as read-only and the provider rejects importing them as resources. The
datasource provisioning YAML remains the sole datasource controller.

No alert rules, folders, contact points, notification policies, teams, library
panels, annotations, Keycloak objects, Loki objects, or Alloy objects are
managed by this root.

## Owner import addresses

The remote state was bootstrapped by owner-controlled imports. The exact
dashboard import IDs are their Grafana UIDs:

```powershell
tofu import 'grafana_dashboard.managed["wotbtools_ai_review"]' wotbtools-ai-review
tofu import 'grafana_dashboard.managed["wotbtools_android_downloads"]' wotbtools-android-downloads
tofu import 'grafana_dashboard.managed["wotbtools_backend_overview"]' wotbtools-backend-overview
tofu import 'grafana_dashboard.managed["wotbtools_error_explorer"]' wotbtools-error-explorer
tofu import 'grafana_dashboard.managed["wotbtools_http_errors"]' wotbtools-http-errors
tofu import 'grafana_dashboard.managed["wotbtools_keycloak"]' wotbtools-keycloak
tofu import 'grafana_dashboard.managed["wotbtools_production_overview"]' wotbtools-production-overview
tofu import 'grafana_dashboard.managed["wotbtools_replay_parser"]' wotbtools-replay-parser
tofu import 'grafana_dashboard.managed["wotbtools_usage"]' wotbtools-usage
```

CI never runs import or apply. Trusted runs use the repository Actions secret
`GRAFANA_PAT` only for an authenticated plan; fork runs never receive it.
The token must be a dedicated least-privilege service-account token and must
not be printed, committed, or placed in dashboard JSON/state artifacts.

## Runtime validation

The runtime smoke keeps datasource file provisioning, then adopts the canonical
dashboard JSON through the Grafana API before checking datasource health, all
dashboard UIDs, dashboard links, the Production Overview five-target health
contract, and authentication failure behavior. This validates the API boundary
used by the provider without restoring the removed dashboard file controller.

The provider workflow blocks deletion/replacement of critical datasources and
the Production Overview dashboard. Other dashboard deletes remain visible in
the reviewed plan rather than being hidden by a global permanent guard.
