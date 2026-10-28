/**
 * 配置器计算引擎 golden：期望值由上游仓（WoT-Blitz-Agent）同一公式表的独立 Python
 * 参照实现，对 common/research/ 导出数据逐项算出（双实现对拍；公式与裁定口径见
 * 上游 docs/wotbtools-research-loadout-plan.md §5）。改公式必须同时改两处并重生成。
 */
import { describe, expect, it } from 'vitest'
import CONSUMABLES from './__fixtures__/research/consumables.json'
import PROVISIONS from './__fixtures__/research/provisions.json'
import DEVICES from './__fixtures__/research/devices.json'
import CAMOUFLAGE from './__fixtures__/research/camouflage.json'
import SKILLS from './__fixtures__/research/skills.json'
import USSRS from './__fixtures__/modules/ussr.json'
import EUROPEANS from './__fixtures__/modules/european.json'
import GERMANY from './__fixtures__/modules/germany.json'

import {
  computeCharacteristics,
  invisibilityBonusFor,
  penetrationCoefficient,
  type ComputeInput,
} from './characteristics'
import { degressiveStat, progressiveStat } from './crewStats'

const T34 = (USSRS as any).tanks['T-34']
const IS4 = (USSRS as any).tanks['IS-4']
const MINOTAURO = (EUROPEANS as any).tanks['It21_Controcarro3_Minotauro']
const JAGDTIGER = (GERMANY as any).tanks['JagdTiger']
const S54 = { damage: 160, penetration: 125, type: 'ap' }
/** 客户端迷彩网 script（optional_devices.xml）与涂装类别表（camouflages.xml）。 */
const NET_SCRIPT = (DEVICES as any).devices.find((device: any) => device.stem === 'camouflageNet').script.params
const PAINT = (CAMOUFLAGE as any).categories[(CAMOUFLAGE as any).defaultCategory]
const L11 = { damage: 140, penetration: 85, type: 'ap' }

/** 客户端 script 摘要（食物 crewLevelIncrease 等数值的唯一权威来源）。 */
function scriptMap(items: any[], stems: string[]) {
  const want = new Set(stems)
  const out: Record<string, any> = {}
  for (const item of items) if (want.has(item.stem) && item.script) out[item.stem] = item.script
  return out
}

function setup(overrides: Partial<ComputeInput>): ComputeInput {
  const input: ComputeInput = {
    modules: T34,
    turretIdx: 1,
    gunIdx: 3, // _76mm_S-54（顶级炮）
    engineIdx: 1, // V-2-34
    trackIdx: 1, // T-34 mod. 1943
    standardShell: S54,
    isBurstGun: false,
    deviceIds: [],
    provisionStems: [],
    provisionScripts: {},
    consumableScripts: {},
    consumableStems: [],
    skillLevels: {},
    skillEffects: (SKILLS as any).items,
    camouflage: false,
    camouflageNet: NET_SCRIPT,
    paintInvisibility: PAINT,
    vehicleClass: 'mediumTank',
    crewRoles: T34.crewRoles,
    ...overrides,
  }
  if (!overrides.provisionScripts) {
    input.provisionScripts = scriptMap(PROVISIONS.items, input.provisionStems)
  }
  if (!overrides.consumableScripts) {
    input.consumableScripts = scriptMap(CONSUMABLES.items, input.consumableStems)
  }
  return input
}

