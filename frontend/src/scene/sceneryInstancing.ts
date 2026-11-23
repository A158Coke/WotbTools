/**
 * 场景 GLB 的实例化合批（纯函数 + 薄 three 构造；单测锁不变量）。
 *
 * 背景：地图导出器把同一实例批次的每个实例导成独立节点（节点级共享 mesh/几何——
 * 实测 malinovka 3096 节点 / 142 唯一几何）。GLTFLoader 为每个节点建独立 Mesh →
 * 每帧 ~3000 draw call + 同量级场景图双遍历，是中/高档场景侧最大的 CPU 开销。
 * 这里把节点按 (geometry, material) 分组成 InstancedMesh：几何**零拷贝**复用
 * （clone 共享同一 BufferGeometry），draw call 从节点数降到批次数。
 *
 * 可破坏物不在本模块（树倒/建筑换模的逐实例矩阵由 playbackScene 驱动），但
 * fallMatrix 提供与旧 pivot 组装**逐值等价**的倒伏矩阵（等价性由测试锁定）：
 * 旧模型 = pivot(T(p)·R) ∘ child(T(pos−p)·R·S)；实例模型 = T(p)·R·T(−p)·M_node。
 * 两者相差的 T(p)·T(−p) 在矩阵乘法下消去，浮点序差异 ~1e-7 量级。
 */
import * as THREE from 'three'
import type { BufferGeometry, InstancedMesh, Material, Matrix4, Mesh, Object3D, Sphere, Vector3 } from 'three'

/** 展平可渲染叶子。matrix = 以 root 为父系的完整局部变换（含整条父链；GLTFLoader 产出的叶子
 *  Mesh 单 primitive 单材质——material 按 Material 建模）。调用方负责先 root.updateMatrixWorld(true)
 *  （或等价地保证局部矩阵新鲜），本函数只读不写。 */
export interface InstanceEntry {
  node: Mesh
  name: string
  geometry: BufferGeometry
  material: Material
  matrix: Matrix4
  x: number
  y: number
  z: number
  /** 烘焙光照图的逐实例 UV 变换 [sx, sy, ox, oy]（导出器节点 extras.lm；缺失 = null） */
  lm: number[] | null
}

/** 透明材质不能进 InstancedMesh：three 只按 object 排序，批内实例顺序固定，
 *  重叠软混合物（alphaBlend 树/效果片）会随镜头出现错误混合。返回 true = 保留独立节点。 */
export function hasTransparentMaterial(material: Material | Material[] | null | undefined): boolean {
  const ms = Array.isArray(material) ? material : [material]
  return ms.some((m) => !!(m && m.transparent))
}

/** 材质签名的**保守白名单**（只收直接影响渲染输出的属性；不在表里的差异不会被
 *  合并——宁少合不错合）。纹理按 uuid 进键：同图同参才合并。 */
const MATERIAL_SIGNATURE_FIELDS: ReadonlyArray<string> = Object.freeze([
  'type', 'map', 'lightMap', 'aoMap', 'alphaMap', 'normalMap', 'emissiveMap', 'envMap',
  'color', 'emissive', 'specular', 'shininess', 'roughness', 'metalness',
  'opacity', 'transparent', 'alphaTest', 'side', 'vertexColors', 'flatShading',
  'blending', 'depthWrite', 'depthTest', 'wireframe',
  'premultipliedAlpha', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
])

/** 渲染状态字段（ShaderMaterial 与内建材质共用 Material 基类上的这些属性）。
 *  ShaderMaterial 分支必须显式拼上：它的 uniforms/源码相同但 transparent/depthWrite/
 *  side 等仍可能不同，只比 uniforms 会把不同渲染状态的材质并成一份。 */
const RENDER_STATE_FIELDS: ReadonlyArray<string> = Object.freeze([
  'transparent', 'opacity', 'alphaTest', 'side', 'blending', 'vertexColors', 'flatShading',
  'depthWrite', 'depthTest', 'colorWrite', 'premultipliedAlpha',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits',
  'visible',
])

