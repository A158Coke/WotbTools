# Issue #827 逐例处置台账（终稿骨架，2026-11-11）

由 source-text-inventory.json 生成；处置列来源：CSS 组与 scene 簇逐例映射（见下方处置标注），探针编号待 probe-matrix 完成后回填。

处置图例: R=改写为行为测试, K=保留(真实守卫), D=删除(已有接替者), PK=shader 公式逐字/CSS 提请用户复核

## frontend/src/api/replay-capabilities.test.ts（text=1/3）

读取源: (dynamic), src/api/replay-capabilities.ts, src/components/BattlePlaybackPanel.vue, src/api/ai-review.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | no longer fetches server-side replay artifacts (server has no parser) | source,source,panel | toMatch |  |  |  |

## frontend/src/app/navigation-context.test.ts（text=1/1）

读取源: (dynamic)

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | does not restore removed magic-string service locators in production s | text | newRegExp |  |  |  |

## frontend/src/app/navigationPressedFeedback.test.js（text=1/5）

读取源: ./AppTopBar.vue, ./AppSidebar.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | pressed rules come after the hover rules so pressing overrides hover c | sidebar | indexOf |  |  |  |

## frontend/src/components/AgentArmorView.dom-contract.test.js（text=22/64）

读取源: ../scene/viewer/armorPlateModel.ts, ./AgentArmorView.vue, ./ArmorShotHud.vue, ./AgentArmorView.vue, ./AgentArmorView.vue, ./AgentArmorView.vue, ../scene/viewer/shotResultCard.ts, ../scene/penetration.js, ../scene/armorCollisionPack.ts, ../scene/armorCollisionPack.ts, ./TankCatalogMenu.vue, ./AgentArmorView.vue, ./ArmorShotHud.vue, ../scene/viewer/armorShaders.ts, ./AgentArmorView.vue, ./AgentArmorView.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 点选结果只显示装甲名称与基础装甲值，停靠在场景顶部正中；右上角合并为一块整体面板 | template,shotHud,view,view,view,card,pen | toMatch+indexOf+slice |  |  |  |
| 2 | 模块替换材质沿用客户端材质的双面口径 | plateModel | toMatch |  |  |  |
| 3 | 单车装甲检视与 shot replay 共用 Armor Inspector 实测标定 | view,view,view,view | toMatch |  |  |  |
| 4 | 热力图用 flat vNormal 面法线 + highp 视线方向（移动端 mediump 回归） | plateModel | toMatch |  |  |  |
| 5 | rcContinue 双实现：每个非外部层独立转正（BlitzKit） | packSrc,packSrc | toMatch |  |  |  |
| 6 | 点击链：每个非外部层独立转正（BlitzKit） | pen | toMatch |  |  |  |
| 7 | 判定输入缺数据时 fail-closed：无 120mm 静默默认、未知弹种不落到 HE | plateModel | toMatch |  |  |  |
| 8 | 非跳弹的 0mm 板不显示“跳弹 (-25% 穿深)”子标签 | view,view,view,menu,view | toMatch+indexOf+slice |  |  |  |
| 9 | 卡片盒是固定 8:5 比例、无固定高度尺寸 | menu | toMatch |  |  |  |
| 10 | 共享菜单以同一比例常数应用内容框变换，并驱动迟到表补样式 | menu | toMatch |  |  |  |
| 11 | 原生回退控件把选择写回 URL，避免 HUD 与场景各用一套状态 | view,view,view,view | toMatch |  |  |  |
| 12 | 空 scfg 视同缺省，射击方配置不再回落受击方 config | view,view,view,view | toMatch |  |  |  |
| 13 | 射击方配置独立：不回落受击方 config，双方同车型也不共享主炮配置 | view,view,view,view | toMatch |  |  |  |
| 14 | HUD 只加载 devices 轻目录，不拉整份配置器目录 | hud | toMatch |  |  |  |
| 15 | 射击复现换装备/换配置沿权威 launch/lvDir 重跑 | view,view,view,view,hud | toMatch |  |  |  |
| 16 | 目标配置切换清空旧结果并使在途判定失效 | view,view,view,view,hud | toMatch |  |  |  |
| 17 | 只重建场景时保留已挂载子组件的 readiness | view,view,view,view | toMatch |  |  |  |
| 18 | 只换射手发动机/履带不凭空建立 scfg；换炮才写 scfg | view,view,view,view | toMatch |  |  |  |
| 19 | HUD 就绪即独占被替换的装备控件；配置变更按解析后的选择判断 | view,view,view,view,hud | toMatch |  |  |  |
| 20 | 间隙甲材质/状态材质/深度占位的既有渲染状态 | plateModel,shaders | toMatch |  |  |  |
| 21 | onPickerKeydown 在 #tank-picker 之外的 dialog 内直接放行 | template,template,template | indexOf+slice |  |  |  |
| 22 | 勾选框回放判定 tooltip 不得硬编码：走 L.replayEquipmentAutoTitle | template,template,template | indexOf+slice |  |  |  |

