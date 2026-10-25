# Replay Workspace（当前实现索引）

本文档只记录前端代码的 ownership 与导航边界；回放协议、AI/Playback API 和资产细节仍由各自 canonical 文档维护。

## 当前实现

- 工作台的官方示例与帮助复用同一 Replay session。示例经固定 manifest 与 SHA-256 验证后，匿名可用 3D/射击；普通文件选择立即撤销示例资格，AI 与服务端写操作仍使用真实登录。真实页面教学与维护规则见 [onboarding.md](../features/onboarding.md)。

- 回放优先的页面组织：能力切换放在页头操作区；单场能力共用紧凑选局行。数据 / 2D / 3D 支持一次选择多个文件，先分析再选局。完成分析后，2D / 3D / 射击 / AI 可收起文件区，文件选择器仍挂载并保持会话；解析中或出错时自动显示，数据页始终保留文件区。
- 能力栏随可用宽度自然换行，手机上每行按钮填满宽度，五个入口及中英俄标签完整可见，无需横向滑动。桌面空间足够时保留单行排列；选中态、键盘切换和至少 44px 的触屏目标继续由共享 `SegmentedControl` 提供。
- 2D 默认无标注且关闭编辑，播放区提供直接的“标记模式”入口。进入时暂停，退出不自动继续；已完成标注常驻，可手动隐藏，切局或刷新清空。LT / MT / HT / TD、多点路线及编辑沿用现有 annotation owner，不与 3D 同步。具体行为见 [battle-playback.md](../features/battle-playback.md)。
- 2D / 3D 共用时间轴在上、主要播放按钮在下的传输控件。3D 开始前直接选择画质，额外性能选项默认收在原生折叠区；相机与模型查看在单独的工具行。

