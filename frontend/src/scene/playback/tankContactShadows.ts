// 坦克接地软阴影（blob / contact shadow）：每车一片贴地渐变网格，不透明内核恰好是车体，
// 按场景现有 sunLight 的传播方向只加长背光一侧的渐隐尾（有界）。不是实时 Shadow Map——地形/场景材质不接收阴影，
// 也不改光照：太阳方向只读 sunLight → target 的世界位置（mapLighting.ts 是唯一写入方）。
// 生命周期由宿主（playbackScene）持有：仅在用户开启且画质门禁通过时创建，会话 teardown 时 dispose；
// 关闭时本模块从不实例化（零资源、零绘制）。
import * as THREE from 'three'
import type { DirectionalLight, Object3D, Scene } from 'three'

/** 车体系半尺寸（米）：halfW = 横向，halfL = 纵向（车头 +Z）。 */
export interface ShadowFootprint {
  halfW: number
  halfL: number
}

/** 太阳对单车阴影的有界作用：沿传播方向加长背光侧渐隐尾。 */
export interface SunShadow {
  /** 太阳不可用（非有限 / 零向量 / 不朝向地面 / 正上方）→ 四周等宽的居中阴影 */
  centered: boolean
  /** 水平传播方向（单位向量；centered 时为 0） */
  dirX: number
  dirZ: number
  /** 背光侧额外渐隐尾长，单位 = halfW 的倍数（与车体大小关联、有上限） */
  tailFactor: number
}

interface Vec3Like { x: number, y: number, z: number }

/** 代理车履带盒 3.6 × 6.5 m（playbackScene.buildVehicles）：GLB 尺寸不可得时的回落。 */
export const PROXY_FOOTPRINT: Readonly<ShadowFootprint> = Object.freeze({ halfW: 1.8, halfL: 3.25 })

// 视觉常量：背光尾长 ∝ tan(天顶角)，硬上限 = 1.2 × halfW（约 1.8–2.1 m）；迎光侧只有窄接触带。
// 36 张图的太阳仰角 21°–66°（中位 ~35°）——曾把偏移/拉伸作用在不透明内核上，
// 多数图直接打满上限，车后拖出一块 3–4 m 的实心暗板；内核现在恒等于车体。
const K_TAIL = 0.6
const MAX_TAIL = 1.2
/** 传播方向 y 分量至少这么"朝下"才算照向地面（约 3° 仰角以上） */
const MIN_DOWN = 0.05
const CENTERED: Readonly<SunShadow> = Object.freeze({ centered: true, dirX: 0, dirZ: 0, tailFactor: 0 })

/**
 * 由光源与 target 的世界位置求阴影作用。传播方向 = target − light（太阳 → 地面），
 * 阴影落在传播方向的水平分量一侧；**不取反**。
 */
export function sunShadowFrom(light: Vec3Like, target: Vec3Like): SunShadow {
  const dx = target.x - light.x, dy = target.y - light.y, dz = target.z - light.z
  if (![dx, dy, dz].every(Number.isFinite)) return CENTERED
  const n = Math.hypot(dx, dy, dz)
  if (!(n > 1e-9)) return CENTERED
  const ux = dx / n, uy = dy / n, uz = dz / n
  if (uy > -MIN_DOWN) return CENTERED   // 水平或向上：不是照向地面的太阳
  const h = Math.hypot(ux, uz)
  if (!(h > 1e-6)) return CENTERED      // 正上方：阴影就在车下
  const ratio = h / -uy                 // tan(天顶角)：太阳越低越大
  return {
    centered: false,
    dirX: ux / h,
    dirZ: uz / h,
    tailFactor: Math.min(K_TAIL * ratio, MAX_TAIL),
  }
}

/** 底盘节点（履带 / 负重轮）= 实际接地范围；命名与 glbParts.collectGlbParts 的车体/底盘拆分同源 */
const CHASSIS_NODE = /^chassis_(track|wheel)_/i

