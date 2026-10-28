/**
 * 配置器状态解析 golden：用客户端导出数据（T-34）构造与 tank/{id}.json 同形的 config 表，
 * 锁定 (turret_local, gun_local) ↔ config 对号、装备槽编解码、默认消耗品与 delta 行契约。
 */
import { describe, expect, it } from 'vitest'
import DEVICES from './__fixtures__/research/devices.json'
import CONSUMABLES from './__fixtures__/research/consumables.json'
import PROVISIONS from './__fixtures__/research/provisions.json'
import FORMAT from './__fixtures__/research/params/format.json'
import CAMOUFLAGE from './__fixtures__/research/camouflage.json'
import SKILLS from './__fixtures__/research/skills.json'
import USSRS from './__fixtures__/modules/ussr.json'
import {
  armorFactorFor,
  baseSelection,
  buildComputeInput,
  configIndexFor,
  computeSetupPair,
  consumableTiming,
  decodeDevices,
  devicesFromEquipmentIds,
  encodeDevices,
  findTankModules,
  gunCycleOf,
  paramGroups,
  defaultShellIndex,
  pickGun,
  pickTurret,
  pitchAtBearing,
  resolveArmor,
  resolveSetup,
  standardShellOf,
  tankRef,
} from './tankSetup'
import { availableItems } from '../../utils/researchCatalog'

const catalog = {
  devices: DEVICES.devices,
  devicePresets: DEVICES.presets,
  consumables: CONSUMABLES.items,
  provisions: PROVISIONS.items,
  camouflage: { defaultCategory: CAMOUFLAGE.defaultCategory, categories: CAMOUFLAGE.categories },
  skills: SKILLS.items,
  crewSkillClasses: SKILLS.classes,
}

const MODULES = findTankModules(USSRS, 1)!

/** 由模块数据生成与 tank/{id}.json 同形的 configs（客户端顺序：炮塔序 × 该塔炮序）。 */
function makeDetail() {
  const configs: any[] = []
  for (const turret of MODULES.turrets) {
    for (const gun of turret.guns) {
      configs.push({
        turret_local: turret.localId,
        gun_local: gun.localId,
        shells: [
          { type: 'ap', damage: 160, penetration: 125, velocity: 816 },
          { type: 'ap_cr_premium', damage: 160, penetration: 175, velocity: 900 },
        ],
        is_burst: false,
      })
    }
  }
  return {
    tank_id: 1,
    name: 'T-34',
    nation: 'ussr',
    tier: 5,
    type: 'mediumTank',
    tags: [],
    armor: { hull: { front: 45, sides: 40, rear: 40 }, turret: { front: 60, sides: 45, rear: 45 } },
    configs,
  }
}

const DETAIL = makeDetail()
const EMPTY_URL = { config: null, engine: null, track: null, dev: '', cons: null, prov: null, camo: false }

describe('模块对号（客户端 localId）', () => {
  it('findTankModules 按 tankId 而非名称匹配', () => {
    expect(MODULES.name).toBe('T-34')
    expect(findTankModules(USSRS, 999999)).toBeNull()
  })

  it('(turret_local, gun_local) → configs 下标；无匹配 -1', () => {
    expect(configIndexFor(DETAIL.configs, 1, 6)).toBe(6)
    expect(configIndexFor(DETAIL.configs, 0, 0)).toBe(0)
    expect(configIndexFor(DETAIL.configs, 1, 2)).toBe(4)
    expect(configIndexFor(DETAIL.configs, 99, 0)).toBe(-1)
    expect(configIndexFor(DETAIL.configs, null, 0)).toBe(-1)
  })
})

