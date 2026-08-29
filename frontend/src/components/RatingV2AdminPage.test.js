// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const authState = vi.hoisted(() => ({ loggedIn: true, roles: ['wotbtools-admin'], login: vi.fn() }))
const replayState = vi.hoisted(() => ({
  files: null,
  selectionRevision: null,
  loading: null,
  error: null,
  processingJob: null,
  processingError: null,
  processingActive: null,
  processingJobId: null,
  uploadState: null,
  updateFiles: vi.fn(),
  startProcessingJob: vi.fn(),
  cancelProcessing: vi.fn(),
  dismissProcessingJob: vi.fn(),
}))
const api = vi.hoisted(() => ({ ratingV2Admin: vi.fn() }))

vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  return {
    useI18n: () => ({
      t: (key, values) => values ? `${key}:${Object.values(values).join(',')}` : key,
      te: () => true,
      locale: ref('zh'),
    }),
  }
})

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    initPromise: Promise.resolve(authState.loggedIn),
    tokenParsed: { value: authState.roles.length ? { realm_access: { roles: authState.roles } } : null },
    login: authState.login,
  }),
}))

vi.mock('../composables/useReplay.js', async () => {
  const { ref } = await import('vue')
  const files = ref([])
  const selectionRevision = ref(0)
  const loading = ref(false)
  const error = ref('')
  const processingJob = ref(null)
  const processingError = ref('')
  const processingActive = ref(false)
  const processingJobId = ref(null)
  const uploadState = ref(null)
  replayState.files = files
  replayState.selectionRevision = selectionRevision
  replayState.loading = loading
  replayState.error = error
  replayState.processingJob = processingJob
  replayState.processingError = processingError
  replayState.processingActive = processingActive
  replayState.processingJobId = processingJobId
  replayState.uploadState = uploadState
  replayState.updateFiles.mockImplementation(next => {
    files.value = next
    selectionRevision.value++
    processingJobId.value = null
  })
  return {
    useReplay: () => ({
      files, selectionRevision, loading, error, processingJob, processingError, processingActive, processingJobId,
      uploadState, updateFiles: replayState.updateFiles, startProcessingJob: replayState.startProcessingJob,
      cancelProcessing: replayState.cancelProcessing, dismissProcessingJob: replayState.dismissProcessingJob,
    }),
  }
})

vi.mock('../utils/api.js', () => api)

import RatingV2AdminPage from './RatingV2AdminPage.vue'

const FileUploaderStub = {
  props: ['showWorkspaceActions'],
  emits: ['update:files'],
  template: '<button class="select-replays" :data-workspace-actions="showWorkspaceActions" @click="$emit(\'update:files\', [{ name: \'a.wotbreplay\', size: 1, lastModified: 1 }])">select</button>',
}

const mountedWrappers = []