/** object 自身坐标系下、满足 pick 的网格包围盒（与 object 当前位姿无关） */
function localBox(object: Object3D, pick: (node: Object3D) => boolean): THREE.Box3 {
  object.updateWorldMatrix(true, true)
  const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const box = new THREE.Box3(), part = new THREE.Box3(), m = new THREE.Matrix4()
  object.traverse((node) => {
    if (!pick(node)) return
    node.traverse((child) => {
      const geo = (child as THREE.Mesh).geometry
      if (!(child as THREE.Mesh).isMesh || !geo) return
      if (!geo.boundingBox) geo.computeBoundingBox()
      box.union(part.copy(geo.boundingBox!).applyMatrix4(m.multiplyMatrices(toLocal, child.matrixWorld)))
    })
  })
  return box
}

/**
 * GLB 实例一次性测接地水平尺寸；不可信时回落代理尺寸。
 * - 轴向：GLB 模型系是 Z-up（glbRig.ts 的 Q_FRAME = Ry(π)·Rx(−π/2) 转到场景 Y-up），
 *   模型 X = 车宽、Y = 车长（→ 场景 Z）、Z = 高。按模型自身坐标量，与当前位姿无关。
 * - 只量底盘：整车包围盒含炮管外伸，长炮管车的阴影会被拉长并向车尾对称外扩。
 *   未知模型（无底盘命名）回落整车包围盒。
 */
export function measureShadowFootprint(object: Object3D): ShadowFootprint {
  let box = localBox(object, (node) => CHASSIS_NODE.test(node.name || ''))
  if (box.isEmpty()) box = localBox(object, (node) => node === object)
  const size = box.getSize(new THREE.Vector3())
  const halfW = size.x / 2, halfL = size.y / 2
  if (!Number.isFinite(halfW) || !Number.isFinite(halfL) || halfW < 0.3 || halfL < 0.3 || halfW > 6 || halfL > 12) {
    return { ...PROXY_FOOTPRINT }
  }
  return { halfW, halfL }
}

/** 网格每边顶点数：25 个有界采样点贴合斜坡，成本不随地形规模变化 */
export const GRID = 5
const LIFT = 0.04         // 离地抬升（米），配合 polygonOffset 防 z-fighting
const OPACITY = 0.65
const SHADOW_COLOR = 0x0b0f14

/**
 * 四周的接触带宽（米）：只模拟履带贴地处的遮蔽，窄且与车宽成比例。
 * 渐变必须落在车体**外**（俯视时车体盖住内核），但不能宽：四周等宽的宽光晕
 * 与任何真实光照都不符（迎光侧也发暗），用户真实 GPU 验收判为「说不出的奇怪」。
 * 明显度交给只在背光侧出现的太阳尾巴。
 */
export function shadowMargin(fp: ShadowFootprint): number {
  return Math.min(0.6, Math.max(0.35, fp.halfW * 0.25))
}

/**
 * 九宫格轴映射：网格线 t ∈ {-1, -0.5, 0, 0.5, 1}（对应 uv 0/0.25/0.5/0.75/1），
 * |t| ≤ 0.5 线性铺满车体半宽 h，|t| > 0.5 铺车体外的渐隐带（负侧 mNeg、正侧 mPos）。
 * 内线恰好压在车体边缘 ⇒ 贴图的不透明内核覆盖车体、渐隐只发生在车外。
 */
function axisOffset(t: number, h: number, mNeg: number, mPos: number): number {
  const a = Math.abs(t)
  const m = t < 0 ? mNeg : mPos
  const d = a <= 0.5 ? a * 2 * h : h + (a - 0.5) * 2 * m
  return t < 0 ? -d : d
}

/**
 * 贴图 alpha（x, y ∈ [-1, 1]，与 uv 同向）：|x|,|y| ≤ 0.5 的内核恒为 1，
 * 外圈按到内核的圆角矩形距离平滑降到 0。
 */
export function shadowAlpha(x: number, y: number): number {
  const qx = Math.max(Math.abs(x) - 0.5, 0) * 2
  const qy = Math.max(Math.abs(y) - 0.5, 0) * 2
  return 1 - THREE.MathUtils.smoothstep(Math.min(1, Math.hypot(qx, qy)), 0, 1)
}

