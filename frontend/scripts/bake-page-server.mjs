// 烘焙页服务器（#857 修复轮抽层）：BAKE_HTML + vite 静态服务从 CLI 中独立成可导入模块——
// 供 scripts/bake-ground-overhead.mjs（CLI）与 bake-ground-terrain.smoke.mjs（真实浏览器
// 全链路 smoke：real BAKE_HTML → renderTerrainOnly → groundTerrain → /file-upload →
// 最终 webp）共用同一份页面与中间件。页面代码硬约束：整体处于模板串内，禁用反引号。
import { createReadStream, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')   // vite root：/src/scene 裸导入按本仓 frontend 解析

export function buildBakeHtml(size) {
  return `<!doctype html><html><body><script>
window.__bakeErr=[];
addEventListener('error',(e)=>window.__bakeErr.push('error: '+(e.message||e.type||'?')+' @'+String(e.filename||'').split('/').pop()+':'+(e.lineno||0)));
addEventListener('unhandledrejection',(e)=>window.__bakeErr.push('reject: '+String(e.reason)));
</script><script type="module">
// 三处 three 导入用**裸符**（Vite 6 经 transformIndexHtml 抽成虚拟模块后改写为预打包 URL）；
// 此前写死的 '/node_modules/three/...' 原始路径会被 Vite 原样返回，其内部裸 'three'
// 在浏览器侧无法解析（Vite 6 起不再对 node_modules 深层路径做 import 改写）——
// 症状：/bake 页 12s 未就绪、错误仅一行 "Failed to resolve module specifier \"three\""。
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
// 材质 SSOT：与 3D 运行时（playbackScene）同一份实现——俯视烘焙的观感基准
import { disposeSceneGroup } from '/src/scene/sceneryMaterials.js'
// 场景装配 SSOT（extras 贴图解 + 逐节点材质分派；与 3D 运行时同一份——2026-10-14 收编，
// 用户裁示"直接用它的代码"：本页此前复制的 convMat/route/水面收集全部删除）
import { resolveSceneryExtras, makeTexResolvers, assembleSceneryMaterials } from '/src/scene/sceneryAssembly.js'
// 逐图光照 SSOT（与 3D 运行时同一份应用体；2026-10-14 抽层——本页此前自持固定日光常量，
// 夜间图比 3D 档亮约 3 倍，见该模块头部说明）
import { applyMapLighting, resetMapLighting, DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY, DEFAULT_SUN_INTENSITY } from '/src/scene/mapLighting.js'
// 装配规则 SSOT：剔除/水面语义判定与运行时共用同一份（见该模块头部 2026-10-14 漂移事故说明）
import { isLiteDroppedMeshObject, strictSurfacesOf, bakeDropNode, isWaterNode, materialIsWater, sceneHasSkyFlags } from '/src/scene/sceneryAssemblyRules.js'
import { pruneForeignVariantsDetailed } from '/src/scene/variantFilter.js'
// 实例化合批：与 3D 运行时**同一模块同一序列**（sceneryInstancing.js；含 aLm 逐实例
// 光照图变换的 InstancedBufferAttribute 口径）——此前本页手写的『单实例 InstancedMesh
// + 几何克隆』是第二套实现，已删除（2026-10-14 收编，用户裁示"直接用它的代码"）
import { collectInstanceEntries, groupInstanceBatches, buildInstancedMesh, buildStandaloneLightmappedMeshes, hasTransparentMaterial } from '/src/scene/sceneryInstancing.js'
// 地面 pass SSOT（2026-10-14 收编，用户裁示"直接完全照搬 3D 回放的代码接入渲染"）：
// 地形数据/几何、分层地表材质（cm×lm×tile/mask）、水面海岸线资源与 3D 运行时共用同一份——
// 此前本页不渲染地面（底图 = 客户端自带地图图），与 3D 档实时分层渲染在夜图/带 lm 图上
// 差异显著（faust 用户报障"webp 和 3D 俯视图差别大"的直接来源）
import { loadTerrain, buildGroundGeometry, makeGroundMaterial, makeWaterCoast,
         setupGroundTextures, buildCorridorRefineMask } from '/src/scene/groundPass.js'
// 分层地表读取 = fail-closed（缺/坏任一份即抛出；键集仍是 groundPass.groundLayerKeys）
import { loadBakeGroundLayers, requireBakeTerrain } from '/scripts/bake-ground-layers.js'
import { CLIENT_NORMAL_CAMERA_FOV_H } from '/src/scene/terrainMesh.js'

const SIZE = ${size}
let renderer, scene, camera, group
let hemiLight = null, sunLight = null
// 地面 pass 的逐图资源（地形网格/分层贴图/海岸线高度场纹理）——与 group 一起在换图时释放
let groundMesh = null, groundTexs = null, waterCoast = null, waterCoastTex = null

// 光照：与 3D 运行时**同一份应用体**（mapLighting.js SSOT）——逐图 lighting.json 在 load 里
// 应用（方向/色/强度 + "保色相、归亮度"曝光归一）；此处只建兜底灯（DEFAULT_* 与运行时同值）
// 与出屏口径（LinearToneMapping + 曝光 1.0——客户端发布版无 filmic 曲线、屏幕级自动曝光，
// 证据见 playbackScene 文件头 A2 注释；此前本页用 ACES 1.15 属旧基线）。
async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(SIZE, SIZE)
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.LinearToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.setClearColor(0x000000, 0)          // 透明清屏：alpha 即覆盖掩膜
  scene = new THREE.Scene()
  hemiLight = new THREE.HemisphereLight(DEFAULT_HEMI_SKY, DEFAULT_HEMI_GROUND, DEFAULT_HEMI_INTENSITY)
  scene.add(hemiLight)
  sunLight = new THREE.DirectionalLight(0xffffff, DEFAULT_SUN_INTENSITY)
  sunLight.position.set(120, 260, 80)
  scene.add(sunLight)
  scene.add(sunLight.target)      // 平行光只认 position→target 方向；target 必须在场景图里
  sunLight.target.position.set(0, 0, 0)
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000)
  camera.position.set(0, 1000, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  renderer.domElement.style.display = 'none'
  document.body.appendChild(renderer.domElement)
  const gl = renderer.getContext()
  return { size: SIZE, webgl2: renderer.capabilities.isWebGL2, gpu: gl.getParameter(gl.RENDERER) }
}

async function load(key, span = 600, mapId = null) {
  if (group) {                       // --all 批处理：上一张必须卸载，否则场景逐张
    scene.remove(group)              // 累积——后续每张都叠着此前全部地图的几何
    disposeSceneGroup(group)         // （实测第 2 张起 coverPct 恒 100 的根因）。
    group = null                     // disposeSceneGroup 同时清 uniforms 纹理与
  }                                  // 材质缓存——共享 SpeedTree 贴图不回收会随图数累积显存（评审 P2）
  // 地面 pass 资源逐图释放（地形网格 + 分层贴图 + 海岸线高度场；上一张的残留会累积显存）
  if (groundMesh) { scene.remove(groundMesh); groundMesh.geometry.dispose(); groundMesh.material.dispose(); groundMesh = null }
  if (groundTexs) { for (const k in groundTexs) groundTexs[k]?.dispose?.(); groundTexs = null }
  if (waterCoastTex) { waterCoastTex.dispose(); waterCoastTex = null }
  waterCoast = null
  // 换图先复位兜底灯（避免上一张图的光照残留），再应用本图 lighting.json（缺数据 = 兜底）
  resetMapLighting({ renderer, scene, sunLight, hemiLight })
  const lighting = await fetch(location.origin + '/pack/map/' + encodeURIComponent(key) + '/lighting.json')
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
  applyMapLighting({ renderer, scene, sunLight, hemiLight, lighting })
  // ---- 地面 pass（与 3D 运行时同一份实现：src/scene/groundPass.js SSOT）----
  // 地形：pack 内 terrain.json + 配对 terrain.u16.bin（共享 loadTerrain——span 自愈与
  // json/bin sha 配对同运行时）；分层地表：ground.layers.json + ground/<layer>.webp
  // （键集/上传契约共享）。faust 这类夜图此前"底图亮、3D 暗"的根因即本页不渲染该层：
  // 底图来自客户端自带地图图，而 3D 档地面是 cm×lm×tile/mask 的实时合成。
  const P = location.origin + '/pack/map/' + encodeURIComponent(key) + '/'
  const { field, meta: tmeta, metaStatus, binStatus } = await loadTerrain({
    binUrl: P + 'terrain.u16.bin', metaUrl: P + 'terrain.json', fetchFn: (u) => fetch(u),
  })
  // fail-closed：地形配对按 HTTP 事实判定（requireBakeTerrain，见 bake-ground-layers.js）——json+bin
  // 均 404 才走无地面口径（ground=false）；json 缺而 bin 在（loadTerrain 会按缺省参数解码，field 非空
  // 也不可信）、json 在而 bin 缺/不配对、读取异常一律本图失败，不得静默退化或以错误标尺出图。
  requireBakeTerrain({ field, metaStatus, binStatus })
  // 有效跨度：terrain.json 自愈后的 span（运行时 terrainSpanOf 同式）——相机与地面材质、
  // 水面海岸线必须同取这一个值，否则成像范围与 ground.webp 的图幅契约错位
  const effSpan = (tmeta && Number.isFinite(tmeta.span) && tmeta.span > 0) ? tmeta.span : span
  // fail-closed（PR #621 review blocker，见 scripts/bake-ground-layers.js 头部）：有地形 ⇒ 分层
  // 地表必须完整，缺/坏任一份即抛出 → 本图烘焙失败（bakeKey 已删旧产物且不写新产物；--all 逐图
  // catch 照旧继续其它图）。烘焙侧没有回退底图：不得以 mapTexture:null（= 纯白地面）继续出图。
  // 无地形（json+bin 均 404）路径不变：不建地面网格、ground=false（合成器不做覆盖替换）。
  let groundLayers = null
  let groundReady = false            // 仅当分层地面网格真正建成后置 true——meta.ground 的唯一来源
  if (field) {
    groundLayers = await loadBakeGroundLayers({
      base: P, fetchFn: (u) => fetch(u),
      loadTexture: async (blob) => {
        const u = URL.createObjectURL(blob)
        try { return await new THREE.TextureLoader().loadAsync(u) } finally { URL.revokeObjectURL(u) }
      },
    })
    groundTexs = groundLayers.texs   // 立即登记：本图后续任一步失败，下一张 load 开头照常释放
    // 各向异性取高清档值（4）：正交俯拍下与 1 等效（近法向入射），只为与运行时的上传契约一致
    setupGroundTextures(groundLayers.texs, Math.min(4, renderer.capabilities.getMaxAnisotropy()))
  }
  // 地面网格构建推迟到走廊掩码之后（掩码需要场景已置于 qFrame 组下并更新世界矩阵）
  // 水面海岸线资源：与运行时同一份构造（深度位深上下文实测 + 相机 near/far 口径）
  if (field) {
    let depthBits = 24
    try {
      const glc = renderer.getContext()
      const b = glc.getParameter(glc.DEPTH_BITS)
      if (Number.isFinite(b) && b >= 16 && b <= 32) depthBits = b
    } catch { /* 取不到按 24bit 缺省（同运行时） */ }
    waterCoast = makeWaterCoast({ field, n: tmeta.size || 512, span: effSpan,
      near: camera.near, far: camera.far, depthBits })
    waterCoastTex = waterCoast.heightTex
  }
  const url = location.origin + '/pack/map/' + encodeURIComponent(key) + '/scenery.glb'
  const bytes = await (await fetch(url)).arrayBuffer()
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(bytes, '', res, rej))   // arrayBuffer() 已是 ArrayBuffer，别再取 .buffer
  // 包级天空标记必须在**任何剔除之前**采样：变体组里的唯一 sky 节点被裁掉后，再从
  // 缩减场景重算会退化为 false，bakeDropNode 会误启 /sky/ 名字 fallback。
  const skyFlagsAvailable = sceneHasSkyFlags(gltf.scene)
  // 变体裁剪：与 3D 运行时同一实现（mapId 对应激活的 LabelComponent 变体组）。
  // fail-closed（映射缺失/当前 mapId 不在映射）时整图拒绝烘焙——否则会把缺少全部
  // 变体布景的俯视图永久发布为正常资产。
  const variantPrune = pruneForeignVariantsDetailed(gltf.scene, mapId)
  if (variantPrune.failClosed || gltf.scene.userData?.variantMappingIncomplete === true) {
    // ⚠️ 本页整体处于 BAKE_HTML 模板串内：页面代码禁用反引号（PR #673 第八轮曾在此用
    // 嵌套反引号令整个脚本语法失效、工具不可运行），一律字符串拼接
    throw new Error('变体映射缺失/不完整（mapId=' + String(mapId) + '）：拒绝烘焙不完整俯视图')
  }
  // extras 贴图预解析（mask/lightmap/detail/env/water/decal）——共享装配模块同一实现
  const sceneryExtras = await resolveSceneryExtras(gltf)
  const masks = makeTexResolvers(gltf, sceneryExtras)
  // 排除规则 = 共享规则模块（src/scene/sceneryAssemblyRules.js，与 3D 运行时同一份判定；
  // 2026-10-14 抽层——此前本页自持一份 water|sea|river|lake 名字剔除，未随运行时的
  // "水面语义优先"修复同步，出现双向错剔：水塔/探照灯被过剔、ocean/浮冰被当固体烘入。
  // 语义优先：水面按 isWaterNode（strict 包 = 材质 extras.water 标记，名字仅旧包回退）；
  // 名字只用于天空（/sky/，与运行时同式）/非完好态/隐形（用户报障"顶棚类没渲染"后收窄——
  // 穹顶建筑/舱室/山体块此前被 dome/loonar/surroundings/^plane 名字启发式过剔）。
  // keepWater：水语义件**渲染**（与 3D 运行时同源——地面 pass 落地后底图不再由客户端
  // 地图图的水系配色承担；NewBay 海面 SkySeaSurface 这类"名字像天、材质是水"的节点
  // 也按材质标记保留，见规则模块 keepWater 注释）。
  const strictSurfaces = strictSurfacesOf(gltf.scene)
  // 新包天空语义 = 材质 extras.sky（导出器按 Skyobject 模板写入）；旧包无 sky 标记才按名字。
  // 烘焙与 3D 运行时同判，避免"名字不含 sky 的天穹被烘进俯视图 / 名字含 sky 的非天穹被剔"。
  const drop = []
  gltf.scene.traverse((o) => {
    const nm = o.name || ''
    if (bakeDropNode(nm, o.material,
                     { strictSurfaces, mdVariant: !!(o.userData && o.userData.mdVariant),
                       keepWater: true, skyFlagsAvailable })) drop.push(o)
  })
  for (const o of drop) o.removeFromParent()
  // ⚠️ 2026-10-14 删除"≥90% 图幅环境壳"几何剔除（用户报"米德尔堡右上角黑块"）：该规则把
  // **运行时正常渲染**的大件整块剔掉（erlenberg 外圈山体 mountain_3/land_main1 等、各图
  // 边缘地貌带/大地壳），露出可玩区外那条客户端 colormap 的暗色边带 → webp 黑块。
  // 探针实证：保留后该处恢复为山体（(23,24,18)→(155,131,56)）。
  // 真天空穹已由规则模块 isSkyShell 剔除（新包 extras.sky，旧包 /sky/ fallback）；本页的渲染集合自此
  // 与 3D 运行时逐件一致（水件/穹顶/地形块均保留）——"完全照搬运行时"的最后一处收敛。
  // 旧"退化几何"按 (三角形/顶点) 比率逐网格删除已撤除：内容统计启发式无法区分旧导出器
  // 损坏与合法高比率网格，且静默删数据；树批次撕裂由导出器修正。
  // 逐节点材质分派 = 共享装配模块（与 3D 运行时同一份实现与同一顺序）：
  //   水(对象)→blendByAngle→decal→lm(+env+detail)→混合层掩码→水下→convMat。
  //   groundLayers 传**真实分层**（贴花件按 cm(UV1) 不受光渲染，同运行时——此前传 null
  //   使 faust 等 5 支 decal 材质回落受光 Lambert）；waterCoast 同运行时（水面片保留渲染）。
  // 场景网格清单（走廊掩码类筛选用；water = 材质带 extras.water）——与运行时同口径
  const sceneryMeshes = []
  assembleSceneryMaterials(gltf, {
    strictSurfaces,
    masks,
    groundLayers,
    waterCoast,
    debug: false,
    onMesh: (o, waterMarked) => {
      // #857：收集点在材质转换前（原始 extras 在）——liteDropped 标供走廊掩码语义策略
      sceneryMeshes.push({ o, water: waterMarked, liteDropped: isLiteDroppedMeshObject(o) });
    },
    // 预剔除已移除天穹；必须沿用剔除前的标记，否则会退回 /sky/ 名字并误伤普通网格
    skyFlagsAvailable,
  })
  // qFrame：与 playbackScene 同一帧变换（GLB 游戏系 z 上 → 回放场景系）。必须在材质装配**之后**
  // 挂载（与运行时 mapScenery 同序）：装配内的水面片收集/水下判定按 GLB 世界包围盒取 z 为高度、
  // (x,y) 为占地——先挂 qFrame 时结果取决于组世界矩阵是否已更新，更新后高度变成 y，水下件
  // 与水上件会互换材质（PR #621 review P2）。走廊掩码按场景系世界矩阵取样 ⇒ 挂载在掩码前。
  group = new THREE.Group()
  group.rotation.order = 'YXZ'
  group.rotation.set(-Math.PI / 2, Math.PI, 0)
  group.add(gltf.scene)
  scene.add(group)

  // ---- 贴地薄构件走廊掩码 + 地面网格（两者都在合批前；掩码=共享实现）----
  // 运行时同款机制（2026-10-14 用户报"轨道被下方地形遮挡"）：粗 LOD 插值面在路堑处会高于
  // 真实地表而盖住贴地薄构件；正交俯视同样成立（遮挡取决于插值高度）⇒ 走廊 texel 强制最细。
  group.updateMatrixWorld(true)
  let corridor = null
  try {
    corridor = buildCorridorRefineMask({
      meshes: sceneryMeshes, field,
      n: (tmeta && tmeta.size) || 512, span: effSpan,
    })
  } catch (e) { console.warn('ground pass: 走廊掩码构建失败（地形保持缺省口径）:', e) }
  if (field) {
    // 相机参数（位置/fov）只决定细分成本；正交直下时着色是 (x,z) 的函数，细分级只影响遮挡
    groundMesh = new THREE.Mesh(buildGroundGeometry({
      field, n: tmeta.size || 512, span: effSpan,
      cam: { x: 0, y: 1000, z: 0 }, fovY: 0.96, aspect: 1,
      hFovDeg: CLIENT_NORMAL_CAMERA_FOV_H,
      refineMask: corridor ? corridor.mask : null,
    }), makeGroundMaterial({
      layers: groundLayers.layers, texs: groundLayers.texs, size: effSpan,
    }))
    scene.add(groundMesh)
    // 不变量自检：分层着色才算地面 pass（回退档 MeshBasicMaterial 在烘焙侧无底图 = 纯白）
    if (!groundMesh.material.isShaderMaterial) throw new Error('ground pass: 地面材质未走分层着色（拒绝以回退材质出图）')
    groundReady = true
    console.log('corridor mask:', corridor ? JSON.stringify({ candidates: corridor.candidates, texels: corridor.texels }) : 'null')
  }

  // 实例化合批：与运行时**同一模块同一序列**（sceneryInstancing.js 的 collect → group →
  // buildInstancedMesh；aLm 逐实例属性、几何薄包装零拷贝都在模块内）。原节点摘除，
  // 批次挂回场景；D_ 损毁态/破坏匹配等运行时专属步骤本页无（相关节点已在剔除阶段移除）。
  const allEntries = collectInstanceEntries(gltf.scene)
  const batchable = (e) =>
    !(e.node.userData && e.node.userData.isSky)
    && !isWaterNode(e.name, e.material, { strictSurfaces })
    && !hasTransparentMaterial(e.material)
  const instEntries = allEntries.filter(batchable)
  const cellSize = Math.max(75, span / 8)
  const batches = groupInstanceBatches(instEntries, cellSize)
  for (const b of batches) { b.mesh = buildInstancedMesh(b); gltf.scene.add(b.mesh) }
  // 透明材质不批（three 只按 object 排序）；带 lm 的用单实例保留逐节点 atlas 变换
  buildStandaloneLightmappedMeshes(allEntries.filter((e) =>
    !batchable(e)
    && hasTransparentMaterial(e.material)
    && !(e.node.userData && e.node.userData.isSky)
    && !isWaterNode(e.name, e.material, { strictSurfaces })), gltf.scene)
  for (const e of instEntries) e.node.removeFromParent()
  return { ok: true, span: effSpan, ground: groundReady }
}

// 调试：对象 ID 拾取——每个 mesh 临时换唯一编码色渲染，读像素反查覆盖者
let __meshes = [], __idbuf = null, __names = []
function renderIdPass(span) {
  if (!__idbuf) {
    group.traverse((o) => { if (o.isMesh) __meshes.push(o) })
    __names = __meshes.map((m, i) => m.name || (m.parent && m.parent.name) || ('mesh#' + i))
    __idbuf = new Uint8Array(SIZE * SIZE * 4)
  }
  const orig = __meshes.map((m) => m.material)
  __meshes.forEach((m, i) => {
    const c = new THREE.Color(((i + 1) >> 16 & 255) / 255, ((i + 1) >> 8 & 255) / 255, ((i + 1) & 255) / 255)
    m.material = new THREE.MeshBasicMaterial({ color: c })
  })
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  __meshes.forEach((m, i) => { m.material = orig[i] })
  const gl = renderer.getContext()
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, __idbuf)
  const row = SIZE * 4
  const flipped = new Uint8Array(__idbuf.length)
  for (let y = 0; y < SIZE; y++) flipped.set(__idbuf.subarray(y * row, (y + 1) * row), (SIZE - 1 - y) * row)
  __idbuf = flipped
  return __meshes.length
}
function idAt(x, y) {
  const i = (y * SIZE + x) * 4
  const idx = (__idbuf[i] << 16) | (__idbuf[i + 1] << 8) | __idbuf[i + 2]
  return idx > 0 ? (__names[idx - 1] + '#' + idx) : '(empty)'
}

function render(span) {
  camera.left = -span / 2; camera.right = span / 2
  camera.top = span / 2; camera.bottom = -span / 2
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  // readPixels 行序自下而上：翻成图像行序（上到下），python 侧免翻转
  const row = SIZE * 4
  const flipped = new Uint8Array(buf.length)
  for (let y = 0; y < SIZE; y++) flipped.set(buf.subarray(y * row, (y + 1) * row), (SIZE - 1 - y) * row)
  window.__buf = flipped
  let covered = 0
  for (let i = 3; i < flipped.length; i += 4) if (flipped[i] > 8) covered++
  return { covered, coverPct: +(100 * covered / (SIZE * SIZE)).toFixed(2) }
}

// ---- ground-terrain（#857 Step 4）：terrain-only 渲染 + 客户端底图合成 → webp ----
// low/mid 档的地面 = 纯地形烘焙底图（无俯视 scenery 合成），与 3D 结构场景 lite 档配合
// 消除"3D 桥 + 地面图画桥"双重投影。朝向 = 常量 ORIENT "YX"（与 composite_overhead.py
// 同一坐标契约：渲染图左列 = −X_scene、顶行 = −Z_scene ⇒ 底图帧两轴各翻一次），纯索引
// 重排零插值；合成 = base×(1−a) + render×a（canvas source-over 即该式）。
// 无地形图（ground=false）：ground-terrain = 客户端底图原样（该档无 3D 地形/场景可叠）。
function renderTerrainOnly(span) {
  if (!groundMesh) return { ok: false, coverPct: null }   // 无地形图：合成走 base-only 分支
  camera.left = -span / 2; camera.right = span / 2
  camera.top = span / 2; camera.bottom = -span / 2
  camera.updateProjectionMatrix()
  const groupWasVisible = group ? group.visible : false
  if (group) group.visible = false          // 只藏场景组；地形/水面海岸线资源保留渲染
  renderer.render(scene, camera)
  if (group) group.visible = groupWasVisible
  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  const row = SIZE * 4
  const flipped = new Uint8Array(buf.length)
  for (let y = 0; y < SIZE; y++) flipped.set(buf.subarray(y * row, (y + 1) * row), (SIZE - 1 - y) * row)
  let covered = 0
  for (let i = 3; i < flipped.length; i += 4) if (flipped[i] > 8) covered++
  return { ok: true, rgba: flipped, coverPct: +(100 * covered / (SIZE * SIZE)).toFixed(2) }
}

async function composeGroundTerrain(span, space, key) {
  const baseResp = await fetch('/base/' + encodeURIComponent(space) + '.ground.webp')
  if (!baseResp.ok) throw new Error('客户端底图缺失: ' + space + '.ground.webp (HTTP ' + baseResp.status + ')')
  const bmp = await createImageBitmap(await baseResp.blob())
  const canvas = document.createElement('canvas')
  canvas.width = SIZE; canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE)
  const t = renderTerrainOnly(span)
  if (t.ok) {
    const tmp = document.createElement('canvas')
    tmp.width = SIZE; tmp.height = SIZE
    // ImageData 8-bit 构造器要求 Uint8ClampedArray（Uint8Array 会被部分实现拒绝/隐式
    // coercion），显式转换不靠隐式行为
    tmp.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(t.rgba.buffer, t.rgba.byteOffset, t.rgba.byteLength), SIZE, SIZE), 0, 0)
    ctx.save(); ctx.scale(-1, -1); ctx.drawImage(tmp, -SIZE, -SIZE); ctx.restore()   // ORIENT "YX"
  }
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.82))
  if (!blob) throw new Error('ground-terrain webp 编码失败')
  // ⚠️ 本页整体处于 BAKE_HTML 模板串内：页面代码禁用反引号，一律字符串拼接
  const resp = await fetch('/file-upload?rel=' + encodeURIComponent('map/' + key + '/ground-terrain.webp'),
    { method: 'POST', body: blob })
  if (!resp.ok) throw new Error('ground-terrain 上传失败: HTTP ' + resp.status)
  return { base: space, terrainRendered: t.ok, coverPct: t.coverPct, bytes: blob.size }
}

window.__bake = { init, load, render, renderIdPass, idAt, groundTerrain: composeGroundTerrain }
</script></body></html>`
}

/** 极简 vite：只为 /bake 页面（import three）与 /pack/*（场景 GLB）服务；/base/* 伺服
 *  客户端原始底图（ground-terrain 合成的 base，#857 Step 4）。 */
export async function startBakeServer({ pack, baseDir, size }) {
  const BASE_DIR = baseDir
    const uploadPath = join(pack, 'overhead', 'upload.rgba')   // /pixel-upload 落盘点（bakeKey 读同一路径）
  mkdirSync(join(pack, 'overhead'), { recursive: true })
  const server = await createServer({
    configFile: false,
    root: frontendRoot,
    logLevel: 'error',
    // 内联页的裸导入（three / GLTFLoader 深路径）需预打包才能被改写成浏览器可解析的 URL
    optimizeDeps: { include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'] },
    plugins: [{
      name: 'bake-pack-server',
      configureServer(server) {
        server.middlewares.use('/pack', (req, res) => {
          const rel = decodeURIComponent(req.url.replace(/^\//, '')).split('?')[0]
          const file = join(pack, rel)
          if (!file.startsWith(pack) || !existsSync(file)) { res.statusCode = 404; return res.end('nf') }
          res.setHeader('access-control-allow-origin', '*')
          // MIME 按扩展名：webp 交给 <img>/TextureLoader 需要 image/webp（octet-stream 下
          // Chromium 的 blob 解码不可靠）；json 供 fetch().json()
          const ct = rel.endsWith('.glb') ? 'model/gltf-binary'
            : rel.endsWith('.webp') ? 'image/webp'
            : rel.endsWith('.json') ? 'application/json'
            : 'application/octet-stream'
          res.setHeader('content-type', ct)
          createReadStream(file).pipe(res)
        })
        server.middlewares.use('/base', (req, res) => {
          const rel = decodeURIComponent(req.url.replace(/^\//, '')).split('?')[0]
          const file = join(BASE_DIR, rel)
          if (!file.startsWith(BASE_DIR) || !existsSync(file)) { res.statusCode = 404; return res.end('nf') }
          res.setHeader('content-type', 'image/webp')
          createReadStream(file).pipe(res)
        })
        server.middlewares.use('/bake', (_req, res) => {
          res.setHeader('content-type', 'text/html')
          // transformIndexHtml：内联 module 脚本 → vite 虚拟模块（裸导入才有改写的机会，见 BAKE_HTML 注释）
          server.transformIndexHtml('/bake', buildBakeHtml(size)).then((html) => res.end(html))
        })
        server.middlewares.use('/pixel-upload', (req, res) => {

          if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
          const chunks = []
          let total = 0
          req.on('data', (c) => { chunks.push(c); total += c.length })
          req.on('end', () => {
            const body = Buffer.concat(chunks, total)
            writeFileSync(uploadPath, body)
            res.end('ok:' + body.length)
          })
        })
        // ground-terrain 相（#857 Step 4）：页面合成好的 webp 直传包内最终路径（tmp+rename，
        // 与 .rgba 同口径——只有整文件成功才出现在最终路径）
        server.middlewares.use('/file-upload', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; return res.end() }
          const rel = decodeURIComponent(new URL(req.url, 'http://local').searchParams.get('rel') || '')
          if (!/^map\/[A-Za-z0-9_-]+\/ground-terrain\.webp$/.test(rel)) { res.statusCode = 400; return res.end('bad rel') }
          const file = join(pack, rel)
          mkdirSync(dirname(file), { recursive: true })
          const chunks = []
          req.on('data', (c) => chunks.push(c))
          req.on('end', () => {
            const body = Buffer.concat(chunks)
            writeFileSync(`${file}.tmp`, body)
            renameSync(`${file}.tmp`, file)
            res.end('ok:' + body.length)
          })
        })
      },
    }],
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()
  const origin = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '')
  if (!origin) throw new Error('vite did not publish a local URL')
  return { server, origin, uploadPath }
}
