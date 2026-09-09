locals {
  dashboard_files = {
    wotbtools_ai_review           = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-ai-review.json"
    wotbtools_android_downloads   = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-android-downloads.json"
    wotbtools_backend_overview    = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-backend-overview.json"
    wotbtools_error_explorer      = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-error-explorer.json"
    wotbtools_http_errors         = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-http-errors.json"
    wotbtools_keycloak            = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-keycloak.json"
    wotbtools_production_overview = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-production-overview.json"
    wotbtools_replay_parser       = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-replay-parser.json"
    wotbtools_usage               = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-usage.json"
  }
}

resource "grafana_dashboard" "managed" {
  for_each = local.dashboard_files

  config_json = file(each.value)
  overwrite   = false
}