/** 着色器编译期 define 签名。**必须进键**：同源码同 uniforms、只有 `defines` 不同的
 *  材质走不同编译分支——实例如 `makeDecalMaterial` 的 `DECAL_SEPARATE_LM`：不论
 *  `separateLm` 值如何 `colormapLm` uniform 都存在，只有 define 决定是否乘光照图；
 *  漏判会把逐实例光照语义并成首个材质的一份（评审 P2 反例）。 */
/** 读材质上的运行期扩展属性（uniforms/defines/userData/onBeforeCompile）。用
 *  `Reflect.get` 而非 `as unknown as` 断言：three 的 Material 类型不含这些字段，
 *  而本仓的 TypeScript escape-hatch 基线**只减不增**（typescript-ownership.test.ts），
 *  新增断言会被门禁拒绝。语义等价：都是读自有/继承属性（getter 亦按需触发）。 */
function materialProp(m: Material, key: string): unknown {
  return Reflect.get(m, key)
}

/** 颜色签名：**原始 r/g/b 浮点**，不经 `getHexString()`——后者把颜色钳到 8-bit
 *  显示域，HDR tint（如 1.77）会与 1.0 得到同一个 hex，而 lightmapped/decal 的
 *  着色器直接用原始 `uTint` 乘算 → 亮度不同却被并成一份（评审 P2）。 */
function colorSignature(color: { r: number, g: number, b: number }): string {
  return `c:${color.r.toFixed(6)},${color.g.toFixed(6)},${color.b.toFixed(6)}`
}

function definesSignature(m: Material): string {
  const defines = materialProp(m, 'defines')
  if (!defines || typeof defines !== 'object') return '-'
  const record = defines as Record<string, unknown>
  return Object.keys(record).sort().map((k) => `${k}=${String(record[k])}`).join(',')
}

function renderStateSignature(m: Material): string {
  return RENDER_STATE_FIELDS.map((f) => `${f}=${materialSignatureValue(m, f)}`).join(',')
}

/** 3D annotation 可绘制策略签名（装配期 `sceneryAssembly.markNotDrawable` 写入
 *  `userData.annotationSurface`；消费口径见 `annotationSurface.isDrawableSurfaceHit`：
 *  **只有显式 false 排除**，undefined 与 true 等价 = 可绘制）。
 *  **必须进身份**：薄片贴花 overlay 与实体（如贴花桥）可以共享同一套源码/uniforms/
 *  defines/渲染状态，仅此策略不同；规整忽略它会让代表材质的标记决定整批，
 *  traversal 顺序就可能让桥不可标注、或让薄片变成可选中（评审 P2）。 */
function annotationPolicySignature(m: Material): string {
  const userData = materialProp(m, 'userData')
  const policy = userData && typeof userData === 'object'
    ? (userData as { annotationSurface?: unknown }).annotationSurface
    : undefined
  return policy === false ? 'annotation:false' : 'annotation:true'
}

function materialSignatureValue(m: Material, field: string): string {
  const value = materialProp(m, field)
  if (value == null) return '-'
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return String(value)
  // 纹理：uuid 即身份（同图对象共享 uuid）；颜色：hex
  if (typeof value === 'object' && 'uuid' in (value as object)) return `tex:${(value as { uuid: string }).uuid}`
  if (typeof value === 'object' && (value as { isColor?: boolean }).isColor === true) {
    return colorSignature(value as { r: number, g: number, b: number })
  }
  return String(value)
}

/** uniforms 值签名（ShaderMaterial 族的渲染状态全在 uniforms 里：光照图建筑材质
 *  makeLightmappedMaterial 的 map/lightmap/atlas/uTint/uEnv* 等）。纹理按 uuid、
 *  颜色按 hex、向量/数组按值；未认识的类型按字符串化值保守进键。 */