- `frontend/src/components/ReplayWorkspace.vue` 是 `data`、`playback`、`3d`、`shots`、`ai` **五种能力**的统一工作台：选择一次文件，能力之间切换不重新选文件、不重建 session。
- Workspace 页面本身是 orchestration layer：`PageHeader` 负责页面标题，`ReplayCapabilityTabs.vue` 负责能力切换（数据 · 2D 回放 · 3D 回放 · 射击分析 · AI 复盘，五种能力对所有用户可见，`wotbtools-admin` 不改变能力集合；五个能力都在本工作台内，没有"导航去另一个页面"的能力），`FileDrop.vue` 是全站唯一的上传面（空 / 已选择 / 解析完成三种状态，解析完成后折叠为一行，清空需确认，是唯一的清空入口），`BattlePicker.vue`（可搜索的场次选择器）在四个单场能力上方选择当前场次。它们只接收 Workspace 派生状态并发出显式命令，不复制 session owner。
- 四个非数据能力面板由工作台按需异步加载、首次激活才挂载（`composables/useMountedWhenActive.js`）：3D / shots 还必须已登录或使用可信官方示例，3D / AI 还要求 capability 可用（连通性）；满足条件后切走只 `v-show` 隐藏：`BattlePlaybackPanel.vue`（2D）、`Replay3DPane.vue`（3D）、`ReplayShotsPane.vue`（射击）、`AiReviewWorkspacePane.vue`（AI）。四个面板共用 `file` / `active` / `blockedReason` props 契约；`active=false` 时停渲染不销毁会话（3D 场景 `setPaused` 停 rAF），切回保留 timeline / 相机且不重新解析。`BattlePlaybackPanel.vue` 直接接收目标文件，通过工作台的 canonical Worker 得到 2D 数据与地图概览，不等待 3D 的联网俯仰资料或显示名；已就绪的 scene facet 仍可复用；多文件未选场次时四个面板显示同一份 `workspace.single_replay_required`。
- 3D 面板按「待开播 → 开始」两步进入播放：文件由工作台派生后就位，但解析与资产加载都要等用户在面板里按「开始」（卡片上先选画质档——内核 `startPlayback()` 惰性创建渲染器、首帧按当前档位定型，所以档位不能事后在加载中再改）。换场次 / 清空先 `reset()` 撤下上一场：`reset` 与 `destroy` 同等作废在途加载（`sessionEpoch` / `loadGeneration`），被撤下的解析 / 资产续体不得再回写 store，也不得把上一场继续画在待开播面板后面。
- **画质四档**（SSOT 是 `scene/playbackScene.js` 的 `QUALITY_PRESETS`，UI 文案走 `agentReplay.q_*` 三语键）：`low 流畅`（盒代理 + 小地图底图，弱机/省电）→ `mid 均衡`（真车模 GLB + **俯视烘焙底图**（上游 tools/bake_ground_roofs.py 把屋顶/树冠/草丛烘进地形图）+ MSAA/DPR 1.25，**不拉 11–67MB 场景 GLB**——移动/Tauri 默认档）→ `high 高清`（场景 GLB + 分层地表 + DPR 1.5，桌面默认）→ `ultra 极致`（DPR 2 + 地形 512，4K/Retina 显式选择）。档位阶梯 = 相邻档各跨一个真实成本断崖（车模 / 场景下载 / 填充率）；URL `?q=` 覆盖，localStorage `pb_quality` 保存当前档位（四档键名兼容）。同一节另有 `?dynres=1` 动态分辨率（显式 A/B 开关）：持续超帧预算按 0.25 步长降 pixel ratio、有余量升回档位上限（迟滞 + 冷却防振荡，纯函数状态机 `scene/dynRes.js` 单测锁定）；`?perf` 报告带 pixel ratio 分位数供对比。
- 解析任务的**生命周期归当前会话所有**：`Replay3DPane` 持有 per-load 的 `AbortController`，清空 / 换场次 / 销毁经 `sceneApi.loadData({ signal })` 透传到 `scene/replaySource.js` 的解析边界——被撤下的解析立即以 `AbortError` 结束并让出 Worker 队列（仍在 Worker 上时整体 terminate）。`replaySource` 的每个解析请求带看门狗（120s 不回包也不报错 → terminate + 在途全部失败，下次请求重建 Worker）；WASM 装载链（fingerprint 拉取 / 产物 JS dynamic import / wasm 初始化）有 20s 看门狗（浏览器 fetch / import 没有默认超时）。装载超时后 dynamic import 换带序号的 specifier 强制全新装载（浏览器模块表按 URL 去重，同 URL 重试只会拿回同一个悬着的模块记录）。
- 3D 场景加载与就绪态由 `scene/playbackScene.js` 独占：进入解析阶段立即置 `loading=true`、`hasData=false`、`assetStage=false`、`assetProgress=null`；当前会话进入资产阶段才推进资产进度，完成后才标 ready。销毁清掉加载阶段状态。地图资产每个异步边界之后先复核会话身份，再发布地图 key、纹理、地形、分层地表或场景；迟到资源只释放局部结果。资产 URL 显式使用当前会话的地图 key，旧实例的地图解析不能改变当前会话后续请求。`Replay3DPane` 只负责编排，不新增加载令牌。
- 3D 顶栏的双方总血量与比分都按**阵营视角**渲染，不是原始 `score1` / `score2`：`scene/teamHpTotals.js` 的 `teamHpTotals()` 按 `friendly_team` 把车辆血量归到己方 / 敌方，`perspectiveScore()` 把物理比分映射成 `scoreFriend` / `scoreEnemy`，store 只暴露视角字段，HUD 数值不缩写（完整整数 + 原始百分比色条）。
- 3D / 射击面板不持有文件选择器，也不持有第二份 session：选择与 identity 仍只由 `useReplaySession` 拥有。
- 四个懒加载面板都经 `utils/lazyModule.ts` 的 `defineLazyModule` 边界加载（不是裸 `defineAsyncComponent`）：部署换掉 chunk 文件名后旧页面进入能力必然 404，边界保证工作台**保持挂载**并在该能力内显示可操作失败态（「重新加载」为主、「重试」覆盖瞬时失败），且失败态在切走再切回后**仍然保留**（generation 与 recovery 由边界自己拥有）。生产契约见 [`docs/architecture/ai-review.md`](../architecture/ai-review.md)「懒加载与部署的关系」。
- 数据模式（`ReplayPage.vue`）的结果区自上而下是：提示（`Banner`：重复 / 解析失败 / League 不可用 / 未评分场次）→ 工具栏（`SegmentedControl` 汇总 / 单场 · 单场时的 `BattlePicker` · Rating 说明 · 列 · `MenuButton` 导出 ▾：Excel 汇总 / Excel 逐场 / PNG 当前视图）→ 汇总视图顶部的 `SeriesOverview`（两支稳定战队时显示系列赛比分，其后是逐场结果条，点击跳到该场单场视图）→ 表格。
- 玩家表默认只显示 6–8 个核心列（`utils/helpers.js` 的 `*_DEFAULT_VISIBLE`），其余在「列 N/M」面板里；localStorage 可见列与 `LEGACY_DEFAULT_VISIBLE` 中任一份默认列完全相同时视为未自定义，采用当前默认列。手机（<768）默认用 `PlayerCardList` 卡片列表（可切回表格，排序与表格共用）；卡片模式下表格仍在 DOM 中隐藏，PNG 导出始终导出表格。
- 玩家详情 `PlayerDetailDrawer`：桌面可拖宽的推开式侧栏，平板固定 360px 推开式侧栏（都写 `--pd-drawer-offset` 让工作台让位），手机全屏 sheet，可左右滑动切换玩家。
- 系列赛比分与场次选项由纯函数 `utils/replaySeries.js` 从 ReplayResult 派生：战队身份只认 League 批次 `teamSummaries` 的 `clan:` teamKey 与 `arenaTeams`；任何一方是 `arenaId:team` 兜底键、或不是恰好两支队伍时不推算比分；无法归属的（未评分）场次如实计数并说明，不计入比分。场次选项显示「第 N 场 · 地图」与「胜方 · 时间」，可按文件名检索。
- `frontend/src/composables/useReplaySession.ts` 是唯一 session state owner，持有 selection、当前 battle、本地分析状态（`analysis: { phase, done, total, failure }`）、结果与 Workspace view state。
- `frontend/src/composables/useLocalReplayAnalysis.ts` 持有本机分析生命周期：Worker 解析（上游 Rust Core WASM）→ 批次计算 → 提交结果；选择变化 / 取消作废在途分析；`exportExcel` 复用最近一次的批次结果在客户端生成 xlsx / zip。服务器没有 parser，失败只显示原因（`ENGINE_UNAVAILABLE` / `NO_VALID_REPLAYS` / `UNKNOWN`），不回退服务端。
- `frontend/src/composables/useReplay.ts` 是 facade/orchestrator，组合 session 与本地分析。
- `BattlePlaybackPanel.vue` 直接接收目标文件，通过工作台的 canonical Worker 得到 2D 数据与地图概览，不等待 3D 的联网俯仰资料或显示名；已就绪的 scene facet 仍可复用。多文件先由 Workspace 批次分析并选中有效场次，面板仅处理目标 File。
- `frontend/src/app/viewRegistry.js` 是 view → capability 的唯一映射：`replay` → `data`、`battle-playback` → `playback`、`agent-replay` → `3d`、`agent-shots` → `shots`、`ai-review` → `ai`；五个 view 全部映射到同一个 `ReplayWorkspace`，由 `initialCapability` 决定初始能力。`ViewHost.vue` 用 `KeepAlive` 保留工作台实例。`agent-replay` / `agent-shots` 深链解析为能力入口。
- `frontend/src/app/router.js` 是浏览器历史与深链 owner。页面组件通过注入的 `navigate` 改变 URL，不直接操作浏览器 history。

