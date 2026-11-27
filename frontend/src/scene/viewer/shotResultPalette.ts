
export type ShotResultRole = 'PENETRATION' | 'MAY_PENETRATE' | 'RICOCHET' | 'SPLASH' | 'BLOCKED' | 'UNREACHED' | 'ERROR'

export const RESULT_CSS_VAR: Readonly<Record<ShotResultRole, string>> = Object.freeze({
  PENETRATION: 'var(--green)',
  MAY_PENETRATE: 'var(--yellow)',
  RICOCHET: 'var(--purple)',
  SPLASH: 'var(--orange)',
  BLOCKED: 'var(--red)',
  UNREACHED: 'var(--muted)',
  ERROR: 'var(--red)',
})

export const RICOCHET_HEATMAP_HUE_COLOR = 0xff00ff

export const SCENE_RESULT_COLORS: Readonly<Record<ShotResultRole, number>> = Object.freeze({
  PENETRATION: 0x3ee08a,
  MAY_PENETRATE: 0xffd24a,
  RICOCHET: 0xff6bff,
  SPLASH: 0xff9b3d,
  BLOCKED: 0xff5f52,
  UNREACHED: 0x9aa3ad,
  ERROR: 0xff5f52,
})

export const OVERLAY_METRICS = Object.freeze({
  rayWidthPx: 2,
  rayHaloWidthPx: 4,
  rayHaloColor: 0x05070a,
  rayHaloOpacity: 0.5,
  dotSizePx: 7,
  markerSizePx: 9,
  markerPendingColor: 0xf5f5f5,
  haloRenderOrder: 996,
  coreRenderOrder: 997,
  markerRenderOrder: 999,
})

export const ANNOTATION_COLORS = Object.freeze({
  launch: 0xff6622,
  velocity: 0x00ccff,
  chord: 0x00ff00,
  endpoint: 0xffcc00,
  bounce: 0xffaa00,
  impact: 0xff2222,
  shooterAnchor: 0x00aaff,
  victimAnchor: 0x00ffcc,
  trackHeading: 0x33ff66,
  turn: 0xffdd33,
  breech: 0xcc66ff,
  deviation: 0xffffff,    // 偏差线
})

export function resultRoleForOutcome(outcome: string | null | undefined): ShotResultRole {
  switch ((outcome ?? '').trim()) {
    case 'PENETRATION': return 'PENETRATION'
    case 'MAY_PENETRATE': return 'MAY_PENETRATE'
    case 'RICOCHET': return 'RICOCHET'
    case 'SPLASH': return 'SPLASH'
    case 'BLOCKED': return 'BLOCKED'
    case 'ERROR': return 'ERROR'
    default: return 'SPLASH'
  }
}

export function resultRoleForCardDisplay(input: {
  result: string
  heInfo: { unavailable?: boolean; splash_avg?: number | null } | null
  heChance: number
  probabilityMode: boolean
  overallChance: number | null
  chancePartial: boolean
}): ShotResultRole {
  const { result, heInfo, heChance, probabilityMode, overallChance, chancePartial } = input
  if (heInfo) {
    if (heInfo.unavailable) return 'ERROR'
    if (heChance >= 1) return 'PENETRATION'
    if (heChance > 0) return 'MAY_PENETRATE'
    const splash = typeof heInfo.splash_avg === 'number' && Number.isFinite(heInfo.splash_avg)
      ? heInfo.splash_avg
      : 0
    return splash > 0 ? 'SPLASH' : 'BLOCKED'
  }
  if (probabilityMode) return resultRoleForChance(overallChance ?? 0)
  if (chancePartial) return 'MAY_PENETRATE'
  return resultRoleForOutcome(result.split('→').pop() ?? '')
}

export function resultRoleForHitPoint(input: {
  layerRoles?: ReadonlyArray<ShotResultRole> | null
  resultRole: ShotResultRole
  hasPerLayerDisplay: boolean
}): ShotResultRole {
  if (input.hasPerLayerDisplay) {
    const first = input.layerRoles?.[0]
    if (first) return first
  }
  return input.resultRole
}

export function resultRoleForChance(chance: number): ShotResultRole {
  if (chance >= 1) return 'PENETRATION'
  if (chance > 0) return 'MAY_PENETRATE'
  return 'BLOCKED'
}

export interface LayerResultRoleInput {
  layer: {
    penetrated?: boolean
    ricochet?: boolean
    chance?: number | null
    layerChance?: number | null
    reached?: boolean
  }
  probabilityMode: boolean
  blockedNoPrimary?: boolean
  partialChance?: number | null
}

export function layerResultRole(input: LayerResultRoleInput): ShotResultRole {
  const { layer, probabilityMode, blockedNoPrimary = false, partialChance = null } = input
  if (layer.reached === false) return 'UNREACHED'
  if (blockedNoPrimary) return 'BLOCKED'
  if (layer.ricochet) return 'RICOCHET'
  if (probabilityMode) {
    const local = typeof layer.layerChance === 'number' && Number.isFinite(layer.layerChance)
      ? layer.layerChance
      : null
    return resultRoleForChance(local ?? (layer.chance ?? 0))
  }
  if (partialChance != null) return resultRoleForChance(partialChance)
  return layer.penetrated ? 'PENETRATION' : 'BLOCKED'
}

export function cssHex(color: number): string {
  return '#' + (color >>> 0).toString(16).padStart(6, '0')
}

export function sceneResultColor(role: ShotResultRole): number {
  return SCENE_RESULT_COLORS[role]
}
