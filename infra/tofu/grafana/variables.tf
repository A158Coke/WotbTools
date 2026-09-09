variable "grafana_url" {
  description = "Grafana base URL."
  type        = string
  default     = "https://monitor.wotbtools.com"
}

variable "grafana_auth" {
  description = "Dedicated Grafana provider token; never commit or print it."
  type        = string
  sensitive   = true
  nullable    = true
  default     = null
}

variable "grafana_org_id" {
  description = "Grafana organization ID."
  type        = string
  default     = "1"
}
