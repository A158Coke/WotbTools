// 实时回放 three.js 场景内核：自上游 Agent 前端平移（会话生命周期修复版）。
// 渲染语义（位姿滤波/炮塔随动/弹道动画/分层地表/画质档/GLB 姿态）沿用既有实现；
// 唯一改动是原 DOM 面板触点（$('timer') 等）全部改写 store（playbackStore.js）。
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
import { createConsumableStateResolver } from '../utils/consumableRuntime.js'
import { mapBases } from '../data/mapBases.js'
import { firstIndexAfter } from './seekPointer.js'
import {
  CLIENT_NORMAL_CAMERA_FOV_H,
  terrainLodState, terrainLodStale, terrainSurfaceHeightAt,
} from './terrainMesh.js'
import { treeFrame } from './destructibles.js'
import { writeHiddenInstance, fallMatrix } from './sceneryInstancing.js'
import { createDynRes } from './dynRes.js'
import { clearSceneryMatCache } from './sceneryMaterials.js'
// 地面 pass SSOT（2026-10-14 抽层，用户裁示"直接完全照搬 3D 回放的代码"）：地形数据/几何、
// 分层地表材质与俯视烘焙共用同一份——此前烘焙不渲染地面，底图用客户端自带
// 地图图，与 3D 档实时分层渲染在夜图/带 lm 图上差异显著（见该模块头部）
import { loadTerrain, buildGroundGeometry, makeGroundMaterial,
         groundLayerKeys, setupGroundTextures } from './groundPass.js'
// 装配规则 / 场景装配 / 水面海岸线 / 走廊掩码 / 可破坏物索引 的消费随场景装配块
//（2026-10-24 Step A3）整体移至 playback/mapAssets.js；本文件只留地面装载与运行期消费。
import { assembleMapScenery } from './playback/mapAssets.js'
// 逐图光照 SSOT（2026-10-14 抽层）：光照应用与俯视烘焙共用同一份——烘焙此前自持固定日光
// 常量（白 3.0 + 半球 2.4 + ACES 1.15），未随逐图光照落地而同步（见该模块头部）
import { applyMapLighting as applyMapLightingCore, resetMapLighting as resetMapLightingCore } from './mapLighting.js'
//（pickDebug 的纯函数随拾取报告器移入 playback/pickReport.js；buildMeshOwnerMap 随场景
// 装配块移入 playback/mapAssets.js）
import { collectMaterialTextures } from './materialDispose.js'
import { applyTankDestroyedVisual, destroyedVisualAmount, disposeTankDestroyedVisual, prepareTankDestroyedVisual } from './tankDestroyedVisual.js'
import { lifeAt, defLifeAt } from '../utils/battlePlaybackV2.ts'
//（pruneForeignVariantsDetailed 随场景装配块移入 playback/mapAssets.js）
import { sampleDetachedPose, spansContainAt } from './trackInterp.js'
import { sampleVehiclePoseGame, visibilitySpansByEid } from '../replay-local/pose/vehiclePose.js'
import { pathPointsOf, legSecsOf, legEndTimes, pointAtInto, legArcEnds, arcAtTime, pointAtArcInto } from './shotPath.js'
import { impactKind } from './impactKind.js'
import { TRACER_STREAK_M, createBattleFx, muzzleTipOf, trailOpacityAt } from './battleFx.js'
//（ROSTER_GROUPS/applyRosterRuntime/buildRosterRows/projectRoster 随名册桥接出仓
// playback/hudFeed.js；hpPercentText 仍为本文件 HUD 消费）
import { hpPercentText } from './rosterState.js'
import { createReloadStateResolver, resolveMountedConfig } from './reloadBar.js'
import { pointsAt } from './supremacyPoints.js'
import { teamHpTotals } from './teamHpTotals.js'   //（perspectiveScore 随计分桥接出仓 playback/hudFeed.js）
// 战斗反馈时长：与 2D 共用同一组 canonical 常量（SSOT，避免两处各自漂移）
import { FLASH_MS, FLOAT_DMG_MS, GHOST_MS } from '../utils/battlePlayback.js'
import { playableBounds } from '../data/playableBounds.js'
import { createLoadProgress } from './loadProgress.js'
import { createFrameMeter } from './frameMeter.js'
import { advancePlaybackTime } from '../utils/playbackClock'
import { activeEntityAt, resolveReplayClock } from '../replay-local/canonical/facts'
import { isPlaybackSpeed } from '../composables/usePlaybackTransport.js'
import { isFlySpeedIndex, FLY_SPEEDS, DEFAULT_FLY_SPEED_INDEX, advanceFly as tickFlyImpl } from '../composables/useSceneFlyControls.js'
import { poseFromYPR, yprScene, cloneDetachedTurret, neutralizeDefaultMetalness, dropDuplicateGunMasks } from './glbRig.js'
import {
  clampTravel, rateLimitTravel, spinStep, treadScrollStep, groundDropLocal,
  attachChainToWheels, solveChain, vertexChainParams, applyChainToVertices, chainChanged, chainDrift, sideTravel,
  parseWheelNodeName, parseTrackNodeName, wheelRadiusFromExtents,
  applyWheelSpin, measureBeltUvSlope, chainBottomRunDir, writeUvOffsetV,
} from './suspension.js'
// 地面履带印（TreadSystem 碾压痕）：生成/摆放纯函数；数据面 = 包内 tread/（上游
// tools/export_tank_tread.py），可行性与回落口径见上游 docs/feasibility-track-marks.md
import {
  advanceTrail, createTrailState, openStampOf, resetTrailState, resolveTreadParams,
  trailStampCorners, treadAlphaAt, treadScaleFor, TREAD_FADE,
  TREAD_FALLBACK, TREAD_RING,
} from './treadMarks.js'
import { assetProvider } from './assetProvider.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createSceneCore } from './playback/renderer.js'
// 内核拆分（2026-10-24，docs/current-plan.md Step A1 + 模式验证）：常量/纯函数/画质表
// 出仓到 ./playback/，点击拾取调试与边界带出仓为工厂；公开 API 经本文件 re-export，
// 导入方（Replay3DPane / 测试）零改动。
import { GRID_DT, ASSET_CONCURRENCY, mapLimit } from './playback/util.js'
import { QUALITY_PRESETS } from './playback/quality.js'
import { tracerSpanSecs, occlusionCells, occlusionFootprintCells } from './playback/pure.js'
import { createPickReporter } from './playback/pickReport.js'
import { createBoundaryBand, BOUNDARY_THICK } from './playback/boundary.js'
import { createBaseMarkers } from './playback/bases.js'
import { createHudFeed } from './playback/hudFeed.js'

export { QUALITY_PRESETS, tracerSpanSecs, occlusionCells, occlusionFootprintCells }

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

