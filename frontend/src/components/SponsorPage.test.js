// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import SponsorPage from './SponsorPage.vue'
import { messages } from '../locales/messages.js'

function mountPage() {
  const i18n = createI18n({ locale: 'zh', fallbackLocale: 'en', messages })
  return mount(SponsorPage, { global: { plugins: [i18n] } })
}

describe('SponsorPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders runtime-configured Alipay and WeChat methods', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        methods: [
          { type: 'alipay', image: '/sponsor-assets/alipay.png' },
          { type: 'wechat', image: '/sponsor-assets/wechat.webp' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPage()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/sponsor-config.json', { cache: 'no-store' })
    expect(wrapper.find('[data-testid="sponsor-methods"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sponsor-methods"]').findAll('img')).toHaveLength(2)
    expect(wrapper.text()).toContain('支付宝')
    expect(wrapper.text()).toContain('微信支付')
    wrapper.unmount()
  })

  it('shows the unconfigured fallback when runtime config is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('[data-testid="sponsor-unconfigured"]').text()).toBe('赞助方式暂未配置')
    expect(wrapper.find('[data-testid="sponsor-methods"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the fallback if every configured QR image fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enabled: true, methods: [{ type: 'alipay', image: '/sponsor-assets/alipay.png' }] }),
    }))

    const wrapper = mountPage()
    await flushPromises()
    await wrapper.get('img').trigger('error')

    expect(wrapper.find('[data-testid="sponsor-unconfigured"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('hides only the failing method and never leaves a broken image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        methods: [
          { type: 'alipay', image: '/sponsor-assets/alipay.png' },
          { type: 'wechat', image: '/sponsor-assets/wechat.webp' },
        ],
      }),
    }))

    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findAll('img')).toHaveLength(2)

    await wrapper.findAll('img')[0].trigger('error')
    await flushPromises()

    // 单张失败只隐藏该方式：另一张仍在，且不出现「暂未配置」兜底。
    const remaining = wrapper.findAll('img')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].attributes('src')).toBe('/sponsor-assets/wechat.webp')
    expect(wrapper.text()).toContain('微信支付')
    expect(wrapper.text()).not.toContain('支付宝')
    expect(wrapper.find('[data-testid="sponsor-unconfigured"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
