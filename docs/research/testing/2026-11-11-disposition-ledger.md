# Issue #827 逐例处置台账（2026-11-11，main `7b4285870`）

逐例映射来源：CSS 组与 scene 簇全量阅读（21 个 scene/components 测试文件 + 7 个 styles 测试文件）。探针编号（probe-matrix-*.json）在各批次 PR 时回填。完整用例名索引见 `2026-11-11-disposition-ledger-draft.md`（由 inventory 生成）。

处置图例：**R**=改写为行为测试（标注 owner 模块与断言）· **K**=保留（真实守卫，无接替者）· **D**=删除（已有接替者，标注出处）· **PK**=shader 公式逐字 / CSS 无 JS owner，提请用户复核。

优先级：HIGH=生命周期/失败路径，MED=接线/算法锚，LOW=负面守卫/装饰性。

汇总：**R 128 / K 37 / D 131 / PK ~34**（CSS 组 9/19/9 与 scene 组 110/28/113/17 相加；K 含 #888 型宿主接线守卫）。

---

## A. scene 簇

### sceneryMaterials.test.js（text 48）— R 40 / K 14 / D 8 / PK 6 子句

| 行 | 守卫 | 处置 | 优先级 |
|---|---|---|---|
| 65 | convMat 缓存键含 alphaTest/transparent/map.uuid | R: `sceneryAssembly.assembleSceneryMaterials` 两个仅差 alphaTest 的材质 → 实例不同；同输入两次 → 同实例（缓存命中） | MED |
| 78 | disposeObject3D 回收 ShaderMaterial uniforms 纹理 | R: `materialDispose.disposeObject3D` + spy 纹理 → dispose 调用、stats.materials==1（扩展 :1306 既有行为测试） | MED |
| 88 | 会话释放清材质缓存 | R: `createMapWorld().dispose()` 后 cachedSceneryMat 返回新实例 + 宿主接线 | HIGH |
| 98 | 叶片卡不透明管线 uAlphaCut 0.33 | PK（公式）；R-lite: `makeBillboardMaterial` → transparent===false, uniforms.uAlphaCut.value===0.33 | MED |
| 107 | 叶片材质取自身 occMean/SH 色调 | R: `makeBillboardMaterial` userData.occMean=2.5 → uOcc===2.5，uSH 来自 baseColorFactor | MED |
| 115 | 伪不透明→opaque+alphaTest；真透明保 depthWrite=false | R: `assembleSceneryMaterials` 三网格分支断言（镜像 groundPass.test.js:226 风格） | MED |
| 128 | blendLayer 软 alpha + 缓存键 alphaBlend 标记 | R: assemble 断言；bake 侧 SSOT 子句 K | MED |
| 144 | blend 双采样 + uTime 每帧推进 | PK（GLSL）+ R 接线：animLayerMats 注册 + 宿主 tick 推进 uTime | MED |
| 169 | GLB 加载失败带 tank_id 告警、proxy 车保留 | R: `createVehicleRuntime` assetProvider reject → warn 含 tank_id、v.glb 保持 null；空 scene → '解析返回空' | HIGH |
| 183 | 自定义 vertexShader varying 声明完整性 | K（shader-lint 类，无 runtime 接替） | MED |
| 208 | env 反射公式 | PK（公式）+ R: `mapLighting.applyMapLightingCore` → uSunDirScene 归一 | MED |
| 233 | 水体 MEDIUM 档着色 | PK + R: water extras → makeWaterMaterial 路由（transparent+depthWrite:true） | MED |
| 260 | 每-map IBL + 会话分离释放 | R: mapWorld handle → scene.environment Equirect + dispose 后 null、texture.dispose 调用 | MED |
| 282 | lightmap 材质 albedo×lm×2 | PK（GLSL）+ R: LM extras → 缓存材质、aLm 属性保留 | MED |
| 317 | detail 层顺序/缓存键 | PK + R: detail extras → detail 材质 vs patchSceneryDetail 标记；同键缓存 | MED |
| 354 | 每-map 太阳驱动 directional/hemi | R: applyMapLightingCore fixture → sunLight 位置/强度/hemi 色；缺失 → fallback | MED |
| 374 | 静态几何 gamma 直通 shader | PK；可选 R-lite: uAlphaCut 0.05/0.33 档位 | MED |
| 391 | 占位地面+网格不可见但保留 | R: 空图 createMapWorld → mapPlane/grid in scene 且 visible===false | LOW |
| 404 | 坦克环境光隔离（幂等、program key） | PK + R-lite: patchTankMaterial 两次幂等、envMapIntensity 设置 | MED |
| 422 | 输出变换 LinearToneMapping+exposure 1.0 | R: `createSceneCore` → renderer.toneMapping/exposure 断言；URL 禁令 K | MED |
| 435 | ground shader varyings 双端声明 | PK（shader-lint）；"无本地副本"半句 D（groundPass.test.js:34 SSOT 覆盖） | MED |
| 457 | 取样色彩空间 NoColorSpace/4 处 SRGB | R-lite: 各 owner 显示内容纹理 colorSpace 行为断言（精确计数形态重构） | MED |
| 489 | 地面贴花已移除（负面守卫） | K | LOW |
| 497 | 地形客户端同构（texel 原位、LOD 迟滞、走廊细化、morph、sampleHeight） | R 拆分：`terrainMesh.buildAdaptiveTerrain` 行为 + mapWorld LOD 接线（旋转原位触发重建） | HIGH |
| 599 | decal 材质 UV1×2.0 | PK + R 接线：decal extras → decal ShaderMaterial（路由已被 groundPass.test.js:270/297 覆盖） | MED |
| 635 | 无共面接缝补偿 | K（负面守卫） | LOW |
| 648 | 无 per-mesh 三角删除 | K（负面守卫） | LOW |
| 657 | blendByAngle 视角混合 | PK + R: `makeBlendByAngleMaterial` → transparent/depthWrite/uniforms 断言 | MED |
| 679 | 海岸线按深度分辨率淡出 | PK + R: `groundPass.makeWaterCoast` → uDepthUlp=2/2^depthBits | MED |
| 728 | 水下静态网格跳过 lightmap | R: collectWaterSurfaces+makeUnderWater 边界（0.05/0.5m）；主体 D（groundPass.test.js:198-242 已行为） | MED |
| 759 | 无第 4 条细分判据 | K（负面守卫） | LOW |
| 773 | uHbSoft 必须 Vector4 | R: `groundPass.makeGroundMaterial` → uniforms.uHbSoft.value instanceof Vector4；类型声明子句 PK | MED |
| 788 | 每-map 曝光归一 clamp 0.05–4 | R: intensity 8 fixture → toneMappingExposure≈clamp(3/8) | MED |
| 804 | 水面 transparent depthWrite+DoubleSide；extras SSOT | R: DoubleSide/renderOrder 断言（主体 D: groundPass.test.js:198）；SSOT 子句 D（sceneryAssemblyRules.test.js） | MED |
| 831 | logdepth 默认关 + 逃生参数 | R-lite: createSceneCore → capabilities.logarithmicDepthBuffer；include 子句 PK | LOW |
| 860 | scenery Lambert 曝光 0.75 | R: assemble → color×SCENERY_LAMBERT_EXPOSURE | LOW |
| 866 | 天穹材质标志 + sky-vs-water 路由 | PK + R: makeSkyMaterial 标志断言；SkySeaSurface 含 water extras 不走 sky（曾为用户 bug）；isSkyShell 半句 D（sceneryAssemblyRules.test.js） | MED |
| 919 | 各向异性随画质档 + uuid 去重 | R: applyMaterialTextureAnisotropy(root,8) → uniform 纹理 anisotropy===8 且 spy 只一次 | LOW |
| 931 | 无 flatShading | K（负面守卫） | LOW |
| 942 | bake 页消费同一 SSOT | K（构建脚本 SSOT）；dispatch 顺序 R 已由 groundPass.test.js:226 达成 | LOW |
| 984 | __hullGroup 拆分 + 恒等姿态 | R: `glbParts.collectGlbParts` stub GLB → hullGroup 含 hull、chassis 收集；poseGlb 恒等 | MED |
| 1007 | suspension 404→刚体；beltW 定义序 | R: assetProvider 404 → v.suspParts===null；成功 fixture → 挂载 + beltW 有限 | MED |
| 1020 | poseGlb 内解算 + seek snap 语义 | R: frameTiming+tick 两帧无横向积累；markSeekSnap 后 tick 吸附 | HIGH |
| 1035 | GLB-off/会话末清 suspParts+释放克隆 | R: applyGlbToggle(false) → null + dispose spies | MED |
| 1040 | fail-closed 轮数不匹配；克隆 per-vehicle | R: 轮数≠节点 → null；两车 geometry !== | MED |
| 1055 | 履带 UV 仅偏移不折叠 | R: suspensionStep stub 带 → V=base+offset 无 clamp | MED |
| 1065 | 履带速率取实测斜率 | R: 已知斜率几何 → dvPerM 近似；源码子句 D | MED |
| 1077 | advancePlaybackTime NaN/负安全 | R: 纯函数行为（NaN 不污染、END clamp） | MED |
| 1082 | setSpeed 只认表值 | R: setSpeed(0.37) → SPEED 不变；表值生效 | LOW |
| 1086 | onResize 取整 setSize | R: stub container 100.6 → setSize(101,h) spy | LOW |
| 1094 | 单 WebGL context/单 render | K（宿主无可注入 renderer 工厂；#888 备忘） | LOW |
| 1107 | FX 对象池 take/give、热路径不 dispose | R: createBattleRuntime → takeRibbon≥shots、giveRibbon、dispose spy=0 | MED |
| 1128 | 弹匣读数门控（labels-off/33ms/100ms） | R: createLabelsRuntime stub：同 T 只解析一次、off 不解析 | MED |
| 1142 | HUD 100ms 节流+seek 强制 | LOW：宿主接线（需可测 hudTick 或 fake timers 两 tick 断言） | LOW |
| 1150 | 分数/击杀游标增量；kills 升序 | R: createHudFeed 乱序 → 消费按 t 序；transientFeedback3d sort | MED |
| 1160 | 资产并发上限 4 | R: instrumented fetchFn → max in-flight ≤4 | MED |
| 1166 | poseGlb 零分配 | R-lite: 复用 scratch 断言；源码负面子句 D | MED |
| 1180 | dirty-frame 门控 busy 判定 | R: createBattleRuntime.isActive() 真值表 | MED |
| 1201 | hull roll 共享采样器缺列→0 | R: `replay-local/pose/vehiclePose.sampleVehiclePoseGame` 缺 hull_roll → out.roll===0 | MED |
| 1213 | pose 通道单实现 | R: visByEid 覆盖回退断言；重复源码子句 D | MED |
| 1222 | 双路径带 roll 负号 | R: sampleVehiclePoseGame roll=10 → 场景四元数 −10° | MED |
| 1231 | yaw/roll 同号 pitch 不变 | D（并入 1222） | MED |
| 1240 | 弹道外观只在 battleFx | R: battleRuntime spy → setTracer 按队伍色；TRAJ_OPACITY 子句 D | LOW |
| 1246 | tracerSpanSecs 真飞行时间 | D（已是行为测试；仅删 battleSrc regex 半句） | MED |
| 1265 | 标记材质 toneMapped:false | R: createBoundaryBand/createBaseMarkers → toneMapped===false | MED |
| 1283 | 场景 ready 时 shader 预热 | R: createSessionLifecycle deps 调用序（prewarmShaders 恰一次） | HIGH |
| 1295 | perf watchdog 50ms+清理 | R: createPerfProbe fake timers → stall 告警、destroy 清 interval | LOW |
| 1306 | disposeSceneGroup 释放+清缓存 | D（已是行为测试） | MED |
| 1333 | maybeRebuildTerrainLod 消费地形状态 | R: createMapWorld harness 原位旋转→重建、迟滞内→不重建 | HIGH |
| 1344 | 纹理 await 后 stale 检查再发布 | R: assembleMapScenery stale 翻转 → {stale:true}+gltf.scene dispose | HIGH |
| 1351 | 无 undefined v0tankId | D（行为并入 1007） | LOW |
| 1356 | LM 材质按指纹缓存 | R: 两个共享 atlas 网格 → 同实例 | MED |
| 1366 | applyGlbToggle(false) 先释放后清引用 | D（并入 1035） | MED |
| 1375 | 履带形变按链比较 | R: 两链等幅不同分布 → 更新；相等链 → 跳过 | MED |

