# TX Keycloak 新 Realm 启动手册

适用范围：Phase 1 在 TX 创建全新的 `keycloak-postgres` 数据库与 `wotbtools` realm。旧 Yecao Keycloak 数据库不导入；本手册不授权删除任何旧身份或业务数据。

## Git 中可导入的静态配置

Keycloak 镜像只包含自定义 provider。`infra/tofu/keycloak` 是 TX realm、角色、client、mapper
和 IdP 的唯一声明来源；镜像启动不使用 `--import-realm`。OpenTofu 在 TX localhost
`127.0.0.1:18080` 上以 bootstrap admin 建立 fresh realm，并在 apply 后执行第二次 plan
确认无 drift。

## 运行时配置与凭据边界

GitHub Actions Secrets / Variables 是 TX runtime 与 TX-local OpenTofu 的唯一配置入口。
工作流通过 SSH `envs` 注入变量；服务器不再维护 `/etc/wotb/tx-runtime.env` 或
`/etc/wotb/postgres-keycloak-tofu.env`。以下信息禁止写进 Git、realm JSON、tfvars、Tofu
state 或日志：

- `KC_BOOTSTRAP_ADMIN_PASSWORD`；
- `KC_POSTGRES_ADMIN_PASSWORD`；
- `KC_DB_PASSWORD`；
- `KEYCLOAK_ADMIN_CLIENT_SECRET`（`wotbtools-admin-api` 的 service account）；
- `WG_APPLICATION_ID`；
- `TX_QQ_CLIENT_SECRET`（QQ Connect application secret）。

TX workflow secrets：`TX_KC_POSTGRES_ADMIN_PASSWORD`、`TX_KC_DB_PASSWORD`、
`TX_KC_BOOTSTRAP_ADMIN_PASSWORD`、`WG_APPLICATION_ID`、`TENCENTCLOUD_SECRET_ID`、
`TENCENTCLOUD_SECRET_KEY`。非敏感固定值 `KC_POSTGRES_ADMIN_USER=kc_admin`、
`KC_DB_USERNAME=keycloak` 由 workflow 提供；`CADDY_ACME_EMAIL` 使用
`vars.CADDY_ACME_EMAIL`，为空时 fail-closed。

`wotbtools-admin-api` 是由 OpenTofu 创建的 confidential service-account client。它只获得
`realm-management` 的 `manage-users`、`query-users`、`view-realm`；secret 通过 write-only
runtime 变量注入，禁止写入 HCL、tfvars、plan 或普通 state attribute。backend 继续使用
`KEYCLOAK_ADMIN_CLIENT_ID=wotbtools-admin-api` 与 `KEYCLOAK_ADMIN_CLIENT_SECRET`。

Wargaming IdP representation 与 Keycloak runtime 共用**同一个**已存在凭据，不引入第二个 secret：

- GitHub Secret `WG_APPLICATION_ID` 经 SSH 环境注入 Keycloak OpenTofu apply step；
- `deploy/tx/keycloak-tofu.sh` 在缺失、空值或 placeholder 时 fail-closed，并导出敏感
  `TF_VAR_wargaming_application_id`，由 `keycloak_oidc_identity_provider.wargaming` 的
  `wargaming-asia` / `wargaming-eu` / `wargaming-na` 三个实例共用为 `client_id`（值不打印、
  不进 tfvars、不进 Tofu output）；
- 同一 secret 仍注入 Keycloak runtime env `WG_APPLICATION_ID`（自定义 SPI 通过
  `System.getenv("WG_APPLICATION_ID")` 读取），因此这份注入不得删除；
- 不存在 `TX_WG_APPLICATION_ID` / `WG_CLIENT_ID` / `WARGAMING_CLIENT_ID` 等重复凭据。

官方 QQ IdP 由 OpenTofu 完整拥有，不存在 operator 手工凭据路径：
- GitHub Variable `TX_QQ_CLIENT_ID` 经 SSH 环境传入 `TF_VAR_qq_client_id`；
- GitHub Secret `TX_QQ_CLIENT_SECRET` 经 SSH 环境传入 write-only
  `TF_VAR_qq_client_secret`，不得写进 tfvars、日志或普通 state attribute；