## Playback 布局契约（共享外围，按 renderer 定义 Stage 几何）

2D 与 3D 是同一个 Playback 产品，共享外围布局，Stage 几何按渲染器区分：2D 为正方形地图；3D 横屏铺满中心列可用宽高，竖屏为正方形。外围 workspace 契约**只有一份**：`frontend/src/styles/playback-workspace.css`（`main.js` 在 `playback-shared.css` / `playback-mobile.css` 之后引入），2D 与 3D 的三列网格、车道宽度、Stage 容量与中心栈都写在那里；`Replay3DPane.vue` 只保留 3D 自己的呈现与竖屏 order 阶梯。竖屏判据两边共用 `usePlaybackPortraitViewport()`（不从 `isPhone` 推）。

**布局档位**

| 档位 | 呈现 |
|---|---|
| 手机竖屏 | **纵向流**：HUD / 正方形 Stage / 传输控件 / Display（打开时，流内）/ 详情（inline）/ 己方 / 敌方，页面纵向滚动；没有名册浮层、没有两个各自滚动的队伍盒子 |
| 手机横屏（740×360、844×390） | `己方 │ Stage │ 敌方`（2D 正方形，3D 横屏铺满）；外壳让出（沉浸态）、2D HUD 一行；2D 的传输条是最底部**全宽一行**（时间轴 + 按钮 + 时间），车道只跨 HUD + Stage 两行 |
| 手机全屏横屏 | **同一个**几何：`己方 │ Stage │ 敌方`（2D 正方形，3D 横屏铺满），传输控件在 Stage 之下；没有常驻侧栏，⚙ 打开的是锚定在 gear 上的 Display 浮面 |
| 平板 / 桌面（含全屏） | `己方 │ Stage │ 敌方`（2D 正方形，3D 横屏铺满）；六个 primary 控件在中心列 Stage 之下，不存在「控件进左栏」的形态 |
| 名册关闭（`uiPrefs.showRoster=false`） | 两侧车道**整体不存在**，2D Stage 仍为居中正方形；3D 横屏填满可用中心区域，竖屏保持正方形；数据、选中、详情、跟随、相机、播放与倍速都保留 |
| 异常数据（远超 7v7） | 车道内滚动只作为安全兜底；正常 7v7 不是异常数据，任何视口都不走「临时名册面」 |

