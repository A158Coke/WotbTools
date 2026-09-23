# WotbTools 项目历史

本文记录 WotbTools 的主要产品、架构与工程演进。它不是逐版本变更日志，也不试图重复 Git 已经保存的实现细节；重点记录当时为什么做出关键选择、这些选择解决了什么问题，以及它们如何影响后续设计。

Git Commit 与 Pull Request 是历史证据的事实源；本文是项目演进叙事的事实源。日期按关键决策进入主线的时间记录。

---

## 2026-06-23 — 从 Replay 数据提取器开始

WotbTools 最初源于一个 Python 编写的 WoT Blitz Replay 数据提取工具，目标是解析 `.wotbreplay` 文件、汇总玩家战斗数据，并提供 Excel 导出与可视化能力。

项目建立 Git 仓库后，很快将主要实现迁移到 Java 21，并建立共享的 `wotb-core`，将 Replay 解析、数据聚合和导出能力与具体交付方式分离。

早期同时尝试了 Web 和基于 Spring Boot + Vue + jpackage 的本地离线版本。离线版本是一次短期产品方向探索，随后项目选择 Web 作为主要发展方向。

**Git 证据：** `6edb2d36`、`05049a7e`、`00fc0713`。

## 2026-06-24 — 为 AI 复盘开始解析战斗过程

WotbTools 最初主要读取 Replay 中的最终战斗结果，可以知道玩家最终造成了多少伤害、获得了什么结果，但这些数据不足以支撑 AI 对一场战斗进行真正的复盘。

为了给 AI 提供足够的战斗证据，项目开始进一步解析 Replay 的事件流，从中提取时间、位置、移动、死亡以及其他战斗过程信息。这使 Replay 解析目标从“提取最终结果”发生变化：项目不仅需要知道一场战斗最后发生了什么，还需要尽可能重建战斗是如何发生的。

事件流解析从一开始就是 AI 复盘的数据基础建设，而不是后来才被 AI 复盘复用。

同期项目也首次尝试从 Replay 原始数据计算玩家表现 Rating。这不是后来赛事 Rating 的直接实现，但建立了“从原始战斗事实推导表现评价”的早期思路。

**Git 证据：** `87857033`、`f21cec8c`、`33bfe19a`、`7ef93090`、`483244e3`、`13677236`、`4741dd08`。

## 2026-06-25～06-27 — 从工具转向长期运行的 Web 服务

项目将前端和后端逐渐分离为独立服务，为长期 Web 版本建立基础，离线版本随后退出主要发展路线。

排行榜需求首先推动了持久化能力落地。跨 Replay 长期保存和查询成绩不能依赖一次性文件处理，因此项目引入 PostgreSQL、Hibernate 和 Flyway，数据库开始成为长期业务状态的一部分。

随着账号绑定和用户资料出现，项目又需要稳定的用户身份，因此引入 Keycloak。WotbTools 从匿名 Replay 工具开始拥有长期身份边界，数据库和身份系统也为之后更复杂的业务能力提供了基础。

**Git 证据：** `81135740`、`fcbd9ce7`、`65b49772`、`62faf6ef`、`51339c00`、`58fca7a7`、`93aafb8e`、`2095fa23`、`6e31c809`、`0bef1090`、`fb47bc78`、`79806fa2`、`ae417d5f`、`331f5d31`、`71b52b89`。

## 2026-06-28～07-03 — 用户体系、代练业务与 Keycloak 扩展

Keycloak 引入后，项目继续建设用户资料和 WoT Blitz 账号绑定，身份开始从“谁能登录”进入业务模型。

同期项目探索 Replay 分析之外的玩家服务，引入 Coaching 与代练业务。代练并非单一页面，而逐渐形成请求、状态、人员分配、用户关系和后台管理等完整流程。数据库、身份和权限系统开始服务有状态业务，产品一度从 Replay 工具向更综合的平台扩展。

为了降低目标用户的登录门槛，项目开始支持 QQ 登录。现成方案不能完全满足需求后，项目开发和调整 Keycloak Identity Provider，使 Keycloak 从外部认证组件进一步成为拥有自定义身份扩展和映射逻辑的平台组件。

**Git 证据：** `47fbae0a`、`63ca1a2a`、`a5d0b788`、`252a0a74`、`d2671e5a`、`d6e6f708`、`439a8a2f`、`6fb53ac7`、`e538d4a6`、`c8ffac93`、`7f54a536`。

## 2026-07-05～07-14 — Rating V2 实验与用户业务深化

在早期 Rating 思路基础上，另一位开发者探索 Rating V2，基于 V1 进行实验性和扩展性开发，尝试另一套评价与榜单方式。潜在场均等能力也属于这条探索路线。

Rating V2 不应理解为后来赛事 Rating 的直接前身；它是基于早期 Rating 的独立实验分支。

同期项目开放用户注册，并继续完善代练业务中的角色、人员资料、用户删除数据清理、并发和审计等能力。此时 WotbTools 同时探索 Replay 数据分析、不同评价体系以及玩家服务等多个产品方向。

