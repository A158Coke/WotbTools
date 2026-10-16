# 安全日志留存（190 天）与投诉举报渠道

> Canonical。公安自评估「日志信息留存措施」与「是否建立投诉举报机制」两项的实现事实源。
> 改动日志分流、retention、脱敏边界或投诉举报渠道时必须同步本文件。

两条硬线：

- **普通日志 7 天**（`retention_period: 168h`）——product telemetry、backend debug、
  AI 用量、APK 下载、Grafana 查询用的全部运行日志。这次整改**没有**把整个 observability
  栈改成半年。
- **安全日志 190 天**（`4560h`）——只有带 `compliance="security"` 标签的流。

## 1. 什么算安全日志

| `security_kind` | 来源 | 内容 |
|---|---|---|
| `auth` | Keycloak realm events（`jboss-logging` listener → 容器 stdout） | 登录/登出/第三方身份提供者登录的成功与失败，以及管理动作（admin event） |
| `api_access` | Caddy `wotbtools.com` 的 `log security_api` | 只有 `/api/*` 的访问记录 |
| `auth_access` | Caddy `auth.wotbtools.com` 的受控访问日志 | 认证域的访问记录 |

Keycloak 侧保留的事件类型由 [`infra/tofu/keycloak/events.tf`](../../infra/tofu/keycloak/events.tf)
的 `enabled_event_types` 声明，当前为：`LOGIN`、`LOGIN_ERROR`、`LOGOUT`、`LOGOUT_ERROR`、
`IDENTITY_PROVIDER_LOGIN`、`IDENTITY_PROVIDER_LOGIN_ERROR`、`IDENTITY_PROVIDER_FIRST_LOGIN`，
加上 admin event（`admin_events_enabled = true`、`admin_events_details_enabled = false`）。

**该字段不是留存边界。** `jboss-logging` listener 不受 realm 的 `enabled_event_types` 约束
（那只过滤 Keycloak 数据库里的 event store），所以**全部**事件类型都会出现在容器 stdout。
190 天留存的收窄发生在 TX Alloy 的 compliance selector 里，两边清单必须逐一对应——
`deploy/validate-alloy-config.sh` 断言它们一致。

## 2. 什么明确不算安全日志（只留 7 天）

- backend / business-api 的普通运行与 debug 日志
- AI telemetry（token 用量、复盘结果、prompt/output）
- feature usage、active user 等产品 telemetry
- Android APK 下载计数
- Keycloak 的普通 runtime 日志（Quarkus 启动、数据库连接等）
- 未列入上面清单的 Keycloak 事件类型（例如 `CLIENT_LOGIN`）
- Caddy 的 TLS/ACME/reload 等 runtime 日志
- 首页、JS/CSS、图片、WASM、APK 重定向、`/agent-assets/*` 的访问——这些请求**完全不写**
  安全访问日志（Caddy 站点级 `log_skip`），不是「写出来再让 Loki 丢掉」

## 3. 脱敏边界

以下内容**禁止**进入 190 天留存的日志，并由配置层强制而非约定：

| 禁止项 | 强制方式 |
|---|---|
| query string（含 `token=` 之类） | `wotbtools.com` 的 filter 编码器删除原始 `request>uri`，再用 `log_append path {http.request.uri.path}` 只写回 path |
| `Authorization` / `Cookie` | 同一编码器删除**整个** `request>headers`；认证域另有逐项 `delete` |
| OAuth `code` / `state` / `session_state` / `iss` | `auth.wotbtools.com` 的 filter 编码器在写 stdout 前从 query 中删除 |
| 响应头（含 `Set-Cookie`） | 删除整个 `resp_headers` |
| request body / response body | Caddy 从不记录 body |
| AI prompt/output、回放内容、上传文件内容 | 这些只出现在 backend / ai-service 日志，而那两条车道永远不打 `compliance` 标签 |
| Keycloak 管理动作的完整 resource representation | `admin_events_details_enabled = false` |

`/api/*` 安全访问日志实际留存的字段：`ts`、`remote_ip`、`remote_port`、`host`、
`method`、`path`、`status`、`ua`，加上 Caddy 自身的结构字段（`proto`、`duration`、
`size` 等，不含个人信息）。

## 4. 实现位置

| 层 | 文件 | 职责 |
|---|---|---|
| Keycloak | [`infra/tofu/keycloak/events.tf`](../../infra/tofu/keycloak/events.tf) | 打开 realm events、事件清单、admin event 开关、`jboss-logging` listener |
| Keycloak | [`deploy/tx/keycloak.compose.yml`](../../deploy/tx/keycloak.compose.yml) | `KC_LOG_LEVEL=info,org.keycloak.events:debug`——成功事件默认只到 DEBUG，不抬级别就只有失败记录 |
| Caddy | [`deploy/tx/Caddyfile`](../../deploy/tx/Caddyfile) | `/api/*` 的 `log security_api`、站点级 `log_skip @notApi`、`log_append` 字段与 compliance 标记 |
| Alloy | [`deploy/tx/alloy/config.alloy`](../../deploy/tx/alloy/config.alloy) | `loki.process "compliance"`：给安全日志行打 `compliance` / `security_kind` 标签，其余照旧透传 |
| Loki | [`deploy/observability/loki/loki-config.yml`](../../deploy/observability/loki/loki-config.yml) | 默认 `168h`，`retention_stream` 对 `{compliance="security"}` 用 `4560h` |

