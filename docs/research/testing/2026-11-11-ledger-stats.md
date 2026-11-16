# Issue #827 台账统计与 D 项门禁（F1/F2 交付，2026-11-11）

统计单位统一为 **test case**（u=case 的台账行）；clause 行附着到所属 case，不单独计数。稳定 ID = `<文件slug>:<case起始行>`。**对齐基线固定为 `scripts/testing/source-text-inventory-wave0.json`（Wave 0 快照，181 例）**——台账行号属于改写前的测试树，不能用改写后重生成的当前 inventory 反推。当前树 inventory 只服务探针，不与历史台账混用。台账行与基线 case 的出入列入「对齐异常」，人工复核后以台账为准。`validation_status` 初始 PENDING：删除批次实际执行 + 接替测试本地/CI 绿 + 故障注入抽查通过后才置 DONE。

## 统计（case 单位）

区间台账行按区间内实际映射到的 case 数计（去重），单行按 1 计；同一 case 在同类处置的多行里只计一次。未映射的单行单独计数，**不混入 R/K/D**；同一 case 被不同处置引用时列入「跨处置冲突」。

| 文件 | baseline text cases | R | K | D | PK | clause 行 | 未对齐行 | 未映射单行 | 唯一 case | 跨处置冲突 |
|---|---|---|---|---|---|---|---|---|---|---|
| frontend/src/scene/sceneryMaterials.test.js | 48 | 35 | 8 | 4 | 0 | 13 | 0 | 0 | 42 | 5 |
| frontend/src/scene/groundPass.test.js | 5 | 0 | 4 | 2 | 0 | 1 | 6 | 6 | 4 | 2 |
| frontend/src/scene/playbackScene.occlusion.test.js | 18 | 15 | 0 | 2 | 0 | 3 | 3 | 3 | 15 | 2 |
| frontend/src/scene/playbackScene.staticFreeze.test.js | 7 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 7 | 1 |
| frontend/src/scene/labelOcclusion.test.js | 7 | 5 | 0 | 1 | 0 | 1 | 0 | 0 | 6 | 0 |
| frontend/src/scene/pickDebug.test.js | 6 | 6 | 0 | 1 | 0 | 0 | 0 | 0 | 6 | 1 |
| frontend/src/scene/seekPointer.test.js | 5 | 3 | 0 | 0 | 0 | 2 | 1 | 1 | 3 | 0 |
| frontend/src/scene/supremacyPoints.test.js | 3 | 3 | 1 | 0 | 0 | 0 | 2 | 2 | 3 | 1 |
| frontend/src/scene/rosterState.test.js | 2 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 2 | 2 |
| frontend/src/scene/treadMarks.test.js | 6 | 6 | 0 | 1 | 0 | 1 | 1 | 0 | 6 | 1 |
| frontend/src/scene/tankViewer.distance.test.js | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| frontend/src/scene/tankViewer.cameraPreset.test.js | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | 0 | 0 |
| frontend/src/scene/tankViewer.collisionBoxFailsafe.test.js | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 4 | 0 | 0 |
| frontend/src/scene/armorCollisionPack.test.js | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| frontend/src/scene/heHeatmapProjection.test.js | 1 | 1 | 0 | 1 | 0 | 3 | 1 | 1 | 1 | 1 |
| frontend/src/scene/heSplash.test.js | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| frontend/src/scene/viewer/collisionView.test.js | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| frontend/src/components/MapPreview3DPane.wiring.test.js | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| frontend/src/components/BattlePlaybackHud.test.js | 3 | 0 | 2 | 0 | 0 | 1 | 0 | 0 | 2 | 0 |
| frontend/src/components/PlaybackRoster.test.js | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| frontend/src/components/TankConfigPanel.layout.test.js | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/styles/agent-theme-css.test.js | 4 | 3 | 1 | 1 | 0 | 0 | 2 | 2 | 4 | 1 |
| frontend/src/styles/light-theme-source-regression.test.js | 3 | 2 | 2 | 0 | 0 | 0 | 1 | 1 | 3 | 1 |
| frontend/src/styles/glass-accessibility.test.js | 1 | 0 | 0 | 1 | 0 | 0 | 3 | 3 | 1 | 0 |
| frontend/src/styles/corner-shape.test.js | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 1 | 0 |
| frontend/src/styles/hof-admin-tabs-css.test.js | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/styles/replay3d-hud-layout.test.js | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | 0 | 0 |
| frontend/src/styles/tokens/color-contrast.test.ts | 1 | 0 | 1 | 1 | 0 | 0 | 2 | 1 | 1 | 1 |
| frontend/src/api/replay-capabilities.test.ts | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/app/navigation-context.test.ts | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/app/navigationPressedFeedback.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/AgentArmorView.dom-contract.test.js | 22 | 0 | 22 | 0 | 0 | 0 | 0 | 0 | 22 | 0 |
| frontend/src/components/AgentTankopedia.baseline.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/AppSheet.test.ts | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/PlayerRatingRadar.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/ProfilePage.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/Replay3DPane.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/ReplayWorkspace.test.js | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/components/TankResearchPanel.layout.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/data-version-wiring.test.js | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/index-firstpaint.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/shared/tabular/csv/encode.test.ts | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/vehicle-models/extractor.test.js | 6 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| frontend/src/vehicle-models/texture-bake.test.js | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| **合计（已映射 44 文件）** | — | **99** | **69** | **17** | **0** | **28** | **33** | **31** | **165** | **20** |

