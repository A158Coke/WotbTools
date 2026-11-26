locals {
  protocol_mappers = {
    display_name = {
      name           = "display-name-mapper"
      user_attribute = "displayName"
      claim_name     = "displayName"
      claim_type     = "String"
    }
    region = {
      name           = "wotb-region-mapper"
      user_attribute = "region"
      claim_name     = "wotb_region"
      claim_type     = "String"
    }
    account_id = {
      name           = "wotb-account-id-mapper"
      user_attribute = "wotb.account_id"
      claim_name     = "wotb_account_id"
      claim_type     = "String"
    }
    nickname = {
      name           = "wotb-nickname-mapper"
      user_attribute = "wotb.nickname"
      claim_name     = "wotb_nickname"
      claim_type     = "String"
    }
    verified = {
      name           = "wotb-verified-mapper"
      user_attribute = "wotb.verified"
      claim_name     = "wotb_verified"
      claim_type     = "boolean"
    }
  }
}

resource "keycloak_openid_user_attribute_protocol_mapper" "wotbtools_web" {
  for_each = local.protocol_mappers

  realm_id            = keycloak_realm.wotbtools.id
  client_id           = keycloak_openid_client.web.id
  name                = each.value.name
  user_attribute      = each.value.user_attribute
  claim_name          = each.value.claim_name
  claim_value_type    = each.value.claim_type
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}

# Android client 的同一组 attribute mapper。Keycloak 的 protocol mapper 属于
# client，不能共享：`wotbtools_web` 上的一份只作用于 Web token，Android token 必须
# 有自己的实例。
# 下面是**新增**资源，`keycloak_openid_user_attribute_protocol_mapper.wotbtools_web`
# 的声明本身一个字都不改、也不重命名：资源地址即身份，改块名/改成 for_each 组合键
# 都会让线上 Web client 的 mapper 变成 delete + create，出现 token claim 空窗，
# 这是本改动的明确非目标。两组只共享同一个 `local.protocol_mappers` 单一事实源，
# 因此 claim 名、user attribute 与 claim 类型永远不会在两条客户端上漂移。
resource "keycloak_openid_user_attribute_protocol_mapper" "wotbtools_android" {
  for_each = local.protocol_mappers

  realm_id            = keycloak_realm.wotbtools.id
  client_id           = keycloak_openid_client.android.id
  name                = each.value.name
  user_attribute      = each.value.user_attribute
  claim_name          = each.value.claim_name
  claim_value_type    = each.value.claim_type
  add_to_id_token     = true
  add_to_access_token = true
  add_to_userinfo     = true
}
