import { assetProvider } from '../scene/assetProvider.js'

const CONFIG_PATH = '/sponsor-config.json'
const ALLOWED_METHODS = new Set(['alipay', 'wechat'])
const ASSET_PATH = /^\/sponsor-assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i

export function normalizeSponsorConfig(config) {
  if (config == null || typeof config !== 'object' || Array.isArray(config) || config.enabled !== true) {
    return []
  }
  if (!Array.isArray(config.methods)) return []

  const seen = new Set()
  const methods = []
  for (const method of config.methods) {
    if (method == null || typeof method !== 'object' || Array.isArray(method)) return []
    if (!ALLOWED_METHODS.has(method.type) || typeof method.image !== 'string') return []
    if (!ASSET_PATH.test(method.image) || seen.has(method.type)) return []
    seen.add(method.type)
    methods.push({ type: method.type, image: method.image })
  }
  return methods
}

export async function loadSponsorMethods(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return []

  try {
    // 内容源 = 资产面（`assetBase()`）：Web 是构建注入的 asset origin（生产 = 对象存储），
    // Android 是本机 `/agent-assets`——请求由 Native AgentAssetProxy 直连同一对象存储并做
    // ETag 磁盘缓存。配置与 QR 因此都不经生产网关下发（TX1 公网口不被赞助页占用），
    // 也从不进 APK bundle。`no-store` 让每次进页面都回源校验（对象侧是 no-cache）。
    const response = await fetchImpl(assetProvider.url(CONFIG_PATH), { cache: 'no-store' })
    if (!response.ok) return []
    // 图片与配置同一 origin：把配置里的 `/sponsor-assets/<name>` 解析到当前资产面。
    return normalizeSponsorConfig(await response.json())
      .map(method => ({ ...method, image: assetProvider.url(method.image) }))
  } catch {
    return []
  }
}
