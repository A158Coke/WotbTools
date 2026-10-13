import { describe, expect, it } from 'vitest'

import {
  ARMOR_STATES,
  dynamicArmorDeclaration,
  parseArmorRef,
  activePlateSet,
  controllablePlateSet,
  defaultStateId,
  stateAtTime
} from './armorStates.js'

describe('armorStates 声明与纯函数助手', () => {
  it('全表形状守恒：6 车、每车 ≥2 态、id 唯一、恰一态 default、armors 全部可解析', () => {
    const entries = Object.entries(ARMOR_STATES)
    expect(entries).toHaveLength(6)
    for (const [stem, decl] of entries) {
      expect(stem).toMatch(/^Oth\d{2}_/)
      expect(decl.states.length).toBeGreaterThanOrEqual(2)
      const ids = decl.states.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(decl.states.filter((s) => s.default)).toHaveLength(1)
      for (const s of decl.states) {
        expect(s.armors.length).toBeGreaterThan(0)
        for (const ref of s.armors) expect(parseArmorRef(ref)).not.toBeNull()
      }
    }
  })

  it('dynamicArmorDeclaration：stem 大小写不敏感，非动态车 null', () => {
    expect(dynamicArmorDeclaration('Oth71_Titan_Strife')?.states).toHaveLength(2)
    expect(dynamicArmorDeclaration('oth71_titan_strife')?.states).toHaveLength(2)
    expect(dynamicArmorDeclaration('E-100')).toBeNull()
    expect(dynamicArmorDeclaration('')).toBeNull()
    expect(dynamicArmorDeclaration(null)).toBeNull()
  })

  it('parseArmorRef：部位序号剥离（gun_01→gun / turret_01→turret），未知部位 null', () => {
    expect(parseArmorRef('hull.armor_10')).toEqual({ section: 'hull', plateId: '10' })
    expect(parseArmorRef('gun_01.armor_11')).toEqual({ section: 'gun', plateId: '11' })
    expect(parseArmorRef('turret_01.armor_12')).toEqual({ section: 'turret', plateId: '12' })
    expect(parseArmorRef('chassis.armor_1')).toBeNull()
    expect(parseArmorRef('')).toBeNull()
  })

  it('Oth71 两态的激活板集与可控板集（枪盾/车体盾互斥切换）', () => {
    const decl = dynamicArmorDeclaration('Oth71_Titan_Strife')
    expect([...activePlateSet(decl, 0)].sort()).toEqual(['gun:11', 'hull:11'])
    expect([...activePlateSet(decl, 1)].sort()).toEqual(['gun:10', 'hull:10'])
    expect([...controllablePlateSet(decl)].sort()).toEqual(['gun:10', 'gun:11', 'hull:10', 'hull:11'])
  })

  it('Charioteer_T 态 1 引入 turret 板（跨部位可控集并集）', () => {
    const decl = dynamicArmorDeclaration('Oth44_Charioteer_T')
    expect([...activePlateSet(decl, 1)].sort()).toEqual(['hull:13', 'hull:15', 'turret:12'])
    expect(controllablePlateSet(decl).has('turret:12')).toBe(true)
  })

  it('defaultStateId：取 default:true 的 state', () => {
    expect(defaultStateId(dynamicArmorDeclaration('Oth71_Titan_Strife'))).toBe(0)
  })

  it('stateAtTime：首样本前=初态；≤t 最近更新生效；非法状态值被门控丢弃', () => {
    const decl = dynamicArmorDeclaration('Oth71_Titan_Strife')
    const timeline = { t: [10, 20, 30], state: [1, 0, 1] }
    expect(stateAtTime(decl, timeline, 5)).toBe(0)
    expect(stateAtTime(decl, timeline, 10)).toBe(1)
    expect(stateAtTime(decl, timeline, 10.5)).toBe(1)
    expect(stateAtTime(decl, timeline, 25)).toBe(0)
    expect(stateAtTime(decl, timeline, 99)).toBe(1)
    // 非法状态值（∉ 声明集）丢弃——门控语义与消费端一致
    const noisy = { t: [10, 20], state: [7, 1] }
    expect(stateAtTime(decl, noisy, 15)).toBe(0)
    expect(stateAtTime(decl, noisy, 25)).toBe(1)
  })

  it('stateAtTime：时间线形状无效 → 初态（fail-closed）', () => {
    const decl = dynamicArmorDeclaration('Oth71_Titan_Strife')
    expect(stateAtTime(decl, null, 10)).toBe(0)
    expect(stateAtTime(decl, {}, 10)).toBe(0)
    expect(stateAtTime(decl, { t: 'x', state: [] }, 10)).toBe(0)
  })
})
