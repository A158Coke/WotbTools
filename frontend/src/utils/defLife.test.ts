import { expect, it } from 'vitest'
import { defLifeAt } from './battlePlaybackV2.ts'


it('无复活字段时保持死亡终态语义', () => {
  const def = { death_t: 20, killer_eid: 7 }
  expect(defLifeAt(def, 19)).toEqual({ lifeState: 'ALIVE', destroyedKnownAtSec: 20 })
  expect(defLifeAt(def, 20)).toEqual({ lifeState: 'DESTROYED', destroyedKnownAtSec: 20 })
  expect(defLifeAt(def, 999)).toEqual({ lifeState: 'DESTROYED', destroyedKnownAtSec: 20 })
})

it('死亡一次 + 复活（death_times 缺省）→ 复活后回 ALIVE', () => {
  const def = { death_t: 20, killer_eid: 7, resurrection_times: [35] }
  expect(defLifeAt(def, 34)).toMatchObject({ lifeState: 'DESTROYED', destroyedKnownAtSec: 20 })
  expect(defLifeAt(def, 35)).toMatchObject({ lifeState: 'ALIVE', destroyedKnownAtSec: null })
})

it('死→复活→再死完整交替（death_times 全列表在场）', () => {
  const def = { death_t: 20, killer_eid: 7, death_times: [20, 58.5], resurrection_times: [35] }
  expect(defLifeAt(def, 19)).toMatchObject({ lifeState: 'ALIVE' })
  expect(defLifeAt(def, 20)).toMatchObject({ lifeState: 'DESTROYED', destroyedKnownAtSec: 20 })
  expect(defLifeAt(def, 35)).toMatchObject({ lifeState: 'ALIVE', destroyedKnownAtSec: null })
  expect(defLifeAt(def, 58.5)).toMatchObject({ lifeState: 'DESTROYED', destroyedKnownAtSec: 58.5 })
  expect(defLifeAt(def, 90)).toMatchObject({ lifeState: 'DESTROYED', destroyedKnownAtSec: 58.5 })
})

it('无死亡 / 无死亡时刻 → null（不凭空立状态）', () => {
  expect(defLifeAt({ death_t: null }, 10)).toBeNull()
  expect(defLifeAt(null, 10)).toBeNull()
  expect(defLifeAt({ death_t: 5 }, NaN)).toBeNull()
})
