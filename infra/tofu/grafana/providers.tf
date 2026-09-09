provider "grafana" {
  url    = var.grafana_url
  auth   = var.grafana_auth
  org_id = var.grafana_org_id
}
