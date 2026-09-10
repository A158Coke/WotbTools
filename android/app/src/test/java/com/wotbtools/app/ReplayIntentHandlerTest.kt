package com.wotbtools.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.UUID

/**
 * pending replay metadata（跨 process death 恢复）/ TTL / orphan 清理的纯 JVM 测试。
 *
 * 只用纯函数 + `java.io` 临时目录，不依赖 Context / SharedPreferences / Robolectric；metadata 编码刻意
 * 不用 org.json（android.jar 的 org.json 在 JVM 单测里是 stub，会抛异常）。
 */
class ReplayIntentHandlerTest {

    /** authoritative identity：完整 UUID（Blocker 2），ACK 的 compare-and-clear 逐字符依赖它。 */
    private val fullPendingId = "3f2b9c1e-7d4a-4b8e-9f01-2c6d5a7e8b90"

    @Test
    fun metadataRoundTripsThroughDeterministicLineEncoding() {
        val metadata = ReplayPendingMetadata(
            pendingId = fullPendingId,
            cacheFilename = "replay-$fullPendingId.wotbreplay",
            originalName = "2024-05-01 battle.wotbreplay",
            size = 12_345L,
            createdAt = 1_700_000_000_000L
        )

        val encoded = ReplayIntentHandler.encodeMetadata(metadata)

        assertEquals(metadata, ReplayIntentHandler.decodeMetadata(encoded))
        // 完整 UUID identity 逐字符保真（36 字符）：Web 原样回传它做 compare-and-clear，一位都不能变。
        assertEquals(36, fullPendingId.length)
        assertEquals(fullPendingId, ReplayIntentHandler.decodeMetadata(encoded)!!.pendingId)
        // 确定性：同一输入重复编码逐字节一致（无时间戳、随机值或平台换行）。
        assertEquals(encoded, ReplayIntentHandler.encodeMetadata(metadata))
        assertFalse(encoded.contains("\r"))
        // 只允许恢复所需的最小字段：metadata 绝不夹带 replay 内容 / 路径 / 凭据等额外载荷。
        assertEquals(
            listOf("version", "pendingId", "cacheFilename", "originalName", "size", "createdAt"),
            encoded.split("\n").map { it.substringBefore('=') }
        )
    }

    @Test
    fun metadataValuesContainingSeparatorsSurviveRoundTrip() {
        // 显示名可含 '=' 与空格（只按第一个 '=' 切分），中文名原样保留。
        val metadata = ReplayPendingMetadata(
            pendingId = "deadbeef",
            cacheFilename = "replay-deadbeef.wotbreplay",
            originalName = "a=b 战局 报告.wotbreplay",
            size = 0L,
            createdAt = 1L
        )

        val decoded = ReplayIntentHandler.decodeMetadata(ReplayIntentHandler.encodeMetadata(metadata))!!

        assertEquals(metadata, decoded)
        assertEquals("a=b 战局 报告.wotbreplay", decoded.originalName)
        assertEquals("replay-deadbeef.wotbreplay", decoded.cacheFilename)
    }

    @Test
    fun newlineInDisplayNameIsSanitizedOnEncode() {
        // 换行会破坏 key=value 行编码；不清理就会让这份 pending 在下次 startup 解码失败而永久丢失。
        val encoded = ReplayIntentHandler.encodeMetadata(
            ReplayPendingMetadata(
                pendingId = "cafebabe",
                cacheFilename = "replay-cafebabe.wotbreplay",
                originalName = "line1\nline2\r\n.wotbreplay",
                size = 5L,
                createdAt = 1_000L
            )
        )

        assertFalse(encoded.contains("\r"))
        val decoded = ReplayIntentHandler.decodeMetadata(encoded)!!
        assertEquals("line1 line2  .wotbreplay", decoded.originalName)
    }