- **Recorder 视角**：己方在左、敌方在右；录像者属于 Team 2 时交换两队车道。HP 条、圆点与行边框使用己方绿／敌方红，未知视角保持中性，未识别阵营独立列在左侧。物理 `vehicle.team` 身份保持不变。
- **桌面列宽**：左右名册各约 25%，中心约 50%；横条模式下战场血量位于 16px 血条内，装填轨道等宽、厚 2px，不重复显示血量百分比。2D 可切换车辆外围的血量环，环形模式隐藏装填条；一键防遮使用类型图标、车型名及血量环。昵称与车型共用轻薄半透明毛玻璃底。玩家名开关控制战场标签，3D 名字读取回放 `nickname`。
- **2D 正方形是几何约束**：边长 = `min(中心列可用宽度, 纵向可用高度)`。2D 的高度那一半由 `BattlePlayback` 的 `writeSquareAvailHeight()` 实测写入 `--pb-square-avail-h`：`视口高 − 顶部偏移（全屏为 0，否则 --header-h）− --tabbar-h（全屏为 0）` 得到 `--pb-workspace-h`，再减 workspace 上缘偏移与上内边距、实测 persistent HUD 高度、实测传输控件高度、两处间距与容器下内边距；这里刻意用**视口容量**而不是根元素的内容高度（那会反过来把 Stage 撑大形成自指），滚动只改变呈现位置、不改变容量。3D 横屏画布铺满中心列可用宽高，由场景 ResizeObserver 更新相机 aspect；竖屏仍为正方形。2D 地图元素带的是地图自己的逻辑画框（`mapView` W/H，如 766×769，底图 / SVG / 标记共用），与 1:1 的差 < 1%，不强行拉伸。
- **手机横屏沉浸态**：`ReplayWorkspace` 在「手机形态 + 横屏 + 触屏 + 当前是 2D / 3D 且已有回放」时通过 `shared/shellChrome.ts` 的 `SHELL_CHROME_KEY` 向 `AppShell` 申请沉浸；`AppShell` 是唯一 owner，沉浸时不渲染顶栏 / Tab 栏并在根元素写 `data-shell-chrome="immersive"`，`tokens/scale.css` 据此把 `--header-h` / `--tabbar-h` 归零，2D / 3D 的高度预算自动吃到这 104px（两个 pane 在沉浸态切换时显式重算预算）。转竖屏、切到非回放 capability、离开页面或 KeepAlive 停用都会释放。
- **手机横屏名册可访问性**：触屏侧栏保留 64px 行高；高度不足时列表内部滚动，昵称 / 车型 / HP 不被压扁裁切，末行可滚动到达。
- **名册事实与地图可见性独立**：HP 从完整 V2 车队投影，未被发现或没有当前位置的敌车仍保留已知血量；缺失血量继续显示 `—`。
- **名册行**：共享 `PlaybackRoster`，信息为玩家 / 车型 / 当前 HP（缺精确数值时用百分比）/ 阵亡；**HP 血条内呈现当前数值或百分比**。未知血量显示 `—` 而不是 `0%`；只有相对比例证据时可显示百分比，不要求可信绝对上限。当前行模板不渲染装填轨道，装填只保留上游数据接线与战场车辆标签展示。信息不减，密度由调用方按形态给（2D 只在手机形态用 `compact`，3D 在非竖屏一律 `compact`）。
- **选中 ≠ 详情可见 ≠ 跟随**：选车 → `selected = 车` 且 `detailsOpen = true`；详情 × 只把 `detailsOpen` 置 false，选中（名册高亮 / 标记）、跟随、相机、时间、倍速、名册都不动；再点同一台或另一台 → 同一个详情窗重新打开 / 换内容，永远只有一个窗。2D 的名册行与场景点击打开详情；3D 名册行直接跟随，场景点击打开详情。
- **详情**：同一个 `VehicleDetailsPanel`。宽档 / 横屏是**整个战场 workspace** 顶层的可拖动浮窗（2D 宿主 `.pb-main`，3D 宿主 `.pb-root`；浮窗是宿主的直接子元素，定位、夹紧与拖动同一坐标系），可以拖到 Team 1 / Stage / Team 2 任意一栏之上；边界 = workspace 内容盒（左右 / 上内边距不算，那里是 workspace 的留白与顶部 HUD）减去受保护的传输控件。位置归 `usePlaybackDetailsPlacement.js` 独占，不持久化；同一次打开内换车不重置用户拖过的位置，关闭后重开是新的一次。未拖过时的初始落位：点左车道 → 右侧，点右车道 → 左侧，点场景里的车 → 与它相对的一侧。手机竖屏是 `presentation="inline"`，排在传输控件之后、名册之前。名册与详情互不影响。
- **全屏**：不引入第二套布局模型，只改变容器尺寸；`document.fullscreenElement` 是权威状态。3D 进出全屏不重建场景、不丢选中 / 跟随 / 时间。
- **Display**：`PlaybackDisplaySurface.vue` 是 gear 锚定的配置面（不可拖动），与可拖动的 Details 语义分离。宽档 / 横屏是绝对定位浮层，优先开在 gear 上方、右侧空间不足向左平移、上方高度不足改用下方，并夹在 workspace 内；竖屏是 100% 宽的流内面（有界内部滚动），顺序由宿主自己给——2D 的 `.pb-main` 竖屏下就是文档流，3D 的 `.portrait-flow` 有显式 order 阶梯。

## 稳定边界

- Playback 2D/3D 共用 `usePlaybackPhoneForm()` / `PLAYBACK_MOBILE_QUERY`：844×390 coarse 手机横屏仍用 compact transport 与二级面板；3D CSS 由根 `.phone-form` 驱动，不单凭宽度切回 tablet。真正平板保留 tablet。共享 `usePlaybackFullscreen` 只在当前 target 拥有 `document.fullscreenElement` 时报告全屏；另一个 keep-alive 面板不冒认或退出别人的全屏。landscape orientation 尝试只属于 phone 的自身全屏。
- 3D 名册没有「临时名册面」：竖屏走纵向流，其余一律两侧常驻车道（见上表）。`uiPrefs.showRoster` 是唯一的呈现偏好，隐藏不能清空名册、selection、follow 或播放时刻。
- `Replay3DPane` 独占 selected vehicle；场景 raycast 执行选择并打开共享 `VehicleDetailsPanel.vue`；3D roster 行执行明确的跟随命令。相机模式与 follow target 独立，Follow 必须显式请求，Free/Top 不清 selection。2D / 3D 共用 canonical evidence；3D 在 canonical 就绪前保留场景身份 / 权威 HP / 阵亡基础子集，就绪后按账号增强统计、日志与装备状态（见文末 canonical parity），不伪造缺失伤害统计；详情开关不重建场景或重新解析。（`selected` 与 `followed` 是独立状态；3D 行点击选择并跟随，场景点击打开详情。）

