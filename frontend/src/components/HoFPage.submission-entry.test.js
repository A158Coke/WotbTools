// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
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


const { mountPage, makeRow, openSingleUpload, openHundredSubmit, pickVehicle, openMark3Submit } = createHoFPageTestHelpers({ HoFPage, DIALOG_INLINE_KEY, vi })

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
  it('shows ranking rules in every submit dialog', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openSingleUpload(wrapper)
    expect(wrapper.find('[data-testid="hof-rules-single"]').text()).toContain('hofRules.single.recorder')
    await openHundredSubmit(wrapper)
    expect(wrapper.find('[data-testid="hof-rules-hundred"]').text()).toContain('hofRules.hundred.higher')
    expect(wrapper.find('.h100-modal').text()).not.toContain('hundred.claimedDamageHint')
    await openMark3Submit(wrapper)
    expect(wrapper.find('[data-testid="hof-rules-mark3"]').text()).toContain('hofRules.mark3.once')
  })


  it('focuses the visible upload control and closes the submit dialog with Escape', async () => {
    const wrapper = mount(HoFPage, {
      attachTo: document.body,
      global: { mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } }
    })
    try {
      await flushPromises()
      const trigger = wrapper.find('.lb-submit-row button.filebtn')
      trigger.element.focus()
      await openSingleUpload(wrapper)
      const dialog = document.querySelector('.hof-upload-modal[role="dialog"]')
      expect(dialog).not.toBeNull()
      const pick = wrapper.find('.hof-upload-modal button.filebtn').element
      expect(document.activeElement).toBe(pick)
      const input = wrapper.find('.hof-upload-modal input[type="file"]')
      expect(input.attributes('tabindex')).toBe('-1')
      expect(input.attributes('aria-hidden')).toBe('true')
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(document.querySelector('.hof-upload-modal')).toBeNull()
      expect(document.activeElement).toBe(trigger.element)
    } finally {
      wrapper.unmount()
      document.body.innerHTML = ''
    }
  })

  it('describes the hundred-battle threshold from the user\'s own current record', async () => {
    lbApi.hofHundredMyStatus.mockResolvedValue({
      current: [{ id: 5, vehicleId: 385, vehicleName: 'Progetto 65', status: 'CURRENT', approvedAverageDamage: 3800, approvedBattleCount: 110 }],
      pending: [], rejected: [],
    })
    const wrapper = mountPage()
    await flushPromises()
    await openHundredSubmit(wrapper)
    const threshold = () => wrapper.find('[data-testid="hundred-threshold"]').text()
    expect(threshold()).toContain('hofRules.threshold.chooseVehicle')

    await pickVehicle(wrapper, '.h100-modal .h100-submit-vehicle', 385)
    expect(threshold()).toContain('hofRules.threshold.hundredCurrent')

    const other = wrapper.findAll('.h100-modal .h100-submit-vehicle [role="option"]')
      .map(option => option.attributes('data-id'))
      .find(id => id !== '385')
    await pickVehicle(wrapper, '.h100-modal .h100-submit-vehicle', other)
    expect(threshold()).toContain('hofRules.threshold.hundredFirst')
  })

  it('describes the Mark 3 threshold as a first record when the user has none for the vehicle', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openMark3Submit(wrapper)
    await pickVehicle(wrapper, '.mark3-modal .mark3-submit-vehicle', 385)
    expect(wrapper.find('[data-testid="mark3-threshold"]').text()).toContain('hofRules.threshold.mark3First')
  })

  it('triggers login when not authenticated and clicking download', async () => {
    authenticated = false
    lbApi.hofList.mockResolvedValue({
      items: [makeRow({ id: 1, replayAvailable: true })],
      page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.lb-download').trigger('click')
    expect(api.login).toHaveBeenCalledWith('hof')
    expect(lbApi.hofDownload).not.toHaveBeenCalled()
  })

  it('unauthenticated upload button click → login BEFORE file picker', async () => {
    authenticated = false
    const wrapper = mountPage()
    await flushPromises()
    await openSingleUpload(wrapper)
    const input = wrapper.find('.hof-upload-modal input[type="file"]')
    const clickSpy = vi.spyOn(input.element, 'click')
    await wrapper.find('.hof-upload-modal button.filebtn').trigger('click')
    expect(api.login).toHaveBeenCalledWith('hof')
    expect(clickSpy).not.toHaveBeenCalled()
    expect(lbApi.hofUpload).not.toHaveBeenCalled()
  })

  it('authenticated upload button click → opens the hidden file input', async () => {
    authenticated = true
    const wrapper = mountPage()
    await flushPromises()
    await openSingleUpload(wrapper)
    const input = wrapper.find('.hof-upload-modal input[type="file"]')
    const clickSpy = vi.spyOn(input.element, 'click')
    await wrapper.find('.hof-upload-modal button.filebtn').trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(lbApi.hofUpload).not.toHaveBeenCalled()
  })

  it('unauthenticated drag/drop → login, never calls upload API', async () => {
    authenticated = false
    const wrapper = mountPage()
    await flushPromises()
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    await openSingleUpload(wrapper)
    await wrapper.find('.hof-upload-modal .lb-upload-section').trigger('drop', { dataTransfer: { files: [file] } })
    expect(api.login).toHaveBeenCalledWith('hof')
    expect(lbApi.hofUpload).not.toHaveBeenCalled()
  })

  it('uploads file with valid extension when authenticated', async () => {
    const wrapper = mountPage()
    await openSingleUpload(wrapper)
    const input = wrapper.find('.hof-upload-modal input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(lbApi.hofUpload).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('hof.upload_success')
  })

  it('an already-recorded battle is reported as such, not as a new Hall of Fame entry', async () => {
    lbApi.hofUpload.mockResolvedValueOnce({ status: 'already_recorded', arenaId: 'a1' })
    const wrapper = mountPage()
    await flushPromises()
    await openSingleUpload(wrapper)
    const input = wrapper.find('.hof-upload-modal input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    const msg = wrapper.find('.lb-upload-msg')
    expect(msg.text()).toBe('hof.upload_already_recorded')
    expect(msg.classes()).not.toContain('err')
    expect(wrapper.text()).not.toContain('hof.upload_success')
  })

  it('the upload button is reset when the result message appears, even while the leaderboard reloads', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openSingleUpload(wrapper)
    let finishReload
    lbApi.hofList.mockImplementationOnce(() => new Promise((resolve) => { finishReload = resolve }))
    const input = wrapper.find('.hof-upload-modal input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('hof.upload_success')
    expect(wrapper.text()).not.toContain('hof.uploading')
    finishReload({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })
    await flushPromises()
  })

  it('shows UNSUPPORTED_BATTLE_TYPE business error, never network error', async () => {
    lbApi.hofUpload.mockRejectedValue(new ApiError('UNSUPPORTED_BATTLE_TYPE', 400))
    const wrapper = mountPage()
    await flushPromises()
    await openSingleUpload(wrapper)
    const input = wrapper.find('.hof-upload-modal input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    const msg = wrapper.find('.lb-upload-msg')
    expect(msg.exists()).toBe(true)
    expect(msg.text()).toContain('err:UNSUPPORTED_BATTLE_TYPE')
    expect(msg.text()).not.toContain('network')
    expect(msg.classes()).toContain('err')
    expect(wrapper.text()).not.toContain('hof.upload_success')
    expect(lbApi.hofList).toHaveBeenCalledTimes(1)
  })
})
