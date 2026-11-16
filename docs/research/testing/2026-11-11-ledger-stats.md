# Issue #827 台账统计与 D 项门禁（F1/F2 交付，2026-11-11）

统计单位统一为 **test case**（u=case 的台账行）；clause 行附着到所属 case，不单独计数。稳定 ID = `<文件slug>:<case起始行>`。**对齐基线固定为 `scripts/testing/source-text-inventory-wave0.json`（历史提交 67fdb2be 的树，用修正后的分类器重新生成，300 个文本用例）**——保留历史行号，但不冻结旧分类器的漏判。映射使用**完整 baseline cases**（含改写后的行为测试），不再先过滤 `textAssertion` 再向前借 case；floor 距离超出容差即记未映射。当前树 inventory 只服务探针，不与历史台账混用。`validation_status` 初始 PENDING：删除批次实际执行 + 接替测试本地/CI 绿 + 故障注入抽查通过后才置 DONE。

## 统计（case 单位）

区间台账行按区间内实际映射到的 case 数计（去重），单行按 1 计；同一 case 在同类处置的多行里只计一次。未映射 / 超容差的单行单独计数，**不混入 R/K/D**；同一 case 被不同处置引用时列入「跨处置冲突」。

| 文件 | baseline cases（all/text） | R | K | D | PK | clause 行 | 未对齐行 | 未映射单行 | 唯一 case | 跨处置冲突 |
|---|---|---|---|---|---|---|---|---|---|---|
| frontend/src/scene/sceneryMaterials.test.js | 74/73 | 48 | 8 | 5 | 0 | 13 | 0 | 0 | 61 | 0 |
| frontend/src/scene/groundPass.test.js | 28/13 | 2 | 8 | 7 | 0 | 1 | 0 | 0 | 17 | 0 |
| frontend/src/scene/playbackScene.occlusion.test.js | 27/21 | 17 | 0 | 7 | 0 | 3 | 0 | 0 | 24 | 0 |
| frontend/src/scene/playbackScene.staticFreeze.test.js | 8/8 | 7 | 1 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| frontend/src/scene/labelOcclusion.test.js | 7/7 | 5 | 0 | 1 | 0 | 1 | 0 | 0 | 6 | 0 |
| frontend/src/scene/pickDebug.test.js | 21/7 | 6 | 0 | 1 | 0 | 0 | 0 | 0 | 7 | 0 |
| frontend/src/scene/seekPointer.test.js | 10/6 | 4 | 0 | 1 | 0 | 2 | 0 | 0 | 5 | 0 |
| frontend/src/scene/supremacyPoints.test.js | 10/4 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 6 | 0 |
| frontend/src/scene/rosterState.test.js | 23/2 | 2 | 0 | 22 | 0 | 0 | 0 | 0 | 22 | 2 |
| frontend/src/scene/treadMarks.test.js | 42/8 | 7 | 0 | 27 | 0 | 1 | 0 | 0 | 34 | 0 |
| frontend/src/scene/tankViewer.distance.test.js | 1/0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/scene/tankViewer.cameraPreset.test.js | 3/0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| frontend/src/scene/tankViewer.collisionBoxFailsafe.test.js | 5/5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| frontend/src/scene/armorCollisionPack.test.js | 54/1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/scene/heHeatmapProjection.test.js | 11/3 | 7 | 0 | 1 | 0 | 3 | 0 | 0 | 8 | 0 |
| frontend/src/scene/heSplash.test.js | 14/1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| frontend/src/scene/viewer/collisionView.test.js | 6/1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| frontend/src/components/MapPreview3DPane.wiring.test.js | 8/8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| frontend/src/components/BattlePlaybackHud.test.js | 14/3 | 0 | 2 | 0 | 0 | 1 | 0 | 0 | 2 | 0 |
| frontend/src/components/PlaybackRoster.test.js | 16/3 | 0 | 2 | 0 | 0 | 1 | 0 | 0 | 2 | 0 |
| frontend/src/components/TankConfigPanel.layout.test.js | 4/4 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| frontend/src/styles/agent-theme-css.test.js | 7/4 | 4 | 2 | 1 | 0 | 0 | 0 | 0 | 7 | 0 |
| frontend/src/styles/light-theme-source-regression.test.js | 6/6 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| frontend/src/styles/glass-accessibility.test.js | 6/1 | 2 | 0 | 4 | 0 | 0 | 0 | 0 | 6 | 0 |
| frontend/src/styles/corner-shape.test.js | 2/1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/styles/hof-admin-tabs-css.test.js | 2/2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/styles/replay3d-hud-layout.test.js | 2/0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/styles/tokens/color-contrast.test.ts | 4/2 | 0 | 3 | 1 | 0 | 0 | 0 | 0 | 4 | 0 |
| frontend/src/api/replay-capabilities.test.ts | 3/3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/app/navigation-context.test.ts | 1/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/app/navigationPressedFeedback.test.js | 5/5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/AgentArmorView.dom-contract.test.js | 64/57 | 0 | 63 | 0 | 0 | 0 | 0 | 0 | 63 | 0 |
| frontend/src/components/AgentTankopedia.baseline.test.js | 1/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/AppSheet.test.ts | 7/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/PlayerRatingRadar.test.js | 13/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/ProfilePage.test.js | 52/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/Replay3DPane.test.js | 85/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/components/ReplayWorkspace.test.js | 61/2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/components/TankResearchPanel.layout.test.js | 2/2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/data-version-wiring.test.js | 4/4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| frontend/src/index-firstpaint.test.js | 5/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/shared/tabular/csv/encode.test.ts | 7/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| frontend/src/vehicle-models/extractor.test.js | 92/7 | 0 | 41 | 0 | 0 | 0 | 0 | 0 | 41 | 0 |
| frontend/src/vehicle-models/texture-bake.test.js | 23/1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| **合计（已映射 44 文件）** | — | **136** | **160** | **79** | **0** | **28** | **0** | **0** | **373** | **2** |

