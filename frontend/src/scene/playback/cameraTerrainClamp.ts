// 相机地形净空与旋转中心钳制（#820 Wave B6A 自 playbackScene.js 出仓）。
//
// 单一职责：OrbitControls 相机点相对地形的净空校验 + target 可玩范围钳制。输入面只有
// 「相机/controls + 两条高度采样 + 世界范围」；不创建场景、不持有 mesh、不决定相机模式
// （cameraDriven 由调用方提供）。飞行/录像者相机的离地约束在各自路径，不在这里。
//
// 语义（与出仓前实现逐值一致）：
// - 高度优先取渲染网格真实三角面（含 LOD/morph/缝合）；网格未建或该点无三角面时回退
//   高度场。超出高度场范围的 x/z 返回 null——没有地形数据时不得拿 0 当代替，否则会在
//   边界外制造假的净空。
// - 放大阻挡沿 target→camera 射线从当前距离向外逐轮重采样（最多 24 轮，0.5 斜率下
//   12 轮仍差最后几厘米）。若射线没有安全交点（坡面比射线更陡、方向水平/向下、或出
//   高度场），在相机当前 x/z 垂直抬到净空之上——绝不把相机留在地下。
// - 贴住限制时把 minDistance 锁在当前安全距离，滚轮继续放大不会钻地；缩小后相机升高，
//   minDistance 复位，**target 全程不动**（旋转/缩放中心不变）。
// - target 钳制框 = max(世界范围 × 1.1, 340)：既保护「拖到天边只剩背景色」的视野，
//   又不吞掉键盘飞行的位移（ext 小的图上 lim 若只有 ±10，WASD 每帧被拉回）。
import * as THREE from 'three'
import type { Vector3 } from 'three'

/** OrbitControls 在本模块用到的字段（结构化类型，不把 three/examples 拖进单测）。 */
export interface OrbitControlsLike {
  target: Vector3
  minDistance: number
  maxDistance: number
}

/** 相机在本模块用到的字段（只读写 position 并 lookAt）。 */
export interface CameraLike {
  position: Vector3
  lookAt(target: Vector3): void
}

/** 高度场元数据（与 terrainMesh / heightMeta 的消费面一致）。 */
export interface HeightMetaLike {
  size: number
  span: number
}

/** 战场世界范围（buildWorld 计算：中心与半径）。 */
export interface WorldCenterLike {
  cx: number
  cz: number
  ext: number
}

export interface CameraTerrainClampDeps {
  /** 相机在 initScene 才创建；取值为 null 时钳制 fail-closed（不猜位置）。 */
  getCamera: () => CameraLike | null
  getControls: () => OrbitControlsLike | null
  /** 相机由飞行/录像者路径驱动：地形轨道钳制不参与。 */
  cameraDriven: () => boolean
  /** 渲染网格是否存在（决定是否尝试真实三角面采样）。 */
  getTerrainMesh: () => unknown | null
  getHeightField: () => unknown | null
  getHeightMeta: () => HeightMetaLike | null
  /** 渲染网格真实三角面高度；无网格/该点无三角面返回 null。 */
  sampleRenderedTerrainHeight: (x: number, z: number) => number | null
  /** 高度场双线性采样；无数据返回 0（调用方保证 heightField/heightMeta 就绪）。 */
  sampleHeight: (x: number, z: number) => number
  /** 相机离地净空（米）。 */
  clearance: number
  /** 世界范围在 buildWorld 完成后才可用。 */
  getWorldCenter: () => WorldCenterLike
  /** 跟随中 target 钉在坦克上（坦克恒在图内），不钳制。 */
  isFollowing: () => boolean
}

export interface CameraTerrainClamp {
  /** 按世界范围设置 min/max 距离（初值；实测后由净空钳制再调）。 */
  applyCameraClamp: (ext: number) => void
  /** 当前基准最小距离（未锁定净空时的值）。 */
  baseMinDistance: () => number
  terrainHeightForCameraClamp: (x: number, z: number) => number | null
  /** @returns 本帧是否改动了相机位置 / minDistance。 */
  clampOrbitCameraToTerrain: () => boolean
  clampCameraTarget: () => void
}

