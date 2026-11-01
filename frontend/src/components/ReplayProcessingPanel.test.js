// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)),
}))

function mountPanel(analysis, fileCount = 1) {
  return mount(ReplayProcessingPanel, {
    props: { analysis, fileCount },
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

  it('READY leaves no trace: content appearing is the success signal', () => {
    const wrapper = mountPanel(analysisOf({ phase: 'ready', done: 4, total: 4 }))
    expect(find(wrapper, 'replay-processing-panel').exists()).toBe(false)
  })

  it('PARSING speaks about loading, shows batch progress and a cancel action', async () => {
    const wrapper = mountPanel(analysisOf({ done: 3, total: 4 }), 4)

    expect(wrapper.text()).toContain('replay.analysis.loading')
    expect(find(wrapper, 'analysis-progress').text()).toContain('replay.analysis.progress {"done":3,"total":4}')
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('75')

    await find(wrapper, 'processing-cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('PARSING a single replay hides the file counter and never shows NaN', () => {
    const wrapper = mountPanel(analysisOf({ done: 0, total: 0 }))
    expect(find(wrapper, 'analysis-progress').exists()).toBe(false)
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('0')
  })

  it.each([
    ['ENGINE_UNAVAILABLE', 'replay.analysis.engine_unavailable'],
    ['NO_VALID_REPLAYS', 'replay.analysis.no_valid_replays'],
    ['UNKNOWN', 'replay.analysis.failed_unknown'],
    [null, 'replay.analysis.failed_unknown'],
  ])('FAILED (%s) offers recovery with %s', async (failure, key) => {
    const wrapper = mountPanel(analysisOf({ phase: 'failed', failure }))

    expect(wrapper.text()).toContain('replay.analysis.failed_open')
    expect(find(wrapper, 'analysis-failure').text()).toBe(key)
    expect(find(wrapper, 'processing-clear').text()).toBe('replay.analysis.remove_from_list')

    await find(wrapper, 'processing-retry').trigger('click')
    await find(wrapper, 'processing-open-other').trigger('click')
    await find(wrapper, 'processing-clear').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.emitted('open-other')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('FAILED with several files clears the list instead of removing one', () => {
    const wrapper = mountPanel(analysisOf({ phase: 'failed', failure: 'NO_VALID_REPLAYS' }), 3)
    expect(find(wrapper, 'processing-clear').text()).toBe('replay.analysis.clear_list')
  })
})