    @Test
    fun malformedOrEmptyMetadataDecodesToNull() {
        assertNull(ReplayIntentHandler.decodeMetadata(null))
        assertNull(ReplayIntentHandler.decodeMetadata(""))
        assertNull(ReplayIntentHandler.decodeMetadata("garbage-without-separator"))
        assertNull(ReplayIntentHandler.decodeMetadata("=novalue\npendingId=x"))
        // 缺字段（createdAt 缺失）。
        assertNull(
            ReplayIntentHandler.decodeMetadata(
                "version=1\npendingId=a1b2c3d4\ncacheFilename=replay-a1b2c3d4.wotbreplay\n" +
                    "originalName=battle.wotbreplay\nsize=1"
            )
        )
        // 版本不符（不认识的未来格式不恢复）。
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(version = "2")))
        // 数字不可解析 / 负 size / 非正 createdAt。
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(size = "abc")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(size = "-1")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(createdAt = "0")))
        // 空白短 id。
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "   ")))
        // 重复 key（同一字段出现两次）。
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw() + "\nsize=9"))
    }

    @Test
    fun unsafeCacheFilenameIsNeverRestorable() {
        // backing file 名不得逃出 cache/replay 目录：metadata 即使被篡改也拿不到外部路径。
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "../files/secret.wotbreplay")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "sub/replay.wotbreplay")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "sub\\replay.wotbreplay")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "   ")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "a".repeat(200))))
    }

    @Test
    fun pendingIdMustBeNonBlankAndWithinLengthBounds() {
        // 冻结的边界：非空白 且 长度 8..64。完整 UUID（36）是常态；下限 8 保留升级前写入的短 id metadata
        // 的向后兼容（一次 app update 不会把未消费的 pending 判成损坏丢掉），上限 64 拒绝超长注入值。
        assertEquals(8, ReplayIntentHandler.PENDING_ID_MIN_LENGTH)
        assertEquals(64, ReplayIntentHandler.PENDING_ID_MAX_LENGTH)

        assertNotNull(ReplayIntentHandler.decodeMetadata(validRaw(pendingId = fullPendingId)))
        assertNotNull(
            "边界下限 8 必须仍可恢复（升级前写入的短 id）",
            ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "a".repeat(8)))
        )
        assertNotNull(
            "边界上限 64 必须仍可恢复",
            ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "a".repeat(64)))
        )

        assertNull("过短（<8）不得恢复", ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "a".repeat(7))))
        assertNull("过短（<8）不得恢复", ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "x")))
        assertNull("超长（>64）不得恢复", ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "a".repeat(65))))
        // 长度合法但全空白：仍然不是 identity，必须被空白检查单独挡住。
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(pendingId = " ".repeat(8))))
    }

    @Test
    fun generatedPendingIdIsAFullUuidAndItsLogRefStaysShort() {
        val first = ReplayIntentHandler.newPendingId()
        val second = ReplayIntentHandler.newPendingId()

        // identity 必须是完整 UUID（36 字符），不再是 8 位短 id（Blocker 2）；畸形串会让 fromString 抛异常。
        assertEquals(first, UUID.fromString(first).toString())
        assertEquals(36, first.length)
        assertNotEquals(first, second)

        // 日志只允许 short ref：完整 id 的 8 位前缀，且绝不等于完整 id（short ref 不是 identity）。
        assertEquals(first.take(8), pendingLogRef(first))
        assertEquals(8, pendingLogRef(first).length)
        assertNotEquals(first, pendingLogRef(first))
        // 没有 pending 时用固定占位符，绝不用空串冒充 identity。
        assertEquals("none", pendingLogRef(null))
    }

    @Test
    fun unknownAdditionalKeysAreIgnoredForForwardCompatibility() {
        val decoded = ReplayIntentHandler.decodeMetadata(validRaw() + "\nfutureField=whatever")!!

        assertEquals("a1b2c3d4", decoded.pendingId)
        assertEquals(1_700_000_000_000L, decoded.createdAt)
    }

    @Test
    fun expiryBoundaryIsExactlyTwentyFourHours() {
        val createdAt = 1_700_000_000_000L

        assertEquals(24L * 60 * 60 * 1000, ReplayIntentHandler.PENDING_TTL_MS)
        assertFalse(ReplayIntentHandler.isExpired(createdAt, createdAt)) // 刚创建
        assertFalse(ReplayIntentHandler.isExpired(createdAt, createdAt + ReplayIntentHandler.PENDING_TTL_MS - 1)) // 未到
        assertTrue(ReplayIntentHandler.isExpired(createdAt, createdAt + ReplayIntentHandler.PENDING_TTL_MS)) // 刚好 24h
        assertTrue(ReplayIntentHandler.isExpired(createdAt, createdAt + ReplayIntentHandler.PENDING_TTL_MS + 1)) // 超过
        assertTrue(ReplayIntentHandler.isExpired(createdAt, createdAt + 7 * ReplayIntentHandler.PENDING_TTL_MS))
        assertFalse(ReplayIntentHandler.isExpired(createdAt, createdAt - 60_000L)) // 时钟回拨不算过期
    }

    @Test
    fun orphanCleanupKeepsOnlyTheActiveBackingFile() {
        withTempCacheDir { dir ->
            val active = File(dir, "replay-a1b2c3d4.wotbreplay").apply { writeText("active") }
            val orphan = File(dir, "replay-ffffffff.wotbreplay").apply { writeText("orphan") }

            ReplayIntentHandler.cleanupOrphansInDir(dir, active)

            assertTrue("active backing file 必须保留", active.exists())
            assertFalse("未引用的 orphan 必须删除", orphan.exists())
        }
    }

    @Test
    fun orphanCleanupWithoutActivePendingClearsTheWholeCacheDir() {
        // 没有 active pending（activeFile=null）时退化为清空 cache/replay，与修复前行为一致。
        withTempCacheDir { dir ->
            val file = File(dir, "replay-a1b2c3d4.wotbreplay").apply { writeText("stale") }

            ReplayIntentHandler.cleanupOrphansInDir(dir, null)

            assertFalse(file.exists())
        }
        // 目录不存在时不得抛异常。
        ReplayIntentHandler.cleanupOrphansInDir(File("does-not-exist-${System.nanoTime()}"), null)
    }

    @Test
    fun freshActivePendingIsRestoredAndItsFileSurvivesCleanup() {
        withTempCacheDir { dir ->
            val backing = File(dir, "replay-33334444.wotbreplay").apply { writeText("fresh") }
            val orphan = File(dir, "replay-55556666.wotbreplay").apply { writeText("orphan") }
            val metadata = ReplayPendingMetadata(
                pendingId = "33334444",
                cacheFilename = backing.name,
                originalName = "fresh.wotbreplay",
                size = 5L,
                createdAt = 1_000L
            )
            val now = 1_000L + ReplayIntentHandler.PENDING_TTL_MS - 1 // 未过期

            val restored = ReplayIntentHandler.resolveRestorableBackingFile(metadata, dir, now)

            assertNotNull(restored)
            assertEquals(backing.absolutePath, restored!!.absolutePath)

            ReplayIntentHandler.cleanupOrphansInDir(dir, restored)

            assertTrue("active backing file 绝不能被 startup cleanup 删除", backing.exists())
            assertFalse(orphan.exists())
        }
    }

    @Test
    fun expiredActivePendingIsNotRestoredAndItsFileIsCleaned() {
        withTempCacheDir { dir ->
            val backing = File(dir, "replay-11112222.wotbreplay").apply { writeText("stale") }
            val metadata = ReplayPendingMetadata(
                pendingId = "11112222",
                cacheFilename = backing.name,
                originalName = "old.wotbreplay",
                size = 5L,
                createdAt = 1_000L
            )
            val now = 1_000L + ReplayIntentHandler.PENDING_TTL_MS // 刚好过期

            assertNull("过期 active 不得恢复", ReplayIntentHandler.resolveRestorableBackingFile(metadata, dir, now))

            // 不恢复 → startup cleanup 以 active=null 运行 → 过期文件被清掉，不留垃圾。
            ReplayIntentHandler.cleanupOrphansInDir(dir, null)

            assertFalse(backing.exists())
        }
    }

    @Test
    fun missingOrCorruptMetadataIsNotRestored() {
        withTempCacheDir { dir ->
            val backing = File(dir, "replay-77778888.wotbreplay").apply { writeText("gone") }
            val metadata = ReplayPendingMetadata(
                pendingId = "77778888",
                cacheFilename = "replay-99990000.wotbreplay", // backing file 缺失
                originalName = "gone.wotbreplay",
                size = 5L,
                createdAt = 1_000L
            )

            assertNull(ReplayIntentHandler.resolveRestorableBackingFile(metadata, dir, 2_000L))
            // 损坏 / 不完整 metadata 一律不恢复（decode 已经返回 null）。
            assertNull(ReplayIntentHandler.resolveRestorableBackingFile(null, dir, 2_000L))
            assertTrue(backing.exists()) // 与恢复无关的既有文件不在此函数里被删
        }
    }

    @Test
    fun consumedPendingLeavesNothingRestorable() {
        // consume 链路：Web 带 identity 调 consumePendingReplay(expectedPendingId) →
        // PendingReplayAckPolicy 判定与当前 pending 完全一致（SUCCESS）→ MainActivity.bridgeConsumePendingReplay
        // → clearPendingReplay() → ReplayIntentHandler.clearPendingMetadata()（清掉这唯一的 metadata 值）。
        // SharedPreferences 访问依赖 Context，而 app 只依赖 junit（无 Robolectric），所以这里覆盖纯编码层的
        // 「无 pending」契约：null / 空 raw 一律解码为 null —— 下次 startup 的 restorePending() 因此直接
        // 返回 null，绝不恢复一份已被 Web 消费的 replay。
        assertNull(ReplayIntentHandler.decodeMetadata(null))
        assertNull(ReplayIntentHandler.decodeMetadata(""))

        // 反证：只要 metadata 还在（没被清），同一 backing file 就会被恢复 —— 所以 consume 必须清 metadata。
        withTempCacheDir { dir ->
            val backing = File(dir, "replay-$fullPendingId.wotbreplay").apply { writeText("consumed") }
            val metadata = ReplayIntentHandler.decodeMetadata(
                ReplayIntentHandler.encodeMetadata(
                    ReplayPendingMetadata(
                        pendingId = fullPendingId,
                        cacheFilename = backing.name,
                        originalName = "consumed.wotbreplay",
                        size = 8L,
                        createdAt = 1_000L
                    )
                )
            )

            assertNotNull(ReplayIntentHandler.resolveRestorableBackingFile(metadata, dir, 2_000L))
        }
    }

    private fun withTempCacheDir(block: (File) -> Unit) {
        val dir = Files.createTempDirectory("wotb-replay-cache").toFile()
        try {
            block(dir)
        } finally {
            dir.deleteRecursively()
        }
    }

    /**
     * 合法 metadata 原文（与 encodeMetadata 的输出格式一致），用于生成 encode 无法产生的畸形变体；
     * 刻意不走 encodeMetadata —— 否则无法构造「缺字段 / 版本不符 / 重复 key」这类输入。
     */
    private fun validRaw(
        version: String = "1",
        pendingId: String = "a1b2c3d4",
        cacheFilename: String = "replay-a1b2c3d4.wotbreplay",
        size: String = "12345",
        createdAt: String = "1700000000000"
    ): String = listOf(
        "version=$version",
        "pendingId=$pendingId",
        "cacheFilename=$cacheFilename",
        "originalName=battle.wotbreplay",
        "size=$size",
        "createdAt=$createdAt"
    ).joinToString("\n")
}