> R/K/D/PK 是**处置覆盖计数**（同一 case 跨处置会重复计入，不能相加当唯一 case 数）。全表唯一 case（按 `testFile:caseId` 并集）= **373**；跨处置冲突 **2** 例；未映射单行 **0** 行（未计入 R/K/D）。映射到非文本（行为）case 的台账行 **128** 行，见下节人工确认。

## 台账未覆盖的 text 断言文件（scope 缺口，Wave 2/3 前需补映射）

- frontend/src/api/agent-wasm-loader.test.ts（1 例）
- frontend/src/components/BattlePlayback.coordinate.test.js（3 例）
- frontend/src/components/BattlePlayback.integration.test.js（3 例）
- frontend/src/components/PlaybackTimeline.test.js（1 例）
- frontend/src/components/PlaybackVehicleLabel.test.js（1 例）
- frontend/src/components/PlayerDetailDrawer.test.js（2 例）
- frontend/src/data/map2dOverlay.test.js（1 例）
- frontend/src/platform/geckoBridgeOriginGate.test.js（2 例）
- frontend/src/replay-local/agent-wasm-smoke.test.ts（1 例）
- frontend/src/shared/ui-dependency-ownership.test.ts（1 例）
- frontend/src/vite-proxy.test.js（1 例）

scope 缺口合计 17 例 / baseline inventory 全量 300 例。

## D 项安全门禁（F2）

删除前置：① 接替者证据存在；② 接替测试实际执行（本地/CI）；③ 旧守卫独有失败模式抽查（故障注入）；④ validation_status 置 DONE。任何 BLOCKED 项不得删除。

