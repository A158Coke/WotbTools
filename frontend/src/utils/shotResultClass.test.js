import { describe, expect, it } from 'vitest'
import { shotResultClass } from './shotResultClass.js'

const shot = (over = {}) => ({
  target_eid: 7,
  target_name: 'Target',
  hit_flags: 0,
  damage: 0,
  game_hit_result: 255,
  ...over,
})

describe('shotResultClass · 服务器结果枚举', () => {
  it('result=4 = raw（语义未定），不映射跳弹/履带/击穿', () => {
    expect(shotResultClass(shot({ game_hit_result: 4, damage: 0 }))).toBe('UNVERIFIED')
    // 带伤也不能仅凭 damage>0 伪造成击穿；4 的语义仍未被证伪/证实
    expect(shotResultClass(shot({ game_hit_result: 4, damage: 569 }))).toBe('UNVERIFIED')
  })

  it('result=1/2 = 未穿，3 = 击穿', () => {
    expect(shotResultClass(shot({ game_hit_result: 1 }))).toBe('NO PENETRATION')
    expect(shotResultClass(shot({ game_hit_result: 2 }))).toBe('NO PENETRATION')
    expect(shotResultClass(shot({ game_hit_result: 3, damage: 400 }))).toBe('PENETRATION')
  })

  it('result=0/255 = 服务器未通知；damage>0 只能证明有伤，不得反推 PEN', () => {
    expect(shotResultClass(shot({ game_hit_result: 0, damage: 0 }))).toBe('HIT')
    expect(shotResultClass(shot({ game_hit_result: 0, damage: 500 }))).toBe('HIT')
    expect(shotResultClass(shot({ game_hit_result: 255, damage: 0 }))).toBe('HIT')
    expect(shotResultClass(shot({ game_hit_result: 255, damage: 500 }))).toBe('HIT')
  })

  it('无目标 = MISS；target_eid 在案（名字缺失）仍算命中', () => {
    expect(shotResultClass(shot({ target_eid: null, target_name: '' }))).toBe('MISS')
    expect(shotResultClass(shot({ target_eid: 7, target_name: '' }))).toBe('HIT')
  })
})

describe('shotResultClass · 作者位图优先', () => {
  it('HE / 材料击穿 / 跳弹 / 其余未穿', () => {
    expect(shotResultClass(shot({ hit_flags: 0x1000, game_hit_result: 4, damage: 500 }))).toBe('HE BLAST')
    expect(shotResultClass(shot({ hit_flags: 0x0010, game_hit_result: 3, damage: 500 }))).toBe('PENETRATION')
    expect(shotResultClass(shot({ hit_flags: 0x0008, game_hit_result: 0, damage: 0 }))).toBe('RICOCHET')
    expect(shotResultClass(shot({ hit_flags: 0x0020, game_hit_result: 0, damage: 0 }))).toBe('NO PENETRATION')
  })

  it('result=4 + 位图：位图优先（击穿位 = 击穿；未穿位 = 未穿）', () => {
    expect(shotResultClass(shot({ hit_flags: 0x0010, game_hit_result: 4, damage: 569 }))).toBe('PENETRATION')
    expect(shotResultClass(shot({ hit_flags: 0x0020, game_hit_result: 4, damage: 0 }))).toBe('NO PENETRATION')
  })
})
