/**
 * 配置器计算引擎 golden：期望值由上游仓（WoT-Blitz-Agent）同一公式表的独立 Python
 * 参照实现，对 common/research/ 导出数据逐项算出（双实现对拍；公式与裁定口径见
 * 上游 docs/wotbtools-research-loadout-plan.md §5）。改公式必须同时改两处并重生成。
 */
import { describe, expect, it } from 'vitest'
import { computeCharacteristics } from './characteristics'
import { JAGDTIGER, L11, setup } from '../../test/characteristicsTestHelpers'

describe('computeCharacteristics（T-34 golden，双实现对拍）', () => {
  // Fixed BF statsByLoadout (WG 11.21.0_1, ussr-T-34) against project module fixtures.
  it.each([
    [0, 0, 0, 0, 28.512, 400, 44.849, 94.81818181818181],
    [0, 0, 1, 0, 28.512, 470, 52.697575, 94.81818181818181],
    [0, 0, 0, 1, 28.512, 400, 47.978, 104.3],
    [1, 3, 1, 1, 29.942, 470, 53.67456408813877, 104.3],
  ])('BF T-34 turret %i gun %i engine %i chassis %i', (turretIdx, gunIdx, engineIdx, trackIdx, mass, power, turn, firm) => {
    const { _mobility: m } = computeCharacteristics(setup({ turretIdx, gunIdx, engineIdx, trackIdx }))
    expect(m.mass).toBeCloseTo(mass, 8)
    expect(m.power).toBe(power)
    expect(m.limit).toBe(48)
    expect(m.traverse.Firm).toBeCloseTo(turn, 8)
    expect(m.permeability.Firm).toBeCloseTo(firm, 8)
  })
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