## frontend/src/components/AgentTankopedia.baseline.test.js（text=1/1）

读取源: ./AgentTankopedia.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 加载/换车过渡清空上一辆车的 delta 基线 | source | toMatch |  |  |  |

## frontend/src/components/AppSheet.test.ts（text=1/7）

读取源: src/components/AppSheet.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 退场动画源码契约：closed 态各方向有从实时位移变量起手的退场 keyframes，reduced-motion 下不做动画等待 | source | indexOf+slice |  |  |  |

## frontend/src/components/BattlePlaybackHud.test.js（text=3/14）

读取源: src/components/BattlePlaybackHud.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | compact reserves HP track width and lets only the map name yield | hudSource | toMatch+indexOf+slice |  |  |  |
| 2 | 无标签文字：HP 数字居中在血条上方，比分只留数字（2026-10-05 需求） | hudSource | toMatch |  |  |  |
| 3 | stacks the points label above the score | hudSource | indexOf+slice |  |  |  |

## frontend/src/components/MapPreview3DPane.wiring.test.js（text=8/8）

读取源: ./MapPreview3DPane.vue, ../scene/playbackScene.js, ../scene/playback/sessionLifecycle.ts, ../scene/playback/cameraRuntime.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 面板只经 loadMapOnly 装载，不出现 loadData 回放路径 | paneSrc | toMatch |  |  |  |
| 2 | 画质与相机走 SegmentedControl，与 Replay3DPane 同一控件（DC-SEL-08） | paneSrc | toMatch |  |  |  |
| 3 | 换图判定只看 mapId：locale 化的 mapName 变化不得清空标注（回归锁） | paneSrc | toMatch |  |  |  |
| 4 | destroyScene（GPU teardown/离线销毁）不触碰标注会话（回归锁） | paneSrc | indexOf+slice |  |  |  |
| 5 | 基地点位：唯一推送方向 pane→scene（setMapBasesKind），三触发点齐全 | paneSrc | indexOf+slice |  |  |  |
| 6 | 出生点：唯一推送方向 pane→scene（setMapSpawns），三触发点齐全（#835） | paneSrc | indexOf+slice |  |  |  |
| 7 | UI Profile 切换：pane watch uiProfile → 内核 refreshSpawnColors 原位重着色（#877  | paneSrc,kernelSrc,sessionSrc,cameraSrc | toMatch+indexOf |  |  |  |
| 8 | 内核 map 会话：stub DATA + 就绪门控 mapReady（hasData 保持回放专用） | kernelSrc,sessionSrc,cameraSrc | indexOf |  |  |  |

## frontend/src/components/PlaybackRoster.test.js（text=2/16）

读取源: src/components/PlaybackRoster.vue, src/components/PlaybackRoster.vue, src/components/PlaybackRoster.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | HP 条源码回归：行尾 52 宽，数值写在条内，无弹夹分段节点 | source,source,source | newRegExp |  |  |  |
| 2 | dense：固定 30px 轨道、不纵向铺满、两行信息、44×20 窄血条、隐藏枪章 | source,source,source | newRegExp |  |  |  |

## frontend/src/components/PlayerRatingRadar.test.js（text=1/13）

读取源: src/components/PlayerRatingRadar.vue, src/styles/tokens.css

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 100 strong grid is visible at 2/3 radius while no 150 outer boundary i | comp,tokens | includes |  |  |  |

## frontend/src/components/ProfilePage.test.js（text=1/52）

读取源: src/components/ProfilePage.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | P1 守卫：每个 finally 里的 pending 清理都做身份归属检查（源码级不变量） | source | indexOf+slice+newRegExp |  |  |  |

## frontend/src/components/Replay3DPane.test.js（text=1/85）

读取源: Replay3DPane.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 队面板不得是独立滚动容器（常规名册必须一屏看全） | src | toMatch |  |  |  |

## frontend/src/components/ReplayWorkspace.test.js（text=2/61）

读取源: (dynamic)

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | requires confirmed replacement and does not overwrite a selection chan | demoBytes | slice |  |  |  |
| 2 | guide cancellation aborts the pending sample before selecting or analy | demoBytes | slice |  |  |  |

## frontend/src/components/TankConfigPanel.layout.test.js（text=2/4）

读取源: ./TankConfigPanel.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 手机按类型分组，不再按选项序号拼 2 列矩阵 | source | toMatch |  |  |  |
| 2 | 手机装备矩阵按 9 对候选分组：横纵组间均为 12px、组内 2px | source | toMatch+indexOf+slice |  |  |  |

## frontend/src/components/TankResearchPanel.layout.test.js（text=1/2）

