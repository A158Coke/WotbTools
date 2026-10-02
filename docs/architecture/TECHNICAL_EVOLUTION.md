# WotbTools 技术演进

本文记录 WotbTools 的 canonical technical evolution：重点不是逐版本列功能，而是解释关键技术决策为什么出现、哪些边界或权威发生了变化，以及哪些方案后来只是迁移机制并已退役。

HISTORY.md 记录项目整体产品与工程历史；本文只聚焦架构、数据流、identity、authority 与 production topology。Git Commit / Pull Request 仍是实现事实源。

---

## 当前架构一览

~~~text
User device
+---------------------------------------------------------+
| Browser / Android WebView                               |
| .wotbreplay                                             |
|   -> pinned WoT-Blitz-Agent Rust Core WASM             |
|   -> WotbTools replay-local canonical facts            |
|      -> Data / League Rating / Export                   |
|      -> 2D Playback                                     |
|      -> AI projection                                   |
|   -> 3D Playback / shot replay consume Agent facets    |
+--------------------------+------------------------------+
                           |
                         HTTPS
                           |
                           v
Tencent Cloud
+---------------------------------------------------------+
| Caddy / Public Edge                                     |
| Frontend                                                |
| Keycloak                                                |
| Business API                                            |
| Business PostgreSQL                                     |
+--------------------------+------------------------------+
                           |
                        WireGuard
                           |
+--------------------------v------------------------------+
| Yecao Cloud                                             |
| AI Service                                              |
| Observability                                           |
+---------------------------------------------------------+
~~~

当前 Replay 主链路：

~~~text
.wotbreplay (parsing is local; bytes leave the device only for explicit evidence upload, e.g. HoF)
   -> pinned Agent WASM
   -> frontend trust-boundary validation
   -> WotbTools canonical replay facts
        +-> batch compute / League Rating / export
        +-> 2D playback projection
        +-> AI projection --gzip--> Yecao ai-service
        +-> HoF submission facts + replay evidence attachment
~~~

服务器**没有 Replay parser，也没有 Replay Processing Job / Parser Worker / RabbitMQ / MinIO temporary dataset 链路**。上游 Agent Rust Core 负责锁定版本下的字节解码；WotbTools 的 `replay-local/canonical` 负责领域语义与消费边界。外部 Agent 研究材料是 provenance，不因其同时提供生产 parser 而自动成为 WotbTools canonical authority。LLM 只负责战术解释，不拥有 Replay Facts。

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

**Git evidence:** 6edb2d36、05049a7e、00fc0713。

## 2. 2026-06-24～06-27 — Event Stream、Rating 与持久业务状态

最初 Replay 主要提供结算结果。第一次深入 Event Stream 的直接目的，是确定死亡时间，从而得到 survival time；它不是一开始就为了 AI Review 建立的。

Event Stream 随后开始支持更丰富的行为分析与 Rating。排行榜又带来跨 Replay 的长期业务状态需求，因此 PostgreSQL 被引入。选择 PostgreSQL 的现实原因是开源且使用方便。

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

**Git evidence:** 87857033、f21cec8c、33bfe19a、81135740、51339c00。

## 3. 2026-06-26～07 — Authentication Identity 与 Business Identity 分离

随着 Web 服务开始需要知道实际用户量并进行 RBAC，项目引入 Keycloak。Keycloak 的职责是认证与角色边界，而不是成为所有业务数据的身份主键。

随后 user_profile 把 Authentication Identity 与 Business Identity 分开，为账号绑定和长期业务状态建立独立模型。

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

**Git evidence:** 91c6f5c4、01412d57、ab3c5a0d、a795c603、d78e35a5、a0a5bc49、2f78e06a。

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

**Git evidence:** 62f2e7ac、f30ef415、a22b2508、ec956315。

## 7. 2026-08-29 起 — Android Thin Client 与 Replay Operation Identity

Android 被设计成 Thin Client，而不是第二套 WotbTools。

~~~text
Android Native
  = OS integration / replay intent / cache / update / bridge

Web
  = Replay / AI / Playback / product behavior
~~~

外部 Replay intent 随后暴露了 auth redirect、process death 和 retry 下的重复提交问题。Native pendingId 因此成为 backend operationId，并形成端到端幂等协议：

