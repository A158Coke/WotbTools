# 回放管线（Replay Pipeline）

> **服务器没有 parser。** 唯一的回放解析器是上游 [WoT-Blitz-Agent](https://github.com/fanypcd/WoT-Blitz-Agent)
> Rust Core，编译成 WASM 在浏览器 / Android APK 自带的 GeckoView 里运行（版本与 sha256 锁定在 `deploy/agent/source.json`，
> 消费契约 `contracts/agent/replay-facets-v2.md`）。对解析结果的一切计算（去重、League Rating、指标、列投影、
> xlsx 导出、2D 回放数据）也都在客户端完成；服务端只负责存储、去重键、授权、名人堂记录与 AI 编排。
> 当前解析链路以本文与 `contracts/agent/replay-facets-v2.md` 为准。

## Agent 产物身份（content-addressed）

- **identity SSOT**：`deploy/agent/source.json:ref`（上游完整 commit）。`artifact.release` 是同一份
  Release 的 tag，二者必须同时匹配产物自带的 `fingerprint.json`（`upstream_commit` / `tag`）。
- **运行时 URL 是 content-addressed**：`/wasm/<ref>/wotb_replay_wasm.js`、`/wasm/<ref>/wotb_replay_wasm_bg.wasm`、
  `/wasm/<ref>/fingerprint.json`（wasm-bindgen wrapper 从同目录加载 `_bg.wasm`，所以三者必须同一目录）。
- **stable `/wasm/wotb_replay_wasm.js` 被禁止**：固定 URL 会让浏览器把**别的 build 的 Agent** 长期缓存下来，
  同一个 frontend 用错版引擎解析，直到 AI Review 才以 `ai_review.poses 缺失` 暴露。构建/发布两侧都断言它不存在
  （`frontend/scripts/verify-agent-wasm-dist.mjs`、`deploy/tx/build-frontend-from-gitee.sh`）。
- **浏览器缓存靠 URL identity 失效，不靠 no-cache**：新 Agent → 新 URL，旧 URL 永不覆盖，因此
  `location ~ ^/wasm/[0-9a-f]{40}/` 反而是长期 `immutable` 缓存（用户普通刷新即可拿到新建对应的产物，
  不需要 Ctrl+F5 / 清站点数据）。只锁 40 位 hex 目录，不给 `/wasm/` 根目录统一 immutable。
- **装载顺序 fail closed**：先校验 fingerprint（commit 与 tag 都要等于 build 期 pin）→ 再 dynamic import
  版本化 JS → 才装载 `_bg.wasm`。任一不一致抛 `AgentWasmVersionMismatchError`
  （带 `expectedRelease` / `expectedCommit` / `actualRelease` / `actualCommit`），UI 提示刷新页面重试。
- **build 期注入**：`frontend/vite.config.js:agentWasmIdentity()` 读 `deploy/agent/source.json` 并通过
  `define` 注入 `__AGENT_WASM_COMMIT__` / `__AGENT_WASM_RELEASE__`（不在 TypeScript 里手写版本号）。
  Docker 通过 `COPY deploy/agent/source.json /deploy/agent/source.json` 保持与仓库同一相对布局。
- **落位与证据链**：`scripts/fetch-agent-wasm.sh`（Release 直取，sha256 + fingerprint 校验；
  `scripts/agent-wasm-artifact.py` 是唯一 ingest 实现）与 `scripts/build-agent-wasm.sh`（源码自建后备）
  都产出 `common/assets/wasm/<ref>/`，经 Vite publicDir 进 `dist/wasm/<ref>/`，再由 TX 发布脚本
  从该 source commit 的 `source.json` 逐字段回验镜像内产物。

## 数据流

```text
.wotbreplay（用户本机，文件不上传）
    │
    ▼
上游 Rust Core WASM（/wasm/<source.json ref>/wotb_replay_wasm.js）
    ├── parseResult      结算：花名册 / 胜负 / 地图 / 全员统计（毫秒级，不读包流）
    ├── parsePlayback    时序：位姿网格 / 弹道 / 击杀 / 阶段 / 可见性 / 基地
    ├── parseShotReplays 射击分析
    └── parseAiReview    AI 事件流（伤害归因等）
    │
    ▼
frontend/src/replay-local/
    ├── parse.worker.ts / parseReplays.ts   批量 parseResult 跑在 Web Worker，逐文件进度
    ├── battleFacts.ts                      parseResult → Battle 事实（与已退役 Java ReplayParser 逐字段一致）
    ├── compute/                            去重 → League Rating → 指标 → Preview 列投影
    ├── analyzeReplays.ts                   全链路：逐文件失败隔离，0 场有效 → NoValidReplaysError
    ├── export/                             Replay XLSX 投影与逐场 ZIP（XLSX 由 shared/tabular/xlsx 渲染；fflate 按需加载）
    ├── canonical/                          WotbTools canonical replay facts：身份 / 视角 / AoI / 血量 / 归属 / 终态
    │                                       （已退役 Java canonical 层逐条移植；2D 与 AI 共用的语义边界）
    ├── playback/                           canonical facts + 原始位姿 → BattlePlaybackDataset + MapOverview
    ├── ai/                                 canonical facts → ClientAiReviewProjection（AI 请求的唯一事实载体）
    └── submissionFacts.ts                  名人堂 / 百场 / 三环提交的结算事实
```

## 消费面

| 能力 | 入口 | 说明 |
|---|---|---|
| 回放工作台 · 数据 | `composables/useLocalReplayAnalysis.ts` | 选择文件 → Worker 解析 → 批次计算 → 表格；失败只显示原因，不回退服务端 |
| 回放工作台 · 导出 | 同上 `exportExcel(mode)` | 复用最近一次分析的批次结果；shared XLSX capability 生成工作簿，Replay 负责逐场 ZIP |
| 2D 战局回放 | `components/BattlePlaybackPanel.vue` | 共享 playback session → `parseLocalPlaybackOffThread` → canonical Worker（三切面 → canonical facts）；线程设施失败才退回主线程 |
| AI 复盘 | `components/AiReviewWorkspacePane.vue` | 目标文件本机 `buildLocalAiReviewInput` → `AiReviewRequest`（gzip）→ ai-service |
| 3D 回放 / 射击分析 | `components/Replay3DPane.vue`、`components/ReplayShotsPane.vue`（回放工作台能力面板）、`scene/*` | 直接消费 WASM 时序 / 射击切面 |
| 名人堂 / 百场 / 三环提交 | `api/hall-of-fame.ts` → `replay-local/submissionFacts.ts` | 本机解析得到 `Battle` 事实 JSON（`facts` 字段）+ 原始回放（证据附件） |
| 账号验证 | `ProfilePage.vue` | 本机解析出录像者 accountId，提交给 `POST /api/users/wotb-account/verify-replay` |
| Android | `useNativeReplayImport.js` | Native 只交接字节；本机分析完成后 ACK pending |

射击分析的产品计数口径与上游 Shot 身份一致：**一次开火 = 一个 unique `shotId` = 表格一行**。
同一 `shotId` 如果关联多条 method29、多个 type=32 命中段或多次装甲接触，仍属于同一个 Shot；
WotbTools 不把 interaction / segment 展开成额外“射击”，也不在消费端重新解释原始包流。
这些事件的关联与归并属于上游 Agent parser 的职责——后续 method29 在物理上究竟是什么，
上游仍标记为未定，WotbTools 不做公开定义。

## 服务端边界

- **名人堂**（`com.wotb.web.replayfile.ClientReplayFacts`）：**客户端事实被有意视为不可信；服务端只校验结构，不校验真实性。** 只做结构校验（arenaId / 录像者 / 1..64 名战斗者 / 账号与车辆 ID / 队伍）；不重新解析回放、
  不比对回放与 facts。防伪造靠管理员审核与回放附件（有意的产品决策，见 `docs/features/hall-of-fame.md`「信任模型」）。
- **账号验证**：客户端声称的便利徽章——只比较客户端提交的录像者数值 accountId 与当前绑定账号；不授予权限、不参与
  授权、不是身份安全边界（`docs/features/user-profile.md`）。
- **AI 复盘**：`AiReviewRequest` 只承载 client canonical AI projection；ai-service 的 `ClientAiProjectionAdapter` 结构校验后
  装配内存 canonical 事件流（纯归约，不读字节），下游 BattleTimeline / 证据 / prompt 不变。与 Java 删除前冻结重建的
  语义 parity 见 `docs/architecture/ai-review.md`「AI 复盘输入」。

## 一致性基线

`frontend/src/replay-local/__golden__/` 保存服务端 Java 解析器 / 批次计算 / 导出 / 2D 回放在仓库 fixture 回放上的
最后一份输出（Java 删除前生成，只读），CI 常驻断言客户端全链路与之逐字段一致（2D 时序数据按文档化的容差）。
上游 Rust Core 升级后重新导出 `wasm-*` 文件，再跑同一组测试。

## Agent 切面不是领域契约

2D 回放与 AI 复盘都经过 `replay-local/canonical` 消费上游切面：`api/agent-replay-facets.ts` 只做信任边界的形状校验
（含 canonical 必需证据的版本门禁，缺失即拒绝），语义决定（参战者 / 录像者 / 观测段 / 可信血量 / 归属证据 / 终态）
只在 canonical 层发生一次。Agent DTO 字段名、钳 0 的显示值、渲染滤波网格等都不得直接进入 WotbTools 的展示或领域模型。

## 遥测缺失时 UI 必须 fail-closed（`unknown ≠ full`）

上游只对本方全队广播装填遥测（`reloads` / `reload_effective`）。**没有遥测不等于满弹**：
`frontend/src/scene/reloadBar.js#shellStatesAt` 在无可用相位时返回 `null`，3D 标签直接不画装填条；
只有"有遥测且当前状态算出来是满弹"才画满条。

2026-10-02 线上故障是这条规则的直接反例：错版 WASM 让 `reloads = 0`，旧实现把"无遥测"兜底成
`full()`，于是每台车都画出一根**永远不动的白条**。修复分两层——artifact identity 让错版产物根本装载不进来
（见「Agent 产物身份」），UI 层则保证即使拿到空遥测也不会伪造满弹。回归见
`frontend/src/scene/reloadBar.test.js`（fake-full 用例）与 `agent-wasm-smoke.test.ts`
（真实 replay 的作者车 reload timeline + 状态随相位变化）。

上游已知缺口：method 35 目前只解码 `[eid][single duration]`，autoreloader 的多段装填 profile
（如 Kranvagn）整场 `reload_effective` 为空。这属 **producer 语义**，消费方不得按车型/burst size
推断或用 shots 反推——需要时在上游修并发新 Release。

## 匿名 Battle Data Collector

数据批次 `parseReplays.ts` 与名人堂 `submissionFacts.ts:replayFactsJson` 在主事实构造成功后，
同步触发 `replay-local/battle-data/collector.ts` 的 best-effort 旁路。主流程不等待采集，
Collector 的异常、超时、重复提交和断网均不改变主解析结果或用户错误状态。
账号验证、AI 与其它底层 parser 调用不隐式触发采集。

只采集 `arenaBonusType=1/7` 的 Random/Rating，且必须恰好两队各七辆。seed 只保留 arenaId、
模式、地图、版本、胜方、队伍车型及 authorTeam；不传整个解析对象。独立 Dedicated Worker
接收原始 `Blob`（`File` 是其子类），自行读字节并调用 pinned Agent 的
`parseAuthorInitialPosition`，主 parser Worker 与 ArrayBuffer ownership 不变。
主机只保留一项执行中、两项等待中；单文件最多 32 MiB、等待文件总和最多 64 MiB，超限直接丢弃。
任务最多 15 秒、空闲 15 秒后释放 Worker。crash、messageerror、离线和 pagehide 丢弃活动及排队任务；
新文件可重新创建 Worker，旧任务不重试、不恢复。

3D 打开回放后，`scene/replaySource.js` 的 `loadRecorderCameraFromFile` 用同一 parse Worker 与 session
取消语义后台调用 `parseRecorderCamera`，不阻塞进场；返回 `null` 或解析失败时录像者视角禁用，回放不受影响。

物理出生方向只读 [canonical 地图语义](../reference/maps.md)，通过 `map_key`/`mapCodes` 查找，
不能使用 numeric mapId 对照语义文件名前缀，也不能把 replay Team 编号等同场景出生组。
只接受 clock 在 0–1 秒、距 exact scene 出生点不超过 2 米且唯一命中某物理侧的观测，
按 authorTeam 赋给对应 replay team，对侧取互补方向。该门限是保守接收策略，非全地图误差保证。
回放 team 与场景出生组没有固定对应：匹配战里 team 2 可以出生在场景第 1 组，所以方向只由位置命中的场景组决定。
Rift 有真实 Random 回放正例，马利诺夫卡有非采集模式真实回放位置正例；语义缺 mapCodes 或缺 reviewed physicalSide 的地图跳过。铜矿采集场是唯一的 WEST/EAST 地图，其 Collector 位置映射只有场景坐标与合成测试覆盖。

Worker 使用 `api/battle-data.ts` 发送 `POST /api/battle-data`，wire SSOT 为 OpenAPI 的
`BattleDataRequest`，发送前执行生成的 runtime validator。请求不带 Authorization/Cookie，
`credentials=omit`、禁止重定向、5 秒超时。201/204 都是正常终态；其它结果也静默丢弃。
dispatch 和发送前检查在线状态；无 IndexedDB/localStorage/Cache API 队列、联网补发或 retry。

后端 CLOSED `battledata` 模块不解析 replay、不读取身份。先严格验证字段与队伍/出生侧不变量，
再以 `UNIQUE(arena_id)` 和 PostgreSQL `ON CONFLICT DO NOTHING RETURNING id` 仲裁。
首个有效事务写入一条 `battle_data_battle` 与十四条 `battle_data_vehicle`，后续同 arena 返回 204，
不合并、覆盖或升级；非法提交不占 arenaId，子表或提交失败全部回滚。同车型可重复，winnerTeam=0 保留为平局。
匿名输入只经过结构和领域校验，不能证明战斗真实性，也不能防止伪造客户端抢先占用 arenaId。

管理员只读审计位于 `?view=admin-battle-data` 与 `/api/admin/battle-data/**`，后端只允许 `wotbtools-admin`。
三个 GET 从同一 battle / vehicle 表读取 summary、keyset recent list 和实际子行；没有管理写入 API。
时间窗口采用 UTC `[from,to)`，summary 使用只读一致快照，`received_at` 是服务端接收事务时间而非战斗时间。
Summary 的 `spawnStats` 只返回 map / side / mode 维度的胜、平、负计数，`arenaBonusType=null` 是 Random + Rating 合计，胜率 `wins / battles` 由前端派生，平局计入分母。
页面同时列出当前 map-semantics 中可寻址、已审校但无观察的地图和未匹配观察；当前已审校集合会随语义更新，不能反推历史采样覆盖。
数量是已持久化的 accepted observations，不是请求总数或无偏总体统计；匿名提交仍不能证明真实性。

只持久化 relational representation；不收集玩家账号、昵称、clan、录像者身份、文件名、原始回放或个人战绩，
不保存原始 JSON。dataset 默认长期保留；开关、配额与显式删除路径见
[运维手册](../operations/observability-runbook.md#battle-data-collector)。

## 缺字段怎么办

后端或前端需要的回放字段，一律向上游 Rust Core 要（直接改上游、发版、升级 `deploy/agent/source.json`），
不在客户端启发式推导，也不在服务端解析。已知待补项在上游 Rust Core 的 issue 与发布中跟踪。

## Android 内置运行时

Android 在 `http://127.0.0.1:21653/index.html` 运行同一个 ReplayWorkspace（自 3.0 起使用内置 GeckoView + Native LocalRuntimeServer）。
回放导入、Rust/WASM 解析、Result/Rating 与 2D 地图继续使用内置资源。
射击分析输入（紧凑的俯仰角 / 配置炮弹身份）与炮弹类型表自 2026-10-15 起在运行时从资产包获取
（`tank/{id}.json` 投影 + `/data/shellKinds.json`）；内置快照 `common/shot-tank-data.json` 已退役。
pending intent 仅从精确匹配的本机 `/__native/replay-pending` 资源以流方式读取，携带 UUID 请求头，
分析完成后通过比较并清除的 ACK 确认。解析器加载失败时保留 pending，供重试使用。
AI、名人堂、远程 Profile 和远程 3D 资产在认证或请求之前需要联网。
运行时 URL 边界将 Android 业务请求发送到生产环境，使用 Native Bearer，不带 cookie；
普通 Web 请求保持同源行为。发布校验 APK 内前端的身份，而非生产 Web 部署的 commit。
详见 `docs/android/architecture.md` 与 `docs/android/release-process.md`。

## Canonical 投影的线程边界

`useReplayWorkspace.ts` 的 `playbackSession.loadCanonical` 是工作台 2D / 3D Details 的共享入口，调用 `canonicalRuntime.ts#parseLocalPlaybackOffThread`；`canonical.worker.ts` 执行 `parseLocalPlayback` 的 WASM 解码与 JS 投影。已有 scene Playback 切面通过请求复用，避免再解析一次；场景 ready 后才后台加载 canonical，3D scene 不等待 Details 事实。Worker 不存在、启动/传输失败或进程崩溃时才在主线程兜底；Worker 返回的业务解析错误直接传播，不重跑。该边界独立于数据批次 `parse.worker.ts` 与场景 `scene/playbackParse.worker.ts`。
