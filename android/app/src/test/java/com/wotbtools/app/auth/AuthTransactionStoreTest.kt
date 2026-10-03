package com.wotbtools.app.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 进行中的授权交易（[AuthTransactionStore]）的确定性测试。
 *
 * 这里固定的是**状态域隔离**：交易域只被登录/回程/交换路径读写，永远不被会话域的读取、损坏处理、
 * 刷新或 logout 触碰。旧实现把两者放进同一个 slot，`authGetState` 会把持久化的
 * `AuthorizationRequest` 当成 `AuthState` 解析，失败即清空整份状态 —— 于是「登录途中进程被杀 +
 * 重新初始化 WebView」会永久作废那笔交易，回程 callback 再也无法通过校验。
 */
class AuthTransactionStoreTest {

    private val redirectUri = OidcConfiguration.PRIVATE_REDIRECT_URI
    private val requestJson = """{"configuration":{"issuer":"https://auth.wotbtools.com/realms/wotbtools"},"clientId":"wotbtools-android","state":"state-1","codeVerifier":"verifier-1"}"""

    private fun store(slots: SecureSlotStore, now: Long = 1_700_000_000_000L) =
        AuthTransactionStore(slots) { now }

    @Test
    fun theTwoStateDomainsNeverShareASlot() {
        assertNotEquals(AuthTransactionStore.SLOT, AuthSessionStore.SLOT)
    }

    @Test
    fun absentSlotMeansNoPendingTransaction() {
        val slots = FakeSecureSlotStore()
        assertNull(store(slots).load())
        assertTrue(slots.clearedSlots().isEmpty())
    }

    @Test
    fun savedTransactionRoundTripsRequestRedirectAndTimestamp() {
        val slots = FakeSecureSlotStore()
        assertTrue(store(slots).save(requestJson, redirectUri))

        val loaded = store(slots).load()
        assertEquals(requestJson, loaded?.requestJson)
        assertEquals(redirectUri, loaded?.redirectUri)
        assertEquals(1_700_000_000_000L, loaded?.createdAtMillis)
    }

    @Test
    fun blankInputsAreNeverPersisted() {
        val slots = FakeSecureSlotStore()
        assertFalse(store(slots).save("", redirectUri))
        assertFalse(store(slots).save(requestJson, "   "))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun failedWriteIsReportedAndLeavesNoStaleTransaction() {
        val slots = FakeSecureSlotStore(
            mapOf(AuthTransactionStore.SLOT to "version=1\nrequest=old\nredirectUri=$redirectUri\ncreatedAt=1\n")
        )
        slots.failWrites = true
        // 写失败必须让调用方知道（它决定要不要启动浏览器），且不能留下旧交易冒充新交易。
        assertFalse(store(slots).save(requestJson, redirectUri))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun malformedPayloadClearsOnlyTheTransactionSlot() {
        val sessionJson = """{"refreshToken":"r"}"""
        val slots = FakeSecureSlotStore(
            mapOf(
                AuthTransactionStore.SLOT to "not-a-valid-payload",
                AuthSessionStore.SLOT to sessionJson
            )
        )

        assertNull(store(slots).load())
        // 只有交易 slot 被清；会话 slot 既没被读也没被清。
        assertEquals(listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
        assertEquals(sessionJson, slots.value(AuthSessionStore.SLOT))
    }

    @Test
    fun unknownEncodingVersionOrMissingFieldsAreMalformed() {
        val cases = listOf(
            "version=2\nrequest=$requestJson\nredirectUri=$redirectUri\ncreatedAt=1\n",
            "version=1\nredirectUri=$redirectUri\ncreatedAt=1\n",
            "version=1\nrequest=$requestJson\ncreatedAt=1\n",
            "version=1\nrequest=$requestJson\nredirectUri=$redirectUri\ncreatedAt=0\n",
            "version=1\nrequest=$requestJson\nredirectUri=$redirectUri\ncreatedAt=not-a-number\n"
        )
        cases.forEach { payload ->
            val slots = FakeSecureSlotStore(mapOf(AuthTransactionStore.SLOT to payload))
            assertNull("payload=$payload", store(slots).load())
            assertEquals("payload=$payload", listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
        }
    }

    @Test
    fun clearingTheTransactionNeverTouchesTheSession() {
        val sessionJson = """{"accessToken":"a"}"""
        val slots = FakeSecureSlotStore(mapOf(AuthSessionStore.SLOT to sessionJson))
        store(slots).save(requestJson, redirectUri)

        store(slots).clear("exchanged")

        assertNull(slots.value(AuthTransactionStore.SLOT))
        assertEquals(sessionJson, slots.value(AuthSessionStore.SLOT))
        assertEquals(listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
    }

    @Test
    fun aPendingTransactionSurvivesSessionReadsCorruptionAndLogout() {
        // BLOCKER 1 的原始故障序列：登录进行中，进程死亡/被回收后 App 重新启动，
        // 前端 init 调 authGetState（读会话域 + 损坏即清会话域），随后用户 logout。
        // 这三件事都不允许影响那笔仍在等待回程的交易。
        val slots = FakeSecureSlotStore()
        store(slots).save(requestJson, redirectUri)

        // 1) 重新启动后的 WebView init：会话域为空（或损坏），读取方只处理会话域。
        val sessions = AuthSessionStore(slots)
        assertNull(sessions.load())
        slots.write(AuthSessionStore.SLOT, "corrupted-session-payload")
        sessions.clear("deserialize-failed")

        // 2) 用户 logout：只清会话域。
        sessions.clear("logout")

        // 3) 回程 callback 到达：交易仍在，且带着当初那份 request 与回程 URI。
        val transaction = store(slots).load()
        assertEquals(requestJson, transaction?.requestJson)
        assertEquals(redirectUri, transaction?.redirectUri)
        assertFalse(slots.clearedSlots().contains(AuthTransactionStore.SLOT))
    }
}
