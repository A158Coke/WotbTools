// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import HoFPage from './HoFPage.vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import { createHoFPageTestHelpers } from '../test/HoFPageTestHelpers.js'

const confirmDialog = vi.hoisted(() => ({ confirm: vi.fn(() => Promise.resolve(true)) }))
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

vi.mock('../composables/useConfirm.js', () => ({ confirm: confirmDialog.confirm }))


let authenticated = true
let tokenClaims = null
const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined)),
  logout: vi.fn(() => Promise.resolve(undefined))
}))

const lbApi = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofVehicleOptions: vi.fn(() => Promise.resolve([])),
  hofUpload: vi.fn(() => Promise.resolve({ status: 'ok', arenaId: 'a1' })),
  hofDownload: vi.fn(() => Promise.resolve(undefined)),
  hofHundredList: vi.fn(() => Promise.resolve({ vehicleId: null, vehicleName: '', items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofHundredSubmit: vi.fn(() => Promise.resolve({ id: 1, status: 'PENDING' })),
  hofHundredCancel: vi.fn(() => Promise.resolve({ id: 1, status: 'CANCELLED' })),
  hofHundredMyStatus: vi.fn(() => Promise.resolve({ current: [], pending: [], rejected: [] })),
  hofMark3List: vi.fn(() => Promise.resolve({ vehicleId: null, vehicleName: '', items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofMark3Submit: vi.fn(() => Promise.resolve({ id: 3, status: 'PENDING' })),
  hofMark3Cancel: vi.fn(() => Promise.resolve({ id: 3, status: 'CANCELLED' })),
  hofMark3MyStatus: vi.fn(() => Promise.resolve({ current: [], pending: [], rejected: [] }))
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    isAuthenticated: () => authenticated,
    login: api.login,
    logout: api.logout,
    initPromise: Promise.resolve(true),
    tokenParsed: ref(tokenClaims)
  })
}))

vi.mock('../api/hall-of-fame.js', () => lbApi)

vi.mock('../utils/helpers.js', () => ({
  mapLabel: () => '',
  fileKey: file => [file.webkitRelativePath || file.name, file.size, file.lastModified].join(':')
}))

vi.mock('../utils/display.js', () => ({
  apiErrorLabel: (t, te, error) => (error?.code ? 'err:' + error.code : 'api-error'),
  replayValueLabel: (t, te, value) => value,
  formatDateTimeMinute: value => value || ''
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: key => key,
    te: () => true
  })
}))


const { mountPage, setFiles, stubDeferredFileReader, pickVehicle, openMark3Submit } = createHoFPageTestHelpers({ HoFPage, DIALOG_INLINE_KEY, vi })

