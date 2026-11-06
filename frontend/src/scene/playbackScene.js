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

import { loadPlaybackData, loadRecorderCameraFromFile, mapStaticUrl, resolveMapKey } from './replaySource.js'
import {
  ANCHOR_HEIGHT_M,
  ARCADE_BOOM_M,
  BASE_FOV_DEG,
  CAMERA_MODE,
  FOLIAGE_CLIP_ARCADE_M,
  FOLIAGE_CLIP_SCOPED_M,
  recorderModeAt,
  REVERSE_SAMPLE_OFFSET_SEC,
  aimDirectionScene,
  arcadeCameraPosition,
  backwardZoomScale,
  blendProgress,
  fovFromZoomRaw,
  isReversing,
  reticleRadiusPx,
  sampleRecorderCamera,
} from './playback/cameraRig.js'
import { battleEndTime } from './battleEnd.js'
import { orientDiscUv } from './baseDecal.js'
import { ASSAULT_BASE_ID, SUPREMACY_BASE_IDS, baseView, foldAssaultProgress, foldSupremacyTransitions } from '../utils/baseStatus.js'
import { mapBases } from '../data/mapBases.js'
import { firstIndexAfter } from './seekPointer.js'
import { createDynRes } from './dynRes.js'
import { isAndroidRuntime } from '../platform/runtime.js'
import { createPerf } from './playback/perf.ts'
import { createGpuFrameTracker } from './playback/gpuTimer.ts'
import { AGENT_WASM_COMMIT, AGENT_WASM_RELEASE } from '../api/agent-replay-facets.js'
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
import { collectMaterialTextures } from './materialDispose.js'
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
import {
  aimedVehicle, armorEquipmentCoeffs, armorHighlightBlock, authorShellAt, createArmorHighlight, markPickBoundsStale,
  mountedShell, reticleAimDirection,
} from './playback/armorHighlight.js'
import { pointsAt } from './supremacyPoints.js'
import { teamHpTotals } from './teamHpTotals.js'   //（perspectiveScore 随计分桥接出仓 playback/hudFeed.js）
// 战斗反馈时长：与 2D 共用同一组 canonical 常量（SSOT，避免两处各自漂移）
//（FLASH_MS/FLOAT_DMG_MS/GHOST_MS 随战斗反馈 transient 出仓 playback/battleRuntime.ts）
import { playableBounds } from '../data/playableBounds.js'
import { createLoadProgress } from './loadProgress.js'
import { createFrameMeter } from './frameMeter.js'
import { advancePlaybackTime } from '../utils/playbackClock'
import { activeEntityAt, resolveReplayClock } from '../replay-local/canonical/facts'
import { isPlaybackSpeed } from '../composables/usePlaybackTransport.js'
import { isFlySpeedIndex, FLY_SPEEDS, DEFAULT_FLY_SPEED_INDEX, TOUCH_PAN_MIN_HEIGHT, advanceFly as tickFlyImpl, classifyTwoFinger, groundPanOffset } from '../composables/useSceneFlyControls.js'
//（GLB 装载/悬挂求解/履带印 Buffer 写入随车辆与履带运行时出仓 playback/vehicleRuntime.ts、
//  playback/treadRuntime.ts，#820 Step 4；本文件只经 vehicles/tread 句柄调度）
import { assetProvider } from './assetProvider.js'
import { createSceneCore } from './playback/renderer.js'
import { createSessionLifecycle } from './playback/sessionLifecycle.ts'
import { createMapWorld } from './playback/mapWorld.ts'
import { createVehicleRuntime } from './playback/vehicleRuntime.ts'
import { createTreadRuntime } from './playback/treadRuntime.ts'
//（战斗表现/3D 标注场景层/标签 HUD 随 #820 Step 5 出仓 playback/battleRuntime.ts、
//  playback/annotationScene.ts、playback/labelsRuntime.ts；本文件只经句柄调度）
import { createBattleRuntime } from './playback/battleRuntime.ts'
import { createAnnotationScene } from './playback/annotationScene.ts'
import { createLabelsRuntime } from './playback/labelsRuntime.ts'
// 内核拆分（2026-10-24）：常量/纯函数/画质表
// 出仓到 ./playback/，点击拾取调试与边界带出仓为工厂；公开 API 经本文件 re-export，
// 导入方（Replay3DPane / 测试）零改动。
import { GRID_DT } from './playback/util.js'
import { QUALITY_PRESETS } from './playback/quality.js'
import { tracerSpanSecs, occlusionCells, occlusionFootprintCells } from './playback/pure.js'
import { createPickReporter } from './playback/pickReport.js'
import { chainVisible } from './pickDebug.js'
import { createBoundaryBand, BOUNDARY_THICK } from './playback/boundary.js'
import { createCameraTerrainClamp } from './playback/cameraTerrainClamp.js'
import { createBaseMarkers } from './playback/bases.js'
import { createSpawnMarkers } from './playback/spawns.js'
import { createFlyZoomSmoother, createZoomSmoother, flyWheelFactor, orbitWheelFactor } from './playback/zoomSmoothing.js'

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