export function initPlayback(container, store, labelOverlay = null, { onVehicleSelect } = {}) {
  // ---------- 全局状态 ----------
  let DATA = null;                 // PlaybackData（当前会话）
  /** eid → 协议精确 AoI 段 flat [t0,t1,...]（来自 DATA.visibility；3D 炮塔/侧倾采样用） */
  let VIS_BY_EID = new Map();
  /** 共享位姿采样器的时间轴（DATA 就位时写入；见 replay-local/pose/vehiclePose.ts） */
  const POSE_GRID = { tStart: 0, samples: 0 };
  /** 位姿采样复用对象（每帧多车高频调用，零分配） */
  const _poseOut = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0,
  };
  let currentMapBases = null;
  // 阵营/中立调色（唯一事实源）：green / red / white——炮线、基地归属、标签共用；
  // 中立与未知阵营一律 white（unknown ≠ enemy）。
  // 阵营色深色板（2026-10-05 加深）：原亮绿/亮红在明亮地表上对比不足；
  // 统一到与车辆 tint 同源的深绿/深红（「与上游 Agent 同值」，`teamColor` 原已用此对），
  // 炮线与车辆着色共用一个事实源。
  const COLOR_FRIENDLY = 0x26794a;   // 深绿
  const COLOR_ENEMY = 0x98322a;      // 深红
  const COLOR_UNKNOWN = 0xf5f5f5;
  // 炮线专用亮色（与车辆 tint **分离**，2026-10-05 用户反馈"亮度/鲜艳度不够"）：
  // 两者取色目标相反——车辆 tint 要压得住（亮色在明亮地表上刺眼且车体显脏，已回退），
  // 炮线是细长高动态、只存在一两秒的物体，需要**字面亮度**才看得清（材质 toneMapped=false
  // 直出字面色，故提亮只能靠颜色本身与不透明度）。保持"绿=友 / 红=敌"色相，仅提亮提饱和。
  // 车辆/基地/标签**不得**改用这两个值（回退即车辆 tint 变亮）。
  const TRACER_FRIENDLY = 0x3ee08a;  // 亮绿（同色相提亮 #26794a）
  const TRACER_ENEMY = 0xff5a45;     // 亮红（同色相提亮 #98322a）
      // mapBases[资产面 map key]（基地几何；loadMapImage 解析后缓存）
  let currentMapKey = null;        // 资产面 map key（playableBounds 表索引）
  let V = [];                      // 车辆运行时 {def, group, turretG, gunPivot, labelAnchor, meshHull, glb}
  let T = 0, PLAYING = false, SPEED = store.speed;
  // 战斗时间轴 [START, END]：引擎是唯一权威（store.startTime / store.duration 只是发布）。0 = 开战，与 2D 同一个时钟：
  // 工作台 canonical 的 clock（面板经 setBattleClock 交给引擎）优先，canonical 未就绪 / 失败时用场景按同一
  // resolveReplayClock 从自身 periods 推出的 sceneClock，都没有才退回数据范围（t_start → battleEnd.js）。
  // 播放 / seek（seekTo / seekBy / seekFraction）/ 自动停止 / 进度比例 / 胜负横幅全部以它为准。
  let START = 0, END = 0;
  let sceneClock = null, canonicalClock = null;
  // Derived identity index only; ReplaySession still owns every canonical life fact.
  let lifeTracks = null, lifeTracksByAccount = new Map();
  let CAM = 'free', FOLLOW_EID = 0;
  let shotPtr = 0;   //（killPtr 随击杀 feed 出仓 playback/hudFeed.js）
  const tracers = [];
  const pendingMuzzles = [];   // 本 tick 开火、待炮管姿态摆完再定位的炮口特效（见 flushMuzzles）
  let renderer = null, scene, camera, controls, clock, raycaster;
  let hemiLight = null, sunLight = null;   // 逐图光照（applyMapLighting 覆盖，见 load 流程）
  let animLayerMats = [];                  // 动画混合层材质（uTime 每帧写回放秒数）
  let envTexture = null;                   // 逐图 IBL 环境贴图（scene.environment；会话拥有）
  let envMultiplier = 1;                   // 逐图 ibl.environmentMultiplier → scene.environmentIntensity
  let sizeObserver = null;
  let glbCache = new Map(), glbOn = false;
  // 履带印（tread/）逐车参数与贴图缓存：会话域（与 glbCache 同生命周期）。
  // 缺 json（424/735 辆无 authored 块）→ resolveTreadParams(null) 的产品回落（上游
  // feasibility §四），**不视为失败**——缓存正结果，避免逐帧重试 404。
  const treadParamCache = new Map();
  const treadTexCache = new Map();   // texture 相对路径 → THREE.Texture（逐会话共享、逐会话释放）
  let treadMetaPromise = null;       // /tread/textures.json（alpha 归一化系数表；失败 → {} 即全 1）
  let classIcons = false, showMarkerStatus = true;
  const classIconsVisible = () => classIcons && store.labelsOn;
  let mapPlane = null;
  let mapTexture = null, mapMetaInfo = null;          // 底图贴图 + 铺设参数
  // 分层地表（客户端 tilemask-fp.sl 实时合成）：{layers: 合成参数, texs: {cm,tile,mask,hmap}}。
  // 缺失（未导出/404）时回退整图烘焙底图
  let groundLayers = null;
  let terrainMesh = null, heightField = null, heightMeta = null;  // 3D 地形
  const CAMERA_GROUND_CLEARANCE = 0.5;  // 初值：小于地形起伏尺度，真实地图视觉校准由人工验收
  // 高度场只有一份（客户端同构：渲染/查询/放置全用真值场）。让位掩码（v0.4.2 的"渲染场"副本
  // 概念）与"贴地结构脚印"细分判据均已撤销（2026-10-11 用户裁示：只对齐客户端，不自创补偿）。
  let waterTexDispose = null;   // 水面海岸线用的高度场纹理（会话 teardown 释放）
  let mapScenery = null;                              // 静态场景 GLB（建筑等）
  // 贴地薄构件走廊掩码（terrainMesh.buildRefineMask 产物；随场景 GLB 一起失效）：
  // 语义判据 = 材质 extras.decal（客户端 MATERIAL_DECAL，"objects colored with landscape"——
  // 铁轨基板/压顶/铺装）。这些件只有 ~0.3 m 厚、净空常仅 3–30 cm，远视距会被自适应粗格插值
  // 抬过顶面盖住（2026-10-14 用户报障"拉远后部分铁轨被白色盖住"：250 m 机位实测 rails_003
  // 39.7% / rails_002 6.7% 的钢条顶点被盖）。2026-10-11 撤销的"让位掩码/脚印细分"是**改高度值**
  // 或全局改判据；这里是用户 2026-10-14 重新裁定的 B 方案：**只对走廊块强制细分**——不改任何
  // 高度值、廊外层级与客户端口径逐字节一致（回归锁见 terrainMesh.test.js）。
  let terrainRefineMask = null;
  // 可破坏地形（契约 additive：destructible_areas/events + map/destructibles.json）。
  // scenery = { states, appliedPtr, lastT, meshIdx }；Pivot 挂在 gltf.scene 内随
  // mapScenery 一起 dispose（会话生命周期同场景 GLB，无独立 teardown）。
  let destruct = null;
  let destructPickList = null;   // 拾取用全量实例清单（destructibles.json instances，与事件无关）
  let meshOwner = null;          // mesh → 实例 精确归属（buildMeshOwnerMap，拾取主路径）
  let groundMesh = null, gridHelper = null;           // buildWorld 的占位地面/网格（会话拥有）
  let destroyed = false;
  // 会话代数：loadData/teardown 各自递增，全部异步续体持旧代数即失效
  let sessionGen = 0;
  /** 加载令牌：只有新的 loadData 递增，用于判定「谁是最新一次加载」（见 loadData 注释） */
  let loadGeneration = 0;
  /**
   * 会话身份：当前「活着的会话」的标识。旧会话的资源续体用它判定自己是否已过期，
   * 而本次加载的资产阶段用它判定自己是否仍是当前会话（见 startPlayback）。
   * 与 sessionGen 分开的原因：teardown 是本次加载自己的提交流程，不能把自己判过期。
   */
  let sessionEpoch = 0;
  // 渲染帧句柄：destroy 显式 cancel（旧实现依赖 destroyed 标志的自然退出，
  // 帧回调在 destroy 后仍可能再排队一次）
  let rafId = 0;
  /**
   * 宿主可见性闸门（Replay3DPane 的 `active`）：工作台切到别的能力时停帧——
   * rAF、相机 update、标签/基地重绘全部停止，**不销毁场景**（切回不重解析、
   * 保留 timeline / 相机 / 画质档）。恢复时重置时钟，否则暂停期间累积的 dt
   * 会让第一帧直接跳进战斗。
   */
  let paused = false;
  // 诊断强引用仅在显式 debug 下创建（生产不挂 window.__scene 等长生命周期引用）
  const DEBUG = (() => { try { return new URLSearchParams(location.search).has('debug'); } catch (e) { return false; } })();
  // 点击拾取调试（pickDebug.js）：dev 构建且 ?admin=1 / ?debug=1 时，单击场景任意物体
  // 即报告节点名/场景坐标/destructibles 实例（id、serverId cell+slot）。生产构建恒关。
  const PICK_DEBUG = (() => {
    if (!import.meta.env.DEV) return false;
    try {
      const q = new URLSearchParams(location.search);
      return q.has('admin') || q.has('debug');
    } catch (e) { return false; }
  })();
  // 渲染性能偏好（播放组件 Display 面板可切，localStorage 持久化；URL 参数最高优先）。
  // - logdepth（对数深度）：默认**关**——每片元写 gl_FragDepth + 禁 early-z，对
  //   alpha-test 植被的填充率开销是乘法级（真机 A/B 权衡后默认关闭）；代价是 600m+
  //   俯瞰时贴地薄板/重建地形交叠带可能成片 z-fighting（开启即恢复确定性深度序）。
  // - dynres（动态分辨率）：默认**开**——持续超帧预算降 DPR、有余量升回档位上限
  //  （纯函数状态机 scene/dynRes.js），负载起伏的软着陆。
  const prefOf = (key, urlKey, dflt) => {
    try {
      const usp = new URLSearchParams(location.search);
      if (usp.has(urlKey)) return usp.get(urlKey) !== '0';
      const v = localStorage.getItem(key);
      return v == null ? dflt : v === '1';
    } catch (e) { return dflt; }
  };
  // 实例级可变量（非 const）：待开播阶段的偏好切换只持久化 + 同步 store——渲染器
  // 尚未创建，下次 initScene（按「开始」）自然按新偏好装配，无需重载；已在播放中
  // 不存在这两个开关（已移至待开播卡片）。
  let LOGDEPTH = prefOf('pb_logdepth', 'logdepth', false);
  let DYNRES = prefOf('pb_dynres', 'dynres', true);
  const persistPref = (key, on) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch (_) {} };

  // ---------- 画质分档 ----------
  // 解析优先级：URL ?q= > localStorage > 设备默认；四档都开 3D 地形（仅分段数降档）。
  // （预设表用模块级 QUALITY_PRESETS，与面板共享）
  function resolveQuality() {
    const usp = new URLSearchParams(location.search);
    let q = (usp.get('q') || '').toLowerCase();
    if (!QUALITY_PRESETS[q]) { try { q = localStorage.getItem('pb_quality') || ''; } catch (e) {} }
    if (!QUALITY_PRESETS[q]) {
      const mobile = !!window.__TAURI__ || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      // 移动/Tauri 默认**均衡**（真车模 + 无场景 GLB 下载税）；4K/Retina 想吃满
      // 填充率的显式选极致，桌面默认不背 DPR 2 的税。
      q = mobile ? 'mid' : 'high';
    }
    try { localStorage.setItem('pb_quality', q); } catch (e) {}
    return q;
  }
  let QKEY = resolveQuality(), Q = QUALITY_PRESETS[QKEY];
  store.qualityKey = QKEY;
  store.qualityLabel = '画质 · ' + Q.label;
  store.logdepth = LOGDEPTH;   // Display 面板开关的初始态（偏好解析见上方 prefOf）
  store.dynres = DYNRES;
  function setQuality(k) {
    if (!QUALITY_PRESETS[k] || k === QKEY) return;
    const apply = () => {
      QKEY = k; Q = QUALITY_PRESETS[k];
      try { localStorage.setItem('pb_quality', k); } catch (e) {}
      store.qualityKey = QKEY;
      store.qualityLabel = '画质 · ' + Q.label;
      applyGlbGate();
    };
    if (DATA) {
      // 已在播放：渲染参数一次性定型，切换档位需带新 ?q= 整页重载
      // （Tauri WebView 不弹 confirm 对话框，直接重载）
      // 应用内确认对话框（审计 PG-09：不用 window.confirm）；文案沿用本模块的上游中文
      const reload = () => {
        try { localStorage.setItem('pb_quality', k); } catch (e) {}
        const u = new URL(location.href); u.searchParams.set('q', k); location.replace(u);
      };
      if (window.__TAURI__) { reload(); return; }
      appConfirm({
        title: '切换画质',
        message: '切换到「' + QUALITY_PRESETS[k].label + '」画质将重新加载回放，继续？',
      }).then((ok) => { if (ok) reload(); });
      return;   // 取消则维持原档
    }
    apply();
  }
  // 低档强制盒子代理（14 车 ×数 MB GLB 下载 + PBR 填充率是移动端主要瓶颈之一）；
  // 高/极致反向强制 GLB（履带印轨距一致性，见 QUALITY_PRESETS 注）
  function applyGlbGate() {
    store.glbAllowed = Q.allowGlb && !Q.forceGlb;   // 强制档：开关停用（UI disabled + 提示）
    store.treadAllowed = !!Q.treadMarks;
    if (Q.forceGlb) {
      store.glbOn = true;
      if (!glbOn) applyGlbToggle(true);
    } else if (!Q.allowGlb) {
      store.glbOn = false;
      if (glbOn) applyGlbToggle(false);
    }
  }

  // ---------- 工具 ----------
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function idxOf(t) { return Math.floor((t - DATA.meta.t_start) / GRID_DT); }

  // 位姿求值：**唯一实现**在 `replay-local/pose/vehiclePose.ts`（2D 俯视与 3D 场景共用）——
  // 含 `pose_kf` 关键帧优先 / 10Hz 网格回退、以及炮塔绝对角 → 相对角的换算。
  // 本处只施加「场景系 = 游戏系 x 取负」的帧变换（符号约定见 glbRig.js 头注释）；
  // 车体侧倾 hull_roll 取自原始 type=10 volatile（滤波层不输出侧倾），旧产物缺列 → 0。
  const poseOf = (v, t) => sampleVehiclePoseGame(
    v.def, POSE_GRID, t, _poseOut, VIS_BY_EID.get(v.def.eid) ?? v.def.coverage,
  );
  function posAt(v, t, out) {
    const p = poseOf(v, t);
    out.set(-p.x, p.y, p.z);
    return out;
  }
  function yawAt(v, t) { return poseOf(v, t).yaw; }
  function hullPitchAt(v, t) { return poseOf(v, t).pitch; }
  function turretAbsAt(v, t) { return poseOf(v, t).turretAbs; }
  function gunPitchAt(v, t) { return poseOf(v, t).gunPitch; }
  const rollAt = (v, t) => poseOf(v, t).roll;

  function hpAt(v, t) {
    const hp = v.def.hp; let cur = v.def.max_hp;
    for (const [ht, hv] of hp) { if (ht <= t) cur = hv; else break; }
    return cur;
  }
  function canonicalLifeTrack(v, canonical) {
    const tracks = canonical.dataset.vehicles;
    if (tracks !== lifeTracks) {
      lifeTracks = tracks;
      lifeTracksByAccount = new Map(tracks.map(track => [track.accountId, track]));
    }
    return lifeTracksByAccount.get(v.def.account_id);
  }
  /** Use the producer's canonical identity evidence; older local sessions retain coverage-based identity. */
  function canonicalDeathAppliesTo(v, rawDeath, canonical) {
    const starts = canonical.entityStartsByAccount?.get(v.def.account_id);
    if (starts) return activeEntityAt(starts, rawDeath - canonical.clock.startRaw) === v.def.eid;
    const siblings = V.filter(candidate => candidate.def.account_id === v.def.account_id);
    if (siblings.length === 1) return Number.isFinite(rawDeath);
    const legacyStarts = new Map(siblings.map(candidate => [candidate.def.eid, candidate.def.coverage?.[0] ?? null]));
    return activeEntityAt(legacyStarts, rawDeath) === v.def.eid;
  }
  /** Canonical life uses battle-relative seconds; this render boundary returns raw seconds like T. */
  function sceneLifeAt(v, t) {
    const canonical = store.playbackSession?.canonical;
    if (canonical?.dataset?.vehicles && Number.isFinite(canonical.clock?.startRaw)) {
      const track = canonicalLifeTrack(v, canonical);
      const life = lifeAt(track, t - canonical.clock.startRaw);
      if (!life) return null;
      if (life.lifeState === 'DESTROYED') {
        const transition = track.lifeTransitions.find(item => item.lifeState === 'DESTROYED');
        const death = (life.destroyedKnownAtSec ?? transition?.timeSec) + canonical.clock.startRaw;
        if (!canonicalDeathAppliesTo(v, death, canonical)) return null;
      }
      return {
        lifeState: life.lifeState,
        destroyedKnownAtSec: Number.isFinite(life.destroyedKnownAtSec)
          ? life.destroyedKnownAtSec + canonical.clock.startRaw : null,
      };
    }
    // Canonical may still be loading/fail: retain the existing authoritative scene fact, never HP.
    // def 层复活轨道感知（issue #622）：复活字段缺省 = 死亡终态（行为与既往逐位一致）。
    return defLifeAt(v.def, t);
  }
  function deathAt(v, t) { return sceneLifeAt(v, t)?.lifeState === 'DESTROYED'; }
  function visibleAt(v, t) {
    // 活车按**协议精确 visibility** 显隐（coverage 只保证"有采样"，短隐藏段不断开）；
    // 否则隐藏期仍会显示车辆并把炮塔/炮管插值到下一段。死亡残骸例外由 applyPose
    // 的 `|| dead` 保留。
    return spansContainAt(VIS_BY_EID.get(v.def.eid) ?? v.def.coverage, t);
  }
  // ---------- 自由飞行的 FPS 视角接管（用户裁定：旋转中心 = 镜头自身） ----------
  // **接管态 = CAM === 'free'（派生，非独立状态）**——独立布尔会被任何路径漏设/
  // 误清（表现 = FPS 转头与 OrbitControls 环绕/pan 漂移交替，用户实测两轮）。
  // 自由模式下：
  //   · 左键拖拽 = 转视角（yaw/pitch 直接作用在相机朝向上）；
  //   · 滚轮 = 沿视线推拉相机（OrbitControls 的 dolly 语义——推近/拉远，视角与视距不变）；
  //   · WASD/QE = 平移相机（flyTick → advanceFly，target 重钉 cam+dir×flyDist）。
  // 事件在 **container capture 阶段**拦截：祖先 capture 先于 canvas 的 target 阶段，
  // OrbitControls（挂 canvas）物理上收不到左键拖拽/滚轮。选中/拾取语义不变
  // （位移 ≤ SLOP 仍算单击，在 capture 处理器内联）。切回跟随/top 或销毁时恢复 controls。
  const flyLook = { active: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0, dist: 30 };
  // 接管态 = 自由模式（派生）。**不按输入设备开关**：`(pointer: fine)` 之类的能力
  // 探测在触屏笔记本 / 平板模式下会报 coarse，把整条接管链关掉（用户实测：WASD 全灭、
  // 拖拽退回 OrbitControls）。触屏走同一套手势：单指拖拽 = 转头，双指捏合 = 改视距。
  const flyMode = () => CAM === 'free';
  // 触屏多点手势状态：pointerId → 最新坐标；pinch = 双指捏合起点（d0 指距 / dist0 视距）
  const flyPointers = new Map();
  let flyPinch = null;
  // [fly] 埋点：?debug 下走 console.info（默认级别可见，排障不用勾 Verbose）；
  // 非 debug 走 console.debug（默认隐藏）。每次交互只输出个位数行。
  const flyDbg = (tag, extra) => {
    const line = `[fly] ${tag} ${extra !== undefined ? extra : ''} cam=${CAM} enabled=${controls ? controls.enabled : '?'} yaw=${flyLook.yaw.toFixed(2)} pitch=${flyLook.pitch.toFixed(2)} dist=${flyLook.dist.toFixed(0)}`;
    if (DEBUG) console.info(line); else console.debug(line);
  };
  let flyMoveLastLog = 0;

  /** 从当前相机→target 向量反解 yaw/pitch（进入自由模式的朝向基准）。
   *  顶视（top→free）反解出 pitch≈±π/2 会让 WASD 的水平投影 fwdLen≈0（无法移动）——
   *  |pitch| 接近天顶/天底时回落到斜俯视（保留 yaw）：从正俯视过渡到斜俯视是自然的
   *  模式切换，换来飞行立即可用。 */
  function flyLookSyncFromCamera(tag = null, preserveVertical = false) {
    const dx = controls.target.x - camera.position.x;
    const dy = controls.target.y - camera.position.y;
    const dz = controls.target.z - camera.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    flyLook.dist = dist;
    flyLook.yaw = Math.atan2(-dx, -dz);              // yaw：绕 y（0 = 看 -z）
    const rawPitch = Math.asin(Math.max(-1, Math.min(1, dy / dist)));
    // 天顶/天底附近回落到斜俯视：**保持原朝向的上下符号**（俯视=向下看，pitch 仍为负）。
    // 旧实现 `-0.6*sign(rawPitch)` 把俯视翻成仰视（target 跑到地图上空、WASD 水平分量为 0）。
    flyLook.pitch = !preserveVertical && Math.abs(rawPitch) > Math.PI / 2 - 0.25
      ? 0.6 * Math.sign(rawPitch || 1)
      : rawPitch;
    if (tag) flyDbg(`sync(${tag})`);   // 逐帧对齐（tick）不埋点，防按住键时刷屏
  }
  /** 相机被**外部路径**改过（初始视野 fit / 名册跟随退出 / 钳制）后，flyLook 会与
   *  实际 cam→target 不一致——交互起点先对齐，否则首帧拖拽/飞行会把 target 跳到
   *  旧朝向×旧视距上（用户实测：进入自由后第一次拖拽视距从 570 变 284）。 */
  function flyLookSyncIfStale(tag) {
    if (!controls || flyLook.active) return;
    const cp = Math.cos(flyLook.pitch);
    const ex = camera.position.x - Math.sin(flyLook.yaw) * cp * flyLook.dist;
    const ey = camera.position.y + Math.sin(flyLook.pitch) * flyLook.dist;
    const ez = camera.position.z - Math.cos(flyLook.yaw) * cp * flyLook.dist;
    const d = Math.hypot(ex - controls.target.x, ey - controls.target.y, ez - controls.target.z);
    if (d > 0.05) flyLookSyncFromCamera(tag);
  }
  /** free↔其他模式切换的 OrbitControls 侧状态迁移（enabled/damping/惯性清理）。 */
  function flyLookApplyMode(mode) {
    if (mode === 'free') {
      if (controls) {
        controls.enabled = false;
        controls.enableDamping = false;
        flyLookSyncFromCamera('enter free');   // 进入自由：以当前视野为基准（top 的天顶朝向在此回落）
      }
    } else {
      // 离开自由：手势状态一并清空（触屏指针表 / 捏合起点 / 转头态）
      flyPointers.clear();
      flyPinch = null;
      flyLook.active = false;
      emptyDownAt = null;
      if (controls) {
        controls.enabled = true;
        controls.enableDamping = true;
        controls.__flyDist = null;
      }
    }
  }
  function flyLookApply() {
    const cp = Math.cos(flyLook.pitch);
    const dir = { x: -Math.sin(flyLook.yaw) * cp, y: Math.sin(flyLook.pitch), z: -Math.cos(flyLook.yaw) * cp };
    controls.target.set(
      camera.position.x + dir.x * flyLook.dist,
      camera.position.y + dir.y * flyLook.dist,
      camera.position.z + dir.z * flyLook.dist,
    );
    // 相机朝向必须显式重算：free 模式跳过 controls.update()（它的球面状态会与
    // target 重钉互相污染），而 update() 正是平时调用 camera.lookAt(target) 的地方——
    // 只改 target 不 lookAt，拖拽时 target 在动、画面却完全不转（用户实测）。
    camera.lookAt(controls.target);
  }
  /** 沿当前视线推拉相机（OrbitControls 的 dolly 语义 = 滚轮/捏合缩放）：相机与 target
   *  同步平移，视角与视距保持不变。step > 0 前进（推近），step < 0 后退（拉远）。
   *  只改 flyLook.dist 而相机不动是没有画面变化的（用户实测「滚轮没有缩放」）。 */
  function flyDolly(step) {
    if (!step) return;
    const cp = Math.cos(flyLook.pitch);
    const dx = -Math.sin(flyLook.yaw) * cp;
    const dy = Math.sin(flyLook.pitch);
    const dz = -Math.cos(flyLook.yaw) * cp;
    camera.position.x += dx * step;
    camera.position.y += dy * step;
    camera.position.z += dz * step;
    controls.target.x += dx * step;
    controls.target.y += dy * step;
    controls.target.z += dz * step;
    constrainFreeCameraAltitude();
    camera.lookAt(controls.target);
    invalidate();
  }

  // ---- container capture 拦截（祖先 capture 先于 canvas target 阶段）----
  //（SCENE_CLICK_SLOP_PX / emptyDownAt 沿用原选中语义的声明——同一闭包作用域）
  function onFlyCaptureDown(e) {
    if (!controls) return;
    if (flyMode()) {
      // 进入自由模式：OrbitControls 让位（enabled=false 后其处理器自忽略，
      // capture 先行是双保险）；本处理器接管拖拽 + 单击选中
      if (controls.enabled) controls.enabled = false;
      flyLookSyncIfStale('drag');
      flyDbg('down', `button=${e.button} type=${e.pointerType || 'mouse'}`);
      if (e.pointerType === 'touch') {
        flyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (flyPointers.size >= 2) {
          // 双指 = 捏合缩放（沿视线推拉相机）；本次手势不再转头、也算不上单击
          const [a, b] = [...flyPointers.values()];
          const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          flyPinch = { d0, dist0: flyLook.dist, applied: 0 };
          flyLook.active = false;
          emptyDownAt = null;
        } else {
          flyLook.active = true;
          flyLook.lastX = e.clientX; flyLook.lastY = e.clientY;
          emptyDownAt = { x: e.clientX, y: e.clientY };
        }
      } else if (e.button === 0) {
        flyLook.active = true;
        flyLook.lastX = e.clientX; flyLook.lastY = e.clientY;
        emptyDownAt = { x: e.clientX, y: e.clientY };
      }
      // 指针捕获：拖出画布仍能收到 move/up。否则画布外松键会留下「幽灵拖拽」
      // （回到画布不按键也在转头）。
      try { container.setPointerCapture(e.pointerId); } catch (_) {}
      // 画布交互夺回键盘焦点：preventDefault 挡住了浏览器的焦点迁移，若不主动 blur，
      // 点过「自由」按钮后焦点仍留在该按钮上——空格 / ←→（播放传输）会落给按钮。
      const ae = document.activeElement;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 非 free：恢复 OrbitControls 并走原选中语义（onScenePointerDown 由 renderer 接线）
    if (!controls.enabled) controls.enabled = true;
  }
  function onFlyCaptureMove(e) {
    if (!flyMode()) return;
    if (e.pointerType === 'touch') {
      if (!flyPointers.has(e.pointerId)) return;
      flyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (flyPointers.size >= 2 && flyPinch) {
        const [a, b] = [...flyPointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        // 双指捏合 = 沿视线推拉相机：以**手势起点**为稳定基准算**累计目标**，
        // 再应用目标与已应用量之差。累计位移 = clamp((d−d0)/d0, ±0.5)·dist0：
        //  · 回到 d0 ⇒ 目标 0 ⇒ 精确回位（不随事件分批漂移）；
        //  · 单次触限只截断**累计目标**，不会丢掉后续回程位移（评审 P2：分别截断
        //    每次增量 + 无条件推进基准，会让 200→350→275→200 净退 0.25×视距）。
        const target = Math.max(-0.5, Math.min(0.5, (d - flyPinch.d0) / flyPinch.d0)) * flyPinch.dist0;
        const delta = target - flyPinch.applied;
        flyPinch.applied = target;
        flyDolly(delta);
        e.stopPropagation();
        return;
      }
    }
    if (!flyLook.active) return;
    // 已无按键 = 在画布外松了键（捕获没拿到 up）：结束拖拽，且不当作单击
    if (!e.buttons) { flyLook.active = false; emptyDownAt = null; return; }
    const now = performance.now();
    const logThis = now - flyMoveLastLog > 400;
    if (logThis) flyMoveLastLog = now;
    const events = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const dx = ev.clientX - flyLook.lastX, dy = ev.clientY - flyLook.lastY;
      flyLook.lastX = ev.clientX; flyLook.lastY = ev.clientY;
      const k = 0.0032;   // rad/px（与常见 FPS 灵敏度同量级）
      flyLook.yaw -= dx * k;
      flyLook.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, flyLook.pitch - dy * k));
    }
    flyLookApply();
    if (logThis) flyDbg('move(applied)');
    invalidate();
    e.stopPropagation();   // flyMode 下 OrbitControls 与场景单击语义都不再需要
  }
  function onFlyCaptureUp(e) {
    if (!flyMode()) return;
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    if (e.pointerType === 'touch') {
      flyPointers.delete(e.pointerId);
      if (flyPointers.size < 2) flyPinch = null;
      // 双指手势收尾（还剩一指 / 刚结束）：不把它当单击，也不继续转头
      if (flyPinch === null && flyPointers.size > 0) {
        flyLook.active = false;
        emptyDownAt = null;
        e.stopPropagation();
        return;
      }
    }
    // 单击判定（≤SLOP）与拖拽转头共存：按下记录起点、抬起位移 ≤SLOP 才算单击
    const wasActive = flyLook.active;
    flyLook.active = false;
    if (!wasActive || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - (emptyDownAt?.x ?? e.clientX), e.clientY - (emptyDownAt?.y ?? e.clientY));
    emptyDownAt = null;
    if (moved <= SCENE_CLICK_SLOP_PX) {
      // 单击：up 位置统一 raycast（命中车辆 → eid；空处 → null）
      const r = container.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(nd, camera);
      const hits = raycaster.intersectObjects(V.map(v => v.group), true);
      let eid = null;
      if (hits.length) {
        let o = hits[0].object;
        while (o && !o.userData.eid) o = o.parent;
        if (o) eid = o.userData.eid;
      }
      flyDbg('click', `eid=${eid}`);
      onVehicleSelect?.(eid, e);
    }
    e.stopPropagation();
  }
  function onFlyCaptureWheel(e) {
    if (!flyMode()) return;
    // 滚轮 = 沿视线推拉相机（OrbitControls 的 dolly 语义）：相机与 target 一起前进/后退，
    // 视角与视距保持不变。旧实现只改 flyLook.dist 而相机不动——target 只沿视线挪，
    // 画面毫无变化（用户实测「滚轮没有缩放」）。
    flyLookSyncIfStale('wheel');
    // 线性步进（对 |deltaY| 对称，往返可精确抵消）：一格鼠标滚轮（deltaY≈100）≈12% 视距；
    // 触控板的小 delta 逐次累积；单次上限 30%，防一帧飞越半个地图。
    const f = Math.max(-0.3, Math.min(0.3, -e.deltaY * 0.0012));
    flyDolly(flyLook.dist * f);
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `step=${(flyLook.dist * f).toFixed(1)}`);
  }
  function onFlyCaptureCancel(e) {
    flyLook.active = false;
    emptyDownAt = null;
    if (e) flyPointers.delete(e.pointerId);
    if (flyPointers.size < 2) flyPinch = null;
  }

  // ---------- 场景 ----------
  function initScene() {
    // 创建核心（渲染器/相机/控件/灯光/resize+pointer 接线）在 playback/renderer.js
    //（2026-10-24 Step A2 出仓；状态所有权仍在本闭包——解构写回可变绑定）
    const core = createSceneCore({
      container, quality: Q, logdepth: LOGDEPTH, dynres: DYNRES, debug: DEBUG,
      envTexture, envMultiplier,
      onResize, onPointerDown: onScenePointerDown, onPointerUp: onScenePointerUp,
      setFollow,
    });
    scene = core.scene; camera = core.camera; renderer = core.renderer;
    controls = core.controls; clock = core.clock; raycaster = core.raycaster;
    hemiLight = core.hemiLight; sunLight = core.sunLight;
    dynResCtl = core.dynResCtl; sizeObserver = core.sizeObserver; rendererCaps = core.rendererCaps;
    // FPS 飞行接管（capture 阶段挂 container——先于 canvas 的 target 阶段，
    // OrbitControls 物理收不到 flyMode 下的事件；down/up 的 renderer 接线仍服务
    // 非 free 模式的选中语义）
    container.addEventListener('pointerdown', onFlyCaptureDown, true);
    container.addEventListener('pointermove', onFlyCaptureMove, true);
    container.addEventListener('pointerup', onFlyCaptureUp, true);
    container.addEventListener('pointercancel', onFlyCaptureCancel, true);
    container.addEventListener('wheel', onFlyCaptureWheel, { capture: true, passive: false });
    if (CAM === 'free') flyLookApplyMode('free');   // 初始 CAM 可能已是 'free'（默认值）
  }
  function onResize() {
    if (!renderer) return;
    // 容器可能随名册布局改变高度；画布与投影必须跟随实际容器。
    const w = Math.max(1, Math.round(container.clientWidth));
    const h = Math.max(1, Math.round(container.clientHeight));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    invalidate();            // 视口变化：下一帧必须重绘
  }
  // 空处按下起点：pointerup 位移 ≤ 阈值才算「单击空处」（轨道旋转/平移的拖拽起点也在空处，
  // 拖拽不属于「点击其它地方」，不得把详情窗关掉）。
  const SCENE_CLICK_SLOP_PX = 4;
  let emptyDownAt = null;
  function onScenePointerDown(e) {
    // （free 模式的事件在 container capture 已拦截——此处只服务 OrbitControls 路径）
    if (e.button !== 0) return;
    if (PICK_DEBUG) pickDownAt = { x: e.clientX, y: e.clientY };   // 调试拾取独立记录（车辆命中路径也出报告）
    const r = container.getBoundingClientRect();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, camera);
    const hits = raycaster.intersectObjects(V.map(v => v.group), true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.eid) o = o.parent;
      emptyDownAt = null;
      // 车辆命中：选中延迟到 pointerup 判定（拖拽转头 ≠ 点击选中——飞行动作下
      // 按下即选会把"路过"的车辆选上；≤SLOP 才算单击，与空处单击同口径）
      if (o) { emptyDownAt = { x: e.clientX, y: e.clientY, eid: o.userData.eid, event: e }; }
    } else {
      emptyDownAt = { x: e.clientX, y: e.clientY, eid: null };
    }
  }
  function onScenePointerUp(e) {
    if (e.button !== 0) return;
    // 调试拾取：按下/抬起与拖拽判定独立于选中语义——车辆命中路径（emptyDownAt=null）
    // 同样出报告，且不会被前方车辆挡掉场景物体的调试报告
    if (pickDownAt) {
      const movedPick = Math.hypot(e.clientX - pickDownAt.x, e.clientY - pickDownAt.y);
      pickDownAt = null;
      if (movedPick <= SCENE_CLICK_SLOP_PX) reportPick(e);
    }
    if (!emptyDownAt) return;
    const moved = Math.hypot(e.clientX - emptyDownAt.x, e.clientY - emptyDownAt.y);
    const down = emptyDownAt;
    emptyDownAt = null;
    // 单击判定（≤SLOP）对自由飞行与 OrbitControls 路径同一口径：
    // 车辆命中 → 选中该 eid；空处 → 上报 null（宿主隐藏详情窗）。拖拽（>SLOP）不触发。
    if (moved <= SCENE_CLICK_SLOP_PX) onVehicleSelect?.(down.eid ?? null, e);
  }

  // ---------- 点击拾取调试（PICK_DEBUG；报告器在 playback/pickReport.js，纯函数在 pickDebug.js） ----------
  let pickDownAt = null;
  const pickReporter = createPickReporter();
  // 事件时刻的 ctx 快照（闭包内均为可变绑定，工厂创建期捕获会过期——契约见 pickReport.js 头注释）
  const pickCtx = () => ({
    clock: T, vehicles: V, scenery: mapScenery, terrainMesh, groundMesh,
    destruct, destructPickList, meshOwner, heightField, heightMeta,
    camera, raycaster, container, scene, terrainSpan: terrainSpanOf(),
  });
  function reportPick(e) { pickReporter.reportPick(e, pickCtx()); }
  // 报告组装/面板/标记的实现自 2026-10-24 起在 playback/pickReport.js（工厂 + ctx 快照）。

  // ---------- 地图边界带（几何在 playback/boundary.js 工厂；本处只留可玩范围解析） ----------

  // 优先 terrain meta 的 playableBounds（打包器从场景 MapBorderComponent 提取，新地图自带）；
  // 否则回退 mapCode 表。两者皆缺 → null（不画，不用车辆范围猜）
  function playableBoundsFor() {
    const pb = (heightMeta && heightMeta.playableBounds) || playableBounds[currentMapKey];
    if (!pb) return null;
    const sxMin = -pb.xMax, sxMax = -pb.xMin;   // 场景为 x 镜像系
    return { cx: (sxMin + sxMax) / 2, cz: (pb.yMin + pb.yMax) / 2,
             hx: (sxMax - sxMin) / 2, hz: (pb.yMax - pb.yMin) / 2 };
  }

  // 边界带工厂（boundaryGroup 由工厂私有持有；几何与 fail-closed 语义见 playback/boundary.js。
  // getScene 因 scene 在 initScene 才创建；groundY / disposeObject3D 是闭包内函数声明，
  // 创建期引用安全——调用时才求值）
  const boundaryBand = createBoundaryBand({ getScene: () => scene, disposeObject3D, groundY });
  function buildBoundary(bounds, thick) { boundaryBand.build(bounds, thick); }

  // 相机距离钳制（禁止无限 zoom-out）：min/max 基于 world extent，初值实测后再调
  function applyCameraClamp() {
    const { ext } = WORLD_CENTER;
    controls.minDistance = Math.max(20, ext * 0.08);
    controls.maxDistance = ext * 2.2;
  }

  // 相机目标钳制在战场范围内（拖到天边会让地形/边界消失、只剩背景色）
  function clampCameraTarget() {
    if (FOLLOW_EID) return;   // 跟随中：target 钉在坦克上（坦克恒在图内），不钳制
    const { cx, cz, ext } = WORLD_CENTER;
    // 钳制框 = max(世界范围, ext*1.1)：视野保护（拖到天边只剩背景色）不得反过来吞掉
    // 键盘飞行的位移（评审发现：ext 小的图上 lim≈±10，每帧把 target 拉回、WASD 挪不动
    // ——飞行需要覆盖整个地形 ±300 + 余量；拖拽保护语义仍保留，只是框必须够大）
    const lim = Math.max(ext * 1.1, 340);
    const t = controls.target;
    const nx = Math.min(cx + lim, Math.max(cx - lim, t.x));
    const nz = Math.min(cz + lim, Math.max(cz - lim, t.z));
    if (nx !== t.x) t.x = nx;
    if (nz !== t.z) t.z = nz;
  }

  function buildWorld() {
    // 数据范围（直接取自 DATA；去 2% 离群后取整百）。注意必须在 buildVehicles 之前也可用——
    // 运行时数组 V 此时尚未填充
    const xs = [], zs = [];
    for (const def of DATA.vehicles)
      for (let i = 0; i < def.pos.length; i += 9) { xs.push(def.pos[i]); zs.push(def.pos[i+2]); }
    xs.sort((a,b)=>a-b); zs.sort((a,b)=>a-b);
    const q = (a, f) => a.length ? a[Math.floor((a.length-1) * f)] : 0;
    const ex = Math.max(q(xs, .98) - q(xs, .02), 200) * 0.65;
    const ez = Math.max(q(zs, .98) - q(zs, .02), 200) * 0.65;
    const m = Math.max(ex, ez);
    let ext = isFinite(m) && m > 0 ? Math.ceil(m / 50) * 50 : 300;
    let cx = -((q(xs, .98) + q(xs, .02)) / 2), cz = (q(zs, .98) + q(zs, .02)) / 2;   // 云心后备：x 要镜像（场景系 x = -回放 x）
    // 相机中心用**地图可玩矩形**（车辆云心只作后备）——交火偏一侧的图（如运河）云心
    // 会大幅偏离地图中心：俯视/初始机位对不准，钳制框还会把跟随目标拽离坦克。
    // currentMapKey 由 startPlayback 在 buildWorld 之前解析（loadMapImage 幂等重用）。
    const pb = playableBoundsFor();
    if (pb) {
      cx = pb.cx; cz = pb.cz;
      const me = Math.ceil(Math.max(pb.hx, pb.hz) * 1.15 / 50) * 50;
      if (me > ext) ext = me;
    }

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ext * 2 + 100, ext * 2 + 100),
      new THREE.MeshLambertMaterial({ color: 0x202a36 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cz);
    // 占位地面平面**不再显示**：它只是"地图资产尚未加载"时的深色底板，与真实
    // terrainMesh/mapPlane 同处 y=0，会与水面的透明层叠在一起（透出暗色底，掩盖
    // 水的 alpha/mask 效果）。对象仍保留并入 scene——bbox 拟合（roots 列表）与拾取
    // 过滤（terrainMesh || groundMesh）都引用它，且 three.js 的射线检测不看 visible，
    // 故隐藏不改变任何交互行为。
    ground.visible = false;
    scene.add(ground);
    groundMesh = ground;
    const grid = new THREE.GridHelper(ext * 2 + 100, Math.floor((ext * 2 + 100) / 50), 0x3a4a5e, 0x273140);
    grid.position.set(cx, 0.02, cz);
    // 占位网格同样**不再显示**：它位于 y=0.02，正好压在水面（y=0）之上——会在地表、
    // 半透明水面（透出的是它而不是水下的地形/alpha 效果）以及地图外沿都画出一层蓝灰线。
    // 与上面的占位地面同口径：对象仍保留入 scene（拾取过滤 isWaterNode/terrainMesh 与
    // bbox 拟合都按对象引用走，不看 visible），只是不参与绘制。
    grid.visible = false;
    scene.add(grid);
    gridHelper = grid;
    // 边界只按权威可玩范围画（见 buildBoundary 的 fail-closed 说明）：此处地图资产
    // 尚未加载，命中 mapCode 表则先画，否则不画；rebuildGround 再按 terrain meta 重建
    buildBoundary(playableBoundsFor(), BOUNDARY_THICK);
    WORLD_CENTER = { cx, cz, ext };
    camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
    controls.target.set(cx, 0, cz);
    applyCameraClamp();   // 世界范围决定 min/max 距离（初值，实测再调）
  }
  let WORLD_CENTER = { cx: 0, cz: 0, ext: 300 };

  // ---------- 底图 + 3D 地形 ----------
  // 后端返回小地图贴图 + X-Map-Meta 铺设参数（size_m/x/z/rot90/flip_x）。
  // 方向约定：图上边 = 世界 +z，图右边 = 游戏 +x = 场景 −x（与 pos = (−x,y,z) 镜像自洽，
  // 故平面 rotation.z = π）。底图/高度场覆盖世界 [-300,+300]²（600m 方框，原点居中）。
  // terrain 端点返回 u16 LE 高度场（行 0=南，行主序）+ X-Terrain-Meta（size/zmax/span/terrainLayout，
  // 列口径见 terrainMesh.js `decodeTerrainField`）；
  // 有高度场时用起伏地形替换 2D 平面，404 时保持 2D。
  // SpeedTree 叶卡 billboard 材质（客户端 speedtree-materials-vp.sl 同构）：
  // POSITION=锚点 pivot，_corner=(角点偏移, pivot.w)。客户端每帧在【视空间】把
  // 角点偏移（旋转风摆相位后）加回锚点——叶卡恒面向相机，这是其树丛立体感的
  // 来源；静态渲染的展开角点则是"片层堆叠"观感的根因。COLOR_0=烘焙遮挡灰度：
  // 输出 = albedo × SH(标定 1.77) × (遮挡/遮挡均值)——按均值归一化保留内暗外亮
  // 的纵深变化，又不会把整体亮度压到校准水平之下（各图贴图明暗差异大，固定
  // 系数会把暗色贴图的灌木压成黑色）。风摆为动态效果，静态导出不参与。
  //
  // 场景 GLB 材质实例缓存（对齐上游）：同一（name,map,color,alphaTest,transparent,
  // opacity,occMean）复用同一材质对象。此前每个 mesh 各建一份——材质/着色器实例与
  // program 切换随 mesh 数线性膨胀，是场景侧最大的开销来源。
  // 生命周期：teardown 时随 mapScenery dispose 并清空本表（勿复用已 dispose 实例）。
  async function loadMapImage() {
    if (DEBUG) window.__destructStage = 'map-load';
    // 会话身份 guard：回放替换/销毁后，旧会话的地图资产续体一律失效——
    // 迟到的已加载纹理就地 dispose，不得写入新会话的共享状态或场景。
    // 用 sessionEpoch（不是 sessionGen）：新的 loadData / destroy 都会换掉身份，
    // 旧会话的资源续体因此无法再写共享 store。
    const epoch = sessionEpoch;
    const stale = () => destroyed || epoch !== sessionEpoch;
    // ASYNC SESSION RULE: await into locals → revalidate ownership → dispose obsolete
    // local resources → only then publish session state or mutate the scene.
    if (mapPlane) { scene.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; if (DEBUG) window.__terrain = null; }
    if (mapScenery) { scene.remove(mapScenery); mapScenery = null; }
    terrainRefineMask = null;   // 走廊掩码属场景 GLB，随它失效
    destruct = null;
    destructPickList = null;
    meshOwner = null;
    mapTexture = null; mapMetaInfo = null; heightField = null; heightMeta = null;
    if (waterTexDispose) { waterTexDispose.dispose(); waterTexDispose = null; }
    terrainLodPrev = null;   // 会话场景失效：下一场首帧必重建地形 LOD
    occlGrid = null;   // 标签遮挡候选格属于会话场景，随场景一起失效
    groundLayers = null;
    // 地面加载方式由画质档决定（低=小地图底图、中=高清烘焙底图、高=分层地表），3D 地形有高度场即开启
    // 地图端点用回放数字 id（与客户端 arenaTypeID → maps.yaml 同链）；
    // 显示名可能与解析器枚举名不一致，仅作后备
    const mid = DATA.meta.map_id || 0;
    const mapq = mid ? ('id=' + mid) : ('name=' + encodeURIComponent(DATA.meta.map_name || ''));
    // 静态资产面的 key 解析（必须在 mapq 构造之后——曾放在函数首行引用未初始化的
    // mapq，TDZ ReferenceError 让整个函数静默死亡，地图/地形/场景一个请求都不发，
    // 全画质档回退占位网格）
    const resolvedKey = await resolveMapKey(mapq).catch(() => null);
    if (stale()) return;
    currentMapKey = resolvedKey;
    store.mapKey = resolvedKey;
    currentMapBases = resolvedKey ? (mapBases[resolvedKey] || null) : null;
    // 资产阶段进度（审计 3D-23）：按画质档实际会请求的段登记，每段完成（含缺失降级）计满；
    // 分层地表按纹理张数、场景 GLB 按字节推进。写入 store.assetProgress（0–1）
    const progress = createLoadProgress((snap) => { if (!stale()) store.assetProgress = snap.fraction; });
    // 资产完整性：404/解码失败可以让该进度段结束（loadProgress 的完成=结束），但必须写
    // assetIssues/assetDegraded，不能表现为“健康完成”。核心缺失（map/terrain/scenery/lighting）
    // 置 assetDegraded；分层/IBL/可破坏物等可选件只记录、不降级整场。
    const assetIssues = [];
    store.assetIssues = assetIssues;
    store.assetDegraded = false;
    const noteAsset = (key, status, detail = '', { optional = false } = {}) => {
      // 迟到请求（切换会话 / reset 后的 reject）不得把旧诊断写进新会话的 store。
      if (stale()) return;
      const issue = { key, status, detail: String(detail || '') };
      assetIssues.push(issue);
      store.assetIssues = assetIssues.slice();
      if (!optional) store.assetDegraded = true;
      console.warn(`[map-assets] ${key}: ${status}${detail ? ' — ' + detail : ''}`);
    };
    const mapUrlPlanned = mapStaticUrl('map', undefined, resolvedKey);
    if (mapUrlPlanned) progress.expect('map');
    if (mapStaticUrl('terrain', undefined, resolvedKey)) progress.expect('terrain');
    if (Q.groundLayers && mapStaticUrl('groundmeta', undefined, resolvedKey)) progress.expect('ground');
    if (Q.scenery && mapStaticUrl('scenery', undefined, resolvedKey)) progress.expect('scenery');
    try {
      // 地面贴图统一用**契约化的 `ground.webp`**（±300 全幅，与 2D 底图同源同框）。
      // 曾用客户端 HUD 小地图（资产面 res=mini）省流量：实测它覆盖约 620 m —— 比 ±300 契约框
      // **多出外围一圈**（水面/场景在 Landscape 框外侧），按 600 m 铺会把内容压缩约 3%、并把圈外
      // 内容摊进边界（2026-10-16 用户裁定：以 ±300 为准，外圈不呈现）。
      // client-only：仅资产平面静态路径；未配置基址/索引未命中 → 无底图（回退网格），
      // 不存在服务端回退
      const mapUrl = mapStaticUrl('map', undefined, resolvedKey);
      if (!mapUrl) noteAsset('map', 'missing-url', resolvedKey ? 'ground.webp URL 为空' : '未解析到资产索引 key');
      else {
        const resp = await assetProvider.fetch(mapUrl);
        if (stale()) return;
        if (!resp.ok) noteAsset('map', `http-${resp.status}`, 'ground.webp 获取失败');
        else {
          const meta = JSON.parse(resp.headers.get('X-Map-Meta') || '{}');
          const blob = await resp.blob();
          if (stale()) return;
          const url = URL.createObjectURL(blob);
          let texture;
          try {
            texture = await new THREE.TextureLoader().loadAsync(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          if (stale()) { texture.dispose(); return; }
          mapMetaInfo = meta;
          mapTexture = texture;
          mapTexture.colorSpace = THREE.SRGBColorSpace;
          mapTexture.anisotropy = Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy());
          if (mapMetaInfo.flip_x) { mapTexture.wrapS = THREE.RepeatWrapping; mapTexture.repeat.x = -1; mapTexture.offset.x = 1; }
        }
      }
    } catch (e) { noteAsset('map', 'failed', e && e.message ? e.message : e); }
    if (stale()) return;
    progress.complete('map');
    // 逐图光照（客户端 DirectionalLightComponent → lighting.json）：方向/色/强度 + 环境色。
    // 读不到（旧包/未配置资产面）→ 保留兜底灯光（不阻断）。太阳方向此前是硬编码的
    // (120,260,80)，与各图真实太阳无关——删掉 flatShading（改用 authored 法线）后定向光
    // 第一次真正塑形，方向错误立刻显形（面向太阳的面反而暗，2026-10-09 用户报障）。
    try {
      const lmUrl = mapStaticUrl('lighting', undefined, resolvedKey);
      if (lmUrl) {
        const lresp = await assetProvider.fetch(lmUrl);
        if (stale()) return;
        if (lresp.ok) {
          const L = await lresp.json();
          if (stale()) return;
          applyMapLighting(L);
        } else {
          noteAsset('lighting', `http-${lresp.status}`, '保留兜底灯光');
        }
      }
    } catch (e) { noteAsset('lighting', 'failed', e && e.message ? e.message : e); }
    // 逐图 IBL（环境反射）：客户端 IBLComponent 的 specular 立方图（上游转等距柱状投影）。
    // 只影响 glTF PBR 材质（坦克）——自定义 ShaderMaterial（场景/地面/植被）不吃 enviroment。
    // `ibl.environmentMultiplier`（逐图 0.8–4.0）经 scene.environmentIntensity 施加（three r163+）。
    try {
      const iblUrl = mapStaticUrl('ibl', undefined, resolvedKey);
      if (iblUrl) {
        const iresp = await assetProvider.fetch(iblUrl);
        if (stale()) return;
        if (iresp.ok) {
          const blob = await iresp.blob();
          if (stale()) return;
          const url = URL.createObjectURL(blob);
          let tex;
          try {
            tex = await new THREE.TextureLoader().loadAsync(url);
          } finally { URL.revokeObjectURL(url); }
          if (stale()) { tex.dispose(); return; }
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          envTexture = tex;
          // 场景可能尚未创建（渲染器/场景惰性，资产阶段可早于 initScene）→ 有则立即挂、
          // 无则留待 initScene 末尾补挂（两种时序都覆盖）
          if (scene) {
            scene.environment = tex;
            scene.environmentIntensity = envMultiplier;
          }
        } else {
          noteAsset('ibl', `http-${iresp.status}`, '不设环境贴图', { optional: true });
        }
      }
    } catch (e) { noteAsset('ibl', 'failed', e && e.message ? e.message : e, { optional: true }); }
    try {
      // 3D 地形：仅资产平面静态路径 + terrain.json sidecar 尺度；无静态资产 → 保持 2D。
      // 读取与解码（span 自愈 / json-bin sha 配对 / 布局补正）在共享模块 groundPass.loadTerrain
      // ——俯视烘焙同一份；本处只做宿主接线（assetProvider/stale/会话写回）。
      // 米制高度场 = 场景系引擎顶点口径（见 terrainMesh.js `decodeTerrainField`）；
      // 网格 / sampleHeight / 拾取诊断 / 水面岸线全读这一份
      const { field, meta: tmeta, metaStatus, binStatus } = await loadTerrain({
        binUrl: mapStaticUrl('terrain', undefined, resolvedKey),
        metaUrl: mapStaticUrl('terrain-meta', undefined, resolvedKey),
        fetchFn: (u) => assetProvider.fetch(u),
        stale,
      });
      if (stale()) return;
      // 只在完整元数据下发布 heightField：loadTerrain 已 fail-closed，这里再守一次
      // size/layout，防止任何未来调用把它改成“有 field 就发布”（sampleHeight 的 n
      // 必须有限；缺失曾让 fx/fy 变 NaN，坦克贴地/遮挡全部失效）。
      if (field && Number.isFinite(Number(tmeta?.size)) && tmeta.terrainLayout !== undefined) {
        heightMeta = tmeta; heightField = field;
        // CAM 初始即 free；场景核先于异步地形初始化。发布高度场后一次性补齐初始相机约束。
        constrainFreeCameraAltitude();
      } else if (field) {
        noteAsset('terrain', 'incomplete-meta', '忽略高度场（回退 2D）');
      } else if (metaStatus === 404 && binStatus === 404) {
        noteAsset('terrain', 'missing', 'terrain.json + terrain.u16.bin 均 404（2D 回退）');
      } else {
        noteAsset('terrain', 'unavailable', `meta=${metaStatus} bin=${binStatus}（回退 2D）`);
      }
    } catch (e) { noteAsset('terrain', 'failed', e && e.message ? e.message : e); }
    if (stale()) return;
    progress.complete('terrain');
    // 客户端同款分层地表：colormap/lightmap/tile 细节/mask/(HeightBlend 高度图)，
    // tile 纹理前端按 textureTiling 平铺全分辨率采样——清晰度等同客户端，不受整图烘焙
    // 分辨率限制。任一分层缺失则整体回退烘焙底图。
    // 注意分层一律无 alpha（Chrome 把带 alpha 的 webp 预乘解码，GPU 侧会压暗
    // 近黑），第 4 通道在独立灰度图里（tile1/mask1/hmap1 的 R）。
    // 低/中档跳过分层地表：直接走整图烘焙底图（省 4–8 张纹理下载与显存）
    if (Q.groundLayers) try {
      const gmUrl = mapStaticUrl('groundmeta', undefined, resolvedKey);
      if (!gmUrl) {
        noteAsset('groundLayers', 'missing-url', '跳过分层地表（回退烘焙底图）', { optional: true });
      }
      else {
      const mresp = await assetProvider.fetch(gmUrl);
      if (stale()) return;
      if (mresp.ok) {
        const L = await mresp.json();
        if (stale()) return;
        // 纹理键集与上传契约在共享模块（groundPass：groundLayerKeys / setupGroundTextures）
        // ——俯视烘焙同一份；本处只做宿主 I/O（assetProvider/进度/stale）
        const need = groundLayerKeys(L);
        const texs = {};
        // 有限并发（4）：此前逐张 await 白等网络往返（6–8 张串行 = 6–8 个 RTT）。
        // 任一张失败仍整体回退（其余在飞的照常收下，失败分支统一 dispose）。
        let texDone = 0;
        const loaded = await mapLimit(need, ASSET_CONCURRENCY, async (k) => {
          if (stale()) return false;
          let okOne = false;
          try {
            const texUrl = mapStaticUrl('groundtex', k, resolvedKey);
            if (texUrl) {
              const r = await assetProvider.fetch(texUrl);
              if (stale()) return false;
              if (r.ok) {
                const blob = await r.blob();
                if (stale()) return false;
                const u = URL.createObjectURL(blob);
                let t;
                try {
                  t = await new THREE.TextureLoader().loadAsync(u);
                } finally {
                  URL.revokeObjectURL(u);
                }
                if (stale()) { t.dispose(); }
                else { texs[k] = t; okOne = true; }
              }
            }
          } catch { okOne = false; }
          progress.update('ground', ++texDone, need.length);
          return okOne;
        });
        if (stale()) {
          for (const k in texs) texs[k]?.dispose?.();
          return;
        }
        const ok = loaded.every(Boolean);
        if (!ok) noteAsset('groundLayers', 'incomplete', '部分分层纹理缺失（回退烘焙底图）', { optional: true });
        if (ok) {
          const ani = Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy());
          // tile/hmap Repeat 平铺 + 全部各向异性（colormap/mask 也开：掠射角下不糊）——
          // 契约实现见 groundPass.setupGroundTextures（两侧同一份）
          setupGroundTextures(texs, ani);
          groundLayers = { layers: L, texs };
        } else {
          // 半途失效/缺失：已加载的分层纹理就地释放，不留悬挂 GPU 资源
          for (const k in texs) texs[k]?.dispose?.();
        }
      } else {
        noteAsset('groundLayers', `http-${mresp.status}`, 'ground.layers.json 获取失败（回退烘焙底图）', { optional: true });
      }
      }
    } catch (e) { noteAsset('groundLayers', 'failed', e && e.message ? e.message : e, { optional: true }); }
    if (stale()) return;
    progress.complete('ground');
    // 诊断钩子：window.__gdbg 查看地表实际走的路径与已加载分层（仅 ?debug）
    if (DEBUG) window.__gdbg = { layers: !!groundLayers, texs: groundLayers ? Object.keys(groundLayers.texs) : [],
                                 meta: !!mapMetaInfo, sizeM: mapMetaInfo?.size_m ?? null };
    try {
      rebuildGround();
    } catch (e) {
      // 分层地表元数据形状错误（如缺 tiling）会在 groundShaderMaterial 抛错；这不是
      // 「无分层」而是资产故障——必须记降级，清掉坏层并用烘焙底图重试，且不能因此
      // 跳过后续场景 GLB。
      noteAsset('groundLayers', 'invalid', e && e.message ? e.message : e);
      if (groundLayers) {
        for (const k in groundLayers.texs) groundLayers.texs[k]?.dispose?.();
        groundLayers = null;
      }
      try { rebuildGround(); } catch (e2) {
        console.warn('地面重建回退失败（保留 2D 底图）:', e2);
      }
    }
    // 静态场景模型（建筑/桥/岩石，tools/export_map_glb.py 预生成；缺失静默跳过）。
    // GLB 为游戏系（z 上、+y 北），qFrame = Ry(π)·Rx(-π/2)（YXZ 序）转到回放场景系——
    // 与坦克 GLB 同一帧变换，纯旋转无镜像，绕序天然正确。
    // 低/中档跳过场景 GLB（单图 11–67MB 下载 + 大块显存，是画质档最大的分流项；
    // 均衡档定位 = 真车模 + 无场景下载税）；高档加载场景且地面走分层地表合成，
    // 均衡档地面走高清烘焙底图（无分层）
    if (Q.scenery) try {
      // 可破坏物清单（与场景 GLB 并行拉取；缺失/低档静默禁用该特性）
      // mapStaticUrl 返回完整 URL——assetProvider.json() 会再拼一次 base（逻辑路径专用），
      // 必须走透传的 fetch + resp.json()（与下方 terrain-meta 同款用法）
      const destructUrl = mapStaticUrl('destructibles', undefined, resolvedKey);
      const destructDocPromise = destructUrl
        ? assetProvider.fetch(destructUrl).then((r) => {
            if (!r.ok) noteAsset('destructibles', `http-${r.status}`, '可破坏物特性禁用', { optional: true });
            return r.ok ? r.json() : null;
          }).catch((e) => {
            noteAsset('destructibles', 'failed', e && e.message ? e.message : e, { optional: true });
            return null;
          })
        : Promise.resolve(null);
      if (DEBUG) destructDocPromise.then((d) => { window.__destructStage = d ? 'doc-ok' : 'doc-missing'; });
      const sceneryUrl = mapStaticUrl('scenery', undefined, resolvedKey);
      if (!sceneryUrl) {
        noteAsset('scenery', 'missing-url', '未配置资产面/未命中索引（无场景 GLB）');
      }
      else {
      const gltf = await new Promise((res) => {
        new GLTFLoader().load(sceneryUrl,
          (g) => res(g),
          (e) => { if (e) progress.update('scenery', e.loaded, e.lengthComputable ? e.total : 0); },
          () => res(null));
      });
      if (stale()) {
        if (gltf?.scene) disposeObject3D(gltf.scene);
        return;
      }
      if (!gltf || !gltf.scene) noteAsset('scenery', 'failed', 'scenery.glb 加载/解析失败（建筑/场景缺失）');
      if (gltf && gltf.scene) {
        // 装配（变体裁剪 → 材质分派 → 合批 → 可破坏物槽位 → 矩阵冻结）在
        // playback/mapAssets.js（2026-10-24 Step A3 出仓；ctx 快照 + 增量 writes，
        // stale 语义与原闭包逐段赋值 + 中途 return 一致——见该模块头注释）
        const asm = await assembleMapScenery(gltf, {
          DATA, Q, DEBUG,
          camera, renderer, scene, controls, terrainMesh,
          groundLayers, heightField, heightMeta, terrainSpan: terrainSpanOf(),
          stale, disposeObject3D, noteAsset, sampleHeight,
          // 掩码先写入宿主绑定再重建 LOD（评审 P2：否则首次重建拿到空掩码、
          // terrainLodPrev 置当前后不再失效，走廊细分在初始视角丢失）
          onRefineMaskBuilt: (mask) => { terrainRefineMask = mask; terrainLodPrev = null; maybeRebuildTerrainLod(); },
          // 挂载即归属（评审 P1 复核）：destructibles 悬挂期间 reset/切场，
          // teardownSession 也能看到并释放这批资源（原闭包在此点即时赋值的语义）
          onSceneryMounted: (group, waterTex) => { mapScenery = group; if (waterTex) waterTexDispose = waterTex; },
          destructDocPromise,
        });
        // stale 判定先于一切 writes 发布（评审 P1：stale 结果不得写回宿主——
        // 会覆盖新会话的 mapScenery/动画材质/遮挡表；过期资源已由模块就地回收）
        if (asm.stale) return;
        const w = asm.writes;
        if ('waterTexDispose' in w) waterTexDispose = w.waterTexDispose;
        if ('animLayerMats' in w) animLayerMats = w.animLayerMats;
        if ('mapScenery' in w) mapScenery = w.mapScenery;
        if ('terrainRefineMask' in w) terrainRefineMask = w.terrainRefineMask;
        if ('occlGrid' in w) occlGrid = w.occlGrid;
        destructPickList = w.destructPickList;
        meshOwner = w.meshOwner;
        destruct = w.destruct;
      }
      }
    } catch (e) {
      console.warn('场景模型加载失败（忽略）:', e);
      // 装配/变体裁剪/实例化等后续步骤抛错同样意味着建筑缺失，必须进入降级状态
      noteAsset('scenery', 'failed', e && e.message ? e.message : e);
    }
    if (stale()) return;
    progress.complete('scenery');
  }

  // 双线性采样世界 (x,z) 处高度（米）；无高度场/元数据不完整返回 0
  function sampleHeight(x, z) {
    if (!heightField || !heightMeta) return 0;
    const n = Number(heightMeta.size), span = Number(heightMeta.span);
    if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return 0;
    // 引擎口径（`Landscape::GetHeightAtPoint` 逐行）：`fx = hmSize·(x−min)/span` —— **除 size，
    // 不是 size−1**；整数部 = texel 下标、小数部 = 相邻 texel 间权重。此前用 `(n−1)`（等价于把
    // texel 当中心）⇒ 0.2% 水平拉伸：地图中部偏半格（0.59 m）、+x 边缘偏一整格（1.17 m）。
    // 挡土墙顶等"与某一 texel 等高"的结构在俯瞰下会把这点偏差放大成穿透（2026-10-09 报障）。
    const fx = (x / span + 0.5) * n, fy = (z / span + 0.5) * n;
    const x0 = Math.max(0, Math.min(n - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(n - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const at = (r, c) => heightField[r * n + c];
    const top = at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx;
    const bot = at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  }

  function sampleRenderedTerrainHeight(x, z) {
    const terrainBuild = terrainMesh?.geometry?.userData?.terrainBuild;
    if (!terrainBuild) return null;
    return terrainSurfaceHeightAt(terrainBuild, x, z);
  }

  /** Free Camera 的上限与俯视默认高度同源；地面下限只在有效高度场覆盖内生效。 */
  function constrainFreeCameraAltitude() {
    if (!flyMode() || !camera || !controls) return false;
    const { x, y, z } = camera.position;
    if (!Number.isFinite(y) || !Number.isFinite(controls.target.y)) return false;
    let minY = -Infinity;
    if (heightField && heightMeta) {
      const n = Number(heightMeta.size), span = Number(heightMeta.span);
      if (Number.isInteger(n) && n >= 2 && heightField.length === n * n
        && Number.isFinite(span) && span > 0
        && Number.isFinite(x) && Number.isFinite(z)) {
        // sampleHeight 的 corner 坐标域是 [-span/2, span/2)；外侧会被采样器夹到 edge texel。
        const half = span / 2;
        if (x >= -half && x < half && z >= -half && z < half) {
          // 地形高度异步发布早于网格装配；网格可用时按其局部 LOD 三角面 O(1) 采样，
          // 避免双线性高度低估非共面格子；装配前沿用高度场。
          const terrainY = terrainMesh
            ? sampleRenderedTerrainHeight(x, z)
            : sampleHeight(x, z);
          if (Number.isFinite(terrainY)) minY = terrainY + CAMERA_GROUND_CLEARANCE;
        }
      }
    }
    const maxY = topCameraDefaultHeight();
    if (!Number.isFinite(maxY)) return false;
    const constrainedY = Math.max(minY, Math.min(maxY, y));
    if (constrainedY === y) return false;
    const deltaY = constrainedY - y;
    camera.position.y += deltaY;
    controls.target.y += deltaY;
    camera.lookAt(controls.target);
    return true;
  }

  /** 地形世界跨度（渲染高度场的世界↔UV 换算也用同一式，杜绝与网格两处漂移）。 */
  function terrainSpanOf() {
    return mapMetaInfo?.size_m || heightMeta?.span || 600;
  }
  /** 构建/重建地形几何（客户端同构自适应细分）。实现与 UV 契约在共享模块 groundPass.js
   *  （buildGroundGeometry，俯视烘焙同一份）；本处只传相机/掩码等宿主参数。 */
  function buildTerrainGeometry() {
    const n = heightMeta?.size || 512;
    const span = terrainSpanOf();
    // 不传 tolScale = 1 = 客户端原口径（该参数仅供单测）
    return buildGroundGeometry({
      field: heightField, n, span,                  // 真值场一份到底（渲染/查询同源，客户端同构）
      cam: camera ? camera.position : { x: 0, y: 320, z: 0 },   // 兜底：原生相机距离量级
      fovY: camera && Number.isFinite(camera.fov) ? (camera.fov * Math.PI) / 180 : 0.8,
      aspect: camera && Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 16 / 9,
      // 阈值插值的 fov 按**客户端口径**传：引擎 `GetFOV()` 是相机配置的水平 fov、与画面宽高比无关
      // （宽高比只进投影项 tanFovY）。回放自由相机 = 客户端正常相机（无狙击镜档）⇒ 恒 normal。
      // 不传这个的话，窄画布会把「55° 竖直 × aspect」折算成小水平角、阈值滑向狙击镜档（放宽 ~1.8×）。
      hFovDeg: CLIENT_NORMAL_CAMERA_FOV_H,
      // 贴地薄构件走廊（B）：只在这些块强制细分到最细层，廊外层级与客户端口径逐字节一致。
      refineMask: terrainRefineMask,
      cx: mapMetaInfo?.x || 0, cz: mapMetaInfo?.z || 0,
    });
  }
  let terrainLodPrev = null, terrainLodAt = 0;
  /** 相机姿态变化时重建地形几何（见 terrainMesh.js `terrainLodStale`——滞回输入与
   *  `buildAdaptiveTerrain` 的判据同源：相机位置/视距/FOV/aspect）。视距单向滞回（拉近立即细化、
   *  拉远 ≥40% 才允许变粗）+ 侧向绕转（≥5% 视距）与 FOV/aspect 变化按新相机位置重算，两次重建
   *  至少隔 120 ms。保证网格**永不比客户端判据（同一相机位置）允许的层级更粗**——否则粗格插值会
   *  把地形抬到贴地薄结构之上（2026-10-10 用户"铁轨被盖、转视角又正常"）。重建成本 ≈ 一次四叉
   *  遍历（~18 ms/帧预算内节流）。 */
  function maybeRebuildTerrainLod(now = performance.now()) {
    if (!terrainMesh || !heightField || !camera || !controls) return;
    const cur = terrainLodState(camera, controls.target, camera.aspect);
    if (!terrainLodStale(terrainLodPrev, cur, now - terrainLodAt)) return;
    terrainLodPrev = cur;
    terrainLodAt = now;
    const old = terrainMesh.geometry;
    terrainMesh.geometry = buildTerrainGeometry();
    old.dispose();
    // 当前 camera pose 触发的 LOD 几何将在本帧渲染；按新网格重新约束，避免旧 LOD
    // floor 与替换后的三角面之间留下一帧/停驻时的穿地。
    constrainFreeCameraAltitude();
  }

  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）
  // 地面材质（客户端 Landscape/tilemask-fp.sl 非 PBR 路径的实时合成：GLOBAL_TINT /
  // SCALED_TILES / HEIGHT_BLEND 逐分支离线核对）已迁至共享模块 groundPass.js
  // `groundShaderMaterial`——3D 运行时与俯视烘焙共用同一份。
  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）的宿主流程如下。

  function rebuildGround() {
    if (mapPlane) { scene.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; }
    if (!mapTexture && !heightField) return;
    const meta = mapMetaInfo || {};
    const size = meta.size_m || heightMeta?.span || 600;
    if (heightField) {
      // 3D 地形：**客户端同构自适应网格**（见 terrainMesh.js；`LandscapeSubdivision` 逐行核对：
      // 顶点用 `Heightmap::GetPoint(x, y)` 落在 texel **原位**、高度取 texel 值，不平滑）。
      //   · 顶点世界坐标 = `x_j = (j/n − 0.5)·span`、`z_i = (i/n − 0.5)·span`（列 ↔ 场景 x、
      //     行 ↔ 场景 z，与 `sampleHeight` 的参数化互为逆）；
      //   · 最粗层 8×8 四边形（每格 n/8 texel），只按「下一层真高度 vs 本层双线性」的误差
      //     **按视距**细分（容差 = min(3 m, 0.014·d·tan(fov/2))）——高度图的厘米~分米级毛刺
      //     根本不进网格；顶点按 (i,j) 去重（法线跨叶连续）；
      //   · 层级不同处按「最粗相邻叶所在层级的**边界直线**」取高度（细侧折线落在粗侧直线上，
      //     端点递归）⇒ 无 T 型接缝（2026-10-09 用户"这次引入了横竖条纹"）。
      // ⚠️ 此前用 `PlaneGeometry(seg) + sampleHeight` 双线性采样：顶点与 texel 网格**错位**，
      // 陡坡/切槽处地形面沿坡向外探出 0.5–1.3 m（实测等高线水平探出 +0.5–0.75 m、同点高度
      // +0.04 中位/+1.34 最大）；随后逐 texel 全画又让毛刺全在 ⇒ 与结构齐平的接缝上被顶出来
      // （2026-10-09 用户"不规则地形突出于石板面"；"客户端无论如何看都没问题"即本 LOD 口径
      // 的直接结果）。
      const geo = buildTerrainGeometry();
      // 分层地表（客户端 tilemask-fp.sl 实时合成，tile 原生分辨率平铺）优先；
      // 缺失时回退整图烘焙贴图（已含烘焙光照，不受光材质避免二次压暗；
      // toneMapped=false 保持烘焙色彩逐像素对齐客户端）。材质选择在共享模块
      // groundPass.makeGroundMaterial（俯视烘焙同一份）。
      // 几何已直接建在场景系（顶点 = texel 中心的世界坐标）⇒ 不再旋转/平移
      terrainMesh = new THREE.Mesh(geo, makeGroundMaterial({
        layers: groundLayers && groundLayers.layers, texs: groundLayers && groundLayers.texs,
        size, cx: meta.x || 0, cz: meta.z || 0, mapTexture,
      }));
      scene.add(terrainMesh);
      constrainFreeCameraAltitude();
      if (DEBUG) window.__terrain = terrainMesh;   // 诊断/测试钩子：地形网格身份（免按几何猜）
    } else if (mapTexture) {
      const mat = new THREE.MeshBasicMaterial({ map: mapTexture });
      mat.toneMapped = false;
      mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mapPlane.rotation.set(-Math.PI / 2, 0, Math.PI + (meta.rot90 || 0) * Math.PI / 2);
      mapPlane.position.set(meta.x || 0, 0.04, meta.z || 0);
      scene.add(mapPlane);
    }
    // 边界按权威可玩范围重建（terrain meta 的 playableBounds 优先，否则 mapCode 表）；
    // 两者皆缺则不画（fail-closed，绝不用 terrain span 冒充战场边界）
    buildBoundary(playableBoundsFor(), BOUNDARY_THICK);
    // 地形异步就绪后把基地环带/HUD 重新贴回地表
    regroundBases();
  }

  function teamColor(v) {
    const f = DATA.meta.friendly_team, t = v.def.team;
    if (t === 0 || f === 0) return COLOR_UNKNOWN;   // 中立＝白（green / red / white 口径）
    // 深绿/深红（与上游 Agent 同值）：原 0x3fa66a/0xc05046 偏亮，明亮地表上对比不足
    return t === f ? COLOR_FRIENDLY : COLOR_ENEMY;
  }

  // ---------- 基地（争霸 A–D / 单基地）贴地标记（实现在 playback/bases.js；快照式工厂） ----------
  //（原节的语义注释与 fail-closed 判据随实现迁往该模块头）
  const bases = createBaseMarkers({
    getScene: () => scene, getCamera: () => camera,
    getData: () => DATA, getMapBases: () => currentMapBases,
    store, groundY,
  });
  function buildBases() { bases.build(); }
  function clearBases() { bases.clear(); }
  function regroundBases() { bases.reground(); }
  function updateBases() { bases.update(T); }

  function groundY(x, z) {
    return sampleHeight(x, z) + 0.12;
  }

  // ---------- 标签软遮挡（fast-pass）----------
  // camera → 标签锚点做一次视线检测：先撞地形或静态场景 → 该车标签被标记为 occluded。
  // 具体弱化强度由呈现层负责（3D 覆盖层按 utils/labelLayout.js 的
  // LABEL_OCCLUDED_OPACITY 加 `.label-occluded`）——**永不隐藏**，被挡只是明显变淡。
  // 只把地形与静态场景当 blocker，不含其他车辆。
  //
  // 成本控制（不让每个标签每帧都检测）：
  //   · 地形用高度场解析步进（LABEL_OCCL_SAMPLES 次 sampleHeight），不 raycast
  //     512² 地形网格（那是几十万三角形）；
  //   · 场景（建筑/树）才 raycast，且**每 occlStride 帧只检测一辆车**（轮转），
  //     其余帧复用上次结果；
  //   · 单次 raycast 超过 4ms（大图三角形多）自动拉长步长，避免掉帧。
  const LABEL_OCCL_SAMPLES = 16;
  const LABEL_OCCL_BUDGET_MS = 4;
  let occlCursor = 0, occlTick = 0, occlStride = 1, occlCostMs = 0;
  const _occlDir = new THREE.Vector3();

  // 场景遮挡候选格（**性能关键**）：早先对整个 `mapScenery` 做**递归全量**射线检测，
  // 会遍历**整张场景 GLB**（本工程实测 3000+ 节点、含全部树卡片批次）——
  // 单次可达数十~数百毫秒。它在"标签可见 + 正在播放"时按轮转触发，于是表现为
  // **打起来后间歇性整页卡死**（暂停时 `updateLabels` 不跑 → 立刻不卡，恢复播放过一会再卡）。
  // 现在改为：加载场景时把每个可见静态网格按**世界位置 + 包围球半径**登记进粗格
  // （16m），检测时只对"相机→锚点线段经过的格子"里的网格做 raycast。
  //（登记循环随场景装配块在 playback/mapAssets.js，格长常量 OCCL_CELL 亦在其内）
  /** 场景遮挡候选（加载期构建；null = 未建/旧路径） */
  let occlGrid = null;
  /** 单次检测的候选上限：超限直接判"不遮挡"（fail-open，宁可少淡一个标签也不掉帧） */
  const OCCL_MAX_CANDIDATES = 400;

  // 地形遮挡：沿 camera→anchor 采样高度场（地形高过视线即判遮挡）
  function terrainBlocksAim(cx, cy, cz, ax, ay, az) {
    if (!heightField || !heightMeta) return false;
    for (let i = 1; i < LABEL_OCCL_SAMPLES; i++) {
      const k = i / LABEL_OCCL_SAMPLES;
      const x = cx + (ax - cx) * k, z = cz + (az - cz) * k;
      const y = cy + (ay - cy) * k;
      if (sampleHeight(x, z) > y + 0.5) return true;
    }
    return false;
  }

  // 静态场景遮挡（建筑/树）：raycast，far 收到锚点之前。
  // **只对线段经过的粗格内的网格**做检测（见 occlGrid 注释）；候选超限则 fail-open。
  function sceneryBlocksAim(anchor) {
    if (!mapScenery || !raycaster || !occlGrid) return false;
    _occlDir.copy(anchor).sub(camera.position);
    const dist = _occlDir.length();
    if (dist < 2) return false;
    _occlDir.divideScalar(dist);
    const cands = [];
    const seenObj = new Set();
    for (const key of occlusionCells(camera.position.x, camera.position.z, anchor.x, anchor.z)) {
      const list = occlGrid.get(key);
      if (!list) continue;
      for (const m of list) {
        if (seenObj.has(m)) continue;
        seenObj.add(m);
        cands.push(m);
      }
    }
    if (!cands.length || cands.length > OCCL_MAX_CANDIDATES) return false;   // 无候选/超限 → fail-open
    const prevFar = raycaster.far;
    raycaster.far = dist - 1.0;   // 只关心锚点之前的遮挡物
    raycaster.set(camera.position, _occlDir);
    const hit = raycaster.intersectObjects(cands, false).length > 0;
    raycaster.far = prevFar;
    return hit;
  }

  function updateLabelOcclusion() {
    const n = V.length;
    if (!n) return;
    occlStride = Math.min(16, occlCostMs > LABEL_OCCL_BUDGET_MS
      ? occlStride + 1 : Math.max(1, occlStride - 1));
    if (++occlTick < occlStride) return;   // 未到检测帧：沿用缓存结果
    occlTick = 0;
    const v = V[occlCursor++ % n];
    if (!v || !v.labelAnchor || !v.group.visible || !store.labelsOn) return;
    const a = v.labelAnchor;
    let blocked = terrainBlocksAim(camera.position.x, camera.position.y, camera.position.z,
                                   a.x, a.y, a.z);
    if (!blocked) {
      const t0 = performance.now();
      blocked = sceneryBlocksAim(a);
      occlCostMs = performance.now() - t0;
    } else {
      occlCostMs = 0;
    }
    v.labelOccluded = blocked;
  }

  // HTML label contents are isolated in the child overlay, capped at 10 Hz.
  // Anchors use camera projection at render FPS without mutating Vue state.
  let reloadStateAt = () => null;
  // 定时消耗品状态 resolver（ACTIVE/COOLDOWN + 剩余秒）；startPlayback 重建，teardown 清空
  let consumableStateAt = () => [];
  // 会话级 mounted-configs（tank_id → tank/{id}.json）：弹容 N 的实际搭载配置联表源
  //（reloadBar.resolveMountedConfig 消费；startPlayback 重建，teardown 清空）
  let tankDataByTankId = new Map();
  let labelsWrittenMs = -Infinity;
  let labelsTime = null;
  // 上一轮快照里是否有正在装填（loading）的可见车：装填条是名牌唯一连续变化的元素
  // （HP/身份变化远低于此），有装填时按 ~30Hz 发布让进度平滑，其余时间维持 10Hz
  // （少触发整屏 VDOM patch）。
  let labelsReloadActive = false;
  const LABEL_INTERVAL_RELOAD_MS = 33;
  const LABEL_INTERVAL_IDLE_MS = 100;
  const labelClip = new THREE.Vector4();
  // 零分配锚点：所有车辆共用一个 scratch 喂 labelOverlay.setAnchor——overlay 侧契约是
  // **同步拷贝**进它自有的 per-eid 存储（见 PlaybackVehicleLabels3D.setAnchor），不持有
  // 调用方对象引用，因此逐帧逐车复用同一个对象是安全的（此前每帧每车新建一个对象）。
  const labelAnchorScratch = { x: 0, y: 0, visible: false, occluded: false, projected: false };
  function publishLabels(force = false) {
    if (!DATA || !labelOverlay || !store.labelsOn) return;
    const now = performance.now();
    const interval = labelsReloadActive ? LABEL_INTERVAL_RELOAD_MS : LABEL_INTERVAL_IDLE_MS;
    if (!force && (T === labelsTime || now - labelsWrittenMs < interval)) return;
    labelsWrittenMs = now;
    labelsTime = T;
    const canonicalVehicles = store.playbackSession?.canonical?.dataset?.vehicles || [];
    const classByAccount = new Map(canonicalVehicles.map((vehicle) => [vehicle.accountId, vehicle.tankClass]));
    const rows = V.map((v) => {
      const destroyed = deathAt(v, T);
      const current = hpAt(v, T);
      const pct = Number.isFinite(v.def.max_hp) && v.def.max_hp > 0
        ? Math.max(0, Math.min(100, current / v.def.max_hp * 100)) : null;
      const friendlyTeam = DATA.meta.friendly_team;
      const friendly = [1, 2].includes(friendlyTeam) && [1, 2].includes(v.def.team)
        ? v.def.team === friendlyTeam : null;
      const ghost = ghostByEid.get(v.def.eid);
      return {
        eid: v.def.eid, accountId: v.def.account_id, playerName: v.def.nickname || '', tankName: v.def.tank_name || '',
        tankClass: classByAccount.get(v.def.account_id) || '',
        friendly, destroyed, lastKnown: false,
        hp: { current, pct, state: destroyed ? 'DESTROYED' : 'CURRENT' },
        reload: destroyed ? null : reloadStateAt(v.def.eid, T),
        consumables: destroyed ? [] : consumableStateAt(v.def.eid, T),
        hpGhost: ghost ? { prevPct: (ghost.fromFrac + ghost.lossFrac) * 100, nextPct: ghost.fromFrac * 100 } : null,
        hpFlash: flashByEid.has(v.def.eid),
      };
    });
    labelsReloadActive = rows.some((r) => Array.isArray(r.reload)
      && r.reload.some((sh) => sh.state === 'loading'));
    labelOverlay.setLabels(rows);
  }
  function setLabelPrefs() {
    labelsTime = null;
    publishLabels(true);
    invalidate();
  }
  // 名牌锚点（= 名牌块底边）相对车体的世界抬升：这是"名牌挂在屏幕哪里"的唯一事实源。
  // 伤害数字在覆盖层里只量"相对锚点的几何"（见 PlaybackVehicleLabels3D.measureDamageLayout），
  // 屏幕位置每帧用当前 anchor 重算；关名牌 / 无血条 / 空名牌时覆盖层回退到这个锚点上方。
  // In symbol mode the icon replaces the hull at its projected position;
  // ordinary labels keep their headroom above the visible vehicle model.
  function labelLiftWorld(distance) {
    return classIconsVisible() ? 0.3 : Math.min(6, Math.max(3.25, distance * 0.045));
  }
  function updateLabels() {
    if (!labelOverlay) return;
    camera.updateMatrixWorld();
    for (const v of V) {
      const d = camera.position.distanceTo(v.group.position);
      v.labelAnchor.copy(v.group.position);
      v.labelAnchor.y += labelLiftWorld(d);
    }
    updateLabelOcclusion();
    for (const v of V) {
      labelClip.set(v.labelAnchor.x, v.labelAnchor.y, v.labelAnchor.z, 1)
        .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      const w = labelClip.w;
      const x = labelClip.x / w, y = labelClip.y / w, z = labelClip.z / w;
      // projected = 车辆在视锥内；visible = 名牌本身是否显示。两者必须分开：伤害数字是
      // 战斗反馈而不是名牌内容，关掉名牌后它仍要有落点（覆盖层里回退到锚点上方）。
      const projected = v.group.visible && w > 0
        && Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1
        && x >= -1 && x <= 1 && y >= -1 && y <= 1;
      labelAnchorScratch.x = projected ? (x + 1) * container.clientWidth / 2 : 0;
      labelAnchorScratch.y = projected ? (1 - y) * container.clientHeight / 2 : 0;
      labelAnchorScratch.projected = projected;
      labelAnchorScratch.visible = projected && store.labelsOn;
      labelAnchorScratch.occluded = v.labelOccluded;
      labelOverlay.setAnchor(v.def.eid, labelAnchorScratch);
    }
    publishLabels();
  }

  function buildVehicles() {
    // 低模车体：俯视六边形轮廓（平尾 + 尖首）挤压成棱柱，配合尾部散热格栅——
    // 炮管之外的第二重车头方向提示（GLB 关闭时的代理模型）
    const hullProfile = new THREE.Shape();
    hullProfile.moveTo(-1.6, -3.1);   // 左后
    hullProfile.lineTo(1.6, -3.1);    // 右后（尾部平直）
    hullProfile.lineTo(1.6, 1.15);    // 右舷
    hullProfile.lineTo(0, 3.1);       // 车首尖点（+z = 车头，与炮管同向）
    hullProfile.lineTo(-1.6, 1.15);   // 左舷
    hullProfile.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hullProfile, { depth: 1.05, bevelEnabled: false });
    hullGeo.rotateX(Math.PI / 2);     // 轮廓 y（车首方向）→ 世界 +z，挤出方向翻向 −y
    hullGeo.translate(0, 1.45, 0);    // 车体占 y ∈ [0.40, 1.45]（顶面接炮塔底）
    const trackGeo = new THREE.BoxGeometry(3.6, 0.75, 6.5);
    const turretGeo = new THREE.BoxGeometry(2.35, 0.85, 3.3);
    const gunGeo = new THREE.CylinderGeometry(0.14, 0.18, 5.4, 8);
    const grilleGeo = new THREE.BoxGeometry(2.0, 0.4, 0.5);
    for (const def of DATA.vehicles) {
      const color = teamColor({ def });
      const g = new THREE.Group(); g.userData.eid = def.eid;
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color }));
      const tracks = new THREE.Mesh(trackGeo, new THREE.MeshLambertMaterial({ color: 0x333a44 })); tracks.position.y = 0.42;
      const grille = new THREE.Mesh(grilleGeo, new THREE.MeshLambertMaterial({ color: 0x272e38 })); grille.position.set(0, 1.62, -2.8);
      const turretG = new THREE.Group(); turretG.position.y = 1.85;
      const turret = new THREE.Mesh(turretGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(1.15) }));
      turret.position.z = -0.25;
      const gunPivot = new THREE.Group(); gunPivot.position.set(0, 0.05, 1.5);
      const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x59636f }));
      gun.rotation.x = Math.PI / 2; gun.position.z = 2.4;
      gunPivot.add(gun); turretG.add(turret); turretG.add(gunPivot);
      // 低模侧同构：履带盒留组根、hull/grille/turretG 收进 __hullGroup（悬挂挂点，恒单位）
      const hullG = new THREE.Group(); hullG.name = '__hullGroup';
      hullG.add(hull); hullG.add(grille); hullG.add(turretG);
      g.add(tracks); g.add(hullG);
      if (def.is_author) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.3, 32),
          new THREE.MeshBasicMaterial({ color: 0xe8b23c, side: THREE.DoubleSide, transparent: true,
                                        opacity: .85, toneMapped: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
        ring.userData.keepWithGlb = true;   // GLB 模式下保留作者标记环
        g.add(ring);
      }
      const v = { def, group: g, turretG, gunPivot, meshHull: hull, hullGroup: hullG };
      // Capture clean proxy materials before the vehicle receives its wreck shader.
      v.detachedTurrets = (DATA.detached_turrets || []).filter(track => track.vehicle_eid === def.eid).map(track => {
        const root = new THREE.Group(); root.userData.eid = def.eid;
        const proxy = turretG.clone();
        proxy.position.set(0, 0, 0); proxy.quaternion.identity();
        // turretG is constructed immediately above as [turret mesh, gunPivot].
        proxy.children[1].rotation.x = -gunPitchAt(v, track.pose_kf.t[0]);
        root.add(proxy); root.visible = false; scene.add(root);
        return { track, root, proxy, proxyVisual: prepareTankDestroyedVisual(proxy), glb: null, glbVisual: null };
      });
      v.proxyVisual = prepareTankDestroyedVisual(g, { cloneMaterials: false });
      v.labelAnchor = new THREE.Vector3();
      // 履带印路径累积态（左右各一条；builtT = 已铺到的回放时刻，-∞ = 待全量重算）
      v.trail = { L: createTrailState(), R: createTrailState(), builtT: -Infinity };
      v.tread = null; v.treadMesh = null;
      if (Q.treadMarks) {
        Promise.all([treadParamsFor(def.tank_id), treadMetaFor()]).then(([tp, meta]) => {
          if (destroyed || !v.trail) return;
          // 宽度解析（客户端语义：forceManualWidth=false ⇒ 从履带几何现算）：
          // authored → 模型履带盒实测（suspParts.beltW）→ 常量回落。
          // ⚠️ 此刻 suspension 往往还没就位（参数 JSON 早于 GLB 到达），未 authored 车会先
          // 落到常量回落；`authoredWidth:false` 标记让 updateTrails 在 beltW 就位后**重解析
          // 并全量重建**（review P2 2026-10-11：旧写法把宽度永久锁成 0.6）。
          v.tread = {
            ...tp,
            authoredWidth: tp.width != null,
            width: tp.width != null ? tp.width : resolvedTreadWidth(v),
            texScale: treadScaleFor(meta, tp.texture),
          };
          ensureTreadMesh(v, v.tread);
          invalidate();   // 参数晚到：下一帧从 -∞ 全量补铺（builtT 未推进过，无空洞）
        }).catch((e) => {
          // fail-soft：资产源未配置（assetProvider.url 抛错）/贴图装配异常 ⇒ 该车无印记，
          // 绝不冒未处理拒绝（2026-10-11 CI 复盘：vitest 以 unhandled error 判失败——本机
          // .env.local 掩盖了无资产源形态；会话/地图资产链路本身有各自的错误呈现）。
          console.warn('[playback] 履带印装配失败（该车无印记）tank=' + def.tank_id + ':', e);
        });
      }
      scene.add(g);
      V.push(v);
      setLowPoly(v, true);
    }
  }

  // ---------- 地面履带印（TreadSystem 碾压痕） ----------
  // 数据面：包内 tread/<tank_id>.json（authored 311/735 辆）+ tread/textures/*.webp。
  // 生成 = 沿位姿路径按 authored manualSpace 铺段（treadMarks.js 纯函数）；呈现 =
  // 每车一个 InstancedMesh（两侧各自环形槽位），四边形经 trailQuadMatrix 贴地（随坡倾斜）。
  // seek 后退 = 复位路径态从 START 全量重算（与 destructibles 的"后退全量"同构）；
  // 前进 = 游标增量泵。开关关 → 网格整体隐藏且 builtT 退回 -∞（重开即全量补铺，语义 =
  // 印记由回放数据确定性生成，与播放/开关路径无关）。

  /** 每侧戳环槽数 = 客户端 TreadSystem 的固定环（反汇编 `(i+0x32)%0x32`，50 槽/侧）。
   *  ⚠️ **50 槽含 active/open 槽**（落锚函数 0x727b80：`head=write; write=(write+1)%50;
   *  count 封顶 50`）——逐帧拉伸的活戳占 write 槽（= total % cap），落锚后定型并推进，
   *  **没有独立的第 51 槽**。印记长度预算 = 50 × manualSpace 米，车后滚动收尾。 */
  const TRAIL_CAP_PER_SIDE = TREAD_RING;
  /** 槽位总数（左右交错）：50 槽/侧（含活戳）。 */
  const TRAIL_SLOTS = TRAIL_CAP_PER_SIDE * 2;
  /** 无 suspension 数据时的履带中心线横距（m）：低模履带盒半宽量级（产品回落，上游 feasibility §四） */
  const TREAD_HALF_GAUGE = 0.9;

  function treadParamsFor(tankId) {
    // tank_id 缺失/非法（车队识别失败等）：不发请求，直接产品回落（键 0 共享一个正结果）
    const key = Number.isFinite(tankId) && tankId > 0 ? tankId : 0;
    let p = treadParamCache.get(key);
    if (!p) {
      p = key > 0
        ? assetProvider.json(`/tread/${key}.json`)
          .then((j) => resolveTreadParams(j))
          .catch(() => resolveTreadParams(null))
        : Promise.resolve(resolveTreadParams(null));
      treadParamCache.set(key, p);
    }
    return p;
  }

  function treadMetaFor() {
    if (!treadMetaPromise) {
      treadMetaPromise = assetProvider.json('/tread/textures.json').catch(() => ({}));
    }
    return treadMetaPromise;
  }

  /** 模型履带条宽（两侧履带盒横向尺寸均值；无 suspension 数据 → 0 ⇒ 调用方回落常量） */
  function beltWidthOf(v) {
    const sp = v.suspParts && v.suspParts.sides;
    if (!sp) return 0;
    let sum = 0, n = 0;
    for (const key of ['L', 'R']) {
      const s = sp[key];
      if (s && s.beltW > 1e-3) { sum += s.beltW; n++; }
    }
    return n ? sum / n : 0;
  }

  /** 未 authored 车（`manual_width: null`，客户端 forceManualWidth=false 语义）的当前宽度：
   *  模型履带盒实测 beltW → 常量回落。authored 车恒用 manual_width、不走这里。 */
  function resolvedTreadWidth(v) {
    const beltW = beltWidthOf(v);
    return beltW > 1e-3 ? beltW : TREAD_FALLBACK.width;
  }

  function ensureTreadMesh(v, tp) {
    if (v.treadMesh || !scene) return;
    const SLOTS = TRAIL_SLOTS;                    // 50 槽/侧（含活戳，客户端 0x727b80 同构）
    const geo = new THREE.BufferGeometry();
    // 逐段 4 顶点的**动态合并几何**（不是 InstancedMesh）：四角必须各自独立贴地
    // （trailStampCorners），单个实例矩阵表达不了四角异高——正是首版"单平面 + 中心梯度"
    // 被粗格地形网格盖住（印记断续可见）的根因。position 逐段写；uv/index 全槽位恒定。
    const pos = new THREE.BufferAttribute(new Float32Array(SLOTS * 4 * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const uvArr = new Float32Array(SLOTS * 4 * 2);
    for (let s = 0; s < SLOTS; s++) uvArr.set([0, 0, 1, 0, 1, 1, 0, 1], s * 8);
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    // RGBA 顶点色：rgb 恒 1，a = 寿命淡出系数（treadAlphaAt，按回放时钟老化）——
    // 初始 0（未写槽位不可见；drawRange 之外本就不画，这里是防御）
    const col = new THREE.BufferAttribute(new Float32Array(SLOTS * 4 * 4), 4);
    col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', col);
    const idx = new Uint32Array(SLOTS * 6);
    for (let s = 0; s < SLOTS; s++) {
      const b = s * 4, o = s * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);               // 未写段的位置是全零：drawRange 挡住 + seek 回退缩窗口
    // 双面（review P2 2026-10-11）：戳的角序 [L0,R0,R1,L1] 跟车体朝向走，**倒车**时位移
    // 反向 ⇒ 固定索引产生朝下法线，默认 FrontSide 下被背面剔除（实测倒车印记从地面以上
    // 完全不可见：从上方向下 Raycaster 命中 0 三角形，DoubleSide 后命中）。贴地覆盖层
    // 走 MeshBasicMaterial 无光照，双面零代价。
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, vertexColors: true,
                                              side: THREE.DoubleSide });
    let tex = treadTexCache.get(tp.texture);
    if (!tex) {
      tex = new THREE.TextureLoader().load(assetProvider.url(tp.texture));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Q.anisotropy;
      treadTexCache.set(tp.texture, tex);
    }
    mat.map = tex;
    mat.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;           // 段遍布全场：包围球无意义
    mesh.renderOrder = 2;                 // 地形/底图之后
    mesh.matrixAutoUpdate = false;
    mesh.visible = store.treadOn;
    scene.add(mesh);
    v.treadMesh = mesh;
  }

  /** 单侧履带中心线的世界横距：suspension 解析出的 halfW 优先（模型实测），低模/无悬挂回落常数 */
  function trailHalfGauge(v, side) {
    const s = v.suspParts && v.suspParts.sides[side];
    return s && s.halfW > 1e-3 ? s.halfW : TREAD_HALF_GAUGE;
  }

  /**
   * 采样 [t0,T] 的两侧接地点序列并推进路径态（coverage 空洞断链；阵亡后静止不再出段）。
   *
   * **固定网格喂样**（review P2 2026-10-11）：只喂**完整 0.1 s 网格片**（片界按 [START] 对齐），
   * 且首点固定为 t0 时刻的横截面——片内交会点的插值只依赖片界样本 ⇒ seek 重算与逐帧连续
   * 播放**逐值一致**。旧实现从任意帧的 builtT 重切网格、首锚取第一次子步的 tt：首锚随帧
   * 时刻漂移（实测同一直线同终点：一次 seek 首锚 z=0.5/t=0.3，60fps 泵 z=0.083/t=0.217，
   * 转弯处几何还有差异）。不足整片的尾巴**留待下次**：返回值为最后已喂的网格时刻（不是 T），
   * 调用方以此作 builtT——尾巴在网格片完成前不上屏，语义与"逐帧推进"等价。
   *
   * @returns {number} 已喂到的回放时刻（网格对齐；无完整片可喂时 = t0）
   */
  function feedTrail(v, tr, t0) {
    const space = v.tread.space;
    const hwL = trailHalfGauge(v, 'L'), hwR = trailHalfGauge(v, 'R');
    const def = v.def;
    const pendL = [], pendR = [];
    let broken = false;
    // flush = 纯批次收尾（只把已在批内的点喂给 advanceTrail），**不再兼职复位**——
    // 复位一律由调用点在"断链时刻"显式执行（2026-10-11 review blocker：旧写法把复位藏在
    // flush 的 `if (broken)` 里，而进入空洞的首帧 broken 还是 false ⇒ 不复位 ⇒ 出空洞的
    // 首点仍挂空洞前的旧锚，桥接出一段横跨空洞的长印记，违背"跨空洞不连铺"契约）。
    const flush = () => {
      if (pendL.length) advanceTrail(tr.L, pendL, space, TRAIL_CAP_PER_SIDE);
      if (pendR.length) advanceTrail(tr.R, pendR, space, TRAIL_CAP_PER_SIDE);
      pendL.length = 0; pendR.length = 0;
    };
    /** 单点：阵亡/可见性过滤后按该时刻位姿推两侧接地点（yaw 随点携带，横截面戳据此定向） */
    const pushPoint = (tt) => {
      // 阵亡期：残骸不出段，且必须**断链**——复活会把车放到新位置（或渐进迁移），若沿用死前锚，
      // 复活后的首个接地点会与死前锚连铺，跨阵亡期盖出一段长印记（3.1.0 review P2，issue #622）。
      // 与 AoI 空洞同语义：历史印记保留，出阵亡期从新锚开始。
      if (defLifeAt(def, tt)?.lifeState === 'DESTROYED') {
        if (!broken) {
          flush();
          resetTrailState(tr.L);
          resetTrailState(tr.R);
          broken = true;
        }
        return;
      }
      if (!visibleAt(v, tt)) {                                // AoI 外：断链（跨空洞不连铺）
        if (!broken) {
          flush();
          resetTrailState(tr.L);                              // 显式复位：出空洞从新锚开始
          resetTrailState(tr.R);
          broken = true;
        }
        return;
      }
      broken = false;
      posAt(v, tt, tmpV);
      const yaw = yawAt(v, tt);
      const fx = -Math.sin(yaw), fz = Math.cos(yaw);          // 场景系前向（group.rotation.y = −yaw）
      const rx = -fz, rz = fx;                                // 横向（左右对称，命名不承载语义）
      pendL.push({ x: tmpV.x - rx * hwL, z: tmpV.z - rz * hwL, t: tt, yaw });
      pendR.push({ x: tmpV.x + rx * hwR, z: tmpV.z + rz * hwR, t: tt, yaw });
    };
    // 首锚 = t0 横截面（固定起始面；t0 落在空洞/阵亡内时由出空洞的首个可见点建锚）
    pushPoint(t0);
    const k0 = Math.round((t0 - START) / GRID_DT);
    const kEnd = Math.floor((T - START) / GRID_DT + 1e-9);
    let fedTo = t0;
    for (let k = Math.max(0, k0); k < kEnd; k++) {
      const tA2 = START + k * GRID_DT, tB2 = START + (k + 1) * GRID_DT;
      const pa = posAt(v, tA2, tmpV); const ax = pa.x, az = pa.z;
      const pb = posAt(v, tB2, tmpV); const bx = pb.x, bz = pb.z;   // 先取值：子步 posAt 覆写 tmpV
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen > 2.5) {
        // 大步 = 断链（出生摆放 / AoI 传送 / pose_kf 保持-跳变）：跨过去不铺印，
        // 否则位姿折线被 stamp 成一小段斜折线（用户报"刚进入对局时印记有一小段折线"）
        flush();
        resetTrailState(tr.L);
        resetTrailState(tr.R);
        fedTo = tB2;          // 断链片已消费：不补点，下一片的点从新锚开始
        continue;
      }
      // 自适应子步：步内弧长 ≤ ~0.6 m（高速时 0.1 s 网格步会到 2 m+，段方向成弦切角）
      const nSub = Math.min(6, Math.max(1, Math.ceil(segLen / 0.6)));
      for (let s = 1; s <= nSub; s++) pushPoint(tA2 + (GRID_DT * s) / nSub);
      fedTo = tB2;
    }
    flush();
    return fedTo;
  }

  /**
   * 路径态 → 四边形顶点 + 寿命 alpha（客户端槽位模型，2026-10-12）。
   *
   * 槽位 = **左右交错**：第 k 个已提交戳占槽 `2k`（L）/ `2k+1`（R）——首版把 R 整块放在
   * `[cap, 2cap)` 而 drawRange 只从 0 数起，R 区间永远落在绘制窗口外（"只有左侧履带有
   * 印记"）。额外一对槽 `2cap`/`2cap+1` = 两侧各自的**活戳槽**（逐帧拉伸到车辆当前位置的
   * 那一戳，客户端每帧重发同款）。
   *
   * 绘制窗口=全部槽位（50×2 个四边形，索引开销可忽略），**无效槽一律显式隐藏**（alpha 0）：
   * 环里的空槽（k ≥ total，残留上一轮旧戳）、无活戳时的活戳槽，都清零。此前按 min/max(L,R)
   * 取窗口只解决了一半（review P2 2026-10-11：左右弧长不同会互相截断）——显式隐藏没有这个
   * 耦合，也不再依赖"位置全零即退化"的偶然。
   * `written` = 该侧已写入 GPU 的绝对戳数；环形覆写只重写被覆盖的那个槽。
   */
  function writeTrailQuads(v, tr) {
    const geo = v.treadMesh.geometry;
    const posAttr = geo.getAttribute('position');
    const colAttr = geo.getAttribute('color');
    const parr = posAttr.array, carr = colAttr.array;
    const h = heightField ? sampleHeight : () => 0;
    const width = v.tread.width;
    const c12 = new Float32Array(12);
    let wrote = false;
    // 槽位 alpha 统一走 fround：carr 是 Float32Array，写 0.8 读回 0.8000000119——比较必须
    // 按同一量化值（review P3 2026-10-11：double 严格比较让未变化缓冲每 tick 重新上传）
    const alphaAt = (t) => Math.fround(treadAlphaAt(T - t) * (v.tread.texScale || 1));
    const hideQuads = (co) => {
      if (carr[co + 3] !== 0 || carr[co + 7] !== 0 || carr[co + 11] !== 0 || carr[co + 15] !== 0) {
        carr[co + 3] = 0; carr[co + 7] = 0; carr[co + 11] = 0; carr[co + 15] = 0;
        wrote = true;
      }
    };
    for (const st of [tr.L, tr.R]) {
      const quad = st === tr.L ? 0 : 1;      // 交错槽：L 占偶数槽（2k）、R 占奇数槽（2k+1）
      // 环满时的显示权切换点 = **active 激活**（open != null，即净位移已达 0.3 m），
      // 不是上一次提交完成时——客户端 0x3632a54 的语义：< 0.3 m 时 active 不占 write 槽
      // 的显示权，最老 committed 槽继续显示（第 50 次提交后仍应有 50 个可见槽）。
      // open 存在时 write 槽（= total % cap）才切给活戳并顶掉最老 committed 槽；
      // 提交循环跳过该槽（否则会把活戳 alpha 顶回旧戳值）。（四轮 review P2 边界）
      const writeSlot = ((st.total % TRAIL_CAP_PER_SIDE) + TRAIL_CAP_PER_SIDE) % TRAIL_CAP_PER_SIDE;
      const openActive = !!openStampOf(st);
      for (let k = st.written; k < st.total; k++) {
        const slot = k % TRAIL_CAP_PER_SIDE;
        if (openActive && slot === writeSlot && st.total >= TRAIL_CAP_PER_SIDE) continue;
        const seg = st.segs[slot];
        if (!seg) {
          // 防御：未定型槽（理论不可达——total 只计已提交）显式隐藏
          const co = slot * 32 + quad * 16;
          if (carr[co + 3] !== 0) {
            carr[co + 3] = 0; carr[co + 7] = 0; carr[co + 11] = 0; carr[co + 15] = 0;
            wrote = true;
          }
          continue;
        }
        if (!trailStampCorners(seg, width, h, c12)) continue;
        parr.set(c12, slot * 24 + quad * 12);
        const a = alphaAt(seg.t);
        const co = slot * 32 + quad * 16;
        for (let q = 0; q < 4; q++) {
          carr[co + q * 4] = 1; carr[co + q * 4 + 1] = 1;
          carr[co + q * 4 + 2] = 1; carr[co + q * 4 + 3] = a;
        }
        wrote = true;
      }
      st.written = st.total;
      // 环内空槽显式隐藏（k ∈ [total, cap)：环形里可能残留上一轮更长运行的旧戳）。
      // openSlot（若 active 存在）跳过——否则先清 0 再被活戳块写回，paused/static tick
      // 也会无意义地标脏重传（四轮 review P3）。
      const openSlotNow = st.total % TRAIL_CAP_PER_SIDE;
      for (let k = Math.min(st.total, TRAIL_CAP_PER_SIDE); k < TRAIL_CAP_PER_SIDE; k++) {
        if (openActive && k === openSlotNow) continue;
        hideQuads((k % TRAIL_CAP_PER_SIDE) * 32 + quad * 16);
      }
      // 活戳 = write 槽（= total % cap，50 槽含 active——客户端 0x727b80 同构，无第 51 槽）。
      // 逐帧写入拉伸中的活戳（位置 + alpha），位置按 fround 变化检测——静止且时钟未动时
      // 零上传（与环槽同一门控）；无活戳（未起步/未激活/已复位）则隐藏该槽。
      const openSlot = st.total % TRAIL_CAP_PER_SIDE;
      const pos0 = openSlot * 24 + quad * 12;
      const col0 = openSlot * 32 + quad * 16;
      const open = openStampOf(st);
      if (open && trailStampCorners(open, width, h, c12)) {
        let changed = false;
        for (let i = 0; i < 12; i++) {
          if (parr[pos0 + i] !== Math.fround(c12[i])) { changed = true; break; }
        }
        if (changed) { parr.set(c12, pos0); wrote = true; }
        const a = alphaAt(open.t);
        for (let q = 0; q < 4; q++) {
          const ci = col0 + q * 4;
          if (carr[ci] !== 1 || carr[ci + 1] !== 1 || carr[ci + 2] !== 1 || carr[ci + 3] !== a) {
            carr[ci] = 1; carr[ci + 1] = 1; carr[ci + 2] = 1; carr[ci + 3] = a;
            wrote = true;
          }
        }
      } else if (openActive || st.total < TRAIL_CAP_PER_SIDE) {
        // ownership 三态：active 已激活但几何无效，或环未满且无 active 时，这个 write 槽
        // 不属于历史 committed，必须隐藏；环已满 + open==null 时 write 槽仍由最老
        // committed 占有，不能在这里清零（review 七轮 P2）。
        hideQuads(col0);
      }
    }
    geo.setDrawRange(0, TRAIL_SLOTS * 6);
    // 门控上传：本帧没有变化就不传（静止/暂停时零 GPU 上传——2026-10-11）
    if (wrote) { posAttr.needsUpdate = true; colAttr.needsUpdate = true; }
  }

  /** 寿命老化扫描：把每槽的 alpha 按其**自身**出生时刻刷新进顶点色。
   *
   * ⚠️ **逐槽独立老化，不做任何时间有序假设**（2026-10-12 review P2）：回压重占只改
   * 被重占槽的 `t`（不动绝对序号）、其它槽又可能被写成 `null` ⇒ "按 k 的出生时刻单调
   * 递增"的二分前提不成立（复现：三槽 [1,2,3]，t=10.1 重占第一槽 → [10.1,2,3]，二分把
   * 新戳当过期前缀清 0——刚生成就不可见）。环只有 51 槽/侧，逐槽全扫与二分同量级。
   * null 槽（回压清空）显式隐藏。暂停时时钟冻结 ⇒ 淡出冻结。
   */
  function ageTrailAlphas(v, tr) {
    const colAttr = v.treadMesh.geometry.getAttribute('color');
    const carr = colAttr.array;
    let dirty = false;
    for (const st of [tr.L, tr.R]) {
      const quad = st === tr.L ? 0 : 1;
      const k0 = Math.max(0, st.total - TRAIL_CAP_PER_SIDE);
      const writeSlot = st.total % TRAIL_CAP_PER_SIDE;
      const openActive = !!openStampOf(st);
      for (let k = k0; k < st.total; k++) {
        const slot = k % TRAIL_CAP_PER_SIDE;
        // 活戳槽：**仅当 active 已激活**显示权才切给活戳（四轮 review P2 边界：
        // open == null 时该槽仍显示最老 committed，老化照常按旧戳计算）
        if (openActive && slot === writeSlot && st.total >= TRAIL_CAP_PER_SIDE) continue;
        const co = slot * 32 + quad * 16;
        const seg = st.segs[slot];
        // 与写入侧同口径的 f32 量化（review P3 2026-10-11）：carr 是 Float32Array，拿
        // double 严格比较恒不相等 ⇒ 时钟没动也每 tick 标脏重传。
        const a = seg ? Math.fround(treadAlphaAt(T - seg.t) * (v.tread.texScale || 1)) : 0;
        for (let q = 0; q < 4; q++) {
          if (carr[co + q * 4 + 3] !== a) {
            carr[co + q * 4 + 3] = a;
            dirty = true;
          }
        }
      }
    }
    if (dirty) colAttr.needsUpdate = true;
  }

  function updateTrails() {
    if (!DATA) return;
    const on = store.treadOn && !!Q.treadMarks;   // 仅高清/极致（低档车模轨距与印记口径不一致）
    for (const v of V) {
      const tr = v.trail;
      if (!tr) continue;
      if (v.treadMesh) v.treadMesh.visible = on;
      if (!on) {
        // 关断期间不推进游标：重开时从 START 全量补铺（印记 = 全程确定性重算）。
        // ⚠️ 路径态必须**一起复位**（review P2 2026-10-11）：旧写法只回退 builtT，重开时
        // 整条路径被追加到旧末端——反向桥接、重复段、出生时刻非单调，后面的时间二分也失去
        // 前提（实测同一 t=52 关→seek→开→seek 后每侧段数 49 → 148）。
        if (tr.builtT !== -Infinity || tr.L.total || tr.R.total) {
          resetTrailState(tr.L); resetTrailState(tr.R);
          tr.builtT = -Infinity;
        }
        continue;
      }
      if (!v.tread || !v.treadMesh) continue;   // 参数/网格未就绪：builtT 保持 -∞，就绪后全量补铺
      // 宽度晚到（review P2 2026-10-11）：参数 JSON 通常早于 GLB 到达，未 authored 车首解析
      // 时无 suspension 实测（beltW=0）⇒ 宽度被锁成常量回落。模型挂载实测就位后在此重解析，
      // 变了就复位全量重建（旧段是按旧宽度铺的，混宽会视觉分层）。authored 车恒用 manual_width。
      if (!v.tread.authoredWidth) {
        const w = resolvedTreadWidth(v);
        if (Math.abs(w - v.tread.width) > 1e-3) {
          v.tread.width = w;
          resetTrailState(tr.L); resetTrailState(tr.R);
          tr.builtT = -Infinity;
        }
      }
      if (T < tr.builtT) {                       // seek 后退：全量重算（destructibles 同构）
        resetTrailState(tr.L); resetTrailState(tr.R);   // written 随复位归零 ⇒ 全量重写实例
        tr.builtT = -Infinity;
      }
      const t0 = Math.max(tr.builtT, START);
      tr.builtT = feedTrail(v, tr, t0);          // 返回最后已喂网格时刻；不足整片的尾巴留待下次
      writeTrailQuads(v, tr);
      ageTrailAlphas(v, tr);
    }
  }

  // ---------- GLB 真实车模 ----------
  // 姿态处理与装甲查看器 world 模式（poseFromYPR / poseShooterTurretGun）同构：
  // - GLB 内部系 x右/y前/z上（models.pb 原点已按 (x,z,y) 校正到该系）；根位姿 = qYaw·qPitch·qRoll·qFrame，
  //   qFrame = Ry(π)·Rx(−π/2) 的 z-up→y-up 帧变换；yaw 传镜像值（−游戏 yaw），pitch 原值，roll 滤波层恒 0；
  // - 炮塔/炮管 = 烘焙矩阵绕枢轴旋转：炮塔 Rz(−rel)（镜像系）@ tP=track+turret，炮管 Rx(俯仰)@ gP=tP+gun_origin；
  // - 部件数据（model_origins / configs[].gun_origin / initial_turret_rotation）来自资产平面 tank/{id}.json
  //  （WotBTools client-only：dump-tank-data 物化，与上游 /api/tank/{id} 同一形状）。

  async function loadGlb(tankId) {
    // 捕获当前会话的缓存实例：会话结束后迟到的完成写入旧 Map（已脱离新会话），
    // 不污染新会话缓存；teardown 时在册的 Promise 已被挂 then(dispose)——迟到
    // 模板到达即销毁，teardown 后才创建的残余随旧 Map GC
    const cache = glbCache;
    if (cache.has(tankId)) return cache.get(tankId);
    const p = (async () => {
      try {
        const [glbBytes, sd, susp] = await Promise.all([
          assetProvider.bytes(`/glb/${tankId}/model.glb`),
          assetProvider.json(`/tank/${tankId}.json`).catch(() => null),
          // 逐车悬挂数据（additive：tools/export_tank_suspension.py 产物；缺失/404 → null，
          // 整车回落刚体——与"该车客户端无悬挂数据"同路）
          assetProvider.json(`/suspension/${tankId}.json`).catch(() => null),
        ]);
        // GLTFLoader.parse：bytes 经 provider（storage/network 与场景解耦），
        // GLB 自包含无外部资源，resourcePath 无关紧要
        const model = await new Promise((res) =>
          new GLTFLoader().parse(glbBytes.buffer, '', (g) => res(g.scene), () => res(null)));
        if (!model) {
          console.warn('[playback] 坦克 GLB 解析返回空 tank_id=' + tankId)
          return null
        }
        model.scale.setScalar(1);
        // 老式车（无 metallicRoughness 贴图）金属度归零——否则无环境贴图下发黑；
        // 在模板上做一次，逐车 clone 共享材质即随带（见 glbRig.js）
        neutralizeDefaultMetalness(model);
        // 同名几何副本去重：Maus 的根级 mask_01 与 gun_01_mask 是同一块炮盾（实测唯一一台），
        // rig 不摆位 mask_NN → 炮塔转走后它会留在原地（见 glbRig.dropDuplicateGunMasks）
        dropDuplicateGunMasks(model);
        // hide_elements 拆件全部渲染（与装甲检视器同规则；位于部件子树内，姿态随父节点自动跟随）
        // 缓存模板 + 部件数据（sd）；每车实例化时 clone 并重收集节点引用
        //（同 tank_id 多车共用一个实例会互相抢对象、位姿互覆盖）
        return { template: model, sd, susp };
      } catch (e) {
        // 静默失败是"切真实车模后没有车"这类报障无从定位的根因（2026-10-09 实测）：
        // 资产 404 / 解析异常 / 模板处理抛错都落在这里，必须留痕（含 tank_id 与原始错误）
        console.warn('[playback] 坦克 GLB 加载失败 tank_id=' + tankId + ':', e)
        return null
      }
    })();
    cache.set(tankId, p);
    // 负结果不入缓存：失败（404/解析失败）只影响本次，资产补位后下次切换即可重试——
    // 缓存 null 会毒化整个会话（transient 缺资产被永久记住）
    p.then((entry) => { if (!entry) cache.delete(tankId); }).catch(() => cache.delete(tankId));
    return p;
  }

  // 炮塔/炮管驱动部件收集 + 枢轴原点链（track+turret / +gun_origin，models.pb 数据）
  function collectGlbParts(model, sd, sel) {
    // 节点分组（装甲查看器 collectConfigNodes 同式）：gun_XX(+_mask 等) 按编号分组升序、
    // turret_XX 升序——与 build_configs 的 dense 索引序一致
    const byGroup = new Map(); const turrets = [];
    model.traverse(n => {
      const nm = n.name || '';
      const gm = nm.match(/^gun_(\d+)/);
      const tm = nm.match(/^turret_(\d+)$/);
      if (gm) { const g = parseInt(gm[1], 10); if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(n); }
      else if (tm) turrets.push(n);
    });
    const gunGroups = Array.from(byGroup.keys()).sort((a, b) => a - b)
      .map(k => byGroup.get(k).sort((a, b) => ((a.name || '') < (b.name || '') ? -1 : 1)));
    turrets.sort((a, b) => ((a.name.match(/\d+/)?.[0] | 0) - (b.name.match(/\d+/)?.[0] | 0)));
    // 选中变体 = 回放证据推断的 dense 索引（缺省 = 顶级配置），其余隐藏
    const cfgs = (sd && sd.configs && sd.configs.length) ? sd.configs : null;
    const gi = (sel && sel.gun_index != null) ? sel.gun_index
      : (cfgs ? cfgs[cfgs.length - 1].gun_index : 0);
    const ti = (sel && sel.turret_index != null) ? sel.turret_index
      : (cfgs ? cfgs[cfgs.length - 1].turret_index : 0);
    gunGroups.forEach((grp, i) => grp.forEach(n => n.visible = (i === (gi % gunGroups.length))));
    turrets.forEach((n, i) => n.visible = (i === (ti % turrets.length)));
    const turretNode = turrets.length ? turrets[ti % turrets.length] : null;
    // 摆位只取炮管本体+炮盾（精确命名）；组内其余节点（gun_XX_mask_nc 等）是炮盾子树，
    // 直接摆位会与父节点继承叠加成双重旋转（装甲查看器 gunBarrelNodes 同款过滤）
    const grp = gunGroups.length ? gunGroups[gi % gunGroups.length] : [];
    const barrelNodes = grp.filter(n => /^gun_\d+(_mask)?$/.test(n.name || ''));
    const gunNodes = barrelNodes.length ? barrelNodes : grp;
    const mo = sd && sd.model_origins;
    if (!mo || !mo.track || !mo.turret) {
      console.warn('[playback] glb parts incomplete: turret=' + !!turretNode + ' origins=' + !!(mo && mo.track));
      return null;
    }
    // 固定战斗室车辆（歼击车，实测资产包 44/735：T110E3/ISU-152/T28/SU-85/StuG…）
    // 客户端源模型**没有 turret_N 实体**——炮管组直接装在车体上，导出器按源场景图
    // 忠实导出（tools/export_tank_glb.py 不造节点）。摆位证据其实齐全：track/turret
    // 枢轴在 tank.json model_origins、炮管组在 GLB——照常挂载，炮塔横转由 poseGlbRig
    // 施加到炮管组（mG 本就 = mT·Rx(gr)，与客户端「TD 的炮塔 = 炮架横转」同构）。
    // 连炮管组都没有的模型无任何受姿部件，仍退代理车（fail-visible）。
    if (!turretNode && !gunNodes.length) {
      console.warn('[playback] GLB 部位不全，保留代理车（无炮塔且无炮管组）');
      return null;
    }
    const tP = [mo.track[0] + mo.turret[0], mo.track[1] + mo.turret[1], mo.track[2] + mo.turret[2]];
    // 火炮枢轴用选中配置的 gun_origin（非默认顶级）
    const cfg = cfgs ? (cfgs.find(c => c.turret_index === ti && c.gun_index === gi) || cfgs[cfgs.length - 1]) : null;
    const gP = (cfg && cfg.gun_origin)
      ? [tP[0] + cfg.gun_origin[0], tP[1] + cfg.gun_origin[1], tP[2] + cfg.gun_origin[2]]
      : tP.slice();
    // —— __hullGroup：后续「逐轮贴地 + 履带分段」的挂点，当前恒归单位（不参与摆放）——
    // 底盘（`chassis_track_*` / `chassis_wheel_*`，实测 200/200 辆坦克 GLB 都有）按名字
    // 分离出车体子树：车体进 hullGroup（identity ⇒ 与拆分前逐像素等价），底盘留根上。
    // 客户端里车体 = 记录位姿、底盘由 `Suspension*System` 按模型几何解算（逆向证据见
    // 上游 docs/tank-suspension-client-re.md），悬挂实现落地时在此挂点内摆残差。
    // 命名不符（未知模型）→ hullGroup=null，消费端回落整台刚体（fail-safe）。
    let hullGroup = null;
    const chassisNode = (() => {
      let hit = null;
      model.traverse((n) => {
        if (!hit && /^chassis_(track|wheel)_/i.test(n.name || '')) hit = n;
      });
      return hit;
    })();
    const modelRoot = chassisNode && chassisNode.parent ? chassisNode.parent : null;
    if (modelRoot) {
      hullGroup = new THREE.Group();
      hullGroup.name = '__hullGroup';
      for (const child of [...modelRoot.children]) {
        if (/^chassis_(track|wheel)_/i.test(child.name || '')) continue;
        hullGroup.add(child);
      }
      modelRoot.add(hullGroup);
    }
    return { turretNode, gunNodes, tP, gP, hullGroup,
             itr: (sd && sd.initial_turret_rotation) || null };
  }

  // ---------- 悬挂求解（轮/带逐帧解算，客户端同构） ----------
  // 依据：上游 `docs/tank-suspension-client-re.md` §六（第二轮反汇编）。与客户端逐条对应：
  //   · 负重轮（`chassis_wheel_{L,R}_NN`，yaml `wheels` 记录 1:1）= **纯竖直平移**，夹到
  //     `[pz−b, pz+a]`、按 `wheelsReactionSpeed` 限速、首次可见直接吸附；`flag=0`
  //     （诱导/主动/托带轮）不参与贴地解算（但照常自转）。
  //   · 自转 = 绕轮节点**局部 X 轴** `θ += −Δs_侧 / r`；Δs_侧 = 该侧履带接触线中心的纵向
  //     位移（左右各算 ⇒ 转向差速自动成立）。
  //   · 履带（`chassis_track_{L,R}`，多段模型为 `…_NN`）= 静止折线（链路）→ 逐轮偏移 →
  //     悬空段垂弧 → 铺地，随后**逐顶点形变**（只动模型 +z）+ 花纹 V 滚动
  //     （每米速率 = **网格实测**沿带 dV/ds × 底段走向；客户端形式常数
  //     `textureScale/chunkLength` 实测偏快 3.4~19×，见 collectSuspensionParts 内注释）。
  // 半径/挂点/链长由模型现算（客户端亦从骨骼现算）；数据缺失/命名不符/轮数不匹配 →
  // 返回 null，整车回落刚体（fail-closed，与数据面无 suspension 块的车同路）。
  const SUSP_AXIS = new THREE.Vector3(0, 0, 1);      // 模型 +z（上）——行程方向
  const SUSP_SPIN_AXIS = new THREE.Vector3(1, 0, 0); // 轮局部 X（车宽）——自转轴（客户端同款）
  const _spQ = new THREE.Quaternion(), _spQ2 = new THREE.Quaternion();
  const _spV = new THREE.Vector3(), _spP = new THREE.Vector3(), _spC = new THREE.Vector3();
  const _spUp = new THREE.Vector3(), _spFwd = new THREE.Vector3();
  const _spUpW = new THREE.Vector3(), _spBox = new THREE.Box3(), _spBox2 = new THREE.Box3();
  let suspDt = 0;          // 本帧 dt（0 = seek/跳变 ⇒ 行程限速退化为吸附）
  let suspSnap = false;    // 本 tick 为跳变（seek）：行程吸附、侧位移不积分

  function collectSuspensionParts(root, susp, tankId) {
    if (!susp || !Array.isArray(susp.wheels) || !susp.chains) return null;
    const chainsBySide = { L: susp.chains.left, R: susp.chains.right };
    if (!Array.isArray(chainsBySide.L) || !Array.isArray(chainsBySide.R)) return null;
    root.updateMatrixWorld(true);          // clone 未入 scene：matrixWorld 即"相对模型根"
    const disposables = [];
    const sides = {};
    for (const side of ['L', 'R']) {
      const wheelNodes = [];
      const trackNodes = [];
      root.traverse((n) => {
        const wp = parseWheelNodeName(n.name);
        if (wp && wp.side === side) wheelNodes.push([wp.index, n]);
        const tp = parseTrackNodeName(n.name);
        if (tp && tp.side === side) trackNodes.push([tp.segment, n]);
      });
      wheelNodes.sort((a, b) => a[0] - b[0]);
      trackNodes.sort((a, b) => a[0] - b[0]);
      const chains = chainsBySide[side];
      // 客户端断言 `wheelInfos.size() == suspension.wheels.size()`：轮数不符即 fail-closed
      if (!wheelNodes.length || wheelNodes.length !== susp.wheels.length) return null;
      if (!trackNodes.length || trackNodes.length !== chains.length) return null;
      const wheels = [];
      for (const [idx, node] of wheelNodes) {
        const rec = susp.wheels[idx - 1];
        if (!Array.isArray(rec) || rec.length < 3) return null;
        const flag = rec[0], up = rec[1], down = rec[2];
        _spBox.makeEmpty();
        node.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          if (o.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
          }
        });
        if (_spBox.isEmpty()) return null;
        const ctr = _spBox.getCenter(new THREE.Vector3());
        const size = _spBox.getSize(new THREE.Vector3());
        const radius = wheelRadiusFromExtents(size.y, size.z);
        const travelAxis = SUSP_AXIS.clone().applyQuaternion(node.quaternion.clone().invert());
        const upHull = SUSP_AXIS.clone().applyQuaternion(node.quaternion);
        // 导出器把轮几何烘进顶点、节点留在原点（实测平移/旋转皆 identity）：直接给节点写
        // 旋转会绕**整车原点**转（轮公转 = 观感"旋转混乱"）。故按轮心做枢轴补偿——
        // 与炮塔/炮管同一套"节点原点 + 显式枢轴"约定（见 model_origins 那条链）。
        const pivot = node.parent ? node.parent.worldToLocal(ctr.clone()) : ctr.clone();
        const restPivotRot = pivot.clone().applyQuaternion(node.quaternion);
        wheels.push({
          node, flag,
          up: flag ? up : 0, down: flag ? down : 0,     // flag=0：不参与贴地（客户端同款）
          radius, centerHull: ctr, travelAxis, upHull, pivot, restPivotRot,
          restPos: node.position.clone(), restQuat: node.quaternion.clone(),
          travel: 0, spin: 0,
        });
      }
      const tracks = [];
      for (let ti = 0; ti < trackNodes.length; ti++) {
        const node = trackNodes[ti][1];
        const chain = chains[ti];
        if (!Array.isArray(chain) || chain.length < 4) return null;
        _spBox.makeEmpty();
        const meshes = [];
        node.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          meshes.push(o);
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          if (o.geometry.boundingBox) {
            _spBox.union(_spBox2.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
          }
        });
        if (!meshes.length || _spBox.isEmpty()) return null;
        const lateral = _spBox.getCenter(new THREE.Vector3()).x;   // 履带中心线（模型系横向）
        const beltW = _spBox.getSize(new THREE.Vector3()).x;        // 履带条宽（回落实测宽度用）
        const chain2 = chain.map((pt) => [pt[0], pt[1]]);           // [纵向 y, 高度 z]
        const restZ = chain.map((pt) => pt[1]);
        // 段弧长（花纹速率与顶点弧长参数用）
        const segArc = [];
        const cumArc = [0];
        for (let i = 0; i + 1 < chain2.length; i++) {
          segArc.push(Math.hypot(chain2[i + 1][0] - chain2[i][0], chain2[i + 1][1] - chain2[i][1]));
          cumArc.push(cumArc[cumArc.length - 1] + segArc[i]);
        }
        const uvSamples = [];
        const wheelCfg = wheels.map((w) => ({
          longitudinal: w.centerHull.y, centerZ: w.centerHull.z, radius: w.radius,
        }));
        const attach = attachChainToWheels(chain2, wheelCfg);
        const parts = [];
        for (const mesh of meshes) {
          mesh.geometry = mesh.geometry.clone();      // 形变逐车独立（模板几何共享）
          disposables.push(mesh.geometry);
          const posAttr = mesh.geometry.getAttribute('position');
          if (!posAttr) continue;
          const basePos = new Float32Array(posAttr.array);
          const nv = basePos.length / 3;
          // 顶点 → 链路映射在**模型根系**里做（链路即模型根系的纵剖面折线）
          const rootPos = new Float32Array(basePos.length);
          const m = mesh.matrixWorld;
          for (let vi = 0; vi < nv; vi++) {
            _spV.set(basePos[vi * 3], basePos[vi * 3 + 1], basePos[vi * 3 + 2]).applyMatrix4(m);
            rootPos[vi * 3] = _spV.x; rootPos[vi * 3 + 1] = _spV.y; rootPos[vi * 3 + 2] = _spV.z;
          }
          const params = vertexChainParams(rootPos, chain2);
          // 位移方向：模型根 +z 在该网格局部系里的方向（网格可能带旋转）
          const localAxis = SUSP_AXIS.clone().applyQuaternion(mesh.quaternion.clone().invert());
          const uvAttr = mesh.geometry.getAttribute('uv');
          const uvBase = uvAttr ? new Float32Array(uvAttr.array) : null;
          // 花纹速率样本：[沿带弧长, V]（沿带弧长由顶点→链路映射给出）
          if (uvAttr) {
            for (let vi = 0; vi < nv; vi++) {
              const sg = params.seg[vi];
              const arc = cumArc[sg] + params.t[vi] * segArc[sg];
              uvSamples.push([arc, uvAttr.array[vi * 2 + 1]]);
            }
          }
          parts.push({ mesh, posAttr, basePos, params, axis3: [localAxis.x, localAxis.y, localAxis.z],
                       uvAttr, uvBase, appliedUv: 0 });
        }
        if (!parts.length) return null;
        // 花纹滚动速率：**网格实测**沿带 dV/ds（客户端形式 textureScale/chunkLength 实测偏快
        // 3.4~19×——那条常数在客户端自己的 shader V 空间里，与导出网格的图集式 per-link V
        // 不同量纲）。方向：ΔV = dir·k·Δs，dir = 链路底段走向（材料在底段向后流），
        // k 的符号自带模型的 V 朝向 ⇒ 两个符号方向都自动正确（见 suspension.js 推导）。
        const uvFit = measureBeltUvSlope(uvSamples);
        const dvPerM = uvFit.ok ? chainBottomRunDir(chain2) * uvFit.slope : 0;
        if (!uvFit.ok) {
          console.warn('[playback] 履带 UV 沿带斜率不可测（花纹停滚）tank=' + (tankId || '?')
            + ' pairs=' + uvFit.pairs);
        }
        tracks.push({
          node, parts, chain: chain2, restZ, attach, wheelCfg, lateral, beltW,
          groundDrop: new Float64Array(chain2.length),
          chainZ: new Float64Array(chain2.length),
          appliedChainZ: null,    // 已下发的解算链（顶点输出的唯一形状输入，见 suspensionStep）
          normalChainZ: null,     // 上次**重算法线**时的链（法线闸门逐点比较用）
          dvPerM, uv: 0,
        });
      }
      // 侧接触线横向偏移：履带中心线 |x| 的均值；同时累计履带条宽（beltW 均值）
      let sum = 0, wsum = 0;
      for (const tg of tracks) { sum += Math.abs(tg.lateral); wsum += tg.beltW || 0; }
      sides[side] = {
        wheels, tracks, wheelDelta: new Float64Array(wheels.length),
        halfW: tracks.length ? sum / tracks.length : 0,
        beltW: tracks.length ? wsum / tracks.length : 0, prev: null,
      };
    }
    return {
      sides, disposables, bend: susp.track_bending || null,
    };
  }

  // 逐帧：贴地（轮）→ 自转 → 链路解算 → 逐顶点形变 + 花纹滚动
  function suspensionStep(v) {
    const sp = v.suspParts;
    if (!sp || !v.glb) return;
    _spQ.copy(v.glb.quaternion);                       // 车体系（模型系）→ 世界
    _spUp.set(0, 0, 1).applyQuaternion(_spQ);          // 车体 up 的世界向量
    const upY = _spUp.y;
    _spFwd.set(0, 1, 0).applyQuaternion(_spQ);         // 车体前向（世界）
    const snap = suspSnap;
    const dt = suspDt;
    const reaction = Number.isFinite(v.def && v.def.suspReaction) ? v.def.suspReaction : 1.0;
    for (const key of ['L', 'R']) {
      const side = sp.sides[key];
      if (!side) continue;
      // 该侧履带接触线中心（世界）：车体系 (±halfW, 0, 0)
      _spP.set(key === 'L' ? -side.halfW : side.halfW, 0, 0).applyQuaternion(_spQ).add(v.glb.position);
      let dS = 0;
      if (side.prev && !snap) {
        dS = sideTravel(side.prev.x, side.prev.z, _spP.x, _spP.z, _spFwd.x, _spFwd.z);
      }
      if (!side.prev) side.prev = new THREE.Vector3();
      side.prev.copy(_spP);
      // 逐轮：贴地行程 + 自转
      for (let wi = 0; wi < side.wheels.length; wi++) {
        const w = side.wheels[wi];
        if (w.flag) {
          _spC.copy(w.centerHull).applyQuaternion(_spQ).add(v.glb.position);
          const terr = sampleHeight(_spC.x, _spC.z);
          _spUpW.copy(w.upHull).applyQuaternion(_spQ);
          const upw = Math.abs(_spUpW.y) > 0.25 ? _spUpW.y : 0;
          if (upw) {
            const wantWorld = (terr + w.radius) - _spC.y;      // 世界竖直差
            const wantLocal = clampTravel(wantWorld / upw, w.up, w.down);
            w.travel = rateLimitTravel(w.travel, wantLocal, reaction, dt, snap);
          } else {
            w.travel = 0;
          }
        } else {
          w.travel = 0;                                        // 非负重轮：保持装定位
        }
        if (dS) w.spin = spinStep(w.spin, dS, w.radius);
        // 自转（绕轮局部 X）+ 枢轴补偿（导出的轮节点在原点，几何烘进顶点；见 applyWheelSpin）
        _spQ2.setFromAxisAngle(SUSP_SPIN_AXIS, w.spin);
        applyWheelSpin(w.node, w.restPos, w.restQuat, w.pivot, w.restPivotRot,
                       _spQ2, w.travelAxis, w.travel);
        side.wheelDelta[wi] = w.travel;
      }
      // 履带：链路解算 + 形变 + 花纹
      for (const tg of side.tracks) {
        const n = tg.chain.length;
        for (let i = 0; i < n; i++) {
          _spP.set(tg.lateral, tg.chain[i][0], tg.chain[i][1]).applyQuaternion(_spQ).add(v.glb.position);
          const terr = sampleHeight(_spP.x, _spP.z);
          tg.groundDrop[i] = groundDropLocal(terr, _spP.y, upY);
        }
        solveChain(tg.chainZ, tg.chain, tg.attach, side.wheelDelta, tg.groundDrop, tg.wheelCfg, sp.bend);
        // 花纹：每米 V 变化 = 网格实测 dV/ds（见收集期注释）
        const uv = (dS && tg.dvPerM)
          ? (tg.uv = treadScrollStep(tg.uv, dS, tg.dvPerM))
          : tg.uv;
        // 顶点输出 = f(chainZ, basePos, params, restZ, axis)（纯函数）⇒ **按解算链**判定是否下发：
        // 只比形变最大幅度会漏"幅度相同、分布不同"的形变（2026-10-10 review P2：把 0.1 的形变
        // 从一处挪到另一处时 max 不变、顶点已变但 `version` 仍是 1，GPU 停在旧形状；法线同理）。
        // 逐链路点（~40）比较比逐顶点指纹便宜且**恰好充分**：链相同 ⇒ 顶点逐点相同。
        const chainMoved = snap || !tg.appliedChainZ || chainChanged(tg.appliedChainZ, tg.chainZ);
        if (chainMoved) {
          // 法线闸门：与**上次重算法线时的链**逐点比较取最大偏差（2026-10-10 review 复审 P2——
          // dmax/dmean 这类累计统计量表达不了空间分布：把 0.1 m 的形变从一处挪到另一处时两者
          // 都不变，法线却必须重算）。2 cm 阈值仍是成本刹车：行驶中偏差累积到 2 cm 才重算一次，
          // 而非逐帧重算（逐帧 = 每车每帧一次全顶点遍历）。
          const dNorm = (snap || !tg.normalChainZ) ? Infinity : chainDrift(tg.normalChainZ, tg.chainZ);
          const redoNormals = dNorm > 0.02;
          for (const gp of tg.parts) {
            applyChainToVertices(gp.posAttr.array, gp.basePos, gp.params,
                                 tg.chainZ, tg.restZ, gp.axis3);
            gp.posAttr.needsUpdate = true;
            if (redoNormals) {
              gp.mesh.geometry.computeVertexNormals();
              const na = gp.mesh.geometry.getAttribute('normal');
              if (na) na.needsUpdate = true;
            }
          }
          if (redoNormals) {
            if (!tg.normalChainZ) tg.normalChainZ = new Float64Array(n);
            tg.normalChainZ.set(tg.chainZ);
          }
          if (!tg.appliedChainZ) tg.appliedChainZ = new Float64Array(n);
          tg.appliedChainZ.set(tg.chainZ);
        }
        // 花纹与形变解耦：UV 只随累计滚动量变（链静止时也照样滚），故独立于上面的形变闸门
        for (const gp of tg.parts) {
          if (gp.uvAttr && gp.uvBase && Math.abs(uv - gp.appliedUv) > 1e-3) {
            gp.appliedUv = uv;
            // 取模只作用于**偏移**（整带同相）：逐顶点取模会破坏跨 wrap 图元的 UV 插值
            // （长直段被拉成"没有纹理"，见 writeUvOffsetV 注释）
            writeUvOffsetV(gp.uvAttr.array, gp.uvBase, uv);
            gp.uvAttr.needsUpdate = true;
          }
        }
      }
    }
  }

  // GLB 位姿模块级 scratch：本函数每车每帧执行，原实现每次分配 ~20 个矩阵/欧拉/四元数
  // （14 车 × 60fps 的 GC 抖动源）。语义与逐次分配完全一致，只是复用容器。
  const _glbQuat = new THREE.Quaternion();
  const _glbEuler = new THREE.Euler();
  const _mRot = new THREE.Matrix4(), _mTmpA = new THREE.Matrix4(), _mTmpB = new THREE.Matrix4();
  const _mTmpC = new THREE.Matrix4(), _mTmpD = new THREE.Matrix4(), _mT = new THREE.Matrix4();
  const _mG = new THREE.Matrix4(), _mAcc = new THREE.Matrix4();

  // GLB 根位姿 = poseFromYPR(−yaw, pitch, roll)（共享 rig，见 scene/glbRig.js）——
  // **车体位姿照回放记录摆**（客户端同构：车体收记录的 yaw/pitch/roll + y）。
  // ⚠️ 2026-10-10：曾试过"根吃地形局部平面 + 车体吃限幅残差"的近似，观感被判"怪"且与客户端
  // 结构相反（客户端：车体 = 记录位姿；轮/带由 `Suspension*System` 按模型几何解算——逆向证据见
  // 上游 docs/tank-suspension-client-re.md），已整段回退。`__hullGroup` 保留但**恒归单位**：
  // 它是下一步"逐轮贴地 + 履带分段"的挂点，现在不参与摆放。
  function poseGlb(v) {
    poseGlbRig(v, T, v.group.position);
    // 悬挂：轮带宽高/自转/履带形变（客户端同构；v.suspParts 缺失 = 整车刚体）。只读根位姿。
    suspensionStep(v);
  }
  // 根位姿 + 炮塔 / 炮管：t 时刻的纯函数（不碰悬挂积分状态）。开火定位炮口时临时摆到 t_fire
  // 量完再摆回 T（见 flushMuzzles）。
  function poseGlbRig(v, t, pos) {
    v.glb.position.copy(pos);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, t), hullPitchAt(v, t), -rollAt(v, t), _glbQuat));
    const p = v.glbParts;
    if (p && p.hullGroup) {
      p.hullGroup.quaternion.identity();
      p.hullGroup.position.set(0, 0, 0);
    }
    if (!p) return;
    const rel = wrapPi(turretAbsAt(v, t) - yawAt(v, t));
    const tr = -rel;                       // 镜像系节点旋转角 = −rel
    const gr = gunPitchAt(v, t);           // glb 系 Rx(θ)：θ>0 = 前向(+Y)抬向 +Z = 仰角
    if (p.itr) {
      // Euler 序 'ZYX'：yaw (Z) 最外层 → pitch/roll 补偿在炮塔局部系内执行。
      // 'XYZ' 会把 pitch 放在全局系，炮塔转开 90° 时 pitch 变成侧倾。
      _glbEuler.set(-THREE.MathUtils.degToRad(p.itr.pitch || 0), -THREE.MathUtils.degToRad(p.itr.roll || 0),
                    tr - THREE.MathUtils.degToRad(p.itr.yaw || 0), 'ZYX');
      _mRot.makeRotationFromEuler(_glbEuler);
    } else {
      _mRot.makeRotationZ(tr);
    }
    const mT = _mT.makeTranslation(p.tP[0], p.tP[1], p.tP[2]).multiply(_mRot)
      .multiply(_mTmpA.makeTranslation(-p.tP[0], -p.tP[1], -p.tP[2]));
    const mG = _mG.copy(_mT).multiply(_mTmpB.makeTranslation(p.gP[0], p.gP[1], p.gP[2]))
      .multiply(_mTmpC.makeRotationX(gr))
      .multiply(_mTmpD.makeTranslation(-p.gP[0], -p.gP[1], -p.gP[2]));
    const tn = p.turretNode;
    if (tn) {
      // 回转炮塔：横转（含 itr 补偿）写炮塔节点；炮管随父链继承横转。
      tn.updateMatrix();
      if (!tn.userData.__bake) { tn.userData.__bake = tn.matrix.clone(); tn.matrixAutoUpdate = false; }
      tn.matrix.copy(_mAcc.copy(mT).multiply(tn.userData.__bake));
    }
    // 固定战斗室（turretNode=null，歼击车）：炮管组直接吃 mG——mG = mT·Rx(gr)，
    // 已含绕 tP 的横转（itr 补偿在内）与绕 gP 的俯仰，与客户端「TD 炮塔 = 炮架横转」同构。
    for (const gn of p.gunNodes) {
      gn.updateMatrix();
      if (!gn.userData.__bake) { gn.userData.__bake = gn.matrix.clone(); gn.matrixAutoUpdate = false; }
      gn.matrix.copy(_mAcc.copy(mG).multiply(gn.userData.__bake));
    }
    // 世界矩阵不在此强制刷新：renderer.render 的 scene.updateMatrixWorld() 从根向下传播，
    // v.glb 根 matrixAutoUpdate=true → updateMatrix 置脏 → force 覆盖 matrixAutoUpdate=false
    // 的炮塔/炮管节点，本行是每车全树一遍纯重复的 compose+multiply（14 车 ×60fps）。
    // tick 与 render 之间唯一的车辆世界矩阵读者是开火定位炮口（flushMuzzles），它只在开火的
    // tick 把射手一台摆到 t_fire、刷新、量完再摆回 T 并刷新；标签投影用位姿插值坐标、遮挡射线
    // 只打静态场景网格。
  }

  async function applyGlbToggle(on) {
    const gen = sessionGen;
    glbOn = on;
    store.glbOn = on;
    if (on) {
      // 有限并发加载（上限 4）：单个大模型慢解析不阻塞其余车辆，又不会让 14 台车
      // 的主线程 GLTF 解析同时排队。每车 clone 独立实例。
      // generation guard：回放替换后迟到的完成不得挂载到新会话场景
      await mapLimit(V.filter(v => v.def.tank_id > 0), ASSET_CONCURRENCY, async (v) => {
        if (!v.glb) {
          const loaded = await loadGlb(v.def.tank_id);
          if (gen !== sessionGen) return;   // 迟到：模板留在旧缓存对象里随 GC 回收
          if (loaded && glbOn && !v.glb) {
            const inst = loaded.template.clone();
            inst.scale.setScalar(1);
            // 炮塔/主炮变体（dense 节点索引）按**实际搭载配置**选：facet 的 turret_index/
            // gun_index 只有服务器路径产出；WASM 客户端产物用同一三级证据链
            // （comp locals → 发射弹种 → 初始血量，resolveMountedConfig）联表 tank 数据
            // 派生——多炮坦克各炮 GLB 节点组不同（实测同队两台 B-C 25t 分别 100/105mm），
            // 不钉定会整场显示顶级炮。sd 拉取失败 → 回退 facet 字段 → 顶级。
            const mounted = loaded.sd ? resolveMountedConfig(v.def, loaded.sd) : null;
            const parts = collectGlbParts(inst, loaded.sd, mounted
              ? { turret_index: mounted.turret_index, gun_index: mounted.gun_index }
              : { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            if (!parts) {
              // 部位/枢轴链不全（sd 缺失等）：不受姿的 GLB 会停在世界原点被地形埋住，
              // 看起来就是"没加载出来"——此时保持代理车（失败可见，且与日志对应）
              console.warn('[playback] GLB 部位不全，保留代理车 tank_id=' + v.def.tank_id)
              return
            }
            v.glb = inst;                       // 通过部位检查后才落库（否则会卡在半装载态）
            v.glbParts = parts;
            // 悬挂部件（轮/带）逐车收集：几何逐车 clone（模板共享），数据缺 → null 回落刚体
            v.suspParts = collectSuspensionParts(inst, loaded.susp, v.def.tank_id);
            v.def.suspReaction = loaded.susp ? loaded.susp.wheels_reaction_speed : null;
            v.glb.visible = v.group.visible && !classIconsVisible();
            scene.add(v.glb);
            // Clone before shader patching: templates keep shared textures/geometry only.
            // The material module composes the existing tank ambient-light isolation.
            for (const head of v.detachedTurrets) {
              head.glb = cloneDetachedTurret(inst, parts, gunPitchAt(v, head.track.pose_kf.t[0]));
              head.glbVisual = prepareTankDestroyedVisual(head.glb);
              head.root.add(head.glb);
            }
            v.glbVisual = prepareTankDestroyedVisual(v.glb);
            applyPose(v);   // late attach while paused must reflect the current replay time
            invalidate();
          }
        }
        if (v.glb) setLowPoly(v, false);
      });
    } else {
      for (const v of V) {
        if (v.glb) {
          for (const head of v.detachedTurrets) {
            head.root.remove(head.glb);
            disposeTankDestroyedVisual(head.glbVisual);
            head.glb = null; head.glbVisual = null;
          }
          scene.remove(v.glb);            // borrowed geometry/textures stay with the template
          disposeTankDestroyedVisual(v.glbVisual);
          v.glbVisual = null;
          // 悬挂求解为逐车 clone 的履带几何（见 collectSuspensionParts 的 disposables）
          // ——清引用前必须释放，否则反复开关 GLB 逐次累积 GPU 缓冲（2026-10-10 review P2）。
          if (v.suspParts && v.suspParts.disposables) {
            for (const g of v.suspParts.disposables) g.dispose();
          }
          v.glb = null; v.glbParts = null; v.suspParts = null;
        }
        setLowPoly(v, true);
        applyDetachedTurrets(v);
      }
    }
  }
  // 低模显隐（标签与作者标记环除外；GLB 根在 scene 上不经过 group）
  function setLowPoly(v, show) {
    for (const c of v.group.children) {
      c.visible = c.userData.keepWithGlb ? showMarkerStatus : show && !classIconsVisible();
    }
    // 车体收在 `__hullGroup` 包装内（悬挂挂点），上面的循环只切到包装层；
    // 而契约按 `meshHull.visible` 读低模显隐（class-icon 用例断言此标志），故同步自身。
    if (v.meshHull) v.meshHull.visible = show && !classIconsVisible();
  }

  // ---------- 弹道 ----------
  // 飞行中的炮弹 = 阵营色曳光（白热弹头 + 阵营色渐隐尾迹，长 TRACER_STREAK_M）；全弹道
  // = 阵营色细光迹（弹头飞过才显现，走完全程后停留 TRAIL_HOLD_SECS、再淡出 TRAIL_FADE_SECS，
  // 回放时钟）。外观、粗细与屏幕像素下限都在 battleFx.js；这里只管时序（何时开火、飞到哪、
  // 何时命中），2D 激光炮线不受影响。
  // 战斗反馈显示时长倍率（**只作用于 3D 场景**）：掉血飘字、HP 条幽灵/受击闪乘这个系数——
  // 回放里这些反馈需要更长的可读时间。乘在 transient 段的 2D SSOT 常量之上，因此 **2D 回放
  // 时序不受影响**；1 = 与 2D 逐值一致。爆炸 / 开火 / 命中 / 光迹的 3D 时长是 battleFx.js 的
  // 独立常量（2026-10-13 写实化），不再由 2D 常量推导。
  const FX_SCALE = 2;
  // 战斗特效（会话拥有，按当局画质档预算创建；teardownSession 释放）
  let battleFx = null;
  function ensureBattleFx() {
    if (!battleFx) {
      battleFx = createBattleFx(Q.fx);
      scene.add(battleFx.root);
      if (DEBUG) window.__battleFx = battleFx;   // 诊断钩子（仅 ?debug；会话结束 / destroy 时清除）
    }
    return battleFx;
  }
  // 残骸烟翻滚相位：只在播放时按壁钟累计（倍速不加快，暂停冻结 → 不需要额外重绘）
  let wreckClock = 0;
  let trajLines = [];

  function spawnShot(s, seed) {
    // 炮线唯一颜色规则 = 射手阵营（绿/红/白）；命中/跳弹/击毁不改炮线颜色——
    // 结果由弹着点 impact 编码（原实现按结果上色，与上游 Agent 不一致）
    const color = shotTeamColor(s);
    const fx = ensureBattleFx();
    // 飞行段时长 = **真实飞行时长**（直射弹 = |终点−炮口|/弹速；跳弹/穿透弹 = 各折线段
    // 时长之和，见 shotPath.js）。此处曾设 0.22s 最小时长"保证可见性"——但实测 68% 的射击
    // 真飞行时长 <0.22s（J39 样本 155 发：中位 0.16s、p10 0.04s），那些炮弹被放慢最多 11×，
    // 与客户端不一致。现只保留 1 帧下限，防退化数据（flight_secs=0/负数）造成零时长除零。
    // 折线：from → via…（跳弹/出射点）→ to（**method20 服务器终点**＝弹道最终停止点，跳弹后
    // 落在出射方向延长线上）；各段按时长匀速推进。
    // 折线点表必须**先镜像 x**（游戏系 → 场景系，与 posAt 同规则）：facet 的 from/via/to
    // 是游戏系原始坐标；折线改造曾直接消费原始坐标——轨迹线/飞行段/弹着特效全部画到
    // 地图镜像侧（用户实测"炮线轨迹不见了"）。
    const pts3 = pathPointsOf(s).map(([x, y, z]) => [-x, y, z]);
    const legSecs = legSecsOf(s, tracerSpanSecs(s.flight_secs));
    const legEnds = legEndTimes(legSecs, s.t_fire);
    const t1 = legEnds[legEnds.length - 1];
    const from = new THREE.Vector3().fromArray(pts3[0]);
    // 弹着特效落点 = **抵达点**（有跳弹 = via[0]，即镜像后的 pts3[1]；直射 = 服务器终点），
    // 命中时刻 = 抵达点时刻 legEnds[0]（跳弹后弹头继续沿出射段飞，特效不等它飞完）
    const impactPos = new THREE.Vector3().fromArray(pts3[1]);
    const dir = impactPos.clone().sub(from);
    if (dir.lengthSq() > 1e-8) dir.normalize(); else dir.set(0, 0, 1);
    // 跳弹出射方向 = 折线下一段方向（缺省由 battleFx 按来弹方向上挑）
    const out = pts3.length > 2 ? new THREE.Vector3().fromArray(pts3[2]).sub(impactPos) : null;
    // s0 = 可见起点弧长：炮管里那一段（起点 → 炮口）不画曳光与光迹，由 flushMuzzles 填入
    const tracer = { mesh: fx.takeRibbon('tracer'), points: pts3, legEnds, arcEnds: legArcEnds(pts3),
      t0: s.t_fire, t1, shot: s, color, seed, impactPos, dir, out, head: from.clone(), hit: false,
      s0: 0, inBarrel: false };
    tracers.push(tracer);
    // 弹道光迹（逐段一条：折线在跳弹处拐弯）：段起点时刻起随弹头显现，弹头走完全程后
    // 停留再淡出（trailOpacityAt，回放时钟；暂停时一直留着，seek 清空）。
    let firstTrail = null;
    for (let k = 0; k + 1 < pts3.length; k++) {
      const a = new THREE.Vector3().fromArray(pts3[k]);
      const b = new THREE.Vector3().fromArray(pts3[k + 1]);
      const len = a.distanceTo(b);
      if (!(len > 1e-3)) continue;
      const mesh = fx.takeRibbon('trail');
      mesh.visible = false;
      const tl = { mesh, a, b, len, start: k === 0 ? s.t_fire : legEnds[k - 1], end: legEnds[k], t1, color, s0: 0 };
      trajLines.push(tl);
      if (k === 0) firstTrail = tl;
    }
    pendingMuzzles.push({ eid: s.shooter_eid, tFire: s.t_fire, from, dir, seed, tracer, firstTrail });
  }
  // 炮口火光 / 炮口烟放在炮管末端：回放记录的开火起点是火炮枢轴（在炮塔 / 炮盾里），直接放会被
  // 车模挡住（2026-10-13 实机近景）。没有可见车模（代理车 / 兵种图标 / 不可见）时用记录起点。
  // 同一段距离也是曳光与第一段光迹的可见起点（s0）：炮管里那截不画，否则光迹会贴着炮管
  // 露出一条线；弹道折线与计时不变，最多截到抵达点（贴脸射击时整段都在炮管里）。
  // 炮管按**开火时刻** t_fire 的姿态量：处理这一 tick 时 T 已晚于 t_fire（掉帧 / 倍速），射手
  // 早已前移或转动，用 T 时刻的炮管会把这段位移混进固定弹道的起点，同一发炮弹的光迹起点随
  // 倍速 / 帧间隔变化（PR #613 审查：10 m/s 射手、100 ms 帧，1×/2×/4×/8× 起点 5/6/8/12 m，
  // 应为 4.5 m）。所以把射手一台临时摆到 t_fire（纯姿态，不碰悬挂积分），量完摆回 T。
  // 在 applyPose 之后调用：摆回用的是本 tick 的 T 时刻位置。
  const _muzzleTip = new THREE.Vector3(), _firePos = new THREE.Vector3();
  function flushMuzzles() {
    for (const m of pendingMuzzles) {
      const v = V.find((x) => x.def.eid === m.eid);
      const parts = v && v.group.visible && v.glb && v.glb.visible ? v.glbParts : null;
      if (parts) {
        poseGlbRig(v, m.tFire, posAt(v, m.tFire, _firePos));
        v.glb.updateMatrixWorld(true);
      }
      const at = muzzleTipOf(parts ? parts.gunNodes : null, m.from, m.dir, _muzzleTip);
      if (parts) {
        poseGlbRig(v, T, v.group.position);
        v.glb.updateMatrixWorld(true);
      }
      const s0 = Math.min(at.distanceTo(m.from), m.tracer.arcEnds[0] || 0);
      m.tracer.s0 = s0;
      if (m.firstTrail) m.firstTrail.s0 = s0;
      battleFx.spawnMuzzle(at, m.dir, performance.now(), m.seed);
    }
    pendingMuzzles.length = 0;
  }
  // 阵营色（唯一规则：按射手阵营 → green / red / white）。炮线用**亮色板**
  // （TRACER_FRIENDLY/ENEMY，见顶部注释）；未知阵营仍为白（unknown ≠ enemy）。
  function shotTeamColor(s) {
    const d = DATA.vehicles.find((x) => x.eid === s.shooter_eid);
    const t = d ? d.team : 0;
    const ft = DATA.meta.friendly_team;
    if ((t !== 1 && t !== 2) || (ft !== 1 && ft !== 2)) return COLOR_UNKNOWN;
    return t === ft ? TRACER_FRIENDLY : TRACER_ENEMY;
  }
  // 命中类型 → 写实命中特效（全部 transient，无 decal/弹孔；外观见 battleFx.js）：
  //   pen（击穿）= 小火光 + 橙色余火 + 暗烟；nonpen = 亮白火花回溅 + 灰烟；
  //   ricochet = 火花顺出射方向划过 + 淡烟；miss（无 target）/未知结果 = 不生成（不伪造）。
  // impactKind 见 ./impactKind.js（纯函数，可单测）：game_hit_result 枚举里没有"跳弹"
  // 取值（1=未击穿、2=间隙止），只有作者 hit_flags & 0x0008 才是跳弹证据。
  // 寿命按真实壁钟计（UI feedback transient）：0.5x / 16x 下可读时长一致；暂停时自然播完；
  // seek 由 clearEffects 直接清空。
  function spawnImpact(tr) {
    const kind = impactKind(tr.shot);
    if (!kind) return;
    battleFx.spawnImpact(kind, tr.impactPos, tr.dir, tr.out, performance.now(), tr.seed);
  }

  function updateTracers() {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      if (T < tr.t0) continue;
      // 沿折线推进：头部按时间落在当前段（段内匀速），尾部 = 头部**弧长位置**回退
      // TRACER_STREAK_M 米（跳弹拐角时尾巴跟着折线弯）。零分配：into 变体直写 scratch。
      pointAtInto(tr.points, tr.legEnds, T, tr.t0, _tpA);
      const sHead = arcAtTime(tr.points, tr.legEnds, tr.arcEnds, T, tr.t0);
      // 弹头还在炮管里（没过炮口 s0）：曳光与弹头光晕都不画；尾部不早于炮口
      tr.inBarrel = sHead <= tr.s0;
      tr.mesh.visible = !tr.inBarrel;
      pointAtArcInto(tr.points, tr.arcEnds, Math.max(sHead - TRACER_STREAK_M, tr.s0), _tpB);
      battleFx.setTracer(tr.mesh, _tpB, _tpA, tr.color);
      tr.head.copy(_tpA);
      if (!tr.hit && T >= tr.legEnds[0]) { tr.hit = true; spawnImpact(tr); }
      // 完成判定 = **时间到终点**（折线改造曾误留旧变量 `f >= 1`——f 已不存在，
      // 每帧 ReferenceError 中断整个 tick：不渲染、位姿/HUD 全停，且该炮线永远走不到
      // 移除分支 → 持续抛到暂停为止。这就是此前"播放中卡死、暂停即止"的根因。）
      if (T >= tr.t1) {
        battleFx.giveRibbon(tr.mesh);   // 归还条带池；真正的释放在会话结束（battleFx.dispose）
        tracers.splice(i, 1);
      }
    }
    // 弹道光迹：随弹头显现 → 停留 → 淡出 → 归还
    for (let i = trajLines.length - 1; i >= 0; i--) {
      const tl = trajLines[i];
      const opacity = trailOpacityAt(T - tl.t1);
      if (opacity <= 0) {
        battleFx.giveRibbon(tl.mesh);
        trajLines.splice(i, 1); continue;
      }
      const f = tl.end > tl.start ? Math.min(1, (T - tl.start) / (tl.end - tl.start)) : 1;
      const f0 = Math.min(1, tl.s0 / tl.len);   // 炮管内那段不画（见 flushMuzzles）
      tl.mesh.visible = T >= tl.start && f > f0;
      if (!tl.mesh.visible) continue;
      battleFx.setTrail(tl.mesh, _tpA.copy(tl.a).lerp(tl.b, f0), _tpB.copy(tl.a).lerp(tl.b, f), tl.color, opacity);
    }
  }

  // 战斗特效逐帧写入（render 前；按需渲染下只在真正重绘的帧执行）。回放时钟驱动的粒子：
  // 在飞炮弹的弹头光晕、残骸持续烟（存在与否看场景唯一死亡判据 sceneLifeAt，倒带到死亡前
  // 即消失；未知死亡时刻按已渐入处理）。
  function updateBattleFx() {
    if (!battleFx) return;
    battleFx.frame(performance.now(), camera, container.clientHeight, emitReplayFx);
  }
  function emitReplayFx(emit) {
    for (const tr of tracers) if (T >= tr.t0 && !tr.inBarrel) emit.headGlow(tr.head, tr.color);
    if (!battleFx.budget.wreckSmoke) return;
    for (const v of V) {
      if (!v.group.visible) continue;
      const life = sceneLifeAt(v, T);
      if (life?.lifeState !== 'DESTROYED') continue;
      const since = Number.isFinite(life.destroyedKnownAtSec) ? T - life.destroyedKnownAtSec : Infinity;
      const p = v.group.position;
      emit.wreck(p.x, p.y, p.z, v.group.rotation.y, since, wreckClock, v.def.eid);
    }
  }

  // ---------- 战斗反馈 transient（语义与 WotBTools 2D 对齐）----------
  // 关键语义：**壁钟（真实 ms）寿命**，而非回放时钟——任意倍速下可读时长相近
  // （2D battlePlayback.js 同款常量与注释）。因用壁钟，暂停时 transient 自然走完，
  // 无需特殊处理；seek 则清空并重置事件游标（不补播历史动画）。
  // FLOAT_DMG_MS / GHOST_MS / FLASH_MS 来自 ../utils/battlePlayback.js（2D SSOT）；
  // 3D 侧统一在**使用点**乘 FX_SCALE（不改进 SSOT 常量 → 2D 时序不动）
  const ghostByEid = new Map();  // eid -> { fromFrac, toFrac, untilMs }
  const flashByEid = new Map();  // eid -> untilMs
  let dmgEvents = [];          // { t, eid, hpLoss }（回放时钟，升序）
  let burstEvents = [];        // { t, eid }（回放时钟，升序）
  let dmgPtr = 0, burstPtr = 0;

  // 伤害来自血量链下降；击毁特效与模型共用生命事实，不要求 killer/kill 归属。
  function buildTransientSources() {
    dmgEvents = [];
    for (const def of DATA.vehicles || []) {
      const hp = def.hp || [];
      for (let i = 1; i < hp.length; i++) {
        const loss = hp[i - 1][1] - hp[i][1];
        if (loss > 0) dmgEvents.push({ t: hp[i][0], eid: def.eid, hpLoss: loss });
      }
    }
    dmgEvents.sort((a, b) => a.t - b.t);
    // 击杀流和比分需要升序输入；爆炸独立按生命事实生成，不要求击杀归属。
    if (DATA.kills) DATA.kills.sort((a, b) => a.t - b.t);
    buildBurstSources();
    dmgPtr = 0; burstPtr = 0;
  }

  function buildBurstSources() {
    const canonical = store.playbackSession?.canonical;
    const hasCanonicalLife = canonical?.dataset?.vehicles && Number.isFinite(canonical.clock?.startRaw);
    burstEvents = [];
    for (const v of V) {
      // 每次死亡各一次爆焰（issue #622 复活模式：同一 eid 可多次死亡）。
      // 普通战斗每车至多一次死亡——单条行为与既往逐位一致。
      const times = [];
      if (hasCanonicalLife) {
        const seenDeaths = new Set();
        for (const life of canonicalLifeTrack(v, canonical)?.lifeTransitions ?? []) {
          if (life.lifeState !== 'DESTROYED' || !Number.isFinite(life.timeSec)) continue;
          const identityTime = (life.destroyedKnownAtSec ?? life.timeSec) + canonical.clock.startRaw;
          if (!canonicalDeathAppliesTo(v, identityTime, canonical)) continue;
          // 同一次死亡的重复迁移只爆一次（既有不变式）；真复活模式的多死 killedAtSec 互异
          const key = Number.isFinite(life.destroyedKnownAtSec) ? life.destroyedKnownAtSec : life.timeSec;
          if (seenDeaths.has(key)) continue;
          seenDeaths.add(key);
          times.push(life.timeSec + canonical.clock.startRaw);
        }
      } else {
        const death = v.def.death_t;
        if (Number.isFinite(death)) {
          times.push(death);
          for (const d of v.def.death_times ?? []) {
            if (Number.isFinite(d) && d !== death) times.push(d);
          }
        }
      }
      for (const t of times) burstEvents.push({ t, eid: v.def.eid });
    }
    burstEvents.sort((a, b) => a.t - b.t);
  }

  function vehicleByEid(eid) { return V.find((x) => x.def.eid === eid); }

  // 掉血反馈（一次掉血事件 = 伤害数字 + HP 条幽灵段 + 受击闪，与 2D 三件套同源）。
  // 伤害数字的落点与动画完全在 HTML 覆盖层（PlaybackVehicleLabels3D）：canvas sprite 恒在
  // DOM 名牌之下，renderOrder / 世界空间偏移都压不住它，而数字要精确贴住血条右缘，只有同层
  // 读 DOM 几何才做得到（覆盖层内部按 px 定位，不做世界↔屏幕换算）。
  function emitDamageFeedback(eid, hpLoss) {
    const v = vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    labelOverlay?.spawnDamage?.(eid, hpLoss, FLOAT_DMG_MS * FX_SCALE);
    // HP 条幽灵段 + 受击闪（与伤害数字同一 loss 事件驱动，2D 三件套同源）
    const nowMs = performance.now();
    const maxHp = v.def.max_hp > 0 ? v.def.max_hp : 0;
    if (maxHp > 0) {
      const curHp = Math.max(0, hpAt(v, T));
      const fromFrac = Math.max(0, Math.min(1, curHp / maxHp));
      const toFrac = Math.max(0, fromFrac + hpLoss / maxHp);   // 损失前比例（幽灵显示刚丢的量）
      ghostByEid.set(eid, { fromFrac, toFrac, untilMs: nowMs + GHOST_MS * FX_SCALE });
    }
    flashByEid.set(eid, nowMs + FLASH_MS * FX_SCALE);
    labelsTime = null;   // feedback expires independently of playback time
  }

  // 击毁爆炸（外观见 battleFx.js：强闪光 + 地面光斑、湍流火球、黑烟柱、火星；高档加碎片与
  // 地面尘浪）。权威死亡触发一次（buildBurstSources），壁钟寿命 BURST_SECS，seek 不补播。
  function spawnBurst(eid) {
    const v = vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    ensureBattleFx().spawnBurst(v.group.position, performance.now(), eid);
  }

  function updateTransients() {
    const now = performance.now();
    // HP 条反馈过期清理（过期后再刷一次标签以擦除残影/闪光）
    for (const [eid, g] of ghostByEid) {
      if (now >= g.untilMs) {
        ghostByEid.delete(eid);
        labelsTime = null;
        invalidate();   // 到期要重画标签（清幽灵段），否则脏帧会停在这一帧
      }
    }
    for (const [eid, until] of flashByEid) {
      if (now >= until) {
        flashByEid.delete(eid);
        labelsTime = null;
        invalidate();
      }
    }
  }

  function clearTransients() {
    labelOverlay?.clearDamages?.();   // 伤害数字：seek 后不补播（到期由覆盖层自己的定时器负责）
    battleFx?.clearTransients();   // 爆炸 / 开火 / 命中：seek 后不补播
    ghostByEid.clear(); flashByEid.clear();   // 2D seek 同语义：清空且不补播
    dmgPtr = 0; burstPtr = 0;                 // 游标重置：seek 后不补播历史动画
  }

  // ---------- 击杀 feed / 计分 / 名册（实现在 playback/hudFeed.js；快照式工厂） ----------
  //（原节的语义注释——响应式代理登记、阵营视角映射、resolver 单源——随实现迁往该模块）
  const hudFeed = createHudFeed({
    store, getData: () => DATA, getT: () => T, getV: () => V,
    getSessionGen: () => sessionGen, deathAt,
    // reloadStateAt 是闭包 let（startPlayback 里重赋值为真实 resolver）——按 getter
    // 注入，工厂不得按值捕获初始空箭头（名册 reload 列会永远为 null）
    getReloadStateAt: () => reloadStateAt,
    getFollowEid: () => FOLLOW_EID,
  });
  function advanceKills() { hudFeed.advanceKills(); }
  function rebuildFeed() { hudFeed.rebuildFeed(); }
  function resetScore() { hudFeed.resetScore(); }
  function updateScore() { hudFeed.updateScore(); }
  function buildRoster() { hudFeed.buildRoster(); }
  function updateRoster() { hudFeed.updateRoster(); }

  // ---------- 主循环 ----------
  const tmpV = new THREE.Vector3();
  let followAnchor = null;             // 跟随模式：上一帧坦克位置（位移增量基准）
  const tmpDir = new THREE.Vector3();  // 进入跟随：相机方向临时量
  const FOLLOW_SNAP_DIST = 26;         // 进入跟随：相机沿当前方向收拢到此距离（米；坦克约 7m 长）
  const FOLLOW_MIN_HEIGHT = 9;         // 进入跟随：相机至少高于坦克此高度（米，保证俯角不贴地）
  // 可破坏状态推进（回放时钟；seek 后退 = 全量重算，前进 = 游标泵）。
  // 实例化后不再有 pivot 节点：树倒写**逐实例矩阵**（T(p)·R·T(−p)·base，与旧 pivot
  // 装配逐值等价，见 sceneryInstancing.js），建筑换模在 base / 隐藏矩阵之间翻转实例
  // 矩阵。树只在自己倒伏窗口内写矩阵、终态后写一次不再碰（省去 700+ 次 compose）；
  // 实例矩阵上传按帧合并（同帧多树只触发一次所在批次的 needsUpdate）。
  function updateDestructibles(T) {
    if (!destruct) return;
    const states = destruct.states;
    if (T < destruct.lastT) {
      destruct.ptr = 0;   // seek 后退：全部回到未激活
      // 树终态缓存随回退**显式失效**。⚠️ 此处不得置 upright=true（评审 P1）：
      // upright 是「槽位已恢复直立」的标记，提前置 true 会让未激活分支跳过
      // base 矩阵恢复——树已倒下后回退到事件前，画面仍停在倒伏姿态。
      // 复位交给下方 !active 分支（upright=false 时才执行 base 写回 + fallQuat 复位）。
      for (const st of states) if (st.prop === 3) st.settled = false;
    }
    destruct.lastT = T;
    while (destruct.ptr < states.length && states[destruct.ptr].clock <= T) destruct.ptr++;
    destruct.animating = false;
    let dirty = null;   // 本帧被写过的批次 → 一次性 needsUpdate（Set 去重多树同批次）
    const mark = (mesh) => { (dirty || (dirty = new Set())).add(mesh); };
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      const active = i < destruct.ptr;
      if (st.prop === 3) {
        if (!st.slots) continue;
        if (!active) {
          // 倒带复位：恢复 base（直立）。upright 标记免每帧重写（旧实现查四元数非零）。
          if (!st.upright) {
            for (const s of st.slots) { s.mesh.setMatrixAt(s.idx, s.base); mark(s.mesh); }
            st.fallQuat.w = 1;
            st.upright = true;
          }
          continue;
        }
        // 推进决策在 destructibles.treeFrame（纯函数，单测锁定倒带序列），此处只写
        // 实例矩阵与 fallQuat（settled 自校验的第二道防线用）。
        const f = treeFrame(st, true, T);
        if (f) {
          if (f.animating) destruct.animating = true;
          _tmpFallAxis.set(f.axis[0], f.axis[1], f.axis[2]);
          for (const s of st.slots) {
            fallMatrix(s.base, st.pivotPos.x, st.pivotPos.y, st.pivotPos.z, _tmpFallAxis, f.angle, _tmpInstM);
            s.mesh.setMatrixAt(s.idx, _tmpInstM);
            mark(s.mesh);
          }
          _tmpFallQ.setFromAxisAngle(_tmpFallAxis, f.angle);
          st.fallQuat.w = _tmpFallQ.w;
          st.upright = false;
        }
      } else {
        if (active === !!st.applied) continue;
        st.applied = active;
        // 完好态：存活期显示、摧毁后隐藏；损毁态相反（旧 visible 翻转 → 实例矩阵翻转）。
        for (const s of st.intactSlots || []) {
          if (active) writeHiddenInstance(s.mesh, s.idx); else s.mesh.setMatrixAt(s.idx, s.base);
          mark(s.mesh);
        }
        for (const s of st.deadSlots || []) {
          if (!active) writeHiddenInstance(s.mesh, s.idx); else s.mesh.setMatrixAt(s.idx, s.base);
          mark(s.mesh);
        }
      }
    }
    if (dirty) for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }
  const _tmpFallAxis = new THREE.Vector3();
  const _tmpInstM = new THREE.Matrix4();
  const _tmpFallQ = new THREE.Quaternion();
  // 炮线折线求值 scratch（每帧多车并发，避免逐帧分配）
  const _tpA = new THREE.Vector3(), _tpB = new THREE.Vector3();

  const detachedPose = {};
  /**
   * 分离事实是否属于**当前这一世**（issue #622 review P2）：复活模式下车会带着炮塔复活——上一世的
   * 飞头不应让新车继续无炮塔。分离从 detached 轨道首帧起生效，到该车**下一次复活**为止（规则与
   * `defLifeAt` 同一份上游字段，原始时钟域）；复活后的新死亡若再飞头，会有新的 detached 轨道
   * （新首帧）重新接管。飞头实体自身的渲染不受此判据影响（它有自己的 coverage 与位姿轨道）。
   */
  function detachmentAppliesNow(v, head) {
    const startRaw = head.track.pose_kf.t[0];
    if (!(T >= startRaw)) return false;
    for (const r of v.def.resurrection_times || []) {
      if (r > startRaw && r <= T + 1e-6) return false;
    }
    return true;
  }
  function applyDetachedTurrets(v) {
    let separated = false;
    for (const head of v.detachedTurrets) {
      const known = T >= head.track.pose_kf.t[0];
      separated ||= known && detachmentAppliesNow(v, head);
      head.root.visible = known && !classIconsVisible() && sampleDetachedPose(head.track, T, detachedPose);
      if (head.root.visible) {
        head.root.position.set(detachedPose.x, detachedPose.y, detachedPose.z);
        yprScene(detachedPose.yaw, detachedPose.pitch, detachedPose.roll, head.root.quaternion);
      }
      head.proxy.visible = !head.glb;
      if (head.glb) head.glb.visible = true;
      // Detachment is itself known destruction evidence for this part, even if
      // canonical vehicle life is still loading. Rewind simply hides the part.
      const amount = destroyedVisualAmount({ lifeState: 'DESTROYED', destroyedKnownAtSec: head.track.pose_kf.t[0] }, T);
      applyTankDestroyedVisual(head.proxyVisual, amount);
      applyTankDestroyedVisual(head.glbVisual, amount);
    }
    v.turretG.visible = !separated;
    if (v.glbParts) {
      // 固定战斗室（turretNode=null，歼击车）没有炮塔节点可摘——脱落时只藏炮管组
      //（TD 的炮架横转就是它的「炮塔」，脱落件一并带走）。
      if (v.glbParts.turretNode) v.glbParts.turretNode.visible = !separated;
      for (const node of v.glbParts.gunNodes) node.visible = !separated;
    }
  }

  function applyPose(v) {
    applyDetachedTurrets(v);
    const life = sceneLifeAt(v, T);
    const dead = life?.lifeState === 'DESTROYED';
    const amount = destroyedVisualAmount(life, T);
    applyTankDestroyedVisual(v.proxyVisual, amount);
    applyTankDestroyedVisual(v.glbVisual, amount);
    // 死亡后模型不消失：coverage 在阵亡处截止，但残骸应留在最后已知位置
    // （posAt 对越界时间钳位到最后采样，即阵亡点），与游戏内残骸留场行为一致
    const vis = visibleAt(v, T) || dead;
    v.group.visible = vis;
    if (v.glb) v.glb.visible = vis && !classIconsVisible();
    if (!vis) {
      // 悬挂积分复位：不可见期间不累积侧位移（复现时首帧吸附，不跳变）
      if (v.suspParts) {
        for (const k of ['L', 'R']) if (v.suspParts.sides[k]) v.suspParts.sides[k].prev = null;
      }
      return;
    }
    posAt(v, T, tmpV);
    v.group.position.copy(tmpV);
    if (v.glb) poseGlb(v);
    // 低模位姿（GLB 显示时保留低模位姿更新，切回低模无跳变）：与 GLB 侧同口径 = **记录位姿**
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = -yawAt(v, T);
    v.group.rotation.x = hullPitchAt(v, T);
    v.group.rotation.z = -rollAt(v, T);   // 横滚（符号约定见 rollAt 注释）
    if (v.hullGroup) {
      v.hullGroup.quaternion.identity();
      v.hullGroup.position.set(0, 0, 0);
    }
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    v.turretG.rotation.y = -rel;
    v.gunPivot.rotation.x = -gunPitchAt(v, T);
  }

  // 按需渲染的脏标记：状态跳变（seek/换相机/开关节/尺寸变化/特效到期）必须显式置脏，
  // 否则那一帧的静止状态会一直停留在旧画面上。
  let frameDirty = true;
  function invalidate() { frameDirty = true; }

  // 实时帧率（FPS 覆盖层）：rAF 回调间隔的 500ms 窗口均值，每窗口写一次 store
  //（每帧只多两次减法；窗口边界才触发一次响应式写入）。暂停 / 恢复时重新起窗。
  const frameMeter = createFrameMeter();
  let lastRenderAt = 0;
  let fpsIdle = false;   // 场景进入空闲（!busy）后置位；恢复渲染前 re-起窗

  let winnerShown = false;
  function animate() {
    if (destroyed) return;
    if (paused) { rafId = 0; return; }   // 停帧：不排队下一帧，场景与状态原样保留
    rafId = requestAnimationFrame(animate);
    if (!renderer) return;   // 渲染器惰性创建（首次 startPlayback）：数据加载完成前无场景可渲染
    const dt = Math.min(clock.getDelta(), 0.1);
    if (DATA && PLAYING) {
      // 推进 + 钳制合并到纯函数里（NaN/负增量不会污染时钟）；终点是比赛结束 END，不是录像流结束
      T = advancePlaybackTime(T, END, dt * 1000, SPEED);
      wreckClock += dt;
      suspDt = dt;          // 行程限速用的逐帧 dt（客户端同源：按帧步长限速）
      suspSnap = false;
      tick();
      if (T >= END) setPlaying(false);   // 先 tick 后停：停播时的 HUD/名册补写要包含终点帧的事件
    }
    // 动画混合层（烟雾/瀑布/浪）：纹理位移按**回放时钟**走——暂停即停、seek 后相位
    // 由回放时刻唯一确定（不随壁钟漂移，截图可复现）。未装载时该数组为空。
    if (animLayerMats.length) {
      const secs = T / 1000;
      for (const mm of animLayerMats) mm.uniforms.uTime.value = secs;
    }
    // 相机
    // 跟随模式：相机位置与视点目标按坦克逐帧位移整体平移——用户选好的方位/
    // 距离/俯仰刚性保持，不会被拉回固定机位；旋转/缩放/平移始终自由
    if (DATA && CAM === 'follow' && FOLLOW_EID) {
      const v = V.find((x) => x.def.eid === FOLLOW_EID);
      if (v && v.group.visible) {
        posAt(v, T, tmpV);
        if (!followAnchor) {
          controls.target.copy(tmpV);          // 进入跟随：视点先对准车体（旋转中心 = 坦克）
          // 拉近：沿**当前观察方向**把相机收到跟随距离——此前进入跟随只挪视点、相机留在
          // 开局全景位（数百米外），旋转看起来绕着别处转。仅当当前更远时收拢（用户已手动
          // 贴近则不打扰），且不低于 minDistance+2（否则 controls.update 会再推出去）。
          const off = tmpDir.subVectors(camera.position, tmpV);
          const snap = Math.max(FOLLOW_SNAP_DIST, (controls.minDistance || 0) + 2);
          if (off.length() > snap) {
            camera.position.copy(tmpV).addScaledVector(off.normalize(), snap);
          }
          if (camera.position.y < tmpV.y + FOLLOW_MIN_HEIGHT) {
            camera.position.y = tmpV.y + FOLLOW_MIN_HEIGHT;
          }
        } else {
          const dx = tmpV.x - followAnchor.x, dy = tmpV.y - followAnchor.y,
                dz = tmpV.z - followAnchor.z;
          camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
          controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
        }
        followAnchor = (followAnchor || new THREE.Vector3()).copy(tmpV);
      } else followAnchor = null;
    } else followAnchor = null;
    clampCameraTarget();
    // flyMode 接管期间 OrbitControls.update() 必须完全停跑：enabled=false 只挡输入
    // 事件、update 照常执行——其内部球面状态会按 target/相机重算，与 flyLook 的
    // target 重钉互相污染（表现 = 拖拽行为在 FPS 转头与 OrbitControls 环绕之间漂移、
    // WASD 位移被球面拉回吞掉）。相机推进由 flyTick 全权负责。
    // flyMode 接管不变量（每帧断言）：enabled 意外被拉回 true 的同一帧压回 false，
    // 杜绝"FPS 转头与环绕/pan 漂移交替"的整类状态漂移。
    if (flyMode() && controls.enabled) controls.enabled = false;
    // free 接管期间 update() 不跑，它的 lookAt(target) 也随之缺席——相机朝向由本行
    // 维持（target 是权威：拖拽 / 平移 / 缩放都会先重钉 target）。不补这一步，
    // 拖拽只改 target 不改朝向，画面不转（用户实测）。
    if (flyMode()) camera.lookAt(controls.target);
    const cameraMoved = flyMode() ? false : controls.update();   // three 的 update() 返回相机是否变化（阻尼/交互）
    // ---------- 按需渲染（脏帧）----------
    // 暂停且没有在飞特效、相机也静止时，跳过整帧工作（标签/基地/transient 重算 + 全屏
    // render）。此前空闲也满速重绘，是移动端发热与笔记本耗电的第一来源。
    // 伤害数字不参与这个判定：它是覆盖层 DOM + CSS 动画，暂停时自己走完，不需要出帧。
    const busy = PLAYING
      || cameraMoved
      || frameDirty
      || (destruct && destruct.animating)
      || tracers.length > 0 || (battleFx && battleFx.active())
      || ghostByEid.size > 0 || flashByEid.size > 0;
    if (!busy) {
      // 空闲（场景确实停画，而不是渲染很慢）：显式重起统计窗，避免把空闲间隙
      // 算成一帧；超过 0.6s 把角标归零（显示 —），别让旧帧率冒充“当前”。
      // 注意判定只在这里做——PLAYING 期间即使 300ms/帧也照常计入长帧（评审 P2）。
      const now = performance.now();
      const since = lastRenderAt ? now - lastRenderAt : Infinity;
      if (since > 250 && !fpsIdle) { frameMeter.reset(); fpsIdle = true; }
      if (store.fps && since > 600) {
        store.fps = 0; store.frameMs = 0; store.framePeakMs = 0;
      }
      return;
    }
    if (fpsIdle) { frameMeter.reset(); fpsIdle = false; }   // 恢复渲染：全新窗口
    lastRenderAt = performance.now();
    // 只统计**真正渲染的帧**：按需渲染下 rAF 每帧都跑（暂停静止也跑），数回调会得到
    // 120 FPS 这种与画面无关的数——用户实测「卡顿和显示的帧率不符」正是这个。
    const fpsStats = frameMeter.sample(lastRenderAt);
    if (fpsStats) {
      store.fps = fpsStats.fps;
      store.frameMs = fpsStats.frameMs;
      store.framePeakMs = fpsStats.peakMs;
    }
    frameDirty = false;
    // 动态分辨率调整必须在**渲染前**（黑闪根因）：canvas width/height 赋值会清空
    // drawing buffer——若在渲染后调整，合成器在下一帧渲染前取到空 buffer 即黑帧。
    // 渲染前调整则本帧立刻以新分辨率画满，buffer 从不空。dt 取自本帧 rAF。
    if (dynResCtl) {
      const nd = dynResCtl.frame(dt * 1000);
      if (nd != null) {
        const w = container.clientWidth, h = container.clientHeight;
        renderer.setSize(w, h, false);
        renderer.setPixelRatio(nd);
        renderer.domElement.style.width = w + 'px';
        renderer.domElement.style.height = h + 'px';
      }
    }
    const perfT0 = PERF ? performance.now() : 0;
    updateLabels();
    updateBases();
    updateTransients();
    updateBattleFx();     // 战斗特效（壁钟特效暂停时也继续自然播完）
    const perfT1 = PERF ? performance.now() : 0;
    maybeRebuildTerrainLod();   // 地形 LOD 跟随相机姿态（视距滞回 + 绕转/FOV/aspect；120 ms 节流）
    renderer.render(scene, camera);
    if (PERF) perfFrame(perfT1 - perfT0, performance.now() - perfT1);
  }

  // ---------- 性能探针（`?perf`；只读测量，不改变任何渲染行为） ----------
  // 3D 卡顿类问题靠"读代码"定不了位：这里逐帧记录**分阶段耗时**（场景状态更新 /
  // 提交渲染）与当时的**在场对象数**，并保留最慢的若干帧（含回放时刻 T）——复现后
  // 在控制台执行 `__pbPerf.report()` 即可拿到证据（谁慢、慢在哪个阶段、当时有多少
  // 炮线/轨迹盒/命中特效/爆散/可见车辆）。
  const PERF = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('perf');
  let dynResCtl = null;
  let rendererCaps = null;   // 当前渲染器实际装配的 { logdepth, dynres }（reset 保留渲染器时用于失配检测）
  const PERF_RING = 240;              // ≈4s 窗口（60fps）
  let perfRing = [], perfRingN = 0, perfLast = 0, perfSlow = [];
  function perfFrame(updateMs, renderMs) {
    const now = performance.now();
    const dt = perfLast ? now - perfLast : 0;
    perfLast = now;
    // draw call 数（renderer.info 是上一帧 render 的累计）：场景侧结构性优化（材质去重 /
    // 实例化 / 冻结）的收益直接体现在这个数上，没有它优化前后无法量化对比。
    const calls = renderer ? renderer.info.render.calls : 0;
    perfRing[perfRingN % PERF_RING] = { dt, updateMs, renderMs, t: T, calls,
      dpr: renderer ? Math.round(renderer.getPixelRatio() * 100) / 100 : 0,
      tracers: tracers.length, traj: trajLines.length, impacts: battleFx ? battleFx.stats().impacts : 0,
      burst: battleFx ? battleFx.stats().bursts : 0,
      veh: V.filter((v) => v.group.visible).length };
    perfRingN++;
    if (dt > 33) {
      perfSlow.push({ dt, updateMs, renderMs, t: T });
      perfSlow.sort((a, b) => b.dt - a.dt);
      if (perfSlow.length > 12) perfSlow.length = 12;
    }
  }
  function perfReport() {
    const n = Math.min(perfRingN, PERF_RING);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(perfRing[i]);
    if (!rows.length) return 'no frames';
    const q = (key, p) => {
      const a = rows.map((r) => r[key]).sort((x, y) => x - y);
      return a[Math.min(a.length - 1, Math.floor(a.length * p))];
    };
    const f = (v) => v.toFixed(1);
    const last = rows[rows.length - 1];
    const out = [
      `frames=${perfRingN} (window ${n})`,
      `frame ms  med=${f(q('dt', 0.5))} p90=${f(q('dt', 0.9))} max=${f(q('dt', 0.99))}`,
      `update ms med=${f(q('updateMs', 0.5))} p90=${f(q('updateMs', 0.9))}`,
      `render ms med=${f(q('renderMs', 0.5))} p90=${f(q('renderMs', 0.9))}`,
      `draw calls med=${f(q('calls', 0.5))} p90=${f(q('calls', 0.9))} max=${f(q('calls', 0.99))}`,
      `pixel ratio med=${f(q('dpr', 0.5))} min=${f(q('dpr', 0.05))}`,
      `now: T=${last.t.toFixed(1)} veh=${last.veh} tracers=${last.tracers} trajBoxes=${last.traj} impacts=${last.impacts} burst=${last.burst}`,
      'slowest frames (dt ms / update / render / T):',
      ...perfSlow.map((r) => `  ${f(r.dt)} / ${f(r.updateMs)} / ${f(r.renderMs)} @T=${r.t.toFixed(1)}`),
      `main-thread stalls >${PERF_HEARTBEAT_MS * 2}ms: ${perfStalls.length}`,
      ...perfStalls.map((r) => `  ${f(r.gap)} ms @T=${r.t.toFixed(1)}`),
    ];
    return out.join(String.fromCharCode(10));
  }
  // 主线程停顿看门狗（`?perf`）：帧循环之外的**长任务**（例如解析/投影跑在主线程）不会出现在
  // 帧间隔里——它们表现为"下一帧的 dt 巨大、但 update/render 都很小"。看门狗用 50ms 心跳量真实
  // 间隔，直接抓出这类停顿（含当时的回放时刻 T），与帧统计互相印证。
  const PERF_HEARTBEAT_MS = 50;
  let perfStalls = [], perfBeat = 0, perfBeatTimer = 0;
  function perfStartWatchdog() {
    if (!PERF || perfBeatTimer) return;
    perfBeat = performance.now();
    perfBeatTimer = setInterval(() => {
      const now = performance.now();
      const gap = now - perfBeat;
      perfBeat = now;
      if (gap > PERF_HEARTBEAT_MS * 2) {
        perfStalls.push({ gap, t: T });
        perfStalls.sort((a, b) => b.gap - a.gap);
        if (perfStalls.length > 8) perfStalls.length = 8;
      }
    }, PERF_HEARTBEAT_MS);
  }
  if (PERF) {
    perfStartWatchdog();
    window.__pbPerf = {
      report: () => { const s = perfReport(); console.log(s); return s; },
      reset: () => { perfRing = []; perfRingN = 0; perfSlow = []; perfStalls = []; perfBeat = performance.now(); },
    };
  }

  /** 预热在用材质（见 renderer 初始化处注释）：把首次编译的数十~数百 ms 从"战斗第一次
   *  开火/命中"挪到加载阶段。失败不影响播放（best-effort）。 */
  function prewarmShaders() {
    try {
      camera.updateMatrixWorld();
      // 战斗特效的批次与条带平时按需隐藏：预热期间临时显示，避免首发开火时才编译
      ensureBattleFx().prewarm(() => {
        renderer.compile(scene, camera);
      });
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }

  function tick() {
    // 弹道推进
    const shots = DATA.shots;
    while (shotPtr < shots.length && shots[shotPtr].t_fire <= T) { spawnShot(shots[shotPtr], shotPtr); shotPtr++; }
    advanceKills();
    // Visibility/position at this T must precede feedback: a newly destroyed vehicle
    // can become visible again after coverage ended, so last frame's visibility is stale.
    for (const v of V) applyPose(v);
    suspSnap = false;   // pose has consumed the seek snap for this tick
    // 炮口要等本 tick 炮管摆到 T 时刻姿态后再定位；曳光 / 光迹的可见起点（炮口）由它填入，
    // 所以弹道推进排在它之后
    flushMuzzles();
    updateTracers();
    // 战斗反馈事件泵（回放时钟；壁钟寿命见 transient 段）
    while (dmgPtr < dmgEvents.length && dmgEvents[dmgPtr].t <= T) {
      const e = dmgEvents[dmgPtr++];
      emitDamageFeedback(e.eid, e.hpLoss);
    }
    while (burstPtr < burstEvents.length && burstEvents[burstPtr].t <= T) {
      spawnBurst(burstEvents[burstPtr++].eid);
    }
    updateDestructibles(T);
    updateTrails();     // 履带印游标泵（seek 后退 = 全量重算，前进 = 增量）
    updateScore();
    // HUD → store
    // 顶栏：争霸实时点数——**每 tick 确定性重算**（无采样也写 null）：从争霸场切到普通场时
    // supremacy_points 缺失，若只在有采样时才写，上一场的点数会残留在 HUD 上。
    // 阵营映射只认 friendly_team ∈ {1,2}（unknown ≠ enemy，见 pointsAt）。
    {
      const pts = pointsAt(DATA.supremacy_points, T, DATA.meta.friendly_team);
      // 变更守卫与 updateScore 同款：点数在两次占领事件间恒定，60Hz 无守卫写是仅存的
      // 每 tick reactive 写入（Vue 同值短路只免 trigger，不免 proxy set 本身）。
      if (store.pointsFriend !== pts.friend) store.pointsFriend = pts.friend;
      if (store.pointsEnemy !== pts.enemy) store.pointsEnemy = pts.enemy;
    }
    // 顶栏：单基地目标存在性 + 占领进度（取 ≤T 最后一条；无目标证据整行不显示）
    writeHud();
    if (!winnerShown && T >= END - 1e-3 && DATA.meta.winner_team) {
      winnerShown = true;
      const w = DATA.meta.winner_team, fr = DATA.meta.friendly_team;
      // outcome 供消费方面板三语化（text 为上游兼容中文字段；WotBTools 唯一分叉的加性字段）
      store.banner = {
        text: w === 0 ? '平局' : (w === fr ? '胜利' : '失败'),
        color: w === fr ? '#3fa66a' : '#c05046',
        outcome: w === 0 ? 'draw' : (w === fr ? 'win' : 'lose'),
      };
    }
  }

  // ---------- 控制 ----------
  // HUD 降频：store.time / seekFrac 每帧都变会让页面壳（AgentReplay3D）每帧整页 VDOM patch
  // 一次（顶栏 + 双名册 + 击杀流 + 传输控件）。3D 平滑度来自场景时钟，HUD 与进度条按
  // ~10Hz 更新即可；seek / 会话开始 / 停播等状态跳变时 force 立即补一次，语义不丢。
  const HUD_INTERVAL_MS = 100;
  let hudWrittenMs = -Infinity;
  function writeHud(force = false) {
    if (!DATA) return;
    const now = performance.now();
    if (!force && now - hudWrittenMs < HUD_INTERVAL_MS) return;
    hudWrittenMs = now;
    if (force) publishLabels(true);
    // 顶栏：双方队伍总血量（与上游 3D 视图同口径：各队 max_hp 汇总；未知阵营不计入任一方，
    // 见 teamHpTotals）。随 HUD 10Hz 节流写入即可——血量每秒变化远低于此，没必要每帧
    // 触发整页 VDOM patch（见上方 HUD_INTERVAL_MS）。
    Object.assign(store, teamHpTotals(
      V.map((v) => ({ team: v.def.team, hp: hpAt(v, T), maxHp: v.def.max_hp })),
      DATA.meta.friendly_team,
    ));
    // 名册与上面的总血量同帧写入：两侧名册与顶栏永远是同一个 T 的投影
    updateRoster();
    store.time = T;
    const f = (T - START) / Math.max(0.001, END - START);
    if (!store.seeking) store.seekFrac = Math.round(f * 1000);
  }
  function setPlaying(p) {
    PLAYING = p;
    store.playing = p;
    // 停下（暂停 / 播到终点）后不再有帧：把 HUD 与名册补写到当前 T，
    // 否则停在节流窗口里的上一次写入（最后 ≤100ms 的掉血 / 击毁不上屏）
    if (!p) writeHud(true);
    invalidate();
  }
  /** 宿主可见性闸门：暂停时停帧（保留会话），恢复时重挂帧循环；已初始化场景还要
   *  丢弃暂停期间的时间差。渲染器/时钟是惰性创建的（首次 startPlayback 才 initScene），
   *  所以 pre-init resume 不能读 `clock`，但必须把 pause 取消掉的唯一 rAF 重新挂回去；
   *  `animate()` 在 renderer 尚不存在时本身就是安全的空转等待。 */
  function setPaused(next) {
    const value = !!next;
    if (value === paused) return;
    paused = value;
    if (paused) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!destroyed) {
      // pre-init 也必须把被 pause 取消的唯一 rAF 重新挂回去：animate() 本身在 renderer
      // 尚未创建时只排下一帧并安全返回。否则「待开播切走 → 切回 → Start」会进入
      // paused=false / renderer!=null / rafId=0 的死态，场景 ready 但时间与画面都不再推进。
      if (clock) clock.getDelta();   // 已初始化时丢弃暂停期间累积的 dt
      frameMeter.reset();            // 恢复后重新起窗：暂停间隙不得计入帧间隔
      if (!rafId) animate();
    }
  }
  /** 当前权威时钟（canonical 优先，场景自推兜底）下的 [START, END]，夹在录像数据范围内。 */
  function battleRange() {
    const dataStart = DATA.meta.t_start;
    const dataEnd = Math.max(dataStart, battleEndTime(DATA));
    const clock = canonicalClock || sceneClock;
    if (!clock) return [dataStart, dataEnd];
    const streamEnd = Number(DATA.meta.duration) > dataStart ? Number(DATA.meta.duration) : dataEnd;
    const start = Math.min(Math.max(dataStart, clock.startRaw), streamEnd);
    const end = Number.isFinite(clock.durationSec) && clock.durationSec > 0
      ? Math.min(streamEnd, clock.startRaw + clock.durationSec) : dataEnd;
    return [start, Math.max(start, end)];
  }
  /**
   * canonical 时钟换了（晚到 / 失败 / 换会话）：重定 [START, END]，把 T 夹回范围（越界才 seek，范围内不打断播放），
   * 越过新终点时停播；随即发布到 store，播放条 / 顶栏 / Details 与引擎同一刻对齐。
   */
  function setBattleClock(clock) {
    canonicalClock = clock && Number.isFinite(clock.startRaw) ? { startRaw: clock.startRaw, durationSec: clock.durationSec } : null;
    if (!DATA) return;
    [START, END] = battleRange();
    buildBurstSources();
    burstPtr = firstIndexAfter(burstEvents, T);   // late canonical never replays past explosions
    store.startTime = START;
    store.duration = END;
    const t = Math.max(START, Math.min(END, T));
    if (t !== T) seekTo(t);
    else for (const v of V) applyPose(v);   // canonical late/failure refreshes paused visuals too
    if (PLAYING && T >= END) setPlaying(false);
    writeHud(true);
    invalidate();
  }
  function seekTo(t) {
    T = Math.max(START, Math.min(END, t));
    clearEffects();   // 动态层 dispose（与 teardown 同一路径，防 seek 循环累积显存）
    // 游标一律重定到「T 之后第一条」：clearEffects 已把 transient 游标归零，
    // 若不重定，紧随的 tick() 会把 t<=T 的历史飘字/爆散一次性补播（与 2D seek 语义不符）
    shotPtr = firstIndexAfter(DATA.shots, T, (x) => x.t_fire);
    dmgPtr = firstIndexAfter(dmgEvents, T);
    burstPtr = firstIndexAfter(burstEvents, T);
    rebuildFeed();
    resetScore();     // 比分为单调游标，seek 后必须从头推进（否则分数不回落）
    winnerShown = false; store.banner = null;
    suspSnap = true;  // 跳变：行程吸附到目标、侧位移不积分（客户端"首次可见直接吸附"同款）
    suspDt = 0;
    tick();
    suspSnap = false;
    // seek 是状态跳变：立即把 HUD/进度条/名册对齐到新 T（不等下一个降频窗口）——
    // 暂停时没有帧在跑，名册投影只能靠这次强制写入。
    writeHud(true);
    invalidate();
  }
  function setFollow(eid) {
    FOLLOW_EID = eid;
    if (FOLLOW_EID) { setCam('follow'); } else { setCam('free'); }
    // 跟随变更立即应用到名册行（followed 高亮）：updateRoster 平时在 tick 里跑，
    // **暂停时不跑**——不补这次，暂停中点跟随的行高亮永远不亮（实测门禁抓到）。
    if (DATA) updateRoster();
    invalidate();
  }
  function setCam(mode) {
    // Top 是一次性战术总览动作，不是可持续相机模式。俯视快照完成后立刻回到
    // Free 状态，让键盘、鼠标与触屏控制从同一帧起可用。
    const topAction = mode === 'top';
    const nextMode = topAction ? 'free' : mode;
    CAM = nextMode;
    store.cam = nextMode;
    flyLookApplyMode(topAction ? 'follow' : nextMode); // 先清理飞行手势，再接管 Free
    if (topAction) FOLLOW_EID = 0;
    // 场景未初始化（renderer 惰性创建，首次 startPlayback 才有 controls）：只记录模式，
    // 初始化后由 animate 按 CAM/FOLLOW_EID 逐帧生效——名册点击可先于首帧发生。
    if (!controls) { invalidate(); return; }
    // free 接管期间 controls.enabled 必须保持 false（OrbitControls 的 pan/rotate
    // 无生效路径）——不得在此无条件拉回 true（top→free 复活拖曳移动的根因）
    controls.enabled = !flyMode();
    invalidate();
    if (topAction) {
      const { cx, cz } = WORLD_CENTER;
      camera.position.set(cx, topCameraDefaultHeight(), cz + 0.01);
      controls.target.set(cx, 0, cz);
      constrainFreeCameraAltitude();
      // 保留直下俯视的实际画面，同时为下一次自由飞行准备可用的水平朝向。
      flyLookSyncFromCamera('top overview', true);
      flyLook.yaw = 0;
      controls.enabled = false;
    } else if (nextMode === 'free') {
      FOLLOW_EID = 0;
      constrainFreeCameraAltitude();
    }
    // 跟随目标是名册的运行时状态（followed）。setFollow 也经由这里：暂停时没有帧在跑，
    // 换相机必须自己补写，否则跟随描边要等到下次播放 / seek 才出现。走 writeHud 而不是
    // 直接投影名册：播放中名册也不得跑到顶栏前面（两者始终同一个 T）。
    writeHud(true);
  }
  // 只接受档位表内的值：面板按钮与 URL 参数都不该把场景带进"1.37×"这种未定义速度
  function setSpeed(s) { if (!isPlaybackSpeed(s)) return; SPEED = s; store.speed = s; }

  // ---------- 键盘自由视角（WASD/QE 飞行）----------
  // 速率档 1–6（与播放速度档独立）：场景只存展示值并失效一帧（暂停时改档也出帧）；
  // 位移推进本体在 composables/useSceneFlyControls.tickFly（Replay3DPane 逐帧调用，
  // 相机数学不进内核——OrbitControls 的 target 随位移平移，其余控制语义不变）。
  function topCameraDefaultHeight() { return WORLD_CENTER.ext * 1.7; }
  function setFlySpeed(n) {
    if (!isFlySpeedIndex(n)) return;
    store.flySpeed = FLY_SPEEDS[n - 1];
    store.flySpeedIndex = n;
    invalidate();
  }
  // 键盘飞行一帧（Replay3DPane 的 useSceneFlyControls 循环逐帧调用）：follow 不接管
  //（跟随语义 = 车体锚定）；位移并入按需渲染判定（暂停时按键也出帧）。dt ≤ 0 零位移。
  // pressed = 调用方（composable 实例）维护的按下键集合——按键态不进内核（pane 持有）。
  let flyWasMoving = false;
  function flyTick(dt, pressed) {
    if (!controls || !DATA || !flyMode() || !(dt > 0) || !pressed?.size) return false;
    // 相机可能被非飞行路径改过（初始 fit / 跟随退出）：首帧对齐朝向基准，防 target 跳变
    flyLookSyncIfStale('tick');
    // 接管（enabled/damping/朝向反解）由 flyLookApplyMode 在模式切换时完成；
    // 这里只做平移推进 + target 重钉。
    const speed = store.flySpeed || FLY_SPEEDS[DEFAULT_FLY_SPEED_INDEX];
    const moved = tickFlyImpl(pressed, dt, camera, controls, speed, flyLook.yaw);
    if (moved) {
      flyLookApply();                                // 平移后重钉 target = cam + dir×dist
      clampCameraTarget();
      constrainFreeCameraAltitude();
      if (!flyWasMoving) { flyDbg('fly', `keys=${[...pressed].join('+')} speed=${speed}`); flyWasMoving = true; }
    } else {
      flyWasMoving = false;
    }
    return moved;
  }

  // 键盘（空格 / ←→）由页面经 usePlaybackTransport 统一处理（与 2D 同一套键位与输入框防误触），
  // 场景内核不再自挂全局 keydown：原实现不区分输入框，会吞掉文本框里的空格。

  // ---------- 数据加载 ----------
  // 注：hull_yaw/turret_yaw 由后端相位解卷绕（连续域）后落盘，朴素线性插值即物理正确，
  // 前端不再二次去缠绕（旧版前端 unwrapAngleArray 已由后端数据契约取代）。

  // 递归收集 Object3D 子树的 geometry / material / texture 并各自 dispose 一次
  //（Set 去重：clone 共享的模板资源多路径命中只 dispose 一遍；three dispose 幂等，
  // 此处集合化只为省去重复遍历开销）
  function disposeObject3D(root, shared = null) {
    const geos = new Set(), mats = new Set(), texs = new Set();
    void shared;   // 去重由调用方的 disposed 集合按 root 级完成（资源级去重见 materialDispose）
    root.traverse((o) => {
      // InstancedMesh 的 instanceMatrix 是实例专属的 InstancedBufferAttribute，
      // 不随 geometry.dispose 释放，必须走 InstancedMesh.dispose 自己清理
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) geos.add(o.geometry);
      const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of ms) {
        mats.add(m);
        collectMaterialTextures(m, texs);   // 直接属性 + uniforms（ShaderMaterial 纹理在 uniforms.value）
      }
    });
    for (const t of texs) t.dispose();
    for (const m of mats) m.dispose();
    for (const g of geos) g.dispose();
  }

  // 动态层（弹道/弹着点/轨迹线）清除：与 seekTo 共用一条路径
  function clearEffects() {
    // 条带归还 battleFx 的池（对象留待复用），会话结束时由 battleFx.dispose 统一释放
    for (const tr of tracers) battleFx.giveRibbon(tr.mesh);
    tracers.length = 0;
    for (const tl of trajLines) battleFx.giveRibbon(tl.mesh);
    trajLines.length = 0;
    pendingMuzzles.length = 0;
    clearTransients();   // 战斗反馈（飘字/爆散/幽灵段/受击闪）：seek 后不补播
  }

  // ---- 逐图光照（客户端 DirectionalLightComponent → map/<key>/lighting.json）----
  // 客户端静态场景是**烘焙光照图**（无实时定向光），实时定向光只服务动态物体；
  // 本渲染器尚无烘焙光照图（上游 docs/map-lighting-plan.md 期 2b），故用"该图真实太阳
  // 方向 + 色/强度"的定向光近似直接光，环境项用半球光承载 `sun.ambient`（客户端 ambColor）。
  // 方向语义：客户端给的是**传播**方向（源→地面，场景系）；three 的方向光从 position
  // 射向 target，故 position = −direction。强度按客户端公式直用：客户端
  // `diffuse = lightColor*intensity*NdotL/π`，three 物理光单位（r165+）同式。
  // 应用体见共享模块 mapLighting.js（SSOT，与俯视烘焙同一份——见该模块头部 2026-10-14 说明）：
  // 本页只保留本地签名与 envMultiplier 闭包回写（IBL 晚到的加载路径继续读该值）。
  function applyMapLighting(L) {
    if (!sunLight || !hemiLight) return;
    envMultiplier = applyMapLightingCore({ renderer, scene, sunLight, hemiLight, lighting: L, debug: DEBUG }).envMultiplier;
  }
  // 复位体见共享模块（含共享太阳 uniform 与曝光复位）；envMultiplier 闭包回写。
  function resetMapLighting() {
    resetMapLightingCore({ renderer, scene, sunLight, hemiLight, debug: DEBUG });
    envMultiplier = 1;
  }
  function teardownSession() {
    sessionGen++;
    resetMapLighting();   // 逐图光照随会话复位（否则换图时上一张的太阳会残留）
    animLayerMats = [];   // 动画混合层材质随会话失效（材质已随 mapScenery dispose）
    clearEffects();
    battleFx?.dispose();   // 战斗特效（粒子批次 / 条带 / 图集）随会话一次性释放
    battleFx = null;
    if (DEBUG) delete window.__battleFx;
    // 可破坏物拾取/动画状态随会话释放：meshOwner 持 mesh 引用、destructPickList
    // 持实例引用、destruct.states 持 pivot/网格组——不置空则 reset 后仍被持有
    destruct = null;
    destructPickList = null;
    meshOwner = null;
    // 拾取调试残留（标记网格 + 面板 DOM）与边界带随会话回收（实现在 playback/ 工厂）
    pickReporter.dispose({ scene, disposeObject3D });
    boundaryBand.clear();
    currentMapKey = null;
    clearBases();   // 基地贴地标记（圆环 + 圆盘贴图）随会话释放
    currentMapBases = null;
    for (const v of V) {
      for (const head of v.detachedTurrets) {
        scene.remove(head.root);
        disposeTankDestroyedVisual(head.proxyVisual);
        disposeTankDestroyedVisual(head.glbVisual);
      }
      if (v.glb) scene.remove(v.glb);          // only material clones are instance-owned
      disposeTankDestroyedVisual(v.glbVisual);
      v.glbVisual = null;
      // 悬挂求解为逐车 clone 的履带几何（唯一持有者）：显式释放
      if (v.suspParts && v.suspParts.disposables) {
        for (const g of v.suspParts.disposables) g.dispose();
      }
      v.suspParts = null;
      // 履带印：几何/材质逐车持有，贴图会话共享（treadTexCache 统一释放）
      if (v.treadMesh) {
        scene.remove(v.treadMesh);
        v.treadMesh.geometry.dispose();
        v.treadMesh.material.dispose();
        v.treadMesh = null;
      }
      v.tread = null;
      v.trail = null;
      if (v.group) { scene.remove(v.group); disposeObject3D(v.group); }
    }
    V = [];
    lifeTracks = null;
    lifeTracksByAccount.clear();
    treadParamCache.clear();
    for (const tex of treadTexCache.values()) tex.dispose();
    treadTexCache.clear();
    labelOverlay?.clear();
    labelsTime = null; labelsWrittenMs = -Infinity;
    reloadStateAt = () => null;
    consumableStateAt = () => [];
    tankDataByTankId = new Map();
    for (const o of [mapPlane, terrainMesh, mapScenery, groundMesh, gridHelper]) {
      if (o) { scene.remove(o); disposeObject3D(o); }
    }
    mapPlane = null; terrainMesh = null; mapScenery = null; groundMesh = null; gridHelper = null;
    clearSceneryMatCache();   // 材质已随 mapScenery dispose，缓存须清空（勿复用已 dispose 实例）
    if (mapTexture) { mapTexture.dispose(); mapTexture = null; }
    // 逐图 IBL：先摘 scene.environment 再 dispose（three 的 PMREM 缓存随纹理释放）；
    // scene 可能尚未创建（teardown 可先于 initScene），故判空
    if (scene) {
      scene.environment = null;
      scene.environmentIntensity = 1;
    }
    if (envTexture) { envTexture.dispose(); envTexture = null; }
    if (groundLayers) { for (const k in groundLayers.texs) groundLayers.texs[k]?.dispose?.(); }
    groundLayers = null;
    heightField = null; heightMeta = null; mapMetaInfo = null;
    // GLB 模板缓存（session-scoped）：unique shared resources dispose 一次并清缓存。
    // 未决 Promise 逐个挂 then(dispose)——迟到模板到达即销毁（未渲染未上传 GPU，
    // 不泄漏）；teardown 之后才创建的迟到 Promise 不在册，随旧缓存对象 GC
    for (const p of glbCache.values()) {
      p.then((entry) => { if (entry && entry.template) disposeObject3D(entry.template); })
        .catch(() => {});
    }
    glbCache = new Map();
    DATA = null;
    VIS_BY_EID = new Map();
    POSE_GRID.tStart = 0;
    POSE_GRID.samples = 0;
    store.playbackSession = null;
    // 会话终止 = 不再有任何可用的回放数据：就绪标记必须一起落下，否则新会话加载期间
    // （或 file=null / 被阻断 / 组件卸载之后）HUD 与播放传输仍会按「已就绪」渲染，
    // 而底层 DATA/车辆/贴图已经 dispose。destroy 与 loadData 的替换路径都经过这里。
    store.hasData = false;
    T = 0; shotPtr = 0; hudFeed.resetKillPtr();
    winnerShown = false;
    FOLLOW_EID = 0; followAnchor = null;
    store.killfeed = [];
    store.banner = null;
    // HUD 派生字段显式归零（与 tick 的确定性重算互为双保险：会话切换不留上一场残值）
    store.pointsFriend = null; store.pointsEnemy = null;
    store.scoreFriend = 0; store.scoreEnemy = 0;
    store.hpFriend = 0; store.hpFriendMax = 0; store.hpEnemy = 0; store.hpEnemyMax = 0;
    store.hpFriendPct = 100; store.hpEnemyPct = 100;
    store.friendlyTeam = null;
    store.roster.team1 = [];
    store.roster.team2 = [];
    store.roster.unknown = [];
    hudFeed.resetRoster();   // eid → 名册行 索引清空（实现在 playback/hudFeed.js）
  }

  async function loadData(source) {
    // source 仅接受 { kind:'local', file }（client-only 拓扑，replaySource 对
    // 其他形态显式拒绝）；字符串路径等 server 形态在本拓扑中不存在
    //
    // 三个计数各司其职（混用会漏掉真实竞态）：
    // - `sessionGen`（加载代数）：只有新的 loadData / destroy 递增，判定「谁是最新一次加载」；
    // - `loadGen`（实例内加载令牌）：同上但按实例隔离，配合 destroyed 判定归属；
    // - `sessionEpoch`（会话身份）：每次新的 loadData 与 destroy 时递增，判定
    //   「startPlayback 的资产续体是否还属于当前会话」。
    //   与 sessionGen 分开的原因：sessionGen 表达「加载顺序」，而身份判定需要的是
    //   「谁拥有当前会话」。teardown 只销毁旧会话资源、不改身份，否则本次加载自己的
    //   资产续体会连同旧会话一起被判过期（正常加载被误伤）。
    const gen = ++sessionGen;
    // 会话身份：每次加载唯一。teardown 只销毁旧会话资源、不改身份——否则本次加载的
    // 资产续体会连同旧会话一起被判过期（这正是「正常加载也被误伤」的成因）。
    const epoch = ++sessionEpoch;
    const loadGen = ++loadGeneration;
    // 归属判定必须同时覆盖两件事：**本实例还活着**（destroyed）且**本代仍是最新一次加载**。
    // 只看 loadGen 不够：`loadGeneration` 是实例内闭包，A 实例被 destroy 后自己的计数器不变，
    // 它会继续把自己评为「最新代」，于是被销毁实例的迟到续体仍能写共享 store（B 用同一个 store）。
    const ownsLoading = () => !destroyed && loadGen === loadGeneration;
    // 新会话被接受的那一刻，当前场景就不再是「已就绪」：否则解析/资产阶段（可能数秒）
    // 里 HUD、播放传输与 time/roster 仍然代表上一场回放（ready 泄漏 + 旧 UI 可交互）。
    // 与下面的 hasData=true 一起构成不变量：hasData ⟺ 当前会话已完成加载且 DATA 可用。
    store.hasData = false;
    // 上一场的 canonical 时钟不属于这一场：新会话就绪后由面板重新交给引擎（setBattleClock）
    canonicalClock = null;
    store.err = '';
    store.loading = true;
    store.assetStage = false;
    store.assetProgress = null;
    try {
      // 数据获取在 teardown 之前：新回放解析失败时当前回放保持完好（替换语义 =
      // 新数据就位才拆旧会话）
      const data = source?.session ? await source.session.loadScene(source.file) : await loadPlaybackData(source);
      const playbackSession = source?.session ? source.session.getState(source.file) : null;
      if (gen !== sessionGen) return;   // 迟到：新数据随旧代数 GC（loading 由新所有者管理）
      teardownSession();   // 拆旧会话资源；会话身份已在入口领取，本调用仍是当前会话
      DATA = data;
      VIS_BY_EID = visibilitySpansByEid(data.visibility);
      POSE_GRID.tStart = data.meta.t_start;
      POSE_GRID.samples = data.meta.samples;
      store.playbackSession = playbackSession;
      // 资产阶段（地图/地形/地表/场景）内部有多个 await：被取代后必须立刻放弃，
      // 否则旧会话会走完 buildVehicles / buildRoster / setPlaying / tick / writeHud 复活自己。
      const ready = await startPlayback(epoch);
      if (!ready || !ownsLoading()) return;
      store.hasData = true;
    } catch (e) {
      // 只写原因；标题与重试由宿主页（Scene3DStatus）按当前语言呈现。
      // 只有最新一次加载可以写：旧加载的失败不得覆盖新加载的状态。
      if (ownsLoading()) store.err = String(e?.message || e || 'unknown');
    } finally {
      // 只有最新一次加载可以落下 loading；被取代的加载不得提前结束新会话的加载态。
      if (ownsLoading()) store.loading = false;
    }
  }
  /**
   * 进入场景：等待运行所需全部资产（地图/地形/地表/场景 GLB 按画质档）后落成会话。
   *
   * 本函数内部有多个 await；`epoch` 是本会话的身份令牌，**每个 await 之后与最终就绪态之前
   * 都必须复核**。否则被取代的会话会在资产加载返回后继续走完
   * buildVehicles / buildRoster / setPlaying / tick / writeHud，把旧会话复活到新会话身上。
   *
   * @param {number} epoch loadData 提交数据后领取的会话身份（见 loadData 注释）
   * @returns {boolean} true = 本会话仍是当前会话，可以落成就绪态；false = 已过期，调用方必须放弃
   */
  /** 重建渲染器上下文（偏好失配时）：卸旧 renderer/controls/画布与事件，
   *  initScene 重建——会话数据（DATA/资产/相机状态）不动，仅重挂画布。 */
  function rebuildRenderer() {
    // 旧尺寸监听器必须先断（评审 P2）：initScene 每次新建 ResizeObserver 覆盖
    // sizeObserver——不断开旧实例会在同容器上累积回调（每次重建一个），
    // destroy 也只回收最后一个；旧回调还会对已 dispose 的 renderer 调 setSize。
    if (sizeObserver) { try { sizeObserver.disconnect(); } catch (_) {} sizeObserver = null; }
    removeEventListener('resize', onResize);
    if (controls) { try { controls.dispose(); } catch (_) {} controls = null; }
    if (renderer) {
      try { renderer.domElement.removeEventListener('pointerdown', onScenePointerDown); } catch (_) {}
      try { renderer.domElement.removeEventListener('pointerup', onScenePointerUp); } catch (_) {}
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (_) {}
      renderer.domElement.remove();
      renderer = null;
    }
    dynResCtl = null;
    initScene();
  }

  async function startPlayback(epoch) {
    const current = () => epoch === sessionEpoch && !destroyed;
    // 入口即复核：数据阶段可能耗时到被取代，此时连渲染器都不该为它创建;
    if (!current()) return false;
    if (!renderer) initScene();   // 渲染器惰性创建：此时画质档已定型（loader 选择/URL 参数）
    else if (rendererCaps && (rendererCaps.logdepth !== LOGDEPTH || rendererCaps.dynres !== DYNRES)) {
      // 复用渲染器（换文件 reset 保留）但待开播偏好已改：按失配项热修正——
      // logdepth 是上下文级参数 → 重建渲染器（initScene 换新上下文，dynres 同步重装）；
      // 仅 dynres 变化 → 热装/卸控制器即可（无需动上下文）。
      if (rendererCaps.logdepth !== LOGDEPTH) {
        rebuildRenderer();
        rendererCaps = { logdepth: LOGDEPTH, dynres: DYNRES };
      } else {
        // 仅 dynres 变化（评审 P2）：控制器可能已把 pixelRatio 降过档，热装/卸时
        // 必须先同步 renderer 回当前档位上限 + 重设画布——否则 B 场永久停在
        // A 场的低清晰度（或新控制器内部上限与实际画布不一致）。
        rendererCaps.dynres = DYNRES;
        const cap = Math.min(devicePixelRatio, Q.maxDpr);
        renderer.setPixelRatio(cap);
        renderer.setSize(container.clientWidth, container.clientHeight, false);
        renderer.domElement.style.width = container.clientWidth + 'px';
        renderer.domElement.style.height = container.clientHeight + 'px';
        dynResCtl = (DYNRES && cap > 1) ? createDynRes({ ceilDpr: cap }) : null;
      }
    }
    store.mapName = DATA.meta.map_name || ('map_' + DATA.meta.map_id);
    // 提前解析资产面 mapKey：buildWorld 要用 playableBoundsFor（依赖 currentMapKey）；
    // loadMapImage 里的 resolveMapKey 幂等（索引有缓存），不会重复请求。
    {
      const mid0 = DATA.meta.map_id || 0;
      const mq0 = mid0 ? ('id=' + mid0) : ('name=' + encodeURIComponent(DATA.meta.map_name || ''));
      // 场景自己的 currentMapKey（playableBoundsFor 读这个）必须在此赋值——只调不接曾让
      // buildWorld 拿不到可玩矩形、中心回退到车辆云心。
      const resolvedKey = await resolveMapKey(mq0).catch(() => null);
      if (!current()) return false;   // 资产解析期间被取代：不得继续动场景
      currentMapKey = resolvedKey;
    }
    buildWorld();
    // 进入场景前等待运行所需全部资产（评审要求：地图/地形/分层地表/场景 GLB 按
    // 画质档全部就绪后才进场，不再先进场后异步补图）。各段内部已 try/catch——
    // 资产缺失按档位语义降级（回退网格/2D/烘焙底图），等待不因单项缺失而悬挂。
    store.assetStage = true;
    store.assetProgress = null;
    try {
      await loadMapImage();
    } catch (e) {
      console.warn('地图资产加载失败（回退网格）:', e);
    } finally {
      if (current()) store.assetStage = false;
    }
    if (!current()) return false;   // 地图资产期间被取代：后面全是 DATA 派生的会话状态
    buildVehicles();
    if (glbOn) {
      const attach = applyGlbToggle(true);   // 会话切换后按用户偏好恢复 GLB 车模
      if (Q.forceGlb) {
        // 高/极致（2026-10-11 用户裁示）：进地图前**全部**车辆模型就绪——此前 GLB 在
        // 开始播放后才并发下载，开局数秒是盒子代理，且履带印轨距（suspension 模型
        // halfW）随挂载跳变，起步印记出现侧向折线
        store.assetStage = true;
        try { await attach; } finally { if (current()) store.assetStage = false; }
        if (!current()) return false;
      }
    }
    buildRoster();
    // 会话级 mounted-configs 缓存（tank_id → tank/{id}.json）：先建 Map 再建 resolver——
    // resolver 闭包持有同一引用，异步填充后自动生效
    tankDataByTankId = new Map();
    reloadStateAt = createReloadStateResolver({ ...DATA, friendlyTeam: DATA.meta.friendly_team, mountedConfigs: tankDataByTankId });
    consumableStateAt = createConsumableStateResolver(DATA);
    // 弹容 N：resolver 按「实际搭载配置」取默认（comp locals → 发射弹种 → 初始血量 三级
    // 证据链联表资产面 tank/{id}.json；见 reloadBar.resolveMountedConfig）。多炮坦克各炮
    // 弹容不同，禁止跨配置取最大 / 剩余弹数+1 推断（上游 §六 裁决）。configs 就绪后写入
    // 共享 Map 即生效，这里只需触发一次重绘。
    {
      const mySession = sessionGen;
      const tankIds = new Set(DATA.vehicles
        .filter((v) => v.team === DATA.meta.friendly_team && v.tank_id > 0)
        .map((v) => v.tank_id));
      for (const tid of tankIds) {
        assetProvider.json(`/tank/${tid}.json`).then((t) => {
          if (mySession !== sessionGen || !t || tankDataByTankId.get(tid)) return;
          tankDataByTankId.set(tid, t);
          labelsTime = null;
          invalidate();
        }).catch(() => {});
      }
    }
    buildTransientSources();   // 战斗反馈事件源（伤害/击毁）
    buildBases();   // 基地贴地标记（争霸 A–D / 单基地）
    // 会话从开战时刻开始：准备 / 倒计时阶段不在时间轴上（与 2D 一致）
    sceneClock = resolveReplayClock(DATA.periods || [], null, DATA.meta.duration);
    [START, END] = battleRange();
    T = START;
    burstPtr = firstIndexAfter(burstEvents, T);
    shotPtr = 0; hudFeed.resetKillPtr();
    if (DEBUG) window.__pbV = V;   // 调试钩子：控制台可查每车 GLB/位姿状态（仅 ?debug）
    prewarmShaders();
    // 会话常量一次写清（此前每 tick 重写，值不变不会触发响应式，但语义上属会话级）
    store.startTime = START;
    store.duration = END;
    // 最后一处会「启动播放」的写：过期会话绝不允许走到这里（否则旧会话会自己开始 tick）
    if (!current()) return false;
    setPlaying(true);
    tick();
    writeHud(true);   // 会话开始：立即对齐 HUD（不等降频窗口）
    invalidate();
    return true;
  }

  // 初始化：事件绑定 + 动画循环（渲染器惰性创建，画质选择先于首帧定型）
  animate();
  applyGlbGate();

  return {
    loadData,
    /**
     * 撤下当前回放（工作台清空选择 / 多文件未选场次 / 玩家换选）：回到「无数据」等待态。
     * 渲染器、画质档与相机保持——重新选回放时不必重建 WebGL 上下文、也不必重选画质；
     * 新数据就位的加载仍走 `loadData` 自己的 loading / asset 阶段（先解析、资产就绪后才
     * `hasData`），所以这里只负责把上一场彻底清干净，不留下任何「还在呈现旧回放」的残留。
     *
     * 撤下发生在**加载途中**时（换选 / 清空都可能落在解析或资产阶段里），在途续体必须整体
     * 作废：解析阶段的迟到数据已由 `teardownSession` 递增的 `sessionGen` 挡下（不会落成
     * `DATA`），这里再补上另两道闸——`sessionEpoch` 让 `startPlayback` 的资产续体在触到场景
     * 之前返回；`loadGeneration` 让被撤下的加载不得再写 store（否则 `teardownSession` 清空
     * `DATA` 后旧续体会在 `DATA.vehicles` 上抛错，把内部异常当「加载失败」写给用户）。
     */
    reset() {
      loadGeneration++;
      sessionEpoch++;
      teardownSession();               // 车辆/地图/地形/特效/GLB 模板全量释放 + roster/HP/点数归零
      setPlaying(false);
      store.hasData = false;
      store.loading = false;
      store.assetStage = false;
      store.assetProgress = null;
      store.assetIssues = [];
      store.assetDegraded = false;
      store.err = '';
      store.scoreFriend = 0;
      store.scoreEnemy = 0;
      store.mapName = '';
      store.mapKey = null;
      store.startTime = 0;
      store.duration = 0;
      store.time = 0;
      store.seekFrac = 0;
      invalidate();
    },
    togglePlay: () => setPlaying(!PLAYING),
    setPlaying,
    setSpeed,
    setFlySpeed,
    flyTick,
    invalidate,
    seekFraction: (frac) => { if (DATA) seekTo(START + frac * (END - START)); },
    // 共用播放控件（PlaybackTransport）按绝对秒 seek / 跳秒；seekTo 自带 [START, END] 夹取（准备 / 倒计时阶段回不去）
    seekTime: (t) => { if (DATA) seekTo(t); },
    seekBy: (delta) => { if (DATA) seekTo(T + delta); },
    setBattleClock,
    setCam,
    setFollow,
    setGlb: (on) => { if (!Q.forceGlb && (Q.allowGlb || !on)) applyGlbToggle(on); invalidate(); },
    // 地面履带印开关（会话级，不持久化；关→开从 START 全量补铺，见 updateTrails）
    setTreadMarks: (on) => {
      store.treadOn = !!on;
      // 立即同步（review P2 2026-10-11）：writeTrailQuads/可见性只由 tick 驱动，而暂停时
      // animate 不 tick——只改 store 的话，暂停态 setTreadMarks(false) 后 mesh.visible 仍是
      // true（实测），必须继续播放或 seek 才更新。这里直接跑一次游标泵（幂等：同 T 重入
      // 不产生新段，全量重建也由 builtT=-∞ 路径确定性收敛）。
      updateTrails();
      invalidate();
    },
    /**
     * 共享标签偏好（唯一 owner = usePlaybackPreferences）。契约：
     * - `enabled:false` → 整层名牌隐藏。伤害数字是战斗反馈而不是名牌内容：覆盖层收到
     *   的 anchor 仍带 `projected`，关名牌时数字回退到锚点上方继续显示；
     * - `showPlayerName / showTankName / showHp / showReload` → 名牌内部的行开关。
     * - `classIcons` → 使用 HTML 类型图标替换模型，保留事实 root 与拾取。
     * - `showStatus` → 作者标记环 / 伤害数字（数字的显示开关在覆盖层，与标记同一偏好）。
     */
    setLabelPrefs: (prefs) => {
      const enabled = !prefs || prefs.enabled !== false;
      store.labelsOn = enabled;
      classIcons = prefs?.classIcons === true;
      showMarkerStatus = prefs?.showStatus !== false;
      // Keep factual visibility and the raycast roots intact. Only artwork is
      // replaced; projected icon buttons continue selecting the same entity.
      for (const v of V) {
        setLowPoly(v, !v.glb);
        applyDetachedTurrets(v);
        if (v.glb) v.glb.visible = v.group.visible && !classIconsVisible();
      }
      setLabelPrefs(prefs || {});
      if (camera) updateLabels();
    },
    // 渲染性能偏好切换：只持久化 + 同步 store（待开播阶段渲染器未创建，下次
    // initScene 按当前偏好装配——不重载、不重建；开关已移至待开播卡片，
    // 播放中不存在该入口）。
    setLogdepth: (on) => {
      LOGDEPTH = !!on;
      persistPref('pb_logdepth', on);
      store.logdepth = !!on;
    },
    setDynres: (on) => {
      DYNRES = !!on;
      persistPref('pb_dynres', on);
      store.dynres = !!on;
    },
    setQuality,
    setPaused,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      destroyed = true;
      flyLookApplyMode('follow');   // 恢复 controls 原生状态（实例随即销毁，防残 handedness）
      loadGeneration++;
      sessionEpoch++;
      store.loading = false;
      store.assetStage = false;
      store.assetProgress = null;
      store.assetIssues = [];
      store.assetDegraded = false;
      // 使本实例所有在途 loadData 的归属判定永久失效：仅有 `destroyed` 也能挡住，
      // 但把加载令牌一并推进让「被销毁的实例」与「被取代的加载」走同一条判定路径
      // （ownsLoading 同时看 destroyed 与 loadGeneration），不依赖单一标志。
      cancelAnimationFrame(rafId);   // 显式取消：不等下一帧的 destroyed 自然退出
      teardownSession();             // 会话资源（车辆/地图/特效/GLB 模板）全量 dispose
      removeEventListener('resize', onResize);
      // container 由宿主复用（场景销毁 ≠ 舞台销毁）：capture 拦截必须摘除，
      // 否则重建场景后同一事件被多份闭包重复消费（拖拽增量翻倍）。
      try { container.removeEventListener('pointerdown', onFlyCaptureDown, true); } catch (_) {}
      try { container.removeEventListener('pointermove', onFlyCaptureMove, true); } catch (_) {}
      try { container.removeEventListener('pointerup', onFlyCaptureUp, true); } catch (_) {}
      try { container.removeEventListener('pointercancel', onFlyCaptureCancel, true); } catch (_) {}
      try { container.removeEventListener('wheel', onFlyCaptureWheel, true); } catch (_) {}
      sizeObserver?.disconnect();
      sizeObserver = null;
      if (DEBUG) {
        delete window.__scene; delete window.__camera; delete window.__controls; delete window.__setFollow; delete window.__renderer;
        delete window.__pbV; delete window.__gdbg; delete window.__battleFx;
        delete window.__destructStage; delete window.__destructDebug;
        delete window.__waterCoast;
      }
      // ?perf 看门狗随实例销毁停表并摘除调试句柄：实例没了帧循环自然停，但心跳
      // setInterval 不清会永久空转，window.__pbPerf 会指向已销毁实例的旧数据。
      if (PERF) {
        if (perfBeatTimer) { clearInterval(perfBeatTimer); perfBeatTimer = 0; }
        delete window.__pbPerf;
      }
      if (renderer) {
        try { renderer.domElement.removeEventListener('pointerdown', onScenePointerDown); } catch (_) {}
        try { renderer.domElement.removeEventListener('pointerup', onScenePointerUp); } catch (_) {}
      }
      if (controls) { try { controls.dispose(); } catch (_) {} }
      if (renderer) {
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (_) {}
        renderer.domElement.remove();
      }
    },
  };
}
