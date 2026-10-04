# Replay Workspace（当前实现索引）

本文档只记录前端当前代码的 ownership 与导航边界；回放协议、AI/Playback API 和资产细节仍由各自 canonical 文档维护。

## 当前实现

- `frontend/src/components/ReplayWorkspace.vue` 是 `data`、`playback`、`3d`、`shots`、`ai` **五种能力**的统一工作台：选择一次文件，能力之间切换不重新选文件、不重建 session。
- Workspace 页面本身是 orchestration layer：`PageHeader` 负责页面标题，`ReplayCapabilityTabs.vue` 负责能力切换（数据 · 2D 回放 · 3D 回放 · 射击分析 · AI 复盘，五种能力对所有用户可见，`wotbtools-admin` 不改变能力集合；五个能力都在本工作台内，没有"导航去另一个页面"的能力），`FileDrop.vue` 是全站唯一的上传面（空 / 已选择 / 解析完成三种状态，解析完成后折叠为一行，清空需确认，是唯一的清空入口），`BattlePicker.vue`（可搜索的场次选择器）在四个单场能力上方选择当前场次。它们只接收 Workspace 派生状态并发出显式命令，不复制 session owner。
- 五个能力面板都由工作台按需异步加载、首次激活才挂载（`composables/useMountedWhenActive.js`）：3D / shots 还必须已登录，3D / AI 还要求 capability 可用（连通性）；满足条件后切走只 `v-show` 隐藏：`BattlePlaybackPanel.vue`（2D）、`Replay3DPane.vue`（3D）、`ReplayShotsPane.vue`（射击）、`AiReviewWorkspacePane.vue`（AI）。四个面板共用 `file` / `active` / `blockedReason` props 契约；`active=false` 时停渲染不销毁会话（3D 场景 `setPaused` 停 rAF），切回保留 timeline / 相机且不重新解析。`BattlePlaybackPanel.vue` 直接接收目标文件，本机 `parseLocalPlayback` 得到 2D 数据与地图概览；多文件未选场次时四个面板显示同一份 `workspace.single_replay_required`。
- 3D 面板按「待开播 → 开始」两步进入播放：文件由工作台派生后就位，但解析与资产加载都要等用户在面板里按「开始」（卡片上先选画质档——内核 `startPlayback()` 惰性创建渲染器、首帧按当前档位定型，所以档位不能事后在加载中再改）。换场次 / 清空先 `reset()` 撤下上一场：`reset` 与 `destroy` 同等作废在途加载（`sessionEpoch` / `loadGeneration`），被撤下的解析 / 资产续体不得再回写 store，也不得把上一场继续画在待开播面板后面。
- 解析任务的**生命周期归当前会话所有**（P0）：`Replay3DPane` 持有 per-load 的 `AbortController`，清空 / 换场次 / 销毁经 `sceneApi.loadData({ signal })` 透传到 `scene/replaySource.js` 的解析边界——被撤下的解析立即以 `AbortError` 结束并让出 Worker 队列（仍在 Worker 上时整体 terminate），不再无限排队。`replaySource` 的每个解析请求带看门狗（120s 不回包也不报错 → terminate + 在途全部失败，下次请求重建 Worker）；WASM 装载链（fingerprint 拉取 / 产物 JS dynamic import / wasm 初始化）有 20s 看门狗——浏览器 fetch / import 没有默认超时，网络停滞曾让会话级缓存里的悬 Promise 把 3D Worker 与 Data 批量解析（同一装载链）永久钉在「解析中」。装载超时后 dynamic import 换带序号的 specifier 强制全新装载（浏览器模块表按 URL 去重，同 URL 重试只会拿回同一个悬着的模块记录）。
- 3D 场景加载与就绪态由 `scene/playbackScene.js` 独占：进入解析阶段立即置 `loading=true`、`hasData=false`、`assetStage=false`、`assetProgress=null`；当前会话进入资产阶段才推进资产进度，完成后才标 ready。销毁清掉加载阶段状态。地图资产每个异步边界之后先复核会话身份，再发布地图 key、纹理、地形、分层地表或场景；迟到资源只释放局部结果。资产 URL 显式使用当前会话的地图 key，旧实例的地图解析不能改变当前会话后续请求。`Replay3DPane` 只负责编排，不新增加载令牌。
- 3D 顶栏的双方总血量与比分都按**阵营视角**渲染，不是原始 `score1` / `score2`：`scene/teamHpTotals.js` 的 `teamHpTotals()` 按 `friendly_team` 把车辆血量归到己方 / 敌方，`perspectiveScore()` 把物理比分映射成 `scoreFriend` / `scoreEnemy`，store 只暴露视角字段，HUD 数值不缩写（完整整数 + 原始百分比色条）。
- 3D / 射击面板不持有文件选择器，也不持有第二份 session：选择与 identity 仍只由 `useReplaySession` 拥有。
- 四个懒加载面板都经 `utils/lazyModule.ts` 的 `defineLazyModule` 边界加载（不是裸 `defineAsyncComponent`）：部署换掉 chunk 文件名后旧页面进入能力必然 404，边界保证工作台**保持挂载**并在该能力内显示可操作失败态（「重新加载」为主、「重试」覆盖瞬时失败），且失败态在切走再切回后**仍然保留**（generation 与 recovery 由边界自己拥有）。生产契约见 [`docs/architecture/ai-review.md`](../architecture/ai-review.md)「懒加载与部署的关系」。
- 数据模式（`ReplayPage.vue`）的结果区自上而下是：提示（`Banner`：重复 / 解析失败 / League 不可用 / 未评分场次）→ 工具栏（`SegmentedControl` 汇总 / 单场 · 单场时的 `BattlePicker` · Rating 说明 · 列 · `MenuButton` 导出 ▾：Excel 汇总 / Excel 逐场 / PNG 当前视图）→ 汇总视图顶部的 `SeriesOverview`（两支稳定战队时显示系列赛比分，其后是逐场结果条，点击跳到该场单场视图）→ 表格。
- 玩家表默认只显示 6–8 个核心列（`utils/helpers.js` 的 `*_DEFAULT_VISIBLE`），其余在「列 N/M」面板里；localStorage 可见列与旧默认值完全相同时视为未自定义，迁到新默认值。手机（<768）默认用 `PlayerCardList` 卡片列表（可切回表格，排序与表格共用）；卡片模式下表格仍在 DOM 中隐藏，PNG 导出始终导出表格。
- 玩家详情 `PlayerDetailDrawer`：桌面可拖宽的推开式侧栏，平板固定 360px 推开式侧栏（都写 `--pd-drawer-offset` 让工作台让位），手机全屏 sheet，可左右滑动切换玩家。
- 系列赛比分与场次选项由纯函数 `utils/replaySeries.js` 从 ReplayResult 派生：战队身份只认 League 批次 `teamSummaries` 的 `clan:` teamKey 与 `arenaTeams`；任何一方是 `arenaId:team` 兜底键、或不是恰好两支队伍时不推算比分；无法归属的（未评分）场次如实计数并说明，不计入比分。场次选项显示「第 N 场 · 地图」与「胜方 · 时间」，可按文件名检索。
- `frontend/src/composables/useReplaySession.ts` 是唯一 session state owner，持有 selection、当前 battle、本地分析状态（`analysis: { phase, done, total, failure }`）、结果与 Workspace view state。
- `frontend/src/composables/useLocalReplayAnalysis.ts` 持有本机分析生命周期：Worker 解析（上游 Rust Core WASM）→ 批次计算 → 提交结果；选择变化 / 取消作废在途分析；`exportExcel` 复用最近一次的批次结果在客户端生成 xlsx / zip。服务器没有 parser，失败只显示原因（`ENGINE_UNAVAILABLE` / `NO_VALID_REPLAYS` / `UNKNOWN`），不回退服务端。
- `frontend/src/composables/useReplay.ts` 是 facade/orchestrator，组合 session 与本地分析。
- `BattlePlaybackPanel.vue` 直接接收目标文件，本机 `parseLocalPlayback` 得到 2D 数据与地图概览；多文件未选场次时显示 `workspace.single_replay_required`。
- `frontend/src/app/viewRegistry.js` 是 view → capability 的唯一映射：`replay` → `data`、`battle-playback` → `playback`、`agent-replay` → `3d`、`agent-shots` → `shots`、`ai-review` → `ai`；五个 view 全部映射到同一个 `ReplayWorkspace`，由 `initialCapability` 决定初始能力。`ViewHost.vue` 用 `KeepAlive` 保留工作台实例。旧深链（`agent-replay` / `agent-shots`）继续有效，只是变成能力入口。
- `frontend/src/app/router.js` 是历史与深链 owner。页面组件通过注入的 `navigate` 改变 URL，不直接操作浏览器 history。