/**
 * 网格顶点（世界 XZ）。纯函数：基础矩形按车体 yaw 旋转（three rotation.y 口径：
 * 世界 = (lx·c + lz·s, −lx·s + lz·c)）。太阳传播方向先转进车体系，背光侧两条边的
 * 渐隐带各加长 tail × 该轴分量——尾巴总长 = tail、恒指向传播方向，车辆转向时不跟着转。
 */
export function shadowGridXZ(x: number, z: number, yaw: number, fp: ShadowFootprint, sun: SunShadow, out: Float32Array): Float32Array {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const m = shadowMargin(fp)
  const tail = sun.tailFactor * fp.halfW
  const ldx = c * sun.dirX - s * sun.dirZ   // 传播方向的车体系分量（旋转矩阵转置）
  const ldz = s * sun.dirX + c * sun.dirZ
  const mxNeg = m + tail * Math.max(-ldx, 0), mxPos = m + tail * Math.max(ldx, 0)
  const mzNeg = m + tail * Math.max(-ldz, 0), mzPos = m + tail * Math.max(ldz, 0)
  let i = 0
  for (let r = 0; r < GRID; r++) {
    const v = (r / (GRID - 1)) * 2 - 1
    for (let q = 0; q < GRID; q++) {
      const u = (q / (GRID - 1)) * 2 - 1
      const lx = axisOffset(u, fp.halfW, mxNeg, mxPos), lz = axisOffset(v, fp.halfL, mzNeg, mzPos)
      out[i++] = x + lx * c + lz * s
      out[i++] = z - lx * s + lz * c
    }
  }
  return out
}

