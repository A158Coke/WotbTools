// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
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


const { mountPage, makeRow, openSingleUpload } = createHoFPageTestHelpers({ HoFPage, DIALOG_INLINE_KEY, vi })

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
  it.each(['offline', 'unknown', 'degraded', 'service-unavailable'])('HoF deep entry and all boards issue zero requests in %s', async (state) => {
    connectivityState.state.value = state
    authenticated = false
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="hof-connectivity"]').exists()).toBe(true)
    await wrapper.findAll('.tabs button')[1].trigger('click')
    await wrapper.findAll('.tabs button')[2].trigger('click')
    await openSingleUpload(wrapper)
    await flushPromises()
    for (const call of Object.values(lbApi)) expect(call).not.toHaveBeenCalled()
    expect(api.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('cold-start ?view=hof shows no connectivity verdict and issues no request until detection settles, then loads once', async () => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="hof-connectivity"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('connectivityNotice.')
    for (const call of Object.values(lbApi)) expect(call).not.toHaveBeenCalled()

    connectivityState.settled.value = true
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.find('[data-testid="hof-connectivity"]').exists()).toBe(false)
    expect(lbApi.hofList).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('cold-start ?view=hof settling UNKNOWN shows the real unknown banner without any request', async () => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="hof-connectivity"]').exists()).toBe(false)

    connectivityState.settled.value = true
    await flushPromises()
    expect(wrapper.get('[data-testid="hof-connectivity"]').text()).toContain('connectivityNotice.unknown')
    for (const call of Object.values(lbApi)) expect(call).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('resumes the currently blocked hundred board once on reconnect, preserving the selected tab', async () => {
    connectivityState.state.value = 'offline'
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.tabs button')[1].trigger('click')
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenCalledTimes(1)
    expect(lbApi.hofHundredMyStatus).toHaveBeenCalledTimes(1)
    expect(lbApi.hofList).not.toHaveBeenCalled()
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

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


  it('formats the game version column and shows total records with page numbers', async () => {
    lbApi.hofList.mockResolvedValue({
      items: [makeRow({ id: 1, version: '10.6.0_apple' }), makeRow({ id: 2, version: '' })],
      page: 1, size: 50, totalItems: 120, totalPages: 3,
    })
    const wrapper = mountPage()
    await flushPromises()
    const versions = wrapper.findAll('.lb-version').map(cell => cell.text())
    expect(versions).toEqual(['10.6.0', '-'])
    expect(wrapper.find('[data-testid="hof-pager"]').text()).toContain('hofPager.summary')
    expect(wrapper.find('[data-testid="hof-pager"]').findAll('button')).toHaveLength(3)
  })

  it('shows only the page number when the API omits the total, and no page buttons for one page', async () => {
    lbApi.hofList.mockResolvedValue({ items: [makeRow()], page: 1, size: 50, totalPages: 1 })
    const wrapper = mountPage()
    await flushPromises()
    const pager = wrapper.find('[data-testid="hof-pager"]')
    expect(pager.text()).toBe('hofPager.pages')
    expect(pager.findAll('button')).toHaveLength(0)
  })


  it('scrolls the active board back into view on page change and keeps stale rows while loading', async () => {
    lbApi.hofList.mockResolvedValue({ items: [makeRow()], page: 1, size: 50, totalItems: 60, totalPages: 2 })
    const wrapper = mountPage()
    await flushPromises()
    const board = wrapper.find('[data-hof-pane="single"] [data-hof-board]')
    const scrollIntoView = vi.fn()
    board.element.scrollIntoView = scrollIntoView
    board.element.getBoundingClientRect = () => ({ top: -200, bottom: 300, left: 0, right: 0, width: 0, height: 500 })

    let resolveNext
    lbApi.hofList.mockReturnValueOnce(new Promise(resolve => { resolveNext = resolve }))
    await wrapper.find('[data-testid="hof-pager"] > button:last-child').trigger('click')
    await flushPromises()
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
    expect(wrapper.find('[data-hof-pane="single"] .tablewrap').classes()).toContain('is-stale')
    expect(wrapper.findAll('[data-hof-pane="single"] tbody tr')).toHaveLength(1)
    resolveNext({ items: [makeRow({ id: 3 })], page: 2, size: 50, totalItems: 60, totalPages: 2 })
    await flushPromises()
    expect(wrapper.find('[data-hof-pane="single"] .tablewrap').classes()).not.toContain('is-stale')
  })


  it('jumps straight to the requested page from the single-board pager', async () => {
    lbApi.hofList.mockResolvedValue({ items: [makeRow()], page: 1, size: 50, totalItems: 6000, totalPages: 120 })
    const wrapper = mountPage()
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenCalledTimes(1)

    const input = wrapper.find('[data-testid="hof-pager"] .page-jump input')
    await input.setValue('42')
    await wrapper.find('[data-testid="hof-pager"] .page-jump button').trigger('click')
    await flushPromises()

    expect(lbApi.hofList).toHaveBeenCalledTimes(2)
    expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 42 }))
    expect(input.element.value).toBe('')
  })

  it('jumps with Enter and ignores blank / out-of-range / non-integer / current page input', async () => {
    lbApi.hofList.mockResolvedValue({ items: [makeRow()], page: 1, size: 50, totalItems: 6000, totalPages: 120 })
    const wrapper = mountPage()
    await flushPromises()
    const input = wrapper.find('[data-testid="hof-pager"] .page-jump input')
    const jumpButton = wrapper.find('[data-testid="hof-pager"] .page-jump button')

    for (const raw of ['', '0', '121', '2.5', 'abc']) {
      await input.setValue(raw)
      await input.trigger('keydown.enter')
      await jumpButton.trigger('click')
      await flushPromises()
      expect(lbApi.hofList).toHaveBeenCalledTimes(1)
    }

    await input.setValue('1')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenCalledTimes(1)

    await input.setValue('7')
    await input.trigger('keydown.enter')
    await flushPromises()
    expect(lbApi.hofList).toHaveBeenCalledTimes(2)
    expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 7 }))
  })

  it('jumps straight to the requested page on the hundred and mark3 boards', async () => {
    lbApi.hofHundredList.mockResolvedValue({
      vehicleId: null, vehicleName: '',
      items: [{ id: 1, rank: 1, nickname: 'hundred', vehicleName: 'FV4005', approvedBattleCount: 100, approvedAverageDamage: 3000, approvedAt: null }],
      page: 1, size: 50, totalItems: 6000, totalPages: 120,
    })
    lbApi.hofMark3List.mockResolvedValue({
      vehicleId: null, vehicleName: '',
      items: [{ id: 2, rank: 1, nickname: 'mark3', vehicleName: 'FV4005', approvedBattleCount: 90, approvedAverageDamage: 3000, approvedWinRate: 60, approvedAt: null }],
      page: 1, size: 50, totalItems: 6000, totalPages: 120,
    })
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('.tabs button')[1].trigger('click')
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenCalledTimes(1)
    const hundredInput = wrapper.find('[data-testid="hundred-pager"] .page-jump input')
    await hundredInput.setValue('9')
    await hundredInput.trigger('keydown.enter')
    await flushPromises()
    expect(lbApi.hofHundredList).toHaveBeenCalledTimes(2)
    expect(lbApi.hofHundredList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 9 }))

    await wrapper.findAll('.tabs button')[2].trigger('click')
    await flushPromises()
    expect(lbApi.hofMark3List).toHaveBeenCalledTimes(1)
    const mark3Input = wrapper.find('[data-testid="mark3-pager"] .page-jump input')
    await mark3Input.setValue('11')
    await mark3Input.trigger('keydown.enter')
    await flushPromises()
    expect(lbApi.hofMark3List).toHaveBeenCalledTimes(2)
    expect(lbApi.hofMark3List).toHaveBeenLastCalledWith(expect.objectContaining({ page: 11 }))
  })

  it('keeps the jumped page in the HoF URL state', async () => {
    const { createMemoryHistory, createRouter } = await import('vue-router')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push({ path: '/', query: { view: 'hof' } })
    await router.isReady()
    lbApi.hofList.mockResolvedValue({ items: [makeRow()], page: 1, size: 50, totalItems: 6000, totalPages: 120 })

    const wrapper = mount(HoFPage, {
      global: { plugins: [router], mocks: { $t: key => key }, provide: { [DIALOG_INLINE_KEY]: true } },
    })
    try {
      await flushPromises()
      expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))

      const input = wrapper.find('[data-testid="hof-pager"] .page-jump input')
      await input.setValue('42')
      await input.trigger('keydown.enter')
      await flushPromises()

      expect(lbApi.hofList).toHaveBeenCalledTimes(2)
      expect(lbApi.hofList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 42 }))
      expect(router.currentRoute.value.query.page).toBe('42')
    } finally {
      wrapper.unmount()
    }
  })

})
