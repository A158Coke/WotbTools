import { describe, it, expect } from 'vitest'
import { attachChainToWheels, chainSpanBoundaries, solveChain } from './suspension.ts'





function makeLoop() {
  const pts = []
  for (let i = 0; i <= 6; i++) pts.push([-3 + i, 0])
  pts.push([3.4, 0.3], [3.6, 0.7])
  for (let i = 0; i <= 6; i++) pts.push([3.6 - i * 0.9, 1.0])
  pts.push([-3.2, 0.6], [-3.1, 0.2])
  return pts
}

describe('链路解算：三步顺序与方向性（逐轮偏移 → 垂弧 → 铺地）', () => {
  const chain = makeLoop()
  const wheels = [
    { longitudinal: -2.0, centerZ: 0.25, radius: 0.3 },
    { longitudinal: 0.0, centerZ: 0.25, radius: 0.3 },
    { longitudinal: 2.0, centerZ: 0.25, radius: 0.3 },
  ]
  const attach = attachChainToWheels(chain, wheels)
  const zeros = [0, 0, 0]

  it('挂接：只挂底段的近轮点；同纵向的上段点不挂（高度消歧）', () => {
    expect(attach[1]).toBe(0)
    expect(attach[3]).toBe(1)
    expect(attach[5]).toBe(2)
    const upperIdx = 9 + 3
    expect(chain[upperIdx][1]).toBe(1.0)
    expect(attach[9 + 4]).toBe(-1)
  })

  it('逐轮偏移：挂接点随轮移动（含负向）—— 地面在下方，允许下垂', () => {
    const out = new Float64Array(chain.length)
    solveChain(out, chain, attach, [-0.1, 0, 0.2], new Array(chain.length).fill(-1),
               wheels, { upper_factor: 0, length_power: 0.5 })
    expect(out[1]).toBeCloseTo(-0.1, 9)
    expect(out[3]).toBeCloseTo(0, 9)
    expect(out[5]).toBeCloseTo(0.2, 9)
  })

  it('铺地只抬不压：地面在下方（drop<0）时履带保持原高度（悬空）', () => {
    const out = new Float64Array(chain.length)
    const up = new Array(chain.length).fill(0.05)
    const down = new Array(chain.length).fill(-0.5)
    solveChain(out, chain, attach, zeros, up, wheels, { upper_factor: 0, length_power: 0.5 })
    expect(out[3]).toBeCloseTo(0.05, 9)
    solveChain(out, chain, attach, zeros, down, wheels, { upper_factor: 0, length_power: 0.5 })
    expect(out[3]).toBeCloseTo(0, 9)
  })

  it('垂弧：支承点之间向下垂，峰在跨度中点、幅度 = upperFactor·span^lengthPower/4', () => {
    const out = new Float64Array(chain.length)
    const bend = { upper_factor: 0.4, length_power: 1.0 }
    solveChain(out, chain, attach, zeros, new Array(chain.length).fill(-1), wheels, bend)
    const expectedSag = 0.4 * Math.pow(2, 1.0) * (0.5 - 0.25)
    expect(out[2]).toBeCloseTo(-expectedSag, 9)
    expect(out[1]).toBeCloseTo(0, 9)
    expect(out[3]).toBeCloseTo(0, 9)
  })

  it('包轮约束只作用于轮顶以上：底段（轮心以下）不被顶到轮顶', () => {
    const out = new Float64Array(chain.length)
    solveChain(out, chain, attach, [-0.3, -0.3, -0.3], new Array(chain.length).fill(-1), wheels,
               { upper_factor: 0, length_power: 0.5 })
    expect(out[1]).toBeLessThan(0)
    expect(out[3]).toBeLessThan(0)
  })
})