function uniformValueSignature(value: unknown): string {
  if (value == null) return 'null'
  const v = value as Record<string, unknown>
  if (v.isTexture === true) return `tex:${String(v.uuid)}`
  if (v.isColor === true) return colorSignature(value as { r: number, g: number, b: number })
  if (v.isVector2 === true || v.isVector3 === true || v.isVector4 === true) {
    return `v:${(value as { toArray?(): number[] }).toArray?.().join(',') ?? String(value)}`
  }
  if (v.isMatrix3 === true || v.isMatrix4 === true) {
    return `m:${Array.from((value as { elements: number[] }).elements).join(',')}`
  }
  if (Array.isArray(value)) return `a:${value.join(',')}`
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return String(value)
  return `opaque:${String(value)}`
}

/** onBeforeCompile 的**原型默认实现**（three 给每个材质都挂了空函数；不与原型默认
 *  比较的话，所有材质都会被误判成"有自定义注入"而拒绝规整）。 */
const DEFAULT_ON_BEFORE_COMPILE = THREE.Material.prototype.onBeforeCompile

/** 自定义 program 注入（运行期改着色器）无法静态签名 → 该材质拒绝规整。 */
function hasCustomProgramHook(m: Material): boolean {
  const hook = materialProp(m, 'onBeforeCompile')
  return typeof hook === 'function' && hook !== DEFAULT_ON_BEFORE_COMPILE
}

/** ShaderMaterial 族签名：着色器源码 + uniforms + defines + 渲染状态。四者缺一都可能
 *  把走不同编译分支/不同混合状态的材质并成一份（defines 反例见 definesSignature）。 */
function shaderMaterialSignature(m: Material): string | null {
  const uniforms = materialProp(m, 'uniforms')
  if (!uniforms || typeof uniforms !== 'object') return null
  const parts = [
    'shader',
    String(materialProp(m, 'vertexShader') ?? ''),
    String(materialProp(m, 'fragmentShader') ?? ''),
    `defines:${definesSignature(m)}`,
    `state:${renderStateSignature(m)}`,
    annotationPolicySignature(m),
  ]
  for (const name of Object.keys(uniforms as Record<string, unknown>).sort()) {
    const uniform = (uniforms as Record<string, { value?: unknown } | undefined>)[name]
    parts.push(`${name}=${uniformValueSignature(uniform?.value)}`)
  }
  return parts.join('|')
}

/** 材质签名 → key；多材质叶子（契约外）或不可静态签名者返回 null = 不规整。 */
function materialSignature(m: Material | Material[]): string | null {
  if (Array.isArray(m)) return null
  if (hasCustomProgramHook(m)) return null
  // ShaderMaterial 族（光照图建筑/环境反射/细节层等）：标准属性白名单读不到
  // uniforms——用 uniforms+着色器源码签名；这里漏判会把同族不同贴图的实例并到
  // 第一个材质对象上（2026-11-14 实测：建筑物贴图全串）。
  const uniforms = materialProp(m, 'uniforms')
  if (uniforms && typeof uniforms === 'object') return shaderMaterialSignature(m)
  // 内建材质同样可能有 defines（走不同编译分支）→ 一并进键
  return [...MATERIAL_SIGNATURE_FIELDS.map((f) => materialSignatureValue(m, f)),
    `defines:${definesSignature(m)}`, annotationPolicySignature(m)].join('|')
}

/** 材质签名规整：导出器给每个节点各建一份材质对象，属性相同也会把 (geometry,
 *  material) 分组键撕开（幽灵工厂实测 170 材质对象 / 27 种真实配置），批次数被
 *  人为抬高一倍、GL 状态切换同步膨胀。这里把同配置材质收敛到**同一个代表对象**：
 *  代表对象是入参之一、其余引用直接换成代表（原对象随后随节点丢弃，未渲染过
 *  不会进 GPU 缓存，无 dispose 负担）。分组键合并依赖本步；合批键是
 *  geometry.uuid（几何不做内容级去重——形状差异不可凭签名断言）。 */
