import { describe, it, expect } from 'vitest'
import { impactKind } from './impactKind.js'

const shot = (o) => ({ target_eid: 7, ...o })

describe('impactKind（弹着结果不得靠视觉猜）', () => {
  it('无 target_eid → null：脱靶或目标未知时不伪造弹着', () => {
    expect(impactKind({ target_eid: null })).toBeNull()
    expect(impactKind({})).toBeNull()
  })

  it('作者路径按 hit_flags 位判定（服务器逐发权威）', () => {
    expect(impactKind(shot({ is_author: true, hit_flags: 0x0008 }))).toBe('ricochet')
    for (const b of [0x0010, 0x0040, 0x0100, 0x1000]) {
      expect(impactKind(shot({ is_author: true, hit_flags: b }))).toBe('pen')
    }
    expect(impactKind(shot({ is_author: true, hit_flags: 0x0020 }))).toBe('nonpen')   // 未击穿位
    // 跳弹位优先于击穿位
    expect(impactKind(shot({ is_author: true, hit_flags: 0x0008 | 0x0010 }))).toBe('ricochet')
  })

  it('作者路径无 hit_flags 位 → 退化到 game_hit_result', () => {
    expect(impactKind(shot({ is_author: true, hit_flags: 0, game_hit_result: 3 }))).toBe('pen')
    expect(impactKind(shot({ is_author: true, hit_flags: 0, game_hit_result: 1 }))).toBe('nonpen')
  })

  it('非作者路径：game_hit_result 枚举里没有跳弹——1/2 必须 nonpen，绝不伪装 ricochet', () => {
    // 枚举：0=无 1=未击穿 2=间隙止 3=有伤害 4=履带/模块 255=未获取
    expect(impactKind(shot({ is_author: false, game_hit_result: 3 }))).toBe('pen')
    expect(impactKind(shot({ is_author: false, game_hit_result: 1 }))).toBe('nonpen')
    expect(impactKind(shot({ is_author: false, game_hit_result: 2 }))).toBe('nonpen')
    expect(impactKind(shot({ is_author: false, game_hit_result: 4 }))).toBe('nonpen')
    for (const r of [0, 5, 255, undefined]) {
      expect(impactKind(shot({ is_author: false, game_hit_result: r }))).toBeNull()
    }
  })

  it('非作者路径在任何枚举值下都不得产出 ricochet（回归：1/2 原被误判为跳弹）', () => {
    for (const r of [0, 1, 2, 3, 4, 5, 255]) {
      expect(impactKind(shot({ is_author: false, game_hit_result: r }))).not.toBe('ricochet')
    }
  })
})