- 多文件选择、当前 battle 选择和 capability 切换都由 Workspace facade 协调；session 以 `selectionRevision` 与 `sourceId`（`r{文件序号}`）作为唯一 identity。
- 场次选择器（数据模式在 `ReplayPage` 工具栏、四个单场能力在面板上方）只展示选项并调用 Workspace 的 `selectBattle(sourceId)`；权威 `currentBattleId` 仍由 `useReplaySession` 持有。用户 tab 命令先更新 Workspace capability，再通过注入的 `navigate(view)` 写入 URL；外部 URL 只通过 `initialCapability` 初始化/同步 Workspace，避免 router 与 tab watcher 互相回写。五种能力对匿名、普通登录用户与管理员永久可见，`wotbtools-admin` 不改变能力集合；匿名直达 `?view=agent-replay|agent-shots` 保持目标能力，个人回放由能力层显示登录门禁，已验证的官方示例可匿名进入。
- AI 复盘是**正式能力**（普通用户可见，未登录由 AuthGate 引导登录）：联网能力先经 `useFeatureGate` 判定，离线/unknown/degraded/service-unavailable 先给 connectivity 提示，绝不启动登录；在线且未登录沿用 native/browser auth。可用深链挂载 AI 面板（`AiReviewWorkspacePane.vue` → `AiReviewPanel.vue`），受登录门控与客户端投影可用性约束。切换 capability 不重新分析数据模式的结果。
- 射击分析默认选择录像者（「我的射击」），汇总与列表仅统计当前射击者；「全部玩家」及其他玩家是可选筛选。录像者依次使用 shot facet 的 `author_eid`、playback meta、名册 `is_author`、逐发 `is_author`，不按昵称猜测。自己没有记录时保留诚实空态，并提供查看全部玩家入口。
- 射击条目与详情突出双方车型及类型符号，昵称作为次要身份信息。车型名优先使用 playback roster，缺失时从已有本地 tankopedia 补全；名字解析不调用远程资产服务。`utils/shotPresentation.js` 是车型呈现与记录结果徽标的共享 owner，不重算伤害或击穿。
- 命中结果徽标与 3D 射击复现头部共用 `utils/shotResultClass.js`：`game_hit_result=4` 的语义未定，统一显示「结果未定（4）」，不映射跳弹/履带/击穿；`0/255` 显示结果未知；作者 `hit_flags` 位图优先。解析层给出 `quality.target_dead`（开火前受击方已死亡）时，射击按未命中处理并在质量提示中标注「残骸命中」。
- 3D 射击复现的 hash6 解码盒只取坦克数据里的客户端 `collision_boxes`（Parameters YAML 的部件代理盒，也是服务器量化框）；盒缺失时设置 `__segBoxMissing` 并在统一判定入口阻断（world 初始化、时间轴重判、换弹都覆盖，清除旧结果；普通相机点击不受影响），同时在常显 `#shot-replay-error` 错误条展示原因（不进入 debug details/隐藏面板），**不从 collision.glb 的装甲网格自算 AABB**——网格 AABB 与客户端量化框不是同一份数据。
- 无主装甲门禁（`require_primary`）命中时 `penetration.js` 返回 `blocked_no_primary`，结果卡同步禁用概率链与满伤回填：保持 BLOCKED/0%，不会重新显示「可能击穿」或满伤；续飞路径同样传递该标记。
- 射击面板按容器宽度使用 Master–Detail（expanded 常驻详情 / medium 有界双栏 / compact 模态详情）；窄屏详情保留焦点约束与关闭后焦点恢复。命中弹「在装甲查看器里打开」通过既有本地交接通道只保存当前筛选内可检查的命中弹，保留原始索引与时间，随后经注入的 `navigate` 打开装甲页。
- 装甲页逐发导航复用 `scene/agentData.js` 的 `shotViewerQuery` 和 Router：上一发 / 下一发保持当前命中快照，返回恢复列表。相同页面 query 更新时先销毁旧场景再重建 DOM 契约；迟到的 snapshot、模型加载、计时器和状态回调不能覆盖下一发。页面顶部展示双方车型、记录时间、结果和伤害；模拟参数与记录结果明确分开，技术证据默认折叠。
- AI/Playback 详细接口与回放管线以以下文档为准，不在本索引重复维护：
  - [`docs/architecture/ai-review.md`](../architecture/ai-review.md)
  - [`docs/features/team-ai-review.md`](../features/team-ai-review.md)
  - [`docs/features/battle-playback.md`](../features/battle-playback.md)
  - [`docs/architecture/replay-pipeline.md`](../architecture/replay-pipeline.md)

若上述实现路径或 owner 发生变化，先更新本索引与 [`docs/frontend/architecture.md`](architecture.md)，再更新目录级硬规则。

## 匿名访问

服务器没有 parser：解析、汇总、导出与 2D 回放全部在本机进行，工作台挂载即可用、不等登录、没有登录门禁，也不发出任何回放相关的后端请求。个人回放的 3D、射击分析 / 复现以及 AI 复盘、名人堂等写操作需要登录；官方示例只对 3D/射击放行。