describe('60TP（7297）履带塌陷回归：支承点按客户端 chain flag 建表', () => {
  const CHAIN = [
    [-2.46, 0.0, 1], [-2.39, 0.0, 1], [-1.45, 0.0, 1], [-0.5, 0.0, 1],
    [0.45, 0.0, 1], [1.4, 0.0, 1], [2.4, 0.0, 1], [2.54, 0.01, 1],
    [2.65, 0.08, 0], [2.81, 0.15, 0], [2.97, 0.23, 0], [3.13, 0.31, 0],
    [3.47, 0.47, 1], [3.54, 0.56, 1], [3.6, 0.75, 1], [3.56, 0.94, 1],
    [3.43, 1.09, 1], [3.24, 1.14, 1], [3.06, 1.14, 0], [2.88, 1.14, 0],
    [2.71, 1.14, 0], [2.53, 1.14, 0], [2.36, 1.14, 0], [2.18, 1.14, 0],
    [2.01, 1.14, 1], [1.83, 1.14, 1], [1.66, 1.14, 0], [1.48, 1.14, 0],
    [1.3, 1.14, 0], [1.13, 1.14, 0], [0.95, 1.14, 0], [0.78, 1.14, 0],
    [0.6, 1.14, 0], [0.43, 1.14, 0], [0.25, 1.13, 0], [0.07, 1.13, 1],
    [-0.1, 1.13, 1], [-0.28, 1.13, 0], [-0.45, 1.13, 0], [-0.63, 1.13, 0],
    [-0.8, 1.13, 0], [-0.98, 1.13, 0], [-1.16, 1.13, 0], [-1.33, 1.13, 0],
    [-1.51, 1.13, 0], [-1.68, 1.13, 0], [-1.86, 1.13, 1], [-2.03, 1.13, 1],
    [-2.21, 1.13, 0], [-2.39, 1.13, 0], [-2.56, 1.13, 0], [-2.74, 1.13, 0],
    [-2.91, 1.13, 0], [-3.19, 1.13, 1], [-3.42, 1.06, 1], [-3.58, 0.88, 1],
    [-3.63, 0.64, 1], [-3.54, 0.42, 1], [-3.34, 0.27, 1], [-3.17, 0.22, 0],
    [-3.0, 0.17, 0], [-2.83, 0.12, 0], [-2.67, 0.07, 0],
  ]
  const flags = CHAIN.map((p) => p[2])
  const chain = CHAIN.map(([x, z]) => [x, z])
  const wheels = [
    { longitudinal: 3.24, centerZ: 0.77, radius: 0.252 },
    { longitudinal: 2.4, centerZ: 0.45, radius: 0.35 },
    { longitudinal: 1.86, centerZ: 0.89, radius: 0.14 },
    { longitudinal: 1.4, centerZ: 0.45, radius: 0.35 },
    { longitudinal: 0.45, centerZ: 0.45, radius: 0.35 },
    { longitudinal: -0.05, centerZ: 0.89, radius: 0.14 },
    { longitudinal: -0.5, centerZ: 0.45, radius: 0.35 },
    { longitudinal: -1.45, centerZ: 0.45, radius: 0.35 },
    { longitudinal: -1.94, centerZ: 0.89, radius: 0.14 },
    { longitudinal: -2.39, centerZ: 0.45, radius: 0.35 },
    { longitudinal: -3.19, centerZ: 0.69, radius: 0.407 },   // 前端导向轮
  ]
  const zeros = new Array(chain.length).fill(0)
  const bend = { upper_factor: 0.19214, length_power: 0.5 }
  const sagPeak = (span) => bend.upper_factor * Math.pow(Math.max(span, 1e-3), bend.length_power) / 4
  const attach = attachChainToWheels(chain, wheels)
  const spans = chainSpanBoundaries(attach, flags)
  const solve = (attachTable) => {
    const out = new Float64Array(chain.length)
    solveChain(out, chain, attachTable, new Array(wheels.length).fill(0), zeros, wheels, bend, spans)
    return out
  }

  it('flag 只作分段：零行程 + 零贴地 ⇒ 逐点偏离不超过所属跨距的垂弧峰值', () => {
    const out = solve(attach)
    let checked = 0
    for (let s = 0; s + 1 < spans.length; s++) {
      const i = spans[s], j = spans[s + 1]
      const limit = sagPeak(Math.abs(chain[j][0] - chain[i][0]))
      for (let k = i + 1; k < j; k++) {
        const dev = out[k] - chain[k][1]
        expect(dev).toBeLessThanOrEqual(limit + 1e-9)
        expect(dev).toBeGreaterThanOrEqual(-limit - 1e-9)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('三对托带轮点（24/25、35/36、46/47）是**分段边界**，但不挂轮（几何上确实没贴轮缘）', () => {
    for (const i of [24, 25, 35, 36, 46, 47]) {
      expect(attach[i]).toBe(-1)
      expect(spans).toContain(i)
    }
    for (const i of [0, 2, 4, 6, 55, 58]) expect(attach[i]).toBeGreaterThanOrEqual(0)
    for (const i of [18, 20, 26, 30, 37, 41, 48]) expect(attach[i]).toBe(-1)
  })

  it('边界 = 挂接点 ∪ flag 点：历史跨距只会被切细，绝不合并', () => {
    const attachedOnly = chainSpanBoundaries(attach, null)
    for (const i of attachedOnly ?? []) expect(spans).toContain(i)
    expect(spans.length).toBeGreaterThanOrEqual(attachedOnly.length)
  })

  it('flag 列任一非 0/1 值 ⇒ 整列不参与分段（含中段/末段：不得留下半列边界）', () => {
    const attachedOnly = chainSpanBoundaries(attach, null)
    for (const badAt of [0, 24, 48, 62]) {
      const bogus = flags.slice()
      bogus[badAt] = 7
      expect(chainSpanBoundaries(attach, bogus), `非法值在 idx ${badAt}`).toEqual(attachedOnly)
    }
    for (const badAt of [0, 48, 62]) {
      const holes = flags.slice()
      holes[badAt] = NaN
      expect(chainSpanBoundaries(attach, holes), `缺列在 idx ${badAt}`).toEqual(attachedOnly)
    }
    expect(chainSpanBoundaries(attach, flags.slice(0, flags.length - 1))).toEqual(attachedOnly)
  })

  it('最小反例（评审给出）：非法值出现在已加入 1 之后也不得残留边界', () => {
    const tinyAttach = [0, -1, -1, -1, 1]
    expect(chainSpanBoundaries(tinyAttach, [0, 1, 0, 7, 0])).toEqual([0, 4])
    expect(chainSpanBoundaries(tinyAttach, [0, 1, 0, NaN, 0])).toEqual([0, 4])
    expect(chainSpanBoundaries(tinyAttach, [0, 1, 0, 0, 0])).toEqual([0, 1, 4])
  })
})



describe('VK 30.02 (M)（15889）支承点必须挂轮缘最近的轮，而非纵向最近的轮', () => {
  const CHAIN = [
    [-1.9874, 0.0152, 1], [-1.3914, 0.0152, 1], [-0.8339, 0.0152, 1],
    [-0.2716, 0.0152, 1], [0.286, 0.0152, 1], [0.8482, 0.0152, 1],
    [1.4058, 0.0152, 1], [1.987, 0.0152, 1], [2.193, 0.0391, 1],
    [2.4365, 0.1726, 0], [2.577, 0.2532, 0], [2.7175, 0.3338, 0],
    [3.0104, 0.5133, 1], [3.162, 0.7305, 1], [3.14, 1.0206, 1],
    [2.9961, 1.22, 1], [2.7838, 1.2853, 1], [2.6219, 1.2785, 1],
    [2.4601, 1.2717, 0], [2.2983, 1.2648, 0], [2.1364, 1.258, 0],
    [1.9746, 1.2512, 0], [1.8128, 1.2443, 0], [1.6509, 1.2375, 0],
    [1.4891, 1.2307, 0], [1.3273, 1.2238, 0], [1.1654, 1.217, 0],
    [1.0036, 1.2102, 0], [0.8418, 1.2033, 0], [0.6799, 1.1965, 0],
    [0.5181, 1.1897, 0], [0.3563, 1.1828, 0], [0.1944, 1.176, 0],
    [0.0326, 1.1691, 0], [-0.1293, 1.1623, 0], [-0.2911, 1.1555, 0],
    [-0.4529, 1.1486, 0], [-0.6148, 1.1418, 0], [-0.7766, 1.135, 0],
    [-0.9384, 1.1281, 0], [-1.1003, 1.1213, 0], [-1.2621, 1.1145, 0],
    [-1.4239, 1.1077, 0], [-1.5858, 1.1008, 0], [-1.7476, 1.094, 0],
    [-1.9094, 1.0871, 0], [-2.0713, 1.0803, 0], [-2.2331, 1.0735, 0],
    [-2.5538, 1.0472, 1], [-2.7277, 1.0319, 1], [-2.892, 0.9124, 1],
    [-2.9724, 0.7, 1], [-2.9326, 0.5127, 1], [-2.798, 0.3608, 1],
    [-2.6009, 0.2529, 0], [-2.4557, 0.1811, 0], [-2.0945, 0.0228, 1],
  ]
  const flags = CHAIN.map((p) => p[2])
  const chain = CHAIN.map(([x, z]) => [x, z])
  const wheels = [
    { longitudinal: 2.7352, centerZ: 0.8347, radius: 0.4045 },
    { longitudinal: 2.394, centerZ: 0.987, radius: 0.1261 },
    { longitudinal: 1.968, centerZ: 0.5014, radius: 0.4499 },
    { longitudinal: 1.4058, centerZ: 0.5014, radius: 0.44 },
    { longitudinal: 0.8482, centerZ: 0.5014, radius: 0.4499 },
    { longitudinal: 0.286, centerZ: 0.5014, radius: 0.44 },
    { longitudinal: -0.2716, centerZ: 0.5014, radius: 0.4499 },
    { longitudinal: -0.8339, centerZ: 0.5014, radius: 0.44 },
    { longitudinal: -1.3914, centerZ: 0.5014, radius: 0.4499 },
    { longitudinal: -1.9537, centerZ: 0.5014, radius: 0.44 },
    { longitudinal: -2.5829, centerZ: 0.6592, radius: 0.293 },   // 10: L_11 后驱动轮
  ]
  const bend = { upper_factor: 0.62882, length_power: 0.61261 }

  it('底段 idx 8 挂在负重轮 L_03（索引 2），不是纵向更近的托带轮 L_02（索引 1）', () => {
    const attach = attachChainToWheels(chain, wheels)
    expect(attach[8]).toBe(2)
    const dLong = (w) => Math.abs(chain[8][0] - wheels[w].longitudinal)
    expect(dLong(1)).toBeLessThan(dLong(2))
  })

  it('负重轮压缩 0.06 m 时，底段支承点跟着上移（不被固定托带轮钉住）', () => {
    const attach = attachChainToWheels(chain, wheels)
    const delta = new Array(wheels.length).fill(0)
    delta[2] = 0.06
    const out = new Float64Array(chain.length)
    solveChain(out, chain, attach, delta, new Array(chain.length).fill(0), wheels, bend)
    expect(out[8] - chain[8][1]).toBeCloseTo(0.06, 9)
    expect(out[7] - chain[7][1]).toBeCloseTo(0.06, 9)
  })
})