**Git 证据：** `ae4cefee`、`b0698264`、`dcb04ac8`、`429d3a59`、`67b71dd2`、`09ebd1d9`、`5726e9f0`、`ce2601c0`、`57460d43`、`046798c2`。

## 2026-07-22～07-26 — Reconstruction 建立，并首次形成 Evidence → AI Review 链路

在此前开始解析 Replay Event Stream 后，项目进一步建立 Battle Reconstruction。Replay Packet 被解码为领域事件，并通过 `BattleStateReconstructor` 重建战场状态、参与者、事件时间线和时间点 Snapshot。Replay 解析由单纯提取过程数据开始转向重建“战斗是如何发生的”。

Reconstruction 建立后，项目立即开始实验 AI 战术复盘。第一版 DeepSeek AI Review 将重建结果转换为紧凑的战斗上下文，并首先以管理员灰度能力上线。

实际逆向很快暴露出关键边界：能够从 Event Stream 解码某个字段，并不意味着已经知道它的游戏语义。项目因此停止将未经证明的 Type 7 数值直接解释为血量或伤害，开始区分证据来源：`battle_results.dat` 中的最终结算负责伤害、承伤、助攻、击杀、生存和胜负等权威事实；Reconstruction 负责位置、移动、事件顺序和战斗过程等可观察信息。AI 只能解释这些数据，而不能自行创造事实。

AI Review 随后扩展到批量 Replay。项目开始通过 Battle Identity、重复检测、Perspective Group 和 Representative Replay 区分“文件数量”和“真正的分析单元”。随机战采用个人视角，训练房和赛事则开始采用团队视角；同一场战斗的双方 Replay 保持独立 Perspective，而不是合并成事后全知视角。

到 07-26，AI 输入开始摆脱 Replay 的底层表示：Team Number 转换为 `FRIENDLY / ENEMY / UNKNOWN`，坐标获得有效性状态，时间统一为 Battle-relative Time，成员身份和地图位置也通过共享 Resolver 转换为领域语义。

**这一阶段建立了后来 AI 架构的基本方向：Replay Event Stream 用于 Reconstruction，权威结算与重建信息共同形成 Evidence，经过稳定领域语义转换后再交给 AI。**

**Git 证据：** `91c6f5c4`、`01412d57`、`a9e21024`、`ab3c5a0d`、`4997f459`、`88946cca`、`c5e7c9dc`。

## 2026-08-02～08-04 — 建立生产可观测能力

随着 AI Review 带来长耗时调用、外部服务依赖、超时和失败路径，单纯判断“服务是否在线”已经不足以理解生产状态。

项目引入 Grafana、Prometheus、Loki 和 Alloy，对 Replay 解析、AI Review、服务运行状态以及关键队列和失败路径建立观测，并持续修正指标边界和语义。

生产运维开始从“容器是否启动”转向“功能是否真正工作、调用停在哪里、失败发生在哪一层”。

**Git 证据：** `5f4cdc2a`、`d9459530`、`4cd46ffc`、`1356752f`、`cc00b5f7`、`de46255c`、`f6a4b165`、`422fa4a0`、`e357b786`、`f91df447`、`b7474a6`。

## 2026-08-05～08-06 — 建立面向国内外玩家的受控 IdP 登录体系

随着更多功能要求登录，项目不希望继续开放普通用户自注册，而是希望通过受控 Identity Provider 管理用户入口。

中国区使用 QQ；海外玩家则选择与 WoT Blitz 用户身份更相关的 Wargaming，而不是通用社交登录。Wargaming Provider 随后扩展到 ASIA、EU 和 NA，并将可信的游戏账号信息同步到业务 Profile。

因此登录模型逐渐形成：普通用户通过 IdP 进入，管理员仍保留管理入口；身份提供方不仅负责认证，也开始为后续游戏身份绑定提供可信来源。

**Git 证据：** `abaf07eb`、`edeb12a2`、`ad115e16`、`a634630f`、`83fe572c`、`ef69eb7c`、`0465a929`、`07f84759`、`b7c7c44a`、`23d28f20`。

## 2026-08-06 — 生产部署首次建立不可变 Release 与自动回滚

持续运行真实生产服务后，Docker `latest` Tag 已无法可靠回答“生产究竟运行哪一个源码版本”。项目因此首次将 Backend、Frontend 和 Keycloak 的生产镜像统一绑定到 Git Commit SHA，并通过 `DEPLOYED_SHA` 记录当前生产版本。

部署成功的定义也从“容器启动”扩展为关键应用路径通过健康检查。新版本启动或健康检查失败时，部署流程恢复此前保存的 Compose 和 Release SHA，并重新验证恢复后的服务。

不可变 Release 很快暴露出与增量构建的冲突：如果只构建发生变化的组件，就无法保证三个组件都存在同一个 `sha-<commit>` Artifact。项目选择 Release 完整性优先，每次生产发布统一构建完整 SHA Artifact Set。

部署配置随后采用 Candidate → Promotion：新的 Compose 先写入 `docker-compose.next.yml` 并验证镜像可获取，成功后才替换生产配置。回滚目标也不再简单等于“上一份 Compose”，只有引用的镜像确实存在时才允许覆盖此前保存的恢复目标。

