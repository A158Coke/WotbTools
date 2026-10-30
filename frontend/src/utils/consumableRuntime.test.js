import { describe, expect, it } from 'vitest'
import { consumableRuntimeAt, createConsumableStateResolver } from './consumableRuntime.js'

const tr = (over = {}) => ({
  timeSec: 0,
  consumableSlot: 0,
  logicalItemId: null,
  wireCode: 0,
  state: 'INITIALIZED',
  durationSec: null,
  endsAt: null,
  everActivated: false,
  invalidation: false,
  ...over,
})

const activeAt10 = (over = {}) => tr({
  timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: 30,
  wireCode: 0x09, logicalItemId: 'ADRENALINE', everActivated: true, ...over,
})

describe('consumableRuntimeAt', () => {
  it('激活窗口内：按 endsAt 计算剩余秒数', () => {
    const transitions = [
      tr({ timeSec: 0, wireCode: 0x09, logicalItemId: 'ADRENALINE' }),
      activeAt10(),
    ]
    expect(consumableRuntimeAt(transitions, 20)).toEqual([{
      slot: 0, logicalItemId: 'ADRENALINE', wireCode: 0x09, remainingSec: 10, durationSec: 20,
    }])
    expect(consumableRuntimeAt(transitions, 9)).toEqual([])
  })

  it('激活结束后（冷却/已就绪）不再展示——HUD 只表达正在生效', () => {
    const active = activeAt10()
    const cooldown = tr({
      timeSec: 30, state: 'ACTIVE_ENDED_OR_COOLDOWN', durationSec: 60, endsAt: 90,
      wireCode: 0x09, logicalItemId: 'ADRENALINE', everActivated: true,
    })
    expect(consumableRuntimeAt([active], 30)).toEqual([])
    expect(consumableRuntimeAt([active, cooldown], 40)).toEqual([])
    const ready = tr({ timeSec: 50, state: 'INITIALIZED', wireCode: 0x09, logicalItemId: 'ADRENALINE' })
    expect(consumableRuntimeAt([active, cooldown, ready], 60)).toEqual([])
  })

  it('瞬发消耗品不进入 HUD（duration=0；其冷却也不展示）', () => {
    const transitions = [
      tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 0, endsAt: 10, logicalItemId: 'REPAIR_KIT', wireCode: 0x0D, everActivated: true }),
      tr({ timeSec: 10, state: 'ACTIVE_ENDED_OR_COOLDOWN', durationSec: 60, endsAt: 70, logicalItemId: 'REPAIR_KIT', wireCode: 0x0D, everActivated: true }),
    ]
    expect(consumableRuntimeAt(transitions, 10)).toEqual([])
    expect(consumableRuntimeAt(transitions, 40)).toEqual([])
  })

  it('invalidation 清空全部槽位（AoI 关闭不保留旧状态）', () => {
    const transitions = [
      activeAt10(),
      tr({ timeSec: 20, state: 'UNKNOWN', invalidation: true, consumableSlot: null }),
    ]
    expect(consumableRuntimeAt(transitions, 21)).toEqual([])
  })

  it('旧产物缺 endsAt 时回退 timeSec + durationSec', () => {
    expect(consumableRuntimeAt([activeAt10({ endsAt: null })], 20)[0])
      .toMatchObject({ remainingSec: 10, durationSec: 20 })
  })

  it('since 起点忽略窗口前历史：AoI 重入不复用离开前的状态', () => {
    const active = activeAt10()
    expect(consumableRuntimeAt([active], 20, 5)).toHaveLength(1)
    expect(consumableRuntimeAt([active], 20, 15)).toEqual([])
    // 重入后新事件仍可用
    const fresh = tr({
      timeSec: 22, state: 'ACTIVATED', durationSec: 20, endsAt: 42,
      wireCode: 0x09, logicalItemId: 'ADRENALINE', everActivated: true,
    })
    expect(consumableRuntimeAt([active, fresh], 25, 21)[0]).toMatchObject({ remainingSec: 17 })
  })

  it('按槽位升序输出，最多三个槽位', () => {
    const transitions = [
      activeAt10({ consumableSlot: 2, logicalItemId: 'ADRENALINE' }),
      activeAt10({ consumableSlot: 0, logicalItemId: 'ENGINE_POWER_BOOST' }),
    ]
    expect(consumableRuntimeAt(transitions, 20).map((x) => x.slot)).toEqual([0, 2])
  })

  it('createConsumableStateResolver 按 eid 分组，互不串车', () => {
    const resolve = createConsumableStateResolver({
      consumables: [
        activeAt10({ eid: 1, logicalItemId: 'ADRENALINE' }),
        activeAt10({ eid: 2, durationSec: 5, endsAt: 15, logicalItemId: 'RETICLE_CALIBRATION' }),
      ],
    })
    expect(resolve(1, 20).map((x) => x.logicalItemId)).toEqual(['ADRENALINE'])
    expect(resolve(2, 12).map((x) => x.logicalItemId)).toEqual(['RETICLE_CALIBRATION'])
    expect(resolve(2, 20)).toEqual([])
    expect(resolve(3, 20)).toEqual([])
  })

  it('接受 3D facet 原始事件形状（clock/state_name/duration_s/ends_at/slot/logical_item_id）', () => {
    // 3D 场景直接消费 Playback facet（snake_case、state 为数字），3D 的 T 与 clock 同 base；
    // 字段名不匹配曾导致 3D 徽标静默全空。
    const raw = (over = {}) => ({
      clock: 0, eid: 1, wire_code: 9, state: 1, state_name: 'INITIALIZED',
      duration_s: null, ends_at: null, ever_activated: false, slot: 0, logical_item_id: null,
      ...over,
    })
    const events = [
      raw({ state: 2, state_name: 'ACTIVATED', clock: 10, duration_s: 20, ends_at: 30, ever_activated: true, logical_item_id: 'ADRENALINE' }),
      raw({ state: 3, state_name: 'ACTIVE_ENDED_OR_COOLDOWN', clock: 30, duration_s: 60, ends_at: 90, ever_activated: true, logical_item_id: 'ADRENALINE' }),
    ]
    expect(consumableRuntimeAt(events, 20)).toEqual([{
      slot: 0, logicalItemId: 'ADRENALINE', wireCode: 9, remainingSec: 10, durationSec: 20,
    }])
    expect(consumableRuntimeAt(events, 40)).toEqual([])
    expect(consumableRuntimeAt(events, 9)).toEqual([])
  })

  it('createConsumableStateResolver 直接消费 facet telemetry（3D 路径）', () => {
    const resolve = createConsumableStateResolver({
      consumables: [
        {
          clock: 10, eid: 7, wire_code: 9, state: 2, state_name: 'ACTIVATED',
          duration_s: 20, ends_at: 30, ever_activated: true, slot: 1, logical_item_id: 'ADRENALINE',
        },
      ],
    })
    expect(resolve(7, 20)).toEqual([{
      slot: 1, logicalItemId: 'ADRENALINE', wireCode: 9, remainingSec: 10, durationSec: 20,
    }])
    expect(resolve(8, 20)).toEqual([])
  })
})
