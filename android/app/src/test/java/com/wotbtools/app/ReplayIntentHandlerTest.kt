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

class ReplayIntentHandlerTest {

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
        assertEquals(36, fullPendingId.length)
        assertEquals(fullPendingId, ReplayIntentHandler.decodeMetadata(encoded)!!.pendingId)
        assertEquals(encoded, ReplayIntentHandler.encodeMetadata(metadata))
        assertFalse(encoded.contains("\r"))
        assertEquals(
            listOf("version", "pendingId", "cacheFilename", "originalName", "size", "createdAt"),
            encoded.split("\n").map { it.substringBefore('=') }
        )
    }

    @Test
    fun metadataValuesContainingSeparatorsSurviveRoundTrip() {
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
        assertNull(
            ReplayIntentHandler.decodeMetadata(
                "version=1\npendingId=a1b2c3d4\ncacheFilename=replay-a1b2c3d4.wotbreplay\n" +
                    "originalName=battle.wotbreplay\nsize=1"
            )
        )
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(version = "2")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(size = "abc")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(size = "-1")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(createdAt = "0")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(pendingId = "   ")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw() + "\nsize=9"))
    }

    @Test
    fun unsafeCacheFilenameIsNeverRestorable() {
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "../files/secret.wotbreplay")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "sub/replay.wotbreplay")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "sub\\replay.wotbreplay")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "   ")))
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(cacheFilename = "a".repeat(200))))
    }

    @Test
    fun pendingIdMustBeNonBlankAndWithinLengthBounds() {
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
        assertNull(ReplayIntentHandler.decodeMetadata(validRaw(pendingId = " ".repeat(8))))
    }

    @Test
    fun generatedPendingIdIsAFullUuidAndItsLogRefStaysShort() {
        val first = ReplayIntentHandler.newPendingId()
        val second = ReplayIntentHandler.newPendingId()

        assertEquals(first, UUID.fromString(first).toString())
        assertEquals(36, first.length)
        assertNotEquals(first, second)

        assertEquals(first.take(8), pendingLogRef(first))
        assertEquals(8, pendingLogRef(first).length)
        assertNotEquals(first, pendingLogRef(first))
        assertEquals("none", pendingLogRef(null))
    }

    @Test
    fun unknownAdditionalKeysAreIgnoredForForwardCompatibility() {
        val decoded = ReplayIntentHandler.decodeMetadata(validRaw() + "\nfutureField=whatever")!!

        assertEquals("a1b2c3d4", decoded.pendingId)
        assertEquals(1_700_000_000_000L, decoded.createdAt)
    }

    @Test
    fun expiryBoundaryIsExactlyOneHour() {
        val createdAt = 1_700_000_000_000L

        assertEquals(60L * 60 * 1000, ReplayIntentHandler.PENDING_TTL_MS)
        assertFalse(ReplayIntentHandler.isExpired(createdAt, createdAt))
        assertFalse(ReplayIntentHandler.isExpired(createdAt, createdAt + ReplayIntentHandler.PENDING_TTL_MS - 1))
        assertTrue(ReplayIntentHandler.isExpired(createdAt, createdAt + ReplayIntentHandler.PENDING_TTL_MS))
        assertTrue(ReplayIntentHandler.isExpired(createdAt, createdAt + ReplayIntentHandler.PENDING_TTL_MS + 1))
        assertTrue(ReplayIntentHandler.isExpired(createdAt, createdAt + 7 * ReplayIntentHandler.PENDING_TTL_MS))
        assertFalse(ReplayIntentHandler.isExpired(createdAt, createdAt - 60_000L))
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
        withTempCacheDir { dir ->
            val file = File(dir, "replay-a1b2c3d4.wotbreplay").apply { writeText("stale") }

            ReplayIntentHandler.cleanupOrphansInDir(dir, null)

            assertFalse(file.exists())
        }
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
            val now = 1_000L + ReplayIntentHandler.PENDING_TTL_MS - 1

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
            val now = 1_000L + ReplayIntentHandler.PENDING_TTL_MS

            assertNull("过期 active 不得恢复", ReplayIntentHandler.resolveRestorableBackingFile(metadata, dir, now))

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
                cacheFilename = "replay-99990000.wotbreplay",
                originalName = "gone.wotbreplay",
                size = 5L,
                createdAt = 1_000L
            )

            assertNull(ReplayIntentHandler.resolveRestorableBackingFile(metadata, dir, 2_000L))
            assertNull(ReplayIntentHandler.resolveRestorableBackingFile(null, dir, 2_000L))
            assertTrue(backing.exists())
        }
    }

    @Test
    fun consumedPendingLeavesNothingRestorable() {
        assertNull(ReplayIntentHandler.decodeMetadata(null))
        assertNull(ReplayIntentHandler.decodeMetadata(""))

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