**这一阶段首次建立后来 Release Contract 的核心思想：生产版本必须具有不可变身份，发布必须经过运行时验证，而回滚目标必须是已经证明可恢复的状态。**

**Git 证据：** `9460f5b4`、`9fea9a47`、`42b42904`。

## 2026-08-06～08-09 — 为 AI Review 建立游戏知识与战术语义

Reconstruction 可以描述战斗过程，但不能独立解释车辆能力、地图战术和阵容含义。项目因此开始为 AI 建立游戏领域知识。

车辆数据最初来自 Wargaming 官方数据，随后为了覆盖实际版本和新车逐步切换到 BlitzKit；地图位置也开始映射到战术区域、路线和关系。

从此 AI Review 的输入逐渐分成两个层次：Replay Evidence 描述“实际发生了什么”，游戏知识和地图语义帮助解释“这些事实意味着什么”。外部知识只能解释 Evidence，不能覆盖或改写 Replay 已经证明的事实。

**Git 证据：** `dadc1d74`、`c610b117`、`2828f1ab`、`0f1e3fac`、`c2777fde`、`31c65495`、`4e879886`、`c084ad29`、`60d13a34`、`8ecb5dde`、`16e48910`、`318637ee`、`d4fe6616`、`e56b70af`、`0916f0ab`、`dc372c14`。

## 2026-08-11～08-16 — Reconstruction 发展为可视化战局回放

Reconstruction 最初为 AI Review 服务，随后开始直接向人展示。项目陆续建立地图总览、路线、阶段以及 Battle Playback 时间线，并显示车辆位置、方向、死亡、射击、血量和争霸状态等信息。

Playback 因此成为 Reconstruction 的人类可见验证面：如果重建事实不正确，用户可以直接在战局回放中观察到问题。

随着逆向深入，项目也更明确地区分 Observed、Derived 和 Unknown。无法从 Replay 证明的信息保持未知，而不是为了视觉完整性填充猜测。车辆视觉资源则逐渐复用 BlitzKit。

架构由单一 AI 消费者扩展为共享事实层：

`Replay → Parser → Reconstruction → Battle Playback / Evidence → AI Review`

**Git 证据：** `c656095d`、`90748589`、`a0a17ac6`、`1ee0c1a1`、`46153376`、`febaf5ba`、`91cb82a4`、`2c9aebf6`、`b5734cca`、`efd7170a`、`c5082716`、`e7dfc0d5`。

## 2026-08-12～08-20 — AI Review 从 Prompt 调试走向 Evidence Contract

随着 AI Review 复杂度提高，仅通过 Prompt 要求模型“不要幻觉”已经不足以保证结果可靠。

项目开始建立 Evaluation Harness、Golden Cases 和回归验证，将知识状态逐渐转化为可执行契约；Canonical BattleTimeline 开始统一 AI 所依赖的事实，并逐步建立 Claim 与 Evidence 的绑定。

Backend 与 LLM 的责任边界因此被明确：

**Backend 决定事实，LLM 负责解释事实。**

AI Review 从 Prompt 驱动功能逐渐发展为具有 Evidence、来源、Knowledge State、质量门禁和回归体系的系统。

**Git 证据：** `a795c603`、`f85c3315`、`84b20edb`、`d78e35a5`、`8f831eee`、`d0607b3c`、`6eb8c10b`、`0f91c15b`、`c13282e2`、`99569147`、`99b40298`、`f5c3ba08`、`04aa4708`、`00503cfd`。

## 2026-08-17～08-18 — Leaderboard 演化为 Hall of Fame，并建立可审核的数据提交机制

早期排行榜主要从上传 Replay 的结果自动生成成绩。随着功能发展为 Hall of Fame，并开始保存百场、三环等不同荣誉，仅保存最终分数已经不足以支撑长期可信度。

项目开始保留原始 Replay，使成绩能够追溯到证据；百场等能力进一步采用一组 Replay Evidence 加管理员人工审核的流程。

数据模型因此从“保存结果”转向：

`提交 → Evidence → Review → Decision`

数据库和存储系统开始共同管理原始证据生命周期，而不只是最终业务结果。

**Git 证据：** `ebf2b4e6`、`674ae143`、`dc3f07db`、`03743d20`、`1bbcd9ab`、`f2b41bfd`、`4c643627`、`d2d3dd6b`、`62436731`、`03d2ed20`、`0590c1ae`、`69299717`。

## 2026-08-27～08-29 — Replay 研究收敛为生产级协议与事实模型

随着 AI、Playback 和 Rating 都依赖 Replay，分散的启发式解析、重复推导和未经证明的协议语义开始成为系统性风险。

项目将长期逆向研究收敛为生产协议模型，明确区分已确认事实、版本限定语义、遗留启发式和未知状态，并逐步为死亡、血量、AoI、移动、射击和结算等事实建立单一权威来源。

版本兼容也从简单的“支持某个 Replay 版本”转向按能力记录证据。Battle Playback V2 进一步尝试重建“在时间 t 当时能够知道什么”，避免利用后来才出现的信息污染过去的视角。

