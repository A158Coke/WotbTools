/**
 * 车辆配置器计算引擎（纯函数）。
 *
 * 公式结构参考 BlitzKit `tankCharacteristics.ts`。**2026-10-27 用户裁定：BK 除隐蔽系数
 * 外均可参考**——隐蔽（迷彩网/涂装）继续用客户端原值；其余数值以客户端 script/参数为准，
 * 并用 BlitzInfo 11.21 对拍（见上游计划 §5/§7 #12）。差异及理由逐条记在 §7：
 * BK 的 1.05 无角色兜底、武器补给 +30%、漏电台/油箱重量不采用（BI 实测与客户端 script
 * 分别给出 1.0 / +35% / 含电台油箱）。乘员技能支持 0–7 级：per-level 效果只读
 * `common/research/skills.json.effects`（avatar.xml 导出），默认 0。
 *
 * 数据输入：上游仓 data/research/ 的逐车模块数据（VehicleModulesData，客户端原值）+
 * tank/{id}.json 当前配置的弹种摘要/装甲值。坐标/口径注记见各公式行注释。
 *
 * 物品 script（provisions/consumables）必须由调用方经 researchCatalog.scriptMap 注入：
 * 食物类乘员加成的唯一权威是客户端 script，引擎不按 stem 猜数值。
 */
import { degressiveStat, progressiveStat } from './crewStats'

/** 乘员熟练度曲线（BK degressiveStat/progressiveStat，100% 时均为 0）。 */
export { degressiveStat, progressiveStat }

/** 车辆类别 → 视野装备的类别加成（客户端 CoatedOptics script；AT-SPG/SPG 同 4%）。 */
export function viewRangeBonusByClass(vehicleClass) {
  if (vehicleClass === 'lightTank') return 0.11
  if (vehicleClass === 'mediumTank') return 0.08
  if (vehicleClass === 'heavyTank') return 0.06
  return 0.04
}

/**
 * 客户端隐蔽加成查值（车辆类别键：lightTank / mediumTank / heavyTank / AT-SPG / SPG）。
 * 来源：
 * - 迷彩网：`optional_devices.xml` 的 `CamouflageNet` script（`bonus` + `activateBonusFactor`）；
 * - 涂装：`camouflages.xml` 的 `<invisibility><categories>`（配置器用 defaultCategory，通常 free）。
 * 缺失类别按 0（fail-closed：宁可少算，不臆造数值）。
 */
