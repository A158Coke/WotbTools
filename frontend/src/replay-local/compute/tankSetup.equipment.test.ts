import { describe, expect, it } from 'vitest'
import DEVICES from './__fixtures__/research/devices.json'
import CONSUMABLES from './__fixtures__/research/consumables.json'
import PROVISIONS from './__fixtures__/research/provisions.json'
import CAMOUFLAGE from './__fixtures__/research/camouflage.json'
import SKILLS from './__fixtures__/research/skills.json'
import USSRS from './__fixtures__/modules/ussr.json'
import {
  consumableTiming, devicesFromEquipmentIds, findTankModules, pitchAtBearing, pitchDeviceBonus,
  presetProvidesPitchDevice, recordedTargetMatchesShot, resolvePitchCheckboxChecked, resolvePitchDeviceEffective,
} from './tankSetup'

const catalog = {
  devices: DEVICES.devices,
  devicePresets: DEVICES.presets,
  consumables: CONSUMABLES.items,
  provisions: PROVISIONS.items,
  camouflage: { defaultCategory: CAMOUFLAGE.defaultCategory, categories: CAMOUFLAGE.categories },
  skills: SKILLS.items,
  crewSkillClasses: SKILLS.classes,
}

describe('pitchAtBearing（客户端 front/back 扇区 + transition）', () => {
  it('back 扇区：0° 默认、过渡中点、后向极限', () => {
    const pitch = { max: 6, min: -18, back: { max: 3, min: -18, range: 30 } }
    expect(pitchAtBearing(pitch, 0)).toEqual({ up: 18, down: -6 })
    expect(pitchAtBearing(pitch, 155)).toEqual({ up: 18, down: -4.5 })
    expect(pitchAtBearing(pitch, 165)).toEqual({ up: 18, down: -3 })
    expect(pitchAtBearing(pitch, 180)).toEqual({ up: 18, down: -3 })
  })

  it('front + back 双扇区：front 优先', () => {
    const pitch = {
      max: 6,
      min: -17,
      front: { max: 9, min: -20, range: 135 },
      back: { max: 4, min: -20, range: 10 },
      transition: 5,
    }
    expect(pitchAtBearing(pitch, 0)).toEqual({ up: 20, down: -9 })
    expect(pitchAtBearing(pitch, 180)).toEqual({ up: 20, down: -4 })
  })

  it('装备加成（+4 仰角 / +3 俯角）施加在最终极限上', () => {
    const pitch = { max: 6, min: -18, back: { max: 3, min: -18, range: 30 } }
    expect(pitchAtBearing(pitch, 0, { up: 4, down: 3 })).toEqual({ up: 22, down: -9 })
    expect(pitchAtBearing(pitch, 180, { up: 4, down: 3 })).toEqual({ up: 22, down: -6 })
  })
})

describe('pitchDeviceBonus / presetProvidesPitchDevice（122 数据锚定）', () => {
  it('未装 122 → null；装上 → 读 devices.json 的 bonusValues', () => {
    expect(pitchDeviceBonus([103, 110], catalog)).toBeNull()
    expect(pitchDeviceBonus([122], catalog)).toEqual({ up: 4, down: 3 })
  })

  it('目录缺 122 时 fail-closed，不猜默认值', () => {
    expect(pitchDeviceBonus([122], { devices: [] })).toBeNull()
  })

  it('只有预设槽位含 improvedPitchLimitsSystem 的车才可用', () => {
    expect(presetProvidesPitchDevice({ optDevicePreset: 'AlternatePitchGrouserPreset' }, catalog)).toBe(true)
    expect(presetProvidesPitchDevice({ optDevicePreset: 'DrumGunPitchLimitsPreset' }, catalog)).toBe(true)
    expect(presetProvidesPitchDevice({ optDevicePreset: 'defaultPreset' }, catalog)).toBe(false)
    expect(presetProvidesPitchDevice(null, catalog)).toBe(false)
  })

  it('回放真值只匹配记录的目标车；换目标后不继承', () => {
    const shot = { target_tank_id: 9057 }
    expect(recordedTargetMatchesShot(shot, 9057)).toBe(true)
    expect(recordedTargetMatchesShot(shot, '9057')).toBe(true)
    expect(recordedTargetMatchesShot(shot, 9825)).toBe(false)
    expect(recordedTargetMatchesShot({ target_tank_id: undefined }, 9057)).toBe(false)
    expect(recordedTargetMatchesShot(null, 9057)).toBe(false)
    expect(recordedTargetMatchesShot(shot, null)).toBe(false)
  })
})