核心链路逐渐稳定为：

`Replay Binary → Protocol Decoder → Canonical Replay Facts → Reconstruction → Canonical BattleTimeline → Evidence → AI Review`

以及：

`Canonical Replay Facts → Battle Playback Projection → 用户可见状态`

**Git 证据：** `a0a5bc49`、`d0b83a2f`、`435573a2`、`04facd45`、`033bd1b4`、`13162e0e`、`a7e4147f`、`68cddcf4`、`4258de67`、`0c435a7f`、`07aeb908`、`b5182ae1`、`9c480296`、`2f78e06a`。

## 2026-08-29～08-30 — Android Thin Client

Web 继续作为主要产品和业务实现，Android 客户端被明确设计为 Thin Client，而不是第二套 Replay、AI 或 Playback 实现。

Native 层只处理 Web 难以直接完成的设备能力：接收 `.wotbreplay`、临时缓存、Web 与 Android Bridge、安装和更新。Native Bridge 同时建立 capability check 和安全边界。

APK 签名、版本和自动发布能力使客户端真正具备分发条件。与项目早期桌面版不同，这次客户端重新进入产品体系时没有复制核心业务逻辑。

**Git 证据：** `97aad637`、`c6b84b3d`、`90ee4add`、`9e7f9ea1`、`c7cd81b3`、`718815c8`、`80dcb0d3`、`cad8d130`、`d3144461`、`da8b355b`。

## 2026-08-29～08-31 — Replay Workspace 统一 Replay 工作流

Data、AI Review、Battle Playback 等能力此前各自维护 Replay 上下文，逐渐产生重复上传、状态不同步和异步竞态。

Replay Workspace 将这些能力统一到共享的当前战斗上下文，并通过 Capability Model 明确“Replay 可以解析”不代表“所有高级能力都可用”。

这次整合也推动前端明确共享状态 ownership、修复异步竞态，并逐步采用 Vue Router 和 TypeScript 管理核心 Replay 域。后两者是实现手段，而不是独立的产品历史节点。

**Git 证据：** `62f2e7ac`、`f30ef415`、`b54be83c`、`a22b2508`、`9a5e50e1`、`ad3bbbea`、`ec956315`、`cc89e760`、`82f8a422`、`ba0ca608`、`8f9b4b93`、`578deb22`。

## 2026-08-31 — 国内访问问题推动双服务器架构探索

最初生产环境运行在 yecaoyun 香港服务器。国内用户访问香港环境不稳定后，项目增加腾讯云国内服务器。

这带来新的问题：既然两台付费服务器已经同时存在，如何让两边资源都参与生产，而不是让其中一台长期闲置或只承担简单代理。

项目因此开始探索 Control / Execution 分离、异步 Job Contract 和跨服务器任务分配，并为未来 Object Storage 与 Worker 建立边界。

这一阶段仍然只是架构与代码责任划分，RabbitMQ、对象存储和远程 Worker 尚未形成真实生产执行链。

**Git 证据：** `d4d9a459`、`c8482c91`、`d2a823ed`、`ff311c87`、`ad4eff6a`。

## 2026-09-05～09-06 — League Rating 形成训练赛与赛事表现评价体系

项目重新建立面向训练房和锦标赛的表现评价体系。它继承早期“从 Replay Facts 推导玩家表现”的一般思想，但不是 Rating V2 的直接后续实现。

League Rating 明确限制在训练和赛事等结构化竞技场景，随机战隐藏。评分只依赖 Canonical Replay Facts，并接受部分事实为 UNKNOWN。

V4.1 建立单场评分，随后 V5 探索批量聚合，V6 将个人和队伍聚合模型收敛。赛事 Replay Corpus 用于研究和校准，但并未被定义为冻结的 Golden Dataset。

**Git 证据：** `1d53a09e`、`fd4fefed`、`130a13a8`、`863add73`、`98d78d86`。

## 2026-09-05～09-06 — Team AI Review 从结果归责转向战术因果复盘

早期 Team Autopsy 曾探索战斗总结以及 culprit / MVP 等结果归责。新的 Team AI Tactical Review 改变了目标：不再强制寻找责任人或错误，而是解释团队战术过程和因果链。

Strategic Prior 只作为非权威基线，不能被 AI 描述为队伍真实制定的计划；Replay 也不能证明语音沟通、指挥责任、心理状态等信息。

团队复盘逐渐采用从 Information / Vision、Objectives、Local Engagements、Position / Tempo 到 Team Execution、HP / Trades 的推理链，并严格区分 CURRENT、LAST_KNOWN 和 UNSEEN。

Backend 继续只提供事实，不提前生成 BAD_PUSH、GOOD_TRADE 等战术结论。Team Autopsy 后来退出生产，但作为这一产品方向的早期探索保留在历史中。

**Git 证据：** `6071f416`、`cba4d666`、`4c5ead50`、`1368a877`、`efb2ab89`、`a0b89bbe`、`a42b647a`、`07afeeba`。

## 2026-09-05～09-07 — 可观测性进入事故诊断与发布安全机制

