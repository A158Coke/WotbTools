// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReplayTaskCard from './ReplayTaskCard.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key) => key),
  te: vi.fn(key => key.startsWith('api_errors.'))
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, te: i18n.te, locale: { value: 'en' } })
}))

function makeJob(overrides = {}) {
  return {
    jobId: 'j1',
    status: 'PROCESSING',
    phase: 'PROCESSING_REPLAYS',
    total: 34,
    processed: 18,
    valid: 16,
    duplicates: 2,
    failures: 1,
    errorCode: null,
    filename: null,
    contentType: null,
    currentFile: null,
    ...overrides
  }
}

function mountCard(job, error = '', kind = 'export') {
  return mount(ReplayTaskCard, {
    props: { job, error, kind },
    global: { mocks: { $t: i18n.t } }
  })
}

describe('ReplayTaskCard (export kind)', () => {
  it('renders nothing when no job', () => {
    const wrapper = mountCard(null)
    expect(wrapper.find('[data-testid="replay-task-card"]').exists()).toBe(false)
  })

  it('QUEUED shows preparing state and cancel button', async () => {
    const wrapper = mountCard(makeJob({ status: 'QUEUED', processed: 0 }))
    expect(wrapper.text()).toContain('replay.export_job.queued')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('PROCESSING shows real progress bar and phase', () => {
    const wrapper = mountCard(makeJob())
    expect(wrapper.text()).toContain('replay.export_job.progress')
    expect(wrapper.text()).toContain('replay.export_job.phase_processing')
    expect(wrapper.text()).toContain('replay.export_job.duplicates_failures')
    const fill = wrapper.get('[data-testid="etc-bar-fill"]')
    expect(fill.attributes('style')).toContain('width: 53%')
    expect(wrapper.get('[data-testid="etc-bar"]').exists()).toBe(true)
  })

  it('BUILDING_EXCEL phase shows Excel label', () => {
    const wrapper = mountCard(makeJob({ phase: 'BUILDING_EXCEL', processed: 34 }))
    expect(wrapper.text()).toContain('replay.export_job.phase_excel')
  })

  it('BUILDING_ARCHIVE phase shows ZIP label', () => {
    const wrapper = mountCard(makeJob({ phase: 'BUILDING_ARCHIVE' }))
    expect(wrapper.text()).toContain('replay.export_job.phase_archive')
  })

  it('READY shows download + dismiss and emits', async () => {
    const wrapper = mountCard(makeJob({ status: 'READY', phase: null }))
    expect(wrapper.text()).toContain('replay.export_job.ready')
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    expect(wrapper.emitted('download')).toBeTruthy()
    await buttons[1].trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  it('FAILED NO_VALID_REPLAYS shows clear message', () => {
    const wrapper = mountCard(makeJob({ status: 'FAILED', phase: null, errorCode: 'NO_VALID_REPLAYS' }))
    expect(wrapper.text()).toContain('replay.export_job.failed')
    expect(wrapper.text()).toContain('api_errors.NO_VALID_REPLAYS')
  })

  it('FAILED generic shows generic message', () => {
    const wrapper = mountCard(makeJob({ status: 'FAILED', phase: null, errorCode: 'EXPORT_JOB_FAILED' }))
    expect(wrapper.text()).toContain('api_errors.EXPORT_JOB_FAILED')
  })

  it('CANCELLED shows cancelled state', () => {
    const wrapper = mountCard(makeJob({ status: 'CANCELLED', phase: null }))
    expect(wrapper.text()).toContain('replay.export_job.cancelled')
  })

  it('renders error text when provided', () => {
    const wrapper = mountCard(makeJob(), 'replay.export_failed:JOB_NOT_FOUND')
    expect(wrapper.get('[data-testid="etc-error"]').text()).toContain('JOB_NOT_FOUND')
  })

  it('progress bar caps at 100%', () => {
    const wrapper = mountCard(makeJob({ processed: 99, total: 10 }))
    const fill = wrapper.get('[data-testid="etc-bar-fill"]')
    expect(fill.attributes('style')).toContain('width: 100%')
  })
})

describe('ReplayTaskCard (processing kind)', () => {
  it('PROCESSING shows real 18/34 + current file + valid/dup/fail counts', () => {
    const wrapper = mountCard(makeJob({ currentFile: '20260725_1600__CHRD-A158.wotbreplay' }), '', 'processing')
    expect(wrapper.text()).toContain('replay.processing_job.title')
    expect(wrapper.text()).toContain('replay.processing_job.progress')
    expect(wrapper.text()).toContain('replay.processing_job.current_file')
    expect(wrapper.text()).toContain('replay.processing_job.counts')
    const fill = wrapper.get('[data-testid="etc-bar-fill"]')
    expect(fill.attributes('style')).toContain('width: 53%')
  })

  it('QUEUED shows processing preparing + cancel', () => {
    const wrapper = mountCard(makeJob({ status: 'QUEUED', processed: 0 }), '', 'processing')
    expect(wrapper.text()).toContain('replay.processing_job.queued')
  })

  it('READY shows parse-complete summary and dismiss (auto result shown by page)', async () => {
    const wrapper = mountCard(makeJob({ status: 'READY', phase: null, processed: 34, valid: 31, duplicates: 2, failures: 1 }), '', 'processing')
    expect(wrapper.text()).toContain('replay.processing_job.ready')
    expect(wrapper.text()).toContain('replay.processing_job.counts')
    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
    // processing READY 不显示 download（结果已在页面自动展示）
    expect(wrapper.emitted('download')).toBeFalsy()
  })

  it('FAILED NO_VALID_REPLAYS shows processing-specific message', () => {
    const wrapper = mountCard(makeJob({ status: 'FAILED', phase: null, errorCode: 'NO_VALID_REPLAYS' }), '', 'processing')
    expect(wrapper.text()).toContain('replay.processing_job.failed')
    expect(wrapper.text()).toContain('api_errors.NO_VALID_REPLAYS')
  })

  it('CANCELLED shows processing cancelled', () => {
    const wrapper = mountCard(makeJob({ status: 'CANCELLED', phase: null }), '', 'processing')
    expect(wrapper.text()).toContain('replay.processing_job.cancelled')
  })

  it('cancel button emits cancel', async () => {
    const wrapper = mountCard(makeJob(), '', 'processing')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })
})
