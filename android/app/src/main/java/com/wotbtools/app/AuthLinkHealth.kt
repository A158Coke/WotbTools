package com.wotbtools.app

/**
 * App Link（Android App Links / domain verification）健康状态。
 *
 * 背景：QQ native 登录返回目前依赖 `auth.wotbtools.com` 的 Verified App Link 作为回程 fallback，
 * 但 domain verification 的实际结果**因设备 / ROM 而异**（已观察到部分 OEM 环境异常）。Android 侧
 * 因此需要把平台状态归一化成 4 态，用于两件事：
 *  1. 一次安全诊断日志（`auth-link-health host=... state=...`）；
 *  2. [NONE] 时的一次性 recovery 提示。
 *
 * 本状态**不 gate 登录**：任何取值都允许用户继续用 QQ 登录，绝不 fail closed。
 */
internal enum class AuthLinkState {
    /** 平台确认 `auth.wotbtools.com` 已 domain-verified，且用户允许本 App 打开受支持链接。 */
    VERIFIED,

    /** 用户手动把本 App 选为该 host 的链接处理者（Android 12+ 的 “Selected” 语义）。 */
    SELECTED,

    /** 本设备无法把 `auth.wotbtools.com` 的链接交给本 App（未验证 / 用户关闭了链接处理）。 */
    NONE,

    /** 无法判断（Android 12 以下、平台返回未知取值、系统服务异常）。 */
    UNAVAILABLE
}

/**
 * 平台 domain verification 状态的中立表示。
 *
 * 由 Android adapter（`MainActivity.probeAuthLinkHealth`）用**平台常量**翻译而来 —— 本文件刻意不引用
 * 任何 Android 类型，也刻意不比较裸数字，这样归一化逻辑能作为纯 JVM 单测运行，同时把「平台常量 →
 * 中立状态」这一段翻译留在唯一一处的 Android 代码里。
 */
internal enum class AuthLinkDomainState { NONE, SELECTED, VERIFIED, UNKNOWN }

/**
 * App Link 状态归一化（纯逻辑，无 Android 类型、无 I/O）。
 *
 * 判定顺序与理由：
 *  - 用户关闭了本 App 的「打开支持的链接」→ [AuthLinkState.NONE]：此时链接不可能再交给本 App，
 *    即使 host 本身是 VERIFIED 也一样，因此该判断**优先于** domain state（recovery 提示正好指向这个开关）。
 *  - [AuthLinkDomainState.UNKNOWN] → [AuthLinkState.UNAVAILABLE]：「无法判断」不能伪装成「未验证」，
 *    否则会给出误导性的 recovery 提示。
 */
internal object AuthLinkHealth {

    /** App Link host：与 AndroidManifest 的两个 `autoVerify` filter 和 assetlinks.json 一致。 */
    internal const val HOST = "auth.wotbtools.com"

    internal fun resolve(domainState: AuthLinkDomainState, linkHandlingAllowed: Boolean): AuthLinkState {
        if (!linkHandlingAllowed) return AuthLinkState.NONE
        return when (domainState) {
            AuthLinkDomainState.VERIFIED -> AuthLinkState.VERIFIED
            AuthLinkDomainState.SELECTED -> AuthLinkState.SELECTED
            AuthLinkDomainState.NONE -> AuthLinkState.NONE
            AuthLinkDomainState.UNKNOWN -> AuthLinkState.UNAVAILABLE
        }
    }
}
