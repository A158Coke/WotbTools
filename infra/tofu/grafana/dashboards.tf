locals {
  dashboard_files = {
    wotbtools_active_users       = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-active-users.json"
    wotbtools_feature_usage      = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-feature-usage.json"
    wotbtools_android_downloads  = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-android-downloads.json"
    wotbtools_ai_token_usage     = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-ai-token-usage.json"
    wotbtools_backend_error_logs = "${path.module}/../../../deploy/observability/grafana/dashboards/wotbtools-backend-error-logs.json"
  }
}

resource "grafana_dashboard" "managed" {
  for_each = local.dashboard_files

  config_json = file(each.value)
  overwrite   = false
}