function mountPage(options = {}) {
  const wrapper = mount(RatingV2AdminPage, {
    ...options,
    global: {
      stubs: {
        FileUploader: FileUploaderStub,
        ReplayProcessingPanel: { template: '<div class="processing-panel-stub" />' },
        RatingV2RadarPanel: {
          props: ['row', 'rows'],
          emits: ['close'],
          template: '<section class="rating-v2-radar-stub">{{ row.cells.nickname }}<button class="rating-v2-radar-close close-radar" @click="$emit(\'close\')">close</button></section>',
        },
        teleport: true,
      },
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('RatingV2AdminPage', () => {
  beforeEach(() => {
    authState.loggedIn = true
    authState.roles = ['wotbtools-admin']
    authState.login.mockClear()
    replayState.startProcessingJob.mockReset()
    replayState.cancelProcessing.mockReset()
    replayState.dismissProcessingJob.mockReset()
    replayState.updateFiles.mockClear()
    api.ratingV2Admin.mockReset()
    if (replayState.files) replayState.files.value = []
    if (replayState.selectionRevision) replayState.selectionRevision.value = 0
    if (replayState.processingJobId) replayState.processingJobId.value = null
  })

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
    vi.clearAllMocks()
  })

  it('redirects unauthenticated deep links to the same hidden view', async () => {
    authState.loggedIn = false
    authState.roles = []
    const wrapper = mountPage()
    await flushPromises()

    expect(authState.login).toHaveBeenCalledWith('rating-v2')
    expect(wrapper.text()).toContain('ratingV2.login')
    expect(wrapper.find('.select-replays').exists()).toBe(false)
  })

  it('shows no uploader to a signed-in non-admin', async () => {
    authState.roles = ['wotbtools-user']
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('ratingV2.denied')
    expect(wrapper.find('.select-replays').exists()).toBe(false)
  })

  it('reuses the processing job and loads V2 only after its READY job id exists', async () => {
    api.ratingV2Admin.mockResolvedValue({
      rows: [
        { cells: { nickname: 'Low', rating: 900 } },
        { cells: { nickname: 'High', rating: 1200 } },
      ],
      duplicates: [], failures: [],
      columns: [{ key: 'nickname', num: false }, { key: 'rating', num: true }],
    })
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.select-replays').attributes('data-workspace-actions')).toBe('false')
    await wrapper.find('.select-replays').trigger('click')
    await wrapper.find('[data-testid="rating-v2-run"]').trigger('click')
    expect(replayState.startProcessingJob).toHaveBeenCalledOnce()
    expect(api.ratingV2Admin).not.toHaveBeenCalled()

    replayState.processingJobId.value = 'ready-job'
    await flushPromises()
    expect(api.ratingV2Admin).toHaveBeenCalledWith('ready-job')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)

    const ratingHeader = wrapper.findAll('.rating-v2-sort').find(header => header.text().startsWith('ratingV2.labels.rating'))
    await ratingHeader.trigger('click')
    await ratingHeader.trigger('click')
    expect(wrapper.find('tbody tr').text()).toContain('High')
  })

  it('clears an old V2 table when the file selection changes', async () => {
    api.ratingV2Admin.mockResolvedValue({
      rows: [{ cells: { nickname: 'Pilot', rating: 1200 } }],
      duplicates: [], failures: [],
      columns: [{ key: 'nickname', num: false }, { key: 'rating', num: true }],
    })
    const wrapper = mountPage()
    await flushPromises()
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'ready-job'
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)

    replayState.selectionRevision.value++
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
  })

  it('uses the same numeric alignment marker for headers and cells', async () => {
    api.ratingV2Admin.mockResolvedValue({
      rows: [{ cells: { nickname: 'Pilot', rating: 1200 } }],
      duplicates: [], failures: [],
      columns: [{ key: 'nickname', num: false }, { key: 'rating', num: true }],
    })
    const wrapper = mountPage()
    await flushPromises()
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'ready-job'
    await flushPromises()

    expect(wrapper.findAll('thead th').map(cell => cell.classes().includes('num'))).toEqual([false, true])
    expect(wrapper.findAll('tbody td').map(cell => cell.classes().includes('num'))).toEqual([false, true])
  })

  it('opens a selected player radar in a side drawer and clears it with the next file selection', async () => {
    api.ratingV2Admin.mockResolvedValue({
      rows: [{ cells: { nickname: 'Pilot', rating: 1200 }, radar: [] }],
      duplicates: [], failures: [],
      columns: [{ key: 'nickname', num: false }, { key: 'rating', num: true }],
    })
    const wrapper = mountPage()
    await flushPromises()
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'ready-job'
    await flushPromises()

    await wrapper.find('.rating-v2-player').trigger('click')
    expect(wrapper.find('.rating-v2-radar-drawer .rating-v2-radar-stub').text()).toContain('Pilot')
    expect(wrapper.find('.rating-v2-results .rating-v2-radar-stub').exists()).toBe(false)
    expect(wrapper.find('.rating-v2-player').attributes('aria-label')).toBe('ratingV2.radar.open:Pilot')
    expect(wrapper.find('.rating-v2-player').attributes('aria-pressed')).toBe('true')

    replayState.selectionRevision.value++
    await flushPromises()
    expect(wrapper.find('.rating-v2-radar-stub').exists()).toBe(false)
  })

  it('closes the radar drawer with Escape and restores focus to the player trigger', async () => {
    api.ratingV2Admin.mockResolvedValue({
      rows: [{ cells: { nickname: 'Pilot', rating: 1200 }, radar: [] }],
      duplicates: [], failures: [],
      columns: [{ key: 'nickname', num: false }, { key: 'rating', num: true }],
    })
    const wrapper = mountPage({ attachTo: document.body })
    await flushPromises()
    replayState.files.value = [new File(['x'], 'a.wotbreplay')]
    replayState.processingJobId.value = 'ready-job'
    await flushPromises()

    const trigger = wrapper.find('.rating-v2-player')
    await trigger.trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.find('.rating-v2-radar-close').element)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.rating-v2-radar-drawer').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })
})
