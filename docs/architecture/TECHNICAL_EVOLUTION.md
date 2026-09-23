# WotbTools 技术演进

本文记录 WotbTools 的 canonical technical evolution：重点不是逐版本列功能，而是解释关键技术决策为什么出现、哪些边界或权威发生了变化，以及哪些方案后来只是迁移机制并已退役。

HISTORY.md 记录项目整体产品与工程历史；本文只聚焦架构、数据流、identity、authority 与 production topology。Git Commit / Pull Request 仍是实现事实源。

---

## 当前架构一览

~~~text
Internet
   |
   v
Tencent Cloud
+--------------------------------------+
| Caddy / Public Edge                  |
| Frontend                             |
| Keycloak                             |
| Business API + Replay Control Plane  |
| Business PostgreSQL                  |
| RabbitMQ                             |
+------------------+-------------------+
                   |
                WireGuard
                   |
+------------------v-------------------+
| Yecao Cloud                          |
| Replay Parser Worker                 |
| MinIO temporary workspace            |
| Observability                        |
+--------------------------------------+
~~~

当前 Replay 主链路：

~~~text
Replay -> Processing Job -> RabbitMQ -> Yecao Parser Worker
       -> Processed Dataset / MinIO
       -> Canonical Replay Facts
       -> Replay Reconstruction
       -> Canonical BattleTimeline
            -> Data
            -> Battle Playback
            -> Evidence -> AI Review
~~~

核心原则是：每一种事实只有一个明确 authority。RabbitMQ 负责 delivery，不拥有 Job State；LLM 负责战术解释，不拥有 Replay Facts。

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

## Current Authority Model

| Concern | Authority |
|---|---|
| Authentication identity | Keycloak |
| Business user binding | user_profile / PostgreSQL |
| Game identity | (server, WotB accountId) |
| Replay operation identity | (subject, operationId) |
| Processing Job lifecycle | PostgreSQL |
| Battle settlement facts | battle_results.dat |
| Replay protocol facts | version-scoped protocol decoder |
| Canonical battle timeline | Replay Reconstruction / deterministic backend |
| Temporary processed dataset | MinIO |
| Distributed delivery | RabbitMQ — transport only |
| Replay execution | Yecao Parser Worker |
| Tactical interpretation | LLM — interpretation only |

## Retired / Transitional Architecture

- **Boost / Coaching** — 曾经形成完整有状态业务，后续连同 DB / frontend / roles 一并退役。
- **Local Replay Execution** — Distributed Replay 迁移期间的 compatibility path，分布式链路完成后删除。
- **Memory Replay Job Authority** — 迁移/开发时期 fallback；production 最终只允许 PostgreSQL authority。
- **wotb-control** — standalone Control Plane POC；最终 production control responsibility 留在 Business API。
- **Yecao legacy application runtime** — 原 production application host；TX cutover 后退役。
- **PRE/POST cutover machinery** — 一次性 migration verification；迁移完成后删除。
- **business-data-integrity migration token** — 用于搬迁验收的 snapshot invariant，不是长期 production invariant。

## 从演进中形成的长期原则

1. **Facts before interpretation.** Backend 决定事实，LLM 解释事实。
2. **Authority must be explicit.** Transport、storage、identity 与 business state 不互相冒充 authority。
3. **Processed Dataset is a capability boundary.** Replay 解析一次，Data / AI / Playback 复用。
4. **Authentication identity is not game identity.** Keycloak lifecycle 不拥有长期游戏数据生命周期。
5. **Execution placement is not coordinator responsibility.** Coordinator 通过 contract dispatch，executor 可以位于另一台服务器。
6. **Compatibility exists to enable migration, not to become permanent architecture.**
7. **Migration checks should retire after migration.** 长期只保留 live runtime invariants。
8. **Unknown stays unknown.** 无法从 Replay 或 Git 历史证明的事实与决策理由不补写猜测。

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
