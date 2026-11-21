// 录像者 Sniper 穿深着色的资格判定与加载重试策略（纯函数）——自 armorHighlight.ts 出仓
//（2026-11-21 #LOC 结构拆分：代码与搬移前逐字一致；公共入口仍由 armorHighlight re-export）。
import type { AgentAuthorShellEvent, AgentPlaybackShot } from '../../api/agent-replay-facets.js'
import { dynamicDeclarationByTankId } from '../../data/armorStates.js'
import { calibratedPenMul, ENHANCED_ARMOR_THICK_MUL, shellTypeOf } from '../viewer/armorPlateModel.js'

const EQ_CALIBRATED_SHELLS = 103
const EQ_ENHANCED_ARMOR = 110
const ARMOR_LOAD_ATTEMPTS = 3
const ARMOR_LOAD_RETRY_MS = 5000


/**
 * 加载失败的有限重试：临时错误（断网、503）过后还能恢复，永久错误（404、坏文件）试满就停，
 * 不会每帧重新下载。`succeed` 清掉记录，一次成功后不再占用次数。
 */
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

/** 时刻 t 的当前弹种（`timeline` 时间升序）；首条之前未知，返回 null。 */
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

/** 配置弹表里的弹种（caliber 取弹体，缺失回退该炮口径）；不在表内返回 null。 */
export interface MountedShell {
  shell: AgentPlaybackShot | Record<string, unknown>
  caliber: number
}

/** 资产包 configs[] 条目中本模块消费的字段（mountedShell / armorHighlightBlock）。 */
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

/**
 * 资格判定：返回第一个不满足的原因码，全部满足返回 null。每一项都是「证据不足就不显示」，
 * 不存在回退分支——颜色本身就是结论，错的配置/弹种只会给出错的结论。
 */
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

/** 回放 equipment 原值 → 着色系数（调用方已确认双方 equipment 在场）。 */
export function armorEquipmentCoeffs(shell: AgentPlaybackShot | Record<string, unknown>, authorEquipment: unknown, targetEquipment: unknown): { penMul: number; thickMul: number } {
  return {
    penMul: Array.isArray(authorEquipment) && authorEquipment.includes(EQ_CALIBRATED_SHELLS) ? calibratedPenMul(shellTypeOf(shell as { type?: unknown })) : 1.0,
    thickMul: Array.isArray(targetEquipment) && targetEquipment.includes(EQ_ENHANCED_ARMOR) ? ENHANCED_ARMOR_THICK_MUL : 1.0,
  }
}