> R/K/D/PK 是**处置覆盖计数**（同一 case 跨处置会重复计入，不能相加当唯一 case 数）。全表唯一 case（按 `testFile:caseId` 并集）= **165**；跨处置冲突 **20** 例；未映射单行 **31** 行（未计入 R/K/D）。

## 台账未覆盖的 text 断言文件（scope 缺口，Wave 2/3 前需补映射）

（无）

scope 缺口合计 0 例 / baseline inventory 全量 181 例。

## D 项安全门禁（F2）

删除前置：① 接替者证据存在；② 接替测试实际执行（本地/CI）；③ 旧守卫独有失败模式抽查（故障注入）；④ validation_status 置 DONE。任何 BLOCKED 项不得删除。

| case ID | 优先级 | 接替者证据 | validation_status |
|---|---|---|---|
| sceneryMaterials:1229 | MED | 与 1222 同行为，删除重复 → DONE（重复删除） | PENDING |
| sceneryMaterials:1263 | MED | disposeSceneGroup 已是行为 → DONE（已是行为，删源码半句） | PENDING |
| sceneryMaterials:1349 | LOW | 源码卫生守卫（行为并入 1007 改写） → DONE：并入 playback/vehicleRuntime.pose.test.ts（beltW 声明序） | PENDING |
| sceneryMaterials:1354 | MED | 与 1035 同行为，删除重复 → DONE（与 1035 重复删除） | PENDING |
| (未对齐) | LOW | 导出形状由行为测试消费（loadTerrain 等） | PENDING |
| groundPass:394 | LOW | 已是行为 | PENDING |
| groundPass:453 | LOW | 诊断已是行为 | PENDING |
| (未对齐) | MED | 纯函数已是行为（迁 import 到 playback/pure） | PENDING |
| playbackScene.occlusion:61 | MED | footprint 已是行为 | PENDING |
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
| color-contrast:188 | MED | browser-battle-data-spawn-bar.mjs:63-65 computed 严格包含 | PENDING |

D 项处置覆盖 17；BLOCKED 0。

## 跨处置冲突（同一 case 被不同处置行引用，人工复核）

- frontend/src/scene/sceneryMaterials.test.js:sceneryMaterials:142：R / K
- frontend/src/scene/sceneryMaterials.test.js:sceneryMaterials:677：R / K
- frontend/src/scene/sceneryMaterials.test.js:sceneryMaterials:1229：D / R
- frontend/src/scene/sceneryMaterials.test.js:sceneryMaterials:1263：R / D
- frontend/src/scene/sceneryMaterials.test.js:sceneryMaterials:1354：R / D
- frontend/src/scene/groundPass.test.js:groundPass:394：K / D
- frontend/src/scene/groundPass.test.js:groundPass:453：K / D
- frontend/src/scene/playbackScene.occlusion.test.js:playbackScene.occlusion:61：R / D
- frontend/src/scene/playbackScene.occlusion.test.js:playbackScene.occlusion:138：R / D
- frontend/src/scene/playbackScene.staticFreeze.test.js:playbackScene.staticFreeze:21：R / K
- frontend/src/scene/pickDebug.test.js:pickDebug:179：R / D
- frontend/src/scene/supremacyPoints.test.js:supremacyPoints:85：R / K
- frontend/src/scene/rosterState.test.js:rosterState:131：D / R
- frontend/src/scene/rosterState.test.js:rosterState:138：R / D
- frontend/src/scene/treadMarks.test.js:treadMarks:30：R / D
- frontend/src/scene/armorCollisionPack.test.js:armorCollisionPack:709：R / K
- frontend/src/scene/heHeatmapProjection.test.js:heHeatmapProjection:38：R / D
- frontend/src/styles/agent-theme-css.test.js:agent-theme-css:198：R / K
- frontend/src/styles/light-theme-source-regression.test.js:light-theme-source-regression:43：R / K
- frontend/src/styles/tokens/color-contrast.test.ts:color-contrast:188：D / K