describe('computeCharacteristics（T-34 golden，双实现对拍）', () => {
  it('S1：顶级配置 + 输弹机 + 改进装配 + 高级油料 + 肾上腺素', () => {
    const out = computeCharacteristics(setup({
      deviceIds: [100, 111],
      provisionStems: ['improved_fuel'],
      consumableStems: ['berserk'],
    }))
    expect(out.maxHealth).toBe(714) // (496+184)×1.05，HP 加法合成（回放实证）
    expect(out.weight).toBe(29.94) // 整车：车体+发动机+底盘+炮塔+火炮+电台+油箱（BlitzInfo 同值）
    expect(out.enginePower).toBe(517) // 470×1.1（improved_fuel）
    expect(out.thrustToWeightRatio).toBe(17.27)
    expect(out.gunShellReloadTime).toBe(6.151) // 7.9×0.95(输弹机)×0.9589(装填手×1.1)÷1.17(肾上腺素)
    expect(out.gunCommonDamagePerMin).toBe(1561)
    expect(out.gunShotsPerMinute).toBe(9.75)
    expect(out.baseShellAvgPiercingPower).toBe(125) // 无校准弹：原值
    expect(out.gunAimingTime).toBe(2.125) // 无炮手角色 → 无炮手乘员加成（BlitzInfo T-34 同口径）
    expect(out.gunShotDispersionRadius).toBe(0.4)
    expect(out.circularVisionRadius).toBe(240)
    expect(out.chassisRepairTime).toBeCloseTo(6.857, 3) // 24 / 3.5（BI Track Repair Time 6.86 s）
    // BI 11.21 Dimensions（顶级炮塔）：长度 5.72 / 宽度 2.94 / 高度 2.63 m
    expect(out.tankLength).toBe(5.72)
    expect(out.tankWidth).toBe(2.94)
    expect(out.tankHeight).toBe(2.63)
    expect(out.tankVolume).toBeCloseTo(44.23, 2)
    expect(out.gunClipDamage).toBeNull() // 常规炮不给弹匣总伤
    expect(out.stillInvisibility).toBe(28.8)
    expect(out.movingInvisibility).toBe(21.6)
    expect(out.shotInvisibility).toBe(7.11) // ×S-54 invisibilityFactorAtShot 0.247
    expect(out.movingShotInvisibility).toBe(5.34) // 21.6 × 0.247
    expect(out.fireInvisibility).toBe(12.44) // 28.8 × firePenalty 0.432
    expect(out.hasTurret).toBe(true)
    expect(out.turretRotationSpeed).toBe(53.9) // 49×1.1(油料)，无炮手加成
    expect(out.gunTraverseSpeed).toBe(43.313) // 39.375×1.1 四舍五入到 3 位（BK gunTraverseSpeed；有炮塔时不展示）
    expect(out.chassiRotationSpeed).toBe(53.674) // 46×1.0429×(470/400 发动机)×初始/当前整车重量（BlitzInfo 同值）
    expect(out.terrainPermeabilityFirm).toBe(104.3)
    expect(out.gunPitchUpLimit).toBe(26)
    expect(out.gunPitchDownLimit).toBe(8)
  })

  it('S2：初始配置全空（基准态，stock crew 角色加成仍在）', () => {
    const out = computeCharacteristics(setup({
      turretIdx: 0,
      gunIdx: 0, // L-11
      engineIdx: 0,
      trackIdx: 0,
      standardShell: L11,
    }))
    expect(out.maxHealth).toBe(620) // (496+124)，无装备
    expect(out.weight).toBe(28.51)
    expect(out.enginePower).toBe(400)
    expect(out.gunShellReloadTime).toBe(7.959) // 8.3×0.9589
    expect(out.gunCommonDamagePerMin).toBe(1055)
    expect(out.baseShellAvgPiercingPower).toBe(85)
    expect(out.circularVisionRadius).toBe(200)
    expect(out.gunPitchUpLimit).toBe(17)
    expect(out.gunPitchDownLimit).toBe(6)
    // 初始炮塔盒更矮：高度 2.35（BI 同口径按所选炮塔变）
    expect(out.tankHeight).toBe(2.35)
    expect(out.tankLength).toBe(5.72)
    expect(out.tankWidth).toBe(2.94)
  })

  it('S3：厨房水槽（校准弹/光学/炮网/通风/涂装/食物/齿轮油）', () => {
    const out = computeCharacteristics(setup({
      deviceIds: [103, 114, 115, 102, 111],
      provisionStems: ['improved_fuel', 'improvedGearOil', 'ration'],
      camouflage: true,
    }))
    expect(out.baseShellAvgPiercingPower).toBe(132.5) // 125×1.06（AP 校准弹）
    expect(out.circularVisionRadius).toBe(279.2) // 240×1.08(光学 MT)×1.0771(乘员 1.18：ration+10%×script + 通风+8%)
    expect(out.stillInvisibility).toBe(39.8) // 28.8 + 3（涂装MT）+ 8（网MT静止），绝对值相加
    expect(out.movingInvisibility).toBe(28.6) // 21.6 + 3 + 4
    expect(out.enginePower).toBe(545.2) // 470×(1+0.1 fuel+0.06 gearOil)
    expect(out.maxFrontSpeed).toBe(52) // 48+4（improvedGearOil bias）
    expect(out.maxBackSpeed).toBe(22) // 18+4
    // 食物+通风 crew 1.18：loaderMastery=1.298 → deg=-0.1132
    expect(out.gunShellReloadTime).toBe(7.005) // 7.9×0.95×0.8868
    expect(out.gunCommonDamagePerMin).toBe(1370)
    expect(out.gunAimingTime).toBe(1.973)
    expect(out.gunShotDispersionRadius).toBe(0.371)
    expect(out.turretRotationSpeed).toBe(58.058)
    expect(out.chassiRotationSpeed).toBe(58.042)
    expect(out.terrainPermeabilityFirm).toBe(112.8)
  })

  it('无炮塔车（Jagdtiger，客户端 hasTurret=false）：火炮转向速度独立于炮塔转速', () => {
    const out = computeCharacteristics(setup({
      modules: JAGDTIGER,
      turretIdx: 0,
      gunIdx: 0,
      engineIdx: 0,
      trackIdx: 0,
      standardShell: { damage: 460, penetration: 276, type: 'ap' },
      vehicleClass: 'AT-SPG',
      crewRoles: JAGDTIGER.crewRoles,
    }))
    expect(out.hasTurret).toBe(false)
    // 炮塔 26°/s × 炮手 1.1 的 progressiveStat 1.042857；火炮 26.25 × 同一系数
    expect(out.turretRotationSpeed).toBeCloseTo(27.114, 3)
    expect(out.gunTraverseSpeed).toBeCloseTo(27.375, 3)
    // 常规炮没有“有效 DPM”（只有自动装填炮）
    expect(out.gunEffectiveDamagePerMin).toBeNull()
  })

  it('fail-closed：模块缺失时全部字段为 undefined，不猜默认值', () => {
    const out = computeCharacteristics(setup({ turretIdx: 99 }))
    expect(out.maxHealth).toBeUndefined()
    expect(out.gunShellReloadTime).toBeUndefined()
  })
})