describe('resolveSetup（URL + 数据 → 选择态）', () => {
  it('无 URL 状态：顶级配置（末位）+ 顶级发动机/履带 + 空装备 + 客户端默认消耗品', () => {
    const setup = resolveSetup({ detail: DETAIL, modules: MODULES, url: EMPTY_URL, catalog })
    expect(setup.canConfigure).toBe(true)
    expect(setup.config).toBe(6)         // 末位 = 1 号炮塔 + S-54
    expect(setup.turret).toBe(1)
    expect(setup.gun).toBe(3)
    expect(setup.engine).toBe(MODULES.engines.length - 1)
    expect(setup.track).toBe(MODULES.chassis.length - 1)
    expect(setup.devices).toEqual(Array(9).fill(null))
    expect(setup.provisions).toEqual([])
    expect(setup.camouflage).toBe(false)
    // 默认空（与 BlitzInfo 中性基线一致；客户端默认表不再预填）
    expect(setup.consumables).toEqual([])
  })

  it('URL 状态生效：config / engine / track / dev / cons / prov / camo', () => {
    const setup = resolveSetup({
      detail: DETAIL,
      modules: MODULES,
      url: { config: 0, engine: 0, track: 0, dev: '01', cons: [], prov: ['regular_fuel'], skills: { smooth_driving: 3, not_a_skill: 7 }, camo: true },
      catalog,
    })
    expect(setup).toMatchObject({ config: 0, turret: 0, gun: 0, engine: 0, track: 0, camouflage: true })
    expect(setup.devices).toEqual([0, 1, null, null, null, null, null, null, null])
    // cons: []（键存在但空）= 用户清空，不回填默认表
    expect(setup.consumables).toEqual([])
    expect(setup.provisions).toEqual(['regular_fuel'])
    // 技能只保留已知 20 项；效果全局、不按当前车型过滤
    expect(setup.skills).toEqual({ smooth_driving: 3 })
    expect(buildComputeInput({ detail: DETAIL, modules: MODULES, selection: setup, catalog }).skillLevels)
      .toEqual({ smooth_driving: 3 })
  })

  it('URL 里别车残留的 stem 与越界下标被夹掉', () => {
    const setup = resolveSetup({
      detail: DETAIL,
      modules: MODULES,
      url: { config: 99, engine: 99, track: 99, dev: '', cons: ['notAnItem', 'afterburning'], prov: ['notAProvision'], camo: false },
      catalog,
    })
    expect(setup.config).toBe(6) // 越界回落末位
    expect(setup.engine).toBe(MODULES.engines.length - 1)
    expect(setup.track).toBe(MODULES.chassis.length - 1)
    expect(setup.consumables).toEqual(['afterburning'])
    expect(setup.provisions).toEqual([])
  })

  it('无模块或无 config 对号 → canConfigure=false（调用方保留静态展示）', () => {
    expect(resolveSetup({ detail: DETAIL, modules: null, url: EMPTY_URL, catalog }).canConfigure).toBe(false)
    const broken = { ...DETAIL, configs: [{ shells: [] }] }
    expect(resolveSetup({ detail: broken, modules: MODULES, url: EMPTY_URL, catalog }).canConfigure).toBe(false)
  })
})

describe('模块切换（炮塔 / 炮 → config）', () => {
  it('切炮塔保留同 stem 炮；该塔无此炮时退回首炮', () => {
    const top = resolveSetup({ detail: DETAIL, modules: MODULES, url: EMPTY_URL, catalog })
    const next = pickTurret(top, MODULES, DETAIL, 0)
    expect(next.turret).toBe(0)
    expect(next.gun).toBe(0)
    expect(next.config).toBe(0) // 0 号塔 + L-11
  })

  it('切炮写回对应 config', () => {
    const top = resolveSetup({ detail: DETAIL, modules: MODULES, url: EMPTY_URL, catalog })
    const next = pickGun(top, MODULES, DETAIL, 2) // 1 号塔的 ZiS-4
    expect(next.gun).toBe(2)
    expect(next.config).toBe(5)
  })
})

describe('gunCycleOf（config 的 is_drum/is_burst 语义）', () => {
  it('regular / autoloader / autoreloader', () => {
    expect(gunCycleOf({ reload_time: 8, is_burst: false, is_drum: false })).toMatchObject({ type: 'regular' })
    expect(gunCycleOf({ reload_time: 20, burst_size: 3, burst_interval: 3, is_burst: true, is_drum: false }))
      .toMatchObject({ type: 'autoloader', shellCount: 3, intraClip: 3 })
    expect(gunCycleOf({ reload_time: 14, burst_size: 3, burst_interval: 2.727, burst_reloads: [14, 12, 10], is_burst: true, is_drum: true }))
      .toMatchObject({ type: 'autoreloader', shellCount: 3, shellReloads: [14, 12, 10] })
  })

  it('连发组（PomPom）：burst_group_* 进循环；缺字段/不超过 1 发视为无组', () => {
    const atlas = gunCycleOf({
      reload_time: 13, burst_size: 6, burst_interval: 3, is_burst: true, is_drum: false,
      burst_group_count: 3, burst_group_interval: 0.25,
    })
    expect(atlas).toMatchObject({
      type: 'autoloader', shellCount: 6, intraClip: 3,
      burstGroupCount: 3, burstGroupInterval: 0.25,
    })
    // 普通弹夹（旧包没有 burst_group_*）：0 → 计算仍走整匣公式
    expect(gunCycleOf({ reload_time: 20, burst_size: 3, burst_interval: 3, is_burst: true }))
      .toMatchObject({ burstGroupCount: 0, burstGroupInterval: 0 })
    // count=1 是“单发连发组”（客户端常规炮也带 burst count 1）：不算组
    expect(gunCycleOf({ reload_time: 20, burst_size: 3, burst_interval: 3, is_burst: true, burst_group_count: 1, burst_group_interval: 0.2 }))
      .toMatchObject({ burstGroupCount: 0, burstGroupInterval: 0 })
  })
})