### groundPass.test.js（text 16）— R 2 / K 8 / D 6

| 行 | 守卫 | 处置 |
|---|---|---|
| 35 | 7 个共享导出存在 | D（下方行为测试已消费这些入口） |
| 45 | runtime/mapWorld 无本地副本 | K（#888 接线守卫） |
| 64 | bake 侧消费共享入口 | K（构建脚本 SSOT） |
| 81 | 地形读取 fail-closed 源码子句 | D（:116-134 已行为） |
| 88 | 纹理上传契约单实现 | R: `setupGroundTextures(texs,8)` stub → Repeat+anisotropy 8；cm/lm/mask colorSpace 不动 |
| 138 | 走廊细化掩码单实现 | R: `buildCorridorRefineMask` 行为（贴地薄板→细化、高物→排除）；顺序源码子句 D |
| 165/172/180/396/408/455 | bake 脚本接线/负面/生命周期 | K（无 vitest owner；408 行为半句已在 :116-134） |
| 185 | assemble-before-mount 顺序 | R-split：行为半句已测（:198-352）→ 删源码顺序子句 |
| 442 | makeGroundMaterial fallback | D（已是行为） |
| 464/490/508/519 | 诊断 | D（已是行为） |

### playbackScene.occlusion.test.js（text 24）— R 14 / D 5 / PK 1