## 对齐异常（人工复核清单）

- sceneryMaterials.test: case sceneryMaterials:142 跨处置冲突（R/K）
- sceneryMaterials.test: case sceneryMaterials:677 跨处置冲突（R/K）
- sceneryMaterials.test: case sceneryMaterials:1229 跨处置冲突（D/R）
- sceneryMaterials.test: case sceneryMaterials:1263 跨处置冲突（R/D）
- sceneryMaterials.test: case sceneryMaterials:1354 跨处置冲突（R/D）
- groundPass.test:35-35 [D] 未对齐任何 text case
- groundPass.test:45-45 [K] 未对齐任何 text case
- groundPass.test:64-64 [K] 未对齐任何 text case
- groundPass.test:81-81 [D] 未对齐任何 text case
- groundPass.test:88-88 [R] 未对齐任何 text case
- groundPass.test:138-138 [R] 未对齐任何 text case
- groundPass.test: case groundPass:394 跨处置冲突（K/D）
- groundPass.test: case groundPass:453 跨处置冲突（K/D）
- playbackScene.occlusion.test:8-8 [D] 未对齐任何 text case
- playbackScene.occlusion.test:16-16 [D] 未对齐任何 text case
- playbackScene.occlusion.test:22-22 [D] 未对齐任何 text case
- playbackScene.occlusion.test: case playbackScene.occlusion:61 跨处置冲突（R/D）
- playbackScene.occlusion.test: case playbackScene.occlusion:138 跨处置冲突（R/D）
- playbackScene.staticFreeze.test: case playbackScene.staticFreeze:21 跨处置冲突（R/K）
- pickDebug.test: case pickDebug:179 跨处置冲突（R/D）
- seekPointer.test:13-13 [D] 未对齐任何 text case
- supremacyPoints.test:18-18 [D] 未对齐任何 text case
- supremacyPoints.test:55-55 [R] 未对齐任何 text case
- supremacyPoints.test: case supremacyPoints:85 跨处置冲突（R/K）
- rosterState.test: case rosterState:131 跨处置冲突（D/R）
- rosterState.test: case rosterState:138 跨处置冲突（R/D）
- treadMarks.test:79-398 [D] 未对齐任何 text case
- treadMarks.test: case treadMarks:30 跨处置冲突（R/D）
- tankViewer.distance.test:24-24 [K] 未对齐任何 text case
- tankViewer.cameraPreset.test:62-62 [K] 未对齐任何 text case
- tankViewer.cameraPreset.test:102-102 [K] 未对齐任何 text case
- tankViewer.cameraPreset.test:116-116 [K] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:15-15 [R] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:26-26 [R] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:32-32 [R] 未对齐任何 text case
- tankViewer.collisionBoxFailsafe.test:37-37 [R] 未对齐任何 text case
- armorCollisionPack.test: case armorCollisionPack:709 跨处置冲突（R/K）
- heHeatmapProjection.test:26-26 [R] 未对齐任何 text case
- heHeatmapProjection.test: case heHeatmapProjection:38 跨处置冲突（R/D）
- agent-theme-css.test:108-108 [K] 未对齐任何 text case
- agent-theme-css.test:112-112 [R] 未对齐任何 text case
- agent-theme-css.test: case agent-theme-css:198 跨处置冲突（R/K）
- light-theme-source-regression.test:36-36 [R] 未对齐任何 text case
- light-theme-source-regression.test: case light-theme-source-regression:43 跨处置冲突（R/K）
- glass-accessibility.test:24-24 [R] 未对齐任何 text case
- glass-accessibility.test:32-32 [D] 未对齐任何 text case
- glass-accessibility.test:38-38 [R] 未对齐任何 text case
- corner-shape.test:25-25 [R] 未对齐任何 text case
- replay3d-hud-layout.test:15-15 [R] 未对齐任何 text case
- replay3d-hud-layout.test:21-21 [R] 未对齐任何 text case
- color-contrast.test:136-160 [K] 未对齐任何 text case
- color-contrast.test:170-170 [K] 未对齐任何 text case
- color-contrast.test: case color-contrast:188 跨处置冲突（D/K）