describe('HoFPage', () => {
  beforeEach(() => {
        connectivityState.state.value = 'online'
        connectivityState.settled.value = true
        authenticated = true
        tokenClaims = null
        vi.clearAllMocks()
        lbApi.hofVehicleOptions.mockResolvedValue([])
        lbApi.hofHundredSubmit.mockResolvedValue({ id: 1, status: 'PENDING' })
        lbApi.hofHundredMyStatus.mockResolvedValue({ current: [], pending: [], rejected: [] })
        lbApi.hofMark3List.mockResolvedValue({ vehicleId: null, vehicleName: '', items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })
        lbApi.hofMark3Submit.mockResolvedValue({ id: 3, status: 'PENDING' })
        lbApi.hofMark3MyStatus.mockResolvedValue({ current: [], pending: [], rejected: [] })
  })
  it('submits Mark 3 data with two proofScreenshots and exactly five replays', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openMark3Submit(wrapper)

    const modal = wrapper.find('.mark3-modal')
    await pickVehicle(wrapper, '.mark3-modal .mark3-submit-vehicle', 385)
    await modal.find('#mark3-submit-battles').setValue('86')
    await modal.find('#mark3-submit-damage').setValue('4123')
    await modal.find('#mark3-submit-win-rate').setValue('67.25')
    const inputs = modal.findAll('input[type="file"]')
    await setFiles(inputs[0], [
      new File(['one'], 'start.png', { type: 'image/png', lastModified: 1 }),
      new File(['two'], 'finish.png', { type: 'image/png', lastModified: 2 }),
    ])
    await vi.waitFor(() => expect(modal.findAll('.mark3-proof-item')).toHaveLength(2))
    await setFiles(inputs[1], [1, 2, 3, 4, 5].map(number => new File(
      [`r${number}`], `battle-${number}.wotbreplay`, { lastModified: number }
    )))

    await modal.find('.mark3-modal-submit').trigger('click')
    await flushPromises()

    expect(lbApi.hofMark3Submit).toHaveBeenCalledTimes(1)
    const [formData] = lbApi.hofMark3Submit.mock.calls[0]
    expect(formData.get('vehicleId')).toBe('385')
    expect(formData.get('battleCount')).toBe('86')
    expect(formData.get('averageDamage')).toBe('4123')
    expect(formData.get('winRate')).toBe('67.25')
    const screenshots = formData.getAll('proofScreenshots')
    expect(screenshots).toHaveLength(2)
    expect(screenshots.every(screenshot => String(screenshot).startsWith('data:image/'))).toBe(true)
    expect(formData.getAll('replays')).toHaveLength(5)
  })

  it('rejects over-limit Mark 3 screenshots before opening FileReaders', async () => {
    const readers = stubDeferredFileReader()
    try {
      const wrapper = mountPage()
      await flushPromises()
      await openMark3Submit(wrapper)
      const modal = wrapper.find('.mark3-modal')

      await setFiles(modal.findAll('input[type="file"]')[0], [
        new File(['one'], 'one.png', { type: 'image/png' }),
        new File(['two'], 'two.png', { type: 'image/png' }),
        new File(['three'], 'three.png', { type: 'image/png' }),
      ])

      expect(readers).toHaveLength(0)
      expect(modal.find('.h100-err').text()).toContain('mark3.screenshotLimit')
      expect(modal.findAll('.mark3-proof-item')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('invalidates a pending Mark 3 read when removing an existing screenshot', async () => {
    const readers = stubDeferredFileReader()
    try {
      const wrapper = mountPage()
      await flushPromises()
      await openMark3Submit(wrapper)
      const modal = wrapper.find('.mark3-modal')
      const screenshots = modal.findAll('input[type="file"]')[0]
      const first = new File(['first'], 'first.png', { type: 'image/png', lastModified: 1 })

      await setFiles(screenshots, [first])
      readers[0].result = 'data:image/png;base64,AAAA'
      readers[0].onload()
      await vi.waitFor(() => expect(modal.findAll('.mark3-proof-item')).toHaveLength(1))

      await setFiles(screenshots, [first])
      expect(readers).toHaveLength(1)
      expect(modal.find('.h100-err').text()).toContain('mark3.screenshotDuplicateIgnored')

      await setFiles(screenshots, [
        new File(['second'], 'second.png', { type: 'image/png', lastModified: 2 })
      ])
      expect(readers).toHaveLength(2)
      await modal.find('.mark3-proof-item .h100-remove-file').trigger('click')
      readers[1].result = 'data:image/png;base64,BBBB'
      readers[1].onload()
      await flushPromises()

      expect(modal.find('.h100-file-reading').exists()).toBe(false)
      expect(modal.findAll('.mark3-proof-item')).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves a pending Mark 3 screenshot read after closing the modal', async () => {
    const readers = stubDeferredFileReader()
    try {
      const wrapper = mountPage()
      await flushPromises()
      await openMark3Submit(wrapper)
      await setFiles(
        wrapper.find('.mark3-modal').findAll('input[type="file"]')[0],
        [new File(['proof'], 'late-mark3.png', { type: 'image/png', lastModified: 1 })]
      )
      expect(readers).toHaveLength(1)
      expect(wrapper.find('.h100-file-reading').exists()).toBe(true)

      await wrapper.find('.mark3-submit-overlay').trigger('click')
      expect(wrapper.find('.mark3-submit-overlay').attributes('style')).toContain('display: none')
      readers[0].result = 'data:image/png;base64,AAAA'
      readers[0].onload()
      await flushPromises()

      await openMark3Submit(wrapper)
      const reopened = wrapper.find('.mark3-modal')
      expect(reopened.text()).toContain('late-mark3.png')
      expect(reopened.find('.h100-file-reading').exists()).toBe(false)
      expect(reopened.find('.mark3-modal-submit').attributes('disabled')).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a Mark 3 win rate with more than two decimal places before upload', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openMark3Submit(wrapper)

    const modal = wrapper.find('.mark3-modal')
    await pickVehicle(wrapper, '.mark3-modal .mark3-submit-vehicle', 385)
    await modal.find('#mark3-submit-battles').setValue('86')
    await modal.find('#mark3-submit-damage').setValue('4123')
    await modal.find('#mark3-submit-win-rate').setValue('67.251')
    const inputs = modal.findAll('input[type="file"]')
    await setFiles(inputs[0], [new File(['one'], 'start.png', { type: 'image/png', lastModified: 1 })])
    await vi.waitFor(() => expect(modal.findAll('.mark3-proof-item')).toHaveLength(1))
    await setFiles(inputs[1], [1, 2, 3, 4, 5].map(number => new File(
      [`r${number}`], `battle-${number}.wotbreplay`, { lastModified: number }
    )))

    await modal.find('.mark3-modal-submit').trigger('click')

    expect(modal.text()).toContain('mark3.fillRequired')
    expect(lbApi.hofMark3Submit).not.toHaveBeenCalled()
  })

  it('requires login before opening the Mark 3 submission dialog', async () => {
    authenticated = false
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.tabs button')[2].trigger('click')
    await flushPromises()
    await wrapper.find('.mark3-submit-btn').trigger('click')

    expect(api.login).toHaveBeenCalledWith('hof')
    expect(wrapper.find('.mark3-submit-overlay').attributes('style')).toContain('display: none')
  })

  it('blocks a second Mark 3 submission for a vehicle with a CURRENT record', async () => {
    lbApi.hofMark3MyStatus.mockResolvedValue({
      current: [{ id: 40, vehicleId: 385, vehicleName: 'Progetto 65', status: 'CURRENT', approvedBattleCount: 76, approvedAverageDamage: 4200, approvedWinRate: 68 }],
      pending: [], rejected: [],
    })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.tabs button')[2].trigger('click')
    await flushPromises()
    await pickVehicle(wrapper, '.mark3-pane .mark3-vehicle-select', 385)
    await flushPromises()

    expect(wrapper.find('.mark3-current-card').exists()).toBe(true)
    expect(wrapper.find('.mark3-submit-btn').attributes('disabled')).toBeDefined()
  })
})