- Android pending 字节通过固定的同源 LocalRuntimeServer resource（`http://127.0.0.1:21653/__native/replay-pending`）读取；header 校验 pending identity，响应不缓存。fetch/blob 失败复用 Replay 错误区与重试，不分析、不 ACK。
- Android pending replay 在工作台挂载后消费；ACK 边界是「本机分析已完成」（`analyze()` 返回 `{ completed: true }`，无论有没有有效场次）；回放引擎装载失败返回 `{ completed: false, reason: 'ENGINE_UNAVAILABLE' }`，Native pending 原样保留可重试（见 [`docs/android/replay-intent.md`](../android/replay-intent.md)）。

## 能力访问策略

Replay Workspace 有五个公开可发现的能力。匿名用户可使用 Data 与 2D Playback。个人回放的 3D Playback 与 Shot Analysis / Reconstruction 需要登录；已验证官方示例也允许匿名使用这两项。AI Review 始终需要登录，包括官方示例。`wotbtools-admin` 不改变 Replay Workspace 能力。

`ReplayCapabilityAuthGate.vue` 复用 `EmptyState` 与登录按钮：匿名使用个人回放时不挂载 `Replay3DPane` / `ReplayShotsPane`，不启动对应解析、场景或远端资产加载；已验证的官方示例可按需挂载这两个 pane，3D 仍受连通性门禁约束。普通选择、追加、清空或 Android 导入会撤销示例资格。登录分别以 `agent-replay` / `agent-shots` 为返回目的地。登出卸载不具备示例资格的受限 pane，但不清空 Workspace 的 replay selection/session。AI 保留自己的 projection/error lifecycle，全部匿名选择均不构建投影，登录返回 `ai-review`。

装甲查看器 `agent-armor` 保持独立页面，且**匿名可用**：登录用户或匿名官方示例用户可从 shots 选择命中弹并打开复现场景；普通用户从 Tankopedia 详情入口卡（对全员开放）进入；匿名深链由 `ViewHost` 直接挂载装甲页面，不做登录拦截。场景 query（`tank/shooter/config/scfg/shell/shot/world/heatmap/az/h/d/…`）原样保留。登录门禁不会主动清空 selection；浏览器 OIDC 整页跳转受现有 session 持久化能力限制，回放字节不持久化。

## 本地优先能力边界

`app/featureCapabilities.js` 是唯一连通性能力模型；组件消费 `useFeatureGate()`，不自行读 `navigator.onLine`。连通性与登录是**两条独立门禁**：ONLINE_REQUIRED 能力在非-online 时连挂载都不做，登录门禁只决定「已连通但未登录」时的引导。连通性首次检测完成前（`availability().pending`）只 fail-closed、不下结论：不显示任何 connectivity 提示，也不落到登录门禁；检测完成后按真实结论（含仍为 UNKNOWN）渲染。

| 能力 | 运行要求 | 离线行为 |
|---|---|---|
| `data`：导入、Rust/WASM 解析、Result、deterministic Rating、session state | LOCAL | 文件、结果与选择照常使用，不请求业务 HTTP |
| `playback`：2D、底图、标记 | LOCAL | 本机解析，底图和标记随 bundle 提供 |
| `shots`：射击列表、检视、弹种、俯仰锚定 | LOCAL +（登录或已验证官方示例） | 本机解析；弹种表与搭载输入取资产包（`/data/shellKinds.json` 与 `tank/{id}.json`）；匿名个人回放由 `ReplayCapabilityAuthGate.vue` 引导登录 |
| `3d`：远端场景/GLB | ONLINE_REQUIRED +（登录或已验证官方示例） | tab 保留；官方示例也受连通性门禁约束；连通性提示优先于登录门禁，不挂载 remote loader |
| `ai`：AI 复盘 | ONLINE_REQUIRED + auth | connectivity 先于登录与请求；联网恢复不自动提交 |
| HoF/remote Profile/Admin users | ONLINE_REQUIRED | 入口保留；mount、读写、确认后的动作都经过同一门禁 |

Android 与 Web 共用工作台、Router 和唯一 `useReplaySession`。外部 replay pending 导入在同一工作台选择文件并本机分析后 ACK；解析引擎失败保留 pending 供重试，不自动发起 AI、3D 或上传。

断网不清空 replay、Result、Rating、native cached session 或本地检视。3D 断网销毁当前场景以作废在途 asset session（沿用场景 generation，不创建另一套 cancellation）；selection 仍属于工作台。用户停留在阻断的 3D 时，重连只恢复 controller 与待开播面板一次；沿用先选画质、明确 Start 后才解析/拉资产，后台重连不新建场景。AI 流沿用既有 AbortController 取消，断网取消不再发送 cancel HTTP；重连只恢复能力，不提交复盘。HoF 只在 availability 从不可用恢复可用时加载当前榜单一次，业务错误仍由明确重试处理。

射击检视的搭载输入与弹种表运行期直读资产包——`fetchShotTankData` 对 `tank/{id}.json` 做 config 顺序 + `pitch_limits` + `shell_global_ids` 的紧凑投影，弹种表取 `/data/shellKinds.json`（与上游 tanks.pb 同批刷新，经 manifest sha256 差分发布）。资产源未配置或请求失败时按降级语义继续（pitch 如实降级、弹种走槽位/id 兜底）；**列表发布不被资产请求挂起阻塞**：弹种表与解析并行、到位后经响应式视图原地补齐；俯仰锚定是解析期入参，采用**有界等待**（1.5s 到期用已到的部分表继续，单个请求挂起不拖死列表）。装甲查看器跳转属于联网 3D 动作，由装甲页面自身承载（匿名可用，无需登录）。

