package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [AuthManager] 投影边界的纯 JVM 测试。
 *
 * Android 侧（Keystore / AppAuth / Activity）刻意不做单测：那些类只做胶水。这里固定的是
 * 「持久化状态 → 会话快照」这一条**无需 Android framework 就能判定**的规则，其中最重要的就是
 * 「条目缺失 / 解密失败 / JSON 损坏 / 超时 → 未认证」—— 恢复路径上出现 null 时不允许崩溃、
 * 不允许给出半成品会话。
 */
class AuthManagerTest {

    @Test
    fun absentStoredStateMeansUnauthenticated() {
        // AuthStateStore.load() 在「没有条目 / 解密失败 / JSON 损坏 / 过期」时统一返回 null，
        // 投影必须把这个 null 变成明确的未认证，而不是异常或空壳会话。
        val session = AuthManager.sessionOf(null)
        assertEquals(AuthSession.unauthenticated(), session)
        assertFalse(session.authenticated)
        assertNull(session.accessToken)
        assertNull(session.expiresAtSeconds)
        assertNull(session.claims)
        assertFalse(session.isValidFor(0, 1_700_000_000_000L))
    }
}