## Playback 正方形的布局契约（2D / 3D 同一套）

2D 与 3D 是同一个 Playback 产品，只有渲染器不同（2D = 正方形地图，3D = 正方形 3D 场景）。外围 workspace 契约只有一份：2D 的唯一事实源是 `frontend/src/styles/playback-workspace.css`（`main.js` 在三套形态文件**之后**、全屏细化之前引入），3D 的同一契约写在 `Replay3DPane.vue` 的 `.roster-side` / `.portrait-flow`。竖屏判据两边共用 `usePlaybackPortraitViewport()`（不从 `isPhone` 推）。

**布局档位**

| 档位 | 呈现 |
|---|---|
| 手机竖屏 | **纵向流**：HUD / 正方形 Stage / 传输控件 / 详情（inline）/ Team 1 / Team 2，页面纵向滚动；没有名册浮层、没有两个各自滚动的队伍盒子 |
| 手机横屏（740×360、844×390） | `Team 1 │ 正方形 Stage │ Team 2`，传输控件在 Stage 之下（中心列） |
| 手机全屏横屏 | **同一个**几何：`Team 1 │ 正方形 Stage │ Team 2`，传输控件在 Stage 之下；左栏不是常驻列，只由 ⚙ 打开成抽屉 |
| 平板 / 桌面（含全屏） | `Team 1 │ 正方形 Stage │ Team 2`（桌面控件在左栏时 Stage 下方不让位） |
| 名册关闭（`uiPrefs.showRoster=false`） | 两侧车道**整体不存在**，Stage 仍是**居中**的正方形；数据、选中、详情、跟随、相机、播放与倍速都保留 |
| 异常数据（远超 7v7） | 车道内滚动只作为安全兜底；正常 7v7 不是异常数据，任何视口都不走「临时名册面」 |