describe('consumableTiming（装备 101/118 与客户端 script 计时）', () => {
  it('101 高端消耗品：持续时间 +33%；118 配送系统：冷却速度 +17%（÷1.17）', () => {
    const script = { params: { duration: 12, cooldown: 65 } }
    expect(consumableTiming(script, [], catalog)).toEqual({ duration: 12, cooldown: 65 })
    const buffed = consumableTiming(script, [101, 118], catalog)
    expect(buffed.duration).toBeCloseTo(12 * 1.33, 6)
    expect(buffed.cooldown).toBeCloseTo(65 / 1.17, 6)
  })

  it('只对带计时的消耗品生效；补给无冷却/持续时间返回 null', () => {
    const extinguisher = CONSUMABLES.items.find((item: any) => item.stem === 'autoExtinguisher')
    expect(extinguisher).toBeTruthy()
    expect(consumableTiming(extinguisher!.script, [118], catalog).cooldown).toBeCloseTo(70 / 1.17, 6)
    expect(consumableTiming({ params: { crewLevelIncrease: 10 } }, [101, 118], catalog))
      .toEqual({ cooldown: null, duration: null })
  })
})

describe('devicesFromEquipmentIds（回放装配 → 槽位反解）', () => {
  const modules = findTankModules(USSRS as any, 5137) ?? Object.values(USSRS.tanks)[0]

  it('id 命中预设一侧 → 该侧；两侧都命中/都未命中 → null', () => {
    expect(devicesFromEquipmentIds([100], modules, catalog)[0]).toBe(0)
    expect(devicesFromEquipmentIds([103], modules, catalog)[0]).toBe(1)
    expect(devicesFromEquipmentIds([], modules, catalog)[0]).toBeNull()
    expect(devicesFromEquipmentIds([101], modules, catalog)[0]).toBeNull()
  })

  it('0 = 空槽垫底：过滤掉；左右候选 id 同时在场 = 歧义 → null', () => {
    const slots = devicesFromEquipmentIds([0, 100, 101], modules, catalog)
    expect(slots[0]).toBe(0)
    expect(devicesFromEquipmentIds([100, 103], modules, catalog)[0]).toBeNull()
  })

  it('未知 id（预设外）→ 对应槽位 null；空入参 → 全 null 表', () => {
    expect(devicesFromEquipmentIds([999], modules, catalog)).not.toContain(1)
    expect(devicesFromEquipmentIds(null, modules, catalog).every(s => s === null)).toBe(true)
    expect(devicesFromEquipmentIds([], modules, catalog).length).toBe(9)
  })
})

describe('122 生效与原生回退勾选（review P2：撤销覆盖不得留 stale checkbox）', () => {
  it('effective：可用性 fail-closed 先于一切', () => {
    expect(resolvePitchDeviceEffective({ available: false, override: true, recorded: true, checkboxChecked: true })).toBe(false)
  })

  it('effective：覆盖 > 录制真值 > 原生勾选', () => {
    expect(resolvePitchDeviceEffective({ available: true, override: false, recorded: true, checkboxChecked: true })).toBe(false)
    expect(resolvePitchDeviceEffective({ available: true, override: true, recorded: false, checkboxChecked: false })).toBe(true)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: true, checkboxChecked: false })).toBe(true)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: false, checkboxChecked: true })).toBe(false)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: null, checkboxChecked: true })).toBe(true)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: null, checkboxChecked: false })).toBe(false)
  })

  it('checkbox 回退态：录制真值在场跟随真值，缺失则关闭（不清真值、不留旧勾选）', () => {
    expect(resolvePitchCheckboxChecked({ override: null, recorded: true })).toBe(true)
    expect(resolvePitchCheckboxChecked({ override: null, recorded: false })).toBe(false)
    expect(resolvePitchCheckboxChecked({ override: null, recorded: null })).toBe(false)
    expect(resolvePitchCheckboxChecked({ override: null, recorded: undefined })).toBe(false)
    expect(resolvePitchCheckboxChecked({ override: false, recorded: true })).toBe(false)
    expect(resolvePitchCheckboxChecked({ override: true, recorded: null })).toBe(true)
  })

  it('非 shot 切走→切回：清覆盖后勾选关闭，effective 不再被旧勾选点亮', () => {
    const cleared = resolvePitchCheckboxChecked({ override: null, recorded: null })
    expect(cleared).toBe(false)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: null, checkboxChecked: cleared })).toBe(false)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: null, checkboxChecked: false })).toBe(false)
    expect(resolvePitchDeviceEffective({ available: true, override: null, recorded: true, checkboxChecked: false })).toBe(true)
  })
})
