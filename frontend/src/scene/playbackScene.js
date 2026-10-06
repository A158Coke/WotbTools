// 实时回放 three.js 场景内核：自上游 Agent 前端平移（会话生命周期修复版）。
// 渲染语义（位姿滤波/炮塔随动/弹道动画/分层地表/画质档/GLB 姿态）一行不改；
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
import { mapBases } from '../data/mapBases.js'
import { firstIndexAfter } from './seekPointer.js'
import { buildDestructibleIndex, foldDestructibleStates, fallStopAngle, treeFrame } from './destructibles.js'
import { sampleChannel, sampleKeyframes } from './trackInterp.js'
import { pathPointsOf, legSecsOf, legEndTimes, pointAt, legArcEnds, arcAtTime, pointAtArc } from './shotPath.js'
import { impactKind } from './impactKind.js'
import { ROSTER_GROUPS, applyRosterRuntime, buildRosterRows, hpPercentText, projectRoster } from './rosterState.js'
import { DMG_ASPECT, DMG_TEX_H, DMG_TEX_W, dmgWorldHeight, floatDmgAnim } from './floatDmg.js'
import { createReloadStateResolver, resolveMountedConfig } from './reloadBar.js'
import { pointsAt } from './supremacyPoints.js'
import { perspectiveScore, teamHpTotals } from './teamHpTotals.js'
// 战斗反馈时长：与 2D 共用同一组 canonical 常量（SSOT，避免两处各自漂移）
import { BURST_MS, FLASH_MS, FLOAT_DMG_MS, GHOST_MS } from '../utils/battlePlayback.js'
import { playableBounds } from '../data/playableBounds.js'
import { createLoadProgress } from './loadProgress.js'
import { advancePlaybackTime } from '../utils/playbackClock'
import { resolveReplayClock } from '../replay-local/canonical/facts'
import { isPlaybackSpeed } from '../composables/usePlaybackTransport.js'
import { poseFromYPR, neutralizeDefaultMetalness, dropDuplicateGunMasks } from './glbRig.js'
import { assetProvider } from './assetProvider.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const GRID_DT = 0.1

// 资产加载并发上限：全串行（9 张地表贴图 / 逐张 await）白等网络往返；无限并发
// （14 台坦克 GLB 同时 fetch + 主线程 parse）又会把主线程解析排满。取 4。
const ASSET_CONCURRENCY = 4

/** 有限并发映射（保持结果顺序）；用于资产下载/解析 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// 三档渲染预设（面板与场景共用；桌面默认高，Tauri/移动 WebView 默认低）。
// 抗锯齿/DPR/场景资源在渲染器与场景首次创建时一次性定型，加载后改档需整页刷新。
export const QUALITY_PRESETS = {
  low:  { label: '低', antialias: false, maxDpr: 1,   scenery: false, groundLayers: false, miniMap: true,  anisotropy: 1, terrainSeg: 192, allowGlb: false },
  mid:  { label: '中', antialias: false, maxDpr: 1.5, scenery: true,  groundLayers: false, miniMap: false, anisotropy: 4, terrainSeg: 256, allowGlb: true },
  high: { label: '高', antialias: true,  maxDpr: 2,   scenery: true,  groundLayers: true,  miniMap: false, anisotropy: 8, terrainSeg: 512, allowGlb: true },
}

/**
 * 飞行段时长（秒）= **真实飞行时长**（`shots[].flight_secs` = |终点−炮口|/弹速）。
 * 只做 1 帧下限：防退化数据（0/负数/非有限）造成零时长与除零；**不做"最小显示时长"**
 * —— 曾用 0.22s 下限"保证可见性"，实测 68% 的射击真飞行时长 <0.22s（J39 样本 155 发：
 * 中位 0.16s、p10 0.04s，弹速 560~1658 m/s），那些炮弹被拖慢最多 11×，与客户端不一致。
 */
export function tracerSpanSecs(flightSecs) {
  const oneFrame = 1 / 60
  return Number.isFinite(flightSecs) && flightSecs > oneFrame ? flightSecs : oneFrame
}

/** 线段经过的格子键（2D DDA；纯函数，单测锁定；用于标签遮挡的候选格选取） */
export function occlusionCells(ax, ay, bx, by, cell = 16) {
  const out = new Set();
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (cell / 2)));
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    out.add(`${Math.floor((ax + dx * k) / cell)},${Math.floor((ay + dy * k) / cell)}`);
  }
  return out;
}

/** 遮挡物足印覆盖的**全部**格子（AABB 全枚举；纯函数，单测锁定；occGrid 登记专用）。
 *  与 occlusionCells（线段 DDA 遍历，检测时选候选格）是两个概念，不可互用：登记若走
 *  线段遍历（从包围盒角到角），只有对角线经过的格子入表，大建筑/大网格的非对角线
 *  覆盖格子全部缺失——穿那些格子的相机→标签射线在候选表里查不到该遮挡物，标签
 *  隔楼可见（false-visible）。每轴格数钳制 64（16m 格 × 64 ≈ 1km，远超静态建筑
 *  尺度；防病态大包围球把登记表撑爆）。 */
export function occlusionFootprintCells(minX, minY, maxX, maxY, cell = 16) {
  let gx0 = Math.floor(minX / cell), gx1 = Math.floor(maxX / cell);
  let gy0 = Math.floor(minY / cell), gy1 = Math.floor(maxY / cell);
  const MAX_SPAN = 64;
  if (gx1 - gx0 >= MAX_SPAN) { const c = Math.floor((gx0 + gx1) / 2); gx0 = c - (MAX_SPAN >> 1); gx1 = gx0 + MAX_SPAN - 1; }
  if (gy1 - gy0 >= MAX_SPAN) { const c = Math.floor((gy0 + gy1) / 2); gy0 = c - (MAX_SPAN >> 1); gy1 = gy0 + MAX_SPAN - 1; }
  const out = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) out.push(`${gx},${gy}`);
  }
  return out;
}

