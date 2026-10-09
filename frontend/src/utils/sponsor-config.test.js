import { describe, expect, it, vi } from 'vitest'
import { loadSponsorMethods, normalizeSponsorConfig } from './sponsor-config.js'

describe('normalizeSponsorConfig', () => {
  it('accepts supported methods with server-relative image paths', () => {
    expect(normalizeSponsorConfig({
      enabled: true,
      methods: [
        { type: 'alipay', image: '/sponsor-assets/alipay.png' },
        { type: 'wechat', image: '/sponsor-assets/wechat.webp' }
      ]
    })).toEqual([
      { type: 'alipay', image: '/sponsor-assets/alipay.png' },
      { type: 'wechat', image: '/sponsor-assets/wechat.webp' }
    ])
  })

  it.each([
    null,
    [],
    {},
    { enabled: false, methods: [] },
    { enabled: true, methods: 'invalid' },
    { enabled: true, methods: [{ type: 'alipay', image: '/sponsor-assets/../secret.png' }] },
    { enabled: true, methods: [{ type: 'card', image: '/sponsor-assets/card.png' }] },
    {
      enabled: true,
      methods: [
        { type: 'alipay', image: '/sponsor-assets/alipay.png' },
        { type: 'alipay', image: '/sponsor-assets/duplicate.png' }
      ]
    }
  ])('rejects disabled or malformed config %#', (config) => {
    expect(normalizeSponsorConfig(config)).toEqual([])
  })
})

describe('loadSponsorMethods', () => {
  it('fetches runtime config without caching', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        methods: [{ type: 'alipay', image: '/sponsor-assets/alipay.png' }]
      })
    })

    await expect(loadSponsorMethods(fetchImpl)).resolves.toEqual([
      { type: 'alipay', image: '/sponsor-assets/alipay.png' }
    ])
    expect(fetchImpl).toHaveBeenCalledWith('/sponsor-config.json', { cache: 'no-store' })
  })

  it('falls back to no methods when loading fails', async () => {
    await expect(loadSponsorMethods(vi.fn().mockRejectedValue(new Error('offline')))).resolves.toEqual([])
  })
})