export function initPlayback(container, store, labelOverlay = null, { onVehicleSelect, onAnnotationCommit, onAnnotationErase, recorderReticle = null } = {}) {
  // ---------- 全局状态 ----------
  let DATA = null;                 // PlaybackData（当前会话）
  /** eid → 协议精确 AoI 段 flat [t0,t1,...]（来自 DATA.visibility；3D 炮塔/侧倾采样用） */
  let VIS_BY_EID = new Map();
  /** 共享位姿采样器的时间轴（DATA 就位时写入；见 replay-local/pose/vehiclePose.ts）。
   *  唯一 owner 仍在本闭包（canonical 事实域），按引用共享给 vehicleRuntime。 */
  const POSE_GRID = { tStart: 0, samples: 0 };
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
  // 车辆运行时（{def, group, turretG, gunPivot, labelAnchor, meshHull, glb}）与 GLB 模板缓存、
  // 履带印缓存的唯一 owner = playback/vehicleRuntime.ts / playback/treadRuntime.ts
  //（#820 Step 4 出仓；本闭包经 vehicles/tread 句柄读写，语义与拆分前逐字一致）
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
  // 新会话默认以俯视机位开局；用户一旦操作过相机，同一实例内不再覆盖其视角。
  let topViewOnLoad = true;
  // 录像者视角：facet 随会话，相机由 driveRecorderCamera 逐帧写入。
  let recorderCamera = null;
  const recorderSample = {};
  let recorderBoomScale = 1;
  // 开镜时相机在炮位，本车只从渲染里摘掉：group.visible 仍表示「车辆在场」，
  // 炮口定位与击毁特效都依赖它。
  let scopedHiddenEid = 0;
  let cameraBlend = null;              // 进入录像者视角的呈现过渡
  let fovRestore = null;               // 离开录像者视角时 FOV 的呈现过渡
  // 弹道/战斗特效/战斗反馈 transient（tracers/pendingMuzzles/trajLines/battleFx/wreckClock/
  // shotPtr/FX_SCALE）的唯一 owner = playback/battleRuntime.ts（#820 Step 5 出仓；
  // 本闭包经 battle 句柄读写，语义与拆分前逐字一致）
  let renderer = null, scene, camera, controls, clock, raycaster;
  let hemiLight = null, sunLight = null;   // 逐图光照（applyMapLighting 覆盖，见 load 流程）
  // 世界/地形/地图资产状态（mapPlane/heightField/mapScenery/destruct/envTexture…）与
  // 逐图 IBL envTexture/envMultiplier 的唯一 owner = playback/mapWorld.ts（#820 Step 2 出仓）。
  let sizeObserver = null;
  // 名牌偏好（classIcons/showMarkerStatus）与 HTML 标签游标的唯一 owner = playback/labelsRuntime.ts
  //（#820 Step 5 出仓；本闭包经 labels 句柄读写）
  const RETICLE_MIN_GUN_DISTANCE_M = 30;  // 瞄准点贴脸时扩散圆的最小投影距离
  const SCOPED_HIDDEN_LAYER = 1;       // 相机不启用的 layer：开镜时本车留在场景里但不绘制
  const CAMERA_GROUND_CLEARANCE = 0.5;  // 初值：小于地形起伏尺度，真实地图视觉校准由人工验收
  // 高度场只有一份（客户端同构：渲染/查询/放置全用真值场）。让位掩码（v0.4.2 的"渲染场"副本
  // 概念）与"贴地结构脚印"细分判据均已撤销（2026-10-11 用户裁示：只对齐客户端，不自创补偿）。
  // ---------- 3D annotation（selected-surface drawing；无 surfaceY 时 terrain fallback）----------
  // GPU 资源 / rebuild 编排 / 地表拾取 / pointer 手势状态机的唯一 owner =
  // playback/annotationScene.ts（#820 Step 5 出仓；本闭包经 annotationScene 句柄读写，
  // 语义与拆分前逐字一致。committed annotation 的权威 owner 仍是 Replay3DPane）。
  let destroyed = false;
  // 会话代数三计数与 SESSION_MODE 的唯一 owner = playback/sessionLifecycle.ts
  //（#820 Step 1 出仓；本闭包经 session handle 读写，语义与拆分前逐字一致）
  /**
   * 地图预览会话的基地模式（'supremacy' | 'assault' | null）：宿主经 setMapBasesKind
   * 显式选择画哪组贴地基地环。回放会话不消费它（模式由 DATA 轨迹判，语义红线）；
   * teardown 随会话复位为 null。
   */
  let MAP_BASES_KIND = null;
  /**
   * 地图预览会话的出生点列（#835）：宿主经 setMapSpawns 下发语义档案
   * （common/map-semantics → parseMapGridProfile.spawnPoints）解析出的点列；
   * 几何与渲染 fail-closed 在 playback/spawns.ts，本闭包只持数组的引用。
   * 回放会话不消费；teardown 随会话复位为 null。
   */
  let MAP_SPAWN_POINTS = null;
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
  let ARMOR_HIGHLIGHT = prefOf('pb_armor_highlight', 'armorhl', false);
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
      // 移动/Tauri 默认**均衡**（真车模、完整场景和烘焙地表）；4K/Retina 想吃满
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
  store.armorHighlight = ARMOR_HIGHLIGHT;
  function setQuality(k) {
    if (!QUALITY_PRESETS[k] || k === QKEY) return;
    const apply = () => {
      if (perf) perf.interrupt('quality-change');
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
        if (perf) perf.interrupt('quality-change');
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
      if (!vehicles.glbOn()) vehicles.applyGlbToggle(true);
    } else if (!Q.allowGlb) {
      store.glbOn = false;
      if (vehicles.glbOn()) vehicles.applyGlbToggle(false);
    }
  }

  // ---------- 工具 ----------
  //（wrapPi 随车辆运行时出仓 playback/vehicleRuntime.ts——仅 applyPose/glbTurretMatrix 消费）

  function idxOf(t) { return Math.floor((t - DATA.meta.t_start) / GRID_DT); }

  // 位姿求值（poseOf/poseStash/posAt/yawAt/hullPitchAt/turretAbsAt/gunPitchAt/rollAt）
  // 随车辆运行时出仓 playback/vehicleRuntime.ts（#820 Step 4）；宿主经 vehicles 句柄消费。
  // 位姿采样复用对象（每帧多车高频调用，零分配）
  //（_poseOut 一并随迁）

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
    const siblings = vehicles.getVehicles().filter(candidate => candidate.def.account_id === v.def.account_id);
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
  // 触屏对应键鼠：单指 = WASD（贴地平移）；两指一起拖 = 左键拖拽；指距变化 = 滚轮。
  // 事件在 **container capture 阶段**拦截：祖先 capture 先于 canvas 的 target 阶段，
  // OrbitControls（挂 canvas）物理上收不到左键拖拽/滚轮。选中/拾取语义不变
  // （位移 ≤ SLOP 仍算单击，在 capture 处理器内联）。切回跟随/top 或销毁时恢复 controls。
  const flyLook = { active: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0, dist: 30 };
  // 滚轮缩放平滑（#835）：两条滚轮路径（fly 拦截 / top·follow 的 OrbitControls 拦截）
  // 都只把事件比例 push 进预算，zoomTick 每帧向目标收敛——事件当帧立即生效一小步，
  // 约 0.4s 收敛到终点（公式/界限与原即时实现逐值一致，只改节奏不改步长）。
  const zoomSmoother = createZoomSmoother();
  // fly 路径用独立的**可加世界位移**预算（旧 flyDolly 语义）：比例预算对视距不变的
  // fly 不等价（各帧比例份额相加 ≠ 事件时刻的一次性位移，且随帧率漂移）——见
  // zoomSmoothing.createFlyZoomSmoother 注释。orbit 路径（top/follow）仍用比例预算。
  const flyZoomSmoother = createFlyZoomSmoother();
  // 接管态 = 自由模式（派生）。**不按输入设备开关**：`(pointer: fine)` 之类的能力
  // 探测在触屏笔记本 / 平板模式下会报 coarse，把整条接管链关掉（用户实测：WASD 全灭、
  // 拖拽退回 OrbitControls）。
  const flyMode = () => CAM === 'free';
  // 触屏多点手势状态：pointerId → 最新坐标
  const flyPointers = new Map();
  // 单指：armed 前是单击候选，armed 后是贴地平移（x0/y0/z0 手势起点相机 / height 平移平面 / offset0 抓取偏移）
  let flyPan = null;
  // 双指：mode = pending（判定中）| pinch（d0 指距 / dist0 视距）| look（cx/cy 两指中点）
  let flyTwoFinger = null;
  const FLY_LOOK_RAD_PER_PX = 0.0032;   // rad/px（与常见 FPS 灵敏度同量级）
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
    flyPan = null;   // 平移从手势起点重算：相机被模式切换挪动后，旧起点不能再用
    zoomSmoother.reset();   // 滚轮预算一并清空：旧目标在新机位上继续生效会突然一跳
    flyZoomSmoother.reset();
    if (mode === 'free') {
      if (controls) {
        controls.enabled = false;
        controls.enableDamping = false;
        flyLookSyncFromCamera('enter free');   // 进入自由：以当前视野为基准（top 的天顶朝向在此回落）
      }
    } else {
      // 离开自由：手势状态一并清空（触屏指针表 / 平移 / 双指 / 转头态）
      flyPointers.clear();
      flyTwoFinger = null;
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
    topViewOnLoad = false;
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
  // 滚轮缩放的逐帧推进（animate 每帧调用；预算见 zoomSmoothing.js）：
  //   · fly：可加世界位移预算，advance 返回本帧位移直接交给 flyDolly——各帧位移之和
  //     恒等于事件时刻按旧公式算出的总位移，终点与旧即时实现逐值一致且帧率无关；
  //   · top/follow：f = 本帧视距比例，沿 target→camera 缩放视距（OrbitControls dolly
  //     的同一几何）。min/maxDistance 已含地形净空锁定值，随后的
  //     clampOrbitCameraToTerrain 逐帧再校验——被钳掉的部分自然吸收（与即时缩放同一
  //     钳制语义，只改节奏）。
  const _zoomDir = new THREE.Vector3();
  function zoomTick(dt) {
    if (!renderer) return;
    if (flyMode()) {
      if (!flyZoomSmoother.active()) return;
      flyDolly(flyZoomSmoother.advance(dt));
    } else {
      if (!zoomSmoother.active()) return;
      const f = zoomSmoother.advance(dt);
      if (f === 1) return;
      if (controls && controls.enabled) {
        const off = _zoomDir.subVectors(camera.position, controls.target);
        const len = off.length();
        if (len > 1e-6) {
          const next = Math.min(controls.maxDistance, Math.max(controls.minDistance, len * f));
          camera.position.copy(controls.target).addScaledVector(off.divideScalar(len), next);
          camera.lookAt(controls.target);
        }
      }
    }
    invalidate();
  }
  /** 手指当前射线的方向（单指平移用）；rect 不可用时返回 null。 */
  function flyPanRay(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    annotationScene.setRaycasterFromClient(clientX, clientY, rect);
    return raycaster.ray.direction;
  }
  /** 单指越过单击阈值：抓住手指下的地面点。高度只决定平移比例，不用作净空。 */
  function flyPanArm(clientX, clientY) {
    if (!flyPanRay(clientX, clientY)) return;
    const { x: x0, y: y0, z: z0 } = camera.position;
    const refY = annotationScene.raycastAnnotationGround(clientX, clientY, container.getBoundingClientRect())?.point.y
      ?? terrainHeightForCameraClamp(camera.position.x, camera.position.z)
      ?? 0;
    const height = Math.max(y0 - refY, TOUCH_PAN_MIN_HEIGHT);
    const offset0 = groundPanOffset(flyPanRay(clientX, clientY), height);
    Object.assign(flyPan, { armed: true, x0, y0, z0, height, offset0 });
    emptyDownAt = null;
  }
  /** 单指平移一步：每次从手势起点重算，撞边修正不累积，手指回到起点相机就回到起点。 */
  function flyPanStep(clientX, clientY) {
    const dir = flyPanRay(clientX, clientY);
    if (!dir) return;
    const o = groundPanOffset(dir, flyPan.height);
    camera.position.set(flyPan.x0 + flyPan.offset0.x - o.x, flyPan.y0, flyPan.z0 + flyPan.offset0.z - o.z);
    topViewOnLoad = false;
    flyLookApply();
    // target 被钳制时相机同步修正：到地图边缘停下，而不是转头
    const { x: bx, z: bz } = controls.target;
    clampCameraTarget();
    camera.position.x += controls.target.x - bx;
    camera.position.z += controls.target.z - bz;
    constrainFreeCameraAltitude();
    camera.lookAt(controls.target);
    invalidate();
  }
  /** 从当前前两根手指开始一轮双指手势（绘制模式固定捏合，其余先判定）。 */
  function flyTwoFingerStart() {
    const [[a, pa], [b, pb]] = flyPointers;
    flyTwoFinger = { mode: 'pending', a, b, startA: pa, startB: pb };
    if (annotationScene.annotationToolActive()) flyTwoFingerEnter('pinch', pa, pb);
  }
  /** 进入双指通道：以当前时刻为基准，判定瞬间相机不跳。 */
  function flyTwoFingerEnter(mode, pa, pb) {
    flyTwoFinger.mode = mode;
    if (mode === 'pinch') {
      flyTwoFinger.d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      flyTwoFinger.dist0 = flyLook.dist;
      flyTwoFinger.applied = 0;
    } else {
      flyTwoFinger.cx = (pa.x + pb.x) / 2;
      flyTwoFinger.cy = (pa.y + pb.y) / 2;
    }
    flyDbg('two-finger', mode);
  }
  function flyTwoFingerStep() {
    const g = flyTwoFinger;
    const pa = flyPointers.get(g.a), pb = flyPointers.get(g.b);
    if (!pa || !pb) return;
    if (g.mode === 'pending') {
      // pointermove 逐指派发，单个事件时另一指可能还是旧位置：一帧判定一次，
      // 这一帧里两指的最新位置都到齐后再分类，结果不依赖派发顺序。
      if (!g.sampling) {
        g.sampling = true;
        requestAnimationFrame(() => flyTwoFingerSample(g));
      }
      return;
    }
    if (g.mode === 'pinch') {
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      // 双指捏合 = 沿视线推拉相机：以**手势基准**算**累计目标**，再应用目标与已应用量之差。
      // 累计位移 = clamp((d−d0)/d0, ±0.5)·dist0：
      //  · 回到 d0 ⇒ 目标 0 ⇒ 精确回位（不随事件分批漂移）；
      //  · 单次触限只截断**累计目标**，不会丢掉后续回程位移（评审 P2：分别截断
      //    每次增量 + 无条件推进基准，会让 200→350→275→200 净退 0.25×视距）。
      const target = Math.max(-0.5, Math.min(0.5, (d - g.d0) / g.d0)) * g.dist0;
      const delta = target - g.applied;
      g.applied = target;
      flyDolly(delta);
      return;
    }
    const cx = (pa.x + pb.x) / 2, cy = (pa.y + pb.y) / 2;
    flyLookBy(cx - g.cx, cy - g.cy);
    g.cx = cx; g.cy = cy;
    topViewOnLoad = false;
    flyLookApply();
    invalidate();
  }
  function flyTwoFingerSample(g) {
    g.sampling = false;
    if (flyTwoFinger !== g || g.mode !== 'pending') return;   // 这一帧里手势已结束或换了手指
    const pa = flyPointers.get(g.a), pb = flyPointers.get(g.b);
    if (!pa || !pb) return;
    const mode = classifyTwoFinger(g.startA, g.startB, pa, pb);
    if (mode) flyTwoFingerEnter(mode, pa, pb);
  }
  function flyLookBy(dx, dy) {
    flyLook.yaw -= dx * FLY_LOOK_RAD_PER_PX;
    flyLook.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, flyLook.pitch - dy * FLY_LOOK_RAD_PER_PX));
  }
  /** 手指数量变化：还有两指就重新判定，否则结束双指手势（剩下的手指不生效）。 */
  function flyTouchCountChanged() {
    if (flyPointers.size >= 2) flyTwoFingerStart();
    else flyTwoFinger = null;
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
        flyLook.active = false;
        emptyDownAt = null;
        if (flyPointers.size >= 2) {
          // 第二指加入：平移立即停止，本次手势也算不上单击
          flyPan = null;
          flyTwoFingerStart();
        } else if (annotationScene.annotationToolActive()) {
          // drawing mode：单指 owner 是 annotation；free camera 也不得移动。
          flyPan = null;
        } else {
          flyPan = { armed: false, startX: e.clientX, startY: e.clientY };
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
    // 录像者视角不接受相机输入：OrbitControls 保持关闭，选中语义仍由 renderer 接线。
    if (CAM === 'recorder') return;
    // 非 free：恢复 OrbitControls 并走原选中语义（onScenePointerDown 由 renderer 接线）
    if (!controls.enabled) controls.enabled = true;
  }
  function onFlyCaptureMove(e) {
    if (!flyMode()) return;
    if (e.pointerType === 'touch') {
      if (!flyPointers.has(e.pointerId)) return;
      flyPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (flyTwoFinger) {
        flyTwoFingerStep();
      } else if (flyPan?.armed) {
        flyPanStep(e.clientX, e.clientY);
      } else if (flyPan && Math.hypot(e.clientX - flyPan.startX, e.clientY - flyPan.startY) > SCENE_CLICK_SLOP_PX) {
        flyPanArm(e.clientX, e.clientY);
      } else {
        return;
      }
      e.stopPropagation();
      return;
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
      flyLookBy(dx, dy);
    }
    topViewOnLoad = false;
    flyLookApply();
    if (logThis) flyDbg('move(applied)');
    invalidate();
    e.stopPropagation();   // flyMode 下 OrbitControls 与场景单击语义都不再需要
  }
  function onFlyCaptureUp(e) {
    if (!flyMode()) return;
    try { container.releasePointerCapture(e.pointerId); } catch (_) {}
    let wasActive = flyLook.active;
    if (e.pointerType === 'touch') {
      flyPointers.delete(e.pointerId);
      flyTouchCountChanged();
      // 双指手势收尾（还剩一指）：不把它当单击，剩下的手指也不生效
      if (flyPointers.size > 0) {
        e.stopPropagation();
        return;
      }
      // 只有没越过阈值的单指才是单击：平移过的手指回到起点也不算
      wasActive = !!flyPan && !flyPan.armed;
      flyPan = null;
    }
    // 单击判定（≤SLOP）与拖拽共存：按下记录起点、抬起位移 ≤SLOP 才算单击
    flyLook.active = false;
    if (!wasActive || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - (emptyDownAt?.x ?? e.clientX), e.clientY - (emptyDownAt?.y ?? e.clientY));
    emptyDownAt = null;
    if (moved <= SCENE_CLICK_SLOP_PX) {
      // 单击：up 位置统一 raycast（命中车辆 → eid；空处 → null）
      const r = container.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(nd, camera);
      const hits = raycaster.intersectObjects(vehicles.getVehicles().map(v => v.group), true);
      let eid = null;
      if (hits.length) {
        let o = hits[0].object;
        while (o && !o.userData.eid) o = o.parent;
        if (o) eid = o.userData.eid;
      }
      flyDbg('click', `eid=${eid}`);
      if (!annotationScene.annotationToolActive()) onVehicleSelect?.(eid, e);
    }
    e.stopPropagation();
  }
  function onFlyCaptureWheel(e) {
    if (CAM === 'recorder') { e.preventDefault(); e.stopPropagation(); return; }
    if (!flyMode()) return;
    // 滚轮 = 沿视线推拉相机（OrbitControls 的 dolly 语义）：相机与 target 一起前进/后退，
    // 视角与视距保持不变。旧实现只改 flyLook.dist 而相机不动——target 只沿视线挪，
    // 画面毫无变化（用户实测「滚轮没有缩放」）。
    flyLookSyncIfStale('wheel');
    // 事件只累积**可加世界位移**（旧即时公式：step = clamp(−deltaY×0.0012, ±0.3)，
    // 位移 = 当前视距 × step——flyDolly 平移 camera+target，视距不变，故为可加量），
    // 实际推拉由 zoomTick 逐帧收敛——平滑只改变时间分布，最终位移与旧即时实现逐值
    // 一致（#835「缩放生硬」）。
    flyZoomSmoother.pushDisplacement(flyLook.dist * (1 - flyWheelFactor(e.deltaY)));
    invalidate();
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `pushed=${(flyLook.dist * (1 - flyWheelFactor(e.deltaY))).toFixed(3)}`);
  }
  /** three 0.185.1 OrbitControls._customWheelEvent 的归一化等价（对照 node_modules
   *  安装源码）：deltaMode 1（行）×16、2（页）×100；`ctrlKey && !_controlActive` =
   *  触控板模拟 pinch（实体 Control 按键按下时 OrbitControls 经 keydown 维护
   *  _controlActive=true），再 ×10。我们的 capture 拦截发生在 OrbitControls 收到事件
   *  之前，必须先复刻该归一化再换算比例，否则行/页单位设备与触控板捏合的实际缩放
   *  幅度都会变小。 */
  function orbitWheelNormalizedDelta(e) {
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 16;
    else if (e.deltaMode === 2) deltaY *= 100;
    if (e.ctrlKey && controls?._controlActive !== true) deltaY *= 10;
    return deltaY;
  }
  /** top/follow（OrbitControls 路径）的滚轮拦截：只累积缩放预算，几何推进归 zoomTick。
   *  事件幅度与 OrbitControls 直收滚轮逐值一致（先过 _customWheelEvent 等价归一化，
   *  再走 orbitWheelFactor 公式），拦截只是把「当帧一步到位」换成短窗收敛；单事件不改
   *  min/max/地形钳制语义。 */
  function onOrbitZoomWheel(e) {
    if (flyMode()) return;   // fly/recorder 已由 onFlyCaptureWheel（先注册）处理或拦截
    if (!controls || !controls.enabled || controls.enableZoom === false) return;   // 输入关闭态不劫持
    const deltaY = orbitWheelNormalizedDelta(e);
    zoomSmoother.push(orbitWheelFactor(deltaY, controls.zoomSpeed));
    invalidate();
    e.preventDefault();
    e.stopPropagation();
    flyDbg('wheel', `orbit pushed=${orbitWheelFactor(deltaY, controls.zoomSpeed).toFixed(3)}`);
  }
  function onFlyCaptureCancel(e) {
    flyLook.active = false;
    emptyDownAt = null;
    flyPan = null;
    if (e) flyPointers.delete(e.pointerId);
    flyTouchCountChanged();
  }

  // ---------- 场景 ----------
  function initScene() {
    // 创建核心（渲染器/相机/控件/灯光/resize+pointer 接线）在 playback/renderer.js
    //（2026-10-24 Step A2 出仓；状态所有权仍在本闭包——解构写回可变绑定）
    const core = createSceneCore({
      container, quality: Q, logdepth: LOGDEPTH, dynres: DYNRES, debug: DEBUG,
      envTexture: mapWorld.envTexture(), envMultiplier: mapWorld.envMultiplier(),
      onResize, onPointerDown: onScenePointerDown, onPointerUp: onScenePointerUp,
      setFollow,
    });
    scene = core.scene; camera = core.camera; renderer = core.renderer;
    controls = core.controls; clock = core.clock; raycaster = core.raycaster;
    gpu?.attach(renderer);
    hemiLight = core.hemiLight; sunLight = core.sunLight;
    dynResCtl = core.dynResCtl; sizeObserver = core.sizeObserver; rendererCaps = core.rendererCaps;
    // annotation 段收口（#820 Step 5）：独立 raycaster 重建 + 5 个 capture 监听 + layer
    // 就绪 + 触摸模式（原逐行实现的等价入口，见 playback/annotationScene.ts）。
    annotationScene.attachListeners();
    // FPS 飞行接管（capture 阶段挂 container——先于 canvas 的 target 阶段，
    // OrbitControls 物理收不到 flyMode 下的事件；down/up 的 renderer 接线仍服务
    // 非 free 模式的选中语义）
    container.addEventListener('pointerdown', onFlyCaptureDown, true);
    container.addEventListener('pointermove', onFlyCaptureMove, true);
    container.addEventListener('pointerup', onFlyCaptureUp, true);
    container.addEventListener('pointercancel', onFlyCaptureCancel, true);
    container.addEventListener('wheel', onFlyCaptureWheel, { capture: true, passive: false });
    // top/follow 的滚轮拦截（#835）：OrbitControls 的 wheel dolly 当帧生效、无过渡。
    // 在 container capture 拦下（先于 canvas 的 target 阶段，OrbitControls 收不到），
    // 比例公式与其 _getZoomScale 逐值同构（orbitWheelFactor）——单事件幅度不变，
    // 只把「一步到位」换成 zoomTick 的短窗收敛。fly/recorder 模式在 onFlyCaptureWheel
    // 内已处理/拦截，此处理器只服务 OrbitControls 路径。
    container.addEventListener('wheel', onOrbitZoomWheel, { capture: true, passive: false });
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
    if (annotationScene.annotationToolActive()) { emptyDownAt = null; return; }
    if (PICK_DEBUG) pickDownAt = { x: e.clientX, y: e.clientY };   // 调试拾取独立记录（车辆命中路径也出报告）
    const r = container.getBoundingClientRect();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, camera);
    const hits = raycaster.intersectObjects(vehicles.getVehicles().map(v => v.group), true);
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
    if (annotationScene.annotationToolActive()) { emptyDownAt = null; return; }
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
    clock: T, vehicles: vehicles.getVehicles(), scenery: mapWorld.mapScenery(), terrainMesh: mapWorld.terrainMesh(), groundMesh: mapWorld.groundMesh(),
    destruct: mapWorld.destruct(), destructPickList: mapWorld.destructPickList(), meshOwner: mapWorld.meshOwner(), heightField: mapWorld.heightField(), heightMeta: mapWorld.heightMeta(),
    camera, raycaster, container, scene, terrainSpan: mapWorld.terrainSpanOf(),
  });
  function reportPick(e) { pickReporter.reportPick(e, pickCtx()); }
  // 报告组装/面板/标记的实现自 2026-10-24 起在 playback/pickReport.js（工厂 + ctx 快照）。

  // ---------- 地图边界带（几何在 playback/boundary.js 工厂；可玩范围解析/重建时机在 mapWorld） ----------
  // 边界带工厂（boundaryGroup 由工厂私有持有；几何与 fail-closed 语义见 playback/boundary.js。
  // getScene 因 scene 在 initScene 才创建；groundY / disposeObject3D 是闭包内函数声明，
  // 创建期引用安全——调用时才求值）
  const boundaryBand = createBoundaryBand({ getScene: () => scene, disposeObject3D, groundY: (x, z) => mapWorld.groundY(x, z) });
  // 世界/地形/地图资产 owner（#820 Step 2 出仓）：buildWorld / loadMapImage / sampleHeight /
  // 地形 LOD / rebuildGround / 可破坏物推进 / 逐图光照接线 + 会话 teardown 的地图资产段。
  const mapWorld = createMapWorld({
    store,
    debug: DEBUG,
    perf: () => perf,
    sessionEpoch: () => session.sessionEpoch(),
    destroyed: () => destroyed,
    getData: () => DATA,
    quality: () => Q,
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
    getControls: () => controls,
    invalidate,
    disposeObject3D,
    constrainFreeCameraAltitude,
    regroundBases,
    regroundSpawns,
    // annotation 派生缓存重建（owner = annotationScene；晚绑定箭头——工厂创建期不触碰）
    rebuildAnnotationProjection: () => annotationScene.rebuildAnnotationProjection(),
    reprojectAnnotationHeights: () => annotationScene.reprojectAnnotationHeights(),
    scopedHiddenEid: () => scopedHiddenEid,
    lightingTargets: () => ({ renderer, scene, sunLight, hemiLight, debug: DEBUG }),
    buildWorldCameraPlacement: (center) => {
      const { cx, cz, ext } = center;
      // 用户操作过的自由视角跨回放保留；跟随目标不跨回放，仍回到默认机位。
      if (topViewOnLoad || CAM !== 'free') {
        camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
        controls.target.set(cx, 0, cz);
      }
      applyCameraClamp();   // 世界范围决定 min/max 距离（初值，实测再调）
    },
  }, boundaryBand);

  // 车辆运行时 owner（#820 Step 4 出仓）：buildVehicles / 位姿采样 / GLB / 悬挂 /
  // applyPose 与车辆 teardown 的唯一归属。canonical 生命事实（sceneLifeAt/visibleAt）
  // 与调色板仍在本闭包，按 deps 注入；POSE_GRID 按引用共享同一可变对象。
  const vehicles = createVehicleRuntime({
    store,
    destroyed: () => destroyed,
    sessionGen: () => session.sessionGen(),
    getScene: () => scene,
    getT: () => T,
    getData: () => DATA,
    quality: () => Q,
    teamColor: (v) => teamColor(v),
    classIconsVisible: () => labels.classIconsVisible(),
    showMarkerStatus: () => labels.showMarkerStatus(),
    invalidate,
    visibleAt: (v, t) => visibleAt(v, t),
    sceneLifeAt: (v, t) => sceneLifeAt(v, t),
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    // 晚绑定解环：vehicles 需要 tread.attachVehicle（buildVehicles 的履带装配段）、
    // tread 需要 vehicles 的位姿采样与车辆清单。buildVehicles 只在运行期调用，届时
    // 两个工厂都已构造完成（箭头闭包按引用读 tread，不按值捕获）。
    treadAttachVehicle: (v) => tread.attachVehicle(v),
    disposeObject3D,
    poseGrid: POSE_GRID,
    visByEid: () => VIS_BY_EID,
  });
  // 地面履带印 owner（#820 Step 4 出仓）：逐车参数/贴图缓存、网格装配、路径喂样与
  // 游标泵的唯一归属；会话 teardown 的履带段（逐车 treadMesh + 共享贴图）在其 dispose。
  const tread = createTreadRuntime({
    store,
    quality: () => Q,
    getScene: () => scene,
    destroyed: () => destroyed,
    invalidate,
    getT: () => T,
    getStart: () => START,
    getData: () => DATA,
    getVehicles: () => vehicles.getVehicles(),
    vehicles,
    visibleAt: (v, t) => visibleAt(v, t),
    heightAt: (x, z) => mapWorld.sampleHeight(x, z),
    heightFieldReady: () => !!mapWorld.heightField(),
  });

  // 战斗表现 owner（#820 Step 5 出仓）：弹道推进/炮口/曳光/弹着/击毁爆炸/战斗特效批次/
  // 残骸烟相位/动态层清除/战斗反馈 transient 的唯一归属。canonical 生命事实
  //（sceneLifeAt/deathTimesOf）与调色板仍在本闭包，按 deps 注入。
  const battle = createBattleRuntime({
    getData: () => DATA,
    getT: () => T,
    getScene: () => scene,
    getCamera: () => camera,
    getViewportHeight: () => container.clientHeight,
    debug: DEBUG,
    getVehicles: () => vehicles.getVehicles(),
    vehicles,
    sceneLifeAt: (v, t) => sceneLifeAt(v, t),
    colorUnknown: COLOR_UNKNOWN,
    tracerFriendly: TRACER_FRIENDLY,
    tracerEnemy: TRACER_ENEMY,
    invalidate,
    deathTimesOf: (v) => deathTimesOf(v),
    qualityFx: () => Q.fx,
    // 标签快照失效（owner = labelsRuntime 的 labelsTime；晚绑定箭头——labels 工厂在其后构造）
    getLabelOverlay: () => labelOverlay,
    invalidateLabels: () => labels.invalidateLabels(),
  });

  // 3D annotation 场景层 owner（#820 Step 5 出仓）：GPU 资源/rebuild 编排/地表拾取/
  // pointer 手势状态机。相机/共享 raycaster/controls 来自渲染器核心；世界事实经 mapWorld
  // 句柄消费。事件监听注册/摘除收口为 attachListeners()/detach()。
  const annotationScene = createAnnotationScene({
    container,
    debug: DEBUG,
    perfEnabled: () => !!PERF,
    invalidate,
    getScene: () => scene,
    getCamera: () => camera,
    getRaycaster: () => raycaster,
    getControls: () => controls,
    mapWorld,
    annotationSurfaceHeightAt: (x, z) => mapWorld.annotationSurfaceHeightAt(x, z),
    onAnnotationCommit,
    onAnnotationErase,
  });

  // 标签运行时 owner（#820 Step 5 出仓）：软遮挡/名牌发布/会话 resolver/击杀 feed 计分名册。
  // writeHud（时钟+相机+名册编排）、teamHpTotals、pointsAt 仍在本闭包。
  const labels = createLabelsRuntime({
    store,
    container,
    getCamera: () => camera,
    getRaycaster: () => raycaster,
    getData: () => DATA,
    getT: () => T,
    getVehicles: () => vehicles.getVehicles(),
    getSessionGen: () => session.sessionGen(),
    getFollowEid: () => FOLLOW_EID,
    deathAt,
    hpAt,
    visibleAt,
    visByEid: () => VIS_BY_EID,
    scopedHiddenEid: () => scopedHiddenEid,
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    heightField: () => mapWorld.heightField(),
    heightMeta: () => mapWorld.heightMeta(),
    mapScenery: () => mapWorld.mapScenery(),
    occlGrid: () => mapWorld.occlGrid(),
    transients: battle.transients,
    fxScale: () => battle.fxScale(),
    getLabelOverlay: () => labelOverlay,
    canonicalVehicles: () => store.playbackSession?.canonical?.dataset?.vehicles || [],
    invalidate,
  });

  // annotation 地表采样 = 世界事实的唯一采样口径（mapWorld owner；消费经 annotationScene deps）。

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
    getData: () => DATA, getMapBases: () => mapWorld.mapBases(),
    store, groundY: (x, z) => mapWorld.groundY(x, z),
  });
  // 回放会话：模式由 DATA 轨迹判（buildBases 原语义）；地图预览会话：宿主经
  // setMapBasesKind 显式选组，几何仍是唯一事实（bases.buildStatic 内部 fail-closed）。
  function buildBases() {
    if (session.sessionMode() === 'map') bases.buildStatic(MAP_BASES_KIND);
    else bases.build();
  }
  function clearBases() { bases.clear(); }
  function regroundBases() { bases.reground(); }
  function updateBases() { bases.update(T); }

  // ---------- 出生点贴地标记（#835；实现在 playback/spawns.ts；快照式工厂） ----------
  //（数据面 / 呈现口径 / fail-closed 判据见该模块头：宿主经 setMapSpawns 下发语义
  //  档案解析出的点列，回放会话不消费；几何 fail-closed 在 spawns.build 内部。）
  const spawnMarkers = createSpawnMarkers({ getScene: () => scene, groundY: (x, z) => mapWorld.groundY(x, z) });
  function buildSpawns() { spawnMarkers.build(session.sessionMode() === 'map' ? MAP_SPAWN_POINTS : null); }
  function clearSpawns() { spawnMarkers.clear(); }
  function regroundSpawns() { spawnMarkers.reground(); }
  /** UI Profile 切换后 token 色板变化（showcase<->classic / auto 随系统）：已有出生点
   *  材质原位重着色——不重建场景、不动相机。仅 map 会话有意义（回放无出生点）。 */
  function refreshSpawnColors() {
    if (session.sessionMode() !== 'map') return;
    spawnMarkers.refreshColors();
    invalidate();
  }
  function buildBoundary(bounds, thick) { boundaryBand.build(bounds, thick); }

  // 相机地形净空与 target 钳制（#820 Wave B6A：实现与语义注释在
  // playback/cameraTerrainClamp.js）。本处只注入场景侧的事实来源。
  const cameraTerrainClamp = createCameraTerrainClamp({
    getCamera: () => camera,
    getControls: () => controls,
    // cameraDriven 是下方的 const：经箭头延迟求值，工厂创建期不触碰。
    cameraDriven: () => cameraDriven(),
    getTerrainMesh: () => mapWorld.terrainMesh(),
    getHeightField: () => mapWorld.heightField(),
    getHeightMeta: () => mapWorld.heightMeta(),
    sampleRenderedTerrainHeight: (x, z) => mapWorld.sampleRenderedTerrainHeight(x, z),
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    clearance: CAMERA_GROUND_CLEARANCE,
    getWorldCenter: () => mapWorld.worldCenter(),
    isFollowing: () => !!FOLLOW_EID,
  });
  function applyCameraClamp() { cameraTerrainClamp.applyCameraClamp(mapWorld.worldCenter().ext); }
  function terrainHeightForCameraClamp(x, z) { return cameraTerrainClamp.terrainHeightForCameraClamp(x, z); }
  function clampOrbitCameraToTerrain() { return cameraTerrainClamp.clampOrbitCameraToTerrain(); }
  function clampCameraTarget() { cameraTerrainClamp.clampCameraTarget(); }

  /** Free Camera 的上限与俯视默认高度同源；地面下限只在有效高度场覆盖内生效。 */
  function constrainFreeCameraAltitude() {
    if (!flyMode() || !camera || !controls) return false;
    const { x, y, z } = camera.position;
    if (!Number.isFinite(y) || !Number.isFinite(controls.target.y)) return false;
    let minY = -Infinity;
    const heightField = mapWorld.heightField(), heightMeta = mapWorld.heightMeta();
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
          const terrainY = mapWorld.terrainMesh()
            ? mapWorld.sampleRenderedTerrainHeight(x, z)
            : mapWorld.sampleHeight(x, z);
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

  // ---------- 车辆运行时（buildVehicles / GLB 装载 / 悬挂 / 履带印 / applyPose）----------
  // 上述车辆域实现自 2026-11-05 起（#820 Step 4）整体出仓：
  //   · 车辆运行时 owner = playback/vehicleRuntime.ts（buildVehicles/poseStash/loadGlb/
  //     applyGlbToggle/collectSuspensionParts/suspensionStep/poseGlb/poseGlbRig/glbGunWorld/
  //     applyDetachedTurrets/applyPose/vehicleByEid + 会话 teardown 的车辆段）；
  //   · 地面履带印 owner = playback/treadRuntime.ts（treadParamsFor/ensureTreadMesh/feedTrail/
  //     updateTrails + 逐车 treadMesh 与贴图缓存 teardown）。
  // 本闭包只经 vehicles / tread 句柄调度，代码与搬移前逐字一致。

  // ---------- 战斗反馈 transient（状态/游标在 playback/transientFeedback3d.ts）----------
  // 壁钟寿命、血量链事件源、幽灵段/受击闪的语义注释随实现迁往该模块；本处只保留
  // 依赖场景的事实：canonical 生命链的 deathTimesOf、车模可见性/位置、battleFx 爆散。
  /** 车辆每次死亡的场景时刻（issue #622 复活模式：同一 eid 可多次死亡），未排序。 */
  function deathTimesOf(v) {
    const canonical = store.playbackSession?.canonical;
    const times = [];
    if (canonical?.dataset?.vehicles && Number.isFinite(canonical.clock?.startRaw)) {
      const seenDeaths = new Set();
      for (const life of canonicalLifeTrack(v, canonical)?.lifeTransitions ?? []) {
        if (life.lifeState !== 'DESTROYED' || !Number.isFinite(life.timeSec)) continue;
        const identityTime = (life.destroyedKnownAtSec ?? life.timeSec) + canonical.clock.startRaw;
        if (!canonicalDeathAppliesTo(v, identityTime, canonical)) continue;
        // 同一次死亡的重复迁移只算一次（既有不变式）；真复活模式的多死 killedAtSec 互异
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
    return times;
  }

  const tmpV = new THREE.Vector3();
  let followAnchor = null;             // 跟随模式：上一帧坦克位置（位移增量基准）
  const tmpDir = new THREE.Vector3();  // 进入跟随：相机方向临时量
  const FOLLOW_SNAP_DIST = 26;         // 进入跟随：相机沿当前方向收拢到此距离（米；坦克约 7m 长）
  const FOLLOW_MIN_HEIGHT = 9;         // 进入跟随：相机至少高于坦克此高度（米，保证俯角不贴地）
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
    const cpuStarted = PERF ? performance.now() : 0;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (DATA && PLAYING) {
      // 推进 + 钳制合并到纯函数里（NaN/负增量不会污染时钟）；终点是比赛结束 END，不是录像流结束
      T = advancePlaybackTime(T, END, dt * 1000, SPEED);
      battle.advanceWreckClock(dt);
      vehicles.frameTiming(dt, false);   // 行程限速用的逐帧 dt + 本帧非跳变（客户端同源：按帧步长限速）
      tick();
      if (T >= END) setPlaying(false);   // 先 tick 后停：停播时的 HUD/名册补写要包含终点帧的事件
    }
    const tickFinished = PERF ? performance.now() : 0;
    // 动画混合层（烟雾/瀑布/浪）：纹理位移按**回放时钟**走——暂停即停、seek 后相位
    // 由回放时刻唯一确定（不随壁钟漂移，截图可复现）。未装载时该数组为空。
    const animLayerMats = mapWorld.animLayerMats();
    if (animLayerMats.length) {
      const secs = T / 1000;
      for (const mm of animLayerMats) mm.uniforms.uTime.value = secs;
    }
    // 相机
    // 跟随模式：相机位置与视点目标按坦克逐帧位移整体平移——用户选好的方位/
    // 距离/俯仰刚性保持，不会被拉回固定机位；旋转/缩放/平移始终自由
    if (DATA && CAM === 'follow' && FOLLOW_EID) {
      const v = vehicles.getVehicles().find((x) => x.def.eid === FOLLOW_EID);
      if (v && v.group.visible) {
        vehicles.posAt(v, T, tmpV);
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
    if (CAM === 'recorder') driveRecorderCamera(dt);
    else clampCameraTarget();
    zoomTick(dt);   // 滚轮缩放预算逐帧收敛（先于 controls.update()：本帧位移当帧可见）
    if (fovRestore) stepFovRestore(dt);
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
    const cameraMoved = cameraDriven() ? false : controls.update();   // three 的 update() 返回相机是否变化（阻尼/交互）
    clampOrbitCameraToTerrain();
    const cameraFinished = PERF ? performance.now() : 0;
    // ---------- 按需渲染（脏帧）----------
    // 暂停且没有在飞特效、相机也静止时，跳过整帧工作（标签/基地/transient 重算 + 全屏
    // render）。此前空闲也满速重绘，是移动端发热与笔记本耗电的第一来源。
    // 伤害数字不参与这个判定：它是覆盖层 DOM + CSS 动画，暂停时自己走完，不需要出帧。
    const busy = PLAYING
      || cameraMoved
      || cameraBlend || fovRestore
      || frameDirty
      || mapWorld.destruct()?.animating
      || battle.isActive();   // 弹道在飞 / 战斗特效 / 战斗反馈 transient（owner = battleRuntime）
    if (!busy) {
      if (perf) perf.idle();
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
    labels.updateLabels();
    updateBases();
    battle.transients.updateNow();
    battle.updateBattleFx();     // 战斗特效（壁钟特效暂停时也继续自然播完）
    const perfT1 = PERF ? performance.now() : 0;
    mapWorld.maybeRebuildTerrainLod();   // 地形 LOD 跟随相机姿态（视距滞回 + 绕转/FOV/aspect；120 ms 节流）
    const terrainFinished = PERF ? performance.now() : 0;
    // 一帧可有多次 render：探针期间手动复位，info 才是整帧累计而不是最后一次 render
    const perfAutoReset = PERF ? renderer.info.autoReset : null;
    try {
      if (PERF) { renderer.info.autoReset = false; renderer.info.reset(); }
      const gpuFrameId = session.isReadySession() ? gpu?.beginFrame() ?? null : null;
      const gpuMainStarted = gpu?.begin('main') ?? false;
      try { renderer.render(scene, camera); } finally { if (gpuMainStarted) gpu.end(); }
      session.tryMarkFirstReadyFrame();
      const perfR0 = PERF ? performance.now() : 0;
      renderArmorHighlight();
      gpu?.submitFrame();
      const perfR1 = PERF ? performance.now() : 0;
      if (PERF && session.isReadySession()) perfFrame(perfT1 - perfT0, perfR0 - terrainFinished, perfR1 - perfR0, armorStats, { cpuFrameMs: perfR1 - cpuStarted, tickMs: tickFinished - cpuStarted, cameraMs: cameraFinished - tickFinished, terrainCheckInclusiveMs: terrainFinished - perfT1, gpuFrameId, gpu_total_ms: null });
      gpu?.recorded(gpuFrameId);
    } finally {
      if (PERF) renderer.info.autoReset = perfAutoReset;
      gpu?.abortFrame();
    }
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
  const perf = PERF ? createPerf() : null;
  // perf 装载段状态（perfLoadingStart/perfLoadingEpoch/perfFirstSubmitted/perfReadySession）
  // 的唯一 owner = playback/sessionLifecycle.ts（#820 Step 1 出仓）。
  const gpu = PERF ? createGpuFrameTracker(perf) : null;
  if (perf) perf.setIdentity({ buildCommit: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : null,
    buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null,
    wasmCommit: AGENT_WASM_COMMIT, wasmRelease: AGENT_WASM_RELEASE, replayDigest: null, runtime: isAndroidRuntime() ? 'android' : 'browser',
    userAgent: navigator.userAgent, viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio, quality: QKEY, assetIdentity: null, identityComplete: false });
  function perfFrame(updateMs, renderMs, armorMs, armorStats, stages) {
    const a = armorStats || {};
    perf.record({ ...stages, updateMs, renderMs, armorMs, t: T,
      calls: renderer ? renderer.info.render.calls : 0, ...(mapWorld.terrainCounters()),
      armorPick: a.pickMs ?? 0, armorState: a.stateMs ?? 0,
      armorThick: a.thicknessMs ?? 0, armorOcc: a.occluderMs ?? 0,
      armorColor: a.colorMs ?? 0, armorCalls: a.calls ?? 0,
      armorStateCalls: a.stateCalls ?? 0, armorThicknessCalls: a.thicknessCalls ?? 0, armorOccluderCalls: a.occluderCalls ?? 0, armorColorCalls: a.colorCalls ?? 0,
      armorRtWidth: a.rt?.width ?? null, armorRtHeight: a.rt?.height ?? null, armorRtCreates: a.rt?.creates ?? null,
      armorRtResizes: a.rt?.resizes ?? null, armorRtDisposes: a.rt?.disposes ?? null, armorRtColorEstimateBytes: a.rt?.colorEstimateBytes ?? null,
      dpr: renderer ? renderer.getPixelRatio() : 0,
      tracers: battle.tracerCount(), traj: battle.trajLineCount(),
      impacts: battle.fxStats()?.impacts ?? 0,
      burst: battle.fxStats()?.bursts ?? 0,
      veh: vehicles.getVehicles().filter((v) => v.group.visible).length });
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
        perf.event({ stage: 'main-thread-stall', durationMs: gap, replayTime: T });
        perfStalls.sort((a, b) => b.gap - a.gap);
        if (perfStalls.length > 8) perfStalls.length = 8;
      }
    }, PERF_HEARTBEAT_MS);
  }
  function updatePerfIdentity() {
    perf.setIdentity({ quality: QKEY, cameraMode: CAM, armorhl: ARMOR_HIGHLIGHT,
      viewport: [container.clientWidth, container.clientHeight], dpr: renderer ? renderer.getPixelRatio() : window.devicePixelRatio });
  }
  const perfHandle = PERF ? {
    report: () => { gpu.poll(); updatePerfIdentity(); const s = perf.report() + `\ngpu_total_ms: sum of successfully measured render-pass GPU timings (not a full GPU frame; null unless all required queries succeed)` + `\nannotation: ${JSON.stringify(annotationScene.stats())}` + `\ngpu: ${JSON.stringify(gpu.snapshot())}` + `\nmain-thread stalls >${PERF_HEARTBEAT_MS * 2}ms: ${perfStalls.length}\n` + perfStalls.map(r => `  ${r.gap.toFixed(1)} ms @T=${r.t.toFixed(1)}`).join('\n'); console.log(s); return s; },
    snapshot: () => (gpu.poll(), updatePerfIdentity(), { ...perf.snapshot(), annotation: { ...annotationScene.stats() }, resources: { geometries: renderer?.info?.memory?.geometries ?? null, textures: renderer?.info?.memory?.textures ?? null }, armorRt: armorStats.rt ? { ...armorStats.rt } : null, gpu: gpu.snapshot() }),
    startCapture: (options) => { if (paused) throw new Error('scene is inactive'); updatePerfIdentity(); perf.startCapture(options); },
    stopCapture: () => { gpu.poll(); return perf.stopCapture(); },
    reset: () => { gpu.reset(); perf.reset(); mapWorld.resetTerrainCounters(); perfStalls = []; perfBeat = performance.now(); },
  } : null;
  if (PERF) { perfStartWatchdog(); window.__pbPerf = perfHandle; }


  /** 预热在用材质（见 renderer 初始化处注释）：把首次编译的数十~数百 ms 从"战斗第一次
   *  开火/命中"挪到加载阶段。失败不影响播放（best-effort）。 */
  function prewarmShaders() {
    try {
      camera.updateMatrixWorld();
      // 战斗特效的批次与条带平时按需隐藏：预热期间临时显示，避免首发开火时才编译
      battle.ensureBattleFx().prewarm(() => {
        renderer.compile(scene, camera);
      });
      if (ARMOR_HIGHLIGHT && typeof renderer.compile === 'function') {
        ensureArmorHighlight().prewarm(camera);
      }
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }

  function tick() {
    // 弹道推进（游标/推进 owner = battleRuntime.advanceShotsTo）
    battle.advanceShotsTo(T);
    labels.advanceKills();
    // Visibility/position at this T must precede feedback: a newly destroyed vehicle
    // can become visible again after coverage ended, so last frame's visibility is stale.
    for (const v of vehicles.getVehicles()) vehicles.applyPose(v);
    vehicles.clearSnap();   // pose has consumed the seek snap for this tick
    // 炮口要等本 tick 炮管摆到 T 时刻姿态后再定位；曳光 / 光迹的可见起点（炮口）由它填入，
    // 所以弹道推进排在它之后
    battle.flushMuzzles();
    battle.updateTracers();
    // 战斗反馈事件泵（回放时钟；壁钟寿命/游标在 playback/transientFeedback3d.ts）
    battle.transients.advanceTo(T);
    mapWorld.updateDestructibles(T);
    tread.updateTrails();     // 履带印游标泵（seek 后退 = 全量重算，前进 = 增量）
    labels.updateScore();
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
    if (force) labels.publishLabels(true);
    // 顶栏：双方队伍总血量（与上游 3D 视图同口径：各队 max_hp 汇总；未知阵营不计入任一方，
    // 见 teamHpTotals）。随 HUD 10Hz 节流写入即可——血量每秒变化远低于此，没必要每帧
    // 触发整页 VDOM patch（见上方 HUD_INTERVAL_MS）。
    Object.assign(store, teamHpTotals(
      vehicles.getVehicles().map((v) => ({ team: v.def.team, hp: hpAt(v, T), maxHp: v.def.max_hp })),
      DATA.meta.friendly_team,
    ));
    // 名册与上面的总血量同帧写入：两侧名册与顶栏永远是同一个 T 的投影
    labels.updateRoster();
    store.time = T;
    store.recorderModeUnknown = !!recorderCamera && recorderModeAt(recorderCamera, T) === CAMERA_MODE.UNKNOWN;
    store.recorderViewAvailable = recorderViewAvailable();
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
      if (perf) { perf.idle(); perf.interrupt('background'); }
      if (perfBeatTimer) { clearInterval(perfBeatTimer); perfBeatTimer = 0; }
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!destroyed) {
      // pre-init 也必须把被 pause 取消的唯一 rAF 重新挂回去：animate() 本身在 renderer
      // 尚未创建时只排下一帧并安全返回。否则「待开播切走 → 切回 → Start」会进入
      // paused=false / renderer!=null / rafId=0 的死态，场景 ready 但时间与画面都不再推进。
      perfStartWatchdog();
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
    battle.transients.resyncBursts(T);   // late canonical never replays past explosions
    store.startTime = START;
    store.duration = END;
    const t = Math.max(START, Math.min(END, T));
    if (t !== T) seekTo(t);
    else for (const v of vehicles.getVehicles()) vehicles.applyPose(v);   // canonical late/failure refreshes paused visuals too
    if (PLAYING && T >= END) setPlaying(false);
    writeHud(true);
    invalidate();
  }
  function seekTo(t) {
    T = Math.max(START, Math.min(END, t));
    battle.clearEffects();   // 动态层 dispose（与 teardown 同一路径，防 seek 循环累积显存）
    // 游标一律重定到「T 之后第一条」：clearEffects 已把 transient 游标归零，
    // 若不重定，紧随的 tick() 会把 t<=T 的历史飘字/爆散一次性补播（与 2D seek 语义不符）
    battle.resetShotsTo(firstIndexAfter(DATA.shots, T, (x) => x.t_fire));
    battle.transients.rewind(T);
    labels.rebuildFeed();
    labels.resetScore();     // 比分为单调游标，seek 后必须从头推进（否则分数不回落）
    winnerShown = false; store.banner = null;
    vehicles.markSeekSnap();  // 跳变：行程吸附到目标、侧位移不积分（客户端"首次可见直接吸附"同款）
    tick();
    vehicles.clearSnap();
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
    if (DATA) labels.updateRoster();
    invalidate();
  }
  function setCam(mode) {
    if (annotationScene.hasGesture()) annotationScene.cancelAnnotationGesture()   // 相机模式跳变不得继续旧 draft
    // 沙盘（top）是持续的战术总览模式：OrbitControls 以**地图中心**为 target，拖拽/滚轮围绕
    // 地图中心旋转与缩放。top-view 不是模式，只是快速回到俯视机位的动作（reset view）：
    // 完成后就是自由视角，键盘、鼠标与触屏从同一帧起可用。跟随以选中坦克为 target；
    // 自由视角是 FPS 飞行（旋转中心 = 相机，由 flyLook 接管）。
    const topViewAction = mode === 'top-view';
    const nextMode = topViewAction ? 'free' : mode;
    if (nextMode === 'recorder' && !recorderViewAvailable()) return;
    if (nextMode !== 'top') topViewOnLoad = false;
    if (CAM === 'recorder' && nextMode !== 'recorder') leaveRecorderView();
    if (nextMode === 'recorder' && CAM !== 'recorder') enterRecorderView();
    CAM = nextMode;
    store.cam = nextMode;
    flyLookApplyMode(nextMode === 'free' ? 'free' : 'follow');
    if (nextMode !== 'follow') FOLLOW_EID = 0;
    if (!controls) { invalidate(); return; }
    controls.enabled = nextMode === 'follow';
    // 旋转/缩放中心语义要求 target 不被平移带走：Top 锁地图中心、Follow 锁坦克；
    // Free 由 flyLook 接管，OrbitControls 的 pan 不参与（恢复默认值供下次非 Free 入口设置）。
    controls.enablePan = nextMode === 'free';
    invalidate();
    if (nextMode === 'top') {
      applyTopView();
      // 总览视角：可绕地图中心自由旋转（仍不沉到地平线以下），缩放上限放开到默认机位高度
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minDistance = cameraTerrainClamp.baseMinDistance();
      controls.maxDistance = Math.max(controls.maxDistance, topCameraDefaultHeight());
      clampOrbitCameraToTerrain();
      camera.lookAt(controls.target);
      controls.enabled = true;
    } else if (nextMode === 'free') {
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      if (topViewAction) applyTopView();
      constrainFreeCameraAltitude();
      if (topViewAction) camera.lookAt(controls.target);
    } else if (nextMode === 'follow') {
      // 跟随绕转不得沉到 target 水平线以下：OrbitControls 的极角上限直接挡住
      // 「向下绕到地下」的输入；相机点仍由 clampOrbitCameraToTerrain 按地形净空校验。
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI * 0.49;
      clampOrbitCameraToTerrain();
    }
    // 跟随目标是名册的运行时状态（followed）。setFollow 也经由这里：暂停时没有帧在跑，
    // 换相机必须自己补写，否则跟随描边要等到下次播放 / seek 才出现。走 writeHud 而不是
    // 直接投影名册：播放中名册也不得跑到顶栏前面（两者始终同一个 T）。
    writeHud(true);
  }
  // ---------- 录像者视角 ----------
  const cameraDriven = () => flyMode() || CAM === 'recorder';
  const recorderVehicle = () => vehicles.vehicleByEid(DATA?.meta?.author_eid);
  /** Type39/23/31 的归属止于第一次死亡：之后可能属于观战视点，复活不能证明相机回到录像者。 */
  function recorderOwnsCamera(v) {
    return !deathAt(v, T) && deathTimesOf(v).every((death) => T < death);
  }
  /** Type23 未知时不伪装成 Arcade：保留 raw，消费层退出。 */
  function recorderViewAvailable() {
    const v = recorderVehicle();
    return !!recorderCamera && !!v && recorderOwnsCamera(v)
      && recorderModeAt(recorderCamera, T) !== CAMERA_MODE.UNKNOWN;
  }
  function loadRecorderCamera(source, epoch) {
    recorderCamera = null;
    store.recorderCameraStatus = source?.file ? 'loading' : 'unavailable';
    if (!source?.file) return;
    const settle = (facet) => {
      if (destroyed || epoch !== session.sessionEpoch()) return;
      const usable = !!facet && facet.author_eid === DATA?.meta?.author_eid;
      recorderCamera = usable ? facet : null;
      store.recorderCameraStatus = usable ? 'ready' : 'unavailable';
      writeHud(true);
    };
    loadRecorderCameraFromFile(source.file, source.signal).then(settle).catch((err) => {
      if (err?.name !== 'AbortError') console.warn('[playback] 录像者相机解析失败:', err);
      settle(null);
    });
  }
  function enterRecorderView() {
    cameraBlend = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: camera.fov,
      elapsed: 0,
    };
    fovRestore = null;
    recorderBoomScale = 1;
    // 开镜前预取敌方车型 armor 模板，减少首次瞄准新车型的 GLB 下载/解析卡顿。
    if (ARMOR_HIGHLIGHT && renderer) {
      const highlight = ensureArmorHighlight();
      highlight.prewarm(camera);
      highlight.prefetch(highlightEnemies());
    }
  }
  function leaveRecorderView() {
    cameraBlend = null;
    fovRestore = camera.fov === BASE_FOV_DEG ? null : { fov: camera.fov, elapsed: 0 };
    const hidden = scopedHiddenEid ? vehicles.vehicleByEid(scopedHiddenEid) : null;
    scopedHiddenEid = 0;
    if (hidden) setScopedLayer(hidden, false);
    foliageClip.value = 0;
    recorderReticle?.hide();
    // 开镜结束即释放全尺寸 RT（下次开镜命中目标时按需重建），不把 2×W×H 显存挂到会话结束。
    armorHighlight?.releaseRenderTargets?.();
  }
  function setScopedLayer(v, hidden) {
    const layer = hidden ? SCOPED_HIDDEN_LAYER : 0;
    v.group.traverse((node) => node.layers.set(layer));
    v.glb?.traverse((node) => node.layers.set(layer));
  }
  function applyCameraFov(fov) {
    if (Math.abs(camera.fov - fov) < 1e-3) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    invalidate();
  }
  function stepFovRestore(dt) {
    fovRestore.elapsed += dt;
    const progress = blendProgress(fovRestore.elapsed);
    applyCameraFov(fovRestore.fov + (BASE_FOV_DEG - fovRestore.fov) * progress);
    if (progress >= 1) fovRestore = null;
  }
  const _recorderDir = {};
  const _recorderPos = new THREE.Vector3();
  const _recorderAnchor = new THREE.Vector3();
  const _recorderPrev = new THREE.Vector3();
  const _recorderLook = new THREE.Vector3();
  const _recorderRay = new THREE.Vector3();
  const _recorderGun = new THREE.Vector3();
  const _recorderGunDir = new THREE.Vector3();
  const _reticleAim = { x: 0, y: 0 };
  const _reticleGun = { x: 0, y: 0 };
  const _recorderQuat = new THREE.Quaternion();
  const _recorderLastPos = new THREE.Vector3();
  const _recorderLastQuat = new THREE.Quaternion();
  /** 回放数据驱动相机：开镜相机在炮位、朝向与 FOV 全部来自回放，不做平滑。 */
  function driveRecorderCamera(dt) {
    const v = recorderVehicle();
    if (!DATA || !recorderCamera || !v || !recorderOwnsCamera(v)) { setCam('free'); return; }
    const sample = sampleRecorderCamera(recorderCamera, T, recorderSample);
    if (sample.mode === CAMERA_MODE.UNKNOWN) { setCam('free'); return; }
    aimDirectionScene(sample.yaw, sample.pitch, _recorderDir);
    const scoped = sample.mode === CAMERA_MODE.SNIPER;
    const hiddenEid = scoped ? v.def.eid : 0;
    const wasScoped = scopedHiddenEid !== 0;
    if (hiddenEid !== scopedHiddenEid) {
      scopedHiddenEid = hiddenEid;
      setScopedLayer(v, scoped);
      // SNIPER→ARCADE（含 seek 回 Arcade）：叠加渲染停止，释放全尺寸 RT；
      // 下次命中目标再按需重建。进入开镜/待在开镜不释放。
      if (wasScoped && !scoped) armorHighlight?.releaseRenderTargets?.();
      if (scoped && !wasScoped && ARMOR_HIGHLIGHT) ensureArmorHighlight().prefetch(highlightEnemies());
    } else if (scoped && v.glb && !v.glb.layers.isEnabled(SCOPED_HIDDEN_LAYER)) {
      setScopedLayer(v, true);   // 开镜期间 GLB 才装配完成
    }
    foliageClip.value = scoped ? FOLIAGE_CLIP_SCOPED_M : FOLIAGE_CLIP_ARCADE_M;
    let fov = BASE_FOV_DEG;
    if (scoped) {
      if (!vehicles.glbGunWorld(v, _recorderPos, _recorderGunDir)) {
        v.gunPivot.updateWorldMatrix(true, false);
        v.gunPivot.getWorldPosition(_recorderPos);
      }
      fov = fovFromZoomRaw(sample.zoomRaw);
      recorderBoomScale = 1;
    } else {
      vehicles.posAt(v, T, _recorderAnchor);
      _recorderAnchor.y += ANCHOR_HEIGHT_M;
      if (recorderCamera.client_options.backward_zoom === true) {
        vehicles.posAt(v, T - REVERSE_SAMPLE_OFFSET_SEC, _recorderPrev);
        const reversing = isReversing(
          { x: -_recorderPrev.x, z: _recorderPrev.z },
          { x: -_recorderAnchor.x, z: _recorderAnchor.z },
          vehicles.yawAt(v, T),
        );
        recorderBoomScale = backwardZoomScale(recorderBoomScale, reversing, dt);
      }
      arcadeCameraPosition(_recorderAnchor, _recorderDir, ARCADE_BOOM_M * recorderBoomScale, _recorderPos);
      const terrainY = terrainHeightForCameraClamp(_recorderPos.x, _recorderPos.z);
      if (Number.isFinite(terrainY)) _recorderPos.y = Math.max(_recorderPos.y, terrainY + CAMERA_GROUND_CLEARANCE);
    }
    _recorderLastPos.copy(camera.position);
    _recorderLastQuat.copy(camera.quaternion);
    const lastFov = camera.fov;
    camera.position.copy(_recorderPos);
    _recorderLook.set(_recorderDir.x, _recorderDir.y, _recorderDir.z);
    camera.lookAt(_recorderPos.x + _recorderLook.x, _recorderPos.y + _recorderLook.y, _recorderPos.z + _recorderLook.z);
    if (cameraBlend) {
      cameraBlend.elapsed += dt;
      const progress = blendProgress(cameraBlend.elapsed);
      _recorderQuat.copy(camera.quaternion);
      camera.position.lerpVectors(cameraBlend.position, _recorderPos, progress);
      camera.quaternion.slerpQuaternions(cameraBlend.quaternion, _recorderQuat, progress);
      fov = cameraBlend.fov + (fov - cameraBlend.fov) * progress;
      if (progress >= 1) cameraBlend = null;
    }
    applyCameraFov(fov);
    controls.target.copy(camera.position).addScaledVector(_recorderLook, 30);
    if (!camera.position.equals(_recorderLastPos) || !camera.quaternion.equals(_recorderLastQuat) || camera.fov !== lastFov) {
      invalidate();
    }
    updateRecorderReticle(sample, v);
  }
  /** Type39 瞄准点（场景坐标）：准星与穿深着色的选目标共用这一点。 */
  function recorderAimPoint(sample, out) {
    return out.set(-sample.rayX, sample.rayY, sample.rayZ);
  }
  /** 世界点 → 舞台像素；投影不到返回 null，不伪造屏幕位置。 */
  function projectToStage(point, out) {
    point.project(camera);
    if (![point.x, point.y, point.z].every((n) => Number.isFinite(n) && Math.abs(n) <= 1)) return null;
    out.x = (point.x + 1) * container.clientWidth / 2;
    out.y = (1 - point.y) * container.clientHeight / 2;
    return out;
  }
  /**
   * Arcade 相机沿 Type39 看，所以中心点按定义在屏幕中间；扩散圆画在炮管实际指向上，
   * 炮塔转动滞后时才会偏离中心再追上来，开镜时两者接近重合。
   */
  function updateRecorderReticle(sample, v) {
    if (!recorderReticle) return;
    camera.updateMatrixWorld();
    if (!vehicles.glbGunWorld(v, _recorderGun, _recorderGunDir)) {
      v.gunPivot.updateWorldMatrix(true, false);
      v.gunPivot.getWorldPosition(_recorderGun);
      _recorderGunDir.set(0, 0, 1).transformDirection(v.gunPivot.matrixWorld);
    }
    recorderAimPoint(sample, _recorderRay);
    const distance =Math.max(RETICLE_MIN_GUN_DISTANCE_M, _recorderGun.distanceTo(_recorderRay));
    _recorderGun.addScaledVector(_recorderGunDir, distance);
    const aim = projectToStage(_recorderRay, _reticleAim);
    const gun = projectToStage(_recorderGun, _reticleGun);
    if (!aim && !gun) { recorderReticle.hide(); return; }
    recorderReticle.update(aim, gun, reticleRadiusPx({
      bloomRaw: sample.bloomRaw, fovDeg: camera.fov, viewportH: container.clientHeight,
    }));
  }
  // ---------- Sniper 穿深着色 ----------
  let armorHighlight = null;
  const _armorAimPoint = new THREE.Vector3();
  const _armorAimDir = new THREE.Vector3();
  /** 当前时刻可被准星选中的敌车（可见、复活/存活、真实车模）。 */
  function highlightEnemies() {
    if (!DATA?.meta) return [];
    const friendlyTeam = DATA.meta.friendly_team;
    return vehicles.getVehicles().filter((v) => v.glb?.visible && v.group.visible && v.tankData
      && (v.def.team === 1 || v.def.team === 2) && v.def.team !== friendlyTeam && !deathAt(v, T));
  }
  function ensureArmorHighlight() {
    armorHighlight ??= createArmorHighlight({ renderer, assetProvider });
    return armorHighlight;
  }
  const armorStats = { pickMs: 0, stateMs: 0, thicknessMs: 0, occluderMs: 0, colorMs: 0, calls: 0, _t0: 0 };
  const _occluderRoots = [];
  function occluderRoots(targetEid) {
    _occluderRoots.length = 0;
    for (const root of [mapWorld.terrainMesh(), mapWorld.mapScenery(), mapWorld.mapPlane(), mapWorld.groundMesh()]) {
      if (root) _occluderRoots.push(root);
    }
    for (const v of vehicles.getVehicles()) {
      if (v.def.eid === targetEid) continue;
      if (v.group) _occluderRoots.push(v.group);
      if (v.glb) _occluderRoots.push(v.glb);
      for (const head of v.detachedTurrets || []) _occluderRoots.push(head.root);
    }
    return _occluderRoots;
  }
  /**
   * 主渲染之后的叠加 pass：只有录像者开镜才可能运行，其余路径没有任何额外 render。
   * 进入录像者的过渡期相机还没到炮位，距离衰减和入射角都不对，不着色。
   */
  function renderArmorHighlight() {
    if (PERF) {
      armorStats.pickMs = 0; armorStats.stateMs = 0; armorStats.thicknessMs = 0;
      armorStats.occluderMs = 0; armorStats.colorMs = 0; armorStats.calls = 0;
      armorStats.stateCalls = 0; armorStats.thicknessCalls = 0; armorStats.occluderCalls = 0; armorStats.colorCalls = 0;
    }
    if (!ARMOR_HIGHLIGHT || CAM !== 'recorder' || !scopedHiddenEid || cameraBlend) return;
    const author = recorderVehicle();
    if (!author?.tankData) return;
    const tPick0 = PERF ? performance.now() : 0;
    const enemies = highlightEnemies();
    const aimDir = reticleAimDirection(camera, recorderAimPoint(recorderSample, _armorAimPoint), _armorAimDir);
    let target = null;
    if (aimDir) target = aimedVehicle(camera.position, aimDir, enemies, camera);
    const shellId = target == null ? null : authorShellAt(DATA.author_shell_timeline, T);
    const config = target == null ? null : resolveExactMountedConfig(target.def, target.tankData);
    const authorConfig = target == null ? null : resolveExactMountedConfig(author.def, author.tankData);
    const blocked = target == null ? 'no_target' : armorHighlightBlock({
      targetTankId: target.def.tank_id, targetConfig: config, authorConfig, shellId,
      targetEquipment: target.def.equipment, authorEquipment: author.def.equipment,
    });
    if (PERF) {
      armorStats.pickMs = performance.now() - tPick0;
      if (blocked) return;
    } else if (blocked) return;
    const { shell, caliber } = mountedShell(authorConfig, shellId);
    ensureArmorHighlight().render({
      scene, camera, vehicle: target, tankData: target.tankData, config, shell, caliber,
      ...armorEquipmentCoeffs(shell, author.def.equipment, target.def.equipment),
      onReady: invalidate,
      occluderRoots: occluderRoots(target.def.eid),
      stats: PERF ? armorStats : null,
      gpu: gpu ?? undefined,
    });
  }
  /** 回到俯视机位：相机置地图中心正上方，target 锁地图中心。 */
  function applyTopView() {
    const { cx, cz } = mapWorld.worldCenter();
    camera.position.set(cx, topCameraDefaultHeight(), cz + 0.01);
    controls.target.set(cx, 0, cz);
    // 保留直下朝向：默认的天顶回落会让第一次拖拽突然跳到斜俯视。
    flyLookSyncFromCamera('top view', true);
  }
  // 只接受档位表内的值：面板按钮与 URL 参数都不该把场景带进"1.37×"这种未定义速度
  function setSpeed(s) { if (!isPlaybackSpeed(s)) return; SPEED = s; store.speed = s; }

  // ---------- 键盘自由视角（WASD/QE 飞行）----------
  // 速率档 1–6（与播放速度档独立）：场景只存展示值并失效一帧（暂停时改档也出帧）；
  // 位移推进本体在 composables/useSceneFlyControls.tickFly（Replay3DPane 逐帧调用，
  // 相机数学不进内核——OrbitControls 的 target 随位移平移，其余控制语义不变）。
  function topCameraDefaultHeight() { return mapWorld.worldCenter().ext * 1.7; }
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
      topViewOnLoad = false;
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

  //（动态层清除 owner = playback/battleRuntime.ts 的 clearEffects/dispose；seekTo 与
  //  teardownSession 经 battle 句柄调用，防 seek 循环累积显存的语义逐字保留）

  function teardownSession() {
    session.bumpSessionGen();
    session.setSessionMode('replay');
    MAP_BASES_KIND = null;
    MAP_SPAWN_POINTS = null;   // 出生点列随会话复位（宿主就绪后经 setMapSpawns 补推）
    store.mapReady = false;
    // 录像者不跨回放：同步退出，旧机位不能被下一场当成用户的自由相机保留。
    if (CAM === 'recorder') {
      setCam('free');
      topViewOnLoad = true;
    }
    recorderCamera = null;
    armorHighlight?.dispose();
    armorHighlight = null;
    foliageClip.value = 0;
    store.recorderCameraStatus = 'idle';
    store.recorderViewAvailable = false;
    store.recorderModeUnknown = false;
    mapWorld.resetMapLighting();   // 逐图光照随会话复位（否则换图时上一张的太阳会残留）
    // 动画混合层材质随会话失效（材质已随 mapScenery dispose；mapWorld.dispose 内复位）
    battle.dispose();   // 战斗表现 teardown owner（#820 Step 5）：clearEffects + battleFx 释放
                        //（粒子批次 / 条带 / 图集）+ window.__battleFx 删除，顺序逐字保留
    // 拾取调试残留（标记网格 + 面板 DOM）与边界带随会话回收（实现在 playback/ 工厂）
    pickReporter.dispose({ scene, disposeObject3D });
    boundaryBand.clear();
    mapWorld.dispose();   // 地图资产段 teardown（owner 在 mapWorld；对象清单/顺序逐字保留）
    annotationScene.clearSessionProjection();   // 旧会话的 annotation 派生几何不得跨图残留（权威在 pane）
    clearBases();   // 基地贴地标记（圆环 + 圆盘贴图）随会话释放
    clearSpawns();   // 出生点贴地标记随会话释放（#835，与基地同一生命周期）
    // 车辆域 teardown owner（#820 Step 4）：履带印逐车回收 + 贴图/参数缓存释放
    //（treadRuntime.dispose），随后车辆循环（分离炮塔/GLB/悬挂几何/低模组）+ GLB 模板
    // 缓存释放 + V=[]（vehicleRuntime.dispose）。先 tread 后 vehicles，保持原相对顺序
    //（原车辆循环内履带段在组 dispose 之前）。
    tread.dispose();
    vehicles.dispose();
    lifeTracks = null;
    lifeTracksByAccount.clear();
    labels.resetSessionState();   // 标签段 teardown owner（#820 Step 5）：labelOverlay 清空 +
                                  // 标签游标/resolver/tankData 缓存复位（原逐行段收口）
    // 地图资产段 teardown 已在上方 mapWorld.dispose()（owner 释放：占位地面/地形/场景
    // GLB/底图/IBL/分层地表/高度场/遮挡与 annotation 候选格）。
    // GLB 模板缓存（session-scoped）的释放已并入上方 vehicles.dispose()（owner 在
    // vehicleRuntime；未决 Promise 挂 then(dispose) 的语义逐字保留）。
    DATA = null;
    VIS_BY_EID = new Map();
    POSE_GRID.tStart = 0;
    POSE_GRID.samples = 0;
    store.playbackSession = null;
    // 会话终止 = 不再有任何可用的回放数据：就绪标记必须一起落下，否则新会话加载期间
    // （或 file=null / 被阻断 / 组件卸载之后）HUD 与播放传输仍会按「已就绪」渲染，
    // 而底层 DATA/车辆/贴图已经 dispose。destroy 与 loadData 的替换路径都经过这里。
    store.hasData = false;
    T = 0; battle.resetShotPtr(); labels.resetCursors();
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
    labels.resetRoster();   // eid → 名册行 索引清空（实现在 playback/hudFeed.js）
  }

  /** 重建渲染器上下文（偏好失配时）：卸旧 renderer/controls/画布与事件，
   *  initScene 重建——会话数据（DATA/资产/相机状态）不动，仅重挂画布。 */
  function rebuildRenderer() {
    // initScene 换新相机：机位不随之丢失，是否保留由 buildWorld 按会话决定。
    const position = camera.position.clone();
    const target = controls.target.clone();
    // 旧尺寸监听器必须先断（评审 P2）：initScene 每次新建 ResizeObserver 覆盖
    // sizeObserver——不断开旧实例会在同容器上累积回调（每次重建一个），
    // destroy 也只回收最后一个；旧回调还会对已 dispose 的 renderer 调 setSize。
    if (sizeObserver) { try { sizeObserver.disconnect(); } catch (_) {} sizeObserver = null; }
    removeEventListener('resize', onResize);
    if (controls) { try { controls.dispose(); } catch (_) {} controls = null; }
    if (renderer) {
      try { renderer.domElement.removeEventListener('pointerdown', onScenePointerDown); } catch (_) {}
      try { renderer.domElement.removeEventListener('pointerup', onScenePointerUp); } catch (_) {}
      gpu?.detach();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch (_) {}
      renderer.domElement.remove();
      renderer = null;
    }
    dynResCtl = null;
    initScene();
    camera.position.copy(position);
    controls.target.copy(target);
    if (flyMode()) flyLookSyncFromCamera('renderer rebuild', true);
    camera.lookAt(controls.target);
  }

  /** 渲染器就绪（startPlayback 编排调用；原 startPlayback 内联段，偏好失配语义原样）。 */
  function ensureRenderer() {
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
  }
  /** 会话开场相机重置：跟随目标不跨回放（startPlayback 编排调用）。 */
  function prepareSessionCamera() { if (CAM !== 'free') topViewOnLoad = true; }
  /** 回放数据发布（sessionLifecycle 编排调用；DATA/VIS_BY_EID/POSE_GRID 唯一 owner 仍在本闭包）。 */
  function publishSessionData(data, playbackSession) {
    DATA = data;
    VIS_BY_EID = visibilitySpansByEid(data.visibility);
    POSE_GRID.tStart = data.meta.t_start;
    POSE_GRID.samples = data.meta.samples;
    store.playbackSession = playbackSession;
  }
  /** 地图预览 stub 发布（空车队，minimalData 同款形状；startPlayback 只走地图资产前缀）。 */
  function publishMapOnlyData(mapId, mapName) {
    DATA = {
      meta: { map_id: mapId || 0, map_name: mapName || '', t_start: 0, friendly_team: 1, duration: 0 },
      vehicles: [],
      shots: [],
      periods: [],
      destructible_events: [],
    };
    VIS_BY_EID = visibilitySpansByEid(undefined);
    POSE_GRID.tStart = 0;
    POSE_GRID.samples = 0;
    store.playbackSession = null;
  }
  /** 会话级 resolver 装配 + mounted-configs 预取（owner = labelsRuntime.prepareResolvers）。 */
  function prepareResolvers() { labels.prepareResolvers(); }
  /** 会话游标复位（开战时刻：弹道指针与击杀 feed 指针）。 */
  function resetSessionCursors() { battle.resetShotPtr(); labels.resetCursors(); }

  // 会话生命周期 owner（#820 Step 1 出仓）：loadData / loadMapOnly / startPlayback 与
  // 会话代数三计数迁至 playback/sessionLifecycle.ts；本闭包是它的宿主（编排接线 +
  // 事实 owner），依赖注入语义见该模块 deps 接口。
  const session = createSessionLifecycle({
    store,
    destroyed: () => destroyed,
    perf: () => perf,
    teardownSession,
    publishSessionData,
    publishMapOnlyData,
    ensureRenderer,
    battleRange,
    publishSceneClock: () => { sceneClock = resolveReplayClock(DATA.periods || [], null, DATA.meta.duration); },
    clearCanonicalClock: () => { canonicalClock = null; },
    prepareSessionCamera,
    setMapKey: (key) => mapWorld.setMapKey(key),
    getGlbOn: () => vehicles.glbOn(),
    buildWorld: () => mapWorld.buildWorld(),
    setCam,
    clampCameraTarget,
    constrainFreeCameraAltitude,
    loadMapImage: () => mapWorld.loadMapImage(),
    buildBases,
    buildSpawns,
    buildVehicles: () => vehicles.buildVehicles(),
    applyGlbToggle: (on) => vehicles.applyGlbToggle(on),
    buildRoster: () => labels.buildRoster(),
    prepareResolvers,
    prewarmShaders,
    setPlaying,
    tick,
    writeHud,
    invalidate,
    loadRecorderCamera,
    transients: battle.transients,
    setClockRange: (start, end) => { START = start; END = end; },
    setTime: (t) => { T = t; },
    debug: DEBUG,
    exposeVehicles: () => { window.__pbV = vehicles.getVehicles(); },
    data: () => DATA,
    topViewOnLoad: () => topViewOnLoad,
    cam: () => CAM,
    forceGlb: () => !!Q.forceGlb,
    resetSessionCursors,
  });

  // 初始化：事件绑定 + 动画循环（渲染器惰性创建，画质选择先于首帧定型）
  animate();
  applyGlbGate();

  return {
    loadData: session.loadData,
    loadMapOnly: session.loadMapOnly,
    /**
     * 地图预览会话：选择贴地基地环画哪组（'supremacy' | 'assault' | null=隐藏）。
     * 非法值归一为 null（fail-closed）。会话未就绪时只记意图——startPlayback 的
     * map 分支建场景时按它 build；已就绪则立即重建 + 标脏（按需渲染立即见效）。
     * 回放会话调用只记值（会被 teardown 复位），不触碰回放的轨迹判模式语义。
     */
    setMapBasesKind(kind) {
      MAP_BASES_KIND = (kind === 'supremacy' || kind === 'assault') ? kind : null;
      if (session.sessionMode() === 'map' && store.mapReady) {
        buildBases();
        invalidate();
      }
    },
    /**
     * 地图预览会话：下发出生点列（#835；语义档案 parseMapGridProfile.spawnPoints 的
     * 解析产物）。非数组归一为 null（fail-closed：缺档/脏值不画不猜，逐条兜底在
     * spawns.build）。推送纪律与 setMapBasesKind 完全一致：会话未就绪时只记意图
     * （startPlayback 的 map 分支按它 build）；已就绪则立即重建 + 标脏。回放会话
     * 调用只记值（会被 teardown 复位），buildSpawns 在回放会话恒传 null。
     */
    setMapSpawns(points) {
      MAP_SPAWN_POINTS = Array.isArray(points) ? points : null;
      if (session.sessionMode() === 'map' && store.mapReady) {
        buildSpawns();
        invalidate();
      }
    },
    /**
     * UI Profile 切换（useUiProfile 不 reload/remount）后刷新已有出生点材质颜色：
     * 与 setMapSpawns 同一 map 会话门控；非 map 会话 no-op。宿主（MapPreview3DPane）
     * watch `uiProfile` 触发——2D 出生点随 CSS 自动更新，3D 必须显式同步。
     */
    refreshSpawnColors() {
      refreshSpawnColors();
    },
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
      if (perf) { perf.interrupt('session-reset'); perf.beginSession(); session.clearReadySession(); perf.setIdentity({ replayDigest: null }); }
      session.invalidateLoadingTokens();
      teardownSession();               // 车辆/地图/地形/特效/GLB 模板全量释放 + roster/HP/点数归零
      setPlaying(false);
      store.hasData = false;
      store.mapReady = false;
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
    /**
     * committed annotations 的 projection input（权威 owner = Replay3DPane）。
     * 同引用重复调用跳过；scene 不修改数组，也不把它当可回写状态。
     */
    setAnnotations: (annotations) => annotationScene.setAnnotations(annotations),
    /**
     * drawing tool 配置（pane 是唯一 owner）。width/eraserWidth 是 CSS px 视觉值；
     * scene 在 gesture 起点换算 semantic 尺寸。只在 enabled/tool 变化时取消 draft。
     */
    setAnnotationInteraction: (config = {}) => annotationScene.setAnnotationInteraction(config),
    /** 只切 renderer 可见性；不删 state、不写 history、不重建 geometry。 */
    setAnnotationsVisible: (visible) => annotationScene.setAnnotationsVisible(visible),
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
    setGlb: (on) => { if (!Q.forceGlb && (Q.allowGlb || !on)) vehicles.applyGlbToggle(on); invalidate(); },
    // 地面履带印开关（会话级，不持久化；关→开从 START 全量补铺，见 updateTrails）
    setTreadMarks: (on) => {
      store.treadOn = !!on;
      // 立即同步（review P2 2026-10-11）：writeTrailQuads/可见性只由 tick 驱动，而暂停时
      // animate 不 tick——只改 store 的话，暂停态 setTreadMarks(false) 后 mesh.visible 仍是
      // true（实测），必须继续播放或 seek 才更新。这里直接跑一次游标泵（幂等：同 T 重入
      // 不产生新段，全量重建也由 builtT=-∞ 路径确定性收敛）。
      tread.updateTrails();
      invalidate();
    },
    /**
     * 共享标签偏好（唯一 owner = usePlaybackPreferences）。契约：
     * - `enabled:false` → 整层名牌隐藏。伤害数字是战斗反馈而不是名牌内容：覆盖层收到
     *   的 anchor 仍带 `projected`，关名牌时数字回退到锚点上方继续显示；
     * - `showPlayerName / showTankName / showHp / showReload` → 名牌内部的行开关。
     * - `classIcons` → 使用 HTML 类型图标替换模型，保留事实 root 与拾取。
     * - `showStatus` → 作者标记环。战斗反馈（伤害数字 / 幽灵段 / 受击闪）不受它控制，
     *   只随 `enabled:false`（隐藏全部 UI）对应的覆盖层整层隐藏一起消失。
     */
    setLabelPrefs: (prefs) => {
      const enabled = !prefs || prefs.enabled !== false;
      store.labelsOn = enabled;
      labels.setClassIcons(prefs?.classIcons === true);
      labels.setShowMarkerStatus(prefs?.showStatus !== false);
      // Keep factual visibility and the raycast roots intact. Only artwork is
      // replaced; projected icon buttons continue selecting the same entity.
      for (const v of vehicles.getVehicles()) {
        vehicles.setLowPoly(v, !v.glb);
        vehicles.applyDetachedTurrets(v);
        if (v.glb) v.glb.visible = v.group.visible && !labels.classIconsVisible();
      }
      labels.setLabelPrefs();
      if (camera) labels.updateLabels();
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
    setArmorHighlight: (on) => {
      if (perf && ARMOR_HIGHLIGHT !== !!on) perf.interrupt('armor-setting-change');
      ARMOR_HIGHLIGHT = !!on;
      persistPref('pb_armor_highlight', on);
      store.armorHighlight = !!on;
      if (!ARMOR_HIGHLIGHT) {
        // 关闭即释放 RT；模板与目标保留，重新打开时不再重新下载/构建。
        armorHighlight?.releaseRenderTargets?.();
      } else if (CAM === 'recorder' && renderer) {
        const highlight = ensureArmorHighlight();
        highlight.prewarm(camera);
        highlight.prefetch(highlightEnemies());
      }
      invalidate();
    },
    setQuality,
    setPaused,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      destroyed = true;
      foliageClip.value = 0;
      flyLookApplyMode('follow');   // 恢复 controls 原生状态（实例随即销毁，防残 handedness）
      session.invalidateForDestroy();
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
      annotationScene.dispose();     // annotation 材质/geometry/group 随实例释放
      removeEventListener('resize', onResize);
      // container 由宿主复用（场景销毁 ≠ 舞台销毁）：capture 拦截必须摘除，
      // 否则重建场景后同一事件被多份闭包重复消费（拖拽增量翻倍）。
      annotationScene.detach();   // annotation capture 监听（原 5 行 removeEventListener 收口）
      try { container.removeEventListener('pointerdown', onFlyCaptureDown, true); } catch (_) {}
      try { container.removeEventListener('pointermove', onFlyCaptureMove, true); } catch (_) {}
      try { container.removeEventListener('pointerup', onFlyCaptureUp, true); } catch (_) {}
      try { container.removeEventListener('pointercancel', onFlyCaptureCancel, true); } catch (_) {}
      try { container.removeEventListener('wheel', onFlyCaptureWheel, true); } catch (_) {}
      try { container.removeEventListener('wheel', onOrbitZoomWheel, true); } catch (_) {}
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
        perf.reset();
        if (window.__pbPerf === perfHandle) delete window.__pbPerf;
      }
      if (renderer) {
        try { renderer.domElement.removeEventListener('pointerdown', onScenePointerDown); } catch (_) {}
        try { renderer.domElement.removeEventListener('pointerup', onScenePointerUp); } catch (_) {}
      }
      if (controls) {
        annotationScene.restoreTouches();   // touches.ONE 交还（原 annotation touches 恢复段）
        try { controls.dispose(); } catch (_) {}
      }
      if (renderer) {
        gpu?.dispose();
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (_) {}
        renderer.domElement.remove();
      }
    },
  };
}
