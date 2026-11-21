// 装甲着色的 perf 统计与 render(frame) 装配参数形状——自 armorHighlight.ts 出仓
//（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；公共入口仍由 armorHighlight re-export）。
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
  /** passBegin 的工作字段（perfFrame 读取前由 renderArmorHighlight 每帧清零） */
  _t0: number
}

/** 计数按实际 render target 对象计；大小为每张 RT，估算仅含两张颜色纹理。 */
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
  /** ?perf 逐 pass 计时（仅 PERF 传入；调用方已关闭 info.autoReset 并逐帧 reset） */
  stats?: ArmorHighlightPerfStats
  /** 不重叠包围实际执行的 render；调用方以当前帧序号绑定 query。 */
  gpu?: { begin(pass: 'state' | 'thickness' | 'occluder' | 'color'): boolean; end(): void }
  /** 语义化遮挡根（issue #850 F）：地形/场景 GLB/占位地面/每车低模组、GLB/飞炮塔 */
  occluderRoots?: Object3D[]
}