describe('乘员曲线（BK degressiveStat/progressiveStat）', () => {
  it('100% 熟练度 = 0，+8% 与 WoT PC 曲线不同', () => {
    expect(degressiveStat(1.0)).toBe(0)
    expect(progressiveStat(1.0)).toBe(0)
    expect(degressiveStat(1.08)).toBeCloseTo(-0.033149, 5)
    expect(progressiveStat(1.08)).toBeCloseTo(0.0342857, 5)
  })
})

describe('隐蔽加成（客户端数据：迷彩网 script / camouflages.xml）', () => {
  it('迷彩网 moving：客户端 bonus LT .06 / MT .04 / HT .02 / TD·SPG .07', () => {
    expect(invisibilityBonusFor(NET_SCRIPT.bonus, 'lightTank')).toBe(0.06)
    expect(invisibilityBonusFor(NET_SCRIPT.bonus, 'mediumTank')).toBe(0.04)
    expect(invisibilityBonusFor(NET_SCRIPT.bonus, 'heavyTank')).toBe(0.02)
    expect(invisibilityBonusFor(NET_SCRIPT.bonus, 'AT-SPG')).toBe(0.07)
    expect(invisibilityBonusFor(NET_SCRIPT.bonus, 'SPG')).toBe(0.07)
  })
  it('迷彩网仍静：bonus × activateBonusFactor(2.0) = LT .12 / MT .08 / HT .04 / TD .14', () => {
    const still = cls => invisibilityBonusFor(NET_SCRIPT.bonus, cls) * Number(NET_SCRIPT.activateBonusFactor)
    expect(still('lightTank')).toBeCloseTo(0.12)
    expect(still('mediumTank')).toBeCloseTo(0.08)
    expect(still('heavyTank')).toBeCloseTo(0.04)
    expect(still('AT-SPG')).toBeCloseTo(0.14)
  })
  it('涂装（标准免费类别）：LT .03 / MT .03 / HT .02 / TD .04', () => {
    expect(invisibilityBonusFor(PAINT, 'lightTank')).toBe(0.03)
    expect(invisibilityBonusFor(PAINT, 'mediumTank')).toBe(0.03)
    expect(invisibilityBonusFor(PAINT, 'heavyTank')).toBe(0.02)
    expect(invisibilityBonusFor(PAINT, 'AT-SPG')).toBe(0.04)
  })
  it('加成按百分点绝对值相加，不是相对乘算（MT：28.8 + 8 = 36.8）', () => {
    const base = computeCharacteristics(setup({}))
    const net = computeCharacteristics(setup({ deviceIds: [115] }))
    expect(net.stillInvisibility - base.stillInvisibility).toBeCloseTo(8, 5)
    expect(net.movingInvisibility - base.movingInvisibility).toBeCloseTo(4, 5)
    const both = computeCharacteristics(setup({ deviceIds: [115], camouflage: true }))
    expect(both.stillInvisibility).toBeCloseTo(base.stillInvisibility + 8 + 3, 5)
    expect(both.movingInvisibility).toBeCloseTo(base.movingInvisibility + 4 + 3, 5)
  })

  it('缺表/未知类别按 0（fail-closed，不臆造数值）', () => {
    expect(invisibilityBonusFor(null, 'lightTank')).toBe(0)
    expect(invisibilityBonusFor(NET_SCRIPT.bonus, 'unknown')).toBe(0)
  })
})

