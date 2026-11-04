/**
 * 射击轨迹几何构建（armor viewer 点击判定；Issue #820 Wave B3B）。
 *
 * 从 tankViewer.js `showTrajectory()` 原样搬出的 Three.js 轨迹 Group 工厂：
 * 纯几何构建、不访问 window/document、不持有 runtime state、不挂载到任何
 * scene——调用方（tankViewer）拥有 fxScene / trajGroup 生命周期与移除语义，
 * 本模块只按已算好的输入（层链、轨迹色）构建等价的 Mesh/材质/renderOrder。
 *
 * 原语义保留：轨迹原点优先取调用方弹道起点，否则沿视线反向回退 300m；
 * incoming 点链遇 ricochet 截断；reflected 段由 ricochet 点与 `seg === 1`
 * 续飞点组成；Tube/标记的半径、分段、透明度与 renderOrder 数值不变。
 */
import * as THREE from 'three'

/** 轨迹几何消费的层链字段（与卡片 ShotResultCardLayer 同一来源，兼容 snake/camel）。 */
export interface ShotTrajectoryGeometryLayer {
  point: THREE.Vector3
  ricochet?: boolean
  seg?: number | null
  penetrated?: boolean
  /** 仅 probabilityMode 分支读取的逐层累计概率。 */
  chance?: number | null
  [key: string]: unknown
}

/** createShotTrajectoryGroup 的显式输入（全部由调用方计算）。 */
export interface ShotTrajectoryInput {
  /** 命中面首点（轨迹/标记的世界坐标基准）。 */
  firstPoint: THREE.Vector3
  /** 相机位置：origin 回退沿 `cameraPosition - firstPoint` 视线反向计算。 */
  cameraPosition: THREE.Vector3
  /** 弹道起点（如炮口）；缺省时按 300m 视线回退。 */
  trajOrigin?: THREE.Vector3 | null
  /** 层链（概率模式下为调用方预算好的累计概率链）。 */
  layers: ReadonlyArray<ShotTrajectoryGeometryLayer>
  /** 轨迹线/段颜色（调用方按最终判定算出，与结果卡 trajectoryColor 共享）。 */
  color: number
  /** 概率模式：层点颜色按逐层累计概率分档，否则按判定结果给色。 */
  probabilityMode: boolean
}

/** 概率色分档：0 红、0–1 黄、1 绿（与结果卡层着色共用同一数值表）。 */
export function trajectoryChanceColor(chance: number): number {
  return chance >= 1 ? 0x4CAF50 : (chance > 0 ? 0xffcf5c : 0xf44336)
}

/** 轨迹层点颜色：概率模式按逐层累计概率分档，否则按判定结果给色。 */
export function trajectoryLayerColor(layer: ShotTrajectoryGeometryLayer, probabilityMode: boolean): number {
  if (probabilityMode) return trajectoryChanceColor(layer.chance ?? 0)
  return layer.penetrated ? 0x4CAF50 : (layer.ricochet ? 0xFF8800 : 0xf44336)
}

/**
 * 轨迹 Group 工厂：与原 showTrajectory() 的几何构建等价。
 * 返回 `lastPoint`（层链末点或 firstPoint）供调用方定位轨迹信息面板；
 * group 的移除/dispose 仍由调用方按现有语义处理，本模块不挂载到任何 scene。
 */
export function createShotTrajectoryGroup(input: ShotTrajectoryInput): { group: THREE.Group; lastPoint: THREE.Vector3 } {
  const { firstPoint, cameraPosition, layers, color, probabilityMode } = input
  const group = new THREE.Group()

  // 轨迹管原点：调用方传入的弹道起点（如炮口）优先；否则沿视线反向
  // 长距离回退（300m），入射弹向一眼可见（原 15m 太短——用户反馈）
  const camDir = cameraPosition.clone().sub(firstPoint).normalize()
  const origin = input.trajOrigin || firstPoint.clone().add(camDir.multiplyScalar(300))
  const trajMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })

  const ricLayer = layers.find(l => l.ricochet)
  const ricPoint = ricLayer ? ricLayer.point : null

  const incoming: THREE.Vector3[] = [origin]
  for (const l of layers) {
    incoming.push(l.point)
    if (l.ricochet) break; // stop at ricochet point
  }
  if (incoming.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(incoming, false, 'catmullrom', 0)
    const geo = new THREE.TubeGeometry(curve, Math.max(2, incoming.length * 2), 0.025, 8, false)
    const mesh = new THREE.Mesh(geo, trajMat)
    mesh.renderOrder = 999
    group.add(mesh)
  }

  const reflected: THREE.Vector3[] = []
  let sawRicPoint = false
  for (const l of layers) {
    if (l.ricochet) { sawRicPoint = true; reflected.push(l.point); continue }
    if (l.seg === 1) {
      if (!sawRicPoint) { reflected.push(ricPoint as THREE.Vector3); sawRicPoint = true }
      reflected.push(l.point)
    }
  }
  if (sawRicPoint && reflected.length >= 2) {
    const curve = new THREE.CatmullRomCurve3(reflected, false, 'catmullrom', 0)
    const geo = new THREE.TubeGeometry(curve, Math.max(2, reflected.length * 2), 0.025, 8, false)
    const mesh = new THREE.Mesh(geo, trajMat)
    mesh.renderOrder = 999
    group.add(mesh)
  }

  for (const l of layers) {
    const dotGeo = new THREE.SphereGeometry(0.04, 8, 8)
    const dotMat = new THREE.MeshBasicMaterial({
      color: trajectoryLayerColor(l, probabilityMode), depthTest: false, transparent: true, opacity: 0.95,
    })
    const dotMesh = new THREE.Mesh(dotGeo, dotMat)
    dotMesh.position.copy(l.point)
    dotMesh.renderOrder = 999
    group.add(dotMesh)
  }

  const lastPoint = (layers.length > 0 ? layers[layers.length - 1].point : firstPoint).clone()

  // 轨迹画在溅射球壳之上（996）、命中标记之下（999）：三者的深度测试都关闭，
  // 玻璃球壳不能把轨迹线/层点糊掉。
  group.traverse((o) => { if (o instanceof THREE.Mesh) o.renderOrder = 997 })
  return { group, lastPoint }
}