| 行 | 守卫 | 处置 |
|---|---|---|
| 8,16,22 / 74,81,91 | occlusionCells/Footprint 纯函数 | D（已是行为；机械迁移 import 到 `playback/pure`） |
| 35 | 候选列表 raycast + occlGrid 生命周期 | R: createLabelsRuntime spy 断言 intersectObjects(cands)；createMapWorld().dispose() → occlGrid null | HIGH |
| 46/63 | 镜像 pts3 方向 | R: createBattleRuntime shot fixture 向量断言 | MED |
| 53 | tracer 完成门 T>=t1、ribbon 归还、impact 一次 | R: tick 跨 t1 → giveRibbon 一次、spawnImpact 一次 | HIGH |
| 101 | footprint 注册进 occlGrid | R: assembleMapScenery 多格 footprint → 9 格入格 | MED |
| 105 | 时间线回退重置可破坏物 | R: updateDestructibles 前进+回退 → settled false、ptr 重置 | HIGH |
| 110 | perf watchdog destroy 清理 | R: createPerfProbe destroy → clearInterval | LOW |
| 124 | 盔甲叠加 pass 顺序+门控 | R: createCameraRuntime 门控真值表（recorder+scoped 才调用） | MED |
| 132 | 瞄准点取 reticle/recorder | R: camera 偏离 → 仍对准 recorderAimPoint | MED |
| 140 | suspension 只标 stale | R: markPickBoundsStale spy、computeBoundingSphere 不调用 | MED |
| 149 | armorhl 默认关 | D（prefOf 单测在别处） | LOW |
| 153 | 精确挂载配置 | R: 缺挂载件 → 无高亮（不用最近回退） | MED |
| 160/167 | RT 释放路径 | R: recorder scoped→unscoped / pref-off → releaseRenderTargets spy | MED |
| 176 | 遮挡剔除批 AABB 优先 | R: armorHighlight markOccluders box/sphere 路径 | MED |
| 186 | spacedRect UV 公式 | PK（GLSL）+ R-lite: RT bucket 尺寸数值 | MED |
| 200 | perfFrame 统计接线 | R（并入 124 harness） | LOW |
| 208 | 遮挡根=语义清单 | R: occluderRoots() 返回确切数组（stub deps） | MED |
| 224 | SNIPER 预热 | R: scoped 转换 → prewarmArmorHighlight spy | MED |
| 230 | 零遮挡快路径 | R: 空 roots → 深度 pass 不调用 | MED |
| 238 | RT 收缩迟滞 90 帧 | R: 90 帧序列 → RT 变小；release → 重置 | MED |

