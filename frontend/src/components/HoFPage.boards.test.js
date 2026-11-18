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


const { mountPage, pickVehicle, pickerLabels } = createHoFPageTestHelpers({ HoFPage, DIALOG_INLINE_KEY, vi })

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
  it('passes battle type and nickname filters to hofList', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const singleToolbar = wrapper.findAll('.lb-toolbar')[0]
    const selects = singleToolbar.findAll('select')
    await selects[3].setValue('RATING')
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
    expect(pickerLabels(wrapper, '.hof-vehicle-select')).toEqual(['hof.all_tanks', 'Progetto 65'])
    expect(wrapper.find('.hof-vehicle-select [role="option"][data-id="385"] .vp-hint').text()).toBe('T10 · EUROPE · MEDIUM_TANK')
    expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({
      nation: 'EUROPE', vehicleType: 'MEDIUM_TANK', tier: '10'
    }))
    expect(lbApi.hofList.mock.calls.at(-1)[0].tankId).toBeNull()

    await pickVehicle(wrapper, '.hof-vehicle-select', 385)
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
    expect(tabButtons).toHaveLength(3)
    await tabButtons[1].trigger('click')
    await flushPromises()
    // 切到百场 Tab → 拉取个人 PENDING 状态
    expect(lbApi.hofHundredMyStatus).toHaveBeenCalled()

    expect(wrapper.find('.h100-vehicle-select input[role="combobox"]').exists()).toBe(true)
    // Tier X 全集 + 「默认」选项
    expect(pickerLabels(wrapper, '.h100-vehicle-select').length).toBeGreaterThanOrEqual(86)

    await pickVehicle(wrapper, '.h100-vehicle-select', 385)
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
    expect(pickerLabels(wrapper, '.h100-vehicle-select')[0]).toBe('hundred.default')
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
    expect(pickerLabels(wrapper, '.h100-vehicle-select').length).toBeGreaterThan(1)
    expect(wrapper.find('.h100-search-input').exists()).toBe(false)

    await filters[1].setValue('MEDIUM_TANK')
    await flushPromises()
    await pickVehicle(wrapper, '.h100-vehicle-select', 385)
    expect(lbApi.hofHundredList).toHaveBeenLastCalledWith({
      page: 1, size: 50, nation: 'EUROPE', vehicleType: 'MEDIUM_TANK', vehicleId: 385
    })
  })

  it('loads Mark 3 rows with the same category filters and preserves server competition ranks', async () => {
    lbApi.hofMark3List.mockResolvedValue({
      vehicleId: null,
      vehicleName: '',
      items: [
        { id: 31, rank: 1, vehicleId: 385, vehicleName: 'Progetto 65', nickname: 'Fast', approvedBattleCount: 76, approvedAverageDamage: 4200, approvedWinRate: 68.25, approvedAt: '2026-08-24T00:00:00Z' },
        { id: 32, rank: 1, vehicleId: 385, vehicleName: 'Progetto 65', nickname: 'AlsoFast', approvedBattleCount: 76, approvedAverageDamage: 4100, approvedWinRate: 66.5, approvedAt: '2026-08-25T00:00:00Z' },
      ],
      page: 1, size: 50, totalItems: 2, totalPages: 1,
    })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.tabs button')[2].trigger('click')
    await flushPromises()

    expect(lbApi.hofMark3List).toHaveBeenLastCalledWith({
      page: 1, size: 50, nation: '', vehicleType: '', vehicleId: null,
    })
    expect(wrapper.findAll('.mark3-pane .rk').map(item => item.text())).toEqual(['1', '1'])
    expect(wrapper.text()).toContain(`${(68.25).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`)

    const filters = wrapper.findAll('.mark3-pane .mark3-filter select')
    await filters[0].setValue('EUROPE')
    await flushPromises()
    expect(lbApi.hofMark3List).toHaveBeenLastCalledWith({
      page: 1, size: 50, nation: 'EUROPE', vehicleType: '', vehicleId: null,
    })
  })
})
