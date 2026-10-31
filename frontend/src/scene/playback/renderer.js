// 渲染器/相机/控件/灯光的**创建核心**（2026-10-24 自 initPlayback 闭包出仓，
// 拆分计划见 docs/current-plan.md Step A2；代码与搬移前逐字一致——解构参数沿用
// 原变量名（Q/LOGDEPTH/DYNRES/DEBUG），源码级守卫随实现迁移到本文件）。
// 模式：**创建逻辑出仓、状态所有权留在闭包**——返回创建产物（含诊断钩子挂载与
// resize/pointer 事件接线），宿主解构赋值回自己的可变绑定；onResize 回调由宿主注入。
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createDynRes } from '../dynRes.js'
import { DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY, DEFAULT_SUN_INTENSITY } from '../mapLighting.js'

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.container 视口容器（SPA 壳内 main 区域，非整窗）
 * @param {typeof import('./quality.js').QUALITY_PRESETS.high} opts.quality 画质档（Q）
 * @param {boolean} opts.logdepth 对数深度偏好（LOGDEPTH）
 * @param {boolean} opts.dynres 动态分辨率偏好（DYNRES）
 * @param {boolean} opts.debug 诊断钩子开关（仅显式 ?debug 才挂 window.__*）
 * @param {THREE.Texture|null} [opts.envTexture] 逐图 IBL（资产阶段早于场景创建时补挂）
 * @param {number} [opts.envMultiplier] 逐图 IBL 强度（scene.environmentIntensity）
 * @param {() => void} opts.onResize
 * @param {(e: PointerEvent) => void} opts.onPointerDown
 * @param {(e: PointerEvent) => void} opts.onPointerUp
 * @param {unknown} [opts.setFollow] 诊断钩子（宿主闭包内函数声明，提升后传入）
 */
export function createSceneCore({
  container, quality: Q, logdepth: LOGDEPTH, dynres: DYNRES, debug: DEBUG,
  envTexture = null, envMultiplier = 1,
  onResize, onPointerDown, onPointerUp, setFollow,
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11161d);
  if (DEBUG) window.__scene = scene;   // 诊断钩子（仅显式 ?debug，destroy 时清除）
  // SPA 壳内渲染：视口尺寸取容器（main 区域），而非整窗（顶部导航占 67px）
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 4000);
  camera.position.set(0, 180, 220);
  // 对数深度：客户端（贴地 TPS）可视地面恒在 ~200m 内，线性深度足够；回放查看器
  // 允许 600–1000m 俯瞰——该距离线性 24bit 深度分辨率 4–12cm，与贴地装饰（铁轨
  // 路基/冰面等场景薄板，按游戏精确高程导出）同重建地形间 ±3–30cm 的交叠带同
  // 量级 → 远景俯视成片 z-fighting（碎色块、转动闪烁；拉近即消失）。对数深度把
  // 远距离分辨率提至亚毫米，交叠带恢复确定性深度序。两个自定义 ShaderMaterial
  // 需手动挂 logdepthbuf 代码块（内建材质自动注入）；?logdepth=0 可关闭（A/B 与
  // 真机回滚，见 LOGDEPTH 注释）。
  // powerPreference：多 GPU 设备（核显 + RTX 等独显）上 Windows 按 per-app 分配
  // GPU，Chrome 缺省可能落在核显——3D 回放是本页唯一的重负载任务，显式请求
  // 高性能独显（移动端/单 GPU 设备该提示被忽略，无副作用）。
  const renderer = new THREE.WebGLRenderer({
    antialias: Q.antialias,
    logarithmicDepthBuffer: LOGDEPTH,
    powerPreference: 'high-performance',
  });
  const rendererCaps = { logdepth: LOGDEPTH, dynres: DYNRES };   // 实际装配快照（复用渲染器时校验偏好是否仍一致）
  // 着色器预热（`renderer.compile`）：three 在**首次渲染某材质**时才编译程序，编译会阻塞
  // 数十~数百 ms，落在"战斗第一次开火/命中"的那一帧就是用户实测的"打起来就卡"。
  // 场景就绪后立即编译在用材质（含地面分层着色器/FX 池），成本挪到加载阶段（那时本来在等资产）。
  renderer.setSize(container.clientWidth, container.clientHeight);
  const baseDpr = Math.min(devicePixelRatio, Q.maxDpr);
  renderer.setPixelRatio(baseDpr);
  // 动态分辨率（?dynres=1 显式开启，A/B 与回滚同 ?logdepth 惯例）：持续超预算
  // 降 pixel ratio、有余量升回档位上限。档位 DPR 无下调空间（baseDpr ≤ 1）时
  // 跳过装配——降无可降。
  const dynResCtl = DYNRES && baseDpr > 1
    ? createDynRes({ ceilDpr: baseDpr })
    : null;
  if (DEBUG) window.__renderer = renderer;   // 诊断钩子（renderer 创建后才可引用；仅 ?debug）
  if (DEBUG) window.__camera = camera;       // 诊断钩子：跟随相机定位（创建后引用）
  // three r165+ 恒为物理光照单位（Lambert 除以 π），旧强度会让建筑/车模暗到发黑
  // 出屏口径（客户端证据见 playbackScene.js 文件头）：线性 × 曝光 1.0 → sRGB 编码 = 客户端 legacy 材质直出口径。
  // 不设 ?tonemap/?exposure 旋钮：客户端曝光是屏幕级自动曝光、无静态值可抄，引入替代参数只会
  // 得到"需要手工调才能看对"的状态（2026-10-10 按该原则撤掉）。
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;
  if (DEBUG) window.__controls = controls;   // 诊断钩子（controls 创建后才可引用）
  if (DEBUG) window.__setFollow = setFollow;   // 诊断钩子：跟随问题定位（函数声明提升）
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  // 兜底灯光（旧包/无 lighting.json 时用；有逐图数据时 applyMapLighting 覆盖方向/色/强度）。
  // 兜底值 = 上游硬编码时代的两盏灯，保持"读不到数据也不变样"。
  const hemiLight = new THREE.HemisphereLight(DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY);
  scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xffffff, DEFAULT_SUN_INTENSITY);
  sunLight.position.set(120, 260, 80);
  scene.add(sunLight);
  scene.add(sunLight.target);      // 平行光只认 position→target 方向；target 必须在场景图里
  sunLight.target.position.set(0, 0, 0);
  // 逐图 IBL 若在场景创建前就已加载（资产阶段早于 initScene），在此补挂
  if (envTexture) {
    scene.environment = envTexture;
    scene.environmentIntensity = envMultiplier;
  }
  addEventListener('resize', onResize);
  let sizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver(onResize);
    sizeObserver.observe(container);
  }
  // 点选意图上报宿主；是否跟随由 Pane 决定。
  // pointerup 用于「空处单击」判定（拖拽相机 ≠ 点击其它地方，见 onScenePointerUp）。
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  return { scene, camera, renderer, controls, clock, raycaster, hemiLight, sunLight, dynResCtl, sizeObserver, rendererCaps };
}
