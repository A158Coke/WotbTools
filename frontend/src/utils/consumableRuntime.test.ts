import { describe, expect, it } from 'vitest'
import type { AgentConsumableEvent } from '../api/agent-replay-facets.js'
import type { ConsumableTransition } from '../types/playback-v2.js'
import { consumableRuntimeAt, type ConsumableInput } from './consumableRuntime.js'

const facetEvent: AgentConsumableEvent = {
  clock: 10,
  eid: 7,
  wire_code: 3,
  state: 2,
  state_name: 'ACTIVATED',
  duration_s: 30,
  ends_at: 40,
  slot: 1,
  body_clock: 10,
  param: 0,
}

describe('consumableRuntimeAt input shapes', () => {
  it('reads a raw facet event through the shared normalization', () => {
    expect(consumableRuntimeAt([facetEvent], 25)).toMatchObject([{ slot: 1, remainingSec: 15, durationSec: 30 }])
  })
})

// 只做编译期证明，从不运行。48110a4ca 的缺陷是把 3D 的 facet 事件当 canonical 读字段，
// 字段名不匹配导致徽标永远为空；这些写法现在都必须编译失败。
export function consumableTypeProofs(input: ConsumableInput, canonical: ConsumableTransition) {
  // @ts-expect-error facet 事件没有 canonical 的 timeSec
  void facetEvent.timeSec
  // @ts-expect-error facet 事件不能当作 canonical transition 使用
  const asCanonical: ConsumableTransition = facetEvent
  // @ts-expect-error 联合输入未归一化前不能读取只属于一种形状的字段
  void input.timeSec
  // @ts-expect-error canonical transition 没有 facet 的 clock
  void canonical.clock
  // @ts-expect-error 缺少时间字段的对象不是任何一种合法输入
  consumableRuntimeAt([{ slot: 1 }], 0)
  return asCanonical
}
