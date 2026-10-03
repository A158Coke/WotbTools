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
        val source = authManagerSource()

        assertTrue(
            "交易归属校验必须比较持久化交易的身份（state）与响应返回的 response.state",
            source.contains("expectedState = transaction.state")
        )
        assertTrue(
            "必须比较响应真正携带回来的 state",
            source.contains("responseState = response.state")
        )
        assertFalse(
            "禁止把响应自带的 response.request.state 当作 responseState（自指恒等）",
            source.contains("responseState = response.request.state")
        )
    }

    /**
     * 失败与消费路径必须**按身份**清交易（[AuthTransactionStore.clearIfState]），不得无条件清空。
     *
     * 陈旧 / 外来的 callback（旧登录的回程、库判定的 STATE_MISMATCH、读不出 state 的取消）到达时
     * 无条件清空会作废用户已经开始的那笔新登录。这里断言接线只用身份匹配的清理原语，行为断言由
     * `AuthTransactionStoreTest.aStaleCallbackNeverClearsTheCurrentTransaction` 覆盖。
     */
    @Test
    fun transactionCleanupOnCallbackPathsIsIdentityMatched() {
        val source = authManagerSource()

        assertTrue(
            "回程失败路径必须经 clearIfState 按身份清理",
            source.contains("transactions.clearIfState(returnedState, \"auth-exception\")")
        )
        assertTrue(
            "guard 失败路径必须经 clearIfState 按身份清理",
            source.contains("transactions.clearIfState(response.state, \"guard-")
        )
        assertTrue(
            "异步交换消费必须带上自己那笔交易的身份",
            source.contains("transactions.clearIfState(transactionState, \"exchanged\")")
        )
        for (blindClear in listOf(
            "transactions.clear(\"auth-exception\")",
            "transactions.clear(\"empty-result\")",
            "transactions.clear(\"guard-",
            "transactions.clear(\"exchanged\")"
        )) {
            assertFalse(
                "回程路径禁止无条件清交易：$blindClear",
                source.contains(blindClear)
            )
        }
    }

    /**
     * 登录必须先成功落盘交易才允许启动 external user-agent（落盘失败 ⇒ 不启动、不假装已受理）。
     * 该顺序无法用普通 JVM 单测执行（AppAuth + Keystore），因此窄断言这条接线。
     */
    @Test
    fun theBrowserIsOnlyLaunchedAfterTheTransactionWasPersisted() {
        val source = authManagerSource()

        val persist = source.indexOf("private fun persistTransactionThenLaunch(")
        assertTrue("persistTransactionThenLaunch must exist", persist >= 0)
        val body = source.substring(persist, minOf(source.length, persist + 1600))
        assertTrue(
            "落盘结果必须被检查（失败即不启动）",
            body.contains("if (!transactions.save(state, redirectUri))")
        )
        assertTrue(
            "落盘失败必须打 not-launched reason=persist-failed",
            body.contains("auth-login not-launched reason=persist-failed")
        )
        assertTrue(
            "没有 state 的请求无法做归属校验，必须 fail closed",
            body.contains("auth-login not-launched reason=missing-state")
        )
        val saveIndex = body.indexOf("transactions.save(")
        val launchIndex = body.indexOf("onMainThread { startAuthorizationRequest(")
        assertTrue("save 必须发生在启动之前", saveIndex in 0 until launchIndex)
    }

    private fun authManagerSource(): String {
        val candidates = listOf(
            "src/main/java/com/wotbtools/app/auth/AuthManager.kt",
            "app/src/main/java/com/wotbtools/app/auth/AuthManager.kt"
        )
        return candidates.map(::File).firstOrNull { it.isFile }?.readText()
            ?: error("AuthManager.kt not found from ${File(".").absolutePath}")
    }
}
