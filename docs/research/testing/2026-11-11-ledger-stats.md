# Issue #827 台账统计与 D 项门禁（F1/F2 交付，2026-11-11）

统计单位统一为 **test case**（u=case 的台账行）；clause 行附着到所属 case，不单独计数。稳定 ID = `<文件slug>:<case起始行>`。台账行与 classifier text case 的出入列入「对齐异常」，人工复核后以台账为准。`validation_status` 初始 PENDING：删除批次实际执行 + 接替测试本地/CI 绿 + 故障注入抽查通过后才置 DONE。

## 统计（case 单位）

| 文件 | inventory text cases | R | K | D | PK | clause 行 |
|---|---|---|---|---|---|---|
| frontend/src/scene/sceneryMaterials.test.js | 48 | 48 | 8 | 5 | 0 | 13 |
| frontend/src/scene/groundPass.test.js | 5 | 2 | 8 | 7 | 0 | 1 |
| frontend/src/scene/playbackScene.occlusion.test.js | 18 | 17 | 0 | 7 | 0 | 3 |
| frontend/src/scene/playbackScene.staticFreeze.test.js | 7 | 7 | 0 | 0 | 1 | 0 |
| frontend/src/scene/labelOcclusion.test.js | 7 | 5 | 0 | 1 | 0 | 1 |
| frontend/src/scene/pickDebug.test.js | 6 | 6 | 0 | 1 | 0 | 0 |
| frontend/src/scene/seekPointer.test.js | 5 | 5 | 0 | 1 | 0 | 1 |
| frontend/src/scene/supremacyPoints.test.js | 3 | 4 | 1 | 1 | 0 | 0 |
| frontend/src/scene/rosterState.test.js | 2 | 2 | 0 | 2 | 0 | 0 |
| frontend/src/scene/treadMarks.test.js | 6 | 7 | 0 | 2 | 0 | 1 |
| frontend/src/scene/tankViewer.distance.test.js | 0 | 0 | 1 | 0 | 0 | 0 |
| frontend/src/scene/tankViewer.cameraPreset.test.js | 0 | 0 | 3 | 0 | 0 | 0 |
| frontend/src/scene/tankViewer.collisionBoxFailsafe.test.js | 0 | 4 | 0 | 0 | 0 | 0 |
| frontend/src/scene/armorCollisionPack.test.js | 1 | 1 | 0 | 0 | 1 | 0 |
| frontend/src/scene/heHeatmapProjection.test.js | 1 | 7 | 0 | 1 | 0 | 3 |
| frontend/src/scene/heSplash.test.js | 1 | 0 | 0 | 0 | 0 | 1 |
| frontend/src/scene/viewer/collisionView.test.js | 0 | 0 | 0 | 0 | 0 | 1 |
| frontend/src/components/MapPreview3DPane.wiring.test.js | 8 | 8 | 0 | 0 | 0 | 0 |
| frontend/src/components/BattlePlaybackHud.test.js | 3 | 0 | 0 | 0 | 2 | 1 |
| frontend/src/components/PlaybackRoster.test.js | 2 | 0 | 0 | 0 | 2 | 1 |
| frontend/src/components/TankConfigPanel.layout.test.js | 2 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/styles/agent-theme-css.test.js | 4 | 4 | 2 | 1 | 0 | 0 |
| frontend/src/styles/light-theme-source-regression.test.js | 3 | 3 | 3 | 0 | 0 | 0 |
| frontend/src/styles/glass-accessibility.test.js | 1 | 2 | 0 | 4 | 0 | 0 |
| frontend/src/styles/corner-shape.test.js | 1 | 2 | 0 | 0 | 0 | 0 |
| frontend/src/styles/hof-admin-tabs-css.test.js | 2 | 1 | 1 | 0 | 0 | 0 |
| frontend/src/styles/replay3d-hud-layout.test.js | 0 | 2 | 0 | 0 | 0 | 0 |
| frontend/src/styles/tokens/color-contrast.test.ts | 1 | 0 | 3 | 1 | 0 | 0 |
| **合计（已映射 28 文件）** | — | **137** | **30** | **34** | **7** | **27** |

## 台账未覆盖的 text 断言文件（scope 缺口，Wave 2/3 前需补映射）

- frontend/src/api/replay-capabilities.test.ts（1 例）
- frontend/src/app/navigation-context.test.ts（1 例）
- frontend/src/app/navigationPressedFeedback.test.js（1 例）
- frontend/src/components/AgentArmorView.dom-contract.test.js（22 例）
- frontend/src/components/AgentTankopedia.baseline.test.js（1 例）
- frontend/src/components/AppSheet.test.ts（1 例）
- frontend/src/components/PlayerRatingRadar.test.js（1 例）
- frontend/src/components/ProfilePage.test.js（1 例）
- frontend/src/components/Replay3DPane.test.js（1 例）
- frontend/src/components/ReplayWorkspace.test.js（2 例）
- frontend/src/components/TankResearchPanel.layout.test.js（1 例）
- frontend/src/data-version-wiring.test.js（2 例）
- frontend/src/index-firstpaint.test.js（1 例）
- frontend/src/shared/tabular/csv/encode.test.ts（1 例）
- frontend/src/vehicle-models/extractor.test.js（6 例）
- frontend/src/vehicle-models/texture-bake.test.js（1 例）

scope 缺口合计 44 例 / inventory 全量 181 例。

## D 项安全门禁（F2）

