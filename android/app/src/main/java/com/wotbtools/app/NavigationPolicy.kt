package com.wotbtools.app

import java.net.URI

/**
 * 主文档导航策略（纯 JVM，不引用 GeckoView 类型）。
 *
 * `NavigationDelegate.onLoadRequest` 的全部判断都在这里，因此 URL 形态可以用 JVM unit test 穷举，
 * 不需要在测试里实例化 `GeckoSession`。
 *
 * 三类放行，语义互不相同：
 * - [MainFrameNavigation.LOCAL]：文档 origin 唯一事实源 [MainActivity.LOCAL_APP_ORIGIN]（exact host + port）。
 * - [MainFrameNavigation.BLANK]：Gecko 自身的空文档。
 * - [MainFrameNavigation.BLOB_DOWNLOAD]：内嵌 origin 就是本机 origin 的 `blob:` URL，**只为让 Gecko
 *   的下载派发继续走到 `ContentDelegate.onExternalResponse`**（`<a download>` + `URL.createObjectURL`）。
 *   它不是文档导航目标，也不是 trusted application origin：Native Bridge 的 sender 校验继续是
 *   [MainActivity.isLocalAppUrl]，blob URL 在那里恒为 false（scheme 不是 `http`）。
 *
 * 失败方向是关闭：任何未列入上面的形态都返回 [MainFrameNavigation.DENY]，绝不因为「看起来像下载」
 * 而放宽。
 */
internal object NavigationPolicy {
    /** Gecko 自己的空文档：既不是本机 origin，也不需要交系统浏览器。 */
    const val BLANK = "about:blank"

    private const val BLOB_SCHEME = "blob:"

    /** blob id 只允许单段、URL 安全的不透明标识；长度上限挡住异常长的输入。 */
    private const val MAX_BLOB_ID = 128

    /** 小写 `blob:` + exact 本机 origin + `/` + 单段 id；`%`、`/`、`?`、`#`、`@` 都不在字符集里。 */
    private val BLOB_ID = Regex("[A-Za-z0-9._~-]{1,$MAX_BLOB_ID}")

    /** 交系统浏览器 / 系统 handler 的 scheme（是否真的能打开由宿主决定）。 */
    private val EXTERNAL_SCHEMES = setOf("https", "mailto")

    /** 唯一事实源仍是 [MainActivity.LOCAL_APP_ORIGIN]，这里只做一次 rawAuthority 提取。 */
    private val LOCAL_APP_AUTHORITY = URI(MainActivity.LOCAL_APP_ORIGIN).rawAuthority

    enum class MainFrameNavigation { LOCAL, BLANK, BLOB_DOWNLOAD, EXTERNAL, DENY }

    /**
     * 纯函数：主文档请求的分类。[EXTERNAL] 由宿主交给系统浏览器 / 系统 handler；[DENY] 一律拒绝。
     * `target=_blank` 不在这里区分：blob 与 local 的 target 处理由调用方决定（见 `GeckoWebRuntime`）。
     */
    fun classifyMainFrameNavigation(url: String): MainFrameNavigation = when {
        MainActivity.isLocalAppUrl(url) -> MainFrameNavigation.LOCAL
        url == BLANK -> MainFrameNavigation.BLANK
        isTrustedLocalBlobUrl(url) -> MainFrameNavigation.BLOB_DOWNLOAD
        url.substringBefore(':', "").lowercase() in EXTERNAL_SCHEMES -> MainFrameNavigation.EXTERNAL
        else -> MainFrameNavigation.DENY
    }

    /**
     * 纯函数：只接受 `blob:http://127.0.0.1:21653/<id>`——scheme 必须是 `blob`，内嵌 URL 必须
     * **exact** 等于本机 origin（同 scheme、同 host、同 port，无 userinfo / query / fragment），
     * 且带一个单段不透明 id。
     *
     * 明确拒绝（fail-closed）：其它 host / port / scheme（`blob:https://evil.example/...`、
     * `blob:http://127.0.0.1:9999/...`、`blob:http://localhost:21653/...`、`blob:null/...`、
     * `blob:ftp://...`）、`blob:` 空内嵌、缺失 / 空 / 多段 / 被编码的 id、带 userinfo / query /
     * fragment 的形态、以及所有非 blob scheme（`data:`、`file:`、`javascript:`、外部 `http:`）。
     * 不是「scheme == blob 就放行」。
     */
    fun isTrustedLocalBlobUrl(url: String): Boolean {
        if (!url.startsWith(BLOB_SCHEME)) return false
        val inner = try {
            URI(url.substring(BLOB_SCHEME.length))
        } catch (_: Exception) {
            return false
        }
        if (inner.scheme != "http") return false
        if (inner.rawAuthority != LOCAL_APP_AUTHORITY) return false
        if (inner.rawUserInfo != null || inner.rawQuery != null || inner.rawFragment != null) return false
        val path = inner.rawPath ?: return false
        return path.isNotEmpty() && path[0] == '/' && BLOB_ID.matches(path.substring(1))
    }
}