| case ID | 优先级 | 接替者证据 | validation_status |
|---|---|---|---|
| sceneryMaterials:1229 | MED | 与 1222 同行为，删除重复 → DONE（重复删除） | PENDING |
| sceneryMaterials:1244 | MED | tracerSpanSecs 已是行为（删源码半句） → DONE（源码半句已删，行为由 battleFx.test.js 覆盖） | PENDING |
| sceneryMaterials:1305 | MED | disposeSceneGroup 已是行为 → DONE（已是行为，删源码半句） | PENDING |
| sceneryMaterials:1349 | LOW | 源码卫生守卫（行为并入 1007 改写） → DONE：并入 playback/vehicleRuntime.pose.test.ts（beltW 声明序） | PENDING |
| sceneryMaterials:1364 | MED | 与 1035 同行为，删除重复 → DONE（与 1035 重复删除） | PENDING |
| groundPass:34 | LOW | 导出形状由行为测试消费（loadTerrain 等） | PENDING |
| groundPass:79 | LOW | :116-134 已行为 | PENDING |
| groundPass:440 | LOW | 已是行为 | PENDING |
| groundPass:463 | LOW | 诊断已是行为 | PENDING |
| groundPass:489 | LOW | 诊断已是行为 | PENDING |
| groundPass:507 | LOW | 诊断已是行为 | PENDING |
| groundPass:518 | LOW | 诊断已是行为 | PENDING |
| playbackScene.occlusion:7 | MED | 纯函数已是行为（迁 import 到 playback/pure） | PENDING |
| playbackScene.occlusion:14 | MED | 同上 | PENDING |
| playbackScene.occlusion:20 | MED | 同上 | PENDING |
| playbackScene.occlusion:72 | MED | footprint 已是行为 | PENDING |
| playbackScene.occlusion:79 | MED | 同上 | PENDING |
| playbackScene.occlusion:89 | MED | 同上 | PENDING |
| playbackScene.occlusion:147 | LOW | prefOf 单测在别处 | PENDING |
| labelOcclusion:62 | MED | 并入 20 harness | PENDING |
| pickDebug:222 | LOW | ReferenceError 已修；formatPickReport 覆盖 | PENDING |
| seekPointer:11 | MED | firstIndexAfter 已是行为（owner 即本模块） | PENDING |
| supremacyPoints:16 | MED | pointsAt 已是行为 | PENDING |
| rosterState:22 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:33 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:39 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:46 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:59 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:69 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:77 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:88 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:96 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:108 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:118 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:131 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:138 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:150 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:184 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:192 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:198 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:211 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:217 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:227 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:239 | MED | rosterState.js 行为测试覆盖 | PENDING |
| rosterState:245 | MED | rosterState.js 行为测试覆盖 | PENDING |
| treadMarks:42 | LOW | 常量导入已是行为 | PENDING |
| treadMarks:79 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:85 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:90 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:99 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:109 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:114 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:127 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:143 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:158 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:170 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:178 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:193 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:205 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:219 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:224 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:244 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:259 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:281 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:302 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:314 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:324 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:334 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:343 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:352 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:372 | LOW | treadMarks 纯函数行为主体 | PENDING |
| treadMarks:387 | LOW | treadMarks 纯函数行为主体 | PENDING |
| heHeatmapProjection:128 | MED | heSplash:21+armorCollisionPack grid 覆盖 | PENDING |
| agent-theme-css:172 | MED | stylelint color-no-hex/function-disallowed 覆盖；#canvas-container 转 inline disable | PENDING |
| glass-accessibility:30 | MED | browser-home-reduced-motion.mjs:274 computed 门禁 | PENDING |
| glass-accessibility:46 | MED | 块序→双偏好 computed 门禁 :286-292 | PENDING |
| glass-accessibility:50 | MED | stylelint 覆盖 app-shell.css | PENDING |
| glass-accessibility:57 | MED | browser-home-reduced-motion.mjs:265-266/316 | PENDING |
| color-contrast:188 | MED | browser-battle-data-spawn-bar.mjs:63-65 computed 严格包含 | PENDING |

D 项处置覆盖 79；BLOCKED 0。

## 映射到非文本（行为）case 的台账行（人工确认）