读取源: ./TankResearchPanel.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 窄屏覆盖 has-side，前驱车与研发图纵向堆叠 | source | toMatch |  |  |  |

## frontend/src/data-version-wiring.test.js（text=2/4）

读取源: (dynamic), (dynamic), ../src/app/AppSidebar.vue, ../src/app/SidebarDataVersion.vue, ../src/components/DataVersionSelect.vue, ../src/components/MorePage.vue, ../src/scene/assetBase.ts, ../src/data/map2dOverlay.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | all runtime asset origins go through assetBase / assetProvider | code,assetBase | includes+slice |  |  |  |
| 2 | the sidebar places the selector directly below the brand; mobile More  | sidebar,sidebarSelector,settingSelector, | indexOf |  |  |  |

## frontend/src/index-firstpaint.test.js（text=1/5）

读取源: (dynamic)

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 静态默认与首屏 loader 底色覆盖四套主题；只有 wotb-ui-profile 一个 key | html | toMatch |  |  |  |

## frontend/src/scene/armorCollisionPack.test.js（text=1/54）

读取源: ./armorCollisionPack.ts, ./tankViewer.js

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | JS 参考入口与 click 路径使用同一初始接受阈（源码级锁，防回归到 +eps 口径） | src,viewer | toMatch |  |  |  |

## frontend/src/scene/groundPass.test.js（text=5/28）

读取源: groundPass.js, playbackScene.js, playback/mapAssets.ts, playback/mapWorld.ts, bake-ground-overhead.mjs, bake-ground-layers.js

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 地形数据来自 pack 的 terrain.json + 配对 bin；有效跨度取自愈后的 span | bakeSrc | toMatch |  |  |  |
| 2 | 水语义件保留渲染（keepWater）；"≥90% 图幅壳"几何剔除已删（运行时渲染件不得被剔） | bakeSrc | toMatch |  |  |  |
| 3 | 材质装配先于 qFrame 挂载（两侧同序；PR #621 review P2：水下判定按 GLB z-up 世界包围盒） | mapAssetsSrc,bakeSrc | indexOf |  |  |  |
| 4 | meta 携带 ground 标志与有效跨度（合成器据 ground 以"覆盖即替换"口径合并） | bakeSrc | toMatch |  |  |  |
| 5 | 逐图资源生命周期：地面网格/分层贴图/海岸线纹理随换图释放 | bakeSrc | toMatch |  |  |  |

## frontend/src/scene/heHeatmapProjection.test.js（text=1/11）

读取源: ./viewer/shotTrajectoryGeometry.ts, ./viewer/shotResultCard.ts, ./heSplash.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 击穿视图 HE 白色遮罩 = 点击卡片的「击穿」判定（首层主装 + 100%），渐变两视图都保留 | card | indexOf |  |  |  |

## frontend/src/scene/heSplash.test.js（text=1/14）

读取源: ./heSplash.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 热力图方向子集仍走同一网格 DDA；没有网格同样 fail-closed | splashSource | slice |  |  |  |

## frontend/src/scene/labelOcclusion.test.js（text=7/7）

读取源: playbackScene.js, playback/labelsRuntime.ts, ../components/PlaybackVehicleLabels3D.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 车辆标签材质不再固定半透明：遮挡标记由场景发布、强度由覆盖层消费 | src,labelsSrc | toMatch |  |  |  |
| 2 | **永不隐藏**：被挡下限严格大于 0（弱化而非消失），且只有一份事实源 | labelsSrc,overlay | toMatch+indexOf+slice |  |  |  |
| 3 | 按 camera → 标签锚点做视线检测：地形用高度场步进、场景用 raycast | labelsSrc | toMatch |  |  |  |
| 4 | 只把地形与静态场景当 blocker（不把其他车辆算遮挡） | labelsSrc | toMatch+indexOf+slice |  |  |  |
| 5 | 成本受控：每 occlStride 帧只检测一辆车，并按实测耗时自适应拉长步长 | labelsSrc | toMatch |  |  |  |
| 6 | updateLabels 每帧推进遮挡，并把结果作为 anchor 的 occluded 发布出去 | labelsSrc | toMatch+indexOf+slice |  |  |  |
| 7 | raycast 的 far 在调用后被恢复（不污染其他射线使用点，如点选跟随） | labelsSrc | toMatch |  |  |  |

## frontend/src/scene/pickDebug.test.js（text=6/21）

