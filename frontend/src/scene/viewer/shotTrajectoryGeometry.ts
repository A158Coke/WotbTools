import * as THREE from 'three'
import { createScreenSpaceDot, createScreenSpacePolyline } from './overlayStroke.js'
import {
  OVERLAY_METRICS, layerResultRole, sceneResultColor, type ShotResultRole,
} from './shotResultPalette.js'

export interface ShotTrajectoryGeometryLayer {
  point: THREE.Vector3
  ricochet?: boolean
  seg?: number | null
  penetrated?: boolean
  layerChance?: number | null
  reached?: boolean
  chance?: number | null
  [key: string]: unknown
}

export interface ShotTrajectoryInput {
  firstPoint: THREE.Vector3
  cameraPosition: THREE.Vector3
  trajOrigin?: THREE.Vector3 | null
  layers: ReadonlyArray<ShotTrajectoryGeometryLayer>
  resultRole: ShotResultRole
  probabilityMode: boolean
  layerRoles?: ReadonlyArray<ShotResultRole>
}

export const SHOT_TRAJECTORY_STYLE = Object.freeze({
  rayWidthPx: OVERLAY_METRICS.rayWidthPx,
  rayHaloWidthPx: OVERLAY_METRICS.rayHaloWidthPx,
  dotSizePx: OVERLAY_METRICS.dotSizePx,
  renderOrder: OVERLAY_METRICS.coreRenderOrder,
})

export function createShotTrajectoryGroup(input: ShotTrajectoryInput): { group: THREE.Group; lastPoint: THREE.Vector3 } {
  const { firstPoint, cameraPosition, layers, resultRole, probabilityMode } = input
  const group = new THREE.Group()

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
    if (l.ricochet) break
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

  return { group, lastPoint }
}