最初的可观测系统主要用于观察生产指标和日志。随着真实生产故障增加，项目开始要求一次事故能够从用户看到的错误标识一路追踪到 Backend、Replay Processing、AI 上游调用、验证和最终失败。

生产事故面板因此引入 errorId、correlationId、jobId 等筛选，并能够按时间查看单次 Incident 生命周期。CI 同时开始验证真实 Docker emitter → Alloy → Loki 数据链，避免“配置文件存在但生产日志链实际不可用”。

可观测性随后进入发布门禁。生产部署不仅检查应用健康，也验证 Metrics、Prometheus Target、Loki Stream、Grafana Datasource 和 Dashboard 等运行链路。

在一次生产恢复问题后，回滚权威进一步从简单 Previous Deployment 收敛为经过完整验证的 Last Known Good。LKG 保存已验证的部署树、Compose、SHA，后来又加入 Capability Metadata；缺少可靠 LKG 时默认 Fail Closed，而不是盲目把时间上较旧的版本当作可恢复版本。

同时项目开始区分 Application Availability 与 Observability Availability：观测栈故障需要报告和修复，但不能在应用本身健康时错误地阻止建立恢复基线或导致不必要的业务回滚。

**这一阶段使 Observability 从“查看生产”进入“证明生产状态、定位事故并参与安全发布与恢复”的工程机制。**

**Git 证据：** `3269cc31`、`f803fc84`、`69cb6e2b`、`8e8cd8fb`、`39d2dcb3`、`bef1d91d`、`4d0db653`、`d559e899`、`761b358e`。

## 2026-09-05 — 从完整 3D 地图探索收敛到 2.5D 战术回放

项目曾认真研究和提取真实地图 3D / Terrain 数据，但最终确认 Battle Playback 真正需要的是可靠地形事实，而不是复制完整游戏场景。

因此保留权威 Terrain Heightfield，车辆继续使用 2D Hull / Turret 资产；Pitch 和 Roll 可以根据地形派生用于表现，但不能声称 Replay 记录了车辆完整 3D 姿态。

29 张地图同时进行 AI 超分辨率处理，保留原始来源并要求几何结构不能改变，通过人工和自动 Gate 验证。达到源素材细节上限后停止继续放大。

这再次强化项目的一条通用原则：事实模型与派生表现必须分离。

**Git 证据：** `778d13c3`、`5249e724`、`5e196c0d`、`85dcb9e9`、`245c1535`。

## 2026-09-09 — 国内生产节点进入基础设施代码管理，生产发布开始采用不可变 Artifact

腾讯云已有资源开始通过 OpenTofu 纳入声明式管理。已有 COS 采用 discover → declare → manual import → no-changes 的方式接管，而不是重建；腾讯 Lighthouse 和防火墙也进入基础设施代码管理。

发布体系同时继续演进。PR CI 负责质量门禁，Build 冻结 Source Commit 并生成不可变 SHA Image，Deploy 只消费已经产生的 Artifact，而不是部署时重新决定源码和镜像。

定向组件发布和回滚开始出现，但这一阶段仍然属于国内生产节点与 Release Pipeline 的生产化准备，并不意味着双服务器 Worker 架构已经完成。

**Git 证据：** `29b3dc87`、`3a5c12c7`、`0167aefe`、`348d892d`、`cdccf816`、`4a6b5fcc`、`6c6e30ce`、`efa976da`。

## 2026-09-09～09-10 — Replay 后端建立可替换执行边界，并开始证据驱动的性能工程

原本集中在 `wotb-web` 的职责被拆分为 `wotb-result`、`wotb-playback`、`wotb-replay-coordinator`、`wotb-replay-processing` 和 `wotb-ai` 等 Maven Feature Module，但此时仍运行在同一个 Spring Boot 应用、JVM 和容器中。

Coordinator 开始拥有 Job Lifecycle / Processing State，Processing 负责执行，两者通过 `ReplayProcessingDispatcher` Port 连接。Dispatcher Request 被限制为稳定的 value-only contract，不携带本地路径、Spring Object 或 callback，为未来远程执行准备边界。

此时实现仍然是 `LocalReplayProcessingDispatcher`，尚未接入消息队列或远程 Worker。

性能优化也开始使用 Benchmark、JFR 和 Fingerprint 证明变化没有改变 Canonical Replay Facts；CPU 解析使用受限 Platform Worker，AI 等待则使用受控 Virtual Thread。

**Git 证据：** `8c6e8c9e`、`bfe14714`、`c85b9a27`、`678d83e5`、`68c8a581`、`2d4112ba`。

## 2026-09-10 — Hall of Fame 推动网站身份与游戏身份正式解耦

Hall of Fame 长期保存百场和三环成绩后，项目必须回答成绩究竟属于登录 WotbTools 的账号，还是属于实际参加战斗的 WoT Blitz 玩家。

早期实现仍让 Keycloak 用户身份参与成绩归属。如果用户更换登录方式、Keycloak 用户被删除后重新登录，即使绑定相同游戏账号，历史成绩也可能无法自然重新关联。

