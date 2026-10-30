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

describe('consumableRuntimeAt', () => {
  it('定时消耗品激活中：按 endsAt 计算剩余，state=ACTIVE', () => {
    const transitions = [
      tr({ timeSec: 0, state: 'INITIALIZED', wireCode: 0x09, logicalItemId: 'ADRENALINE' }),
      tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: 30, wireCode: 0x09, logicalItemId: 'ADRENALINE', everActivated: true }),
    ]
    expect(consumableRuntimeAt(transitions, 20)).toEqual([{
      slot: 0, logicalItemId: 'ADRENALINE', wireCode: 0x09, state: 'ACTIVE',
      remainingSec: 10, durationSec: 20,
    }])
    expect(consumableRuntimeAt(transitions, 9)).toEqual([])
  })

  it('定时消耗品冷却中：state=COOLDOWN，剩余按冷却 endsAt', () => {
    const transitions = [
      tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: 30, logicalItemId: 'ADRENALINE', wireCode: 0x09, everActivated: true }),
      tr({ timeSec: 30, state: 'ACTIVE_ENDED_OR_COOLDOWN', durationSec: 60, endsAt: 90, logicalItemId: 'ADRENALINE', wireCode: 0x09, everActivated: true }),
    ]
    expect(consumableRuntimeAt(transitions, 40)).toEqual([{
      slot: 0, logicalItemId: 'ADRENALINE', wireCode: 0x09, state: 'COOLDOWN',
      remainingSec: 50, durationSec: 60,
    }])
    expect(consumableRuntimeAt(transitions, 90)).toEqual([])
  })

  it('瞬发消耗品不进入 HUD（duration=0；冷却也不展示）', () => {
    const transitions = [
      tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 0, endsAt: 10, logicalItemId: 'REPAIR_KIT', wireCode: 0x0D, everActivated: true }),
      tr({ timeSec: 10, state: 'ACTIVE_ENDED_OR_COOLDOWN', durationSec: 60, endsAt: 70, logicalItemId: 'REPAIR_KIT', wireCode: 0x0D, everActivated: true }),
    ]
    expect(consumableRuntimeAt(transitions, 10)).toEqual([])
    expect(consumableRuntimeAt(transitions, 40)).toEqual([])
  })

  it('state1（就绪/未使用）隐藏；提前 state1 覆盖冷却', () => {
    const active = tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: 30, logicalItemId: 'ADRENALINE', wireCode: 0x09, everActivated: true })
    const cooldown = tr({ timeSec: 30, state: 'ACTIVE_ENDED_OR_COOLDOWN', durationSec: 60, endsAt: 90, logicalItemId: 'ADRENALINE', wireCode: 0x09, everActivated: true })
    const ready = tr({ timeSec: 50, state: 'INITIALIZED', logicalItemId: 'ADRENALINE', wireCode: 0x09, everActivated: true })
    expect(consumableRuntimeAt([active, cooldown], 40).length).toBe(1)
    expect(consumableRuntimeAt([active, cooldown, ready], 60)).toEqual([])
  })

  it('invalidation 清空全部槽位（AoI 关闭不保留旧状态）', () => {
    const transitions = [
      tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: 30, logicalItemId: 'ADRENALINE', wireCode: 0x09, everActivated: true }),
      tr({ timeSec: 20, state: 'UNKNOWN', invalidation: true, consumableSlot: null }),
    ]
    expect(consumableRuntimeAt(transitions, 21)).toEqual([])
  })

  it('旧产物缺 endsAt 时回退 timeSec + durationSec', () => {
    const transitions = [
      tr({ timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: null, logicalItemId: 'ADRENALINE', wireCode: 0x09 }),
    ]
    expect(consumableRuntimeAt(transitions, 20)[0]).toMatchObject({ state: 'ACTIVE', remainingSec: 10 })
  })

  it('按槽位升序输出，最多三个槽位', () => {
    const transitions = [
      tr({ timeSec: 10, consumableSlot: 2, state: 'ACTIVATED', durationSec: 20, endsAt: 30, logicalItemId: 'ADRENALINE' }),
      tr({ timeSec: 10, consumableSlot: 0, state: 'ACTIVATED', durationSec: 20, endsAt: 30, logicalItemId: 'ENGINE_POWER_BOOST' }),
    ]
    expect(consumableRuntimeAt(transitions, 20).map((x) => x.slot)).toEqual([0, 2])
  })

  it('createConsumableStateResolver 按 eid 分组，互不串车', () => {
    const resolve = createConsumableStateResolver({
      consumables: [
        tr({ eid: 1, timeSec: 10, state: 'ACTIVATED', durationSec: 20, endsAt: 30, logicalItemId: 'ADRENALINE' }),
        tr({ eid: 2, timeSec: 10, state: 'ACTIVATED', durationSec: 5, endsAt: 15, logicalItemId: 'RETICLE_CALIBRATION' }),
      ],
    })
    expect(resolve(1, 20).map((x) => x.logicalItemId)).toEqual(['ADRENALINE'])
    expect(resolve(2, 20)).toEqual([])
    expect(resolve(3, 20)).toEqual([])
  })
})
