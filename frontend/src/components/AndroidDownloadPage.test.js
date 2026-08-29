// @vitest-environment happy-dom

import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AndroidDownloadPage from './AndroidDownloadPage.vue'
import { messages } from '../locales/messages.js'

const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages })

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
  })

  it('renders latest version and SHA from the manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(manifestResponse()))
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.text()).toContain('1.2.0')
    expect(wrapper.text()).toContain('abc123')
    const link = wrapper.find('[data-testid="android-download-link"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toContain('wotbtools-android-v1.2.0.apk')
  })

  it('shows unavailable message when the manifest fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const wrapper = mount(AndroidDownloadPage, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="android-unavailable"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Android 版本信息暂未配置')
  })
})
