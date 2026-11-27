// @vitest-environment happy-dom

import { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import BattlePlayback from './BattlePlayback.vue'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { makeBattlePlaybackDataset as makePlaybackV2Impl } from '../test/playbackV2TestUtil.js'
import { preloadBattleModels } from '../vehicle-models/runtime.js'
import { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'
import { TANK_ID_TO_MODEL } from '../vehicle-models/mapping.js'

const i18n = vi.hoisted(() => ({
  t: vi.fn(key => key)
}))

export function mountBattlePlayback(props) {
  const wrapper = mount(BattlePlayback, {
    props,
    global: { mocks: { $t: i18n.t } }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

export function makeOverview() {
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
        firstObservedSec: 10, lastObservedSec: 20, deathSec: null
      },
      {
        accountId: 2001, playerName: 'EnemyA', tankId: 2, team: 2,
        points: [{ x: -50, y: -50, timeSec: 10 }, { x: -100, y: -100, timeSec: 14 }],
        firstObservedSec: 10, lastObservedSec: 30, deathSec: null
      }
    ]
  }
}

export function mountPlayback(overview = makeOverview(), seekTo = null, dataset = undefined) {
  const finalDataset = dataset === undefined ? makePlaybackV2Impl() : dataset
  return mountBattlePlayback({ overview, seekTo, playbackV2: finalDataset })
}

export async function openPanel(wrapper, name) {
  if (!wrapper.find('[data-testid="display-panel"]').exists()) {
    await wrapper.get('[data-test="pb-secondary-entry"]').trigger('click')
  }
  if (name === 'events') await wrapper.get('[data-test="pb-panel-events"]').trigger('click')
  await flushPromises()
}


export function trackOf(dataset, accountId) {
  return dataset.vehicles.find((vehicle) => vehicle.accountId === accountId)
}

export function setPositionSamples(dataset, accountId, samples, startSec = samples[0]?.timeSec ?? 0, endSec = samples.at(-1)?.timeSec ?? startSec) {
  trackOf(dataset, accountId).positionSegments = [{
    knowledge: 'OBSERVED', startSec, endSec, interpolationAllowed: true, samples,
  }]
}

export function setLife(dataset, accountId, timeSec) {
  trackOf(dataset, accountId).lifeTransitions = [{
    timeSec, lifeState: 'DESTROYED', destroyedKnownAtSec: timeSec,
  }]
}

export const rafState = { cb: null }
export const mountedWrappers = []

export function installIntegrationLifecycle() {
  beforeEach(async () => {
  const prefs = usePlaybackPreferences()
  Object.assign(prefs.labelPrefs, { showPlayerName: false, showTankName: true, showReload: true })
  Object.assign(prefs.hpPrefs, { showHp: true, mode: 'bar' })
  Object.assign(prefs.trailPrefs, { showTrail: true })
  Object.assign(prefs.markerPrefs, { classIcons: false, showStatus: true })
  Object.assign(prefs.uiPrefs, { showTopbar: true, showRoster: true, showKillfeed: true, showBaseStatus: true })
  await nextTick()
  localStorage.clear()
})

  afterEach(() => {
    mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount())
  })
}

export function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    rafState.cb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

export function detailsHpNum(info) {
  const val = info.find('[data-test="v2-inspector-hp"] .v2-inspector-val').text()
  const m = val.match(/\d+/)
  return m ? m[0] : null
}

export function enemyHudNum(wrapper) {
  return wrapper.find('[data-test="pb-marker-2001"]').find('[data-test="pb-hp-num"]').text()
}

export { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
export { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'
export { flushPromises, mount } from '@vue/test-utils'
export { readFileSync } from 'node:fs'
export { resolve } from 'node:path'
export { PLAYBACK_MOBILE_QUERY } from '../shared/breakpoints.js'
export { makeBattlePlaybackDataset as makePlaybackV2 } from '../test/playbackV2TestUtil.js'
export { preloadBattleModels } from '../vehicle-models/runtime.js'
export { loadVehiclePortrait } from '../vehicle-portraits/runtime.js'
export { TANK_ID_TO_MODEL } from '../vehicle-models/mapping.js'
export { default as BattlePlayback } from './BattlePlayback.vue'
export { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
export { i18n }
