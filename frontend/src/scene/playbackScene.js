// 实时回放 three.js 场景内核：自上游 Agent 前端平移（会话生命周期修复版）。
// 渲染语义（位姿滤波/炮塔随动/弹道动画/分层地表/画质档/GLB 姿态）沿用既有实现；
// 唯一改动是原 DOM 面板触点（$('timer') 等）全部改写 store（playbackStore.ts）。
//
// WotBTools 唯一分叉（评审 P0-3 client-only 拓扑）：资产访问只走 assetProvider
//（?assets= 资产平面），上游的 /api/playback/*、/api/tank 同源服务端回退删除——
// 其余与上游逐行同源，上游渲染/生命周期修复随版本跟随。
//
// 会话生命周期（契约 v2 / 评审 P0-2）：同场景实例换回放必须 teardown 上一场——
// load A → dispose A → load B；路由/组件销毁 → dispose 当前会话。会话拥有的资源
// （车辆低模/GLB 克隆/标签/弹道特效/地图与地表纹理/GLB 模板缓存）显式 dispose，
// 异步资产加载带 generation guard（迟到完成不得污染新会话，迟到的已加载资源随旧
// 会话缓存一并释放）。GLB 模板缓存为 session-scoped：同 tank 会话内复用，会话结束
// 对 unique shared resources dispose 一次并清缓存（clone 共享模板资源，不逐克隆
// 深度 dispose）；cross-session refcount/LRU 不在本层。
import { confirm as appConfirm } from '../composables/useConfirm.js'
import * as THREE from 'three'