读取源: playbackScene.js, playback/pickReport.ts, playback/mapAssets.ts, playback/cameraRuntime.ts, playback/mapWorld.ts, playback/pickReport.ts, playback/pickReport.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | onScenePointerDown 无条件记录 pickDownAt（含车辆命中路径） | cameraSrc | toMatch+indexOf+slice |  |  |  |
| 2 | onScenePointerUp 先处理调试拾取再走选中语义 | cameraSrc | toMatch+indexOf+slice |  |  |  |
| 3 | 拾取实例：meshOwner 精确归属优先，距离仅兜底 | pickSrc | toMatch+indexOf+slice |  |  |  |
| 4 | teardownSession 释放 meshOwner/destructPickList/destruct（评审回归：reset 后仍持有 | sceneSrc,mapWorldSrc | toMatch+indexOf+slice |  |  |  |
| 5 | destructibles await 之后先核会话（stale）再发布清单；stale 不自行摘除宿主资源 | mapAssetsSrc | toMatch+indexOf+slice |  |  |  |
| 6 | terrain / render 诊断变量在 buildPickReport 函数作用域共声明（return 可达） | src,src | toMatch |  |  |  |

## frontend/src/scene/playbackScene.occlusion.test.js（text=18/27）

读取源: playbackScene.js, playback/labelsRuntime.ts, playback/mapAssets.ts, playback/mapWorld.ts, playback/battleRuntime.ts, playbackScene.js, playback/mapAssets.ts, playback/mapWorld.ts, playback/perfProbe.ts, playbackScene.js, playback/cameraRuntime.ts, playback/vehicleRuntime.ts, playback/armorHighlight.ts, sceneryInstancing.ts, playback/mapAssets.ts, playback/armorHighlight.ts, viewer/armorShaders.ts, playback/armorHighlight.ts, playback/armorHighlight.ts, playback/armorHighlight.ts, playback/armorHighlight.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 源码护栏：不再对 mapScenery 全量 intersectObject，改用候选列表 intersectObjects | src,labelsSrc,mapAssetsSrc,mapWorldSrc,s | toMatch |  |  |  |
| 2 | 折线点表必须镜像 x（游戏系 → 场景系）——镜像丢失 = 轨迹画到地图对侧 | battleSrc | toMatch |  |  |  |
| 3 | 开火 / 命中特效的炮口、来弹与跳弹出射方向都取自镜像后的点表（折线改造曾漏字段 → 整帧抛异常） | battleSrc | toMatch |  |  |  |
| 4 | occGrid 登记必须用足印全枚举，不得用线段遍历 | src,mapAssetsSrc,src,mapAssetsSrc | toMatch |  |  |  |
| 5 | 时间轴回退必须显式清树终态 settled（否则重播不重写触地旋转） | mapWorldSrc,mapWorldSrc | toMatch |  |  |  |
| 6 | 叠加 pass 排在主渲染之后，只有录像者开镜且过渡结束才运行 | source,cameraSrc | indexOf |  |  |  |
| 7 | 选目标与准星同源（Type39 瞄准点），不取相机正前方 | cameraSrc | indexOf+slice |  |  |  |
| 8 | 悬挂改写履带顶点后只打标记，不在主路径重算或置空 bounds | vehicleSrc | toMatch+indexOf+slice |  |  |  |
| 9 | 配置解析不走带回退的 resolveMountedConfig | cameraSrc | toMatch+indexOf+slice |  |  |  |
| 10 | SNIPER→ARCADE 转换释放 RT（不只退出录像者模式） | cameraSrc | toMatch+indexOf+slice |  |  |  |
| 11 | 关闭开关与退出录像者模式仍释放 RT | source,cameraSrc | indexOf+slice |  |  |  |
| 12 | 遮挡剔除优先批次 AABB；可破坏物批次回退球 | hl,inst,mapAssets,hl,hl,hl,hl,hl | toMatch |  |  |  |
| 13 | 装甲 RT 按目标矩形分配：视口偏移相机 + spacedRect 采样映射（full → rect 局部） | hl,hl,shaders,hl,hl,hl,hl | toMatch |  |  |  |
| 14 | ?perf 逐 pass 计时与装甲预热接线 | source,cameraSrc,hl,hl,hl,hl,hl,hl | toMatch |  |  |  |
| 15 | 遮挡 pass 用语义化遮挡根，不再全场景 traverseVisible（issue #850 F） | cameraSrc,hl,hl,hl,hl,hl,hl | toMatch+indexOf+slice |  |  |  |
| 16 | SNIPER 进入时补预取敌方 armor 模板（tankData 晚到缺口） | cameraSrc | toMatch+indexOf+slice |  |  |  |
| 17 | 零遮挡快速路径：走廊内无遮挡物时跳过世界深度重绘 | hl,hl,hl,hl,hl,hl | toMatch |  |  |  |
| 18 | RT 收缩滞回：需求持续减半才重建，防近距全尺寸 RT 挂满会话 | hl,hl,hl,hl,hl,hl | toMatch |  |  |  |

## frontend/src/scene/playbackScene.staticFreeze.test.js（text=7/8）

