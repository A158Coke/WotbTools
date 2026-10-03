import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config, {
  assertLocal3dDistributionBoundary,
  buildIdentity,
  devProxyTarget,
  nativeRuntimeIdentity,
} from '../vite.config.js'
import {
  NATIVE_AUTH_CAPABILITY,
  NATIVE_AUTH_CHANGED_GLOBAL,
  NATIVE_AUTH_METHODS,
  SUPPORTED_NATIVE_BRIDGE_VERSIONS,
} from './platform/nativeBridgeContract.js'

const bridgeContract = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../contracts/android-native-bridge.json', import.meta.url)), 'utf8'))

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

describe('frontend build identity', () => {
  it('uses the Docker-injected release SHA as the canonical build commit', () => {
    const previous = process.env.BUILD_COMMIT
    process.env.BUILD_COMMIT = '0123456789abcdef0123456789abcdef01234567'
    try {
      expect(buildIdentity()).toMatchObject({
        buildCommit: '0123456789abcdef0123456789abcdef01234567',
      })
    } finally {
      if (previous === undefined) delete process.env.BUILD_COMMIT
      else process.env.BUILD_COMMIT = previous
    }
  })
})

/**
 * `/version.json` 里的 native 运行面是 Android 发布门禁（publish 阶段）判断「线上前端是否
 * 支持 Bridge v2 + native-auth」的唯一机器可读来源，因此它必须是 bridge 契约声明的投影，
 * 而不是任何手写副本。
 */
describe('production native runtime identity', () => {
  it('projects the bridge contract module verbatim', () => {
    expect(nativeRuntimeIdentity()).toEqual({
      supportedBridgeVersions: [...SUPPORTED_NATIVE_BRIDGE_VERSIONS],
      nativeAuthCapability: NATIVE_AUTH_CAPABILITY,
      authChangedGlobal: NATIVE_AUTH_CHANGED_GLOBAL,
      nativeAuthMethods: Object.values(NATIVE_AUTH_METHODS).sort(),
    })
  })

  it('proves the two facts the Android publish gate requires', () => {
    const runtime = nativeRuntimeIdentity()
    // 1) 线上前端支持的 bridge 世代包含 wire contract 的 head 版本。
    expect(runtime.supportedBridgeVersions).toContain(bridgeContract.bridgeVersion)
    // 2) 线上前端声明了 native-auth 能力，且该能力就是契约里的名字。
    expect(bridgeContract.capabilities).toContain(runtime.nativeAuthCapability)
    expect(runtime.nativeAuthCapability.length).toBeGreaterThan(0)
  })
})
