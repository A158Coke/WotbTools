package com.wotbtools.app

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

class WebDownloadTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun blobBytesArePreservedAndInputIsClosed() {
        var closed = false
        val bytes = ByteArray(100_000) { (it % 251).toByte() }
        val input = object : ByteArrayInputStream(bytes) {
            override fun close() { closed = true; super.close() }
        }
        val file = MainActivity.spoolDownload(input, temporary.root)
        assertArrayEquals(bytes, file.readBytes())
        assertTrue(closed)
    }

    @Test fun failedReadClosesInputAndRemovesPartialFile() {
        var closed = false
        val input = object : InputStream() {
            override fun read(): Int = throw IOException("read failed")
            override fun close() { closed = true }
        }
        assertThrows(IOException::class.java) { MainActivity.spoolDownload(input, temporary.root) }
        assertTrue(closed)
        assertEquals(0, temporary.root.listFiles()!!.size)
    }

    @Test fun failedTempCreationStillClosesInput() {
        var closed = false
        val input = object : ByteArrayInputStream(byteArrayOf(1)) {
            override fun close() { closed = true; super.close() }
        }
        assertThrows(IOException::class.java) {
            MainActivity.spoolDownload(input, File(temporary.root, "missing/directory"))
        }
        assertTrue(closed)
    }

    @Test fun failedCloseRemovesCompletedTempFile() {
        val input = object : ByteArrayInputStream(byteArrayOf(1, 2)) {
            override fun close() { throw IOException("close failed") }
        }
        assertThrows(IOException::class.java) { MainActivity.spoolDownload(input, temporary.root) }
        assertEquals(0, temporary.root.listFiles()!!.size)
    }

    @Test fun extendedFilenamePreservesUnicodeAndLiteralPlus() {
        assertEquals("回放+战绩.png", MainActivity.extendedDownloadName(
            "attachment; filename=fallback.png; filename*=UTF-8''%E5%9B%9E%E6%94%BE+%E6%88%98%E7%BB%A9.png"))
        assertEquals("replay.wotbreplay", MainActivity.extendedDownloadName(
            "attachment; FILENAME*=UTF-8'en'replay.wotbreplay"))
        assertNull(MainActivity.extendedDownloadName("attachment; filename=replay.wotbreplay"))
        assertNull(MainActivity.extendedDownloadName("attachment; filename*=UTF-8''%broken"))
        assertNull(MainActivity.extendedDownloadName("attachment; filename*=unknown''file"))
    }
}