- **物理队伍**：左车道恒为物理 Team 1（未识别阵营排在它下面），右车道恒为物理 Team 2，按权威 `vehicle.team` 分组，录像者属于哪一队都不交换。friendly / enemy 是录像者视角，只服务 HUD 总血量、比分与详情里的关系文案。
- **正方形是几何约束**：边长 = `min(中心列可用宽度, 纵向可用高度)`。2D 的高度那一半由 `BattlePlayback` 的 `writeSquareAvailHeight()` 实测写入 `--pb-square-avail-h`（`min(根高, 视口高)` − workspace 上缘偏移与上内边距 − 传输控件整块），同时写 `--pb-controls-h` / `--pb-hud-h`；3D 由 `.stage-square` 的 `min(100%, 100cqh)` 给出。2D 地图元素带的是地图自己的逻辑画框（`mapView` W/H，如 766×769，底图 / SVG / 标记共用），与 1:1 的差 < 1%，不强行拉伸。
- **名册行**：共享 `PlaybackRoster`，信息为玩家 / 车型 / 当前 HP / 百分比 / 阵亡；**没有 HP 血条**。百分比在没有可信上限时显示 `—` 而不是 `0%`。横屏车道用紧凑密度（`compact`），信息不减。
- **选中 ≠ 详情可见 ≠ 跟随**：选车 → `selected = 车` 且 `detailsOpen = true`；详情 × 只把 `detailsOpen` 置 false，选中（名册高亮 / 标记）、跟随、相机、时间、倍速、名册都不动；再点同一台或另一台 → 同一个详情窗重新打开 / 换内容，永远只有一个窗。名册行与场景点击都只选中，从不自动 Follow。
- **详情**：同一个 `VehicleDetailsPanel`。宽档 / 横屏是**整个战场 workspace** 顶层的可拖动浮窗（2D 宿主 `.pb-main`，3D 宿主 `.pb-root`；浮窗是宿主的直接子元素，定位、夹紧与拖动同一坐标系），可以拖到 Team 1 / Stage / Team 2 任意一栏之上；边界 = workspace 内容盒（左右上内边距不算，那里是浮层左栏 / 全屏 HUD）减去受保护的传输控件。位置归 `usePlaybackDetailsPlacement.js` 独占，不持久化；同一次打开内换车不重置用户拖过的位置，关闭后重开是新的一次。未拖过时的初始落位：点左车道 → 右侧，点右车道 → 左侧，点场景里的车 → 与它相对的一侧。手机竖屏是 `presentation="inline"`，排在传输控件之后、名册之前。名册与详情互不影响。
- **全屏**：不引入第二套布局模型，只改变容器尺寸；`document.fullscreenElement` 是权威状态。3D 进出全屏不重建场景、不丢选中 / 跟随 / 时间。
- 早先的「手机全屏：常驻 148px 左栏 | 地图 | 右侧 Details 抽屉 / 全屏 sheet」与「3D 放不下就改临时名册面（`rosterConstrained`）」两套模型已整体移除，样式表里不保留被后加载样式覆盖的死规则。

