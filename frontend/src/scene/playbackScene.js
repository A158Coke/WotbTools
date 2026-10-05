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
import { buildDestructibleIndex, foldDestructibleStates, fallRotation, fallTipVector, fallStopAngle } from './destructibles.js'
import { sampleChannel, sampleKeyframes } from './trackInterp.js'
import { pathPointsOf, legSecsOf, legEndTimes, pointAt, legArcEnds, arcAtTime, pointAtArc } from './shotPath.js'
import { impactKind } from './impactKind.js'
import { ROSTER_GROUPS, applyRosterRuntime, buildRosterRows, hpPercentText, projectRoster } from './rosterState.js'
import { DMG_ASPECT, DMG_TEX_H, DMG_TEX_W, dmgWorldHeight, floatDmgAnim } from './floatDmg.js'
import { createReloadStateResolver, inferMagazineSize, resolveMagazineSize } from './reloadBar.js'
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

/**
 * AABB 覆盖的全部粗格。静态 mesh 入格与 camera→label 的线段 traversal 是两种问题：
 * 入格必须覆盖包围球投影的整个方框，不能拿对角线采样代替，否则大建筑会漏掉非对角格。
 */
export function occlusionCoverageCells(minX, minY, maxX, maxY, cell = 16) {
  const out = new Set();
  const gx0 = Math.floor(Math.min(minX, maxX) / cell);
  const gx1 = Math.floor(Math.max(minX, maxX) / cell);
  const gy0 = Math.floor(Math.min(minY, maxY) / cell);
  const gy1 = Math.floor(Math.max(minY, maxY) / cell);
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) out.add(`${gx},${gy}`);
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
  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11161d);
    if (DEBUG) window.__scene = scene;
    camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 4000);
    camera.position.set(0, 180, 220);
    renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, logarithmicDepthBuffer: LOGDEPTH });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.maxDpr));
    if (DEBUG) window.__renderer = renderer;
    if (DEBUG) window.__camera = camera;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    labelScene = new THREE.Scene();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;
    if (DEBUG) window.__controls = controls;
    if (DEBUG) window.__setFollow = setFollow;
    clock = new THREE.Clock();
    raycaster = new THREE.Raycaster();
    scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x2a2f36, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.0); sun.position.set(120, 260, 80); scene.add(sun);
    addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') {
      sizeObserver = new ResizeObserver(onResize);
      sizeObserver.observe(container);
    }
    renderer.domElement.addEventListener('pointerdown', onScenePointerDown);
    renderer.domElement.addEventListener('pointerup', onScenePointerUp);
  }
  function onResize() {
    if (!renderer) return;
    const w = Math.max(1, Math.round(container.clientWidth));
    const h = Math.max(1, Math.round(container.clientHeight));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    invalidate();
  }
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
    if (moved <= SCENE_CLICK_SLOP_PX) onVehicleSelect?.(null, e);
  }

  const BOUNDARY_COLOR = 0xff2f2f;
  const BOUNDARY_THICK = 1.8;
  const BOUNDARY_STEP = 2.0;
  function playableBoundsFor() {
    const pb = (heightMeta && heightMeta.playableBounds) || playableBounds[currentMapKey];
    if (!pb) return null;
    const sxMin = -pb.xMax, sxMax = -pb.xMin;
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
  function buildBoundary(bounds, thick) {
    clearBoundary();
    if (!bounds) return;
    const { cx, cz, hx, hz } = bounds;
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz;
    const path = [];
    const push = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / BOUNDARY_STEP));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        path.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      }
    };
    push(x0, z0, x1, z0); push(x1, z0, x1, z1); push(x1, z1, x0, z1); push(x0, z1, x0, z0);
    const N = path.length;
    const pos = new Float32Array(N * 2 * 3);
    const idx = [];
    const half = thick / 2;
    for (let i = 0; i < N; i++) {
      const [px, pz] = path[i];
      const [nx2, nz2] = path[(i + 1) % N];
      const [ox, oz] = path[(i - 1 + N) % N];
      let tx = nx2 - ox, tz = nz2 - oz;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const lx = -tz, lz = tx;
      const y = groundY(px, pz) + 0.06;
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
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    g.userData.sharedMaterial = mat;
    boundaryGroup = g;
    scene.add(g);
  }
  function applyCameraClamp() {
    const { ext } = WORLD_CENTER;
    controls.minDistance = Math.max(20, ext * 0.08);
    controls.maxDistance = ext * 2.2;
  }
  function clampCameraTarget() {
    if (FOLLOW_EID) return;
    const { cx, cz, ext } = WORLD_CENTER;
    const lim = ext * 1.1;
    const t = controls.target;
    const nx = Math.min(cx + lim, Math.max(cx - lim, t.x));
    const nz = Math.min(cz + lim, Math.max(cz - lim, t.z));
    if (nx !== t.x) t.x = nx;
    if (nz !== t.z) t.z = nz;
  }
  function buildWorld() {
    const xs = [], zs = [];
    for (const def of DATA.vehicles)
      for (let i = 0; i < def.pos.length; i += 9) { xs.push(def.pos[i]); zs.push(def.pos[i+2]); }
    xs.sort((a,b)=>a-b); zs.sort((a,b)=>a-b);
    const q = (a, f) => a.length ? a[Math.floor((a.length-1) * f)] : 0;
    const ex = Math.max(q(xs, .98) - q(xs, .02), 200) * 0.65;
    const ez = Math.max(q(zs, .98) - q(zs, .02), 200) * 0.65;
    const m = Math.max(ex, ez);
    let ext = isFinite(m) && m > 0 ? Math.ceil(m / 50) * 50 : 300;
    let cx = -((q(xs, .98) + q(xs, .02)) / 2), cz = (q(zs, .98) + q(zs, .02)) / 2;
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
    scene.add(ground); groundMesh = ground;
    const grid = new THREE.GridHelper(ext * 2 + 100, Math.floor((ext * 2 + 100) / 50), 0x3a4a5e, 0x273140);
    grid.position.set(cx, 0.02, cz); scene.add(grid); gridHelper = grid;
    buildBoundary(playableBoundsFor(), BOUNDARY_THICK);
    WORLD_CENTER = { cx, cz, ext };
    camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
    controls.target.set(cx, 0, cz);
    applyCameraClamp();
  }
  let WORLD_CENTER = { cx: 0, cz: 0, ext: 300 };

  const sceneryMatCache = new Map();
  function cachedSceneryMat(key, factory) {
    let m = sceneryMatCache.get(key);
    if (!m) { m = factory(); sceneryMatCache.set(key, m); }
    return m;
  }
  const CARD_ALPHA_CUT = 0.33;
  const SCENERY_LAMBERT_EXPOSURE = 0.75;
  const isWaterName = (n) => /water|sea|lake|river|fountain/i.test(n || '');
  function makeBillboardMaterial(m) {
    const occRaw = m.userData && Number(m.userData.occMean);
    const occMean = Number.isFinite(occRaw) && occRaw > 0 ? occRaw : 0.8;
    const shTintRaw = m.color ? Number(m.color.r) : NaN;
    const shTint = Number.isFinite(shTintRaw) && shTintRaw > 0 ? shTintRaw : 1.77;
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
    const epoch = sessionEpoch;
    const stale = () => destroyed || epoch !== sessionEpoch;
    if (mapPlane) { scene.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; }
    if (mapScenery) { scene.remove(mapScenery); mapScenery = null; }
    destruct = null;
    mapTexture = null; mapMetaInfo = null; heightField = null; heightMeta = null;
    occlGrid = null;
    groundLayers = null;
    const mid = DATA.meta.map_id || 0;
    const mapq = mid ? ('id=' + mid) : ('name=' + encodeURIComponent(DATA.meta.map_name || ''));
    const resolvedKey = await resolveMapKey(mapq).catch(() => null);
    if (stale()) return;
    currentMapKey = resolvedKey;
    store.mapKey = resolvedKey;
    currentMapBases = resolvedKey ? (mapBases[resolvedKey] || null) : null;
    const progress = createLoadProgress((snap) => { if (!stale()) store.assetProgress = snap.fraction; });
    const mapUrlPlanned = (Q.miniMap ? mapStaticUrl('map-mini', undefined, resolvedKey) : null) ?? mapStaticUrl('map', undefined, resolvedKey);
    if (mapUrlPlanned) progress.expect('map');
    if (mapStaticUrl('terrain', undefined, resolvedKey)) progress.expect('terrain');
    if (Q.groundLayers && mapStaticUrl('groundmeta', undefined, resolvedKey)) progress.expect('ground');
    if (Q.scenery && mapStaticUrl('scenery', undefined, resolvedKey)) progress.expect('scenery');
    try {
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
          try { texture = await new THREE.TextureLoader().loadAsync(url); }
          finally { URL.revokeObjectURL(url); }
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
      const terrainBin = mapStaticUrl('terrain', undefined, resolvedKey);
      let tmeta = {}; let tbuf = null;
      if (terrainBin) {
        const m = await assetProvider.fetch(mapStaticUrl('terrain-meta', undefined, resolvedKey));
        if (stale()) return;
        if (m.ok) {
          tmeta = await m.json();
          if (stale()) return;
          const wb = tmeta.worldBounds;
          if (Array.isArray(wb?.min) && Array.isArray(wb?.max)) {
            const dx = wb.max[0] - wb.min[0];
            const dy = wb.max[1] - wb.min[1];
            if (dx > 0 || dy > 0) tmeta.span = Math.max(dx, dy);
          }
        }
        const b = await assetProvider.fetch(terrainBin);
        if (stale()) return;
        if (b.ok) { tbuf = await b.arrayBuffer(); if (stale()) return; }
      }
      const meta = tmeta;
      const n = meta.size || 512;
      const buf = tbuf;
      if (buf && buf.byteLength === n * n * 2) {
        const u16 = new Uint16Array(buf);
        heightMeta = meta;
        heightField = new Float32Array(n * n);
        const zmin = meta.zmin || 0;
        const k = ((meta.zmax || 100) - zmin) / 65535;
        for (let i = 0; i < u16.length; i++) heightField[i] = u16[i] * k + zmin;
      }
    } catch (e) { console.warn('地形加载失败（回退 2D）:', e); }
    if (stale()) return;
    progress.complete('terrain');
    if (Q.groundLayers) try {
      const gmUrl = mapStaticUrl('groundmeta', undefined, resolvedKey);
      if (gmUrl) {
        const mresp = await assetProvider.fetch(gmUrl);
        if (stale()) return;
        if (mresp.ok) {
          const L = await mresp.json();
          if (stale()) return;
          const need = L.height_blend
            ? ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1', 'hmap0', 'hmap1']
            : ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1'];
          const texs = {};
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
                  try { t = await new THREE.TextureLoader().loadAsync(u); }
                  finally { URL.revokeObjectURL(u); }
                  if (stale()) t.dispose();
                  else { texs[k] = t; okOne = true; }
                }
              }
            } catch { okOne = false; }
            progress.update('ground', ++texDone, need.length);
            return okOne;
          });
          if (stale()) { for (const k in texs) texs[k]?.dispose?.(); return; }
          const ok = loaded.every(Boolean);
          if (ok) {
            const ani = Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy());
            for (const k of ['tile0', 'tile1', 'hmap0', 'hmap1']) if (texs[k]) {
              texs[k].wrapS = texs[k].wrapT = THREE.RepeatWrapping;
              texs[k].anisotropy = ani;
            }
            for (const k of ['cm', 'lm', 'mask0', 'mask1']) if (texs[k]) texs[k].anisotropy = ani;
            groundLayers = { layers: L, texs };
          } else {
            for (const k in texs) texs[k]?.dispose?.();
          }
        }
      }
    } catch (e) { console.warn('分层地表加载失败（回退烘焙底图）:', e); }
    if (stale()) return;
    progress.complete('ground');
    if (DEBUG) window.__gdbg = { layers: !!groundLayers, texs: groundLayers ? Object.keys(groundLayers.texs) : [],
                                 meta: !!mapMetaInfo, sizeM: mapMetaInfo?.size_m ?? null };
    rebuildGround();
    if (Q.scenery) try {
      const destructUrl = mapStaticUrl('destructibles', undefined, resolvedKey);
      const destructDocPromise = destructUrl
        ? assetProvider.fetch(destructUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        : Promise.resolve(null);
      if (DEBUG) destructDocPromise.then((d) => { window.__destructStage = d ? 'doc-ok' : 'doc-missing'; });
      const sceneryUrl = mapStaticUrl('scenery', undefined, resolvedKey);
      if (sceneryUrl) {
        const gltf = await new Promise((res) => {
          new GLTFLoader().load(sceneryUrl,
            (g) => res(g),
            (e) => { if (e) progress.update('scenery', e.loaded, e.lengthComputable ? e.total : 0); },
            () => res(null));
        });
        if (stale()) { if (gltf?.scene) disposeObject3D(gltf.scene); return; }
        if (gltf && gltf.scene) {
          const convMat = (m, isCard) => cachedSceneryMat(
            [isCard ? 'C' : 'M', m.name || '', m.map ? m.map.uuid : '',
             m.color ? [m.color.r, m.color.g, m.color.b].map((v) => v.toFixed(4)).join(',') : '',
             m.alphaMode || '', m.alphaTest ?? 0, !!m.transparent, m.opacity ?? 1,
             (m.userData && m.userData.occMean) || ''].join('|'),
            () => (isCard ? makeBillboardMaterial(m) : (() => {
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
                bm.alphaTest = opaqueEnough ? 0.33 : 0.05;
                bm.toneMapped = false;
                return bm;
              }
              const pseudoOpaque = !!m.transparent && (m.opacity ?? 1) >= 0.99;
              const nm = new THREE.MeshLambertMaterial({
                map: m.map || null,
                color: (m.color ? m.color.clone() : new THREE.Color(0xffffff))
                  .multiplyScalar(SCENERY_LAMBERT_EXPOSURE),
                transparent: !!m.transparent && !pseudoOpaque,
                opacity: m.opacity ?? 1,
                side: THREE.DoubleSide,
              });
              if (m.alphaTest > 0) nm.alphaTest = m.alphaTest;
              if (pseudoOpaque) nm.alphaTest = Math.max(nm.alphaTest || 0, 0.33);
              if (nm.transparent) nm.depthWrite = false;
              nm.flatShading = true;
              return nm;
            })()));
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
          for (const o of degradedMeshes) { o.removeFromParent(); o.geometry.dispose(); }
          if (DEBUG) window.__degradedSkipped = degradedMeshes.length;
          gltf.scene.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const isCard = !!o.geometry.attributes._corner;
            o.material = Array.isArray(o.material) ? o.material.map((m) => convMat(m, isCard))
                                                   : convMat(o.material, isCard);
            if (isWaterName(o.name)) {
              const ms = Array.isArray(o.material) ? o.material : [o.material];
              for (const mm of ms) {
                if (!mm || !mm.transparent) continue;
                mm.depthWrite = true;
                mm.side = THREE.DoubleSide;
                mm.depthTest = true;
                mm.needsUpdate = true;
              }
            }
            if (isCard) {
              if (o.geometry.boundingSphere) o.geometry.boundingSphere.radius += 2;
            }
          });
          mapScenery = new THREE.Group();
          mapScenery.rotation.order = 'YXZ';
          mapScenery.rotation.set(-Math.PI / 2, Math.PI, 0);
          mapScenery.add(gltf.scene);
          scene.add(mapScenery);
          gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            if (/sky/i.test(o.name || '')) o.visible = false;
          });
          const MESH_MATCH_R = 0.02;
          const meshGrid = new Map();
          const gridKey = (x, y) => `${Math.round(x / 2)},${Math.round(y / 2)}`;
          const occGrid = new Map();
          gltf.scene.traverse((o) => {
            if (!o.isMesh || !o.name) return;
            if (o.name.startsWith('D_')) { o.visible = false; }
            let wx = 0, wy = 0, n = o;
            while (n && n !== gltf.scene) { wx += n.position.x; wy += n.position.y; n = n.parent; }
            const k = gridKey(wx, wy);
            (meshGrid.get(k) || meshGrid.set(k, []).get(k)).push({ mesh: o, x: wx, y: wy });
            if (o.visible && !/sky/i.test(o.name)) {
              if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
              const r = o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 0;
              const c = occlusionCoverageCells(wx - r, wy - r, wx + r, wy + r, OCCL_CELL);
              for (const key of c) {
                const list = occGrid.get(key);
                if (list) { if (!list.includes(o)) list.push(o); }
                else occGrid.set(key, [o]);
              }
            }
          });
          occlGrid = occGrid;
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
            const worldZ = (m) => { let z = m.position.z, n = m.parent; while (n && n !== gltf.scene) { z += n.position.z; n = n.parent; } return z; };
            for (const st of states) {
              const [px, py] = st.inst.pos;
              if (st.prop === 3) {
                const hits = findMeshes(px, py, false);
                if (!hits.length) continue;
                const pivot = new THREE.Group();
                pivot.position.set(px, py, worldZ(hits[0].mesh));
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
      const geo = new THREE.PlaneGeometry(size, size, Q.terrainSeg, Q.terrainSeg);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) pos.setZ(k, sampleHeight(-pos.getX(k), pos.getY(k)));
      geo.computeVertexNormals();
      let mat;
      if (groundLayers) mat = groundShaderMaterial(groundLayers.layers, groundLayers.texs, size, meta.x || 0, meta.z || 0);
      else { mat = new THREE.MeshBasicMaterial({ map: mapTexture }); mat.toneMapped = false; }
      terrainMesh = new THREE.Mesh(geo, mat);
      terrainMesh.rotation.set(-Math.PI / 2, 0, Math.PI);
      terrainMesh.position.set(meta.x || 0, 0, meta.z || 0);
      scene.add(terrainMesh);
    } else if (mapTexture) {
      const mat = new THREE.MeshBasicMaterial({ map: mapTexture }); mat.toneMapped = false;
      mapPlane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mapPlane.rotation.set(-Math.PI / 2, 0, Math.PI + (meta.rot90 || 0) * Math.PI / 2);
      mapPlane.position.set(meta.x || 0, 0.04, meta.z || 0);
      scene.add(mapPlane);
    }
    buildBoundary(playableBoundsFor(), BOUNDARY_THICK);
    regroundBases();
  }

  function teamColor(v) {
    const f = DATA.meta.friendly_team, t = v.def.team;
    if (t === 0 || f === 0) return COLOR_UNKNOWN;
    return t === f ? COLOR_FRIENDLY : COLOR_ENEMY;
  }

  const BASE_TEX = 256;
  const BASE_COLOR_FALLBACK = { friendly: '#5cc280', enemy: '#f2786d', neutral: '#f5f5f5', objective: '#ffc24b', onNeutral: '#1c1f1d' };
  let baseObjects = [];
  let baseColors = BASE_COLOR_FALLBACK;
  let supremacyBaseIds = [];
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
  const ASSAULT_RADIUS_FALLBACK = 20;
  const ASSAULT_PROGRESS_COLOR = 0xffc24b;
  function assaultHasObjective() {
    if (DATA.assault_objective_present === true) return true;
    if (DATA.assault_objective_present === undefined) return !!(DATA.assault_bases && DATA.assault_bases.length);
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
                reground: () => {
                  ring.geometry.dispose(); ring.geometry = makeGroundedRing(gx, gz, r);
                  disc.geometry.dispose(); disc.geometry = makeGroundedDisc(gx, gz, r * 0.9);
                  b.uvDir = null;
                } };
    baseObjects.push(b);
  }
  function buildBases() {
    clearBases(); baseColors = readBaseColors();
    const tracks = DATA.supremacy_bases || [];
    if (tracks.length) {
      const seen = new Set(tracks.map((tr) => SUPREMACY_BASE_IDS[tr.base_id]).filter(Boolean));
      const pts = (currentMapBases && currentMapBases.supremacy) || [];
      for (const p of pts) {
        if (!SUPREMACY_BASE_IDS.includes(p.baseId)) continue;
        seen.add(p.baseId); addBaseMarker(p.baseId, 'supremacy', -p.x, p.y, p.radius || 15);
      }
      supremacyBaseIds = SUPREMACY_BASE_IDS.filter((id) => seen.has(id));
    }
    if (assaultHasObjective()) {
      const pts = (currentMapBases && currentMapBases.assault) || [];
      if (pts.length === 1) addBaseMarker(ASSAULT_BASE_ID, 'assault', -pts[0].x, pts[0].y, pts[0].radius || ASSAULT_RADIUS_FALLBACK);
    }
  }
  function regroundBases() { for (const b of baseObjects) b.reground(); }
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
    ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = 0.2; ctx.fillStyle = owner; ctx.fillRect(0, 0, S, S);
    const fillColor = view.kind === 'assault' ? baseColors.objective : (view.capturing ? baseColors[view.capturing] : null);
    if (fillColor && view.progress != null) {
      const h = 2 * R * (view.progress / 100);
      ctx.globalAlpha = 0.5; ctx.fillStyle = fillColor; ctx.fillRect(0, c + R - h, S, h);
    }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    if (view.kind === 'supremacy') {
      ctx.font = 'bold 132px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeText(b.baseId, c, c + 6); ctx.fillStyle = owner; ctx.fillText(b.baseId, c, c + 6);
    } else {
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
      const dx = b.gx - camera.position.x, dz = b.gz - camera.position.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ux = dx / len, uz = dz / len;
      if (!b.uvDir || ux * b.uvDir[0] + uz * b.uvDir[1] < 0.9994) {
        orientDisc(b.disc.geometry, ux, uz); b.uvDir = [ux, uz];
      }
    }
  }
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
        offsets[k * 2] = dx / radius; offsets[k * 2 + 1] = dz / radius; k++;
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
    geo.setIndex(idx); geo.userData.offsets = offsets; return geo;
  }
  function orientDisc(geo, ux, uz) {
    orientDiscUv(geo.userData.offsets, geo.attributes.uv.array, ux, uz);
    geo.attributes.uv.needsUpdate = true;
  }
  function makeGroundedRing(gx, gz, radius, seg = 72) {
    const pos = new Float32Array((seg + 1) * 2 * 3); const idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const xo = gx + ca * radius, zo = gz + sa * radius;
      const xi = gx + ca * radius * 0.9, zi = gz + sa * radius * 0.9;
      pos[i * 6] = xo; pos[i * 6 + 1] = groundY(xo, zo) + 0.08; pos[i * 6 + 2] = zo;
      pos[i * 6 + 3] = xi; pos[i * 6 + 4] = groundY(xi, zi) + 0.08; pos[i * 6 + 5] = zi;
    }
    for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
  }
  function groundY(x, z) { return sampleHeight(x, z) + 0.12; }

  const LABEL_OCCL_SAMPLES = 16;
  const LABEL_OCCL_BUDGET_MS = 4;
  let occlCursor = 0, occlTick = 0, occlStride = 1, occlCostMs = 0;
  const _occlDir = new THREE.Vector3();
  const OCCL_CELL = 16;
  let occlGrid = null;
  const OCCL_MAX_CANDIDATES = 400;
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
        seenObj.add(m); cands.push(m);
      }
    }
    if (!cands.length || cands.length > OCCL_MAX_CANDIDATES) return false;
    const prevFar = raycaster.far;
    raycaster.far = dist - 1.0;
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
    if (++occlTick < occlStride) return;
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
    } else occlCostMs = 0;
    v.labelOccluded = blocked;
  }

  let reloadStateAt = () => null;
  let labelsWrittenMs = -Infinity;
  let labelsTime = null;
  let labelsReloadActive = false;
  const LABEL_INTERVAL_RELOAD_MS = 33;
  const LABEL_INTERVAL_IDLE_MS = 100;
  const labelClip = new THREE.Vector4();
  function publishLabels(force = false) {
    if (!DATA || !labelOverlay || !store.labelsOn) return;
    const now = performance.now();
    const interval = labelsReloadActive ? LABEL_INTERVAL_RELOAD_MS : LABEL_INTERVAL_IDLE_MS;
    if (!force && (T === labelsTime || now - labelsWrittenMs < interval)) return;
    labelsWrittenMs = now; labelsTime = T;
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
        reload: destroyed ? null : reloadStateAt(v.def.eid, T, v.reloadSize),
        hpGhost: ghost ? { prevPct: (ghost.fromFrac + ghost.lossFrac) * 100, nextPct: ghost.fromFrac * 100 } : null,
        hpFlash: flashByEid.has(v.def.eid),
      };
    });
    labelsReloadActive = rows.some((r) => Array.isArray(r.reload)
      && r.reload.some((sh) => sh.state === 'loading'));
    labelOverlay.setLabels(rows);
  }
  function setLabelPrefs() { labelsTime = null; publishLabels(true); invalidate(); }
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
    const hullProfile = new THREE.Shape();
    hullProfile.moveTo(-1.6, -3.1); hullProfile.lineTo(1.6, -3.1); hullProfile.lineTo(1.6, 1.15);
    hullProfile.lineTo(0, 3.1); hullProfile.lineTo(-1.6, 1.15); hullProfile.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hullProfile, { depth: 1.05, bevelEnabled: false });
    hullGeo.rotateX(Math.PI / 2); hullGeo.translate(0, 1.45, 0);
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
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.userData.keepWithGlb = true; g.add(ring);
      }
      const v = { def, group: g, turretG, gunPivot, meshHull: hull };
      v.labelAnchor = new THREE.Vector3(); scene.add(g); V.push(v);
    }
  }

  async function loadGlb(tankId) {
    const cache = glbCache;
    if (cache.has(tankId)) return cache.get(tankId);
    const p = (async () => {
      try {
        const [glbBytes, sd] = await Promise.all([
          assetProvider.bytes(`/glb/${tankId}/model.glb`),
          assetProvider.json(`/tank/${tankId}.json`).catch(() => null),
        ]);
        const model = await new Promise((res) =>
          new GLTFLoader().parse(glbBytes.buffer, '', (g) => res(g.scene), () => res(null)));
        if (!model) return null;
        model.scale.setScalar(1);
        neutralizeDefaultMetalness(model);
        dropDuplicateGunMasks(model);
        return { template: model, sd };
      } catch { return null; }
    })();
    cache.set(tankId, p);
    p.then((entry) => { if (!entry) cache.delete(tankId); }).catch(() => cache.delete(tankId));
    return p;
  }
  function collectGlbParts(model, sd, sel) {
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
    const cfgs = (sd && sd.configs && sd.configs.length) ? sd.configs : null;
    const gi = (sel && sel.gun_index != null) ? sel.gun_index : (cfgs ? cfgs[cfgs.length - 1].gun_index : 0);
    const ti = (sel && sel.turret_index != null) ? sel.turret_index : (cfgs ? cfgs[cfgs.length - 1].turret_index : 0);
    gunGroups.forEach((grp, i) => grp.forEach(n => n.visible = (i === (gi % gunGroups.length))));
    turrets.forEach((n, i) => n.visible = (i === (ti % turrets.length)));
    const turretNode = turrets.length ? turrets[ti % turrets.length] : null;
    const grp = gunGroups.length ? gunGroups[gi % gunGroups.length] : [];
    const barrelNodes = grp.filter(n => /^gun_\d+(_mask)?$/.test(n.name || ''));
    const gunNodes = barrelNodes.length ? barrelNodes : grp;
    const mo = sd && sd.model_origins;
    if (!turretNode || !mo || !mo.track || !mo.turret) {
      console.warn('[playback] glb parts incomplete: turret=' + !!turretNode + ' origins=' + !!(mo && mo.track));
      return null;
    }
    const tP = [mo.track[0] + mo.turret[0], mo.track[1] + mo.turret[1], mo.track[2] + mo.turret[2]];
    const cfg = cfgs ? (cfgs.find(c => c.turret_index === ti && c.gun_index === gi) || cfgs[cfgs.length - 1]) : null;
    const gP = (cfg && cfg.gun_origin)
      ? [tP[0] + cfg.gun_origin[0], tP[1] + cfg.gun_origin[1], tP[2] + cfg.gun_origin[2]]
      : tP.slice();
    return { turretNode, gunNodes, tP, gP, itr: (sd && sd.initial_turret_rotation) || null };
  }
  const _glbQuat = new THREE.Quaternion();
  const _glbEuler = new THREE.Euler();
  const _mRot = new THREE.Matrix4(), _mTmpA = new THREE.Matrix4(), _mTmpB = new THREE.Matrix4();
  const _mTmpC = new THREE.Matrix4(), _mTmpD = new THREE.Matrix4(), _mT = new THREE.Matrix4();
  const _mG = new THREE.Matrix4(), _mAcc = new THREE.Matrix4();
  function poseGlb(v) {
    v.glb.position.copy(v.group.position);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, T), hullPitchAt(v, T), -rollAt(v, T), _glbQuat));
    const p = v.glbParts;
    if (!p) return;
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    const tr = -rel;
    const gr = gunPitchAt(v, T);
    if (p.itr) {
      _glbEuler.set(-THREE.MathUtils.degToRad(p.itr.pitch || 0), -THREE.MathUtils.degToRad(p.itr.roll || 0),
                    tr - THREE.MathUtils.degToRad(p.itr.yaw || 0), 'ZYX');
      _mRot.makeRotationFromEuler(_glbEuler);
    } else _mRot.makeRotationZ(tr);
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
      await mapLimit(V.filter(v => v.def.tank_id > 0), ASSET_CONCURRENCY, async (v) => {
        if (!v.glb) {
          const loaded = await loadGlb(v.def.tank_id);
          if (gen !== sessionGen) return;
          if (loaded && glbOn && !v.glb) {
            const inst = loaded.template.clone(); inst.scale.setScalar(1);
            v.glb = inst;
            v.glbParts = collectGlbParts(inst, loaded.sd,
              { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            v.glb.visible = v.group.visible; scene.add(v.glb);
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
  function setLowPoly(v, show) {
    for (const c of v.group.children) {
      if (c.userData.keepWithGlb) continue;
      c.visible = show;
    }
  }

  const TRACER_LEN = 9;
  const TRAJ_OPACITY = 0.85;
  const TRACER_RADIUS = 0.36;
  const TRAJ_RADIUS = 0.18;
  const FX_SCALE = 2;
  let trajLines = [];
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
    const color = shotTeamColor(s);
    const mesh = fxTake('tracer', () => new THREE.Mesh(
      new THREE.BoxGeometry(TRACER_RADIUS, TRACER_RADIUS, TRACER_LEN),
      new THREE.MeshBasicMaterial({ color, toneMapped: false })));
    mesh.material.color.setHex(color); mesh.visible = true; scene.add(mesh);
    const pts3 = pathPointsOf(s).map(([x, y, z]) => [-x, y, z]);
    const legSecs = legSecsOf(s, tracerSpanSecs(s.flight_secs));
    const legEnds = legEndTimes(legSecs, s.t_fire);
    const t1 = legEnds[legEnds.length - 1];
    const impactPos = new THREE.Vector3().fromArray(pts3[1]);
    tracers.push({ mesh, points: pts3, legEnds, arcEnds: legArcEnds(pts3), t0: s.t_fire, t1, shot: s, color,
      from: new THREE.Vector3().fromArray(pts3[0]), to: impactPos.clone(), impactPos });
    for (let k = 0; k + 1 < pts3.length; k++) {
      const a = new THREE.Vector3().fromArray(pts3[k]);
      const b = new THREE.Vector3().fromArray(pts3[k + 1]);
      const trajLen = a.distanceTo(b);
      if (!(trajLen > 1e-3)) continue;
      const traj = fxTake('traj', () => new THREE.Mesh(
        new THREE.BoxGeometry(TRAJ_RADIUS, TRAJ_RADIUS, 1),
        new THREE.MeshBasicMaterial({
          color: shotTeamColor(s), transparent: true, opacity: TRAJ_OPACITY, depthWrite: false,
          toneMapped: false,
        })));
      traj.material.color.setHex(shotTeamColor(s)); traj.material.opacity = TRAJ_OPACITY;
      traj.scale.set(1, 1, trajLen); traj.visible = true;
      traj.position.copy(a.clone().add(b).multiplyScalar(0.5)); traj.lookAt(b); scene.add(traj);
      trajLines.push({ mesh: traj, until: t1 + 0.5 * FX_SCALE, fadeEnd: t1 + 1.1 * FX_SCALE, base: TRAJ_OPACITY });
    }
  }
  function shotTeamColor(s) {
    const d = DATA.vehicles.find((x) => x.eid === s.shooter_eid);
    const t = d ? d.team : 0;
    const ft = DATA.meta.friendly_team;
    if ((t !== 1 && t !== 2) || (ft !== 1 && ft !== 2)) return COLOR_UNKNOWN;
    return t === ft ? TRACER_FRIENDLY : TRACER_ENEMY;
  }
  const IMPACT_WHITE = 0xffffff;
  function makeImpactFx(kind) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(kind === 'nonpen' ? 0.42 : 0.72, 10, 10),
      new THREE.MeshBasicMaterial({ color: IMPACT_WHITE, transparent: true }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 20),
      new THREE.MeshBasicMaterial({ color: IMPACT_WHITE, side: THREE.DoubleSide, transparent: true }));
    ring.rotation.x = -Math.PI / 2; g.add(ball); g.add(ring);
    const sparks = [];
    if (kind === 'ricochet') {
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
    ball.material.opacity = 1; ring.material.opacity = 1; ring.scale.setScalar(1);
    for (const sp of sparks) sp.material.opacity = 1;
    if (kind === 'ricochet') {
      const dir = tr.to.clone().sub(tr.from).normalize();
      const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
      for (let i = 0; i < sparks.length; i++) {
        const sgn = i === 0 ? 1 : -1; const sp = sparks[i];
        sp.position.set(side.x * sgn * 1.1, 0, side.z * sgn * 1.1);
        sp.rotation.y = Math.atan2(side.x * sgn, side.z * sgn);
      }
    }
    g.position.copy(tr.impactPos); g.visible = true; scene.add(g);
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
        impacts.splice(i, 1); continue;
      }
      const op = 1 - k;
      im.ball.material.opacity = op;
      im.ring.material.opacity = op * 0.8;
      im.ring.scale.setScalar(1 + k * (im.kind === 'nonpen' ? 2.2 : 1.6));
      if (im.sparks) for (const sp of im.sparks) sp.material.opacity = op * 0.7;
    }
  }
  const _tpA = new THREE.Vector3(), _tpB = new THREE.Vector3();
  function updateTracers() {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      if (T < tr.t0) continue;
      const headArr = pointAt(tr.points, tr.legEnds, T, tr.t0);
      const sHead = arcAtTime(tr.points, tr.legEnds, tr.arcEnds, T, tr.t0);
      const tailArr = pointAtArc(tr.points, tr.arcEnds, sHead - TRACER_LEN);
      const head = _tpA.set(headArr[0], headArr[1], headArr[2]);
      _tpB.set(tailArr[0], tailArr[1], tailArr[2]);
      tr.mesh.position.copy(head.clone().add(_tpB).multiplyScalar(0.5));
      tr.mesh.lookAt(head);
      tr.mesh.scale.z = Math.max(0.001, Math.hypot(head.x - _tpB.x, head.y - _tpB.y, head.z - _tpB.z) / TRACER_LEN);
      if (T >= tr.t1) {
        scene.remove(tr.mesh); fxGive('tracer', tr.mesh); tracers.splice(i, 1); spawnImpact(tr);
      }
    }
    for (let i = trajLines.length - 1; i >= 0; i--) {
      const tl = trajLines[i];
      if (T >= tl.fadeEnd) {
        scene.remove(tl.mesh); fxGive('traj', tl.mesh); trajLines.splice(i, 1); continue;
      }
      tl.mesh.material.opacity = T <= tl.until ? tl.base
        : tl.base * Math.max(0, 1 - (T - tl.until) / (tl.fadeEnd - tl.until));
    }
  }

  const ghostByEid = new Map();
  const flashByEid = new Map();
  let floatDmgs = [];
  let burstFx = [];
  let dmgEvents = [];
  let burstEvents = [];
  let dmgPtr = 0, burstPtr = 0;
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
    if (DATA.kills) DATA.kills.sort((a, b) => a.t - b.t);
    burstEvents = (DATA.kills || []).map((k) => ({ t: k.t, eid: k.victim_eid })).sort((a, b) => a.t - b.t);
    dmgPtr = 0; burstPtr = 0;
  }
  function vehicleByEid(eid) { return V.find((x) => x.def.eid === eid); }
  function makeFloatDmgFx() {
    const cv = document.createElement('canvas'); cv.width = DMG_TEX_W; cv.height = DMG_TEX_H;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, depthTest: false, depthWrite: false, transparent: true, opacity: 1,
    }));
    sp.renderOrder = 1001;
    return { sp, tex, cv, ctx: cv.getContext('2d') };
  }
  function spawnFloatDmg(eid, hpLoss) {
    const v = vehicleByEid(eid);
    if (!v || !v.group.visible) return;
    const fx = fxTake('floatDmg', makeFloatDmgFx);
    const cv = fx.cv, c = fx.ctx, tex = fx.tex, sp = fx.sp;
    const cx = DMG_TEX_W / 2, cy = DMG_TEX_H / 2;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, DMG_TEX_W, DMG_TEX_H);
    c.font = 'bold 100px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    const text = '-' + hpLoss;
    c.shadowColor = 'rgba(255,140,0,.95)'; c.shadowBlur = 30;
    c.fillStyle = '#000'; c.fillText(text, cx, cy);
    c.shadowBlur = 0; c.lineWidth = 16; c.strokeStyle = 'rgba(0,0,0,.95)'; c.strokeText(text, cx, cy);
    c.fillStyle = '#ffb340'; c.fillText(text, cx, cy);
    tex.needsUpdate = true; sp.material.opacity = 1; sp.visible = true; sp.scale.set(DMG_ASPECT, 1, 1);
    sp.position.copy(v.group.position); sp.position.y += 3.2; labelScene.add(sp);
    floatDmgs.push({ sp, tex, cv, born: performance.now(), baseY: sp.position.y, group: v.group });
    const nowMs = performance.now();
    const maxHp = v.def.max_hp > 0 ? v.def.max_hp : 0;
    if (maxHp > 0) {
      const curHp = Math.max(0, hpAt(v, T));
      const fromFrac = Math.max(0, Math.min(1, curHp / maxHp));
      const toFrac = Math.max(0, fromFrac + hpLoss / maxHp);
      ghostByEid.set(eid, { fromFrac, toFrac, untilMs: nowMs + GHOST_MS * FX_SCALE });
    }
    flashByEid.set(eid, nowMs + FLASH_MS * FX_SCALE); labelsTime = null;
  }
  function makeBurstFx() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const rings = [];
    for (const r0 of [0.8, 1.6]) {
      const mesh = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 0.45, 28), mat.clone());
      mesh.rotation.x = -Math.PI / 2; g.add(mesh); rings.push(mesh);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), mat.clone()); g.add(ball);
    return { g, rings, ball };
  }
  function spawnBurst(eid) {
    const v = vehicleByEid(eid); if (!v || !v.group.visible) return;
    const fx = fxTake('burst', makeBurstFx);
    const g = fx.g, rings = fx.rings, ball = fx.ball;
    for (const rr of rings) { rr.scale.setScalar(1); rr.material.opacity = 0.85; }
    ball.scale.setScalar(1); ball.material.opacity = 0.7;
    g.visible = true; g.position.copy(v.group.position); scene.add(g);
    burstFx.push({ g, born: performance.now(), rings, ball });
  }
  function updateTransients() {
    const now = performance.now();
    for (const [eid, g] of ghostByEid) {
      if (now >= g.untilMs) { ghostByEid.delete(eid); labelsTime = null; invalidate(); }
    }
    for (const [eid, until] of flashByEid) {
      if (now >= until) { flashByEid.delete(eid); labelsTime = null; invalidate(); }
    }
    for (let i = floatDmgs.length - 1; i >= 0; i--) {
      const f = floatDmgs[i];
      const k = (now - f.born) / (FLOAT_DMG_MS * FX_SCALE);
      if (k >= 1) {
        labelScene.remove(f.sp);
        fxGive('floatDmg', { sp: f.sp, tex: f.tex, cv: f.cv, ctx: f.cv.getContext('2d') });
        floatDmgs.splice(i, 1); continue;
      }
      f.sp.position.x = f.group.position.x;
      f.sp.position.z = f.group.position.z;
      f.sp.position.y = f.baseY + k * 4.5;
      const { pop, opacity } = floatDmgAnim(k);
      const s = dmgWorldHeight(camera.position.distanceTo(f.sp.position), camera.fov) * pop;
      f.sp.scale.set(s * DMG_ASPECT, s, 1); f.sp.material.opacity = opacity;
    }
    for (let i = burstFx.length - 1; i >= 0; i--) {
      const b = burstFx[i];
      const k = (now - b.born) / (BURST_MS * FX_SCALE);
      if (k >= 1) {
        scene.remove(b.g); fxGive('burst', { g: b.g, rings: b.rings, ball: b.ball }); burstFx.splice(i, 1); continue;
      }
      for (let j = 0; j < b.rings.length; j++) {
        b.rings[j].scale.setScalar(1 + k * (2.2 + j * 1.6)); b.rings[j].material.opacity = 0.85 * (1 - k);
      }
      b.ball.scale.setScalar(1 + k * 1.5); b.ball.material.opacity = 0.7 * (1 - k);
    }
  }
  function clearTransients() {
    for (const f of floatDmgs) {
      labelScene.remove(f.sp);
      fxGive('floatDmg', { sp: f.sp, tex: f.tex, cv: f.cv, ctx: f.cv.getContext('2d') });
    }
    floatDmgs.length = 0;
    for (const b of burstFx) {
      scene.remove(b.g); fxGive('burst', { g: b.g, rings: b.rings, ball: b.ball });
    }
    burstFx.length = 0; ghostByEid.clear(); flashByEid.clear(); dmgPtr = 0; burstPtr = 0;
  }

  function feedEntry(k) {
    const gen = sessionGen;
    const name = (eid) => { const v = V.find((x) => x.def.eid === eid); return v ? (v.def.nickname || 'Unknown') : eid === 0 ? '环境' : String(eid); };
    const causeMap = { 0: '', 1: '（火焰）', 2: '（撞击）', 3: '（环境）', 5: '（溺水）' };
    const text = k.killer_eid !== 0 ? `${name(k.killer_eid)} 击毁 ${name(k.victim_eid)}` : `${name(k.victim_eid)}${causeMap[k.cause] || '阵亡'}`;
    const entry = { id: ++kfId, kill: k.killer_eid !== 0, killer: name(k.killer_eid), victim: name(k.victim_eid), text };
    store.killfeed.push(entry);
    setTimeout(() => {
      if (gen !== sessionGen) return;
      const i = store.killfeed.findIndex((x) => x.id === entry.id);
      if (i >= 0) store.killfeed.splice(i, 1);
    }, 8000);
  }
  function advanceKills() {
    while (killPtr < DATA.kills.length && DATA.kills[killPtr].t <= T) { feedEntry(DATA.kills[killPtr]); killPtr++; }
  }
  function rebuildFeed() {
    store.killfeed = [];
    const recent = DATA.kills.filter((k) => k.t <= T).slice(-6);
    for (const k of recent) feedEntry(k);
    killPtr = 0;
    while (killPtr < DATA.kills.length && DATA.kills[killPtr].t <= T) killPtr++;
  }
  let scorePtr = 0, score1 = 0, score2 = 0;
  function resetScore() { scorePtr = 0; score1 = 0; score2 = 0; }
  function updateScore() {
    while (scorePtr < DATA.kills.length && DATA.kills[scorePtr].t <= T) {
      const k = DATA.kills[scorePtr++];
      const victim = V.find((x) => x.def.eid === k.victim_eid);
      if (!victim) continue;
      if (victim.def.team === 1) score2++; else if (victim.def.team === 2) score1++;
    }
    const perspective = perspectiveScore(score1, score2, DATA.meta.friendly_team);
    if (store.scoreFriend !== perspective.scoreFriend) store.scoreFriend = perspective.scoreFriend;
    if (store.scoreEnemy !== perspective.scoreEnemy) store.scoreEnemy = perspective.scoreEnemy;
  }

  const rosterRowsByEid = new Map();
  function buildRoster() {
    store.friendlyTeam = [1, 2].includes(DATA.meta.friendly_team) ? DATA.meta.friendly_team : null;
    const groups = buildRosterRows(V);
    rosterRowsByEid.clear();
    for (const key of ROSTER_GROUPS) {
      store.roster[key] = groups[key].map((row) => applyRosterRuntime(
        { ...row }, { hp: 0, maxHp: 0, dead: false, followed: false, reload: null }));
      for (const row of store.roster[key]) rosterRowsByEid.set(row.eid, row);
    }
  }
  function updateRoster() {
    const projected = projectRoster(V, T);
    for (const v of V) {
      const e = rosterRowsByEid.get(v.def.eid);
      const p = projected.get(v.def.eid);
      if (!e || !p) continue;
      applyRosterRuntime(e, {
        hp: p.hp, maxHp: p.maxHp, dead: p.dead, followed: FOLLOW_EID === v.def.eid,
        reload: p.dead ? null : reloadStateAt(v.def.eid, T, v.reloadSize),
      });
    }
  }

  const tmpV = new THREE.Vector3();
  let followAnchor = null;
  const tmpDir = new THREE.Vector3();
  const FOLLOW_SNAP_DIST = 26;
  const FOLLOW_MIN_HEIGHT = 9;
  function updateDestructibles(T) {
    if (!destruct) return;
    if (T < destruct.lastT) destruct.ptr = 0;
    destruct.lastT = T;
    const states = destruct.states;
    while (destruct.ptr < states.length && states[destruct.ptr].clock <= T) destruct.ptr++;
    destruct.animating = false;
    for (let i = 0; i < states.length; i++) {
      const st = states[i]; const active = i < destruct.ptr;
      if (st.prop === 3) {
        if (!st.pivot) continue;
        if (!active) {
          if (st.pivot.quaternion.x || st.pivot.quaternion.y || st.pivot.quaternion.z) st.pivot.quaternion.identity();
          continue;
        }
        const elapsed = T - st.clock;
        const stop = st.stopRad ?? Math.PI / 2;
        const r = fallRotation(st.fallDir, elapsed, st.heightM, stop);
        if (r && elapsed < r.durationS) {
          destruct.animating = true;
          st.pivot.quaternion.setFromAxisAngle(_tmpFallAxis.set(r.axis[0], r.axis[1], r.axis[2]), r.angle);
        } else if (!st.settled) {
          st.settled = true;
          st.pivot.quaternion.setFromAxisAngle(_tmpFallAxis.set(r_axis(st.fallDir, 0), r_axis(st.fallDir, 1), r_axis(st.fallDir, 2)), stop);
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
  function r_axis(dir8, idx) { const [dx, dy] = fallTipVector(dir8); return [-dy, dx, 0][idx]; }
  function applyPose(v) {
    const dead = deathAt(v, T);
    const vis = visibleAt(v, T) || dead;
    v.group.visible = vis;
    if (v.glb) v.glb.visible = vis;
    if (!vis) { v.wasDead = false; return; }
    posAt(v, T, tmpV); v.group.position.copy(tmpV);
    if (v.glb) poseGlb(v);
    v.group.rotation.order = 'YXZ';
    v.group.rotation.y = -yawAt(v, T);
    v.group.rotation.x = hullPitchAt(v, T);
    v.group.rotation.z = -rollAt(v, T);
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    v.turretG.rotation.y = -rel;
    v.gunPivot.rotation.x = -gunPitchAt(v, T);
    if (dead !== v.wasDead) {
      v.wasDead = dead;
      v.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.color) {
          if (dead) {
            o.userData.__c = o.material.color.clone();
            const hsl = { h: 0, s: 0, l: 0 };
            o.material.color.getHSL(hsl);
            o.material.color.setHSL(hsl.h, hsl.s * 0.15, Math.max(0.30, hsl.l));
          } else if (o.userData.__c) o.material.color.copy(o.userData.__c);
        }
      });
    }
  }

  let frameDirty = true;
  function invalidate() { frameDirty = true; }
  let winnerShown = false;
  function animate() {
    if (destroyed) return;
    if (paused) { rafId = 0; return; }
    rafId = requestAnimationFrame(animate);
    if (!renderer) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (DATA && PLAYING) {
      T = advancePlaybackTime(T, END, dt * 1000, SPEED);
      tick();
      if (T >= END) setPlaying(false);
    }
    if (DATA && CAM === 'follow' && FOLLOW_EID) {
      const v = V.find((x) => x.def.eid === FOLLOW_EID);
      if (v && v.group.visible) {
        posAt(v, T, tmpV);
        if (!followAnchor) {
          controls.target.copy(tmpV);
          const off = tmpDir.subVectors(camera.position, tmpV);
          const snap = Math.max(FOLLOW_SNAP_DIST, (controls.minDistance || 0) + 2);
          if (off.length() > snap) camera.position.copy(tmpV).addScaledVector(off.normalize(), snap);
          if (camera.position.y < tmpV.y + FOLLOW_MIN_HEIGHT) camera.position.y = tmpV.y + FOLLOW_MIN_HEIGHT;
        } else {
          const dx = tmpV.x - followAnchor.x, dy = tmpV.y - followAnchor.y, dz = tmpV.z - followAnchor.z;
          camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
          controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
        }
        followAnchor = (followAnchor || new THREE.Vector3()).copy(tmpV);
      } else followAnchor = null;
    } else followAnchor = null;
    clampCameraTarget();
    const cameraMoved = controls.update();
    const busy = PLAYING || cameraMoved || frameDirty || (destruct && destruct.animating)
      || tracers.length > 0 || impacts.length > 0 || floatDmgs.length > 0 || burstFx.length > 0
      || ghostByEid.size > 0 || flashByEid.size > 0;
    if (!busy) return;
    frameDirty = false;
    const perfT0 = PERF ? performance.now() : 0;
    updateLabels(); updateBases(); updateImpacts(); updateTransients();
    const perfT1 = PERF ? performance.now() : 0;
    renderer.render(scene, camera);
    renderer.autoClear = false; renderer.render(labelScene, camera); renderer.autoClear = true;
    if (PERF) perfFrame(perfT1 - perfT0, performance.now() - perfT1);
  }

  const PERF = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('perf');
  const PERF_RING = 240;
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
  function prewarmShaders() {
    try {
      camera.updateMatrixWorld();
      renderer.compile(scene, camera);
      renderer.compile(labelScene, camera);
    } catch (e) { console.warn('着色器预热失败（忽略）:', e); }
  }
  function tick() {
    const shots = DATA.shots;
    while (shotPtr < shots.length && shots[shotPtr].t_fire <= T) { spawnShot(shots[shotPtr]); shotPtr++; }
    updateTracers(); advanceKills();
    while (dmgPtr < dmgEvents.length && dmgEvents[dmgPtr].t <= T) {
      const e = dmgEvents[dmgPtr++]; spawnFloatDmg(e.eid, e.hpLoss);
    }
    while (burstPtr < burstEvents.length && burstEvents[burstPtr].t <= T) spawnBurst(burstEvents[burstPtr++].eid);
    for (const v of V) applyPose(v);
    updateDestructibles(T); updateScore();
    {
      const pts = pointsAt(DATA.supremacy_points, T, DATA.meta.friendly_team);
      store.pointsFriend = pts.friend; store.pointsEnemy = pts.enemy;
    }
    writeHud();
    if (!winnerShown && T >= END - 1e-3 && DATA.meta.winner_team) {
      winnerShown = true;
      const w = DATA.meta.winner_team, fr = DATA.meta.friendly_team;
      store.banner = {
        text: w === 0 ? '平局' : (w === fr ? '胜利' : '失败'),
        color: w === fr ? '#3fa66a' : '#c05046',
        outcome: w === 0 ? 'draw' : (w === fr ? 'win' : 'lose'),
      };
    }
  }

  const HUD_INTERVAL_MS = 100;
  let hudWrittenMs = -Infinity;
  function writeHud(force = false) {
    if (!DATA) return;
    const now = performance.now();
    if (!force && now - hudWrittenMs < HUD_INTERVAL_MS) return;
    hudWrittenMs = now;
    if (force) publishLabels(true);
    Object.assign(store, teamHpTotals(
      V.map((v) => ({ team: v.def.team, hp: hpAt(v, T), maxHp: v.def.max_hp })),
      DATA.meta.friendly_team,
    ));
    updateRoster(); store.time = T;
    const f = (T - START) / Math.max(0.001, END - START);
    if (!store.seeking) store.seekFrac = Math.round(f * 1000);
  }
  function setPlaying(p) {
    PLAYING = p; store.playing = p;
    if (!p) writeHud(true);
    invalidate();
  }
  function setPaused(next) {
    const value = !!next;
    if (value === paused) return;
    paused = value;
    if (paused) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!destroyed) {
      if (clock) clock.getDelta();
      if (!rafId) animate();
    }
  }
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
  function setBattleClock(clock) {
    canonicalClock = clock && Number.isFinite(clock.startRaw) ? { startRaw: clock.startRaw, durationSec: clock.durationSec } : null;
    if (!DATA) return;
    [START, END] = battleRange();
    store.startTime = START; store.duration = END;
    const t = Math.max(START, Math.min(END, T));
    if (t !== T) seekTo(t);
    if (PLAYING && T >= END) setPlaying(false);
    writeHud(true); invalidate();
  }
  function seekTo(t) {
    T = Math.max(START, Math.min(END, t));
    clearEffects();
    shotPtr = firstIndexAfter(DATA.shots, T, (x) => x.t_fire);
    dmgPtr = firstIndexAfter(dmgEvents, T);
    burstPtr = firstIndexAfter(burstEvents, T);
    rebuildFeed(); resetScore(); winnerShown = false; store.banner = null;
    tick(); writeHud(true); invalidate();
  }
  function setFollow(eid) {
    FOLLOW_EID = eid;
    if (FOLLOW_EID) setCam('follow'); else setCam('free');
    if (DATA) updateRoster();
    invalidate();
  }
  function setCam(mode) {
    CAM = mode; store.cam = mode;
    if (!controls) { invalidate(); return; }
    controls.enabled = true; invalidate();
    if (mode === 'top') {
      FOLLOW_EID = 0;
      const { cx, cz, ext } = WORLD_CENTER;
      camera.position.set(cx, ext * 1.7, cz + 0.01); controls.target.set(cx, 0, cz);
    } else if (mode === 'free') FOLLOW_EID = 0;
    writeHud(true);
  }
  function setSpeed(s) { if (!isPlaybackSpeed(s)) return; SPEED = s; store.speed = s; }

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
  function clearEffects() {
    for (const tr of tracers) { scene.remove(tr.mesh); fxGive('tracer', tr.mesh); }
    tracers.length = 0;
    for (const im of impacts) {
      scene.remove(im.g);
      fxGive('impact-' + im.kind, { g: im.g, ball: im.ball, ring: im.ring, sparks: im.sparks || [] });
    }
    impacts.length = 0;
    for (const tl of trajLines) { scene.remove(tl.mesh); fxGive('traj', tl.mesh); }
    trajLines.length = 0; clearTransients();
  }
  function teardownSession() {
    sessionGen++; clearEffects(); disposeFxPool();
    if (boundaryGroup) {
      const shared = boundaryGroup.userData.sharedMaterial;
      if (shared) shared.dispose();
      scene.remove(boundaryGroup); disposeObject3D(boundaryGroup); boundaryGroup = null;
    }
    currentMapKey = null; clearBases(); currentMapBases = null;
    for (const v of V) {
      if (v.glb) scene.remove(v.glb);
      if (v.group) { scene.remove(v.group); disposeObject3D(v.group); }
    }
    V = []; labelOverlay?.clear(); labelsTime = null; labelsWrittenMs = -Infinity; reloadStateAt = () => null;
    for (const o of [mapPlane, terrainMesh, mapScenery, groundMesh, gridHelper]) {
      if (o) { scene.remove(o); disposeObject3D(o); }
    }
    mapPlane = null; terrainMesh = null; mapScenery = null; groundMesh = null; gridHelper = null;
    sceneryMatCache.clear();
    if (mapTexture) { mapTexture.dispose(); mapTexture = null; }
    if (groundLayers) { for (const k in groundLayers.texs) groundLayers.texs[k]?.dispose?.(); }
    groundLayers = null; heightField = null; heightMeta = null; mapMetaInfo = null;
    for (const p of glbCache.values()) {
      p.then((entry) => { if (entry && entry.template) disposeObject3D(entry.template); }).catch(() => {});
    }
    glbCache = new Map(); DATA = null; store.playbackSession = null; store.hasData = false;
    T = 0; shotPtr = 0; killPtr = 0; winnerShown = false; FOLLOW_EID = 0; followAnchor = null;
    store.killfeed = []; store.banner = null;
    store.pointsFriend = null; store.pointsEnemy = null;
    store.scoreFriend = 0; store.scoreEnemy = 0;
    store.hpFriend = 0; store.hpFriendMax = 0; store.hpEnemy = 0; store.hpEnemyMax = 0;
    store.hpFriendPct = 100; store.hpEnemyPct = 100;
    store.friendlyTeam = null;
    store.roster.team1 = []; store.roster.team2 = []; store.roster.unknown = [];
    rosterRowsByEid.clear();
  }
  async function loadData(source) {
    const gen = ++sessionGen;
    const epoch = ++sessionEpoch;
    const loadGen = ++loadGeneration;
    const ownsLoading = () => !destroyed && loadGen === loadGeneration;
    store.hasData = false; canonicalClock = null; store.err = ''; store.loading = true;
    store.assetStage = false; store.assetProgress = null;
    try {
      const data = source?.session ? await source.session.loadScene(source.file) : await loadPlaybackData(source);
      const playbackSession = source?.session ? source.session.getState(source.file) : null;
      if (gen !== sessionGen) return;
      teardownSession(); DATA = data; store.playbackSession = playbackSession;
      const ready = await startPlayback(epoch);
      if (!ready || !ownsLoading()) return;
      store.hasData = true;
    } catch (e) {
      if (ownsLoading()) store.err = String(e?.message || e || 'unknown');
    } finally {
      if (ownsLoading()) store.loading = false;
    }
  }
  async function startPlayback(epoch) {
    const current = () => epoch === sessionEpoch && !destroyed;
    if (!current()) return false;
    if (!renderer) initScene();
    store.mapName = DATA.meta.map_name || ('map_' + DATA.meta.map_id);
    {
      const mid0 = DATA.meta.map_id || 0;
      const mq0 = mid0 ? ('id=' + mid0) : ('name=' + encodeURIComponent(DATA.meta.map_name || ''));
      const resolvedKey = await resolveMapKey(mq0).catch(() => null);
      if (!current()) return false;
      currentMapKey = resolvedKey;
    }
    buildWorld();
    store.assetStage = true; store.assetProgress = null;
    try { await loadMapImage(); }
    catch (e) { console.warn('地图资产加载失败（回退网格）:', e); }
    finally { if (current()) store.assetStage = false; }
    if (!current()) return false;
    buildVehicles(); buildRoster();
    reloadStateAt = createReloadStateResolver({ ...DATA, friendlyTeam: DATA.meta.friendly_team });
    for (const v of V) {
      v.reloadEvents = (DATA.reloads || []).filter((e) => e.eid === v.def.eid);
      v.reloadSize = inferMagazineSize(v.reloadEvents);
      if (!(v.def.tank_id > 0)) continue;
      assetProvider.json(`/tank/${v.def.tank_id}.json`).then((tank) => {
        if (!current()) return;
        v.reloadSize = resolveMagazineSize(tank, v.reloadEvents);
        labelsTime = null; invalidate();
      }).catch(() => {});
    }
    buildTransientSources(); buildBases();
    sceneClock = resolveReplayClock(DATA.periods || [], null, DATA.meta.duration);
    [START, END] = battleRange();
    T = START; shotPtr = 0; killPtr = 0;
    if (DEBUG) window.__pbV = V;
    if (glbOn) applyGlbToggle(true);
    prewarmShaders();
    store.startTime = START; store.duration = END;
    if (!current()) return false;
    setPlaying(true); tick(); writeHud(true); invalidate(); return true;
  }

  animate(); applyGlbGate();
  return {
    loadData,
    reset() {
      loadGeneration++; sessionEpoch++; teardownSession(); setPlaying(false);
      store.hasData = false; store.loading = false; store.assetStage = false; store.assetProgress = null;
      store.err = ''; store.scoreFriend = 0; store.scoreEnemy = 0; store.mapName = ''; store.mapKey = null;
      store.startTime = 0; store.duration = 0; store.time = 0; store.seekFrac = 0; invalidate();
    },
    togglePlay: () => setPlaying(!PLAYING),
    setPlaying,
    setSpeed,
    seekFraction: (frac) => { if (DATA) seekTo(START + frac * (END - START)); },
    seekTime: (t) => { if (DATA) seekTo(t); },
    seekBy: (delta) => { if (DATA) seekTo(T + delta); },
    setBattleClock,
    setCam,
    setFollow,
    setGlb: (on) => { if (Q.allowGlb || !on) applyGlbToggle(on); invalidate(); },
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
      cancelAnimationFrame(rafId);
      teardownSession();
      removeEventListener('resize', onResize);
      sizeObserver?.disconnect();
      sizeObserver = null;
      if (PERF) {
        if (perfBeatTimer) { clearInterval(perfBeatTimer); perfBeatTimer = 0; }
        delete window.__pbPerf;
      }
      if (DEBUG) {
        delete window.__scene; delete window.__camera; delete window.__controls; delete window.__setFollow; delete window.__renderer;
        delete window.__pbV; delete window.__gdbg;
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