export function invisibilityBonusFor(values, vehicleClass) {
  if (!values || !vehicleClass) return 0
  // 涂装表只有 AT-SPG（无 SPG）；SPG 回退 AT-SPG。未知类别按 0，不借用别的车型桶。
  const raw = values[vehicleClass] ?? (vehicleClass === 'SPG' ? values['AT-SPG'] : undefined)
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

/** 从物品 script 读 crewLevelIncrease（Stimulator 族权威来源）。 */
export function crewLevelIncreaseFromScript(script) {
  const bonus = script?.params?.bonusValues?.crewLevelIncrease
  const v = bonus == null ? null : Number(bonus)
  return v == null || Number.isNaN(v) ? null : v / 100
}

/**
 * 客户端弹种词表（tank/{id}.json shells[].type）→ 校准弹系数（BK resolvePenetrationCoefficient）。
 * AP 族（ap / ap_premium / ap_cr / ap_cr_premium）×1.06；HEAT 族（hc / hc_premium / atgm_heat）
 * 与 HE 族（he / he_premium）×1.07。
 */
export function penetrationCoefficient(type, calibrated) {
  if (!calibrated || !type) return 1
  return /^ap/.test(type) ? 1.06 : 1.07
}

export interface ComputeInput {
  /** research modules/{nation}.json 的单车条目 */
  modules: any
  turretIdx: number
  gunIdx: number
  engineIdx: number
  trackIdx: number
  /** 火炮循环（tank/{id}.json config 的 is_drum/is_burst/burst_*；缺省=regular） */
  gunCycle?: {
    type: 'regular' | 'autoloader' | 'autoreloader'
    /** regular=单发装填；autoloader=整弹匣；autoreloader=最长单发 */
    reload: number
    /** 弹间装填（弹夹/自动装填）；regular=0 */
    intraClip: number
    /** 弹匣/连发容量；regular=0 */
    shellCount: number
    /** 自动装填逐发时间（autoreloader）；其余为空 */
    shellReloads: number[]
    /** 连发组每组发数（PomPom 类；0/1 = 无连发组）；组间仍按 intraClip */
    burstGroupCount?: number
    /** 连发组内弹间秒（BK `GunDefinition.burst.interval`） */
    burstGroupInterval?: number
  } | null
  /** tank/{id}.json 当前配置的标准弹（AP/首个非金币）；burst 炮可空 */
  standardShell: { damage: number; penetration: number; type: string; velocity?: number | null } | null
  /** @deprecated 肾上腺素改由 gunCycle.type === 'regular' 判定（客户端 filter 的 clip 排除）；
   *  保留字段仅为调用方兼容，引擎不再读取。 */
  isBurstGun: boolean
  /** tank/{id}.json 的装甲值（hull/turret × front/sides/rear），用于参数区装甲行 */
  armor?: { hull?: { front?: number; sides?: number; rear?: number }; turret?: { front?: number; sides?: number; rear?: number } } | null
  /** 装甲系数（强化装甲 110：客户端 script 的 armorHomogenizationFactor，未装 = 1） */
  armorFactor?: number
  /** 已选设备 id（resolveDeviceIds 输出） */
  deviceIds: number[]
  /** 乘员技能等级（0–7；未选技能 = 缺省 0，效果按满级百分比缩放） */
  skillLevels?: Record<string, number>
  /** 客户端 skills.json 的逐技能效果参数（per-level；不在此写死百分比） */
  skillEffects?: Record<string, { effects?: Record<string, number> }>
  provisionStems: string[]
  consumableStems: string[]
  /** 物品 script 摘要（provisions/consumables 的 {stem, script} 表） */
  provisionScripts: Record<string, any>
  consumableScripts: Record<string, any>
  camouflage: boolean
  /** 迷彩网客户端 script：`bonus` 逐车型系数 + 静止翻倍系数（devices.json camouflageNet） */
  camouflageNet?: { bonus?: Record<string, number>; activateBonusFactor?: number } | null
  /** 涂装隐蔽系数（camouflages.xml categories[defaultCategory]） */
  paintInvisibility?: Record<string, number> | null
  /** 车辆类别（lightTank/mediumTank/heavyTank/AT-SPG），类别加成用 */
  vehicleClass: string
  /** <crew> 角色表（modules.crewRoles）：专职角色 ×1.1；兼职（如 T-34 的 commander 兼
   *  gunner）在 BI 实测中不给加成，与 BK 的 1.05 兜底不同——按 BI 口径保持 1.0。 */
  crewRoles: string[]
}

export interface TankCharacteristics {
  /** 参数键 → 数值；辅助字段（_susp 等）不是客户端参数键，允许非数值 */
  [key: string]: any
}

/** coefficient（BK）：同调用内加法。 */
function coeff(...effects: Array<[boolean, number]>): number {
  return effects.reduce((acc, e) => acc + (e[0] ? e[1] : 0), 1)
}

interface ModelBbox {
  min: number[]
  max: number[]
}

/** 单个碰撞盒 + 挂点偏移；全零 = 客户端空心占位（无炮塔 TD），返回 null 不参与并集。 */
function bboxWithOffset(box: any, offset?: number[] | null): ModelBbox | null {
  if (!box || !Array.isArray(box.min) || !Array.isArray(box.max)) return null
  if (box.min.length < 3 || box.max.length < 3) return null
  const values = [...box.min.slice(0, 3), ...box.max.slice(0, 3)]
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return null
  if (values.every(value => value === 0)) return null
  const shift = offset || [0, 0, 0]
  return {
    min: box.min.slice(0, 3).map((value, i) => value + (shift[i] || 0)),
    max: box.max.slice(0, 3).map((value, i) => value + (shift[i] || 0)),
  }
}

export interface TankDimensions {
  width: number
  length: number
  height: number
  volume: number
}

/**
 * 车体尺寸（BI 11.21 Dimensions 同口径）：底盘 + 车体 + 当前炮塔碰撞盒并集，**不含炮管**
 * （BI 文案：“车体、炮塔和行走部分的长度/宽度/高度，无炮管——按游戏碰撞”）。
 *
 * 碰撞盒坐标是 [x 宽, y 长, z 高]；车辆 XML 的挂点（`hullPosition` / `turretPositions`）
 * 是 [x, 上, 前]，叠加前换序为 [x, 前, 上]；炮塔挂点 = 车体挂点 + 炮塔相对挂点。
 * 对拍：T-34 顶级炮塔 5.72 × 2.94 × 2.63 m、116-F3 7.63 × 3.49 × 2.70 m，与 BI 逐值一致。
 * 任一必需盒缺失/非数值 → null（fail-closed；参数行隐藏，不猜尺寸）。
 */
export function tankDimensions(modules: any, turret: any, track: any): TankDimensions | null {
  const hullPosition = track?.stats?.hullPosition
  const turretOrigin = modules?.turretOrigin
  if (!Array.isArray(hullPosition) || hullPosition.length < 3) return null
  // [x, 上, 前] → [x, 前, 上]
  const hullOffset = [hullPosition[0], hullPosition[2], hullPosition[1]]
  // 炮塔盒是空心占位（无炮塔 TD）时不参与并集，也不要求挂点存在；
  // 有实体炮塔盒却没有挂点 = 无法定位，整组 fail-closed。
  const turretBox = bboxWithOffset(turret?.stats?.bbox)
  if (turretBox && (!Array.isArray(turretOrigin) || turretOrigin.length < 3)) return null
  const turretOffset = turretBox
    ? [
        hullOffset[0] + turretOrigin[0],
        hullOffset[1] + turretOrigin[2],
        hullOffset[2] + turretOrigin[1],
      ]
    : null
  const boxes = [
    bboxWithOffset(modules?.bbox?.chassis),
    bboxWithOffset(modules?.bbox?.hull, hullOffset),
    turretOffset ? bboxWithOffset(turret?.stats?.bbox, turretOffset) : null,
  ].filter((box): box is ModelBbox => box !== null)
  // BI J6：至少两个碰撞盒才出尺寸（缺车体/底盘时整组隐藏）
  if (boxes.length < 2) return null
  const min = [0, 1, 2].map(i => Math.min(...boxes.map(box => box.min[i])))
  const max = [0, 1, 2].map(i => Math.max(...boxes.map(box => box.max[i])))
  const size = [0, 1, 2].map(i => max[i] - min[i])
  // BI J6 的合理区间守卫（0.5–20 m）：坏盒不产出尺寸
  if (!size.every(value => Number.isFinite(value) && value > 0.5 && value < 20)) return null
  return { width: size[0], length: size[1], height: size[2], volume: size[0] * size[1] * size[2] }
}

export function computeCharacteristics(input: ComputeInput): TankCharacteristics {
  const { modules } = input
  const turret = modules.turrets?.[input.turretIdx]
  const gun = turret?.guns?.[input.gunIdx]
  const engine = modules.engines?.[input.engineIdx]
  const track = modules.chassis?.[input.trackIdx]
  if (!turret || !gun || !engine || !track) {
    // fail-closed：模块缺数据时返回全 null（参数面板逐项隐藏，不猜默认值）
    return {}
  }

  const ids = new Set(input.deviceIds)
  const has = (id: number) => ids.has(id)
  const hasProvision = (stem: string) => input.provisionStems.includes(stem)
  const hasConsumable = (stem: string) => input.consumableStems.includes(stem)
  const skill = (id: string) => {
    const level = Number(input.skillLevels?.[id]) || 0
    return Math.min(7, Math.max(0, level))
  }
  const skillRate = (id: string, key: string) => {
    const value = Number(input.skillEffects?.[id]?.effects?.[key])
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  // ---- 乘员（食物 script 权威 + 通风设备 +0.08）----
  let crewBonus = 0
  for (const stem of input.provisionStems) {
    const inc = crewLevelIncreaseFromScript(input.provisionScripts[stem])
    if (inc != null) crewBonus += inc
  }
  if (has(102)) crewBonus += 0.08 // improvedVentilation
  const commanderMastery = 1 + crewBonus
  // 角色加成（BK）：有该乘员 ×1.1，无 ×1.0（无 1.05 兜底）。兼职（commander 兼 gunner）不算专职。
  // BlitzInfo 口径：车辆没有该乘员角色时不给 1.05 兜底（T-34 无炮手 → 炮塔/瞄准无乘员加成）
  const roleMul = (role: string) => (input.crewRoles.includes(role) ? 1.1 : 1.0)
  const loaderMastery = commanderMastery * roleMul('loader')
  const gunnerMastery = commanderMastery * roleMul('gunner')
  const driverMastery = commanderMastery * roleMul('driver')
  const loaderDeg = degressiveStat(loaderMastery)
  const gunnerDeg = degressiveStat(gunnerMastery)
  const driverDeg = degressiveStat(driverMastery)
  const gunnerProg = progressiveStat(gunnerMastery)
  const driverProg = progressiveStat(driverMastery)
  const commanderProg = progressiveStat(commanderMastery)

  // ---- HP（加法合成；回放实证 5%+6%=11%）----
  const hpCoeff = coeff(
    [hasProvision('smallHPStock'), 0.03],
    [hasProvision('largeHPStock'), 0.06],
    [has(111), 0.05], // highQualityAssembly
  )
  const maxHealth = Math.round(((modules.hull?.hp ?? 0) + (turret.stats?.maxHealth ?? 0)) * hpCoeff)
  // 无炮塔标记来自导出器（客户端 `<hull><fakeTurrets>` 元素存在 ⇔ hasTurret=false）。
  // 旧数据/缺字段按“有炮塔”处理（保持既有参数行，不因数据迁移隐藏行）。
  const hasTurret = modules.hasTurret !== false

  // ---- 重量（游戏内整车：车体+发动机+底盘+炮塔+火炮+电台+油箱）----
  // BK 参考实现漏掉电台/油箱，但 BlitzInfo 显示值与客户端一致（T-34 29.61+0.08+0.25=29.94）；
  // 各车电台/油箱唯一（738/738 各 1 件，不可换装），故直接取第一件。
  const radio = modules.radios?.[0]
  const fuelTank = modules.fuelTanks?.[0]
  const weightKg =
    (modules.hull?.weight ?? 0) +
    (engine.stats?.weight ?? 0) +
    (track.stats?.weight ?? 0) +
    (turret.stats?.weight ?? 0) +
    (gun.stats?.weight ?? 0) +
    (radio?.stats?.weight ?? 0) +
    (fuelTank?.stats?.weight ?? 0)
  const weightT = weightKg / 1000

  // ---- 发动机功率（同调用加法）----
  const enginePowerCoeff = coeff(
    [has(117), 0.06], // recycledEngineSpeed
    [hasConsumable('freeAfterburning'), 0.1],
    [hasConsumable('afterburning'), 0.2],
    [hasConsumable('improvedAfterburning'), 0.35],
    [hasProvision('regular_fuel'), 0.03],
    [hasProvision('improved_fuel'), 0.1],
    [hasProvision('gearOil'), 0.03],
    [hasProvision('improvedGearOil'), 0.06],
  )
  const baseEnginePower = engine.stats?.power ?? 0
  const enginePower = baseEnginePower * enginePowerCoeff *
    (1 + skill('surrounded_by_enemy') * skillRate('surrounded_by_enemy', 'enginePowerFactorPerLevel'))

  // ---- 装填（BK：rammer × 乘员 ÷ 肾上腺素；条件技能按触发效果计入）----
  const reloadBase = gun.stats?.reloadTime ?? 0
  const cycle = input.gunCycle || {
    type: 'regular', reload: reloadBase, intraClip: 0, shellCount: 0, shellReloads: [],
    burstGroupCount: 0, burstGroupInterval: 0,
  }
  const isMagazine = cycle.type !== 'regular'
  // 肾上腺素：客户端 consumable filter 的 exclude extendedTags:["clip"]（弹夹/自动装填车不可用），
  // 等价于 BK 的 gun_type === regular；burst 已由 tankSetup 的同一过滤排除，这里不另设守卫。
  const adrenaline = hasConsumable('berserk') && cycle.type === 'regular' ? 0.17 : 0
  // 装填系数（BK）：输弹机 + 装填手；肾上腺素只作用于常规炮
  const reloadCoeff = coeff([has(100), -0.05]) * (1 + loaderDeg)
  const reloadSkillFactor = isMagazine
    ? 1
    : (1 + skill('battle_rage') * skillRate('battle_rage', 'reloadFactorPerLevel')) *
      (1 + skill('desperado') * skillRate('desperado', 'gunReloadTimeFactorPerLevel'))
  const reload = reloadBase > 0
    ? (reloadCoeff * reloadBase) / (1 + adrenaline) / reloadSkillFactor
    : null
  // 炮弹装填加速（Shell Reload Boost）：客户端 script 的 clipReloadTimeFactor 作用于**弹间装填**
  // （描述原文“弹匣内每发炮弹的装填时间”；BlitzInfo 实测 2.40→1.68 = ×0.7）。
  const intraClipFactor = (() => {
    if (!hasConsumable('newAutoloader')) return 1
    const factor = Number(input.consumableScripts?.newAutoloader?.params?.clipReloadTimeFactor)
    return Number.isFinite(factor) && factor > 0 ? factor : 1
  })()
  // 弹夹/自动装填（客户端 config 原值；整匣/逐发装填吃输弹机+装填手，弹间只吃装填加速）
  const intraClip = cycle.intraClip * intraClipFactor
  const clipShellCount = isMagazine && cycle.shellCount > 0 ? cycle.shellCount : null
  // 弹夹炮用 gunClipShellReloadTime；自动装填炮用 timeBetweenPumpShots（同一数值只出现一次）
  // 连发组（PomPom）：组内弹间 / 每组发数 / 每夹组数（客户端 hangarParams 同名参数）。
  // 非连发组 → null（参数行隐藏）；整夹不能被每组整除时组数留空（fail-closed）。
  const burstGroupSize = cycle.type === 'autoloader' && (cycle.burstGroupCount || 0) > 1
    ? (cycle.burstGroupCount as number)
    : 0
  const burstGroupsPerClip = burstGroupSize > 0 && cycle.shellCount % burstGroupSize === 0
    ? cycle.shellCount / burstGroupSize
    : null
  const burstGroupInterval = burstGroupSize > 0 && (cycle.burstGroupInterval || 0) > 0
    ? (cycle.burstGroupInterval as number)
    : null
  // 弹间装填 = 组与组之间的扳机间隔。整夹只有一组连发时（Annihilator/Cerberus：3 发一组、
  // 一夹一组）不存在“组间”，该行隐藏——此时唯一的射击间隔是组内的 gunClipBurstReloadTime。
  const clipShotsSpan = burstGroupSize > 0
    ? burstGroupsPerClip != null && burstGroupsPerClip > 1
    : true
  const clipShellReload = cycle.type === 'autoloader' && intraClip > 0 && clipShotsSpan ? intraClip : null
  const clipReload = cycle.type === 'autoloader'
    ? (cycle.reload > 0 ? cycle.reload * reloadCoeff : null)
    : cycle.type === 'autoreloader' && cycle.shellReloads.length > 0
      ? cycle.shellReloads.reduce((acc, value) => acc + value, 0) * reloadCoeff
      : null
  const pumpReloads = cycle.type === 'autoreloader'
    ? cycle.shellReloads.map(value => value * reloadCoeff)
    : []

  // ---- 瞄准 / 散布 ----
  const aimTime = (gun.stats?.aimingTime ?? 0) *
    coeff([has(104), -0.12], [hasConsumable('fireControlSystem'), -0.3]) *
    (1 + gunnerDeg) /
    (1 + skill('deadly_accuracy') * skillRate('deadly_accuracy', 'aimingFactorPerLevel'))
  const dispersion = (gun.stats?.shotDispersionRadius ?? 0) *
    coeff([has(106), -0.11], [hasConsumable('fireControlSystem'), -0.3]) *
    (1 + gunnerDeg)
  // 动态扩圈系数（BlitzInfo FIRE “Gun flexibility” 同口径）：客户端 gun/chassis
  // dispersionFactors × 垂稳(105) −17% × 对应 smooth_* 技能。这是无量纲系数，
  // 不是米制散布；照 BI 的 “Moving +0.158 / Shooting +3.255” 显示。
  const gunFactors = gun.stats?.dispersionFactors || {}
  const trackFactors = track.stats?.dispersionFactors || {}
  const dynamicDispersion = (factor: any, skillId: string) => {
    const value = Number(factor)
    if (!Number.isFinite(value) || value <= 0) return null
    const reduction = skill(skillId) * skillRate(skillId, 'shotDispersionFactorPerLevel')
    const multiplier = coeff([has(105), -0.17], [reduction > 0, -reduction])
    return Math.round(value * multiplier * 1000) / 1000
  }
  const dispersionMoving = dynamicDispersion(trackFactors.vehicleMovement, 'smooth_driving')
  const dispersionHullTraversing = dynamicDispersion(trackFactors.vehicleRotation, 'smooth_turn')
  const dispersionTurretTraversing = dynamicDispersion(gunFactors.turretRotation, 'smooth_turret')
  const dispersionShooting = dynamicDispersion(gunFactors.afterShot, 'soft_recoil')
  const dispersionGunDamaged = (() => {
    const value = Number(gunFactors.whileGunDamaged)
    if (!Number.isFinite(value) || value <= 0) return null
    return Math.round(value * coeff([has(105), -0.17]) * 1000) / 1000
  })()

  // ---- 视野 ----
  const viewRange = (turret.stats?.circularVisionRadius ?? 0) *
    coeff([has(114), viewRangeBonusByClass(input.vehicleClass)]) *
    (1 + commanderProg) *
    (1 + skill('deadly_accuracy') * skillRate('deadly_accuracy', 'visionRadiusFactorPerLevel'))

  // ---- 隐蔽（2026-10-27 用户裁定：绝对值相加）
  //   camo = 基础 <invisibility> + 涂装类别系数 + 迷彩网 bonus（静止再 ×activateBonusFactor）。
  //   数值均为客户端原值（camouflages.xml / optional_devices.xml script），按“百分点”直接相加；
  //   移动只吃迷彩网的移动 bonus，静止吃翻倍后的 bonus。----
  const paint = input.camouflage ? invisibilityBonusFor(input.paintInvisibility, input.vehicleClass) : 0
  const netBonus = has(115) ? invisibilityBonusFor(input.camouflageNet?.bonus, input.vehicleClass) : 0
  const netMoving = netBonus
  const netStill = netBonus * (Number(input.camouflageNet?.activateBonusFactor) || 0)
  // 乘员 Camouflage：客户端描述为“隐蔽 +3%/级”，作用在裸隐蔽上；涂装/迷彩网仍按
  // 用户裁定的绝对值（百分点）相加，不把技能乘到它们身上。
  const camoSkill = 1 + skill('camouflage') * skillRate('camouflage', 'camouflageFactorPerLevel')
  const baseStill = (modules.invisibility?.still ?? 0) * camoSkill
  const baseMoving = (modules.invisibility?.moving ?? 0) * camoSkill
  const camoStill = baseStill + paint + netStill
  const camoMoving = baseMoving + paint + netMoving
  // 开火后隐蔽：炮的 invisibilityFactorAtShot 是“剩余比例”（T-34 S-54 0.247）；
  // 移动开火 = 移动隐蔽 × 同一系数，起火 = 静止隐蔽 × 车辆 invisibility.firePenalty
  // （BK 的 5 种隐蔽状态；数值仍用客户端基础值/涂装/网）。
  const shotFactor = Number(gun.stats?.invisibilityFactorAtShot)
  const hasShotFactor = Number.isFinite(shotFactor) && shotFactor > 0
  const camoShot = hasShotFactor ? camoStill * shotFactor : camoStill
  const camoShotMoving = hasShotFactor ? camoMoving * shotFactor : null
  const firePenalty = Number(modules.invisibility?.firePenalty)
  const camoOnFire = Number.isFinite(firePenalty) && firePenalty > 0 ? camoStill * firePenalty : null

  // ---- 极速（加法 bias）----
  const fwdBias =
    (hasConsumable('improvedAfterburning') ? 4 : 0) +
    (hasProvision('gearOil') ? 2 : 0) +
    (hasProvision('improvedGearOil') ? 4 : 0)
  const bkwdBias =
    (hasConsumable('improvedAfterburning') ? 8 : 0) +
    (hasProvision('gearOil') ? 2 : 0) +
    (hasProvision('improvedGearOil') ? 4 : 0)
  const maxFrontSpeed = (modules.speedLimits?.forward ?? 0) + fwdBias
  const maxBackSpeed = (modules.speedLimits?.backward ?? 0) + bkwdBias

  // ---- 转向 ----
  const turretCoeff = coeff([hasProvision('regular_fuel'), 0.03], [hasProvision('improved_fuel'), 0.1]) *
    (1 + gunnerProg)
  const turretRotationSpeed = (turret.stats?.rotationSpeed ?? 0) * turretCoeff *
    (1 + skill('close_combat_master') * skillRate('close_combat_master', 'turretRotationSpeedFactorPerLevel'))
  // 火炮转向速度（BK gunTraverseSpeed）：火炮模块自己的 <rotationSpeed> × 与炮塔相同的
  // 燃料/炮手系数。无炮塔车的“炮塔转速”实际由该值表达（参数区在 !hasTurret 时替换）；
  // BK 不把 close_combat_master（“炮塔”转速技能）乘到 gunTraverseSpeed，这里保持一致。
  const gunRotationSpeed = Number(gun.stats?.rotationSpeed)
  const gunTraverseSpeed = Number.isFinite(gunRotationSpeed) && gunRotationSpeed > 0
    ? gunRotationSpeed * turretCoeff
    : null
  const hullCoeff = coeff(
    [has(116), 0.12],
    [hasConsumable('improvedAfterburning'), 0.05],
    [skill('virtuoso') > 0, skill('virtuoso') * skillRate('virtuoso', 'rotationSpeedFactorPerLevel')],
  ) * (1 + driverProg)
  // 车体转向（BlitzInfo Hull Turn Rate）：发动机功率比 × 底盘转速 × 乘员/操控系数 ×
  // 初始/当前重量比。升级发动机/减重会提高转向，与游戏内一致。
  const stockEngine = modules.engines?.[0]
  const stockTrack = modules.chassis?.[0]
  const stockTurret = modules.turrets?.[0]
  const stockGun = stockTurret?.guns?.[0]
  const stockWeightKg =
    (modules.hull?.weight ?? 0) +
    (stockEngine?.stats?.weight ?? 0) +
    (stockTrack?.stats?.weight ?? 0) +
    (stockTurret?.stats?.weight ?? 0) +
    (stockGun?.stats?.weight ?? 0) +
    (radio?.stats?.weight ?? 0) +
    (fuelTank?.stats?.weight ?? 0)
  const stockEnginePower = stockEngine?.stats?.power ?? baseEnginePower
  const stockWeightRatio = stockWeightKg > 0 && weightKg > 0 ? stockWeightKg / weightKg : 1
  // 只计模块发动机（装车/初始），消耗品增压不改变车体转向（BlitzInfo：引擎增压只 +5% rotation）
  const stockPowerRatio = stockEnginePower > 0 ? baseEnginePower / stockEnginePower : 1
  const chassiRotationSpeed = (track.stats?.rotationSpeed ?? 0) * hullCoeff * stockPowerRatio * stockWeightRatio

  // ---- 地形阻力（显示系数 = 100/raw）----
  const resist = track.stats?.terrainResistance
  // Improved Suspension（grousers）：客户端 script 是“通过性 +20/15/30%”
  // （bonusPercentage），阻力按 1/(1+bonus) 变化；BlitzInfo 实测 Road 91→109 (+20%)。
  const grousers = has(123)
  const suspFirm = (grousers ? 1 / 1.2 : 1) * (1 + driverDeg)
  const suspMedium = (grousers ? 1 / 1.15 : 1) * (1 + driverDeg)
  const suspSoft = (grousers ? 1 / 1.3 : 1) * (1 + driverDeg)
  const rawFirm = (resist?.[0] ?? 0) * suspFirm
  const rawMedium = (resist?.[1] ?? 0) * suspMedium
  const rawSoft = (resist?.[2] ?? 0) * suspSoft

  // ---- 弹种（校准弹：AP/APCR ×1.06，HEAT/HE ×1.07）----
  const shell = input.standardShell
  const calibrated = has(103)
  // 词表见 penetrationCoefficient：ap* / hc*（HEAT）/ he*（HE）/ atgm_heat。
  const penCoeff = penetrationCoefficient(shell?.type, calibrated)
  const penetration = shell ? shell.penetration * penCoeff : null
  // 钨芯穿甲弹（tungstenTip）：客户端 script 的 min/max 伤害因子 → 平均系数（(1.05+1.25)/2 = 1.15，
  // 与 BlitzInfo 实测 +15% 一致）；同时作用于 DPM 与模块伤害。
  const tungstenFactor = (() => {
    if (!hasConsumable('tungstenTip')) return 1
    const params = input.consumableScripts?.tungstenTip?.params
    const min = Number(params?.minDamageFactor)
    const max = Number(params?.maxDamageFactor)
    return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 ? (min + max) / 2 : 1
  })()
  const damage = shell ? shell.damage * tungstenFactor : null
  // 弹匣/连发总伤（BK clipDamage）：单发伤害 × 弹匣容量；regular 不给（参数行隐藏）
  const clipDamage = isMagazine && cycle.shellCount > 0 && damage != null
    ? Math.round(damage * cycle.shellCount * 100) / 100
    : null
  // DPM（BK resolveDpm）：regular 单发；autoloader 整匣循环；autoreloader 取最短单发循环
  let dpm: number | null = null
  let shotsPerMinute = reload && reload > 0 ? Math.round((60 / reload) * 100) / 100 : null
  if (shell && damage != null) {
    if (cycle.type === 'regular') {
      dpm = reload ? Math.round(damage * 60 / reload) : null
    } else if (cycle.type === 'autoloader' && cycle.shellCount > 0) {
      // 整匣循环（BK resolveDpm）：无连发组 = reload + (n-1)×弹间；
      // PomPom = reload + (组数-1)×弹间 + 组数×(每组发数-1)×组内弹间
      //（组内连发比扳机间隔快，按普通弹夹算会把组内时间重复计一遍，DPM 显著偏低）。
      const groupCount = (cycle.burstGroupCount || 0) > 1
        ? cycle.shellCount / (cycle.burstGroupCount as number)
        : 0
      let cycleTime = cycle.reload * reloadCoeff
      if (groupCount > 0) {
        cycleTime += (groupCount - 1) * intraClip +
          groupCount * ((cycle.burstGroupCount as number) - 1) * (cycle.burstGroupInterval || 0)
      } else {
        cycleTime += Math.max(0, cycle.shellCount - 1) * intraClip
      }
      dpm = cycleTime > 0 ? Math.round((damage * cycle.shellCount * 60) / cycleTime) : null
      shotsPerMinute = cycleTime > 0 ? Math.round((cycle.shellCount * 60 / cycleTime) * 100) / 100 : null
    } else if (cycle.type === 'autoreloader' && cycle.shellReloads.length > 0) {
      const perShell = cycle.shellReloads.map((value, index) => value * reloadCoeff + (index > 0 ? intraClip : 0))
      const best = Math.min(...perShell.filter(value => value > 0))
      dpm = Number.isFinite(best) && best > 0 ? Math.round(damage * 60 / best) : null
      shotsPerMinute = Number.isFinite(best) && best > 0 ? Math.round((60 / best) * 100) / 100 : null
    }
  }
  // 自动装填炮“有效 DPM”（BK dpmEffective 的 60 s 窗口模型）：只有 autoreloader 有。
  // BK 的分支条件是**原始**逐发装填（不乘系数）比较首两发；窗口与已打出的弹药数
  // 取整匣，末发/首发耗时按分支选择（装填最长的一发决定循环）。少于两发时公式
  // 无定义——留 null（fail-closed，不臆造）。
  let dpmEffective: number | null = null
  if (cycle.type === 'autoreloader' && cycle.shellReloads.length >= 2 && damage != null) {
    const reloads = cycle.shellReloads
    const rawIntra = cycle.intraClip
    const longFirst = reloads[0] > reloads[1] + rawIntra
    const denominatorReload = longFirst ? reloads[reloads.length - 1] : reloads[0]
    const denominator = denominatorReload * reloadCoeff + rawIntra * intraClipFactor
    const window = 60 - (reloads.length - 2) * rawIntra * intraClipFactor
    dpmEffective = denominator > 0
      ? Math.round(((damage / denominator) * window + damage * (reloads.length - 1)) * 100) / 100
      : null
  }
  // 弹速：超负荷 107 +35%；火药补给 gunPowder 的客户端 script projectileSpeedFactor = 35
  // （BK 旧值 30% 已过时，按客户端 script 取 35%）。弹种表/弹种明细按同一系数显示。
  const shellVelocityFactor = 1 + (has(107) ? 0.35 : 0) + (hasProvision('gunPowder') ? 0.35 : 0)
  const shellVelocity = shell?.velocity != null ? shell.velocity * shellVelocityFactor : null
  // 超负荷 107 的 piercingPenaltyFactor500m = -60：500m 穿透**衰减量**降到 40%
  // （近距/远距穿深都先吃校准弹系数，再按衰减量 ×0.4 得到远距穿深）。
  const farPenetrationFalloffFactor = has(107) ? 0.4 : 1

  // ---- 装甲表（板值 × 强化装甲系数；系数来自客户端 script，未装 = 1）----
  const armorFactor = Number(input.armorFactor) > 0 ? Number(input.armorFactor) : 1
  const armorValue = v => (v == null ? null : Math.round(v * armorFactor * 100) / 100)
  const armor = input.armor || null

  // ---- 引擎起火 / 履带维修 ----
  const fireChance = (engine.stats?.fireStartingChance ?? 0) * (hasProvision('safety_set') ? 0.8 : 1)
  // 履带维修：客户端 hangarParams 的 chassisRepairTime = hysteresisHealth / healthRegenPerSec
  // （T-34 24/3.5 = 6.86 s，BI 11.21 同值），再除以维修加速：
  //   工具箱 113 +20%（client script repairSpeedFactor）
  //   × 乘员 Repair 技能（avatar.xml repairSpeedFactorPerLevel，0–7 级）
  //   × 防护套件 safety_set +10%（client script repairSpeedIncrease）
  const repairBase = Number(track.stats?.hysteresisHealth) > 0 && Number(track.stats?.healthRegenPerSec) > 0
    ? Number(track.stats.hysteresisHealth) / Number(track.stats.healthRegenPerSec)
    : null
  const repairSpeed = (has(113) ? 1.2 : 1) *
    (1 + skill('repair') * skillRate('repair', 'repairSpeedFactorPerLevel')) *
    (hasProvision('safety_set') ? 1.1 : 1)
  const chassisRepairTime = repairBase == null ? null : repairBase / repairSpeed

  // ---- 炮塔射界（客户端模块 yawLimits；[-180,180] = 全向）----
  const yaw = turret.stats?.yawLimits
  const yawLeft = Array.isArray(yaw) && yaw.length === 2 ? Math.abs(yaw[0]) : null
  const yawRight = Array.isArray(yaw) && yaw.length === 2 ? yaw[1] : null

  // ---- 俯仰（初始炮塔姿态 + 稳定器 122 装备在预设内时生效）----
  // 客户端 pitchLimits 的存储顺序：|min| = 仰角上限、max = 俯角下限
  // （T-34 `-26 8` → 仰 26 / 俯 8；BlitzInfo Gun Turn Limit 同口径）。
  // 4 辆意系 AT-SPG 的炮塔有非零初始 pitch（models.pb 的 initial_turret_rotation）：
  // 有效仰角 = |min| − pitch、有效俯角 = max + pitch；BI 11.21 同口径
  // （Minotauro 18/7 + pitch 3 → 15/10；Ciclope 20/7 + 6.5 → 13.5/13.5）。
  const pitch = gun.stats?.pitchLimits
  const defaultPitch = Number(modules.initialTurretRotation?.pitch) || 0
  const upperBuff = has(122) ? 4 : 0
  const lowerBuff = has(122) ? 3 : 0
  const pitchUp = pitch ? Math.abs(pitch.min) - defaultPitch + upperBuff : null
  const pitchDown = pitch ? pitch.max + defaultPitch + lowerBuff : null

  const dimensions = tankDimensions(modules, turret, track)

  return {
    maxHealth,
    hasTurret,
    weight: Math.round(weightT * 100) / 100,
    enginePower: Math.round(enginePower * 10) / 10,
    thrustToWeightRatio: weightT > 0 ? Math.round((enginePower / weightT) * 100) / 100 : null,
    chassisRepairTime: chassisRepairTime == null ? null : Math.round(chassisRepairTime * 1000) / 1000,
    // 弹夹炮的“单发装填”由整匣/逐发字段表达，不重复给 gunShellReloadTime
    gunShellReloadTime: isMagazine || reload == null ? null : Math.round(reload * 1000) / 1000,
    gunCommonDamagePerMin: dpm,
    gunEffectiveDamagePerMin: dpmEffective,
    gunClipDamage: clipDamage,
    gunShotsPerMinute: shotsPerMinute,
    gunClipShellCount: clipShellCount,
    gunClipBurstCount: burstGroupsPerClip,
    gunBurstShellCount: burstGroupSize > 0 ? burstGroupSize : null,
    gunClipBurstReloadTime: burstGroupInterval,
    gunClipShellReloadTime: clipShellReload,
    gunClipReloadTime: clipReload,
    timeBetweenPumpShots: cycle.type === 'autoreloader' && intraClip > 0 ? intraClip : null,
    reloadingShellTime0: pumpReloads[0] ?? null,
    reloadingShellTime1: pumpReloads[1] ?? null,
    reloadingShellTime2: pumpReloads[2] ?? null,
    reloadingShellTime3: pumpReloads[3] ?? null,
    reloadingShellTime4: pumpReloads[4] ?? null,
    reloadingShellTime5: pumpReloads[5] ?? null,
    turretYawLeftLimit: yawLeft,
    turretYawRightLimit: yawRight,
    baseShellAvgPiercingPower: penetration == null ? null : Math.round(penetration * 100) / 100,
    baseShellAvgDamage: damage,
    baseShellAvgSpeed: shellVelocity == null ? null : Math.round(shellVelocity),
    gunAimingTime: Math.round(aimTime * 1000) / 1000,
    gunShotDispersionRadius: Math.round(dispersion * 1000) / 1000,
    dispersionMoving,
    dispersionHullTraversing,
    dispersionTurretTraversing,
    dispersionShooting,
    dispersionGunDamaged,
    circularVisionRadius: Math.round(viewRange * 10) / 10,
    stillInvisibility: Math.round(camoStill * 10000) / 100,
    movingInvisibility: Math.round(camoMoving * 10000) / 100,
    shotInvisibility: Math.round(camoShot * 10000) / 100,
    movingShotInvisibility: camoShotMoving == null ? null : Math.round(camoShotMoving * 10000) / 100,
    fireInvisibility: camoOnFire == null ? null : Math.round(camoOnFire * 10000) / 100,
    maxFrontSpeed: Math.round(maxFrontSpeed * 100) / 100,
    maxBackSpeed: Math.round(maxBackSpeed * 100) / 100,
    chassiRotationSpeed: Math.round(chassiRotationSpeed * 1000) / 1000,
    turretRotationSpeed: Math.round(turretRotationSpeed * 1000) / 1000,
    gunTraverseSpeed: gunTraverseSpeed == null ? null : Math.round(gunTraverseSpeed * 1000) / 1000,
    terrainPermeabilityFirm: rawFirm > 0 ? Math.round((100 / rawFirm) * 10) / 10 : null,
    terrainPermeabilityMedium: rawMedium > 0 ? Math.round((100 / rawMedium) * 10) / 10 : null,
    terrainPermeabilitySoft: rawSoft > 0 ? Math.round((100 / rawSoft) * 10) / 10 : null,
    engineFireStartingChance: Math.round(fireChance * 10000) / 100,
    // 车体尺寸（BI Dimensions 同口径；无碰撞盒 = null，参数行隐藏）
    tankWidth: dimensions == null ? null : Math.round(dimensions.width * 100) / 100,
    tankLength: dimensions == null ? null : Math.round(dimensions.length * 100) / 100,
    tankHeight: dimensions == null ? null : Math.round(dimensions.height * 100) / 100,
    tankVolume: dimensions == null ? null : Math.round(dimensions.volume * 100) / 100,
    gunPitchUpLimit: pitchUp,
    gunPitchDownLimit: pitchDown,
    // 装甲（参数区；客户端结构里的 turretArmor*/primaryArmor* 行）
    turretArmorFront: armorValue(armor?.turret?.front),
    turretArmorSide: armorValue(armor?.turret?.sides),
    turretArmorRear: armorValue(armor?.turret?.rear),
    hullArmorFront: armorValue(armor?.hull?.front),
    hullArmorSide: armorValue(armor?.hull?.sides),
    hullArmorRear: armorValue(armor?.hull?.rear),
    // 供 UI 判定基准差分的辅助字段（不属于客户端参数键）
    _damageCoeff: tungstenFactor,
    _shellVelocityFactor: shellVelocityFactor,
    _farPenetrationFalloffFactor: farPenetrationFalloffFactor,
    _weightKg: weightKg,
    _crewBonus: Math.round(crewBonus * 1000) / 1000,
    _susp: { firm: suspFirm, medium: suspMedium, soft: suspSoft },
  }
}