describe('弹夹 / 自动装填（客户端 config 字段 → BK resolveDpm）', () => {
  it('弹夹炮：整匣循环 DPM、弹匣容量与弹间装填；单发装填字段留空', () => {
    const out = computeCharacteristics(setup({
      gunCycle: { type: 'autoloader', reload: 20, intraClip: 3, shellCount: 3, shellReloads: [] },
    }))
    // 装填手系数 0.9591：20×0.9591 + 2×3 = 25.18s；160×3×60/25.18 ≈ 1144
    expect(out.gunCommonDamagePerMin).toBeGreaterThan(1140)
    expect(out.gunCommonDamagePerMin).toBeLessThan(1150)
    expect(out.gunShellReloadTime).toBeNull()
    expect(out.gunClipShellCount).toBe(3)
    expect(out.gunClipShellReloadTime).toBe(3)
    expect(out.gunClipReloadTime).toBeCloseTo(19.18, 1)
    // 普通弹夹没有连发组：三行留空（参数行隐藏）
    expect(out.gunClipBurstReloadTime).toBeNull()
    expect(out.gunBurstShellCount).toBeNull()
    expect(out.gunClipBurstCount).toBeNull()
    expect(out.gunClipDamage).toBe(480) // 160 × 3
    expect(out.gunEffectiveDamagePerMin).toBeNull() // 有效 DPM 只给 autoreloader
  })

  it('连发组（PomPom，AC Atlas）：组内连发与组间弹间分开计，DPM 不再把组内时间重复计入', () => {
    // 客户端 AC Atlas V2：整夹 6 发、组间 3s、每组 3 发、组内 0.25s、整夹装填 13s、单发 120。
    // BK resolveDpm：13×装填系数 + (6/3−1)×3 + (6/3)×(3−1)×0.25 = 12.466 + 3 + 1 = 16.466s
    // → 120×6×60/16.466 ≈ 2623（若按普通弹夹算组内也乘 3s 会得到 ~1573，明显偏低）。
    const out = computeCharacteristics(setup({
      standardShell: { damage: 120, penetration: 255, type: 'ap' },
      gunCycle: {
        type: 'autoloader', reload: 13, intraClip: 3, shellCount: 6, shellReloads: [],
        burstGroupCount: 3, burstGroupInterval: 0.25,
      },
    }))
    expect(out.gunCommonDamagePerMin).toBeGreaterThan(2618)
    expect(out.gunCommonDamagePerMin).toBeLessThan(2628)
    expect(out.gunShotsPerMinute).toBeGreaterThan(21.8)
    expect(out.gunShotsPerMinute).toBeLessThan(21.9)
    expect(out.gunClipShellCount).toBe(6)
    expect(out.gunClipShellReloadTime).toBe(3) // 组间扳机间隔（组内 0.25s 走下面的连发行）
    expect(out.gunClipReloadTime).toBeCloseTo(12.466, 2)
    // 连发行（客户端 hangarParams 同名参数）：组内弹间 / 每组发数 / 每夹组数
    expect(out.gunClipBurstReloadTime).toBe(0.25)
    expect(out.gunBurstShellCount).toBe(3)
    expect(out.gunClipBurstCount).toBe(2)
  })

  it('单组连发（Annihilator/Cerberus）：整夹即一组，弹间装填行隐藏、只显示组内间隔', () => {
    // 客户端 Cerberus：整夹 3 发全部在同一个连发组里（一组 3 发、组内 0.333s），
    // 一夹一组 ⇒ 不存在“组间扳机间隔”，gunClipShellReloadTime 应为空；
    // 唯一的射击间隔是 gunClipBurstReloadTime，DPM 循环只加组内 (n−1) 个间隔。
    const out = computeCharacteristics(setup({
      standardShell: { damage: 160, penetration: 200, type: 'ap' },
      gunCycle: {
        type: 'autoloader', reload: 10, intraClip: 0.3333333, shellCount: 3, shellReloads: [],
        burstGroupCount: 3, burstGroupInterval: 0.3333333,
      },
    }))
    expect(out.gunClipBurstCount).toBe(1)
    expect(out.gunBurstShellCount).toBe(3)
    expect(out.gunClipBurstReloadTime).toBeCloseTo(0.3333333, 6)
    expect(out.gunClipShellReloadTime).toBeNull()
    expect(out.gunClipReloadTime).toBeCloseTo(10 * 0.958904, 4)
    // 3 发 / (10×0.958904 + 2×0.3333)s ≈ 2808/min
    expect(out.gunCommonDamagePerMin).toBeGreaterThan(2800)
    expect(out.gunCommonDamagePerMin).toBeLessThan(2820)
  })

  it('自动装填炮：逐发时间、整匣 = 逐发之和、最短单发循环决定 DPM', () => {
    const out = computeCharacteristics(setup({
      gunCycle: { type: 'autoreloader', reload: 14, intraClip: 2.727, shellCount: 3, shellReloads: [14, 12, 10] },
    }))
    expect(out.gunClipShellCount).toBe(3)
    expect(out.gunClipReloadTime).toBeCloseTo(34.53, 1)
    expect(out.timeBetweenPumpShots).toBe(2.727)
    expect(out.gunClipShellReloadTime).toBeNull() // 自动装填只走 pump 字段
    expect(out.reloadingShellTime0).toBeCloseTo(13.43, 1)
    expect(out.reloadingShellTime2).toBeCloseTo(9.59, 1)
    // 最短单发 10×0.9591 + 2.727 = 12.32 → 160×60/12.32 ≈ 779
    expect(out.gunCommonDamagePerMin).toBeGreaterThan(770)
    expect(out.gunCommonDamagePerMin).toBeLessThan(790)
    // BK dpmEffective 60s 窗口：160/16.15×57.27 + 160×2 ≈ 887.4
    expect(out.gunEffectiveDamagePerMin).toBeCloseTo(887.4, 1)
    expect(out.gunShellReloadTime).toBeNull()
  })

  it('自动装填炮：首发装填显著更长时有效 DPM 取末发（BK longFirst 分支）', () => {
    // Carro 45t 形态：首 19.51s、随后 7.24/6.40/4.18，弹间 3.333s
    const out = computeCharacteristics(setup({
      gunCycle: {
        type: 'autoreloader', reload: 19.51, intraClip: 3.333333, shellCount: 4,
        shellReloads: [19.51, 7.24, 6.4, 4.18],
      },
    }))
    // 4.18×0.958904 + 3.333333 = 7.341552；160/7.341552×53.333334 + 160×3 = 1642.33
    expect(out.gunEffectiveDamagePerMin).toBeCloseTo(1642.33, 1)
  })

  it('炮塔射界来自模块 yawLimits（T-34 全向 ±180）', () => {
    const out = computeCharacteristics(setup({}))
    expect(out.turretYawLeftLimit).toBe(180)
    expect(out.turretYawRightLimit).toBe(180)
  })
})