- sceneryMaterials.test:1306 → sceneryMaterials:1305
- groundPass.test:442 → groundPass:440
- groundPass.test:464 → groundPass:463
- groundPass.test:490 → groundPass:489
- groundPass.test:508 → groundPass:507
- groundPass.test:519 → groundPass:518
- playbackScene.occlusion.test:8 → playbackScene.occlusion:7
- playbackScene.occlusion.test:16 → playbackScene.occlusion:14
- playbackScene.occlusion.test:22 → playbackScene.occlusion:20
- playbackScene.occlusion.test:74 → playbackScene.occlusion:72
- playbackScene.occlusion.test:81 → playbackScene.occlusion:79
- playbackScene.occlusion.test:91 → playbackScene.occlusion:89
- pickDebug.test:230 → pickDebug:222
- seekPointer.test:13 → seekPointer:11
- supremacyPoints.test:18 → supremacyPoints:16
- supremacyPoints.test:55 → supremacyPoints:53
- rosterState.test:22 → rosterState:22
- rosterState.test:22 → rosterState:33
- rosterState.test:22 → rosterState:39
- rosterState.test:22 → rosterState:46
- rosterState.test:22 → rosterState:59
- rosterState.test:22 → rosterState:69
- rosterState.test:22 → rosterState:77
- rosterState.test:22 → rosterState:88
- rosterState.test:22 → rosterState:96
- rosterState.test:22 → rosterState:108
- rosterState.test:22 → rosterState:118
- rosterState.test:141 → rosterState:150
- rosterState.test:141 → rosterState:184
- rosterState.test:141 → rosterState:192
- rosterState.test:141 → rosterState:198
- rosterState.test:141 → rosterState:211
- rosterState.test:141 → rosterState:217
- rosterState.test:141 → rosterState:227
- rosterState.test:141 → rosterState:239
- rosterState.test:141 → rosterState:245
- treadMarks.test:43 → treadMarks:42
- treadMarks.test:79 → treadMarks:79
- treadMarks.test:79 → treadMarks:85
- treadMarks.test:79 → treadMarks:90
- treadMarks.test:79 → treadMarks:99
- treadMarks.test:79 → treadMarks:109
- treadMarks.test:79 → treadMarks:114
- treadMarks.test:79 → treadMarks:127
- treadMarks.test:79 → treadMarks:143
- treadMarks.test:79 → treadMarks:158
- treadMarks.test:79 → treadMarks:170
- treadMarks.test:79 → treadMarks:178
- treadMarks.test:79 → treadMarks:193
- treadMarks.test:79 → treadMarks:205
- treadMarks.test:79 → treadMarks:219
- treadMarks.test:79 → treadMarks:224
- treadMarks.test:79 → treadMarks:244
- treadMarks.test:79 → treadMarks:259
- treadMarks.test:79 → treadMarks:281
- treadMarks.test:79 → treadMarks:302
- treadMarks.test:79 → treadMarks:314
- treadMarks.test:79 → treadMarks:324
- treadMarks.test:79 → treadMarks:334
- treadMarks.test:79 → treadMarks:343
- treadMarks.test:79 → treadMarks:352
- treadMarks.test:79 → treadMarks:372
- treadMarks.test:79 → treadMarks:387
- tankViewer.distance.test:24 → tankViewer.distance:23
- tankViewer.cameraPreset.test:62 → tankViewer.cameraPreset:61
- tankViewer.cameraPreset.test:102 → tankViewer.cameraPreset:100
- tankViewer.cameraPreset.test:116 → tankViewer.cameraPreset:114
- armorCollisionPack.test:753 → armorCollisionPack:752
- heHeatmapProjection.test:26 → heHeatmapProjection:25
- heHeatmapProjection.test:63 → heHeatmapProjection:62
- heHeatmapProjection.test:76 → heHeatmapProjection:75
- heHeatmapProjection.test:85 → heHeatmapProjection:84
- heHeatmapProjection.test:98 → heHeatmapProjection:97
- heHeatmapProjection.test:142 → heHeatmapProjection:141
- agent-theme-css.test:108 → agent-theme-css:106
- agent-theme-css.test:112 → agent-theme-css:110
- agent-theme-css.test:209 → agent-theme-css:208
- glass-accessibility.test:24 → glass-accessibility:23
- glass-accessibility.test:32 → glass-accessibility:30
- glass-accessibility.test:38 → glass-accessibility:36
- glass-accessibility.test:52 → glass-accessibility:50
- glass-accessibility.test:59 → glass-accessibility:57
- corner-shape.test:25 → corner-shape:24
- replay3d-hud-layout.test:15 → replay3d-hud-layout:13
- replay3d-hud-layout.test:21 → replay3d-hud-layout:19
- color-contrast.test:136 → color-contrast:135
- color-contrast.test:170 → color-contrast:169
- AgentArmorView.dom-contract.test:37 → AgentArmorView.dom-contract:176
- AgentArmorView.dom-contract.test:37 → AgentArmorView.dom-contract:190
- AgentArmorView.dom-contract.test:37 → AgentArmorView.dom-contract:482
- AgentArmorView.dom-contract.test:37 → AgentArmorView.dom-contract:508
- AgentArmorView.dom-contract.test:37 → AgentArmorView.dom-contract:770
- AgentArmorView.dom-contract.test:37 → AgentArmorView.dom-contract:833
- extractor.test:241 → extractor:260
- extractor.test:241 → extractor:269
- extractor.test:241 → extractor:278
- extractor.test:241 → extractor:285
- extractor.test:241 → extractor:298
- extractor.test:241 → extractor:313
- extractor.test:241 → extractor:324
- extractor.test:241 → extractor:332
- extractor.test:241 → extractor:341
- extractor.test:241 → extractor:348
- extractor.test:241 → extractor:363
- extractor.test:241 → extractor:373
- extractor.test:241 → extractor:382
- extractor.test:241 → extractor:393
- extractor.test:241 → extractor:411
- extractor.test:241 → extractor:417
- extractor.test:241 → extractor:422
- extractor.test:241 → extractor:426
- extractor.test:241 → extractor:444
- extractor.test:241 → extractor:455
- extractor.test:241 → extractor:464
- extractor.test:241 → extractor:478
- extractor.test:241 → extractor:485
- extractor.test:241 → extractor:498
- extractor.test:241 → extractor:514
- extractor.test:241 → extractor:524
- extractor.test:241 → extractor:534
- extractor.test:241 → extractor:544
- extractor.test:241 → extractor:556
- extractor.test:241 → extractor:572
- extractor.test:241 → extractor:581
- extractor.test:241 → extractor:591
- extractor.test:241 → extractor:600
- extractor.test:241 → extractor:613
- extractor.test:241 → extractor:627

## 跨处置冲突（同一 case 被不同处置行引用，人工复核）

- frontend/src/scene/rosterState.test.js:rosterState:131：D / R
- frontend/src/scene/rosterState.test.js:rosterState:138：R / D

## 对齐异常（人工复核清单）

- rosterState.test: case rosterState:131 跨处置冲突（D/R）
- rosterState.test: case rosterState:138 跨处置冲突（R/D）
