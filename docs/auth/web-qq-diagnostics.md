# Web QQ 登录诊断（`cookie_not_found` 取证手册）

2.1.0 Phase 2 的红线：**不允许带着猜测性修复进 stage**。本文档定义 SPA 侧诊断事件的
schema、失败分类法，以及需要在 TX 生产环境执行的取证清单。前端只拥有「SPA 能看到的
少数事实」；决定性证据在 Keycloak / Caddy 侧，按下文清单逐项取证。

## 1. SPA 侧诊断事件（`[auth-diag]`）

`frontend/src/platform/authDiagnostics.js` 输出单行 JSON（`console.info('[auth-diag]', …)`，
可 grep / jq），另有 30 条环形缓冲：控制台 `window.__authDiag === undefined` 时用
`snapshot()` 由支持人员导出。

| 事件 | 字段（全部布尔 / 枚举） | 含义 |
|---|---|---|
| `login_started` | `destination`（view 名或路径） | 用户点了登录、SPA 即将整页跳向 Keycloak |
| `return_facts` | `hasCode` / `hasState` / `hasSessionState` / `hasIss` | 回程 URL 上 OIDC 参数的**存在性** |
| `return_facts` | `hasError` + `error`（固定枚举码） | Keycloak 把登录失败弹回了 SPA（如 `identity_provider_login_failure`、`access_denied`） |

字段纪律：**只读参数存在性，绝不复制参数值**——code / state / token / cookie 值一律不落。
`useAuth` 既有 `[auth] init_started / init_completed / init_failed / init_timeout` 行与之配对
（generation 可串联）。

时间线读法：`login_started(T0)` →（用户在 Keycloak/QQ 上操作）→
`return_facts(T1)`：

- **有 `code`**：Keycloak 完整走完 broker 并签发了授权码 → 断点不在 broker cookie，
  看 token 交换与后续；
- **有 `error`**：Keycloak 主动把失败弹回 → 取 error 码对应类别（见下节）；
- **什么都没有（用户手动返回/刷新）**：用户停在了 Keycloak 的错误页 →
  决定性证据在 Keycloak 服务端日志与 cookie（下节清单）。

## 2. 失败分类法（不要把四类混成一个数字）

| 类别 | Keycloak 事件 / 错误 | 含义 | 典型根因方向 |
|---|---|---|---|
| A | `cookie_not_found` | broker 回调时读不到 auth session cookie | cookie 属性 / 代理头 / 会话被重启清掉 |
| B | `Failed to verify login action` | first-broker-login 表单校验失败 | **多数是 A 的下游症状**；也可能主题（`login_theme=wotbtools`）部署漂移 |
| C | `expired_code` | 授权码过期 / 重复 callback | 用户停留过久、刷新、重复提交 |
| D | `identity_provider_login_failure` | QQ 侧失败 | QQ App 凭据 / API / provider 故障 |

**噪音**（不得计入生产登录可靠性指标）：localhost `silent-check-sso.html` 的
`invalid_redirect_uri`、invalid password、user_not_found、admin-console 操作。

## 3. 服务端取证清单（TX 生产环境执行）

### 3.1 核验线上实际下发的 cookie 属性（A 类第一判据）

```bash
curl -sI 'https://auth.wotbtools.com/realms/wotbtools/protocol/openid-connect/auth?client_id=wotbtools-web&redirect_uri=https%3A%2F%2Fwotbtools.com%2F&response_type=code&scope=openid&state=diag' \
  | grep -i 'set-cookie'
```

对每一枚 `AUTH_SESSION_ID` / `AUTH_SESSION_ID_LEGACY` / `KC_RESTART` 核对：
`Secure` 存在、`SameSite` 值、`Path`、`Domain`（host-only 还是 domain 形）。
`--proxy-headers=xforwarded` 下 Keycloak 必须知道自己是 https——若看到缺 `Secure`
的 `SameSite=None`，现代浏览器会**直接拒收**，这正是 `cookie_not_found` 的经典机制。

### 3.2 核验运行中的容器参数与仓库一致

```bash
docker inspect -f '{{.Config.Cmd}}' $(docker ps -qf name=keycloak)
docker inspect -f '{{.State.StartedAt}}  restarts={{.RestartCount}}' $(docker ps -qf name=keycloak)
```

