/**
 * 原始 u16 血量的 canonical 分类——终态族 = 上游 Agent 的同一规则
 * （`combat::hp_terminal_normalized`：终态 ⇔ 归一化为 0，即 `hp == 0 ∨ i16(hp) < 0`）。
 * 只依赖 wire 形状，不依赖客户端版本。
 *
 * 语义红线：
 *  - `hp_state` 在场时 = **上游权威分类**（`current`/`zero`/`terminal`），逐事件直用；
 *    缺省（旧产物）时按同一规则从 `hp_raw` 现算——两条路径判定一致；
 *  - 0x0000 = 确知 HP 归零（终态）；负 i16 = 终态哨兵（**死亡面之一**；实测族
 *    0xFFFF/0xFFFE/0xFFFD，其余负值同属该编码——同族全部取值同一处理，禁按分布裁剪）——
 *    血量未知，**不得改写成 0**（`knownHpOf` → null）；
 *  - 上游 `Damage.hp` 的钳 0 只是显示便利，canonical 一律读 `hp_raw`。
 *
 * 历史（2026-10-16 裁决，见上游 docs/wotbtools-cross-reference.md §七）：本层曾只认
 * {0x0000, 0xFFFD} 为终态、把 −1/−2 档记为"未证明"，导致 0xFFFE 档的殉爆死亡被判成
 * 存活（血量冻在最后正值、装填条继续播放；实例 1910 局 Intotherainy）。
 */

/** 上游切面 `hp_state`（additive；缺省 = 旧产物，走 hp_raw 现算） */
export type HpStateField = 'current' | 'zero' | 'terminal'

export type HpRawState =
  | 'CURRENT_HP'
  | 'HP_ZERO_TERMINAL'
  /** 负 i16 终态哨兵（0xFFFF/0xFFFE/0xFFFD 及同编码其它负值）——死亡面之一，血量未知 */
  | 'DEATH_TERMINAL'

export function classifyHpRaw(rawValue: number, hpState?: HpStateField | null): HpRawState {
  // 上游分类在场 = 权威（与现值算规则同判；字段存在即以此为准，禁止二次解释）
  if (hpState === 'current') return 'CURRENT_HP'
  if (hpState === 'zero') return 'HP_ZERO_TERMINAL'
  if (hpState === 'terminal') return 'DEATH_TERMINAL'
  const raw = rawValue & 0xffff
  if (raw === 0x0000) return 'HP_ZERO_TERMINAL'
  return toSignedShort(raw) > 0 ? 'CURRENT_HP' : 'DEATH_TERMINAL'
}

export function isTerminalHpState(state: HpRawState): boolean {
  return state === 'HP_ZERO_TERMINAL' || state === 'DEATH_TERMINAL'
}

/** Java `HealthChangedEvent.isPlausibleHp`：0 < hp < 0xFF00 */
export function isPlausibleHp(hp: number | null | undefined): hp is number {
  return typeof hp === 'number' && hp > 0 && hp < 0xff00
}

/**
 * 原始值对应的确知当前血量：CURRENT_HP → 有符号值，HP_ZERO → 0，终态哨兵 → null（未知 ≠ 0）。
 * 与 Java prop3 `currentHealth` 的取值口径一致（终态哨兵的 currentHealth 为 null）。
 */
export function knownHpOf(rawValue: number, hpState?: HpStateField | null): number | null {
  const state = classifyHpRaw(rawValue, hpState)
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
