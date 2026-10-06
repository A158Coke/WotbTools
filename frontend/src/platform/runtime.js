/** URL ownership: APK resources stay local; business services remain production-owned. */
export const ANDROID_APP_ORIGIN = 'https://appassets.androidplatform.net'
export const PRODUCTION_API_ORIGIN = 'https://wotbtools.com'
// Android 3D 资产直连对象存储，与 Web 构建默认（ASSET_BASE_URL Repository Variable）同一
// origin——TX1 网关的 /agent-assets 反代会被 15MB 级 GLB/地图流量打满出口带宽，只保留给
// 未升级的旧版本 APK。Android 构建读不到 Repository Variable，只能在此钉住字面量：
// 更换 origin 时必须同步 docs/operations/agent-asset-origin.md、androidCsp（connect-src
// 与 img-src）以及桶的 CORS 规则（fetch 需要 ACAO，AllowedOrigin 必须含 ANDROID_APP_ORIGIN）。
export const ANDROID_ASSET_BASE = 'https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com'
export const isAndroidRuntime = () => import.meta.env?.MODE === 'android'

/** Only service paths cross the Android local-origin boundary. */
export function resolveApiUrl(input) {
  if (!isAndroidRuntime() || typeof input !== 'string') return input
  if (/^\/(?:api(?:\/|$)|download\/android\/)/.test(input)) {
    return `${PRODUCTION_API_ORIGIN}${input}`
  }
  return input
}