必须包含 `--hostname=https://auth.wotbtools.com --proxy-headers=xforwarded`。
**旧容器若先于某次配置修复启动，跑的仍是旧参数**——以运行中实例为准，不以仓库为准。

### 3.3 时间线相关性（A 类 vs 部署事故）

```bash
docker logs --timestamps keycloak 2>&1 | grep -E 'cookie_not_found|Failed to verify login action' 
docker inspect -f '{{.State.StartedAt}}' keycloak
```

把 `cookie_not_found` 的时间戳与 Keycloak 重启 / `administrator command` /
JGroups `connection closed`（日志已出现）对齐：**重启后 in-flight 登录的 auth session
丢失属预期行为**，不属于 cookie 策略问题；只有稳定复现于正常操作路径的才算 blocker。

### 3.4 broker 回调的 HTTP 层证据（已上线的受控访问日志）

`deploy/tx/Caddyfile` 为 `auth.wotbtools.com` 开启受控访问日志（Caddy 的 `log` 是站点级指令，无法只挂某条路径；路径筛选交给下面的 LogQL），并且
**在写 stdout 之前**由 Caddy 的 filter 编码器剥掉秘密：query 里的 `code` / `state` /
`session_state` / `iss` 被删除，`Cookie` 与 `Authorization` 头被删除（Caddy 默认即不记录
凭据，这里是显式固定口径）。经 `deploy/tx/alloy` 送 Loki，标签 `container_name="caddy"`；校验脚本断言脱敏行齐全，且配置用真实 Caddy（`caddy validate`）在 CI 中适配通过。

保留的字段足以回答两件事：

```logql
# 谁在打 broker 回调（UA / 路径 / 状态码；IP 是 datacenter 还是住宅网段）
{container_name="caddy"} |~ "broker" | json | line_format "{{.request.headers.User-Agent}} {{.request.uri}} {{.status}}"
```

- **真实用户 vs 机器人**：UA 与来源 IP 网段；实测 72h 内 234 条 `cookie_not_found` 里约
  83 条来自腾讯云机房段且表现为"同一秒 8–10 个不同 IP 齐打"（扫描器），151 条来自住宅 /
  移动网段（真实用户，同一 IP 反复重试）。
- **哪类客户端**：移动 QQ 内置浏览器 / WebView / 桌面 Chrome 在 UA 上可分辨——这正是
  "cookie 从未送到"与"送到了但被过滤"之外的第三条判别线。

查询方式（从任意能连 WireGuard 的 TX 主机；生产 Grafana 的 Keycloak 看板另有对应面板）：

```bash
curl -sG 'http://10.20.0.2:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={container_name="caddy"} |~ "broker"' \
  --data-urlencode "start=$(date -d '-2 hours' +%s)000000000" \
  --data-urlencode "end=$(date +%s)000000000" --data-urlencode 'limit=50'
```

### 3.4b 一次失败登录的完整跳链（浏览器 DevTools，Network 面板，可选手工复核）

1. 清 cookie → 点 QQ 登录 → 一直保留 Network 记录（Preserve log）。
2. 关注三跳：SPA → `auth.wotbtools.com/.../auth`（Set-Cookie 是否出现）；
   → `graph.qq.com/...`；→ QQ 回 `auth.wotbtools.com/realms/wotbtools/broker/idp-qq/endpoint`
   ——**这一跳的请求是否带上了 `AUTH_SESSION_ID` cookie**（Cookie 列）。
3. 没带 = 浏览器拒收/丢了 cookie（回到 3.1 的属性核验）；带了仍 `cookie_not_found`
   = Keycloak 侧会话存储问题（重启清空 / 集群路由），与 3.3 对齐。

### 3.5 主题漂移（B 类独立检查）

realm 的 `login_theme=wotbtools` 覆盖了登录与 first-broker-login 页面。核对线上主题
版本与本仓部署是否一致：`Failed to verify login action` 若集中在主题表单 POST 上，
而 A 类证据不足，优先排查主题模板里的 action URL / cookie 相关改动历史。

## 4. 修复边界（取证证实后）

允许落点：Keycloak hostname/proxy 参数、Caddy 头链、cookie 属性（经由升级路径）、
IdP callback 配置、broker flow 配置、主题、部署/会话连续性。

**禁止**：disable 校验、忽略缺失 cookie、削弱 state 校验、disable PKCE、
接受无效 first-login action——一切「为了让日志闭嘴」的改动。
