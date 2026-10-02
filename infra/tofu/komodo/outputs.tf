output "controller_hostname" {
  value       = "${var.subdomain}.${var.domain}"
  description = "Public Komodo controller hostname."
}

output "controller_ingress_ipv4" {
  value       = tencentcloud_dnspod_record.komodo.value
  description = "TX public IPv4 used by the Komodo controller DNS record."
}