import { loadPlaybackData, mapStaticUrl, resolveMapKey } from './replaySource.js'
import { battleEndTime } from './battleEnd.js'
import { orientDiscUv } from './baseDecal.js'
import { ASSAULT_BASE_ID, SUPREMACY_BASE_IDS, baseView, foldAssaultProgress, foldSupremacyTransitions } from '../utils/baseStatus.js'
import { mapBases } from '../data/mapBases.js'
import { firstIndexAfter } from './seekPointer.js'
import { createDynRes } from './dynRes.js'
import { foliageClip } from './sceneryMaterials.js'
// 地面 pass SSOT（2026-10-14 抽层，用户裁示"直接完全照搬 3D 回放的代码"）：地形数据/几何、
// 分层地表材质与俯视烘焙共用同一份——此前烘焙不渲染地面，底图用客户端自带
// 地图图，与 3D 档实时分层渲染在夜图/带 lm 图上差异显著（见该模块头部）
import { loadTerrain } from './groundPass.js'
// 装配规则 / 场景装配 / 水面海岸线 / 走廊掩码 / 可破坏物索引 的消费随场景装配块
//（2026-10-24 Step A3）整体移至 playback/mapAssets.js；本文件只留地面装载与运行期消费。
// 逐图光照 SSOT（2026-10-14 抽层）：光照应用与俯视烘焙共用同一份——烘焙此前自持固定日光
// 常量（白 3.0 + 半球 2.4 + ACES 1.15），未随逐图光照落地而同步（见该模块头部）
//（pickDebug 的纯函数随拾取报告器移入 playback/pickReport.js；buildMeshOwnerMap 随场景
// 装配块移入 playback/mapAssets.js）
import { collectMaterialTextures, disposeObject3D } from './materialDispose.js'
import { lifeAt, defLifeAt } from '../utils/battlePlaybackV2.ts'
//（pruneForeignVariantsDetailed 随场景装配块移入 playback/mapAssets.js）
//（applyPose/applyDetachedTurrets 随车辆运行时出仓 playback/vehicleRuntime.ts，
//  sampleDetachedPose 一并随迁；本文件只留 spanStartAt/spansContainAt 消费）
import { spansContainAt } from './trackInterp.js'
import { visibilitySpansByEid } from '../replay-local/pose/vehiclePose.js'
//（ROSTER_GROUPS/applyRosterRuntime/buildRosterRows/projectRoster 随名册桥接出仓
// playback/hudFeed.js；hpPercentText 仍为本文件 HUD 消费）
import { hpPercentText } from './rosterState.js'
import { resolveExactMountedConfig, resolveMountedConfig } from './reloadBar.js'
import { applySupremacyPointsToStore } from './supremacyPoints.js'
import { COLOR_FRIENDLY, COLOR_ENEMY, COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY, teamColorOf } from './playback/palette.ts'
import { teamHpTotals } from './teamHpTotals.js'   //（perspectiveScore 随计分桥接出仓 playback/hudFeed.js）
// 战斗反馈时长：与 2D 共用同一组 canonical 常量（SSOT，避免两处各自漂移）
//（FLASH_MS/FLOAT_DMG_MS/GHOST_MS 随战斗反馈 transient 出仓 playback/battleRuntime.ts）
import { playableBounds } from '../data/playableBounds.js'
import { createLoadProgress } from './loadProgress.js'
import { createFrameMeter } from './frameMeter.js'
import { advancePlaybackTime } from '../utils/playbackClock'
import { activeEntityAt, resolveReplayClock } from '../replay-local/canonical/facts'
import { isPlaybackSpeed } from '../composables/usePlaybackTransport.js'
//（GLB 装载/悬挂求解/履带印 Buffer 写入随车辆与履带运行时出仓 playback/vehicleRuntime.ts、
//  playback/treadRuntime.ts，#820 Step 4；本文件只经 vehicles/tread 句柄调度）
import { assetProvider } from './assetProvider.js'
import { createSceneCore } from './playback/renderer.js'
import { createSessionLifecycle } from './playback/sessionLifecycle.ts'
import { createMapWorld } from './playback/mapWorld.ts'
import { createWaterReflectionRuntime } from './playback/waterReflectionRuntime.ts'
import { createVehicleRuntime } from './playback/vehicleRuntime.ts'
import { makeReplacedAt } from './playback/identity.ts'
import { createTreadRuntime } from './playback/treadRuntime.ts'
//（战斗表现/3D 标注场景层/标签 HUD 随 #820 Step 5 出仓 playback/battleRuntime.ts、
//  playback/annotationScene.ts、playback/labelsRuntime.ts；本文件只经句柄调度）
import { createBattleRuntime } from './playback/battleRuntime.ts'
import { createAnnotationScene } from './playback/annotationScene.ts'
import { createLabelsRuntime } from './playback/labelsRuntime.ts'
import { createBattleMarkerHost } from './playback/battleMarkerHost.ts'
import { createShaderPrewarm } from './playback/shaderPrewarm.ts'
import { createPerfProbe } from './playback/perfProbe.ts'
//（相机运行时/录像者视角/穿深着色随 #820 Step 4 出仓 playback/cameraRuntime.ts；
//  fly 接管/top·follow 相机/选中语义经 cameraRuntime 句柄调度）
import { createCameraRuntime, CAMERA_GROUND_CLEARANCE } from './playback/cameraRuntime.ts'
// 内核拆分（2026-10-24）：常量/纯函数/画质表
// 出仓到 ./playback/，点击拾取调试与边界带出仓为工厂；公开 API 经本文件 re-export，
// 导入方（Replay3DPane / 测试）零改动。
import { GRID_DT } from './playback/util.js'
import { QUALITY_PRESETS, qualityFeatures, shadowQualityEligible } from './playback/quality.js'
import { boolPref, persistBoolPref, resolveQualityKey } from './playback/preferences.ts'
import { installDebugProbes } from './playback/debugProbes.ts'
// 坦克接地阴影（#907 主干随迁）：选择/句柄生命周期 owner = contactShadowControl.ts（逐车挂接在 vehicleRuntime）。
import { createContactShadowControl } from './playback/contactShadowControl.ts'
import { tracerSpanSecs, occlusionCells, occlusionFootprintCells } from './playback/pure.js'
import { createPickReporter } from './playback/pickReport.js'
import { chainVisible } from './pickDebug.js'
import { createCameraTerrainClamp } from './playback/cameraTerrainClamp.js'
import { createBaseMarkers } from './playback/bases.js'
import { createSpawnMarkers } from './playback/spawns.js'
// 闭包分段（行数预算 500）：psP1 数据/画质/工具，psP2 运行时装配，psP3 帧循环/HUD，
// psP4 会话/时钟/seek/渲染器，psP5 公开 API。共享状态经 S 袋传递（入口持有 let 绑定）。
import { psP1 } from './playbackSceneP1.ts'
import { psP2 } from './playbackSceneP2.ts'
import { psP3 } from './playbackSceneP3.ts'
import { psP4 } from './playbackSceneP4.ts'
import { psP5 } from './playbackSceneP5.ts'

