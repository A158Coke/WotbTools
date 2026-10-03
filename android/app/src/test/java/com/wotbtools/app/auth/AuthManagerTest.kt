package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * [AuthManager] 投影边界与关键接线的纯 JVM 测试。
 *
 * Android 侧（Keystore / AppAuth / Activity）刻意不做单测：那些类只做胶水。这里固定的是
 * 「持久化状态 → 会话快照」这一条**无需 Android framework 就能判定**的规则，其中最重要的就是
 * 「条目缺失 / 解密失败 / JSON 为空 → 未认证」—— 恢复路径上出现 null 时不允许崩溃、
 * 不允许给出半成品会话。
 */
class AuthManagerTest {

    @Test
    fun absentStoredStateMeansUnauthenticated() {
        // AuthSessionStore.load() 在「没有条目 / 解密失败 / 内容为空」时统一返回 null，
        // 投影必须把这个 null 变成明确的未认证，而不是异常或空壳会话。
        val session = AuthManager.sessionOf(null)
        assertEquals(AuthSession.unauthenticated(), session)
        assertFalse(session.authenticated)
        assertNull(session.accessToken)
        assertNull(session.expiresAtSeconds)
        assertNull(session.claims)
        assertFalse(session.isValidFor(0, 1_700_000_000_000L))
    }

    /**
     * 交易归属校验的**接线**必须使用 OAuth 响应真正返回的 `response.state`。
     *
     * 这个调用点与 AppAuth 的 [net.openid.appauth.AuthorizationResponse]（Android 类型）耦合，
     * 无法在普通 JVM 单测里执行；而「拿 `response.request.state` 与自己比较」是一个编译器与
     * 行为测试都发现不了的自指接线错误（永远相等 ⇒ 这道独立校验形同不存在）。因此这里对那条
     * 接线做一次窄断言，行为断言由 `AuthResponseGuardTest` 覆盖。
     */
    @Test
    fun theTransactionOwnershipCheckIsWiredToTheReturnedState() {
        val candidates = listOf(
            "src/main/java/com/wotbtools/app/auth/AuthManager.kt",
            "app/src/main/java/com/wotbtools/app/auth/AuthManager.kt"
        )
        val source = candidates.map(::File).firstOrNull { it.isFile }?.readText()
            ?: error("AuthManager.kt not found from ${File(".").absolutePath}")

        assertTrue(
            "交易归属校验必须比较持久化交易的 state 与响应返回的 response.state",
            source.contains("responseState = response.state")
        )
        assertFalse(
            "禁止把响应自带的 response.request.state 当作 responseState（自指恒等）",
            source.contains("responseState = response.request.state")
        )
    }
}
