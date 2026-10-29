# WotbTools 技术演进

本文记录 WotbTools 的技术演进：解释关键技术决策为何出现、哪些边界或权威发生变化，以及哪些方案只是迁移机制并已退役，而不是逐版本罗列功能。

HISTORY.md 记录产品/业务演进；本文只聚焦架构、数据流、identity、authority 与 production topology。Git Commit / Pull Request 仍是实现事实源。

---

## 1. 2026-06-23 — 从 Python Replay Extractor 到 Java Application

WotbTools 起点是 Python Replay 数据提取工具。Git 仓库建立后，主实现迁移到 Java 21，并形成共享的 wotb-core；Spring Boot、Vue、Docker 与 jpackage 承担不同交付形态。

早期 Web 与 Desktop 共用 Java runtime。随后仓库逐步把 common、offline、online 责任拆开，项目从单次 Replay 解析脚本变成可以持续演进的应用。

~~~text
Python Replay Extractor
        -> Java 21 + wotb-core
        -> Spring Boot / Vue
        -> shared Web + Desktop runtime
~~~

## 2. 2026-06-24～06-27 — Event Stream、Rating 与持久业务状态

最初 Replay 主要提供结算结果。第一次深入 Event Stream 的直接目的，是确定死亡时间，从而得到 survival time；它不是一开始就为了 AI Review 建立的。

Event Stream 随后开始支持更丰富的行为分析与 Rating。排行榜又带来跨 Replay 的长期业务状态需求，因此 PostgreSQL 被引入。选择 PostgreSQL 的现实原因是开源且使用方便。

持久化落地同时引入 Hibernate 与 Flyway：前者承担对象关系映射，后者把数据库结构纳入版本化迁移。前端与后端也在这一阶段拆成独立服务，为长期 Web 运行方式建立边界；早期离线桌面交付随后退出主发展路线。

~~~text
Settlement Result
      -> Event Stream
      -> death_time -> survival_time
      -> behavior / Rating
~~~

排行榜使系统第一次需要真正的持久业务状态：

~~~text
Replay processing + PostgreSQL -> Leaderboard
~~~

## 3. 2026-06-26～07 — Authentication Identity 与 Business Identity 分离

随着 Web 服务开始需要知道实际用户量并进行 RBAC，项目引入 Keycloak。Keycloak 的职责是认证与角色边界，而不是成为所有业务数据的身份主键。

随后 user_profile 把 Authentication Identity 与 Business Identity 分开，为账号绑定和长期业务状态建立独立模型。

2026-06-28～07，为降低中国区用户的登录门槛，项目扩展 Keycloak Identity Provider 接入 QQ。现成方案不能完全满足需求后，项目开始维护自己的 Identity Provider 与映射逻辑；Keycloak 由此从外部认证组件变成拥有自定义身份扩展的平台组件。

2026-08，普通用户自注册被关闭，登录入口收敛为受管理员控制的 Identity Provider：中国区走 QQ，海外走 Wargaming，管理员保留独立入口。Wargaming Provider 覆盖 ASIA、EU、NA，并把可信的游戏账号信息同步到业务 Profile。

2026-09-23，聚合数据 QQ Provider 退役。QQ 登录长期存在聚合数据与官方 QQ Connect 两套并行实现；官方通道接管生产登录后，旧 Provider 的 SPI 模块、镜像构建与装载、CI 与影响域清单、Android 旧回调路径与旧参数校验、各层拒绝名单一起收敛。Keycloak 生产 realm 此前已不存在该 Provider 实例，因此没有 realm 侧变更或用户数据迁移；QQ 身份此后只有官方 `idp-qq` broker callback 一条通道。

~~~text
Keycloak subject
      |
      v
user_profile
      |
      v
business state
~~~

这一时期 Boost / Coaching 等有状态业务也真实存在，并推动数据库、权限与后台流程成熟。它们后来被完整删除，但属于真实技术历史，不能因为当前 main 已不存在就从演进记录中抹去。

## 4. 2026-07-22～08 — Replay Reconstruction 与 Evidence Model

随着 Replay 分析需要更完整的战斗过程，项目建立 Replay Reconstruction。AI Review 与随后出现的 Battle Playback 都需要比最终结算更丰富的 timeline，这持续推动 Reconstruction 成熟。

第一版 DeepSeek AI Review 在 2026-07-22 以 admin 灰度接入已有 Reconstruction。之后 AI 与 Playback 对事实质量的要求反过来推动 BattleTimeline、Knowledge State 与 Evidence Contract 收敛。

AI Review 随后扩展到批量 Replay。实现引入 Battle Identity、重复检测、Perspective Group 与 Representative Replay，把“文件数量”与“真正的分析单元”分开；随机战采用个人视角，训练房和赛事采用团队视角，同一场战斗的双方 Replay 保持独立 Perspective，不合并为事后全知视角。

到 07-26，AI 输入开始脱离 Replay 底层表示：Team Number 转换为 `FRIENDLY / ENEMY / UNKNOWN`，坐标获得有效性状态，时间统一为 Battle-relative Time，成员身份与地图位置通过共享 Resolver 转换为领域语义。

2026-08-06～09，AI Review 开始引入游戏领域知识：车辆数据最初来自 Wargaming 官方数据，后为覆盖实际版本与新车切换到 BlitzKit；地图位置映射到战术区域、路线和关系。AI 输入由此分成 Replay Evidence 与游戏知识/地图语义两层，外部知识只能解释 Evidence，不能覆盖 Replay 事实。

2026-08-11～16，Battle Reconstruction 的第二个消费者 Battle Playback 建立：地图总览、路线、阶段、时间线以及车辆位置/方向/死亡/射击/血量/争霸状态直接向人展示，并明确区分 Observed、Derived、Unknown。Playback 成为 Reconstruction 的人类可见验证面。

2026-08-12～20，AI Review 从 Prompt 约束转向 Evidence Contract：Evaluation Harness、Golden Cases 与回归验证把知识状态变成可执行契约；Canonical BattleTimeline 统一 AI 依赖的事实，Claim 与 Evidence 建立绑定。Backend 决定事实、LLM 解释事实的边界由此固定。

2026-09-05，Team AI Review 将团队复盘从 culprit / MVP 结果归责转向战术因果链；Strategic Prior 只作为非权威基线，Replay 不能证明语音沟通、指挥责任或心理状态。信息状态区分 CURRENT、LAST_KNOWN 与 UNSEEN，Backend 不预生成 BAD_PUSH / GOOD_TRADE 等结论。

~~~text
Replay Binary
   -> Protocol Decoder
   -> Replay Events
   -> Replay Reconstruction
   -> Canonical BattleTimeline
        -> Playback
        -> Evidence -> LLM
~~~

这一阶段逐步确立：

- file identity != battle identity != analysis identity；
- Player scope != Team scope；
- Protocol truth != implementation state；
- settlement facts、live observations 与 unknown 必须区分；
- 不能用未来信息污染过去时间点的 POV / Area of Information；
- Backend 负责事实和确定性推导，LLM 只负责战术解释。

死亡事实形成明确 authority 优先级：settlement authority 优先，其次是可证明的 live exact evidence，否则保持 unknown。

## 5. 2026-08 — Replay Artifact 与可审核 Evidence

Leaderboard 演进为 Hall of Fame 后，只保存最终业务结果已经不足以证明记录来源。系统开始保存原始 Replay，并通过 SHA-256 content identity、atomic publish 和数据库元数据把业务记录与 evidence 联系起来。

~~~text
Submission -> Replay Evidence -> Review -> Decision
~~~

PostgreSQL 与 artifact storage 的责任从这里开始明确分离：数据库负责业务状态和 metadata，二进制 Replay artifact 由文件/对象存储负责。两者不能假装拥有一个跨介质 ACID transaction。

百场等流程最终允许管理员进行人工最终认证；自动解析提供 Evidence，但不会冒充人工审核 authority。

## 6. 2026-08-29～08-31 — Processed Dataset 与 Replay Workspace