describe('装备槽编解码', () => {
  it('9 槽 0/1/- 往返；尾随空槽不写进 URL', () => {
    const decoded = decodeDevices('01-1')
    expect(decoded.slice(0, 4)).toEqual([0, 1, null, 1])
    expect(decoded).toHaveLength(9)
    expect(encodeDevices(decoded)).toBe('01-1')
    expect(encodeDevices(Array(9).fill(null))).toBe('')
  })
})

describe('标准弹与默认消耗品', () => {
  it('标准弹优先非金币 AP（跳过 ap_cr_premium 等金币弹）', () => {
    expect(standardShellOf(DETAIL.configs[6])).toEqual({ damage: 160, penetration: 125, type: 'ap', velocity: 816 })
    expect(standardShellOf({ shells: [{ type: 'hc_premium', damage: 1, penetration: 2 }] }))
      .toMatchObject({ type: 'hc_premium' })
    expect(standardShellOf({ shells: [] })).toBeNull()
  })

  it('选中弹种：下标越界回落默认 AP；resolveSetup 读取 URL shell', () => {
    expect(defaultShellIndex(DETAIL.configs[6])).toBe(0)
    expect(standardShellOf(DETAIL.configs[6], 1)).toMatchObject({ type: 'ap_cr_premium', penetration: 175, velocity: 900 })
    const second = resolveSetup({
      detail: DETAIL,
      modules: MODULES,
      url: { ...EMPTY_URL, shell: 1 },
      catalog,
    })
    expect(second.shell).toBe(1)
    expect(buildComputeInput({ detail: DETAIL, modules: MODULES, selection: second, catalog }).standardShell)
      .toMatchObject({ type: 'ap_cr_premium', penetration: 175 })
    const outOfRange = resolveSetup({
      detail: DETAIL,
      modules: MODULES,
      url: { ...EMPTY_URL, shell: 9 },
      catalog,
    })
    expect(outOfRange.shell).toBe(0)
  })

  it('强化装甲 110：armorFactor 从客户端 script 读取；未装 = 1', () => {
    expect(armorFactorFor([], catalog)).toBe(1)
    expect(armorFactorFor([110], catalog)).toBeCloseTo(1.04, 5)
  })

  it('弹夹/连发车（is_drum / is_burst）注入 clip 语义标记：berserk 不可用', () => {
    const clipDetail = { ...DETAIL, configs: DETAIL.configs.map((config, i) => (i === 0 ? { ...config, is_drum: true } : config)) }
    expect(tankRef(clipDetail).tags).toContain('clip')
    const setup = resolveSetup({ detail: clipDetail, modules: MODULES, url: EMPTY_URL, catalog })
    expect(setup.consumables).not.toContain('berserk')
  })

  it('ids 规则（nation:stem）用模块键补出的 stem；无 stem 时 ids 物品不可用', () => {
    expect(tankRef(DETAIL, MODULES).stem).toBe('T-34')
    const items = [{ stem: 'idOnly', mode: 'common', filter: { include: [{ ids: ['ussr:T-34'] }] } }]
    expect(availableItems(items, tankRef(DETAIL, MODULES))).toHaveLength(1)
    expect(availableItems(items, tankRef(DETAIL))).toHaveLength(0)
  })

})