- GitHub Variable `TX_QQ_CLIENT_SECRET_VERSION` 经 SSH 环境传入
  `TF_VAR_qq_client_secret_version`。secret 每次轮换必须同时递增该正整数版本；缺失、空值、
  placeholder 或非法版本均使 TX-local OpenTofu apply fail-closed。

`qq_enabled` 的 production declaration 固定为 `true`。`idp-qq` 的 alias、enabled、client ID、
write-only secret/version 与 QQ endpoint configuration 均由 OpenTofu 收敛，并以
`prevent_destroy = true` 防止删除。QQ Open Platform 已获批准且 production credentials 已可用；
仍不得将凭据复制到 GitHub Actions 以外的介质。

## Identity Provider 启动顺序

1. 让 OpenTofu 创建 fresh realm，确认 `wotbtools-web`、`wotbtools-admin-api`、角色与 JWT mapper 已存在。
2. 由 OpenTofu 创建 `wargaming-asia`、`wargaming-eu`、`wargaming-na` 三个实例（`provider_id=wargaming`，
   `client_id` = 同一 `WG_APPLICATION_ID`），并在 Keycloak runtime 继续注入 `WG_APPLICATION_ID` 供自定义 SPI 读取。
3. 镜像构建 `keycloak-qq-provider` 与 `keycloak-wargaming-provider`；运行时验收必须确认
   `keycloak-qq-provider.jar` 存在且 Keycloak 已以 `start --optimized` 启动。仓库仍保留
   vendored legacy Juhe provider 源码/镜像 artifact 以兼容历史构建，但 TX realm 不创建它的实例，
   不得把它作为 fallback。
4. OpenTofu 创建唯一官方 QQ alias `idp-qq`（provider id `qq`，enabled）；TX 不创建
   `juhe-qq` fallback，也不创建裸 alias `qq`。固定 production broker callback 为
   `https://auth.wotbtools.com/realms/wotbtools/broker/idp-qq/endpoint`；QQ Open Platform、
   Android exact callback allowlist 与 Web 登录流必须使用此唯一 callback，不得引入
   `/qq/endpoint` 或 `idp-qq-v2`。

## wotbtools-web 浏览器客户端生产对齐

`infra/tofu/keycloak/client.tf` 的 `keycloak_openid_client.web` 显式声明当前生产
`wotbtools-web` 行为。字段名全部来自 pinned provider `keycloak/keycloak 5.9.0` 的
resource schema，不按 Admin Console 标签推断：

| 生产行为 | OpenTofu 声明 |
|---|---|
| client type: OpenID Connect | 资源类型 `keycloak_openid_client`（protocol 固定 `openid-connect`） |
| enabled: true | `enabled = true` |
| always display in UI: on | `always_display_in_console = true`（representation `alwaysDisplayInConsole`） |
| client authentication: off | `access_type = "PUBLIC"` |
| standard flow: on | `standard_flow_enabled = true` |
| direct access grants: off | `direct_access_grants_enabled = false` |
| implicit flow: off | `implicit_flow_enabled = false` |
| service account roles: off | `service_accounts_enabled = false` |
| PKCE required: off | `pkce_code_challenge_method = ""`（provider 允许的“无 code challenge method”取值） |
| login theme: wotbtools | `login_theme = "wotbtools"`（Keycloak client attribute `login_theme`） |
| front-channel logout: on | `frontchannel_logout_enabled = true`（representation `frontchannelLogout`） |
| front-channel logout session required: on | `extra_config` 的 `frontchannel.logout.session.required = "true"`（见下） |
| consent required: off | `consent_required = false` |

