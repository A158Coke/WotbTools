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

/** 展平可渲染叶子：{ node, name, geometry, material, matrix, x, y, z }。
 *  matrix = 以 root 为父系的完整局部变换（含整条父链，.GLTFLoader 产出的叶子
 *  Mesh 单 primitive 单材质）。调用方负责先 root.updateMatrixWorld(true)（或等价地
 *  保证局部矩阵新鲜），本函数只读不写。 */
export function collectInstanceEntries(root) {
  const out = []
  const stack = [{ node: root, parent: new THREE.Matrix4() }]
  while (stack.length) {
    const { node, parent } = stack.pop()
    // 本地矩阵必须新鲜：collect 通常发生在首次 render 之前（GLTFLoader 解析完只写了
    // position/quaternion/scale，node.matrix 尚未 compose），updateMatrix 幂等且廉价
    if (node.matrixAutoUpdate) node.updateMatrix()
    // 与节点本地矩阵合成（node.matrix 含自身 position/rotation/scale）
    const world = parent.clone().multiply(node.matrix)
    for (const child of node.children) stack.push({ node: child, parent: world })
    if (!node.isMesh || !node.geometry) continue
    const e = world.elements
    out.push({
      node,
      name: node.name || '',
      geometry: node.geometry,
      material: node.material,
      matrix: world,
      x: e[12], y: e[13], z: e[14],
    })
  }
  return out
}

/** 按 (geometry, material) 分组：[{ geometry, material, items: [entry, …] }]。
 *  顺序稳定（首见序），保证同输入同输出（seek 确定性）。 */
export function groupInstanceBatches(entries) {
  const byKey = new Map()
  for (const e of entries) {
    const key = `${e.geometry.uuid}|${e.material.uuid}`
    let b = byKey.get(key)
    if (!b) { b = { geometry: e.geometry, material: e.material, items: [] }; byKey.set(key, b) }
    b.items.push(e)
  }
  return [...byKey.values()]
}

/** 由批次构造 InstancedMesh（矩阵在构造时写入；动态改写由调用方 needsUpdate）。
 *  必须在全部实例矩阵写入后 computeBoundingSphere——视锥剔除用的球要罩住**所有**
 *  实例，用几何自身球会按原点剔错（远处实例整批消失）。 */
export function buildInstancedMesh(batch) {
  const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.items.length)
  // 树倒 / 换模翻转是运行期唯一改写路径：DynamicDrawUsage 允许局部上传，静态批不付代价
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  batch.items.forEach((it, i) => mesh.setMatrixAt(i, it.matrix))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.matrixAutoUpdate = false   // 批自身变换恒为 root 本地单位阵，冻结由场景加载段统一处理
  return mesh
}

/** 隐藏实例 = 远处 + 微缩：不用精确零矩阵（奇异矩阵进 raycast 的求逆会产生 NaN 路径），
 *  微缩退化三角形 GPU 直接丢弃、包围球/射线球测都不可能命中。 */
export function writeHiddenInstance(mesh, idx) {
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
export function fallMatrix(base, pivotX, pivotY, pivotZ, axis, angle, out) {
  _t1.makeTranslation(-pivotX, -pivotY, -pivotZ)
  _t2.makeTranslation(pivotX, pivotY, pivotZ)
  _r.makeRotationAxis(axis, angle)
  return out.copy(_t2).multiply(_r).multiply(_t1).multiply(base)
}
const _t1 = new THREE.Matrix4()
const _t2 = new THREE.Matrix4()
const _r = new THREE.Matrix4()