读取源: playbackScene.js, playback/mapAssets.ts, playback/vehicleRuntime.ts, sceneryMaterials.ts, playback/mapWorld.ts, playback/mapWorld.ts, playback/renderer.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 场景加载定型后 bake 世界矩阵并关全树 matrixAutoUpdate（含 mapScenery 根组） | mapAssetsSrc | toMatch |  |  |  |
| 2 | poseGlb 不再逐车强制全树 updateMatrixWorld（renderer 场景遍历已从根强制传播） | vehicleSrc | toMatch+indexOf+slice |  |  |  |
| 3 | 合批后原节点必须摘除渲染图（漏摘 = 优化失效：原 Mesh 照常画一遍） | mapAssetsSrc | toMatch+indexOf+slice |  |  |  |
| 4 | D_ 损毁态实例必须初始隐藏（writeHiddenInstance），且隐藏实例不进遮挡候选 | mapAssetsSrc | toMatch+indexOf+slice |  |  |  |
| 5 | 树倒走逐实例矩阵（fallMatrix）且与 settled 自校验的 fallQuat 同步维护 | worldSrc,worldSrc | toMatch+indexOf+slice |  |  |  |
| 6 | 实例矩阵上传按帧合并（dirty 集合 → needsUpdate），不许逐树逐帧全量上传 | worldSrc,worldSrc | toMatch+indexOf+slice |  |  |  |
| 7 | 装配有空间判定（DPR 无下调空间则跳过）、只喂实际渲染帧、调整即重设尺寸 | src,rendererSrc | toMatch |  |  |  |

## frontend/src/scene/rosterState.test.js（text=2/23）

读取源: playbackScene.js, playback/hudFeed.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 名册 HP 由 projectRoster 投影，死亡判据复用场景 resolver | feedSrc | toMatch+indexOf+slice |  |  |  |
| 2 | teardown 清空名册与 eid → 行 索引（会话切换不留旧行） | feedSrc | toMatch |  |  |  |

## frontend/src/scene/sceneryMaterials.test.js（text=48/74）