### playbackScene.staticFreeze.test.js（text 8）— R 7 / PK 1

| 行 | 守卫 | 处置 |
|---|---|---|
| 16 | 静态子树矩阵冻结 | R: assembleMapScenery stub → matrixAutoUpdate false 全树 + 世界矩阵烘焙 |
| 23 | poseGlb 不逐帧全树更新 | R: poseGlb → updateMatrixWorld spy 不调用 |
| 45 | USE_INSTANCING 全覆盖 | PK（shader-lint 类） |
| 59 | 批合节点移出渲染图 | R: instanced entries → 原 node.parent===null、InstancedMesh 入场景 |
| 67 | D_ 实例隐藏+排除遮挡 | R: 同 harness → 隐藏 + occlGrid 缺席 |
| 75 | 倒树 per-instance+回退 | R: updateDestructibles 前进/回退矩阵断言；fallMatrix 纯函数数值 | HIGH |
| 91 | 实例矩阵批量上传 | R: 50 树一帧 → needsUpdate 每网格一次（spy 计数） |
| 101 | dynres 门控 | R: createSceneCore({baseDpr:1}) → 无 dynres；DPR2 → setPixelRatio 调用 | LOW |

### labelOcclusion.test.js（text 7）— R 5 / K 1 / D 1

| 行 | 守卫 | 处置 |
|---|---|---|
| 20 | 标签只发布 occluded 标志 | R: createLabelsRuntime 遮挡 LOS → labelOccluded true；overlay CSS 消费子句 K（组件测试） |
| 31 | 永不隐藏下限 | D 常量半句（已是行为）；overlay 接线 K |
| 39 | LOS 地形步进+候选 cell raycast | R: heightfield stub：5m 脊后 → 遮挡；intersectObjects 参数=cands |
| 50 | blockers 不含车辆 | R: 车辆挡在中间 → 不遮挡 |
| 58 | occlStride 自适应 | R: 慢 raycaster stub → stride 增大 |
| 64 | updateLabels 推进+发布 | D（并入 20 harness） |
| 71 | raycaster.far 还原 | R: 同 harness 更新后 far===原值 |

