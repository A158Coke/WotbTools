package com.wotbtools.app

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FilePickerCacheTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun fixtureBytesAndOriginalNameSurviveCopy() {
        val fixture = File("../../common/fixtures/replays/random-battle-example.wotbreplay")
        val output = FilePickerCache.copy(temporary.root, "battle.wotbreplay", { fixture.inputStream() })
        assertEquals("battle.wotbreplay", output.name)
        assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(fixture.readBytes()),
            MessageDigest.getInstance("SHA-256").digest(output.readBytes()))
        assertTrue(output.isFile) // backing file remains readable after returning to Gecko
    }

    @Test fun missingOrThrowingInputLeavesNoOutput() {
        for (open in listOf<() -> InputStream?>({ null }, { throw IOException("denied") })) {
            assertThrows(IOException::class.java) { FilePickerCache.copy(temporary.root, "a.wotbreplay", open) }
            assertTrue(temporary.root.listFiles()!!.isEmpty())
        }
    }

    @Test fun partialReadAndEmptyInputAreRejectedAndCleaned() {
        val broken = object : InputStream() {
            var reads = 0
            override fun read(): Int = if (reads++ == 0) 42 else throw IOException("read failed")
        }
        for (input in listOf(broken, byteArrayOf().inputStream())) {
            assertThrows(IOException::class.java) {
                FilePickerCache.copy(temporary.root, "battle.wotbreplay", { input })
            }
            assertTrue(temporary.root.listFiles()!!.isEmpty())
        }
    }

    @Test fun writeFailureClosesInputAndRemovesSelectionDirectory() {
        var closed = false
        val input = object : java.io.ByteArrayInputStream(byteArrayOf(1, 2)) {
            override fun close() { closed = true; super.close() }
        }
        val events = mutableListOf<String>()
        assertThrows(IOException::class.java) {
            FilePickerCache.copy(temporary.root, "blocked.wotbreplay", {
                // Simulate an output that cannot be opened, after the provider stream was acquired.
                File(temporary.root.listFiles()!!.single(), "blocked.wotbreplay").mkdir()
                input
            }, events::add)
        }
        assertTrue(closed)
        assertTrue(events.single().startsWith("picker-copy-write-failed"))
        assertTrue(temporary.root.listFiles()!!.isEmpty())
    }

    @Test fun namesCannotEscapeAndKeepReplayOrImageSuffix() {
        for (name in listOf("../../battle.wotbreplay", "..\\battle.wotbreplay", "\u0000battle.wotbreplay",
            "战".repeat(200) + ".wotbreplay", "image.png")) {
            val output = FilePickerCache.copy(temporary.root, name, { byteArrayOf(1, 2).inputStream() })
            assertEquals(temporary.root.canonicalFile, output.parentFile!!.parentFile!!.canonicalFile)
            assertTrue(output.name.endsWith(if (name.endsWith(".png")) ".png" else ".wotbreplay"))
            assertTrue(output.name.toByteArray(Charsets.UTF_8).size <= 200)
        }
    }

    @Test fun sameNameSelectionsAreIndependentAndWholeBatchCanBeDiscarded() {
        val files = (1..3).map { value ->
            FilePickerCache.copy(temporary.root, "battle.wotbreplay", { byteArrayOf(value.toByte()).inputStream() })
        }
        assertEquals(3, files.map { it.absolutePath }.distinct().size)
        files.forEachIndexed { index, file -> assertArrayEquals(byteArrayOf((index + 1).toByte()), file.readBytes()) }
        FilePickerCache.discard(files)
        assertTrue(temporary.root.listFiles()!!.isEmpty())
    }

    @Test fun cleanupPreservesFreshFilesAndExpiresOldOnes() {
        val old = FilePickerCache.copy(temporary.root, "old.wotbreplay", { byteArrayOf(1).inputStream() })
        val fresh = FilePickerCache.copy(temporary.root, "new.png", { byteArrayOf(2).inputStream() })
        val now = System.currentTimeMillis()
        assertTrue(old.parentFile!!.setLastModified(now - 60L * 60 * 1000))
        assertTrue(fresh.parentFile!!.setLastModified(now - 60L * 60 * 1000 + 1000))
        FilePickerCache.cleanup(temporary.root, now)
        assertFalse(old.exists())
        assertArrayEquals(byteArrayOf(2), fresh.readBytes())
    }
}
