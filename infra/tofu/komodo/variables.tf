variable "domain" {
  type        = string
  description = "Authoritative DNSPod domain."
  default     = "wotbtools.com"
}

variable "subdomain" {
  type        = string
  description = "Komodo controller DNS host label."
  default     = "komodo"
}

variable "tx_public_ipv4" {
  type        = string
  description = "TX public IPv4 that terminates TLS and proxies to Yecao over WireGuard."
  default     = "118.25.18.105"

  validation {
    condition     = can(cidrhost("${var.tx_public_ipv4}/32", 0))
    error_message = "tx_public_ipv4 must be a valid IPv4 address."
  }
}
