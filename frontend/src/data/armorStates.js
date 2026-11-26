
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

export const DYNAMIC_TANK_IDS = {
  8305: 'Oth28_Sturmfeur_HW',
  9073: 'Oth30_T54MS',
  12657: 'Oth44_Charioteer_T',
  17777: 'Oth71_Titan_Strife',
  22385: 'Oth92_JagdPantherII_Titan',
  24945: 'Oth98_AMX_50_100_Titan'
}

/**
 * 按 tank_id 取动态装甲声明；非动态车 / 非法 id 返回 null。
 * @param {number|string|null|undefined} tankId
 * @returns {{ file: string, states: Array<object> }|null}
 */
export function dynamicDeclarationByTankId(tankId) {
  const stem = DYNAMIC_TANK_IDS[Number(tankId)]
  return stem ? dynamicArmorDeclaration(stem) : null
}

const SECTION_RE = /^(hull|turret|gun)(?:_\d+)?\.armor_(\d+)$/

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