读取源: playbackScene.js, playback/util.ts, playback/boundary.ts, playback/transientFeedback3d.ts, playback/renderer.ts, playback/mapAssets.ts, playback/bases.ts, playback/glbParts.ts, sceneryMaterials.ts, mapLighting.ts, sceneryAssembly.ts, groundPass.js, bake-ground-overhead.mjs, replaySource.ts, sceneryInstancing.ts, ../../scripts/bake-ground-overhead.mjs, replaySource.ts, terrainMesh.js, sceneryMaterials.ts, terrainMesh.js, bake-ground-overhead.mjs, bake-ground-overhead.mjs, bake-ground-overhead.mjs, playback/renderer.ts, playback/hudFeed.ts, ../replay-local/pose/vehiclePose.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 材质实例按 key 去重：convMat 经 cachedSceneryMat，键含 alphaTest/transparent | src,mapAssetsSrc,asmSrc | toMatch+indexOf+slice |  |  |  |
| 2 | disposeObject3D 经 collectMaterialTextures 回收纹理（含 ShaderMaterial unifor | src | toMatch+indexOf+slice |  |  |  |
| 3 | 材质缓存随会话释放（勿复用已 dispose 实例） | src | toMatch+indexOf+slice |  |  |  |
| 4 | 叶卡走不透明管线：transparent=false + uAlphaCut discard（消除互遮挡闪烁） | matSrc | toMatch+indexOf+slice |  |  |  |
| 5 | 叶卡材质取自身 occMean 与 SH 染色（不硬编码 1.77、不读 extras） | matSrc | toMatch+indexOf+slice |  |  |  |
| 6 | 伪透明转不透明 + 裁切，真透明不写深度 | src,asmSrc | toMatch |  |  |  |
| 7 | 真混合层（extras.blendLayer）保留软 alpha：不被伪透明分流削成硬边卡片 | src,mapAssetsSrc,matSrc,asmSrc,bakeSrcBl | toMatch+indexOf+slice |  |  |  |
| 8 | 动画混合层：双采样器（albedo 走 UV0+位移 / 掩码走 UV1）+ 回放时钟驱动 | src,mapAssetsSrc,matSrc,asmSrc | toMatch+indexOf+slice |  |  |  |
| 9 | 环境反射（ENVIRONMENT_MAPPING）：遮罩×菲涅尔×天空立方图，含高光项 | matSrc,mlSrc | toMatch+indexOf+slice |  |  |  |
| 10 | 逐图 IBL：等距柱状环境贴图 + 倍率 + 时序守卫 + 会话释放 | src,rendererSrc,basesSrc,matSrc,mlSrc,as | toMatch+indexOf+slice |  |  |  |
| 11 | 烘焙光照图：albedo × lightmap(UV1×逐实例变换) × 2、不受光、镂空保留 | src,rendererSrc,basesSrc,matSrc,mlSrc,as | toMatch+indexOf+slice |  |  |  |
| 12 | 细节层（B1）：uv0×scale 采样 ×2 乘入，位置在环境反射之后；两条路径都接线 | src,rendererSrc,basesSrc,matSrc,mlSrc,as | toMatch+indexOf+slice |  |  |  |
| 13 | 逐图太阳：lighting.json 驱动方向/色/强度与半球环境色，缺失回落兜底 | src,rendererSrc,mlSrc,rs,rs,rendererSrc | toMatch |  |  |  |
| 14 | ST/ 静态几何走伽马直通 ShaderMaterial（与叶卡同方程，防同树双色） | matSrc,asmSrc | toMatch+indexOf+slice |  |  |  |
| 15 | 坦克环境光隔离：清零 three 的环境/半球 irradiance、保留 IBL 与直接光 | matSrc | toMatch+indexOf+slice |  |  |  |
| 16 | 出屏口径（A2）：线性 × 曝光 1.0 → sRGB 编码 = 客户端口径；不引入调参旋钮 | src,rendererSrc,rendererSrc | toMatch |  |  |  |
| 17 | 内联着色器的 varying 必须在**该段**声明（地面着色器是内联字符串，漏声明=整材质不画） | src,gpSrc | toMatch+indexOf+slice |  |  |  |
| 18 | 采样空间（C3）：自定义材质一律原样采样；SRGB 解码只许出现在显示内容链 | src,basesSrc,matSrc | toMatch |  |  |  |
| 19 | 地面弹着痕迹（D2）已撤除：客户端贴图不在可得数据面 ⇒ 不留程序化替代 | src | toMatch |  |  |  |
| 20 | 地形网格客户端同构（texel 原位取原值）——错位会让地形穿出挡土墙/桥台 | src | toMatch |  |  |  |
| 21 | 共面接缝不做人工补偿（客户端无深度偏移、数据同样共面；2026-10-10 撤掉 ?poff 与 ?seamfix） | src | toMatch |  |  |  |
| 22 | 禁止按逐网格三角形/顶点比删几何（统计启发式；损坏应由导出器语义标记/报错） | src | toMatch |  |  |  |
| 23 | 水面"海岸线"coastLine：按客户端 water-fp.sl 的相对深度差口径淡出反射（距离无关、随相机高低自适应） | asmSrc | toMatch |  |  |  |
| 24 | 地面分层混合 uniform 类型对齐：uHbSoft 必须 vec4（曾误写 float ⇒ 值 NaN ⇒ 地面取错层色） | rendererSrc,mapAssetsSrc,matSrc,mlSrc,gp | toMatch |  |  |  |
| 25 | 逐图光照亮度归一：保留方向/色相，曝光 = 基准太阳强度 / 该图太阳强度（模拟客户端自动曝光） | rendererSrc,mlSrc,rendererSrc | toMatch |  |  |  |
| 26 | 水体：透明面写深度 + 双面 + 不设 renderOrder | mapAssetsSrc,matSrc | toMatch |  |  |  |
| 27 | 对数深度缓冲：默认开启 + ?logdepth=0 逃生开关 + 两自定义 ShaderMaterial 挂 logdepthbuf 块 | src,rendererSrc,matSrc,gpSrc,rendererSrc | toMatch+indexOf+slice |  |  |  |
| 28 | 场景 Lambert 曝光修整只作用于 convMat 建出的材质 | matSrc,asmSrc | toMatch |  |  |  |
| 29 | 场景 GLB 贴图各向异性随画质档（此前场景侧漏设=默认 1，掠射角发糊闪烁） | mapAssetsSrc,matSrc | toMatch+indexOf+slice |  |  |  |
| 30 | 场景材质用几何 authored 法线（不设 flatShading——旧行为把它整条丢掉） | src,bake,bakeSrcNormals | toMatch |  |  |  |
| 31 | 俯视烘焙页消费同一装配 SSOT：convMat/键指纹/分派只有一处实现（两侧无本地副本） | src,mapAssetsSrc,asmSrc,bake,bakeSrc | toMatch+indexOf |  |  |  |
| 32 | 底盘（chassis_track_*/chassis_wheel_*）与车体子树分离，挂点恒归单位；命名不符则回落整台刚体 | glbPartsSrc | toMatch |  |  |  |
| 33 | 每帧在 poseGlb 里解算；seek 跳变吸附；不可见时侧位移积分复位 | src | toMatch+indexOf+includes+slice |  |  |  |
| 34 | 推进走 advancePlaybackTime（NaN/负增量不污染时钟），终点钳制仍生效 | src | toMatch |  |  |  |
| 35 | onResize 单画布取整尺寸 + 置脏重绘（防 1px 错位与脏帧停住） | src | toMatch+indexOf+slice |  |  |  |
| 36 | 覆盖层并入主画布：不再有第二个 WebGL 上下文，也没有第二次 render | src,rendererSrc,rendererSrc | toMatch+indexOf+slice |  |  |  |
| 37 | 特效走对象池：到期归池而非 dispose，池只在会话结束时整体释放 | src | toMatch+indexOf+slice |  |  |  |
| 38 | HUD 降频：store.time/seekFrac 不再每帧写，seek 时强制补一次 | src | toMatch+indexOf+slice |  |  |  |
| 39 | 比分/点数走增量而非每 tick 全量扫描 | transientSrc,feedSrc | toMatch |  |  |  |
| 40 | 资产加载走有限并发（地表贴图 / 坦克 GLB 都受上限约束） | pbUtilSrc | toMatch |  |  |  |
| 41 | GLB 位姿零分配：poseFromYPR 支持 out 参数，poseGlb 用模块级 scratch | bake | toMatch+indexOf+slice |  |  |  |
| 42 | 按需渲染：脏帧判定覆盖播放/相机/特效/幽灵闪，跳帧时不跑更新与 render | src | toMatch+indexOf+slice |  |  |  |
| 43 | 侧倾取值走共享位姿采样器：旧产物缺列时落 0（不拿 pitch 顶替） | src,poseSrc | toMatch |  |  |  |
| 44 | 横滚与偏航符号同号、俯仰不受影响（镜像约定的可判据部分） | src | toMatch |  |  |  |
| 45 | 标记/反馈层材质字面色直出（toneMapped:false）——逐图曝光不得压深 UI 语义色 | bandSrc,basesSrc | toMatch |  |  |  |
| 46 | 纹理依赖 await 之后、共享状态写入之前复查会话失效 | mapAssetsSrc,asmSrc | toMatch |  |  |  |
| 47 | 履带 UV 回退分支引用有效变量（v0tankId 未定义会抛 ReferenceError，半初始化装配） | asmSrc | toMatch+indexOf+slice |  |  |  |
| 48 | 光照图材质按输入指纹缓存共享（逐 mesh 新建会把 (几何,材质) 合批拆成单实例批） | asmSrc | toMatch+indexOf+slice |  |  |  |