### pickDebug.test.js（text 7）— R 5 / D 2

| 行 | 守卫 | 处置 |
|---|---|---|
| 137 | pointerdown 始终记录 pickDownAt | R: createCameraRuntime harness 派发事件 → setPickDownAt 命中车也记录 |
| 144 | up 语义序+slop 门 | R: 调用序断言；超 slop 无 reportPick |
| 156 | 实例归属精确优先 | R: createPickReporter meshOwner 命中 → 用 owner inst；空 map → 回退 |
| 167 | teardown 释放 meshOwner/destruct | R: createMapWorld().dispose() → 内部 null（getter 观测） | HIGH |
| 180 | 可破坏物 stale 检查 | R: destructDocPromise 晚 resolve + stale → 写空、无 scene.remove | HIGH |
| 230 | 诊断共声明 | D（ReferenceError 已修；行为由 formatPickReport 覆盖） | LOW |
| 237 | pick 失败可见 | R: 抛错 raycast → 面板出现 `[scene-pick] failed:` |

### seekPointer.test.js（text 7）— R 4 / D 3

| 行 | 守卫 | 处置 |
|---|---|---|
| 13–42 | firstIndexAfter 游标语义 | D（已是行为，owner 即 ./seekPointer.ts） |
| 59 | seek 三游标重定位 | R: createTransientFeedback3d.rewind(t) + battleRuntime.resetShotsTo；宿主 seekTo 接线 #888 | HIGH |
| 66 | clearEffects 清态不回放历史 | R: clear() → Map 空、ptr 0；seek 后 tick 无 ghost | HIGH |
| 79 | buildBoundary null → 只清不画 | R: build(null) → 0 children |
| 83 | boundary 只吃 playableBounds | R: createMapWorld 不同 ext → 边界值断言；禁 fallback 子句 D |
| 101/109 | 相机距离 clamp/baseMin | R: cameraTerrainClamp.applyCameraClamp ext=100 → min20/max220（合并同 fixture） |

### supremacyPoints.test.js（text 6）— R 3 / K 1 / D 2