export function canonicalizeEntryMaterials<T extends { material: Material | Material[] }>(entries: T[]): T[] {
  const byKey = new Map<string, Material>()
  for (const e of entries) {
    const key = materialSignature(e.material)
    if (key === null) continue
    const rep = byKey.get(key)
    if (rep === undefined) { byKey.set(key, e.material as Material); continue }
    if (rep !== e.material) e.material = rep
  }
  return entries
}

export function collectInstanceEntries(root: Object3D): InstanceEntry[] {
  const out: InstanceEntry[] = []
  const stack: Array<{ node: Object3D; parent: Matrix4 }> = [{ node: root, parent: new THREE.Matrix4() }]
  while (stack.length) {
    const top = stack.pop()
    if (!top) break
    const { node, parent } = top
    // 本地矩阵必须新鲜：collect 通常发生在首次 render 之前（GLTFLoader 解析完只写了
    // position/quaternion/scale，node.matrix 尚未 compose），updateMatrix 幂等且廉价
    if (node.matrixAutoUpdate) node.updateMatrix()
    // 与节点本地矩阵合成（node.matrix 含自身 position/rotation/scale）
    const world = parent.clone().multiply(node.matrix)
    for (const child of node.children) stack.push({ node: child, parent: world })
    const mesh = node as Mesh
    if (!mesh.isMesh || !mesh.geometry) continue
    const e = world.elements
    out.push({
      node: mesh,
      name: mesh.name || '',
      geometry: mesh.geometry,
      material: mesh.material as Material,   // GLTFLoader 叶子单 primitive 单材质（见文件头契约）
      matrix: world,
      x: e[12], y: e[13], z: e[14],
      // 烘焙光照图的逐实例 UV 变换 [sx, sy, ox, oy]（导出器节点 extras.lm；
      // 客户端 `varTexCoord1 = uvScale*texcoord1 + uvOffset` 是逐材质实例的）
      lm: (mesh.userData && Array.isArray(mesh.userData.lm)) ? mesh.userData.lm : null,
    })
  }
  return out
}

/** 紧邻的已有批次可在同一三角预算内合并；稠密区域原样交还。 */
function combineSparseRegions(
  batches: Iterable<InstanceEntry[]>, regionSize: number, trisEach: number, maxTris: number, minBatches: number,
): InstanceEntry[][] {
  const regions = new Map<string, InstanceEntry[][]>()
  for (const batch of batches) {
    const key = Math.floor(batch[0].x / regionSize) + ',' + Math.floor(batch[0].y / regionSize)
    const region = regions.get(key)
    if (region) region.push(batch)
    else regions.set(key, [batch])
  }
  const out: InstanceEntry[][] = []
  for (const region of regions.values()) {
    const count = region.reduce((sum, batch) => sum + batch.length, 0)
    if (region.length >= minBatches && trisEach * count <= maxTris) out.push(region.flat())
    else for (const batch of region) out.push(batch)
  }
  return out
}

/** 按 (geometry, material, 宫格) 分组：每片独立 InstancedMesh。
 *  cellSize 有限时按世界坐标宫格分片——整批一个跨全图的包围球会失去逐实例
 *  视锥剔除（镜头看半张图，视野外的实例也全量提交，林荫图实测减半的树渲染
 *  量全靠它）；分片后每片包围球局部化，剔除恢复到格粒度，draw call 总量
 *  仍 ≈ 片数（远小于实例数）。cellSize = Infinity 关闭分片（单批，兼容旧形态）。 */
export interface InstanceBatch {
  geometry: BufferGeometry
  material: Material
  items: InstanceEntry[]
}

