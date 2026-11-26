import { describe, expect, it } from 'vitest'
import { lastKnownPoseAt, replacedBySuccessorAt } from './lastKnown.js'
import type { LastKnownPose } from './lastKnown.js'

const T_START = 5
const makePos = (n = 250): number[] =>
  Array.from({ length: n * 3 }, (_, k) => {
    const i = Math.floor(k / 3)
    return k % 3 === 0 ? i : k % 3 === 1 ? i * 10 : -i
  })

function posAt(i: number): [number, number, number] {
  return [i, i * 10, -i]
}

describe('lastKnownPoseAt — 在场时段', () => {
  it('t 在段内 → null（正常呈现，无幽灵）', () => {
    expect(lastKnownPoseAt([10, 20], 15, makePos(), T_START)).toBeNull()
  })

  it('段边界（t_in / t_out，闭区间）→ null', () => {
    expect(lastKnownPoseAt([10, 20], 10, makePos(), T_START)).toBeNull()
    expect(lastKnownPoseAt([10, 20], 20, makePos(), T_START)).toBeNull()
  })

  it('末段缺 t_out（+∞ = 战斗结束仍在场）→ 恒 null', () => {
    expect(lastKnownPoseAt([10, Number.POSITIVE_INFINITY], 500, makePos(), T_START)).toBeNull()
  })

  it('多段之一包含 t → null', () => {
    expect(lastKnownPoseAt([10, 20, 30, 40], 32, makePos(), T_START)).toBeNull()
  })
})

describe('lastKnownPoseAt — 不在场（最后已知）', () => {
  it('段间空隙 → 前段（最近一个已开始段）的段内末采样', () => {
    const result = lastKnownPoseAt([10, 20, 30, 40], 25, makePos(), T_START) as LastKnownPose
    expect(result.t).toBeCloseTo(20, 6)
    expect(result.pos).toEqual(posAt(150))
  })

  it('战斗尾声（晚于末段）→ 末段的段内末采样', () => {
    const result = lastKnownPoseAt([10, 20, 30, 40], 45, makePos(400), T_START) as LastKnownPose
    expect(result.t).toBeCloseTo(40, 6)
    expect(result.pos).toEqual(posAt(350))
  })

  it('候选段整段落在网格之后 → null（钳到末采样也在段外，不外推）', () => {
    const result = lastKnownPoseAt([10, 20, 30, 40], 45, makePos(250), T_START)
    expect(result).toBeNull()
  })

  it('段末晚于网格但网格更长 → 取段内真正的末采样', () => {
    const result = lastKnownPoseAt([10, 20], 45, makePos(400), T_START) as LastKnownPose
    expect(result.t).toBeCloseTo(20, 6)
    expect(result.pos).toEqual(posAt(150))
  })

  it('短段不足一个网格间隔且不含采样 → null（不拿段外采样顶替）', () => {
    const result = lastKnownPoseAt([12.34, 12.34], 15, makePos(), T_START)
    expect(result).toBeNull()
  })

  it('单段（无多段）的尾声同样取该段末采样', () => {
    const result = lastKnownPoseAt([10, 20], 25, makePos(), T_START) as LastKnownPose
    expect(result.t).toBeCloseTo(20, 6)
    expect(result.pos).toEqual(posAt(150))
  })
})

describe('lastKnownPoseAt — 无证据 / 畸形输入（fail-closed）', () => {
  it('无在场段 → null', () => {
    expect(lastKnownPoseAt([], 15, makePos(), T_START)).toBeNull()
  })

  it('空数组（spans 与 pos 均空）→ null', () => {
    expect(lastKnownPoseAt([], 15, [], T_START)).toBeNull()
    expect(lastKnownPoseAt([10, 20], 15, [], T_START)).toBeNull()
  })

  it('早于首段（从未被观测）→ null', () => {
    expect(lastKnownPoseAt([10, 20], 5, makePos(), T_START)).toBeNull()
  })

  it('pos 长度非 3 的倍数 / 不足一个采样 → null', () => {
    expect(lastKnownPoseAt([10, 20], 25, [1, 2, 3, 4], T_START)).toBeNull()
    expect(lastKnownPoseAt([10, 20], 25, [1, 2], T_START)).toBeNull()
  })

  it('段末早于网格起点（该段无采样证据）→ null，不拿段外采样顶替', () => {
    expect(lastKnownPoseAt([0, 2], 15, makePos(), T_START)).toBeNull()
  })

  it('非有限 t / tStart / null spans → null', () => {
    expect(lastKnownPoseAt([10, 20], Number.NaN, makePos(), T_START)).toBeNull()
    expect(lastKnownPoseAt([10, 20], 15, makePos(), Number.NaN)).toBeNull()
    expect(lastKnownPoseAt(null, 15, makePos(), T_START)).toBeNull()
    expect(lastKnownPoseAt(undefined, 15, makePos(), T_START)).toBeNull()
  })

  it('畸形段（起点非有限）被跳过：全部畸形 → null', () => {
    expect(lastKnownPoseAt([Number.NaN, 20], 25, makePos(), T_START)).toBeNull()
  })
})

describe('replacedBySuccessorAt — 同账号后继实体（身份 + 当前时刻，非统计）', () => {
  const vehicles = [
    { eid: 42, account_id: 7 },
    { eid: 49, account_id: 7 },
    { eid: 50, account_id: 8 },
  ]
  const spans = new Map<number, number[]>([
    [42, [10, 48]],
    [49, [49, 51]],
    [50, [10, 60]],
  ])
  const spansOf = (eid: number) => spans.get(eid)

  it('接管时刻之后 → true（幽灵抑制）；接管前 → false（保留最后已知，倒带恢复）', () => {
    expect(replacedBySuccessorAt(vehicles, spansOf, 42, 49.5)).toBe(true)
    expect(replacedBySuccessorAt(vehicles, spansOf, 42, 48.5)).toBe(false)
    expect(replacedBySuccessorAt(vehicles, spansOf, 42, 20)).toBe(false)
  })

  it('后继实体自身不被判替换', () => {
    expect(replacedBySuccessorAt(vehicles, spansOf, 49, 50)).toBe(false)
  })

  it('后继实体尚未入场时不隐藏旧实体（[42,48] vs [60,70]，T=50）', () => {
    const v2 = [{ eid: 1, account_id: 9 }, { eid: 2, account_id: 9 }]
    const sp = new Map([[1, [42, 48]], [2, [60, 70]]])
    expect(replacedBySuccessorAt(v2, (e) => sp.get(e), 1, 50)).toBe(false)
    expect(replacedBySuccessorAt(v2, (e) => sp.get(e), 1, 60)).toBe(true)
  })

  it('不同账号 / 无账号 / 无段 / 非有限时刻时 fail-closed 为 false', () => {
    expect(replacedBySuccessorAt(vehicles, spansOf, 50, 60)).toBe(false)
    expect(replacedBySuccessorAt([{ eid: 60 }], () => [1, 2], 60, 5)).toBe(false)
    expect(replacedBySuccessorAt(vehicles, () => null, 42, 60)).toBe(false)
    expect(replacedBySuccessorAt(vehicles, spansOf, 42, Number.NaN)).toBe(false)
  })
})