`frontchannel.logout.session.required` 是唯一没有 provider typed field 的生产设置：
provider 5.9.0 只有 `frontchannel_logout_enabled` 与 `frontchannel_logout_url`
（`backchannel_logout_session_required` 只覆盖 back-channel）。因此按 provider 官方支持的
声明方式，用其 `extra_config` map 声明，attribute key 取 Keycloak 26.6.4
`OIDCConfigAttributes.FRONT_CHANNEL_LOGOUT_SESSION_REQUIRED` 的字面值；不使用 `local-exec`、
provisioner 或 Admin Console 手工步骤。Keycloak 自身对该 attribute 的默认值也是 `true`
（`OIDCAdvancedConfigWrapper#isFrontChannelLogoutSessionRequired`），所以显式声明与
Keycloak 默认值一致，不会产生漂移。

`wotbtools-admin-api` 是 confidential service-account client，不声明任何浏览器流、theme
或 consent 设置；`security-admin-console` 等内置 client 由 Keycloak 自己拥有，OpenTofu 不管理。

## 导入后的验收

- Keycloak 使用 `start --optimized`，启动时没有 augmentation；
- image 包含 `keycloak-qq-provider.jar`，并成功以 `start --optimized` 启动；
- OpenTofu fresh realm 的 Admin API 验收通过：唯一 alias 为 `idp-qq`、`providerId=qq`、
  `enabled=true`、client ID 非 placeholder、`authorizationUrl` / `tokenUrl` /
  `userInfoUrl` / `clientAuthMethod=client_secret_post` 全部匹配 QQ contract，且没有 `qq` 或
  `juhe-qq` alias；二次 plan 为 no-op；
- OIDC discovery、三个 Wargaming 登录、前端 public client redirect URI 均可验证；
- QQ Connect 凭据或 rotation version 缺失/非法时 fail-closed，不通过猜测配置绕过。
- DNS cutover 前，受控 TX runtime 必须记录一次真实 QQ E2E：Web Login → QQ authorize →
  `idp-qq` callback → Keycloak broker → 新 TX Keycloak user → WotBTools session/token；同时确认
  无 callback loop、expired_code、重复 broker alias 或 Juhe fallback，且无关 admin 登录仍可用。
  fresh TX realm 不迁移旧 Keycloak users。
- Android 使用 `idp-qq` 官方 OAuth callback contract；本 TX realm 不引入 Juhe fallback。

## PRE_CUTOVER_READY 只读门禁

在申请 DNS cutover 前，在 TX runtime 上执行 `deploy/tx/pre-cutover-check.sh`。该入口只复用
`deploy/tx/deploy.sh` 的现有 health-probe/Compose 配置读取逻辑，不执行 staging、promote、
recreate、stop、删除或 DNS 操作。TX 包内的 `yecao-backend-contract.json` 是由 Yecao
Compose contract test 校验的非机密 bind 基线；若 TX 上另有受控 checkout，可设置
`WOTB_SOURCE_ROOT` 让门禁直接复核 production Compose。两者都不可用时，门禁会拒绝宣称 ready，
而不是猜测 backend bind。

全部检查通过时输出：

```text
PRE_CUTOVER_READY
DNS_CUTOVER_NOT_PERFORMED
WAITING_FOR_OPERATOR_APPROVAL
```

Business PostgreSQL 是权威业务状态，因此门禁同样要求它完全就绪才允许 `PRE_CUTOVER_READY`：
`business-postgres` 容器存在且 healthy、`pg_isready` 成功、发布端口严格为
`127.0.0.1:25432:5432`（出现 `0.0.0.0`、`::` 或 WireGuard 地址即失败）、
`/opt/wotb-tx/business-postgres.tofu-provisioned` 存在且内容精确为
`tx-local-opentofu-business-postgres`。任一检查失败即输出 `PRE_CUTOVER_NOT_READY`；
这些检查全部只读，不创建、修改或删除任何数据库或数据行。详见
`docs/operations/business-postgres.md`。

门禁读取的 live Compose 现在也包含 TX 业务运行时 `business-api`，因此它的必需输入同样要在
环境中提供（应用数据库凭据 `TX_BUSINESS_DB_*`、`TX_RABBITMQ_CONTROL_API_PASSWORD`、
MinIO `control_api` key pair、`KEYCLOAK_ADMIN_CLIENT_SECRET`、`AI_API_KEY`），缺失时门禁在
渲染阶段立即拒绝，而不是给出误导性的 ready。门禁本身仍只读：这些值只用于 Compose 渲染与
就绪判定，不写盘、不落日志。