/** 单批合并的三角量预算（性能旋钮，非语义开关；0 = 关闭合并，恢复逐格分片形态）。
 *
 *  (geometry, material) 一组的**总三角量**（几何三角 × 实例数）≤ 预算时，整组合并
 *  为一个跨宫格单批：常驻提交这些三角的顶点处理成本远低于「每格一个 draw call」
 *  的固定成本（幽灵工厂实测 1294 批 / 2678 实例 = 批均 2.1 实例，每帧 1449 调用
 *  的主体是这批小几何稀疏种；合并后 scenery 批次 ≈ 1/4，材质状态切换随材质规整
 *  再降一档）。大几何密集种（林荫图树海：几何大、实例多，逐实例剔除有真实渲染量
 *  收益——「镜头看半张图视野外实例全量提交」正是它实测卡顿的主因）超预算，
 *  以空间分片保留剔除粒度；只在相邻区域不超预算时共用一批。 */
export const SCENERY_COLLAPSE_MAX_TRIS = 20000

/** 几何三角数（index 优先；非索引几何按 position 顶点数折算）。 */
function geometryTriCount(geometry: BufferGeometry): number {
  const idx = geometry.index
  if (idx) return idx.count / 3
  const pos = geometry.attributes?.position
  return pos ? pos.count / 3 : 0
}

/** 按 (geometry, material, 宫格) 分组：每片独立 InstancedMesh。
 *  cellSize 有限时按世界坐标宫格分片——整批一个跨全图的包围球会失去逐实例
 *  视锥剔除（镜头看半张图，视野外的实例也全量提交，林荫图实测减半的树渲染
 *  量全靠它）；分片后每片包围球局部化，剔除恢复到格粒度。
 *  小三角量组（总三角 ≤ SCENERY_COLLAPSE_MAX_TRIS，可被 opts.maxCollapseTris 覆盖，
 *  0 关闭）无视宫格退化为整组单批——见该常量注释。cellSize = Infinity 关闭分片
 * （单批，兼容旧形态）。 */
export function groupInstanceBatches(
  entries: readonly InstanceEntry[],
  cellSize = Infinity,
  opts: { maxCollapseTris?: number } = {},
): InstanceBatch[] {
  const maxCollapseTris = opts.maxCollapseTris ?? SCENERY_COLLAPSE_MAX_TRIS
  const out: InstanceBatch[] = []
  const byGeoMat = new Map<string, { geometry: BufferGeometry; material: Material; cells: Map<string, InstanceEntry[]> }>()
  for (const e of entries) {
    const gk = `${e.geometry.uuid}|${e.material.uuid}`
    let g = byGeoMat.get(gk)
    if (!g) {
      g = { geometry: e.geometry, material: e.material, cells: new Map() }
      byGeoMat.set(gk, g)
    }
    const cx = cellSize === Infinity ? 0 : Math.floor(e.x / cellSize)
    const cy = cellSize === Infinity ? 0 : Math.floor(e.y / cellSize)
    const ck = `${cx},${cy}`
    let items = g.cells.get(ck)
    if (!items) { items = []; g.cells.set(ck, items) }
    items.push(e)
  }
  for (const g of byGeoMat.values()) {
    // 小三角量组：整组合并单批（常驻提交总三角 ≤ 预算，换取调用数合并；
    // 只在跨多格时有意义——单格组本来就是单批）
    if (maxCollapseTris > 0 && g.cells.size > 1) {
      const trisEach = geometryTriCount(g.geometry)
      let total = 0
      for (const items of g.cells.values()) total += items.length
      if (trisEach * total <= maxCollapseTris) {
        const items: InstanceEntry[] = []
        for (const cell of g.cells.values()) items.push(...cell)
        out.push({ geometry: g.geometry, material: g.material, items })
        continue
      }
      // 先尝试合并相邻细格。在更大的区域，至少能减少两次提交时才扩大剔除范围。
      const pairs = combineSparseRegions(g.cells.values(), cellSize * 2, trisEach, maxCollapseTris, 2)
      for (const items of combineSparseRegions(pairs, cellSize * 4, trisEach, maxCollapseTris, 3)) {
        out.push({ geometry: g.geometry, material: g.material, items })
      }
      continue
    }
    for (const items of g.cells.values()) {
      out.push({ geometry: g.geometry, material: g.material, items })
    }
  }
  return out
}

