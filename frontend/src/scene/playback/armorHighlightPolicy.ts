import type { AgentAuthorShellEvent, AgentPlaybackShot } from '../../api/agent-replay-facets.js'
import { dynamicDeclarationByTankId } from '../../data/armorStates.js'
import { calibratedPenMul, ENHANCED_ARMOR_THICK_MUL, shellTypeOf } from '../viewer/armorPlateModel.js'

const EQ_CALIBRATED_SHELLS = 103
const EQ_ENHANCED_ARMOR = 110
const ARMOR_LOAD_ATTEMPTS = 3
const ARMOR_LOAD_RETRY_MS = 5000


export interface LoadRetry {
  allowed(key: string | number): boolean
  fail(key: string | number): void
  succeed(key: string | number): void
}

export function createLoadRetry({
  attempts = ARMOR_LOAD_ATTEMPTS, delayMs = ARMOR_LOAD_RETRY_MS, now = () => performance.now(),
}: { attempts?: number; delayMs?: number; now?: () => number } = {}): LoadRetry {
  const failures = new Map<string | number, { count: number; retryAt: number }>()
  return {
    allowed(key: string | number): boolean {
      const failure = failures.get(key)
      return !failure || (failure.count < attempts && now() >= failure.retryAt)
    },
    fail(key: string | number): void {
      const count = (failures.get(key)?.count ?? 0) + 1
      failures.set(key, { count, retryAt: now() + delayMs })
    },
    succeed(key: string | number): void { failures.delete(key) },
  }
}

export function authorShellAt(timeline: readonly AgentAuthorShellEvent[] | null | undefined, t: number): number | null {
  if (!timeline || !timeline.length || !(t >= timeline[0].t)) return null
  let lo = 0, hi = timeline.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (timeline[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return timeline[lo].shell_id
}

export interface MountedShell {
  shell: AgentPlaybackShot | Record<string, unknown>
  caliber: number
}

export interface HighlightConfig {
  shell_global_ids?: number[]
  caliber?: number
  shells?: Array<Record<string, unknown> & { caliber?: number; penetration?: number; penetration_far?: number; damage?: number; explosion_radius?: number }>
  [key: string]: unknown
}

export function mountedShell(cfg: HighlightConfig | null | undefined, shellId: number | null): MountedShell | null {
  const i = (cfg?.shell_global_ids ?? []).indexOf(shellId as number)
  const shell = i >= 0 ? cfg?.shells?.[i] : null
  if (!shell) return null
  const caliber = [shell.caliber, cfg?.caliber].find((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) ?? 0
  return { shell, caliber }
}

export function armorHighlightBlock({ targetTankId, targetConfig, authorConfig, shellId, targetEquipment, authorEquipment }: {
  targetTankId: number | null | undefined
  targetConfig: unknown
  authorConfig: unknown
  shellId: number | null
  targetEquipment: unknown
  authorEquipment: unknown
}): string | null {
  if (dynamicDeclarationByTankId(targetTankId)) return 'dynamic_armor'
  if (!targetConfig) return 'target_config_unknown'
  if (!authorConfig) return 'author_config_unknown'
  if (shellId == null) return 'shell_unknown'
  const mounted = mountedShell(authorConfig as HighlightConfig, shellId)
  if (!mounted) return 'shell_not_mounted'
  if (!shellTypeOf(mounted.shell as { type?: unknown })) return 'shell_type_unknown'
  if (!(mounted.caliber > 0)) return 'caliber_unknown'
  if (!Array.isArray(targetEquipment) || !Array.isArray(authorEquipment)) return 'equipment_unknown'
  return null
}

export function armorEquipmentCoeffs(shell: AgentPlaybackShot | Record<string, unknown>, authorEquipment: unknown, targetEquipment: unknown): { penMul: number; thickMul: number } {
  return {
    penMul: Array.isArray(authorEquipment) && authorEquipment.includes(EQ_CALIBRATED_SHELLS) ? calibratedPenMul(shellTypeOf(shell as { type?: unknown })) : 1.0,
    thickMul: Array.isArray(targetEquipment) && targetEquipment.includes(EQ_ENHANCED_ARMOR) ? ENHANCED_ARMOR_THICK_MUL : 1.0,
  }
}