项目因此将百场和三环的 canonical owner 从 Keycloak 身份迁移到游戏身份。最初只使用 WotB Account ID，Review 随后发现不同区服可能存在相同 Account ID，因此最终定义为 **`(区服, WotB Account ID)`**。

从此三层身份模型逐渐明确：

- Keycloak `sub`：认证身份；
- `user_profile`：WotbTools 业务用户投影；
- `(wotb_server, wotb_account_id)`：实际游戏身份。

Profile API 同时收敛为幂等 Ensure 语义，使认证用户能够自动补齐业务 Profile，并通过数据库事实处理并发初始化。

V22 数据迁移最初尝试自动解决历史 ownership 冲突，但 Review 发现这可能擅自改变成绩状态或删除 Evidence，最终改为 Fail-Fast：无法可靠确定区服或存在 ownership 冲突时停止迁移并输出诊断，由管理员根据真实业务历史处理。

当时百场和三环已经采用复合游戏身份，但单场 Hall of Fame 仍只使用 Account ID，是尚未解决的遗留边界。

**Git 证据：** `e5550a0e`、`8fac89ff`、`6e9da442`、`79d1fe50`、`ed737605`、`ef9c49d9`。

## 2026-09-10 — Android 外部 Replay 导入形成可重放、身份绑定的处理协议

Android Thin Client 支持从系统文件管理器直接打开 Replay 后，认证流程与 Replay Processing 生命周期之间的边界暴露出来：未登录 Replay 可能进入部分处理流程，Replay 导航也可能与 Keycloak 登录抢占 WebView。

项目首先规定认证流程拥有最高导航优先级。认证期间 Replay 进入 Pending Queue；Pending Replay 获得持久化 `pendingId`，可以跨 Android Process Death 恢复。

Replay 只有在服务器真正接受 Processing Request 并返回 Job 后才 ACK。ACK 使用基于 `pendingId` 的 compare-and-clear，避免旧 ACK 删除后来到达的新 Replay。

为关闭“服务器已接受、客户端在 ACK 前退出”的失败窗口，`pendingId` 同时作为 `operationId` 传入后端，并以 **`(authenticated subject, operationId)`** 建立幂等身份。并发状态最终收敛为 `ABSENT → IN_FLIGHT → COMMITTED(jobId)`；只有 Dispatcher 真正接受任务后才 COMMITTED。

Replay Export 也统一进入认证边界，避免通过导出接口绕过受保护 Dataset。

**Git 证据：** `166000d4`、`cdd122b8`、`f4eeaac7`、`4915e820`、`96448fc0`。

## 2026-09-11～09-13 — 生产发布从 Workflow 流程收敛为可验证的 Release Contract

Build 与 Deploy 分离后，项目继续消除二者之间的隐式状态。Build 为冻结 Source Commit 生成权威 `deployment-manifest`，记录源码身份、不可变镜像和部署目标。

Deploy 只消费成功 Build 产生的 Manifest，checkout 精确 Source SHA，并按照 Manifest 发布；不再重新计算源码差异、选择镜像或决定部署哪些服务。

Last Known Good 也从简单历史副本发展为包含 Deployment Tree、Compose、Release SHA 和数据库 Schema Version 的恢复状态。回滚前验证当前数据库 Schema 是否仍被旧 Backend 支持；无法证明兼容时标记 `ROLLBACK UNSAFE`，而不是自动数据库降级或强行启动旧应用。

健康检查逐渐使用独立 health-probe 从生产网络验证 Backend、Frontend 和 Keycloak；Application Availability 与 Observability Availability 被划分为不同故障域。定向发布失败只恢复对应组件，不回退其他已经独立成功的服务。

同期 Android 采用 Version-as-Code，Native Bridge 建立显式协议版本和 Breaking Change Gate。

**Git 证据：** `7aacc0b6`、`2f945221`、`fc9a54c1`、`e9a1e25a`、`85af3bd7`、`8466c29c`、`7a136e6f`、`7537656c`。

## 2026-09-16～09-19 — 腾讯云从基础设施节点发展为可切换的生产运行面

腾讯云 Lighthouse 此前已经进入 OpenTofu 管理，但实际生产仍主要围绕 yecaoyun。随着国内迁移推进，TX 开始建设为能够承接真实流量的独立生产运行面。

Production Release Manifest 加入按环境划分的 `targetServices`，使同一 Release 可以明确声明哪些服务部署到 yecaoyun、哪些部署到 TX。

迁移采用渐进方式：TX 先建立 Frontend、Keycloak、Caddy 等入口和身份能力，原 yecaoyun Backend 暂时继续承担业务处理。TX 通过 WireGuard 访问仅绑定隧道地址的 yecaoyun Backend。

只读 Pre-Cutover Gate 验证 TX Runtime、Keycloak、IdP、Android Web Association、Release Identity 和 WireGuard Backend 链路，只能报告 `PRE_CUTOVER_READY`，明确禁止自动修改 DNS 或关闭旧生产。