/** 由批次构造 InstancedMesh（矩阵在构造时写入；动态改写由调用方 needsUpdate）。
 *  必须在全部实例矩阵写入后 computeBoundingSphere——视锥剔除用的球要罩住**所有**
 *  实例，用几何自身球会按原点剔错（远处实例整批消失）。 */
export function buildInstancedMesh(batch: InstanceBatch): InstancedMesh {
  const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.items.length)
  // 烘焙光照图的逐实例 UV 变换：材质（extras.lightmap）按客户端公式
  // `albedo(UV0) × lightmap(UV1×uvScale+uvOffset) × 2` 采样，变换必须逐实例给
  //（放材质键会让同一网格每实例各建一份几何，实测膨胀 2.3–11.3×），故走实例属性。
  // 批内任一实例带 lm 即挂属性；缺失实例填单位变换（fail-closed：宁可按原 UV1 采样，
  // 也不静默用邻居的变换）。
  if (batch.items.some((it) => it.lm)) {
    const arr = new Float32Array(batch.items.length * 4)
    batch.items.forEach((it, i) => {
      const v = it.lm || [1, 1, 0, 0]
      arr[i * 4] = v[0]; arr[i * 4 + 1] = v[1]; arr[i * 4 + 2] = v[2]; arr[i * 4 + 3] = v[3]
    })
    const attr = new THREE.InstancedBufferAttribute(arr, 4)
    attr.setUsage(THREE.StaticDrawUsage)
    // 几何**不能**就地 setAttribute：几何是跨批次零拷贝复用的，两个批次挂不同数组会
    // 互相覆盖。用"薄包装几何"——属性对象**原样引用**（three 按属性对象建 GPU 缓冲，
    // 引用同一对象即零重复上传），只额外挂 aLm（16 B/实例）。不用 geometry.clone()：
    // clone 会复制属性对象 → 顶点缓冲被重复上传（实测 +4~8 MB/图）。
    const g = new THREE.BufferGeometry()
    for (const name in batch.geometry.attributes) g.setAttribute(name, batch.geometry.attributes[name])
    if (batch.geometry.index) g.setIndex(batch.geometry.index)
    g.setAttribute('aLm', attr)
    mesh.geometry = g
    mesh.userData.lmInstances = batch.items.length
  }
  // 树倒 / 换模翻转是运行期唯一改写路径：DynamicDrawUsage 允许局部上传，静态批不付代价
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  batch.items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.matrixAutoUpdate = false   // 批自身变换恒为 root 本地单位阵，冻结由场景加载段统一处理
  return mesh
}

/**
 * 不可合批（透明排序/单独节点）但带逐节点光照图变换的网格：用**单实例 InstancedMesh**
 * 承载。这样既保留"一个 object 一个透明排序单位"，又复用 buildInstancedMesh 的 aLm
 * 逐实例 UV 变换（否则非实例路径按原始 uv1 采样，会读错 atlas 区域）。
 * @returns {entry, mesh} 列表（单实例 InstancedMesh 与其来源 entry）
 */
export function buildStandaloneLightmappedMeshes(entries: readonly InstanceEntry[], target: Object3D): Array<{ entry: InstanceEntry; mesh: InstancedMesh }> {
  const out: Array<{ entry: InstanceEntry; mesh: InstancedMesh }> = []
  for (const e of entries) {
    if (!e || !e.lm || !e.geometry || !e.material) continue
    const mesh = buildInstancedMesh({ geometry: e.geometry, material: e.material, items: [e] })
    target.add(mesh)
    e.node.removeFromParent()
    out.push({ entry: e, mesh })
  }
  return out
}

