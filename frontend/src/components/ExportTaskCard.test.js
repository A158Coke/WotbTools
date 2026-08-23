// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ExportTaskCard from './ExportTaskCard.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key) => key)
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: { value: 'en' } })
}))

function makeJob(overrides = {}) {
  return {
    jobId: 'j1',
    status: 'PROCESSING',
    phase: 'PROCESSING_REPLAYS',
    total: 34,
    processed: 18,
    duplicates: 2,
    failures: 1,
    errorCode: null,
    filename: null,
    contentType: null,
    ...overrides
  }
}

function mountCard(job, error = '') {
  return mount(ExportTaskCard, {
    props: { job, error },
    global: { mocks: { $t: i18n.t } }
  })
}

describe('ExportTaskCard', () => {
  it('renders nothing when no job', () => {
    const wrapper = mountCard(null)
    expect(wrapper.find('[data-testid="export-task-card"]').exists()).toBe(false)
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
    expect(wrapper.text()).toContain('replay.export_job.failed_no_valid')
  })

  it('FAILED generic shows generic message', () => {
    const wrapper = mountCard(makeJob({ status: 'FAILED', phase: null, errorCode: 'EXPORT_JOB_FAILED' }))
    expect(wrapper.text()).toContain('replay.export_job.failed_generic')
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