`pnpm run test:browser-interaction` 包含真实 WASM offline scenario：冷启动/重启、fixture 手动导入/Result/Rating/2D/射击、AI/HoF/3D/Profile 深链、重连/断网与 local state 保持，并在网络边界记录和拒绝业务 HTTP（应为零）。这是自动运行门禁；3D 画面和 Android provider 真机验证仍由人工完成。

Playback 布局有两条**真实浏览器门禁**（jsdom / happy-dom 没有布局引擎，几何断言只能在这里判定）：

- `pnpm run test:browser-layout`（`scripts/browser-playback-layout.mjs`）：几何夹具按生产顺序加载**生产样式表**（`tokens/scale.css` → `playback-shared.css` → `playback-mobile.css` → `playback-workspace.css`，只把 `:fullscreen` 换成根类标记），并用脚本**合成**生产由 JS 写入的容量变量（`--pb-workspace-h` / `--pb-square-avail-h`，按与 `writeSquareAvailHeight()` 相同的口径算）。夹具自己的控件盒（`.pb-controls` / `.pb-btn`）是独立的小尺寸替身，因此这里锁的是宏几何，中心栈与控件尺寸由 `test:browser-interaction` 用真实组件覆盖。视口用 CDP `Emulation.setDeviceMetricsOverride` 而不是 `--window-size`（headless 窗口最小宽 500px，`390×844` 会被静默放大），并断言页面实测视口与请求一致。
- `pnpm run test:browser-interaction`：真实应用。`ws2d-*` 场景挂载生产 `BattlePlayback`（`playback-controls.html?players=7&recorder=1|2`；手机横屏场景带 `shell=immersive` 复现外壳让出，并断言地图边长下限——740×360 ≥260、667×375 ≥270、844×390 ≥290，HUD ≤36px、传输条一行全宽；真实应用场景 `multifile-workspace-playback` 另验沉浸态隐藏 / 恢复外壳），`roster-geometry-*` 场景驱动真实 `Replay3DPane`，覆盖 375×812、390×844、740×360、844×390（含全屏与录像者在 Team 2）、1024×460、1024×768、1366×1024、1600×900、1792×922（全屏）：竖屏纵向流、横屏三段式、2D 正方形 / 3D 横屏填满与竖屏正方形、Recorder 视角左右、车道不滚动、行信息完整且 HP 文字位于血条内、主控件一行且顺序不变、HUD↔Stage↔Transport 间距紧凑、Display 从 gear 打开并夹在 workspace 内（竖屏必须是紧跟传输控件的流内面）、详情浮窗挂在 workspace 上并能拖过三栏且不压传输控件、连点 Team 2 更新同一个窗且位置不动、× 不清选中、名册关闭 / 打开保留状态、3D 全屏不重建场景。

### Playback 流体几何与控件

3D 回放下方工具栏右上角支持收起／展开，默认展开。收起后仅保留恢复按钮，播放继续，进度、倍速、选车和相机保持；切换文件恢复展开，全屏和视口变化保留状态。此开关独立于“隐藏全部 UI”。

2D/3D 共用 primary composition `-5 / Play-Pause / +5 / current speed / Fullscreen / Display`。速度选项按需展开；六个控件都保留自身触控目标。HUD、Stage 与 Transport 形成一个紧凑的中央栈。2D Stage 保持正方形；3D canvas 横屏填满可用中央宽高、竖屏保持正方形。录像者友军保持左侧、敌军右侧；竖屏保留自然文档流。名册宽度在工作台相对范围内有界增长。视口容量与实测 persistent HUD/Transport 高度决定 Stage 容量；滚动、选择和展示切换不重建 renderer、不重新解析回放、不重新加载资产。

Display 是锚定在 Gear 上、不可拖动的工作台面；空间允许时在 Gear 上方，并夹在工作台内；竖屏使用全宽内联面、有界滚动，由宿主排序（2D `.pb-main` 跟随文档流，3D `.portrait-flow` 有明确顺序阶梯）。Details 仍是独立的可拖动上下文面。Persistent HUD 共享地图/时间、HP/比分与紧凑基地元数据；瞬态 kill feed 有界且不参与高度测量。

真实浏览器矩阵还覆盖 1792×922 全屏，并检查最大 2D 正方形容量、3D 横屏填满/竖屏正方形、紧凑栈间距、流体名册边界、primary DOM/x 顺序、Display 锚定与竖屏 Display 顺序。740×360 重新选择 replay 文件使用原生 touch；不添加 synthetic click。文件 chip 上的拖动是滚动手势，不得选中任何内容；一次 tap 只选中一次，清除 pending replay 仍会在加载新文件前中止其解析。