Data、AI Review 和 Battle Playback 曾分别维护 Replay 上下文，导致同一个 Replay 在不同能力之间重复上传、重复解析。

Replay Workspace 的核心驱动力不是单纯统一 UI，而是避免同一 Replay 被不同能力重复解析，浪费处理时间。

~~~text
Replay File
   -> Processing Job
   -> Processed Dataset
   -> ReplayDatasetRef(processingJobId, sourceId)
        -> Data
        -> AI Review
        -> Playback
~~~

Dataset identity 最终由 processingJobId + sourceId 表示；文件名不再是 processed Dataset 的 identity authority。Workspace 拥有 selection 与 Processing Job lifecycle，各 capability 消费 Dataset，但不共享自己的业务状态，因此 AI failure 不等于 Playback failure。

## 7. 2026-08-29 起 — Android Thin Client 与 Replay Operation Identity

Android 被设计成 Thin Client，而不是第二套 WotbTools。

~~~text
Android Native
  = OS integration / replay intent / cache / update / bridge

Web
  = Replay / AI / Playback / product behavior
~~~

外部 Replay intent 随后暴露了 auth redirect、process death、ACK 丢失和 retry 下的重复提交问题。认证流程被规定为最高导航优先级；认证期间 Replay 进入 Pending Queue，并持有可跨 Android Process Death 恢复的 `pendingId`。Replay 只有在服务器真正接受 Processing Request 并返回 Job 后才 ACK；ACK 使用基于 `pendingId` 的 compare-and-clear，避免旧 ACK 删除后来到达的新 Replay。Native `pendingId` 同时成为 backend `operationId`，并形成端到端幂等协议：

~~~text
identity = (authenticated subject, operationId)

ABSENT -> IN_FLIGHT -> COMMITTED(jobId)
~~~

只有 dispatcher 接受任务后才能 COMMIT。后来的 Distributed Replay 沿用了这一 invariant，并进一步把 accepted 收紧为 RabbitMQ publisher-confirmed 且 routable。Replay Export 也统一进入认证边界，避免通过导出接口绕过受保护 Dataset。Native Bridge 同时建立 capability check 与安全边界；APK 签名、版本与自动发布能力使客户端具备分发条件。

## 8. 2026-08-31～09 — 双云基础规划

最初 production 在 Yecao 香港服务器。大陆访问不稳定后，项目增加 Tencent Cloud 国内服务器。

引入 Tencent 的原始原因不是 Replay 计算负载，而是大陆访问问题。两台服务器同时存在后，目标才变成合理利用两边资源，而不是让其中一台长期闲置或只做代理。

~~~text
Yecao mainland accessibility problem
        -> Tencent introduced
        -> two paid servers exist
        -> plan responsibility split
~~~

双云工作开始时拆分已经在计划中，因此先建立 wotb-contracts 与独立 wotb-control POC，探索 provider-neutral async contract、Control Plane 与 execution 的边界。此时 RabbitMQ、MinIO 与 remote worker 尚未成为真实 production path。

wotb-control 后来没有成为最终独立 production service；正式 Replay Control Plane 留在 TX Business API。仓库能证明这一结果，但已经无法可靠恢复当时没有保留 standalone control service 的完整决策理由，因此本文不补写猜测。

## 9. 2026-09 — Replay Coordinator / Processing 分离

Tencent 更适合作为大陆入口，但资源有限；Yecao 有更多可用计算资源。因此 Replay coordination / job management 与实际 parsing execution 被拆开。

这不是为了微服务化，而是为了允许：

~~~text
TX: Ingress / Business / Control
        |
        | ReplayProcessingDispatcher contract
        v
Execution placement independent from coordinator
        |
        v
Yecao: Replay Processing
~~~

代码拆分先落在 Maven Feature Module：`wotb-result`、`wotb-playback`、`wotb-replay-coordinator`、`wotb-replay-processing`、`wotb-ai` 等模块仍运行在同一个 Spring Boot 应用、JVM 和容器中。Coordinator 拥有 Job Lifecycle / Processing State，Processing 负责执行，两者通过 `ReplayProcessingDispatcher` Port 连接；Dispatcher Request 被限制为 value-only contract，不携带本地路径、Spring Object 或 callback，为未来远程执行准备边界。此时实现仍是 `LocalReplayProcessingDispatcher`，尚未接入消息队列或远程 Worker。

性能工程也开始使用 Benchmark、JFR 与 Fingerprint 证明优化没有改变 Canonical Replay Facts；CPU 解析使用受限 Platform Worker，AI 等待使用受控 Virtual Thread。

## 10. 2026-09 — 持久游戏身份

Keycloak 用户可能被删除或重新创建，认证体系本身也可能迁移。长期游戏数据因此不能继续依赖可变的 Keycloak subject。

canonical game identity 收敛为：

~~~text
Authentication Identity: Keycloak subject
        |
        v
Business binding: user_profile
        |
        v
Game Identity: (server, WotB accountId)
~~~

HoF 等游戏域数据由 Game Identity 持有。这样 Authentication lifecycle 与 Game-data lifecycle 被真正解耦，也让后续身份迁移更容易。

2026-09-10，百场和三环的 canonical owner 从 Keycloak 身份迁移到 `(server, WotB accountId)`。V22 数据迁移最初尝试自动解决历史 ownership 冲突，Review 发现这可能擅自改变成绩状态或删除 Evidence，最终改为 Fail-Fast：无法可靠确定区服或存在 ownership 冲突时停止迁移并输出诊断，由管理员按真实业务历史处理。Profile API 收敛为幂等 Ensure 语义，使认证用户能够自动补齐业务 Profile，并通过数据库事实处理并发初始化。单场 Hall of Fame 仍只使用 Account ID，是当时尚未解决的遗留边界。

2026-09-22，`user_profile.wotb_account_verified_at` 表示当前绑定游戏身份的验证状态。系统复用 Canonical Replay Parser 提取真正的录像者 Account ID，只有与当前绑定游戏身份相符时才标记为已验证；昵称相同、账号出现在同局玩家列表或无法可靠识别录像者都不能作为依据。验证接入 READY Dataset 的共享读取边界，不建立第二套 Parser；它被设计为旁路能力，验证失败不能让已经成功的 Replay Processing 失败。更换区服或 Account ID 会清除验证，昵称变化不会。Wargaming 登录可通过可信 IdP Claims 建立验证，手工绑定可通过本人 Replay 获得验证。

2026-10 服务端 parser 退役后，Replay recorder 的信任模型明确收敛：它不再被当作绑定账号的 proof，而是**客户端声称的便利徽章**。服务器没有 parser，客户端只提交录像者数值 `accountId`，服务端仅与当前绑定账号比较；它不授予权限、不参与授权、不构成回放真实性证明。换绑会使验证失效，只改昵称不会。Wargaming IdP 的 `wotb_verified` 是另一条链路：由 IdP 服务端验证后写入 JWT，属于认证侧可信 claim。

## 11. 2026-09-19～09-22 — Distributed Replay 成为唯一生产执行架构

基础设施开始实现之前已经确定的责任边界。

### PostgreSQL — Job 状态权威

Processing Job、Source、Operation identity 与 lifecycle 状态迁入 PostgreSQL。PostgreSQL 成为 durable authority，而不是依赖单进程内存。

### MinIO — 临时 Dataset 工作区

MinIO 部署在 Yecao。它保存 temp/jobs/<job-id>/... 这类 distributed Replay workspace，不是 Business DB，也不是 HoF 永久 Replay archive。API 仅通过 WireGuard 暴露，Console 仅本机访问；TX Control Plane 与 Yecao Parser Worker 使用独立 MinIO Identity。Object Storage Port 获得 MinIO Production Adapter，Dataset 和 Artifact 读取收敛到统一存储边界。

### RabbitMQ — 投递层

