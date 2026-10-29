// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AndroidDownloadPage from './AndroidDownloadPage.vue'
import { messages } from '../locales/messages.js'

const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages })

const telemetry = vi.hoisted(() => ({ post: vi.fn(() => Promise.resolve()) }))
vi.mock('../api/usage-events.js', () => ({ postUsageEvents: telemetry.post }))

function manifestResponse() {
  return {
    ok: true,
    json: async () => ({
      latestVersionName: '1.2.0',
      apkUrl: 'https://wotbtools.com/download/android/wotbtools-android-v1.2.0.apk',
      sha256: 'abc123',
      releaseNotes: '修复 Android 回放导入问题',
      publishedAt: '2026-08-28T00:00:00Z',
    }),
  }
}

describe('AndroidDownloadPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    telemetry.post.mockReset().mockResolvedValue(undefined)
  })

  it('renders latest version and SHA from the public manifest without auth', async () => {
    const fetch = vi.fn().mockResolvedValue(manifestResponse())
    vi.stubGlobal('fetch', fetch)
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toEqual({ credentials: 'omit' })
    expect(wrapper.text()).toContain('1.2.0')
    expect(wrapper.text()).toContain('abc123')
    const link = wrapper.find('[data-testid="android-download-link"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toContain('wotbtools-android-v1.2.0.apk')
    expect(wrapper.find('[data-testid="android-login-required"]').exists()).toBe(false)
    expect(telemetry.post).not.toHaveBeenCalled()
  })

  it('records exactly one aggregate event with the exact Android download payload per final-button click', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(manifestResponse()))
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(telemetry.post).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="android-download-link"]').trigger('click')

    expect(telemetry.post).toHaveBeenCalledTimes(1)
    const [events] = telemetry.post.mock.calls[0]
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      event: 'android_download_click',
      platform: 'web',
      feature: 'android_download',
      occurred_at: expect.any(String),
    })
    expect(Number.isNaN(Date.parse(events[0].occurred_at))).toBe(false)
  })

  it('counts every repeated final-button click without deduplicating', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(manifestResponse()))
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()

    const link = wrapper.get('[data-testid="android-download-link"]')
    await link.trigger('click')
    await link.trigger('click')

    expect(telemetry.post).toHaveBeenCalledTimes(2)
    for (const [events] of telemetry.post.mock.calls) expect(events).toHaveLength(1)
    const first = telemetry.post.mock.calls[0][0][0]
    const second = telemetry.post.mock.calls[1][0][0]
    expect(first.event_id).not.toBe(second.event_id)
    expect(first).toMatchObject({ event: 'android_download_click', platform: 'web', feature: 'android_download' })
    expect(second).toMatchObject({ event: 'android_download_click', platform: 'web', feature: 'android_download' })
  })

  it('starts the APK navigation even when telemetry throws or rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(manifestResponse()))
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()

    const link = wrapper.get('[data-testid="android-download-link"]')
    let prevented = true
    link.element.addEventListener('click', event => { prevented = event.defaultPrevented }, { once: true })
    telemetry.post
      .mockImplementationOnce(() => { throw new Error('synchronous telemetry failure') })
      .mockImplementationOnce(() => Promise.reject(new Error('asynchronous telemetry failure')))
    await link.trigger('click')
    await link.trigger('click')
    await flushPromises()

    expect(telemetry.post).toHaveBeenCalledTimes(2)
    expect(prevented).toBe(false)
    expect(wrapper.get('[data-testid="android-download-link"]').attributes('href'))
      .toContain('wotbtools-android-v1.2.0.apk')
  })

  it('shows unavailable message when the manifest fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="android-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Android 版本信息暂未配置')
    expect(telemetry.post).not.toHaveBeenCalled()
  })
})