| 几何职责 | 负责方 |
|---|---|
| 共享列、流体名册边界、renderer 专属 Stage 容量、中央栈 | `playback-workspace.css` |
| 手机竖屏流 | `playback-mobile.css` |
| 3D 竖屏顺序阶梯、3D 场景/HUD 呈现 | `Replay3DPane.vue` scoped rules |
| 工作台高度 | 2D `BattlePlayback.writeSquareAvailHeight()`；3D viewport token 来自 pane |
| Stage 预算（HUD + Transport + 间距） | 2D 用 `BattlePlayback.writeSquareAvailHeight()`；3D 用 grid rows `auto minmax(0,1fr) auto` |
| 主控件与速度展开 | `PlaybackTransport.vue` |
| 常驻 HUD 与紧凑基地 | `BattlePlaybackHud.vue` / `BaseStatusBar.vue` |
| Display 锚定与工作台边界 | `PlaybackDisplaySurface.vue` |
| Details 拖动放置 | 既有 `usePlaybackDetailsPlacement` |
| 全屏生命周期 / replay 选择 | 既有 fullscreen composable / ReplayWorkspace |

3D 视觉验收仍需人工完成：检查 740×360、844×390 全屏、1600×900 与 1792×922 全屏下的战场突出度、紧凑 HUD/Transport 与舒适的 Display 呈现。浏览器几何与交互检查只建立布局/状态不变量，不证明 GPU/材质外观。

### 3D Details canonical parity

`useReplayWorkspace.playbackSession` 是 2D / 3D Playback 解析的唯一 owner，按 selection 中的 File 身份复用在途及完成结果；两个 Pane 经显式 prop 消费。接口分为 `loadScene(file)`、`loadCanonical(file)` 和 `getState(file)`，共享状态分别记录 scene / canonical 的 readiness 与错误。

首次进入 2D 或启动 3D 时才加载；原始 Playback 经既有 Worker 入口只解析一次。`loadScene` 仅等待 raw 数据，3D 立即进入场景资产与建场流程，不等 canonical。session 后台启动 `parseLocalPlayback(file, { playback })`，复用 raw 数据投影 canonical dataset / overview；2D 可以等待 `loadCanonical`。canonical 后到时更新稳定的响应式 state，已打开的 3D Details 自动增强，不要求重新点击车辆或重建场景。canonical 失败只留下基础详情，2D 显示自己的错误；不阻塞 3D。

切换 renderer、布局、Details 不重跑 parser。`invalidateCanonical` 仅撤下并重试 canonical，不动成功的 scene 数据或 3D 场景；raw 失败时显式 `invalidate` 可重试整个 session。换 selection / 工作台销毁真实 abort 在途 Worker；canonical parser 无 AbortSignal，使用 generation guard 丢弃迟到投影，不能声称物理取消了 WASM。

场景名册保留 `accountId` / `tankId`；选择动作仍以 3D `eid` 为键，详情按账号匹配 track。查询时间为 `store.time - clock.startRaw`，不能用 render-grid 的 `startTime` 代替 AI-derived origin；rich Details 不以 reload telemetry 是否存在为前提。

共享 `VehicleDetailsPanel` / `V2VehicleInspector` 展示肖像、最后已知位置时间、血量与生命状态、已记录伤害 / 承伤 / 击杀、最近伤害日志、装备 / 物资 / 消耗品及状态。已记录伤害优先读取该车 `damageDealtSamples` 中当前时刻已出现的累计广播；当前仅录像者 Avatar prop10 有此证据，其 eid 与车辆 eid 不同，归属由录像者账号确定。旧数据或其他玩家仍累计可靠归属的掉血；累计广播不与掉血重复相加，也不回填结算总伤害。日志标注由两种 renderer 共用 `detailsDamageLogAtV2`，事件时刻未覆盖的攻击者保持来源未知；累计广播没有目标身份，不凭总量补造日志。缺少 canonical 数据、时钟起点或账号匹配时不造 0；仅保留场景已有的基础详情。场景加载代数与肖像 generation guard 防止迟到数据和肖像串场。

## Shared batch selection / single-battle capabilities

`data` 是 batch capability；`playback` / `3d` / `shots` / `ai` 是共享 batch selection 之上的 single-battle capabilities。

Workspace 的唯一 `ensureTargetBattle()` 复用现有 batch analysis，从 finalized `ReplayResult.battles` 自动选择第一场有效 battle，再通过 session 的 `currentBattleId` / `currentTargetBattleId` / `currentTargetFile` 交给当前 pane。文件选择仍由现有上传条与手动解析动作负责；进入单场能力时可准备已有多文件 selection。单文件保留无需先 batch analysis 的快速路径。3D 的画质选择与 Start、AI 的明确 Analyze 动作保持不变，不因选场自动提交 AI 请求。

`sourceId = r{original sourceIndex}`；`rN → files[N]`。Sparse source IDs 是有意设计：失败首文件后可以从 `r1` 开始，重复文件后可以出现 `r0,r2`。不得按成功场次数重新编号。BattlePicker 仅列 finalized battles，切场始终使用对应原始 File。

待分析与解析中由现有上传条/ProcessingPanel 表达，零有效场次显示真实解析失败，不报“只支持单回放”。已有结果和选中场次在能力切换间复用，不重复 batch parse。能力切换仅自动准备 idle selection；parsing 不重复启动，cancelled/failed 保留当前状态，仅显式 Preview 才允许重试。selection replacement 由 revision/abort 作废旧 batch 和 target preparation；per-File playbackSession 缓存与 canonical generation 保持独立，迟到工作不能覆盖新场次。

AI 仅为当前 File 构建一场的投影，切场撤销旧 review 并清空旧结果；投影与流的 generation 隔离迟到结果。Shots 使用同一个 target/picker，不持有另一份 batch selection。