describe('消耗品对 DPM / 伤害的影响（与 BlitzInfo 对照）', () => {
  it('钨芯穿甲弹：min/max 因子均值 1.15 → 伤害、DPM、模块系数同乘', () => {
    const base = computeCharacteristics(setup({}))
    const tungsten = computeCharacteristics(setup({ consumableStems: ['tungstenTip'] }))
    expect(tungsten._damageCoeff).toBeCloseTo(1.15, 6)
    expect(tungsten.baseShellAvgDamage).toBeCloseTo(160 * 1.15, 6)
    expect(tungsten.gunCommonDamagePerMin).toBeCloseTo(base.gunCommonDamagePerMin! * 1.15, 0)
  })

  it('炮弹装填加速：弹间装填 ×0.7（整匣不变），DPM 提升', () => {
    const cycle = { type: 'autoloader' as const, reload: 20, intraClip: 3, shellCount: 3, shellReloads: [] }
    const base = computeCharacteristics(setup({ gunCycle: cycle }))
    const boosted = computeCharacteristics(setup({ gunCycle: cycle, consumableStems: ['newAutoloader'] }))
    expect(base.gunClipShellReloadTime).toBe(3)
    expect(boosted.gunClipShellReloadTime).toBeCloseTo(2.1, 6)
    expect(boosted.gunClipReloadTime).toBeCloseTo(base.gunClipReloadTime!, 6) // 整匣不受影响
    expect(boosted.gunCommonDamagePerMin).toBeGreaterThan(base.gunCommonDamagePerMin!)
    // 自动装填炮的“自动装填间隔”同样吃 ×0.7；有效 DPM 的弹间耗时同步缩短
    const autoCycle = { type: 'autoreloader' as const, reload: 14, intraClip: 2.727, shellCount: 3, shellReloads: [14, 12, 10] }
    const autoBase = computeCharacteristics(setup({ gunCycle: autoCycle }))
    const auto = computeCharacteristics(setup({ gunCycle: autoCycle, consumableStems: ['newAutoloader'] }))
    expect(auto.timeBetweenPumpShots).toBeCloseTo(2.727 * 0.7, 6)
    expect(auto.gunEffectiveDamagePerMin).toBeGreaterThan(autoBase.gunEffectiveDamagePerMin!)
  })

  it('改进型引擎增压：车体转向 +5%（客户端 rotationSpeedFactor），炮塔不变', () => {
    const base = computeCharacteristics(setup({}))
    const boost = computeCharacteristics(setup({ consumableStems: ['improvedAfterburning'] }))
    expect(boost.chassiRotationSpeed).toBeCloseTo(base.chassiRotationSpeed * 1.05, 2)
    expect(boost.turretRotationSpeed).toBe(base.turretRotationSpeed)
  })
})