export function initPlayback(container, store, labelOverlay = null, { onVehicleSelect } = {}) {
  // ---------- 全局状态 ----------
  let DATA = null;                 // PlaybackData（当前会话）
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
  let boundaryGroup = null;        // 地图边界带（会话拥有）
  let V = [];                      // 车辆运行时 {def, group, turretG, gunPivot, labelAnchor, meshHull, glb}
  let T = 0, PLAYING = false, SPEED = store.speed;
  // 战斗时间轴 [START, END]：引擎是唯一权威（store.startTime / store.duration 只是发布）。0 = 开战，与 2D 同一个时钟：
  // 工作台 canonical 的 clock（面板经 setBattleClock 交给引擎）优先，canonical 未就绪 / 失败时用场景按同一
  // resolveReplayClock 从自身 periods 推出的 sceneClock，都没有才退回数据范围（t_start → battleEnd.js）。
  // 播放 / seek（seekTo / seekBy / seekFraction）/ 自动停止 / 进度比例 / 胜负横幅全部以它为准。
  let START = 0, END = 0;
  let sceneClock = null, canonicalClock = null;
  let CAM = 'free', FOLLOW_EID = 0;
  let shotPtr = 0, killPtr = 0;
  const tracers = [], impacts = [];
  let renderer = null, scene, camera, controls, clock, raycaster;
  let labelScene = null;
  let sizeObserver = null;
  let glbCache = new Map(), glbOn = false;
  let mapPlane = null;
  let mapTexture = null, mapMetaInfo = null;          // 底图贴图 + 铺设参数
  // 分层地表（客户端 tilemask-fp.sl 实时合成）：{layers: 合成参数, texs: {cm,tile,mask,hmap}}。
  // 缺失（未导出/404）时回退整图烘焙底图
  let groundLayers = null;
  let terrainMesh = null, heightField = null, heightMeta = null;  // 3D 地形
  let mapScenery = null;                              // 静态场景 GLB（建筑等）
  // 可破坏地形（契约 additive：destructible_areas/events + map/destructibles.json）。
  // scenery = { states, appliedPtr, lastT, meshIdx }；Pivot 挂在 gltf.scene 内随
  // mapScenery 一起 dispose（会话生命周期同场景 GLB，无独立 teardown）。
  let destruct = null;
  let groundMesh = null, gridHelper = null;           // buildWorld 的占位地面/网格（会话拥有）
  let destroyed = false;
  let kfId = 0;
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
  // 对数深度逃生开关（?logdepth=0 关闭）：log depth 全局生效——每片元写 gl_FragDepth、
  // 禁 early-z，理论上有全场景片元开销。真机（尤其 Android）若出现可感性能回归，
  // URL 立即回滚不必等发版；同一开关即性能验收的 A/B 对照（同回放/同画质/同机位）。
  const LOGDEPTH = (() => { try { return new URLSearchParams(location.search).get('logdepth') !== '0'; } catch (e) { return true; } })();

  // ---------- 画质分档 ----------
  // 解析优先级：URL ?q= > localStorage > 设备默认；三档都开 3D 地形（仅分段数降档）。
  // （预设表用模块级 QUALITY_PRESETS，与面板共享）
  function resolveQuality() {
    const usp = new URLSearchParams(location.search);
    let q = (usp.get('q') || '').toLowerCase();
    if (!QUALITY_PRESETS[q]) { try { q = localStorage.getItem('pb_quality') || ''; } catch (e) {} }
    if (!QUALITY_PRESETS[q]) {
      const mobile = !!window.__TAURI__ || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
      q = mobile ? 'low' : 'high';
    }
    try { localStorage.setItem('pb_quality', q); } catch (e) {}
    return q;
  }
  let QKEY = resolveQuality(), Q = QUALITY_PRESETS[QKEY];
  store.qualityKey = QKEY;
  store.qualityLabel = '画质 · ' + Q.label;
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
  // 低档强制盒子代理（14 车 ×数 MB GLB 下载 + PBR 填充率是移动端主要瓶颈之一）
  function applyGlbGate() {
    store.glbAllowed = Q.allowGlb;
    if (!Q.allowGlb) {
      store.glbOn = false;
      if (glbOn) applyGlbToggle(false);
    }
  }

  // ---------- 工具 ----------
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function idxOf(t) { return Math.floor((t - DATA.meta.t_start) / GRID_DT); }

  // 位姿求值：**优先关键帧折线**（上游 `pose_kf` = 客户端 60Hz 渲染路径的折点序列，
  // 段内线性插值即复现客户端画面，含「保持-跳变」阶梯）。缺失 `pose_kf`（旧 facet）时
  // 回退 10Hz 网格线性插值——与历史行为逐值一致。
  // 为什么不能只靠网格：0.1s 网格与 ≈10~12Hz 位置更新不同相 → 阶梯被混叠成速度摆动
  // （实测某 0.5s 窗内线速度 4.5→29.6 m/s，同段真值稳定），观感即「一顿一顿」。
  // pos 的 x 分量在此处取镜像负号（游戏系 → 场景系）。
  const kfOf = (v) => {
    const k = v.def.pose_kf;
    return k && k.t && k.t.length >= 2 ? k : null;
  };
  function posAt(v, t, out) {
    const k = kfOf(v);
    if (k) {
      const col = (c) => (i) => k.pos[i * 3 + c];
      out.set(-sampleKeyframes(col(0), k.t, t),
               sampleKeyframes(col(1), k.t, t),
               sampleKeyframes(col(2), k.t, t));
      return out;
    }
    const p = v.def.pos, t0 = DATA.meta.t_start, n = DATA.meta.samples;
    const col = (c) => (i) => p[i * 3 + c];
    out.set(-sampleChannel(col(0), n, t, t0, GRID_DT),
             sampleChannel(col(1), n, t, t0, GRID_DT),
             sampleChannel(col(2), n, t, t0, GRID_DT));
    return out;
  }
  function yawAt(v, t) {
    const k = kfOf(v);
    if (k) return sampleKeyframes((i) => k.yaw[i], k.t, t);
    return arrAt(v.def.hull_yaw, t);
  }
  function hullPitchAt(v, t) {
    const k = kfOf(v);
    if (k) return sampleKeyframes((i) => k.pitch[i], k.t, t);
    return arrAt(v.def.hull_pitch, t);
  }
  function turretAbsAt(v, t) { return arrAt(v.def.turret_yaw, t); }
  function gunPitchAt(v, t) { return arrAt(v.def.gun_pitch, t); }
  function arrAt(arr, t) {
    if (!arr || !arr.length) return 0;
    return sampleChannel((i) => arr[i], arr.length, t, DATA.meta.t_start, GRID_DT);
  }
  // 车体侧倾（rad）。数据侧 hull_roll 取自**原始 type=10 volatile 采样**（滤波层不输出侧倾，
  // 与 hull_pitch 不同源）；旧产物无该列 → 0 = 水平（fail-safe，绝不拿 pitch 顶替）。
  // 符号约定：游戏系→场景系是「x 取负」的镜像，镜像下绕 z（偏航）与绕 y（横滚=车体前向轴）
  // 的角度取负、绕 x（俯仰）不变——这正是既有 `-yaw` 与 `+pitch` 的来源，故横滚取 `-roll`。
  // （若实机目视发现侧倾方向相反，只翻这一个符号，并同步更新此处注释与守卫测试。）
  const rollAt = (v, t) => (v.def.hull_roll && v.def.hull_roll.length ? arrAt(v.def.hull_roll, t) : 0);

  function hpAt(v, t) {
    const hp = v.def.hp; let cur = v.def.max_hp;
    for (const [ht, hv] of hp) { if (ht <= t) cur = hv; else break; }
    return cur;
  }
  function deathAt(v, t) { return v.def.death_t == null ? false : t >= v.def.death_t; }
  function visibleAt(v, t) {
    const c = v.def.coverage;
    for (let k = 0; k + 1 < c.length; k += 2) if (t >= c[k] && t <= c[k+1]) return true;
    return false;
  }
  // ---------- 场景 ----------
  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11161d);
    if (DEBUG) window.__scene = scene;   // 诊断钩子（仅显式 ?debug，destroy 时清除）
    // SPA 壳内渲染：视口尺寸取容器（main 区域），而非整窗（顶部导航占 67px）
    camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 4000);
    camera.position.set(0, 180, 220);
    // 对数深度：客户端（贴地 TPS）可视地面恒在 ~200m 内，线性深度足够；回放查看器
    // 允许 600–1000m 俯瞰——该距离线性 24bit 深度分辨率 4–12cm，与贴地装饰（铁轨
    // 路基/冰面等场景薄板，按游戏精确高程导出）同重建地形间 ±3–30cm 的交叠带同
    // 量级 → 远景俯视成片 z-fighting（碎色块、转动闪烁；拉近即消失）。对数深度把
    // 远距离分辨率提至亚毫米，交叠带恢复确定性深度序。两个自定义 ShaderMaterial
    // 需手动挂 logdepthbuf 代码块（内建材质自动注入）；?logdepth=0 可关闭（A/B 与
    // 真机回滚，见 LOGDEPTH 注释）。
    renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, logarithmicDepthBuffer: LOGDEPTH });
    // 着色器预热（`renderer.compile`）：three 在**首次渲染某材质**时才编译程序，编译会阻塞
    // 数十~数百 ms，落在"战斗第一次开火/命中"的那一帧就是用户实测的"打起来就卡"。
    // 场景就绪后立即编译在用材质（含地面分层着色器/FX 池），成本挪到加载阶段（那时本来在等资产）。
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.maxDpr));
    if (DEBUG) window.__renderer = renderer;   // 诊断钩子（renderer 创建后才可引用；仅 ?debug）
    if (DEBUG) window.__camera = camera;       // 诊断钩子：跟随相机定位（创建后引用）
    // three r165+ 恒为物理光照单位（Lambert 除以 π），旧强度会让建筑/车模暗到发黑；
    // 与装甲查看器一致：ACES 色调映射 + ×π 级别的光强
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    // 伤害飘字使用同一 renderer 的反馈层；车辆标签由宿主 HTML 覆盖层呈现。
    labelScene = new THREE.Scene();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;
    if (DEBUG) window.__controls = controls;   // 诊断钩子（controls 创建后才可引用）
    if (DEBUG) window.__setFollow = setFollow;   // 诊断钩子：跟随问题定位（函数声明提升）
    clock = new THREE.Clock();
    raycaster = new THREE.Raycaster();
    scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x2a2f36, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.0); sun.position.set(120, 260, 80); scene.add(sun);
    addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      sizeObserver = new ResizeObserver(onResize);
      sizeObserver.observe(container);
    }
    // 点选意图上报宿主；相机跟随由显式控件设置。
    // pointerup 用于「空处单击」判定（拖拽相机 ≠ 点击其它地方，见 onScenePointerUp）。
    renderer.domElement.addEventListener('pointerdown', onScenePointerDown);
    renderer.domElement.addEventListener('pointerup', onScenePointerUp);
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
    if (e.button !== 0) return;
    const r = container.getBoundingClientRect();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, camera);
    const hits = raycaster.intersectObjects(V.map(v => v.group), true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.eid) o = o.parent;
      emptyDownAt = null;
      if (o) onVehicleSelect?.(o.userData.eid, e);
    } else {
      emptyDownAt = { x: e.clientX, y: e.clientY };
    }
  }
  function onScenePointerUp(e) {
    if (e.button !== 0 || !emptyDownAt) return;
    const moved = Math.hypot(e.clientX - emptyDownAt.x, e.clientY - emptyDownAt.y);
    emptyDownAt = null;
    // eid = null：宿主语义「选中被清空/点击其它地方」→ 隐藏详情窗（保留选中高亮由宿主决定）
    if (moved <= SCENE_CLICK_SLOP_PX) onVehicleSelect?.(null, e);
  }

  // ---------- 地图边界带 ----------
  // 边界 = 游戏内实际战场范围（playableBoundsMeters），比真实地图 worldBounds(±300) 小。
  // 边界线是连续带（不是离散分段标注）：沿闭合矩形按 BOUNDARY_STEP 采样、逐顶点贴地，
  // 起伏地形上不被埋掉。与上游 Agent 同式（上游表按数字 map_id，本表按 mapCode）。
  const BOUNDARY_COLOR = 0xff2f2f;
  const BOUNDARY_THICK = 1.8;   // 带宽（米）
  const BOUNDARY_STEP = 2.0;    // 采样步长（米）：越小越贴合地形

  // 优先 terrain meta 的 playableBounds（打包器从场景 MapBorderComponent 提取，新地图自带）；
  // 否则回退 mapCode 表。两者皆缺 → null（不画，不用车辆范围猜）
  function playableBoundsFor() {
    const pb = (heightMeta && heightMeta.playableBounds) || playableBounds[currentMapKey];
    if (!pb) return null;
    const sxMin = -pb.xMax, sxMax = -pb.xMin;   // 场景为 x 镜像系
    return { cx: (sxMin + sxMax) / 2, cz: (pb.yMin + pb.yMax) / 2,
             hx: (sxMax - sxMin) / 2, hz: (pb.yMax - pb.yMin) / 2 };
  }

  function clearBoundary() {
    if (!boundaryGroup) return;
    const old = boundaryGroup.userData.sharedMaterial;
    if (old) old.dispose();
    scene.remove(boundaryGroup);
    disposeObject3D(boundaryGroup);
    boundaryGroup = null;
  }

  // 边界只认权威可玩范围（playableBounds）：**fail-closed**——拿不到就不画。
  // 车辆范围 / 地形 span / worldBounds 都不是「游戏内红色战场边界」的证据，
  // 不得作为兜底（历史实现曾用车辆 ext 与 terrain span 兜底，会凭空画出一条
  // 与玩法不符的边界）。
  function buildBoundary(bounds, thick) {
    clearBoundary();
    if (!bounds) return;
    const { cx, cz, hx, hz } = bounds;
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz;
    // 闭合路径（顺时针四条边，角点精确落在 (±hx, ±hz)）
    const path = [];
    const push = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / BOUNDARY_STEP));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        path.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    };
    push(x0, z0, x1, z0);   // 北
    push(x1, z0, x1, z1);   // 东
    push(x1, z1, x0, z1);   // 南
    push(x0, z1, x0, z0);   // 西
    const N = path.length;
    const pos = new Float32Array(N * 2 * 3);
    const idx = [];
    const half = thick / 2;
    for (let i = 0; i < N; i++) {
      const [px, pz] = path[i];
      const [nx2, nz2] = path[(i + 1) % N];
      const [ox, oz] = path[(i - 1 + N) % N];
      let tx = nx2 - ox, tz = nz2 - oz;               // 切线 → 水平面内左法线
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const lx = -tz, lz = tx;
      const y = groundY(px, pz) + 0.06;               // 贴地面（随地形起伏）
      pos[i * 6] = px + lx * half; pos[i * 6 + 1] = y; pos[i * 6 + 2] = pz + lz * half;
      pos[i * 6 + 3] = px - lx * half; pos[i * 6 + 4] = y; pos[i * 6 + 5] = pz - lz * half;
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      idx.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({
      color: BOUNDARY_COLOR, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // 防与地形 z-fighting
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    g.userData.sharedMaterial = mat;
    boundaryGroup = g;
    scene.add(g);
  }

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
    const lim = ext * 1.1;
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
    scene.add(ground);
    groundMesh = ground;
    const grid = new THREE.GridHelper(ext * 2 + 100, Math.floor((ext * 2 + 100) / 50), 0x3a4a5e, 0x273140);
    grid.position.set(cx, 0.02, cz); scene.add(grid);
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
  // terrain 端点返回 u16 LE 高度场（行 0=南，行主序）+ X-Terrain-Meta（size/zmax/span）；
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
  const sceneryMatCache = new Map();
  function cachedSceneryMat(key, factory) {
    let m = sceneryMatCache.get(key);
    if (!m) { m = factory(); sceneryMatCache.set(key, m); }
    return m;
  }
  // 叶卡 alpha 裁切阈值。客户端 AlphaBlend 软边缘 + 0.05 低阈值会让近透明像素仍写
  // 深度（叶片互相遮挡 → 破洞/闪烁）；提到 MASK 量级消除，并保留软边缘。
  const CARD_ALPHA_CUT = 0.33;
  // 场景 Lambert 材质的曝光修整（只作用于 convMat 建出的场景材质；代理车/GLB 车模不受影响）。
  // 这套光照是按坦克 GLB 调的，场景降级到 Lambert 后朝上面过曝；系数 <1 压回过曝而不动光照。
  const SCENERY_LAMBERT_EXPOSURE = 0.75;
  // 水体判定（GLB mesh/材质名启发式：seaplane/water/fountain/lake/river）
  const isWaterName = (n) => /water|sea|lake|river|fountain/i.test(n || '');

  function makeBillboardMaterial(m) {
    // GLB 的 material.extras 由 GLTFLoader 的 assignExtrasToUserData 用 Object.assign
    // 平铺进 userData（不是嵌在 userData.extras 下）——写成 userData.extras.occMean 会
    // 恒取到 undefined，退化成 0.8 固定值，使各材质"按自身贴图均值归一化遮挡"的标定失效。
    const occRaw = m.userData && Number(m.userData.occMean);
    const occMean = Number.isFinite(occRaw) && occRaw > 0 ? occRaw : 0.8;
    // 每实体的 SH(L0) 染色：导出器把它写进 baseColorFactor（松树 1.7725 / 灌木 0.669）。
    // 客户端是 albedo × 自身 SH(L0)——硬编码 1.77（正好等于松树取值）会让灌木亮 2.65×。
    const shTintRaw = m.color ? Number(m.color.r) : NaN;
    const shTint = Number.isFinite(shTintRaw) && shTintRaw > 0 ? shTintRaw : 1.77;
    // 客户端着色器为伽马空间直采直写：关闭 sRGB 纹理解码（自定义着色器无输出
    // 重编码，sRGB 采样得到的线性值直出会整体发黑）
    if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: m.map || null },
        uSH: { value: shTint },
        uOccMean: { value: occMean },
        uAlphaCut: { value: CARD_ALPHA_CUT },
      },
      vertexShader: `
        attribute vec4 _corner;
        attribute vec4 color;
        // <common> 必须先于 logdepthbuf_vertex（isPerspectiveMatrix 定义在 common 里）
        #include <common>
        varying vec2 vUv;
        varying float vOcc;
        #include <logdepthbuf_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 vp = (viewMatrix * wp).xyz;
          float ws = length(vec3(modelMatrix[0][0], modelMatrix[1][0], modelMatrix[2][0]));
          vp += _corner.xyz * ws;
          gl_Position = projectionMatrix * vec4(vp, 1.0);
          #include <logdepthbuf_vertex>
          vUv = uv;
          vOcc = color.r;
        }`,
      // 用 discard 裁切走不透明管线（transparent=false）：叶卡之间排序无关，
      // 消除互遮挡闪烁（此前 transparent=true + depthWrite=true 二者冲突），
      // 同时省掉透明通道的排序开销
      transparent: false,
      depthWrite: true,
      fragmentShader: `
        uniform sampler2D map;
        uniform float uSH;
        uniform float uOccMean;
        uniform float uAlphaCut;
        varying vec2 vUv;
        varying float vOcc;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec4 c = texture2D(map, vUv);
          if (c.a < uAlphaCut) discard;
          float occ = min(vOcc / max(uOccMean, 0.001), 1.25);
          gl_FragColor = vec4(c.rgb * min(occ * uSH, 1.35), c.a);
        }`,
      side: THREE.DoubleSide,
    });
  }

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
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; }
    if (mapScenery) { scene.remove(mapScenery); mapScenery = null; }
    destruct = null;
    mapTexture = null; mapMetaInfo = null; heightField = null; heightMeta = null;
    occlGrid = null;   // 标签遮挡候选格属于会话场景，随场景一起失效
    groundLayers = null;
    // 地面加载方式由画质档决定（低=小地图底图、中/高=分层地表），3D 地形有高度场即开启
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
    const mapUrlPlanned = (Q.miniMap ? mapStaticUrl('map-mini', undefined, resolvedKey) : null) ?? mapStaticUrl('map', undefined, resolvedKey);
    if (mapUrlPlanned) progress.expect('map');
    if (mapStaticUrl('terrain', undefined, resolvedKey)) progress.expect('terrain');
    if (Q.groundLayers && mapStaticUrl('groundmeta', undefined, resolvedKey)) progress.expect('ground');
    if (Q.scenery && mapStaticUrl('scenery', undefined, resolvedKey)) progress.expect('scenery');
    try {
      // 低档 mini：客户端小地图作地面（比高清底图小一个量级，保留 3D 起伏）。
      // client-only：仅资产平面静态路径；未配置基址/索引未命中 → 无底图（回退网格），
      // 不存在服务端回退
      const mapUrl = (Q.miniMap ? mapStaticUrl('map-mini', undefined, resolvedKey) : null) ?? mapStaticUrl('map', undefined, resolvedKey);
      if (mapUrl) {
        const resp = await assetProvider.fetch(mapUrl);
        if (stale()) return;
        if (resp.ok) {
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
    } catch (e) { console.warn('底图加载失败（回退网格）:', e); }
    if (stale()) return;
    progress.complete('map');
    try {
      // 3D 地形：仅资产平面静态路径 + terrain.json sidecar 尺度；无静态资产 → 保持 2D
      const terrainBin = mapStaticUrl('terrain', undefined, resolvedKey);
      let tmeta = {}; let tbuf = null;
      if (terrainBin) {
        const m = await assetProvider.fetch(mapStaticUrl('terrain-meta', undefined, resolvedKey));
        if (stale()) return;
        if (m.ok) {
          tmeta = await m.json();
          if (stale()) return;
          // span = 水平世界跨度（服务端 terrain_scale 同式 max(dx,dy)，map_assets.rs）。
          // 打包器 v0.1.7 sidecar 误写垂直高度差（zmax-zmin，malinovka=60）——按
          // sidecar 自带的 worldBounds 自愈，否则地形被压成 span×span 小块、
          // 高度采样坍缩（"地图未完全加载显示"的根因）
          const wb = tmeta.worldBounds;
          if (Array.isArray(wb?.min) && Array.isArray(wb?.max)) {
            const dx = wb.max[0] - wb.min[0];
            const dy = wb.max[1] - wb.min[1];
            if (dx > 0 || dy > 0) tmeta.span = Math.max(dx, dy);
          }
        }
        const b = await assetProvider.fetch(terrainBin);
        if (stale()) return;
        if (b.ok) {
          tbuf = await b.arrayBuffer();
          if (stale()) return;
        }
      }
      {
        const meta = tmeta;
        const n = meta.size || 512;
        const buf = tbuf;
        if (buf && buf.byteLength === n * n * 2) {
          const u16 = new Uint16Array(buf);
          heightMeta = meta;
          // 预转米制高度（行 0=南，行主序；zmin 缺省 0）
          heightField = new Float32Array(n * n);
          const zmin = meta.zmin || 0;
          const k = ((meta.zmax || 100) - zmin) / 65535;
          for (let i = 0; i < u16.length; i++) heightField[i] = u16[i] * k + zmin;
        }
      }
    } catch (e) { console.warn('地形加载失败（回退 2D）:', e); }
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
      if (!gmUrl) { /* 未配置资产面/未命中索引：跳过分层地表，回退烘焙底图/网格 */ }
      else {
      const mresp = await assetProvider.fetch(gmUrl);
      if (stale()) return;
      if (mresp.ok) {
        const L = await mresp.json();
        if (stale()) return;
        const need = L.height_blend
          ? ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1', 'hmap0', 'hmap1']
          : ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1'];
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
        if (ok) {
          const ani = Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy());
          for (const k of ['tile0', 'tile1', 'hmap0', 'hmap1']) if (texs[k]) {
            texs[k].wrapS = texs[k].wrapT = THREE.RepeatWrapping;
            texs[k].anisotropy = ani;
          }
          // colormap/mask 也开各向异性：掠射角（坦克视角）下不糊
          for (const k of ['cm', 'lm', 'mask0', 'mask1']) if (texs[k]) {
            texs[k].anisotropy = ani;
          }
          groundLayers = { layers: L, texs };
        } else {
          // 半途失效/缺失：已加载的分层纹理就地释放，不留悬挂 GPU 资源
          for (const k in texs) texs[k]?.dispose?.();
        }
      }
      }
    } catch (e) { console.warn('分层地表加载失败（回退烘焙底图）:', e); }
    if (stale()) return;
    progress.complete('ground');
    // 诊断钩子：window.__gdbg 查看地表实际走的路径与已加载分层（仅 ?debug）
    if (DEBUG) window.__gdbg = { layers: !!groundLayers, texs: groundLayers ? Object.keys(groundLayers.texs) : [],
                                 meta: !!mapMetaInfo, sizeM: mapMetaInfo?.size_m ?? null };
    rebuildGround();
    // 静态场景模型（建筑/桥/岩石，tools/export_map_glb.py 预生成；缺失静默跳过）。
    // GLB 为游戏系（z 上、+y 北），qFrame = Ry(π)·Rx(-π/2)（YXZ 序）转到回放场景系——
    // 与坦克 GLB 同一帧变换，纯旋转无镜像，绕序天然正确。
    // 中/低档跳过场景 GLB（单图 11–67MB 下载 + 大块显存，是画质档最大的分流项）
    if (Q.scenery) try {
      // 可破坏物清单（与场景 GLB 并行拉取；缺失/低档静默禁用该特性）
      // mapStaticUrl 返回完整 URL——assetProvider.json() 会再拼一次 base（逻辑路径专用），
      // 必须走透传的 fetch + resp.json()（与下方 terrain-meta 同款用法）
      const destructUrl = mapStaticUrl('destructibles', undefined, resolvedKey);
      const destructDocPromise = destructUrl
        ? assetProvider.fetch(destructUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null);
      if (DEBUG) destructDocPromise.then((d) => { window.__destructStage = d ? 'doc-ok' : 'doc-missing'; });
      const sceneryUrl = mapStaticUrl('scenery', undefined, resolvedKey);
      if (!sceneryUrl) { /* 未配置资产面/未命中索引：跳过场景 GLB（无服务端回退） */ }
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
      if (gltf && gltf.scene) {
        // GLTFLoader 默认 MeshStandardMaterial（PBR）比场景 Lambert 光照吃光得多，
        // 建筑会渲染成近黑——统一降级为 Lambert 并保留贴图/透明/平直着色。
        // 几何含 _CORNER 属性的叶卡走 billboard 材质（见 makeBillboardMaterial）
        const convMat = (m, isCard) => cachedSceneryMat(
          // alphaTest/transparent 必须进键：GLTFLoader 不暴露 alphaMode，同 name+map
          // 的 MASK 与 OPAQUE 材质只靠这两项区分，漏掉会串用（先建的赢）
          // （`m.alphaMode` 当前恒为 undefined，保留仅作将来 GLTFLoader 补上时的保护）
          // 染色值取原始分量而非 getHexString：后者会把 >1 的 SH(L0) 钳到 ffffff，
          // 于是"同一张贴图、不同 SH 染色"的材质在键上无法区分（叶卡 uSH 就取它）。
          [isCard ? 'C' : 'M', m.name || '', m.map ? m.map.uuid : '',
           m.color ? [m.color.r, m.color.g, m.color.b].map((v) => v.toFixed(4)).join(',') : '',
           m.alphaMode || '', m.alphaTest ?? 0, !!m.transparent, m.opacity ?? 1,
           (m.userData && m.userData.occMean) || ''].join('|'),
          () => (isCard ? makeBillboardMaterial(m) : (() => {
          // ST|（SpeedTree 树/灌木）：客户端 speedtree-materials-fp = albedo × SH，
          // 无场景光照——用不受光材质（染色值经 baseColorFactor→color 传入）
          // 客户端 SpeedTree = AlphaTest+AlphaBlend 双通道。但导出材质多为
          // 【不透明度=1 的伪透明】（transparent 却 opacity 1）：这类走混合通道会进
          // 透明渲染队列，大量重叠植被面按深度排序不稳定 → 成片闪烁。按不透明度分流：
          //   不透明度≈1 → 不透明管线 + 裁切（排序无关，消除闪烁且更快）
          //   真透明      → 混合 + 不写深度（减少互遮挡）
          const opaqueEnough = (m.opacity ?? 1) >= 0.99;
          if ((m.name || '').startsWith('ST|')) {
            const bm = new THREE.MeshBasicMaterial({
              map: m.map || null,
              color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
              transparent: !opaqueEnough,
              opacity: m.opacity ?? 1,
              side: THREE.DoubleSide,
              depthWrite: opaqueEnough ? true : false,
            });
            bm.alphaTest = opaqueEnough ? 0.33 : 0.05;   // 不透明：按 MASK 量级裁切
            bm.toneMapped = false;
            return bm;
          }
          // 伪透明（BLEND 但不透明度≈1）一律转不透明 + 裁切，消除透明排序闪烁；
          // 真透明保持混合但不写深度（避免互遮挡抖动）
          const pseudoOpaque = !!m.transparent && (m.opacity ?? 1) >= 0.99;
          const nm = new THREE.MeshLambertMaterial({
            map: m.map || null,
            // 曝光修整：这套光照是按坦克 GLB 调的，场景降级到 Lambert 后朝上面过曝
            // （岩石贴图 87.5/255 却渲染到 137/255、27% 像素近白）。只作用于本函数
            // 建出的场景材质，代理车/GLB 车模不受影响。
            color: (m.color ? m.color.clone() : new THREE.Color(0xffffff))
              .multiplyScalar(SCENERY_LAMBERT_EXPOSURE),
            transparent: !!m.transparent && !pseudoOpaque,
            opacity: m.opacity ?? 1,
            side: THREE.DoubleSide,
          });
          // 镂空材质必须继承 GLTFLoader 解析好的 alphaTest。GLTFLoader 不把 glTF 的
          // alphaMode 挂到材质上——MASK 只体现为 alphaTest（alphaCutoff ?? 0.5），
          // BLEND 只体现为 transparent。旧判据 `m.alphaMode === 'MASK'` 恒为 false
          // （该属性不存在），重建材质又只拷了 map/color/opacity/side，于是 MASK 的
          // 裁切被整个丢掉：铁丝网（wirebarricade）/藤蔓（ivy）/蕨/标牌这类镂空贴图
          // 按整片方片照绘，背景没被剔除——那些贴图的背景恰是纯黑（实测 ivy 背景区
          // 亮度 0.0），看上去就是一张实心黑片。
          if (m.alphaTest > 0) nm.alphaTest = m.alphaTest;
          if (pseudoOpaque) nm.alphaTest = Math.max(nm.alphaTest || 0, 0.33);
          if (nm.transparent) nm.depthWrite = false;
          nm.flatShading = true;
          return nm;
        })()));
        // 退化几何隔离（防护）：旧版导出器把树的三角列表误判为 strip 解析，
        // 产生横跨整个模型的长条三角形（撕裂）并使面数虚高（实测 20–29 面/顶点，
        // 修正后同批树为 7–10）。阈值 15 恰好区分：已重导出的地图保留树，
        // 未重导出地图的撕裂批次整批移除（不渲染/不占 draw call/回收显存）。
        // 允许 ?degrade=N 覆盖（调试用）。
        const degradedMeshes = [];
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const g0 = o.geometry;
          const vc = g0.attributes.position ? g0.attributes.position.count : 0;
          const ic = g0.index ? g0.index.count : vc;
          const degLimit = (() => {
            const q = Number(new URLSearchParams(location.search).get('degrade'));
            return Number.isFinite(q) && q > 0 ? q : 15;
          })();
          if (vc > 0 && (ic / 3) / vc > degLimit) degradedMeshes.push(o);
        });
        for (const o of degradedMeshes) {
          o.removeFromParent();
          o.geometry.dispose();   // 每 mesh 独立几何；材质为共享（缓存）不在此释放
        }
        if (DEBUG) window.__degradedSkipped = degradedMeshes.length;
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          // GLTFLoader 会把自定义属性名转小写：GLB 里的 _CORNER → geometry._corner
          const isCard = !!o.geometry.attributes._corner;
          o.material = Array.isArray(o.material) ? o.material.map((m) => convMat(m, isCard))
                                                 : convMat(o.material, isCard);
          // 水体（海平面等半透明大面）：透明 + depthWrite=true + DoubleSide 会与
          // 地形/自身共面产生 z-fighting 与透明互遮挡闪烁。实测（erlenberg）：水面为
          // 恒定高度的水平面，与地形高度差 −6.9~+7.7m、无一采样点接近 0 → 并非与地形
          // 共面；其几何极简（少数大三角形），depthWrite=false 时大三角形上的深度插值
          // 精度不足，与 512² 地形逐像素比较会在大面积上帧间交替 → 闪。该面是无厚度
          // 水平面（双面同深度、不自我遮挡）且为全场唯一透明物 → 让其正常写深度最稳。
          if (isWaterName(o.name)) {
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            for (const mm of ms) {
              if (!mm || !mm.transparent) continue;
              mm.depthWrite = true;
              mm.side = THREE.DoubleSide;
              mm.depthTest = true;
              mm.needsUpdate = true;
            }
            // 不设 renderOrder：交给 THREE 在透明队列内按摄像机距离排序
            //（此前设 -1 让水面最先绘制，与其余半透明层遮挡关系错乱，接近时抖）
          }
          if (isCard) {
            // 包围球按锚点计算，角点向外超出——扩 2m 防视锥剔除边缘闪没
            if (o.geometry.boundingSphere) o.geometry.boundingSphere.radius += 2;
          }
        });
        mapScenery = new THREE.Group();
        mapScenery.rotation.order = 'YXZ';
        mapScenery.rotation.set(-Math.PI / 2, Math.PI, 0);
        mapScenery.add(gltf.scene);
        scene.add(mapScenery);

        // 天空盒（SkyFlattenSphere 天穹）不显示；草地已整体移除（GLB 无草地网格）
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          if (/sky/i.test(o.name || '')) o.visible = false;
        });

        // ---- 可破坏地形：mesh 空间索引 + 损毁态网格初始隐藏 ----
        // 网格位置 = gltf.scene 局部系（z 上）= destructibles.json 的 pos（游戏场景系，
        // 直接对应回放 x/z）。D_ 前缀 = 损毁态替换网格。
        // 匹配半径 **2cm**（导出器把同一实例的全部批次放在同一坐标上：实测 99.8% 实例
        // 的完好网格在 1cm 内、成对 D_ 网格在 5mm 内）——早期用 1.5m 半径会把**邻近实例**
        // 的网格一起卷进来（malinovka 579 棵树里 22 棵会拖走邻居几何：一棵树倒，旁边草丛
        // 跟着转）。半径收紧后邻居不再误配；无对应网格 = 该物体不在 GLB（不渲染）。
        const MESH_MATCH_R = 0.02;
        const meshGrid = new Map();
        const gridKey = (x, y) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
        // 标签遮挡候选格（16m，见 occlusionCells 注释）：登记**可见**静态网格——按包围球
        // 半径铺进它覆盖到的所有格子（大建筑跨多格），避免"整个场景 raycast"的卡死。
        const occGrid = new Map();
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.name) return;
          if (o.name.startsWith('D_')) { o.visible = false; }
          let wx = 0, wy = 0, n = o;
          // 展平到 gltf.scene：本导出器为扁平结构（节点直挂根），累积父链防御嵌套
          while (n && n !== gltf.scene) { wx += n.position.x; wy += n.position.y; n = n.parent; }
          const k = gridKey(wx, wy);
          (meshGrid.get(k) || meshGrid.set(k, []).get(k)).push({ mesh: o, x: wx, y: wy });
          if (o.visible && !/sky/i.test(o.name)) {
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            const r = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0;
            // 登记 = 足印 AABB 全枚举（occlusionFootprintCells）。不能用 occlusionCells
            // （线段遍历）登记：那只会把包围盒对角线经过的格子入表，大建筑非对角线
            // 覆盖格子缺失 → 穿那些格子的射线漏判遮挡（标签隔楼可见）。
            const c = occlusionFootprintCells(wx - r, wy - r, wx + r, wy + r, OCCL_CELL);
            for (const key of c) {
              const list = occGrid.get(key);
              if (list) { if (!list.includes(o)) list.push(o); }
              else occGrid.set(key, [o]);
            }
          }
        });
        occlGrid = occGrid;   // 遮挡检测的候选表（旧会话的由 teardown 置 null）
        const findMeshes = (px, py, wantDestroyed, r = MESH_MATCH_R) => {
          const out = [];
          const gx = Math.round(px / 2), gy = Math.round(py / 2);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const e of meshGrid.get(`${gx + dx},${gy + dy}`) || []) {
              const destroyedMesh = (e.mesh.name || '').startsWith('D_');
              if (destroyedMesh === wantDestroyed && Math.hypot(e.x - px, e.y - py) <= r) out.push(e);
            }
          }
          return out;
        };
        const destructDoc = await destructDocPromise;
        if (DEBUG) window.__destructStage = destructDoc
          ? (Array.isArray(DATA.destructible_events) ? `events-${DATA.destructible_events.length}` : 'no-events-old-wasm')
          : 'doc-missing';
        if (!stale() && destructDoc && Array.isArray(DATA.destructible_events)) {
          const areasByEid = new Map((DATA.destructible_areas || []).map((a) => [a.eid, a]));
          const index = buildDestructibleIndex(destructDoc);
          const states = foldDestructibleStates(DATA.destructible_events, areasByEid, index);
          // 预挂树倒 pivot（挂 gltf.scene 内，局部 z 上；树顶运动学见 destructibles.js）。
          // mesh 自身保留 placement 旋转/贴地 z；倒伏 = pivot 上的世界轴旋转（后乘），
          // pivot.z 取首网格根部高度，其余网格按各自 z 差挂入。
          const worldZ = (m) => { let z = m.position.z, n = m.parent; while (n && n !== gltf.scene) { z += n.position.z; n = n.parent; } return z; };
          for (const st of states) {
            const [px, py] = st.inst.pos;
            if (st.prop === 3) {
              const hits = findMeshes(px, py, false);
              if (!hits.length) continue;
              const pivot = new THREE.Group();
              pivot.position.set(px, py, worldZ(hits[0].mesh));
              // 树高 = 各网格几何在 pivot 局部系（z 上）的上界 + 网格自身 z 偏移（= 0，
              // 同实例批次同锚点）——倒伏时长 T ∝ √(L/g) 用它（见 destructibles.js）。
              let heightM = 0;
              for (const h of hits) {
                const wz = worldZ(h.mesh);
                h.mesh.position.set(h.x - px, h.y - py, wz - pivot.position.z);
                pivot.add(h.mesh);
                const geo = h.mesh.geometry;
                if (!geo) continue;
                if (!geo.boundingBox) geo.computeBoundingBox();
                const bb = geo.boundingBox;
                if (bb) heightM = Math.max(heightM, (bb.max.z ?? 0) + h.mesh.position.z);
              }
              gltf.scene.add(pivot);
              st.pivot = pivot;
              st.heightM = heightM;
              // 停止角 = 树干沿倒向**触地**的角度（客户端"停在地形上"，因而随位置/倒向变化）。
              // 高度场在**世界系**（见 rebuildGround 注释：世界 x = −场景局部 x），而 pivot 在
              // gltf.scene 局部系（z 上）→ 采样用 (lx, ly) → (世界 −lx, 世界 lz=ly)。
              // 无高度场（2D 资源平面）→ sampleHeight 恒 0，此时按平坦地面（90°）。
              st.stopRad = heightField
                ? fallStopAngle(st.fallDir, { x: px, y: py, z: pivot.position.z }, heightM,
                    (lx, ly) => sampleHeight(-lx, ly))
                : Math.PI / 2;
            } else {
              st.intactMeshes = findMeshes(px, py, false).map((e) => e.mesh);
              st.deadMeshes = findMeshes(px, py, true).map((e) => e.mesh);
            }
          }
          destruct = { states, ptr: 0, lastT: -1, animating: false };
          if (DEBUG) window.__destructStage = `ready states=${destruct.states.length}`;
          if (DEBUG) window.__destructDebug = () => ({
            events: (DATA.destructible_events || []).length,
            states: destruct.states.length,
            pivots: destruct.states.filter((st) => st.pivot).length,
            swaps: destruct.states.filter((st) => st.intactMeshes).length,
            ptr: destruct.ptr,
          });
        }
      }
      }
    } catch (e) { console.warn('场景模型加载失败（忽略）:', e); }
    if (stale()) return;
    progress.complete('scenery');
  }

  // 双线性采样世界 (x,z) 处高度（米）；无高度场返回 0
  function sampleHeight(x, z) {
    if (!heightField) return 0;
    const n = heightMeta.size, span = heightMeta.span || 600;
    const fx = (x / span + 0.5) * (n - 1), fy = (z / span + 0.5) * (n - 1);
    const x0 = Math.max(0, Math.min(n - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(n - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const at = (r, c) => heightField[r * n + c];
    const top = at(y0, x0) * (1 - tx) + at(y0, x0 + 1) * tx;
    const bot = at(y0 + 1, x0) * (1 - tx) + at(y0 + 1, x0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  }

  // 依据 mapTexture/heightField 重建地面（2D 平面或 3D 地形二选一）
  // 客户端 Landscape/tilemask-fp.sl 非 PBR 路径的实时合成材质（离线着色器解码
  // 逐分支核对）：GLOBAL_TINT（globalFlatColor×2 + lightmap 通道 brightness/
  // contrast/gamma 调整）、SCALED_TILES（每通道各自 tileScale）、HEIGHT_BLEND
  // （tilemaskWeight×(mask×2−1) + hMap×scale + offset，softness 归一加权）。
  // UV 在片元由世界坐标反推（colormap 原始空间，分层贴图行序未翻转：
  // u = 0.5−X/s、v = 0.5−Z/s）；tile/height 用 Repeat 平铺原生分辨率采样，
  // 清晰度等同客户端。伽马空间直出（客户端着色器同为 sRGB 纹理直采直写）。
  function groundShaderMaterial(L, texs, size, cx, cz) {
    return new THREE.ShaderMaterial({
      defines: {
        GLOBAL_TINT: !!L.flatcolor,
        SEPARATE_LM: !!L.separate_lm,
        SCALED_TILES: !!L.scaled_tiles,
        HEIGHT_BLEND: !!L.height_blend,
      },
      uniforms: {
        uCM: { value: texs.cm }, uLM: { value: texs.lm },
        uTile0: { value: texs.tile0 }, uTile1: { value: texs.tile1 },
        uMask0: { value: texs.mask0 }, uMask1: { value: texs.mask1 },
        uHMap0: { value: texs.hmap0 || texs.tile0 },
        uHMap1: { value: texs.hmap1 || texs.tile1 },
        uSize: { value: size }, uCenter: { value: new THREE.Vector2(cx, cz) },
        uTiling: { value: new THREE.Vector2(L.tiling[0], L.tiling[1]) },
        uTileScale: { value: new THREE.Vector4(L.tile_scale[0], L.tile_scale[1],
                                               L.tile_scale[2], L.tile_scale[3]) },
        uTC: { value: L.tile_colors.map((c) => new THREE.Vector3(c[0], c[1], c[2])) },
        uFlatColor: { value: new THREE.Vector3(L.flat_color[0], L.flat_color[1], L.flat_color[2]) },
        uLmAdjust: { value: new THREE.Vector3(L.lm_adjust[0], L.lm_adjust[1], L.lm_adjust[2]) },
        uTmWeight: { value: L.tilemask_weight },
        uHbScale: { value: new THREE.Vector4(L.hb_scale[0], L.hb_scale[1],
                                             L.hb_scale[2], L.hb_scale[3]) },
        uHbOffset: { value: new THREE.Vector4(L.hb_offset[0], L.hb_offset[1],
                                              L.hb_offset[2], L.hb_offset[3]) },
        uHbSoft: { value: new THREE.Vector4(L.hb_softness[0], L.hb_softness[1],
                                            L.hb_softness[2], L.hb_softness[3]) },
      },
      vertexShader: `
        // <common> 必须先于 logdepthbuf_vertex：后者调用的 isPerspectiveMatrix 定义
        // 在 common 里，漏 include 会让整个材质 GLSL 编译失败（地形/叶卡整片消失）
        #include <common>
        varying vec2 vXZ;
        #include <logdepthbuf_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uCM;
        uniform sampler2D uLM;
        uniform sampler2D uTile0;
        uniform sampler2D uTile1;
        uniform sampler2D uMask0;
        uniform sampler2D uMask1;
        uniform sampler2D uHMap0;
        uniform sampler2D uHMap1;
        uniform float uSize;
        uniform vec2 uCenter;
        uniform vec2 uTiling;
        uniform vec4 uTileScale;
        uniform vec3 uTC[4];
        uniform vec3 uFlatColor;
        uniform vec3 uLmAdjust;
        uniform float uTmWeight;
        uniform vec4 uHbScale;
        uniform vec4 uHbOffset;
        uniform vec4 uHbSoft;
        varying vec2 vXZ;
        #include <logdepthbuf_pars_fragment>

        void main() {
          #include <logdepthbuf_fragment>
          vec2 tc = vec2(0.5 - (vXZ.x - uCenter.x) / uSize,
                         0.5 - (vXZ.y - uCenter.y) / uSize);
          vec3 colorAlbedo = texture2D(uCM, tc).rgb;
          float lmA = texture2D(uLM, tc).r;
          #ifdef GLOBAL_TINT
          colorAlbedo *= uFlatColor * 2.0;
          #ifdef SEPARATE_LM
          lmA = pow(lmA, uLmAdjust.b);
          lmA = (lmA - 0.5) * uLmAdjust.g + 0.5;
          lmA += uLmAdjust.r;
          #endif
          #endif
          #ifdef SEPARATE_LM
          vec3 shadowColor = colorAlbedo * lmA;
          #else
          vec3 shadowColor = colorAlbedo;
          #endif

          vec4 mask = vec4(texture2D(uMask0, tc).rgb, texture2D(uMask1, tc).r);
          vec2 tuv = tc * uTiling;
          #ifdef SCALED_TILES
          vec4 tileColor = vec4(
            texture2D(uTile0, tuv * uTileScale.x).r,
            texture2D(uTile0, tuv * uTileScale.y).g,
            texture2D(uTile0, tuv * uTileScale.z).b,
            texture2D(uTile1, tuv * uTileScale.w).r);
          #else
          vec4 tileColor = vec4(texture2D(uTile0, tuv).rgb, texture2D(uTile1, tuv).r);
          #endif

          #ifdef HEIGHT_BLEND
          #ifdef SCALED_TILES
          vec4 hMap = vec4(
            texture2D(uHMap0, tuv * uTileScale.x).r,
            texture2D(uHMap0, tuv * uTileScale.y).g,
            texture2D(uHMap0, tuv * uTileScale.z).b,
            texture2D(uHMap1, tuv * uTileScale.w).r);
          #else
          vec4 hMap = vec4(texture2D(uHMap0, tuv).rgb, texture2D(uHMap1, tuv).r);
          #endif
          vec4 mask2 = clamp(uTmWeight * (mask * 2.0 - 1.0)
                             + hMap * uHbScale + uHbOffset, 0.0, 1.0);
          float mx = max(max(mask2.x, mask2.y), max(mask2.z, mask2.w));
          vec4 hb = max(mask2 - (vec4(mx) - uHbSoft), vec4(0.001));
          vec3 detail = (tileColor.r * uTC[0] * hb.x + tileColor.g * uTC[1] * hb.y +
                         tileColor.b * uTC[2] * hb.z + tileColor.a * uTC[3] * hb.w) /
                        (hb.x + hb.y + hb.z + hb.w);
          #else
          vec3 detail = tileColor.r * mask.r * uTC[0] + tileColor.g * mask.g * uTC[1] +
                        tileColor.b * mask.b * uTC[2] + tileColor.a * mask.a * uTC[3];
          #endif

          gl_FragColor = vec4(detail * shadowColor * 2.0, 1.0);
        }`,
    });
  }

  function rebuildGround() {
    if (mapPlane) { scene.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; }
    if (!mapTexture && !heightField) return;
    const meta = mapMetaInfo || {};
    const size = meta.size_m || heightMeta?.span || 600;
    if (heightField) {
      // 3D 地形：高度场为场景系（列 0 = 场景 x −300，即已含游戏 x 取负），行 0 = z −300。
      // 平面经 rotation(-π/2,0,π) 放置后：世界 x = −局部x（场景镜像系）、世界 z = 局部y、
      // 高度沿局部 +z。车辆/建筑全部位于场景系 → 采样必须用**世界 x（= −局部x）**。
      // 若误用局部 x（少取一次负），地形东西镜像，坦克会陷入地内或悬空。
      // 地形网格按画质档分段（低 192 / 中 256 / 高 512）：顶点仍走双线性高度采样，
      // 降段只影响地形轮廓精度，不破坏 (x,z)→高度映射
      const geo = new THREE.PlaneGeometry(size, size, Q.terrainSeg, Q.terrainSeg);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        pos.setZ(k, sampleHeight(-pos.getX(k), pos.getY(k)));
      }
      geo.computeVertexNormals();
      // 分层地表（客户端 tilemask-fp.sl 实时合成，tile 原生分辨率平铺）优先；
      // 缺失时回退整图烘焙贴图（已含烘焙光照，不受光材质避免二次压暗；
      // toneMapped=false 保持烘焙色彩逐像素对齐客户端）
      let mat;
      if (groundLayers) {
        mat = groundShaderMaterial(groundLayers.layers, groundLayers.texs,
          size, meta.x || 0, meta.z || 0);
      } else {
        mat = new THREE.MeshBasicMaterial({ map: mapTexture });
        mat.toneMapped = false;
      }
      terrainMesh = new THREE.Mesh(geo, mat);
      terrainMesh.rotation.set(-Math.PI / 2, 0, Math.PI);
      terrainMesh.position.set(meta.x || 0, 0, meta.z || 0);
      scene.add(terrainMesh);
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

  // ---------- 基地（争霸 A–D / 单基地）：贴地标记 ----------
  // 几何来自 mapBases[key]（客户端 .sc2 提取，世界坐标；scene x = −游戏 x 镜像）；
  // 状态口径与 2D 地图、顶部基地状态条共用 utils/baseStatus.js（seek 折叠：clock ≤ t 的最后一条）。
  // 地上只画两样，全部贴着地形：
  //   · 圆环：当前归属色（友绿 / 敌红 / 中立白）；
  //   · 圆盘：淡归属底色 + 按占领进度从下往上"灌水"（占领方颜色）+ 圆心字母（单基地为旗帜）。
  // 圆盘贴图随相机水平朝向转正——平躺在地上，但从任何方向看字都是正的。空中不再有 HUD。
  // 颜色取自设计语言阵营 token（design-language §3.3：2D、3D 共用），读不到时用同值兜底。
  const BASE_TEX = 256;
  const BASE_COLOR_FALLBACK = { friendly: '#5cc280', enemy: '#f2786d', neutral: '#f5f5f5', objective: '#ffc24b', onNeutral: '#1c1f1d' };
  let baseObjects = [];   // { baseId, kind, gx, gz, r, ring, disc, canvas, ctx, tex, stateKey, uvDir, ringHex }
  let baseColors = BASE_COLOR_FALLBACK;
  let supremacyBaseIds = [];   // 本场出现过的争霸基地（轨迹 ∪ 几何），状态条按它列出
  let lastBaseViewsKey = '';

  function readBaseColors() {
    if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return BASE_COLOR_FALLBACK;
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    return {
      friendly: read('--color-team-ally', BASE_COLOR_FALLBACK.friendly),
      enemy: read('--color-team-enemy', BASE_COLOR_FALLBACK.enemy),
      neutral: read('--color-team-neutral', BASE_COLOR_FALLBACK.neutral),
      objective: read('--color-objective', BASE_COLOR_FALLBACK.objective),
      onNeutral: read('--color-on-team-neutral', BASE_COLOR_FALLBACK.onNeutral),
    };
  }

  // ---------- 单基地目标（Assault / Encounter）----------
  // 几何来自 mapBases[key].assault（客户端 .sc2 提取，世界坐标；scene x = −游戏 x 镜像），
  // 状态来自 Agent 契约 v2 的 assault_objective_present / assault_bases（wrapper8/root8）。
  //
  // 语义红线（docs/research/replay/assault-base-state.md）：单基地的 owner/capturing 恒为
  // null，静态 scene 的 `team` 字段语义 UNKNOWN——一律不据此上色/推断归属；环与 HUD 用中性
  // 色，进度条用呈现强调色（仅表示"有占领进度"，不代表阵营）。半径不做车辆距离推算。
  //
  // 目标存在性判据：assault_objective_present 优先（上游 v0.3.11 = **目标族存在性**：
  // wrapper8 目标族 field2==1 且 field1∈{1,2} 出现即 true，不要求进度字段），旧产物
  // 回退"有进度广播"。存在性只是前提——真正落地的标记还要求该地图 verified semantics
  // 给出**唯一**单基地 controlpoint（多 candidate fail-closed，见 buildBases）。
  const ASSAULT_RADIUS_FALLBACK = 20;      // 客户端 scene 常不声明 radius：20m 仅呈现兜底
  const ASSAULT_PROGRESS_COLOR = 0xffc24b; // 呈现强调色（非阵营语义）
  function assaultHasObjective() {
    if (DATA.assault_objective_present === true) return true;
    if (DATA.assault_objective_present === undefined) {
      return !!(DATA.assault_bases && DATA.assault_bases.length);
    }
    return false;
  }

  function clearBases() {
    for (const b of baseObjects) {
      scene.remove(b.ring); b.ring.geometry.dispose(); b.ring.material.dispose();
      scene.remove(b.disc); b.disc.geometry.dispose(); b.disc.material.dispose(); b.tex.dispose();
    }
    baseObjects = [];
    supremacyBaseIds = [];
    lastBaseViewsKey = '';
    store.baseViews = [];
  }

  function addBaseMarker(baseId, kind, gx, gz, r) {
    const ring = new THREE.Mesh(
      makeGroundedRing(gx, gz, r),
      new THREE.MeshBasicMaterial({ color: baseColors.neutral, side: THREE.DoubleSide,
                                    transparent: true, opacity: 0.9, depthWrite: false,
                                    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    scene.add(ring);
    const canvas = document.createElement('canvas'); canvas.width = BASE_TEX; canvas.height = BASE_TEX;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const disc = new THREE.Mesh(
      makeGroundedDisc(gx, gz, r * 0.9),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, depthWrite: false,
                                    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    scene.add(disc);
    const b = { baseId, kind, gx, gz, r, ring, disc, canvas, ctx: canvas.getContext('2d'), tex,
                stateKey: undefined, uvDir: null, ringHex: null,
                // 地形异步就绪后：按新高度场重建贴地环带与圆盘
                reground: () => {
                  ring.geometry.dispose(); ring.geometry = makeGroundedRing(gx, gz, r);
                  disc.geometry.dispose(); disc.geometry = makeGroundedDisc(gx, gz, r * 0.9);
                  b.uvDir = null;
                } };
    baseObjects.push(b);
  }

  function buildBases() {
    clearBases();
    baseColors = readBaseColors();
    const tracks = DATA.supremacy_bases || [];
    if (tracks.length) {
      // 非争霸场次不画（不靠静态几何猜模式）；无几何的地图不猜坐标，但状态条照样列出
      const seen = new Set(tracks.map((tr) => SUPREMACY_BASE_IDS[tr.base_id]).filter(Boolean));
      const pts = (currentMapBases && currentMapBases.supremacy) || [];
      for (const p of pts) {
        if (!SUPREMACY_BASE_IDS.includes(p.baseId)) continue;
        seen.add(p.baseId);
        addBaseMarker(p.baseId, 'supremacy', -p.x, p.y, p.radius || 15);
      }
      supremacyBaseIds = SUPREMACY_BASE_IDS.filter((id) => seen.has(id));
    }
    if (assaultHasObjective()) {
      const pts = (currentMapBases && currentMapBases.assault) || [];
      // 多 candidate 无证据 fail-closed（与 2D basesAt 同式）：几何不唯一就不画地面标记
      if (pts.length === 1) addBaseMarker(ASSAULT_BASE_ID, 'assault', -pts[0].x, pts[0].y, pts[0].radius || ASSAULT_RADIUS_FALLBACK);
    }
  }

  function regroundBases() {
    for (const b of baseObjects) b.reground();
  }

  /** 当前时刻的基地视图模型（与 2D 同一口径），状态条与贴地标记共用 */
  function baseViewsAt(t) {
    const ft = DATA.meta.friendly_team;
    const views = [];
    if (supremacyBaseIds.length) {
      for (const state of foldSupremacyTransitions(DATA.supremacy_bases, t)) {
        if (supremacyBaseIds.includes(state.baseId)) views.push(baseView(state, ft));
      }
    }
    if (assaultHasObjective()) views.push(baseView(foldAssaultProgress(DATA.assault_bases, t), ft));
    return views;
  }

  function drawBaseDecal(b, view) {
    const ctx = b.ctx, S = BASE_TEX, c = S / 2, R = S / 2 - 2;
    const owner = baseColors[view.owner];
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.2; ctx.fillStyle = owner; ctx.fillRect(0, 0, S, S);
    const fillColor = view.kind === 'assault' ? baseColors.objective : (view.capturing ? baseColors[view.capturing] : null);
    if (fillColor && view.progress != null) {
      // 从下往上"灌水"（下 = 靠近相机一侧，贴图随视角转正）
      const h = 2 * R * (view.progress / 100);
      ctx.globalAlpha = 0.5; ctx.fillStyle = fillColor; ctx.fillRect(0, c + R - h, S, h);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    if (view.kind === 'supremacy') {
      ctx.font = 'bold 132px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeText(b.baseId, c, c + 6); ctx.fillStyle = owner; ctx.fillText(b.baseId, c, c + 6);
    } else {
      // 旗帜（单基地没有字母）：旗杆 + 三角旗
      ctx.beginPath(); ctx.moveTo(c - 26, c + 54); ctx.lineTo(c - 26, c - 54);
      ctx.lineTo(c + 42, c - 30); ctx.lineTo(c - 26, c - 6);
      ctx.stroke(); ctx.strokeStyle = baseColors.neutral; ctx.lineWidth = 8; ctx.stroke();
    }
    b.tex.needsUpdate = true;
  }

  function updateBases() {
    if (!DATA) return;
    const views = baseViewsAt(T);
    const key = views.map((v) => v.baseId + ':' + v.owner + '/' + v.capturing + '/' + v.progress).join('|');
    if (key !== lastBaseViewsKey) { lastBaseViewsKey = key; store.baseViews = views; }
    for (const b of baseObjects) {
      const view = views.find((v) => v.baseId === b.baseId);
      if (!view) continue;
      const stateKey = view.owner + '/' + view.capturing + '/' + view.progress;
      if (b.stateKey !== stateKey) { b.stateKey = stateKey; drawBaseDecal(b, view); }
      const ringHex = baseColors[view.owner];
      if (b.ringHex !== ringHex) { b.ring.material.color.set(ringHex); b.ringHex = ringHex; }
      // 贴图转正：字母"上"指向远离相机的方向；水平朝向变化超过约 2° 才重算 UV
      const dx = b.gx - camera.position.x, dz = b.gz - camera.position.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ux = dx / len, uz = dz / len;
      if (!b.uvDir || ux * b.uvDir[0] + uz * b.uvDir[1] < 0.9994) {
        orientDisc(b.disc.geometry, ux, uz);
        b.uvDir = [ux, uz];
      }
    }
  }

  // 逐顶点贴地圆盘（极坐标网格，中心 + rings 圈）。offsets 记录每个顶点相对圆心的归一化偏移，
  // UV 由 orientDiscUv 按观察方向旋转计算，几何本身不随视角重建。
  function makeGroundedDisc(gx, gz, radius, rings = 10, seg = 48) {
    const count = 1 + rings * seg;
    const pos = new Float32Array(count * 3);
    const offsets = new Float32Array(count * 2);
    pos[0] = gx; pos[1] = groundY(gx, gz) + 0.05; pos[2] = gz;
    let k = 1;
    for (let i = 1; i <= rings; i++) {
      const rr = (i / rings) * radius;
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
        pos[k * 3] = gx + dx; pos[k * 3 + 1] = groundY(gx + dx, gz + dz) + 0.05; pos[k * 3 + 2] = gz + dz;
        offsets[k * 2] = dx / radius; offsets[k * 2 + 1] = dz / radius;
        k++;
      }
    }
    const idx = [];
    for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + ((j + 1) % seg));
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * seg, b0 = 1 + i * seg;
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    geo.setIndex(idx);
    geo.userData.offsets = offsets;
    return geo;
  }

  function orientDisc(geo, ux, uz) {
    orientDiscUv(geo.userData.offsets, geo.attributes.uv.array, ux, uz);
    geo.attributes.uv.needsUpdate = true;
  }

  // 逐顶点贴地圆环（与地面/边界同构：起伏地形上平面圆环会被坡地埋掉）
  function makeGroundedRing(gx, gz, radius, seg = 72) {
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const xo = gx + ca * radius, zo = gz + sa * radius;
      const xi = gx + ca * radius * 0.9, zi = gz + sa * radius * 0.9;
      pos[i * 6] = xo; pos[i * 6 + 1] = groundY(xo, zo) + 0.08; pos[i * 6 + 2] = zo;
      pos[i * 6 + 3] = xi; pos[i * 6 + 4] = groundY(xi, zi) + 0.08; pos[i * 6 + 5] = zi;
    }
    for (let i = 0; i < seg; i++) {
      idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

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
  const OCCL_CELL = 16;
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
  function publishLabels(force = false) {
    if (!DATA || !labelOverlay || !store.labelsOn) return;
    const now = performance.now();
    const interval = labelsReloadActive ? LABEL_INTERVAL_RELOAD_MS : LABEL_INTERVAL_IDLE_MS;
    if (!force && (T === labelsTime || now - labelsWrittenMs < interval)) return;
    labelsWrittenMs = now;
    labelsTime = T;
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
        eid: v.def.eid, playerName: v.def.nickname || '', tankName: v.def.tank_name || '',
        friendly, destroyed, lastKnown: false,
        hp: { current, pct, state: destroyed ? 'DESTROYED' : 'CURRENT' },
        reload: destroyed ? null : reloadStateAt(v.def.eid, T),
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
  function updateLabels() {
    if (!labelOverlay) return;
    camera.updateMatrixWorld();
    for (const v of V) {
      const d = camera.position.distanceTo(v.group.position);
      v.labelAnchor.copy(v.group.position);
      v.labelAnchor.y += Math.min(6, Math.max(3.25, d * 0.045));
    }
    updateLabelOcclusion();
    for (const v of V) {
      labelClip.set(v.labelAnchor.x, v.labelAnchor.y, v.labelAnchor.z, 1)
        .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      const w = labelClip.w;
      const x = labelClip.x / w, y = labelClip.y / w, z = labelClip.z / w;
      const visible = v.group.visible && store.labelsOn && w > 0
        && Number.isFinite(x) && Number.isFinite(y) && z >= -1 && z <= 1
        && x >= -1 && x <= 1 && y >= -1 && y <= 1;
      labelOverlay.setAnchor(v.def.eid, {
        x: visible ? (x + 1) * container.clientWidth / 2 : 0,
        y: visible ? (1 - y) * container.clientHeight / 2 : 0,
        visible, occluded: v.labelOccluded,
      });
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
    const trackMat = new THREE.MeshLambertMaterial({ color: 0x333a44 });
    const grilleMat = new THREE.MeshLambertMaterial({ color: 0x272e38 });
    for (const def of DATA.vehicles) {
      const color = teamColor({ def });
      const g = new THREE.Group(); g.userData.eid = def.eid;
      const hull = new THREE.Mesh(hullGeo, new THREE.MeshLambertMaterial({ color }));
      const tracks = new THREE.Mesh(trackGeo, trackMat); tracks.position.y = 0.42;
      const grille = new THREE.Mesh(grilleGeo, grilleMat); grille.position.set(0, 1.62, -2.8);
      const turretG = new THREE.Group(); turretG.position.y = 1.85;
      const turret = new THREE.Mesh(turretGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(1.15) }));
      turret.position.z = -0.25;
      const gunPivot = new THREE.Group(); gunPivot.position.set(0, 0.05, 1.5);
      const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0x59636f }));
      gun.rotation.x = Math.PI / 2; gun.position.z = 2.4;
      gunPivot.add(gun); turretG.add(turret); turretG.add(gunPivot);
      g.add(tracks); g.add(hull); g.add(grille); g.add(turretG);
      if (def.is_author) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.3, 32),
          new THREE.MeshBasicMaterial({ color: 0xe8b23c, side: THREE.DoubleSide, transparent: true, opacity: .85 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
        ring.userData.keepWithGlb = true;   // GLB 模式下保留作者标记环
        g.add(ring);
      }
      const v = { def, group: g, turretG, gunPivot, meshHull: hull };
      v.labelAnchor = new THREE.Vector3();
      scene.add(g);
      V.push(v);
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
        const [glbBytes, sd] = await Promise.all([
          assetProvider.bytes(`/glb/${tankId}/model.glb`),
          assetProvider.json(`/tank/${tankId}.json`).catch(() => null),
        ]);
        // GLTFLoader.parse：bytes 经 provider（storage/network 与场景解耦），
        // GLB 自包含无外部资源，resourcePath 无关紧要
        const model = await new Promise((res) =>
          new GLTFLoader().parse(glbBytes.buffer, '', (g) => res(g.scene), () => res(null)));
        if (!model) return null;
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
        return { template: model, sd };
      } catch { return null; }
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
    if (!turretNode || !mo || !mo.track || !mo.turret) {
      console.warn('[playback] glb parts incomplete: turret=' + !!turretNode + ' origins=' + !!(mo && mo.track));
      return null;
    }
    const tP = [mo.track[0] + mo.turret[0], mo.track[1] + mo.turret[1], mo.track[2] + mo.turret[2]];
    // 火炮枢轴用选中配置的 gun_origin（非默认顶级）
    const cfg = cfgs ? (cfgs.find(c => c.turret_index === ti && c.gun_index === gi) || cfgs[cfgs.length - 1]) : null;
    const gP = (cfg && cfg.gun_origin)
      ? [tP[0] + cfg.gun_origin[0], tP[1] + cfg.gun_origin[1], tP[2] + cfg.gun_origin[2]]
      : tP.slice();
    return { turretNode, gunNodes, tP, gP, itr: (sd && sd.initial_turret_rotation) || null };
  }

  // GLB 位姿模块级 scratch：本函数每车每帧执行，原实现每次分配 ~20 个矩阵/欧拉/四元数
  // （14 车 × 60fps 的 GC 抖动源）。语义与逐次分配完全一致，只是复用容器。
  const _glbQuat = new THREE.Quaternion();
  const _glbEuler = new THREE.Euler();
  const _mRot = new THREE.Matrix4(), _mTmpA = new THREE.Matrix4(), _mTmpB = new THREE.Matrix4();
  const _mTmpC = new THREE.Matrix4(), _mTmpD = new THREE.Matrix4(), _mT = new THREE.Matrix4();
  const _mG = new THREE.Matrix4(), _mAcc = new THREE.Matrix4();

  // GLB 根位姿 = poseFromYPR(−yaw, pitch, 0)（共享 rig，见 scene/glbRig.js）
  function poseGlb(v) {
    v.glb.position.copy(v.group.position);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, T), hullPitchAt(v, T), -rollAt(v, T), _glbQuat));
    const p = v.glbParts;
    if (!p) return;
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    const tr = -rel;                       // 镜像系节点旋转角 = −rel
    const gr = gunPitchAt(v, T);           // glb 系 Rx(θ)：θ>0 = 前向(+Y)抬向 +Z = 仰角
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
    tn.updateMatrix();
    if (!tn.userData.__bake) { tn.userData.__bake = tn.matrix.clone(); tn.matrixAutoUpdate = false; }
    tn.matrix.copy(_mAcc.copy(mT).multiply(tn.userData.__bake));
    for (const gn of p.gunNodes) {
      gn.updateMatrix();
      if (!gn.userData.__bake) { gn.userData.__bake = gn.matrix.clone(); gn.matrixAutoUpdate = false; }
      gn.matrix.copy(_mAcc.copy(mG).multiply(gn.userData.__bake));
    }
    v.glb.updateMatrixWorld(true);
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
            v.glb = inst;
            // 炮塔/主炮变体（dense 节点索引）按**实际搭载配置**选：facet 的 turret_index/
            // gun_index 只有服务器路径产出；WASM 客户端产物用同一三级证据链
            // （comp locals → 发射弹种 → 初始血量，resolveMountedConfig）联表 tank 数据
            // 派生——多炮坦克各炮 GLB 节点组不同（实测同队两台 B-C 25t 分别 100/105mm），
            // 不钉定会整场显示顶级炮。sd 拉取失败 → 回退 facet 字段 → 顶级。
            const mounted = loaded.sd ? resolveMountedConfig(v.def, loaded.sd) : null;
            v.glbParts = collectGlbParts(inst, loaded.sd, mounted
              ? { turret_index: mounted.turret_index, gun_index: mounted.gun_index }
              : { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            v.glb.visible = v.group.visible;
            scene.add(v.glb);
          }
        }
        if (v.glb) setLowPoly(v, false);
      });
    } else {
      for (const v of V) {
        if (v.glb) { scene.remove(v.glb); v.glb = null; v.glbParts = null; }
        setLowPoly(v, true);
      }
    }
  }
  // 低模显隐（标签与作者标记环除外；GLB 根在 scene 上不经过 group）
  function setLowPoly(v, show) {
    for (const c of v.group.children) {
      if (c.userData.keepWithGlb) continue;
      c.visible = show;
    }
  }

  // ---------- 弹道 ----------
  const TRACER_LEN = 9;
  // 全弹道轨迹线按 replay clock 保留；impact 单独使用 wall-clock transient（见 updateImpacts）。
  // 透明度（2026-10-05 提高可读性：原 0.35 与背景混合后明显发灰；淡出在其上再乘）。
  // 0.85（二次提高）：用户反馈炮线整体偏暗——轨迹线是长条半透明几何，混合后亮度远低于
  // 字面色，提高不透明度是最直接的补救；淡出阶段仍按比例衰减。
  const TRAJ_OPACITY = 0.85;
  // 粗细（2026-10-05 加粗 ~64%：原 0.22/0.11 在 4K/远视角下几乎不可见，用户实测反馈）：
  // 飞行段与全弹道轨迹线同比例加粗，保持「飞行段更粗」的层级不变。
  const TRACER_RADIUS = 0.36;   // 飞行段粗细
  const TRAJ_RADIUS = 0.18;     // 轨迹线粗细
  // 战斗反馈显示时长倍率（**只作用于 3D 场景**）：炮线（全弹道轨迹线）、命中特效、
  // 掉血飘字、HP 条幽灵/受击闪、击毁爆散统一乘这个系数——回放里这些反馈需要更长的可读
  // 时间，否则 1x 下弹道/数字一闪即逝。乘在下面 transient 段的 2D SSOT 常量之上，
  // 因此 **2D 回放时序不受影响**；1 = 与 2D 逐值一致。
  // 不作用于飞行段（tracers：位置由 t_fire/flight_secs 决定，拉长会让炮弹看起来变慢）。
  const FX_SCALE = 2;
  let trajLines = [];

  // ---------- 特效对象池 ----------
  // 此前每发炮线/每次命中/每次击毁都新建 geometry+material 再 dispose（伤害飘字还新建
  // canvas+CanvasTexture）：FX_SCALE=2 让同时在场数量翻倍，交火高峰即 GPU buffer 分配
  // 与 GC 的尖峰。池按几何规格复用整套对象（含材质与贴图）：取出时重置颜色/透明度/缩放，
  // 归还只从场景移除、不 dispose；真正的释放只在会话结束时做一次（disposeFxPool）。
  const fxPool = new Map();
  function fxTake(key, make) {
    const p = fxPool.get(key);
    if (p && p.length) return p.pop();
    return make();
  }
  function fxGive(key, obj) {
    let p = fxPool.get(key);
    if (!p) { p = []; fxPool.set(key, p); }
    p.push(obj);
  }
  function disposeFxPool() {
    for (const list of fxPool.values()) for (const o of list) disposeObject3D(o);
    fxPool.clear();
  }

  function spawnShot(s) {
    // 炮线唯一颜色规则 = 射手阵营（绿/红/白）；命中/跳弹/击毁不改炮线颜色——
    // 结果由弹着点 impact 编码（原实现按结果上色，与上游 Agent 不一致）
    const color = shotTeamColor(s);
    // toneMapped: false —— 渲染器全局 ACES 胶片色调映射（toneMappingExposure 1.15）会把
    // 颜色压缩降饱和，深色阵营色被进一步压暗（"亮度限制"的来源）。炮线是 UI 语义色，
    // 与地表/场景材质同策略：直出字面色（见 ground/scenery 的 toneMapped: false）。
    const mesh = fxTake('tracer', () => new THREE.Mesh(
      new THREE.BoxGeometry(TRACER_RADIUS, TRACER_RADIUS, TRACER_LEN),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })));
    mesh.material.color.setHex(color);
    mesh.visible = true;
    scene.add(mesh);
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
    // 弹着特效落点 = **抵达点**（有跳弹 = via[0]，即镜像后的 pts3[1]；直射 = 服务器终点）
    const impactPos = new THREE.Vector3().fromArray(pts3[1]);
    // `from`/`to` 供弹着特效（跳弹火花方向）使用：to = **抵达点**（跳弹点/终点），
    // from = 炮口——`spawnImpact` 依赖这两个字段，折线改造时漏掉会让 ricochet 分支抛异常
    // （整帧中断 → 画面卡住一帧且弹着特效不生成）。
    tracers.push({ mesh, points: pts3, legEnds, arcEnds: legArcEnds(pts3), t0: s.t_fire, t1, shot: s, color,
      from: new THREE.Vector3().fromArray(pts3[0]), to: impactPos.clone(), impactPos });
    // 全弹道轨迹线（队伍色：友军蓝/敌军红，与飞行段的命中结果色区分）：
    // 开火即显整条弹道（逐段一盒：折线在跳弹处拐弯）；消失节奏与弹着点特效同步——
    // 基准 t1+1.1s 移除、最后 0.6s 淡出，二者同乘 FX_SCALE（=2 → t1+2.2s 移除、最后 1.2s 淡出）。
    // 2026-10-05 用户反馈显示太久 → 时长减半（1.0/2.2 → 0.5/1.1）。
    // 单位长盒 + scale.z＝段长：几何可池化（半径不变、长度每段不同）
    for (let k = 0; k + 1 < pts3.length; k++) {
      const a = new THREE.Vector3().fromArray(pts3[k]);
      const b = new THREE.Vector3().fromArray(pts3[k + 1]);
      const trajLen = a.distanceTo(b);
      if (!(trajLen > 1e-3)) continue;
      const traj = fxTake('traj', () => new THREE.Mesh(
        new THREE.BoxGeometry(TRAJ_RADIUS, TRAJ_RADIUS, 1),
        new THREE.MeshBasicMaterial({
          color: shotTeamColor(s), transparent: true, opacity: TRAJ_OPACITY, depthWrite: false,
          toneMapped: false,   // 同上：全弹道轨迹线同样直出字面色
        })));
      traj.material.color.setHex(shotTeamColor(s));
      traj.material.opacity = TRAJ_OPACITY;
      traj.scale.set(1, 1, trajLen);
      traj.visible = true;
      traj.position.copy(a.clone().add(b).multiplyScalar(0.5));
      traj.lookAt(b);
      scene.add(traj);
      trajLines.push({ mesh: traj, until: t1 + 0.5 * FX_SCALE, fadeEnd: t1 + 1.1 * FX_SCALE, base: TRAJ_OPACITY });
    }
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
  // 命中类型 → impact（评审批准语义，与上游 Agent 同式；全部 transient，无 decal/弹孔）：
  //   pen（击穿）= 白色球 + 小环；nonpen = 更大的球 + 明显 shock ring；ricochet = 侧向 sparks；
  //   miss（无 target）/未知结果 = 不生成 target impact（不伪造）
  const IMPACT_WHITE = 0xffffff;
  // impactKind 见 ./impactKind.js（纯函数，可单测）：game_hit_result 枚举里没有"跳弹"
  // 取值（1=未击穿、2=间隙止），只有作者 hit_flags & 0x0008 才是跳弹证据。
  // 命中特效三变体（球径/是否带 sparks 不同）各自成池 key；组内子物体随组复用
  function makeImpactFx(kind) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(kind === 'nonpen' ? 0.42 : 0.72, 10, 10),
      new THREE.MeshBasicMaterial({ color: IMPACT_WHITE, transparent: true }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 20),
      new THREE.MeshBasicMaterial({ color: IMPACT_WHITE, side: THREE.DoubleSide, transparent: true }));
    ring.rotation.x = -Math.PI / 2;
    g.add(ball); g.add(ring);
    const sparks = [];
    if (kind === 'ricochet') {
      // 侧向 sparks（两段短射线沿弹道法向散开）；局部偏移在 spawn 时按弹道方向设
      for (const _sgn of [1, -1]) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 2.2),
          new THREE.MeshBasicMaterial({ color: IMPACT_WHITE, transparent: true }));
        g.add(sp); sparks.push(sp);
      }
    }
    return { g, ball, ring, sparks };
  }

  function spawnImpact(tr) {
    const kind = impactKind(tr.shot);
    if (!kind) return;
    const fx = fxTake('impact-' + kind, () => makeImpactFx(kind));
    const g = fx.g, ball = fx.ball, ring = fx.ring, sparks = fx.sparks;
    // 重置为出生状态（池复用：上一次的淡出/缩放必须归位）
    ball.material.opacity = 1;
    ring.material.opacity = 1; ring.scale.setScalar(1);
    for (const sp of sparks) sp.material.opacity = 1;
    if (kind === 'ricochet') {
      const dir = tr.to.clone().sub(tr.from).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      // 局部偏移：群组已置于 tr.to，子物体不得再叠加一次世界坐标（否则成 2*tr.to + offset）
      for (let i = 0; i < sparks.length; i++) {
        const sgn = i === 0 ? 1 : -1;
        const sp = sparks[i];
        sp.position.set(side.x * sgn * 1.1, 0, side.z * sgn * 1.1);
        // 盒体沿 +Z、朝水平 ±side：直接给 yaw，不依赖 lookAt 对父子变换的处理
        sp.rotation.y = Math.atan2(side.x * sgn, side.z * sgn);
      }
    }
    g.position.copy(tr.impactPos);
    g.visible = true;
    scene.add(g);
    // impact 属于 UI feedback transient：寿命按真实壁钟计，而不是 replay clock。
    // 这样 0.5x / 16x 下可读时长一致；暂停时自然淡出；seek 由 clearEffects 直接清空。
    const durationMs = (kind === 'nonpen' ? 650 : kind === 'ricochet' ? 550 : 450) * FX_SCALE;
    impacts.push({ g, bornMs: performance.now(), durationMs, ball, ring, sparks, kind });
  }

  function updateImpacts() {
    const now = performance.now();
    for (let i = impacts.length - 1; i >= 0; i--) {
      const im = impacts[i];
      const k = Math.max(0, Math.min(1, (now - im.bornMs) / im.durationMs));
      if (k >= 1) {
        scene.remove(im.g);
        fxGive('impact-' + im.kind, { g: im.g, ball: im.ball, ring: im.ring, sparks: im.sparks || [] });
        impacts.splice(i, 1);
        continue;
      }
      const op = 1 - k;
      im.ball.material.opacity = op;
      im.ring.material.opacity = op * 0.8;
      im.ring.scale.setScalar(1 + k * (im.kind === 'nonpen' ? 2.2 : 1.6));
      if (im.sparks) for (const sp of im.sparks) sp.material.opacity = op * 0.7;
    }
  }

  function updateTracers() {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      if (T < tr.t0) continue;
      // 沿折线推进：头部按时间落在当前段（段内匀速），尾部 = 头部**弧长位置**回退 TRACER_LEN 米
      // （跳弹拐角时尾巴跟着折线弯，与客户端沿折线推进的观感一致）
      const headArr = pointAt(tr.points, tr.legEnds, T, tr.t0);
      const sHead = arcAtTime(tr.points, tr.legEnds, tr.arcEnds, T, tr.t0);
      const tailArr = pointAtArc(tr.points, tr.arcEnds, sHead - TRACER_LEN);
      const head = _tpA.set(headArr[0], headArr[1], headArr[2]);
      _tpB.set(tailArr[0], tailArr[1], tailArr[2]);
      tr.mesh.position.copy(head.clone().add(_tpB).multiplyScalar(0.5));
      tr.mesh.lookAt(head);
      tr.mesh.scale.z = Math.max(0.001, Math.hypot(head.x - _tpB.x, head.y - _tpB.y, head.z - _tpB.z) / TRACER_LEN);
      // 完成判定 = **时间到终点**（折线改造曾误留旧变量 `f >= 1`——f 已不存在，
      // 每帧 ReferenceError 中断整个 tick：不渲染、位姿/HUD 全停，且该炮线永远走不到
      // 移除分支 → 持续抛到暂停为止。这就是此前"播放中卡死、暂停即止"的根因。）
      if (T >= tr.t1) {
        // 归还对象池（几何/材质留待复用）；真正的释放见 disposeFxPool（会话结束时一次）
        scene.remove(tr.mesh);
        fxGive('tracer', tr.mesh);
        tracers.splice(i, 1);
        spawnImpact(tr);
      }
    }
    // 全弹道轨迹线：命中后延迟停留，再线性淡出并释放
    for (let i = trajLines.length - 1; i >= 0; i--) {
      const tl = trajLines[i];
      if (T >= tl.fadeEnd) {
        scene.remove(tl.mesh); fxGive('traj', tl.mesh);
        trajLines.splice(i, 1); continue;
      }
      tl.mesh.material.opacity = T <= tl.until ? tl.base
        : tl.base * Math.max(0, 1 - (T - tl.until) / (tl.fadeEnd - tl.until));
    }
  }

  // ---------- 战斗反馈 transient（语义与 WotBTools 2D 对齐）----------
  // 关键语义：**壁钟（真实 ms）寿命**，而非回放时钟——任意倍速下可读时长相近
  // （2D battlePlayback.js 同款常量与注释）。因用壁钟，暂停时 transient 自然走完，
  // 无需特殊处理；seek 则清空并重置事件游标（不补播历史动画）。
  // FLOAT_DMG_MS / GHOST_MS / FLASH_MS / BURST_MS 来自 ../utils/battlePlayback.js（2D SSOT）；
  // 3D 侧统一在**使用点**乘 FX_SCALE（不改进 SSOT 常量 → 2D 时序不动）
  const ghostByEid = new Map();  // eid -> { fromFrac, toFrac, untilMs }
  const flashByEid = new Map();  // eid -> untilMs
  let floatDmgs = [];          // { sp, tex, born, baseY, group }
  let burstFx = [];            // { g, born, rings, ball }
  let dmgEvents = [];          // { t, eid, hpLoss }（回放时钟，升序）
  let burstEvents = [];        // { t, eid }（回放时钟，升序）
  let dmgPtr = 0, burstPtr = 0;

  // 事件源：伤害 = 血量链相邻下降幅值（幅值即丢失血量；无逐段伤害归属时仍可判
  // "谁掉了多少"）；击毁 = kills（死亡终态 × 击杀播报归属增强）。
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
    // kills 按 t 升序排一次：击杀流游标与比分游标都以「升序 + 单调推进」为前提
    // （此前只在 burstEvents 的副本上排序，DATA.kills 自身依赖上游产出顺序）
    if (DATA.kills) DATA.kills.sort((a, b) => a.t - b.t);
    burstEvents = (DATA.kills || []).map((k) => ({ t: k.t, eid: k.victim_eid }))
      .sort((a, b) => a.t - b.t);
    dmgPtr = 0; burstPtr = 0;
  }

  function vehicleByEid(eid) { return V.find((x) => x.def.eid === eid); }

  // 伤害飘字：受击车上方浮出 "-<lost>"，上浮 + 淡出（基准 1s × FX_SCALE）。
  // 在同一 renderer 的反馈层绘制（depthTest 关闭），车辆名牌独立使用 HTML 覆盖层。
  // 飘字是最高频的反馈事件（每次掉血一次）：canvas / CanvasTexture / Sprite 全部池化，
  // 复用时只重画画布内容并置 needsUpdate（贴图上传仍会发生，但对象不再反复创建销毁）
  function makeFloatDmgFx() {
    const cv = document.createElement('canvas'); cv.width = DMG_TEX_W; cv.height = DMG_TEX_H;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, depthTest: false, depthWrite: false, transparent: true, opacity: 1,
    }));
    sp.renderOrder = 1001;                 // 反馈层内的绘制顺序
    return { sp, tex, cv, ctx: cv.getContext('2d') };
  }

  function spawnFloatDmg(eid, hpLoss) {
    const v = vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    const fx = fxTake('floatDmg', makeFloatDmgFx);
    const cv = fx.cv, c = fx.ctx, tex = fx.tex, sp = fx.sp;
    const cx = DMG_TEX_W / 2, cy = DMG_TEX_H / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, DMG_TEX_W, DMG_TEX_H);
    c.font = 'bold 100px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    const text = '-' + hpLoss;
    // 三层（由外到内）保证任意地形/车体/名牌上都读得出：橙光晕 → 黑描边 → 亮橙填充。
    // 固定 384×192 对小到手机、大到 4K 都够清晰（屏上数字约 1.6% 视口高，贴图字高 100px
    // 始终过采样；覆盖层的 DPR 上限由主画布画质档决定）：
    // 屏上数字约 1.6% 视口高 ≈ 最多 ~70 设备像素，贴图字高 100px 始终过采样。
    c.shadowColor = 'rgba(255,140,0,.95)'; c.shadowBlur = 30;
    c.fillStyle = '#000'; c.fillText(text, cx, cy);          // 光晕载体（自身被后两层覆盖）
    c.shadowBlur = 0;
    c.lineWidth = 16; c.strokeStyle = 'rgba(0,0,0,.95)'; c.strokeText(text, cx, cy);
    c.fillStyle = '#ffb340'; c.fillText(text, cx, cy);
    tex.needsUpdate = true;
    // 池复用：出生状态归位（透明度/尺寸/可见性由 updateTransients 逐帧驱动）
    sp.material.opacity = 1;
    sp.visible = true;
    sp.scale.set(DMG_ASPECT, 1, 1);        // 实际尺寸每帧按距离设定（屏上占比恒定，见 updateTransients）
    sp.position.copy(v.group.position); sp.position.y += 3.2;
    labelScene.add(sp);
    floatDmgs.push({ sp, tex, cv, born: performance.now(), baseY: sp.position.y, group: v.group });
    // 同源触发 HP 条反馈（2D 三件套：飘字 + 幽灵 + 闪，同一 loss 事件驱动）
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

  // 击毁爆散：双层扩散环 + 中心球，基准 700ms × FX_SCALE 内扩张并淡出
  function makeBurstFx() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffa53a, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const rings = [];
    for (const r0 of [0.8, 1.6]) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 0.45, 28), mat.clone());
      mesh.rotation.x = -Math.PI / 2;
      g.add(mesh); rings.push(mesh);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), mat.clone());
    g.add(ball);
    return { g, rings, ball };
  }

  function spawnBurst(eid) {
    const v = vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    const fx = fxTake('burst', makeBurstFx);
    const g = fx.g, rings = fx.rings, ball = fx.ball;
    // 重置为出生状态（池复用：上一次的扩散/淡出必须归位）
    for (const rr of rings) { rr.scale.setScalar(1); rr.material.opacity = 0.85; }
    ball.scale.setScalar(1); ball.material.opacity = 0.7;
    g.visible = true;
    g.position.copy(v.group.position);
    scene.add(g);
    burstFx.push({ g, born: performance.now(), rings, ball });
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
    for (let i = floatDmgs.length - 1; i >= 0; i--) {
      const f = floatDmgs[i];
      const k = (now - f.born) / (FLOAT_DMG_MS * FX_SCALE);
      if (k >= 1) {
        labelScene.remove(f.sp);
        fxGive('floatDmg', { sp: f.sp, tex: f.tex, cv: f.cv, ctx: f.cv.getContext('2d') });
        floatDmgs.splice(i, 1);
        continue;
      }
      // 跟随车辆水平漂移 + 上浮；尺寸按距离反算（屏上占比恒定，拉远看全场也读得出），
      // 不透明度"先保持后淡出"（线性淡出会让数字来不及读）
      f.sp.position.x = f.group.position.x;
      f.sp.position.z = f.group.position.z;
      f.sp.position.y = f.baseY + k * 4.5;
      const { pop, opacity } = floatDmgAnim(k);
      const s = dmgWorldHeight(camera.position.distanceTo(f.sp.position), camera.fov) * pop;
      f.sp.scale.set(s * DMG_ASPECT, s, 1);
      f.sp.material.opacity = opacity;
    }
    for (let i = burstFx.length - 1; i >= 0; i--) {
      const b = burstFx[i];
      const k = (now - b.born) / (BURST_MS * FX_SCALE);
      if (k >= 1) {
        scene.remove(b.g);
        fxGive('burst', { g: b.g, rings: b.rings, ball: b.ball });
        burstFx.splice(i, 1);
        continue;
      }
      for (let j = 0; j < b.rings.length; j++) {
        b.rings[j].scale.setScalar(1 + k * (2.2 + j * 1.6));
        b.rings[j].material.opacity = 0.85 * (1 - k);
      }
      b.ball.scale.setScalar(1 + k * 1.5);
      b.ball.material.opacity = 0.7 * (1 - k);
    }
  }

  function clearTransients() {
    // 归池而非 dispose：seek/teardown 后这些对象还要复用（真正的释放在 disposeFxPool）
    for (const f of floatDmgs) {
      labelScene.remove(f.sp);
      fxGive('floatDmg', { sp: f.sp, tex: f.tex, cv: f.cv, ctx: f.cv.getContext('2d') });
    }
    floatDmgs.length = 0;
    for (const b of burstFx) {
      scene.remove(b.g);
      fxGive('burst', { g: b.g, rings: b.rings, ball: b.ball });
    }
    burstFx.length = 0;
    ghostByEid.clear(); flashByEid.clear();   // 2D seek 同语义：清空且不补播
    dmgPtr = 0; burstPtr = 0;                 // 游标重置：seek 后不补播历史动画
  }

  // ---------- 击杀 feed / 计分 ----------
  function feedEntry(k) {
    const gen = sessionGen;
    const name = (eid) => { const v = V.find((x) => x.def.eid === eid);
      return v ? (v.def.nickname || 'Unknown') : eid === 0 ? '环境' : String(eid); };
    const causeMap = { 0: '', 1: '（火焰）', 2: '（撞击）', 3: '（环境）', 5: '（溺水）' };
    const text = k.killer_eid !== 0
      ? `${name(k.killer_eid)} 击毁 ${name(k.victim_eid)}`
      : `${name(k.victim_eid)}${causeMap[k.cause] || '阵亡'}`;
    const entry = { id: ++kfId, kill: k.killer_eid !== 0, killer: name(k.killer_eid), victim: name(k.victim_eid), text };
    store.killfeed.push(entry);
    setTimeout(() => {
      if (gen !== sessionGen) return;   // 会话已切换：条目已随 teardown 清空，不动新会话
      const i = store.killfeed.findIndex((x) => x.id === entry.id);
      if (i >= 0) store.killfeed.splice(i, 1);
    }, 8000);
  }
  function advanceKills() {
    while (killPtr < DATA.kills.length && DATA.kills[killPtr].t <= T) {
      feedEntry(DATA.kills[killPtr]);
      killPtr++;
    }
  }
  function rebuildFeed() {
    store.killfeed = [];
    const recent = DATA.kills.filter((k) => k.t <= T).slice(-6);
    for (const k of recent) feedEntry(k);
    killPtr = 0;
    while (killPtr < DATA.kills.length && DATA.kills[killPtr].t <= T) killPtr++;
  }
  // 比分：击杀升序 → 单调游标增量推进（此前每 tick 全量扫描 + 每击杀一次 V.find，随击倒数增长）
  let scorePtr = 0, score1 = 0, score2 = 0;
  function resetScore() { scorePtr = 0; score1 = 0; score2 = 0; }
  function updateScore() {
    while (scorePtr < DATA.kills.length && DATA.kills[scorePtr].t <= T) {
      const k = DATA.kills[scorePtr++];
      const victim = V.find((x) => x.def.eid === k.victim_eid);
      if (!victim) continue;
      if (victim.def.team === 1) score2++; else if (victim.def.team === 2) score1++;
    }
    // 上屏前映射到阵营视角：击杀计数是物理队伍（score1 = team 1），而顶栏布局是
    // 「己方 HP | 己方比分 : 敌方比分 | 敌方 HP」——不映射在 `friendly_team = 2` 时左右相反。
    const perspective = perspectiveScore(score1, score2, DATA.meta.friendly_team);
    if (store.scoreFriend !== perspective.scoreFriend) store.scoreFriend = perspective.scoreFriend;
    if (store.scoreEnemy !== perspective.scoreEnemy) store.scoreEnemy = perspective.scoreEnemy;
  }

  // ---------- 名册 ----------
  // 静态身份（eid / 物理 team / 昵称 / 车型）与运行时状态（hp / 阵亡 / 跟随）**分开放**：
  // 前者只在会话开始时建一次，后者每次投影都按当前 T 重算（见 scene/rosterState.js）。
  // 名册的物理阵营色由呈现层按 `team` 取语义 token（--color-team-1/2），内核不再下发颜色——
  // 否则「Team 1 是什么颜色」会有两份事实源。
  const rosterRowsByEid = new Map();
  function buildRoster() {
    store.friendlyTeam = [1, 2].includes(DATA.meta.friendly_team) ? DATA.meta.friendly_team : null;
    const groups = buildRosterRows(V);
    rosterRowsByEid.clear();
    for (const key of ROSTER_GROUPS) {
      store.roster[key] = groups[key].map((row) => applyRosterRuntime(
        { ...row },
        { hp: 0, maxHp: 0, dead: false, followed: false, reload: null },
      ));
      // 索引登记的必须是**响应式代理**（读回 store 得到的行），不能是上面的原始对象：
      // store 只存原始对象、读取时才包代理，直接改原始对象 Vue 收不到通知——名册就会
      // 停在旧 HP，直到别的状态（如选中行）碰巧触发重绘。
      for (const row of store.roster[key]) rosterRowsByEid.set(row.eid, row);
    }
  }
  /**
   * 把当前 T 的运行时状态投影进名册行（只在值真的变了时写，避免无谓的 VDOM patch）。
   * 只由 writeHud 调用，**不逐帧**：与顶栏总血量同一个 T、同一 ≤10Hz 节拍；seek / 会话开始 /
   * 停播 / 换相机（跟随目标）强制补写。resolver 每次返回新的 reload 数组，若逐帧投影，
   * 名册会每帧重绘。
   *
   * `reload` 复用**场景自己的** reload resolver（`reloadStateAt`，与车辆名牌同一事实源），
   * 不在名册里另起一套解释——弹容 N 由 resolver 从回放 facet 车辆的 `burst_size`
   * （实际搭载配置，解析面钉定）取默认；2D 名册走的是
   * `createReloadStateResolver(reloadTelemetry)`，两边是同一个 resolver 家族、同一套弹夹语义。
   */
  function updateRoster() {
    const projected = projectRoster(V, T);
    for (const v of V) {
      const e = rosterRowsByEid.get(v.def.eid);
      const p = projected.get(v.def.eid);
      if (!e || !p) continue;
      applyRosterRuntime(e, {
        hp: p.hp,
        maxHp: p.maxHp,
        dead: p.dead,
        followed: FOLLOW_EID === v.def.eid,
        // 阵亡不展示 reload（与名牌同一判据：destroyed 时不显示次级瞬时状态）
        reload: p.dead ? null : reloadStateAt(v.def.eid, T),
      });
    }
  }

  // ---------- 主循环 ----------
  const tmpV = new THREE.Vector3();
  let followAnchor = null;             // 跟随模式：上一帧坦克位置（位移增量基准）
  const tmpDir = new THREE.Vector3();  // 进入跟随：相机方向临时量
  const FOLLOW_SNAP_DIST = 26;         // 进入跟随：相机沿当前方向收拢到此距离（米；坦克约 7m 长）
  const FOLLOW_MIN_HEIGHT = 9;         // 进入跟随：相机至少高于坦克此高度（米，保证俯角不贴地）
  // 可破坏地形状态推进（回放时钟；seek 后退 = 全量重算，前进 = 游标泵）。
  // 树倒角度每帧从 (T − clock) 重算（幂等，seek 安全）；碎裂换模只在状态翻转时
  // 触碰 visible。st.pivot 的倒向旋转 = fall ∘ placement（世界轴后乘，见加载段）。
  // 可破坏状态推进（回放时钟；seek 后退 = 全量重算，前进 = 游标泵）。
  // 性能：只在有**在飞倒树动画**时逐帧更新四元数（dirty 标记），已终态的树跳过；
  // 碎裂换模只在状态翻转时触碰 visible（幂等，seek 安全）。
  function updateDestructibles(T) {
    if (!destruct) return;
    const states = destruct.states;
    if (T < destruct.lastT) {
      destruct.ptr = 0;   // seek 后退：全部回到未激活
      // 树终态缓存随回退**显式失效**：settled=true 的树若不清，重播再次越过倒伏终点时
      // 终态分支被跳过，触地旋转不会重写（树直立或停在中间角）。（destructibles.js 的
      // settled getter「pivot 未达停止角 ⇒ 视为未终态」是第二道防线，两道机制独立。）
      for (const st of states) if (st.prop === 3) st.settled = false;
    }
    destruct.lastT = T;
    while (destruct.ptr < states.length && states[destruct.ptr].clock <= T) destruct.ptr++;
    destruct.animating = false;
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      const active = i < destruct.ptr;
      if (st.prop === 3) {
        if (!st.pivot) continue;
        if (!active) {
          if (st.pivot.quaternion.x || st.pivot.quaternion.y || st.pivot.quaternion.z) {
            st.pivot.quaternion.identity();
          }
          continue;
        }
        // 只在动画窗口内逐帧更新；终态后写一次不再碰（省去 700+ 次 setFromAxisAngle）。
        // 推进决策在 destructibles.treeFrame（纯函数，单测锁定倒带序列），此处只写四元数。
        const f = treeFrame(st, true, T);
        if (f) {
          if (f.animating) destruct.animating = true;
          st.pivot.quaternion.setFromAxisAngle(_tmpFallAxis.set(f.axis[0], f.axis[1], f.axis[2]), f.angle);
        }
      } else {
        if (active === !!st.applied) continue;
        st.applied = active;
        for (const m of st.intactMeshes || []) m.visible = !active;
        for (const m of st.deadMeshes || []) m.visible = active;
      }
    }
  }
  const _tmpFallAxis = new THREE.Vector3();
  // 炮线折线求值 scratch（每帧多车并发，避免逐帧分配）
  const _tpA = new THREE.Vector3(), _tpB = new THREE.Vector3();

  function applyPose(v) {
    const dead = deathAt(v, T);
    // 死亡后模型不消失：coverage 在阵亡处截止，但残骸应留在最后已知位置
    // （posAt 对越界时间钳位到最后采样，即阵亡点），与游戏内残骸留场行为一致
    const vis = visibleAt(v, T) || dead;
    v.group.visible = vis;
    if (v.glb) v.glb.visible = vis;
    if (!vis) { v.wasDead = false; return; }
    posAt(v, T, tmpV);
    v.group.position.copy(tmpV);
    if (v.glb) poseGlb(v);
    // 低模位姿（GLB 显示时保留低模位姿更新，切回低模无跳变）
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = -yawAt(v, T);
    v.group.rotation.x = hullPitchAt(v, T);
    v.group.rotation.z = -rollAt(v, T);   // 横滚（符号约定见 rollAt 注释）
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    v.turretG.rotation.y = -rel;
    v.gunPivot.rotation.x = -gunPitchAt(v, T);
    // 死亡：低模灰化——降饱和 + 亮度下限（旧版直接 ×0.35，队伍色本就偏深，乘完近乎
    // 黑色剪影）。复活语义不存在，回放倒带时恢复原色。
    if (dead !== v.wasDead) {
      v.wasDead = dead;
      v.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          if (dead) {
            o.userData.__c = o.material.color.clone();
            const hsl = { h: 0, s: 0, l: 0 };
            o.material.color.getHSL(hsl);
            o.material.color.setHSL(hsl.h, hsl.s * 0.15, Math.max(0.30, hsl.l));
          } else if (o.userData.__c) {
            o.material.color.copy(o.userData.__c);
          }
        }
      });
    }
  }

  // 按需渲染的脏标记：状态跳变（seek/换相机/开关节/尺寸变化/特效到期）必须显式置脏，
  // 否则那一帧的静止状态会一直停留在旧画面上。
  let frameDirty = true;
  function invalidate() { frameDirty = true; }

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
      tick();
      if (T >= END) setPlaying(false);   // 先 tick 后停：停播时的 HUD/名册补写要包含终点帧的事件
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
    const cameraMoved = controls.update();   // three 的 update() 返回相机是否变化（阻尼/交互）
    // ---------- 按需渲染（脏帧）----------
    // 暂停且没有在飞特效、相机也静止时，跳过整帧工作（标签/基地/transient 重算 + 两次全屏
    // render）。此前空闲也满速重绘，是移动端发热与笔记本耗电的第一来源。
    const busy = PLAYING
      || cameraMoved
      || frameDirty
      || (destruct && destruct.animating)
      || tracers.length > 0 || impacts.length > 0 || floatDmgs.length > 0 || burstFx.length > 0
      || ghostByEid.size > 0 || flashByEid.size > 0;
    if (!busy) return;
    frameDirty = false;
    const perfT0 = PERF ? performance.now() : 0;
    updateLabels();
    updateBases();
    updateImpacts();      // wall-clock transient：暂停时也继续自然淡出
    updateTransients();
    const perfT1 = PERF ? performance.now() : 0;
    renderer.render(scene, camera);
    // 伤害飘字覆盖层：同 renderer 的第二次 render；车辆标签由 HTML overlay 呈现。
    renderer.autoClear = false;
    renderer.render(labelScene, camera);
    renderer.autoClear = true;
    if (PERF) perfFrame(perfT1 - perfT0, performance.now() - perfT1);
  }

  // ---------- 性能探针（`?perf`；只读测量，不改变任何渲染行为） ----------
  // 3D 卡顿类问题靠"读代码"定不了位：这里逐帧记录**分阶段耗时**（场景状态更新 /
  // 提交渲染）与当时的**在场对象数**，并保留最慢的若干帧（含回放时刻 T）——复现后
  // 在控制台执行 `__pbPerf.report()` 即可拿到证据（谁慢、慢在哪个阶段、当时有多少
  // 炮线/轨迹盒/命中特效/飘字/爆散/可见车辆）。
  const PERF = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('perf');
  const PERF_RING = 240;              // ≈4s 窗口（60fps）
  let perfRing = [], perfRingN = 0, perfLast = 0, perfSlow = [];
  function perfFrame(updateMs, renderMs) {
    const now = performance.now();
    const dt = perfLast ? now - perfLast : 0;
    perfLast = now;
    perfRing[perfRingN % PERF_RING] = { dt, updateMs, renderMs, t: T,
      tracers: tracers.length, traj: trajLines.length, impacts: impacts.length,
      dmg: floatDmgs.length, burst: burstFx.length,
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
      `now: T=${last.t.toFixed(1)} veh=${last.veh} tracers=${last.tracers} trajBoxes=${last.traj} impacts=${last.impacts} dmg=${last.dmg} burst=${last.burst}`,
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
   *  开火/命中"挪到加载阶段。场景层与飘字层各编译一次；失败不影响播放（best-effort）。 */
  function prewarmShaders() {
    try {
      camera.updateMatrixWorld();
      renderer.compile(scene, camera);
      renderer.compile(labelScene, camera);
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }

  function tick() {
    // 弹道推进
    const shots = DATA.shots;
    while (shotPtr < shots.length && shots[shotPtr].t_fire <= T) { spawnShot(shots[shotPtr]); shotPtr++; }
    updateTracers();
    advanceKills();
    // 战斗反馈事件泵（回放时钟；壁钟寿命见 transient 段）
    while (dmgPtr < dmgEvents.length && dmgEvents[dmgPtr].t <= T) {
      const e = dmgEvents[dmgPtr++];
      spawnFloatDmg(e.eid, e.hpLoss);
    }
    while (burstPtr < burstEvents.length && burstEvents[burstPtr].t <= T) {
      spawnBurst(burstEvents[burstPtr++].eid);
    }
    for (const v of V) applyPose(v);
    updateDestructibles(T);
    updateScore();
    // HUD → store
    // 顶栏：争霸实时点数——**每 tick 确定性重算**（无采样也写 null）：从争霸场切到普通场时
    // supremacy_points 缺失，若只在有采样时才写，上一场的点数会残留在 HUD 上。
    // 阵营映射只认 friendly_team ∈ {1,2}（unknown ≠ enemy，见 pointsAt）。
    {
      const pts = pointsAt(DATA.supremacy_points, T, DATA.meta.friendly_team);
      store.pointsFriend = pts.friend; store.pointsEnemy = pts.enemy;
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
    store.startTime = START;
    store.duration = END;
    const t = Math.max(START, Math.min(END, T));
    if (t !== T) seekTo(t);
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
    tick();
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
    CAM = mode;
    store.cam = mode;
    // 场景未初始化（renderer 惰性创建，首次 startPlayback 才有 controls）：只记录模式，
    // 初始化后由 animate 按 CAM/FOLLOW_EID 逐帧生效——名册点击可先于首帧发生。
    if (!controls) { invalidate(); return; }
    controls.enabled = true;
    invalidate();
    if (mode === 'top') {
      FOLLOW_EID = 0;
      const { cx, cz, ext } = WORLD_CENTER;
      camera.position.set(cx, ext * 1.7, cz + 0.01);
      controls.target.set(cx, 0, cz);
    } else if (mode === 'free') {
      FOLLOW_EID = 0;
    }
    // 跟随目标是名册的运行时状态（followed）。setFollow 也经由这里：暂停时没有帧在跑，
    // 换相机必须自己补写，否则跟随描边要等到下次播放 / seek 才出现。走 writeHud 而不是
    // 直接投影名册：播放中名册也不得跑到顶栏前面（两者始终同一个 T）。
    writeHud(true);
  }
  // 只接受档位表内的值：面板按钮与 URL 参数都不该把场景带进"1.37×"这种未定义速度
  function setSpeed(s) { if (!isPlaybackSpeed(s)) return; SPEED = s; store.speed = s; }

  // 键盘（空格 / ←→）由页面经 usePlaybackTransport 统一处理（与 2D 同一套键位与输入框防误触），
  // 场景内核不再自挂全局 keydown：原实现不区分输入框，会吞掉文本框里的空格。

  // ---------- 数据加载 ----------
  // 注：hull_yaw/turret_yaw 由后端相位解卷绕（连续域）后落盘，朴素线性插值即物理正确，
  // 前端不再二次去缠绕（旧版前端 unwrapAngleArray 已由后端数据契约取代）。

  // 递归收集 Object3D 子树的 geometry / material / texture 并各自 dispose 一次
  //（Set 去重：clone 共享的模板资源多路径命中只 dispose 一遍；three dispose 幂等，
  // 此处集合化只为省去重复遍历开销）
  function disposeObject3D(root) {
    const geos = new Set(), mats = new Set(), texs = new Set();
    root.traverse((o) => {
      if (o.geometry) geos.add(o.geometry);
      const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of ms) {
        mats.add(m);
        for (const k in m) {
          const val = m[k];
          if (val && val.isTexture) texs.add(val);
        }
      }
    });
    for (const t of texs) t.dispose();
    for (const m of mats) m.dispose();
    for (const g of geos) g.dispose();
  }

  // 动态层（弹道/弹着点/轨迹线）清除：与 seekTo 共用一条 dispose 路径
  function clearEffects() {
    // 与 clearTransients 同款：归池（对象留待复用），会话结束时由 disposeFxPool 统一释放
    for (const tr of tracers) {
      scene.remove(tr.mesh);
      fxGive('tracer', tr.mesh);
    }
    tracers.length = 0;
    for (const im of impacts) {
      scene.remove(im.g);
      fxGive('impact-' + im.kind, { g: im.g, ball: im.ball, ring: im.ring, sparks: im.sparks || [] });
    }
    impacts.length = 0;
    for (const tl of trajLines) {
      scene.remove(tl.mesh); fxGive('traj', tl.mesh);
    }
    trajLines.length = 0;
    clearTransients();   // 战斗反馈（飘字/爆散/幽灵段/受击闪）：seek 后不补播
  }

  // 会话拆除：车辆/标签/GLB 克隆/地图与地表/特效/GLB 模板缓存全部移出场景并
  // dispose 会话拥有的 GPU 资源；异步续体经 sessionGen 递增整体失效。
  // 调用时序：loadData 拿到新数据且代数有效后、startPlayback 之前（load A → dispose
  // A → load B）；destroy 亦走此路径（route/component destroy → dispose currentSession）。
  function teardownSession() {
    sessionGen++;
    clearEffects();
    disposeFxPool();   // 特效池（几何/材质/飘字画布贴图）随会话一次性释放
    if (boundaryGroup) {
      const shared = boundaryGroup.userData.sharedMaterial;
      if (shared) shared.dispose();
      scene.remove(boundaryGroup);
      disposeObject3D(boundaryGroup);
      boundaryGroup = null;
    }
    currentMapKey = null;
    clearBases();   // 基地贴地标记（圆环 + 圆盘贴图）随会话释放
    currentMapBases = null;
    for (const v of V) {
      if (v.glb) scene.remove(v.glb);          // clone 与模板共享资源：不在此 dispose
      if (v.group) { scene.remove(v.group); disposeObject3D(v.group); }
    }
    V = [];
    labelOverlay?.clear();
    labelsTime = null; labelsWrittenMs = -Infinity;
    reloadStateAt = () => null;
    tankDataByTankId = new Map();
    for (const o of [mapPlane, terrainMesh, mapScenery, groundMesh, gridHelper]) {
      if (o) { scene.remove(o); disposeObject3D(o); }
    }
    mapPlane = null; terrainMesh = null; mapScenery = null; groundMesh = null; gridHelper = null;
    sceneryMatCache.clear();   // 材质已随 mapScenery dispose，缓存须清空（勿复用已 dispose 实例）
    if (mapTexture) { mapTexture.dispose(); mapTexture = null; }
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
    store.playbackSession = null;
    // 会话终止 = 不再有任何可用的回放数据：就绪标记必须一起落下，否则新会话加载期间
    // （或 file=null / 被阻断 / 组件卸载之后）HUD 与播放传输仍会按「已就绪」渲染，
    // 而底层 DATA/车辆/贴图已经 dispose。destroy 与 loadData 的替换路径都经过这里。
    store.hasData = false;
    T = 0; shotPtr = 0; killPtr = 0;
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
    rosterRowsByEid.clear();
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
  async function startPlayback(epoch) {
    const current = () => epoch === sessionEpoch && !destroyed;
    // 入口即复核：数据阶段可能耗时到被取代，此时连渲染器都不该为它创建;
    if (!current()) return false;
    if (!renderer) initScene();   // 渲染器惰性创建：此时画质档已定型（loader 选择/URL 参数）
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
    buildRoster();
    // 会话级 mounted-configs 缓存（tank_id → tank/{id}.json）：先建 Map 再建 resolver——
    // resolver 闭包持有同一引用，异步填充后自动生效
    tankDataByTankId = new Map();
    reloadStateAt = createReloadStateResolver({ ...DATA, friendlyTeam: DATA.meta.friendly_team, mountedConfigs: tankDataByTankId });
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
    shotPtr = 0; killPtr = 0;
    if (DEBUG) window.__pbV = V;   // 调试钩子：控制台可查每车 GLB/位姿状态（仅 ?debug）
    if (glbOn) applyGlbToggle(true);   // 会话切换后按用户偏好恢复 GLB 车模
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
    seekFraction: (frac) => { if (DATA) seekTo(START + frac * (END - START)); },
    // 共用播放控件（PlaybackTransport）按绝对秒 seek / 跳秒；seekTo 自带 [START, END] 夹取（准备 / 倒计时阶段回不去）
    seekTime: (t) => { if (DATA) seekTo(t); },
    seekBy: (delta) => { if (DATA) seekTo(T + delta); },
    setBattleClock,
    setCam,
    setFollow,
    setGlb: (on) => { if (Q.allowGlb || !on) applyGlbToggle(on); invalidate(); },
    /**
     * 共享标签偏好（唯一 owner = usePlaybackPreferences）。契约：
     * - `enabled:false` → 整层名牌隐藏（覆盖层上还有伤害飘字，它是战斗反馈而非名牌，
     *   关名牌时数字仍要可见——updateLabels 每帧也会重算同一条件）；
     * - `showPlayerName / showTankName / showHp / showReload` → 名牌内部的行开关。
     */
    setLabelPrefs: (prefs) => {
      const enabled = !prefs || prefs.enabled !== false;
      store.labelsOn = enabled;
      setLabelPrefs(prefs || {});
      if (camera) updateLabels();
    },
    setQuality,
    setPaused,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      destroyed = true;
      loadGeneration++;
      sessionEpoch++;
      store.loading = false;
      store.assetStage = false;
      store.assetProgress = null;
      // 使本实例所有在途 loadData 的归属判定永久失效：仅有 `destroyed` 也能挡住，
      // 但把加载令牌一并推进让「被销毁的实例」与「被取代的加载」走同一条判定路径
      // （ownsLoading 同时看 destroyed 与 loadGeneration），不依赖单一标志。
      cancelAnimationFrame(rafId);   // 显式取消：不等下一帧的 destroyed 自然退出
      teardownSession();             // 会话资源（车辆/地图/特效/GLB 模板）全量 dispose
      removeEventListener('resize', onResize);
      sizeObserver?.disconnect();
      sizeObserver = null;
      if (DEBUG) {
        delete window.__scene; delete window.__camera; delete window.__controls; delete window.__setFollow; delete window.__renderer;
        delete window.__pbV; delete window.__gdbg;
      }
      // ?perf 看门狗随实例销毁停表并摘除调试句柄：实例没了帧循环自然停，但心跳
      // setInterval 不清会永久空转，window.__pbPerf 会指向已销毁实例的旧数据。
      if (PERF) {
        if (perfBeatTimer) { clearInterval(perfBeatTimer); perfBeatTimer = 0; }
        delete window.__pbPerf;
      }
      if (renderer) {
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