## 全业务 E2E token（operator 运行门禁时需要）

门禁由同一个入口按阶段运行，阶段决定 edge 部分能诚实地断言什么：

```text
bash deploy/tx/pre-cutover-check.sh                 # 切 DNS 前
bash deploy/tx/pre-cutover-check.sh --post-cutover  # 切 DNS 后（强制 TLS 门）
```

除上面的输入，门禁还需要以下非默认输入：

```text
KEYCLOAK_E2E_CLIENT_SECRET   wotbtools-e2e 机器身份的 client secret（GitHub Secret，write-only）
WOTB_E2E_DATA_SNAPSHOT       X1 搬迁前从 Yecao 只读导出的逐表行数快照，例如
                             {"tables":{"hall_of_fame_record":348, ...}}
可选：
WOTB_E2E_REPLAY_PATH         探针容器内的回放 fixture（默认 /e2e/random-battle-example.wotbreplay，
                             由 Deploy 从 common/fixtures/replays staged 到 /opt/wotb-tx/e2e）
WOTB_E2E_PUBLIC_IP           公网边缘的目标 TX 地址（默认 118.25.18.105）
WOTB_E2E_JOB_TIMEOUT_SEC     processing/export job 轮询上限（默认 300）
```

门禁用 `wotbtools-e2e`（client_credentials）驱动真实链路并逐项输出 `processing-e2e`、
`dataset-result`、`map-overview`、`battle-playback-v2`、`minio`、`ai-facts`、`export`、
`hof-replay-storage`、`parser-worker`、`admin-authz`、`anonymous-rejected`、
`business-data-integrity`。任何一项 FAIL 都输出 `PRE_CUTOVER_NOT_READY`（post 阶段为
`POST_CUTOVER_NOT_READY`）：**这就是「不通过门禁不得切 DNS」的机械含义**。

- 门禁不做付费 AI 调用：AI 只验证 worker 写入的 `ai-facts.json` 可通过 control_api 身份读取。
- 门禁对基础设施与用户数据只读；唯一写入是一个 30 分钟 TTL 自动回收的瞬时 processing job
  与 export job（属于一次性安全操作，不改任何真实用户数据）。
- `business-data-integrity` 需要 operator 先完成 §10.1 的只读行数快照与 TX `pg_restore`，
  并保留 `hall_of_fame_record` 的 explicit id 与 ≥ 355 的 identity sequence。
- `hof-replay-storage` 需要 `replay_data` 卷已迁移且至少存在一条可下载的 HoF 回放记录。

### 公网边缘：分阶段而不是伪装 TLS 就绪

公开 DNS 仍指向 Yecao 时，TX 上的 Caddy **无法**完成 HTTP-01 / TLS-ALPN 校验，因此拿不到受信任
证书。要求「切 DNS 前就有受信任 HTTPS」是一个机械上无法达成的死锁，用 `curl -k` 掩盖它则是把
门禁变成假绿。门禁因此分两阶段（全程**不关闭 TLS 校验**、**不使用** `-k/--insecure`）：

| 阶段 | token | 断言 |
|---|---|---|
| 切 DNS 前 | `public-edge-sni-web` / `public-edge-sni-auth` | TX `443` 可连通、TLS 握手完成且为该 host 出示了证书；`curl` 退出码 `60`（链尚未受信）是**预期通过**状态；连通失败（7/28/35）或非 2xx 则 FAIL |
| 切 DNS 后（`--post-cutover`） | `public-tls-web` / `public-tls-auth` | 该 host 必须解析到 `WOTB_E2E_PUBLIC_IP`、受信任证书校验通过、HTTP 2xx；退出码 `60`（仍不受信）或无 DNS 指向即 FAIL |

路由正确性（frontend / Keycloak upstream）在切 DNS 前由 Caddy 内部 readiness surface
（`http://caddy/_wotb/...`，走 Docker service DNS）证明，不依赖固定容器 IP、公网 DNS 或证书。