describe('弹种分类 / 装甲系数 / 弹速（客户端词表）', () => {
  const ARMOR = { hull: { front: 50, sides: 50, rear: 45 }, turret: { front: 60, sides: 60, rear: 55 } }

  it('校准弹：ap_premium 也吃 +6%，hc/atgm_heat 吃 +7%（旧实现漏了 ap_premium）', () => {
    expect(penetrationCoefficient('ap', true)).toBe(1.06)
    expect(penetrationCoefficient('ap_premium', true)).toBe(1.06)
    expect(penetrationCoefficient('ap_cr_premium', true)).toBe(1.06)
    expect(penetrationCoefficient('hc_premium', true)).toBe(1.07)
    expect(penetrationCoefficient('he', true)).toBe(1.07)
    expect(penetrationCoefficient('atgm_heat', true)).toBe(1.07)
    expect(penetrationCoefficient('ap', false)).toBe(1)
  })

  it('grousers(123)：通过性 +20/15/30%（阻力 /(1+bonus)，与 BlitzInfo 一致）', () => {
    const base = computeCharacteristics(setup({}))
    const grou = computeCharacteristics(setup({ deviceIds: [123] }))
    expect(grou.terrainPermeabilityFirm! / base.terrainPermeabilityFirm!).toBeCloseTo(1.2, 2)
    expect(grou.terrainPermeabilityMedium! / base.terrainPermeabilityMedium!).toBeCloseTo(1.15, 2)
    expect(grou.terrainPermeabilitySoft! / base.terrainPermeabilitySoft!).toBeCloseTo(1.3, 2)
  })

  it('强化装甲 110：板值 × armorHomogenizationFactor（+4%）', () => {
    const base = computeCharacteristics(setup({ armor: ARMOR }))
    expect(base.turretArmorFront).toBe(60)
    expect(base.hullArmorRear).toBe(45)
    const buffed = computeCharacteristics(setup({ armor: ARMOR, deviceIds: [110], armorFactor: 1.04 }))
    expect(buffed.turretArmorFront).toBe(62.4)
    expect(buffed.hullArmorSide).toBe(52)
    expect(buffed.hullArmorRear).toBe(46.8)
  })

  it('乘员技能：smooth_* 降低动态扩圈、Virtuoso +7% 车体转向、Camo 裸隐蔽 ×1.21', () => {
    const base = computeCharacteristics(setup({}))
    const skilled = computeCharacteristics(setup({
      skillLevels: {
        smooth_driving: 7,
        smooth_turn: 7,
        smooth_turret: 7,
        soft_recoil: 7,
        virtuoso: 7,
        camouflage: 7,
      },
    }))
    expect(base.dispersionMoving).not.toBeNull()
    expect(skilled.dispersionMoving).toBeCloseTo(base.dispersionMoving! * 0.93, 3)
    expect(skilled.dispersionHullTraversing).toBeCloseTo(base.dispersionHullTraversing! * 0.93, 3)
    expect(skilled.dispersionTurretTraversing).toBeCloseTo(base.dispersionTurretTraversing! * 0.86, 3)
    expect(skilled.dispersionShooting).toBeCloseTo(base.dispersionShooting! * 0.93, 3)
    expect(skilled.stillInvisibility).toBeCloseTo(base.stillInvisibility! * 1.21, 1)
    expect(skilled.chassiRotationSpeed).toBeCloseTo(base.chassiRotationSpeed! * 1.07, 2)
    // 等级可缩放：1 级只吃 1 个 per-level（客户端 0.01）
    const levelOne = computeCharacteristics(setup({ skillLevels: { smooth_driving: 1 } }))
    expect(levelOne.dispersionMoving).toBeCloseTo(base.dispersionMoving! * 0.99, 3)
  })

  it('条件技能按触发效果计入静态表（BI 同口径）：近战/突围/狂暴/亡命/致命精准', () => {
    const base = computeCharacteristics(setup({}))
    const close = computeCharacteristics(setup({ skillLevels: { close_combat_master: 7 } }))
    expect(close.turretRotationSpeed).toBeCloseTo(base.turretRotationSpeed! * 1.07, 2)
    const surround = computeCharacteristics(setup({ skillLevels: { surrounded_by_enemy: 7 } }))
    expect(surround.enginePower).toBeCloseTo(base.enginePower! * 1.07, 2)
    const rage = computeCharacteristics(setup({ skillLevels: { battle_rage: 7 } }))
    expect(rage.gunShellReloadTime).toBeCloseTo(base.gunShellReloadTime! / 1.07, 2)
    const desperado = computeCharacteristics(setup({ skillLevels: { desperado: 7 } }))
    expect(desperado.gunShellReloadTime).toBeCloseTo(base.gunShellReloadTime! / 1.07, 2)
    const deadly = computeCharacteristics(setup({ skillLevels: { deadly_accuracy: 7 } }))
    expect(deadly.circularVisionRadius).toBeCloseTo(base.circularVisionRadius! * 1.07, 2)
    expect(deadly.gunAimingTime).toBeCloseTo(base.gunAimingTime! / 1.07, 2)
  })

  it('垂直稳定器 105：动态扩圈统一 −17%（基础/移动/转向/射击后/炮损）', () => {
    const base = computeCharacteristics(setup({}))
    const stab = computeCharacteristics(setup({ deviceIds: [105] }))
    expect(stab.dispersionMoving).toBeCloseTo(base.dispersionMoving! * 0.83, 3)
    expect(stab.dispersionHullTraversing).toBeCloseTo(base.dispersionHullTraversing! * 0.83, 3)
    expect(stab.dispersionTurretTraversing).toBeCloseTo(base.dispersionTurretTraversing! * 0.83, 3)
    expect(stab.dispersionShooting).toBeCloseTo(base.dispersionShooting! * 0.83, 3)
    expect(stab.dispersionGunDamaged).toBeCloseTo(base.dispersionGunDamaged! * 0.83, 3)
  })

  it('弹速：超负荷 107 +35%、火药补给 +35%（同调用加法，客户端 script）', () => {
    const shell = { ...S54, velocity: 816 }
    expect(computeCharacteristics(setup({ standardShell: shell })).baseShellAvgSpeed).toBe(816)
    expect(computeCharacteristics(setup({ standardShell: shell, deviceIds: [107] })).baseShellAvgSpeed).toBe(1102)
    expect(computeCharacteristics(setup({ standardShell: shell, provisionStems: ['gunPowder'] })).baseShellAvgSpeed)
      .toBe(Math.round(816 * 1.35))
  })
})

