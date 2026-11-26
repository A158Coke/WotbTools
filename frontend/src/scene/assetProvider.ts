import { isAndroidRuntime } from '../platform/runtime.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { assetBase } from './assetBase.js'

function requireBase(): string {
  if (isAndroidRuntime() && !useFeatureGate().requireFeature(Feature.PLAYBACK_3D)) {
    throw new Error('NETWORK_ERROR')
  }
  const base = assetBase()
  if (!base) {
    throw new Error(
      '资产源未配置：追加 ?assets=<remote-asset-base-url>（坦克数据/GLB/封面/地图资产均来自该 origin）',
    )
  }
  return base
}

export type AssetPath = string

export const assetProvider = {
  fetch(url: string, init?: RequestInit): Promise<Response> {
    requireBase()
    return fetch(url, init)
  },
  url(path: AssetPath): string {
    return requireBase() + path
  },

  imageUrl(path: AssetPath): string | null {
    const base = assetBase()
    if (!base) return null
    if (isAndroidRuntime() && !useFeatureGate().isAvailable(Feature.PLAYBACK_3D)) return null
    return base + path
  },

  async bytes(path: AssetPath): Promise<Uint8Array> {
    const resp = await this.fetch(this.url(path))
    if (!resp.ok) throw new Error(`asset ${path}: HTTP ${resp.status}`)
    return new Uint8Array(await resp.arrayBuffer())
  },

  async json<T = Record<string, unknown>>(path: AssetPath): Promise<T> {
    const resp = await this.fetch(this.url(path))
    if (!resp.ok) throw new Error(`asset ${path}: HTTP ${resp.status}`)
    return await resp.json() as T
  },

  configured(): boolean {
    return !!assetBase()
  },
}
