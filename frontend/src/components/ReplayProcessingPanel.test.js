// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)),
}))

function mountPanel(analysis, result = null) {
  return mount(ReplayProcessingPanel, {
    props: { analysis, result },
    global: { mocks: { $t: i18n.t } },
  })
}

function analysisOf(overrides = {}) {
  return { phase: 'parsing', done: 0, total: 0, failure: null, ...overrides }
}

const find = (wrapper, id) => wrapper.find(`[data-testid="${id}"]`)

describe('ReplayProcessingPanel (local analysis)', () => {
  it('renders nothing while idle', () => {
    const wrapper = mountPanel(analysisOf({ phase: 'idle' }))
    expect(find(wrapper, 'replay-processing-panel').exists()).toBe(false)
  })

  it('PARSING shows done/total + percent progress and a cancel action', async () => {
    const wrapper = mountPanel(analysisOf({ done: 3, total: 4 }))

    expect(wrapper.text()).toContain('replay.analysis.parsing')
    const progress = find(wrapper, 'analysis-progress').text()
    expect(progress).toContain('replay.analysis.progress {"done":3,"total":4}')
    expect(progress).toContain('75%')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('75')
    expect(find(wrapper, 'processing-dismiss').exists()).toBe(false)

    await find(wrapper, 'processing-cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('PARSING with zero total stays at 0% instead of NaN', () => {
    const wrapper = mountPanel(analysisOf({ done: 0, total: 0 }))
    expect(find(wrapper, 'analysis-progress').text()).toContain('0%')
  })

  it('READY collapses into one line with valid / duplicate / failure counts and dismiss', async () => {
    const wrapper = mountPanel(
      analysisOf({ phase: 'ready', done: 4, total: 4 }),
      { battles: [{}, {}], duplicates: [{}], failures: [{}] },
    )

    expect(find(wrapper, 'replay-processing-panel').classes()).toContain('rpp-compact')
    const ready = find(wrapper, 'processing-ready').text()
    expect(ready).toContain('replay.analysis.ready')
    expect(ready).toContain('replay.analysis.summary {"v":2,"d":1,"f":1}')
    expect(find(wrapper, 'processing-cancel').exists()).toBe(false)

    await find(wrapper, 'processing-dismiss').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it.each([
    ['ENGINE_UNAVAILABLE', 'replay.analysis.engine_unavailable'],
    ['NO_VALID_REPLAYS', 'replay.analysis.no_valid_replays'],
    ['UNKNOWN', 'replay.analysis.failed_unknown'],
    [null, 'replay.analysis.failed_unknown'],
  ])('FAILED (%s) surfaces %s with dismiss', (failure, key) => {
    const wrapper = mountPanel(analysisOf({ phase: 'failed', done: 1, total: 2, failure }))

    expect(wrapper.text()).toContain('replay.analysis.failed')
    expect(find(wrapper, 'analysis-failure').text()).toBe(key)
    expect(find(wrapper, 'processing-dismiss').exists()).toBe(true)
    expect(find(wrapper, 'processing-cancel').exists()).toBe(false)
  })

  it('CANCELLED shows cancelled state and dismiss', () => {
    const wrapper = mountPanel(analysisOf({ phase: 'cancelled', done: 1, total: 3 }))
    expect(wrapper.text()).toContain('replay.analysis.cancelled')
    expect(find(wrapper, 'processing-dismiss').exists()).toBe(true)
  })
})
