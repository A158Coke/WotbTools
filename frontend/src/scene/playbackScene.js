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
import * as THREE from 'three'

import { loadPlaybackData, mapStaticUrl, resolveMapKey } from './replaySource.js'
import { poseFromYPR } from './glbRig.js'
import { assetProvider } from './assetProvider.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const GRID_DT = 0.1

// 三档渲染预设（面板与场景共用；桌面默认高，Tauri/移动 WebView 默认低）。
// 抗锯齿/DPR/场景资源在渲染器与场景首次创建时一次性定型，加载后改档需整页刷新。
export const QUALITY_PRESETS = {
  low:  { label: '低', antialias: false, maxDpr: 1,   scenery: false, groundLayers: false, miniMap: true,  anisotropy: 1, terrainSeg: 192, allowGlb: false },
  mid:  { label: '中', antialias: false, maxDpr: 1.5, scenery: true,  groundLayers: false, miniMap: false, anisotropy: 4, terrainSeg: 256, allowGlb: true },
  high: { label: '高', antialias: true,  maxDpr: 2,   scenery: true,  groundLayers: true,  miniMap: false, anisotropy: 8, terrainSeg: 512, allowGlb: true },
}

export function initPlayback(container, store) {
  // ---------- 全局状态 ----------
  let DATA = null;                 // PlaybackData（当前会话）
  let V = [];                      // 车辆运行时 {def, group, turretG, gunPivot, label, meshHull, glb}
  let T = 0, PLAYING = false, SPEED = store.speed;
  let CAM = 'free', FOLLOW_EID = 0;
  let shotPtr = 0, killPtr = 0;
  const tracers = [], impacts = [];
  let renderer = null, scene, camera, controls, clock, raycaster;
  let labelScene = null, labelRenderer = null;
  let glbCache = new Map(), glbOn = false;
  let mapPlane = null;
  let mapTexture = null, mapMetaInfo = null;          // 底图贴图 + 铺设参数
  // 分层地表（客户端 tilemask-fp.sl 实时合成）：{layers: 合成参数, texs: {cm,tile,mask,hmap}}。
  // 缺失（未导出/404）时回退整图烘焙底图
  let groundLayers = null;
  let terrainMesh = null, heightField = null, heightMeta = null;  // 3D 地形
  let mapScenery = null;                              // 静态场景 GLB（建筑等）
  let groundMesh = null, gridHelper = null;           // buildWorld 的占位地面/网格（会话拥有）
  let destroyed = false;
  let kfId = 0;
  // 会话代数：loadData/teardown 各自递增，全部异步续体持旧代数即失效
  let sessionGen = 0;
  // 渲染帧句柄：destroy 显式 cancel（旧实现依赖 destroyed 标志的自然退出，
  // 帧回调在 destroy 后仍可能再排队一次）
  let rafId = 0;
  // 诊断强引用仅在显式 debug 下创建（生产不挂 window.__scene 等长生命周期引用）
  const DEBUG = (() => { try { return new URLSearchParams(location.search).has('debug'); } catch (e) { return false; } })();

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
      if (window.__TAURI__ || confirm('切换到「' + QUALITY_PRESETS[k].label + '」画质将重新加载回放，继续？')) {
        try { localStorage.setItem('pb_quality', k); } catch (e) {}
        const u = new URL(location.href); u.searchParams.set('q', k); location.replace(u);
      }
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
  const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function idxOf(t) { return Math.floor((t - DATA.meta.t_start) / GRID_DT); }

  function posAt(v, t, out) {
    const i = idxOf(t), n = DATA.meta.samples;
    const i0 = Math.max(0, Math.min(i, n - 1)), i1 = Math.min(i0 + 1, n - 1);
    const f = Math.max(0, Math.min(1, (t - DATA.meta.t_start) / GRID_DT - i0));
    const p = v.def.pos;
    out.set(-(p[i0*3] + (p[i1*3] - p[i0*3]) * f),
             p[i0*3+1] + (p[i1*3+1] - p[i0*3+1]) * f,
             p[i0*3+2] + (p[i1*3+2] - p[i0*3+2]) * f);
    return out;
  }
  function yawAt(v, t) { return arrAt(v.def.hull_yaw, t); }
  function turretAbsAt(v, t) { return arrAt(v.def.turret_yaw, t); }
  function gunPitchAt(v, t) { return arrAt(v.def.gun_pitch, t); }
  function arrAt(arr, t) {
    const i = idxOf(t), n = DATA.meta.samples;
    const i0 = Math.max(0, Math.min(i, n - 1)), i1 = Math.min(i0 + 1, n - 1);
    const f = Math.max(0, Math.min(1, (t - DATA.meta.t_start) / GRID_DT - i0));
    return arr[i0] + (arr[i1] - arr[i0]) * f;
  }
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
  function gameTimerLabel(t) {
    const ps = DATA.periods; let p = null;
    for (const pe of ps) { if (pe.clock <= t) p = pe; else break; }
    if (!p || p.period < 3) return p ? (p.period === 1 ? '准备' : '倒计时') : fmtTime(t);
    const elapsed = (t - p.clock) + (p.duration_s - p.remaining_s);
    return fmtTime(Math.max(0, p.duration_s - elapsed));
  }

  // ---------- 场景 ----------
  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11161d);
    if (DEBUG) window.__scene = scene;   // 诊断钩子（仅显式 ?debug，destroy 时清除）
    // SPA 壳内渲染：视口尺寸取容器（main 区域），而非整窗（顶部导航占 67px）
    camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.5, 4000);
    camera.position.set(0, 180, 220);
    renderer = new THREE.WebGLRenderer({ antialias: Q.antialias });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.maxDpr));
    if (DEBUG) window.__renderer = renderer;   // 诊断钩子（renderer 创建后才可引用；仅 ?debug）
    // three r165+ 恒为物理光照单位（Lambert 除以 π），旧强度会让建筑/车模暗到发黑；
    // 与装甲查看器一致：ACES 色调映射 + ×π 级别的光强
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    // 昵称标签独立覆盖画布：按设备像素比满分辨率渲染，清晰度不受画质档 maxDpr 影响
    //（低档锁主画布 DPR=1 会让 HiDPI 屏上的标签文字发糊）。alpha 透明叠在主画布上，
    // pointer-events 穿透，标签恒在主场景之上（与原 depthTest:false 语义一致）。
    labelScene = new THREE.Scene();
    labelRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    labelRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.inset = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;
    clock = new THREE.Clock();
    raycaster = new THREE.Raycaster();
    scene.add(new THREE.HemisphereLight(0xbfd4e8, 0x2a2f36, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.0); sun.position.set(120, 260, 80); scene.add(sun);
    addEventListener('resize', onResize);
    // 点选车辆 → 跟随
    renderer.domElement.addEventListener('pointerdown', onScenePointerDown);
  }
  function onResize() {
    if (!renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    if (labelRenderer) labelRenderer.setSize(container.clientWidth, container.clientHeight);
  }
  function onScenePointerDown(e) {
    if (e.button !== 0) return;
    const r = container.getBoundingClientRect();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, camera);
    const hits = raycaster.intersectObjects(V.map(v => v.group), true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.eid) o = o.parent;
      if (o) setFollow(o.userData.eid);
    }
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
    const ext = isFinite(m) && m > 0 ? Math.ceil(m / 50) * 50 : 300;
    const cx = (q(xs, .98) + q(xs, .02)) / 2, cz = (q(zs, .98) + q(zs, .02)) / 2;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ext * 2 + 100, ext * 2 + 100),
      new THREE.MeshLambertMaterial({ color: 0x202a36 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cz);
    scene.add(ground);
    groundMesh = ground;
    const grid = new THREE.GridHelper(ext * 2 + 100, Math.floor((ext * 2 + 100) / 50), 0x3a4a5e, 0x273140);
    grid.position.set(cx, 0.02, cz); scene.add(grid);
    gridHelper = grid;
    WORLD_CENTER = { cx, cz, ext };
    camera.position.set(cx, ext * 1.1, cz + ext * 1.2);
    controls.target.set(cx, 0, cz);
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
  function makeBillboardMaterial(m) {
    const occMean = (m.userData && m.userData.extras && m.userData.extras.occMean) || 0.8;
    // 客户端着色器为伽马空间直采直写：关闭 sRGB 纹理解码（自定义着色器无输出
    // 重编码，sRGB 采样得到的线性值直出会整体发黑）
    if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: m.map || null },
        uSH: { value: 1.77 },
        uOccMean: { value: occMean },
      },
      vertexShader: `
        attribute vec4 _corner;
        attribute vec4 color;
        varying vec2 vUv;
        varying float vOcc;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 vp = (viewMatrix * wp).xyz;
          float ws = length(vec3(modelMatrix[0][0], modelMatrix[1][0], modelMatrix[2][0]));
          vp += _corner.xyz * ws;
          gl_Position = projectionMatrix * vec4(vp, 1.0);
          vUv = uv;
          vOcc = color.r;
        }`,
      transparent: true,           // 客户端 SpeedTree 为 AlphaBlend 通道：
      depthWrite: true,            // 软边缘半透明混合，近全透明才裁剪
      fragmentShader: `
        uniform sampler2D map;
        uniform float uSH;
        uniform float uOccMean;
        varying vec2 vUv;
        varying float vOcc;
        void main() {
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.05) discard;
          float occ = min(vOcc / max(uOccMean, 0.001), 1.25);
          gl_FragColor = vec4(c.rgb * min(occ * uSH, 1.35), c.a);
        }`,
      side: THREE.DoubleSide,
    });
  }

  async function loadMapImage() {
    // generation guard：回放替换/销毁后，旧会话的地图资产续体一律失效——
    // 迟到的已加载纹理就地 dispose，不得写入新会话的共享状态或场景
    const gen = sessionGen;
    const stale = () => gen !== sessionGen;
    if (mapPlane) { scene.remove(mapPlane); mapPlane = null; }
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh = null; }
    if (mapScenery) { scene.remove(mapScenery); mapScenery = null; }
    mapTexture = null; mapMetaInfo = null; heightField = null; heightMeta = null;
    groundLayers = null;
    // 地面加载方式由画质档决定（低=小地图底图、中/高=分层地表），3D 地形有高度场即开启
    // 地图端点用回放数字 id（与客户端 arenaTypeID → maps.yaml 同链）；
    // 显示名可能与解析器枚举名不一致，仅作后备
    const mid = DATA.meta.map_id || 0;
    const mapq = mid ? ('id=' + mid) : ('name=' + encodeURIComponent(DATA.meta.map_name || ''));
    // 静态资产面的 key 解析（必须在 mapq 构造之后——曾放在函数首行引用未初始化的
    // mapq，TDZ ReferenceError 让整个函数静默死亡，地图/地形/场景一个请求都不发，
    // 全画质档回退占位网格）
    await resolveMapKey(mapq).catch(() => {});
    if (stale()) return;
    try {
      // 低档 mini：客户端小地图作地面（比高清底图小一个量级，保留 3D 起伏）。
      // client-only：仅资产平面静态路径；未配置基址/索引未命中 → 无底图（回退网格），
      // 不存在服务端回退
      const mapUrl = (Q.miniMap ? mapStaticUrl('map-mini') : null) ?? mapStaticUrl('map');
      if (mapUrl) {
        const resp = await fetch(mapUrl);
        if (stale()) return;
        if (resp.ok) {
          mapMetaInfo = JSON.parse(resp.headers.get('X-Map-Meta') || '{}');
          const url = URL.createObjectURL(await resp.blob());
          mapTexture = await new THREE.TextureLoader().loadAsync(url);
          URL.revokeObjectURL(url);
          if (stale()) { mapTexture.dispose(); mapTexture = null; return; }
          mapTexture.colorSpace = THREE.SRGBColorSpace;
          mapTexture.anisotropy = Math.min(Q.anisotropy, renderer.capabilities.getMaxAnisotropy());
          if (mapMetaInfo.flip_x) { mapTexture.wrapS = THREE.RepeatWrapping; mapTexture.repeat.x = -1; mapTexture.offset.x = 1; }
        }
      }
    } catch (e) { console.warn('底图加载失败（回退网格）:', e); }
    try {
      // 3D 地形：仅资产平面静态路径 + terrain.json sidecar 尺度；无静态资产 → 保持 2D
      const terrainBin = mapStaticUrl('terrain');
      let tmeta = {}; let tbuf = null;
      if (terrainBin) {
        const m = await fetch(mapStaticUrl('terrain-meta'));
        if (stale()) return;
        if (m.ok) {
          tmeta = await m.json();
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
        const b = await fetch(terrainBin);
        if (stale()) return;
        if (b.ok) tbuf = await b.arrayBuffer();
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
    // 客户端同款分层地表：colormap/lightmap/tile 细节/mask/(HeightBlend 高度图)，
    // tile 纹理前端按 textureTiling 平铺全分辨率采样——清晰度等同客户端，不受整图烘焙
    // 分辨率限制。任一分层缺失则整体回退烘焙底图。
    // 注意分层一律无 alpha（Chrome 把带 alpha 的 webp 预乘解码，GPU 侧会压暗
    // 近黑），第 4 通道在独立灰度图里（tile1/mask1/hmap1 的 R）。
    // 低/中档跳过分层地表：直接走整图烘焙底图（省 4–8 张纹理下载与显存）
    if (Q.groundLayers) try {
      const gmUrl = mapStaticUrl('groundmeta');
      if (!gmUrl) { /* 未配置资产面/未命中索引：跳过分层地表，回退烘焙底图/网格 */ }
      else {
      const mresp = await fetch(gmUrl);
      if (stale()) return;
      if (mresp.ok) {
        const L = await mresp.json();
        const need = L.height_blend
          ? ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1', 'hmap0', 'hmap1']
          : ['cm', 'lm', 'tile0', 'tile1', 'mask0', 'mask1'];
        const texs = {};
        let ok = true;
        for (const k of need) {
          try {
            const texUrl = mapStaticUrl('groundtex', k);
            if (!texUrl) { ok = false; break; }
            const r = await fetch(texUrl);
            if (!r.ok) { ok = false; break; }
            const u = URL.createObjectURL(await r.blob());
            texs[k] = await new THREE.TextureLoader().loadAsync(u);
            URL.revokeObjectURL(u);
            if (stale()) { texs[k].dispose(); delete texs[k]; ok = false; break; }
          } catch { ok = false; break; }
        }
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
    // 诊断钩子：window.__gdbg 查看地表实际走的路径与已加载分层（仅 ?debug）
    if (DEBUG) window.__gdbg = { layers: !!groundLayers, texs: groundLayers ? Object.keys(groundLayers.texs) : [],
                                 meta: !!mapMetaInfo, sizeM: mapMetaInfo?.size_m ?? null };
    rebuildGround();
    // 静态场景模型（建筑/桥/岩石，tools/export_map_glb.py 预生成；缺失静默跳过）。
    // GLB 为游戏系（z 上、+y 北），qFrame = Ry(π)·Rx(-π/2)（YXZ 序）转到回放场景系——
    // 与坦克 GLB 同一帧变换，纯旋转无镜像，绕序天然正确。
    // 中/低档跳过场景 GLB（单图 11–67MB 下载 + 大块显存，是画质档最大的分流项）
    if (Q.scenery) try {
      const sceneryUrl = mapStaticUrl('scenery');
      if (!sceneryUrl) { /* 未配置资产面/未命中索引：跳过场景 GLB（无服务端回退） */ }
      else {
      const gltf = await new Promise((res) => {
        new GLTFLoader().load(sceneryUrl,
          (g) => res(g), undefined, () => res(null));
      });
      if (stale()) return;   // 迟到的场景 GLB：整体 GC（未渲染即未上传 GPU），不入新会话场景
      if (gltf && gltf.scene) {
        // GLTFLoader 默认 MeshStandardMaterial（PBR）比场景 Lambert 光照吃光得多，
        // 建筑会渲染成近黑——统一降级为 Lambert 并保留贴图/透明/平直着色。
        // 几何含 _CORNER 属性的叶卡走 billboard 材质（见 makeBillboardMaterial）
        const convMat = (m, isCard) => (isCard ? makeBillboardMaterial(m) : (() => {
          // ST|（SpeedTree 树/灌木）：客户端 speedtree-materials-fp = albedo × SH，
          // 无场景光照——用不受光材质（染色值经 baseColorFactor→color 传入）
          if ((m.name || '').startsWith('ST|')) {
            const bm = new THREE.MeshBasicMaterial({
              map: m.map || null,
              color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
              transparent: true,          // 客户端 SpeedTree = AlphaTest+AlphaBlend
              opacity: m.opacity ?? 1,    // 双通道；此处混合渲染软边缘
              side: THREE.DoubleSide,
              depthWrite: true,
            });
            bm.alphaTest = 0.05;          // 仅剔近全透明像素
            bm.toneMapped = false;
            return bm;
          }
          const nm = new THREE.MeshLambertMaterial({
            map: m.map || null,
            color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
            transparent: !!m.transparent,
            opacity: m.opacity ?? 1,
            side: THREE.DoubleSide,
          });
          if (m.alphaMode === 'MASK') nm.alphaTest = m.alphaCutoff || 0.33;
          nm.flatShading = true;
          return nm;
        })());
        gltf.scene.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          // GLTFLoader 会把自定义属性名转小写：GLB 里的 _CORNER → geometry._corner
          const isCard = !!o.geometry.attributes._corner;
          o.material = Array.isArray(o.material) ? o.material.map((m) => convMat(m, isCard))
                                                 : convMat(o.material, isCard);
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
      }
      }
    } catch (e) { console.warn('场景模型加载失败（忽略）:', e); }
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
        varying vec2 vXZ;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vXZ = wp.xz;
          gl_Position = projectionMatrix * viewMatrix * wp;
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

        void main() {
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
  }

  function teamColor(v) {
    const f = DATA.meta.friendly_team, t = v.def.team;
    if (t === 0 || f === 0) return 0x8a94a3;
    return t === f ? 0x3fa66a : 0xc05046;
  }

  // 标签恒定屏幕占比：世界尺寸按相机距离逐帧反算（透视投影 h = f·2d·tan(θ/2)），
  // 远处血量数字同样大、近处不再撑满屏幕；悬浮高度随距离收缩贴住车顶
  const LABEL_FRAC = 0.0275;    // 标签高 ≈ 视口高度的 2.75%（当前尺寸）
  const LABEL_ASPECT = 4;       // 画布 512×128 = 4:1
  function updateLabels() {
    const k = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * LABEL_FRAC;
    for (const v of V) {
      if (!v.label) continue;
      // 标签为覆盖场景根级对象：世界位置 = 车体位置 + 悬浮偏移（不再从父节点继承）
      const d = camera.position.distanceTo(v.group.position);
      // 严格 d·k：屏幕占比对所有车恒定（旧 max(0.3,…) 钳位让近处车的标签明显偏小，
      // 是尺寸不一致的来源）；下限仅防 d→0 退化
      const s = Math.max(0.05, d * k);
      v.label.scale.set(s * LABEL_ASPECT, s, 1);
      // 悬浮高度随距离缩放（较此前整体减半），远处上限同步降半
      v.label.position.copy(v.group.position);
      v.label.position.y += Math.min(6, Math.max(3.25, d * 0.045));   // 上限随标签减半等比收紧
      // 车辆不可见时标签同步隐藏（原先经父子关系继承，现根级需显式管理）
      v.label.visible = v.group.visible && store.labelsOn;
    }
  }

  function makeLabel(v) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    v.labelCanvas = cv;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;   // canvas 本身是 sRGB，颜色直出
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, depthTest: false, depthWrite: false,
      transparent: true, opacity: 0.72,   // 整体半透明，弱化对场景的遮挡感
    }));
    sp.renderOrder = 999;   // 最后绘制：水面/半透明层不得覆盖标签；不写深度避免
                            // 透明四边形裁掉后画的相邻标签（14 车聚簇时必现）
    sp.scale.set(10, 2.5, 1); sp.position.y = 6.2;
    v.label = sp; v.labelHp = null; v.labelDead = null;
    drawLabel(v);
    return sp;
  }

  // 圆角矩形路径（血条卡片/进度条通用）
  function rrPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // #rrggbb → 亮度系数 k 的 css 颜色（血条渐变用）
  function shadeCss(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (s) => Math.min(255, Math.max(0, Math.round(((n >> s) & 255) * k)));
    return `rgb(${c(16)},${c(8)},${c(0)})`;
  }

  // 昵称（作者金星/击殁灰化）+ 渐变血量条（当前/上限数字）+ 队伍色描边卡片。
  // 变化检测必须在清空画布之前——先 clear 再早退会得到永久空白标签。
  function drawLabel(v) {
    const hp = hpAt(v, T), dead = deathAt(v, T);
    if (hp === v.labelHp && dead === v.labelDead) return;
    v.labelHp = hp; v.labelDead = dead;
    const cv = v.labelCanvas, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    const team = '#' + new THREE.Color(teamColor(v)).getHexString();
    const base = dead ? '#5a636e' : team;
    // 卡片：投影 + 纵向渐变底 + 队伍色描边 + 左侧队伍色竖条
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    rrPath(ctx, 26, 6, 460, 116, 18);
    ctx.fillStyle = 'rgba(15,20,28,.85)'; ctx.fill();
    ctx.restore();
    const bg = ctx.createLinearGradient(0, 6, 0, 122);
    bg.addColorStop(0, 'rgba(24,31,43,.88)');
    bg.addColorStop(1, 'rgba(12,17,24,.80)');
    rrPath(ctx, 26, 6, 460, 116, 18);
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = dead ? 'rgba(122,130,140,.42)' : team + '99';
    ctx.stroke();
    ctx.save();
    rrPath(ctx, 26, 6, 460, 116, 18); ctx.clip();
    ctx.globalAlpha = dead ? .45 : .92; ctx.fillStyle = base;
    ctx.fillRect(26, 6, 12, 116);
    ctx.restore();
    // 车型名为主（大字亮色）+ 昵称为辅（小字置灰），并排一行水平居中；超宽自适应缩字号
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const name = (dead ? '✝ ' : '') + (v.def.nickname || 'Unknown');
    const tank = v.def.tank_name || (v.def.tank_id ? 'tank_' + v.def.tank_id : '');
    const starW = (v.def.is_author && !dead) ? 42 : 0;
    const tankFont = (px) => `700 ${px}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    const nickFont = '500 26px "Segoe UI", "Microsoft YaHei", sans-serif';
    let tfs = 42;                                   // 车型名为主字号
    const rowWidth = () => {
      ctx.font = tankFont(tfs);
      let w = starW + ctx.measureText(tank).width;
      if (name) { ctx.font = nickFont; w += 14 + ctx.measureText(name).width; }
      return w;
    };
    while (tfs > 28 && rowWidth() > 430) tfs -= 2;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    let tx = 256 - rowWidth() / 2;
    if (starW) {
      ctx.strokeText('★', tx, 34);
      ctx.fillStyle = '#e8b23c'; ctx.fillText('★', tx, 34);
      tx += starW;
    }
    // 主：车型名（无车型数据时昵称顶位）
    const primaryText = tank || name;
    ctx.font = tankFont(tfs);
    ctx.strokeText(primaryText, tx, 34);
    ctx.fillStyle = dead ? 'rgba(160,168,178,.78)' : '#eef3f9';
    ctx.fillText(primaryText, tx, 34);
    tx += ctx.measureText(primaryText).width;
    // 辅：昵称（小字置灰；tank 缺失时已顶位，不重复绘制）
    if (tank && name) {
      tx += 14;
      ctx.font = nickFont;
      ctx.lineWidth = 5;
      ctx.strokeText(name, tx, 36);
      ctx.fillStyle = dead ? 'rgba(140,148,158,.6)' : '#b9c4cf';
      ctx.fillText(name, tx, 36);
    }
    // 血量条：暗槽 + 队伍色纵向渐变填充
    const frac = v.def.max_hp > 0 ? Math.max(0, Math.min(1, hp / v.def.max_hp)) : 0;
    const bx = 56, by = 68, bw = 400, bh = 44;
    rrPath(ctx, bx, by, bw, bh, 11);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.stroke();
    if (frac > 0 && !dead) {
      const fg = ctx.createLinearGradient(0, by + 3, 0, by + bh - 3);
      fg.addColorStop(0, shadeCss(base, 1.35));
      fg.addColorStop(.5, base);
      fg.addColorStop(1, shadeCss(base, .68));
      rrPath(ctx, bx + 3, by + 3, Math.max(16, (bw - 6) * frac), bh - 6, 8);
      ctx.fillStyle = fg; ctx.fill();
    }
    // 血量数字（条上居中，描边保证低血量时可读；恒定屏幕占比下优先保证可读性）
    const txt = v.def.max_hp > 0 ? `${hp} / ${v.def.max_hp}` : '—';
    ctx.font = '700 30px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(txt, 256, by + bh / 2 + 1);
    ctx.fillStyle = '#fff'; ctx.fillText(txt, 256, by + bh / 2 + 1);
    v.label.material.map.needsUpdate = true;
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
      labelScene.add(makeLabel(v));   // 标签在独立覆盖画布渲染（满 DPR，清晰度与画质档解耦）
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

  // GLB 根位姿 = poseFromYPR(−yaw, pitch, 0)（共享 rig，见 scene/glbRig.js）
  function poseGlb(v) {
    v.glb.position.copy(v.group.position);
    v.glb.quaternion.copy(poseFromYPR(-yawAt(v, T), arrAt(v.def.hull_pitch, T), 0));
    const p = v.glbParts;
    if (!p) return;
    const rel = wrapPi(turretAbsAt(v, T) - yawAt(v, T));
    const tr = -rel;                       // 镜像系节点旋转角 = −rel
    const gr = gunPitchAt(v, T);           // glb 系 Rx(θ)：θ>0 = 前向(+Y)抬向 +Z = 仰角
    let turretRot = new THREE.Matrix4().makeRotationZ(tr);
    if (p.itr) {
      turretRot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
        -THREE.MathUtils.degToRad(p.itr.pitch || 0), -THREE.MathUtils.degToRad(p.itr.roll || 0),
        tr - THREE.MathUtils.degToRad(p.itr.yaw || 0), 'XYZ'));
    }
    const mT = new THREE.Matrix4().makeTranslation(p.tP[0], p.tP[1], p.tP[2]).multiply(turretRot)
      .multiply(new THREE.Matrix4().makeTranslation(-p.tP[0], -p.tP[1], -p.tP[2]));
    const mG = mT.clone().multiply(new THREE.Matrix4().makeTranslation(p.gP[0], p.gP[1], p.gP[2]))
      .multiply(new THREE.Matrix4().makeRotationX(gr))
      .multiply(new THREE.Matrix4().makeTranslation(-p.gP[0], -p.gP[1], -p.gP[2]));
    const tn = p.turretNode;
    tn.updateMatrix();
    if (!tn.userData.__bake) { tn.userData.__bake = tn.matrix.clone(); tn.matrixAutoUpdate = false; }
    tn.matrix.copy(mT.clone().multiply(tn.userData.__bake));
    for (const gn of p.gunNodes) {
      gn.updateMatrix();
      if (!gn.userData.__bake) { gn.userData.__bake = gn.matrix.clone(); gn.matrixAutoUpdate = false; }
      gn.matrix.copy(mG.clone().multiply(gn.userData.__bake));
    }
    v.glb.updateMatrixWorld(true);
  }

  async function applyGlbToggle(on) {
    const gen = sessionGen;
    glbOn = on;
    store.glbOn = on;
    if (on) {
      // 并行加载：单个大模型慢解析不阻塞其余车辆；每车 clone 独立实例。
      // generation guard：回放替换后迟到的完成不得挂载到新会话场景
      await Promise.all(V.filter(v => v.def.tank_id > 0).map(async (v) => {
        if (!v.glb) {
          const loaded = await loadGlb(v.def.tank_id);
          if (gen !== sessionGen) return;   // 迟到：模板留在旧缓存对象里随 GC 回收
          if (loaded && glbOn && !v.glb) {
            const inst = loaded.template.clone();
            inst.scale.setScalar(1);
            v.glb = inst;
            v.glbParts = collectGlbParts(inst, loaded.sd,
              { turret_index: v.def.turret_index ?? null, gun_index: v.def.gun_index ?? null });
            v.glb.visible = v.group.visible;
            scene.add(v.glb);
          }
        }
        if (v.glb) setLowPoly(v, false);
      }));
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
      if (c === v.label || c.userData.keepWithGlb) continue;
      c.visible = show;
    }
  }

  // ---------- 弹道 ----------
  const TRACER_LEN = 9;
  // 全弹道轨迹线：纯色不透明（淡出阶段除外）；与弹着点特效同步（t1+2.2s 移除、最后 1.2s 淡出）
  const TRAJ_OPACITY = 1.0;
  let trajLines = [];
  function spawnShot(s) {
    const from = new THREE.Vector3(-s.from[0], s.from[1], s.from[2]);
    const to = new THREE.Vector3(-s.to[0], s.to[1], s.to[2]);
    const color = s.is_kill ? 0xff3355 : s.ricochet ? 0x9aa5b1
      : s.game_hit_result === 3 ? 0xffc94d : s.hit ? 0x6fb3ff : 0xd8dee7;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, TRACER_LEN),
      new THREE.MeshBasicMaterial({ color }));
    scene.add(mesh);
    // WoTB 弹速高、交战近，直飞常 <0.3s——最小显示 0.22s 保证可见性
    const t1 = s.t_fire + Math.max(0.22, s.flight_secs);
    tracers.push({ mesh, from, to, t0: s.t_fire, t1, shot: s, color });
    // 全弹道轨迹线（队伍色：友军蓝/敌军红，与飞行段的命中结果色区分）：
    // 开火即显整条弹道；消失节奏与弹着点特效同步——t1+2.2s 移除、最后 1.2s 淡出
    const traj = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, from.distanceTo(to)),
      new THREE.MeshBasicMaterial({
        color: shotTeamColor(s), transparent: true, opacity: TRAJ_OPACITY, depthWrite: false,
      }));
    traj.position.copy(from.clone().add(to).multiplyScalar(0.5));
    traj.lookAt(to);
    scene.add(traj);
    trajLines.push({ mesh: traj, until: t1 + 1.0, fadeEnd: t1 + 2.2, base: TRAJ_OPACITY });
  }
  // 射手阵营 → 轨迹颜色：深蓝（友）/ 深红（敌）；无法判断阵营时灰
  function shotTeamColor(s) {
    const d = DATA.vehicles.find((x) => x.eid === s.shooter_eid);
    const t = d ? d.team : 0;
    if (!t || !DATA.meta.friendly_team) return 0x9aa5b1;
    return t === DATA.meta.friendly_team ? 0x1e40af : 0x9b1c1c;
  }
  function spawnImpact(tr) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10),
      new THREE.MeshBasicMaterial({ color: tr.color, transparent: true }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 20),
      new THREE.MeshBasicMaterial({ color: tr.color, side: THREE.DoubleSide, transparent: true }));
    ring.rotation.x = -Math.PI / 2;
    g.add(ball); g.add(ring);
    g.position.copy(tr.to);
    scene.add(g);
    impacts.push({ g, until: tr.t1 + 2.2, ball, ring });
  }
  function updateTracers() {
    for (let i = tracers.length - 1; i >= 0; i--) {
      const tr = tracers[i];
      if (T < tr.t0) continue;
      const f = Math.min(1, (T - tr.t0) / (tr.t1 - tr.t0));
      const head = tr.from.clone().lerp(tr.to, f);
      const tail = tr.from.clone().lerp(tr.to, Math.max(0, f - TRACER_LEN / tr.from.distanceTo(tr.to)));
      tr.mesh.position.copy(head.clone().add(tail).multiplyScalar(0.5));
      tr.mesh.lookAt(head);
      if (f >= 1) {
        // 与 trajLines 同款释放：只 remove 不 dispose 会泄漏 GPU 侧 geometry/material
        // （一场数百发 + 反复拖进度条，显存单调增长）
        scene.remove(tr.mesh);
        tr.mesh.geometry.dispose(); tr.mesh.material.dispose();
        tracers.splice(i, 1);
        spawnImpact(tr);
      }
    }
    for (let i = impacts.length - 1; i >= 0; i--) {
      const im = impacts[i];
      const left = im.until - T;
      if (left <= 0) {
        scene.remove(im.g);
        im.ball.geometry.dispose(); im.ball.material.dispose();
        im.ring.geometry.dispose(); im.ring.material.dispose();
        impacts.splice(i, 1);
        continue;
      }
      const op = Math.min(1, left / 1.2);
      im.ball.material.opacity = op; im.ring.material.opacity = op * 0.8;
      im.ring.scale.setScalar(1 + (1 - Math.min(1, left / 2.2)) * 1.6);
    }
    // 全弹道轨迹线：命中后延迟停留，再线性淡出并释放
    for (let i = trajLines.length - 1; i >= 0; i--) {
      const tl = trajLines[i];
      if (T >= tl.fadeEnd) {
        scene.remove(tl.mesh); tl.mesh.geometry.dispose(); tl.mesh.material.dispose();
        trajLines.splice(i, 1); continue;
      }
      tl.mesh.material.opacity = T <= tl.until ? tl.base
        : tl.base * Math.max(0, 1 - (T - tl.until) / (tl.fadeEnd - tl.until));
    }
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
  function updateScore() {
    let s1 = 0, s2 = 0;
    for (const k of DATA.kills) {
      if (k.t > T) continue;
      const victim = V.find((x) => x.def.eid === k.victim_eid);
      if (!victim) continue;
      if (victim.def.team === 1) s2++; else if (victim.def.team === 2) s1++;
    }
    store.score1 = s1; store.score2 = s2;
  }

  // ---------- 名册 ----------
  function buildRoster() {
    store.roster.team1 = [];
    store.roster.team2 = [];
    for (const v of V) {
      const d = v.def;
      const entry = {
        eid: d.eid,
        dot: '#' + new THREE.Color(teamColor(v)).getHexString(),
        nick: d.is_author ? '★ ' + (d.nickname || 'Unknown') : (d.nickname || 'Unknown'),
        tank: d.tank_name || (d.tank_id ? 'tank_' + d.tank_id : ''),
        frac: 1,
        dead: false,
        followed: false,
      };
      v.rosterEntry = entry;
      (d.team === 2 ? store.roster.team2 : store.roster.team1).push(entry);
    }
  }
  function updateRoster() {
    for (const v of V) {
      const e = v.rosterEntry;
      if (!e) continue;
      const hp = hpAt(v, T), dead = deathAt(v, T);
      const frac = v.def.max_hp > 0 ? hp / v.def.max_hp : 0;
      const w = Math.round(100 * frac);
      if (e.frac !== w) e.frac = w;
      if (e.dead !== dead) e.dead = dead;
      if (e.followed !== (FOLLOW_EID === v.def.eid)) e.followed = FOLLOW_EID === v.def.eid;
    }
  }

  // ---------- 主循环 ----------
  const tmpV = new THREE.Vector3();
  let followAnchor = null;             // 跟随模式：上一帧坦克位置（位移增量基准）
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
    v.group.rotation.x = arrAt(v.def.hull_pitch, T);
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
    drawLabel(v);
  }

  let winnerShown = false;
  function animate() {
    if (destroyed) return;
    rafId = requestAnimationFrame(animate);
    if (!renderer) return;   // 渲染器惰性创建（首次 startPlayback）：数据加载完成前无场景可渲染
    const dt = Math.min(clock.getDelta(), 0.1);
    if (DATA && PLAYING) {
      T += dt * SPEED;
      if (T >= DATA.meta.duration) { T = DATA.meta.duration; setPlaying(false); }
      tick();
    }
    // 相机
    // 跟随模式：相机位置与视点目标按坦克逐帧位移整体平移——用户选好的方位/
    // 距离/俯仰刚性保持，不会被拉回固定机位；旋转/缩放/平移始终自由
    if (DATA && CAM === 'follow' && FOLLOW_EID) {
      const v = V.find((x) => x.def.eid === FOLLOW_EID);
      if (v && v.group.visible) {
        posAt(v, T, tmpV);
        if (!followAnchor) {
          controls.target.copy(tmpV);          // 进入跟随：视点先对准车体
        } else {
          const dx = tmpV.x - followAnchor.x, dy = tmpV.y - followAnchor.y,
                dz = tmpV.z - followAnchor.z;
          camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
          controls.target.x += dx; controls.target.y += dy; controls.target.z += dz;
        }
        followAnchor = (followAnchor || new THREE.Vector3()).copy(tmpV);
      } else followAnchor = null;
    } else followAnchor = null;
    controls.update();
    updateLabels();
    renderer.render(scene, camera);
    // 标签覆盖画布：同一相机，标签恒在主场景之上
    if (labelRenderer) labelRenderer.render(labelScene, camera);
  }

  function tick() {
    // 弹道推进
    const shots = DATA.shots;
    while (shotPtr < shots.length && shots[shotPtr].t_fire <= T) { spawnShot(shots[shotPtr]); shotPtr++; }
    updateTracers();
    advanceKills();
    for (const v of V) applyPose(v);
    updateRoster(); updateScore();
    // HUD → store
    store.timer = gameTimerLabel(T);
    store.time = T;
    store.duration = DATA.meta.duration;
    const f = (T - DATA.meta.t_start) / Math.max(0.001, DATA.meta.duration - DATA.meta.t_start);
    if (!store.seeking) store.seekFrac = Math.round(f * 1000);
    if (!winnerShown && T >= DATA.meta.duration - 1e-3 && DATA.meta.winner_team) {
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
  function setPlaying(p) {
    PLAYING = p;
    store.playing = p;
  }
  function seekTo(t) {
    T = Math.max(DATA.meta.t_start, Math.min(DATA.meta.duration, t));
    clearEffects();   // 动态层 dispose（与 teardown 同一路径，防 seek 循环累积显存）
    shotPtr = 0;
    while (shotPtr < DATA.shots.length && DATA.shots[shotPtr].t_fire <= T) shotPtr++;
    rebuildFeed();
    winnerShown = false; store.banner = null;
    tick();
  }
  function setFollow(eid) {
    FOLLOW_EID = (FOLLOW_EID === eid) ? 0 : eid;
    if (FOLLOW_EID) { setCam('follow'); } else { setCam('free'); }
  }
  function setCam(mode) {
    CAM = mode;
    store.cam = mode;
    controls.enabled = true;
    if (mode === 'top') {
      FOLLOW_EID = 0;
      const { cx, cz, ext } = WORLD_CENTER;
      camera.position.set(cx, ext * 1.7, cz + 0.01);
      controls.target.set(cx, 0, cz);
    } else if (mode === 'free') {
      FOLLOW_EID = 0;
    }
  }
  function setSpeed(s) { SPEED = s; store.speed = s; }

  function onKeydown(e) {
    if (e.code === 'Space' && DATA) { e.preventDefault(); setPlaying(!PLAYING); }
  }

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
    for (const tr of tracers) {
      scene.remove(tr.mesh);
      tr.mesh.geometry.dispose(); tr.mesh.material.dispose();
    }
    tracers.length = 0;
    for (const im of impacts) {
      scene.remove(im.g);
      im.ball.geometry.dispose(); im.ball.material.dispose();
      im.ring.geometry.dispose(); im.ring.material.dispose();
    }
    impacts.length = 0;
    for (const tl of trajLines) {
      scene.remove(tl.mesh); tl.mesh.geometry.dispose(); tl.mesh.material.dispose();
    }
    trajLines.length = 0;
  }

  // 会话拆除：车辆/标签/GLB 克隆/地图与地表/特效/GLB 模板缓存全部移出场景并
  // dispose 会话拥有的 GPU 资源；异步续体经 sessionGen 递增整体失效。
  // 调用时序：loadData 拿到新数据且代数有效后、startPlayback 之前（load A → dispose
  // A → load B）；destroy 亦走此路径（route/component destroy → dispose currentSession）。
  function teardownSession() {
    sessionGen++;
    clearEffects();
    for (const v of V) {
      if (v.glb) scene.remove(v.glb);          // clone 与模板共享资源：不在此 dispose
      if (v.label) {
        labelScene.remove(v.label);
        if (v.label.material) {
          if (v.label.material.map) v.label.material.map.dispose();
          v.label.material.dispose();
        }
      }
      if (v.group) { scene.remove(v.group); disposeObject3D(v.group); }
    }
    V = [];
    for (const o of [mapPlane, terrainMesh, mapScenery, groundMesh, gridHelper]) {
      if (o) { scene.remove(o); disposeObject3D(o); }
    }
    mapPlane = null; terrainMesh = null; mapScenery = null; groundMesh = null; gridHelper = null;
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
    T = 0; shotPtr = 0; killPtr = 0;
    winnerShown = false;
    FOLLOW_EID = 0; followAnchor = null;
    store.killfeed = [];
    store.banner = null;
    store.roster.team1 = [];
    store.roster.team2 = [];
  }

  async function loadData(source) {
    // source 仅接受 { kind:'local', file }（client-only 拓扑，replaySource 对
    // 其他形态显式拒绝）；字符串路径等 server 形态在本拓扑中不存在
    const gen = ++sessionGen;   // 使上一会话的在途异步续体全部失效
    store.err = '';
    store.loading = true;
    try {
      // 数据获取在 teardown 之前：新回放解析失败时当前回放保持完好（替换语义 =
      // 新数据就位才拆旧会话）
      const data = await loadPlaybackData(source);
      if (gen !== sessionGen) return;   // 迟到：新数据随旧代数 GC（loading 由新所有者管理）
      teardownSession();   // 内部再递增一代——gen+1 仍属本调用（仍是最新所有者）
      DATA = data;
      await startPlayback();   // 进入场景前等待运行所需全部资产（地图/地形/地表/场景）
      store.hasData = true;
    } catch (e) {
      if (gen === sessionGen || gen + 1 === sessionGen) store.err = '加载失败: ' + e.message;
    } finally {
      if (gen === sessionGen || gen + 1 === sessionGen) store.loading = false;
    }
  }
  async function startPlayback() {
    if (!renderer) initScene();   // 渲染器惰性创建：此时画质档已定型（loader 选择/URL 参数）
    store.mapName = DATA.meta.map_name || ('map_' + DATA.meta.map_id);
    buildWorld();
    // 进入场景前等待运行所需全部资产（评审要求：地图/地形/分层地表/场景 GLB 按
    // 画质档全部就绪后才进场，不再先进场后异步补图）。各段内部已 try/catch——
    // 资产缺失按档位语义降级（回退网格/2D/烘焙底图），等待不因单项缺失而悬挂。
    store.assetStage = true;
    try {
      await loadMapImage();
    } catch (e) {
      console.warn('地图资产加载失败（回退网格）:', e);
    } finally {
      store.assetStage = false;
    }
    buildVehicles();
    buildRoster();
    T = DATA.meta.t_start;
    shotPtr = 0; killPtr = 0;
    if (DEBUG) window.__pbV = V;   // 调试钩子：控制台可查每车 GLB/位姿状态（仅 ?debug）
    if (glbOn) applyGlbToggle(true);   // 会话切换后按用户偏好恢复 GLB 车模
    setPlaying(true);
    tick();
  }

  // 初始化：事件绑定 + 动画循环（渲染器惰性创建，画质选择先于首帧定型）
  addEventListener('keydown', onKeydown);
  animate();
  applyGlbGate();

  return {
    loadData,
    togglePlay: () => setPlaying(!PLAYING),
    setPlaying,
    setSpeed,
    seekFraction: (frac) => { if (DATA) seekTo(DATA.meta.t_start + frac * (DATA.meta.duration - DATA.meta.t_start)); },
    setCam,
    setFollow,
    setGlb: (on) => { if (Q.allowGlb || !on) applyGlbToggle(on); },
    setLabels: (on) => { store.labelsOn = on; if (labelScene) labelScene.visible = on; },
    setQuality,
    qualityPresets: QUALITY_PRESETS,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);   // 显式取消：不等下一帧的 destroyed 自然退出
      teardownSession();             // 会话资源（车辆/地图/特效/GLB 模板）全量 dispose
      removeEventListener('keydown', onKeydown);
      removeEventListener('resize', onResize);
      if (DEBUG) {
        delete window.__scene; delete window.__renderer;
        delete window.__pbV; delete window.__gdbg;
      }
      if (controls) { try { controls.dispose(); } catch (_) {} }
      if (renderer) {
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch (_) {}
        renderer.domElement.remove();
      }
      if (labelRenderer) {
        labelRenderer.dispose();
        labelRenderer.domElement.remove();
      }
    },
  };
}
