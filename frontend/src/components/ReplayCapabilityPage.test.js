// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import ReplayCapabilityPage from './ReplayCapabilityPage.vue'

const replayState = vi.hoisted(() => ({
  files: null,
  requestDirectAction: vi.fn(() => Promise.resolve({ processingJobId: 'job-1', sourceId: 'r0' })),
  updateFiles: vi.fn((value) => { replayState.files.value = value }),
}))
replayState.files = ref([])

vi.mock('../composables/useReplay.js', () => ({ useReplay: () => ({
  files: replayState.files,
  loading: ref(false), error: ref(''), processingJob: ref(null), processingError: ref(''), uploadState: ref(null),
  updateFiles: replayState.updateFiles,
  requestDirectAction: replayState.requestDirectAction,
  cancelProcessing: vi.fn(), dismissProcessingJob: vi.fn(),
}) }))
vi.mock('../utils/helpers.js', () => ({ fileKey: file => file?.name || '' }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key }) }))
vi.mock('./FileUploader.vue', () => ({ default: {
  name: 'FileUploaderMock',
  props: ['files'],
  emits: ['update:files'],
  template: '<button data-test="uploader" @click="$emit(\'update:files\', [{ name: \'one.wotbreplay\' }])">upload</button>'
} }))
vi.mock('./ReplayProcessingPanel.vue', () => ({ default: { template: '<div data-test="processing" />' } }))
vi.mock('./AiReviewPanel.vue', () => ({ default: {
  props: ['file', 'processingJobId', 'sourceId'],
  template: '<div data-test="ai-panel">{{ processingJobId }}|{{ sourceId }}|{{ file?.name }}</div>'
} }))
vi.mock('./BattlePlaybackPanel.vue', () => ({ default: {
  props: ['file', 'processingJobId', 'sourceId'],
  template: '<div data-test="playback-panel">{{ processingJobId }}|{{ sourceId }}|{{ file?.name }}</div>'
} }))

function mountPage(mode, handoff = null) {
  return mount(ReplayCapabilityPage, {
    props: { mode },
    global: {
      provide: {
        isAuthenticated: () => true,
        replayHandoff: ref(handoff),
      },
      mocks: { $t: key => key },
    },
  })
}

describe('Replay capability pages', () => {
  beforeEach(() => {
    replayState.files.value = []
    replayState.requestDirectAction.mockClear()
  })

  it('consumes an in-memory source reference for AI Review without an uploader', async () => {
    const wrapper = mountPage('ai', { processingJobId: 'job-42', sourceId: 'r7' })
    await flushPromises()
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ai-panel"]').text()).toContain('job-42|r7|r7.wotbreplay')
  })

  it('prepares a selected replay and binds the returned reference to playback', async () => {
    const wrapper = mountPage('playback')
    await wrapper.find('[data-test="uploader"]').trigger('click')
    await flushPromises()
    expect(replayState.requestDirectAction).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-test="playback-panel"]').text()).toContain('job-1|r0|one.wotbreplay')
  })

  it('rejects an invalid handoff and keeps the upload entry point available', async () => {
    const wrapper = mountPage('ai', { processingJobId: 'job-42', sourceId: 'battle-7' })
    await flushPromises()
    expect(wrapper.find('[data-test="uploader"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ai-panel"]').text()).not.toContain('job-42')
  })
})