RabbitMQ 部署在 TX，靠近 Control Plane。它负责 request/result/failure delivery，但不拥有 retry counter、attempt limit 或 Job State；这些仍由 PostgreSQL authority 决定。任务拓扑使用 `wotb.jobs` Exchange 与 Parser Queue、Retry Queue、DLQ，并通过 TTL + Dead Letter Exchange 实现延迟重试。Compose 负责 Runtime，OpenTofu 管理 VHost、用户、权限、Exchange、Queue 与 Binding；Control API 与 Parser Worker 使用独立 RabbitMQ Identity 和最小权限。真实 AMQP Contract Test 验证 Dispatch、Retry、DLQ 与越权拒绝。

### Parser Worker — 执行

Yecao Parser Worker 没有 Business DB credentials，也没有 public HTTP endpoint。它是 executor / outcome reporter，不是 state authority。

~~~text
TX Business API
   +-> PostgreSQL        operation + job state authority
   +-> MinIO             input / processed dataset
   +-> RabbitMQ
          |
          v
     Yecao Parser Worker
          |
          +-> MinIO
          +-> RabbitMQ result
                    |
                    v
             TX Control Plane
                    |
                    v
               PostgreSQL
~~~

Local execution 从一开始就是迁移兼容方案。Distributed Replay 完成后，它完成使命并被删除；local|distributed 从未被设计为长期双模式 architecture。

`ReplayProcessingDispatcher` 获得 RabbitMQ 远程实现；只有 Broker Confirm 且消息可路由后任务才视为真正接受。TX Business API 成为 Replay Control Plane，负责用户请求、PostgreSQL 权威状态、MinIO、RabbitMQ Dispatch、Worker Outcome、Retry 与 Batch Finalization，不再承担 Replay Parsing。Yecao Parser Worker 只负责一次 Attempt：消费 Parser Request、读取 Replay Artifact、执行 `processFull` 与 Reconstruction、写回 Derived Artifact 并报告结果；Retry 与完整 Job Lifecycle 仍由 Control Plane 决定。

2026-09-22，项目删除 `ReplayParseScheduler`、`LocalReplayProcessingDispatcher`、`LocalReplayProcessingExecutor` 和 Local Dataset 等旧执行路径，不再维护 Local / Distributed 双模式。生产 Replay Pipeline 收敛为：用户 → TX Business API → PostgreSQL / MinIO / RabbitMQ → Yecao Parser Worker → MinIO Derived Dataset → TX 消费能力。

## 12. 2026-09-16～09-23 — Tencent 成为 Production Authority

2026-09-09，腾讯云已有资源开始通过 OpenTofu 纳入声明式管理。已有 COS 采用 discover → declare → manual import → no-changes 的方式接管，而不是重建；腾讯 Lighthouse 和防火墙也进入基础设施代码管理。

TX 先建立 Frontend、Keycloak、Business PostgreSQL、Business API 与 production IaC，再通过 pre-cutover checks 验证目标环境。

Production Release Manifest 加入按环境划分的 `targetServices`，使同一 Release 可以声明哪些服务部署到 Yecao、哪些部署到 TX。迁移采用渐进方式：TX 先建立 Frontend、Keycloak、Caddy 等入口和身份能力，原 Yecao Backend 暂时继续承担业务处理，TX 通过 WireGuard 访问仅绑定隧道地址的 Yecao Backend。

只读 Pre-Cutover Gate 验证 TX Runtime、Keycloak、IdP、Android Web Association、Release Identity 与 WireGuard Backend 链路，只能报告 `PRE_CUTOVER_READY`，明确禁止自动修改 DNS 或关闭旧生产。TX Keycloak 随后由独立 OpenTofu Root 管理 Realm、Client、Role、Mapper、IdP 与 Backend Admin API Service Account；Backend 使用最小权限 Service Account，IdP 的结构由 IaC 管理，运行时 enabled 状态保留为 Operator Ownership。

TX 建立独立 Business PostgreSQL Runtime：Compose 管理数据库进程，OpenTofu 管理 Database、Role 与 Grant，Flyway 继续作为业务 Schema 的唯一 Owner。

Business PostgreSQL 放在 TX，是因为 TX 已经承载 Business API 和其他 backend services；数据库与业务服务保持 locality，避免核心业务数据库长期依赖跨云访问。

OpenTofu 与 Flyway 的 authority 被明确分开：

~~~text
OpenTofu = database / role / grants / infrastructure ownership
Flyway   = tables / indexes / sequences / application schema
~~~

完成 DNS / public traffic cutover 后，Yecao 上的 PostgreSQL、Keycloak、Backend、Frontend 等 legacy application runtime 被删除。Yecao 没有变成 TX 的备用站，而是正式转型为 Replay execution / temporary storage / observability node。

镜像交付同时迁入 Tencent TCR。期间探索过 GHCR 复制、主机复制和 OCI 传输等方案，最终收敛为 CI 使用 BuildKit 直接发布 TCR；Registry 可以变化，但 Commit SHA 继续作为不可变 Release Identity。

稳定职责为：TX 负责公网入口、身份、业务 API、权威业务数据库、Replay Control Plane 和 RabbitMQ；Yecao 通过 WireGuard 作为 Replay Execution / Artifact 节点。Local Replay Execution、Memory Job Authority、未进入正式架构的 `wotb-control` POC 和迁移期 Cutover Machinery 被主动删除。

迁移完成后，PRE_CUTOVER_READY、POST_CUTOVER_READY、migration snapshot 等一次性机制也被删除；仍然有长期价值的检查收敛为 TX_RUNTIME_READY。

~~~text
Migration invariant != Runtime invariant
~~~

---

## 13. 2026-09-30～10-02 — Replay Execution 从跨云服务迁回客户端，服务器 parser 归零

仓库内 `replay-engine/` Rust 移植最初用于把 Java Replay Parser 带到 Web / Android，但上游 WoT-Blitz-Agent 已经维护同一问题域的 Rust Core，并为结算、Playback、射击复现和 AI Review 提供 WASM facet。继续维护第二套 parser 会重新制造双事实源，因此 WotbTools 先退役仓库内 Rust 移植，再把上游 Agent 作为唯一字节解析依赖。

依赖不是浮动跟随 upstream main。生产前端只消费 `deploy/agent/source.json` 锁定的 Release artifact；生产 cutover 初始锁定 `v0.3.8` / `f35baa46…`，随后的 additive 装填遥测升级到 `v0.3.9` / `b4e50e13…`，随后 stale-WASM 修复将产物改为 content-addressed URL 并把 production pin 升到 `v0.3.10` / `5029e103…`。WASM 升级必须重新通过仓库 fixture 上的真实 replay → WASM → WotbTools projection parity gate。

客户端解析完成后，原先的 Distributed Replay Processing 不再有长期职责：

~~~text
旧：
Replay upload
   -> TX Business API / Processing Job
   -> RabbitMQ
   -> Yecao Parser Worker
   -> MinIO Processed Dataset
   -> consumers

新：
Replay stays on user device
   -> Agent WASM
   -> WotbTools canonical facts / projections
   -> local consumers
   -> 只有显式的服务器侧能力 payload 过网（例如 AI projection 或 HoF evidence）
~~~

这次切换因此删除服务端 Java parser、Processing Job / Dataset API、Parser Worker、RabbitMQ、MinIO temporary replay workspace 以及相关 processing tables、deployment、CI 与 IaC。这里不是把 executor 从 Yecao 搬到 TX，而是**删除服务器侧 Replay execution 这个职责本身**。

WotbTools 没有把上游 facet 当作领域模型直接传播。边界固定为：

~~~text
Agent facet DTO
   -> version / shape trust-boundary validation
   -> frontend/src/replay-local/canonical
   -> consumer-specific projection
~~~

2D Playback 与 AI Review 共用 canonical facts；3D / shot replay 可以直接消费其专用 Agent facet，但不能因此把渲染态或上游私有字段提升为 WotbTools canonical truth。缺失的 Replay 字段向上游补，不在服务端恢复 parser，也不在消费端复制一套启发式解码。

