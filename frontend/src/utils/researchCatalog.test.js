/**
 * 数据面加载器契约：客户端图标覆盖（配置器只做图标展示，缺图会退化成文字，必须在测试里
 * 锁住覆盖）＋ 装备槽位解析。图标来源 = 客户端 UI 样式表 bg-sprite 映射（上游导出器裁剪）。
 */
import { describe, expect, it } from 'vitest'
import ICON_MANIFEST from '../../../common/research/icons/manifest.json'
import {
  RESEARCH_META,
  availableItems,
  itemAvailableForTank,
  itemIconUrl,
  moduleIconUrl,
  resolveDeviceIds,
  shellIconUrl,
  skillIconUrl,
} from './researchCatalog.js'

describe('research icons', () => {
  it('装备/消耗品/补给图标全部解析到构建期 URL', () => {
    const missing = []
    for (const item of RESEARCH_META.devices) {
      // stereoscope 无任何预设引用（数据文档已记录），客户端也不给装备图标
      if (item.stem !== 'stereoscope' && !itemIconUrl('devices', item.icon)) missing.push(`devices:${item.stem}`)
    }
    for (const item of RESEARCH_META.consumables.filter(entry => entry.mode === 'common')) {
      if (!itemIconUrl('consumables', item.icon)) missing.push(`consumables:${item.stem}`)
    }
    for (const item of RESEARCH_META.provisions.filter(entry => entry.mode === 'common')) {
      if (!itemIconUrl('provisions', item.icon)) missing.push(`provisions:${item.stem}`)
    }
    expect(missing).toEqual([])
  })

  it('模块类型图标 5 张齐全（chassis/engine/gun/hull/turret）', () => {
    for (const kind of ['chassis', 'engine', 'gun', 'hull', 'turret']) {
      expect(moduleIconUrl(kind), kind).toBeTruthy()
    }
  })

  it('导出清单只登记 stereoscope 为缺图（其余缺件会让上面的断言先失败）', () => {
    expect(ICON_MANIFEST.missing).toEqual([
      { kind: 'devices', stem: 'stereoscope', icon: 'stereoscope' },
    ])
    expect(Object.keys(ICON_MANIFEST.items.devices).length).toBe(21)
    expect(Object.keys(ICON_MANIFEST.items.consumables).length).toBe(13)
    expect(Object.keys(ICON_MANIFEST.items.provisions).length).toBe(34)
  })

  it('技能与弹种图标：客户端 20/9 张全覆盖', () => {
    for (const id of ['smooth_turn', 'smooth_driving', 'smooth_turret', 'soft_recoil', 'virtuoso', 'camouflage', 'repair']) {
      expect(skillIconUrl(id), id).toBeTruthy()
    }
    for (const type of ['ap', 'ap_premium', 'ap_cr', 'ap_cr_premium', 'he', 'he_premium', 'hc', 'hc_premium', 'atgm_heat']) {
      expect(shellIconUrl(type), type).toContain(`/shells/${type}.webp`)
    }
  })

  it('未知图标返回 null（组件据此回退文字，不抛错）', () => {
    expect(itemIconUrl('devices', 'no-such-icon')).toBeNull()
    expect(itemIconUrl('unknown-kind', 'rammer')).toBeNull()
    expect(moduleIconUrl('unknown')).toBeNull()
    expect(skillIconUrl('no-such-skill')).toBeNull()
    expect(shellIconUrl('no-such-shell')).toBeNull()
  })
})

describe('resolveDeviceIds', () => {
  it('按预设槽位取左右候选；空槽与缺失 stem 跳过', () => {
    const slots = [
      { level: 0, group: 'attack', left: 'rammer', right: 'calibratedShells' },
      { level: 0, group: 'defence', left: 'protectedModules', right: null },
    ]
    expect(resolveDeviceIds(slots, [0, 1])).toEqual([100])
    expect(resolveDeviceIds(slots, [1, null])).toEqual([103])
    expect(resolveDeviceIds(slots, [null, 1])).toEqual([])
  })
})

describe('vehicleFilter 语义（一个 include 块内是 AND，不是 OR）', () => {
  const ref = (nation, tier, extra = {}) => ({
    nation, tier, stem: extra.stem || 'X', tankId: extra.tankId || 0, tags: extra.tags || [],
  })
  const provision = stem => RESEARCH_META.provisions.find(item => item.stem === stem)
  const consumable = stem => RESEARCH_META.consumables.find(item => item.stem === stem)

  it('苏系食物 = 6-10 级且苏联；德系食物只给德国', () => {
    expect(itemAvailableForTank(provision('ration'), ref('ussr', 7))).toBe(true)
    expect(itemAvailableForTank(provision('ration'), ref('germany', 7))).toBe(false)
    expect(itemAvailableForTank(provision('ration'), ref('ussr', 5))).toBe(false)
    expect(itemAvailableForTank(provision('chocolate'), ref('germany', 8))).toBe(true)
    expect(itemAvailableForTank(provision('chocolate'), ref('ussr', 8))).toBe(false)
  })

  it('ids 规则按 nation:stem 精确匹配（tier 不参与）', () => {
    const gunpowder = provision('gunPowder')
    expect(itemAvailableForTank(gunpowder, ref('european', 10, { stem: 'Pl15_60TP' }))).toBe(true)
    expect(itemAvailableForTank(gunpowder, ref('european', 10, { stem: 'Other_Tank' }))).toBe(false)
  })

  it('exclude 的 clip 条件命中即排除（弹夹/连发车没有 berserk）', () => {
    expect(itemAvailableForTank(consumable('berserk'), ref('ussr', 10, { tags: ['clip'] }))).toBe(false)
    expect(itemAvailableForTank(consumable('berserk'), ref('ussr', 10))).toBe(true)
    expect(itemAvailableForTank(consumable('berserk'), ref('ussr', 3))).toBe(false) // 4 级起
  })

  it('战斗内技能（isAbility）不进入装配物品池：desertPower 不再出现在任何车的补给里', () => {
    const desert = RESEARCH_META.provisions.find(item => item.stem === 'desertPower')
    expect(desert.isAbility).toBe(true)
    const pool = availableItems(RESEARCH_META.provisions, ref('ussr', 5, { stem: 'T-34' }))
    expect(pool.map(item => item.stem)).not.toContain('desertPower')
    expect(pool.every(item => !item.isAbility)).toBe(true)
  })

  it('T-34（苏联 5 级）看不到他国食物，看得到通用油料', () => {
    const pool = availableItems(RESEARCH_META.provisions, ref('ussr', 5, { stem: 'T-34' })).map(item => item.stem)
    expect(pool).not.toContain('ration')
    expect(pool).not.toContain('chocolate')
    expect(pool).toContain('regular_fuel')
  })
})
