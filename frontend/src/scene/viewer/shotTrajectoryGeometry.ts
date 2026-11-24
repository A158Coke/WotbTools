/**
 * 射击轨迹几何构建（armor viewer 点击判定；Issue #820 Wave B3B）。
 *
 * 2026-11 视觉重做：不再用世界空间 TubeGeometry + 球点（近处 5–7px 粗、远处亚像素，
 * 且受 ACES tone mapping 压暗），改为屏幕空间恒定宽度：
 * - 入射/反射段 = `Line2` 2px 核心 + 4px 深色描边；
 * - 层点 = 7px 圆点（含 1.5px 深色描边），颜色表示**当前层自身**的击穿状态
 *   （跳弹紫 / 穿透绿 / 可能黄 / 挡下红；概率模式用该层局部概率，不是累计概率）；
 * - 颜色来自 `shotResultPalette` 的语义角色（卡片/图例/3D 同源）。
 *
 * 纯几何构建、不访问 window/document、不持有 runtime state、不挂载到任何
 * scene——调用方（tankViewer）拥有 fxScene / trajGroup 生命周期与移除语义。
 * 原语义保留：轨迹原点优先取调用方弹道起点，否则沿视线反向回退 300m；
 * incoming 点链遇 ricochet 截断；reflected 段由 ricochet 点与 `seg === 1` 续飞点组成。
 */
import * as THREE from 'three'
import { createScreenSpaceDot, createScreenSpacePolyline } from './overlayStroke.js'
import {
  OVERLAY_METRICS, layerResultRole, sceneResultColor, type ShotResultRole,
} from './shotResultPalette.js'

/** 轨迹几何消费的层链字段（与卡片 ShotResultCardLayer 同一来源，兼容 snake/camel）。 */
export interface ShotTrajectoryGeometryLayer {
  point: THREE.Vector3
  ricochet?: boolean
  seg?: number | null
  penetrated?: boolean
  /** 仅 probabilityMode 分支读取的逐层局部概率（该层自身 CDF）。 */
  layerChance?: number | null
  /** 炮弹是否到达该层；概率链归零后的后续层为 false（层点用中性灰）。 */
  reached?: boolean
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
  /** 层链（概率模式下为调用方预算好的概率链：累计 chance + 逐层局部 layerChance）。 */
  layers: ReadonlyArray<ShotTrajectoryGeometryLayer>
  /** 最终判定角色（射线/反射段与结果卡共用；层点按各自角色着色）。 */
  resultRole: ShotResultRole
  /** 概率模式：层点颜色按该层局部概率分档，否则按该层判定结果给色。 */
  probabilityMode: boolean
  /** 调用方（结果卡 owner）已算好的逐层结果角色；提供时直接使用，避免两套映射。 */
  layerRoles?: ReadonlyArray<ShotResultRole>
}

/** 屏幕空间射线样式（供测试/调用方断言）。 */
export const SHOT_TRAJECTORY_STYLE = Object.freeze({
  rayWidthPx: OVERLAY_METRICS.rayWidthPx,
  rayHaloWidthPx: OVERLAY_METRICS.rayHaloWidthPx,
  dotSizePx: OVERLAY_METRICS.dotSizePx,
  renderOrder: OVERLAY_METRICS.coreRenderOrder,
})

/**
 * 轨迹 Group 工厂：返回 `lastPoint`（层链末点或 firstPoint）供调用方定位轨迹信息面板；
 * group 的移除/dispose 仍由调用方按现有语义处理，本模块不挂载到任何 scene。
 */
export function createShotTrajectoryGroup(input: ShotTrajectoryInput): { group: THREE.Group; lastPoint: THREE.Vector3 } {
  const { firstPoint, cameraPosition, layers, resultRole, probabilityMode } = input
  const group = new THREE.Group()

  // 轨迹管原点：调用方传入的弹道起点（如炮口）优先；否则沿视线反向
  // 长距离回退（300m），入射弹向一眼可见（原 15m 太短——用户反馈）
  const camDir = cameraPosition.clone().sub(firstPoint).normalize()
  const origin = input.trajOrigin || firstPoint.clone().add(camDir.multiplyScalar(300))
  const rayColor = sceneResultColor(resultRole)
  const lineStyle = {
    color: rayColor,
    widthPx: OVERLAY_METRICS.rayWidthPx,
    haloWidthPx: OVERLAY_METRICS.rayHaloWidthPx,
    haloColor: OVERLAY_METRICS.rayHaloColor,
    haloOpacity: OVERLAY_METRICS.rayHaloOpacity,
    opacity: 1,
    renderOrder: OVERLAY_METRICS.coreRenderOrder,
  } as const

  const ricLayer = layers.find(l => l.ricochet)
  const ricPoint = ricLayer ? ricLayer.point : null

  const incoming: THREE.Vector3[] = [origin]
  for (const l of layers) {
    incoming.push(l.point)
    if (l.ricochet) break // stop at ricochet point
  }
  const incomingLine = createScreenSpacePolyline(incoming, lineStyle)
  if (incomingLine) group.add(incomingLine)

  const reflected: THREE.Vector3[] = []
  let sawRicPoint = false
  for (const l of layers) {
    if (l.ricochet) { sawRicPoint = true; reflected.push(l.point); continue }
    if (l.seg === 1) {
      if (!sawRicPoint) { reflected.push(ricPoint as THREE.Vector3); sawRicPoint = true }
      reflected.push(l.point)
    }
  }
  const reflectedLine = sawRicPoint && reflected.length >= 2
    ? createScreenSpacePolyline(reflected, lineStyle)
    : null
  if (reflectedLine) group.add(reflectedLine)

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]
    // 结果卡 owner 已按逐层上下文算好角色时直接用同一数组；独立调用（测试）才回退到
    // 共享映射。两条路径都不会出现第二套颜色分支。
    const role = input.layerRoles?.[i] ?? layerResultRole({ layer: l, probabilityMode })
    const dot = createScreenSpaceDot(
      l.point,
      sceneResultColor(role),
      OVERLAY_METRICS.dotSizePx,
      { renderOrder: OVERLAY_METRICS.coreRenderOrder },
    )
    group.add(dot)
  }

  const lastPoint = (layers.length > 0 ? layers[layers.length - 1].point : firstPoint).clone()

  // 轨迹画在溅射球壳（995）之上、命中标记（999）之下；描边 996 / 核心与层点 997
  // 由原语写入（renderOrder 不继承父级）。
  return { group, lastPoint }
}