TX Keycloak 随后由独立 OpenTofu Root 管理 Realm、Client、Role、Mapper、IdP 和 Backend Admin API Service Account。Backend 使用最小权限 Service Account；IdP 的结构由 IaC 管理，但运行时 enabled 状态保留为 Operator Ownership。

官方 QQ Provider 开始进入 TX 构建和配置体系，但外部条件未完成时原 Juhe QQ 仍作为兼容路径。Wargaming Provider 同样进入迁移验证。

到 09-19，TX 建立独立 Business PostgreSQL Runtime。Compose 管理数据库进程，OpenTofu 管理 Database、Role 和 Grant，Flyway 继续作为业务 Schema 的唯一 Owner。此时只能确认 TX 已具备接管条件，不能据此认定 DNS、历史数据和全部生产流量已经切换。

**Git 证据：** `81097302`、`ec4ac3ed`、`966181da`、`0249e288`、`3045211f`、`3e53101c`、`6c71a581`、`6a5e17ed`、`050d423a`。

## 2026-09-19 — 双服务器异步执行基础设施开始真实落地

此前的双服务器设计已经定义 metadata-only Job Contract、Control / Execution 边界和 Object Storage Port，但尚未对应真实跨服务器基础设施。

TX 首先部署独立 RabbitMQ Runtime。AMQP 只绑定 WireGuard 地址，Management API 只绑定 loopback；RabbitMQ 可以独立部署和验证。

Compose 负责 Runtime，OpenTofu 管理 VHost、用户、权限、Exchange、Queue 和 Binding。任务拓扑形成 `wotb.jobs` Exchange、Parser Queue、Retry Queue 和 DLQ，并通过 TTL + Dead Letter Exchange 实现延迟重试。Retry Counter 和 Job State 仍属于 PostgreSQL。

Control API 与 Parser Worker 使用独立 RabbitMQ Identity 和最小权限。真实 AMQP Contract Test 验证 Dispatch、Retry、DLQ 和越权拒绝。

同期 yecaoyun 建立独立 MinIO Runtime，API 仅通过 WireGuard 暴露，Console 仅本机访问。RabbitMQ 负责小型控制消息，MinIO 准备承载 Replay 等大型 Artifact。

这一阶段仍只是基础设施落地，尚不能认定生产 Replay 已经通过远程 Worker 执行。

**Git 证据：** `a81267b5`、`6e9db9dd`、`00456b8f`、`6c22b98d`、`5da8926b`、`ad826cbf`。

## 2026-09-20～09-22 — Replay Processing 正式进入跨服务器分布式执行

Replay Processing Job、Source 和 Operation 的权威状态首先迁入 PostgreSQL，使 Job Lifecycle 和 `operationId` 幂等能够跨 Control API 重启和跨进程恢复。PostgreSQL 只保存任务状态，不保存 Replay Binary、Processed Dataset 或执行上下文。

此前定义的 Object Storage Port 获得 MinIO Production Adapter。TX Control Plane 与 Yecao Parser Worker 使用独立 MinIO Identity，共享受限的 `temp/jobs/<jobId>/...` Workspace。

`ReplayProcessingDispatcher` 获得 RabbitMQ 远程实现。只有 Broker Confirm 且消息可路由后任务才视为真正接受，延续 Android Replay Operation Protocol 对 Commit Point 的定义。

Yecao 部署独立 Parser Worker，负责消费 Parser Request、读取 Replay Artifact、执行 `processFull` 和 Reconstruction、写回 Derived Artifact 并报告结果。Worker 只负责一次 Attempt；Retry 和完整 Job Lifecycle 仍由 Control Plane 决定。

TX Business API 成为 Replay Control Plane，负责用户请求、PostgreSQL 权威状态、MinIO、RabbitMQ Dispatch、Worker Outcome、Retry 和 Batch Finalization，而不再承担 Replay Parsing。

Dataset 和 Artifact 读取也收敛到统一存储边界，使 AI Review、Battle Playback 和 Export 可以跨 Runtime 复用同一 Derived Dataset。

09-22，项目删除 `ReplayParseScheduler`、`LocalReplayProcessingDispatcher`、`LocalReplayProcessingExecutor` 和 Local Dataset 等旧执行路径，不再维护 Local / Distributed 双模式。

生产 Replay Pipeline 至此形成：

`用户 → TX Business API → PostgreSQL / MinIO / RabbitMQ → Yecao Parser Worker → MinIO Derived Dataset → TX 消费能力`

**Git 证据：** `04e02e76`、`6b915712`、`21378900`、`f2bea028`、`89d1d372`、`5f3781d2`、`90a09492`、`d79d2340`、`d4bb20db`。

## 2026-09-20～09-23 — 腾讯云正式接管生产，双服务器职责完成收敛

分布式 Replay Processing 准备完成后，项目执行实际生产切换。Business API 迁入 TX，与 Frontend、Keycloak、Business PostgreSQL 和 RabbitMQ 一起组成新的主生产运行面。

TX 的镜像交付同时迁入 Tencent TCR。期间探索过 GHCR 复制、主机复制和 OCI 传输等方案，最终收敛为 CI 使用 BuildKit 直接发布 TCR；Registry 可以变化，但 Commit SHA 继续作为不可变 Release Identity。

