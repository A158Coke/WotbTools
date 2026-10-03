package com.wotbtools.app.auth

import android.content.Context
import android.content.pm.verify.domain.DomainVerificationManager
import android.content.pm.verify.domain.DomainVerificationUserState
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * 回程传输选择：HTTPS App Link 优先，private-use URI scheme 兜底。
 *
 * 为什么需要选择：App Link 的 domain verification 结果**因设备 / ROM 而异**（用户可在系统设置里
 * 关掉「打开支持的链接」，部分 OEM 环境异常）。回程一旦落到浏览器而不是 App，登录就断了，
 * 所以只有在平台**明确**回答 `auth.wotbtools.com` 已 VERIFIED **且**允许本 App 处理链接时，
 * 才走 HTTPS 回程；其余一切情况（旧 API、抛异常、用户关闭、未验证）都用 private scheme。
 *
 * 两条回程最终落到**同一个** `RedirectUriReceiverActivity`，所以这条决策只影响 URI 字面量，
 * 不影响响应处理逻辑 —— 切换传输不需要第二套代码路径。
 *
 * 与旧 `AuthLinkHealth` 的关系：这里保留的只是「平台状态 → 是否可信」这一个判断，旧的 QQ native
 * handoff recovery 流程（banner / 设置跳转 / 一次性提示）已随 WebView auth ownership 一并删除。
 */
internal object OidcRedirectStrategy {

    /** App Link host：与 `AndroidManifest.xml` 的 `autoVerify` filter 和 assetlinks.json 一致。 */
    internal const val APP_LINK_HOST = "auth.wotbtools.com"

    /**
     * process 内只探测一次的平台结果；null 表示还没看过。
     *
     * 刻意不提供刷新入口：一次登录交易只选一次回程（并随交易持久化），运行中变更取值没有意义。
     */
    @Volatile
    private var cachedAppLinkUsable: Boolean? = null

    /**
     * 纯决策函数（JVM 单测直接调用）：App Link 已知可用 → HTTPS 回程，否则 private scheme 回退。
     */
    internal fun decide(appLinkUsable: Boolean): String =
        if (appLinkUsable) OidcConfiguration.HTTPS_REDIRECT_URI else OidcConfiguration.PRIVATE_REDIRECT_URI

    /** 本次交易应使用的回程 URI（探测结果 process 内缓存）。 */
    internal fun redirectUri(context: Context): String = decide(appLinkUsable(context))

    /** App Link 是否已知可用；API 31 以下 / 任何异常一律 false（fail closed 到 private scheme）。 */
    internal fun appLinkUsable(context: Context): Boolean {
        cachedAppLinkUsable?.let { return it }
        val probed = probe(context)
        cachedAppLinkUsable = probed
        return probed
    }

    private fun probe(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        return try {
            probeApi31(context)
        } catch (_: Exception) {
            // 平台服务异常 / ROM 行为差异：只当作「不可判断」，回退 private scheme。
            false
        }
    }

    /**
     * Android 12+ (API 31) 的 domain verification 读取。刻意独立成方法：新 API 类型
     * （[DomainVerificationManager] / [DomainVerificationUserState]）只出现在这个方法体内，
     * 老设备永远不会解析到它们。
     */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun probeApi31(context: Context): Boolean {
        val manager = context.getSystemService(DomainVerificationManager::class.java) ?: return false
        val userState = manager.getDomainVerificationUserState(context.packageName) ?: return false
        val verified = userState.hostToStateMap[APP_LINK_HOST] ==
            DomainVerificationUserState.DOMAIN_STATE_VERIFIED
        return verified && userState.isLinkHandlingAllowed
    }
}