describe('履带维修时间（客户端 chassisRepairTime = hysteresisHealth / healthRegenPerSec）', () => {
  it('T-34 基准 6.857 s；工具箱 +20%、防护套件 +10% 同乘', () => {
    const base = computeCharacteristics(setup({}))
    expect(base.chassisRepairTime).toBeCloseTo(6.857, 3) // 24 / 3.5
    const buffed = computeCharacteristics(setup({ deviceIds: [113], provisionStems: ['safety_set'] }))
    expect(buffed.chassisRepairTime).toBeCloseTo(6.857 / (1.2 * 1.1), 3)
  })

  it('乘员 Repair 技能按客户端 per-level 4%（IS-4 重型 7 级 = 28%）', () => {
    const base = computeCharacteristics(setup({
      modules: IS4,
      turretIdx: 0,
      gunIdx: 0,
      engineIdx: 0,
      trackIdx: 0,
      standardShell: null,
    }))
    expect(base.chassisRepairTime).toBeCloseTo(6.857, 3) // 66 / 9.625
    const skilled = computeCharacteristics(setup({
      modules: IS4,
      turretIdx: 0,
      gunIdx: 0,
      engineIdx: 0,
      trackIdx: 0,
      standardShell: null,
      skillLevels: { repair: 7 },
    }))
    expect(skilled.chassisRepairTime).toBeCloseTo(6.857 / 1.28, 3)
  })

  it('缺 hysteresisHealth/healthRegenPerSec → null（fail-closed，不猜基准）', () => {
    const noRepair = {
      ...T34,
      chassis: T34.chassis.map((chassis: any) => ({
        ...chassis,
        stats: { ...chassis.stats, hysteresisHealth: null },
      })),
    }
    expect(computeCharacteristics(setup({ modules: noRepair })).chassisRepairTime).toBeNull()
  })
})

