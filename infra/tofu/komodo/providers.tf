# Credentials come from TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY, which
# only the Komodo controller workflow is permitted to read. This root is scoped
# to DNSPod and never manages compute, Docker, Caddy, WireGuard, or any other
# owner's records.
provider "tencentcloud" {}
