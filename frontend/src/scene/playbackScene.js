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
import { createPerfProbe } from './playback/perfProbe.ts'
//（相机运行时/录像者视角/穿深着色随 #820 Step 4 出仓 playback/cameraRuntime.ts；
//  fly 接管/top·follow 相机/选中语义经 cameraRuntime 句柄调度）
import { createCameraRuntime, CAMERA_GROUND_CLEARANCE } from './playback/cameraRuntime.ts'
// 内核拆分（2026-10-24）：常量/纯函数/画质表
// 出仓到 ./playback/，点击拾取调试与边界带出仓为工厂；公开 API 经本文件 re-export，
// 导入方（Replay3DPane / 测试）零改动。
import { GRID_DT } from './playback/util.js'
import { QUALITY_PRESETS, shadowQualityEligible } from './playback/quality.js'
// 坦克接地阴影（#907 主干随迁）：选择/句柄生命周期 owner = contactShadowControl.ts（逐车挂接在 vehicleRuntime）。
import { createContactShadowControl } from './playback/contactShadowControl.ts'
import { tracerSpanSecs, occlusionCells, occlusionFootprintCells } from './playback/pure.js'
import { createPickReporter } from './playback/pickReport.js'
import { chainVisible } from './pickDebug.js'
import { createBoundaryBand, BOUNDARY_THICK } from './playback/boundary.js'
import { createCameraTerrainClamp } from './playback/cameraTerrainClamp.js'
import { createBaseMarkers } from './playback/bases.js'
import { createSpawnMarkers } from './playback/spawns.js'

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
  // 相机状态（CAM/FOLLOW_EID/topViewOnLoad/录像者 facet/开镜隐藏层/呈现过渡）与
  // fly 接管、穿深着色、场景选中语义的唯一 owner = playback/cameraRuntime.ts
  //（#820 Step 4 出仓；本闭包经 cameraRuntime 句柄读写，语义与拆分前逐字一致）
  let renderer = null, scene, camera, controls, clock, raycaster;
  let hemiLight = null, sunLight = null;   // 逐图光照（applyMapLighting 覆盖，见 load 流程）
  // 世界/地形/地图资产状态（mapPlane/heightField/mapScenery/destruct/envTexture…）与
  // 逐图 IBL envTexture/envMultiplier 的唯一 owner = playback/mapWorld.ts（#820 Step 2 出仓）。
  let sizeObserver = null;
  // 名牌偏好（classIcons/showMarkerStatus）与 HTML 标签游标的唯一 owner = playback/labelsRuntime.ts
  //（#820 Step 5 出仓；本闭包经 labels 句柄读写）
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
  // 接地阴影控制域（选择不持久化，语义见 contactShadowControl.ts 头注释）
  const contactShadowCtl = createContactShadowControl({
    store, qualityKey: () => QKEY, getScene: () => scene, getSunLight: () => sunLight,
    surfaceHeightAt: (x, z) => mapWorld.annotationSurfaceHeightAt(x, z), stencilAssembled: () => !!rendererCaps?.stencil,
  });
  function setQuality(k) {
    if (!QUALITY_PRESETS[k] || k === QKEY) return;
    const apply = () => {
      if (perf) perf.interrupt('quality-change');
      QKEY = k; Q = QUALITY_PRESETS[k];
      try { localStorage.setItem('pb_quality', k); } catch (e) {}
      store.qualityKey = QKEY;
      store.qualityLabel = '画质 · ' + Q.label;
      if (!shadowQualityEligible(k)) contactShadowCtl.setEnabled(false);   // 降档清零；再升档不自动恢复
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

  // ---------- 场景 ----------
  function initScene() {
    // 创建核心（渲染器/相机/控件/灯光/resize+pointer 接线）在 playback/renderer.js
    //（2026-10-24 Step A2 出仓；状态所有权仍在本闭包——解构写回可变绑定）
    const core = createSceneCore({
      container, quality: Q, logdepth: LOGDEPTH, dynres: DYNRES, stencil: contactShadowCtl.wantsStencil(), debug: DEBUG,
      envTexture: mapWorld.envTexture(), envMultiplier: mapWorld.envMultiplier(),
      onResize, onPointerDown: cameraRuntime.onScenePointerDown, onPointerUp: cameraRuntime.onScenePointerUp,
      setFollow: (eid) => cameraRuntime.setFollow(eid),
    });
    scene = core.scene; camera = core.camera; renderer = core.renderer;
    controls = core.controls; clock = core.clock; raycaster = core.raycaster;
    gpu?.attach(renderer);
    cameraRuntime.applyMobileTouchControls();
    hemiLight = core.hemiLight; sunLight = core.sunLight;
    dynResCtl = core.dynResCtl; sizeObserver = core.sizeObserver; rendererCaps = core.rendererCaps;
    // annotation 段收口（#820 Step 5）：独立 raycaster 重建 + 5 个 capture 监听 + layer
    // 就绪 + 触摸模式（原逐行实现的等价入口，见 playback/annotationScene.ts）。
    annotationScene.attachListeners();
    // FPS 飞行接管 + top/follow 滚轮拦截（#835）的 container capture 监听收口
    //（原 6 行 addEventListener 段等价入口，见 playback/cameraRuntime.ts）。
    cameraRuntime.attachListeners();
    if (cameraRuntime.cam() === 'free') cameraRuntime.flyLookApplyMode('free');   // 初始 CAM 可能已是 'free'（默认值）
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
    constrainFreeCameraAltitude: () => cameraRuntime.constrainFreeCameraAltitude(),
    regroundBases,
    regroundSpawns,
    // annotation 派生缓存重建（owner = annotationScene；晚绑定箭头——工厂创建期不触碰）
    rebuildAnnotationProjection: () => annotationScene.rebuildAnnotationProjection(),
    reprojectAnnotationHeights: () => annotationScene.reprojectAnnotationHeights(),
    scopedHiddenEid: () => cameraRuntime.scopedHiddenEid(),
    onTerrainReground: () => contactShadowCtl.handle()?.reground(),   // 接地阴影随地形重建贴回
    onLightingApplied: () => contactShadowCtl.handle()?.syncSun(),   // 逐图光照后同步太阳
    lightingTargets: () => ({ renderer, scene, sunLight, hemiLight, debug: DEBUG }),
    buildWorldCameraPlacement: (center) => {
      const { cx, cz, ext } = center;
      // 用户操作过的自由视角跨回放保留；跟随目标不跨回放，仍回到默认机位。
      if (cameraRuntime.topViewOnLoad() || cameraRuntime.cam() !== 'free') {
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
    contactShadows: () => contactShadowCtl.handle(),   // 逐车阴影挂接/同步（#907 主干随迁）
    scopedHiddenEid: () => cameraRuntime.scopedHiddenEid(),
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
    getFollowEid: () => cameraRuntime.followEid(),
    deathAt,
    hpAt,
    visibleAt,
    visByEid: () => VIS_BY_EID,
    scopedHiddenEid: () => cameraRuntime.scopedHiddenEid(),
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
    // cameraDriven 归相机运行时：经箭头延迟求值，工厂创建期不触碰。
    cameraDriven: () => cameraRuntime.cameraDriven(),
    getTerrainMesh: () => mapWorld.terrainMesh(),
    getHeightField: () => mapWorld.heightField(),
    getHeightMeta: () => mapWorld.heightMeta(),
    sampleRenderedTerrainHeight: (x, z) => mapWorld.sampleRenderedTerrainHeight(x, z),
    sampleHeight: (x, z) => mapWorld.sampleHeight(x, z),
    clearance: CAMERA_GROUND_CLEARANCE,
    getWorldCenter: () => mapWorld.worldCenter(),
    isFollowing: () => !!cameraRuntime.followEid(),
  });
  function applyCameraClamp() { cameraTerrainClamp.applyCameraClamp(mapWorld.worldCenter().ext); }
  function terrainHeightForCameraClamp(x, z) { return cameraTerrainClamp.terrainHeightForCameraClamp(x, z); }
  function clampOrbitCameraToTerrain() { return cameraTerrainClamp.clampOrbitCameraToTerrain(); }
  function clampCameraTarget() { cameraTerrainClamp.clampCameraTarget(); }

  // 相机运行时 owner（#820 Step 4 出仓）：fly 接管 / 滚轮缩放平滑 / setCam·setFollow /
  // topViewOnLoad / 俯视机位 / 录像者视角域 / 穿深着色 / 场景选中语义的唯一归属。
  // 相机地形净空（cameraTerrainClamp）仍在本闭包，经 deps 回调注入；canonical 生命
  // 事实（deathAt/deathTimesOf）、?perf 域与 ARMOR_HIGHLIGHT 偏好仍在本闭包。
  const cameraRuntime = createCameraRuntime({
    store,
    container,
    debug: DEBUG,
    getCamera: () => camera,
    getRenderer: () => renderer,
    getControls: () => controls,
    getRaycaster: () => raycaster,
    getScene: () => scene,
    invalidate,
    getT: () => T,
    getData: () => DATA,
    sessionEpoch: () => session.sessionEpoch(),
    destroyed: () => destroyed,
    writeHud,
    updateRoster: () => labels.updateRoster(),
    vehicles,
    mapWorld,
    annotationScene,
    deathAt: (v, t) => deathAt(v, t),
    deathTimesOf: (v) => deathTimesOf(v),
    gpu: () => gpu,
    perfEnabled: () => !!PERF,
    armorHighlightPref: () => ARMOR_HIGHLIGHT,
    recorderReticle: recorderReticle ?? null,
    clampCameraTarget,
    clampOrbitCameraToTerrain,
    baseMinDistance: () => cameraTerrainClamp.baseMinDistance(),
    terrainHeightForCameraClamp,
    onVehicleSelect: onVehicleSelect ?? null,
    pickDebug: () => PICK_DEBUG,
    mobileTouch: () => MOBILE_TOUCH,
    syncContactShadow: (v) => vehicles.syncContactShadow(v),
    getPickDownAt: () => pickDownAt,
    setPickDownAt: (p) => { pickDownAt = p; },
    reportPick,
  });

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
    if (DATA && cameraRuntime.cam() === 'follow' && cameraRuntime.followEid()) {
      const v = vehicles.getVehicles().find((x) => x.def.eid === cameraRuntime.followEid());
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
    if (cameraRuntime.cam() === 'recorder') cameraRuntime.driveRecorderCamera(dt);
    else clampCameraTarget();
    cameraRuntime.zoomTick(dt);   // 滚轮缩放预算逐帧收敛（先于 controls.update()：本帧位移当帧可见）
    if (cameraRuntime.fovRestore()) cameraRuntime.stepFovRestore(dt);
    // flyMode 接管期间 OrbitControls.update() 必须完全停跑：enabled=false 只挡输入
    // 事件、update 照常执行——其内部球面状态会按 target/相机重算，与 flyLook 的
    // target 重钉互相污染（表现 = 拖拽行为在 FPS 转头与 OrbitControls 环绕之间漂移、
    // WASD 位移被球面拉回吞掉）。相机推进由 flyTick 全权负责。
    // flyMode 接管不变量（每帧断言）：enabled 意外被拉回 true 的同一帧压回 false，
    // 杜绝"FPS 转头与环绕/pan 漂移交替"的整类状态漂移。
    if (cameraRuntime.flyMode() && controls.enabled) controls.enabled = false;
    // free 接管期间 update() 不跑，它的 lookAt(target) 也随之缺席——相机朝向由本行
    // 维持（target 是权威：拖拽 / 平移 / 缩放都会先重钉 target）。不补这一步，
    // 拖拽只改 target 不改朝向，画面不转（用户实测）。
    if (cameraRuntime.flyMode()) camera.lookAt(controls.target);
    const cameraMoved = cameraRuntime.cameraDriven() ? false : controls.update();   // three 的 update() 返回相机是否变化（阻尼/交互）
    clampOrbitCameraToTerrain();
    const cameraFinished = PERF ? performance.now() : 0;
    // ---------- 按需渲染（脏帧）----------
    // 暂停且没有在飞特效、相机也静止时，跳过整帧工作（标签/基地/transient 重算 + 全屏
    // render）。此前空闲也满速重绘，是移动端发热与笔记本耗电的第一来源。
    // 伤害数字不参与这个判定：它是覆盖层 DOM + CSS 动画，暂停时自己走完，不需要出帧。
    const busy = PLAYING
      || cameraMoved
      || cameraRuntime.cameraBlend() || cameraRuntime.fovRestore()
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
      session.tryMarkFirstReadyFrame(performance.now());
      const perfR0 = PERF ? performance.now() : 0;
      cameraRuntime.renderArmorHighlight();
      gpu?.submitFrame();
      const perfR1 = PERF ? performance.now() : 0;
      if (PERF && session.isReadySession()) perfProbe.perfFrame(perfT1 - perfT0, perfR0 - terrainFinished, perfR1 - perfR0, cameraRuntime.armorStats(), { cpuFrameMs: perfR1 - cpuStarted, tickMs: tickFinished - cpuStarted, cameraMs: cameraFinished - tickFinished, terrainCheckInclusiveMs: terrainFinished - perfT1, gpuFrameId, gpu_total_ms: null });
      gpu?.recorded(gpuFrameId);
    } finally {
      if (PERF) renderer.info.autoReset = perfAutoReset;
      gpu?.abortFrame();
    }
  }

  // ---------- 性能探针（`?perf`；只读测量，不改变任何渲染行为） ----------
  // 分阶段逐帧耗时 / 主线程停顿看门狗 / window.__pbPerf 调试句柄的唯一 owner =
  // playback/perfProbe.ts（#820 Step 4 出仓）；PERF/perf/gpu 句柄仍由本闭包解构持有
  //（渲染循环与会话编排直接消费）。
  const perfProbe = createPerfProbe({
    container,
    getT: () => T,
    getRenderer: () => renderer,
    getQualityKey: () => QKEY,
    getArmorHighlightPref: () => ARMOR_HIGHLIGHT,
    getCameraMode: () => cameraRuntime.cam(),
    paused: () => paused,
    terrainCounters: () => mapWorld.terrainCounters(),
    resetTerrainCounters: () => mapWorld.resetTerrainCounters(),
    battle,
    getVehicles: () => vehicles.getVehicles(),
    annotationStats: () => annotationScene.stats(),
    armorStats: () => cameraRuntime.armorStats(),
    contactShadowsCount: () => contactShadowCtl.count(),
  });
  const PERF = perfProbe.PERF;
  const perf = perfProbe.perf;
  const gpu = perfProbe.gpu;
  let dynResCtl = null;
  let rendererCaps = null;   // 当前渲染器实际装配的 { logdepth, dynres, stencil }（reset 保留渲染器时用于失配检测）


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
        cameraRuntime.ensureArmorHighlight().prewarm(camera);
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
    store.recorderModeUnknown = cameraRuntime.recorderModeUnknown();
    store.recorderViewAvailable = cameraRuntime.recorderViewAvailable();
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
      perfProbe.stopWatchdog();
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!destroyed) {
      // pre-init 也必须把被 pause 取消的唯一 rAF 重新挂回去：animate() 本身在 renderer
      // 尚未创建时只排下一帧并安全返回。否则「待开播切走 → 切回 → Start」会进入
      // paused=false / renderer!=null / rafId=0 的死态，场景 ready 但时间与画面都不再推进。
      perfProbe.perfStartWatchdog();
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
  // 只接受档位表内的值：面板按钮与 URL 参数都不该把场景带进"1.37×"这种未定义速度
  function setSpeed(s) { if (!isPlaybackSpeed(s)) return; SPEED = s; store.speed = s; }


  // 键盘（空格 / ←→）由页面经 usePlaybackTransport 统一处理（与 2D 同一套键位与输入框防误触），
  // 场景内核不再自挂全局 keydown：原实现不区分输入框，会吞掉文本框里的空格。

  // ---------- 数据加载 ----------
  // 注：hull_yaw/turret_yaw 由后端相位解卷绕（连续域）后落盘，朴素线性插值即物理正确，
  // 前端不再二次去缠绕（旧版前端 unwrapAngleArray 已由后端数据契约取代）。

  //（动态层清除 owner = playback/battleRuntime.ts 的 clearEffects/dispose；seekTo 与
  //  teardownSession 经 battle 句柄调用，防 seek 循环累积显存的语义逐字保留）

  function teardownSession() {
    session.bumpSessionGen();
    session.setSessionMode('replay');
    MAP_BASES_KIND = null;
    MAP_SPAWN_POINTS = null;   // 出生点列随会话复位（宿主就绪后经 setMapSpawns 补推）
    store.mapReady = false;
    // 录像者不跨回放：同步退出，旧机位不能被下一场当成用户的自由相机保留。
    //（相机段 teardown owner = cameraRuntime.resetSessionState：setCam('free') +
    //  topViewOnLoad 复位 + recorderCamera / armorHighlight 释放，语义逐字保留）
    cameraRuntime.resetSessionState();
    contactShadowCtl.dispose();   // 只释放资源；选择跨 teardown 保留给本次 startPlayback
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
    cameraRuntime.resetFollow(); followAnchor = null;
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
      try { renderer.domElement.removeEventListener('pointerdown', cameraRuntime.onScenePointerDown); } catch (_) {}
      try { renderer.domElement.removeEventListener('pointerup', cameraRuntime.onScenePointerUp); } catch (_) {}
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
    if (cameraRuntime.flyMode()) cameraRuntime.flyLookSyncFromCamera('renderer rebuild', true);
    camera.lookAt(controls.target);
  }

  /** 渲染器就绪（startPlayback 编排调用；原 startPlayback 内联段，偏好失配语义原样）。 */
  function ensureRenderer() {
    if (!renderer) initScene();   // 渲染器惰性创建：此时画质档已定型（loader 选择/URL 参数）
    else if (rendererCaps && (rendererCaps.logdepth !== LOGDEPTH || rendererCaps.dynres !== DYNRES
      || rendererCaps.stencil !== contactShadowCtl.wantsStencil())) {
      // 复用渲染器（换文件 reset 保留）但待开播偏好已改：按失配项热修正——
      // logdepth 是上下文级参数 → 重建渲染器（initScene 换新上下文，dynres 同步重装）；
      // 仅 dynres 变化 → 热装/卸控制器即可（无需动上下文）。
      if (rendererCaps.logdepth !== LOGDEPTH || rendererCaps.stencil !== contactShadowCtl.wantsStencil()) {
        rebuildRenderer();   // 上下文级参数（logdepth / stencil）→ 重建渲染器
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
  function prepareSessionCamera() { cameraRuntime.prepareSessionCamera(); }
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
    setCam: (mode) => cameraRuntime.setCam(mode),
    clampCameraTarget,
    constrainFreeCameraAltitude: () => cameraRuntime.constrainFreeCameraAltitude(),
    loadMapImage: () => mapWorld.loadMapImage(),
    buildBases,
    buildSpawns,
    buildVehicles: () => vehicles.buildVehicles(),
    setupContactShadows: () => contactShadowCtl.setup(),
    applyGlbToggle: (on) => vehicles.applyGlbToggle(on),
    buildRoster: () => labels.buildRoster(),
    prepareResolvers,
    prewarmShaders,
    setPlaying,
    tick,
    writeHud,
    invalidate,
    loadRecorderCamera: (source, epoch) => cameraRuntime.loadRecorderCamera(source, epoch),
    transients: battle.transients,
    setClockRange: (start, end) => { START = start; END = end; },
    setTime: (t) => { T = t; },
    debug: DEBUG,
    exposeVehicles: () => { window.__pbV = vehicles.getVehicles(); },
    data: () => DATA,
    topViewOnLoad: () => cameraRuntime.topViewOnLoad(),
    cam: () => cameraRuntime.cam(),
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
    setFlySpeed: (n) => cameraRuntime.setFlySpeed(n),
    flyTick: (dt, pressed) => cameraRuntime.flyTick(dt, pressed),
    invalidate,
    seekFraction: (frac) => { if (DATA) seekTo(START + frac * (END - START)); },
    // 共用播放控件（PlaybackTransport）按绝对秒 seek / 跳秒；seekTo 自带 [START, END] 夹取（准备 / 倒计时阶段回不去）
    seekTime: (t) => { if (DATA) seekTo(t); },
    seekBy: (delta) => { if (DATA) seekTo(T + delta); },
    setBattleClock,
    setCam: (mode) => cameraRuntime.setCam(mode),
    // 移动端竖向距离滑条（实现 owner = cameraRuntime）
    cameraDistanceState: () => cameraRuntime.cameraDistanceState(),
    setCameraDistance: (v) => cameraRuntime.setCameraDistance(v),
    /** 触屏相机契约开关（usePlaybackPhoneForm 判定，watch 下发；状态 owner = cameraRuntime）。 */
    setMobileTouch: (enabled) => cameraRuntime.setMobileTouch(enabled),
    setFollow: (eid) => cameraRuntime.setFollow(eid),
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
        vehicles.syncContactShadow(v);   // 类型图标替换后阴影随显隐（#907 主干随迁）
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
        cameraRuntime.releaseArmorHighlightRenderTargets();
      } else if (cameraRuntime.cam() === 'recorder' && renderer) {
        cameraRuntime.prewarmArmorHighlight(camera);
      }
      invalidate();
    },
    setContactShadows: (on) => contactShadowCtl.setEnabled(on),
    setQuality,
    setPaused,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      destroyed = true;
      foliageClip.value = 0;
      cameraRuntime.flyLookApplyMode('follow');   // 恢复 controls 原生状态（实例随即销毁，防残 handedness）
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
      cameraRuntime.detachListeners();   // fly capture 监听（原 6 行 removeEventListener 收口）
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
        perfProbe.stopWatchdog();
        perf.reset();
        if (window.__pbPerf === perfProbe.perfHandle) delete window.__pbPerf;
      }
      if (renderer) {
        try { renderer.domElement.removeEventListener('pointerdown', cameraRuntime.onScenePointerDown); } catch (_) {}
        try { renderer.domElement.removeEventListener('pointerup', cameraRuntime.onScenePointerUp); } catch (_) {}
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
