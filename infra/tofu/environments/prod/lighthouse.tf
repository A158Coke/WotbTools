resource "tencentcloud_lighthouse_instance" "production" {
  blueprint_id  = "lhbp-2cacsycc"
  bundle_id     = "bundle_starter_mc_promo_med2_02"
  instance_name = "Ubuntu24.04-Docker29-34Hn"
  renew_flag    = "NOTIFY_AND_MANUAL_RENEW"
  zone          = "ap-shanghai-4"

  lifecycle {
    prevent_destroy = true
  }
}

resource "tencentcloud_lighthouse_firewall_rule" "production" {
  instance_id = tencentcloud_lighthouse_instance.production.id

  lifecycle {
    prevent_destroy = true
  }

  # These are the existing production rules returned by DescribeFirewallRules;
  # preserve them exactly and do not widen or clean up the live firewall here.
  firewall_rules {
    action                    = "ACCEPT"
    cidr_block                = "45.136.14.101/32"
    firewall_rule_description = "Allow UDP 51820 from 45.136.14.101/32"
    port                      = "51820"
    protocol                  = "UDP"
  }

  firewall_rules {
    action                    = "ACCEPT"
    cidr_block                = "0.0.0.0/0"
    firewall_rule_description = "Linux SSH登录"
    port                      = "22"
    protocol                  = "TCP"
  }

  firewall_rules {
    action                    = "ACCEPT"
    cidr_block                = "0.0.0.0/0"
    firewall_rule_description = "Web服务HTTP (80)，如 Apache、Nginx"
    port                      = "80"
    protocol                  = "TCP"
  }

  firewall_rules {
    action                    = "ACCEPT"
    cidr_block                = "0.0.0.0/0"
    firewall_rule_description = "通过Ping测试网络连通性 (放通ALL ICMP)"
    port                      = "ALL"
    protocol                  = "ICMP"
  }
}
