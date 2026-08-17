// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { ApiError } from '../utils/http.js'
import LeaderboardPage from './LeaderboardPage.vue'

let authenticated = true
const api = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve(undefined))
}))

const lbApi = vi.hoisted(() => ({
  leaderboardTopDamage: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  leaderboardTopDamageByTank: vi.fn(() => Promise.resolve({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 })),
  leaderboardUpload: vi.fn(() => Promise.resolve({ status: 'ok', arenaId: 'a1' })),
  leaderboardDownload: vi.fn(() => Promise.resolve(undefined))
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

describe('LeaderboardPage', () => {
  beforeEach(() => {
    authenticated = true
    vi.clearAllMocks()
  })

  function mountPage() {
    return mount(LeaderboardPage, {
      global: { mocks: { $t: key => key } }
    })
  }

  function makeRow(overrides = {}) {
    return {
      id: 1,
      arenaId: 'arena-1',
      tankId: 6481,
      tankName: 'FV4005',
      accountId: 111,
      nickname: 'Player1',
      damageDealt: 3200,
      mapName: 'rockfield',
      version: '11.18.0',
      battleTime: null,
      createdAt: '2024-07-01T00:00:00Z',
      replayAvailable: false,
      ...overrides
    }
  }

  it('renders download button only for rows with replayAvailable', async () => {
    lbApi.leaderboardTopDamage.mockResolvedValue({
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
    // icon-only 按钮：可访问性靠 title/aria-label，无文字
    expect(buttons[0].attributes('title')).toBe('leaderboard.download')
    expect(buttons[0].attributes('aria-label')).toBe('leaderboard.download')
    expect(buttons[0].text()).not.toContain('leaderboard.download')
    expect(wrapper.findAll('.lb-no-replay')).toHaveLength(1)
  })

  it('triggers login when not authenticated and clicking download', async () => {
    authenticated = false
    lbApi.leaderboardTopDamage.mockResolvedValue({
      items: [makeRow({ id: 1, replayAvailable: true })],
      page: 1, size: 50, totalItems: 1, totalPages: 1
    })
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.find('.lb-download').trigger('click')
    expect(api.login).toHaveBeenCalledWith('leaderboard')
    expect(lbApi.leaderboardDownload).not.toHaveBeenCalled()
  })

  it('triggers login when not authenticated and uploading', async () => {
    authenticated = false
    const wrapper = mountPage()
    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(api.login).toHaveBeenCalledWith('leaderboard')
    expect(lbApi.leaderboardUpload).not.toHaveBeenCalled()
  })

  it('uploads file with valid extension when authenticated', async () => {
    const wrapper = mountPage()
    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(lbApi.leaderboardUpload).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('leaderboard.upload_success')
  })

  it('shows NON_RANDOM_BATTLE business error, never network error, and does not treat upload as success', async () => {
    lbApi.leaderboardUpload.mockRejectedValue(new ApiError('NON_RANDOM_BATTLE', 400))
    const wrapper = mountPage()
    await flushPromises()
    const input = wrapper.find('input[type="file"]')
    const file = new File([new Uint8Array([1, 2, 3])], 'battle.wotbreplay', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    const msg = wrapper.find('.lb-upload-msg')
    expect(msg.exists()).toBe(true)
    // apiErrorLabel 输出 locale 对应业务错误（mock 返回 'err:NON_RANDOM_BATTLE'）
    expect(msg.text()).toContain('err:NON_RANDOM_BATTLE')
    expect(msg.text()).not.toContain('network')
    // uploadOk === false → 消息按错误样式渲染
    expect(msg.classes()).toContain('err')
    // 不得显示上传成功
    expect(wrapper.text()).not.toContain('leaderboard.upload_success')
    // 失败不得触发排行榜刷新当作成功处理（仅 mounted 时加载一次）
    expect(lbApi.leaderboardTopDamage).toHaveBeenCalledTimes(1)
  })
})
