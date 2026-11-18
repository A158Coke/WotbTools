// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { ApiError } from '../utils/http.js'
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


const { mountPage, setFiles, stubDeferredFileReader, openHundredSubmit, pickVehicle, pickerLabels, pickerValue } = createHoFPageTestHelpers({ HoFPage, DIALOG_INLINE_KEY, vi })

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
  it('submit modal blocks empty form with required-field error', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()

    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.h100-modal').exists()).toBe(true)

    await wrapper.find('.h100-modal-submit').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('hundred.fillRequired')
    expect(lbApi.hofHundredSubmit).not.toHaveBeenCalled()
  })

  it('keeps the current-page draft and selected files after closing by the backdrop', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openHundredSubmit(wrapper)

    const modal = wrapper.find('.h100-modal')
    await pickVehicle(wrapper, '.h100-modal .h100-submit-vehicle', 385)
    await modal.find('#h100-submit-damage').setValue('4200')
    await modal.find('#h100-submit-battles').setValue('120')
    const proof = new File(['proof'], 'proof.png', { type: 'image/png', lastModified: 1 })
    const replay = new File(['r1'], 'battle-1.wotbreplay', { lastModified: 11 })
    const fileInputs = modal.findAll('input[type="file"]')
    await setFiles(fileInputs[0], [proof])
    await vi.waitFor(() => expect(modal.text()).toContain('proof.png'))
    await setFiles(fileInputs[1], [replay])

    expect(modal.text()).toContain('battle-1.wotbreplay')
    await wrapper.find('.h100-submit-overlay').trigger('click')
    expect(wrapper.find('.h100-submit-overlay').attributes('style')).toContain('display: none')

    const filters = wrapper.findAll('.h100-filter select')
    await filters[0].setValue('UK')
    await filters[1].setValue('TANK_DESTROYER')
    await flushPromises()

    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
    const reopened = wrapper.find('.h100-modal')
    expect(pickerValue(wrapper, '.h100-modal .h100-submit-vehicle')).toBe('385')
    expect(reopened.find('#h100-submit-damage').element.value).toBe('4200')
    expect(reopened.find('#h100-submit-battles').element.value).toBe('120')
    expect(pickerLabels(wrapper, '.h100-modal .h100-submit-vehicle')).toContain('Progetto 65')
    expect(reopened.text()).toContain('proof.png')
    expect(reopened.text()).toContain('battle-1.wotbreplay')
  })

  it('preserves a pending hundred-battle screenshot read after closing the modal', async () => {
    const readers = stubDeferredFileReader()
    try {
      const wrapper = mountPage()
      await flushPromises()
      await openHundredSubmit(wrapper)
      await setFiles(
        wrapper.find('.h100-modal').findAll('input[type="file"]')[0],
        [new File(['proof'], 'late-proof.png', { type: 'image/png', lastModified: 1 })]
      )
      expect(readers).toHaveLength(1)
      expect(wrapper.find('.h100-file-reading').exists()).toBe(true)

      await wrapper.find('.h100-submit-overlay').trigger('click')
      expect(wrapper.find('.h100-submit-overlay').attributes('style')).toContain('display: none')
      readers[0].result = 'data:image/png;base64,AAAA'
      readers[0].onload()
      await flushPromises()

      await openHundredSubmit(wrapper)
      const reopened = wrapper.find('.h100-modal')
      expect(reopened.text()).toContain('late-proof.png')
      expect(reopened.find('.h100-file-reading').exists()).toBe(false)
      expect(reopened.find('.h100-modal-submit').attributes('disabled')).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('invalidates a pending hundred-battle screenshot read when clearing the draft', async () => {
    const readers = stubDeferredFileReader()
    try {
      const wrapper = mountPage()
      await flushPromises()
      await openHundredSubmit(wrapper)
      const modal = wrapper.find('.h100-modal')
      await modal.find('#h100-submit-damage').setValue('4200')
      await setFiles(
        modal.findAll('input[type="file"]')[0],
        [new File(['proof'], 'cleared-proof.png', { type: 'image/png', lastModified: 1 })]
      )
      const confirm = confirmDialog.confirm

      await modal.find('.h100-clear-draft').trigger('click')
      readers[0].result = 'data:image/png;base64,AAAA'
      readers[0].onload()
      await flushPromises()

      expect(modal.find('.h100-file-reading').exists()).toBe(false)
      expect(modal.find('.h100-selected-file').exists()).toBe(false)
      expect(modal.text()).not.toContain('cleared-proof.png')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('appends replay selections in batches, ignores duplicates, and preserves old files on overflow', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openHundredSubmit(wrapper)

    const replayInput = () => wrapper.find('.h100-modal').findAll('input[type="file"]')[1]
    const replay = (number) => new File(
      [`r${number}`], `battle-${number}.wotbreplay`, { lastModified: number }
    )
    const r1 = replay(1)
    await setFiles(replayInput(), [r1])
    await setFiles(replayInput(), [replay(2), replay(3)])
    expect(wrapper.findAll('.h100-selected-files li').map(item => item.text()))
      .toEqual(expect.arrayContaining(['1battle-1.wotbreplay×', '2battle-2.wotbreplay×', '3battle-3.wotbreplay×']))

    await setFiles(replayInput(), [new File(['bad'], 'not-a-replay.txt', { lastModified: 99 })])
    expect(wrapper.findAll('.h100-selected-files li')).toHaveLength(3)
    expect(wrapper.find('.h100-err').text()).toContain('hundred.invalidReplayType')

    await setFiles(replayInput(), [r1, replay(4)])
    expect(wrapper.findAll('.h100-selected-files li')).toHaveLength(4)
    expect(wrapper.find('.h100-err').text()).toContain('hundred.replayDuplicateIgnored')

    await setFiles(replayInput(), [replay(5), replay(6)])
    expect(wrapper.findAll('.h100-selected-files li')).toHaveLength(4)
    expect(wrapper.find('.h100-err').text()).toContain('hundred.replayLimit')

    await wrapper.findAll('.h100-selected-files .h100-remove-file')[1].trigger('click')
    expect(wrapper.findAll('.h100-selected-files li')).toHaveLength(3)
    expect(wrapper.find('.h100-selected-files').text()).not.toContain('battle-2.wotbreplay')
  })

  it('clears the draft only after explicit confirmation', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openHundredSubmit(wrapper)
    await wrapper.find('#h100-submit-damage').setValue('4200')
    await setFiles(
      wrapper.find('.h100-modal').findAll('input[type="file"]')[1],
      [new File(['r1'], 'battle-1.wotbreplay', { lastModified: 1 })]
    )
    const confirm = confirmDialog.confirm

    await wrapper.find('.h100-clear-draft').trigger('click')
    await flushPromises()

    // 应用内确认对话框（审计 PG-09），不再用 window.confirm
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'hundred.clearDraftConfirm', danger: true }))
    expect(wrapper.find('#h100-submit-damage').element.value).toBe('')
    expect(wrapper.find('.h100-selected-files').exists()).toBe(false)
  })

  it('invalidates an older pending screenshot read when a later invalid file is selected', async () => {
    const readers = stubDeferredFileReader()
    try {
      const wrapper = mountPage()
      await flushPromises()
      await openHundredSubmit(wrapper)
      const screenshotInput = () => wrapper.find('.h100-modal').findAll('input[type="file"]')[0]

      await setFiles(screenshotInput(), [
        new File(['valid'], 'first.png', { type: 'image/png', lastModified: 1 })
      ])
      expect(readers).toHaveLength(1)
      expect(wrapper.find('.h100-file-reading').exists()).toBe(true)

      await setFiles(screenshotInput(), [
        new File(['invalid'], 'second.txt', { type: 'text/plain', lastModified: 2 })
      ])
      readers[0].result = 'data:image/png;base64,AAAA'
      readers[0].onload()
      await flushPromises()

      expect(wrapper.find('.h100-file-reading').exists()).toBe(false)
      expect(wrapper.find('.h100-selected-file').exists()).toBe(false)
      expect(wrapper.find('.h100-err').text()).toContain('hundred.invalidImageType')
      expect(wrapper.text()).not.toContain('first.png')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the draft after submit failure and clears it after successful submit', async () => {
    lbApi.hofHundredSubmit
      .mockRejectedValueOnce(new ApiError('UPLOAD_FAILED', 500))
      .mockResolvedValueOnce({ id: 1, status: 'PENDING' })
    const wrapper = mountPage()
    await flushPromises()
    await openHundredSubmit(wrapper)

    const modal = wrapper.find('.h100-modal')
    await pickVehicle(wrapper, '.h100-modal .h100-submit-vehicle', 385)
    await modal.find('#h100-submit-damage').setValue('4200')
    await modal.find('#h100-submit-battles').setValue('120')
    await setFiles(
      modal.findAll('input[type="file"]')[0],
      [new File(['proof'], 'proof.png', { type: 'image/png', lastModified: 1 })]
    )
    await vi.waitFor(() => expect(modal.text()).toContain('proof.png'))
    await setFiles(
      modal.findAll('input[type="file"]')[1],
      [1, 2, 3, 4, 5].map(number => new File(
        [`r${number}`], `battle-${number}.wotbreplay`, { lastModified: number }
      ))
    )

    await wrapper.find('.h100-modal-submit').trigger('click')
    await flushPromises()
    expect(wrapper.find('.h100-modal').exists()).toBe(true)
    expect(wrapper.findAll('.h100-selected-files li')).toHaveLength(5)
    expect(wrapper.find('#h100-submit-damage').element.value).toBe('4200')

    await wrapper.find('.h100-modal-submit').trigger('click')
    await flushPromises()
    expect(wrapper.find('.h100-submit-overlay').attributes('style')).toContain('display: none')

    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
    const reopened = wrapper.find('.h100-modal')
    expect(reopened.find('#h100-submit-damage').element.value).toBe('')
    expect(reopened.find('.h100-selected-files').exists()).toBe(false)
    expect(reopened.find('.h100-selected-file').exists()).toBe(false)
  })
})