## 稳定边界

- Playback 2D/3D 共用 `usePlaybackPhoneForm()` / `PLAYBACK_MOBILE_QUERY`：844×390 coarse 手机横屏仍用 compact transport 与二级面板；3D CSS 由根 `.phone-form` 驱动，不单凭宽度切回 tablet。真正平板保留 tablet。共享 `usePlaybackFullscreen` 只在当前 target 拥有 `document.fullscreenElement` 时报告全屏；另一个 keep-alive 面板不冒认或退出别人的全屏。landscape orientation 尝试只属于 phone 的自身全屏。
- 3D 名册没有「临时名册面」：竖屏走纵向流，其余一律两侧常驻车道（见上表）。`uiPrefs.showRoster` 是唯一的呈现偏好，隐藏不能清空名册、selection、follow 或播放时刻。
- `Replay3DPane` 独占 selected vehicle；场景 raycast 与 roster 行只报告/执行选择并打开共享 `VehicleDetailsPanel.vue`，不自动 Follow。相机模式与 follow target 独立，Follow 必须显式请求，Free/Top 不清 selection。2D 详情传完整 evidence，3D 传身份/权威 HP/阵亡/时刻子集，不伪造缺失伤害统计；详情开关不重建场景或重新解析。（`selected` 与 `followed` 是两个独立状态：行点击 = 选中 + 详情，跟随是相机动作，两者可以同时成立。）

- 多文件选择、当前 battle 选择和 capability 切换都由 Workspace facade 协调；session 以 `selectionRevision` 与 `sourceId`（`r{文件序号}`）作为唯一 identity。
- 场次选择器（数据模式在 `ReplayPage` 工具栏、四个单场能力在面板上方）只展示选项并调用 Workspace 的 `selectBattle(sourceId)`；权威 `currentBattleId` 仍由 `useReplaySession` 持有。用户 tab 命令先更新 Workspace capability，再通过注入的 `navigate(view)` 写入 URL；外部 URL 只通过 `initialCapability` 初始化/同步 Workspace，避免 router 与 tab watcher 互相回写。五种能力对匿名、普通登录用户与管理员永久可见，`wotbtools-admin` 不改变能力集合；匿名直达 `?view=agent-replay|agent-shots` 保持目标能力，由能力层显示登录门禁。
- AI 复盘是**正式能力**（普通用户可见，未登录由 AuthGate 引导登录）：联网能力先经 `useFeatureGate` 判定，离线/unknown/degraded/service-unavailable 先给 connectivity 提示，绝不启动登录；在线且未登录沿用 native/browser auth。可用深链挂载 AI 面板（`AiReviewWorkspacePane.vue` → `AiReviewPanel.vue`），受登录门控与客户端投影可用性约束；前端已无维护状态卡（提交 `83884790`，`ai_maintenance` 三语 key 无消费者）。切换 capability 不重新分析数据模式的结果。
- 射击分析面板按 `docs/frontend/design-language.md` §9 做 Master–Detail（expanded 常驻右栏 / medium 推开式侧栏 / compact 整屏面板），分档由**容器宽度**（`ResizeObserver` + container query）决定而不是视口。装甲场景不在面板内嵌：命中弹的「在装甲查看器里打开」把 `shots` 经既有本地交接通道交出并用注入的 `navigate` 打开 `?view=agent-armor&…`——复用引擎，不复用页面导航模型。
- AI/Playback 详细接口与回放管线以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。

## 匿名访问

服务器没有 parser：解析、汇总、导出与 2D 回放全部在本机进行，工作台挂载即可用、不等登录、没有登录门禁，也不发出任何回放相关的后端请求。3D 回放、射击分析 / 复现、AI 复盘以及名人堂等写操作需要登录。

