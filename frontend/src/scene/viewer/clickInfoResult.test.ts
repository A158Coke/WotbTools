// 点选卡「结果」列的结果码推导（纯函数）：整体 ERROR 优先于首层布尔值。
// 反例来源：HE 爆炸半径缺失 / 溅射采样失败 → penetration.js 返回 result:'ERROR' 与零伤害，
// 但仍保留带 penetrated 的几何层；直接读首层会把「判定不可用」显示成绿色"击穿"。
import { describe, expect, it } from 'vitest'
import { clickInfoResultCode } from './judgment.ts'

describe('clickInfoResultCode', () => {
  it('整体 ERROR 优先：即使首层 penetrated=true 也返回 ERROR', () => {
    expect(clickInfoResultCode('ERROR', { penetrated: true, ricochet: false })).toBe('ERROR')
    expect(clickInfoResultCode('ERROR', { penetrated: false })).toBe('ERROR')
    expect(clickInfoResultCode('ERROR', null)).toBe('ERROR')
  })

  it('正常判定按首层结果映射', () => {
    expect(clickInfoResultCode('PENETRATION', { penetrated: true })).toBe('PENETRATION')
    expect(clickInfoResultCode('BLOCKED', { penetrated: false })).toBe('BLOCKED')
    expect(clickInfoResultCode('RICOCHET', { penetrated: false, ricochet: true })).toBe('RICOCHET')
  })

  it('首层缺失时按阻挡处理（不猜击穿）', () => {
    expect(clickInfoResultCode('BLOCKED', null)).toBe('BLOCKED')
    expect(clickInfoResultCode(undefined, undefined)).toBe('BLOCKED')
  })
})
