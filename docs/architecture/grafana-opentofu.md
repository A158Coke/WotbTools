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

The provisioning mount keeps an empty `dashboards/` directory only so Grafana
does not report a missing provisioning path at startup; it contains no
dashboard controller or dashboard payload. Changes under the canonical
dashboard JSON path therefore reconcile through OpenTofu and do not require an
application image Build or production runtime deployment.

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

CI never runs import. Pull requests use `GRAFANA_PAT` only for an authenticated
plan; fork runs never receive it. Merges to `main` run the separate
`grafana-tofu-apply.yml` workflow, which plans, blocks dashboard deletes, applies
the exact saved plan, and verifies all managed dashboard UIDs.

The current `GRAFANA_PAT` is the existing `wotbtool` service-account token with
the Grafana organization `Admin` role. The owner explicitly approved this
temporary credential exception for automatic apply; it is not a dedicated
least-privilege token. The practical minimum for the adopted dashboard set is
an organization `Editor` service-account role: Grafana documents that Editor
can view and add/edit/delete dashboards and folders, while Viewer cannot write
dashboards. Replacing the current Admin token with a dedicated Editor service
account/token remains a follow-up hardening action. No token, prefix, length,
hash, Authorization header, dashboard JSON, or state artifact is printed or
committed.

## Runtime validation

The runtime smoke keeps datasource file provisioning, then adopts the canonical
dashboard JSON through the Grafana API before checking datasource health, all
dashboard UIDs, dashboard links, the Production Overview five-target health
contract, and authentication failure behavior. This validates the API boundary
used by the provider without restoring the removed dashboard file controller.

Both the PR plan workflow and the main apply workflow block any delete action
for any `grafana_dashboard`; replacement is also blocked because its action set
contains `delete`. The same gate covers any future provider-managed
`grafana_data_source`. Intentional dashboard deletion is not supported by
automatic main apply and requires a separately reviewed manual process.