- Android pending 字节通过固定同源 HTTPS Native resource 读取；header 校验 pending identity，响应不缓存。fetch/blob 失败复用 Replay 错误区与重试，不分析、不 ACK。
- Android pending replay 在工作台挂载后消费；ACK 边界是「本机分析已完成」（`analyze()` 返回 `{ completed: true }`，无论有没有有效场次）；回放引擎装载失败返回 `{ completed: false, reason: 'ENGINE_UNAVAILABLE' }`，Native pending 原样保留可重试（见 [`docs/android/replay-intent.md`](../android/replay-intent.md)）。

## 能力访问策略

Replay Workspace contains five publicly discoverable capabilities. Anonymous users can use Data and 2D Playback. Authentication is required for 3D Playback, Shot Analysis / Reconstruction, and AI Review. `wotbtools-admin` does not alter Replay Workspace capabilities.

`ReplayCapabilityAuthGate.vue` 复用 `EmptyState` 与登录按钮：匿名状态不挂载 `Replay3DPane` / `ReplayShotsPane`，不启动解析、场景或远端资产加载；登录分别以 `agent-replay` / `agent-shots` 为返回目的地。登出卸载受限 pane，但不清空 Workspace 的 replay selection/session。AI 保留自己的 projection/error lifecycle，匿名不构建投影，登录返回 `ai-review`。

装甲查看器 `agent-armor` 保持独立页面。普通登录用户可从 shots 选择命中弹并打开复现场景；匿名深链由 `ViewHost` 显示登录门禁，不加载装甲页面。登录返回保留当前完整 scene query（`tank/shooter/config/scfg/shell/shot/world/heatmap/az/h/d/…`）。登录门禁不会主动清空 selection；浏览器 OIDC 整页跳转仍受既有 session 持久化能力限制，不新增 replay 字节持久化。

## Local-first capability boundary

`app/featureCapabilities.js` 是唯一连通性能力模型；组件消费 `useFeatureGate()`，不自行读 `navigator.onLine`。连通性与登录是**两条独立门禁**：ONLINE_REQUIRED 能力在非-online 时连挂载都不做，登录门禁只决定「已连通但未登录」时的引导。连通性首次检测完成前（`availability().pending`）只 fail-closed、不下结论：不显示任何 connectivity 提示，也不落到登录门禁；检测完成后按真实结论（含仍为 UNKNOWN）渲染。

| 能力 | 运行要求 | 离线行为 |
|---|---|---|
| `data`：导入、Rust/WASM 解析、Result、deterministic Rating、session state | LOCAL | 文件、结果与选择照常使用，不请求业务 HTTP |
| `playback`：2D、底图、标记 | LOCAL | 本机解析，底图和标记随 bundle 提供 |
| `shots`：射击列表、检视、弹种、俯仰锚定 | LOCAL + auth | 本机解析，使用 bundled `shellKinds.json` 与 `common/shot-tank-data.json`；匿名由 `ReplayCapabilityAuthGate.vue` 引导登录 |
| `3d`：远端场景/GLB | ONLINE_REQUIRED + auth | tab 保留；连通性提示优先于登录门禁，不挂载 remote loader |
| `ai`：AI 复盘 | ONLINE_REQUIRED + auth | connectivity 先于登录与请求；联网恢复不自动提交 |
| HoF/remote Profile/Admin users | ONLINE_REQUIRED | 入口保留；mount、读写、确认后的动作都经过同一门禁 |

Android 与 Web 共用工作台、Router 和唯一 `useReplaySession`。外部 replay pending 导入在同一工作台选择文件并本机分析后 ACK；解析引擎失败保留 pending 供重试，不自动发起 AI、3D 或上传。

断网不清空 replay、Result、Rating、native cached session 或本地检视。3D 断网销毁当前场景以作废在途 asset session（沿用场景 generation，不创建另一套 cancellation）；selection 仍属于工作台。用户停留在阻断的 3D 时，重连只恢复 controller 与待开播面板一次；沿用 main 的画质先选、明确 Start 后才解析/拉资产，后台重连不新建场景。AI 流沿用既有 AbortController 取消，断网取消不再发送 cancel HTTP；重连只恢复能力，不提交复盘。HoF 只在 availability 从不可用恢复可用时加载当前榜单一次，业务错误仍由明确重试处理。

