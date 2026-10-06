/** URL ownership: APK resources stay local; business services remain production-owned. */
export const ANDROID_APP_ORIGIN = 'https://appassets.androidplatform.net'
export const PRODUCTION_API_ORIGIN = 'https://wotbtools.com'
// 3D 资产走本机路径（same-origin）：请求被 Native 的 AgentAssetProxy 拦截，由原生
// HttpURLConnection 直连对象存储取流并做 ETag 磁盘缓存——WebView fetch 不受 CORS 约束
// 的前提是请求不出本地 origin，因此这里绝不能指向远程 origin（桶 CORS 白名单不含
// appassets.androidplatform.net，也不应为此放宽）。实现与文档：
// android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt +
// docs/operations/agent-asset-origin.md。
export const ANDROID_ASSET_BASE = '/agent-assets'
export const isAndroidRuntime = () => import.meta.env?.MODE === 'android'

/** Only service paths cross the Android local-origin boundary. */
export function resolveApiUrl(input) {
  if (!isAndroidRuntime() || typeof input !== 'string') return input
  if (/^\/(?:api(?:\/|$)|download\/android\/)/.test(input)) {
    return `${PRODUCTION_API_ORIGIN}${input}`
  }
  return input
}
