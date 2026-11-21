import type {
  ConsumableRuntimeResult,
  ConsumableTransition,
  ModuleCrewResult,
  ModuleCrewTransition,
} from '../types/playback-v2.js'

/**
 * V2 装载（consumable / module / crew）运行时状态的纯查询工具（自 battlePlaybackV2.ts
 * 出仓，2026-11-21 结构拆分：代码与搬移前逐字一致，公共入口仍由 battlePlaybackV2 re-export）。
 */

/** Current runtime state keyed by canonical consumable slot, not array position or wire code. */
export function consumableRuntimeSlotsAt(
  transitions: readonly ConsumableTransition[] | null | undefined,
  t: number,
): Map<number, ConsumableRuntimeResult> {
  const states = new Map<number, ConsumableRuntimeResult>()
  for (const tr of transitions || []) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (tr.invalidation === true) {
      states.clear()
      continue
    }
    if (tr.consumableSlot === null || tr.consumableSlot === undefined
      || typeof tr.state !== 'string') continue
    states.set(tr.consumableSlot, {
      state: tr.state,
      logicalItemId: tr.logicalItemId ?? null,
      wireCode: tr.wireCode ?? null,
    })
  }
  return states
}

/** Current recorder-visible state per module/crew component. */
export function moduleCrewStatesAt(
  transitions: readonly ModuleCrewTransition[] | null | undefined,
  t: number,
): ModuleCrewResult[] {
  if (!Array.isArray(transitions)) return []
  const byComponent = new Map<string, ModuleCrewResult>()
  for (const tr of transitions) {
    if (!tr || !Number.isFinite(tr.timeSec) || tr.timeSec > t + 1e-6) continue
    if (!tr.component) continue
    if (tr.state == null) {
      byComponent.delete(tr.component)
      continue
    }
    byComponent.set(tr.component, {
      component: tr.component,
      state: tr.state,
      recorderVisible: tr.recorderVisible,
      confidence: tr.confidence ?? 'UNKNOWN',
    })
  }
  return [...byComponent.values()].sort((a, b) => a.component.localeCompare(b.component))
}
