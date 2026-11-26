export const ANDROID_APP_ORIGIN = 'http://127.0.0.1:21653'
export const PRODUCTION_API_ORIGIN = 'https://wotbtools.com'
export const ANDROID_ASSET_BASE = '/agent-assets'
export const isAndroidRuntime = () => import.meta.env?.MODE === 'android'

export function resolveApiUrl(input) {
  if (!isAndroidRuntime() || typeof input !== 'string') return input
  if (/^\/(?:api(?:\/|$)|download\/android\/)/.test(input)) {
    return `${PRODUCTION_API_ORIGIN}${input}`
  }
  return input
}
