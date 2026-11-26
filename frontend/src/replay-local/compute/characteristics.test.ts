import { describe, expect, it } from 'vitest'
import { computeCharacteristics } from './characteristics'
import { JAGDTIGER, L11, setup } from '../../test/characteristicsTestHelpers'

describe('computeCharacteristics（T-34 golden，双实现对拍）', () => {
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
    expect(out.maxHealth).toBe(714)
    expect(out.weight).toBe(29.94)
    expect(out.enginePower).toBe(517)
    expect(out.thrustToWeightRatio).toBe(17.27)
    expect(out.gunShellReloadTime).toBe(6.151)
    expect(out.gunCommonDamagePerMin).toBe(1561)
    expect(out.gunShotsPerMinute).toBe(9.75)
    expect(out.baseShellAvgPiercingPower).toBe(125)
    expect(out.gunAimingTime).toBe(2.125)
    expect(out.gunShotDispersionRadius).toBe(0.4)
    expect(out.circularVisionRadius).toBe(240)
    expect(out.chassisRepairTime).toBeCloseTo(6.857, 3)
    expect(out.tankLength).toBe(5.72)
    expect(out.tankWidth).toBe(2.94)
    expect(out.tankHeight).toBe(2.63)
    expect(out.tankVolume).toBeCloseTo(44.23, 2)
    expect(out.gunClipDamage).toBeNull()
    expect(out.stillInvisibility).toBe(28.8)
    expect(out.movingInvisibility).toBe(21.6)
    expect(out.shotInvisibility).toBe(7.11)
    expect(out.movingShotInvisibility).toBe(5.34)
    expect(out.fireInvisibility).toBe(12.44)
    expect(out.hasTurret).toBe(true)
    expect(out.turretRotationSpeed).toBe(53.9)
    expect(out.gunTraverseSpeed).toBe(43.313)
    expect(out.chassiRotationSpeed).toBe(53.674)
    expect(out.terrainPermeabilityFirm).toBe(104.3)
    expect(out.gunPitchUpLimit).toBe(26)
    expect(out.gunPitchDownLimit).toBe(8)
  })

  it('S2：初始配置全空（基准态，stock crew 角色加成仍在）', () => {
    const out = computeCharacteristics(setup({
      turretIdx: 0,
      gunIdx: 0,
      engineIdx: 0,
      trackIdx: 0,
      standardShell: L11,
    }))
    expect(out.maxHealth).toBe(620)
    expect(out.weight).toBe(28.51)
    expect(out.enginePower).toBe(400)
    expect(out.gunShellReloadTime).toBe(7.959)
    expect(out.gunCommonDamagePerMin).toBe(1055)
    expect(out.baseShellAvgPiercingPower).toBe(85)
    expect(out.circularVisionRadius).toBe(200)
    expect(out.gunPitchUpLimit).toBe(17)
    expect(out.gunPitchDownLimit).toBe(6)
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
    expect(out.baseShellAvgPiercingPower).toBe(132.5)
    expect(out.circularVisionRadius).toBe(279.2)
    expect(out.stillInvisibility).toBe(39.8)
    expect(out.movingInvisibility).toBe(28.6)
    expect(out.enginePower).toBe(545.2)
    expect(out.maxFrontSpeed).toBe(52)
    expect(out.maxBackSpeed).toBe(22)
    expect(out.gunShellReloadTime).toBe(7.005)
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
    expect(out.turretRotationSpeed).toBeCloseTo(27.114, 3)
    expect(out.gunTraverseSpeed).toBeCloseTo(27.375, 3)
    expect(out.gunEffectiveDamagePerMin).toBeNull()
  })

  it('fail-closed：模块缺失时全部字段为 undefined，不猜默认值', () => {
    const out = computeCharacteristics(setup({ turretIdx: 99 }))
    expect(out.maxHealth).toBeUndefined()
    expect(out.gunShellReloadTime).toBeUndefined()
  })
})
