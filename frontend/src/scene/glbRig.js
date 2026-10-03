// GLB 装配共享 rig（架构债文档第 3 节）：装甲查看器（tankViewer.js）与全场回放
// （playbackScene.js）此前各自维护逐字相同的实现——抽共享后姿态语义单点定义。
//
// 坐标契约（两场景一致，勿单侧改动）：
// - 游戏系 → 场景系 = x 取负、yaw 取负（镜像）；GLB 根 = poseFromYPR(−yaw, pitch, 0)；
// - qFrame = Ry(π)·Rx(−π/2) 的 z-up→y-up 帧变换（GLB 内部系 x右/y前/z上）；
// - 炮塔绕 models.pb 原点链枢轴 Rz(−rel) 旋转、炮管 Rx(俯仰)，见各自 poseGlb /
//   poseShooterTurretGun（消费方还带 bake 捕获与炮盾随动，留在场景侧）。
import * as THREE from 'three'

// 模块级常量与 scratch：poseFromYPR 在 3D 回放里**每车每帧**被调用（14 车 × 60fps），
// 原实现每次分配 5 个 Quaternion + 3 个 Vector3——是每帧 GC 抖动的主要来源之一。
// 帧变换与旋转轴都是常量；调用方可传 `out` 复用目标四元数（不传则照旧返回新对象，
// tankViewer 里把结果绑到变量再用的调用点不受影响）。
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
/** qFrame = Ry(π)·Rx(−π/2)，常量，预计算一次 */
const Q_FRAME = new THREE.Quaternion()
  .setFromAxisAngle(AXIS_Y, Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2))
const _qYaw = new THREE.Quaternion()
const _qPitch = new THREE.Quaternion()
const _qRoll = new THREE.Quaternion()

/**
 * GLB 根节点四元数：yaw/pitch/roll（场景系）× z-up→y-up 帧变换。
 * `out` 传入时写入并返回它（热路径零分配）；省略则返回新对象（兼容既有调用点）。
 */
export function poseFromYPR(yaw, pitch, roll, out) {
  const q = out || new THREE.Quaternion()
  _qYaw.setFromAxisAngle(AXIS_Y, yaw || 0)
  _qPitch.setFromAxisAngle(AXIS_X, pitch || 0)
  _qRoll.setFromAxisAngle(AXIS_Z, roll || 0)
  return q.copy(_qYaw).multiply(_qPitch).multiply(_qRoll).multiply(Q_FRAME)
}

/** 逐值比较两个顶点属性（`BufferAttribute` / `InterleavedBufferAttribute` 都实现
 *  `getComponent`；按 count×itemSize 取值而不是直接比底层 array——interleaved 属性的
 *  array 是整块交织 buffer，直接比会因其它属性混在同一 buffer 里而误判「不同」）。
 *  遇到不认识的属性实现（无 `getComponent`）一律判**不同**——本判据会删节点，
 *  宁可漏删也不能误删。 */
function sameAttributeValues(a, b, epsilon) {
  if (!a || !b) return a === b
  if (a.itemSize !== b.itemSize || a.count !== b.count) return false
  if (typeof a.getComponent !== 'function' || typeof b.getComponent !== 'function') return false
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < a.itemSize; c++) {
      const d = a.getComponent(i, c) - b.getComponent(i, c)
      if (d > epsilon || d < -epsilon) return false
    }
  }
  return true
}

/** 两个 mesh 的几何是否**数据层面同源**：属性集合逐名对应、每个属性逐值相等、index 逐值
 *  相等、morph 键集合一致。属性集合比较是**全量**的（不是只挑 position/uv）——真实 GLB 里
 *  车体类 primitive 还带 TEXCOORD_1，漏比一个属性就等于给误删留了盲点。
 *  不比较 material（材质跨节点复用，与几何副本无关）。 */
function sameMeshGeometry(ga, gb) {
  if (ga === gb) return true
  const namesA = Object.keys(ga.attributes).sort()
  const namesB = Object.keys(gb.attributes).sort()
  if (namesA.length !== namesB.length) return false
  for (let i = 0; i < namesA.length; i++) {
    if (namesA[i] !== namesB[i]) return false
    if (!sameAttributeValues(ga.attributes[namesA[i]], gb.attributes[namesB[i]], 1e-6)) return false
  }
  if (!sameAttributeValues(ga.index, gb.index, 0)) return false   // 索引是整数：精确比较
  const ma = Object.keys(ga.morphAttributes || {}).sort()
  const mb = Object.keys(gb.morphAttributes || {}).sort()
  if (ma.length !== mb.length) return false
  for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) return false
  return true
}