describe('装甲表（按所选炮塔解析）', () => {
  it('用该炮塔的 primaryArmor + 当前 config 的 turret_plates；缺失回退顶层摘要', () => {
    const modules = {
      ...MODULES,
      turrets: MODULES.turrets.map((turret, index) => ({
        ...turret,
        primaryArmor: { front: 'armor_1', sides: 'armor_3', rear: 'armor_4' },
        plates: index,
      })),
    }
    const detail = {
      ...DETAIL,
      configs: DETAIL.configs.map((config, index) => ({
        ...config,
        turret_plates: { 1: index === 0 ? 100 : 200, 3: 60, 4: 40 },
      })),
    }
    const stock = resolveArmor(detail, modules, { ...baseSelection({ detail, modules })! })
    expect(stock.turret).toEqual({ front: 100, sides: 60, rear: 40 })
    const top = resolveArmor(detail, modules, resolveSetup({ detail, modules, url: EMPTY_URL, catalog }))
    expect(top.turret).toEqual({ front: 200, sides: 60, rear: 40 })
    expect(top.hull).toEqual(DETAIL.armor.hull)
    // 无炮塔 TD（model_turret_count=0）不展示炮塔装甲
    const turretless = {
      ...DETAIL,
      configs: DETAIL.configs.map(config => ({ ...config, model_turret_count: 0 })),
    }
    expect(resolveArmor(turretless, MODULES, resolveSetup({ detail: turretless, modules: MODULES, url: EMPTY_URL, catalog })).turret)
      .toBeNull()
    // 无 primaryArmor/turret_plates → 回退顶层 armor 摘要（不猜）
    expect(resolveArmor(DETAIL, MODULES, resolveSetup({ detail: DETAIL, modules: MODULES, url: EMPTY_URL, catalog })).turret)
      .toEqual(DETAIL.armor.turret)
  })
})

describe('引擎输入与 delta 行', () => {
  it('buildComputeInput 解析装备预设、script 摘要与装甲', () => {
    const setup = resolveSetup({ detail: DETAIL, modules: MODULES, url: EMPTY_URL, catalog })
    const input = buildComputeInput({
      detail: DETAIL,
      modules: MODULES,
      selection: { ...setup, devices: [0, 1, null, null, null, null, null, null, null], provisions: ['regular_fuel'] },
      catalog,
    })
    // T-34 预设 HEprotectionPreset：槽 0 = attack 左(100 rammer)，槽 1 = defence 右(121 改进战斗室)
    expect(input.deviceIds).toEqual([100, 121])
    expect(input.provisionScripts.regular_fuel?.params?.bonusValues?.enginePowerIncrease).toBe('3')
    expect(input.armor?.turret?.front).toBe(60)
    expect(input.standardShell?.type).toBe('ap')
    // 隐蔽加成来自客户端数据（迷彩网 script + camouflages.xml 默认类别）
    expect(Number(input.camouflageNet?.bonus?.mediumTank)).toBe(0.04)
    expect(Number(input.camouflageNet?.activateBonusFactor)).toBe(2)
    expect(input.paintInvisibility).toMatchObject({ lightTank: 0.03, mediumTank: 0.03, heavyTank: 0.02, 'AT-SPG': 0.04 })
  })

  it('基准态 = config 0 + 首档发动机/履带 + 空装备', () => {
    const base = baseSelection({ detail: DETAIL, modules: MODULES })
    expect(base).toMatchObject({ config: 0, turret: 0, gun: 0, engine: 0, track: 0, camouflage: false })
  })

  it('paramGroups：delta 符号按 biggerIsBetter 判定，0 不显示；format 决定小数位/单位', () => {
    const setup = resolveSetup({ detail: DETAIL, modules: MODULES, url: EMPTY_URL, catalog })
    const { current, base } = computeSetupPair({ detail: DETAIL, modules: MODULES, selection: setup, catalog })
    const groups = paramGroups(current, base, FORMAT.params)
    const rows = Object.fromEntries(groups.flatMap(group => group.rows.map(row => [row.key, row])))
    // 顶级炮装填更快：delta 负、biggerIsBetter=false → good
    expect(rows.gunShellReloadTime.delta).toBeLessThan(0)
    expect(rows.gunShellReloadTime.good).toBe(true)
    expect(rows.gunShellReloadTime.digits).toBe(2)
    // 顶级炮塔血量更高：delta 正、good
    expect(rows.maxHealth.delta).toBe(60)
    expect(rows.maxHealth.good).toBe(true)
    // 单位/小数位来自客户端 format
    expect(rows.maxFrontSpeed.unit).toBe('KILOMETER_PER_HOUR')
    expect(rows.weight.digits).toBe(2)
    // 客户端 format 缺 units 的时间/距离键由 UI 语义补充
    expect(rows.gunAimingTime.unit).toBe('SECOND')
    expect(rows.gunShellReloadTime.unit).toBe('SECOND')
    expect(rows.circularVisionRadius.unit).toBe('METER')
    expect(rows.gunShotDispersionRadius.unit).toBe('METER')
    // 没有值的参数不出现
    expect(rows.gunClipReloadTime).toBeUndefined()
    expect(rows.dispersionMoving.unit).toBeNull()
    expect(rows.dispersionMoving.value).toBe(0.17)
    expect(rows.dispersionMoving.digits).toBe(3)
    expect(groups.map(group => group.group)).toEqual(['protectability', 'mobility', 'gun'])
  })

  it('paramGroups：无炮塔车用火炮转向速度替换炮塔转速（有炮塔车相反）', () => {
    const rowsOf = (current: Record<string, any>) => Object.fromEntries(
      paramGroups(current, {}, FORMAT.params).flatMap(group => group.rows.map(row => [row.key, row])),
    )
    const noTurret = rowsOf({ hasTurret: false, turretRotationSpeed: 26, gunTraverseSpeed: 27.375 })
    expect(noTurret.turretRotationSpeed).toBeUndefined()
    expect(noTurret.gunTraverseSpeed.value).toBe(27.375)
    expect(noTurret.gunTraverseSpeed.unit).toBe('DEGREE_PER_SECOND')
    expect(noTurret.gunTraverseSpeed.digits).toBe(2)

    const turret = rowsOf({ hasTurret: true, turretRotationSpeed: 40, gunTraverseSpeed: 39.375 })
    expect(turret.turretRotationSpeed.value).toBe(40)
    expect(turret.gunTraverseSpeed).toBeUndefined()

    // 旧数据/缺 rotationSpeed：保留炮塔行（fail-open，不因数据迁移留空）
    const fallback = rowsOf({ hasTurret: false, turretRotationSpeed: 26, gunTraverseSpeed: null })
    expect(fallback.turretRotationSpeed.value).toBe(26)
    expect(fallback.gunTraverseSpeed).toBeUndefined()
  })

  it('paramGroups：自动装填炮的有效 DPM 行只在有值时出现', () => {
    const rowsOf = (current: Record<string, any>) => Object.fromEntries(
      paramGroups(current, {}, FORMAT.params).flatMap(group => group.rows.map(row => [row.key, row])),
    )
    const withEffective = rowsOf({ hasTurret: true, gunCommonDamagePerMin: 900, gunEffectiveDamagePerMin: 887.35 })
    expect(withEffective.gunEffectiveDamagePerMin.value).toBe(887.35)
    expect(withEffective.gunEffectiveDamagePerMin.digits).toBe(0)
    const withoutEffective = rowsOf({ hasTurret: true, gunCommonDamagePerMin: 900, gunEffectiveDamagePerMin: null })
    expect(withoutEffective.gunEffectiveDamagePerMin).toBeUndefined()
  })
})

