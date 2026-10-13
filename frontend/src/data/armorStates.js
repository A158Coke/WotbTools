/**
 * 动态装甲（armorsStatesController）状态声明与纯函数助手。
 *
 * ⚠️ 数据来源：上游 Agent 仓 `tools/extract_armor_states.py` ← 客户端 item_defs
 * 车辆 XML 的 `<extras><armorsStatesController>`（2026-10-13，
 * 协议定案见上游 `investigation/blitz-client-protocol-and-replay.md` §8.6 与
 * `docs/index.md` 待发版条目）。**游戏版本更新后需重新生成**——本文件是
 * game-version 数据的前端 vendored 常量（仅 6 车 / ~2KB，不值得走 COS 资产包渠道）。
 *
 * 运行时语义（上游 PlaybackData / AiReviewFacet 的 additive 字段 `armor_states`）：
 * Vehicle 实体 type=7 prop0 载荷 1 字节 = 当前状态号；值域 = 本表声明的 state id 集。
 * 每态 `armors` = 该态**激活**的 `<part>.<armor_N>` 集合——可切换板中未列出的 = 隐藏；
 * 从未出现在任何 state 的装甲板 = 常驻板，不受状态控制。初始态 = `default: true` 的
 * state（不经状态流，回放的 armor_states 时间线首样本之前用它）。
 *
 * 消费方门控（fail-closed）：armor_states 时间线里的 state 值 ∉ 本表状态集的更新丢弃。
 */

/** item_defs stem（与回放车辆 codename 同域，如 "Oth71_Titan_Strife"）→ 声明 */
export const ARMOR_STATES = {
  Oth28_Sturmfeur_HW: {
    file: 'vehicles/other/Oth28_Sturmfeur_HW.xml',
    states: [
      { id: 0, armors: ['gun_01.armor_13', 'hull.armor_13'], type: 'default', enabled: false, default: true },
      { id: 1, armors: ['gun_01.armor_14', 'hull.armor_14'], type: 'default', enabled: false, default: false }
    ]
  },
  Oth30_T54MS: {
    file: 'vehicles/other/Oth30_T54MS.xml',
    states: [
      { id: 0, armors: ['turret_01.armor_11', 'hull.armor_10'], type: 'default', enabled: true, default: true },
      { id: 1, armors: ['turret_01.armor_12', 'hull.armor_11'], type: 'default', enabled: false, default: false }
    ]
  },
  Oth44_Charioteer_T: {
    file: 'vehicles/other/Oth44_Charioteer_T.xml',
    states: [
      { id: 0, armors: ['hull.armor_14'], type: 'default', enabled: true, default: true },
      { id: 1, armors: ['turret_01.armor_12', 'hull.armor_13', 'hull.armor_15'], type: 'default', enabled: false, default: false }
    ]
  },
  Oth71_Titan_Strife: {
    file: 'vehicles/other/Oth71_Titan_Strife.xml',
    states: [
      { id: 0, armors: ['gun_01.armor_11', 'hull.armor_11'], type: 'default', enabled: true, default: true },
      { id: 1, armors: ['gun_01.armor_10', 'hull.armor_10'], type: 'default', enabled: false, default: false }
    ]
  },
  Oth92_JagdPantherII_Titan: {
    file: 'vehicles/other/Oth92_JagdPantherII_Titan.xml',
    states: [
      { id: 0, armors: ['hull.armor_14'], type: 'default', enabled: true, default: true },
      { id: 1, armors: ['hull.armor_10'], type: 'default', enabled: false, default: false }
    ]
  },
  Oth98_AMX_50_100_Titan: {
    file: 'vehicles/other/Oth98_AMX_50_100_Titan.xml',
    states: [
      { id: 0, armors: ['turret_01.armor_14', 'hull.armor_14'], type: 'default', enabled: true, default: true },
      { id: 1, armors: ['turret_01.armor_15', 'hull.armor_15'], type: 'default', enabled: false, default: false }
    ]
  }
}

/**
 * 按车辆代号（item_defs stem，大小写不敏感）取动态装甲声明；非动态车返回 null。
 * @param {string|null|undefined} tankName 车辆代号（如回放的 target/shooter codename）
 * @returns {{ file: string, states: Array<object> }|null}
 */
export function dynamicArmorDeclaration(tankName) {
  if (!tankName) return null
  const key = Object.keys(ARMOR_STATES).find((k) => k.toLowerCase() === String(tankName).toLowerCase())
  return key ? ARMOR_STATES[key] : null
}

const SECTION_RE = /^(hull|turret|gun)(?:_\d+)?\.armor_(\d+)$/

/** `hull.armor_10` / `gun_01.armor_11` → `{ section: 'gun', plateId: '11' }`；其余 null */
export function parseArmorRef(ref) {
  const m = SECTION_RE.exec(String(ref || ''))
  if (!m) return null
  return { section: m[1], plateId: m[2] }
}

/**
 * 某状态下**受控板**的激活集合：`"section:plateId"` 字符串 Set（如 `"hull:11"`）。
 * 消费方（tankViewer）对 armorSection ∈ {hull,turret,gun} 且
 * `section:armorPlateId` ∈ 可控集但 ∉ 本集合的网格做隐藏。
 * @returns Set<string>
 */
export function activePlateSet(decl, stateId) {
  const state = decl.states.find((s) => s.id === stateId)
  if (!state) throw new Error(`armorStates: unknown state id ${stateId}`)
  const active = new Set()
  for (const ref of state.armors) {
    const parsed = parseArmorRef(ref)
    if (parsed) active.add(`${parsed.section}:${parsed.plateId}`)
  }
  return active
}

/** 全部可切换板（各态 armors 的并集，`section:plateId` Set）。 */
export function controllablePlateSet(decl) {
  const all = new Set()
  for (const s of decl.states) {
    for (const ref of s.armors) {
      const parsed = parseArmorRef(ref)
      if (parsed) all.add(`${parsed.section}:${parsed.plateId}`)
    }
  }
  return all
}

/** 初态 id（`default: true` 的 state；缺标记取最小 id——fail-closed 兜底）。 */
export function defaultStateId(decl) {
  const d = decl.states.find((s) => s.default)
  if (d) return d.id
  return Math.min(...decl.states.map((s) => s.id))
}

/**
 * 回放时刻 t 的状态号：二分 armor_states 时间线（列式 {t:[], state:[]}），
 * 取 ≤ t 的最近更新；早于首样本 → 初态。timeline 形状无效 / 状态 ∉ 声明集 →
 * 返回初态并忽略该样本（消费方门控的纯函数实现）。
 * @param {{t: number[], state: number[]}} timeline 上游 PlaybackData.armor_states 轨道
 */
export function stateAtTime(decl, timeline, t) {
  const fallback = defaultStateId(decl)
  const valid = new Set(decl.states.map((s) => s.id))
  if (!timeline || !Array.isArray(timeline.t) || !Array.isArray(timeline.state)) return fallback
  let current = fallback
  const ts = timeline.t
  const ss = timeline.state
  const n = Math.min(ts.length, ss.length)
  for (let i = 0; i < n; i++) {
    if (ts[i] > t) break
    if (valid.has(ss[i])) current = ss[i]
  }
  return current
}
