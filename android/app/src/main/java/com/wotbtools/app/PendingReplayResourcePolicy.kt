package com.wotbtools.app

import java.net.URI

/**
 * Android 外部 replay 的 Native → Web 字节 transport 契约。
 *
 * WebView 保持 fail-closed（`allowFileAccess=false` / `allowContentAccess=false`），因此 Web
 * **不能** `fetch(content://…)`。字节改由一个**同源、固定、无参数**的 synthetic HTTPS 资源承载：
 * 页面 `fetch()` 它，`shouldInterceptRequest` 命中后流式返回 app private cache 里的 pending replay。
 *
 * 契约冻结（由 [PendingReplayResourcePolicyTest] 覆盖）：
 * - 只允许 exact `https://wotbtools.com/__native/replay-pending`（app 的 canonical origin 就是
 *   [HOST]；`www` 只是 Native Bridge 的 origin 白名单超集，不是页面 origin，因此这里不放行）。
 * - URL **不含** pendingId / 文件名 / 本地路径 / token / state / code：即便某次未被拦截而落到真实
 *   nginx/backend access log，也不泄漏任何身份或路径信息。pendingId 只经 Native Bridge 传输，
 *   继续充当 ACK identity 与 Processing `operationId`。
 * - 命中该 URL 时响应**永远由 Native 拥有**，绝不 `return null` 把请求放行到真实网络。
 *
 * query 不参与判定：这是刻意的 fail-closed 方向 —— 就算将来有人误加 `?id=…`，请求仍被拦下由
 * Native 应答，而不会漏到真实后端（放行才会造成泄漏）。
 */
object PendingReplayResourcePolicy {

    const val SCHEME = "https"
    const val HOST = "wotbtools.com"
    const val PATH = "/__native/replay-pending"

    /** Native Bridge 交给 Web 的固定 stream URL（与页面 app origin 同源）。 */
    const val SYNTHETIC_URL = "$SCHEME://$HOST$PATH"

    /**
     * exact match：scheme / host / path 三者全等。
     *
     * scheme 与 host 按 URL 规范大小写不敏感；path 大小写敏感。
     */
    fun matches(scheme: String?, host: String?, path: String?): Boolean =
        SCHEME.equals(scheme, ignoreCase = true) &&
            HOST.equals(host, ignoreCase = true) &&
            PATH == path

    /** 从 URL 字面量判定（`shouldInterceptRequest` 与单测共用同一条判定路径）。 */
    fun matchesUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val parsed = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        return matches(parsed.scheme, parsed.host, parsed.path)
    }
}
