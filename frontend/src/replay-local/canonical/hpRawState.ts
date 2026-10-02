/**
 * 原始 u16 血量的 canonical 分类——与已退役 Java `HpRawState.classify` / `HealthChangedEvent.isPlausibleHp`
 * 逐值一致（golden 以此为前提）。只依赖 wire 形状，不依赖客户端版本。
 *
 * 语义红线：
 *  - 0x0000 = 确知 HP 归零（终态）；0xFFFD = 已证明的阵亡终态哨兵——**血量未知**，不得改写成 0；
 *  - 0xFFFF / 0xFFFE / 其余负值 = 未证明的哨兵，血量与生死都未知；
 *  - 上游 `Damage.hp` 的钳 0 只是显示便利，canonical 一律读 `hp_raw`。
 */

export type HpRawState =
  | 'CURRENT_HP'
  | 'HP_ZERO_TERMINAL'
  | 'DEATH_TERMINAL_FFFD'
  | 'UNKNOWN_FFFF'
  | 'UNKNOWN_OTHER'

export function classifyHpRaw(rawValue: number): HpRawState {
  const raw = rawValue & 0xffff
  if (raw === 0x0000) return 'HP_ZERO_TERMINAL'
  if (raw === 0xfffd) return 'DEATH_TERMINAL_FFFD'
  if (raw === 0xffff) return 'UNKNOWN_FFFF'
  if (raw === 0xfffe) return 'UNKNOWN_OTHER'
  return toSignedShort(raw) > 0 ? 'CURRENT_HP' : 'UNKNOWN_OTHER'
}

export function isTerminalHpState(state: HpRawState): boolean {
  return state === 'HP_ZERO_TERMINAL' || state === 'DEATH_TERMINAL_FFFD'
}

/** Java `HealthChangedEvent.isPlausibleHp`：0 < hp < 0xFF00 */
export function isPlausibleHp(hp: number | null | undefined): hp is number {
  return typeof hp === 'number' && hp > 0 && hp < 0xff00
}

/**
 * 原始值对应的确知当前血量：CURRENT_HP → 有符号值，HP_ZERO → 0，哨兵 → null（未知 ≠ 0）。
 * 与 Java prop3 `currentHealth` 的取值口径一致（终态 FFFD 的 currentHealth 为 null）。
 */
export function knownHpOf(rawValue: number): number | null {
  const state = classifyHpRaw(rawValue)
  if (state === 'CURRENT_HP') return toSignedShort(rawValue & 0xffff)
  if (state === 'HP_ZERO_TERMINAL') return 0
  return null
}

function toSignedShort(raw: number): number {
  return raw >= 0x8000 ? raw - 0x10000 : raw
}

/**
 * method1 `causeFlag` → 语义原因（Java `VehicleHealthStateEvent.deriveSemanticCause`）。
 * 原因与来源实体必须自洽才成立：火焰/撞击要求外部来源，世界/溺水要求来源 = 自身；否则未知。
 */
export type HealthCause = 'DIRECT' | 'FIRE' | 'RAMMING' | 'WORLD_OR_ENVIRONMENT' | 'DROWNING'

export function semanticCauseOf(causeFlag: number, sourceEid: number, victimEid: number): HealthCause | null {
  const external = sourceEid !== victimEid
  switch (causeFlag) {
    case 0: return 'DIRECT'
    case 1: return external ? 'FIRE' : null
    case 2: return external ? 'RAMMING' : null
    case 3: return external ? null : 'WORLD_OR_ENVIRONMENT'
    case 5: return external ? null : 'DROWNING'
    default: return null
  }
}