随后的装填遥测升级把这一边界扩展到实时装填：Agent v0.3.9 的 `PlaybackData.reloads` / `reload_effective` 只作为 3D OTM 的专用输入。前者保留本方 arena 装填族与服务器弹量快照，后者保留 method 35 的当前有效完整装填时长；WotbTools 只解释经真实回放和客户端 UI 交叉闭环的相位子集，并用纯时间函数保证 seek 确定性。协议没有敌方装填流，因此敌方不绘制装填状态，缺失继续表示 unknown。这些字段没有进入 `frontend/src/replay-local/canonical`，避免把呈现专用语义升级成全局事实 authority。

AI Review 也随之退出 Processed Dataset 模型：浏览器本地建立 `ClientAiReviewProjection`，gzip 提交给 Yecao 独立 `ai-service`；服务端 adapter 只做结构校验与确定性内存归约，不读取 Replay 字节。Hall of Fame 则明确采用另一种信任边界：client facts 只做结构校验，原始 Replay 作为 evidence attachment，真实性由管理员审核承担；它不是认证或授权事实。

同一轮还把**运行依赖 provenance**与**研究证据 provenance**分开。生产依赖由 `deploy/agent/source.json` 锁 Release commit + artifact hash；外部交叉验证文档则锁具体 upstream research commit / blob。上游项目既是 parser producer 又是 research source，但这两个身份不改变 WotbTools evidence promotion rule：external-only claim 仍需本地 corpus 或 controlled probe 独立复现。

## 14. 2026-09-30～10-03 — AI Review 从 Business Backend 拆成独立无状态服务

客户端 canonical projection 建立后，AI Review 不再需要 Business Backend 持有 Replay Dataset 或 AI provider secret。`wotb-ai` 因此成为部署在 Yecao 的独立 Spring Boot `ai-service`：浏览器把客户端 canonical facts 投影为 `ClientAiReviewProjection`，经 TX 的 `/api/ai/**` 入口与 WireGuard 转发给 Yecao；Business API 不再参与 AI 请求。