/**
 * 丢弃与 `gun_NN_mask` **几何数据完全一致**的 `mask_NN` 重复件。
 *
 * 实测（2026-10-03）：Maus（tank 6929；全 735 台里唯一一个）的视觉模型同时存在
 * `gun_01_mask` 与 `mask_01` 两个节点——两者**共用同一套索引/UV accessor，位置数据逐值
 * 相同**，即同一块炮盾的重复副本。装配 rig 只按名字摆位（`^gun_\d+(_mask)?$`
 * 随炮管、`turret_\d+` 随炮塔），`mask_NN` 不在其中，于是炮塔/炮管转走后这份副本
 * **留在原地**（表现为"原地还剩一块炮盾"），且两份共面几何本就互相 z-fighting。
 *
 * 判据是**几何数据一致**（子树内 mesh 数、逐 mesh 的 position/normal/uv/index 逐值相等，
 * 见 `sameMeshGeometry`）而不只是命名或包围盒：几何不同则原样保留——绝不凭"名字像副本"
 * 就删掉可见部件。
 *
 * dispose 归属：删除前核对**没有保留节点**引用同一 `BufferGeometry`、也没有引用它内部的
 * 任何 attribute / index 对象才释放——实测真实 Maus 资产上两份副本的 TEXCOORD_0 /
 * TEXCOORD_1 / INDEX 就是**共享的 accessor 对象**（只有 POSITION / NORMAL 是各写一份），
 * 释放被删几何会连带把保留部件仍在用的 GPU buffer 一起回收。materials / textures
 * 一律不在此处释放。
 *
 * @returns {number} 丢弃的节点数（0 = 无副本，正常）
 */
export function dropDuplicateGunMasks(root) {
  if (!root) return 0
  const meshesOf = (node) => {
    const out = []
    node.traverse((n) => { if (n.isMesh && n.geometry) out.push(n) })
    return out
  }
  const sameGeometry = (a, b) => {
    if (a.length !== b.length || !a.length) return false
    return a.every((ma, i) => sameMeshGeometry(ma.geometry, b[i].geometry))
  }
  const byName = new Map()
  root.traverse((n) => { if (n.name) byName.set(n.name, n) })
  let dropped = 0
  for (const [name, node] of byName) {
    const m = name.match(/^mask_(\d+)$/)
    if (!m) continue
    const counterpart = byName.get(`gun_${m[1]}_mask`)
    if (!counterpart || !sameGeometry(meshesOf(node), meshesOf(counterpart))) continue
    const removed = meshesOf(node)
    const removedSet = new Set(removed)
    // 保留节点仍在引用的 GPU 资源：geometry 本身 + 它的每个 attribute + index
    // （GLTFLoader 按 accessor 缓存属性对象，两个几何可以共享同一份 uv/index）
    const stillReferenced = new Set()
    root.traverse((n) => {
      if (!n.isMesh || !n.geometry || removedSet.has(n)) return
      stillReferenced.add(n.geometry)
      for (const key of Object.keys(n.geometry.attributes)) stillReferenced.add(n.geometry.attributes[key])
      if (n.geometry.index) stillReferenced.add(n.geometry.index)
    })
    for (const mesh of removed) {
      const geometry = mesh.geometry
      const shared = stillReferenced.has(geometry)
        || (geometry.index && stillReferenced.has(geometry.index))
        || Object.keys(geometry.attributes).some((key) => stillReferenced.has(geometry.attributes[key]))
      if (!shared) geometry.dispose()
    }
    if (node.parent) node.parent.remove(node)
    else root.remove(node)
    dropped++
  }
  return dropped
}

/** 老式车材质（无 metallicRoughness 贴图）的金属度归零。
 *
 * glTF 的 `pbrMetallicRoughness` 省略 `metallicFactor` 时默认值是 **1.0**（全金属），
 * 而老式车材质（`*_mtr`，如 T-34/M4 Sherman）只有 baseColor + normal、没有
 * metallicRoughness 贴图，于是 three.js 照默认值把它当抛光金属渲染。本查看器没有
 * 环境贴图（无 `scene.environment`）：金属拿不到任何环境反射，漫反射又被
 * `diffuseColor * (1 − metalness)` 归零，环境光与半球光对它**恒等于零**，
 * 整车只剩聚光灯的宽高光 → 发黑（实测 T-34 平均亮度 17.8/255，低于背景 21.4，
 * 即黑过背景；仅把金属度归零即回到 119.2，与 PBR 车 E-100 的 116.0 齐平；
 * 单独改粗糙度无效，只到 23.7）。
 *
 * 判据与 BlitzKit `useModel` 的 `hasPbr`（任一材质有 roughnessMap）同源：无
 * metallicRoughness 贴图即非 PBR。只动「无贴图且仍为默认 1」的材质——显式声明过
 * 金属度的材质不受影响。
 */
export function neutralizeDefaultMetalness(root) {
  root.traverse((node) => {
    if (!node.isMesh) return
    const material = node.material
    if (material && !material.metalnessMap && material.metalness === 1) material.metalness = 0
  })
}