本次整改**没有**新增任何公网端口：Caddy 仍是唯一公网入口，Keycloak 与 backend 仍走既有
TX / WireGuard 拓扑。

## 5. 部署顺序（固定）

```
Loki retention → Alloy compliance pipeline → Caddy API logging → Keycloak realm events → Contact 页面
```

先上线 consumer 与 retention，再启动新的日志 producer，避免出现「producer 已经在产生安全
日志、collector 还没准备好打标签」的窗口——那段时间的日志会按 7 天被删掉。

## 6. 查询方法

Grafana（`https://monitor.wotbtools.com`）的 Loki 数据源，或直接查 Loki：

```logql
{compliance="security"}
{compliance="security", security_kind="auth"}
{compliance="security", security_kind="api_access"}
{compliance="security", security_kind="auth_access"}
```

**单次查询窗口上限 7 天**（`max_query_length: 168h`）。回看窗口已放宽到 190 天
（`max_query_lookback: 4560h`），所以取证要按 7 天分段查，不要一次拉 190 天——
Yecao 这台机器会被一次全范围查询打爆。这是刻意的取舍，不是配置遗漏。

查某个账号的登录记录（事件行里有 `userId` / `username` / `ipAddress`）：

```logql
{compliance="security", security_kind="auth"} |= "userId=\"<uuid>\""
```

## 7. 验证方法

### CI（每次改动自动执行，权威门禁）

| 覆盖 | 入口 |
|---|---|
| Loki 同时存在 7 天默认档与 190 天 security 档 + Docker→Alloy→Loki 真实打标 / 不打标 | `deploy/test-observability-e2e.sh`（ci-observability） |
| Alloy 合规分流契约 + 事件清单跨层一致 + 普通车道禁止打标 | `deploy/validate-alloy-config.sh`（ci-alloy-tx、ci-observability） |
| Caddy 文本/适配后 JSON 的字段白名单与覆盖面 | `deploy/tx/validate-caddy-config.sh`（ci-caddy，以及生产 staged 校验） |
| Caddy 真实请求：`/api/*` 有日志、`/`、`/assets/*`、APK 重定向、`/agent-assets/*` 无日志、query/Authorization/Cookie 不出现 | `deploy/test-caddy-route-inventory.sh`（ci-caddy） |
| Keycloak IaC 声明 + 事件 logger 级别 | `scripts/ci/test-keycloak-tofu-contract.sh`（ci-keycloak） |
| plan 级守卫：不得关掉 events / admin events、不得打开 details、不得摘掉 listener | `infra/tofu/keycloak/validate-plan.sh` + 其 fixture |
| 真实 Keycloak：applied realm 配置 + 事件真的出现在 stdout 且不含 representation | `deploy/test-keycloak-tofu.sh`（keycloak 部署 workflow） |

### 生产验收（部署后人工执行一次）

1. 做一次真实登录，再调用一次普通 API。
2. 查 `{compliance="security"}`，必须同时看到登录证据与 API 访问证据。
3. 在同一批结果里确认**不存在**：access token / Authorization 值、Cookie 值、
   query 参数、回放内容、AI prompt/output。
4. 查 `{compliance="security"}` 中是否混入了 telemetry / APK 下载 / backend debug——
   不应有。

**不要把真实用户日志截图入库。** 验收结论写在 PR 或 issue 里即可；本文件只记录方法与边界。

## 8. 投诉举报渠道

[`frontend/src/components/ContactPage.vue`](../../frontend/src/components/ContactPage.vue)
的「投诉与举报」段落把现有 Contact 页面正式定义为问题反馈、投诉与举报渠道；文案在
`frontend/src/locales/{zh,en,ru}.json` 的 `contact.report_title` / `contact.report_body`，
三语同步（缺任一语言即视为未完成）。联系方式沿用页面上已公开的 QQ / 微信 / Discord，
不新增后台工单系统。

## 9. 附录：公安自评估填写文本

「日志信息留存措施」：

> 系统对用户认证、访问请求及安全相关操作进行必要的安全日志记录，包括用户账号标识、操作时间、
> 操作类型、网络源地址、目标服务、网络源端口及访问结果等必要信息。安全日志与日常运行监控日志
> 分离管理，并通过权限控制及日志脱敏措施防止敏感信息泄露；不记录用户密码、授权令牌、Cookie、
> 业务文件内容等非必要敏感信息。安全日志留存时间不少于六个月。WotbTools 不提供用户公开发帖、
> 评论、转发或通讯群组等信息发布功能，因此不存在用户公开发布内容的留存场景；同时不额外采集与
> 业务和网络安全无关的客户端硬件特征。

「是否建立投诉举报机制」：**是**（见第 8 节）。

最后一句是刻意的：表格里问到「客户端硬件特征」与「用户发布信息」，但不应为了填表反过来
增加没有必要的数据收集。