~~~text
Browser canonical facts
   -> ClientAiReviewProjection
   -> TX public ingress /api/ai/**
   -> WireGuard
   -> Yecao ai-service
   -> deterministic adapter / tactical review
   -> LLM provider
~~~

服务本身无数据库、RabbitMQ、MinIO 或 Replay Job 凭据；AI provider 配置与 secret 只属于该服务。取消、准入、SSE 生命周期等运行态可以存在于进程内，但 durable business state 仍不属于 AI Service。

这个拆分也确立了两个故障域：Business API 健康不等于 AI 可用，`ai-service` readiness=UP 也不等于真实用户的端到端 AI Review 已通过。生产验收需要真正的 authenticated request 穿过 TX ingress、WireGuard、AI service 和 provider。

后续积分赛截图识别复用同一个 AI Service，但只让模型提取小组军团与名次；积分规则、草稿、审核与发布仍由 Business API 拥有。这保持了“AI 做非确定性识别，业务规则做确定性计算”的 authority 分离。

## 15. 2026-10-03 — Android Authentication Owner 从 WebView 迁到 Native

Android 早期把 WebView 当作浏览器，Keycloak 与外部 IdP 的完整认证流都运行在 WebView 内，因此 cookie jar、Verified App Link、OEM 浏览器行为与 navigation lifecycle 都会影响认证连续性。

2026-09-23，QQ 登录回程不再把 Verified App Link 当作唯一机制。此前 QQ 原生登录完成后，Keycloak broker callback 必须经 App Link 回到原 WebView；部分 OEM / 浏览器环境暴露了兼容性差异——同一份 manifest 与 assetlinks 在不同设备上得到不同的 domain verification 结果，QQ 的原生回程也可能落到系统浏览器，而浏览器与 WebView 不是同一个 cookie jar，原认证事务因此无法恢复。项目把 domain verification 的健康诊断（只诊断、不阻塞登录）与 native-return ownership 分开处理；在取得真机 URI 形状证据之前，生产仍沿用 QQ 原始握手 URI，Verified App Link 仍是唯一在产的回程路径。

Android 2.0 将认证 owner 改为 Native：AppAuth + Authorization Code + PKCE S256 对 Keycloak 登录，Keycloak 继续负责 QQ / Wargaming identity brokering；Native 只认识 `wotbtools-android` client，不认识具体 IdP alias。

~~~text
Browser:
  keycloak-js -> Keycloak

Android:
  Native AppAuth / PKCE -> Keycloak -> IdP broker
          |
          v
  short-lived access token / claims
          |
          v
       Bridge v2
          |
          v
        WebView
~~~

PKCE verifier、authorization code、refresh token、state/nonce 与 refresh lifecycle 留在 Native；WebView 只消费短生命周期 access token 与登录状态。前端由 `AuthProvider` 抽象选择 browser 或 Android provider，Android bridge v1 不允许静默退回 WebView keycloak-js。

这次变化把 Android 的核心边界从“Thin Client + WebView auth 特例”收敛为“Native 拥有 OS integration 与认证生命周期，Web 继续拥有产品行为”。Replay ingress 也不再需要等待 WebView auth navigation 完成。

## 16. 2026-10-02～10-05 — Komodo 从主机可见性发展为声明式生产控制面，TX2 承担真实 Frontend workload

引入第三个生产节点 TX2 后，项目没有直接把 workload 迁过去，而是先建立独立的运行控制边界。

Komodo Core 部署在 Yecao，Core 只绑定 WireGuard；Yecao、TX1、TX2 都运行 outbound Periphery。Periphery lifecycle 由仓库中的 systemd / reconcile owner 管理，Komodo 自身不拥有 Periphery 的安装、身份或恢复。这样即使 Komodo Core 故障，agent lifecycle 仍可通过独立 GitHub Actions owner 修复。

随后 `infra/komodo/resources/` 建立声明式 ResourceSync：Git 保存期望 Server / ResourceSync metadata，Komodo 计算 diff，危险 ownership（delete、webhook auto-apply 等）保持关闭。这里的 IaC 语义是**声明运行控制面的资源状态**，不是让 Komodo 接管所有基础设施或 release artifact identity。

~~~text
Git-reviewed Komodo resources
        -> ResourceSync diff
        -> reviewed apply / runtime visibility
        -> yecao / tx1 / tx2 Periphery
~~~

TX2 再通过独立 `production-worker` owner 获得 Docker Compose、registry mirror、TCR root credential generation、WireGuard / Periphery regression 等生产 workload 前置条件。主机 ready 与 workload deployment 被刻意分开：`TX2_PRODUCTION_WORKER_READY` 只说明宿主可承载生产负载，不等于已经迁移任何服务。

在真实 cutover 前，K5 先用 disposable Stack 验证 Komodo Core → Periphery → Docker / Compose 的 create / deploy / log / stop / destroy / delete 生命周期；K7B 再以零流量 Frontend shadow 验证 TX2 的 Stack ownership、WireGuard 绑定与 runtime-content 非等价边界。K7C 把 TX2 frontend 纳入真实流量后，**零流量 shadow 行为结束**，但 `wotbtools-frontend-shadow` Stack 资源仍是 TX2 production replica 的声明式元数据/运行时可见性依赖：`infra/komodo/resources/frontend-shadow.toml` 继续声明它，operator 不得把它当作可删除的过期资源。

K7C 才是第一次真实 workload cutover。Frontend 形成 TX1 + TX2 双实例生产池，Caddy 仍在 TX1：

~~~text
Public Internet
      |
      v
TX1 Caddy
   +-> TX1 Frontend  weight 2  (~20%)
   +-> TX2 Frontend  weight 8  (~80%)
        active health check: /version.json
~~~

Frontend 的 release identity 仍由 Git commit / immutable TCR artifact 决定。TX1 从镜像源构建并发布不可变 TCR artifact；TX2 直接拉取同一 artifact，不从 TX1 运行容器“复制当前状态”。Android public download 等 host-owned runtime content 通过明确的同步契约复制到 TX2 本地 root（Sponsor QR 自 2026-10-09 起不再属于 host content——它由 pin 住的发布资产在构建期注入、随 Frontend 镜像与 APK 一起发布，不需要 TX 侧复制或运行时下发）。

因此 Komodo 的长期角色是：**提供声明式资源、主机/Stack 可见性与受控 workload lifecycle；但 release provenance、immutable artifact、owner workflow、业务数据库 authority 与公网入口 ownership 仍由各自系统持有。** K7C 增加了 Frontend workload redundancy，但没有消除 TX1 Caddy 这个公网 ingress single point of failure。

## 17. 2026-08-02～09-07 — Observability 进入事故诊断与发布门禁

AI Review 带来长耗时调用、外部依赖、超时与失败路径，单纯判断“服务是否在线”不足以理解生产状态。项目引入 Grafana、Prometheus、Loki 与 Alloy，对 Replay 解析、AI Review、服务运行状态以及关键队列和失败路径建立观测；运维判断从“容器是否启动”转向“功能是否真正工作、调用停在哪里、失败发生在哪一层”。

真实故障增加后，事故需要从用户看到的错误标识一路追踪到 Backend、Replay Processing、AI 上游调用、验证与最终失败。生产事故面板引入 errorId、correlationId、jobId 等筛选，并能够按时间查看单次 Incident 生命周期。CI 同时验证真实 Docker emitter → Alloy → Loki 数据链，避免“配置文件存在但生产日志链实际不可用”。

可观测性随后进入发布门禁：生产部署不仅检查应用健康，也验证 Metrics、Prometheus Target、Loki Stream、Grafana Datasource 与 Dashboard 等运行链路。一次生产恢复问题后，回滚权威从简单 Previous Deployment 收敛为经过完整验证的 Last Known Good。LKG 保存已验证的部署树、Compose、SHA，后来加入 Capability Metadata；缺少可靠 LKG 时默认 Fail Closed，而不是盲目把时间上较旧的版本当作可恢复版本。Application Availability 与 Observability Availability 被划分为不同故障域：观测栈故障需要报告和修复，但不能在应用本身健康时错误阻止建立恢复基线或导致不必要的业务回滚。

## 18. 2026-08-06～09-30 — 不可变 Release、回滚权威与 Release Contract

持续运行真实生产服务后，Docker `latest` Tag 已无法可靠回答“生产究竟运行哪一个源码版本”。项目首次将 Backend、Frontend 和 Keycloak 的生产镜像统一绑定到 Git Commit SHA，并通过 `DEPLOYED_SHA` 记录当前生产版本；部署成功的定义从“容器启动”扩展为关键应用路径通过健康检查。新版本启动或健康检查失败时，流程恢复此前保存的 Compose 和 Release SHA，并重新验证恢复后的服务。

不可变 Release 很快暴露与增量构建的冲突：只构建变化组件无法保证三个组件都存在同一个 `sha-<commit>` Artifact，项目因此选择 Release 完整性优先，每次生产发布统一构建完整 SHA Artifact Set。部署配置随后采用 Candidate → Promotion：新 Compose 先写入 `docker-compose.next.yml` 并验证镜像可获取，成功后才替换生产配置；回滚目标也不再简单等于上一份 Compose，只有引用的镜像确实存在时才允许覆盖此前保存的恢复目标。

2026-09-09，PR CI 负责质量门禁，Build 冻结 Source Commit 并生成不可变 SHA Image，Deploy 只消费已经产生的 Artifact，不再在部署时重新决定源码和镜像。2026-09-11～13，Build 为冻结 Source Commit 生成权威 `deployment-manifest`，记录源码身份、不可变镜像和部署目标；Deploy 只消费成功 Build 产生的 Manifest，checkout 精确 Source SHA，并按照 Manifest 发布。LKG 发展为包含 Deployment Tree、Compose、Release SHA 和数据库 Schema Version 的恢复状态；回滚前验证当前数据库 Schema 是否仍被旧 Backend 支持，无法证明兼容时标记 `ROLLBACK UNSAFE`，而不是自动数据库降级或强行启动旧应用。健康检查使用独立 health-probe 从生产网络验证 Backend、Frontend 和 Keycloak；Application Availability 与 Observability Availability 被划分为不同故障域，定向发布失败只恢复对应组件。Android 同期采用 Version-as-Code，Native Bridge 建立显式协议版本和 Breaking Change Gate。

2026-09-30，前端镜像发布从“构建、缓存导出、镜像导出与 registry 上传合并为一个无超时步骤”拆成“构建 → 校验 → 发布 → 晋升”：构建只在本地产出镜像，不再直接写 registry；内容校验（源码身份、资产源、三维回放 WASM 产物、期望静态文件）前移到任何 registry 写入之前，校验对象是即将被推送的字节；immutable tag 上传成为独立步骤，带每次尝试的超时与有界瞬态重试，registry 内容寻址使重试只补传未完成的层；发布后只验证 registry 上的 digest 就是本次发布的那一个。生产发布仍按部署位置选择 registry：TX 工作负载用腾讯云 TCR，Yecao 工作负载用 GHCR；前端发布也不再写入外部构建缓存。

## 19. 2026-10-03～10-12 — 客户端交付、会话与还原边界

### 工作台的按能力装载边界

2026-10-03 的五个能力工作台按首次激活懒加载，Three.js、装甲与射击数据不进入首屏包；切走只停渲染不销毁会话，3D 场景切回时保留时间轴与相机。文件入口收敛为全站唯一投放面，旧深链保留为工作台能力入口，不再是独立页面。

### 分块加载失败的恢复协议

SPA 产物文件名带内容哈希，部署整目录替换时，仍打开的页面会按旧 bundle 记录的文件名请求已经消失的代码块。项目把懒加载从单个动态 import 改成显式可用性边界：加载失败成为持久、可见、可操作的状态，页面其余部分继续工作；主操作是重新加载，次要操作是重试网络瞬断。恢复必须换一代异步组件定义，因为框架的异步组件会记住失败的加载 promise，重复调用同一 loader 或重新挂载同一组件定义都无法恢复。AI 复盘同时区分服务繁忙、不可达、超时、返回格式异常、用户取消、未配置，以及登录门禁、已登录但缺权限、AI 输入准备失败等不同失败态。

### Playback 尺寸权威从断点改为可用空间

2026-10-04，Playback sizing 的 authority 从断点固定值改为可用空间：断点只决定结构，尺寸由 Playback workspace 的可用宽高决定，可用高度由视口容量减去实测 persistent HUD 与 Transport 得出，避免读取根元素内容高度形成自指。`playback-workspace.css` 成为共享宏几何的唯一 owner，原先按断点拆分的 `playback-pc.css`、`playback-tablet.css`、`playback-mobile-fullscreen.css`、`playback-fullscreen-form-contract.css` 删除。2D 与 3D 共用 primary composition；Display 是锚定在 ⚙ 上的配置面，Details 是可拖动的上下文浮窗。

### Playback 尺寸权威从断点改为可用空间

2026-10-05～12 的交付调整先处理 APK 下载挤占 TX 公网带宽，再处理发布上传耗时。APK 公网分发进入副本链路，Android 的 3D 资产由 `AgentAssetProxy.kt` 截获固定路径、直连对象存储并使用磁盘缓存；WebView 消费的受控路径与 Native 实际获取字节的网络路径因此不同，不能仅根据页面 URL 判断资产是否经过 TX 网关。

APK stage 采用副本到两台 origin 的拉取链路，但 source、APK hash、staging evidence 与最终 `version.json` 的发布身份不交给分发副本决定。原子 no-clobber 落位避免校验与写入之间覆写不可变 APK；staging evidence 的并发问题继续按发布契约修复。缓存与连接修复也属于交付正确性：不存在的 hash asset/WASM 不能带一年 immutable 的 404，已被缓存的旧 CSS URL 需要内容身份轮换；未可用的 UDP 路径不能继续通过 Alt-Svc 广告 HTTP/3。

### 会话时长、持久登录与认证回程是三个边界

`infra/tofu/keycloak/realm.tf` 声明 access token 30 分钟、SSO idle 30 天、SSO max 365 天，普通与 remember-me 会话采用相同时间策略。365 天用于实现足够长的会话，不应被解释为专门制定的年度强制登录政策，也不在本文提升为 Keycloak 所有配置的通用硬上限。

只有延长 realm timeout，不能保证关闭浏览器后仍保留登录。`keycloak-session-provider` 通过 post-broker authenticator 为 `wotbtools-web` 设置 remember-me；Android 不由这个 authenticator 改写交易，而继续由 Native AppAuth 管理加密会话、刷新与缓存。Web token 留在 SDK 内存，重新打开页面依靠 SSO 恢复。

登录回程另有路由时序边界：先由认证 owner 消费 OIDC callback，再加载 Router，避免路由初始化抢先改写回调参数。会话过期、cookie 持久性与 callback 路由竞态不能互相冒充根因。

### 教学与示例的状态边界

UI 现代化与教程共用现有外壳与组件，不另造演示页面或业务状态。官方示例的匿名资格由可信示例文件身份建立，不能按文件名、路由或管理员角色推定。完成状态按账号同步，内容修订与重新邀请代际分开，避免普通文案更新重置用户教学进度。目录导入失败的修复复用已有 selection、读取与批次校验边界，不宣称已经实现默认目录记忆。积分赛扩展的专属权限、共享草稿、历史导入与正式发布仍由 Business API / PostgreSQL 拥有，AI 不获得积分计算或成绩发布权威。

### 小资源回到构建产物，镜像身份覆盖真实输入

两张 Sponsor 图片由 `deploy/sponsor/content.json` 固定 Release asset 与 SHA-256，在构建期注入 Frontend 和 APK。运行时不再依赖 TX 挂载或单独下发；轮换需要重新构建发布，是这项简化的直接代价。

资源进入构建产物后，仅 source SHA 与资产源 URL 已不足以完整表达 Frontend image identity，Sponsor bundle 指纹也必须贯穿 build、deploy 与 replica。包结构白名单和逐文件内容校验用于证明产物包含预期资源，而不是只证明下载过一个 archive。

### 3D 实例化与画质分档

2026-10-07，地图导出器原先把每个实例做成独立节点（malinovka 3096 节点），GLTFLoader 逐节点建 Mesh，导致数千次 draw call。装载后按（几何, 材质）合批为 InstancedMesh，draw call 3096→141；倒树与损毁换模改逐实例矩阵驱动，静态子树矩阵冻结；拾取按（批次, 实例槽位）编址。画质从三档重划为四档：低（盒代理 + 小地图）、中（真车模 + 俯视烘焙底图 + 抗锯齿）、高（场景 GLB + 分层地表）、极致（填充率拉满）；GPU 俯视烘焙管线与 3D 运行时共用同一材质实现。上游 pin 先适配 v0.4.0（无证据 = null 而非 0、击杀原因 255 哨兵）再切换。

### 客户端还原以可验证行为为目标

不同画质档简化的是视觉成本，不是位置、时间、seek 与可见性的事实语义。实际搭载主炮、弹种身份和装甲命中门禁继续沿已证明的数据链处理，而不以车型默认配置或间隙甲单独命中冒充最终判定。

地形专项撤销自创结构脚印与额外细分补偿，回到客户端判据，并用独立参考与差分测试验证终止补片集合。履带印随后采用每侧 50 槽、包含活戳的有界环，以及 0.3m 激活门、锚点提交与时间淡出；撤销没有客户端证据的空间去重层。回压覆写、倒带重建、出生时间隐藏与 AoI 空洞断链分别承担自己的语义，不用桥接未知位姿制造连续轨迹。这不是不计性能成本复制全部客户端实现，而是以客户端证据减少任意规则，再通过画质分档、实例化与有界数据结构控制用户设备成本。

槽位模型收敛不代表完整复刻：当前履带印仍未实现客户端的相机距离淡出与 GLOBAL_TINT 调色分支；缺 authored 参数时也有模型测宽与通用贴图/间距回落。这些是已知消费侧边界，不能将回落值称为已证明的客户端事实。canonical Details 的整场投影则移入共享 Worker，场景先 ready、详情后台增强；只有线程设施故障才退回主线程，业务解析错误不重跑。两者分别控制渲染成本与主线程阻塞，不改变事实权威。

## 20. 2026-10-14～10-18 — 渲染资产、安全日志与内容契约

### 炮塔分离

独立炮塔的分离、飞行和落地取自录像中真实实体及完整姿态，原车炮塔与主炮分开；倒带可恢复完整车模。低血量死亡不会自动生成飞头，缺少记录时保持 unknown。

### 射击检视数据资产直读

射击检视的 `shellKinds.json` 与 `common/shot-tank-data.json` 原先内嵌前端，随游戏版本更新会静默过期。改为运行期直读资产包：弹种表取 `/data/shellKinds.json`（上游以 `dump-shell-kinds` 随 tanks.pb 同批生成、随包发布），搭载输入由 `fetchShotTankData` 对 `tank/{id}.json` 做 config 顺序 + `pitch_limits` + `shell_global_ids` 的紧凑投影。俯仰锚定表是解析期入参，改为有界等待 1.5s；迟到弹表经响应式视图写入。坦克百科封面改按 `tank_images/crops.json` 做 translate/scale 定位。旧文件与更新脚本删除，Android 随 bundle 变化递增 `wotbVersion`。

### 安全日志留存分档

公安自评估要求认证与访问类安全日志留存不少于六个月。Loki 默认 retention 仍为 `168h`；只有带 `compliance="security"` 标签的流走 `4560h`（190 天），标签由 TX Alloy 产生。查询回看窗口放宽到 190 天，单次查询长度仍限制在 7 天。

安全日志只有三类：Keycloak 受控 realm events、Caddy 对 `/api/*` 的访问记录、认证域访问记录；首页、JS/CSS、图片、WASM、APK 下载通过站点级 `log_skip` 不写安全访问日志。脱敏在写 stdout 之前完成：删除原始 uri（含 query string）、全部请求头与响应头，再用 `log_append` 只写回 path 与 User-Agent；Keycloak 侧 `admin_events_details_enabled` 保持 false。

两个容易静默失效的实现事实：`jboss-logging` listener 不受 realm `enabled_event_types` 约束，事件收窄必须在 Alloy selector 上完成并由 CI 断言两边清单；成功事件默认只记到 DEBUG，不把 `org.keycloak.events` 抬到 debug，半年留存里就只剩登录失败。Docker → Alloy → Loki 的打标/不打标断言是真实验证。

### 内容角色切换与接口收敛

`content-admin` 是新增的独立领域角色，后台接口、前端入口与浏览器验收只认该角色；全站管理员仍通过 Keycloak 复合角色同时获得两个域，应用代码不重复做 super-admin 判断。切换顺序必须先创建角色并授予实际内容管理员，重新登录拿到包含 `content-admin` 的 claim，再切换应用侧授权；旧 access token 不会凭空出现新的复合角色。

联赛回放的三语名称、数字小组和具体时刻逐步加入时，曾为旧客户端并行提供多种接口形状。功能完成后，网站与新版客户端统一使用现代结构和无版本路径，移除旧格式转换与运行时回退；UP 主与视频推荐也统一使用现行分类接口，删除仅面向 UP 主的接口适配与前端回退。历史迁移、已保存回放和文字小组归档仍保留；旧客户端需要升级，接口切换与前后端部署作为同一次发布验收。

## 21. 2026-10-24 — 层级 authority 收口与「遮挡 / 可达」进入浏览器门禁

### 并行 z 刻度退役，局部层叠上下文真正建立

设计语言早就规定全局八档 `--z-*` 与场景型工作台内部的 1–9 局部刻度，但两件事只存在于文档：
`tokens.css` 还活着一套 deprecated 的并行刻度（`--z-topbar/--z-modal/--z-panel/--z-fullscreen`），
而回放工作台**没有任何** `isolation: isolate`——`position: relative` 与 `overflow: hidden` 都不建立
层叠上下文，于是"局部 1–9"实际上和组件里的裸 25/30/40/45 在页面外壳的上下文里裸比大小，
瞬态面（`--pb-z-modal: 9`）反而是最低的一层。并行刻度删除，隔离点落在 `.playback-workspace`
与 `.pb-map`，局部阶梯补齐为 canvas/hud/scrim/controls/transient/modal，层级 authority 回到
`design-language.md` §5 一处。

### 遮挡与可达从"目视验收"变成确定性门禁

层级只决定谁盖住谁，不决定盖住多少、还点不点得到。这两条规则进入 §5 并由真实 Chrome 门禁强制：
共享探针 `frontend/scripts/browser-occlusion.mjs` 量主内容遮挡面积（取并集，不逐个相加）、
瞬态面与常驻控件的绘制次序（重叠区真实命中，不读 z-index 数值）、以及可见选项的命中区 / 裁剪 /
视口与可滚动触达。门禁自带负向对照（故意盖住主内容、把常驻控制条提回瞬态面之上都必须让它变红）
与空跑守卫，避免断言在没有重叠的状态下空转；探针常量与文档数值双向校验。

规则同时定义了 2D 与 3D 的形态差异：3D 是 game-style overlay HUD，常驻层按产品设计浮在场景上；
2D 的地图是主内容，常驻控件归控制条，地图盒里不放常驻 UI。依据是实测——手机横屏 740×360 下
2D 地图只有 96×96 px，任何满足触控下限的常驻入口都会占掉它 10% 以上并压进中心区。

## 22. 2026-10-25 — 交互机制交给成熟 primitive，policy 仍归 Design Language

自研的 focus trap、roving focus、outside-click、ARIA 状态机和 overlay 生命周期分散在 `AppDialog`、
`MenuButton`、`BattlePicker`、`SegmentedControl` 与各页面手写的手机 sheet 中，每处都在重复实现同一套
WAI-ARIA 行为，也是 #727 类遮挡问题的温床。方向是把通用交互机制交给 Reka UI（unstyled、无自带主题），
浏览器/Vue 管线交给 VueUse，低频 UI chrome 的过渡交给 motion-v；WotbTools 组件保持原有 API，
Design Language 与语义 token 仍是唯一的视觉与动效 policy 来源。

- **第三方 primitive 不外泄**：`reka-ui`、`motion-v` 只在 WotbTools 组件边界内 import，由
  `frontend/src/shared/ui-dependency-ownership.test.ts` 强制；页面层不理解第三方 class / theme 词汇。
- **motion 的 policy 来源不变**：`frontend/src/shared/motion/motionPolicy.ts` 从 CSS token 读取时长与缓动，
  `prefers-reduced-motion` 时 token 归零；Reka 管理的 overlay 进出场用 token 驱动的 CSS keyframes
  （Reka 的 Presence 按 CSS animation 判定退场），motion-v 只用于需要 shared layout / 列表增删的位置。
  播放帧路径（3D / 2D 场景、timeline、HP、camera）不进入 motion。
- **VueUse 只收敛机制**：breakpoint 仍由 `useBreakpoint()` 唯一拥有，持久化仍归各自 owner，
  `useStorage` / `useBreakpoints` 由 ownership guard 禁用；与 Reka 传递依赖对齐主版本，避免两份 VueUse。
- **TanStack Table 试点不通过**：现有表格的自研状态只有 sort 键与方向（`AggregateTable` 约 20 行），
  引入列定义与 row model 适配层后净代码不减少，也没有 pinning / grouping / visibility 等收益场景，
  因此不引入依赖。
- **Floating UI 不作为直接依赖**：定位与碰撞由 Reka 内置承担，避免出现第二个 positioning owner。

## 23. 2026-10-25 — 前端包管理从 npm 换成 pnpm：本机安装默认不执行第三方代码

npm 时代任何依赖（含传递依赖）的 `preinstall` / `install` / `postinstall` 都会在贡献者本机无条件执行，
扁平 `node_modules` 让代码可以 import 未声明的包；另有一段只为绕开 npm 可选依赖缺陷存在的
`optionalDependencies`（手工列出 Linux 原生包）。换成 pnpm 的理由是本机环境安全与安装速度：

- **安装脚本 fail-closed**：`frontend/pnpm-workspace.yaml` 的 `allowBuilds` 是唯一放行名单（`esbuild`），
  `strictDepBuilds` 让任何未审查的安装脚本直接让安装失败，放行一个包必须经过 PR 审查。
- **新版本隔离期**：`minimumReleaseAge` 不解析发布不足 24 小时的版本，给被投毒的新版本留出被发现、
  撤回的时间窗口。
- **隔离布局**：只有 `package.json` 声明的依赖可被 import；平台原生包由 pnpm 按平台解析，npm 的
  `optionalDependencies` 绕行随之删除。
- **单一版本来源**：pnpm 版本由 `package.json#packageManager`（带 sha512）钉住，本机与 Docker 经 corepack、
  CI 经 `pnpm/action-setup` 读取同一字段；锁文件由 `pnpm import` 从原 `package-lock.json` 转换，解析版本不变。

## 24. 2026-10-26 — Frontend 镜像构建从 TX1 迁到 TX2：构建内存与部署宿主分离

#753 引入 Reka / VueUse / motion-v 后，`vite build` 的 V8 old-space 需求升到约 1.05 GiB。TX1 是
1.9 GiB / 2 vCPU 的生产部署宿主，常驻 Business API、Keycloak、PostgreSQL、Caddy 与 Frontend；
默认堆直接 OOM，1152 MiB 堆试跑时只剩 174 MiB available / 229 MiB free swap，会威胁生产容器。
把堆上限继续调大不是安全修复——TX1 没有对应内存。

TX2（3.6 GiB / 4 vCPU）承担 Frontend 镜像构建：同一 commit 的完整 Docker 构建（含 WASM 与
资产源校验）通过，构建后仍有 2.9 GiB available，未消耗 swap；TCR 凭据对
`wotbtools/wotbtools-frontend` 有 push scope。构建仍发布同一 immutable TCR tag，TX1 的 deploy
job、Caddy 入口与 TX2 的 frontend replica 都继续消费该 artifact。Frontend build cache 与
`build.lock` 留在 TX2，与 TX1 的 Business API builder 分离；TX2 不因此获得 Frontend 部署 owner。
TX2 的发行版 Docker CLI 没有 buildx 插件，构建脚本只在远端 digest 查询时回退到
`docker manifest inspect --verbose`，构建本身仍走 `docker build`。

## 25. 2026-10-28 — 仓库历史重写后的 Gitee 镜像：首推是全量，镜像不该是发布前置

仓库 hygiene 重写把 main force-push 成全新 commit 图。旧 Gitee tip（`4c3dbcba`，重写前最后一次
成功镜像）与新 main **没有共同祖先**，历次 commit 的树也都是新对象——实测把新 main 推给旧远端需要
约 **300MB**（`git bundle create main --not 4c3dbcba` = 306MB）：只有 tip 的树内容落在共同 blob 上，
历史本身是整张新的。所以重写后的**首次**镜像不是增量而是全量上传，Gitee 侧对新图的对象持有量为零。

失败过程与预算：20 分钟 job 连续三次失败，把 job 提到 60 分钟仍然失败。三次日志都停在
`Git LFS initialized.` 之后整整 59 分钟没有任何输出——hub-mirror-action 的 Python 输出是块缓冲，只在
进程退出时 flush（重写前成功那次同样把 `(1/3) Downloading…`…`Total: 1` 全部挤在结束时间戳上）。
所以"没有进度日志"不等于"没有传输"，我们看不到它卡在 clone、Gitee API 还是 push 哪一段。另一个
致命点：action 的 `timeout: 45m` 只给单次 git 命令设上限，超时被 kill 后**重试从头再来**（不续传），
任何小于完整传输时间的 kill 都兑现不了 300MB；job 上限再大也只是循环烧预算。

结论：把 300MB 跨境全量推送放在发布门禁里，调多大的 job 预算都不是可靠链路。于是改结构：

- **镜像独立成 one-owner workflow，不参与任何发布 run**。`gitee-mirror.yml`（`push: main` +
  `workflow_dispatch`，concurrency `production-gitee-mirror`）拥有镜像；`frontend.yml` /
  `business-api.yml` 只剩 build/deploy，`build` 也不再 `needs` 镜像。这一点不是洁癖：
  `frontend-replica.yml` 只在 `Frontend` run **completed + success** 后更新 TX2，镜像若留在发布
  run 里，一个最长 180 分钟的任务就会让 TX1 已上线的新版本与 TX2 旧版本在 Caddy 2:8 双端混服
  数小时（hashed asset 还会在另一端 404），而被新 push 取消的 run 根本不会触发 replica。
  单次 Git 命令预算 `100m`（job `180m`）使这一次全量推送有机会在单个 attempt 内完成。若仍推不完，
  运维补救是在国内网络执行一次 `git push --mirror`（一次性 bootstrap），之后 CI 回到增量推送。
- **源物化按 exact SHA 兜底**。`deploy/tx/build-*-from-gitee.sh` 的 `materialize_source` 先等镜像
  （`GITEE_WAIT_ATTEMPTS` × 间隔，稳定态只取增量），追不上就
  `git fetch --depth 1 <github-url> <sha>` 只取该 commit 的树：GitHub 允许按未通告的 SHA 浅取，实测
  **53MB / 18s**，是 300MB 全量的 1/5.6 且不含历史。取到的对象与镜像路径同构（`rev-parse`、
  `show <sha>:path`、`show -s --format=%ct`、`worktree add` 全部可用），所以 epoch /
  `deploy/agent/source.json` / worktree 的既有校验不需要任何特判；两条路径都拿不到该 SHA 才
  fail closed。
- 发布证据记录实际传输（`source_transport=gitee-mirror|github-exact-sha`、
  `github_exact_fetch result=PASS`），使"这次靠兜底发出去"可复查，不会被静默当成镜像正常。

对镜像的长期要求不变：它仍是国内用户的首选克隆源，重写后必须补齐那一次全量推送；补齐之后每次
推送回到几 MB 增量，180 分钟与 `100m` 都不会被用到。

重写的另一处 blast radius（同一提交修复）：`deploy/test-flyway-immutability.sh` 的"已批准 V18
历史恢复"用例硬编码 base commit `8d94a24c`，该 commit 现在只经由旧 android 发布标签可达；
`ci-deployment.yml` 的 checkout 默认不取 tags，于是这个用例在重写后首次运行时解析不到 base
commit（`Flyway immutability guard cannot resolve base commit`）。checkout 因此显式
`fetch-tags: true`——用例校验的是真实的生产恢复记录，不该改成任意当前 commit。

## 已退役 / 过渡架构

- **Boost / Coaching** — 曾经形成完整有状态业务，后续连同 DB / frontend / roles 一并退役。
- **In-repo `replay-engine/` Rust parser** — Java→Rust 客户端迁移的过渡实现；确认上游 Agent Rust Core 为唯一 parser 后删除，避免双解析权威。
- **Service-side Java Replay Parser / Reconstruction input pipeline** — 该切换后服务器不再读取 Replay bytes。
- **Distributed Replay Processing** — PostgreSQL Processing Job、RabbitMQ delivery、Yecao Parser Worker、MinIO temporary dataset workspace 曾是唯一生产执行架构；客户端解析完成后整体退役。
- **Processed Dataset as cross-feature boundary** — Data / Playback / AI 曾复用服务器 Processed Dataset；现在由 client canonical facts + consumer projection 取代。
- **Local Replay Execution** — Distributed Replay 迁移期间的 compatibility path，分布式链路完成后删除。
- **Memory Replay Job Authority** — 迁移/开发时期 fallback；production 后来只允许 PostgreSQL authority，并最终随 Processing Job 域整体删除。
- **wotb-control** — standalone Control Plane POC；最终 production control responsibility 留在 Business API。
- **Yecao legacy application runtime** — 原 production application host；TX cutover 后退役。Yecao 当前保留 AI Service、Observability 与 Komodo Core，不是旧整站 runtime 的恢复。
- **WebView-owned Android authentication** — Android 2.0 后由 Native AppAuth / PKCE 取代；不允许通过 bridge v1 回退。
- **PRE/POST cutover machinery** — 一次性 migration verification；迁移完成后删除。
- **业务数据完整性迁移 token** — 用于搬迁验收的 snapshot invariant，不是长期 production invariant。

## 从演进中形成的长期原则

1. **事实先于解释。** Canonical facts 层决定可陈述的事实；LLM 只解释事实。
2. **权威必须显式。** Parser、domain semantics、storage、identity、deployment control 与 business state 不互相冒充 authority。
3. **客户端 canonical facts 是 Replay 能力边界。** Replay 在用户设备解析一次，再投影给 Data / Rating / Export / Playback / AI；不恢复服务器 Processed Dataset。
4. **认证身份不是游戏身份。** Keycloak lifecycle 不拥有长期游戏数据生命周期。
5. **服务器没有 Replay parser。** 缺字段向锁定的上游 parser 补；解析失败不回退服务端，也不在消费端复制第二套协议解码。
6. **固定版本的 parser 不等于语义权威。** Agent Release 决定实际运行哪份 decoder；WotbTools canonical 层决定领域语义。上游研究结论不会仅因来自 parser producer 就自动提升 evidence grade。
7. **运行时来源与研究来源必须分离。** Production artifact 用 release commit + hash 锁定；研究引用用独立 commit / blob 锁定，避免把运行版本与研究文本混为一谈。
8. **control plane 不会自动成为 release authority。** Komodo 可以管理资源与 workload lifecycle，但 immutable artifact identity、Git-reviewed placement、数据库 authority 与 owner workflow 保持独立。
9. **宿主 ready 不等于 workload ready，service ready 也不等于端到端验收。** TX2 host ready、AI readiness=UP、容器 healthy 都不能替代真实生产路径验收。
10. **兼容层的目的是帮助迁移，不是成为永久架构。**
11. **迁移检查应在迁移结束后退役。** 长期只保留仍然有效的 runtime invariant。
12. **未知就保持未知。** 无法从 Replay 或 Git 历史证明的事实与决策理由，不补写猜测。

## 已知历史不确定项

### 为什么最初选择 WireGuard

Git 历史能够证明 WireGuard 最终成为 TX 与 Yecao 之间的 private cross-cloud transport boundary，RabbitMQ 与 MinIO 的跨云访问也建立在这条边界上；当前 AI、Komodo 与跨节点 service-plane 也继续复用它。

但目前没有可靠证据恢复为什么最初选择 WireGuard 而不是其他方案，因此本文不声明原因。

### 为什么 standalone wotb-control 最终没有保留

Git 历史能够证明 wotb-control 是 planned dual-cloud split 期间的独立 Control Plane 探索，也能证明最终 production control responsibility 留在 Business API，POC 随后被删除。

当时没有继续 standalone service 的完整决策理由已经无法可靠恢复，因此本文只记录结果，不补写推测。

## 阅读关系

- HISTORY.md：产品/业务演进历史；技术/架构演进见本文。
- docs/architecture/TECHNICAL_EVOLUTION.md：技术决策、authority 与 boundary 的 canonical timeline。
- docs/architecture/*.md：当前各子系统详细架构。
- docs/operations/ai-service.md：独立 AI Service 的生产边界与验收。
- docs/operations/komodo-*.md：Komodo Core / Periphery / ResourceSync / TX2 workload 与 K7C 的运行契约。
- Git Commit / Pull Request：逐实现事实与原始证据。
