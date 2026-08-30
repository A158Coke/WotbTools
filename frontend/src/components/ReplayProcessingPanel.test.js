// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReplayProcessingPanel from './ReplayProcessingPanel.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key) => key),
  te: vi.fn(key => key.startsWith('api_errors.'))
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, te: i18n.te, locale: { value: 'en' } })
}))

function mountPanel({ uploadState = null, job = null, error = '' } = {}) {
  return mount(ReplayProcessingPanel, {
    props: { uploadState, job, error },
    global: { mocks: { $t: i18n.t } }
  })
}

function pJob(overrides = {}) {
  return {
    jobId: 'p1', status: 'PROCESSING', phase: 'PROCESSING_REPLAYS',
    total: 44, processed: 18, parseCompleted: 18, parseSucceeded: 17, parseFailed: 1,
    valid: 0, duplicates: 0, failures: 0, errorCode: null, currentFile: 'x.wotbreplay',
    activeSources: [
      { sourceId: 'r0', sourceIndex: 0, displayName: 'A.wotbreplay' },
      { sourceId: 'r1', sourceIndex: 1, displayName: 'B.wotbreplay' },
    ],
    ...overrides
  }
}

describe('ReplayProcessingPanel', () => {
  it('renders nothing when neither upload nor job exists', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-testid="replay-processing-panel"]').exists()).toBe(false)
  })

  it('UPLOADING shows real bytes/percent progress and cancel', () => {
    const wrapper = mountPanel({
      uploadState: { phase: 'UPLOADING', loaded: 33_554_432, total: 67_108_864, percent: 50 }
    })
    expect(wrapper.text()).toContain('replay.processing_job.uploading')
    expect(wrapper.find('[data-testid="upload-progress"]').text()).toContain('50%')
    expect(wrapper.find('[data-testid="processing-cancel"]').exists()).toBe(true)
  })

  it('REGISTERING shows preparing state', () => {
    const wrapper = mountPanel({
      uploadState: { phase: 'REGISTERING', loaded: 67_108_864, total: 67_108_864, percent: 100 }
    })
    expect(wrapper.text()).toContain('replay.processing_job.registering')
  })

  it('QUEUED shows waiting for parse resources', () => {
    const wrapper = mountPanel({ job: pJob({ status: 'QUEUED', phase: 'WAITING_FOR_WORKER' }) })
    expect(wrapper.text()).toContain('replay.processing_job.queued')
    expect(wrapper.find('[data-testid="processing-cancel"]').exists()).toBe(true)
  })

  it('PROCESSING shows real parseCompleted/total and success/fail counts', () => {
    const wrapper = mountPanel({ job: pJob() })
    expect(wrapper.text()).toContain('replay.processing_job.title')
    expect(wrapper.text()).toContain('replay.processing_job.progress')
    expect(wrapper.text()).toContain('41%')
    expect(wrapper.text()).toContain('replay.processing_job.counts')
    expect(wrapper.text()).toContain('replay.processing_job.active_sources')
    expect(wrapper.text()).toContain('A.wotbreplay')
    expect(wrapper.text()).toContain('B.wotbreplay')
    expect(wrapper.find('[data-testid="processing-cancel"]').exists()).toBe(true)
  })

  it('PROCESSING falls back to currentFile when activeSources absent', () => {
    const wrapper = mountPanel({ job: pJob({ activeSources: [] }) })
    expect(wrapper.text()).toContain('replay.processing_job.current_file')
  })

  it('FINALIZING shows indeterminate state and cancel', () => {
    const wrapper = mountPanel({ job: pJob({ phase: 'FINALIZING_BATCH' }) })
    expect(wrapper.text()).toContain('replay.processing_job.finalizing')
    expect(wrapper.find('.rpp-indeterminate').exists()).toBe(true)
    expect(wrapper.find('[data-testid="processing-cancel"]').exists()).toBe(true)
  })

  it('READY shows valid summary and dismiss, emits dismiss', async () => {
    const wrapper = mountPanel({
      job: pJob({ status: 'READY', phase: null, parseCompleted: 44, valid: 42, duplicates: 1, failures: 1 })
    })
    expect(wrapper.text()).toContain('replay.processing_job.ready')
    expect(wrapper.text()).toContain('replay.processing_job.valid_summary')
    await wrapper.find('[data-testid="processing-dismiss"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('FAILED surfaces stable error and dismiss', () => {
    const wrapper = mountPanel({
      job: pJob({ status: 'FAILED', phase: null, errorCode: 'NO_VALID_REPLAYS' })
    })
    expect(wrapper.text()).toContain('api_errors.NO_VALID_REPLAYS')
  })

  it('CANCELLED shows cancelled state', () => {
    const wrapper = mountPanel({ job: pJob({ status: 'CANCELLED', phase: null }) })
    expect(wrapper.text()).toContain('replay.processing_job.cancelled')
  })

  it('emits cancel from UPLOADING state', async () => {
    const wrapper = mountPanel({
      uploadState: { phase: 'UPLOADING', loaded: 1, total: 2, percent: 50 }
    })
    await wrapper.find('[data-testid="processing-cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