export function createCameraTerrainClamp(deps: CameraTerrainClampDeps): CameraTerrainClamp {
  let baseMinDistance = 20
  const scratchDir = new THREE.Vector3()

  function applyCameraClamp(ext: number): void {
    const controls = deps.getControls()
    if (!controls) return
    baseMinDistance = Math.max(20, ext * 0.08)
    controls.minDistance = baseMinDistance
    controls.maxDistance = ext * 2.2
  }

  function terrainHeightForCameraClamp(x: number, z: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    const rendered = deps.getTerrainMesh() ? deps.sampleRenderedTerrainHeight(x, z) : null
    if (typeof rendered === 'number' && Number.isFinite(rendered)) return rendered
    const heightField = deps.getHeightField()
    const heightMeta = deps.getHeightMeta()
    if (!heightField || !heightMeta) return null
    const n = Number(heightMeta.size), span = Number(heightMeta.span)
    if (!Number.isInteger(n) || n < 2 || !Number.isFinite(span) || span <= 0) return null
    const half = span / 2
    if (x < -half || x >= half || z < -half || z >= half) return null
    const h = deps.sampleHeight(x, z)
    return Number.isFinite(h) ? h : null
  }

  function clampOrbitCameraToTerrain(): boolean {
    const camera = deps.getCamera()
    const controls = deps.getControls()
    if (deps.cameraDriven() || !camera || !controls || !deps.getHeightField() || !deps.getHeightMeta()) return false
    const t = controls.target
    if (!Number.isFinite(t.y) || !Number.isFinite(camera.position.y)) return false
    const dir = scratchDir.subVectors(camera.position, t)
    const dist = dir.length()
    if (!(dist > 1e-6)) { controls.minDistance = baseMinDistance; return false }
    dir.divideScalar(dist)
    const clearance = deps.clearance

    let safeDist = dist
    let safeTerrain: number | null = null
    let found = false
    for (let i = 0; i < 24; i++) {
      const px = t.x + dir.x * safeDist
      const pz = t.z + dir.z * safeDist
      const py = t.y + dir.y * safeDist
      const terrainY = terrainHeightForCameraClamp(px, pz)
      if (typeof terrainY !== 'number' || !Number.isFinite(terrainY)) break
      safeTerrain = terrainY
      // 1 mm 容差：不动点迭代尾部只差浮点级距离，不应因此判成「无交点」。
      if (py + 1e-3 >= terrainY + clearance) { found = true; break }
      // 水平/向下射线外推不会升高：不再找，交给下面的垂直回退。
      if (!(dir.y > 1e-4)) break
      const next = (terrainY + clearance - t.y) / dir.y
      if (!Number.isFinite(next) || next <= safeDist + 1e-6) break
      safeDist = next
    }
    // 安全点超出 OrbitControls 的最大缩放距离：下一帧 update 会把相机拉回来，
    // 那个距离仍在地形里。改为在相机当前 x/z 垂直抬升，避免来回振荡。
    if (found && safeDist > controls.maxDistance) found = false

    if (!found) {
      const camTerrain = terrainHeightForCameraClamp(camera.position.x, camera.position.z)
      if (typeof camTerrain !== 'number' || !Number.isFinite(camTerrain)) {
        controls.minDistance = baseMinDistance
        return false
      }
      const lift = camTerrain + clearance
      if (camera.position.y < lift) {
        camera.position.y = lift
        camera.lookAt(t)
        const locked = Math.max(baseMinDistance, camera.position.distanceTo(t))
        controls.minDistance = locked
        controls.maxDistance = Math.max(controls.maxDistance, locked)
        return true
      }
      // 相机点本身安全、只是射线前方无交点：无需限制。
      controls.minDistance = baseMinDistance
      return false
    }

    const camDist = camera.position.distanceTo(t)
    const limit = (safeTerrain as number) + clearance
    // 相机低于净空、或还没退到安全距离：沿原方向退到 safeDist（target 不动）。
    if (camDist < safeDist - 1e-6 || camera.position.y < limit - 0.02) {
      camera.position.copy(t).addScaledVector(dir, safeDist)
      camera.lookAt(t)
      controls.minDistance = Math.max(baseMinDistance, safeDist)
      return true
    }
    // 已贴净空：保持 minDistance 锁定，滚轮继续放大不会钻地；缩小后自然释放。
    if (camera.position.y <= limit + 0.02) {
      controls.minDistance = Math.max(baseMinDistance, safeDist)
      return false
    }
    controls.minDistance = baseMinDistance
    return false
  }

  function clampCameraTarget(): void {
    if (deps.isFollowing()) return
    const controls = deps.getControls()
    if (!controls) return
    const { cx, cz, ext } = deps.getWorldCenter()
    const lim = Math.max(ext * 1.1, 340)
    const t = controls.target
    const nx = Math.min(cx + lim, Math.max(cx - lim, t.x))
    const nz = Math.min(cz + lim, Math.max(cz - lim, t.z))
    if (nx !== t.x) t.x = nx
    if (nz !== t.z) t.z = nz
  }

  return {
    applyCameraClamp,
    baseMinDistance: () => baseMinDistance,
    terrainHeightForCameraClamp,
    clampOrbitCameraToTerrain,
    clampCameraTarget,
  }
}