post 阶段成功时输出：

```text
POST_CUTOVER_READY
DNS_CUTOVER_PERFORMED
WAITING_FOR_OPERATOR_RETIREMENT
```

顺序是：Caddy 已在 TX 所有接口上绑 80/443（生产默认，见 `deploy/tx/docker-compose.yml`）
→ 切 DNS 前门禁全绿 → 切 DNS（PR K，operator）→
`--post-cutover` 门禁全绿 → 才允许停止/移除 Yecao 遗留容器。

### Caddy 不再有固定容器地址

旧配置把 Caddy 固定在 `172.29.0.2`，在真实 TX 上与其他服务的动态地址冲突
（`failed to set up container networking: Address already in use`）。现在：

- Compose 不 pin 任何容器地址，Caddy 通过正常网络分配加入 `wotb_tx_internal`；
- readiness surface 绑定 `http://caddy`（Docker service DNS），所有内部探针使用
  `http://caddy/_wotb/...` 与 `http://caddy/.well-known/assetlinks.json`；
- frontend nginx 的 `set_real_ip_from` 改为信任整个 `wotb_tx_internal` 子网
  （`172.29.0.0/16`），因为信任边界不再是某个固定对端地址；该子网只包含本 TX 应用栈的容器，
  Caddy 仍是其中唯一的公网入口。

### parser DLQ 非空时的 operator 动作

`parser-worker` token 在 `wotb.parser.dlq` 不为空时 FAIL（非空 DLQ 意味着至少一条回放永久失败或
无法解码）。这是**必须人工处置**的状态，不允许通过删除证据让门禁变绿：

1. 只读确认权威状态：`docker compose -f /opt/wotb-tx/deploy/docker-compose.yml exec -T rabbitmq
   rabbitmqctl -q list_queues name messages consumers`，并确认 PostgreSQL 中没有该 job 的未终态
   投影（job 权威在 PG，不在 broker）。
2. 在 TX loopback 的 Management UI（`http://127.0.0.1:15672/`，`wotb.parser.dlq` 队列）逐条查看
   被 park 的消息：`parser.dead` 表示终态失败（含错误码），原始字节 park 表示无法解码。
3. 分类处置：解码缺陷 → 保留样本并在修复后**重新投递**（用同 `jobId` 重新创建 processing job，
   或把消息重新发布到 `wotb.jobs` / `parser.request`）；瞬时基础设施故障 → 同样重新投递；
   确实无法处理的旧格式 → 明确记录为「永久失败样本」并由你批准是否接受。
4. 处置后队列必须回到空，然后重新运行门禁。**不要**用 purge 作为「修复」；purge 只在你已记录
   每条消息的结论之后才允许。

门禁以只读 Keycloak Admin API 检查 `idp-qq`：必须唯一、`providerId=qq`、`enabled=true`、
client ID 非 placeholder，且 QQ endpoint/config contract 完整；裸 `qq` / `juhe-qq` alias 会阻断。
全部通过后输出 `QQ_IDP_STATUS=idp-qq=READY`；不再接受 `WAITING_EXTERNAL` 豁免。门禁不再探测
Yecao backend 路径：公开 API 流量已在 TX 内部终结（frontend nginx → `business-api:8087`），
改为两条只读 token：`tx-internal-api-route`（frontend upstream 必须是 TX 内部业务运行时、
`business-api` 不发布任何端口、任何服务都不得发布 8087）与 `distributed-execution-plane`
（`business-api` 不得出现已退役的回放执行模式开关与 job-repository 选择器；PostgreSQL 是唯一
replay job authority）。任一不满足即 `PRE_CUTOVER_NOT_READY`。

TX deploy 在修改 runtime 前只检查 Docker/Compose、`wg0` 地址与到 `10.20.0.2` 的路由（后者仍服务
MinIO 与 broker 链路）；staging 阶段先 fail-closed 拒绝「引用/发布已退役 8087」或「重新启用本地
执行面」的 staged Compose，再进入 pull/promote，因此不会出现「已切到 TX 内部路由但仍依赖
Yecao backend」或反向的中间状态。