function makeGradientTexture(): THREE.DataTexture {
  const n = 64
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4
      data[o] = data[o + 1] = data[o + 2] = 255
      data[o + 3] = Math.round(255 * shadowAlpha((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1))
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

interface ShadowEntry {
  mesh: THREE.Mesh
  pos: THREE.BufferAttribute
  footprint: ShadowFootprint
  x: number, z: number, yaw: number
  /** 已据此采样的太阳/地表版本；不一致才重采样（静止/暂停零开销） */
  stamp: number
  /** 宿主要求显示（车辆可见） */
  wanted: boolean
  /** 上次贴地成功（全部采样点有地表） */
  grounded: boolean
}

export interface TankContactShadowsOptions {
  scene: Scene
  sunLight: DirectionalLight
  /** 当前可见地表高度（无地表 / 越界返回 null，不得以 0 冒充） */
  heightAt: (x: number, z: number) => number | null
}

export interface TankContactShadows {
  /** 重读 sunLight → target（地图光照应用/复位后调用） */
  syncSun(): void
  /** 记录车辆实测尺寸（GLB 挂载时一次） */
  setFootprint(owner: object, footprint: ShadowFootprint): void
  /** 按车辆当前（已变换完成的）场景位姿更新阴影；visible=false 隐藏 */
  update(owner: object, x: number, z: number, yaw: number, visible: boolean): void
  /** 地表换代（地形就绪 / LOD）：按缓存位姿重新贴地 */
  reground(): void
  /** 当前可见阴影数（诊断/测试） */
  count(): number
  dispose(): void
}

export function createTankContactShadows({ scene, sunLight, heightAt }: TankContactShadowsOptions): TankContactShadows {
  const texture = makeGradientTexture()
  const material = new THREE.MeshBasicMaterial({
    color: SHADOW_COLOR, map: texture, transparent: true, opacity: OPACITY,
    depthTest: true, depthWrite: false, toneMapped: false,
    // 比基地/出生点贴地标记（-2/-3）更靠后：标记压在阴影上
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  })
  const entries = new Map<object, ShadowEntry>()
  const footprints = new Map<object, ShadowFootprint>()
  const xz = new Float32Array(GRID * GRID * 2)
  const lightWorld = new THREE.Vector3(), targetWorld = new THREE.Vector3()
  let sun: SunShadow = CENTERED
  let version = 1
  let disposed = false

  const uvs = new Float32Array(GRID * GRID * 2)
  const index: number[] = []
  for (let r = 0; r < GRID; r++) {
    for (let q = 0; q < GRID; q++) {
      uvs[(r * GRID + q) * 2] = q / (GRID - 1)
      uvs[(r * GRID + q) * 2 + 1] = r / (GRID - 1)
      if (r < GRID - 1 && q < GRID - 1) {
        const i = r * GRID + q
        index.push(i, i + GRID, i + 1, i + 1, i + GRID, i + GRID + 1)
      }
    }
  }

  function entryFor(owner: object): ShadowEntry {
    let e = entries.get(owner)
    if (e) return e
    const geometry = new THREE.BufferGeometry()
    const pos = new THREE.BufferAttribute(new Float32Array(GRID * GRID * 3), 3)
    pos.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', pos)
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2))
    geometry.setIndex(index)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'tankContactShadow'
    mesh.visible = false
    mesh.matrixAutoUpdate = false   // 顶点已是世界坐标
    scene.add(mesh)
    e = { mesh, pos, footprint: footprints.get(owner) ?? PROXY_FOOTPRINT, x: NaN, z: NaN, yaw: NaN, stamp: 0, wanted: false, grounded: false }
    entries.set(owner, e)
    return e
  }

  function place(e: ShadowEntry): void {
    shadowGridXZ(e.x, e.z, e.yaw, e.footprint, sun, xz)
    const arr = e.pos.array as Float32Array
    for (let i = 0; i < GRID * GRID; i++) {
      const wx = xz[i * 2], wz = xz[i * 2 + 1]
      const y = heightAt(wx, wz)
      // 任一采样点无地表（图外 / 地表未就绪）→ 整片隐藏，不拿 0 冒充地面
      if (y == null || !Number.isFinite(y)) { e.grounded = false; e.mesh.visible = false; return }
      arr[i * 3] = wx; arr[i * 3 + 1] = y + LIFT; arr[i * 3 + 2] = wz
    }
    e.pos.needsUpdate = true
    e.mesh.geometry.computeBoundingSphere()
    e.grounded = true
    e.mesh.visible = true
  }

  const api: TankContactShadows = {
    syncSun() {
      if (disposed) return
      sunLight.updateMatrixWorld()
      sunLight.target.updateMatrixWorld()
      sunLight.getWorldPosition(lightWorld)
      sunLight.target.getWorldPosition(targetWorld)
      sun = sunShadowFrom(lightWorld, targetWorld)
      version++
    },
    setFootprint(owner, footprint) {
      if (disposed) return
      footprints.set(owner, footprint)
      const e = entries.get(owner)
      if (e) { e.footprint = footprint; e.stamp = 0 }
    },
    update(owner, x, z, yaw, visible) {
      if (disposed) return
      if (!visible) {
        const e = entries.get(owner)
        if (e) { e.wanted = false; e.mesh.visible = false }
        return
      }
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return
      const e = entryFor(owner)
      e.wanted = true
      if (e.stamp === version && e.x === x && e.z === z && e.yaw === yaw) {
        // 位姿与太阳/地表未变：只恢复显隐（上次因无地表隐藏则仍隐藏）
        e.mesh.visible = e.grounded
        return
      }
      e.x = x; e.z = z; e.yaw = yaw; e.stamp = version
      place(e)
    },
    reground() {
      if (disposed) return
      version++
      for (const e of entries.values()) {
        if (!e.wanted || !Number.isFinite(e.x)) continue
        e.stamp = version
        place(e)
      }
    },
    count() {
      let n = 0
      for (const e of entries.values()) if (e.mesh.visible) n++
      return n
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const e of entries.values()) {
        scene.remove(e.mesh)
        e.mesh.geometry.dispose()
      }
      entries.clear()
      footprints.clear()
      material.dispose()
      texture.dispose()
    },
  }
  api.syncSun()
  return api
}