| 行 | 守卫 | 处置 |
|---|---|---|
| 18–48 | pointsAt 纯函数 | D（已是行为） |
| 55 | 每 tick 无条件重算+残留清空 | R: createHudFeed tick → pointsFriend set；切换无 points 会话 → null | HIGH |
| 69 | teardown 归零 HUD 派生字段 | R: hudFeed reset → null；createBaseMarkers.clearBases() → [] |
| 87 | 中立→白 token | R: 中立 base 材质 0xf5f5f5 | LOW |
| 96 | 调色板常量单声明 | K（负面/重复守卫） |
| 105 | 弹道亮色调色板亮度 | R: 注入常量 lum 断言（注入契约行为） |

### rosterState.test.js — R 2 / D ~40（纯函数主体已是行为）

| 行 | 处置 |
|---|---|
| 22–251 | D（owner ./rosterState.js 行为测试） |
| 133 | R: createHudFeed → store rows === projectRoster(T) |
| 140 | R: 会话代际 bump → rosterRowsByEid 清空 |

### treadMarks.test.js — R 7 / D ~25

| 行 | 处置 |
|---|---|
| 20 | R: tick → tread.updateTrails spy（宿主接线 #888） |
| 23/26 | R: paused 时 setTreadMarks(false) → visible false 立即 |
| 31 | R: writeTreadBuffer total=52 → openSlot=2、drawRange、隐藏 quad |
| 43 | D（常量导入已是行为） | LOW |
| 46 | R: 乱序槽位 → alpha 按槽位 t |
| 53 | R: off→on 重置 L/R totals |
| 56 | R: fround 精度外差异 → 无 buffer 更新 |
| 62 | R: dispose spies；顺序子句 #888 |
| 79–398 | D（纯函数行为主体） |

### tankViewer.distance / cameraPreset / collisionBoxFailsafe

- distance:24 — **K**（真实守卫：setter 保姿态+无漂移；setter 迁出 façade 时再改写）
- cameraPreset:62/102/116 — **K**×3（preset 编排为宿主 glue；纯 placement 已由 viewer/cameraPresets.test.ts 覆盖）
- collisionBoxFailsafe:15/32 — **R HIGH**（缺 box → fail-closed 阻断、无 mesh-AABB 回退；owner `viewer/shotReplay`/`judgment` harness）
- collisionBoxFailsafe:26 — R: `viewer/shotResultCard` blockedNoPrimary → 概率不可重开
- collisionBoxFailsafe:37 — R: 1/255 量化分母数值解码断言（`viewer/shotReplayInterp`）

### armorCollisionPack.test.js（源码块 ~695-764）

- :710 初始接受阈值 — R（行为已在 :722 存在；viewer 侧 → judgment harness RC.MIN_CONTINUATION_T），之后删源码子句
- :753 GLSL 注入 sentinel — **PK**（断言的是导出 GLSL 模板串，语义上属公式逐字，提请复核）

### heHeatmapProjection.test.js — R 8 / D 1 / PK 2

| 行 | 处置 |
|---|---|
| 26 | R: heatmap rebuild → excludeMaterial.visible===true（HE 下） |
| 30 | PK（HE 伤害公式） |
| 39 | R-split: shotResultCard heChance/heFirstPrimary 行为；GLSL PK |
| 63 | R: heatmap handle → heGradientWanted/updatePenetrationUniforms spy |
| 76 | R HIGH: build→dispose→getPrimaryArmorScene()===null→重建非空 |
| 85 | R: refreshEquipmentEffects 无模式但有点击 → blast 清除 |
| 98 | R: applyArmorViewStyle 在 syncHeatOverlay 前（调用序）；façade 不可测则 K 接线 |
| 106 | R: fxScene 分离+autoClear+renderOrder 数值（shotTrajectoryGeometry 工厂 traverse → 997） |
| 129 | D（heSplash:21 已行为 fail-closed；grid 数值由 armorCollisionPack 覆盖） |
| 134 | R（并入 judgment harness：换弹重判/clipPlane）；卡宽 CSS PK |
| 142 | R: spacedSatBlocked → heDamageNorm 0 |

### heSplash.test.js — 行 29-35 源码串子句 D（保留行为半句）；其余已是行为

### viewer/collisionView.test.js — :217 façade 文本子句 D（行为半句同 case 已真实网格断言）

### 组件 wiring