describe('车体尺寸（BI 11.21 Dimensions：底盘 + 车体 + 所选炮塔碰撞盒）', () => {
  it('缺炮塔挂点 → 整组 null（不做单盒拼接）', () => {
    const noOrigin = { ...T34, turretOrigin: null }
    const out = computeCharacteristics(setup({ modules: noOrigin }))
    expect(out.tankWidth).toBeNull()
    expect(out.tankLength).toBeNull()
    expect(out.tankHeight).toBeNull()
    expect(out.tankVolume).toBeNull()
  })

  it('无炮塔 TD 的空心炮塔盒不参与并集（仅车体+底盘也出尺寸）', () => {
    const noTurret = {
      ...T34,
      turrets: T34.turrets.map((turret: any, index: number) => index === 0
        ? { ...turret, stats: { ...turret.stats, bbox: { min: [0, 0, 0], max: [0, 0, 0] } } }
        : turret),
    }
    const out = computeCharacteristics(setup({ modules: noTurret, turretIdx: 0, gunIdx: 0 }))
    expect(out.tankLength).toBe(5.72)
    expect(out.tankWidth).toBe(2.94)
    expect(out.tankHeight).toBe(1.67) // 底盘 0.002..0.99 + 车体上移 0.745（无炮塔盒）
  })
})

describe('初始炮塔 pitch（models.pb initial_turret_rotation，4 辆意系 AT-SPG）', () => {
  it('有效仰角 = |min| − pitch、有效俯角 = max + pitch（BI 11.21 同口径）', () => {
    const withPitch = { ...T34, initialTurretRotation: { yaw: 0, pitch: 3, roll: 0 } }
    const out = computeCharacteristics(setup({ modules: withPitch }))
    expect(out.gunPitchUpLimit).toBe(23) // 26 − 3
    expect(out.gunPitchDownLimit).toBe(11) // 8 + 3
  })

  it('Minotauro（真实数据）：18/7 + pitch 3 → 15/10', () => {
    const out = computeCharacteristics(setup({
      modules: MINOTAURO,
      turretIdx: 0,
      gunIdx: 0,
      engineIdx: 0,
      trackIdx: 0,
      standardShell: null,
    }))
    expect(out.gunPitchUpLimit).toBe(15)
    expect(out.gunPitchDownLimit).toBe(10)
  })
})
