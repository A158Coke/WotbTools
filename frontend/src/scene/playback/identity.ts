/**
 * 实体身份替换判据（「最后已知幽灵」抑制用）：同账号在 AoI 重入/复活后换用新 eid 时，
 * 旧实体的最后已知位姿不得与玩家的新实体同时出现。
 *
 * 判别器 = 账号身份 + 协议证据（格式语义，非内容统计）：
 *   - 权威 = canonical `entityStartsByAccount` + `activeEntityAt`（战斗相对秒）——
 *     覆盖 coverage 段起点重叠/重入场景（真实 producer 的既有证据）；
 *   - 缺省 = coverage/AoI 段序回退（`replacedBySuccessorAt`，时间感知：接管前不隐藏）。
 * 只有**当前回放时刻到达接管时刻之后**才抑制；倒带即恢复（此处无状态，纯判据）。
 */
import { activeEntityAt } from '../../replay-local/canonical/facts'
import { replacedBySuccessorAt } from './lastKnown'

/** canonical 身份证据的最小读取面（宿主 `store.playbackSession.canonical`）。 */
export interface CanonicalIdentityEvidence {
  entityStartsByAccount?: Map<number, Map<number, number | null>> | null
  clock?: { startRaw?: number | null } | null
}

/** 车辆的身份/采样读取面（宿主闭包提供）。 */
export interface IdentityVehicle {
  eid: number
  account_id?: number | null
  coverage?: number[] | null
}

export interface IdentityReplacementSource {
  /** 惰性读取 canonical（会话切换后才就绪）。 */
  canonical: () => CanonicalIdentityEvidence | null | undefined
  vehicles: () => readonly IdentityVehicle[]
  /** eid → AoI 在场段 flat（缺省 = 该车 coverage）。 */
  spansOf: (eid: number) => readonly number[] | null | undefined
}

/** 构造 `(eid, t) => 是否已被同账号后继实体接管` 判据（宿主持有并注入 vehicleRuntime）。 */
export function makeReplacedAt(
  source: IdentityReplacementSource,
): (eid: number, t: number) => boolean {
  return (eid: number, t: number): boolean => {
    if (!Number.isFinite(t)) return false
    const all = source.vehicles()
    const self = all.find((candidate) => candidate.eid === eid)
    if (!self) return false
    const canonical = source.canonical()
    const startRaw = canonical?.clock?.startRaw
    const starts = self.account_id == null
      ? null
      : canonical?.entityStartsByAccount?.get(self.account_id)
    if (starts && starts.size > 1 && Number.isFinite(startRaw)) {
      const active = activeEntityAt(starts, t - (startRaw as number))
      // null = 身份证据歧义（同刻双实体）：fail-closed 不抑制
      if (active != null) return active !== eid
    }
    // AoI 段缺失（旧会话/无 Type33 流）→ 该车 coverage（同宿主既有回退语义）
    const spansOf = (id: number) => source.spansOf(id)
      ?? all.find((candidate) => candidate.eid === id)?.coverage
    return replacedBySuccessorAt(all, spansOf, eid, t)
  }
}