`common/shot-tank-data.json` 从 reviewed Agent asset plane 的 `data/tank_cache.json` 与 `tank/{id}.json` 提取 config 原始顺序、`pitch_limits`、`shell_global_ids`；不包含名称/GLB/纹理或第二份 tankopedia。更新：`python common/python/update_shot_tank_data.py --asset-base <reviewed HTTPS asset origin>`。缺 source entry 更新失败，不覆盖现有快照；缓存与全部 tank 原始输入有 SHA-256 provenance。当前 735 车型的 2075 global shell IDs 全部由同包弹表覆盖。未知车型如实保留 pitch 降级，不联网补齐。装甲查看器跳转属于联网 3D 动作，单独门控。

`npm run test:browser-interaction` 包含真实 WASM offline scenario：冷启动/重启、fixture 手动导入/Result/Rating/2D/射击、AI/HoF/3D/Profile 深链、重连/断网与 local state 保持，并在网络边界记录和拒绝业务 HTTP（应为零）。这是自动运行门禁；3D 画面和 Android provider 真机验证仍由人工完成。

Playback 布局有两条**真实浏览器门禁**（jsdom / happy-dom 没有布局引擎，几何断言只能在这里判定）：

- `npm run test:browser-layout`（`scripts/browser-playback-layout.mjs`）：逐字加载生产 CSS（含 `playback-workspace.css`，只把 `:fullscreen` 换成根类标记）的几何夹具。视口用 CDP `Emulation.setDeviceMetricsOverride` 而不是 `--window-size`（headless 窗口最小宽 500px，`390×844` 会被静默放大），并断言页面实测视口与请求一致。
- `npm run test:browser-interaction`：真实应用。`ws2d-*` 场景挂载生产 `BattlePlayback`（`playback-controls.html?players=7&recorder=1|2`），`roster-geometry-*` 场景驱动真实 `Replay3DPane`，覆盖 375×812、390×844、740×360、844×390（含全屏与录像者在 Team 2）、1024×768、1600×900：竖屏纵向流、横屏三段式、正方形、物理左右、车道不滚动、行信息完整且无血条、主控件一行、详情浮窗挂在 workspace 上并能拖过三栏且不压传输控件、连点 Team 2 更新同一个窗且位置不动、× 不清选中、名册关闭 / 打开保留状态、3D 全屏不重建场景。

### Playback fluid geometry and controls

2D/3D share the primary composition `-5 / Play-Pause / +5 / current speed / Fullscreen / Display`.
Speed options open on demand; all six controls retain intrinsic touch targets. HUD, square Stage and
Transport form one compact center stack. Team 1 stays physically left and Team 2 right; portrait
retains natural document flow. Roster widths grow within bounded limits relative to the workspace.
Viewport capacity and measured persistent HUD/Transport heights determine Stage capacity; scrolling,
selection and presentation toggles do not recreate renderers, reparse a replay or reload assets.

Display is a non-draggable workspace surface anchored to Gear, above it when space permits and
clamped within the workspace; portrait uses a compact inline surface with bounded scroll. Details
remain a separate draggable contextual surface. Persistent HUD shares map/time, HP/score and compact
base metadata; transient kill feed is bounded and excluded from height measurement.

The real browser matrix also covers 1792×922 fullscreen and checks maximal square capacity, compact
stack gaps, fluid roster bounds, primary DOM/x order and Display anchoring. Replay file reselection
at 740×360 uses raw touch; no synthetic click is added. Scroll cancels selection, the next tap selects
once, and clearing a pending replay still aborts its parse before loading the new file.

| Geometry responsibility | Owner |
|---|---|
| Shared columns, fluid roster bounds, square capacity, center stack | `playback-workspace.css` |
| Phone portrait flow | `playback-mobile.css` / 3D portrait component rules |
| Workspace height and intrinsic HUD/Transport measurement | Existing renderer ResizeObservers |
| Primary controls and speed disclosure | `PlaybackTransport.vue` |
| Persistent HUD and compact bases | `BattlePlaybackHud.vue` / `BaseStatusBar.vue` |
| Display anchor and workspace bounds | `PlaybackDisplaySurface.vue` |
| Details drag placement | Existing `usePlaybackDetailsPlacement` |
| Fullscreen lifecycle / replay selection | Existing fullscreen composable / ReplayWorkspace |

3D visual acceptance remains manual: check 740×360, 844×390 fullscreen, 1600×900 and 1792×922 fullscreen
for battlefield prominence, compact HUD/Transport and comfortable Display presentation. Browser
geometry and interaction checks establish layout/state invariants, not GPU/material appearance.
