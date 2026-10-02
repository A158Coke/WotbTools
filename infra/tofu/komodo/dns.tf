# The single resource this root owns. Public ingress belongs to the independent
# TX Caddy owner, which terminates TLS and proxies to the Yecao WireGuard
# address; this record only publishes the TX ingress address.
resource "tencentcloud_dnspod_record" "komodo" {
  domain      = var.domain
  sub_domain  = var.subdomain
  record_type = "A"
  record_line = "默认"
  value       = var.tx_public_ipv4
  ttl         = 600
  status      = "ENABLE"
  remark      = "WotBTools Komodo controller ingress"

  lifecycle {
    prevent_destroy = true
  }
}
