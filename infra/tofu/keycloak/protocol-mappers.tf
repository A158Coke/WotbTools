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