export { QUALITY_PRESETS, tracerSpanSecs, occlusionCells, occlusionFootprintCells }
// 调色常量的消费方（bases.tracers.behavior 测试等）经本文件 re-export 零改动。
export { COLOR_FRIENDLY, COLOR_ENEMY, COLOR_UNKNOWN, TRACER_FRIENDLY, TRACER_ENEMY }

// 兜底灯光（读不到 lighting.json 时用，= 上游硬编码时代的两盏灯，保证无数据也不变样）
// 出屏口径（A2）：客户端发布版**没有任何 filmic 出屏曲线**。证据（客户端 Materials/Shaders
// 解出的 tmp_analysis/shaders，逐行核过）：
//   · Default/pbr-fp.sl:481-491 —— Uncharted2 与 Hejl/Burgess 两段曲线都注释掉，生效行是
//     注释写着 "Linear to sRGB conversion without tonemapping" 的 LinearToSRGB（坦克走这条）；
//   · Default/materials-fp.sl:385 —— 非 PBR 材质直写 outColor、不做任何变换（我们的自定义
//     伽马空间着色器同口径；本开关只作用于走 three 内建管线的材质 = 坦克，地面/布景不受影响）；
//   · Utilities/exposure-tonemapping-fp.sl:28-30 —— `1 - exp(-lum × exposure)` 同样注释掉，
//     生效行 `output.color.rgb = luminanceSample * exposure`（线性 × 曝光，**乘在显示空间**）。
// 出屏口径 = **客户端同式**：three 的 LinearToneMapping（`saturate(exposure × 线性色)` → sRGB 编码）
// 等价于客户端"线性 × 曝光 → 编码"；曝光取 1.0 = 纯客户端材质数学。不设 ?tonemap/?exposure 旋钮：
// 客户端曝光是**屏幕级自动曝光**（`[auto] property float exposure`），全客户端数据没有一个静态值
// 可抄 ⇒ 引入替代参数只会得到"必须手工调才对"的状态（2026-10-10 按此原则撤掉）。
// 共面接缝（地形与挡土墙顶/建筑基础**吸附齐平**，实测沿缝 92% |Δ|≤1 cm）不做任何人工深度偏移
// 或几何让步：客户端两条手法都没有——材质层 52/52 无 `DepthBias`/`SlopeScaleDepthBias`（见 docs），
// 几何层同一份数据同样共面。我们俯瞰时缝上的逐像素抢胜与客户端同源，属**相机差异**而非实现差异；
// 2026-10-10 按"只保留客户端有实际依据者"撤掉了此前的 `?poff` 与 `?seamfix` 两处人工补偿。
// 兜底灯光常量与逐图光照应用体自 2026-10-14 起在共享模块 mapLighting.js（SSOT，与俯视烘焙
// 同一份）：DEFAULT_HEMI_* / DEFAULT_SUN_INTENSITY 见文件头导入。

// 资产加载并发上限与有限并发映射在 ./playback/util.js（ASSET_CONCURRENCY / mapLimit）。