- **MapPreview3DPane.wiring.test.js — R 8**（#888 模式：mount + spy）：
  - :15 HIGH loadMapOnly 不触 loadData；:85 HIGH loadMapOnly 会话门控+teardown 清 spawns+capture 监听
  - :24 LOW segmented 控制；:32/39/48/61/74 MED mapId 键控、destroyScene 不动标注、bases/spawns 三触发、uiProfile 原地重着色
- **BattlePlaybackHud.test.js** — 12 D（mount 已行为）+ 3 PK（CSS）
- **PlaybackRoster.test.js** — ~14 D + 3 PK（CSS）
- **TankConfigPanel.layout.test.js** — 4 PK（纯 CSS，文件自述归 browser gate）

---

## B. CSS 组（styles/*.test.js|ts）

接替者事实（agent 已读源验证；浏览器门禁执行均 [UNVERIFIED]）：
- `stylelint.config.mjs`：color-no-hex + function-disallowed-list(rgb/rgba/hsl/hsla) + declaration-strict-value；但 `stylelint.legacy.json` 忽略 ProfilePage.vue、MarkdownContent.vue、BattlePlaybackPanel.vue。
- `browser-home-reduced-motion.mjs`（home-glass-accessibility 场景）：默认 blur(16px) 门槛 :265-266、reduce→backdrop none :274、contrast→none :282、双偏好 :288-292、per-theme :316-321。
- `browser-battle-data-spawn-bar.mjs`：三段出生条 computed backgroundColor :63-65 + 宽度 :55。

| 文件 | D | R | K | 要点 |
|---|---|---|---|---|
| agent-theme-css.test.js | 4（C×4 裸色→stylelint 覆盖，`#canvas-container` 转 inline disable 注释） | 9（var() 完整性×7→stylelint 自定义规则；E 收藏车边框→browser gate；别名契约） | 2（token 自检 meta、tankViewer 内联标记色 sync 契约） |
| light-theme-source-regression.test.js | 0 | 3（负半句 stylelint 覆盖、正半句需 browser gate computed-style） | 3（ProfilePage/MarkdownContent 在 legacy 基线、ReplayCapabilityTabs 所有权守卫） |
| glass-accessibility.test.js | 4（backdrop none×2、块序、无硬编码色） | 2（surface token 映射、border-strong 边界→扩展 home-glass 场景） | 0 |
| corner-shape.test.js | 0 | 2（radius+corner-shape 配对→自定义规则+index.html 构建检查；squircle @supports→browser gate） | 0 |
| hof-admin-tabs-css.test.js | 0 | 1（吸顶 Tab 条→无既有 browser 场景，需新建） | 1（全局表所有权守卫） |
| replay3d-hud-layout.test.js | 0 | 2（flex:none+横向滚动、coarse 命中面积→browser gate） | 0 |
| tokens/color-contrast.test.ts | 1（spawn-seg CSS 映射→spawn-bar gate computed 严格包含） | 0 | 3（对比度计算本身即行为测试；寒冬继承 bug 守卫） |

跨组发现：stylelint 无法表达正向 token 映射、跨声明配对、selector 优先级、var() 完整性、所有权——这些是 R 组的主体；`hof-admin-tabs-css.test.js:26` 文件头声称的 browser 覆盖实际不存在（需在 #827 补）。

---

## Top 10 优先用例（跨组）

1. seekPointer:59/66 seek 三游标+不回放历史（P0 回归）
2. MapPreview3DPane:15/85 地图会话隔离
3. occlusion:53 tracer 完成门/ribbon/impact 一次
4. sceneryMaterials:169 GLB 失败告警+proxy 回退
5. pickDebug:167/180 teardown 释放+stale 检查
6. heHeatmapProjection:76 dispose 后可重建
7. sceneryMaterials:1344 stale 检查后再发布
8. supremacyPoints:55 会话切换残留清空
9. sceneryMaterials:1333/497 地形 LOD 迟滞
10. sceneryMaterials:1283 shader 预热时序

## 备注

- 所有 REWRITE 锚点（owner 模块导出）已在映射当日验证存在；实施时需重新核对（探针曾临时改写生产源）。
- tankViewer.distance/cameraPreset 的 K 依赖源码切片执行；若 #827 后续禁止切片，需把 setter/preset 逻辑迁入可注入 owner（生产改动，另行决策）。
- PK 项合计约 34 处，须用户逐条复核后才能删除或保留。
