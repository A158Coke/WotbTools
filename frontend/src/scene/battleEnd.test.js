import { describe, expect, it } from 'vitest'
import { battleEndTime } from './battleEnd.js'

const meta = { t_start: 12, duration: 400 }

describe('battleEndTime', () => {
  it('终点取进入战后阶段（period 4）的时刻', () => {
    const periods = [{ clock: 0, period: 1 }, { clock: 12, period: 2 }, { clock: 42, period: 3 }, { clock: 230, period: 4 }]
    expect(battleEndTime({ meta, periods })).toBe(230)
  })

  it('没有战后阶段时退回录像结束', () => {
    expect(battleEndTime({ meta, periods: [{ clock: 42, period: 3 }] })).toBe(400)
    expect(battleEndTime({ meta })).toBe(400)
  })

  it('战后阶段晚于录像结束时不越界；早于起点的条目忽略', () => {
    expect(battleEndTime({ meta, periods: [{ clock: 450, period: 4 }] })).toBe(400)
    expect(battleEndTime({ meta, periods: [{ clock: 5, period: 4 }, { clock: 300, period: 4 }] })).toBe(300)
  })
})