describe('pitchAtBearing（客户端 front/back 扇区 + transition）', () => {
  it('back 扇区：0° 默认、过渡中点、后向极限', () => {
    const pitch = { max: 6, min: -18, back: { max: 3, min: -18, range: 30 } }
    // 0° 正前：默认（仰 18 / 俯 6）；165°/180° 后向扇区：俯角只剩 3°
    expect(pitchAtBearing(pitch, 0)).toEqual({ up: 18, down: -6 })
    // 155°：距车尾 25°，落在 15+20 的过渡带中点 → 3° 与 6° 的均值
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
  const modules = findTankModules(USSRS as any, 5137) ?? USSRS.tanks[Object.keys(USSRS.tanks)[0]]

  it('id 命中预设一侧 → 该侧；两侧都命中/都未命中 → null', () => {
    // level0 attack：左 rammer(100) / 右 calibratedShells(103)
    expect(devicesFromEquipmentIds([100], modules, catalog)[0]).toBe(0)
    expect(devicesFromEquipmentIds([103], modules, catalog)[0]).toBe(1)
    // 未命中：槽位空（fail-closed），不猜
    expect(devicesFromEquipmentIds([], modules, catalog)[0]).toBeNull()
    expect(devicesFromEquipmentIds([101], modules, catalog)[0]).toBeNull() // 101 不在该槽两侧
  })

  it('0 = 空槽垫底：过滤掉；左右候选 id 同时在场 = 歧义 → null', () => {
    const slots = devicesFromEquipmentIds([0, 100, 101], modules, catalog)
    expect(slots[0]).toBe(0) // 100 → rammer（左）
    expect(devicesFromEquipmentIds([100, 103], modules, catalog)[0]).toBeNull()
  })

  it('未知 id（预设外）→ 对应槽位 null；空入参 → 全 null 表', () => {
    expect(devicesFromEquipmentIds([999], modules, catalog)).not.toContain(1)
    expect(devicesFromEquipmentIds(null, modules, catalog).every(s => s === null)).toBe(true)
    expect(devicesFromEquipmentIds([], modules, catalog).length).toBe(9)
  })
})