~~~text
identity = (authenticated subject, operationId)

ABSENT -> IN_FLIGHT -> COMMITTED(jobId)
~~~

只有 dispatcher 接受任务后才能 COMMIT。后来的 Distributed Replay 沿用了这一 invariant，并进一步把 accepted 收紧为 RabbitMQ publisher-confirmed 且 routable。

**Git evidence:** 97aad637、166000d4、cdd122b8、f4eeaac7、4915e820。

## 8. 2026-08-31～09 — Planned Dual-Cloud Foundation

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

**Git evidence:** d4d9a459、c8482c91、d2a823ed、ff311c87、ad4eff6a。

## 9. 2026-09 — Replay Coordinator / Processing 分离

Tencent 更适合作为大陆入口，但资源有限；Yecao 有 2C4G，计算资源更多。因此 Replay coordination / job management 与实际 parsing execution 被拆开。

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

代码先建立 wotb-replay-coordinator、wotb-replay-processing、ReplayProcessingDispatcher 等边界，再由后续 broker/object-storage adapter 实现真正远程执行。

**Git evidence:** 8c6e8c9e、bfe14714、c85b9a27。

## 10. 2026-09 — Durable Game Identity

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

Replay recorder 后来还能作为绑定账号的 proof：只有 canonical recorder account 与绑定的 (server, accountId) 匹配才标记 verified；换绑会使验证失效，只改昵称不会。

**Git evidence:** e5550a0e、8fac89ff、79d1fe50、ed737605、314e3fb1。

## 11. 2026-09-19～09-22 — Distributed Replay 成为唯一生产执行架构

基础设施开始实现之前已经确定的责任边界。

### PostgreSQL — Job State Authority

Processing Job、Source、Operation identity 与 lifecycle 状态迁入 PostgreSQL。PostgreSQL 成为 durable authority，而不是依赖单进程内存。

### MinIO — Temporary Dataset Workspace

MinIO 部署在 Yecao。主要原因是 TX 已经承载较多服务，而 Yecao 整体负载较低，因此临时对象存储放在 Yecao 更合理。

它保存 temp/jobs/<job-id>/... 这类 distributed Replay workspace，不是 Business DB，也不是 HoF 永久 Replay archive。

### RabbitMQ — Delivery Layer

RabbitMQ 部署在 TX，靠近 Control Plane。它负责 request/result/failure delivery，但不拥有 retry counter、attempt limit 或 Job State；这些仍由 PostgreSQL authority 决定。

### Parser Worker — Execution

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

**Git evidence:** 5da8926b、a81267b5、04e02e76、6b915712、21378900、f2bea028、89d1d372、5f3781d2、90a09492、d4bb20db、ad02b09c。

## 12. 2026-09-16～09-23 — Tencent 成为 Production Authority

TX 先建立 Frontend、Keycloak、Business PostgreSQL、Business API 与 production IaC，再通过 pre-cutover checks 验证目标环境。

Business PostgreSQL 放在 TX，是因为 TX 已经承载 Business API 和其他 backend services；数据库与业务服务保持 locality，避免核心业务数据库长期依赖跨云访问。

OpenTofu 与 Flyway 的 authority 被明确分开：

~~~text
OpenTofu = database / role / grants / infrastructure ownership
Flyway   = tables / indexes / sequences / application schema
~~~

完成 DNS / public traffic cutover 后，Yecao 上的 PostgreSQL、Keycloak、Backend、Frontend 等 legacy application runtime 被删除。Yecao 没有变成 TX 的备用站，而是正式转型为 Replay execution / temporary storage / observability node。

迁移完成后，PRE_CUTOVER_READY、POST_CUTOVER_READY、migration snapshot 等一次性机制也被删除；仍然有长期价值的检查收敛为 TX_RUNTIME_READY。

~~~text
Migration invariant != Runtime invariant
~~~

**Git evidence:** 81097302、966181da、6a5e17ed、050d423a、6942f2c7、532542ae、036eef8e、86d9fe50。

---


## 13. 2026-09-30～10-02 — Replay Execution 从跨云服务迁回客户端，服务器 parser 归零

