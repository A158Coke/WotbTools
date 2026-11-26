# 受控安全事件日志（公安自评估「日志信息留存措施」）。
#
# 独立文件而不是塞进 realm.tf：realm 的身份与会话策略跟「记录哪些安全事件」是两件需要
# 分开评审的事，而且这份声明是合规承诺的 IaC 载体——在 Keycloak Admin UI 里手工打开不算
# 完成，realm 已完全由 OpenTofu 管理，漂移会在下一次 plan 里被改回去。
#
# 留存分工（SSOT 不重复）：
#   - 事件经 jboss-logging listener 写到 Keycloak 容器 stdout；
#   - TX Alloy 给命中的行打上 compliance="security"（deploy/tx/alloy/config.alloy）；
#   - Loki 对该 stream 保留 190 天（deploy/observability/loki/loki-config.yml）。
# Keycloak 自己数据库里的 event history 不承担留存义务，只留短期用于排障。
# 完整边界见 docs/operations/security-log-retention.md。
#
# 这里没有 prevent_destroy：本 root 的删除保护是身份作用域的（realm / client / IdP），
# 配置类资源的破坏性变更由 validate-plan.sh 审计——它既拒绝删除，也拒绝把 events /
# admin events 关掉、或把 admin event details 打开的 desired state。
resource "keycloak_realm_events" "wotbtools" {
  realm_id = keycloak_realm.wotbtools.id

  events_enabled = true
  # 604800s = 7 天，与 Loki 的默认档一致：190 天的事实源是 Loki 的 compliance stream，
  # 不在 Keycloak 的 PostgreSQL 里再养一份半年数据。
  events_expiration = 604800

  # 只记录真正需要的事件：登录 / 登出 / 第三方身份提供者登录，成功与失败成对。
  # 注意 jboss-logging listener **不**受本字段约束（它只过滤数据库 event store），
  # 所以 190 天留存的收窄发生在 Alloy 的 compliance selector 里；两处清单必须逐一对应，
  # 由 scripts/ci/test-keycloak-tofu-contract.sh 断言一致。
  enabled_event_types = [
    "LOGIN",
    "LOGIN_ERROR",
    "LOGOUT",
    "LOGOUT_ERROR",
    "IDENTITY_PROVIDER_LOGIN",
    "IDENTITY_PROVIDER_LOGIN_ERROR",
    "IDENTITY_PROVIDER_FIRST_LOGIN",
  ]

  # 管理动作：要知道「谁执行了什么管理操作」，但不长期保存完整 resource representation
  # ——那会把用户资料、client secret 之类的内容写进一条保存 190 天的日志里。
  admin_events_enabled         = true
  admin_events_details_enabled = false

  # listener 必须显式声明。本资源接管该字段，留空会把 Keycloak 默认的 jboss-logging
  # 清掉，事件再也不出现在容器 stdout，整条合规链路会静默失效（日志里也看不出原因）。
  events_listeners = ["jboss-logging"]
}
