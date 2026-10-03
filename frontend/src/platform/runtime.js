/** URL ownership: APK resources stay local; business services remain production-owned. */
export const ANDROID_APP_ORIGIN = 'https://appassets.androidplatform.net'
export const PRODUCTION_API_ORIGIN = 'https://wotbtools.com'
export const ANDROID_ASSET_BASE = `${PRODUCTION_API_ORIGIN}/agent-assets`
export const isAndroidRuntime = () => import.meta.env?.MODE === 'android'

/** Only service paths cross the Android local-origin boundary. */
export function resolveApiUrl(input) {
  if (!isAndroidRuntime() || typeof input !== 'string') return input
  if (/^\/(?:api(?:\/|$)|download\/android\/)/.test(input)) {
    return `${PRODUCTION_API_ORIGIN}${input}`
  }
  return input
}
