// @vitest-environment happy-dom

import {beforeEach, describe, expect, it, vi} from 'vitest'
import {flushPromises, mount} from '@vue/test-utils'
import {ref} from 'vue'
import {ApiError} from '../utils/http.js'
import HoFPage from './HoFPage.vue'

let authenticated = true
const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined))
}))

const lbApi = vi.hoisted(() => ({
  hofList: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
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
  apiErrorLabel: (t, te, error) => (error?.code ? 'err:' + error.code : 'api-error')
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
    const selects = wrapper.findAll('select')
    // 第一个 select 是 battleType
    await selects[0].setValue('RATING')
    const input = wrapper.find('.lb-nick-input')
    await input.setValue('Coke')
    await input.trigger('keyup.enter')
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenLastCalledWith(
      expect.objectContaining({ battleType: 'RATING', nickname: 'Coke' })
    )
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
})