删除前置：① 接替者证据存在；② 接替测试实际执行（本地/CI）；③ 旧守卫独有失败模式抽查（故障注入）；④ validation_status 置 DONE。任何 BLOCKED 项不得删除。

| case ID | 优先级 | 接替者证据 | validation_status |
|---|---|---|---|
| sceneryMaterials:1229 | MED | 与 1222 同行为，删除重复 | PENDING |
| sceneryMaterials:1229 | MED | tracerSpanSecs 已是行为（删源码半句） | PENDING |
| sceneryMaterials:1263 | MED | disposeSceneGroup 已是行为 | PENDING |
| sceneryMaterials:1349 | LOW | 源码卫生守卫（行为并入 1007 改写） | PENDING |
| sceneryMaterials:1354 | MED | 与 1035 同行为，删除重复 | PENDING |
| (未对齐) | LOW | 导出形状由行为测试消费（loadTerrain 等） | PENDING |
| (未对齐) | LOW | :116-134 已行为 | PENDING |
| groundPass:394 | LOW | 已是行为 | PENDING |
| groundPass:453 | LOW | 诊断已是行为 | PENDING |
| groundPass:453 | LOW | 诊断已是行为 | PENDING |
| groundPass:453 | LOW | 诊断已是行为 | PENDING |
| groundPass:453 | LOW | 诊断已是行为 | PENDING |
| (未对齐) | MED | 纯函数已是行为（迁 import 到 playback/pure） | PENDING |
| (未对齐) | MED | 同上 | PENDING |
| (未对齐) | MED | 同上 | PENDING |
| playbackScene.occlusion:61 | MED | footprint 已是行为 | PENDING |
| playbackScene.occlusion:61 | MED | 同上 | PENDING |
| playbackScene.occlusion:61 | MED | 同上 | PENDING |
| playbackScene.occlusion:138 | LOW | prefOf 单测在别处 | PENDING |
| labelOcclusion:62 | MED | 并入 20 harness | PENDING |
| pickDebug:179 | LOW | ReferenceError 已修；formatPickReport 覆盖 | PENDING |
| (未对齐) | MED | firstIndexAfter 已是行为（owner 即本模块） | PENDING |
| (未对齐) | MED | pointsAt 已是行为 | PENDING |
| rosterState:131 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:138 | MED | rosterState.js 行为测试覆盖 | PENDING |
| treadMarks:30 | LOW | 常量导入已是行为 | PENDING |
| (未对齐) | LOW | treadMarks 纯函数行为主体 | PENDING |
| heHeatmapProjection:38 | MED | heSplash:21+armorCollisionPack grid 覆盖 | PENDING |
| agent-theme-css:172 | MED | stylelint color-no-hex/function-disallowed 覆盖；#canvas-container 转 inline disable | PENDING |
| (未对齐) | MED | browser-home-reduced-motion.mjs:274 computed 门禁 | PENDING |
| glass-accessibility:46 | MED | 块序→双偏好 computed 门禁 :286-292 | PENDING |
| glass-accessibility:46 | MED | stylelint 覆盖 app-shell.css | PENDING |
| glass-accessibility:46 | MED | browser-home-reduced-motion.mjs:265-266/316 | PENDING |
| color-contrast:188 | MED | browser-battle-data-spawn-bar.mjs:63-65 computed 严格包含 | PENDING |

D 项合计 34；BLOCKED 0。

## 对齐异常（人工复核清单）

- groundPass.test:35-35 [D] 未对齐任何 text case
- groundPass.test:45-45 [K] 未对齐任何 text case
- groundPass.test:64-64 [K] 未对齐任何 text case
- groundPass.test:81-81 [D] 未对齐任何 text case
- groundPass.test:88-88 [R] 未对齐任何 text case
- groundPass.test:138-138 [R] 未对齐任何 text case
- playbackScene.occlusion.test:8-8 [D] 未对齐任何 text case
- playbackScene.occlusion.test:16-16 [D] 未对齐任何 text case
- playbackScene.occlusion.test:22-22 [D] 未对齐任何 text case
- seekPointer.test:13-13 [D] 未对齐任何 text case
- supremacyPoints.test:18-18 [D] 未对齐任何 text case
- supremacyPoints.test:55-55 [R] 未对齐任何 text case
- treadMarks.test:79-398 [D] 未对齐任何 text case
- tankViewer.distance.test:24-24 [K] 未对齐任何 text case
- tankViewer.cameraPreset.test:62-62 [K] 未对齐任何 text case
- tankViewer.cameraPreset.test:102-102 [K] 未对齐任何 text case
- tankViewer.cameraPreset.test:116-116 [K] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:15-15 [R] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:26-26 [R] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:32-32 [R] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:37-37 [R] 未对齐任何 text case
- heHeatmapProjection.test:26-26 [R] 未对齐任何 text case
- agent-theme-css.test:108-108 [K] 未对齐任何 text case
- agent-theme-css.test:112-112 [R] 未对齐任何 text case
- light-theme-source-regression.test:36-36 [R] 未对齐任何 text case
- glass-accessibility.test:24-24 [R] 未对齐任何 text case
- glass-accessibility.test:32-32 [D] 未对齐任何 text case
- glass-accessibility.test:38-38 [R] 未对齐任何 text case
- corner-shape.test:25-25 [R] 未对齐任何 text case
- replay3d-hud-layout.test:15-15 [R] 未对齐任何 text case
- replay3d-hud-layout.test:21-21 [R] 未对齐任何 text case
- color-contrast.test:136-160 [K] 未对齐任何 text case
- color-contrast.test:170-170 [K] 未对齐任何 text case
