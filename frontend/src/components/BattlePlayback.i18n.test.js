// @vitest-environment happy-dom

// 真实 vue-i18n 回归测试：不使用 mock $t，直接走 message compiler。
// 覆盖「选中 last-known/已击毁车辆后整个战局回放消失」的 locale 裸 @ bug（zh/en/ru）。
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import ru from '../locales/ru.json'
import BattlePlayback from './BattlePlayback.vue'
import { legacyPlaybackToV2Dataset } from '../test/playbackV2TestUtil'

vi.mock('../data/mapImages', () => ({
  mapImages: {
    holland: {
      src: 'molendijk.png',
      width: 766,
      height: 769,
      coordinateBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 }
    }
  }
}))

vi.mock('../utils/mapPalette.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, luminanceOfImage: vi.fn().mockResolvedValue(0.8) }
})

vi.mock('../vehicle-models/runtime.js', () => ({
  preloadBattleModels: vi.fn(async () => ({
    resolved: new Map(),
    failed: new Set(),
    byTank: new Map(),
  })),
}))

function makeOverview() {
  return {
    mapCode: 'holland',
    displayName: 'Molendijk',
    displayNames: { zh: '莫伦代克', en: 'Molendijk', ru: 'Молендейк' },
    playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
    friendlyTeam: 1,
    arenaBonusType: 1,
    recorderAccountId: 1001,
    gridCells: [],
    spawnPoints: [],
    routes: [
      {
        accountId: 1001, playerName: 'You', tankId: 1, team: 1,
        points: [{ x: 0, y: 0, timeSec: 10 }, { x: 50, y: 50, timeSec: 14 }],
        firstObservedSec: 10, lastObservedSec: 14, deathSec: null
      },
      {
        accountId: 2001, playerName: 'EnemyGap', tankId: 2, team: 2,
        points: [{ x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 }, { x: -200, y: -200, timeSec: 40 }],
        firstObservedSec: 10, lastObservedSec: 40, deathSec: null
      },
      {
        accountId: 2002, playerName: 'EnemyDead', tankId: 3, team: 2,
        points: [{ x: 100, y: 100, timeSec: 10 }, { x: 110, y: 110, timeSec: 14 }, { x: 120, y: 120, timeSec: 30 }],
        firstObservedSec: 10, lastObservedSec: 30, deathSec: 30
      }
    ],
    playback: {
      durationSec: 60,
      vehicles: [
        {
          accountId: 1001, playerName: 'You', tankId: 1, team: 1,
          positionIntervals: [{ startSec: 0, endSec: 60 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 0, turretRelativeYawDeg: 0 },
            { timeSec: 14, hullYawDeg: 90, turretRelativeYawDeg: 30 }
          ]
        },
        {
          accountId: 2001, playerName: 'EnemyGap', tankId: 2, team: 2,
          positionIntervals: [{ startSec: 10, endSec: 14 }], deathSec: null,
          directionSamples: [
            { timeSec: 10, hullYawDeg: 10, turretRelativeYawDeg: 5 },
            { timeSec: 14, hullYawDeg: 30, turretRelativeYawDeg: 20 }
          ]
        },
        {
          accountId: 2002, playerName: 'EnemyDead', tankId: 3, team: 2,
          positionIntervals: [{ startSec: 10, endSec: 30 }], deathSec: 30, directionSamples: []
        }
      ],
      events: [
        { type: 'POSITION_REPORTED', timeSec: 10, accountId: 2001, targetAccountId: null, damage: null },
        { type: 'POSITION_STALE', timeSec: 14, accountId: 2001, targetAccountId: null, damage: null },
        { type: 'DESTROYED', timeSec: 30, accountId: 2002, targetAccountId: null, damage: null }
      ]
    }
  }
}

const locales = { zh, en, ru }
// PR5 detail sidebar 文案（§8/§7.1）：最后已知 / 已击毁（AoI coverage ≠ spotting → observation 语义）
const lastSpottedLabel = { zh: '最后已知', en: 'Last known', ru: 'Последнее известное' }
const destroyedLabel = { zh: '已击毁', en: 'Destroyed', ru: 'Уничтожен' }

describe('BattlePlayback with real vue-i18n (zh/en/ru)', () => {
  for (const lang of ['zh', 'en', 'ru']) {
    it(lang + ': selecting a last-known vehicle does not throw and keeps the map visible', async () => {
      const i18n = createI18n({ locale: lang, fallbackLocale: 'en', messages: locales })
      const wrapper = mount(BattlePlayback, {
        props: { overview: makeOverview(), seekTo: 20, playbackV2: legacyPlaybackToV2Dataset(makeOverview()) },
        global: { plugins: [i18n] }
      })
      await flushPromises()
      expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
      const marker = wrapper.find('[data-test="pb-marker-2001"]')
      expect(marker.exists()).toBe(true)
      await marker.trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="pb-map"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="pb-markers"]').exists()).toBe(true)
      const info = wrapper.find('[data-test="pb-info"]')
      expect(info.exists()).toBe(true)
      expect(info.text()).toContain(lastSpottedLabel[lang])
      expect(info.text()).toContain('00:14')
    })

    it(lang + ': selecting a destroyed vehicle does not collapse the component', async () => {
      const i18n = createI18n({ locale: lang, fallbackLocale: 'en', messages: locales })
      const wrapper = mount(BattlePlayback, {
        props: { overview: makeOverview(), seekTo: 35, playbackV2: legacyPlaybackToV2Dataset(makeOverview()) },
        global: { plugins: [i18n] }
      })
      await flushPromises()
      const marker = wrapper.find('[data-test="pb-marker-2002"]')
      expect(marker.exists()).toBe(true)
      await marker.trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-test="battle-playback"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="pb-map"]').exists()).toBe(true)
      const info = wrapper.find('[data-test="pb-info"]')
      expect(info.exists()).toBe(true)
      expect(info.text()).toContain(destroyedLabel[lang])
      expect(info.text()).toContain(lastSpottedLabel[lang])
      expect(info.text()).toContain('00:30')
    })
  }
})