// 四档渲染预设（QUALITY_PRESETS，含档位语义注释）在 ./playback/quality.js；
// 纯函数 tracerSpanSecs / occlusionCells / occlusionFootprintCells 在 ./playback/pure.js
//（本文件 re-export，导入方零改动）。


/**
 * @param {HTMLElement} container
 * @param {{ [key: string]: unknown }} store
 * @param {HTMLElement|null} [labelOverlay]
 * @param {{ onVehicleSelect?: Function, onAnnotationCommit?: Function, onAnnotationErase?: Function, recorderReticle?: HTMLElement|null }} [options]
 */
export function initPlayback(container, store, labelOverlay = null, { onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle = null } = {}) {
  const S = {}
  const P = { container, store, labelOverlay, onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle }
  let DATA = null
  let VIS_BY_EID = new Map()
  let T = 0
  let PLAYING = false
  let SPEED = store.speed
  let START = 0
  let END = 0
  let sceneClock = null
  let canonicalClock = null
  let lifeTracks = null
  let lifeTracksByAccount = new Map()
  let renderer = null
  let scene
  let camera
  let controls
  let clock
  let raycaster
  let hemiLight = null
  let sunLight = null
  let sizeObserver = null
  let destroyed = false
  let MAP_BASES_KIND = null
  let MAP_SPAWN_POINTS = null
  let rafId = 0
  let paused = false
  let LOGDEPTH = boolPref('pb_logdepth', 'logdepth', false)
  let DYNRES = boolPref('pb_dynres', 'dynres', true)
  let ARMOR_HIGHLIGHT = boolPref('pb_armor_highlight', 'armorhl', false)
  let QKEY = resolveQualityKey()
  let Q = QUALITY_PRESETS[QKEY]
  let applyQualityFeatures = () => {}
  let requestWaterReflectionRefresh = () => {}
  let pickDownAt = null
  let followAnchor = null
  let frameDirty = true
  let lastRenderAt = 0
  let fpsIdle = false
  let winnerShown = false
  let dynResCtl = null
  let rendererCaps = null
  let hudWrittenMs = -Infinity
  Object.defineProperty(S, 'DATA', { get: () => DATA, set: (v) => { DATA = v }, configurable: true })
  Object.defineProperty(S, 'VIS_BY_EID', { get: () => VIS_BY_EID, set: (v) => { VIS_BY_EID = v }, configurable: true })
  Object.defineProperty(S, 'T', { get: () => T, set: (v) => { T = v }, configurable: true })
  Object.defineProperty(S, 'PLAYING', { get: () => PLAYING, set: (v) => { PLAYING = v }, configurable: true })
  Object.defineProperty(S, 'SPEED', { get: () => SPEED, set: (v) => { SPEED = v }, configurable: true })
  Object.defineProperty(S, 'START', { get: () => START, set: (v) => { START = v }, configurable: true })
  Object.defineProperty(S, 'END', { get: () => END, set: (v) => { END = v }, configurable: true })
  Object.defineProperty(S, 'sceneClock', { get: () => sceneClock, set: (v) => { sceneClock = v }, configurable: true })
  Object.defineProperty(S, 'canonicalClock', { get: () => canonicalClock, set: (v) => { canonicalClock = v }, configurable: true })
  Object.defineProperty(S, 'lifeTracks', { get: () => lifeTracks, set: (v) => { lifeTracks = v }, configurable: true })
  Object.defineProperty(S, 'lifeTracksByAccount', { get: () => lifeTracksByAccount, set: (v) => { lifeTracksByAccount = v }, configurable: true })
  Object.defineProperty(S, 'renderer', { get: () => renderer, set: (v) => { renderer = v }, configurable: true })
  Object.defineProperty(S, 'scene', { get: () => scene, set: (v) => { scene = v }, configurable: true })
  Object.defineProperty(S, 'camera', { get: () => camera, set: (v) => { camera = v }, configurable: true })
  Object.defineProperty(S, 'controls', { get: () => controls, set: (v) => { controls = v }, configurable: true })
  Object.defineProperty(S, 'clock', { get: () => clock, set: (v) => { clock = v }, configurable: true })
  Object.defineProperty(S, 'raycaster', { get: () => raycaster, set: (v) => { raycaster = v }, configurable: true })
  Object.defineProperty(S, 'hemiLight', { get: () => hemiLight, set: (v) => { hemiLight = v }, configurable: true })
  Object.defineProperty(S, 'sunLight', { get: () => sunLight, set: (v) => { sunLight = v }, configurable: true })
  Object.defineProperty(S, 'sizeObserver', { get: () => sizeObserver, set: (v) => { sizeObserver = v }, configurable: true })
  Object.defineProperty(S, 'destroyed', { get: () => destroyed, set: (v) => { destroyed = v }, configurable: true })
  Object.defineProperty(S, 'MAP_BASES_KIND', { get: () => MAP_BASES_KIND, set: (v) => { MAP_BASES_KIND = v }, configurable: true })
  Object.defineProperty(S, 'MAP_SPAWN_POINTS', { get: () => MAP_SPAWN_POINTS, set: (v) => { MAP_SPAWN_POINTS = v }, configurable: true })
  Object.defineProperty(S, 'rafId', { get: () => rafId, set: (v) => { rafId = v }, configurable: true })
  Object.defineProperty(S, 'paused', { get: () => paused, set: (v) => { paused = v }, configurable: true })
  Object.defineProperty(S, 'LOGDEPTH', { get: () => LOGDEPTH, set: (v) => { LOGDEPTH = v }, configurable: true })
  Object.defineProperty(S, 'DYNRES', { get: () => DYNRES, set: (v) => { DYNRES = v }, configurable: true })
  Object.defineProperty(S, 'ARMOR_HIGHLIGHT', { get: () => ARMOR_HIGHLIGHT, set: (v) => { ARMOR_HIGHLIGHT = v }, configurable: true })
  Object.defineProperty(S, 'QKEY', { get: () => QKEY, set: (v) => { QKEY = v }, configurable: true })
  Object.defineProperty(S, 'Q', { get: () => Q, set: (v) => { Q = v }, configurable: true })
  Object.defineProperty(S, 'applyQualityFeatures', { get: () => applyQualityFeatures, set: (v) => { applyQualityFeatures = v }, configurable: true })
  Object.defineProperty(S, 'requestWaterReflectionRefresh', { get: () => requestWaterReflectionRefresh, set: (v) => { requestWaterReflectionRefresh = v }, configurable: true })
  Object.defineProperty(S, 'pickDownAt', { get: () => pickDownAt, set: (v) => { pickDownAt = v }, configurable: true })
  Object.defineProperty(S, 'followAnchor', { get: () => followAnchor, set: (v) => { followAnchor = v }, configurable: true })
  Object.defineProperty(S, 'frameDirty', { get: () => frameDirty, set: (v) => { frameDirty = v }, configurable: true })
  Object.defineProperty(S, 'lastRenderAt', { get: () => lastRenderAt, set: (v) => { lastRenderAt = v }, configurable: true })
  Object.defineProperty(S, 'fpsIdle', { get: () => fpsIdle, set: (v) => { fpsIdle = v }, configurable: true })
  Object.defineProperty(S, 'winnerShown', { get: () => winnerShown, set: (v) => { winnerShown = v }, configurable: true })
  Object.defineProperty(S, 'dynResCtl', { get: () => dynResCtl, set: (v) => { dynResCtl = v }, configurable: true })
  Object.defineProperty(S, 'rendererCaps', { get: () => rendererCaps, set: (v) => { rendererCaps = v }, configurable: true })
  Object.defineProperty(S, 'hudWrittenMs', { get: () => hudWrittenMs, set: (v) => { hudWrittenMs = v }, configurable: true })
  psP1(S, P)
  psP2(S, P)
  psP3(S, P)
  psP4(S, P)
  return psP5(S, P)
}
