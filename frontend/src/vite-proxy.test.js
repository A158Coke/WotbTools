import { describe, expect, it } from 'vitest'
import config, { assertLocal3dDistributionBoundary, devProxyTarget } from '../vite.config.js'

function proxyFor(mode) {
  return config({ command: 'serve', mode }).server.proxy['/api']
}

describe('Vite development backend modes', () => {
  it('uses the local backend for the default dev mode', () => {
    expect(devProxyTarget('development')).toBe('http://localhost:8087')
    expect(proxyFor('development')).toMatchObject({
      target: 'http://localhost:8087',
      changeOrigin: true,
      secure: false,
    })
  })

  it('uses the production site as the proxy target in production-remote mode', () => {
    expect(devProxyTarget('production-remote')).toBe('https://wotbtools.com')
    expect(proxyFor('production-remote')).toMatchObject({
      target: 'https://wotbtools.com',
      changeOrigin: true,
      secure: true,
    })
  })

  it('does not define a business API base URL', () => {
    expect(JSON.stringify(proxyFor('production-remote'))).not.toContain('VITE_API_BASE_URL')
  })
})

describe('local 3D distribution boundary', () => {
  it('allows local client-derived assets during dev serve', () => {
    expect(() => assertLocal3dDistributionBoundary('serve', true)).not.toThrow()
  })

  it('fails closed before a production build can copy local client-derived assets', () => {
    expect(() => assertLocal3dDistributionBoundary('build', true)).toThrow(/Production build blocked/)
    expect(() => assertLocal3dDistributionBoundary('build', false)).not.toThrow()
  })
})
