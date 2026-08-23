// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { ApiError } from '../utils/http.js'
import HoFPage from './HoFPage.vue'

let authenticated = true
const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined))
}))

const lbApi = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofVehicleOptions: vi.fn(() => Promise.resolve([])),
  hofUpload: vi.fn(() => Promise.resolve({ status: 'ok', arenaId: 'a1' })),
  hofDownload: vi.fn(() => Promise.resolve(undefined)),
  hofHundredList: vi.fn(() => Promise.resolve({ vehicleId: null, vehicleName: '', items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  hofHundredSubmit: vi.fn(() => Promise.resolve({ id: 1, status: 'PENDING' })),
  hofHundredCancel: vi.fn(() => Promise.resolve({ id: 1, status: 'CANCELLED' })),
  hofHundredMyStatus: vi.fn(() => Promise.resolve({ current: [], pending: [], rejected: [] }))
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    isAuthenticated: () => authenticated,
    login: api.login,
    initPromise: Promise.resolve(true)
  })
}))

vi.mock('../utils/api.js', () => lbApi)

vi.mock('../utils/helpers.js', () => ({
  mapLabel: () => ''
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

describe('HoFPage', () => {
  beforeEach(() => {
    authenticated = true
    vi.clearAllMocks()
    lbApi.hofVehicleOptions.mockResolvedValue([])
    lbApi.hofHundredSubmit.mockResolvedValue({ id: 1, status: 'PENDING' })
  })

  function mountPage() {
    return mount(HoFPage, {
      global: { mocks: { $t: key => key } }
    })
  }

  function makeRow(overrides = {}) {
    return {
      id: 1,
      rank: 1,
      tankId: 6481,
      tankName: 'FV4005',
      nickname: 'Player1',
      damageDealt: 3200,
      battleType: 'RANDOM',
      mapName: 'rockfield',
      version: '11.18.0',
      battleTime: null,
      createdAt: '2024-07-01T00:00:00Z',
      replayAvailable: false,
      ...overrides
    }
  }

  async function setFiles(input, files) {
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  async function openHundredSubmit(wrapper) {
    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()
    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
  }

  it('renders download button only for rows with replayAvailable', async () => {
    lbApi.hofList.mockResolvedValue({
      items: [
        makeRow({ id: 1, replayAvailable: true }),
        makeRow({ id: 2, replayAvailable: false })
      ],
      page: 1, size: 50, totalItems: 2, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    const buttons = wrapper.findAll('.lb-download')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].attributes('title')).toBe('hof.download')
    expect(buttons[0].attributes('aria-label')).toBe('hof.download')
    expect(wrapper.findAll('.lb-no-replay')).toHaveLength(1)
  })

  it('shows battle type badge per row', async () => {
    lbApi.hofList.mockResolvedValue({
      items: [
        makeRow({ id: 1, battleType: 'RATING' }),
        makeRow({ id: 2, battleType: 'RANDOM' })
      ],
      page: 1, size: 50, totalItems: 2, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    const badges = wrapper.findAll('.bt-badge')
    expect(badges).toHaveLength(2)
    expect(badges[0].classes()).toContain('bt-rating')
    expect(badges[1].classes()).toContain('bt-random')
  })

  it('passes battle type and nickname filters to hofList', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const singleToolbar = wrapper.findAll('.lb-toolbar')[0]
    const selects = singleToolbar.findAll('select')
    await selects[4].setValue('RATING')
    const input = singleToolbar.find('.lb-nick-input')
    await input.setValue('Coke')
    await input.trigger('keyup.enter')
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenLastCalledWith(
      expect.objectContaining({ battleType: 'RATING', nickname: 'Coke' })
    )
  })

  it('single-battle vehicle conditions independently filter the leaderboard and intersect vehicle choices', async () => {
    lbApi.hofVehicleOptions.mockResolvedValue([
      { tankId: 385, tankName: 'Progetto 65', nation: 'EUROPE', type: 'MEDIUM_TANK', tier: 10 },
      { tankId: 999, tankName: 'European IX', nation: 'EUROPE', type: 'MEDIUM_TANK', tier: 9 },
      { tankId: 6481, tankName: 'FV4005', nation: 'UK', type: 'TANK_DESTROYER', tier: 10 }
    ])
    const wrapper = mountPage()
    await flushPromises()

    let selects = wrapper.findAll('.lb-toolbar')[0].findAll('select')
    await selects[2].setValue('10')
    await selects[0].setValue('EUROPE')
    await selects[1].setValue('MEDIUM_TANK')
    await flushPromises()

    selects = wrapper.findAll('.lb-toolbar')[0].findAll('select')
    expect(selects[0].element.value).toBe('EUROPE')
    expect(selects[1].element.value).toBe('MEDIUM_TANK')
    expect(selects[2].element.value).toBe('10')
    expect(selects[1].findAll('option').map(option => option.attributes('value')))
      .toEqual(['', 'MEDIUM_TANK', 'TANK_DESTROYER'])
    expect(selects[3].findAll('option').map(option => option.text()))
      .toEqual(['hof.all_tanks', 'Progetto 65 · T10'])
    expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({
      nation: 'EUROPE', vehicleType: 'MEDIUM_TANK', tier: '10'
    }))
    expect(lbApi.hofList.mock.calls.at(-1)[0].tankId).toBeNull()

    await selects[3].setValue('385')
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({
      nation: 'EUROPE', vehicleType: 'MEDIUM_TANK', tier: '10', tankId: 385
    }))

    await selects[2].setValue('9')
    await flushPromises()
    expect(selects[0].element.value).toBe('EUROPE')
    expect(selects[1].element.value).toBe('MEDIUM_TANK')
    expect(lbApi.hofList.mock.calls.at(-1)[0].tankId).toBeNull()
    expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({
      nation: 'EUROPE', vehicleType: 'MEDIUM_TANK', tier: '9'
    }))
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
    const input = wrapper.find('input[type="file"]')
    const clickSpy = vi.spyOn(input.element, 'click')
    await wrapper.find('button.filebtn').trigger('click')
    expect(api.login).toHaveBeenCalledWith('hof')
    expect(clickSpy).not.toHaveBeenCalled()
    expect(lbApi.hofUpload).not.toHaveBeenCalled()
  })

  it('authenticated upload button click → opens the hidden file input', async () => {
    authenticated = true
    const wrapper = mountPage()
    await flushPromises()
    const input = wrapper.find('input[type="file"]')
    const clickSpy = vi.spyOn(input.element, 'click')
    await wrapper.find('button.filebtn').trigger('click')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(lbApi.hofUpload).not.toHaveBeenCalled()
  })

  it('unauthenticated drag/drop → login, never calls upload API', async () => {
    authenticated = false
    const wrapper = mountPage()
    await flushPromises()
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    await wrapper.find('.lb-upload-section').trigger('drop', { dataTransfer: { files: [file] } })
    expect(api.login).toHaveBeenCalledWith('hof')
    expect(lbApi.hofUpload).not.toHaveBeenCalled()
  })

  it('uploads file with valid extension when authenticated', async () => {
    const wrapper = mountPage()
    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(lbApi.hofUpload).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('hof.upload_success')
  })

  it('shows UNSUPPORTED_BATTLE_TYPE business error, never network error', async () => {
    lbApi.hofUpload.mockRejectedValue(new ApiError('UNSUPPORTED_BATTLE_TYPE', 400))
    const wrapper = mountPage()
    await flushPromises()
    const input = wrapper.find('input[type="file"]')
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

  it('switches to 百场 tab and renders vehicle selector with leaderboard rows', async () => {
    // 钉死单场 Tab 为空，避免前序用例泄漏的 hofList mock 干扰 .rk 计数
    lbApi.hofList.mockResolvedValue({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })
    lbApi.hofHundredList.mockResolvedValue({
      vehicleId: 385,
      vehicleName: 'Progetto 65',
      items: [
        {
          id: 11, rank: 1, vehicleId: 385, vehicleName: 'Progetto 65', nickname: 'Coke',
          approvedAverageDamage: 3200, approvedBattleCount: 100, approvedAt: '2024-07-01T00:00:00Z'
        },
        {
          id: 12, rank: 2, vehicleId: 385, vehicleName: 'Progetto 65', nickname: 'Player2',
          approvedAverageDamage: 3100, approvedBattleCount: 102, approvedAt: '2024-06-20T00:00:00Z'
        }
      ],
      page: 1, size: 50, totalItems: 2, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()

    const tabButtons = wrapper.findAll('.tabs button')
    expect(tabButtons).toHaveLength(2)
    await tabButtons[1].trigger('click')
    await flushPromises()
    // 切到百场 Tab → 拉取个人 PENDING 状态
    expect(lbApi.hofHundredMyStatus).toHaveBeenCalled()

    const select = wrapper.find('.h100-vehicle-select')
    expect(select.exists()).toBe(true)
    // Tier X 全集 + 占位 option
    expect(select.findAll('option').length).toBeGreaterThanOrEqual(85)

    await select.setValue('385')
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenLastCalledWith(
      expect.objectContaining({ vehicleId: 385, page: 1, size: 50 })
    )
    expect(wrapper.findAll('.h100-pane .rk')).toHaveLength(2)
    expect(wrapper.text()).toContain('Coke')
    expect(wrapper.text()).toContain('Player2')
  })

  it('loads the global top-ten default view without a vehicle filter', async () => {
    lbApi.hofHundredList.mockResolvedValue({
      vehicleId: null,
      vehicleName: null,
      items: [{
        id: 21, rank: 1, vehicleId: 385, vehicleName: 'Progetto 65', nickname: 'GlobalTop',
        approvedAverageDamage: 4800, approvedBattleCount: 200, approvedAt: '2024-07-01T00:00:00Z'
      }],
      page: 1, size: 10, totalItems: 1, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()

    expect(lbApi.hofHundredList).toHaveBeenLastCalledWith({
      page: 1, size: 50, nation: '', vehicleType: '', vehicleId: null
    })
    expect(wrapper.find('.h100-vehicle-select option').text()).toBe('hundred.default')
    expect(wrapper.text()).toContain('Progetto 65')
    expect(wrapper.text()).toContain('GlobalTop')
  })

  it('applies optional hundred-battle category filters to the leaderboard and vehicle choices', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()

    const filters = wrapper.findAll('.h100-filter select')
    expect(filters).toHaveLength(2)
    expect(filters[0].find('option').text()).toBe('hundred.allNations')
    expect(filters[1].find('option').text()).toBe('hundred.allVehicleTypes')

    await filters[0].setValue('EUROPE')
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenLastCalledWith({
      page: 1, size: 50, nation: 'EUROPE', vehicleType: '', vehicleId: null
    })
    expect(wrapper.find('.h100-vehicle-select').findAll('option').length).toBeGreaterThan(1)
    expect(wrapper.find('.h100-search-input').exists()).toBe(false)

    await filters[1].setValue('MEDIUM_TANK')
    await flushPromises()
    const vehicleSelect = wrapper.find('.h100-vehicle-select')
    await vehicleSelect.setValue('385')
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenLastCalledWith({
      page: 1, size: 50, nation: 'EUROPE', vehicleType: 'MEDIUM_TANK', vehicleId: 385
    })
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
    await modal.find('select').setValue('385')
    await modal.find('#h100-submit-damage').setValue('4200')
    await modal.find('#h100-submit-battles').setValue('120')
    const proof = new File(['proof'], 'proof.png', { type: 'image/png', lastModified: 1 })
    const replay = new File(['r1'], 'battle-1.wotbreplay', { lastModified: 11 })
    const fileInputs = modal.findAll('input[type="file"]')
    await setFiles(fileInputs[0], [proof])
    await vi.waitFor(() => expect(modal.text()).toContain('proof.png'))
    await setFiles(fileInputs[1], [replay])

    expect(modal.text()).toContain('battle-1.wotbreplay')
    await wrapper.find('.modal-overlay').trigger('click')
    expect(wrapper.find('.h100-modal').exists()).toBe(false)

    const filters = wrapper.findAll('.h100-filter select')
    await filters[0].setValue('UK')
    await filters[1].setValue('TANK_DESTROYER')
    await flushPromises()

    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
    const reopened = wrapper.find('.h100-modal')
    expect(reopened.find('select').element.value).toBe('385')
    expect(reopened.find('#h100-submit-damage').element.value).toBe('4200')
    expect(reopened.find('#h100-submit-battles').element.value).toBe('120')
    expect(reopened.find('select').findAll('option').map(option => option.text())).toContain('Progetto 65')
    expect(reopened.text()).toContain('proof.png')
    expect(reopened.text()).toContain('battle-1.wotbreplay')
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
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await wrapper.find('.h100-clear-draft').trigger('click')

    expect(confirm).toHaveBeenCalledWith('hundred.clearDraftConfirm')
    expect(wrapper.find('#h100-submit-damage').element.value).toBe('')
    expect(wrapper.find('.h100-selected-files').exists()).toBe(false)
    confirm.mockRestore()
  })

  it('invalidates an older pending screenshot read when a later invalid file is selected', async () => {
    const readers = []
    class DeferredFileReader {
      constructor() {
        this.onload = null
        this.onerror = null
        this.result = null
        readers.push(this)
      }

      readAsDataURL() {}
    }
    vi.stubGlobal('FileReader', DeferredFileReader)
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
    await modal.find('select').setValue('385')
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
    expect(wrapper.find('.h100-modal').exists()).toBe(false)

    await wrapper.find('.h100-submit-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('#h100-submit-damage').element.value).toBe('')
    expect(wrapper.find('.h100-selected-files').exists()).toBe(false)
    expect(wrapper.find('.h100-selected-file').exists()).toBe(false)
  })
})
