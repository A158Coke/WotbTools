import type { AgentPlaybackShot } from '../../api/agent-replay-facets.js'
import type { Object3D, PerspectiveCamera, Scene } from 'three'
import type { AimedVehicleCandidate } from './armorHighlightPick.js'

export interface ArmorHighlightPerfStats {
  pickMs: number
  stateMs: number
  thicknessMs: number
  occluderMs: number
  colorMs: number
  calls: number
  stateCalls: number
  thicknessCalls: number
  occluderCalls: number
  colorCalls: number
  rt?: ArmorRenderTargetStats
  _t0: number
}

export interface ArmorRenderTargetStats {
  width: number | null
  height: number | null
  creates: number
  resizes: number
  disposes: number
  colorEstimateBytes: number | null
  estimateKind: 'color-only-estimate'
}

export interface ArmorHighlightFrame {
  scene: Scene
  camera: PerspectiveCamera
  vehicle: AimedVehicleCandidate & { def: { eid: number; tank_id?: number | null; equipment?: unknown } }
  tankData: { model_url?: string | null; [key: string]: unknown }
  config: unknown
  shell: AgentPlaybackShot | Record<string, unknown>
  caliber: number
  penMul: number
  thickMul: number
  onReady: () => void
  stats?: ArmorHighlightPerfStats
  gpu?: { begin(pass: 'state' | 'thickness' | 'occluder' | 'color'): boolean; end(): void }
  occluderRoots?: Object3D[]
}