仓库内 `replay-engine/` Rust 移植最初用于把 Java Replay Parser 带到 Web / Android，但上游 WoT-Blitz-Agent 已经维护同一问题域的 Rust Core，并为结算、Playback、射击复现和 AI Review 提供 WASM facet。继续维护第二套 parser 会重新制造双事实源，因此 WotbTools 先退役仓库内 Rust 移植，再把上游 Agent 作为唯一字节解析依赖。

依赖不是浮动跟随 upstream main。生产前端只消费 `deploy/agent/source.json` 锁定的 Release artifact；#447 cutover 初始锁定 `v0.3.8` / `f35baa46…`，#451 为 additive 装填遥测升级到 `v0.3.9` / `b4e50e13…`，两者都校验 Release asset SHA-256。WASM 升级必须重新通过仓库 fixture 上的真实 replay → WASM → WotbTools projection parity gate。

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
   -> only explicit server-side capability payloads cross the network (for example AI projection or HoF evidence)
~~~

#447 因此删除服务端 Java parser、Processing Job / Dataset API、Parser Worker、RabbitMQ、MinIO temporary replay workspace 以及相关 processing tables、deployment、CI 与 IaC。这里不是把 executor 从 Yecao 搬到 TX，而是**删除服务器侧 Replay execution 这个职责本身**。

WotbTools 没有把上游 facet 当作领域模型直接传播。边界固定为：

~~~text
Agent facet DTO
   -> version / shape trust-boundary validation
   -> frontend/src/replay-local/canonical
   -> consumer-specific projection
~~~

2D Playback 与 AI Review 共用 canonical facts；3D / shot replay 可以直接消费其专用 Agent facet，但不能因此把渲染态或上游私有字段提升为 WotbTools canonical truth。缺失的 Replay 字段向上游补，不在服务端恢复 parser，也不在消费端复制一套启发式解码。

#451 把这一边界扩展到实时装填：Agent v0.3.9 的 `PlaybackData.reloads` / `reload_effective`
只作为 3D OTM 的专用输入。前者保留本方 arena 装填族与服务器弹量快照，后者保留 method 35
的当前有效完整装填时长；WotbTools 只解释经真实回放和客户端 UI 交叉闭环的相位子集，并用
纯时间函数保证 seek 确定性。协议没有敌方装填流，因此敌方不绘制装填状态，缺失继续表示 unknown。
这些字段没有进入 `frontend/src/replay-local/canonical`，避免把呈现专用语义升级成全局事实 authority。

AI Review 也随之退出 Processed Dataset 模型：浏览器本地建立 `ClientAiReviewProjection`，gzip 提交给 Yecao 独立 `ai-service`；服务端 adapter 只做结构校验与确定性内存归约，不读取 Replay 字节。Hall of Fame 则明确采用另一种信任边界：client facts 只做结构校验，原始 Replay 作为 evidence attachment，真实性由管理员审核承担；它不是认证或授权事实。

同一轮还把**运行依赖 provenance**与**研究证据 provenance**分开。生产依赖由 `deploy/agent/source.json` 锁 Release commit + artifact hash；外部交叉验证文档则锁具体 upstream research commit / blob。上游项目既是 parser producer 又是 research source，但这两个身份不改变 WotbTools evidence promotion rule：external-only claim 仍需本地 corpus 或 controlled probe 独立复现。

**Git evidence:** `82f1e26c`（上游 WASM 成为客户端解析方向）、`0dc4767e`（#447：服务端 parser 与 distributed replay pipeline 退役）、PR #451（3D 装填遥测消费）；upstream releases `v0.3.8` = `f35baa46…`、`v0.3.9` = `b4e50e13…`。


## Current Authority Model

| Concern | Authority |
|---|---|
| Authentication identity | Keycloak |
| Business user binding | `user_profile` / PostgreSQL |
| Game identity | `(server, WotB accountId)` |
| Replay bytes | user device, except explicit business evidence uploads |
| Replay byte decoding | pinned WoT-Blitz-Agent Rust Core WASM (`deploy/agent/source.json`) |
| Battle settlement facts | `battle_results.dat`, decoded by the pinned Agent parser |
| WotbTools replay-domain semantics | `frontend/src/replay-local/canonical` + version-gated consumer contract |
| Batch compute / League Rating / export | deterministic client compute under `frontend/src/replay-local/` |
| 2D playback facts | WotbTools canonical facts + playback projection |
| AI request facts | `ClientAiReviewProjection` produced from client canonical facts |
| AI canonical timeline | deterministic `ClientAiProjectionAdapter` / reconstruction inside `ai-service` |
| Hall of Fame authenticity decision | replay evidence + administrator review; client facts are intentionally untrusted |
| Tactical interpretation | LLM — interpretation only |

