package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * App Link 健康状态归一化的 JVM 回归测试。
 *
 * 平台适配（`DomainVerificationManager` / `DomainVerificationUserState`）留在
 * `MainActivity.probeAuthLinkHealth`，这里只覆盖与平台无关的归一化决策。
 */
class AuthLinkHealthTest {

    private fun resolve(
        domainState: AuthLinkDomainState,
        linkHandlingAllowed: Boolean = true
    ): AuthLinkState = AuthLinkHealth.resolve(domainState, linkHandlingAllowed)

    @Test
    fun platformDomainStatesMapToTheFourNormalizedStates() {
        assertEquals(AuthLinkState.VERIFIED, resolve(AuthLinkDomainState.VERIFIED))
        assertEquals(AuthLinkState.SELECTED, resolve(AuthLinkDomainState.SELECTED))
        assertEquals(AuthLinkState.NONE, resolve(AuthLinkDomainState.NONE))
        assertEquals(AuthLinkState.UNAVAILABLE, resolve(AuthLinkDomainState.UNKNOWN))
    }

    @Test
    fun disabledLinkHandlingIsNoneEvenWhenDomainIsVerified() {
        // 用户关闭「打开支持的链接」后，链接不可能再交给本 App —— 即使 host 本身 VERIFIED / SELECTED
        // 也一样。NONE 正是 recovery 提示要指向的场景，因此该判断优先于 domain state。
        assertEquals(AuthLinkState.NONE, resolve(AuthLinkDomainState.VERIFIED, linkHandlingAllowed = false))
        assertEquals(AuthLinkState.NONE, resolve(AuthLinkDomainState.SELECTED, linkHandlingAllowed = false))
        assertEquals(AuthLinkState.NONE, resolve(AuthLinkDomainState.NONE, linkHandlingAllowed = false))
        assertEquals(AuthLinkState.NONE, resolve(AuthLinkDomainState.UNKNOWN, linkHandlingAllowed = false))
    }

    @Test
    fun unknownPlatformStateIsUnavailableRatherThanNone() {
        // 「无法判断」不能伪装成「未验证」：否则会给用户一个误导性的 recovery 提示。
        assertEquals(AuthLinkState.UNAVAILABLE, resolve(AuthLinkDomainState.UNKNOWN))
    }

    @Test
    fun logVocabularyIsTheFourDocumentedTokens() {
        // 诊断日志 `auth-link-health ... state=<token>` 的词汇表就是这 4 个（与 docs/android/architecture.md
        // 的日志白名单一致）；NONE / UNAVAILABLE 都不阻止登录，只影响是否给 recovery 提示。
        assertEquals(
            setOf("VERIFIED", "SELECTED", "NONE", "UNAVAILABLE"),
            AuthLinkState.values().map { it.name }.toSet()
        )
    }
}