/** 隐藏实例 = 远处 + 微缩：不用精确零矩阵（奇异矩阵进 raycast 的求逆会产生 NaN 路径），
 *  微缩退化三角形 GPU 直接丢弃、包围球/射线球测都不可能命中。 */
export function writeHiddenInstance(mesh: InstancedMesh, idx: number): void {
  _m.compose(_hiddenPos, _idQ, _tinyScale)
  mesh.setMatrixAt(idx, _m)
}

const _m = new THREE.Matrix4()
const _hiddenPos = new THREE.Vector3(0, -1e6, 0)
const _idQ = new THREE.Quaternion()
const _tinyScale = new THREE.Vector3(1e-6, 1e-6, 1e-6)

/**
 * 树倒实例矩阵：out = T(pivot) · R(axis, angle) · T(−pivot) · base。
 * 与旧 pivot 装配逐值等价（见文件头）；axis 为 root 局部系（z 上）的世界轴。
 */
export function fallMatrix(base: Matrix4, pivotX: number, pivotY: number, pivotZ: number, axis: Vector3, angle: number, out: Matrix4): Matrix4 {
  _t1.makeTranslation(-pivotX, -pivotY, -pivotZ)
  _t2.makeTranslation(pivotX, pivotY, pivotZ)
  _r.makeRotationAxis(axis, angle)
  return out.copy(_t2).multiply(_r).multiply(_t1).multiply(base)
}
const _t1 = new THREE.Matrix4()
const _t2 = new THREE.Matrix4()
const _r = new THREE.Matrix4()

/** 重算批次包围球：逐实例几何球并集。**可见槽位用当前实例矩阵、初始隐藏的
 *  损毁态（D_）槽位用其 base 位姿**——两者都是合法可渲染位置：
 *  - three 的 InstancedMesh.computeBoundingSphere 会 union 全部实例，D_ 的
 *    「远处微缩」隐藏矩阵（y=-1e6）会把球撑到无效量级（剔除全失效）；
 *  - 但**跳过**隐藏槽位同样错（评审五轮）：只含损毁模型的批次球为空
 *    （radius=-1），混合批次也不覆盖将来会恢复的合法位置——摧毁事件激活后
 *    模型虽可见，仍被旧球剔除、射线在球测先被拒。
 *  修法取评审建议的覆盖式：隐藏槽位按 base 位姿计入覆盖（不纳入 y=-1e6
 *  隐藏矩阵），显隐翻转无需再维护球。 */
export function refreshBatchSphere(
  mesh: InstancedMesh,
  batch: Pick<InstanceBatch, 'geometry' | 'items'>,
  isHidden?: (it: InstanceEntry) => boolean,
): Sphere {
  const sph = new THREE.Sphere()
  sph.makeEmpty()
  if (!batch.geometry.boundingSphere) batch.geometry.computeBoundingSphere()
  if (!batch.geometry.boundingBox) batch.geometry.computeBoundingBox()
  const geoSphere = batch.geometry.boundingSphere as Sphere   // computeBoundingSphere 必然落球
  const box = new THREE.Box3()
  box.makeEmpty()
  const m = new THREE.Matrix4()
  const tmp = new THREE.Sphere()
  const tmpBox = new THREE.Box3()
  batch.items.forEach((it, i) => {
    if (isHidden && isHidden(it)) m.copy(it.matrix)   // 隐藏：base 位姿（合法可恢复位置）
    else mesh.getMatrixAt(i, m)                       // 可见：当前实例矩阵
    tmp.copy(geoSphere).applyMatrix4(m)
    sph.union(tmp)
    tmpBox.copy(batch.geometry.boundingBox as THREE.Box3).applyMatrix4(m)
    box.union(tmpBox)
  })
  if (mesh.boundingSphere) mesh.boundingSphere.copy(sph)
  else mesh.boundingSphere = sph
  if (mesh.userData.occluderBox) mesh.userData.occluderBox.copy(box)
  else mesh.userData.occluderBox = box
  return mesh.boundingSphere
}
