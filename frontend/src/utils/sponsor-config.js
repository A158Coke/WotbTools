const CONFIG_URL = '/sponsor-config.json'
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
    const response = await fetchImpl(CONFIG_URL, { cache: 'no-store' })
    if (!response.ok) return []
    return normalizeSponsorConfig(await response.json())
  } catch {
    return []
  }
}