## Retired / Transitional Architecture

- **Boost / Coaching** — 曾经形成完整有状态业务，后续连同 DB / frontend / roles 一并退役。
- **In-repo `replay-engine/` Rust parser** — Java→Rust 客户端迁移的过渡实现；确认上游 Agent Rust Core 为唯一 parser 后删除，避免双解析权威。
- **Service-side Java Replay Parser / Reconstruction input pipeline** — #447 后服务器不再读取 Replay bytes。
- **Distributed Replay Processing** — PostgreSQL Processing Job、RabbitMQ delivery、Yecao Parser Worker、MinIO temporary dataset workspace 曾是唯一生产执行架构；客户端解析完成后整体退役。
- **Processed Dataset as cross-feature boundary** — Data / Playback / AI 曾复用服务器 Processed Dataset；现在由 client canonical facts + consumer projection 取代。
- **Local Replay Execution** — Distributed Replay 迁移期间的 compatibility path，分布式链路完成后删除。
- **Memory Replay Job Authority** — 迁移/开发时期 fallback；production 后来只允许 PostgreSQL authority，并最终随 Processing Job 域整体删除。
- **wotb-control** — standalone Control Plane POC；最终 production control responsibility 留在 Business API。
- **Yecao legacy application runtime** — 原 production application host；TX cutover 后退役。
- **PRE/POST cutover machinery** — 一次性 migration verification；迁移完成后删除。
- **business-data-integrity migration token** — 用于搬迁验收的 snapshot invariant，不是长期 production invariant。

## 从演进中形成的长期原则

1. **Facts before interpretation.** Canonical facts 层决定可陈述的事实；LLM 只解释事实。
2. **Authority must be explicit.** Parser、domain semantics、storage、identity 与 business state 不互相冒充 authority。
3. **Client canonical facts are the Replay capability boundary.** Replay 在用户设备解析一次，再投影给 Data / Rating / Export / Playback / AI；不恢复服务器 Processed Dataset。
4. **Authentication identity is not game identity.** Keycloak lifecycle 不拥有长期游戏数据生命周期。
5. **The server has no Replay parser.** 缺字段向锁定的上游 parser 补；解析失败不回退服务端，也不在消费端复制第二套协议解码。
6. **Pinned parser is not semantic authority.** Agent Release 决定“实际运行哪份 decoder”；WotbTools canonical 层决定领域语义。上游研究结论不会因为来自 parser producer 就自动提升 evidence grade。
7. **Runtime provenance and research provenance are separate.** Production artifact 用 release commit + hash 锁定；研究引用用独立 commit / blob 锁定，避免“运行版本”与“研究文本”混为一谈。
8. **Compatibility exists to enable migration, not to become permanent architecture.**
9. **Migration checks should retire after migration.** 长期只保留 live runtime invariants。
10. **Unknown stays unknown.** 无法从 Replay 或 Git 历史证明的事实与决策理由不补写猜测。

## Known Historical Uncertainties

### 为什么最初选择 WireGuard

Git 历史能够证明 WireGuard 最终成为 TX 与 Yecao 之间的 private cross-cloud transport boundary，RabbitMQ 与 MinIO 的跨云访问也建立在这条边界上。

但目前没有可靠证据恢复为什么最初选择 WireGuard 而不是其他方案，因此本文不声明原因。

### 为什么 standalone wotb-control 最终没有保留

Git 历史能够证明 wotb-control 是 planned dual-cloud split 期间的独立 Control Plane 探索，也能证明最终 production control responsibility 留在 Business API，POC 随后被删除。

当时没有继续 standalone service 的完整决策理由已经无法可靠恢复，因此本文只记录结果，不补写推测。

## 阅读关系

- HISTORY.md：产品、架构与工程整体历史。
- docs/architecture/TECHNICAL_EVOLUTION.md：技术决策、authority 与 boundary 的 canonical timeline。
- docs/architecture/*.md：当前各子系统详细架构。
- Git Commit / Pull Request：逐实现事实与原始证据。