## frontend/src/scene/seekPointer.test.js（text=5/10）

读取源: playbackScene.js, playback/transientFeedback3d.ts, playback/battleRuntime.ts, playback/boundary.ts, playback/mapWorld.ts, playbackScene.js, playback/cameraTerrainClamp.ts, playback/cameraRuntime.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 三个游标（射击/伤害/击毁）都重定到 seek 时刻之后 | transientSrc,battleSrc | toMatch |  |  |  |
| 2 | clearEffects 会清空 transient 状态与游标（seek 不补播的另一半） | transientSrc,battleSrc | toMatch |  |  |  |
| 3 | 调用点一律传权威 playableBoundsFor()，不再有车辆/地形范围兜底 | mapWorldSrc | toMatch |  |  |  |
| 4 | 设置 controls.minDistance / maxDistance 且基于 ext | src,src,clampSrc,cameraSrc | toMatch |  |  |  |
| 5 | 基准距离只有模块一处分份状态，场景侧经 accessor 读取 | src,src,cameraSrc | toMatch |  |  |  |

## frontend/src/scene/supremacyPoints.test.js（text=3/10）

读取源: playbackScene.js, playback/bases.ts, playbackScene.js, playback/bases.ts, playback/battleRuntime.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | teardown 显式归零 HUD 派生字段（切换会话不留残值） | src,basesSrc,src,basesSrc | toMatch+indexOf+slice |  |  |  |
| 2 | 中立与阵营未知收敛到 white（不再用灰） | src,basesSrc,src,basesSrc | toMatch |  |  |  |
| 3 | 炮线用亮色板且与车辆 tint 分离：tint 不得改亮、炮线必须更亮 | src,src,battleSrc | toMatch+newRegExp |  |  |  |

## frontend/src/scene/treadMarks.test.js（text=6/42）

读取源: playbackScene.js, treadBufferWriter.ts, treadRuntime.ts

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | tick() 必须驱动游标泵 updateTrails()（否则印记只在 seek 时出现） | sceneSrc | toMatch |  |  |  |
| 2 | 客户端槽位模型接线：50 槽含活戳（write 槽）+ 全窗口显式隐藏（0x727b80 同构） | writerSrc,treadSrc | toMatch |  |  |  |
| 3 | 淡出窗 = 客户端引擎常数（TREAD_FADE.start/end；老化逐槽独立、无有序假设） | writerSrc,treadSrc | toMatch |  |  |  |
| 4 | 关断重开必须复位两侧路径态（不只回退 builtT；review P2 2026-10-11） | sceneSrc,writerSrc,treadSrc | toMatch+indexOf |  |  |  |
| 5 | alpha 比较必须走 Math.fround 量化门控（review P3 2026-10-11：double 严格比较恒为脏） | writerSrc,treadSrc | toMatch |  |  |  |
| 6 | teardown 必须释放逐车 treadMesh 几何/材质与会话级贴图缓存（显存生命周期同会话） | sceneSrc,treadSrc | toMatch+indexOf |  |  |  |

