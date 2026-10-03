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
 * 这里固定两组不变量：
 *
 * 1. **状态域隔离**：交易域只被登录/回程/交换路径读写，永远不被会话域的读取、损坏处理、刷新或
 *    logout 触碰。旧实现把两者放进同一个 slot，`authGetState` 会把持久化的
 *    `AuthorizationRequest` 当成 `AuthState` 解析，失败即清空整份状态 —— 于是「登录途中进程被杀 +
 *    重新初始化 WebView」会永久作废那笔交易，回程 callback 再也无法通过校验。
 * 2. **按身份消费**（[AuthTransactionStore.clearIfState]）：只有回程带回的 `state` 与当前交易
 *    身份一致时才允许清空它。一笔陈旧 / 外来的 callback（旧登录的回程、读不出 state 的取消）
 *    绝不能作废用户已经开始的那笔新登录 —— 这是「登录 A → 用户返回 → 登录 B → 旧回程 A 到达」
 *    这条状态机的核心。
 */
class AuthTransactionStoreTest {

    private val redirectUri = OidcConfiguration.PRIVATE_REDIRECT_URI
    private val stateA = "state-a"
    private val stateB = "state-b"

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
    fun savedTransactionRoundTripsItsIdentityRedirectAndTimestamp() {
        val slots = FakeSecureSlotStore()
        assertTrue(store(slots).save(stateA, redirectUri))

        val loaded = store(slots).load()
        assertEquals(stateA, loaded?.state)
        assertEquals(redirectUri, loaded?.redirectUri)
        assertEquals(1_700_000_000_000L, loaded?.createdAtMillis)
    }

    @Test
    fun blankInputsAreNeverPersisted() {
        val slots = FakeSecureSlotStore()
        assertFalse(store(slots).save("", redirectUri))
        assertFalse(store(slots).save(stateA, "   "))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun failedWriteIsReportedAndLeavesNoStaleTransaction() {
        val slots = FakeSecureSlotStore(
            mapOf(AuthTransactionStore.SLOT to "version=1\nstate=$stateB\nredirectUri=$redirectUri\ncreatedAt=1\n")
        )
        slots.failWrites = true
        // 写失败必须让调用方知道（它决定要不要启动浏览器），且不能留下旧交易冒充新交易。
        assertFalse(store(slots).save(stateA, redirectUri))
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
            "version=2\nstate=$stateA\nredirectUri=$redirectUri\ncreatedAt=1\n",
            "version=1\nredirectUri=$redirectUri\ncreatedAt=1\n",
            "version=1\nstate=$stateA\ncreatedAt=1\n",
            "version=1\nstate=$stateA\nredirectUri=$redirectUri\ncreatedAt=0\n",
            "version=1\nstate=$stateA\nredirectUri=$redirectUri\ncreatedAt=not-a-number\n"
        )
        cases.forEach { payload ->
            val slots = FakeSecureSlotStore(mapOf(AuthTransactionStore.SLOT to payload))
            assertNull("payload=$payload", store(slots).load())
            assertEquals("payload=$payload", listOf(AuthTransactionStore.SLOT), slots.clearedSlots())
        }
    }

    // ── 按身份消费（compare-and-clear）──

    @Test
    fun consumingWithTheMatchingStateClearsTheTransaction() {
        val slots = FakeSecureSlotStore()
        val transactions = store(slots)
        transactions.save(stateB, redirectUri)

        assertTrue(transactions.clearIfState(stateB, "exchanged"))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun aStaleCallbackNeverClearsTheCurrentTransaction() {
        // review 指定的状态机：登录 A → 交易 A 落盘 → 用户返回 → 登录 B（交易 B 取代 A）→ 旧回程 A 到达。
        val slots = FakeSecureSlotStore()
        val transactions = store(slots)
        transactions.save(stateA, redirectUri)
        transactions.save(stateB, redirectUri)

        // 旧回程 A：身份不匹配 ⇒ 不清、返回 false（调用方据此把这次回程判成陈旧）
        assertFalse(transactions.clearIfState(stateA, "guard-state_mismatch"))
        assertEquals(stateB, transactions.load()?.state)
        assertEquals(redirectUri, transactions.load()?.redirectUri)
        assertTrue(slots.clearedSlots().isEmpty())

        // 随后真正的 B 回程：身份匹配 ⇒ 可以消费
        assertTrue(transactions.clearIfState(stateB, "exchanged"))
        assertNull(slots.value(AuthTransactionStore.SLOT))
    }

    @Test
    fun anUnprovableCallbackNeverClearsTheTransaction() {
        // 读不出 state（用户直接返回 / 浏览器被关掉）⇒ 归属无法证明 ⇒ 保留当前交易。
        val slots = FakeSecureSlotStore()
        val transactions = store(slots)
        transactions.save(stateB, redirectUri)

        assertFalse(transactions.clearIfState(null, "auth-exception"))
        assertFalse(transactions.clearIfState("", "auth-exception"))
        assertFalse(transactions.clearIfState("   ", "auth-exception"))
        assertEquals(stateB, transactions.load()?.state)
    }

    @Test
    fun consumingWithNoPendingTransactionIsANoOp() {
        val slots = FakeSecureSlotStore()
        assertFalse(store(slots).clearIfState(stateB, "exchanged"))
        assertTrue(slots.clearedSlots().isEmpty())
    }

    @Test
    fun clearingTheTransactionNeverTouchesTheSession() {
        val sessionJson = """{"accessToken":"a"}"""
        val slots = FakeSecureSlotStore(mapOf(AuthSessionStore.SLOT to sessionJson))
        val transactions = store(slots)
        transactions.save(stateB, redirectUri)

        transactions.clearIfState(stateB, "exchanged")

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
        store(slots).save(stateA, redirectUri)

        // 1) 重新启动后的 WebView init：会话域为空（或损坏），读取方只处理会话域。
        val sessions = AuthSessionStore(slots)
        assertNull(sessions.load())
        slots.write(AuthSessionStore.SLOT, "corrupted-session-payload")
        sessions.clear("deserialize-failed")

        // 2) 用户 logout：只清会话域。
        sessions.clear("logout")

        // 3) 回程 callback 到达：交易仍在，且带着当初那份身份与回程 URI。
        val transaction = store(slots).load()
        assertEquals(stateA, transaction?.state)
        assertEquals(redirectUri, transaction?.redirectUri)
        assertFalse(slots.clearedSlots().contains(AuthTransactionStore.SLOT))
    }
}
