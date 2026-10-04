package com.wotbtools.app.auth

/**
 * 回程传输：**固定 private-use URI scheme**（RFC 8252 §7.1），2.1.0 起。
 *
 * 为什么不再选 HTTPS App Link：App Link 的回程结果**因设备 / ROM / 用户设置而异**——
 * domain verification 的判定（`DOMAIN_STATE_VERIFIED` ∧ `isLinkHandlingAllowed`）可以被
 * 系统设置、OEM 行为或 Chrome 的 App Link 处理策略悄悄改变，回程一旦落到浏览器而不是
 * App，登录就断了，而且用户侧不可自愈。OAuth 的原生回程本来就该用 private scheme
 * （AppAuth 的标准做法），它不依赖任何平台判定，行为在所有设备上一致。
 *
 * HTTPS 回程（[OidcConfiguration.HTTPS_REDIRECT_URI]）**降级为兼容回退**：
 * - Keycloak client 上仍然登记（`infra/tofu/keycloak/client.tf`）；
 * - `AndroidManifest.xml` 的 `autoVerify` filter 仍然保留（老版本 APK 与历史交易兼容）；
 * - 浏览器真的停在那条 URL 时，`deploy/tx/Caddyfile` 的落地页提供「返回 App」按钮
 *   （触发 private scheme）与下载入口——它是兜底，不是主认证机制。
 *
 * 与旧实现的关系：2.0.x 的「App Link 优先、private scheme 兜底」探测逻辑
 * （`DomainVerificationManager` probe + process 内缓存）随本决策一并删除——
 * Android native auth 不再读取 domain verification 状态。
 */
internal object OidcRedirectStrategy {

    /** App Link host：与 `AndroidManifest.xml` 的 `autoVerify` filter 和 assetlinks.json 一致。
     *  仅作为兼容回退路径的文档常量保留；授权回程不再使用它。 */
    internal const val APP_LINK_HOST = "auth.wotbtools.com"

    /**
     * 本次交易应使用的回程 URI：**恒为 private scheme**。
     * （2.0.x 的签名带 `Context`——固定决策不再需要平台探测；保留同名入口让调用方
     * 与测试无需改语义。）
     */
    internal fun redirectUri(): String = OidcConfiguration.PRIVATE_REDIRECT_URI

    /**
     * 纯决策函数（JVM 单测直接调用）：回程恒为 private scheme。
     * 保留 `appLinkUsable` 参数位是为了让「回程决策」这条测试线在新旧行为间
     * 有同一个签名——参数被刻意忽略；任何「某设备上 App Link 可用所以走 HTTPS」的
     * 回归都会在这里被抓住。
     */
    internal fun decide(@Suppress("UNUSED_PARAMETER") appLinkUsable: Boolean): String =
        OidcConfiguration.PRIVATE_REDIRECT_URI
}