DNS 随后正式切换到 TX。完成 Cutover 后，yecaoyun 上原有 PostgreSQL、Keycloak、Backend、Frontend 和相关恢复路径被删除。Yecao 最终保留 Parser Worker、MinIO 和观测能力，不再直接暴露完整应用。

稳定职责变为：TX 负责公网入口、身份、业务 API、权威业务数据库、Replay Control Plane 和 RabbitMQ；Yecao 通过 WireGuard 作为 Replay Execution / Artifact 节点。

随着生产拓扑稳定，Local Replay Execution、Memory Job Authority、未进入正式架构的 `wotb-control` POC 和迁移期 Cutover Machinery 被主动删除。

同期复杂度审计也结束了早期代练产品方向：Backend、Frontend、数据库结构和 Keycloak Role 被完整移除。代练作为曾经真实存在的产品探索保留在历史中，但不再属于当前产品。

`PRE_CUTOVER_READY`、DNS Cutover 状态和一次性迁移数据检查最终退出，长期有效的检查收敛为真实 Runtime 健康验证。

**Git 证据：** `6942f2c7`、`532542ae`、`ad02b09c`、`a39fc7b8`、`2adf1e07`、`036eef8e`、`86d9fe50`。

## 2026-09-22 — 游戏身份从“绑定”进一步发展为“可验证身份”

Hall of Fame 已经推动项目使用 `(区服, WotB Account ID)` 表示实际游戏身份，但“用户绑定某个账号”仍不等于“系统有证据证明用户控制该账号”，尤其是 QQ 登录无法证明中国区游戏账号归属。

项目因此直接利用 Replay 作为身份 Evidence。用户正常处理 Replay 后，系统复用 Canonical Replay Parser 提取真正的录像者 Account ID；只有录像者与当前绑定游戏身份相符时才标记为已验证。

昵称相同、账号出现在同局玩家列表、或无法可靠识别录像者，都不能作为验证依据。

验证接入 READY Dataset 的共享读取边界，不建立第二套 Replay Parser 或专用上传流程。它同时被设计为旁路能力：验证失败不能让已经成功的 Replay Processing 失败。

`user_profile.wotb_account_verified_at` 表示当前绑定游戏身份的验证状态。更换区服或 Account ID 会清除验证，昵称变化不会。Wargaming 登录可以通过可信 IdP Claims 建立验证，手工绑定则可以通过本人 Replay 获得验证。

游戏身份由此同时包含两个问题：**账号是谁，以及为什么相信这个账号属于当前用户。**

**Git 证据：** `314e3fb1`。

## 2026-09-23 — Android QQ 登录回程不再把 Verified App Link 当唯一机制

Android QQ 登录的认证连续性此前完全依赖 Verified App Link：QQ 原生登录完成后，Keycloak broker callback 必须经 App Link 回到原 WebView。部分 OEM / 浏览器环境暴露了这一机制的兼容性差异 —— 同一份 manifest 与 assetlinks 在不同设备上得到不同的 domain verification 结果，QQ 的原生回程也可能落到系统浏览器，而浏览器与 WebView 不是同一个 cookie jar，原认证事务因此无法恢复。

本次开始把两件事分开处理：**domain verification 的健康诊断**（只诊断、不阻塞登录，并给出一次可操作的恢复提示）与 **native-return ownership**（让回程可以由 App 自有 scheme 承担）。在取得真机 URI 形状证据之前，生产行为保持不变：继续沿用 QQ 原始握手 URI，Verified App Link 仍是当前唯一在产的回程路径，但不再是设计中唯一被依赖的机制。

**Git 证据：** `ef3022e9`（阶段一，PR #375）。

---

## 当前架构形成的三条长期主线

回看整个演进过程，WotbTools 的变化并不是简单的功能累积，而主要沿三条长期主线收敛。

### Replay 与 Evidence

`最终战果 → Event Stream → Reconstruction → Canonical Replay Facts → Evidence Contract → Playback / AI / Rating / Hall of Fame → Identity Evidence`

Replay 从上传文件逐渐成为多个业务域共同依赖的事实证据来源。长期原则是：**没有证据就保持未知；AI 解释证据，而不创造证据。**

### 生产运行架构

`单体 Web → Observability → Immutable Release → Release Contract → 双服务器 → Control / Execution Boundary → RabbitMQ + MinIO → Distributed Replay Processing → TX / Yecao 稳定职责`

生产架构从单服务器应用逐步发展为具有明确状态权威、Artifact 边界、消息协议、恢复契约和跨节点职责的系统。

### 身份模型

`Keycloak Login → IdP-only → QQ / Wargaming → Authentication Identity ≠ Business User ≠ Game Identity → Verified Game Identity`

身份系统从登录功能逐渐发展为认证身份、业务用户和游戏身份相互解耦，并通过可信 IdP Claims 或 Replay Evidence 证明游戏账号归属。

---

本文只记录具有长期产品、架构或工程意义的变化。UI 微调、普通缺陷修复、实现重构以及一次性迁移细节由 Git 历史保存，不在这里重复维护。