## frontend/src/shared/tabular/csv/encode.test.ts（text=1/7）

读取源: (dynamic)

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | adds only an optional leading UTF-8 BOM | fixture | slice |  |  |  |

## frontend/src/styles/agent-theme-css.test.js（text=4/7）

读取源: (dynamic), AgentArmorView.vue, TankCatalogMenu.vue, tankViewer.js

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | ${label} 不引用未定义 token | src,src,src | indexOf+slice |  |  |  |
| 2 | 每个本地别名引用已定义的全局 token，且不含裸色或独立浅色覆盖 | src,src,src | toMatch |  |  |  |
| 3 | ${label} 的规则只经 token 取色 | css | includes |  |  |  |
| 4 | 收藏车边框规则带 `:not(.is-premium)`——premium > collector 由选择器确定 | css | toMatch |  |  |  |

## frontend/src/styles/corner-shape.test.js（text=1/2）

读取源: (dynamic), scale.css

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | squircle 只在 @supports 里启用，且 scale.css 保留全局规则 | css,css | toMatch |  |  |  |

## frontend/src/styles/glass-accessibility.test.js（text=1/6）

读取源: ./app-shell.css

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | contrast 块排在 reduce 块之后：叠加偏好时边界与表面由更强规则给出 | css | indexOf |  |  |  |

## frontend/src/styles/hof-admin-tabs-css.test.js（text=2/2）

读取源: (dynamic), ../components/HoFAdminPage.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | 全局样式表不定义 Tab 条 / 筛选 / 管理表格规则 | css | toMatch |  |  |  |
| 2 | 组件自身定义吸顶 Tab 条：偏移读顶栏高度 token，层级用 token，窄屏可横向滚动 | source | toMatch+indexOf+slice |  |  |  |

## frontend/src/styles/light-theme-source-regression.test.js（text=3/6）

读取源: ./app-shell.css, ../components/AdminUsersPage.vue, ../components/admin-list.css, ../components/ProfilePage.vue, ../components/MarkdownContent.vue, ../components/PlayerDetailDrawer.vue, ../components/ReplayCapabilityTabs.vue, ../components/SegmentedControl.vue, ../components/BattlePlaybackPanel.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | AdminUsersPage 搜索/表格/按钮 不得再写死深色面 | admin,adminList | toMatch |  |  |  |
| 2 | PlayerDetailDrawer 导出评分卡 不得再写死深色面 | drawer | toMatch |  |  |  |
| 3 | ReplayCapabilityTabs / BattlePlaybackPanel 面板 不得再写死深色面 | capabilityTabs,segmented,bpPanel | toMatch |  |  |  |

## frontend/src/styles/tokens/color-contrast.test.ts（text=1/4）

读取源: color.css, ../../components/BattleDataAdminPage.vue

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | BattleDataAdminPage 出生侧分段条 CSS 映射：first=danger、draw=border-strong、seco | component | toMatch+newRegExp |  |  |  |

## frontend/src/vehicle-models/extractor.test.js（text=6/92）

读取源: (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic)

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | Maus 资产：hide_elements 纳入后 turretBounds 保持（hide 在炮塔内，不改变轮廓；mantlet 独立） | meta,hull,meta,meta,meta,meta,meta,meta, | slice |  |  |  |
| 2 | metadata.generation.method = blitzkit-model-topdown-texture-bake（正式契约） | meta,meta,meta,meta,meta,meta,meta,meta | toMatch |  |  |  |
| 3 | 正式资产：hull.webp 为 WebP 二进制（texture-bake 契约，非 SVG） | hull,buf,buf,buf,buf | slice |  |  |  |
| 4 | turreted 正式资产：turret.webp 存在（turret + mantlet + gun 刚性层） | buf,buf,buf,buf | slice |  |  |  |
| 5 | 正式资产 hull.webp / turret.webp 为 WebP 二进制（texture-bake 契约取代 SVG） | hull,buf,buf,buf,buf | slice |  |  |  |
| 6 | 正式资产契约：WebP 二进制 / 320 logical + 640 physical / 无 base64 内嵌 | hull,buf,buf,buf,buf | includes+slice |  |  |  |

## frontend/src/vehicle-models/texture-bake.test.js（text=1/23）

读取源: (dynamic), (dynamic), ./assets/grille-15/bake-report.json, ./assets/grille-15/metadata.json, ../../scripts/texture-bake-lib.mjs, (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic), (dynamic)

| # | 用例名 | 引用 | 形态 | 处置 | 接替者/理由 | 探针 |
|---|---|---|---|---|---|---|
| 1 | texture-bake-lib 纯函数库不含网络调用 | meta,meta,src,meta,meta | toMatch |  |  |  |

